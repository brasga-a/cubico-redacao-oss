import { describe, expect, test } from 'bun:test'
import chunks from '../../data/knowledge/kb/chunks.json'
import rubric from '../../data/rubric-2026.json'
import { request } from '../../visual/fixtures'
import {
  CORRECTION_PROMPT_VERSION,
  buildGradingGuide,
  officialPassageIds,
} from './grading-guide.server'
import { retrieveGuidanceForFindings } from './rag.server'
import { fromCalibratedOutput, validateCorrection } from './result-validation'

type Chunk = { id: string; kind: string; text: string; origin?: string }
const all = (chunks as unknown as { chunks: Chunk[] }).chunks
const byId = new Map(all.map((c) => [c.id, c]))
const guide = buildGradingGuide()

describe('grading guide', () => {
  test('is versioned and carries every official passage verbatim', () => {
    expect(CORRECTION_PROMPT_VERSION).toBe('2026.2-calibrated')
    for (const id of officialPassageIds()) {
      const chunk = byId.get(id)
      expect(chunk?.origin).toBe('inep_verbatim')
      expect(guide).toContain(chunk!.text.trim())
    }
  })

  test('every quotation of INEP commentary in the procedure is verbatim', () => {
    const commentary = all
      .filter((c) => c.kind === 'commentary')
      .map((c) => c.text.replace(/\s+/g, ' '))
      .join(' ')
    const quoted = [...guide.matchAll(/o INEP registra: "([^"]+)"/g)].map((m) => m[1])
    expect(quoted.length).toBeGreaterThan(0)
    for (const q of quoted) expect(commentary).toContain(q)
  })

  test('carries every official level descriptor', () => {
    const doc = rubric as unknown as {
      competencies: { levels: { description: string }[] }[]
    }
    for (const c of doc.competencies)
      for (const level of c.levels) expect(guide).toContain(level.description)
  })

  test('drops the paraphrases that are not in the cartilha', () => {
    for (const phrase of [
      'excessivamente longos',
      'repetições viciosas',
      'períodos internos',
      'Desenvolvimento completo dos argumentos',
    ])
      expect(guide).not.toContain(phrase)
  })

  test('has no heuristic tags, retrieved references or sample essays', () => {
    for (const tag of [
      'diagnosticTags',
      'periodos_longos',
      'repeticao_conectivos',
      'relevanceScore',
    ])
      expect(guide).not.toContain(tag)
    // No official sample essay can leak into the prompt (benchmark integrity).
    for (const essay of all.filter((c) => c.kind === 'essay'))
      expect(guide).not.toContain(essay.text.slice(0, 120))
  })

  test('adds no numeric tolerance and does not steer towards a total', () => {
    expect(guide).not.toMatch(/\b(até|no máximo|mais de|menos de) \d+ desvios?\b/i)
    expect(guide).not.toMatch(/\b1\.?000\b/)
  })
})

const quote = request.essay.slice(0, 40)

function output(findings: unknown[], score = 160) {
  const competencies = ['I', 'II', 'III', 'IV', 'V'].map((id) => ({
    id,
    rationale: 'Análise.',
    evidence: [],
    strengths: ['Ponto forte.'],
    findings: id === 'I' ? findings : [],
    suggestions: ['Sugestão do modelo.'],
    levelComparison: 'O nível superior não se aplica porque…',
    score: id === 'I' ? score : 200,
  }))
  return {
    competencies,
    priorities: ['a', 'b', 'c'],
    invalidations: {
      textual: { invalid: false, reasons: [] },
      handwritten: { assessable: false, invalid: null, reasons: ['Digitado.'] },
    },
  }
}

describe('calibrated output mapping', () => {
  test('only proven deviations become problems; the rest stays as feedback', () => {
    const { content, diagnostics } = fromCalibratedOutput(
      output([
        { kind: 'desvio', description: 'Desvio de regência.', quote },
        { kind: 'oportunidade', description: 'Pode variar o conector.', quote },
        { kind: 'incerto', description: 'Uso aceito por parte da norma.', quote: null },
      ]),
      request.essay,
    )
    const c1 = (content as ReturnType<typeof output>).competencies[0] as unknown as {
      problems: { description: string }[]
      suggestions: string[]
      rationale: string
    }
    expect(c1.problems.map((p) => p.description)).toEqual(['Desvio de regência.'])
    expect(c1.suggestions[0]).toBe('Sugestão do modelo.')
    expect(c1.suggestions[1]).toContain('Pode variar o conector.')
    expect(c1.suggestions[2]).toStartWith('Ponto a conferir, não considerado desvio:')
    expect(c1.rationale).toContain('O nível superior não se aplica')
    expect(diagnostics[0].findings.map((f) => f.kind)).toEqual([
      'desvio',
      'oportunidade',
      'incerto',
    ])
    expect(validateCorrection(content, request.essay).total).toBe(960)
  })

  test('an unverifiable quote on a non-penalizing finding is dropped, not fatal', () => {
    const { content, diagnostics } = fromCalibratedOutput(
      output([{ kind: 'incerto', description: 'Talvez.', quote: 'inventado' }]),
      request.essay,
    )
    expect(diagnostics[0].findings[0].quoteVerified).toBe(false)
    expect(() => validateCorrection(content, request.essay)).not.toThrow()
  })

  test('an unverifiable quote on a deviation still fails verification', () => {
    const { content } = fromCalibratedOutput(
      output([{ kind: 'desvio', description: 'Erro.', quote: 'inventado' }]),
      request.essay,
    )
    expect(() => validateCorrection(content, request.essay)).toThrow()
  })

  test('long text is clipped to the public limits instead of failing', () => {
    const long = 'palavra '.repeat(400)
    const raw = output([{ kind: 'oportunidade', description: long, quote: null }])
    raw.competencies[0].levelComparison = long.repeat(2)
    raw.competencies[0].rationale = long
    const { content } = fromCalibratedOutput(raw, request.essay)
    expect(() => validateCorrection(content, request.essay)).not.toThrow()
  })
})

describe('references after grading', () => {
  test('nothing is retrieved for competencies without deviations at 200', () => {
    expect(
      retrieveGuidanceForFindings(
        ['I', 'II', 'III', 'IV', 'V'].map((id) => ({
          id: id as 'I',
          score: 200,
          deviations: 0,
        })),
      ),
    ).toEqual([])
  })

  test('guidance follows the competencies with proven deviations', () => {
    const refs = retrieveGuidanceForFindings([
      { id: 'I', score: 160, deviations: 2 },
      { id: 'IV', score: 200, deviations: 0 },
    ])
    expect(refs.length).toBeGreaterThan(0)
    expect(refs.every((r) => r.relatedCompetencies.includes('I'))).toBe(true)
  })
})
