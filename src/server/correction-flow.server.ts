import '@tanstack/react-start/server-only'

import type {
  CorrectionRequest,
  CorrectionResult,
  ServerResult,
} from '../lib/correction'
import type { PersistenceState } from '../lib/evaluation-history'
import type { AuthorizedUser } from './auth.server'
import type { CorrectionExecution, CorrectionUsage } from './correction.server'
import type { PipelineExecution } from './pipeline.server'
import type { Env } from './env.server'
import { AppError, toSafeError } from './errors.server'
import type { FinishUsageOutcome } from './usage.server'

export type CorrectionResponse = ServerResult<CorrectionResult> & {
  persistence?: PersistenceState
}

export type CorrectionDeps = {
  requireUser: (request: Request, env: Env) => Promise<AuthorizedUser>
  verifyTurnstile: (
    env: Env,
    token?: string,
    remoteIp?: string | null,
  ) => Promise<void>
  reserveUsage: (env: Env, userId: string, requestId: string) => Promise<void>
  finishUsage: (
    env: Env,
    userId: string,
    requestId: string,
    outcome: FinishUsageOutcome,
  ) => Promise<void>
  /** Runs the selected grading architecture (one or two inferences). */
  runCorrection: (
    request: CorrectionRequest,
    env: Env,
    onUsage: (usage: CorrectionUsage) => void,
  ) => Promise<CorrectionExecution | PipelineExecution>
  now: () => number
}

export const defaultCorrectionDeps: CorrectionDeps = {
  requireUser: async (request, env) =>
    (await import('./auth.server')).requireAuthorizedUser(request, env),
  verifyTurnstile: async (...args) =>
    (await import('./usage.server')).verifyTurnstileIfConfigured(...args),
  reserveUsage: async (...args) =>
    (await import('./usage.server')).reserveUsage(...args),
  finishUsage: async (...args) =>
    (await import('./usage.server')).finishUsage(...args),
  runCorrection: async (...args) =>
    (await import('./pipeline.server')).runPipeline(...args),
  now: () => Date.now(),
}

/**
 * Correction orchestration (moved from the server-function boundary so it can be tested):
 * origin → validation → auth → recovery of an already stored result → Turnstile → quota
 * reservation → inference → usage finalization → opt-in persistence.
 *
 * A result already stored for this request id is returned without a new (paid) call.
 * Storage happens after usage is finalized; a storage failure never discards the result.
 */
export async function handleCorrection(
  request: Request,
  env: Env,
  input:
    | { success: true; data: CorrectionRequest }
    | { success: false; data?: undefined },
  deps: CorrectionDeps = defaultCorrectionDeps,
): Promise<CorrectionResponse> {
  let captured: CorrectionUsage | undefined
  let reservationMade = false
  let userId: string | undefined
  let requestId: string | undefined

  try {
    const { assertSameOrigin } = await import('./security.server')
    assertSameOrigin(request, env)
    if (!input.success) {
      throw new AppError(
        'INVALID_INPUT',
        'Confira o tema e o texto da redação.',
      )
    }
    const data = input.data
    const user = await deps.requireUser(request, env)
    userId = user.id
    requestId = data.requestId

    const history = await import('./history.server')
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (env.DB) {
      const stored = await history
        .findByRequestId(env.DB, user.id, requestId, deps.now())
        .catch(() => null)
      if (stored) {
        const record = await history
          .getEvaluation(env.DB, user.id, stored.id, deps.now())
          .catch(() => null)
        if (record)
          return {
            ok: true,
            data: record.result,
            persistence: {
              status: 'recovered',
              evaluationId: stored.id,
              createdAt: stored.createdAt,
            },
          }
      }
    }

    await deps.verifyTurnstile(
      env,
      data.turnstileToken,
      request.headers.get('CF-Connecting-IP'),
    )
    await deps.reserveUsage(env, user.id, requestId)
    reservationMade = true

    const execution = await deps.runCorrection(data, env, (usage) => {
      captured = usage
    })
    const meta = executionMetadata(data, execution)
    // One user operation = one quota unit, even when it needed two inferences.
    await deps.finishUsage(env, user.id, requestId, {
      status: 'succeeded',
      ...execution.usage,
      pipeline: meta.pipeline,
      stages: meta.stages,
      audit: meta.auditSummary,
    })
    reservationMade = false

    const persistence = await history.persistCorrection(
      env.DB,
      user.id,
      data,
      execution.result,
      execution.usage.model || null,
      deps.now(),
      {
        pipeline: meta.pipeline,
        promptVersion: meta.promptVersion,
        auditStatus: meta.auditStatus,
        details: meta.details,
      },
    )
    return { ok: true, data: execution.result, persistence }
  } catch (error) {
    if (reservationMade && userId && requestId) {
      try {
        await deps.finishUsage(env, userId, requestId, {
          status: 'failed',
          model: env.GEMINI_MODEL?.trim() || 'gemini-4-argon',
          ...captured,
          pipeline: input.success ? input.data.pipeline : undefined,
        })
      } catch {
        // Do not expose D1 details or user input if usage finalization fails.
      }
    }
    return { ok: false, error: toSafeError(error) }
  }
}

/**
 * Operational metadata of one correction. The ledger copy is content-free (scores,
 * decisions, models, tokens); the history copy also keeps the auditor's justifications,
 * stored with the rest of the opt-in evaluation.
 */
export function executionMetadata(
  request: CorrectionRequest,
  execution: CorrectionExecution | PipelineExecution,
) {
  const pipelineRun = 'pipeline' in execution ? execution : null
  const pipeline =
    pipelineRun?.pipeline ??
    (request.pipeline === 'dual-review' ? 'dual-review' : 'single')
  const audit = pipelineRun?.audit ?? null
  const auditStatus = pipelineRun?.auditStatus ?? 'skipped'
  const scores = (r: CorrectionResult | null | undefined) =>
    r ? Object.fromEntries(r.competencies.map((c) => [c.id, c.score])) : null
  const auditSummary =
    pipeline === 'dual-review'
      ? {
          status: auditStatus,
          promptVersion: audit?.promptVersion ?? null,
          initialScores: scores(pipelineRun?.initialResult),
          finalScores: scores(execution.result),
          initialTotal: pipelineRun?.initialResult?.total ?? null,
          finalTotal: execution.result.total,
          changes: (audit?.changes ?? []).map(
            ({ competency, from, to, decision, accepted, rejection }) => ({
              competency,
              from,
              to,
              decision,
              accepted,
              ...(rejection ? { rejection } : {}),
            }),
          ),
        }
      : undefined
  return {
    pipeline,
    auditStatus,
    promptVersion: execution.diagnostics?.promptVersion ?? null,
    stages: pipelineRun?.stages,
    auditSummary,
    details: {
      pipeline,
      stages: pipelineRun?.stages ?? [],
      audit: audit && { ...audit, status: auditStatus },
      auditStatus,
    },
  }
}
