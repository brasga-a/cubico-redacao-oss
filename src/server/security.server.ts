import '@tanstack/react-start/server-only'

import type { Env } from './env.server'
import { getTrustedOrigins, isTrustedOrigin } from './access-policy'
import { AppError } from './errors.server'

/** Rejects cross-origin server-function requests before auth or data access. */
export function assertSameOrigin(request: Request, env: Env): void {
  const origin = request.headers.get('origin')
  const isSafeMethod = request.method === 'GET' || request.method === 'HEAD'
  let trusted = false

  // Secrets may be absent in an unconfigured Worker; keep the safe GET bootstrap path.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (isSafeMethod && !env.BETTER_AUTH_URL?.trim()) {
    try {
      const requestOrigin = new URL(request.url).origin
      trusted = origin === null || origin === requestOrigin
    } catch {
      trusted = false
    }
  } else if (origin === null) {
    trusted = isSafeMethod && isRequestUrlTrusted(request, env)
  } else {
    trusted = isTrustedOrigin(request, env.BETTER_AUTH_URL)
  }

  if (!trusted) {
    throw new AppError(
      'CSRF_REJECTED',
      'A origem desta solicitação não foi autorizada. Atualize a página e tente novamente.',
    )
  }
}

function isRequestUrlTrusted(request: Request, env: Env): boolean {
  try {
    const trusted = getTrustedOrigins(env.BETTER_AUTH_URL)
    return trusted.has(new URL(request.url).origin)
  } catch {
    return false
  }
}
