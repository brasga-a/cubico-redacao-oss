import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useWorkbench } from '@/providers/workbench-provider'
import { HistoryScreen } from '@/components/screens/history-screen'
import { PageLoading } from '@/components/layout/loading'

export const Route = createFileRoute('/_app/historico')({
  component: HistoryPage,
})
function HistoryPage() {
  const state = useWorkbench(),
    navigate = useNavigate()
  if (!state.historyReady) return <PageLoading />
  const nudge = !state.enabled
    ? 'O histórico na nuvem está desativado: novas correções não são salvas.'
    : state.local && state.local.importable.length > 0 && !state.local.confirmed
      ? 'Há avaliações antigas neste navegador que podem ser importadas.'
      : null
  return (
    <>
      {nudge && (
        <p className="mx-auto mt-6 max-w-4xl px-4 text-sm text-muted-foreground sm:px-6 lg:px-8">
          {nudge}{' '}
          <Link to="/configuracoes" className="text-foreground underline">
            Abrir configurações
          </Link>
        </p>
      )}
      <HistoryScreen
        history={state.history}
        onNew={state.newEssay}
        onDelete={state.deleteRecord}
        onOpen={(evaluationId) =>
          void navigate({
            to: '/redacao/$evaluationId',
            params: { evaluationId },
            search: { tab: 'summary' },
          })
        }
        renderEvaluationLink={(evaluationId, props) => (
          <Link
            to="/redacao/$evaluationId"
            params={{ evaluationId }}
            search={{ tab: 'summary' }}
            {...props}
          />
        )}
      />
    </>
  )
}
