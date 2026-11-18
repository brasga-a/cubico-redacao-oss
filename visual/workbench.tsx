import { useState } from 'react'
import type { CorrectionModelChoice } from '@/lib/correction'
import { ConfirmDialog } from '@/components/confirm-dialog'
import type { ConfirmRequest } from '@/components/confirm-dialog'
import {
  GradingError,
} from '@/components/evaluation/grading-states'
import { TooltipProvider } from '@/components/ui/tooltip'
import { EditorScreen } from '@/components/screens/editor-screen'
import { EvaluationPendingScreen } from '@/components/screens/evaluation-pending-screen'
import { EvaluationScreen } from '@/components/screens/evaluation-screen'
import { HistoryScreen } from '@/components/screens/history-screen'
import { LoginScreen } from '@/components/screens/login-screen'
import { sameDraft } from '@/lib/workbench/view-model'
import type { Draft, Evaluation } from '@/lib/workbench/types'
import {
  evaluationForScenario,
  emptyDraft,
  sampleDraft,
  evaluation,
  history,
  scenarios,
} from './fixtures'
import type { Scenario } from './fixtures'

function initialScenario(): Scenario {
  const value = new URLSearchParams(location.search).get('scenario')
  return scenarios.find((s) => s === value) ?? 'login'
}
/** Test-only in-memory composition. Not a TanStack route, identity provider, store or evaluator. */
export function VisualWorkbench() {
  const [scenario, setScenario] = useState(initialScenario)
  const [modelChoice, setModelChoice] = useState<CorrectionModelChoice>('argon')
  const [draft, setDraft] = useState<Draft>(() =>
    initialScenario() === 'editor-empty' ||
    initialScenario().startsWith('login')
      ? { ...emptyDraft }
      : { ...sampleDraft, supportingTexts: [...sampleDraft.supportingTexts] },
  )
  const [records, setRecords] = useState<Evaluation[]>(() =>
    initialScenario() === 'history-empty' ? [] : structuredClone(history),
  )
  const [current, setCurrent] = useState(() =>
    evaluationForScenario(initialScenario()),
  )
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null)
  function choose(next: Scenario, reset = false) {
    setScenario(next)
    if (reset && next === 'editor-empty') setDraft({ ...emptyDraft })
    if (reset && next === 'editor-filled') setDraft({ ...sampleDraft })
    if (reset && next === 'history') setRecords(structuredClone(history))
    if (reset && next === 'history-empty') setRecords([])
    if (['evaluation-zero', 'evaluation', 'text', 'text-empty'].includes(next))
      setCurrent(evaluationForScenario(next))
    window.scrollTo(0, 0)
  }
  function protect(
    title: string,
    description: string,
    actionLabel: string,
    apply: () => void,
  ) {
    if (
      !draft.essay &&
      !draft.topic &&
      !draft.title &&
      !draft.supportingTexts.some(Boolean)
    ) {
      apply()
      return
    }
    setConfirm({ title, description, actionLabel, onConfirm: apply })
  }
  function newDraft() {
    protect(
      'Começar uma nova redação?',
      'O conteúdo atual será removido do editor de teste. As avaliações do cenário permanecem disponíveis.',
      'Apagar e começar',
      () => {
        setDraft({ ...emptyDraft })
        choose('editor-empty')
      },
    )
  }
  const login = scenario.startsWith('login')
  const processing = scenario === 'processing'
  const error = scenario === 'error-network' || scenario === 'error-service'
  const result =
    scenario === 'evaluation' ||
    scenario === 'evaluation-zero' ||
    scenario === 'text' ||
    scenario === 'text-empty'
  return (
    <TooltipProvider delay={300}>
      <aside
        data-fixture-controls
        className="fixed bottom-20 right-2 z-[100] flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-lg border bg-background px-2 py-1 text-xs shadow-sm"
      >
        <label htmlFor="scenario">Ambiente isolado · fixtures</label>
        <select
          id="scenario"
          className="min-w-0 max-w-36"
          value={scenario}
          onChange={(e) => choose(e.target.value as Scenario, true)}
        >
          {scenarios.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {processing && (
          <button
            className="rounded border px-2"
            onClick={() => choose('evaluation')}
          >
            Resolver fixture
          </button>
        )}
      </aside>
      {login ? (
        <LoginScreen
          onSignIn={() => choose('editor-empty')}
          status={
            scenario === 'login-loading'
              ? 'loading'
              : scenario === 'login-error'
                ? 'error'
                : 'idle'
          }
        />
      ) : (
        <div className="min-h-dvh">
          {processing ? (
            <EvaluationPendingScreen
              topic={draft.topic}
              essay={draft.essay}
              pipeline="single"
              startedAt={Date.parse('2026-11-05T12:00:00.000Z')}
              onCancel={() =>
                choose(draft.essay ? 'editor-filled' : 'editor-empty')
              }
            />
          ) : error ? (
            <GradingError
              reason={scenario === 'error-network' ? 'network' : 'service'}
              onRetry={() => choose('processing')}
              onBack={() =>
                choose(draft.essay ? 'editor-filled' : 'editor-empty')
              }
            />
          ) : result ? (
            <EvaluationScreen
              key={`${current.id}-${scenario}`}
              evaluation={current}
              fresh={false}
              initialTab={scenario.startsWith('text') ? 'text' : 'summary'}
              onRevise={() =>
                protect(
                  'Substituir o rascunho atual?',
                  'O texto da avaliação será copiado para uma nova revisão em memória. O original será preservado.',
                  'Substituir rascunho',
                  () => {
                    setDraft({
                      topic: current.topic,
                      title: current.title,
                      essay: current.essay,
                      supportingTexts: [...current.supportingTexts],
                      updatedAt: '2026-11-05T12:00:00.000Z',
                    })
                    setScenario('editor-filled')
                  },
                )
              }
              onNew={newDraft}
            />
          ) : scenario.startsWith('history') ? (
            <HistoryScreen
              history={records}
              onOpen={(id) => {
                const found = records.find((e) => e.id === id)
                if (found) {
                  setCurrent(found)
                  setScenario('evaluation')
                }
              }}
              onNew={newDraft}
            />
          ) : (
            <>
              {(scenario === 'save-error' || scenario === 'security-error') && (
                <div
                  role="alert"
                  className="mx-auto mt-5 max-w-6xl rounded-lg border border-destructive/25 bg-destructive-soft px-5 py-3 text-sm"
                >
                  {scenario === 'save-error'
                    ? 'Não foi possível salvar o rascunho. Mantenha uma cópia do texto.'
                    : 'O serviço atingiu o limite de correções simultâneas. Seu rascunho permanece no editor.'}
                </div>
              )}
              <EditorScreen
                modelChoice={modelChoice}
                onModelChoiceChange={setModelChoice}
                draft={draft}
                onChange={(patch) =>
                  setDraft((d) => ({
                    ...d,
                    ...patch,
                    updatedAt: '2026-11-05T12:00:00.000Z',
                  }))
                }
                saving={scenario === 'saving'}
                saveFailed={scenario === 'save-error'}
                onSubmit={() => {
                  choose('processing')
                }}
                onLoadSample={() =>
                  protect(
                    'Substituir pelo exemplo?',
                    'O conteúdo atual será substituído por texto sintético de teste. Nenhuma correção será executada.',
                    'Usar exemplo',
                    () => {
                      setDraft({ ...sampleDraft })
                      setScenario('editor-filled')
                    },
                  )
                }
                onChooseTheme={(topic) =>
                  protect(
                    'Substituir o tema?',
                    'O tema atual será substituído; o corpo da redação será mantido.',
                    'Substituir tema',
                    () =>
                      setDraft((d) => ({
                        ...d,
                        topic,
                        updatedAt: '2026-11-05T12:00:00.000Z',
                      })),
                  )
                }
                onClear={() =>
                  protect(
                    'Apagar o texto?',
                    'O conteúdo será removido apenas do editor em memória.',
                    'Apagar texto',
                    () => {
                      setDraft({ ...emptyDraft })
                      setScenario('editor-empty')
                    },
                  )
                }
                matchingEvaluation={
                  sameDraft(draft, sampleDraft) ? evaluation : null
                }
                onOpenEvaluation={() => {
                  setCurrent(evaluation)
                  choose('evaluation')
                }}
              />
            </>
          )}
        </div>
      )}
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
    </TooltipProvider>
  )
}
