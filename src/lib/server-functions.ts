import { createServerFn } from '@tanstack/react-start'
import { correctionRequestSchema } from './correction'

export const getAppStatus = createServerFn({ method: 'GET' }).handler(
  async () => {
    try {
      const { getRequest } = await import('@tanstack/react-start/server')
      const request = getRequest()
      const { getEnv } = await import('../server/env.server')
      const env = getEnv()
      const { assertSameOrigin } = await import('../server/security.server')
      assertSameOrigin(request, env)

      const [
        { getOptionalAuthorizedUser, isAuthConfigured },
        { getCorrectionServiceStatus },
      ] = await Promise.all([
        import('../server/auth.server'),
        import('../server/correction.server'),
      ])
      const user = await getOptionalAuthorizedUser(request, env)
      const service = getCorrectionServiceStatus(env)
      const profile = user
        ? await (
            await import('../server/profile.server')
          )
            .getProfile(env.DB, user.id)
            .catch(() => null)
        : null
      return {
        ok: true as const,
        data: {
          user: user
            ? {
                id: user.id,
                email: user.email,
                name: profile?.name ?? user.name,
                image: profile?.image ?? null,
              }
            : null,
          authConfigured: isAuthConfigured(env),
          configured: service.configured,
          model: service.model,
          turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() || null,
        },
      }
    } catch (error) {
      const { toSafeError } = await import('../server/errors.server')
      return { ok: false as const, error: toSafeError(error) }
    }
  },
)

const parseCorrectionInput = (input: unknown) =>
  correctionRequestSchema.safeParse(input)

async function boundary() {
  const [{ getRequest }, { getEnv }] = await Promise.all([
    import('@tanstack/react-start/server'),
    import('../server/env.server'),
  ])
  return { request: getRequest(), env: getEnv() }
}

/** Correction plus an explicit `persistence` state for the opt-in cloud history. */
export const correctEssay = createServerFn({ method: 'POST' })
  .validator(parseCorrectionInput)
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { handleCorrection } =
      await import('../server/correction-flow.server')
    return handleCorrection(request, env, data)
  })

// Cloud history. Every function checks origin + session server-side; the account id
// is taken from the session, never from the input. Inputs are re-validated with Zod.
// The validator only types the client call; the handler validates the untrusted value.
const typed =
  <T>() =>
  (input: T): unknown =>
    input

export const listEvaluations = createServerFn({ method: 'GET' })
  .validator(typed<{ cursor?: string; limit?: number }>())
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { listHistory } = await import('../server/history-api.server')
    return listHistory(request, env, data)
  })

export const getEvaluation = createServerFn({ method: 'GET' })
  .validator(typed<{ id: string }>())
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { openEvaluation } = await import('../server/history-api.server')
    return openEvaluation(request, env, data)
  })

export const deleteEvaluation = createServerFn({ method: 'POST' })
  .validator(typed<{ id: string }>())
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { removeEvaluation } = await import('../server/history-api.server')
    return removeEvaluation(request, env, data)
  })

export const deleteAllEvaluations = createServerFn({ method: 'POST' })
  .validator(typed<{ confirm: true }>())
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { removeAllEvaluations } =
      await import('../server/history-api.server')
    return removeAllEvaluations(request, env, data)
  })

export const getHistoryPreference = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { request, env } = await boundary()
    const { readHistoryPreference } =
      await import('../server/history-api.server')
    return readHistoryPreference(request, env)
  },
)

export const setHistoryPreference = createServerFn({ method: 'POST' })
  .validator(typed<{ enabled: boolean; consentVersion?: 1 }>())
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { updateHistoryPreference } =
      await import('../server/history-api.server')
    return updateHistoryPreference(request, env, data)
  })

export const importEvaluations = createServerFn({ method: 'POST' })
  .validator(typed<{ records: unknown[] }>())
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { importHistory } = await import('../server/history-api.server')
    return importHistory(request, env, data)
  })

// Profile (name and photo). Same origin/session checks; the account comes from the session.
export const getProfile = createServerFn({ method: 'GET' }).handler(
  async () => {
    const { request, env } = await boundary()
    const { readProfile } = await import('../server/profile-api.server')
    return readProfile(request, env)
  },
)

export const updateProfile = createServerFn({ method: 'POST' })
  .validator(typed<{ name: string }>())
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { saveProfile } = await import('../server/profile-api.server')
    return saveProfile(request, env, data)
  })

export const uploadAvatar = createServerFn({ method: 'POST' })
  .validator(typed<FormData>())
  .handler(async ({ data }) => {
    const { request, env } = await boundary()
    const { uploadAvatar: upload } =
      await import('../server/profile-api.server')
    return upload(request, env, data)
  })

export const removeAvatar = createServerFn({ method: 'POST' }).handler(
  async () => {
    const { request, env } = await boundary()
    const { deleteAvatar } = await import('../server/profile-api.server')
    return deleteAvatar(request, env)
  },
)
