import { useRef, useState } from 'react'
import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'
import { getAppStatus } from '@/lib/server-functions'
import { LoginScreen } from '@/components/screens/login-screen'
import { PageLoading } from '@/components/layout/loading'
import { RouteError } from '@/components/layout/route-error'

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { error?: string } => ({
    error: typeof search.error === 'string' ? search.error : undefined,
  }),
  loader: async () => {
    const response = await getAppStatus()
    if (!response.ok) throw new Error(response.error.message)
    if (response.data.user) throw redirect({ to: '/editor' })
    return response.data
  },
  pendingComponent: PageLoading,
  errorComponent: RouteError,
  component: LoginPage,
})

function LoginPage() {
  const data = Route.useLoaderData(),
    search = Route.useSearch(),
    router = useRouter()
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState('')
  const pending = useRef(false)
  async function signIn() {
    if (pending.current) return
    if (!data.authConfigured) {
      setError('O proprietário ainda não configurou o login.')
      setState('error')
      return
    }
    pending.current = true
    setError('')
    setState('loading')
    try {
      const response = await authClient.signIn.social({
        provider: 'google',
        callbackURL: '/editor',
        errorCallbackURL: '/login?error=oauth',
      })
      if (response.error) throw new Error('Sign-in failed')
    } catch {
      pending.current = false
      setState('error')
      setError('Não foi possível iniciar o acesso Google. Tente novamente.')
    }
  }
  const callbackError =
    search.error && state === 'idle'
      ? 'O Google não concluiu a autenticação. Confira se a conta está autorizada.'
      : ''
  return (
    <LoginScreen
      status={callbackError ? 'error' : state}
      error={error || callbackError}
      onSignIn={() => void signIn()}
      onRetry={() => void router.invalidate()}
    />
  )
}
