import { z } from 'zod'

export const COMPETENCE_IDS = ['I', 'II', 'III', 'IV', 'V'] as const
export const COMPETENCE_SCORES = [0, 40, 80, 120, 160, 200] as const

/**
 * Grading architectures the client may choose. These are identifiers only: models,
 * prompts and inference parameters stay on the server and are never client-selected.
 */
export const CORRECTION_PIPELINES = ['single', 'dual-review'] as const
export type CorrectionPipeline = (typeof CORRECTION_PIPELINES)[number]
export const correctionPipelineSchema = z.enum(CORRECTION_PIPELINES)

/**
 * Model the student picks for a single evaluation. Ids only: the server maps each one to
 * a Gemini model and its fallback; the client never sends model names.
 */
export const CORRECTION_MODEL_CHOICES = ['argon', 'flash'] as const
export type CorrectionModelChoice = (typeof CORRECTION_MODEL_CHOICES)[number]
export const correctionModelChoiceSchema = z.enum(CORRECTION_MODEL_CHOICES)

/** completed: auditor ran and was applied; skipped: not applicable; failed: initial result kept. */
export const AUDIT_STATUSES = ['completed', 'skipped', 'failed'] as const
export type AuditStatus = (typeof AUDIT_STATUSES)[number]

export const correctionRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    theme: z.string().trim().min(1, 'Informe o tema.').max(2_000),
    essay: z.string().trim().min(1, 'Cole a redação.').max(30_000),
    title: z.string().trim().max(300).optional(),
    supportingTexts: z.array(z.string().trim().max(20_000)).max(4).optional(),
    motivators: z.string().trim().max(20_000).optional(),
    turnstileToken: z.string().trim().max(2_048).optional(),
    /** Evaluation being revised, kept only as history metadata (never sent to the model). */
    parentId: z.string().uuid().optional(),
    /** Grading architecture; omitted by older clients, which means the standard one. */
    pipeline: correctionPipelineSchema.default('single'),
    /** Model for the single evaluation; omitted by older clients, which means Argon. */
    modelChoice: correctionModelChoiceSchema.default('argon'),
  })
  .superRefine((v, ctx) => {
    if (
      v.supportingTexts &&
      (v.motivators || v.supportingTexts.join('\n\n').length > 20000)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['supportingTexts'],
        message:
          'Use apenas um formato de motivadores, até 20.000 caracteres no total.',
      })
  })

const competenceSchema = z.object({
  id: z.enum(COMPETENCE_IDS),
  score: z.union(COMPETENCE_SCORES.map((score) => z.literal(score))),
  rationale: z.string().trim().min(1).max(4_000),
  evidence: z.array(z.string().min(1).max(1_000)).max(8),
  strengths: z.array(z.string().trim().min(1).max(1_000)).max(8),
  problems: z
    .array(
      z.object({
        description: z.string().trim().min(1).max(1_000),
        quote: z.string().min(1).max(1_000).nullable(),
      }),
    )
    .max(12),
  suggestions: z.array(z.string().trim().min(1).max(1_000)).max(12),
})

const invalidationConditionSchema = z.object({
  invalid: z.boolean(),
  reasons: z.array(z.string().trim().min(1).max(1_000)).max(8),
})

const handwrittenConditionSchema = z.object({
  assessable: z.literal(false),
  invalid: z.null(),
  reasons: z.array(z.string().trim().min(1).max(1_000)).max(8),
})

export const correctionContentSchema = z
  .object({
    competencies: z.array(competenceSchema).length(5),
    priorities: z.array(z.string().trim().min(1).max(1_000)).length(3),
    invalidations: z.object({
      textual: invalidationConditionSchema,
      handwritten: handwrittenConditionSchema,
    }),
  })
  .superRefine((result, ctx) => {
    const foundIds = result.competencies.map((competence) => competence.id)
    if (new Set(foundIds).size !== COMPETENCE_IDS.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['competencies'],
        message: 'A resposta precisa conter cada competência uma vez.',
      })
    }
  })

export const correctionReferenceSchema = z.object({
  id: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  citation: z.string().trim().min(1).max(500),
  excerpt: z.string().trim().min(1).max(2_000),
})

/**
 * How a result was produced. Optional: evaluations stored before pipelines existed
 * have no such block and are read as the standard single evaluation.
 */
export const correctionExecutionSchema = z.object({
  pipeline: correctionPipelineSchema,
  auditStatus: z.enum(AUDIT_STATUSES),
  /** Competencies whose score the auditor changed (dual review only). */
  changedCompetencies: z.array(z.enum(COMPETENCE_IDS)).max(5),
  /** Model the student chose (absent on older results: Argon). */
  modelChoice: correctionModelChoiceSchema.optional(),
  /** Model that actually produced the result (differs after a fallback). */
  model: z.string().max(64).optional(),
})
export type CorrectionExecutionInfo = z.infer<typeof correctionExecutionSchema>

export const correctionResultSchema = correctionContentSchema
  .extend({
    total: z.number().int().min(0).max(1_000),
    references: z.array(correctionReferenceSchema).max(3),
    execution: correctionExecutionSchema.optional(),
  })
  .superRefine((result, ctx) => {
    const expectedTotal = result.competencies.reduce(
      (sum, competence) => sum + competence.score,
      0,
    )
    if (result.total !== expectedTotal) {
      ctx.addIssue({
        code: 'custom',
        path: ['total'],
        message: 'O total precisa corresponder à soma das competências.',
      })
    }
  })

export type CorrectionRequest = z.infer<typeof correctionRequestSchema>
export type CorrectionContent = z.infer<typeof correctionContentSchema>
export type CorrectionResult = z.infer<typeof correctionResultSchema>
export type CorrectionReference = z.infer<typeof correctionReferenceSchema>
export type AppStatus = {
  user: {
    id?: string
    name: string
    email: string
    image?: string | null
  } | null
  authConfigured: boolean
  configured: boolean
  model: string
  turnstileSiteKey?: string | null
}

export type AppErrorCode =
  | 'INVALID_INPUT'
  | 'CSRF_REJECTED'
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'USAGE_LIMIT'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CORRECTION_FAILED'
  | 'INVALID_MODEL_OUTPUT'
  | 'QUOTE_NOT_FOUND'
  | 'RUBRIC_UNAVAILABLE'
  | 'HISTORY_UNAVAILABLE'
  | 'INTERNAL'

export type SafeError = { code: AppErrorCode; message: string }
export type ServerResult<T> =
  { ok: true; data: T } | { ok: false; error: SafeError }

export function normalizeQuoteForMatching(text: string): string {
  return text
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function ensureEvidenceQuotesAreExact(
  result: CorrectionContent,
  essay: string,
): boolean {
  const quotes = [
    ...result.competencies.flatMap((competence) => [
      ...competence.evidence,
      ...competence.problems.flatMap((problem) =>
        problem.quote === null ? [] : [problem.quote],
      ),
    ]),
  ]

  const normalizedEssay = normalizeQuoteForMatching(essay)

  return quotes.every((quote) => {
    if (essay.includes(quote)) return true
    const normalizedQuote = normalizeQuoteForMatching(quote)
    return (
      normalizedQuote.length > 0 && normalizedEssay.includes(normalizedQuote)
    )
  })
}
