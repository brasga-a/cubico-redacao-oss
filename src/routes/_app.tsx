import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouterState,
} from '@tanstack/react-router'
import { getAppStatus } from '@/lib/server-functions'
import { WorkbenchProvider, useWorkbench } from '@/providers/workbench-provider'
import { PageLoading } from '@/components/layout/loading'
import { RouteError } from '@/components/layout/route-error'
import { Header } from '@/components/layout/header'
import { OperationAlert } from '@/components/layout/operation-alert'

export const Route = createFileRoute('/_app')({
  beforeLoad: async () => {
    const response = await getAppStatus()
    if (!response.ok) throw new Error(response.error.message)
    const user = response.data.user
    if (!user) throw redirect({ to: '/login', search: {} })
    return { status: { ...response.data, user } }
  },
  pendingComponent: PageLoading,
  errorComponent: RouteError,
  component: AuthenticatedLayout,
})
function AuthenticatedLayout() {
  const { status } = Route.useRouteContext()
  return (
    <WorkbenchProvider key={status.user.id} status={status}>
      <AppShell />
    </WorkbenchProvider>
  )
}
function AppShell() {
  const state = useWorkbench()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return (
    <>
      <Header
        user={{
          ...state.status.user,
          initials: state.status.user.name
            .split(/\s+/)
            .map((s) => s[0])
            .slice(0, 2)
            .join(''),
        }}
        historyCount={state.summaries.length}
        onSignOut={() => void state.signOut()}
        onClearData={state.confirmClear}
      />
      {state.error && (
        <div className="mx-auto mt-5 max-w-6xl px-4 sm:px-6 lg:px-8">
          <OperationAlert message={state.error} />
        </div>
      )}
      {state.latest && !state.busy && !pathname.startsWith('/redacao/') && (
        <p className="mx-auto mt-4 max-w-6xl px-4 text-sm">
          Correção concluída.{' '}
          <Link
            to="/redacao/$evaluationId"
            params={{ evaluationId: state.latest.id }}
            search={{ tab: 'summary' }}
            className="underline"
          >
            Ver avaliação
          </Link>
        </p>
      )}
      <Outlet />
    </>
  )
}
