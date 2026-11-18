import '@tanstack/react-start/server-only'

import { updateProfileSchema } from '../lib/profile'
import type { Profile } from '../lib/profile'
import type { ServerResult } from '../lib/correction'
import type { AuthorizedUser } from './auth.server'
import type { Env } from './env.server'
import { AppError, toSafeError } from './errors.server'
import { defaultHistoryDeps } from './history-api.server'
import type { HistoryDeps } from './history-api.server'
import * as profile from './profile.server'
import { assertSameOrigin } from './security.server'

/** Same session/origin guard as the history functions. */
export type ProfileDeps = HistoryDeps
export const defaultProfileDeps: ProfileDeps = defaultHistoryDeps

async function run<T>(
  request: Request,
  env: Env,
  deps: ProfileDeps,
  operation: (user: AuthorizedUser) => Promise<T>,
): Promise<ServerResult<T>> {
  try {
    assertSameOrigin(request, env)
    const user = await deps.requireUser(request, env)
    return { ok: true, data: await operation(user) }
  } catch (error) {
    if (error instanceof AppError)
      return { ok: false, error: toSafeError(error) }
    return {
      ok: false,
      error: {
        code: 'INTERNAL',
        message:
          'Não foi possível atualizar o perfil. Tente novamente em instantes.',
      },
    }
  }
}

export function readProfile(
  request: Request,
  env: Env,
  deps = defaultProfileDeps,
): Promise<ServerResult<Profile>> {
  return run(request, env, deps, (user) => profile.getProfile(env.DB, user.id))
}

export function saveProfile(
  request: Request,
  env: Env,
  input: unknown,
  deps = defaultProfileDeps,
): Promise<ServerResult<Profile>> {
  return run(request, env, deps, async (user) => {
    const parsed = updateProfileSchema.safeParse(input)
    if (!parsed.success)
      throw new AppError(
        'INVALID_INPUT',
        parsed.error.issues[0]?.message ?? 'Nome inválido.',
      )
    await profile.updateName(env.DB, user.id, parsed.data.name)
    return profile.getProfile(env.DB, user.id)
  })
}

export function uploadAvatar(
  request: Request,
  env: Env,
  input: unknown,
  deps = defaultProfileDeps,
): Promise<ServerResult<Profile>> {
  return run(request, env, deps, async (user) => {
    const file = input instanceof FormData ? input.get('file') : null
    await profile.replaceAvatar(env.DB, env.AVATARS, user.id, file)
    return profile.getProfile(env.DB, user.id)
  })
}

export function deleteAvatar(
  request: Request,
  env: Env,
  deps = defaultProfileDeps,
): Promise<ServerResult<Profile>> {
  return run(request, env, deps, async (user) => {
    await profile.removeAvatar(env.DB, env.AVATARS, user.id)
    return profile.getProfile(env.DB, user.id)
  })
}

const PRIVATE_IMAGE_HEADERS = {
  'Cache-Control': 'private, max-age=86400',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cross-Origin-Resource-Policy': 'same-origin',
}

/** GET /api/avatar: the signed-in user's own photo (no key or user id is accepted). */
export async function serveAvatar(
  request: Request,
  env: Env,
  deps = defaultProfileDeps,
): Promise<Response> {
  const headers = { 'Cache-Control': 'private, no-store' }
  try {
    const user = await deps.requireUser(request, env)
    const photo = await profile.readAvatar(env.DB, env.AVATARS, user.id)
    if (!photo) return new Response(null, { status: 404, headers })
    return new Response(photo.body, {
      headers: { ...PRIVATE_IMAGE_HEADERS, 'Content-Type': photo.type },
    })
  } catch (error) {
    const status =
      error instanceof AppError && error.code === 'AUTH_REQUIRED' ? 401 : 503
    return new Response(null, { status, headers })
  }
}
