import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useWorkbench } from '@/providers/workbench-provider'
import { Turnstile } from '@/components/editor/turnstile'
import { EditorScreen } from '@/components/screens/editor-screen'
import { PageLoading } from '@/components/layout/loading'

export const Route = createFileRoute('/_app/editor')({ component: EditorPage })
function EditorPage() {
  const state = useWorkbench(),
    navigate = useNavigate()
  if (!state.draftReady) return <PageLoading />
  return (
    <>
      {state.status.turnstileSiteKey && (
        <div className="mx-auto mt-4 max-w-6xl px-4">
          <Turnstile
            siteKey={state.status.turnstileSiteKey}
            onToken={state.setToken}
            reset={state.reset}
          />
        </div>
      )}
      <EditorScreen
        draft={state.draft}
        saving={false}
        saveFailed={state.saveFailed}
        onChange={state.change}
        onSubmit={() => void state.submit()}
        onLoadSample={state.loadSample}
        onClear={state.clearDraft}
        onChooseTheme={state.chooseTheme}
        matchingEvaluation={state.matchingEvaluation}
        modelChoice={state.modelChoice}
        onModelChoiceChange={state.setModelChoice}
        onOpenEvaluation={(evaluationId) =>
          void navigate({
            to: '/redacao/$evaluationId',
            params: { evaluationId },
            search: { tab: 'summary' },
          })
        }
      />
    </>
  )
}
