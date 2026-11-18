import '@tanstack/react-start/server-only'

import { correctionResultSchema } from '../lib/correction'
import type {
  AuditStatus,
  CorrectionPipeline,
  CorrectionRequest,
  CorrectionResult,
} from '../lib/correction'
import { modelCost } from '../lib/pricing'
import {
  AUDIT_PROMPT_VERSION,
  auditOutputSchema,
  buildAuditContent,
  buildAuditGuide,
  composeAudit,
} from './audit.server'
import type { AuditInput, AuditReport } from './audit.server'
import { sumUsage } from './correction.server'
import type {
  CorrectEssayOptions,
  CorrectionExecution,
  CorrectionUsage,
} from './correction.server'
import type { Env } from './env.server'
import { AppError } from './errors.server'
import { validateCorrection } from './result-validation'

/** Model behind the "flash" choice of a single evaluation (Gemini API id, pricing checked). */
export const FLASH_MODEL = 'gemini-3.8-flash'
/** 3.8 Flash availability is unstable: an overloaded call falls back to Argon. */
export const FLASH_FALLBACK_MODEL = 'gemini-4-argon'

/**
 * Model of both dual-review stages (Gemini API id, checked on the pricing page).
 * No fallback, so both stages always run on this model.
 */
export const DUAL_REVIEW_MODEL = 'gemini-3.8-flash'

/**
 * Whole-operation budget. It stays below the 3-minute quota reservation (RESERVATION_TTL_MS)
 * so a slow correction can never outlive its reservation. Waiting on fetch does not count
 * towards Workers CPU time; the request lives while the client stays connected.
 */
export const PIPELINE_BUDGET_MS = 165_000
export const CORRECTOR_TIMEOUT_MS = 100_000
/** Below this, an audit would likely be cut short: it is not started. */
export const MIN_AUDIT_MS = 20_000

export type StageName = 'corrector' | 'auditor'
export type StageMetrics = {
  stage: StageName
  model: string
  status: 'succeeded' | 'failed' | 'skipped'
  promptVersion: string
  latencyMs: number
  attempts: number
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  cacheReadTokens: number
  estimatedCostUsd: number
  /** Short, content-free reason when an audit did not complete. */
  note?: string
}

export type PipelineExecution = CorrectionExecution & {
  pipeline: CorrectionPipeline
  auditStatus: AuditStatus
  stages: StageMetrics[]
  audit: AuditReport | null
  /** First evaluation, kept for comparison when an audit ran. */
  initialResult: CorrectionResult | null
}

export type AuditCall = (args: {
  input: AuditInput
  env: Env
  signal: AbortSignal
  timeoutMs: number
  onUsage: (usage: CorrectionUsage) => void
}) => Promise<{ raw: unknown; usage: CorrectionUsage }>

export type PipelineDeps = {
  correct: (
    request: CorrectionRequest,
    env: Env,
    onUsage: (usage: CorrectionUsage) => void,
    options: CorrectEssayOptions,
  ) => Promise<CorrectionExecution>
  audit: AuditCall
  now: () => number
}

/** Second inference: the auditor, on the same model, with its own schema and prompt. */
export const callAuditor: AuditCall = async ({ input, env, signal, timeoutMs, onUsage }) => {
  const apiKey = env.GEMINI_API_KEY
  if (typeof apiKey !== 'string' || !apiKey.trim())
    throw new AppError('PROVIDER_NOT_CONFIGURED', 'O serviço Gemini não está configurado.')
  const { invokeModel } = await import('./inference.server')
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) controller.abort()
  else signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, timeoutMs)
  let usage: CorrectionUsage = {
    model: DUAL_REVIEW_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    estimatedCostUsd: 0,
    usageKnown: false,
  }
  try {
    const max = Number(env.MAX_OUTPUT_TOKENS)
    const response = await invokeModel({
      apiKey,
      model: DUAL_REVIEW_MODEL,
      system: buildAuditGuide(),
      prompt: buildAuditContent(input),
      schema: auditOutputSchema,
      maxOutputTokens: Number.isSafeInteger(max) && max > 0 ? max : 12_000,
      signal: controller.signal,
      onUsage: (u) => {
        usage = { ...u, model: DUAL_REVIEW_MODEL, estimatedCostUsd: modelCost(DUAL_REVIEW_MODEL, u, env) }
        onUsage(usage)
      },
    })
    return { raw: JSON.parse(response.text) as unknown, usage }
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

export const defaultPipelineDeps: PipelineDeps = {
  correct: async (...args) => (await import('./correction.server')).correctEssay(...args),
  audit: callAuditor,
  now: () => Date.now(),
}

function stage(
  name: StageName,
  promptVersion: string,
  usage: CorrectionUsage,
  attempts: number,
  latencyMs: number,
  status: StageMetrics['status'],
  note?: string,
): StageMetrics {
  return {
    stage: name,
    model: usage.model,
    status,
    promptVersion,
    latencyMs,
    attempts,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    thoughtTokens: usage.thoughtTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    estimatedCostUsd: usage.estimatedCostUsd,
    ...(note ? { note } : {}),
  }
}

/**
 * Runs the selected grading architecture and returns a result in the unchanged public
 * contract. `onUsage` always receives the running total of every billable call, so a
 * failure is still accounted for in full.
 */
export async function runPipeline(
  request: CorrectionRequest,
  env: Env,
  onUsage: (usage: CorrectionUsage) => void,
  deps: PipelineDeps = defaultPipelineDeps,
): Promise<PipelineExecution> {
  // Only an explicit request selects the second architecture.
  const pipeline: CorrectionPipeline =
    request.pipeline === 'dual-review' ? 'dual-review' : 'single'
  const started = deps.now()

  if (pipeline === 'single') {
    // Argon: exactly the current evaluation (model, fallback, prompt).
    // Flash: same prompt on 3.8 Flash; when Flash is overloaded, Argon answers instead.
    const modelChoice = request.modelChoice === 'flash' ? 'flash' : 'argon'
    const execution = await deps.correct(
      request,
      env,
      onUsage,
      modelChoice === 'flash'
        ? { variant: 'calibrated', model: FLASH_MODEL, fallbackModel: FLASH_FALLBACK_MODEL }
        : { variant: 'calibrated' },
    )
    const result = correctionResultSchema.parse({
      ...execution.result,
      execution: {
        pipeline,
        auditStatus: 'skipped',
        changedCompetencies: [],
        modelChoice,
        model: execution.usage.model || undefined,
      },
    })
    return {
      ...execution,
      result,
      pipeline,
      auditStatus: 'skipped',
      audit: null,
      initialResult: null,
      stages: [
        stage(
          'corrector',
          execution.diagnostics?.promptVersion ?? '',
          execution.usage,
          execution.attempts?.length ?? 1,
          deps.now() - started,
          'succeeded',
        ),
      ],
    }
  }

  const controller = new AbortController()
  const budget = setTimeout(() => controller.abort(), PIPELINE_BUDGET_MS)
  let correctorUsage: CorrectionUsage | undefined
  let auditorUsage: CorrectionUsage | undefined
  const report = () =>
    onUsage(sumUsage([correctorUsage, auditorUsage].filter((u) => u !== undefined)))

  try {
    // Stage 1: corrector (calibrated prompt, Flash, no silent model switch).
    const initial = await deps.correct(
      request,
      env,
      (u) => {
        correctorUsage = u
        report()
      },
      {
        variant: 'calibrated',
        model: DUAL_REVIEW_MODEL,
        fallbackModel: null,
        signal: controller.signal,
        timeoutMs: CORRECTOR_TIMEOUT_MS,
      },
    )
    correctorUsage = initial.usage
    report()
    const correctorDone = deps.now()
    const corrector = stage(
      'corrector',
      initial.diagnostics?.promptVersion ?? '',
      initial.usage,
      initial.attempts?.length ?? 1,
      correctorDone - started,
      'succeeded',
    )
    const finish = (
      result: CorrectionResult,
      auditStatus: AuditStatus,
      audit: AuditReport | null,
      auditor: StageMetrics,
    ): PipelineExecution => {
      const changed = (audit?.changes ?? [])
        .filter((c) => c.accepted && c.to !== c.from)
        .map((c) => c.competency)
      return {
        result: correctionResultSchema.parse({
          ...result,
          execution: { pipeline, auditStatus, changedCompetencies: changed },
        }),
        usage: { ...sumUsage([initial.usage, ...(auditorUsage ? [auditorUsage] : [])]), model: DUAL_REVIEW_MODEL },
        attempts: [...(initial.attempts ?? [initial.usage]), ...(auditorUsage ? [auditorUsage] : [])],
        diagnostics: initial.diagnostics,
        pipeline,
        auditStatus,
        audit,
        initialResult: initial.result,
        stages: [corrector, auditor],
      }
    }
    const skipped = (note: string, status: StageMetrics['status'] = 'skipped') =>
      stage(
        'auditor',
        AUDIT_PROMPT_VERSION,
        auditorUsage ?? { model: DUAL_REVIEW_MODEL, inputTokens: 0, outputTokens: 0, thoughtTokens: 0, estimatedCostUsd: 0 },
        auditorUsage ? 1 : 0,
        deps.now() - correctorDone,
        status,
        note,
      )

    // An annulled essay keeps its zero scores: there is nothing to audit.
    if (initial.result.invalidations.textual.invalid)
      return finish(initial.result, 'skipped', null, skipped('anulacao_textual'))
    if (!initial.diagnostics?.competencies.length)
      return finish(initial.result, 'failed', null, skipped('sem_rastro_do_corretor', 'failed'))
    const remaining = PIPELINE_BUDGET_MS - (correctorDone - started)
    if (remaining < MIN_AUDIT_MS)
      return finish(initial.result, 'failed', null, skipped('tempo_insuficiente', 'failed'))

    // Stage 2: auditor. Any failure keeps the first result, flagged as not audited.
    const input: AuditInput = {
      request,
      initial: initial.result,
      diagnostics: initial.diagnostics.competencies,
    }
    try {
      const { raw, usage } = await deps.audit({
        input,
        env,
        signal: controller.signal,
        timeoutMs: remaining,
        onUsage: (u) => {
          auditorUsage = u
          report()
        },
      })
      auditorUsage = usage
      report()
      const { content, report: audit } = composeAudit(input, raw)
      const validated = validateCorrection(content, request.essay)
      const result = correctionResultSchema.parse({
        ...validated,
        references: initial.result.references,
      })
      if (result.total !== audit.finalTotal)
        throw new Error('Total recomposto divergente.')
      const auditor = stage('auditor', AUDIT_PROMPT_VERSION, usage, 1, deps.now() - correctorDone, 'succeeded')
      return finish(result, 'completed', audit, auditor)
    } catch (error) {
      const note = controller.signal.aborted
        ? 'tempo_esgotado'
        : error instanceof AppError
          ? error.code.toLowerCase()
          : 'resposta_invalida'
      return finish(initial.result, 'failed', null, skipped(note, 'failed'))
    }
  } finally {
    clearTimeout(budget)
  }
}
