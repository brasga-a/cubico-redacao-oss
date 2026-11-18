/** Synthetic, explicitly labelled test data. No grading function or identity credentials. */
import {
  correctionResultSchema,
  correctionRequestSchema,
  ensureEvidenceQuotesAreExact,
} from '../src/lib/correction'
import type {
  CorrectionResult,
  CorrectionRequest,
  AppStatus,
  ServerResult,
} from '../src/lib/correction'
import type { Draft, Annotation } from '@/lib/workbench/types'
import { evaluationView } from '@/lib/workbench/view-model'

export const emptyDraft: Draft = {
  topic: '',
  title: '',
  essay: '',
  supportingTexts: [],
  updatedAt: null,
}
export const sampleDraft: Draft = {
  topic: 'Desafios para a valorização da herança africana no Brasil',
  title: '',
  supportingTexts: [],
  updatedAt: '2026-11-05T12:00:00.000Z',
  essay:
    'A herança africana integra a formação da sociedade brasileira. Entretanto, o preconceito limita o reconhecimento dessa contribuição. É necessário discutir a educação e a valorização da cultura.\n\nEm primeiro lugar, a escola pode ampliar o conhecimento sobre essa herança. O estudo de diferentes manifestações culturais contribui para compreender a diversidade da sociedade brasileira. A formação de professores é uma condição para aprofundar esse debate.\n\nAlém disso, o acesso à informação favorece a valorização cultural. A divulgação de produções de artistas negros pode ampliar o debate público. É necessário relacionar essas ações aos obstáculos apresentados, explicando como podem enfrentá-los.\n\nPortanto, o Ministério da Educação deve promover cursos de formação, por meio de parcerias com universidades, a fim de ampliar o ensino da história afro-brasileira. As escolas devem integrar esse trabalho ao currículo, com acompanhamento das atividades ao longo do ano.',
}
export const request = {
  requestId: '00000000-0000-4000-8000-000000000001',
  theme: sampleDraft.topic,
  essay: sampleDraft.essay,
  pipeline: 'single',
  modelChoice: 'argon',
} satisfies CorrectionRequest
export const result = {
  competencies: [
    {
      id: 'I',
      score: 160,
      rationale:
        'Fixture de apresentação: registro formal e períodos completos.',
      evidence: [
        'A herança africana integra a formação da sociedade brasileira.',
      ],
      strengths: ['Uso de registro formal.'],
      problems: [],
      suggestions: ['Revise a construção dos períodos.'],
    },
    {
      id: 'II',
      score: 160,
      rationale: 'Fixture de apresentação: o texto aborda o tema proposto.',
      evidence: ['a valorização da cultura'],
      strengths: ['Abordagem da proposta.'],
      problems: [
        { description: 'Aprofunde o repertório sociocultural.', quote: null },
      ],
      suggestions: ['Relacione uma referência ao argumento.'],
    },
    {
      id: 'III',
      score: 160,
      rationale:
        'Fixture de apresentação: os argumentos têm organização e podem ser aprofundados.',
      evidence: [],
      strengths: ['Organização dos argumentos.'],
      problems: [
        {
          description:
            'Explique como o acesso à informação enfrenta os obstáculos discutidos.',
          quote: 'o acesso à informação favorece a valorização cultural',
        },
      ],
      suggestions: ['Desenvolva as relações de causa e consequência.'],
    },
    {
      id: 'IV',
      score: 160,
      rationale: 'Fixture de apresentação: há conectivos entre parágrafos.',
      evidence: ['Em primeiro lugar', 'Além disso', 'Portanto'],
      strengths: ['Conectivos articulam a sequência.'],
      problems: [],
      suggestions: ['Revise as retomadas ao longo do texto.'],
    },
    {
      id: 'V',
      score: 200,
      rationale:
        'Fixture de apresentação: há agente, ação, meio e finalidade na proposta.',
      evidence: ['o Ministério da Educação deve promover cursos de formação'],
      strengths: ['Proposta com ação identificável.'],
      problems: [],
      suggestions: ['Mantenha a relação entre proposta e discussão.'],
    },
  ],
  total: 840,
  priorities: [
    'Aprofunde as relações entre argumentos e exemplos.',
    'Relacione o repertório ao tema discutido.',
    'Revise as retomadas entre os períodos.',
  ],
  invalidations: {
    textual: {
      invalid: false,
      reasons: ['Nenhuma condição textual sinalizada neste cenário de teste.'],
    },
    handwritten: {
      assessable: false,
      invalid: null,
      reasons: [
        'Características manuscritas não são avaliáveis em texto digitado.',
      ],
    },
  },
  references: [
    {
      id: 'enem-2025-cartilha-2026-amostra-01-chunk-01',
      title:
        'Comentário Oficial INEP — Amostra 1 (Ana Luiza Martins dos Santos Figueiroa) — Estrutura global, tese e abordagem temática',
      citation: 'Cartilha do Participante ENEM 2026, p. 42-44 (PDF 44-46)',
      excerpt:
        'A redação apresenta um projeto de texto bem definido, um repertório produtivo, uma argumentação consistente e uma proposta de intervenção original e completa. Trata-se de um texto que demonstra domínio do tema e boa articulação entre forma e conteúdo, além de domínio da estrutura dissertativo-argumentativa exigida no Enem, com desenvolvimento consistente do tema proposto e articulação clara de ideias. A tese central discute a ideia de que o envelhecimento da população brasileira ainda é tratado de forma negativa, especialmente em razão da valorização excessiva da produtividade econômica e da insuficiência de políticas públicas voltadas às pessoas idosas.',
    },
  ],
} satisfies CorrectionResult
correctionRequestSchema.parse(request)
correctionResultSchema.parse(result)
if (!ensureEvidenceQuotesAreExact(result, request.essay))
  throw new Error('Invalid fixture evidence')
export const status = {
  user: { name: 'Pessoa de teste', email: 'fixture@example.invalid' },
  authConfigured: true,
  configured: true,
  model: 'gemini-4-argon',
} satisfies AppStatus
export const response = {
  ok: true,
  data: result,
} satisfies ServerResult<CorrectionResult>
const quote = result.competencies[2].problems[0].quote!
export const annotations: Annotation[] = [
  {
    id: 'problem-iii-1',
    competency: 'c3',
    kind: 'issue',
    start: request.essay.indexOf(quote),
    end: request.essay.indexOf(quote) + quote.length,
    label: 'Desenvolvimento argumentativo',
    message: result.competencies[2].problems[0].description,
  },
  {
    id: 'evidence-iv-1',
    competency: 'c4',
    kind: 'evidence',
    start: request.essay.indexOf('Em primeiro lugar'),
    end:
      request.essay.indexOf('Em primeiro lugar') + 'Em primeiro lugar'.length,
    label: 'Evidência de coesão',
    message:
      'Trecho citado na avaliação; não classificado automaticamente como elogio.',
  },
]
export const evaluation = evaluationView(
  'fixture-evaluation-1',
  '2026-11-05T12:00:00.000Z',
  sampleDraft,
  result,
  annotations,
)
export const history = [
  evaluation,
  {
    ...evaluation,
    id: 'fixture-evaluation-2',
    createdAt: '2026-11-04T12:00:00.000Z',
  },
]
export const scenarios = [
  'login',
  'login-loading',
  'login-error',
  'editor-empty',
  'editor-filled',
  'processing',
  'error-network',
  'error-service',
  'evaluation',
  'evaluation-zero',
  'text',
  'text-empty',
  'history-empty',
  'history',
  'saving',
  'save-error',
  'security-error',
] as const
export type Scenario = (typeof scenarios)[number]

export const zeroResult: CorrectionResult = {
  ...result,
  total: 0,
  competencies: result.competencies.map((c) => ({
    ...c,
    score: 0,
    evidence: [],
    strengths: [],
    problems: [],
  })),
  invalidations: {
    ...result.invalidations,
    textual: {
      invalid: true,
      reasons: [
        'Cenário de anulação textual para teste; não é avaliação gerada pelo modelo.',
      ],
    },
  },
}
correctionResultSchema.parse(zeroResult)
export const zeroEvaluation = evaluationView(
  'fixture-zero',
  '2026-11-05T12:00:00.000Z',
  sampleDraft,
  zeroResult,
)
export function evaluationForScenario(scenario: Scenario) {
  return scenario === 'evaluation-zero'
    ? zeroEvaluation
    : scenario === 'text-empty'
      ? { ...evaluation, annotations: [] }
      : evaluation
}
