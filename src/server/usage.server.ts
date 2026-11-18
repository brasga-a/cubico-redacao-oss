import '@tanstack/react-start/server-only'

import type { Env } from './env.server'
import { AppError } from './errors.server'

export const RESERVATION_TTL_MS = 3 * 60 * 1_000
export const DEFAULT_USER_CONCURRENT_LIMIT = 1
export const DEFAULT_GLOBAL_CONCURRENT_LIMIT = 2
export const DEFAULT_DAILY_USER_LIMIT = 10
export const DEFAULT_MONTHLY_CORRECTION_LIMIT = 50

export type FinishUsageOutcome = (
  | {
      status: 'succeeded'
      model: string
      inputTokens: number
      outputTokens: number
      thoughtTokens: number
      estimatedCostUsd: number
    }
  | {
      status: 'failed'
      model: string
      inputTokens?: number
      outputTokens?: number
      thoughtTokens?: number
      estimatedCostUsd?: number
    }
) & {
  cacheReadTokens?: number
  usageKnown?: boolean
  /** Grading architecture; omitted means the standard single evaluation. */
  pipeline?: 'single' | 'dual-review'
  /** Per-stage operational metrics (models, tokens, cost, latency). No essay text. */
  stages?: unknown[]
  /** Content-free audit summary: status, scores before/after, decisions. */
  audit?: unknown
}

function parsePositiveLimit(raw: string | undefined, fallback: number): number {
  if (!raw?.trim()) return fallback
  const parsed = Number(raw)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    return fallback
  }
  return parsed
}

export function getUtcDateKeys(timestampMs: number): {
  dayKey: string
  monthKey: string
} {
  const iso = new Date(timestampMs).toISOString()
  return {
    dayKey: iso.slice(0, 10),
    monthKey: iso.slice(0, 7),
  }
}

export async function verifyTurnstileIfConfigured(
  env: Env,
  turnstileToken?: string,
  remoteIp?: string | null,
): Promise<void> {
  const secret = env.TURNSTILE_SECRET_KEY?.trim()
  const siteKey = env.TURNSTILE_SITE_KEY?.trim()
  if (!secret || !siteKey) {
    return
  }

  const token = turnstileToken?.trim()
  if (!token) {
    throw new AppError(
      'FORBIDDEN',
      'Confirme a verificação de segurança antes de enviar a redação.',
    )
  }

  let verified = false
  try {
    const body = new URLSearchParams({
      secret,
      response: token,
    })
    if (remoteIp?.trim()) {
      body.set('remoteip', remoteIp.trim())
    }
    const response = await fetch(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
      },
    )
    if (response.ok) {
      const payload: { success?: unknown } = await response.json()
      verified = payload.success === true
    }
  } catch {
    throw new AppError(
      'FORBIDDEN',
      'Não foi possível validar a verificação de segurança. Tente novamente.',
    )
  }

  if (!verified) {
    throw new AppError(
      'FORBIDDEN',
      'A verificação de segurança falhou ou expirou. Atualize a página e tente novamente.',
    )
  }
}

export async function reserveUsage(
  env: Env,
  userId: string,
  requestId: string,
  nowMs = Date.now(),
): Promise<void> {
  if (!userId.trim() || !requestId.trim()) {
    throw new AppError(
      'INVALID_INPUT',
      'Identificador de solicitação inválido.',
    )
  }

  // Required bindings can be absent in a misconfigured Worker; keep this runtime guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.BURST_LIMITER) {
    const burst = await env.BURST_LIMITER.limit({ key: `correct:${userId}` })
    if (!burst.success) {
      throw new AppError(
        'USAGE_LIMIT',
        'Muitas solicitações em sequência. Aguarde um minuto e tente novamente.',
      )
    }
  }

  // Required bindings can be absent in a misconfigured Worker; keep this runtime guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!env.DB) {
    throw new AppError(
      'INTERNAL',
      'O controle de uso do serviço não está disponível no momento.',
    )
  }

  const globalConcurrentLimit = parsePositiveLimit(
    env.GLOBAL_CONCURRENT_LIMIT,
    DEFAULT_GLOBAL_CONCURRENT_LIMIT,
  )
  const dailyUserLimit = parsePositiveLimit(
    env.DAILY_USER_LIMIT,
    DEFAULT_DAILY_USER_LIMIT,
  )
  const monthlyGlobalLimit = parsePositiveLimit(
    env.MONTHLY_CORRECTION_LIMIT,
    DEFAULT_MONTHLY_CORRECTION_LIMIT,
  )

  const { dayKey, monthKey } = getUtcDateKeys(nowMs)
  const expiresAt = nowMs + RESERVATION_TTL_MS
  const model = env.GEMINI_MODEL?.trim() || 'gemini-4-argon'

  // 1. Expire stale reservations so crashed workers never permanently lock a user or global slot
  await env.DB.prepare(
    `UPDATE usage_ledger
     SET status = 'failed', updated_at = ?
     WHERE status = 'reserved' AND expires_at < ?`,
  )
    .bind(nowMs, nowMs)
    .run()

  // 2. Atomically insert reservation only if idempotency, concurrency, daily and monthly quotas all pass
  const insertResult = await env.DB.prepare(
    `INSERT INTO usage_ledger (
       request_id, user_id, status, day_key, month_key, model,
       input_tokens, output_tokens, thought_tokens, estimated_cost_usd,
       created_at, updated_at, expires_at
     )
     SELECT ?, ?, 'reserved', ?, ?, ?, 0, 0, 0, 0, ?, ?, ?
     WHERE NOT EXISTS (
       SELECT 1 FROM usage_ledger WHERE request_id = ?
     )
     AND (
       SELECT COUNT(*) FROM usage_ledger
       WHERE user_id = ? AND status = 'reserved' AND expires_at >= ?
     ) < ?
     AND (
       SELECT COUNT(*) FROM usage_ledger
       WHERE status = 'reserved' AND expires_at >= ?
     ) < ?
     AND (
       SELECT COUNT(*) FROM usage_ledger
       WHERE user_id = ? AND day_key = ?
         AND (status IN ('succeeded', 'failed') OR (status = 'reserved' AND expires_at >= ?))
     ) < ?
     AND (
       SELECT COUNT(*) FROM usage_ledger
       WHERE month_key = ?
         AND (status IN ('succeeded', 'failed') OR (status = 'reserved' AND expires_at >= ?))
     ) < ?`,
  )
    .bind(
      requestId,
      userId,
      dayKey,
      monthKey,
      model,
      nowMs,
      nowMs,
      expiresAt,
      requestId,
      userId,
      nowMs,
      DEFAULT_USER_CONCURRENT_LIMIT,
      nowMs,
      globalConcurrentLimit,
      userId,
      dayKey,
      nowMs,
      dailyUserLimit,
      monthKey,
      nowMs,
      monthlyGlobalLimit,
    )
    .run()

  const changes = insertResult.meta.changes
  if (changes === 1) {
    return
  }

  // 3. Determine the exact quota/concurrency condition that blocked the atomic insert
  const diagnostics = await env.DB.prepare(
    `SELECT
       EXISTS(SELECT 1 FROM usage_ledger WHERE request_id = ?) AS is_duplicate,
       (SELECT COUNT(*) FROM usage_ledger WHERE user_id = ? AND status = 'reserved' AND expires_at >= ?) AS user_concurrent,
       (SELECT COUNT(*) FROM usage_ledger WHERE status = 'reserved' AND expires_at >= ?) AS global_concurrent,
       (SELECT COUNT(*) FROM usage_ledger WHERE user_id = ? AND day_key = ? AND (status IN ('succeeded', 'failed') OR (status = 'reserved' AND expires_at >= ?))) AS user_daily,
       (SELECT COUNT(*) FROM usage_ledger WHERE month_key = ? AND (status IN ('succeeded', 'failed') OR (status = 'reserved' AND expires_at >= ?))) AS global_monthly`,
  )
    .bind(
      requestId,
      userId,
      nowMs,
      nowMs,
      userId,
      dayKey,
      nowMs,
      monthKey,
      nowMs,
    )
    .first<{
      is_duplicate: number
      user_concurrent: number
      global_concurrent: number
      user_daily: number
      global_monthly: number
    }>()

  if (diagnostics?.is_duplicate) {
    throw new AppError(
      'USAGE_LIMIT',
      'Esta solicitação já está em processamento ou já foi enviada.',
    )
  }
  if ((diagnostics?.user_concurrent ?? 0) >= DEFAULT_USER_CONCURRENT_LIMIT) {
    throw new AppError(
      'USAGE_LIMIT',
      'Você já possui uma correção em andamento. Aguarde a conclusão antes de enviar outra.',
    )
  }
  if ((diagnostics?.global_concurrent ?? 0) >= globalConcurrentLimit) {
    throw new AppError(
      'USAGE_LIMIT',
      'O serviço atingiu o limite de correções simultâneas no momento. Aguarde alguns instantes e tente novamente.',
    )
  }
  if ((diagnostics?.user_daily ?? 0) >= dailyUserLimit) {
    throw new AppError(
      'USAGE_LIMIT',
      `Você atingiu o limite diário de ${dailyUserLimit} correções por conta. Tente novamente amanhã.`,
    )
  }
  if ((diagnostics?.global_monthly ?? 0) >= monthlyGlobalLimit) {
    throw new AppError(
      'USAGE_LIMIT',
      `O limite mensal de ${monthlyGlobalLimit} correções do serviço foi atingido.`,
    )
  }

  throw new AppError(
    'USAGE_LIMIT',
    'Não foi possível reservar sua quota de correção no momento. Tente novamente em instantes.',
  )
}

export async function finishUsage(
  env: Env,
  userId: string,
  requestId: string,
  outcome: FinishUsageOutcome,
  nowMs = Date.now(),
): Promise<void> {
  // Required bindings can be absent in a misconfigured Worker; keep this runtime guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!env.DB) return

  const inputTokens = Math.max(0, Math.trunc(outcome.inputTokens ?? 0))
  const outputTokens = Math.max(0, Math.trunc(outcome.outputTokens ?? 0))
  const thoughtTokens = Math.max(0, Math.trunc(outcome.thoughtTokens ?? 0))
  const estimatedCostUsd = Number.isFinite(outcome.estimatedCostUsd)
    ? Math.max(0, Number(outcome.estimatedCostUsd))
    : 0
  const model =
    outcome.model.trim() || env.GEMINI_MODEL?.trim() || 'gemini-4-argon'

  await env.DB.prepare(
    `UPDATE usage_ledger
     SET status = ?,
         model = ?,
         cache_read_tokens = ?,
         usage_known = ?,
         input_tokens = ?,
         output_tokens = ?,
         thought_tokens = ?,
         estimated_cost_usd = ?,
         pipeline = ?,
         stages_json = ?,
         audit_json = ?,
         updated_at = ?,
         expires_at = ?
     WHERE request_id = ? AND user_id = ?`,
  )
    .bind(
      outcome.status,
      model,
      Math.max(0, Math.trunc(outcome.cacheReadTokens ?? 0)),
      outcome.usageKnown === true ? 1 : 0,
      inputTokens,
      outputTokens,
      thoughtTokens,
      estimatedCostUsd,
      outcome.pipeline ?? 'single',
      outcome.stages ? JSON.stringify(outcome.stages) : null,
      outcome.audit === undefined ? null : JSON.stringify(outcome.audit),
      nowMs,
      nowMs,
      requestId,
      userId,
    )
    .run()
}
