/**
 * Calibration benchmark: dataset, splits and metrics. Pure module (no I/O, no model calls).
 *
 * Ground truth policy
 * - Official scores come only from cartilhas that state them: 2018–2024 publish
 *   "redações nota 1.000". The 2025 and 2026 cartilhas say the essays "receberam boas
 *   notas" (verified on the rendered page), so their totals are NOT ground truth.
 * - Transcriptions are INEP's own (cartilha text), never press reproductions.
 * - INEP commentary is used for two documented facts: the number of Competency I
 *   deviations INEP points out in a nota-1000 essay, and an explicit statement that
 *   an essay did not reach the top Competency I level.
 * - Splits by edition: calibration (2018–2020) may guide prompt changes; validation
 *   (2022–2024) is only read for the final comparison; diagnostic (2025–2026 and
 *   user-reported cases) is never treated as official.
 */

export const COMPETENCIES = ['I', 'II', 'III', 'IV', 'V'] as const
export type Competency = (typeof COMPETENCIES)[number]
export type Scores = Record<Competency, number>
export type Split = 'calibration' | 'validation' | 'diagnostic' | 'metamorphic'

export type KbChunk = {
  id: string
  kind: string
  docId: string
  year: number
  examYear?: number | null
  theme?: string | null
  text: string
  essayAuthor?: string | null
  scoreDocumented?: number | null
  commentChunkIds?: string[]
  pdfPages: [number, number]
}

export type Expectation = {
  /** Official total and per-competency scores (documented nota 1000 only). */
  total?: number
  scores?: Partial<Scores>
  /** Number of Competency I deviations INEP lists in its commentary. */
  inepC1Deviations?: number | null
  /** INEP states the essay did not reach the top Competency I level. */
  c1BelowTop?: boolean
  /** Metamorphic expectations: competency must not exceed this score. */
  maxScores?: Partial<Scores>
}

export type BenchItem = {
  id: string
  split: Split
  theme: string
  essay: string
  expected: Expectation
  provenance: string
  /** For metamorphic items: the essay they were derived from. */
  derivedFrom?: string
  /** Text from outside INEP whose fidelity is not verified. */
  transcriptionVerified: boolean
}

/**
 * PDF-extraction defects in the knowledge-base copy of INEP essays, each checked
 * against the cartilha text: a compound-word hyphen lost at a line break, or a word
 * split by a stray space. Without these fixes the grader is (correctly) penalizing
 * errors the participant never made. Syllable breaks such as "conse-|quência" were
 * joined correctly and are not listed.
 */
export const TRANSCRIPTION_FIXES: Record<string, [string, string][]> = {
  '2018.essay.02': [
    ['recémaprovado', 'recém-aprovado'],
    ['f ísica', 'física'],
  ],
  '2019.essay.01': [['livrearbítrio', 'livre-arbítrio']],
  '2019.essay.06': [['atenuarse', 'atenuar-se']],
  '2026.essay.10': [['curtametragem', 'curta-metragem']],
}

export function fixTranscription(id: string, text: string): string {
  let out = text
  for (const [wrong, right] of TRANSCRIPTION_FIXES[id] ?? []) {
    if (!out.includes(wrong)) throw new Error(`Correção de transcrição não aplicável em ${id}: ${wrong}`)
    out = out.replaceAll(wrong, right)
  }
  return out
}

/** Cartilha 2020 does not label the 2019 theme in its essay pages; stated on p. 18. */
const THEME_OVERRIDES: Record<string, string> = {
  'cartilha-2020': 'Democratização do acesso ao cinema no Brasil',
}

const CALIBRATION_DOCS = new Set(['cartilha-2018', 'cartilha-2019', 'cartilha-2020'])
const VALIDATION_DOCS = new Set(['cartilha-2022', 'cartilha-2023', 'cartilha-2024'])
const DIAGNOSTIC_DOCS = new Set(['cartilha-2025', 'cartilha-2026'])

const NUMBER_WORDS: Record<string, number> = {
  um: 1,
  uma: 1,
  único: 1,
  dois: 2,
  duas: 2,
  três: 3,
}

/**
 * Reads how many Competency I deviations INEP points out. Returns null when the
 * commentary does not state a count (e.g. "desvios pontuais", "alguns desvios").
 */
export function inepC1DeviationCount(commentary: string): number | null {
  const text = commentary.replace(/\s+/g, ' ')
  if (
    /\b(n[ãa]o apresenta (desvios|inadequa[çc][õo]es)|sem desvios|n[ãa]o h[áa] (presen[çc]a de )?desvios|n[ãa]o se verificam desvios|sem qualquer falha)/i.test(
      text,
    ) &&
    !/apenas (um|uma|dois|duas)|um único desvio|com (um|dois) desvios?/i.test(text)
  )
    return 0
  let count = 0
  let matched = false
  for (const m of text.matchAll(
    /\b(?:apenas|presença de apenas|com|um único|observa-se um único)?\s*(um|uma|dois|duas|três)\s+(?:único\s+)?(desvios?|inadequaç(?:ão|ões)|falhas?)\b/gi,
  )) {
    matched = true
    count = Math.max(count, NUMBER_WORDS[m[1].toLowerCase()] ?? 0)
  }
  if (/um único desvio|um desvio/i.test(text) && count === 0) {
    matched = true
    count = 1
  }
  // "uma falha ... e um desvio" lists two different occurrences.
  if (/uma falha[^.]*\be um desvio\b/i.test(text)) count = 2
  return matched ? count : null
}

/** Competency I statements copied from the commentary, for transparency. */
export function c1Statements(commentary: string): string[] {
  return commentary
    .split(/(?<=[.!?])\s+/)
    .filter((s) =>
      /desvio|modalidade (escrita )?formal|norma[- ]?padr[ãa]o|conven[çc][õo]es/i.test(s),
    )
}

export function buildDataset(chunks: KbChunk[]): BenchItem[] {
  const byId = new Map(chunks.map((c) => [c.id, c]))
  const items: BenchItem[] = []
  for (const essay of chunks.filter((c) => c.kind === 'essay')) {
    const commentary = (essay.commentChunkIds ?? [])
      .map((id) => byId.get(id)?.text ?? '')
      .join(' ')
    const theme = essay.theme ?? THEME_OVERRIDES[essay.docId]
    if (!theme) continue
    const pages = `${essay.docId}, PDF p. ${essay.pdfPages[0]}`
    if (CALIBRATION_DOCS.has(essay.docId) || VALIDATION_DOCS.has(essay.docId)) {
      if (essay.scoreDocumented !== 1000) continue
      items.push({
        id: essay.id,
        split: CALIBRATION_DOCS.has(essay.docId) ? 'calibration' : 'validation',
        theme,
        essay: fixTranscription(essay.id, essay.text),
        expected: {
          total: 1000,
          scores: { I: 200, II: 200, III: 200, IV: 200, V: 200 },
          inepC1Deviations: inepC1DeviationCount(c1Statements(commentary).join(' ')),
        },
        provenance: `INEP, nota 1.000 documentada (${pages})`,
        transcriptionVerified: true,
      })
    } else if (DIAGNOSTIC_DOCS.has(essay.docId)) {
      items.push({
        id: essay.id,
        split: 'diagnostic',
        theme,
        essay: fixTranscription(essay.id, essay.text),
        // Deviation counts are not extracted here: these comments often list several
        // occurrences in one sentence, and the totals are not official anyway.
        expected: {
          c1BelowTop: /não permitem a avaliação no nível máximo/i.test(commentary)
            ? true
            : undefined,
        },
        provenance: `INEP, "boas notas" sem nota publicada (${pages})`,
        transcriptionVerified: true,
      })
    }
  }
  return items
}

// ---------------------------------------------------------------------------
// Metamorphic variants: deterministic degradations with directional expectations.
// They test permissiveness without inventing official scores for weak essays.
// ---------------------------------------------------------------------------

const ACCENT_STRIP: [RegExp, string][] = [
  [/ção\b/g, 'cao'],
  [/ções\b/g, 'coes'],
  [/ência\b/g, 'encia'],
  [/ância\b/g, 'ancia'],
  [/ístic/g, 'istic'],
  [/ública/g, 'ublica'],
  [/ético/g, 'etico'],
]

/** Frequent, diversified spelling/accent deviations plus agreement errors. */
export function degradeC1(essay: string): string {
  let out = essay
  for (const [pattern, replacement] of ACCENT_STRIP) out = out.replace(pattern, replacement)
  out = out
    .replace(/\bhá\b/g, 'a')
    .replace(/\bé\b/g, 'e')
    .replace(/\bos (\p{L}+?)s\b/gu, 'os $1')
    .replace(/\bas (\p{L}+?)s\b/gu, 'as $1')
  return out
}

/** Removes the final paragraph, where the intervention proposal is. */
export function removeProposal(essay: string): string {
  const paragraphs = essay.trim().split(/\n\s*\n|\n/).filter((p) => p.trim())
  return paragraphs.slice(0, -1).join('\n\n')
}

const OPENING_CONNECTIVE =
  /^(Além disso|Ademais|Outrossim|Portanto|Dessa forma|Desse modo|Nesse sentido|Nesse contexto|Nesse cenário|Diante disso|Diante desse cenário|Em primeiro lugar|Em segundo lugar|Em primeira análise|Em segunda análise|Por outro lado|Sob esse viés|Sob essa ótica|Sob essa óptica|Assim|Logo|Por conseguinte|Por fim|Em suma|Nessa perspectiva|Nesse viés|Paralelamente|Somado a isso)\s*,\s*/i

/** Single block, with the opening connective of each paragraph removed. */
export function flattenCohesion(essay: string): string {
  return essay
    .trim()
    .split(/\n\s*\n|\n/)
    .filter((p) => p.trim())
    .map((p) => {
      const stripped = p.trim().replace(OPENING_CONNECTIVE, '')
      return stripped.charAt(0).toUpperCase() + stripped.slice(1)
    })
    .join(' ')
}

export function metamorphicItems(base: BenchItem[], perSource = 6): BenchItem[] {
  const sources = base.filter((i) => i.split === 'validation').slice(0, perSource)
  return sources.flatMap((s) => [
    {
      id: `${s.id}~c1`,
      split: 'metamorphic' as const,
      theme: s.theme,
      essay: degradeC1(s.essay),
      expected: { maxScores: { I: 120 } },
      provenance: `Derivada de ${s.id}: desvios de acentuação, grafia e concordância frequentes e diversificados`,
      derivedFrom: s.id,
      transcriptionVerified: true,
    },
    {
      id: `${s.id}~c5`,
      split: 'metamorphic' as const,
      theme: s.theme,
      essay: removeProposal(s.essay),
      expected: { maxScores: { V: 40 } },
      provenance: `Derivada de ${s.id}: último parágrafo (proposta) removido`,
      derivedFrom: s.id,
      transcriptionVerified: true,
    },
    {
      id: `${s.id}~c4`,
      split: 'metamorphic' as const,
      theme: s.theme,
      essay: flattenCohesion(s.essay),
      expected: { maxScores: { IV: 160 } },
      provenance: `Derivada de ${s.id}: parágrafo único e conectivos iniciais removidos`,
      derivedFrom: s.id,
      transcriptionVerified: true,
    },
  ])
}

// ---------------------------------------------------------------------------
// Run records and metrics
// ---------------------------------------------------------------------------

export type Finding = {
  kind: 'desvio' | 'oportunidade' | 'incerto'
  description: string
  quote: string | null
}

export type RunRecord = {
  itemId: string
  variant: string
  run: number
  promptVersion: string
  model: string | null
  ok: boolean
  error?: string
  scores?: Scores
  total?: number
  /** Penalizing observations per competency (calibrated: desvios; baseline: problems). */
  deviations?: Partial<Record<Competency, Finding[]>>
  /** Non-penalizing observations per competency (calibrated only). */
  observations?: Partial<Record<Competency, Finding[]>>
  inputTokens?: number
  outputTokens?: number
  thoughtTokens?: number
  costUsd?: number
  latencyMs?: number
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN)
const median = (xs: number[]) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const pct = (xs: number[], p: number) => {
  if (!xs.length) return NaN
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]
}

export type Metrics = {
  runs: number
  failures: number
  items: number
  /** Against official scores. */
  maeTotal: number
  biasTotal: number
  maeByCompetency: Record<Competency, number>
  exactTotalRate: number
  belowTopRateByCompetency: Record<Competency, number>
  /** Stability across repeated runs of the same item. */
  meanTotalRange: number
  identicalTotalRate: number
  /** Competency I against INEP's own deviation list. */
  c1ExcessDeviations: number
  c1BelowTopWhenInepAtMostOne: number
  /** Scores below 200 without any penalizing observation. */
  unsupportedDiscountRate: number
  /** Metamorphic expectation pass rate. */
  metamorphicPassRate: number
  c1BelowTopDetected: number
  costUsdMean: number
  latencyMsMedian: number
  latencyMsP90: number
  inputTokensMean: number
  outputTokensMean: number
  thoughtTokensMean: number
}

export function computeMetrics(records: RunRecord[], items: Map<string, BenchItem>): Metrics {
  const ok = records.filter((r) => r.ok && r.scores && items.has(r.itemId))
  const official = ok.filter((r) => items.get(r.itemId)!.expected.total !== undefined)
  const byComp = (f: (c: Competency) => number) =>
    Object.fromEntries(COMPETENCIES.map((c) => [c, f(c)])) as Record<Competency, number>

  const groups = new Map<string, RunRecord[]>()
  for (const r of ok) groups.set(r.itemId, [...(groups.get(r.itemId) ?? []), r])
  const repeated = [...groups.values()].filter((g) => g.length > 1)

  const c1Known = official.filter((r) => {
    const n = items.get(r.itemId)!.expected.inepC1Deviations
    return n !== null && n !== undefined
  })
  const atMostOne = c1Known.filter((r) => items.get(r.itemId)!.expected.inepC1Deviations! <= 1)

  const discounted = ok.flatMap((r) =>
    COMPETENCIES.filter((c) => r.scores![c] < 200).map((c) => ({ r, c })),
  )
  const unsupported = discounted.filter(({ r, c }) => !(r.deviations?.[c]?.length ?? 0))

  const meta = ok.filter((r) => items.get(r.itemId)!.expected.maxScores)
  const metaPass = meta.filter((r) => {
    const max = items.get(r.itemId)!.expected.maxScores!
    return COMPETENCIES.every((c) => max[c] === undefined || r.scores![c] <= max[c])
  })
  const belowTopItems = ok.filter((r) => items.get(r.itemId)!.expected.c1BelowTop)

  const usage = ok.filter((r) => r.inputTokens !== undefined)
  return {
    runs: records.length,
    failures: records.filter((r) => !r.ok).length,
    items: groups.size,
    maeTotal: mean(official.map((r) => Math.abs(r.total! - items.get(r.itemId)!.expected.total!))),
    biasTotal: mean(official.map((r) => r.total! - items.get(r.itemId)!.expected.total!)),
    maeByCompetency: byComp((c) =>
      mean(official.map((r) => Math.abs(r.scores![c] - items.get(r.itemId)!.expected.scores![c]!))),
    ),
    exactTotalRate: mean(official.map((r) => (r.total === items.get(r.itemId)!.expected.total ? 1 : 0))),
    belowTopRateByCompetency: byComp((c) => mean(official.map((r) => (r.scores![c] < 200 ? 1 : 0)))),
    meanTotalRange: mean(
      repeated.map((g) => Math.max(...g.map((r) => r.total!)) - Math.min(...g.map((r) => r.total!))),
    ),
    identicalTotalRate: mean(repeated.map((g) => (new Set(g.map((r) => r.total)).size === 1 ? 1 : 0))),
    c1ExcessDeviations: mean(
      c1Known.map((r) =>
        Math.max(0, (r.deviations?.I?.length ?? 0) - items.get(r.itemId)!.expected.inepC1Deviations!),
      ),
    ),
    c1BelowTopWhenInepAtMostOne: mean(atMostOne.map((r) => (r.scores!.I < 200 ? 1 : 0))),
    unsupportedDiscountRate: discounted.length ? unsupported.length / discounted.length : 0,
    metamorphicPassRate: mean(metaPass.length ? meta.map((r) => (metaPass.includes(r) ? 1 : 0)) : meta.map(() => 0)),
    c1BelowTopDetected: mean(belowTopItems.map((r) => (r.scores!.I < 200 ? 1 : 0))),
    costUsdMean: mean(usage.map((r) => r.costUsd ?? 0)),
    latencyMsMedian: median(ok.map((r) => r.latencyMs ?? NaN).filter(Number.isFinite)),
    latencyMsP90: pct(ok.map((r) => r.latencyMs ?? NaN).filter(Number.isFinite), 90),
    inputTokensMean: mean(usage.map((r) => r.inputTokens!)),
    outputTokensMean: mean(usage.map((r) => r.outputTokens!)),
    thoughtTokensMean: mean(usage.map((r) => r.thoughtTokens ?? 0)),
  }
}
