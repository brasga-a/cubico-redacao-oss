import {
  correctionContentSchema,
  ensureEvidenceQuotesAreExact,
  normalizeQuoteForMatching,
} from '../lib/correction'
import { AppError } from './errors.server'
import { calibratedOutputSchema } from './inference.server'

/** Mandatory deterministic verifier, not an optional model-selected tool. */
export function validateCorrection(raw: unknown, essay: string) {
  const parsed = correctionContentSchema.safeParse(raw)
  if (!parsed.success)
    throw new AppError(
      'INVALID_MODEL_OUTPUT',
      'A resposta não cumpriu o formato de correção esperado.',
    )
  if (!ensureEvidenceQuotesAreExact(parsed.data, essay))
    throw new AppError('QUOTE_NOT_FOUND', 'Uma citação não aparece na redação.')
  const content = parsed.data.invalidations.textual.invalid
    ? {
        ...parsed.data,
        competencies: parsed.data.competencies.map((c) => ({
          ...c,
          score: 0 as const,
        })),
      }
    : parsed.data
  return {
    ...content,
    total: content.competencies.reduce((sum, c) => sum + c.score, 0),
  }
}

export type CompetencyDiagnostics = {
  id: 'I' | 'II' | 'III' | 'IV' | 'V'
  score: number
  levelComparison: string
  findings: {
    kind: 'desvio' | 'oportunidade' | 'incerto'
    description: string
    quote: string | null
    /** False when a non-penalizing finding quoted text that is not in the essay. */
    quoteVerified: boolean
  }[]
}

const MAX_ITEMS = 12
const MAX_RATIONALE = 4_000
const MAX_ITEM_TEXT = 1_000

/** Keeps public text within the schema limits, cutting at a word boundary. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).trimEnd()}…`
}

function quoteInEssay(quote: string, essay: string): boolean {
  if (essay.includes(quote)) return true
  const q = normalizeQuoteForMatching(quote)
  return q.length > 0 && normalizeQuoteForMatching(essay).includes(q)
}

function asSuggestion(
  kind: 'oportunidade' | 'incerto',
  description: string,
  quote: string | null,
): string {
  const text = description.trim()
  const cited = quote ? `${text} (trecho: “${quote.trim()}”)` : text
  return clip(
    kind === 'incerto'
      ? `Ponto a conferir, não considerado desvio: ${cited}`
      : cited,
    MAX_ITEM_TEXT,
  )
}

/**
 * Maps the calibrated model output to the unchanged public contract.
 *
 * Only proven deviations become `problems` (the UI highlights them as points to
 * revise). Improvement opportunities and uncertain observations are kept as
 * `suggestions`, so useful feedback survives without being presented as an error.
 * Deviation quotes stay strictly verified by `validateCorrection`; a non-penalizing
 * finding whose quote cannot be found loses the quote instead of failing the whole
 * correction.
 */
export function fromCalibratedOutput(
  raw: unknown,
  essay: string,
): { content: unknown; diagnostics: CompetencyDiagnostics[] } {
  const parsed = calibratedOutputSchema.safeParse(raw)
  if (!parsed.success)
    throw new AppError(
      'INVALID_MODEL_OUTPUT',
      'A resposta não cumpriu o formato de correção esperado.',
    )
  const diagnostics: CompetencyDiagnostics[] = []
  const competencies = parsed.data.competencies.map((c) => {
    const findings = c.findings.map((f) => ({
      ...f,
      quoteVerified: f.quote === null || quoteInEssay(f.quote, essay),
    }))
    diagnostics.push({
      id: c.id,
      score: c.score,
      levelComparison: c.levelComparison,
      findings,
    })
    const problems = findings
      .filter((f) => f.kind === 'desvio')
      .map((f) => ({ description: f.description, quote: f.quote }))
    const extra = findings
      .filter((f) => f.kind !== 'desvio')
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'oportunidade' ? -1 : 1))
      .map((f) =>
        asSuggestion(
          f.kind as 'oportunidade' | 'incerto',
          f.description,
          f.quoteVerified ? f.quote : null,
        ),
      )
    return {
      id: c.id,
      score: c.score,
      rationale: clip(
        [c.rationale.trim(), c.levelComparison.trim()]
          .filter(Boolean)
          .join('\n\n'),
        MAX_RATIONALE,
      ),
      evidence: c.evidence,
      strengths: c.strengths,
      problems: problems.slice(0, MAX_ITEMS),
      suggestions: [...c.suggestions, ...extra].slice(0, MAX_ITEMS),
    }
  })
  return {
    content: {
      competencies,
      priorities: parsed.data.priorities,
      invalidations: parsed.data.invalidations,
    },
    diagnostics,
  }
}
