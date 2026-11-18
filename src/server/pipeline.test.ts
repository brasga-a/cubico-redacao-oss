import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { request as baseRequest, result as fixture } from '../../visual/fixtures'
import { correctionResultSchema } from '../lib/correction'
import type { CorrectionRequest, CorrectionResult } from '../lib/correction'
import { modelCost } from '../lib/pricing'
import { buildAuditContent, buildAuditGuide, composeAudit } from './audit.server'
import type { AuditOutput } from './audit.server'
import type { CorrectionExecution, CorrectionUsage } from './correction.server'
import type { Env } from './env.server'
import { AppError } from './errors.server'
import { buildGradingGuide } from './grading-guide.server'
import {
  DUAL_REVIEW_MODEL,
  FLASH_FALLBACK_MODEL,
  FLASH_MODEL,
  runPipeline,
} from './pipeline.server'
import type { PipelineDeps } from './pipeline.server'
import type { CompetencyDiagnostics } from './result-validation'

const env = { GEMINI_API_KEY: 'test-only' } as Env
const essay = baseRequest.essay
const QUOTE = 'o acesso à informação favorece a valorização cultural'
const OTHER = 'A formação de professores é uma condição para aprofundar esse debate.'

const initial: CorrectionResult = correctionResultSchema.parse(fixture)
/** Fixture trace: C3 has one deviation (the fixture's problem); C1 one opportunity. */
const diagnostics: CompetencyDiagnostics[] = initial.competencies.map((c) => ({
  id: c.id,
  score: c.score,
  levelComparison: 'Comparação.',
  findings: [
    ...c.problems.map((p) => ({ kind: 'desvio' as const, ...p, quoteVerified: true })),
    ...(c.id === 'I'
      ? [{ kind: 'oportunidade' as const, description: 'Variar períodos.', quote: null, quoteVerified: true }]
      : []),
  ],
}))
const usage = (model: string, cost: number, extra: Partial<CorrectionUsage> = {}): CorrectionUsage => ({
  model,
  inputTokens: 1_000,
  outputTokens: 200,
  thoughtTokens: 50,
  cacheReadTokens: 100,
  estimatedCostUsd: cost,
  usageKnown: true,
  ...extra,
})
const correctorRun = (model = DUAL_REVIEW_MODEL): CorrectionExecution => ({
  result: initial,
  usage: usage(model, 0.002),
  attempts: [usage(model, 0.002)],
  diagnostics: { promptVersion: '2026.2-calibrated', competencies: diagnostics },
})

type Review = AuditOutput['competencies'][number]
/** Auditor answer that keeps every score, with per-competency overrides. */
function audit(overrides: Partial<Record<'I' | 'II' | 'III' | 'IV' | 'V', Partial<Review>>> = {}): AuditOutput {
  return {
    competencies: initial.competencies.map((c) => ({
      id: c.id,
      findingReviews: [],
      missedFindings: [],
      meetsUpperLevel: c.score === 200 ? 'nao_se_aplica' : 'nao',
      meetsCurrentLevel: 'sim',
      decision: 'manter',
      justification: '',
      evidence: [],
      finalScore: c.score,
      ...overrides[c.id],
    })),
  }
}

function deps(answer: unknown | (() => never), over: Partial<PipelineDeps> = {}) {
  const calls = { correct: [] as Record<string, unknown>[], audit: 0, auditInput: '' }
  let clock = 0
  const d: PipelineDeps = {
    now: () => (clock += 1_000),
    correct: async (_req, _env, onUsage, options) => {
      calls.correct.push(options)
      const run = correctorRun(options.model ?? 'gemini-4-argon')
      onUsage(run.usage)
      return run
    },
    audit: async ({ input, onUsage }) => {
      calls.audit++
      calls.auditInput = buildAuditContent(input)
      const u = usage(DUAL_REVIEW_MODEL, 0.001)
      onUsage(u)
      if (typeof answer === 'function') (answer as () => never)()
      return { raw: answer, usage: u }
    },
    ...over,
  }
  return { d, calls }
}
const dual: CorrectionRequest = { ...baseRequest, pipeline: 'dual-review' }
const scores = (r: CorrectionResult) => r.competencies.map((c) => c.score)

describe('single pipeline (control group)', () => {
  test('one calibrated call with the configured model and fallback, no audit', async () => {
    const { d, calls } = deps(audit())
    const run = await runPipeline(baseRequest, env, () => {}, d)
    expect(calls.correct).toEqual([{ variant: 'calibrated' }])
    expect(calls.audit).toBe(0)
    expect(scores(run.result)).toEqual(scores(initial))
    expect(run.result.execution).toEqual({
      pipeline: 'single',
      auditStatus: 'skipped',
      changedCompetencies: [],
      modelChoice: 'argon',
      model: 'gemini-4-argon',
    })
    expect(run.stages.map((s) => s.stage)).toEqual(['corrector'])
  })

  test('the flash choice runs the same prompt on 3.8 Flash, falling back to Argon', async () => {
    const { d, calls } = deps(audit())
    const run = await runPipeline({ ...baseRequest, modelChoice: 'flash' }, env, () => {}, d)
    expect(calls.correct).toEqual([
      { variant: 'calibrated', model: FLASH_MODEL, fallbackModel: FLASH_FALLBACK_MODEL },
    ])
    expect(FLASH_MODEL).toBe('gemini-3.8-flash')
    expect(FLASH_FALLBACK_MODEL).toBe('gemini-4-argon')
    expect(calls.audit).toBe(0)
    expect(run.result.execution).toMatchObject({ modelChoice: 'flash', model: 'gemini-3.8-flash' })
  })

  test('when Flash is overloaded the result records that Argon answered', async () => {
    const { d } = deps(audit(), {
      correct: async (_req, _env, onUsage) => {
        const run = correctorRun('gemini-4-argon')
        onUsage(run.usage)
        return run
      },
    })
    const run = await runPipeline({ ...baseRequest, modelChoice: 'flash' }, env, () => {}, d)
    expect(run.result.execution).toMatchObject({ modelChoice: 'flash', model: 'gemini-4-argon' })
  })

  test('a request without a pipeline is never routed to the dual review', async () => {
    const { d, calls } = deps(audit())
    const { pipeline: _omit, ...legacy } = baseRequest
    await runPipeline(legacy as CorrectionRequest, env, () => {}, d)
    expect(calls.audit).toBe(0)
  })

  test('the calibrated Argon prompt is byte-identical to the control version', () => {
    expect(createHash('sha256').update(buildGradingGuide()).digest('hex')).toBe(
      '8abce6255046f327610a93c8b818992644765f5c2886ca2a96a4909b3e467552',
    )
  })
})

describe('dual review', () => {
  test('corrector runs on Flash without a silent fallback, then the auditor', async () => {
    const { d, calls } = deps(audit())
    const run = await runPipeline(dual, env, () => {}, d)
    expect(calls.correct[0]).toMatchObject({ variant: 'calibrated', model: DUAL_REVIEW_MODEL, fallbackModel: null })
    expect(calls.audit).toBe(1)
    expect(run.auditStatus).toBe('completed')
    expect(run.stages.map((s) => [s.stage, s.status])).toEqual([
      ['corrector', 'succeeded'],
      ['auditor', 'succeeded'],
    ])
  })

  test('the auditor sees the essay, the first scores and numbered findings', async () => {
    const { d, calls } = deps(audit())
    await runPipeline(dual, env, () => {}, d)
    const sent = JSON.parse(calls.auditInput)
    expect(sent.essay).toBe(essay)
    expect(sent.correcaoInicial[2].findings[0]).toMatchObject({ index: 0, kind: 'desvio', quote: QUOTE })
    expect(buildAuditGuide()).toContain('A auditoria é simétrica')
  })

  test('confirming every score keeps the first evaluation', async () => {
    const { d } = deps(audit())
    const run = await runPipeline(dual, env, () => {}, d)
    expect(scores(run.result)).toEqual(scores(initial))
    expect(run.result.total).toBe(initial.total)
    expect(run.result.execution?.changedCompetencies).toEqual([])
    expect(run.initialResult).toEqual(initial)
  })

  test('raising: an isolated deviation judged insufficient is reclassified', async () => {
    const { d } = deps(
      audit({
        III: {
          findingReviews: [{ index: 0, exists: true, quoteSupports: true, verdict: 'reclassificado', kind: 'oportunidade', reason: 'Pontual, não compromete a organização.' }],
          meetsUpperLevel: 'sim',
          decision: 'aumentar',
          justification: 'O desvio apontado é pontual; o texto atende ao descritor de 200.',
          finalScore: 200,
        },
      }),
    )
    const run = await runPipeline(dual, env, () => {}, d)
    const c3 = run.result.competencies.find((c) => c.id === 'III')!
    expect(c3.score).toBe(200)
    expect(c3.problems).toEqual([])
    expect(c3.suggestions.some((s) => s.includes('Explique como o acesso'))).toBe(true)
    expect(c3.rationale).toContain('Revisão da auditoria')
    expect(run.result.total).toBe(initial.total + 40)
    expect(run.result.execution?.changedCompetencies).toEqual(['III'])
    expect(run.audit?.changes.find((c) => c.competency === 'III')).toMatchObject({ from: 160, to: 200, accepted: true })
  })

  test('rejecting a nonexistent problem removes it', async () => {
    const { d } = deps(
      audit({
        III: {
          findingReviews: [{ index: 0, exists: false, quoteSupports: false, verdict: 'rejeitado', kind: 'desvio', reason: 'O trecho desenvolve a relação.' }],
          meetsUpperLevel: 'sim',
          decision: 'aumentar',
          justification: 'O problema apontado não existe.',
          finalScore: 200,
        },
      }),
    )
    const run = await runPipeline(dual, env, () => {}, d)
    expect(run.result.competencies.find((c) => c.id === 'III')!.problems).toEqual([])
    expect(run.audit?.rejectedFindings).toBe(1)
  })

  test('lowering: a problem the corrector missed, with a literal quote', async () => {
    const { d } = deps(
      audit({
        V: {
          missedFindings: [{ kind: 'desvio', description: 'Detalhamento ausente.', quote: 'As escolas devem integrar esse trabalho ao currículo' }],
          meetsCurrentLevel: 'nao',
          decision: 'reduzir',
          justification: 'A proposta não é detalhada como exige o nível 200.',
          finalScore: 160,
        },
      }),
    )
    const run = await runPipeline(dual, env, () => {}, d)
    const c5 = run.result.competencies.find((c) => c.id === 'V')!
    expect(c5.score).toBe(160)
    expect(c5.problems).toHaveLength(1)
    expect(run.audit?.acceptedMissedDeviations).toBe(1)
  })

  test('lowering without a verifiable deviation is refused', async () => {
    const { d } = deps(
      audit({
        V: {
          missedFindings: [{ kind: 'desvio', description: 'Inventado.', quote: 'trecho que não existe na redação' }],
          decision: 'reduzir',
          justification: 'Reduzir.',
          finalScore: 120,
        },
      }),
    )
    const run = await runPipeline(dual, env, () => {}, d)
    expect(run.result.competencies.find((c) => c.id === 'V')!.score).toBe(200)
    expect(run.audit?.changes.find((c) => c.competency === 'V')).toMatchObject({ accepted: false, rejection: 'no_verifiable_deviation' })
  })

  test('raising without removing a deviation needs a literal supporting quote', async () => {
    const up = (evidence: string[]) =>
      audit({ I: { meetsUpperLevel: 'sim', decision: 'aumentar', justification: 'Excelente domínio.', evidence, finalScore: 200 } })
    const refused = await runPipeline(dual, env, () => {}, deps(up(['não está na redação'])).d)
    expect(refused.result.competencies[0].score).toBe(160)
    expect(refused.audit?.changes[0].rejection).toBe('no_verifiable_support')
    const accepted = await runPipeline(dual, env, () => {}, deps(up([OTHER])).d)
    expect(accepted.result.competencies[0].score).toBe(200)
  })

  test('inconsistent decisions, off-scale scores and empty justifications are refused', async () => {
    for (const [review, rejection] of [
      [{ decision: 'manter', finalScore: 200, justification: 'x' }, 'inconsistent_decision'],
      [{ decision: 'aumentar', finalScore: 190, justification: 'x' }, 'invalid_score'],
      [{ decision: 'aumentar', finalScore: 200, justification: '', evidence: [OTHER] }, 'empty_justification'],
    ] as const) {
      const run = await runPipeline(dual, env, () => {}, deps(audit({ I: review })).d)
      expect(run.result.competencies[0].score).toBe(160)
      expect(run.audit?.changes[0].rejection).toBe(rejection)
    }
  })

  test('an audit that skips a competency is invalid: first result kept, not audited', async () => {
    const bad = audit()
    bad.competencies.pop()
    const run = await runPipeline(dual, env, () => {}, deps(bad).d)
    expect(run.auditStatus).toBe('failed')
    expect(run.result).toMatchObject({ total: initial.total, execution: { pipeline: 'dual-review', auditStatus: 'failed' } })
  })

  test('incomplete JSON from the auditor is not accepted', async () => {
    const run = await runPipeline(dual, env, () => {}, deps({ competencies: [{ id: 'I' }] }).d)
    expect(run.auditStatus).toBe('failed')
    expect(run.result.total).toBe(initial.total)
  })

  test('auditor provider failure keeps the first result and its billed usage', async () => {
    const seen: CorrectionUsage[] = []
    const { d } = deps(() => {
      throw new AppError('PROVIDER_UNAVAILABLE', 'x')
    })
    const run = await runPipeline(dual, env, (u) => seen.push(u), d)
    expect(run.auditStatus).toBe('failed')
    expect(run.stages[1]).toMatchObject({ stage: 'auditor', status: 'failed', note: 'provider_unavailable' })
    expect(run.usage.estimatedCostUsd).toBeCloseTo(0.003)
    expect(seen.at(-1)!.estimatedCostUsd).toBeCloseTo(0.003)
  })

  test('auditor timeout keeps the first result, flagged as not audited', async () => {
    const { d } = deps(audit(), {
      audit: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')))
          setTimeout(() => reject(new Error('timeout')), 5)
        }),
    })
    const run = await runPipeline(dual, env, () => {}, d)
    expect(run.auditStatus).toBe('failed')
    expect(run.result.execution?.auditStatus).toBe('failed')
  })

  test('no audit is started when the corrector used up the time budget', async () => {
    let clock = 0
    const { d, calls } = deps(audit(), { now: () => (clock += 150_000) })
    const run = await runPipeline(dual, env, () => {}, d)
    expect(calls.audit).toBe(0)
    expect(run.stages[1]).toMatchObject({ status: 'failed', note: 'tempo_insuficiente' })
  })

  test('corrector failure propagates (existing error handling), auditor never runs', async () => {
    const { d, calls } = deps(audit(), {
      correct: async () => {
        throw new AppError('PROVIDER_UNAVAILABLE', 'x')
      },
    })
    await expect(runPipeline(dual, env, () => {}, d)).rejects.toThrow()
    expect(calls.audit).toBe(0)
  })

  test('an annulled essay is not audited and keeps zero scores', async () => {
    const annulled = correctionResultSchema.parse({
      ...initial,
      competencies: initial.competencies.map((c) => ({ ...c, score: 0 })),
      total: 0,
      invalidations: { ...initial.invalidations, textual: { invalid: true, reasons: ['Fuga ao tema.'] } },
    })
    const { d, calls } = deps(audit(), {
      correct: async () => ({ ...correctorRun(), result: annulled }),
    })
    const run = await runPipeline(dual, env, () => {}, d)
    expect(calls.audit).toBe(0)
    expect(run.auditStatus).toBe('skipped')
    expect(run.result.total).toBe(0)
  })

  test('per-stage usage is kept apart and summed, never overwritten', async () => {
    const run = await runPipeline(dual, env, () => {}, deps(audit()).d)
    expect(run.stages[0]).toMatchObject({ stage: 'corrector', estimatedCostUsd: 0.002, cacheReadTokens: 100 })
    expect(run.stages[1]).toMatchObject({ stage: 'auditor', estimatedCostUsd: 0.001 })
    expect(run.usage).toMatchObject({
      model: DUAL_REVIEW_MODEL,
      inputTokens: 2_000,
      outputTokens: 400,
      thoughtTokens: 100,
      cacheReadTokens: 200,
      estimatedCostUsd: 0.003,
    })
    expect(run.attempts).toHaveLength(2)
  })
})

describe('deterministic composition', () => {
  test('evidence and new quotes must be literal; totals are recomputed', () => {
    const { report } = composeAudit(
      { request: dual, initial, diagnostics },
      audit({ IV: { decision: 'aumentar', meetsUpperLevel: 'sim', justification: 'ok', evidence: [OTHER], finalScore: 200 } }),
    )
    expect(report.finalScores.IV).toBe(200)
    expect(report.finalTotal).toBe(initial.total + 40)
  })
})

describe('pricing', () => {
  test('Gemini 3.8 Flash uses its published rates, including cache reads', () => {
    const u = { inputTokens: 1_000_000, outputTokens: 1_000_000, thoughtTokens: 0, cacheReadTokens: 0 }
    expect(modelCost('gemini-3.8-flash', u, {}, new Date('2026-11-05'))).toBe(4.5)
    expect(modelCost('gemini-3.8-flash', u, {}, new Date('2027-01-01'))).toBe(9)
    expect(
      modelCost('gemini-3.8-flash', { ...u, outputTokens: 0, cacheReadTokens: 1_000_000 }, {}, new Date('2026-11-05')),
    ).toBe(0.075)
    expect(modelCost('gemini-3.6-flash', u, {}, new Date('2026-11-05'))).toBe(4.5)
  })

  test('dual review runs on Gemini 3.8 Flash, priced from the official page', () => {
    expect(DUAL_REVIEW_MODEL).toBe('gemini-3.8-flash')
    expect(() => modelCost(DUAL_REVIEW_MODEL, { inputTokens: 1, outputTokens: 1, thoughtTokens: 0 })).not.toThrow()
  })

  test('Gemini 2.5 Pro: prompt-size tiers, cache reads and routing to Flash on 2026-12-01', () => {
    const call = { inputTokens: 100_000, outputTokens: 10_000, thoughtTokens: 10_000, cacheReadTokens: 0 }
    // ≤ 200k prompt: 100k × 1.25 + 20k × 10 = 0.125 + 0.2
    expect(modelCost('gemini-2.5-pro', call, {}, new Date('2026-11-05'))).toBe(0.325)
    // > 200k prompt: 300k × 2.50 + 20k × 15 = 0.75 + 0.3
    expect(modelCost('gemini-2.5-pro', { ...call, inputTokens: 300_000 }, {}, new Date('2026-11-05'))).toBe(1.05)
    // cache reads at 0.125: 50k × 1.25 + 50k × 0.125 + 20k × 10
    expect(modelCost('gemini-2.5-pro', { ...call, cacheReadTokens: 50_000 }, {}, new Date('2026-11-05'))).toBe(0.26875)
    // From 2026-12-01 the call is served and billed as 3.8 Flash: 100k × 0.75 + 20k × 3.75
    expect(modelCost('gemini-2.5-pro', call, {}, new Date('2026-12-01'))).toBe(0.15)
    expect(() => modelCost('gemini-9-unknown', u)).toThrow()
  })
})
