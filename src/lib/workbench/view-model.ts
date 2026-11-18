import type { CorrectionResult } from '@/lib/correction'
import type { EvaluationSummary } from '@/lib/evaluation-history'
import { COMPETENCIES } from './competencies'
import { getTextStats } from './text'
import type { Annotation, CompetencyId, Draft, Evaluation } from './types'

export const competenceIds = {
  I: 'c1',
  II: 'c2',
  III: 'c3',
  IV: 'c4',
  V: 'c5',
} as const
/** Presentation adapter only; realAnnotations supplies verified quote locations separately. */
export function evaluationView(
  id: string,
  createdAt: string,
  draft: Draft,
  result: CorrectionResult,
  annotations: Annotation[] = [],
): Evaluation {
  return {
    id,
    createdAt,
    topic: draft.topic,
    title: draft.title,
    essay: draft.essay,
    supportingTexts: [...draft.supportingTexts],
    total: result.total,
    competencies: result.competencies
      .map((c) => {
        const cid = competenceIds[c.id]
        return {
          id: cid,
          score: c.score,
          level: c.score / 40,
          summary: COMPETENCIES.find((d) => d.id === cid)!.levels[c.score / 40],
          analysis: [c.rationale, ...c.problems.map((p) => p.description)],
          nextStep: c.suggestions.join(' '),
        }
      })
      .sort((a, b) => a.id.localeCompare(b.id)),
    annotations,
    strengths: result.competencies.flatMap((c) =>
      c.strengths.map((text) => ({ competency: competenceIds[c.id], text })),
    ),
    weaknesses: result.competencies.flatMap((c) =>
      c.problems.map((p) => ({
        competency: competenceIds[c.id],
        text: p.description,
      })),
    ),
    priorities: result.priorities.map((description, index) => ({
      title: `Prioridade ${index + 1}`,
      description,
    })),
    zeroChecks: [
      {
        id: 'textual',
        label: 'Critérios textuais',
        description:
          result.invalidations.textual.reasons.join(' ') ||
          'Nenhuma condição textual sinalizada.',
        status: result.invalidations.textual.invalid ? 'fail' : 'ok',
      },
      {
        id: 'handwritten',
        label: 'Critérios manuscritos não avaliáveis',
        description: result.invalidations.handwritten.reasons.join(' '),
        status: 'warning',
      },
    ],
    stats: getTextStats(draft.essay),
    references: result.references,
    execution: result.execution,
  }
}
/**
 * List-only adapter for cloud history rows: metadata carries scores, theme, title, date
 * and word count but no essay or feedback. Full views come from `evaluationView` once the
 * payload is opened.
 */
export function summaryView(summary: EvaluationSummary): Evaluation {
  const ids = ['c1', 'c2', 'c3', 'c4', 'c5'] as const
  return {
    id: summary.id,
    createdAt: summary.createdAt,
    topic: summary.theme,
    title: summary.title,
    essay: '',
    supportingTexts: [],
    total: summary.totalScore,
    competencies: ids.map((id) => {
      const score = summary.scores[id]
      return {
        id,
        score,
        level: score / 40,
        summary:
          COMPETENCIES.find((d) => d.id === id)?.levels[score / 40] ?? '',
        analysis: [],
        nextStep: '',
      }
    }),
    annotations: [],
    strengths: [],
    weaknesses: [],
    priorities: [],
    zeroChecks: [],
    stats: {
      words: summary.wordCount,
      characters: 0,
      paragraphs: 0,
      sentences: 0,
    },
    references: [],
  }
}
export type TextSegment = { start: number; end: number; ids: string[] }
/** Preserve every UTF-16 code unit once, including overlaps and cross-paragraph annotations. */
export function annotationSegments(
  text: string,
  annotations: Annotation[],
): TextSegment[] {
  const valid = annotations.filter(
    (a) =>
      Number.isInteger(a.start) &&
      Number.isInteger(a.end) &&
      a.start >= 0 &&
      a.end > a.start &&
      a.end <= text.length,
  )
  const bounds = [
    ...new Set([0, text.length, ...valid.flatMap((a) => [a.start, a.end])]),
  ].sort((a, b) => a - b)
  return bounds.slice(0, -1).map((start, i) => ({
    start,
    end: bounds[i + 1],
    ids: valid
      .filter((a) => a.start <= start && a.end >= bounds[i + 1])
      .map((a) => a.id),
  }))
}
export function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.topic === b.topic &&
    a.title === b.title &&
    a.essay === b.essay &&
    JSON.stringify(a.supportingTexts) === JSON.stringify(b.supportingTexts)
  )
}
export type { CompetencyId }
