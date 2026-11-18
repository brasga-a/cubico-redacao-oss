import '@tanstack/react-start/server-only'

import { countWords } from '@/lib/workbench/text'
import {
  CLOUD_CONSENT_VERSION,
  HISTORY_LIMIT,
  HISTORY_PAGE_SIZE,
  HISTORY_RETENTION_MS,
  MAX_RECORD_JSON_CHARS,
  RUBRIC_VERSION,
  SCHEMA_VERSION,
  evaluationInputSchema,
  evaluationRecordSchema,
} from '../lib/evaluation-history'
import { correctionResultSchema } from '../lib/correction'
import type { CorrectionRequest, CorrectionResult } from '../lib/correction'
import type {
  EvaluationInput,
  EvaluationRecord,
  EvaluationSummary,
  HistoryPage,
  HistoryPreference,
  ImportOutcome,
  PersistenceState,
} from '../lib/evaluation-history'
import { AppError } from './errors.server'

/**
 * D1 persistence for the opt-in cloud history.
 *
 * Every query is parameterized and scoped by the authenticated `userId` passed by the
 * caller; no function accepts an owner from the browser. Nothing here logs essay text,
 * feedback or JSON payloads.
 */

/** Global expired rows removed per write, so cleanup cost stays bounded and predictable. */
export const GLOBAL_SWEEP_LIMIT = 100

type EvaluationRow = {
  id: string
  created_at: number
  theme: string
  title: string
  total_score: number
  c1: number
  c2: number
  c3: number
  c4: number
  c5: number
  word_count: number
  parent_id: string | null
  origin: 'correction' | 'import'
  model_id: string | null
}

type PreferenceRow = {
  cloud_enabled: number
  consent_version: number | null
  consented_at: number | null
  revoked_at: number | null
}

export type NewEvaluation = {
  id: string
  requestId: string
  createdAtMs: number
  input: EvaluationInput
  result: CorrectionResult
  parentId: string | null
  modelId: string | null
  origin: 'correction' | 'import'
  /** How the result was produced; absent for imports and older callers. */
  execution?: EvaluationExecution
}

export type EvaluationExecution = {
  pipeline: 'single' | 'dual-review'
  promptVersion: string | null
  auditStatus: 'completed' | 'skipped' | 'failed' | null
  /** Stages, initial vs final scores and audit decisions (stored as JSON). */
  details?: unknown
}

const iso = (ms: number | null) =>
  ms === null ? null : new Date(ms).toISOString()

export const retentionCutoff = (nowMs: number) => nowMs - HISTORY_RETENTION_MS

export async function getPreference(
  db: D1Database,
  userId: string,
): Promise<HistoryPreference> {
  const row = await db
    .prepare(
      'SELECT cloud_enabled, consent_version, consented_at, revoked_at FROM history_preferences WHERE user_id = ?',
    )
    .bind(userId)
    .first<PreferenceRow>()
  return {
    cloudEnabled: row?.cloud_enabled === 1,
    consentVersion: row?.consent_version ?? null,
    consentedAt: iso(row?.consented_at ?? null),
    revokedAt: iso(row?.revoked_at ?? null),
  }
}

/** Granting records the consent version and time; revoking keeps every stored evaluation. */
export async function setPreference(
  db: D1Database,
  userId: string,
  enabled: boolean,
  nowMs: number,
): Promise<HistoryPreference> {
  await db
    .prepare(
      `INSERT INTO history_preferences
         (user_id, cloud_enabled, consent_version, consented_at, revoked_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         cloud_enabled = excluded.cloud_enabled,
         consent_version = CASE WHEN excluded.cloud_enabled = 1
           THEN excluded.consent_version ELSE history_preferences.consent_version END,
         consented_at = CASE WHEN excluded.cloud_enabled = 1
           THEN excluded.consented_at ELSE history_preferences.consented_at END,
         revoked_at = excluded.revoked_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      userId,
      enabled ? 1 : 0,
      enabled ? CLOUD_CONSENT_VERSION : null,
      enabled ? nowMs : null,
      enabled ? null : nowMs,
      nowMs,
    )
    .run()
  return getPreference(db, userId)
}

function scoresOf(result: CorrectionResult) {
  const score = (id: 'I' | 'II' | 'III' | 'IV' | 'V') => {
    const found = result.competencies.find((c) => c.id === id)
    if (!found) throw new AppError('INVALID_INPUT', 'Resultado incompleto.')
    return found.score
  }
  return [score('I'), score('II'), score('III'), score('IV'), score('V')]
}

/**
 * Inserts metadata and payload atomically (one D1 batch = one transaction).
 * Idempotent: an existing row with the same id/request id is never overwritten.
 */
export async function insertEvaluation(
  db: D1Database,
  userId: string,
  record: NewEvaluation,
  nowMs: number,
): Promise<'inserted' | 'duplicate' | 'conflict'> {
  const scores = scoresOf(record.result)
  const total = scores.reduce<number>((sum, s) => sum + s, 0)
  if (total !== record.result.total)
    throw new AppError('INVALID_INPUT', 'Nota total inconsistente.')
  const [inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO evaluations (
           id, user_id, request_id, created_at, theme, title, total_score,
           c1, c2, c3, c4, c5, word_count, model_id, rubric_version,
           schema_version, parent_id, origin, stored_at,
           pipeline, prompt_version, audit_status, execution_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        record.id,
        userId,
        record.requestId,
        record.createdAtMs,
        record.input.topic,
        record.input.title,
        total,
        ...scores,
        countWords(record.input.essay),
        record.modelId,
        RUBRIC_VERSION,
        SCHEMA_VERSION,
        record.parentId,
        record.origin,
        nowMs,
        record.execution?.pipeline ??
          record.result.execution?.pipeline ??
          'single',
        record.execution?.promptVersion ?? null,
        record.execution?.auditStatus ??
          record.result.execution?.auditStatus ??
          null,
        record.execution?.details === undefined
          ? null
          : JSON.stringify(record.execution.details),
      ),
    db
      .prepare(
        `INSERT INTO evaluation_payloads (evaluation_id, input_json, result_json)
         SELECT ?, ?, ?
         WHERE EXISTS (SELECT 1 FROM evaluations WHERE id = ? AND user_id = ?)
         ON CONFLICT DO NOTHING`,
      )
      .bind(
        record.id,
        JSON.stringify(record.input),
        JSON.stringify(record.result),
        record.id,
        userId,
      ),
  ])
  if (inserted.meta.changes === 1) return 'inserted'
  const existing = await db
    .prepare(
      'SELECT user_id, id, request_id FROM evaluations WHERE id = ? OR request_id = ? OR id = ? OR request_id = ?',
    )
    .bind(record.id, record.requestId, record.requestId, record.id)
    .all<{ user_id: string; id: string; request_id: string }>()
  // A row owned by another account is reported as a conflict without revealing anything about it.
  return existing.results.length > 0 &&
    existing.results.every(
      (row) =>
        row.user_id === userId &&
        row.id === record.id &&
        row.request_id === record.requestId,
    )
    ? 'duplicate'
    : 'conflict'
}

const prunePredicate = `user_id = ? AND (
    created_at < ?
    OR id IN (
      SELECT id FROM evaluations WHERE user_id = ?
      ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?
    )
  )`

/**
 * Enforces the retention policy on the server: per account, rows older than the
 * retention window and rows beyond the newest HISTORY_LIMIT are deleted; then a
 * bounded sweep removes expired rows of every account (covers inactive accounts).
 */
export async function enforceRetention(
  db: D1Database,
  userId: string,
  nowMs: number,
): Promise<void> {
  const cutoff = retentionCutoff(nowMs)
  const userBinds = [userId, cutoff, userId, HISTORY_LIMIT]
  const sweep = `SELECT id FROM evaluations WHERE created_at < ? ORDER BY created_at LIMIT ${GLOBAL_SWEEP_LIMIT}`
  await db.batch([
    db
      .prepare(
        `DELETE FROM evaluation_payloads WHERE evaluation_id IN (SELECT id FROM evaluations WHERE ${prunePredicate})`,
      )
      .bind(...userBinds),
    db
      .prepare(`DELETE FROM evaluations WHERE ${prunePredicate}`)
      .bind(...userBinds),
    db
      .prepare(
        `DELETE FROM evaluation_payloads WHERE evaluation_id IN (${sweep})`,
      )
      .bind(cutoff),
    db.prepare(`DELETE FROM evaluations WHERE id IN (${sweep})`).bind(cutoff),
  ])
}

function toSummary(row: EvaluationRow): EvaluationSummary {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    theme: row.theme,
    title: row.title,
    totalScore: row.total_score,
    scores: { c1: row.c1, c2: row.c2, c3: row.c3, c4: row.c4, c5: row.c5 },
    wordCount: row.word_count,
    parentId: row.parent_id,
    origin: row.origin,
    modelId: row.model_id,
  }
}

const SUMMARY_COLUMNS =
  'id, created_at, theme, title, total_score, c1, c2, c3, c4, c5, word_count, parent_id, origin, model_id'

/** Keyset pagination over metadata only (newest first). */
export async function listEvaluations(
  db: D1Database,
  userId: string,
  options: { cursor?: string; limit?: number },
  nowMs: number,
): Promise<Omit<HistoryPage, 'preference'>> {
  const limit = options.limit ?? HISTORY_PAGE_SIZE
  const cutoff = retentionCutoff(nowMs)
  let cursorClause = ''
  const binds: unknown[] = [userId, cutoff]
  if (options.cursor) {
    const dot = options.cursor.indexOf('.')
    const at = Number(options.cursor.slice(0, dot))
    const id = options.cursor.slice(dot + 1)
    cursorClause = 'AND (created_at < ? OR (created_at = ? AND id < ?))'
    binds.push(at, at, id)
  }
  // The newest HISTORY_LIMIT rows are the retained set even before the next prune runs.
  const rows = await db
    .prepare(
      `SELECT ${SUMMARY_COLUMNS} FROM (
         SELECT ${SUMMARY_COLUMNS} FROM evaluations
         WHERE user_id = ? AND created_at >= ?
         ORDER BY created_at DESC, id DESC LIMIT ${HISTORY_LIMIT}
       ) WHERE 1 = 1 ${cursorClause}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .bind(...binds, limit + 1)
    .all<EvaluationRow>()
  const page = rows.results.slice(0, limit)
  const last = page.at(-1)
  return {
    items: page.map(toSummary),
    nextCursor:
      rows.results.length > limit && last
        ? `${last.created_at}.${last.id}`
        : null,
  }
}

/** Loads the full payload of one evaluation of this account, validating it again. */
export async function getEvaluation(
  db: D1Database,
  userId: string,
  id: string,
  nowMs: number,
): Promise<EvaluationRecord | null> {
  const row = await db
    .prepare(
      `SELECT e.id, e.created_at, e.parent_id, e.rubric_version, e.schema_version,
              p.input_json, p.result_json
       FROM evaluations e JOIN evaluation_payloads p ON p.evaluation_id = e.id
       WHERE e.id = ? AND e.user_id = ? AND e.created_at >= ?`,
    )
    .bind(id, userId, retentionCutoff(nowMs))
    .first<{
      id: string
      created_at: number
      parent_id: string | null
      rubric_version: string
      schema_version: number
      input_json: string
      result_json: string
    }>()
  if (!row) return null
  let parsed: ReturnType<typeof evaluationRecordSchema.safeParse>
  try {
    parsed = evaluationRecordSchema.safeParse({
      id: row.id,
      createdAt: new Date(row.created_at).toISOString(),
      input: JSON.parse(row.input_json),
      result: JSON.parse(row.result_json),
      parentId: row.parent_id ?? undefined,
      rubricVersion: row.rubric_version,
      schemaVersion: row.schema_version,
    })
  } catch {
    parsed = { success: false } as typeof parsed
  }
  if (!parsed.success)
    throw new AppError(
      'INTERNAL',
      'Esta avaliação salva não pôde ser lida. Exclua-a ou tente novamente.',
    )
  return parsed.data
}

/** Finds an evaluation stored for a correction request (used to recover without new inference). */
export async function findByRequestId(
  db: D1Database,
  userId: string,
  requestId: string,
  nowMs: number,
): Promise<{ id: string; createdAt: string } | null> {
  const row = await db
    .prepare(
      'SELECT id, created_at FROM evaluations WHERE request_id = ? AND user_id = ? AND created_at >= ?',
    )
    .bind(requestId, userId, retentionCutoff(nowMs))
    .first<{ id: string; created_at: number }>()
  return row
    ? { id: row.id, createdAt: new Date(row.created_at).toISOString() }
    : null
}

export async function deleteEvaluation(
  db: D1Database,
  userId: string,
  id: string,
): Promise<boolean> {
  const [, removed] = await db.batch([
    db
      .prepare(
        'DELETE FROM evaluation_payloads WHERE evaluation_id IN (SELECT id FROM evaluations WHERE id = ? AND user_id = ?)',
      )
      .bind(id, userId),
    db
      .prepare('DELETE FROM evaluations WHERE id = ? AND user_id = ?')
      .bind(id, userId),
  ])
  return removed.meta.changes > 0
}

/** Deletes every evaluation of this account. Usage ledger and consent are untouched. */
export async function deleteAllEvaluations(
  db: D1Database,
  userId: string,
): Promise<number> {
  const [, removed] = await db.batch([
    db
      .prepare(
        'DELETE FROM evaluation_payloads WHERE evaluation_id IN (SELECT id FROM evaluations WHERE user_id = ?)',
      )
      .bind(userId),
    db.prepare('DELETE FROM evaluations WHERE user_id = ?').bind(userId),
  ])
  return removed.meta.changes
}

/** Snapshot of the validated request that was actually graded. */
export function inputFromRequest(request: CorrectionRequest): EvaluationInput {
  return evaluationInputSchema.parse({
    topic: request.theme,
    title: request.title ?? '',
    essay: request.essay,
    supportingTexts:
      request.supportingTexts ??
      (request.motivators ? [request.motivators] : []),
    updatedAt: null,
  })
}

/**
 * Saves a completed correction when (and only when) the account consented.
 * Never throws: a storage failure is reported as `failed` so the paid result is kept.
 */
export async function persistCorrection(
  db: D1Database,
  userId: string,
  request: CorrectionRequest,
  result: CorrectionResult,
  modelId: string | null,
  nowMs: number,
  execution?: EvaluationExecution,
): Promise<PersistenceState> {
  try {
    const preference = await getPreference(db, userId)
    if (!preference.cloudEnabled) return { status: 'disabled' }
    const outcome = await insertEvaluation(
      db,
      userId,
      {
        id: request.requestId,
        requestId: request.requestId,
        createdAtMs: nowMs,
        input: inputFromRequest(request),
        result: correctionResultSchema.parse(result),
        parentId: request.parentId ?? null,
        modelId,
        origin: 'correction',
        execution,
      },
      nowMs,
    )
    if (outcome === 'conflict') return { status: 'failed' }
    await enforceRetention(db, userId, nowMs)
    const stored = await findByRequestId(db, userId, request.requestId, nowMs)
    return stored
      ? {
          status: 'saved',
          evaluationId: stored.id,
          createdAt: stored.createdAt,
        }
      : { status: 'failed' }
  } catch {
    // No D1 detail, essay text or payload is logged or exposed.
    return { status: 'failed' }
  }
}

function idOf(raw: unknown, index: number): string {
  if (raw && typeof raw === 'object' && 'id' in raw) {
    const id = raw.id
    if (typeof id === 'string' && id.length <= 64) return id
  }
  return `#${index + 1}`
}

/**
 * Imports browser-exported records for the authenticated account. Each record is
 * validated again; ids, timestamps, results and revision links are preserved.
 * Re-running the same batch is safe (duplicates are reported, never re-inserted).
 */
export async function importEvaluations(
  db: D1Database,
  userId: string,
  records: unknown[],
  nowMs: number,
): Promise<ImportOutcome[]> {
  const cutoff = retentionCutoff(nowMs)
  const outcomes: ImportOutcome[] = []
  const inserted: string[] = []
  for (const [index, raw] of records.entries()) {
    const id = idOf(raw, index)
    let size = Infinity
    try {
      size = JSON.stringify(raw).length
    } catch {
      // Unserializable input is treated as too large.
    }
    if (size > MAX_RECORD_JSON_CHARS) {
      outcomes.push({ id, status: 'failed', reason: 'too_large' })
      continue
    }
    const parsed = evaluationRecordSchema.safeParse(raw)
    if (!parsed.success) {
      outcomes.push({ id, status: 'failed', reason: 'invalid' })
      continue
    }
    const record = parsed.data
    const createdAtMs = Date.parse(record.createdAt)
    if (createdAtMs < cutoff) {
      outcomes.push({ id, status: 'failed', reason: 'expired' })
      continue
    }
    if (createdAtMs > nowMs + 5 * 60_000) {
      outcomes.push({ id, status: 'failed', reason: 'invalid' })
      continue
    }
    const outcome = await insertEvaluation(
      db,
      userId,
      {
        id: record.id,
        requestId: record.id,
        createdAtMs,
        input: record.input,
        result: record.result,
        parentId: record.parentId ?? null,
        modelId: null,
        origin: 'import',
      },
      nowMs,
    )
    if (outcome === 'inserted') {
      inserted.push(record.id)
      outcomes.push({ id, status: 'imported' })
    } else if (outcome === 'duplicate') {
      outcomes.push({ id, status: 'duplicate' })
    } else {
      outcomes.push({ id, status: 'failed', reason: 'conflict' })
    }
  }
  if (inserted.length) {
    await enforceRetention(db, userId, nowMs)
    const kept = await db
      .prepare(
        `SELECT id FROM evaluations WHERE user_id = ? AND id IN (${inserted.map(() => '?').join(',')})`,
      )
      .bind(userId, ...inserted)
      .all<{ id: string }>()
    const keptIds = new Set(kept.results.map((r) => r.id))
    for (const [i, outcome] of outcomes.entries()) {
      if (outcome.status === 'imported' && !keptIds.has(outcome.id))
        outcomes[i] = { id: outcome.id, status: 'failed', reason: 'retention' }
    }
  }
  return outcomes
}
