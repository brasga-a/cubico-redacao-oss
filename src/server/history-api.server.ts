import '@tanstack/react-start/server-only'

import {
  deleteAllHistorySchema,
  evaluationLookupSchema,
  importHistorySchema,
  listHistoryInputSchema,
  setHistoryPreferenceSchema,
} from '../lib/evaluation-history'
import type {
  EvaluationRecord,
  HistoryPage,
  HistoryPreference,
  ImportReport,
} from '../lib/evaluation-history'
import type { ServerResult } from '../lib/correction'
import type { AuthorizedUser } from './auth.server'
import type { Env } from './env.server'
import { AppError, toSafeError } from './errors.server'
import * as store from './history.server'
import { assertSameOrigin } from './security.server'

/**
 * Authenticated history operations behind the TanStack server functions.
 * Every call (reads included) checks origin, the Better Auth session and the
 * allowlist; the account id always comes from the session, never from input.
 */
export type HistoryDeps = {
  requireUser: (request: Request, env: Env) => Promise<AuthorizedUser>
  now: () => number
}

export const defaultHistoryDeps: HistoryDeps = {
  requireUser: async (request, env) => {
    const { requireAuthorizedUser } = await import('./auth.server')
    return requireAuthorizedUser(request, env)
  },
  now: () => Date.now(),
}

function requireDb(env: Env): D1Database {
  // Required bindings can be absent in a misconfigured Worker; keep this runtime guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!env.DB)
    throw new AppError(
      'HISTORY_UNAVAILABLE',
      'O histórico na nuvem não está disponível no momento.',
    )
  return env.DB
}

function parse<T>(
  schema: { safeParse: (v: unknown) => { success: boolean; data?: T } },
  input: unknown,
): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success)
    throw new AppError('INVALID_INPUT', 'Solicitação de histórico inválida.')
  return parsed.data as T
}

async function run<T>(
  request: Request,
  env: Env,
  deps: HistoryDeps,
  operation: (
    db: D1Database,
    user: AuthorizedUser,
    nowMs: number,
  ) => Promise<T>,
): Promise<ServerResult<T>> {
  try {
    assertSameOrigin(request, env)
    const user = await deps.requireUser(request, env)
    const db = requireDb(env)
    return { ok: true, data: await operation(db, user, deps.now()) }
  } catch (error) {
    if (error instanceof AppError)
      return { ok: false, error: toSafeError(error) }
    // D1 failures are reported generically; no SQL, essay text or payload leaves the server.
    return {
      ok: false,
      error: {
        code: 'HISTORY_UNAVAILABLE',
        message:
          'Não foi possível acessar o histórico na nuvem. Tente novamente em instantes.',
      },
    }
  }
}

export function listHistory(
  request: Request,
  env: Env,
  input: unknown,
  deps = defaultHistoryDeps,
): Promise<ServerResult<HistoryPage>> {
  return run(request, env, deps, async (db, user, now) => {
    const options = parse<{ cursor?: string; limit?: number }>(
      listHistoryInputSchema,
      input ?? {},
    )
    const [page, preference] = await Promise.all([
      store.listEvaluations(db, user.id, options, now),
      store.getPreference(db, user.id),
    ])
    return { ...page, preference }
  })
}

export function openEvaluation(
  request: Request,
  env: Env,
  input: unknown,
  deps = defaultHistoryDeps,
): Promise<ServerResult<EvaluationRecord | null>> {
  return run(request, env, deps, (db, user, now) => {
    const { id } = parse<{ id: string }>(evaluationLookupSchema, input)
    return store.getEvaluation(db, user.id, id, now)
  })
}

export function removeEvaluation(
  request: Request,
  env: Env,
  input: unknown,
  deps = defaultHistoryDeps,
): Promise<ServerResult<{ deleted: boolean }>> {
  return run(request, env, deps, async (db, user) => {
    const { id } = parse<{ id: string }>(evaluationLookupSchema, input)
    return { deleted: await store.deleteEvaluation(db, user.id, id) }
  })
}

export function removeAllEvaluations(
  request: Request,
  env: Env,
  input: unknown,
  deps = defaultHistoryDeps,
): Promise<ServerResult<{ deleted: number }>> {
  return run(request, env, deps, async (db, user) => {
    parse(deleteAllHistorySchema, input)
    return { deleted: await store.deleteAllEvaluations(db, user.id) }
  })
}

export function readHistoryPreference(
  request: Request,
  env: Env,
  deps = defaultHistoryDeps,
): Promise<ServerResult<HistoryPreference>> {
  return run(request, env, deps, (db, user) => store.getPreference(db, user.id))
}

export function updateHistoryPreference(
  request: Request,
  env: Env,
  input: unknown,
  deps = defaultHistoryDeps,
): Promise<ServerResult<HistoryPreference>> {
  return run(request, env, deps, (db, user, now) => {
    const { enabled, consentVersion } = parse<{
      enabled: boolean
      consentVersion?: number
    }>(setHistoryPreferenceSchema, input)
    if (enabled && consentVersion === undefined)
      throw new AppError(
        'INVALID_INPUT',
        'Confirme os termos do histórico na nuvem para ativá-lo.',
      )
    return store.setPreference(db, user.id, enabled, now)
  })
}

export function importHistory(
  request: Request,
  env: Env,
  input: unknown,
  deps = defaultHistoryDeps,
): Promise<ServerResult<ImportReport>> {
  return run(request, env, deps, async (db, user, now) => {
    const { records } = parse<{ records: unknown[] }>(
      importHistorySchema,
      input,
    )
    const preference = await store.getPreference(db, user.id)
    if (!preference.cloudEnabled)
      throw new AppError(
        'FORBIDDEN',
        'Ative o histórico na nuvem antes de importar avaliações.',
      )
    return {
      results: await store.importEvaluations(db, user.id, records, now),
    }
  })
}
