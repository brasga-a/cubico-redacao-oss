import '@tanstack/react-start/server-only'
import { betterAuth } from 'better-auth'
import { APIError } from 'better-auth/api'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { getTrustedOrigins, isAllowedEmail, stripQuotes } from './access-policy'
import { AppError } from './errors.server'
import type { Env } from './env.server'

export type AuthorizedUser = { id: string; email: string; name: string }

export function isAuthConfigured(env: Partial<Env>): boolean {
  return Boolean(
    env.DB &&
    stripQuotes(env.BETTER_AUTH_SECRET ?? '').length >= 32 &&
    stripQuotes(env.BETTER_AUTH_URL ?? '') &&
    stripQuotes(env.GOOGLE_CLIENT_ID ?? '') &&
    stripQuotes(env.GOOGLE_CLIENT_SECRET ?? '') &&
    stripQuotes(env.ALLOWED_EMAILS ?? ''),
  )
}

function resolveEffectiveBaseURL(env: Env, request?: Request): string {
  const configuredBaseURL = stripQuotes(env.BETTER_AUTH_URL)
  if (!request) return configuredBaseURL
  try {
    const requestOrigin = new URL(request.url).origin
    const trusted = getTrustedOrigins(configuredBaseURL)
    if (trusted.has(requestOrigin)) {
      return requestOrigin
    }
  } catch {
    // Fall back to configured BETTER_AUTH_URL.
  }
  return configuredBaseURL
}

export function createAuth(env: Env, request?: Request) {
  if (!isAuthConfigured(env))
    throw new AppError(
      'AUTH_REQUIRED',
      'O login ainda não foi configurado pelo proprietário.',
    )
  const effectiveBaseURL = resolveEffectiveBaseURL(env, request)
  const trustedOrigins = Array.from(getTrustedOrigins(env.BETTER_AUTH_URL))
  const secure = new URL(effectiveBaseURL).protocol === 'https:'
  return betterAuth({
    appName: 'Redação ENEM 2026',
    baseURL: effectiveBaseURL,
    secret: stripQuotes(env.BETTER_AUTH_SECRET),
    database: env.DB,
    trustedOrigins,
    socialProviders: {
      google: {
        clientId: stripQuotes(env.GOOGLE_CLIENT_ID),
        clientSecret: stripQuotes(env.GOOGLE_CLIENT_SECRET),
        prompt: 'select_account',
      },
    },
    emailAndPassword: { enabled: false },
    account: { accountLinking: { enabled: false } },
    user: {
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
      validateUserInfo: ({ user, source }) => {
        if (
          source.oauth?.providerId !== 'google' ||
          source.oauth.profile?.email_verified !== true ||
          !user.email ||
          !isAllowedEmail(user.email, env.ALLOWED_EMAILS)
        ) {
          return {
            error: 'access_denied',
            errorDescription: 'Acesso restrito a contas autorizadas.',
          }
        }
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false },
    },
    advanced: {
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: 'lax' },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            if (
              !user.emailVerified ||
              !isAllowedEmail(user.email, env.ALLOWED_EMAILS)
            )
              throw new APIError('FORBIDDEN', { message: 'Acesso restrito.' })
            return { data: user }
          },
        },
      },
      session: {
        create: {
          before: async (session) => {
            const user = await env.DB.prepare(
              'SELECT email, emailVerified FROM user WHERE id = ?',
            )
              .bind(session.userId)
              .first<{ email: string; emailVerified: number }>()
            if (
              !user?.emailVerified ||
              !isAllowedEmail(user.email, env.ALLOWED_EMAILS)
            )
              throw new APIError('FORBIDDEN', { message: 'Acesso restrito.' })
            return { data: { ...session, ipAddress: null, userAgent: null } }
          },
        },
      },
    },
    // No essay, provider response, credentials or personal details in auth logs.
    logger: { disabled: true },
    plugins: [tanstackStartCookies()],
  })
}

export async function getOptionalAuthorizedUser(
  request: Request,
  env: Env,
): Promise<AuthorizedUser | null> {
  if (!isAuthConfigured(env)) return null
  // Never use cookie-cached sessions: revocation must be observed in D1.
  const session = await createAuth(env, request).api.getSession({
    headers: request.headers,
    query: { disableCookieCache: true },
  })
  if (!session) return null
  if (
    !session.user.emailVerified ||
    !isAllowedEmail(session.user.email, env.ALLOWED_EMAILS)
  ) {
    await env.DB.prepare('DELETE FROM session WHERE userId = ?')
      .bind(session.user.id)
      .run()
    return null
  }
  const google = await env.DB.prepare(
    "SELECT id FROM account WHERE userId = ? AND providerId = 'google' LIMIT 1",
  )
    .bind(session.user.id)
    .first()
  if (!google) return null
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  }
}

export async function requireAuthorizedUser(
  request: Request,
  env: Env,
): Promise<AuthorizedUser> {
  const user = await getOptionalAuthorizedUser(request, env)
  if (!user)
    throw new AppError(
      'AUTH_REQUIRED',
      'Entre com uma conta Google autorizada para corrigir sua redação.',
    )
  return user
}
