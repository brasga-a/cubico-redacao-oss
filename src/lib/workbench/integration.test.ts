import 'fake-indexeddb/auto'
import { test, expect } from 'bun:test'
import { locateQuotes, realAnnotations } from './annotations'
import { makeRecord, loadHistory, saveHistory, retained } from './history'
import { result, sampleDraft } from '../../../visual/fixtures'
import { correctionRequestSchema } from '@/lib/correction'

test('literal, normalized, repeated and absent quotes keep UTF-16 offsets', () => {
  const text = '😀 “ação” — aqui\n\n“ação” — aqui'
  const ranges = locateQuotes(text, '"ação" - aqui')
  expect(ranges).toHaveLength(2)
  expect(ranges[0].start).toBe(3)
  expect(text.slice(ranges[0].start, ranges[0].end)).toBe('“ação” — aqui')
  expect(locateQuotes(text, 'inventado')).toEqual([])
  expect(
    realAnnotations(sampleDraft.essay, result).some(
      (a) => a.kind === 'strength',
    ),
  ).toBe(false)
})
test('IndexedDB is opt-in, account scoped, bounded and deletable', async () => {
  expect((await loadHistory('account-a')).enabled).toBe(false)
  const record = makeRecord('account-a', 'real-result', sampleDraft, result)
  await saveHistory('account-a', true, [record])
  expect((await loadHistory('account-a')).records[0].input).toEqual(sampleDraft)
  expect((await loadHistory('account-b')).records).toEqual([])
  const changed = { ...sampleDraft, essay: 'Revisão' }
  expect(record.input.essay).not.toBe(changed.essay)
  expect(
    retained(
      Array.from({ length: 40 }, (_, i) => ({ ...record, id: String(i) })),
      'account-a',
    ),
  ).toHaveLength(30)
  expect(
    retained(
      [{ ...record, createdAt: '2000-01-01T00:00:00.000Z' }],
      'account-a',
    ),
  ).toEqual([])
  await saveHistory('account-a', false, [])
  expect((await loadHistory('account-a')).records).toEqual([])
})
test('input V2 preserves essay boundaries and rejects conflicting/oversize motivators', () => {
  const input = {
    requestId: crypto.randomUUID(),
    theme: 'Tema',
    essay: 'Corpo',
    title: 'Título',
    supportingTexts: ['Um', 'Dois'],
  }
  expect(correctionRequestSchema.parse(input).essay).toBe('Corpo')
  expect(
    correctionRequestSchema.safeParse({ ...input, motivators: 'legado' })
      .success,
  ).toBe(false)
  expect(
    correctionRequestSchema.safeParse({
      ...input,
      supportingTexts: ['x'.repeat(11000), 'y'.repeat(11000)],
    }).success,
  ).toBe(false)
})
test('strengths and weaknesses keep their source competency', async () => {
  const { evaluationView } = await import('./view-model')
  const view = evaluationView('id', '2026-01-01', sampleDraft, result)
  const expected = result.competencies.reduce(
    (n, c) => n + c.strengths.length,
    0,
  )
  expect(view.strengths).toHaveLength(expected)
  for (const c of result.competencies) {
    const cid = `c${['I', 'II', 'III', 'IV', 'V'].indexOf(c.id) + 1}`
    for (const text of c.strengths)
      expect(view.strengths).toContainEqual({ competency: cid, text })
    for (const p of c.problems)
      expect(view.weaknesses).toContainEqual({
        competency: cid,
        text: p.description,
      })
  }
})
