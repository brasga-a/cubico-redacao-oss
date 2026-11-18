/**
 * Paid calibration runs. Each call is a real, billed Gemini request.
 *
 *   bun scripts/benchmark/run.ts --split calibration --variant calibrated --runs 1 \
 *     --limit 6 --max-usd 1 --yes --out benchmark-results/cal-1.jsonl
 *
 * Safeguards: refuses to call the model without --yes; estimates the cost before any
 * call and aborts above --max-usd; disables the Flash fallback so every run in a
 * comparison uses the same model; never writes essay text to the results file.
 * Secrets are read from the env file and never printed.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import chunks from '../../data/knowledge/kb/chunks.json'
import { correctEssay } from '../../src/server/correction.server'
import type { PromptVariant } from '../../src/server/correction.server'
import type { Env } from '../../src/server/env.server'
import { COMPETENCIES, buildDataset, metamorphicItems } from './lib'
import { loadStored } from './report'
import type { BenchItem, Competency, Finding, KbChunk, RunRecord, Split } from './lib'

/** Mean observed cost per call (local usage ledger; calibrated estimated from prompt size). */
const ESTIMATED_USD: Record<PromptVariant, number> = { baseline: 0.05, calibrated: 0.07 }

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}
const flag = (name: string) => process.argv.includes(`--${name}`)

function loadEnv(file: string): Env {
  const env: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return env as unknown as Env
}

export function selectItems(): BenchItem[] {
  const base = buildDataset((chunks as unknown as { chunks: KbChunk[] }).chunks)
  const all = [...base, ...metamorphicItems(base)]
  // --local-d1 adds locally stored essays that are not in the cartilhas (stability only).
  const d1 = arg('local-d1')
  if (d1) all.push(...loadStored(d1, all).extra)
  const split = arg('split') as Split | undefined
  const ids = arg('ids')?.split(',')
  let items = all.filter((i) => (!split || i.split === split) && (!ids || ids.includes(i.id)))
  const limit = Number(arg('limit', '0'))
  if (limit > 0) items = items.slice(0, limit)
  return items
}

function byCompetency(
  result: Awaited<ReturnType<typeof correctEssay>>,
  keep: (f: Finding) => boolean,
): Record<Competency, Finding[]> {
  const out = Object.fromEntries(COMPETENCIES.map((c) => [c, [] as Finding[]])) as Record<
    Competency,
    Finding[]
  >
  if (result.diagnostics?.competencies.length) {
    for (const c of result.diagnostics.competencies)
      out[c.id] = c.findings.filter(keep).map(({ kind, description, quote }) => ({ kind, description, quote }))
  } else if (keep({ kind: 'desvio', description: '', quote: null })) {
    for (const c of result.result.competencies)
      out[c.id] = c.problems.map((p) => ({ kind: 'desvio', ...p }))
  }
  return out
}

async function main() {
  const variants: PromptVariant[] =
    arg('variant', 'calibrated') === 'both'
      ? ['baseline', 'calibrated']
      : [arg('variant', 'calibrated') as PromptVariant]
  const runs = Number(arg('runs', '1'))
  const concurrency = Math.max(1, Number(arg('concurrency', '2')))
  const maxUsd = Number(arg('max-usd', '0'))
  const out = resolve(arg('out', 'benchmark-results/results.jsonl')!)
  const items = selectItems()
  const calls = items.length * runs * variants.length
  const estimate = items.length * runs * variants.reduce((s, v) => s + ESTIMATED_USD[v], 0)
  console.log(
    `${items.length} redações × ${runs} execução(ões) × ${variants.join('+')} = ${calls} chamadas; estimativa US$ ${estimate.toFixed(2)}`,
  )
  if (!flag('yes')) {
    console.log('Nada foi executado. Repita com --yes e --max-usd para autorizar chamadas pagas.')
    return
  }
  if (!(maxUsd > 0) || estimate > maxUsd) {
    console.error(`Estimativa acima do limite (--max-usd ${maxUsd}). Abortado sem chamadas.`)
    process.exit(1)
  }
  const envFile = resolve(arg('env', '.dev.vars')!)
  if (!existsSync(envFile)) throw new Error(`Arquivo de ambiente ausente: ${envFile}`)
  const env = loadEnv(envFile)
  // Same model for every run of a comparison: no silent switch to the fallback model.
  const model = env.GEMINI_MODEL?.trim() || 'gemini-4-argon'
  const runEnv = { ...env, GEMINI_MODEL: model, GEMINI_FALLBACK_MODEL: model } as Env
  mkdirSync(dirname(out), { recursive: true })

  const queue = items.flatMap((item) =>
    variants.flatMap((variant) => Array.from({ length: runs }, (_, run) => ({ item, variant, run }))),
  )
  let spent = 0
  let done = 0
  async function worker() {
    for (;;) {
      const job = queue.shift()
      if (!job) return
      if (spent > maxUsd) return
      const started = Date.now()
      const record: RunRecord = {
        itemId: job.item.id,
        variant: job.variant,
        run: job.run,
        promptVersion: '',
        model,
        ok: false,
      }
      try {
        // Transient provider overload (503/429) is retried; it says nothing about grading.
        let result: Awaited<ReturnType<typeof correctEssay>> | undefined
        for (let attempt = 0; !result; attempt++) {
          try {
            result = await correctEssay(
              {
                requestId: crypto.randomUUID(),
                theme: job.item.theme,
                essay: job.item.essay,
                pipeline: 'single',
                modelChoice: 'argon',
              },
              runEnv,
              undefined,
              { variant: job.variant },
            )
          } catch (error) {
            const transient =
              error instanceof Error && /alta demanda|limitando solicitações/.test(error.message)
            if (!transient || attempt >= 2) throw error
            await new Promise((r) => setTimeout(r, 20_000 * (attempt + 1)))
          }
        }
        const scores = Object.fromEntries(
          result.result.competencies.map((c) => [c.id, c.score]),
        ) as RunRecord['scores']
        Object.assign(record, {
          ok: true,
          promptVersion: result.diagnostics?.promptVersion ?? '',
          model: result.usage.model,
          scores,
          total: result.result.total,
          deviations: byCompetency(result, (f) => f.kind === 'desvio'),
          observations: byCompetency(result, (f) => f.kind !== 'desvio'),
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          thoughtTokens: result.usage.thoughtTokens,
          costUsd: result.usage.estimatedCostUsd,
        })
        spent += result.usage.estimatedCostUsd
      } catch (error) {
        record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      }
      record.latencyMs = Date.now() - started
      appendFileSync(out, `${JSON.stringify(record)}\n`)
      done += 1
      console.log(
        `[${done}/${calls}] ${job.item.id} ${job.variant}#${job.run} ${record.ok ? `${record.total} ${JSON.stringify(record.scores)}` : `ERRO ${record.error}`} (${Math.round(record.latencyMs / 1000)}s, US$ ${spent.toFixed(3)})`,
      )
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  console.log(`Concluído. Gasto estimado US$ ${spent.toFixed(3)}. Resultados: ${out}`)
}

if (import.meta.main) await main()
