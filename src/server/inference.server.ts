import '@tanstack/react-start/server-only'
import { createGoogle } from '@ai-sdk/google'
import { generateText, Output } from 'ai'
import { z } from 'zod'

const condition = z.object({
  invalid: z.boolean(),
  reasons: z.array(z.string()),
})
const invalidations = z.object({
  textual: condition,
  handwritten: z.object({
    assessable: z.boolean(),
    invalid: z.boolean().nullable(),
    reasons: z.array(z.string()),
  }),
})
const competencyId = z.enum(['I', 'II', 'III', 'IV', 'V'])

/** Output requested by the previous prompt (kept for side-by-side benchmarking). */
export const baselineOutputSchema = z.object({
  competencies: z.array(
    z.object({
      id: competencyId,
      score: z.number().int(),
      rationale: z.string(),
      evidence: z.array(z.string()),
      strengths: z.array(z.string()),
      problems: z.array(
        z.object({ description: z.string(), quote: z.string().nullable() }),
      ),
      suggestions: z.array(z.string()),
    }),
  ),
  priorities: z.array(z.string()),
  invalidations,
})

export const FINDING_KINDS = ['desvio', 'oportunidade', 'incerto'] as const

/**
 * Calibrated output. Property order matters: the analysis, the finding classification
 * and the comparison between adjacent levels come before the score, so the score is
 * produced after its justification instead of being rationalized afterwards.
 */
export const calibratedOutputSchema = z.object({
  competencies: z.array(
    z.object({
      id: competencyId,
      rationale: z.string(),
      evidence: z.array(z.string()),
      strengths: z.array(z.string()),
      findings: z.array(
        z.object({
          kind: z.enum(FINDING_KINDS),
          description: z.string(),
          quote: z.string().nullable(),
        }),
      ),
      suggestions: z.array(z.string()),
      levelComparison: z.string(),
      score: z.number().int(),
    }),
  ),
  priorities: z.array(z.string()),
  invalidations,
})
export type CalibratedOutput = z.infer<typeof calibratedOutputSchema>

export type Usage = {
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  cacheReadTokens: number
  usageKnown: boolean
}
export function normalizeUsage(
  usage:
    | {
        inputTokens?: number
        outputTokens?: number
        inputTokenDetails?: { cacheReadTokens?: number }
        outputTokenDetails?: { textTokens?: number; reasoningTokens?: number }
      }
    | undefined,
): Usage {
  const thoughts = usage?.outputTokenDetails?.reasoningTokens ?? 0
  return {
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens:
      usage?.outputTokenDetails?.textTokens ??
      Math.max(0, (usage?.outputTokens ?? 0) - thoughts),
    thoughtTokens: thoughts,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    usageKnown:
      usage?.inputTokens !== undefined && usage.outputTokens !== undefined,
  }
}
export async function invokeModel(options: {
  apiKey: string
  model: string
  prompt: string
  system: string
  maxOutputTokens: number
  /** Structured output contract; defaults to the calibrated schema. */
  schema?: z.ZodType
  signal: AbortSignal
  fetch?: typeof fetch
  onUsage: (u: Usage) => void
}) {
  const google = createGoogle({ apiKey: options.apiKey, fetch: options.fetch })
  try {
    const generated = await generateText({
      model: google(options.model),
      instructions: options.system,
      prompt: options.prompt,
      output: Output.object({ schema: options.schema ?? calibratedOutputSchema }),
      maxRetries: 0,
      maxOutputTokens: options.maxOutputTokens,
      abortSignal: options.signal,
    })
    options.onUsage(normalizeUsage(generated.usage))
    return { text: JSON.stringify(generated.output) }
  } catch (error) {
    const e = error as { usage?: Parameters<typeof normalizeUsage>[0] }
    if (e.usage) options.onUsage(normalizeUsage(e.usage))
    throw error
  }
}
