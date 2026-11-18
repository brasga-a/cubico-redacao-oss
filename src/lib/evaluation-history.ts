import { z } from 'zod'
import { correctionResultSchema } from './correction'

/** Retention policy shared by server enforcement and user-facing copy. */
export const HISTORY_LIMIT = 30
export const HISTORY_RETENTION_DAYS = 90
export const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * 86_400_000
export const HISTORY_PAGE_SIZE = 10
export const HISTORY_MAX_PAGE_SIZE = 30
/** Records per import request; bounded so a batch stays far below D1 limits. */
export const IMPORT_BATCH_SIZE = 5
/** Upper bound for one serialized record (input + result). */
export const MAX_RECORD_JSON_CHARS = 600_000
export const CLOUD_CONSENT_VERSION = 1
export const RUBRIC_VERSION = '2026'
export const SCHEMA_VERSION = 1

export const evaluationIdSchema = z.string().uuid()

/** Immutable snapshot of what was submitted for correction. */
export const evaluationInputSchema = z.object({
  topic: z.string().max(2_000),
  title: z.string().max(300),
  essay: z.string().min(1).max(30_000),
  supportingTexts: z.array(z.string().max(20_000)).max(4),
  updatedAt: z.string().max(64).nullable(),
})
export type EvaluationInput = z.infer<typeof evaluationInputSchema>

/** Full record, as exported from the browser or returned by the server. Unknown keys (e.g. `owner`) are stripped. */
export const evaluationRecordSchema = z.object({
  id: evaluationIdSchema,
  createdAt: z.string().datetime(),
  input: evaluationInputSchema,
  result: correctionResultSchema,
  parentId: evaluationIdSchema.optional(),
  rubricVersion: z.literal(RUBRIC_VERSION),
  schemaVersion: z.literal(SCHEMA_VERSION),
})
export type EvaluationRecord = z.infer<typeof evaluationRecordSchema>

export const evaluationOriginSchema = z.enum(['correction', 'import'])

/** Listing row: metadata only, never essay or feedback text. */
export const evaluationSummarySchema = z.object({
  id: evaluationIdSchema,
  createdAt: z.string().datetime(),
  theme: z.string(),
  title: z.string(),
  totalScore: z.number().int(),
  scores: z.object({
    c1: z.number().int(),
    c2: z.number().int(),
    c3: z.number().int(),
    c4: z.number().int(),
    c5: z.number().int(),
  }),
  wordCount: z.number().int(),
  parentId: z.string().nullable(),
  origin: evaluationOriginSchema,
  modelId: z.string().nullable(),
})
export type EvaluationSummary = z.infer<typeof evaluationSummarySchema>

export const historyPreferenceSchema = z.object({
  cloudEnabled: z.boolean(),
  consentVersion: z.number().int().nullable(),
  consentedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
})
export type HistoryPreference = z.infer<typeof historyPreferenceSchema>

export type HistoryPage = {
  items: EvaluationSummary[]
  nextCursor: string | null
  preference: HistoryPreference
}

/** Opaque keyset cursor: `<createdAtMs>.<id>`. */
export const historyCursorSchema = z
  .string()
  .max(80)
  .regex(/^\d{1,15}\.[0-9a-f-]{36}$/i)

export const listHistoryInputSchema = z.object({
  cursor: historyCursorSchema.optional(),
  limit: z.number().int().min(1).max(HISTORY_MAX_PAGE_SIZE).optional(),
})
export const evaluationLookupSchema = z.object({ id: evaluationIdSchema })
export const deleteAllHistorySchema = z.object({ confirm: z.literal(true) })
export const setHistoryPreferenceSchema = z.object({
  enabled: z.boolean(),
  consentVersion: z.literal(CLOUD_CONSENT_VERSION).optional(),
})
/** Each record is validated individually so one bad record does not reject the batch. */
export const importHistorySchema = z.object({
  records: z.array(z.unknown()).min(1).max(IMPORT_BATCH_SIZE),
})

export type ImportOutcome =
  | { id: string; status: 'imported' | 'duplicate' }
  | {
      id: string
      status: 'failed'
      reason: 'invalid' | 'too_large' | 'expired' | 'conflict' | 'retention'
    }
export type ImportReport = { results: ImportOutcome[] }

/** Explicit storage outcome returned next to a correction result. */
export type PersistenceState =
  | { status: 'saved'; evaluationId: string; createdAt: string }
  | { status: 'recovered'; evaluationId: string; createdAt: string }
  | { status: 'disabled' }
  | { status: 'failed' }
