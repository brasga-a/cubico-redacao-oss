import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate, useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { authClient } from '@/lib/auth-client'
import {
  correctEssay,
  deleteAllEvaluations,
  deleteEvaluation,
  getEvaluation,
  importEvaluations,
  listEvaluations,
  setHistoryPreference,
} from '@/lib/server-functions'
import { correctionRequestSchema } from '@/lib/correction'
import type {
  AppStatus,
  CorrectionModelChoice,
  CorrectionPipeline,
} from '@/lib/correction'
import {
  CLOUD_CONSENT_VERSION,
  HISTORY_LIMIT,
  HISTORY_PAGE_SIZE,
  HISTORY_RETENTION_MS,
  IMPORT_BATCH_SIZE,
  evaluationRecordSchema,
} from '@/lib/evaluation-history'
import type {
  EvaluationRecord,
  EvaluationSummary,
  HistoryPreference,
  ImportOutcome,
} from '@/lib/evaluation-history'
import { ConfirmDialog } from '@/components/confirm-dialog'
import type { ConfirmRequest } from '@/components/confirm-dialog'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  clearLocalHistory,
  draftSchema,
  makeRecord,
  scanLocalHistory,
} from '@/lib/workbench/history'
import type { StoredEvaluation } from '@/lib/workbench/history'
import {
  clearCache,
  clearOtherAccounts,
  readCache,
  reconcile,
  withRecord,
  withoutRecord,
  writeCache,
} from '@/lib/workbench/history-cache'
import type { HistoryCache } from '@/lib/workbench/history-cache'
import type { Draft } from '@/lib/workbench/types'
import { evaluationView, sameDraft, summaryView } from '@/lib/workbench/view-model'
import {
  DEFAULT_MODEL_CHOICE,
  findMatchingRecord,
  parseModelChoice,
} from '@/lib/workbench/pipeline'
import { realAnnotations } from '@/lib/workbench/annotations'
import { SAMPLE_DRAFT } from '@/lib/workbench/sample'

export type AuthorizedStatus = AppStatus & {
  user: { id: string; name: string; email: string }
}
const blank = (): Draft => ({
  topic: '',
  title: '',
  essay: '',
  supportingTexts: [],
  updatedAt: null,
})
const DISABLED: HistoryPreference = {
  cloudEnabled: false,
  consentVersion: null,
  consentedAt: null,
  revokedAt: null,
}
export type LocalImportState = {
  /** Valid local records within the retention window (importable). */
  importable: EvaluationRecord[]
  /** Local records that are invalid or older than the retention window. */
  skipped: number
  running: boolean
  done: number
  results: ImportOutcome[]
  /** True once every importable record is confirmed in the cloud. */
  confirmed: boolean
}
export type RecordLookup = 'loading' | 'missing' | 'error'
const WorkbenchContext = createContext<ReturnType<
  typeof useWorkbenchState
> | null>(null)

export function WorkbenchProvider({
  status,
  children,
}: {
  status: AuthorizedStatus
  children: ReactNode
}) {
  const state = useWorkbenchState(status)
  return (
    <WorkbenchContext value={state}>
      <TooltipProvider delay={300}>
        {children}
        <ConfirmDialog
          request={state.confirm}
          onClose={() => state.setConfirm(null)}
        />
      </TooltipProvider>
    </WorkbenchContext>
  )
}
export function useWorkbench() {
  const context = useContext(WorkbenchContext)
  if (!context) throw new Error('Workbench requires its authenticated layout')
  return context
}
export type PendingCorrection = {
  id: string
  topic: string
  essay: string
  pipeline: CorrectionPipeline
  startedAt: number
}

function useWorkbenchState(status: AuthorizedStatus) {
  const navigate = useNavigate(),
    router = useRouter()
  const [draft, setDraft] = useState<Draft>(blank),
    [saveFailed, setSaveFailed] = useState(false)
  // Cloud metadata (listing) and full records opened in this tab (session + fetched).
  const [summaries, setSummaries] = useState<EvaluationSummary[]>([]),
    [sessionRecords, setSessionRecords] = useState<StoredEvaluation[]>([]),
    [opened, setOpened] = useState<StoredEvaluation[]>([]),
    [lookups, setLookups] = useState<Partial<Record<string, RecordLookup>>>({})
  const [preference, setPreference] = useState<HistoryPreference>(DISABLED),
    [historyReady, setHistoryReady] = useState(false),
    [draftReady, setDraftReady] = useState(false),
    [local, setLocal] = useState<LocalImportState | null>(null)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  const [token, setToken] = useState(''),
    [reset, setReset] = useState(0)
  // Grading architecture: kept per account for the tab, across edits and recoverable errors.
  // Model for the next correction: kept per account for the tab, across edits and recoverable errors.
  const [modelChoice, setModelChoiceState] =
    useState<CorrectionModelChoice>(DEFAULT_MODEL_CHOICE)
  // Correction running in this tab; its page is /redacao/<requestId> until the result arrives.
  const [pending, setPending] = useState<PendingCorrection | null>(null)
  const revision = useRef(0),
    generation = useRef(0),
    lock = useRef(false),
    ready = useRef(false)
  const owner = useRef<string | null>(status.user.id),
    parent = useRef<string | undefined>(undefined),
    inflight = useRef(new Set<string>()),
    cache = useRef<HistoryCache | null>(null),
    cloudEnabled = useRef(false)
  const operation = useRef<string | null>(null)
  useEffect(() => {
    const id = status.user.id
    const effect = { cancelled: false }
    owner.current = id
    ready.current = false
    try {
      setModelChoiceState(
        parseModelChoice(sessionStorage.getItem(`cubico-model:${id}`)),
      )
    } catch {
      setModelChoiceState(DEFAULT_MODEL_CHOICE)
    }
    try {
      const raw = sessionStorage.getItem(`cubico-draft:${id}`)
      const parsed = raw ? draftSchema.safeParse(JSON.parse(raw)) : null
      setDraft(parsed?.success ? parsed.data : blank())
      if (raw && !parsed?.success) setSaveFailed(true)
    } catch {
      setSaveFailed(true)
    } finally {
      ready.current = true
      setDraftReady(true)
    }
    cache.current = null
    void (async () => {
      // Show this device's copy first, then reconcile it with D1 (the source of truth).
      try {
        await clearOtherAccounts(id)
        const cached = await readCache(id)
        if (cached && !effect.cancelled && owner.current === id) {
          cache.current = cached
          setSummaries(cached.summaries)
          setOpened(cached.records.map((r) => own(id, r)))
          setHistoryReady(true)
        }
      } catch {
        // Cache unavailable: fall back to the server only.
      }
      await refreshHistory(id)
      if (!effect.cancelled) setHistoryReady(true)
    })()
    void scanLocal(id)
    return () => {
      effect.cancelled = true
      generation.current++
      owner.current = null
      ready.current = false
    }
  }, [status.user.id])
  const own = (id: string, record: EvaluationRecord): StoredEvaluation => ({
    ...record,
    owner: id,
  })
  /** Updates the device cache, writing to IndexedDB only when something changed. */
  function commitCache(
    id: string,
    next: { cache: HistoryCache; changed: boolean },
  ) {
    if (owner.current !== id) return
    cache.current = next.cache
    if (next.changed && cloudEnabled.current)
      void writeCache(id, next.cache).catch(() => {})
  }
  function dropCache(id: string) {
    cache.current = null
    void clearCache(id).catch(() => {})
  }
  function cacheRecord(id: string, record: EvaluationRecord) {
    commitCache(id, withRecord(cache.current, record))
  }
  /** Loads every metadata page (retention caps the history at HISTORY_LIMIT rows). */
  async function refreshHistory(id: string) {
    const items: EvaluationSummary[] = []
    let cursor: string | undefined
    try {
      for (let page = 0; page * HISTORY_PAGE_SIZE < HISTORY_LIMIT; page++) {
        const response = await listEvaluations({
          data: { cursor, limit: HISTORY_PAGE_SIZE },
        })
        if (owner.current !== id) return
        if (!response.ok) throw new Error(response.error.message)
        items.push(...response.data.items)
        setPreference(response.data.preference)
        cloudEnabled.current = response.data.preference.cloudEnabled
        cursor = response.data.nextCursor ?? undefined
        if (!cursor) break
      }
      setSummaries(items)
      if (cloudEnabled.current) {
        const next = reconcile(cache.current, items)
        commitCache(id, next)
        // Deleted on another device or expired: the cached payload goes too.
        if (next.removed.length) {
          const removed = new Set(next.removed)
          setOpened((records) => records.filter((r) => !removed.has(r.id)))
        }
      } else dropCache(id)
    } catch {
      if (owner.current === id)
        setError(
          cache.current
            ? 'Sem conexão com o histórico na nuvem: mostrando a cópia salva neste dispositivo, que pode estar desatualizada.'
            : 'Não foi possível carregar o histórico na nuvem. A correção continua disponível; tente novamente mais tarde.',
        )
    }
  }
  async function scanLocal(id: string) {
    try {
      const scan = await scanLocalHistory(id)
      if (owner.current !== id) return
      const cutoff = Date.now() - HISTORY_RETENTION_MS
      const importable = scan.records.filter(
        (r) => Date.parse(r.createdAt) >= cutoff,
      )
      const skipped = scan.invalid + scan.records.length - importable.length
      setLocal(
        importable.length || skipped
          ? {
              importable,
              skipped,
              running: false,
              done: 0,
              results: [],
              confirmed: false,
            }
          : null,
      )
    } catch {
      // Local storage unavailable: nothing to import.
    }
  }
  /** Opens a full record from this tab or, if needed, from the cloud (no inference). */
  function ensureRecord(evaluationId: string) {
    const id = owner.current
    if (
      !id ||
      findRecord(evaluationId) ||
      inflight.current.has(evaluationId) ||
      !evaluationRecordSchema.shape.id.safeParse(evaluationId).success
    ) {
      if (
        id &&
        !evaluationRecordSchema.shape.id.safeParse(evaluationId).success
      )
        setLookups((m) => ({ ...m, [evaluationId]: 'missing' }))
      return
    }
    inflight.current.add(evaluationId)
    setLookups((m) => ({ ...m, [evaluationId]: 'loading' }))
    void getEvaluation({ data: { id: evaluationId } })
      .then((response) => {
        if (owner.current !== id) return
        if (!response.ok) throw new Error(response.error.message)
        const parsed = response.data
          ? evaluationRecordSchema.safeParse(response.data)
          : null
        if (parsed?.success) {
          cacheRecord(id, parsed.data)
          setOpened((items) => [
            own(id, parsed.data),
            ...items.filter((r) => r.id !== evaluationId),
          ])
        }
        setLookups((m) => {
          const next = { ...m }
          if (parsed?.success) delete next[evaluationId]
          else next[evaluationId] = 'missing'
          return next
        })
      })
      .catch(() => {
        if (owner.current === id)
          setLookups((m) => ({ ...m, [evaluationId]: 'error' }))
      })
      .finally(() => inflight.current.delete(evaluationId))
  }
  function retryRecord(evaluationId: string) {
    setLookups((m) => {
      const next = { ...m }
      delete next[evaluationId]
      return next
    })
    ensureRecord(evaluationId)
  }
  function change(patch: Partial<Draft>) {
    revision.current++
    const next = { ...draft, ...patch, updatedAt: new Date().toISOString() }
    setDraft(next)
    if (ready.current && owner.current) {
      try {
        sessionStorage.setItem(
          `cubico-draft:${owner.current}`,
          JSON.stringify(next),
        )
        setSaveFailed(false)
      } catch {
        setSaveFailed(true)
      }
    }
  }
  function replace(next: Draft) {
    change(next)
    void navigate({ to: '/editor' })
  }
  function protect(title: string, apply: () => void) {
    if (
      !draft.essay &&
      !draft.topic &&
      !draft.title &&
      !draft.supportingTexts.some(Boolean)
    ) {
      apply()
      return
    }
    setConfirm({
      title,
      description:
        'O conteúdo atual do editor será substituído. Avaliações anteriores não serão alteradas.',
      actionLabel: 'Confirmar',
      onConfirm: apply,
    })
  }
  function newEssay() {
    protect('Começar nova redação?', () => {
      parent.current = undefined
      replace(blank())
    })
  }
  function loadSample() {
    protect('Substituir pelo exemplo?', () => {
      parent.current = undefined
      replace({
        ...SAMPLE_DRAFT,
        supportingTexts: [...SAMPLE_DRAFT.supportingTexts],
        updatedAt: new Date().toISOString(),
      })
    })
  }
  function revise(record: StoredEvaluation) {
    protect('Revisar sem alterar a avaliação original?', () => {
      parent.current = record.id
      replace({
        ...structuredClone(record.input),
        updatedAt: new Date().toISOString(),
      })
    })
  }
  async function updatePreference(enabled: boolean) {
    const id = owner.current
    if (!id) return
    try {
      const response = await setHistoryPreference({
        data: enabled
          ? { enabled: true, consentVersion: CLOUD_CONSENT_VERSION }
          : { enabled: false },
      })
      if (!response.ok) throw new Error(response.error.message)
      if (owner.current === id) {
        setPreference(response.data)
        cloudEnabled.current = response.data.cloudEnabled
        if (!response.data.cloudEnabled) dropCache(id)
      }
    } catch {
      if (owner.current === id)
        setError(
          enabled
            ? 'Não foi possível ativar o histórico na nuvem. Nada foi salvo.'
            : 'Não foi possível desativar o histórico na nuvem. Tente novamente.',
        )
    }
  }
  function optIn() {
    setConfirm({
      title: 'Ativar histórico na nuvem?',
      description: `As próximas correções concluídas (tema, título, texto, textos motivadores e devolutiva) serão salvas na sua conta e poderão ser abertas em qualquer dispositivo em que você entrar. Guardamos as ${HISTORY_LIMIT} avaliações mais recentes por até ${HISTORY_RETENTION_MS / 86_400_000} dias; você pode excluí-las a qualquer momento. Rascunhos continuam somente neste navegador.`,
      actionLabel: 'Ativar e salvar na nuvem',
      onConfirm: () => void updatePreference(true),
    })
  }
  function optOut() {
    setConfirm({
      title: 'Desativar o histórico na nuvem?',
      description:
        'Novas correções deixarão de ser salvas. As avaliações já salvas continuam na sua conta até você excluí-las ou até expirarem pela política de retenção.',
      actionLabel: 'Desativar',
      onConfirm: () => void updatePreference(false),
    })
  }
  async function clear() {
    const id = owner.current
    if (!id) return
    generation.current++
    revision.current++
    try {
      await clearLocalHistory(id)
      dropCache(id)
      if (owner.current !== id) return
      sessionStorage.removeItem(`cubico-draft:${id}`)
      setLocal(null)
      setSessionRecords([])
      setDraft(blank())
      parent.current = undefined
      void navigate({ to: '/editor' })
    } catch {
      setError('A limpeza local não foi concluída. Tente novamente.')
    }
  }
  function confirmClear() {
    setConfirm({
      title: 'Apagar dados locais desta conta?',
      description:
        'Apaga o rascunho e o histórico antigo guardado neste navegador. Não remove o histórico na nuvem, a conta nem os registros operacionais de consumo do servidor.',
      actionLabel: 'Apagar dados locais',
      onConfirm: () => void clear(),
    })
  }
  function forget(evaluationId?: string) {
    const keep = (r: { id: string }) =>
      evaluationId !== undefined && r.id !== evaluationId
    setSummaries((items) => items.filter(keep))
    setOpened((items) => items.filter(keep))
    setSessionRecords((items) => items.filter(keep))
  }
  function deleteRecord(evaluationId: string) {
    setConfirm({
      title: 'Excluir avaliação da nuvem?',
      description:
        'Remove esta avaliação da sua conta em todos os dispositivos. A ação não pode ser desfeita. Registros operacionais de consumo não são afetados.',
      actionLabel: 'Excluir',
      onConfirm: () => {
        const id = owner.current
        if (!id) return
        void deleteEvaluation({ data: { id: evaluationId } })
          .then((response) => {
            if (!response.ok) throw new Error(response.error.message)
            if (owner.current === id) {
              forget(evaluationId)
              commitCache(id, withoutRecord(cache.current, evaluationId))
            }
          })
          .catch(() => {
            if (owner.current === id)
              setError('Não foi possível excluir a avaliação.')
          })
      },
    })
  }
  function confirmDeleteAll() {
    setConfirm({
      title: 'Excluir todo o histórico na nuvem?',
      description:
        'Remove todas as avaliações salvas nesta conta, em todos os dispositivos. A ação não pode ser desfeita. Rascunhos locais, a preferência de armazenamento e os registros operacionais de consumo não são afetados.',
      actionLabel: 'Excluir tudo',
      onConfirm: () => {
        const id = owner.current
        if (!id) return
        void deleteAllEvaluations({ data: { confirm: true } })
          .then((response) => {
            if (!response.ok) throw new Error(response.error.message)
            if (owner.current === id) {
              forget()
              dropCache(id)
            }
          })
          .catch(() => {
            if (owner.current === id)
              setError('Não foi possível excluir o histórico.')
          })
      },
    })
  }
  /** Sends local records in bounded batches; safe to re-run (server dedupes by id). */
  async function runImport() {
    const id = owner.current
    if (!id || !local || local.running) return
    const pending = local.importable
    setLocal({ ...local, running: true, done: 0, results: [] })
    const results: ImportOutcome[] = []
    try {
      for (let i = 0; i < pending.length; i += IMPORT_BATCH_SIZE) {
        const response = await importEvaluations({
          data: { records: pending.slice(i, i + IMPORT_BATCH_SIZE) },
        })
        // Stop if the account changed or signed out meanwhile; finished batches stay saved.
        if (owner.current !== id) return
        if (!response.ok) throw new Error(response.error.message)
        results.push(...response.data.results)
        setLocal(
          (s) => s && { ...s, done: results.length, results: [...results] },
        )
      }
      const confirmed = results.every(
        (r) => r.status === 'imported' || r.status === 'duplicate',
      )
      setLocal((s) => s && { ...s, running: false, results, confirmed })
      await refreshHistory(id)
    } catch {
      if (owner.current !== id) return
      setLocal((s) => s && { ...s, running: false, results })
      setError(
        'A importação foi interrompida. As avaliações já enviadas foram mantidas; você pode retomar sem duplicar registros.',
      )
    }
  }
  function confirmImport() {
    if (!local?.importable.length) return
    setConfirm({
      title: `Enviar ${local.importable.length} avaliações para a nuvem?`,
      description:
        'As avaliações deste navegador (tema, título, texto, textos motivadores e devolutiva) serão copiadas para sua conta, sem nova correção e sem consumir créditos. Nada é apagado deste navegador.',
      actionLabel: 'Importar',
      onConfirm: () => void runImport(),
    })
  }
  function confirmClearLocalHistory() {
    const id = owner.current
    if (!id || !local?.confirmed) return
    setConfirm({
      title: 'Apagar o histórico antigo deste navegador?',
      description:
        'A importação foi confirmada na nuvem. Isto remove apenas a cópia local das avaliações; o rascunho atual e o histórico na nuvem não são alterados.',
      actionLabel: 'Apagar cópia local',
      onConfirm: () =>
        void clearLocalHistory(id)
          .then(() => owner.current === id && setLocal(null))
          .catch(() => setError('Não foi possível apagar a cópia local.')),
    })
  }
  async function signOut() {
    generation.current++
    revision.current++
    const id = owner.current
    // Remove this account's device copy before the session ends.
    if (id) {
      cache.current = null
      await clearCache(id).catch(() => {})
    }
    try {
      const response = await authClient.signOut()
      if (response.error) throw new Error('Sign-out failed')
      owner.current = null
      setSummaries([])
      setOpened([])
      setSessionRecords([])
      setDraft(blank())
      await navigate({ to: '/login', search: {}, replace: true })
      await router.invalidate()
    } catch {
      setError('Não foi possível encerrar a sessão.')
    }
  }
  function stopWaiting() {
    generation.current++
    setBusy(false)
    setPending(null)
    setError(
      'Você parou de aguardar. O servidor pode continuar processando e consumir créditos.',
    )
    void navigate({ to: '/editor' })
  }
  async function submit() {
    if (lock.current) return
    if (!status.configured) {
      setError('O serviço de correção ainda não está configurado.')
      return
    }
    if (status.turnstileSiteKey && !token) {
      setError('Confirme a verificação de segurança.')
      return
    }
    if (operation.current) {
      setConfirm({
        title: 'Enviar uma nova tentativa?',
        description:
          'O resultado anterior é desconhecido. Uma nova solicitação pode gerar uma segunda cobrança. Aguarde se a correção ainda estiver em andamento.',
        actionLabel: 'Enviar nova solicitação',
        onConfirm: () => {
          operation.current = null
          void submit()
        },
      })
      return
    }
    const snapshot = structuredClone(draft),
      id = owner.current,
      stamp = generation.current,
      version = revision.current,
      requestId = crypto.randomUUID(),
      parentId = parent.current
    if (!id) return
    const parsed = correctionRequestSchema.safeParse({
      requestId,
      theme: snapshot.topic,
      essay: snapshot.essay,
      title: snapshot.title,
      supportingTexts: snapshot.supportingTexts,
      turnstileToken: token || undefined,
      parentId,
      pipeline: 'single',
      modelChoice,
    })
    if (!parsed.success) {
      setError('Confira os campos e os limites de texto.')
      return
    }
    snapshot.essay = parsed.data.essay
    operation.current = requestId
    lock.current = true
    setBusy(true)
    setError('')
    let sent = false
    const pendingPath = `/redacao/${requestId}`
    const onPendingPage = () =>
      router.state.location.pathname === pendingPath
    setPending({
      id: requestId,
      topic: snapshot.topic,
      essay: snapshot.essay,
      pipeline: 'single',
      startedAt: Date.now(),
    })
    try {
      await navigate({
        to: '/redacao/$evaluationId',
        params: { evaluationId: requestId },
        search: { tab: 'summary' },
      })
      if (owner.current !== id || generation.current !== stamp) {
        operation.current = null
        return
      }
      sent = true
      const response = await correctEssay({ data: parsed.data })
      operation.current = null
      if (
        stamp !== generation.current ||
        owner.current !== id ||
        revision.current !== version
      )
        return
      if (!response.ok) {
        setError(response.error.message)
        if (onPendingPage()) void navigate({ to: '/editor' })
        return
      }
      const persistence = response.persistence
      const record = makeRecord(
        id,
        requestId,
        snapshot,
        response.data,
        parentId,
      )
      if (
        persistence?.status === 'saved' ||
        persistence?.status === 'recovered'
      )
        record.createdAt = persistence.createdAt
      setSessionRecords((items) => [record, ...items])
      if (persistence?.status === 'failed')
        setError(
          'Correção concluída, mas não foi possível salvá-la no histórico na nuvem. Ela continua disponível nesta aba; mantenha uma cópia se precisar.',
        )
      else if (persistence?.status === 'saved')
        void refreshHistory(id).then(() => {
          const { owner: _owner, ...saved } = record
          cacheRecord(id, saved)
        })
      // Already on /redacao/<requestId>: the page swaps the placeholders for the result.
    } catch {
      if (!sent) operation.current = null
      // The result may have been saved before the connection dropped: look it up (no inference).
      if (sent && preference.cloudEnabled && owner.current === id) {
        const recovered = await getEvaluation({
          data: { id: requestId },
        }).catch(() => null)
        const found =
          recovered?.ok && recovered.data
            ? evaluationRecordSchema.safeParse(recovered.data)
            : null
        if (found?.success && owner.current === id) {
          operation.current = null
          setOpened((items) => [own(id, found.data), ...items])
          void refreshHistory(id).then(() => cacheRecord(id, found.data))
          if (stamp === generation.current)
            void navigate({
              to: '/redacao/$evaluationId',
              params: { evaluationId: requestId },
              search: { tab: 'summary' },
            })
          return
        }
      }
      if (stamp === generation.current) {
        setError(
          sent
            ? 'Conexão interrompida: o resultado é desconhecido. Seu texto foi preservado. Não repetimos a solicitação automaticamente.'
            : 'Não foi possível iniciar a correção. Seu texto foi preservado.',
        )
        if (onPendingPage()) void navigate({ to: '/editor' })
      }
    } finally {
      lock.current = false
      setBusy(false)
      setPending((current) => (current?.id === requestId ? null : current))
      setReset((n) => n + 1)
      setToken('')
    }
  }
  const available = [...sessionRecords, ...opened].filter(
    (record) => record.owner === status.user.id,
  )
  function findRecord(evaluationId: string) {
    return available.find((record) => record.id === evaluationId)
  }
  const matching = findMatchingRecord(available, draft, modelChoice, sameDraft)
  function setModelChoice(next: CorrectionModelChoice) {
    setModelChoiceState(next)
    try {
      sessionStorage.setItem(`cubico-model:${status.user.id}`, next)
    } catch {
      // The choice still applies to this page; it just won't survive a reload.
    }
  }
  const toView = (record: StoredEvaluation) =>
    evaluationView(
      record.id,
      record.createdAt,
      record.input,
      record.result,
      realAnnotations(record.input.essay, record.result),
    )
  return {
    status,
    draft,
    change,
    saveFailed,
    draftReady,
    summaries,
    history: summaries.map(summaryView),
    preference,
    enabled: preference.cloudEnabled,
    historyReady,
    local,
    error,
    setError,
    busy,
    confirm,
    setConfirm,
    token,
    setToken,
    reset,
    submit,
    pending,
    modelChoice,
    setModelChoice,
    stopWaiting,
    optIn,
    optOut,
    confirmClear,
    deleteRecord,
    confirmDeleteAll,
    confirmImport,
    confirmClearLocalHistory,
    ensureRecord,
    retryRecord,
    lookupStatus: (evaluationId: string) => lookups[evaluationId],
    signOut,
    newEssay,
    loadSample,
    revise,
    protect,
    clearDraft: () =>
      protect('Apagar rascunho?', () => {
        parent.current = undefined
        replace(blank())
      }),
    chooseTheme: (topic: string) =>
      protect('Substituir o tema?', () => change({ topic })),
    findRecord,
    matchingEvaluation: matching ? toView(matching) : null,
    toView,
    latest: sessionRecords.at(0),
  }
}
