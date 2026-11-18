/**
 * Calibration report (no model calls).
 *
 *   bun scripts/benchmark/report.ts benchmark-results/*.jsonl [--local-d1 <sqlite>]
 *
 * --local-d1 adds evaluations already stored in the local D1 (variant "stored": the
 * prompt that was live when they were produced). Essays are matched to the INEP
 * dataset by exact text; anything else is reported only as a stability case under an
 * anonymous id. Essay text is never printed.
 */
import { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import chunks from '../../data/knowledge/kb/chunks.json'
import { COMPETENCIES, buildDataset, computeMetrics, metamorphicItems } from './lib'
import type { BenchItem, Competency, Finding, KbChunk, Metrics, RunRecord } from './lib'

/** Letters and digits only: typographic dashes, quotes and spacing differ between copies. */
const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

export function loadStored(
  file: string,
  items: BenchItem[],
): { records: RunRecord[]; extra: BenchItem[]; divergent: string[] } {
  const db = new Database(file, { readonly: true })
  const rows = db
    .query(
      `SELECT e.model_id, p.input_json, p.result_json FROM evaluations e
       JOIN evaluation_payloads p ON p.evaluation_id = e.id ORDER BY e.created_at`,
    )
    .all() as { model_id: string | null; input_json: string; result_json: string }[]
  const byText = new Map(items.map((i) => [norm(i.essay), i]))
  const extra = new Map<string, BenchItem>()
  const runs = new Map<string, number>()
  const divergent = new Set<string>()
  const records = rows.map((row) => {
    const input = JSON.parse(row.input_json) as { essay: string; theme: string }
    const result = JSON.parse(row.result_json) as {
      total: number
      competencies: { id: Competency; score: number; problems: { description: string; quote: string | null }[] }[]
    }
    let item = byText.get(norm(input.essay))
    if (!item) {
      // Same essay with a few words changed (e.g. a press copy): match, but say so.
      const words = norm(input.essay).split(' ')
      const near = items.find((i) => {
        const ref = norm(i.essay).split(' ')
        if (ref.length !== words.length) return false
        let diff = 0
        for (let k = 0; k < ref.length && diff <= 3; k++) if (ref[k] !== words[k]) diff++
        return diff <= 3
      })
      if (near) {
        divergent.add(near.id)
        item = near
      }
    }
    if (!item) {
      const id = `local:${createHash('sha256').update(norm(input.essay)).digest('hex').slice(0, 8)}`
      item = extra.get(id) ?? {
        id,
        split: 'diagnostic',
        theme: input.theme,
        // Kept in memory so the runner can re-grade it; never printed or written out.
        essay: input.essay,
        expected: {},
        provenance: 'Avaliação local fora das cartilhas (sem nota oficial verificável)',
        transcriptionVerified: false,
      }
      extra.set(id, item)
    }
    const run = runs.get(item.id) ?? 0
    runs.set(item.id, run + 1)
    const deviations = Object.fromEntries(
      result.competencies.map((c) => [c.id, c.problems.map((p): Finding => ({ kind: 'desvio', ...p }))]),
    ) as Record<Competency, Finding[]>
    return {
      itemId: item.id,
      variant: 'stored',
      run,
      promptVersion: '2026.1-baseline (armazenada)',
      model: row.model_id,
      ok: true,
      scores: Object.fromEntries(result.competencies.map((c) => [c.id, c.score])) as RunRecord['scores'],
      total: result.total,
      deviations,
    } satisfies RunRecord
  })
  return { records, extra: [...extra.values()], divergent: [...divergent] }
}

const f = (n: number, d = 1) => (Number.isFinite(n) ? n.toFixed(d) : '—')
const p = (n: number) => (Number.isFinite(n) ? `${Math.round(n * 100)}%` : '—')

function metricsTable(rows: [string, Metrics][]): string {
  const head = ['Variante / conjunto', 'Exec.', 'Falhas', 'EMA total', 'Viés total', ...COMPETENCIES.map((c) => `EMA C${c}`), 'Total exato']
  const lines = rows.map(([name, m]) =>
    [name, m.runs, m.failures, f(m.maeTotal), f(m.biasTotal), ...COMPETENCIES.map((c) => f(m.maeByCompetency[c])), p(m.exactTotalRate)].join(' | '),
  )
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...lines.map((l) => `| ${l} |`)].join('\n')
}

function qualityTable(rows: [string, Metrics][]): string {
  const head = [
    'Variante / conjunto',
    'Amplitude média do total entre execuções',
    'Total idêntico entre execuções',
    'Desvios C1 além dos listados pelo INEP (média)',
    'C1 < 200 quando o INEP aponta ≤ 1 desvio',
    'Descontos sem desvio apontado',
    'Metamórficos dentro do esperado',
    'C1 < 200 onde o INEP nega o nível máximo',
  ]
  const lines = rows.map(([name, m]) =>
    [name, f(m.meanTotalRange), p(m.identicalTotalRate), f(m.c1ExcessDeviations, 2), p(m.c1BelowTopWhenInepAtMostOne), p(m.unsupportedDiscountRate), p(m.metamorphicPassRate), p(m.c1BelowTopDetected)].join(' | '),
  )
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...lines.map((l) => `| ${l} |`)].join('\n')
}

function costTable(rows: [string, Metrics][]): string {
  const head = ['Variante', 'Custo médio (US$)', 'Latência mediana (s)', 'Latência p90 (s)', 'Tokens entrada', 'Tokens saída', 'Tokens raciocínio']
  const lines = rows.map(([name, m]) =>
    [name, f(m.costUsdMean, 4), f(m.latencyMsMedian / 1000), f(m.latencyMsP90 / 1000), f(m.inputTokensMean, 0), f(m.outputTokensMean, 0), f(m.thoughtTokensMean, 0)].join(' | '),
  )
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...lines.map((l) => `| ${l} |`)].join('\n')
}

function perItem(records: RunRecord[], items: Map<string, BenchItem>, filter: (i: BenchItem) => boolean): string {
  const ids = [...new Set(records.map((r) => r.itemId))].filter((id) => items.has(id) && filter(items.get(id)!)).sort()
  const lines = ids.flatMap((id) => {
    const variants = [...new Set(records.filter((r) => r.itemId === id).map((r) => r.variant))].sort()
    return variants.map((v) => {
      const rs = records.filter((r) => r.itemId === id && r.variant === v && r.ok)
      const totals = rs.map((r) => r.total).join(', ')
      const comps = COMPETENCIES.map((c) => rs.map((r) => r.scores![c]).join('/')).join(' · ')
      const exp = items.get(id)!.expected
      const expected = exp.total ?? (exp.maxScores ? `≤ ${JSON.stringify(exp.maxScores)}` : exp.c1BelowTop ? 'C1 < 200 (INEP)' : '—')
      return `| ${id} | ${v} | ${expected} | ${totals} | ${comps} |`
    })
  })
  return ['| Redação | Variante | Esperado | Totais | C1 · C2 · C3 · C4 · C5 (por execução) |', '|---|---|---|---|---|', ...lines].join('\n')
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const d1 = args.includes('--local-d1') ? args[args.indexOf('--local-d1') + 1] : undefined
  const files = args.filter((a, i) => a.endsWith('.jsonl') && args[i - 1] !== '--local-d1')
  const base = buildDataset((chunks as unknown as { chunks: KbChunk[] }).chunks)
  const dataset = [...base, ...metamorphicItems(base)]
  let records: RunRecord[] = files.flatMap((file) =>
    readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as RunRecord),
  )
  if (d1) {
    const stored = loadStored(d1, dataset)
    records = [...records, ...stored.records]
    dataset.push(...stored.extra)
    for (const id of stored.divergent)
      console.log(`> ${id}: a cópia avaliada localmente difere da transcrição do INEP em até 3 palavras.\n`)
  }
  const items = new Map(dataset.map((i) => [i.id, i]))
  const variants = [...new Set(records.map((r) => r.variant))].sort()
  const splits = ['calibration', 'validation', 'diagnostic', 'metamorphic'] as const
  const rows: [string, Metrics][] = []
  for (const v of variants)
    for (const s of splits) {
      const rs = records.filter((r) => r.variant === v && items.get(r.itemId)?.split === s)
      if (rs.length) rows.push([`${v} / ${s}`, computeMetrics(rs, items)])
    }
  const costRows: [string, Metrics][] = variants.map((v) => [v, computeMetrics(records.filter((r) => r.variant === v), items)])
  console.log('## Erro contra notas oficiais\n')
  console.log(metricsTable(rows.filter(([n]) => /calibration|validation/.test(n))))
  console.log('\n## Rigor, estabilidade e falsos positivos\n')
  console.log(qualityTable(rows))
  console.log('\n## Custo e latência\n')
  console.log(costTable(costRows))
  console.log('\n## Por redação (diagnóstico e metamórficos)\n')
  console.log(perItem(records, items, (i) => i.split === 'diagnostic' || i.split === 'metamorphic'))
}
