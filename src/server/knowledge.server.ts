import '@tanstack/react-start/server-only'

import { z } from 'zod'
import indexData from '../../data/knowledge/kb/index.json'

/**
 * Retrieval over the official INEP cartilhas (editions 2018-2026).
 *
 * The index is a static JSON artifact produced by `scripts/cartilhas/ingest.py` and
 * bundled with the Worker: no new binding, service or paid API. Retrieval is lexical
 * (BM25 over accent-less, lightly stemmed Portuguese tokens) with metadata filters.
 * Embeddings would add a binding and a per-reindex dependency without evidence that the
 * ~540-chunk corpus needs them; the interface hides the engine, so one can be added later.
 *
 * Retrieved text is *evidence for pedagogical feedback*. It never sets a score and it is
 * always handed to the model as data, not as instructions.
 */

export type CompetencyId = 'I' | 'II' | 'III' | 'IV' | 'V'
export type KnowledgeCategory = 'orientacao' | 'redacao_comentada' | 'exemplo'

const competencySchema = z.enum(['I', 'II', 'III', 'IV', 'V'])
const pagePairSchema = z.tuple([z.number(), z.number()])

const chunkSchema = z.object({
  id: z.string().min(1),
  category: z.enum(['orientacao', 'redacao_comentada', 'exemplo']),
  kind: z.string(),
  year: z.number().int(),
  examYear: z.number().int().nullable().optional(),
  title: z.string().min(1),
  section: z.string(),
  competencies: z.array(competencySchema),
  competencySource: z.string(),
  theme: z.string().nullable(),
  text: z.string().min(1),
  pdfPages: pagePairSchema,
  printedPages: z.tuple([z.string(), z.string()]).nullable(),
  checksum: z.string(),
  essayId: z.string().optional(),
  essayAuthor: z.string().nullable().optional(),
  scoreDocumented: z.number().nullable().optional(),
  pairedEssayChunkId: z.string().optional(),
  supersedes: z
    .array(
      z.object({
        id: z.string(),
        year: z.number().int(),
        pdfPages: pagePairSchema,
        printedPages: z.tuple([z.string(), z.string()]).nullable(),
        similarity: z.number(),
      }),
    )
    .optional(),
  relatedVersions: z
    .array(
      z.object({
        id: z.string(),
        year: z.number().int(),
        similarity: z.number(),
      }),
    )
    .optional(),
})

const essaySchema = z.object({
  year: z.number().int(),
  examYear: z.number().int().nullable(),
  author: z.string().nullable(),
  scoreDocumented: z.number().nullable(),
  theme: z.string().nullable(),
  pdfPages: pagePairSchema,
  printedPages: z.tuple([z.string(), z.string()]).nullable(),
  excerpt: z.string(),
  commentChunkIds: z.array(z.string()),
  quality: z.string(),
})

const indexSchema = z.object({
  schemaVersion: z.literal(1),
  pipelineVersion: z.number(),
  documents: z.array(
    z.object({
      id: z.string(),
      year: z.number(),
      file: z.string(),
      sha256: z.string(),
      theme: z.string().nullable(),
    }),
  ),
  chunks: z.array(z.unknown()),
  essays: z.record(z.string(), essaySchema),
})

export type KnowledgeChunk = z.infer<typeof chunkSchema>
export type KnowledgeEssay = z.infer<typeof essaySchema>

export type KnowledgeQuery = {
  /** Pedagogical question or problem description. Essay text must not be passed here. */
  text: string
  competencies?: CompetencyId[]
  categories?: KnowledgeCategory[]
  years?: number[]
  /** Exact theme of the edition (as printed in the cartilha). */
  theme?: string
  limit?: number
  /** Absolute BM25 floor; hits below it are dropped instead of padding the result. */
  minScore?: number
  /** Include commentary chunks that were not tied to a specific competency. */
  includeBroad?: boolean
}

export type KnowledgeHit = {
  id: string
  category: KnowledgeCategory
  kind: string
  year: number
  examYear: number | null
  title: string
  section: string
  competencies: CompetencyId[]
  competencySource: string
  theme: string | null
  text: string
  score: number
  source: {
    publisher: 'Inep/MEC'
    document: string
    pdfPages: [number, number]
    printedPages: [string, string] | null
    citation: string
    /** Earlier editions with equivalent text that were folded into this chunk. */
    alsoIn: {
      year: number
      pdfPages: [number, number]
      printedPages: [string, string] | null
    }[]
  }
  essay?: {
    id: string
    author: string | null
    /** Documented score of the sample; null means the cartilha does not state it. */
    scoreDocumented: number | null
    excerpt: string
    pdfPages: [number, number]
  }
}

export type KnowledgeResult =
  | { status: 'ok'; hits: KnowledgeHit[] }
  | { status: 'no_evidence'; reason: string; hits: [] }

// ---------------------------------------------------------------------------------------
// text processing
// ---------------------------------------------------------------------------------------
const STOPWORDS = new Set(
  'a ao aos as com como da das de do dos e em entre era essa esse esta este eu foi ha isso isto ja la mais mas me mesmo meu na nas nao nem no nos nossa nosso num numa o os ou para pela pelas pelo pelos por qual quando que quem se sem ser seu sua suas seus so sobre tambem te tem ter um uma uns umas voce voces vos redacao texto enem participante'.split(
    ' ',
  ),
)

export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Light Portuguese stemming: plural and common derivational endings only. */
export function stem(token: string): string {
  let t = token
  if (t.length > 5 && t.endsWith('coes')) t = t.slice(0, -4) + 'cao'
  else if (t.length > 4 && (t.endsWith('oes') || t.endsWith('aes')))
    t = t.slice(0, -3) + 'ao'
  else if (t.length > 4 && t.endsWith('ais')) t = t.slice(0, -3) + 'al'
  else if (t.length > 4 && t.endsWith('eis')) t = t.slice(0, -3) + 'el'
  else if (t.length > 4 && t.endsWith('ns')) t = t.slice(0, -2) + 'm'
  else if (t.length > 4 && t.endsWith('res')) t = t.slice(0, -2)
  else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss'))
    t = t.slice(0, -1)
  return t
}

export function tokenize(text: string): string[] {
  const normalized = normalizeSearchText(text)
  if (!normalized) return []
  return normalized
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
    .map(stem)
}

// ---------------------------------------------------------------------------------------
// index loading and BM25
// ---------------------------------------------------------------------------------------
type Engine = {
  chunks: KnowledgeChunk[]
  essays: Record<string, KnowledgeEssay>
  postings: Map<string, [number, number][]>
  lengths: number[]
  avgLength: number
  documents: Map<number, string>
}

const K1 = 1.2
const B = 0.75
/** Tokens of the title/section are added again so headings weigh more than body prose. */
const TITLE_WEIGHT = 2

let cached: Engine | undefined

function engine(): Engine {
  if (cached) return cached
  const parsed = indexSchema.parse(indexData)
  const chunks: KnowledgeChunk[] = []
  for (const raw of parsed.chunks) {
    const ok = chunkSchema.safeParse(raw)
    if (ok.success) chunks.push(ok.data)
  }
  const postings = new Map<string, [number, number][]>()
  const lengths: number[] = []
  chunks.forEach((chunk, idx) => {
    const counts = new Map<string, number>()
    const add = (tokens: string[], weight: number) => {
      for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + weight)
    }
    add(tokenize(chunk.text), 1)
    add(tokenize(`${chunk.title} ${chunk.section}`), TITLE_WEIGHT)
    let length = 0
    for (const [term, tf] of counts) {
      length += tf
      const list = postings.get(term) ?? []
      list.push([idx, tf])
      postings.set(term, list)
    }
    lengths.push(length)
  })
  const avgLength =
    lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length)
  const documents = new Map(parsed.documents.map((d) => [d.year, d.file]))
  cached = {
    chunks,
    essays: parsed.essays,
    postings,
    lengths,
    avgLength,
    documents,
  }
  return cached
}

export function getKnowledgeStats(): {
  chunks: number
  years: number[]
  byCategory: Record<string, number>
} {
  const { chunks } = engine()
  const byCategory: Record<string, number> = {}
  for (const c of chunks)
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1
  return {
    chunks: chunks.length,
    years: [...new Set(chunks.map((c) => c.year))].sort(),
    byCategory,
  }
}

export function citationFor(
  chunk: Pick<KnowledgeChunk, 'year' | 'pdfPages' | 'printedPages'>,
): string {
  const pdf =
    chunk.pdfPages[0] === chunk.pdfPages[1]
      ? `${chunk.pdfPages[0]}`
      : `${chunk.pdfPages[0]}-${chunk.pdfPages[1]}`
  if (chunk.printedPages) {
    const [a, b] = chunk.printedPages
    const printed = a === b ? a : `${a}-${b}`
    return `Cartilha do Participante ENEM ${chunk.year}, p. ${printed} (PDF ${pdf})`
  }
  return `Cartilha do Participante ENEM ${chunk.year}, PDF p. ${pdf}`
}

const DEFAULT_MIN_SCORE = 3
/** A hit must reach this share of the best score; weaker results are noise, not evidence. */
const RELATIVE_FLOOR = 0.4

export function searchKnowledge(query: KnowledgeQuery): KnowledgeResult {
  const eng = engine()
  const limit = Math.min(Math.max(1, Math.trunc(query.limit ?? 3)), 8)
  const terms = [...new Set(tokenize(query.text))]
  if (terms.length === 0)
    return {
      status: 'no_evidence',
      reason: 'consulta sem termos pesquisáveis',
      hits: [],
    }

  const eligible = (chunk: KnowledgeChunk): boolean => {
    if (query.categories && !query.categories.includes(chunk.category))
      return false
    if (query.years && !query.years.includes(chunk.year)) return false
    if (query.theme && chunk.theme !== query.theme) return false
    if (query.competencies && query.competencies.length > 0) {
      if (!query.includeBroad && chunk.competencySource === 'essay_scope')
        return false
      if (!chunk.competencies.some((c) => query.competencies?.includes(c)))
        return false
    }
    return true
  }

  const n = eng.chunks.length
  const scores = new Map<number, number>()
  for (const term of terms) {
    const list = eng.postings.get(term)
    if (!list) continue
    const idf = Math.log(1 + (n - list.length + 0.5) / (list.length + 0.5))
    for (const [idx, tf] of list) {
      const chunk = eng.chunks[idx]
      if (!eligible(chunk)) continue
      const len = eng.lengths[idx]
      const norm =
        (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / eng.avgLength))
      scores.set(idx, (scores.get(idx) ?? 0) + idf * norm)
    }
  }
  const ranked = [...scores.entries()].sort(
    (a, b) => b[1] - a[1] || eng.chunks[b[0]].year - eng.chunks[a[0]].year,
  )
  const best = ranked[0]?.[1] ?? 0
  const floor = Math.max(
    query.minScore ?? DEFAULT_MIN_SCORE,
    best * RELATIVE_FLOOR,
  )
  const picked = collapseRelatedVersions(
    ranked.filter(([, s]) => s >= floor),
    eng,
  ).slice(0, limit)
  if (picked.length === 0) {
    return {
      status: 'no_evidence',
      reason:
        'nenhum trecho oficial atingiu a relevância mínima para esta consulta',
      hits: [],
    }
  }
  const hits = picked.map(([idx, score]) => toHit(eng.chunks[idx], score, eng))
  return { status: 'ok', hits }
}

/**
 * Partly overlapping text from different editions (cross-linked by the ingestion as
 * `relatedVersions`) would fill the result with the same guidance. Keep one member per
 * group: the newest edition wins, and it inherits the best score of the group.
 */
function collapseRelatedVersions(
  ranked: [number, number][],
  eng: Engine,
): [number, number][] {
  const kept: [number, number][] = []
  for (const [idx, score] of ranked) {
    const chunk = eng.chunks[idx]
    const related = (other: KnowledgeChunk) =>
      (chunk.relatedVersions ?? []).some((r) => r.id === other.id) ||
      (other.relatedVersions ?? []).some((r) => r.id === chunk.id)
    const at = kept.findIndex(([k]) => related(eng.chunks[k]))
    if (at === -1) {
      kept.push([idx, score])
    } else if (chunk.year > eng.chunks[kept[at][0]].year) {
      kept[at] = [idx, Math.max(score, kept[at][1])]
    }
  }
  return kept.sort((a, b) => b[1] - a[1])
}

function toHit(
  chunk: KnowledgeChunk,
  score: number,
  eng: Engine,
): KnowledgeHit {
  const essayRecord = chunk.essayId ? eng.essays[chunk.essayId] : undefined
  return {
    id: chunk.id,
    category: chunk.category,
    kind: chunk.kind,
    year: chunk.year,
    examYear: chunk.examYear ?? null,
    title: chunk.title,
    section: chunk.section,
    competencies: chunk.competencies,
    competencySource: chunk.competencySource,
    theme: chunk.theme,
    text: chunk.text,
    score: Number(score.toFixed(3)),
    source: {
      publisher: 'Inep/MEC',
      document:
        eng.documents.get(chunk.year) ?? `cartilha_enem_${chunk.year}.pdf`,
      pdfPages: chunk.pdfPages,
      printedPages: chunk.printedPages,
      citation: citationFor(chunk),
      alsoIn: (chunk.supersedes ?? []).map((s) => ({
        year: s.year,
        pdfPages: s.pdfPages,
        printedPages: s.printedPages,
      })),
    },
    ...(essayRecord && chunk.essayId
      ? {
          essay: {
            id: chunk.essayId,
            author: essayRecord.author,
            scoreDocumented: essayRecord.scoreDocumented,
            excerpt: essayRecord.excerpt,
            pdfPages: essayRecord.pdfPages,
          },
        }
      : {}),
  }
}

export function getChunkById(id: string): KnowledgeChunk | undefined {
  return engine().chunks.find((c) => c.id === id)
}
