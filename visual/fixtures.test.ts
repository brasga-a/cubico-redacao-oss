import { describe, expect, test } from 'bun:test'
import {
  correctionResultSchema,
  ensureEvidenceQuotesAreExact,
} from '../src/lib/correction'
import { annotations, request, result, sampleDraft } from './fixtures'
import {
  annotationSegments,
  evaluationView,
  sameDraft,
} from '@/lib/workbench/view-model'

describe('visual contracts and annotation rendering', () => {
  test('fixtures satisfy the real schema and cite their exact input', () => {
    expect(correctionResultSchema.safeParse(result).success).toBe(true)
    expect(ensureEvidenceQuotesAreExact(result, request.essay)).toBe(true)
    for (const a of annotations) {
      expect(a.start).toBeGreaterThanOrEqual(0)
      expect(a.end).toBeLessThanOrEqual(request.essay.length)
      expect(request.essay.slice(a.start, a.end).length).toBeGreaterThan(0)
    }
  })
  test('preserves code units once with overlap, repeats, emoji and cross-paragraph intervals', () => {
    const text = '😀 ação\n\nação é possível.'
    const notes = [
      { ...annotations[0], id: 'a', start: 0, end: 10 },
      { ...annotations[0], id: 'b', start: 3, end: 15 },
      { ...annotations[0], id: 'invalid', start: -1, end: 900 },
    ]
    const segments = annotationSegments(text, notes)
    expect(segments.map((s) => text.slice(s.start, s.end)).join('')).toBe(text)
    expect(
      segments.some((s) => s.ids.includes('a') && s.ids.includes('b')),
    ).toBe(true)
    expect(segments.some((s) => s.ids.includes('invalid'))).toBe(false)
  })
  test('does not invent positive annotations or priority associations', () => {
    const view = evaluationView(
      'test',
      '2026-11-05T12:00:00.000Z',
      sampleDraft,
      result,
      annotations,
    )
    expect(view.priorities.every((p) => p.competency === undefined)).toBe(true)
    expect(view.annotations.some((a) => a.kind === 'strength')).toBe(false)
    expect('range' in view).toBe(false)
    expect(view.priorities.some((p) => 'potentialGain' in p)).toBe(false)
  })
  test('revisions include theme, title and supporting texts', () => {
    expect(sameDraft(sampleDraft, { ...sampleDraft })).toBe(true)
    expect(
      sameDraft(sampleDraft, { ...sampleDraft, title: 'Novo título' }),
    ).toBe(false)
    expect(
      sameDraft(sampleDraft, { ...sampleDraft, supportingTexts: ['Mudança'] }),
    ).toBe(false)
  })
})
