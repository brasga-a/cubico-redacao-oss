import '@tanstack/react-start/server-only'

import { z } from 'zod'
import canonicalData from '../../data/knowledge/rubric/canonical-2026.json'
import { COMPETENCE_IDS, COMPETENCE_SCORES } from '../lib/correction'

/**
 * Canonical ENEM rubric (2026 baseline) extracted from the official cartilha.
 *
 * This module is deliberately independent from retrieval: levels, score ceilings and
 * annulment rules are read from structured data, never from similarity search.
 * Wording that changes between editions is kept in `variants.json`, not here.
 */

const sourceSchema = z.object({
  docId: z.string(),
  year: z.number(),
  file: z.string(),
  pdfPages: z.tuple([z.number(), z.number()]).nullable(),
  printedPages: z.tuple([z.string(), z.string()]).nullable(),
})

const triggerSchema = z.enum([
  'tangenciamento_ao_tema',
  'fuga_ao_tema_ou_tipo_textual',
  'predominancia_outro_tipo_textual',
  'desrespeito_direitos_humanos',
])

const structuredSchema = z.object({
  effect: z.enum(['cap', 'total_zero', 'competency_zero']),
  maxScore: z.number(),
  appliesTo: z.array(z.enum(COMPETENCE_IDS)),
  trigger: triggerSchema,
})

const rubricSchema = z.object({
  schemaVersion: z.literal(1),
  canonicalYear: z.number(),
  origin: z.literal('inep_verbatim'),
  reviewStatus: z.string(),
  scale: z.object({ competencyScores: z.array(z.number()) }),
  competencies: z
    .array(
      z.object({
        id: z.enum(COMPETENCE_IDS),
        heading: z.string(),
        officialTitle: z.string().nullable(),
        levels: z.array(
          z.object({
            score: z.number(),
            descriptor: z.string().min(1),
            quality: z.enum(['ok', 'unreadable']),
            source: sourceSchema,
          }),
        ),
        notes: z.array(
          z.object({
            text: z.string(),
            source: sourceSchema,
            structured: structuredSchema.nullable(),
          }),
        ),
      }),
    )
    .length(5),
  rules: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['annulment', 'discrepancy', 'score_effect']),
      text: z.string(),
      source: sourceSchema,
      structured: structuredSchema.optional(),
    }),
  ),
})

export type CanonicalRubric = z.infer<typeof rubricSchema>
export type RubricTrigger = z.infer<typeof triggerSchema>
export type CompetencyId = (typeof COMPETENCE_IDS)[number]

let parsed: CanonicalRubric | undefined

export function getCanonicalRubric(): CanonicalRubric {
  if (!parsed) {
    const rubric = rubricSchema.parse(canonicalData)
    for (const comp of rubric.competencies) {
      const scores = comp.levels.map((l) => l.score)
      const expected = [...COMPETENCE_SCORES].sort((a, b) => b - a)
      if (
        scores.length !== expected.length ||
        scores.some((s, i) => s !== expected[i])
      ) {
        throw new Error(
          `Rubrica canônica inválida: níveis da competência ${comp.id} = ${scores.join(',')}`,
        )
      }
      if (comp.levels.some((l) => l.quality !== 'ok')) {
        throw new Error(
          `Rubrica canônica inválida: descritor ilegível na competência ${comp.id}`,
        )
      }
    }
    parsed = rubric
  }
  return parsed
}

export function getLevelDescriptor(
  competency: CompetencyId,
  score: number,
): string | undefined {
  return getCanonicalRubric()
    .competencies.find((c) => c.id === competency)
    ?.levels.find((l) => l.score === score)?.descriptor
}

export type ScoreCeilingResult = {
  scores: Record<CompetencyId, number>
  applied: {
    ruleId: string
    trigger: RubricTrigger
    competencies: CompetencyId[]
    maxScore: number
  }[]
}

/**
 * Applies the explicit score effects of the official rubric to competency scores.
 *
 * Detecting a trigger (e.g. that the essay only touches the broader subject) is a
 * linguistic judgment made by the model; what follows from it is not. This function is
 * pure and never raises a score.
 */
export function applyScoreCeilings(
  scores: Record<CompetencyId, number>,
  triggers: readonly RubricTrigger[],
): ScoreCeilingResult {
  const result = { ...scores }
  const applied: ScoreCeilingResult['applied'] = []
  for (const rule of getCanonicalRubric().rules) {
    const s = rule.structured
    if (!s || !triggers.includes(s.trigger)) continue
    const changed: CompetencyId[] = []
    for (const id of s.appliesTo) {
      if (result[id] > s.maxScore) {
        result[id] = s.maxScore
        changed.push(id)
      }
    }
    applied.push({
      ruleId: rule.id,
      trigger: s.trigger,
      competencies: changed,
      maxScore: s.maxScore,
    })
  }
  return { scores: result, applied }
}
