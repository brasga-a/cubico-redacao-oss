import { describe, expect, test } from 'bun:test'
import { progressAt } from './correction-progress'

describe('time-based correction progress', () => {
  test('starts on the first step with an empty bar', () => {
    expect(progressAt('single', 0)).toEqual({ current: 0, fraction: 0 })
  })

  test('advances with the typical duration of each architecture', () => {
    expect(progressAt('single', 20_000).current).toBe(2)
    // The dual review is slower: at the same moment it is earlier in its plan.
    expect(progressAt('dual-review', 20_000).current).toBeLessThan(3)
    expect(progressAt('dual-review', 60_000).current).toBe(3)
  })

  test('never claims completion on its own, however long it takes', () => {
    for (const pipeline of ['single', 'dual-review'] as const) {
      const late = progressAt(pipeline, 10 * 60_000)
      expect(late.fraction).toBe(0.92)
      // The last step stays "in progress" until the result replaces the screen.
      expect(late.current).toBe(pipeline === 'single' ? 3 : 4)
    }
  })

  test('is monotonic', () => {
    let previous = -1
    for (let t = 0; t <= 120_000; t += 5_000) {
      const { fraction } = progressAt('single', t)
      expect(fraction).toBeGreaterThanOrEqual(previous)
      previous = fraction
    }
  })
})
