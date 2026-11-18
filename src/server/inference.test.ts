import { test, expect } from 'bun:test'
import type { Env } from './env.server'
import {
  baselineOutputSchema,
  invokeModel,
  normalizeUsage,
} from './inference.server'
import { modelCost } from '../lib/pricing'
import { result } from '../../visual/fixtures'

/** The fixture in the calibrated model format: every fixture problem is a proven deviation. */
function calibratedFromResult(r: typeof result) {
  return {
    competencies: r.competencies.map((c) => ({
      id: c.id,
      rationale: c.rationale,
      evidence: c.evidence,
      strengths: c.strengths,
      findings: c.problems.map((p) => ({ kind: 'desvio', ...p })),
      suggestions: c.suggestions,
      levelComparison: 'Comparação entre níveis adjacentes.',
      score: c.score,
    })),
    priorities: r.priorities,
    invalidations: r.invalidations,
  }
}

const args = {
  apiKey: 'test-only',
  model: 'gemini-4-argon',
  prompt: 'synthetic',
  system: 'test',
  maxOutputTokens: 12000,
  signal: new AbortController().signal,
  onUsage: () => {},
}
for (const status of [400, 401, 403, 429, 503])
  test(`Google direct HTTP ${status} is not silently retried`, async () => {
    let calls = 0
    await expect(
      invokeModel({
        ...args,
        fetch: async (url) => {
          calls++
          expect(String(url)).toContain('generativelanguage.googleapis.com')
          return new Response(
            JSON.stringify({
              error: { code: status, message: 'test', status: 'UNAVAILABLE' },
            }),
            { status },
          )
        },
      }),
    ).rejects.toThrow()
    expect(calls).toBe(1)
  })
test('structured output and usage are obtained without Gateway', async () => {
  let calls = 0,
    usage: unknown
  const output = await invokeModel({
    ...args,
    schema: baselineOutputSchema,
    onUsage: (u) => {
      usage = u
    },
    fetch: async (url, init) => {
      calls++
      expect(String(url)).not.toContain('gateway')
      const body = JSON.parse(String(init?.body))
      expect(body.generationConfig.responseMimeType).toBe('application/json')
      return Response.json({
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: JSON.stringify(result) }],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          thoughtsTokenCount: 10,
          cachedContentTokenCount: 40,
        },
        modelVersion: 'gemini-4-argon',
      })
    },
  })
  expect(JSON.parse(output.text).competencies).toHaveLength(5)
  expect(calls).toBe(1)
  expect(usage).toMatchObject({
    inputTokens: 100,
    outputTokens: 20,
    thoughtTokens: 10,
    cacheReadTokens: 40,
  })
})
test('abort and invalid JSON fail without extra requests', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(
    invokeModel({
      ...args,
      signal: controller.signal,
      fetch: async () => {
        throw new Error('unexpected fetch')
      },
    }),
  ).rejects.toThrow()
  await expect(
    invokeModel({
      ...args,
      fetch: async () =>
        Response.json({
          candidates: [
            {
              content: { parts: [{ text: '{invalid' }] },
              finishReason: 'STOP',
            },
          ],
        }),
    }),
  ).rejects.toThrow()
})
test('cache and thinking are not charged twice; prices differ by model and date', () => {
  const u = normalizeUsage({
    inputTokens: 100,
    outputTokens: 30,
    inputTokenDetails: { cacheReadTokens: 40 },
    outputTokenDetails: { textTokens: 20, reasoningTokens: 10 },
  })
  expect(u.outputTokens + u.thoughtTokens).toBe(30)
  expect(modelCost('gemini-4-argon', u, {}, new Date('2026-11-05'))).toBe(
    0.000424,
  )
  expect(modelCost('gemini-3.6-flash', u, {}, new Date('2026-11-05'))).toBe(
    0.0001605,
  )
})

test('orchestrator falls back once on structured 503 and records Flash usage', async () => {
  const { correctEssay } = await import('./correction.server')
  const { request } = await import('../../visual/fixtures')
  const previous = globalThis.fetch
  const models: string[] = []
  globalThis.fetch = async (url) => {
    const target = String(url)
    models.push(target.includes('gemini-3.6-flash') ? 'flash' : 'argon')
    if (models.length === 1)
      return new Response(
        JSON.stringify({
          error: { code: 503, message: 'Unavailable', status: 'UNAVAILABLE' },
        }),
        { status: 503 },
      )
    return Response.json({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [{ text: JSON.stringify(calibratedFromResult(result)) }],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 10,
      },
    })
  }
  try {
    const answer = await correctEssay(request, {
      GEMINI_API_KEY: 'local-test',
    } as Env)
    expect(models).toEqual(['argon', 'flash'])
    expect(answer.usage.model).toBe('gemini-3.6-flash')
    // Both attempts are accounted for; the failed primary is not overwritten.
    expect(answer.attempts?.map((a) => a.model)).toEqual([
      'gemini-4-argon',
      'gemini-3.6-flash',
    ])
    expect(answer.usage.inputTokens).toBe(
      answer.attempts!.reduce((n, a) => n + a.inputTokens, 0),
    )
    expect(answer.result.total).toBe(840)
  } finally {
    globalThis.fetch = previous
  }
})

test('unpriced configuration fails before any billable request', async () => {
  expect(() =>
    modelCost('unknown', { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 }),
  ).toThrow('No configured pricing')
  const { correctEssay } = await import('./correction.server')
  const { request } = await import('../../visual/fixtures')
  let calls = 0
  const previous = globalThis.fetch
  globalThis.fetch = async () => {
    calls++
    throw new Error('unexpected')
  }
  try {
    await expect(
      correctEssay(request, {
        GEMINI_API_KEY: 'test-only',
        GEMINI_MODEL: 'unpriced-model',
      } as Env),
    ).rejects.toThrow('tarifa explícita')
    expect(calls).toBe(0)
  } finally {
    globalThis.fetch = previous
  }
})
