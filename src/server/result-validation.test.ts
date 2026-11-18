import { test, expect } from 'bun:test'
import { validateCorrection } from './result-validation'
import { result, request } from '../../visual/fixtures'

test('invalidation overrides positive scores without a second inference', () => {
  expect(
    validateCorrection(
      {
        ...result,
        invalidations: {
          ...result.invalidations,
          textual: { invalid: true, reasons: ['Fuga total'] },
        },
      },
      request.essay,
    ).total,
  ).toBe(0)
})
test('unverified evidence and duplicate competence are rejected', () => {
  expect(() =>
    validateCorrection(
      {
        ...result,
        competencies: result.competencies.map((c) => ({
          ...c,
          evidence: ['inventado'],
        })),
      },
      request.essay,
    ),
  ).toThrow()
  expect(() =>
    validateCorrection(
      { ...result, competencies: Array(5).fill(result.competencies[0]) },
      request.essay,
    ),
  ).toThrow()
})
