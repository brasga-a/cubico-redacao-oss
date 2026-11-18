import {
  createCsrfMiddleware,
  createMiddleware,
  createStart,
} from '@tanstack/react-start'

/** Local development hosts keep plain HTTP. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Production only answers over HTTPS: the auth/origin checks trust exactly
 * BETTER_AUTH_URL (https), so a plain-HTTP visit would be rejected as cross-origin.
 * Redirecting keeps those protections intact.
 */
export function httpsRedirect(requestUrl: string): Response | null {
  const url = new URL(requestUrl)
  if (url.protocol !== 'http:' || LOCAL_HOSTS.has(url.hostname)) return null
  url.protocol = 'https:'
  return new Response(null, {
    status: 308,
    headers: { Location: url.toString(), 'Cache-Control': 'no-store' },
  })
}

const enforceHttps = createMiddleware({ type: 'request' }).server(
  ({ request, next }) => httpsRedirect(request.url) ?? next(),
)

/**
 * Rejects cross-site server-function RPCs (Sec-Fetch-Site, then Origin, then
 * Referer) before any handler runs. Start applies this by default only when
 * there is no start instance, so it must be listed here explicitly. The
 * per-handler assertSameOrigin check stays as a second layer and still covers
 * the /api/* routes.
 */
const csrf = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

export const startInstance = createStart(() => ({
  requestMiddleware: [enforceHttps, csrf],
}))
