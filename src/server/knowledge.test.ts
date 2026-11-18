import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import legacyRubric from '../../data/rubric-2026.json'
import index from '../../data/knowledge/kb/index.json'
import {
  getKnowledgeStats,
  searchKnowledge,
  stem,
  tokenize,
} from './knowledge.server'
import { analyzeEssayDiagnostics, retrieveExamples } from './rag.server'
import {
  applyScoreCeilings,
  getCanonicalRubric,
  getLevelDescriptor,
} from './rubric.server'
import type { CompetencyId } from './rubric.server'

const KB_DIR = resolve(import.meta.dir, '../../data/knowledge')
const readJson = <T = Record<string, unknown>>(...parts: string[]): T =>
  JSON.parse(readFileSync(resolve(KB_DIR, ...parts), 'utf8')) as T

type StoredDocument = {
  id: string
  year: number
  file: string
  sha256: string
  theme: string | null
  samples: { scoreDocumented: number | null; examYear: number | null }
  rubric: Record<string, { levels: { score: number; quality: string }[] }>
  essays: {
    index: number
    author: string | null
    paragraphs: { text: string; quality: string; pdfPages: [number, number] }[]
    commentary: { text: string; quality: string; pdfPages: [number, number] }[]
    scoreDocumented: number | null
  }[]
  validation: { status: string; checks: { id: string; status: string }[] }
  extraction: { ocrPages: number[] }
}

const documentFiles = readdirSync(resolve(KB_DIR, 'documents')).filter((f) =>
  /^cartilha-\d{4}\.json$/.test(f),
)
const documents = documentFiles.map((f) =>
  readJson<StoredDocument>('documents', f),
)

const norm = (t: string) =>
  t
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

describe('Knowledge base artifacts (extraction → validation)', () => {
  test('every stored edition passed validation and keeps the identity of its PDF', () => {
    expect(documents.length).toBeGreaterThanOrEqual(8)
    const manifest = readJson<{
      documents: Record<string, { file: string; sha256: string }>
    }>('manifest.json')
    for (const doc of documents) {
      expect(doc.validation.status).not.toBe('failed')
      expect(manifest.documents[String(doc.year)].sha256).toBe(doc.sha256)
      expect(doc.file).toBe(`cartilha_enem_${doc.year}.pdf`)
    }
  })

  test('all five competencies and six performance levels were extracted in every edition', () => {
    for (const doc of documents) {
      expect(Object.keys(doc.rubric).sort()).toEqual([
        'I',
        'II',
        'III',
        'IV',
        'V',
      ])
      for (const comp of Object.values(doc.rubric)) {
        expect(comp.levels.map((l) => l.score)).toEqual([
          200, 160, 120, 80, 40, 0,
        ])
      }
    }
  })

  test('essays are paired with their commentary and keep PDF page provenance', () => {
    for (const doc of documents) {
      expect(doc.essays.length).toBeGreaterThanOrEqual(7)
      for (const essay of doc.essays) {
        expect(essay.author).toBeTruthy()
        expect(essay.paragraphs.length).toBeGreaterThanOrEqual(3)
        expect(essay.commentary.length).toBeGreaterThanOrEqual(3)
        const essayEnd = Math.max(...essay.paragraphs.map((p) => p.pdfPages[1]))
        const commentStart = Math.min(
          ...essay.commentary.map((p) => p.pdfPages[0]),
        )
        expect(commentStart).toBeGreaterThanOrEqual(essayEnd)
      }
    }
  })

  test('only scores printed in the cartilha are recorded (recent samples are not assumed to be 1000)', () => {
    const byYear = new Map(documents.map((d) => [d.year, d]))
    for (const year of [2018, 2019, 2020, 2022, 2023, 2024]) {
      expect(byYear.get(year)?.samples.scoreDocumented).toBe(1000)
    }
    for (const year of [2025, 2026]) {
      expect(byYear.get(year)?.samples.scoreDocumented).toBeNull()
    }
  })

  test('no unreadable text is validated: OCR and degraded blocks never reach the index', () => {
    const corrupt = /[-�]|[Ѐ-ӿ]/
    for (const chunk of index.chunks) {
      expect(corrupt.test(chunk.text)).toBe(false)
      expect(chunk.pdfPages.length).toBe(2)
    }
    const quarantined = readJson<{ chunks: { quality: string; id: string }[] }>(
      'kb',
      'chunks.json',
    ).chunks.filter((c) => c.quality !== 'ok')
    const indexedIds = new Set(index.chunks.map((c) => c.id))
    for (const c of quarantined) expect(indexedIds.has(c.id)).toBe(false)
    expect(quarantined.length).toBeGreaterThan(0) // 2023-2025 have fonts that cannot be recovered
  })
})

describe('Index consistency', () => {
  test('ids are unique, nothing is duplicated and superseded editions keep provenance', () => {
    const ids = index.chunks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const guidance = index.chunks.filter(
      (c) => c.category !== 'redacao_comentada',
    )
    const checksums = guidance.map((c) => c.checksum)
    expect(new Set(checksums).size).toBe(checksums.length)
    const all = readJson<{ chunks: { id: string; supersededBy?: string }[] }>(
      'kb',
      'chunks.json',
    ).chunks
    const superseded = all.filter((c) => c.supersededBy)
    expect(superseded.length).toBeGreaterThan(0)
    for (const c of superseded) {
      expect(ids.includes(c.id)).toBe(false)
      expect(all.some((w) => w.id === c.supersededBy)).toBe(true)
    }
  })

  test('commentary chunks point to an essay record with author and pages', () => {
    const essays = index.essays as Record<
      string,
      { author: string | null; pdfPages: number[]; commentChunkIds: string[] }
    >
    const commentary = index.chunks.filter((c) => c.kind === 'commentary')
    expect(commentary.length).toBeGreaterThan(100)
    for (const c of commentary) {
      const essay = essays[c.essayId as string] as
        (typeof essays)[string] | undefined
      expect(essay).toBeDefined()
      expect(essay?.author).toBeTruthy()
      expect(essay?.commentChunkIds).toContain(c.id)
    }
  })

  test('stats reflect the three categories and all editions', () => {
    const stats = getKnowledgeStats()
    expect(stats.years).toEqual([
      2018, 2019, 2020, 2022, 2023, 2024, 2025, 2026,
    ])
    expect(Object.keys(stats.byCategory).sort()).toEqual([
      'exemplo',
      'orientacao',
      'redacao_comentada',
    ])
  })
})

describe('Retrieval', () => {
  const hasCompetency = (
    hits: { competencies: CompetencyId[] }[],
    c: CompetencyId,
  ) => hits.some((h) => h.competencies.includes(c))

  test('socio-cultural repertoire queries return Competency II guidance with provenance', () => {
    const result = searchKnowledge({
      text: 'repertório sociocultural produtivo repertório de bolso',
      limit: 3,
    })
    expect(result.status).toBe('ok')
    expect(result.hits.length).toBeGreaterThan(0)
    expect(hasCompetency(result.hits, 'II')).toBe(true)
    for (const hit of result.hits) {
      expect(hit.source.publisher).toBe('Inep/MEC')
      expect(hit.source.pdfPages[0]).toBeGreaterThan(0)
      expect(hit.source.citation).toContain('Cartilha do Participante ENEM')
    }
  })

  test('cohesion queries return Competency IV material', () => {
    const result = searchKnowledge({
      text: 'coesão conectivos operadores argumentativos',
      limit: 3,
    })
    expect(result.status).toBe('ok')
    expect(hasCompetency(result.hits, 'IV')).toBe(true)
    expect(result.hits[0]?.competencies).toContain('IV')
  })

  test('intervention-proposal queries return Competency V material', () => {
    const result = searchKnowledge({
      text: 'proposta de intervenção agente ação meio efeito detalhamento',
      limit: 3,
    })
    expect(result.status).toBe('ok')
    expect(hasCompetency(result.hits, 'V')).toBe(true)
    expect(result.hits[0]?.competencies).toContain('V')
  })

  test('competency and year filters are honored', () => {
    const result = searchKnowledge({
      text: 'proposta de intervenção',
      competencies: ['V'],
      years: [2026],
      limit: 8,
    })
    expect(result.status).toBe('ok')
    for (const hit of result.hits) {
      expect(hit.year).toBe(2026)
      expect(hit.competencies).toContain('V')
    }
  })

  test('commented essays come back with origin, essay metadata and documented score', () => {
    const result = searchKnowledge({
      text: 'proposta de intervenção agente ação meio efeito',
      categories: ['redacao_comentada'],
      competencies: ['V'],
      limit: 8,
    })
    expect(result.status).toBe('ok')
    for (const hit of result.hits) {
      expect(hit.category).toBe('redacao_comentada')
      expect(hit.essay?.author).toBeTruthy()
      expect(hit.essay?.excerpt.length).toBeGreaterThan(100)
      expect(hit.source.pdfPages).toBeDefined()
      if (hit.year >= 2025) expect(hit.essay?.scoreDocumented).toBeNull()
      else expect(hit.essay?.scoreDocumented).toBe(1000)
    }
  })

  test('equivalent text from older editions is folded into the newest one, keeping provenance', () => {
    const hits = [
      'proposta de intervenção',
      'coesão textual',
      'repertório sociocultural',
      'tangenciamento ao tema',
      'nota zero fuga ao tema',
    ].flatMap(
      (text) =>
        searchKnowledge({ text, limit: 8, categories: ['orientacao'] }).hits,
    )
    const folded = hits.filter((h) => h.source.alsoIn.length > 0)
    expect(folded.length).toBeGreaterThan(0)
    for (const hit of folded)
      for (const older of hit.source.alsoIn)
        expect(older.year).toBeLessThan(hit.year)
  })

  test('absence of evidence is explicit, not fabricated', () => {
    const result = searchKnowledge({
      text: 'receita de bolo de chocolate com cobertura de morango',
    })
    expect(result.status).toBe('no_evidence')
    expect(result.hits).toEqual([])
    expect(searchKnowledge({ text: '   ' }).status).toBe('no_evidence')
    expect(searchKnowledge({ text: 'coesão', years: [1999] }).status).toBe(
      'no_evidence',
    )
  })

  test('results are not padded to the requested size', () => {
    const result = searchKnowledge({
      text: 'transtorno do espectro autista avaliação',
      limit: 8,
    })
    expect(result.status).toBe('ok')
    expect(result.hits.length).toBeLessThan(8)
  })

  test('tokenizer folds accents and plurals', () => {
    expect(stem('operacoes')).toBe(stem('operacao'))
    expect(stem('conectivos')).toBe(stem('conectivo'))
    expect(tokenize('Coesão, conectivos e repertórios')).toEqual(
      tokenize('COESAO conectivo repertorio'),
    )
  })
})

describe('Essay-driven retrieval keeps the rubric in charge', () => {
  const noIntervention = [
    'Segundo a Constituição Federal de 1988, a dignidade da pessoa humana é um fundamento do Brasil. Contudo, na sociedade brasileira contemporânea, as perspectivas acerca do envelhecimento ainda são marcadas pelo etarismo e pela exclusão.',
    'Em primeira análise, cabe destacar que o preconceito contra idosos no mercado de trabalho reduz sua autonomia. De acordo com dados do IBGE, a população idosa cresce rapidamente, mas enfrenta barreiras severas de inserção social.',
    'Portanto, percebe-se que o problema do envelhecimento no Brasil é muito grave e faltam investimentos para que a realidade melhore no futuro.',
  ].join('\n\n')

  test('returns official Competency V evidence with provenance and never exceeds the limit', async () => {
    const examples = await retrieveExamples(noIntervention, 3)
    expect(examples.length).toBeGreaterThan(0)
    expect(examples.length).toBeLessThanOrEqual(3)
    expect(examples.some((e) => e.relatedCompetencies.includes('V'))).toBe(true)
    for (const e of examples) {
      expect(e.citation).toContain('Cartilha do Participante ENEM')
      expect(e.pdfPages[0]).toBeGreaterThan(0)
      expect(e.excerpt.length).toBeLessThanOrEqual(2_000)
    }
  })

  test('queries are built from problems, not from the essay topic', async () => {
    const profile = analyzeEssayDiagnostics(noIntervention)
    expect(profile.detectedTags).toContain('proposta_de_intervencao')
    const examples = await retrieveExamples(noIntervention, 5)
    // The essay talks about aging; the 2026 sample essays do too. Results must not be
    // restricted to that edition just because of topical overlap.
    const years = new Set(examples.map((e) => e.year))
    expect(years.size).toBeGreaterThanOrEqual(1)
    expect(
      examples.every(
        (e) => e.scoreDocumented === null || e.scoreDocumented === 1000,
      ),
    ).toBe(true)
  })
})

describe('Canonical rubric', () => {
  test('has five competencies with the six official levels, all readable and with provenance', () => {
    const rubric = getCanonicalRubric()
    expect(rubric.canonicalYear).toBe(2026)
    expect(rubric.competencies.map((c) => c.id)).toEqual([
      'I',
      'II',
      'III',
      'IV',
      'V',
    ])
    for (const comp of rubric.competencies) {
      expect(comp.levels.map((l) => l.score)).toEqual([
        200, 160, 120, 80, 40, 0,
      ])
      for (const level of comp.levels) {
        expect(level.quality).toBe('ok')
        expect(level.source.pdfPages?.[0]).toBeGreaterThan(0)
        expect(level.source.file).toBe('cartilha_enem_2026.pdf')
      }
    }
    expect(getLevelDescriptor('V', 200)).toContain('proposta de intervenção')
  })

  test('the descriptors used by the corrector prompt match the official 2026 cartilha', () => {
    const rubric = getCanonicalRubric()
    for (const legacy of legacyRubric.competencies) {
      const canonical = rubric.competencies.find((c) => c.id === legacy.id)
      expect(canonical).toBeDefined()
      expect(norm(legacy.title)).toBe(norm(canonical?.officialTitle ?? ''))
      for (const level of legacy.levels) {
        expect(norm(level.description)).toBe(
          norm(
            canonical?.levels.find((l) => l.score === level.score)
              ?.descriptor ?? '',
          ),
        )
      }
    }
  })

  test('annulment and discrepancy rules are structured with provenance', () => {
    const rules = getCanonicalRubric().rules
    expect(rules.filter((r) => r.kind === 'annulment').length).toBe(10)
    expect(rules.filter((r) => r.kind === 'discrepancy').length).toBe(4)
    expect(
      rules.some(
        (r) => r.kind === 'annulment' && /fuga total ao tema/i.test(r.text),
      ),
    ).toBe(true)
    for (const rule of rules)
      expect(rule.source.pdfPages?.[0]).toBeGreaterThan(0)
  })

  test('explicit score effects are applied deterministically and never raise a score', () => {
    const base = { I: 160, II: 120, III: 160, IV: 200, V: 80 } as Record<
      CompetencyId,
      number
    >
    const tang = applyScoreCeilings(base, ['tangenciamento_ao_tema'])
    expect(tang.scores).toEqual({ I: 160, II: 40, III: 40, IV: 200, V: 40 })
    expect(
      applyScoreCeilings(base, ['fuga_ao_tema_ou_tipo_textual']).scores,
    ).toEqual({ I: 0, II: 0, III: 0, IV: 0, V: 0 })
    expect(
      applyScoreCeilings(base, ['desrespeito_direitos_humanos']).scores.V,
    ).toBe(0)
    expect(
      applyScoreCeilings({ I: 0, II: 0, III: 0, IV: 0, V: 0 }, [
        'tangenciamento_ao_tema',
      ]).scores.II,
    ).toBe(0)
    expect(applyScoreCeilings(base, []).scores).toEqual(base)
  })

  test('edition variants never alter the canonical baseline', () => {
    const variants = readJson<{
      baselineYear: number
      editions: Record<string, { levelSummary: Record<string, number> }>
    }>('rubric', 'variants.json')
    expect(variants.baselineYear).toBe(2026)
    expect(existsSync(resolve(KB_DIR, 'rubric', 'canonical-2026.json'))).toBe(
      true,
    )
    // the cartilhas state that the descriptors did not change substantively: nothing is "changed"
    for (const edition of Object.values(variants.editions))
      expect(edition.levelSummary.changed).toBeUndefined()
  })
})
