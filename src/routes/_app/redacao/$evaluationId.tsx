import { useEffect, useRef } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useWorkbench } from '@/providers/workbench-provider'
import { EvaluationScreen } from '@/components/screens/evaluation-screen'
import type { EvaluationTab } from '@/components/screens/evaluation-screen'
import { PageLoading } from '@/components/layout/loading'
import { EvaluationPendingScreen } from '@/components/screens/evaluation-pending-screen'

const EASE = [0.22, 1, 0.36, 1] as const

export const Route = createFileRoute('/_app/redacao/$evaluationId')({
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab: EvaluationTab } => ({
    tab:
      search.tab === 'competencies' || search.tab === 'text'
        ? search.tab
        : 'summary',
  }),
  component: EvaluationPage,
})
function EvaluationPage() {
  const { evaluationId } = Route.useParams(),
    { tab } = Route.useSearch(),
    navigate = useNavigate(),
    state = useWorkbench()
  const record = state.findRecord(evaluationId)
  const lookup = state.lookupStatus(evaluationId)
  const { ensureRecord } = state
  // A correction running in this tab for this id: show it in place until the result arrives.
  const pending = state.pending?.id === evaluationId ? state.pending : null
  // Once this page has shown the in-progress state, the result enters with its reveal animations.
  const waited = useRef<string | null>(null)
  if (pending) waited.current = evaluationId
  const revealed = waited.current === evaluationId
  useEffect(() => {
    // Full payload is fetched only when an evaluation is opened (no new inference).
    // A pending id has no record yet: looking it up would report it as missing.
    if (state.historyReady && !pending) ensureRecord(evaluationId)
  }, [evaluationId, state.historyReady, pending]) // ensureRecord is idempotent per id

  if (pending || (record && revealed))
    return (
      <MotionConfig reducedMotion="user">
        <AnimatePresence mode="wait" initial={false}>
          {record ? (
            <motion.div
              key="result"
              initial={{ opacity: 0, y: 12, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ duration: 0.45, ease: EASE }}
            >
              {result(true)}
            </motion.div>
          ) : (
            pending && (
              <motion.div
                key="pending"
                exit={{ opacity: 0, y: -6, filter: 'blur(4px)' }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <EvaluationPendingScreen
                  topic={pending.topic}
                  essay={pending.essay}
                  pipeline={pending.pipeline}
                  startedAt={pending.startedAt}
                  onCancel={state.stopWaiting}
                />
              </motion.div>
            )
          )}
        </AnimatePresence>
      </MotionConfig>
    )
  if (!record && (!state.historyReady || lookup === 'loading' || !lookup))
    return <PageLoading />
  if (!record)
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <h1 className="text-xl font-semibold">
          {lookup === 'error'
            ? 'Não foi possível abrir a avaliação'
            : 'Avaliação indisponível'}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {lookup === 'error'
            ? 'O histórico na nuvem não respondeu. Tente novamente em instantes.'
            : 'O registro pode ter sido excluído, expirado ou não ter sido salvo no histórico na nuvem. Se a página foi recarregada durante a correção, o resultado aparece no histórico quando ficar pronto (com o histórico na nuvem ativo); recarregar não reenvia a redação.'}
        </p>
        {lookup === 'error' && (
          <button
            type="button"
            className="mt-6 mr-4 inline-block underline"
            onClick={() => state.retryRecord(evaluationId)}
          >
            Tentar novamente
          </button>
        )}
        <Link to="/historico" className="mt-6 inline-block underline">
          Ver histórico
        </Link>
      </main>
    )
  return result(false)

  function result(fresh: boolean) {
    if (!record) return null
    return (
    <EvaluationScreen
      key={record.id}
      evaluation={state.toView(record)}
      fresh={fresh}
      tab={tab}
      onTabChange={(next) =>
        void navigate({
          to: '/redacao/$evaluationId',
          params: { evaluationId },
          search: { tab: next },
          resetScroll: false,
        })
      }
      onRevise={() => state.revise(record)}
      onNew={state.newEssay}
    />
    )
  }
}
