import {
  CORRECTION_MODEL_CHOICES,
  correctionModelChoiceSchema,
} from '@/lib/correction'
import type {
  CorrectionExecutionInfo,
  CorrectionModelChoice,
  CorrectionPipeline,
  CorrectionResult,
} from '@/lib/correction'
import type { Draft } from './types'

export const DEFAULT_MODEL_CHOICE: CorrectionModelChoice = 'argon'

/** Display copy only; the server maps each id to its Gemini model and fallback. */
export const MODEL_OPTIONS: Record<
  CorrectionModelChoice,
  { label: string; short: string; detail: string; model: string }
> = {
  argon: {
    label: 'Gemini 4 Argon',
    short: 'Argon',
    detail: 'Padrão · mais caro, mas não garante uma nota mais precisa',
    model: 'gemini-4-argon',
  },
  flash: {
    label: 'Gemini 3.8 Flash',
    short: '3.8 Flash',
    detail: 'Mais barato · se estiver indisponível, o Argon corrige no lugar',
    model: 'gemini-3.8-flash',
  },
}

export const MODEL_ITEMS = CORRECTION_MODEL_CHOICES.map((value) => ({
  value,
  label: MODEL_OPTIONS[value].short,
}))

/** Anything that is not a known id (old storage, tampering) falls back to the default. */
export function parseModelChoice(value: unknown): CorrectionModelChoice {
  const parsed = correctionModelChoiceSchema.safeParse(value)
  return parsed.success ? parsed.data : DEFAULT_MODEL_CHOICE
}

/** Evaluations stored before pipelines existed were standard single evaluations. */
export function pipelineOf(result: CorrectionResult): CorrectionPipeline {
  return result.execution?.pipeline ?? 'single'
}

/** Results stored before the model choice existed were graded with Argon. */
export function modelChoiceOf(result: CorrectionResult): CorrectionModelChoice {
  return result.execution?.modelChoice ?? DEFAULT_MODEL_CHOICE
}

/**
 * "Already corrected" detection: the same draft only counts as already evaluated by a
 * single evaluation with the model now selected, so the other model can still be tried.
 */
export function findMatchingRecord<
  T extends { input: Draft; result: CorrectionResult },
>(
  records: T[],
  draft: Draft,
  modelChoice: CorrectionModelChoice,
  same: (a: Draft, b: Draft) => boolean,
): T | undefined {
  return records.find(
    (record) =>
      pipelineOf(record.result) === 'single' &&
      modelChoiceOf(record.result) === modelChoice &&
      same(record.input, draft),
  )
}

const MODEL_NAMES: Record<string, string> = {
  'gemini-4-argon': 'Gemini 4 Argon',
  'gemini-3.8-flash': 'Gemini 3.8 Flash',
  'gemini-3.6-flash': 'Gemini 3.6 Flash',
}

/** Short, honest description of how a result was produced (never claims an unfinished audit). */
export function executionLabel(
  execution: CorrectionExecutionInfo | undefined,
): string | null {
  if (!execution) return null
  if (execution.pipeline === 'dual-review') {
    if (execution.auditStatus === 'completed') {
      const n = execution.changedCompetencies.length
      return n === 0
        ? 'Dupla revisão · auditoria manteve as notas'
        : `Dupla revisão · auditoria ajustou ${n} ${n === 1 ? 'competência' : 'competências'}`
    }
    return 'Dupla revisão · auditoria não concluída (resultado do primeiro corretor)'
  }
  if (!execution.modelChoice) return null
  const chosen = MODEL_OPTIONS[execution.modelChoice]
  const used = execution.model
  if (used && used !== chosen.model)
    return `${chosen.label} indisponível · corrigida pelo ${MODEL_NAMES[used] ?? used}`
  return `Corrigida pelo ${chosen.label}`
}
