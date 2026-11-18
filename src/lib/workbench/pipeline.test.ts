import { describe, expect, test } from 'bun:test'
import { result, sampleDraft } from '../../../visual/fixtures'
import { correctionRequestSchema, correctionResultSchema } from '../correction'
import {
  DEFAULT_MODEL_CHOICE,
  MODEL_ITEMS,
  MODEL_OPTIONS,
  executionLabel,
  findMatchingRecord,
  modelChoiceOf,
  parseModelChoice,
} from './pipeline'
import { sameDraft } from './view-model'

const base = {
  requestId: '00000000-0000-4000-8000-000000000009',
  theme: 'Tema',
  essay: 'Texto',
}

describe('model selection', () => {
  test('two options, Argon first and default, with honest copy', () => {
    expect(MODEL_ITEMS.map((i) => i.value)).toEqual(['argon', 'flash'])
    expect(DEFAULT_MODEL_CHOICE).toBe('argon')
    expect(MODEL_OPTIONS.argon.detail).toContain('não garante uma nota mais precisa')
    expect(MODEL_OPTIONS.flash.detail).toContain('Mais barato')
    expect(MODEL_OPTIONS.flash.detail).toContain('o Argon corrige no lugar')
  })

  test('each choice reaches the request as a validated id; the default is Argon', () => {
    for (const modelChoice of ['argon', 'flash'] as const)
      expect(correctionRequestSchema.parse({ ...base, modelChoice }).modelChoice).toBe(modelChoice)
    expect(correctionRequestSchema.parse(base)).toMatchObject({ pipeline: 'single', modelChoice: 'argon' })
  })

  test('the client cannot pick model names, prompts or arbitrary values', () => {
    expect(correctionRequestSchema.safeParse({ ...base, modelChoice: 'gemini-4-argon' }).success).toBe(false)
    const extra = correctionRequestSchema.parse({ ...base, model: 'x', prompt: 'y', temperature: 2 })
    expect(extra).not.toHaveProperty('model')
    expect(extra).not.toHaveProperty('prompt')
    expect(extra).not.toHaveProperty('temperature')
  })

  test('stored choices are parsed defensively', () => {
    expect(parseModelChoice('flash')).toBe('flash')
    expect(parseModelChoice(null)).toBe('argon')
    expect(parseModelChoice('dual-review')).toBe('argon')
  })
})

describe('already-corrected detection per model', () => {
  const execution = (modelChoice: 'argon' | 'flash') => ({
    pipeline: 'single',
    auditStatus: 'skipped',
    changedCompetencies: [],
    modelChoice,
  })
  const old = { input: sampleDraft, result: correctionResultSchema.parse(result) }
  const flash = { input: sampleDraft, result: correctionResultSchema.parse({ ...result, execution: execution('flash') }) }
  const dual = {
    input: sampleDraft,
    result: correctionResultSchema.parse({
      ...result,
      execution: { pipeline: 'dual-review', auditStatus: 'completed', changedCompetencies: [] },
    }),
  }

  test('older results without execution info count as Argon', () => {
    expect(modelChoiceOf(old.result)).toBe('argon')
  })

  test('the same draft is "already corrected" only for the selected model', () => {
    expect(findMatchingRecord([old], sampleDraft, 'argon', sameDraft)).toBe(old)
    expect(findMatchingRecord([old], sampleDraft, 'flash', sameDraft)).toBeUndefined()
    expect(findMatchingRecord([old, flash], sampleDraft, 'flash', sameDraft)).toBe(flash)
    // Dual-review results never count as a single evaluation by either model.
    expect(findMatchingRecord([dual], sampleDraft, 'argon', sameDraft)).toBeUndefined()
  })
})

describe('execution label', () => {
  test('names the model, and says so when the other model had to answer', () => {
    expect(executionLabel(undefined)).toBeNull()
    expect(executionLabel({ pipeline: 'single', auditStatus: 'skipped', changedCompetencies: [], modelChoice: 'flash', model: 'gemini-3.8-flash' })).toBe('Corrigida pelo Gemini 3.8 Flash')
    expect(executionLabel({ pipeline: 'single', auditStatus: 'skipped', changedCompetencies: [], modelChoice: 'flash', model: 'gemini-4-argon' })).toBe('Gemini 3.8 Flash indisponível · corrigida pelo Gemini 4 Argon')
    expect(executionLabel({ pipeline: 'single', auditStatus: 'skipped', changedCompetencies: [] })).toBeNull()
  })

  test('never presents an unfinished audit as a completed dual review', () => {
    expect(executionLabel({ pipeline: 'dual-review', auditStatus: 'failed', changedCompetencies: [] })).toContain('não concluída')
  })
})
