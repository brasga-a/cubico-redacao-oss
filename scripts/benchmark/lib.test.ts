import { describe, expect, test } from 'bun:test'
import chunks from '../../data/knowledge/kb/chunks.json'
import {
  buildDataset,
  computeMetrics,
  degradeC1,
  flattenCohesion,
  inepC1DeviationCount,
  metamorphicItems,
  removeProposal,
} from './lib'
import type { BenchItem, KbChunk, RunRecord } from './lib'

const dataset = buildDataset((chunks as unknown as { chunks: KbChunk[] }).chunks)

describe('dataset', () => {
  test('official scores only where the cartilha documents nota 1.000', () => {
    const official = dataset.filter((i) => i.expected.total !== undefined)
    expect(official.length).toBe(50)
    expect(official.every((i) => /^20(18|19|20|22|23|24)\./.test(i.id))).toBe(true)
    expect(
      dataset
        .filter((i) => /^20(25|26)\./.test(i.id))
        .every((i) => i.split === 'diagnostic' && i.expected.total === undefined),
    ).toBe(true)
  })

  test('calibration and validation are disjoint editions', () => {
    const cal = new Set(dataset.filter((i) => i.split === 'calibration').map((i) => i.theme))
    const val = dataset.filter((i) => i.split === 'validation')
    expect(val.length).toBe(27)
    expect(val.some((i) => cal.has(i.theme))).toBe(false)
  })

  test('INEP deviation counts are read from the commentary wording', () => {
    expect(inepC1DeviationCount('o texto não apresenta desvios de escrita.')).toBe(0)
    expect(inepC1DeviationCount('há apenas um desvio de acentuação em “dêem”.')).toBe(1)
    expect(inepC1DeviationCount('há presença de apenas dois desvios.')).toBe(2)
    expect(inepC1DeviationCount('Observa-se um único desvio gramatical.')).toBe(1)
    expect(inepC1DeviationCount('contém desvios pontuais, dentro do limite admitido.')).toBeNull()
    const two = dataset.find((i) => i.id === '2024.essay.02')!
    expect(two.expected.inepC1Deviations).toBe(2)
  })

  test('the essay INEP says did not reach the top C1 level is flagged', () => {
    expect(dataset.find((i) => i.id === '2026.essay.01')!.expected.c1BelowTop).toBe(true)
  })
})

test('PDF-extraction defects are repaired before grading', () => {
  const essay = dataset.find((i) => i.id === '2018.essay.02')!.essay
  expect(essay).toContain('recém-aprovado')
  expect(essay).toContain('física ou verbalmente')
  expect(essay).not.toContain('f ísica')
  expect(dataset.find((i) => i.id === '2019.essay.06')!.essay).toContain('atenuar-se')
})

describe('metamorphic variants', () => {
  const source = dataset.find((i) => i.split === 'validation')!

  test('C1 degradation introduces many changes and is deterministic', () => {
    const a = degradeC1(source.essay)
    expect(a).toBe(degradeC1(source.essay))
    const changed = a.split(/\s+/).filter((w, k) => w !== source.essay.split(/\s+/)[k]).length
    expect(changed).toBeGreaterThan(10)
  })

  test('proposal removal drops exactly the last paragraph', () => {
    const paragraphs = source.essay.trim().split(/\n\s*\n|\n/).filter((p) => p.trim())
    const out = removeProposal(source.essay)
    expect(out).not.toContain(paragraphs.at(-1)!.trim())
    expect(out).toContain(paragraphs[0].trim())
  })

  test('cohesion flattening yields a single block', () => {
    expect(flattenCohesion(source.essay)).not.toContain('\n')
  })

  test('three variants per source, all derived from validation essays', () => {
    const meta = metamorphicItems(dataset, 2)
    expect(meta.length).toBe(6)
    expect(meta.every((m) => m.derivedFrom && m.expected.maxScores)).toBe(true)
  })
})

describe('metrics', () => {
  const items = new Map<string, BenchItem>(dataset.map((i) => [i.id, i]))
  const id = dataset.find((i) => i.expected.inepC1Deviations === 1)!.id
  const rec = (run: number, c1: number, desvios: number): RunRecord => ({
    itemId: id,
    variant: 'x',
    run,
    promptVersion: 't',
    model: 'm',
    ok: true,
    scores: { I: c1, II: 200, III: 200, IV: 200, V: 200 },
    total: c1 + 800,
    deviations: {
      I: Array.from({ length: desvios }, () => ({ kind: 'desvio' as const, description: 'd', quote: null })),
      II: [],
      III: [],
      IV: [],
      V: [],
    },
  })

  test('error, stability, excess deviations and unsupported discounts', () => {
    const m = computeMetrics([rec(0, 160, 3), rec(1, 200, 0), rec(2, 160, 0)], items)
    expect(m.maeTotal).toBeCloseTo(80 / 3)
    expect(m.biasTotal).toBeCloseTo(-80 / 3)
    expect(m.maeByCompetency.I).toBeCloseTo(80 / 3)
    expect(m.meanTotalRange).toBe(40)
    expect(m.identicalTotalRate).toBe(0)
    expect(m.c1ExcessDeviations).toBeCloseTo(2 / 3)
    expect(m.c1BelowTopWhenInepAtMostOne).toBeCloseTo(2 / 3)
    expect(m.unsupportedDiscountRate).toBe(0.5)
  })
})
