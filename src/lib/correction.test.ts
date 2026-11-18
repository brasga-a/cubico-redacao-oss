import { describe, expect, test } from 'bun:test'
import {
  correctionContentSchema,
  correctionResultSchema,
  ensureEvidenceQuotesAreExact,
} from './correction'
import { calculateGeminiCost, getGeminiTokenRates } from './pricing'

const makeCompetence = (id: string, score: number) => ({
  id,
  score,
  rationale: `Avaliação da competência ${id}.`,
  evidence: ['a sociedade brasileira'],
  strengths: [`Ponto forte ${id}.`],
  problems: [{ description: `Problema ${id}.`, quote: 'é preciso agir' }],
  suggestions: [`Sugestão ${id}.`],
})

const validContent = {
  competencies: [
    makeCompetence('I', 160),
    makeCompetence('II', 200),
    makeCompetence('III', 160),
    makeCompetence('IV', 120),
    makeCompetence('V', 200),
  ],
  priorities: [
    'Detalhar o agente.',
    'Variar conectivos.',
    'Ampliar a análise.',
  ],
  invalidations: {
    textual: { invalid: false, reasons: [] },
    handwritten: {
      assessable: false,
      invalid: null,
      reasons: [
        'Características manuscritas não podem ser avaliadas a partir de texto digitado.',
      ],
    },
  },
}

describe('correction contract', () => {
  test('accepts five competencies and validates the server total', () => {
    const content = correctionContentSchema.parse(validContent)
    const result = correctionResultSchema.parse({
      ...content,
      total: 840,
      references: [],
    })
    expect(result.total).toBe(840)
    expect(result.competencies).toHaveLength(5)
  })

  test('rejects a total that does not equal the competence sum', () => {
    expect(() =>
      correctionResultSchema.parse({
        ...validContent,
        total: 800,
        references: [],
      }),
    ).toThrow()
  })

  test('rejects duplicate competence identifiers', () => {
    const duplicate = {
      ...validContent,
      competencies: validContent.competencies.map((competence, index) =>
        index === 4 ? { ...competence, id: 'IV' } : competence,
      ),
    }
    expect(() => correctionContentSchema.parse(duplicate)).toThrow()
  })

  test('requires all per-competence citations to occur verbatim in the essay', () => {
    const parsed = correctionContentSchema.parse(validContent)
    expect(
      ensureEvidenceQuotesAreExact(
        parsed,
        'Na sociedade brasileira, é preciso agir. Essa medida é necessária.',
      ),
    ).toBe(true)
    expect(
      ensureEvidenceQuotesAreExact(
        parsed,
        'Na sociedade\nbrasileira,   é preciso\nagir. Essa medida é necessária.',
      ),
    ).toBe(true)
    expect(
      ensureEvidenceQuotesAreExact(
        parsed,
        'Na sociedade brasileira, é necessário agir. Essa medida é necessária.',
      ),
    ).toBe(false)
  })

  test('normalizes curly vs straight quotes when verifying exact evidence', () => {
    const withQuotedEvidence = correctionContentSchema.parse({
      ...validContent,
      competencies: validContent.competencies.map((comp, idx) =>
        idx === 0
          ? { ...comp, evidence: ['o conceito de "necropolítica"'] }
          : comp,
      ),
    })
    expect(
      ensureEvidenceQuotesAreExact(
        withQuotedEvidence,
        'Na sociedade brasileira, o conceito de “necropolítica” mostra que é preciso agir.',
      ),
    ).toBe(true)
  })

  test('does not mark handwritten conditions as assessed for typed input', () => {
    const invalid = {
      ...validContent,
      invalidations: {
        ...validContent.invalidations,
        handwritten: { assessable: true, invalid: false, reasons: [] },
      },
    }
    expect(() => correctionContentSchema.parse(invalid)).toThrow()
  })
})

describe('Gemini cost estimate', () => {
  test('uses the current rates through November 30 and bills thought tokens as output', () => {
    const rates = getGeminiTokenRates({}, new Date('2026-11-30T12:00:00.000Z'))
    expect(calculateGeminiCost(rates, 1_000_000, 1_000_000, 1_000_000)).toBe(22)
  })

  test('uses the doubled rates starting December 1', () => {
    const rates = getGeminiTokenRates({}, new Date('2026-12-01T00:00:00.000Z'))
    expect(calculateGeminiCost(rates, 1_000_000, 1_000_000, 1_000_000)).toBe(44)
  })

  test('accepts explicit server price overrides and rejects invalid rates', () => {
    const rates = getGeminiTokenRates(
      { INPUT_USD_PER_MILLION: '3', OUTPUT_USD_PER_MILLION: '7' },
      new Date('2026-12-01T00:00:00.000Z'),
    )
    expect(calculateGeminiCost(rates, 1_000_000, 1_000_000, 1_000_000)).toBe(17)
    expect(() => getGeminiTokenRates({ INPUT_USD_PER_MILLION: '-1' })).toThrow()
  })
})
