import '@tanstack/react-start/server-only'

/**
 * Chat usage: per-user daily counters in `chat_usage` (counts and tokens only, never
 * message content). Kept apart from the correction ledger on purpose.
 */

export const DEFAULT_CHAT_DAILY_LIMIT = 50

export function chatDayKey(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10)
}

/**
 * Atomically counts one message against the daily limit. Returns false when the limit is
 * reached (nothing is counted then).
 */
export async function reserveChatMessage(
  db: D1Database,
  userId: string,
  nowMs: number,
  limit: number,
): Promise<boolean> {
  const day = chatDayKey(nowMs)
  await db
    .prepare(
      `INSERT INTO chat_usage (user_id, day_key, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id, day_key) DO NOTHING`,
    )
    .bind(userId, day, nowMs)
    .run()
  const updated = await db
    .prepare(
      `UPDATE chat_usage SET messages = messages + 1, updated_at = ?
       WHERE user_id = ? AND day_key = ? AND messages < ?`,
    )
    .bind(nowMs, userId, day, limit)
    .run()
  return updated.meta.changes === 1
}

export type ChatUsage = {
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  estimatedCostUsd: number
  failed: boolean
}

export async function recordChatUsage(
  db: D1Database,
  userId: string,
  nowMs: number,
  usage: ChatUsage,
): Promise<void> {
  await db
    .prepare(
      `UPDATE chat_usage SET
         input_tokens = input_tokens + ?,
         output_tokens = output_tokens + ?,
         thought_tokens = thought_tokens + ?,
         estimated_cost_usd = estimated_cost_usd + ?,
         failed = failed + ?,
         updated_at = ?
       WHERE user_id = ? AND day_key = ?`,
    )
    .bind(
      Math.max(0, Math.trunc(usage.inputTokens)),
      Math.max(0, Math.trunc(usage.outputTokens)),
      Math.max(0, Math.trunc(usage.thoughtTokens)),
      Math.max(0, usage.estimatedCostUsd),
      usage.failed ? 1 : 0,
      nowMs,
      userId,
      chatDayKey(nowMs),
    )
    .run()
}
