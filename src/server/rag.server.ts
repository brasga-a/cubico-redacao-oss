import '@tanstack/react-start/server-only'

import type { CorrectionReference } from '../lib/correction'
import {
  normalizeSearchText,
  searchKnowledge,
  tokenize as tokenizeText,
} from './knowledge.server'
import type {
  CompetencyId,
  KnowledgeCategory,
  KnowledgeHit,
} from './knowledge.server'

export { normalizeSearchText }
export type { CompetencyId }

export type RetrievedPedagogicalExample = CorrectionReference & {
  essayId: string
  aspect: string
  relatedCompetencies: CompetencyId[]
  diagnosticTags: string[]
  essayExcerpt: string
  relevanceScore: number
  /** Provenance of the official text (never model-generated). */
  category: KnowledgeCategory
  year: number
  pdfPages: [number, number]
  printedPages: [string, string] | null
  /** Documented score of the sample essay; null when the cartilha does not state it. */
  scoreDocumented: number | null
}

export type EssayDiagnosticProfile = {
  priorityCompetencies: CompetencyId[]
  competencyWeights: Record<CompetencyId, number>
  detectedTags: string[]
  signals: string[]
}

const INTERPARAGRAPH_CONNECTIVES = [
  'ademais',
  'outrossim',
  'alem disso',
  'sob esse vies',
  'sob essa optica',
  'sob essa otica',
  'sob esse prisma',
  'nesse sentido',
  'nesse contexto',
  'nesse cenario',
  'nessa conjuntura',
  'por outro lado',
  'em contraponto',
  'em primeira analise',
  'em primeiro lugar',
  'em segunda analise',
  'em segundo lugar',
  'portanto',
  'dessa forma',
  'desse modo',
  'diante desse cenario',
  'diante disso',
  'por conseguinte',
  'logo',
]

const INTRAPARAGRAPH_CONNECTIVES = [
  'entretanto',
  'contudo',
  'todavia',
  'no entanto',
  'porem',
  'visto que',
  'ja que',
  'uma vez que',
  'haja vista',
  'pois',
  'portanto',
  'assim',
  'logo',
  'dessa maneira',
  'desse modo',
  'consequentemente',
  'por isso',
  'por conseguinte',
  'alem disso',
  'ademais',
]

const AGENT_MARKERS = [
  'ministerio',
  'governo',
  'poder executivo',
  'poder legislativo',
  'poder judiciario',
  'estado',
  'prefeitura',
  'secretaria',
  'escola',
  'escolas',
  'universidade',
  'familia',
  'familias',
  'midia',
  'imprensa',
  'emissoras',
  'ong',
  'ongs',
  'sociedade civil',
  'congresso',
  'senado',
]

const ACTION_MARKERS = [
  'deve',
  'devem',
  'cabe a',
  'cabe ao',
  'cabe as',
  'precisa',
  'precisam',
  'urge',
  'implementar',
  'criar',
  'promover',
  'desenvolver',
  'ampliar',
  'fomentar',
  'garantir',
  'elaborar',
  'realizar',
  'instituir',
  'estabelecer',
]

const MEANS_MARKERS = [
  'por meio de',
  'por meio da',
  'por meio do',
  'mediante',
  'por intermedio',
  'via ',
  'atraves de',
  'atraves da',
  'atraves do',
  'com a criacao',
  'com a implementacao',
]

const EFFECT_MARKERS = [
  'a fim de',
  'com o intuito de',
  'com o objetivo de',
  'com a finalidade de',
  'para que',
  'visando',
  'objetivando',
]

const REPERTORY_MARKERS = [
  'constituicao',
  'estatuto',
  'lei ',
  'segundo ',
  'conforme ',
  'de acordo com',
  'filosofo',
  'sociologo',
  'escritor',
  'autor',
  'obra ',
  'livro ',
  'filme ',
  'serie ',
  'documentario',
  'cancao',
  'musica',
  'ibge',
  'oms',
  'onu',
  'censo',
  'pesquisa',
  ' século ',
  'seculo ',
  'revolucao',
]

const POCKET_REPERTORY_MARKERS = [
  'platao',
  'a republica',
  'aristoteles',
  'animal politico',
  'thomas hobbes',
  'lobo do homem',
  'zygmunt bauman',
  'modernidade liquida',
  'thomas more',
  'utopia',
]

function countMarkerMatches(normalizedText: string, markers: string[]): number {
  let count = 0
  for (const marker of markers) {
    if (normalizedText.includes(marker)) count += 1
  }
  return count
}

/**
 * Performs fast, deterministic pedagogical diagnostics on a student's essay
 * to identify which ENEM competencies and specific writing challenges need
 * exemplar feedback from the INEP Cartilha.
 */
export function analyzeEssayDiagnostics(essay: string): EssayDiagnosticProfile {
  const weights: Record<CompetencyId, number> = {
    I: 1.0,
    II: 1.0,
    III: 1.0,
    IV: 1.0,
    V: 1.0,
  }
  const tags = new Set<string>()
  const signals: string[] = []

  const trimmed = essay.trim()
  if (!trimmed) {
    return {
      priorityCompetencies: ['II', 'III', 'V'],
      competencyWeights: weights,
      detectedTags: [],
      signals,
    }
  }

  const paragraphs = trimmed
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const normEssay = normalizeSearchText(trimmed)
  const sentences = trimmed
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  // 1. Check paragraph structure (C.II / C.III / C.IV)
  if (paragraphs.length < 3) {
    weights.IV += 2.2
    weights.II += 1.5
    weights.III += 1.5
    tags.add('coesao_textual')
    tags.add('estrutura_dissertativa')
    TagsAdd(tags, ['projeto_de_texto', 'tipologia_dissertativa'])
    signals.push('poucos_paragrafos_ou_monobloco')
  }

  // 2. Check sentence length, punctuation, and syntactic structure (C.I & C.IV)
  const wordCountsPerSentence = sentences.map(
    (s) => s.split(/\s+/).filter(Boolean).length,
  )
  const maxSentenceWords =
    wordCountsPerSentence.length > 0 ? Math.max(...wordCountsPerSentence) : 0
  const veryShortSentences = wordCountsPerSentence.filter(
    (w) => w > 0 && w <= 5,
  ).length

  if (maxSentenceWords >= 35) {
    weights.I += 2.5
    weights.IV += 2.0
    tags.add('periodos_longos')
    tags.add('estrutura_sintatica')
    tags.add('repeticao_conectivos_ou_periodos_longos')
    signals.push('periodos_excessivamente_longos')
  }
  if (veryShortSentences >= 2) {
    weights.I += 2.0
    tags.add('estrutura_sintatica')
    tags.add('pontuacao')
    signals.push('possivel_truncamento_sintatico')
  }

  // Check informal register or common agreement/regency pitfalls (C.I)
  if (
    /\b(a gente|pra |pro |tipo assim|né|tá|daí|onde que|haveram|haviam muitos|implica em|ocasiona em|acarreta em)\b/i.test(
      trimmed,
    )
  ) {
    weights.I += 2.8
    tags.add('norma_padrao')
    tags.add('desvios_gramaticais')
    tags.add('regencia_concordancia')
    tags.add('vocabulario')
    signals.push('desvios_registro_ou_regencia')
  }

  // 3. Check cohesion & connective diversity (C.IV)
  const interConnectives = countMarkerMatches(
    normEssay,
    INTERPARAGRAPH_CONNECTIVES,
  )
  const intraConnectives = countMarkerMatches(
    normEssay,
    INTRAPARAGRAPH_CONNECTIVES,
  )

  // Check repetition of words or connectives
  const tokens = tokenizeText(trimmed)
  const tokenCounts = new Map<string, number>()
  for (const tok of tokens) {
    tokenCounts.set(tok, (tokenCounts.get(tok) ?? 0) + 1)
  }
  const repeatedContentWords = [...tokenCounts.entries()].filter(
    ([, count]) => count >= 6,
  )

  if (
    interConnectives < Math.max(1, paragraphs.length - 2) ||
    intraConnectives < 3
  ) {
    weights.IV += 3.0
    tags.add('coesao_textual')
    tags.add('operadores_argumentativos')
    tags.add('fluidez_e_encadeamento')
    signals.push('baixa_densidade_de_conectivos')
  }
  if (
    repeatedContentWords.length >= 2 ||
    /\bdessa forma\b[\s\S]*\bdessa forma\b/i.test(trimmed)
  ) {
    weights.IV += 2.4
    tags.add('referenciacao')
    tags.add('repeticao_conectivos_ou_periodos_longos')
    tags.add('coesao_textual')
    signals.push('repeticao_lexical_ou_de_conectivos')
  }

  // 4. Check sociocultural repertory & pocket repertory (C.II)
  const repertoryHits = countMarkerMatches(normEssay, REPERTORY_MARKERS)
  const pocketHits = countMarkerMatches(normEssay, POCKET_REPERTORY_MARKERS)
  if (repertoryHits === 0) {
    weights.II += 3.2
    tags.add('repertorio_sociocultural')
    tags.add('uso_produtivo_repertorio')
    tags.add('compreensao_do_tema')
    signals.push('ausencia_de_repertorio_explicito')
  } else if (pocketHits > 0) {
    weights.II += 2.6
    tags.add('repertorio_sociocultural')
    tags.add('uso_produtivo_repertorio')
    signals.push('possivel_repertorio_de_bolso')
  }

  // 5. Check argumentative depth (C.III)
  const avgParagraphWords =
    paragraphs.reduce(
      (acc, p) => acc + p.split(/\s+/).filter(Boolean).length,
      0,
    ) / Math.max(1, paragraphs.length)
  if (avgParagraphWords < 45 || paragraphs.length <= 3) {
    weights.III += 2.8
    tags.add('desenvolvimento_argumentativo')
    tags.add('argumentacao_descritiva_vs_analitica')
    tags.add('projeto_de_texto')
    signals.push('desenvolvimento_argumentativo_curto_ou_descritivo')
  }

  // 6. Check intervention proposal elements in the last paragraph (C.V)
  const lastParagraph = normalizeSearchText(paragraphs.at(-1) ?? trimmed)
  const hasAgent = countMarkerMatches(lastParagraph, AGENT_MARKERS) > 0
  const hasAction = countMarkerMatches(lastParagraph, ACTION_MARKERS) > 0
  const hasMeans = countMarkerMatches(lastParagraph, MEANS_MARKERS) > 0
  const hasEffect = countMarkerMatches(lastParagraph, EFFECT_MARKERS) > 0
  const hasDetailing =
    /(--|—|\(|como exemplo|a exemplo|isto e|ou seja|especificamente|responsavel por)/.test(
      paragraphs.at(-1) ?? '',
    )

  const c5ElementsCount = [
    hasAgent,
    hasAction,
    hasMeans,
    hasEffect,
    hasDetailing,
  ].filter(Boolean).length
  if (c5ElementsCount < 4) {
    weights.V += 3.4
    tags.add('proposta_de_intervencao')
    tags.add('cinco_elementos_c5')
    tags.add('agente_acao_meio_efeito_detalhamento')
    signals.push(`proposta_incompleta_${c5ElementsCount}_de_5_elementos`)
  }

  const priorityCompetencies = (
    ['I', 'II', 'III', 'IV', 'V'] as CompetencyId[]
  ).sort((a, b) => weights[b] - weights[a])

  return {
    priorityCompetencies,
    competencyWeights: weights,
    detectedTags: [...tags],
    signals,
  }
}

function TagsAdd(target: Set<string>, items: string[]) {
  for (const item of items) target.add(item)
}

/** Competency each diagnostic tag belongs to (used only to route retrieval). */
const TAG_COMPETENCY: Record<string, CompetencyId> = {
  periodos_longos: 'I',
  estrutura_sintatica: 'I',
  pontuacao: 'I',
  norma_padrao: 'I',
  desvios_gramaticais: 'I',
  regencia_concordancia: 'I',
  vocabulario: 'I',
  repertorio_sociocultural: 'II',
  uso_produtivo_repertorio: 'II',
  compreensao_do_tema: 'II',
  tipologia_dissertativa: 'II',
  projeto_de_texto: 'III',
  estrutura_dissertativa: 'III',
  desenvolvimento_argumentativo: 'III',
  argumentacao_descritiva_vs_analitica: 'III',
  coesao_textual: 'IV',
  operadores_argumentativos: 'IV',
  fluidez_e_encadeamento: 'IV',
  referenciacao: 'IV',
  repeticao_conectivos_ou_periodos_longos: 'IV',
  proposta_de_intervencao: 'V',
  cinco_elementos_c5: 'V',
  agente_acao_meio_efeito_detalhamento: 'V',
}

/** Pedagogical wording of each problem. The student's own text is never part of the query. */
const TAG_QUERY: Record<string, string> = {
  periodos_longos: 'estrutura sintática períodos truncados justaposição',
  estrutura_sintatica:
    'estrutura sintática períodos complexos orações subordinadas',
  pontuacao: 'pontuação desvios gramaticais',
  norma_padrao:
    'registro informal marcas de oralidade modalidade escrita formal',
  desvios_gramaticais: 'desvios gramaticais convenções da escrita',
  regencia_concordancia: 'regência concordância verbal nominal desvios',
  vocabulario: 'escolha vocabular precisão',
  repertorio_sociocultural:
    'repertório sociocultural produtivo legitimado pertinente repertório de bolso',
  uso_produtivo_repertorio:
    'uso produtivo do repertório articulado à argumentação',
  compreensao_do_tema:
    'compreensão do tema tangenciamento fuga ao tema recorte temático',
  tipologia_dissertativa:
    'texto dissertativo-argumentativo proposição argumentação conclusão',
  projeto_de_texto: 'projeto de texto organização dos argumentos',
  estrutura_dissertativa:
    'estrutura dissertativo-argumentativa introdução desenvolvimento conclusão',
  desenvolvimento_argumentativo:
    'desenvolvimento dos argumentos autoria argumentação consistente',
  argumentacao_descritiva_vs_analitica:
    'argumentação analítica explicação interpretação dos argumentos',
  coesao_textual:
    'coesão conectivos operadores argumentativos entre parágrafos',
  operadores_argumentativos: 'operadores argumentativos relação lógica',
  fluidez_e_encadeamento: 'encadeamento progressão coesão entre períodos',
  referenciacao: 'referenciação retomada pronomes sinônimos repetição',
  repeticao_conectivos_ou_periodos_longos: 'repetição de conectivos coesão',
  proposta_de_intervencao:
    'proposta de intervenção agente ação meio efeito detalhamento',
  cinco_elementos_c5: 'proposta de intervenção cinco elementos',
  agente_acao_meio_efeito_detalhamento:
    'agente ação modo meio de execução efeito detalhamento',
}

const MIN_COMPETENCY_WEIGHT = 2.5
const MAX_COMPETENCIES = 3

function toExample(
  hit: KnowledgeHit,
  tags: string[],
): RetrievedPedagogicalExample {
  return {
    id: hit.id,
    title: hit.title,
    citation: hit.source.citation,
    excerpt: truncateAtParagraph(hit.text, 1_950),
    essayId: hit.essay?.id ?? '',
    aspect: hit.section,
    relatedCompetencies: hit.competencies,
    diagnosticTags: tags,
    essayExcerpt: hit.essay ? hit.essay.excerpt.slice(0, 300) : '',
    relevanceScore: hit.score,
    category: hit.category,
    year: hit.year,
    pdfPages: hit.source.pdfPages,
    printedPages: hit.source.printedPages,
    scoreDocumented: hit.essay?.scoreDocumented ?? null,
  }
}

function truncateAtParagraph(text: string, max: number): string {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const paragraph = cut.lastIndexOf('\n')
  const sentence = cut.lastIndexOf('. ')
  const at = Math.max(paragraph, sentence + 1)
  return (at > max * 0.5 ? cut.slice(0, at) : cut).trim()
}

/**
 * Retrieves official INEP guidance, worked examples and commented-essay commentary for the
 * problems detected in the essay. Queries are built from the *problem descriptions*, not
 * from the student's text: the result is evidence for feedback and cannot rank an essay by
 * its similarity to high-scoring samples. When nothing relevant exists the result is empty
 * (no padding to a fixed size).
 */
export async function retrieveExamples(
  essay: string,
  limit = 3,
): Promise<RetrievedPedagogicalExample[]> {
  try {
    if (typeof essay !== 'string' || !essay.trim() || limit < 1) return []
    const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 5)
    const profile = analyzeEssayDiagnostics(essay)

    const targets = profile.priorityCompetencies
      .filter((c) => profile.competencyWeights[c] >= MIN_COMPETENCY_WEIGHT)
      .slice(0, MAX_COMPETENCIES)
    const perCompetency: RetrievedPedagogicalExample[][] = []
    for (const competency of targets) {
      const tags = profile.detectedTags.filter(
        (t) => TAG_COMPETENCY[t] === competency,
      )
      const query = tags
        .map((t) => TAG_QUERY[t])
        .filter(Boolean)
        .join(' ')
      if (!query) continue
      const result = searchKnowledge({
        text: query,
        competencies: [competency],
        categories: ['orientacao', 'exemplo', 'redacao_comentada'],
        limit: 2,
      })
      if (result.status === 'ok')
        perCompetency.push(result.hits.map((h) => toExample(h, tags)))
    }
    // round-robin by priority so one competency cannot crowd out the others
    const selected: RetrievedPedagogicalExample[] = []
    const seen = new Set<string>()
    for (let rank = 0; selected.length < safeLimit; rank += 1) {
      let progressed = false
      for (const list of perCompetency) {
        if (rank >= list.length) continue
        const item = list[rank]
        progressed = true
        if (seen.has(item.id) || selected.length >= safeLimit) continue
        seen.add(item.id)
        selected.push(item)
      }
      if (!progressed) break
    }
    return selected
  } catch {
    // Graceful degradation: never fail essay correction if local retrieval errors
    return []
  }
}

/** Official-guidance query per competency, used after grading. */
const COMPETENCY_GUIDANCE_QUERY: Record<CompetencyId, string> = {
  I: 'desvios gramaticais convenções da escrita estrutura sintática',
  II: 'repertório sociocultural produtivo compreensão do tema',
  III: 'projeto de texto desenvolvimento dos argumentos autoria',
  IV: 'coesão operadores argumentativos referenciação',
  V: 'proposta de intervenção agente ação meio efeito detalhamento',
}

/**
 * Retrieves official guidance for the competencies where grading found proven
 * deviations, after the model has answered. Nothing here reaches the prompt, so a
 * keyword heuristic can no longer suggest problems the essay does not have.
 */
export function retrieveGuidanceForFindings(
  competencies: readonly { id: CompetencyId; score: number; deviations: number }[],
  limit = 3,
): RetrievedPedagogicalExample[] {
  try {
    const targets = competencies
      .filter((c) => c.deviations > 0 || c.score < 200)
      .sort(
        (a, b) => a.score - b.score || b.deviations - a.deviations,
      )
    const selected: RetrievedPedagogicalExample[] = []
    for (const target of targets) {
      if (selected.length >= limit) break
      const result = searchKnowledge({
        text: COMPETENCY_GUIDANCE_QUERY[target.id],
        competencies: [target.id],
        categories: ['orientacao', 'exemplo', 'redacao_comentada'],
        limit: 1,
      })
      if (result.status !== 'ok') continue
      for (const hit of result.hits)
        if (!selected.some((s) => s.id === hit.id))
          selected.push(toExample(hit, []))
    }
    return selected.slice(0, limit)
  } catch {
    return []
  }
}
