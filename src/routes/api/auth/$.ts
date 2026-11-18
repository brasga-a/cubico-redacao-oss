import { createFileRoute } from '@tanstack/react-router'

async function handle(request: Request): Promise<Response> {
  const [{ createAuth, isAuthConfigured }, { getEnv }] = await Promise.all([
    import('../../../server/auth.server'),
    import('../../../server/env.server'),
  ])
  const env = getEnv()
  const privateHeaders = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  if (!isAuthConfigured(env))
    return new Response('Login não configurado.', {
      status: 503,
      headers: privateHeaders,
    })
  const path = new URL(request.url).pathname.replace('/api/auth', '')
  const allowed =
    request.method === 'GET'
      ? ['/callback/google', '/get-session', '/error', '/ok']
      : ['/sign-in/social', '/sign-out', '/get-session']
  if (!allowed.includes(path))
    return new Response('Não encontrado.', {
      status: 404,
      headers: privateHeaders,
    })
  if (request.method !== 'GET') {
    const { isTrustedOrigin } = await import('../../../server/access-policy')
    if (!isTrustedOrigin(request, env.BETTER_AUTH_URL))
      return new Response('Origem recusada.', {
        status: 403,
        headers: privateHeaders,
      })
  }
  // Required bindings can be absent in a misconfigured Worker; keep this runtime guard.
  if (
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    !env.BURST_LIMITER ||
    !(
      await env.BURST_LIMITER.limit({
        key: `auth:${request.headers.get('CF-Connecting-IP') ?? 'local'}`,
      })
    ).success
  ) {
    return new Response('Muitas solicitações. Aguarde um minuto.', {
      status: 429,
      headers: privateHeaders,
    })
  }
  try {
    const result = await createAuth(env, request).handler(request)
    const response = new Response(result.body, result)
    for (const [key, value] of Object.entries(privateHeaders))
      response.headers.set(key, value)
    return response
  } catch {
    return new Response('Não foi possível autenticar. Tente novamente.', {
      status: 503,
      headers: privateHeaders,
    })
  }
}

export const Route = createFileRoute('/api/auth/$')({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
})
