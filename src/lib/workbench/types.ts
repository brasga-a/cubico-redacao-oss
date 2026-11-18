import type {
  CorrectionExecutionInfo,
  CorrectionReference,
} from '@/lib/correction'

export type CompetencyId = 'c1' | 'c2' | 'c3' | 'c4' | 'c5'

export type User = {
  name: string
  email: string
  initials: string
  image?: string | null
}

export type Draft = {
  topic: string
  title: string
  essay: string
  supportingTexts: string[]
  updatedAt: string | null
}

export type AnnotationKind = 'issue' | 'strength' | 'evidence'

export type Annotation = {
  id: string
  competency: CompetencyId
  kind: AnnotationKind
  start: number
  end: number
  label: string
  message: string
  suggestion?: string
}

export type CompetencyResult = {
  id: CompetencyId
  score: number
  level: number
  summary: string
  analysis: string[]
  nextStep: string
}

export type Priority = {
  competency?: CompetencyId
  title: string
  description: string
  example?: string
}

export type ZeroCheck = {
  id: string
  label: string
  description: string
  status: 'ok' | 'warning' | 'fail'
}

export type TextStats = {
  words: number
  characters: number
  paragraphs: number
  sentences: number
}

/** Feedback comment with the competency it came from (set by the structured response). */
export type FeedbackItem = { competency: CompetencyId; text: string }

export type Evaluation = {
  id: string
  createdAt: string
  topic: string
  title: string
  essay: string
  supportingTexts: string[]
  total: number
  competencies: CompetencyResult[]
  annotations: Annotation[]
  strengths: FeedbackItem[]
  weaknesses: FeedbackItem[]
  priorities: Priority[]
  zeroChecks: ZeroCheck[]
  stats: TextStats
  references: CorrectionReference[]
  /** How the result was produced; absent on older evaluations. */
  execution?: CorrectionExecutionInfo
}

// Original server result remains the canonical grading contract.
export type { CorrectionRequest, CorrectionResult } from '@/lib/correction'
