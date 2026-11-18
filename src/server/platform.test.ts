import { Database } from 'bun:sqlite'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import rubric from '../../data/rubric-2026.json'
import commentedEssays from '../../data/extracted/commented-essays-2026.json'
import ragIndex from '../../data/extracted/rag-index-2026.json'
import { correctionReferenceSchema } from '../lib/correction'
import {
  getTrustedOrigins,
  isAllowedEmail,
  isTrustedOrigin,
  sanitizeEnv,
  stripQuotes,
} from './access-policy'
import { isAuthConfigured } from './auth.server'
import {
  getCorrectionResponseSchema,
  isHighDemandUnavailableError,
  providerFailure,
} from './correction.server'
import type { Env } from './env.server'
import { AppError } from './errors.server'
import { analyzeEssayDiagnostics, retrieveExamples } from './rag.server'
import { assertSameOrigin } from './security.server'
import {
  RESERVATION_TTL_MS,
  finishUsage,
  reserveUsage,
  verifyTurnstileIfConfigured,
} from './usage.server'

function createSqliteD1Stub(): {
  db: D1Database
  raw: Database
} {
  const sqlite = new Database(':memory:')
  // Every migration, in order, as in production.
  const dir = resolve(import.meta.dir, '../../migrations')
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(resolve(dir, file), 'utf8'))

  const createStatement = (
    sql: string,
    boundValues: unknown[] = [],
  ): D1PreparedStatement => {
    return {
      bind(...values: unknown[]) {
        return createStatement(sql, values)
      },
      async run() {
        const stmt = sqlite.prepare(sql)
        const result = stmt.run(...(boundValues as never[]))
        return {
          success: true,
          results: [],
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: 0,
            rows_written: result.changes,
            last_row_id: Number(result.lastInsertRowid),
            changed_db: result.changes > 0,
            changes: result.changes,
          },
        }
      },
      async first<T = Record<string, unknown>>(
        colName?: string,
      ): Promise<T | null> {
        const stmt = sqlite.prepare(sql)
        const row = stmt.get(...(boundValues as never[])) as Record<
          string,
          unknown
        > | null
        if (!row) return null
        if (colName) return (row[colName] as T) ?? null
        return row as T
      },
      async all<T = Record<string, unknown>>() {
        const stmt = sqlite.prepare(sql)
        const rows = stmt.all(...(boundValues as never[])) as T[]
        return {
          success: true,
          results: rows,
          meta: {
            duration: 0,
            size_after: 0,
            rows_read: rows.length,
            rows_written: 0,
            last_row_id: 0,
            changed_db: false,
            changes: 0,
          },
        }
      },
      async raw() {
        return []
      },
    } as unknown as D1PreparedStatement
  }

  const db = {
    prepare(sql: string) {
      return createStatement(sql)
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      const out = []
      for (const stmt of statements) {
        out.push(await stmt.run())
      }
      return out as D1Result<T>[]
    },
    async exec(sql: string) {
      sqlite.exec(sql)
      return { count: 1, duration: 0 }
    },
    async dump() {
      return new ArrayBuffer(0)
    },
    withSession() {
      return this as unknown as D1DatabaseSession
    },
  }

  return { db, raw: sqlite }
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  const { db } = createSqliteD1Stub()
  return {
    DB: db,
    BURST_LIMITER: {
      async limit() {
        return { success: true }
      },
    },
    BETTER_AUTH_SECRET: 'test-secret-with-at-least-32-chars-123456',
    BETTER_AUTH_URL: 'https://redacao.example.com',
    GOOGLE_CLIENT_ID: 'test-google-client-id',
    GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
    ALLOWED_EMAILS: 'aluna@gmail.com, familia@example.com',
    GEMINI_API_KEY: 'test-gemini-api-key',
    GEMINI_MODEL: 'gemini-4-argon',
    MONTHLY_CORRECTION_LIMIT: '50',
    DAILY_USER_LIMIT: '10',
    GLOBAL_CONCURRENT_LIMIT: '2',
    ...overrides,
  }
}

describe('Official ENEM 2026 Rubric & Extracted Cartilha Artifacts', () => {
  test('validates rubric metadata, 5 competencies, 6 score levels (0..200) and invalidation rules', () => {
    expect(rubric.metadata.reviewed).toBe(true)
    expect(rubric.metadata.year).toBe(2026)
    expect(rubric.competencies).toHaveLength(5)

    const ids = rubric.competencies.map((c) => c.id)
    expect(ids).toEqual(['I', 'II', 'III', 'IV', 'V'])

    for (const comp of rubric.competencies) {
      expect(comp.title.length).toBeGreaterThan(20)
      const scores = comp.levels.map((lvl) => lvl.score)
      expect(scores).toEqual([0, 40, 80, 120, 160, 200])
      for (const lvl of comp.levels) {
        expect(lvl.description.length).toBeGreaterThan(15)
      }
    }

    expect(rubric.invalidationRules.textual.assessableFromTypedInput).toBe(true)
    expect(
      rubric.invalidationRules.textual.conditions.length,
    ).toBeGreaterThanOrEqual(7)
    expect(rubric.invalidationRules.handwritten.assessableFromTypedInput).toBe(
      false,
    )
    expect(
      rubric.invalidationRules.handwritten.conditions.length,
    ).toBeGreaterThanOrEqual(4)
    expect(rubric.interventionProposalRules.requiredElements).toHaveLength(5)
  })

  test('ensures extracted commented essays and RAG chunks do not contain invented numeric scores', () => {
    expect(commentedEssays.essays).toHaveLength(10)
    expect(ragIndex.chunks.length).toBeGreaterThanOrEqual(50)

    const forbiddenKeys = [
      'score',
      'scores',
      'totalScore',
      'competenceScores',
      'nota',
    ]
    for (const essay of commentedEssays.essays) {
      for (const key of forbiddenKeys) {
        expect(key in essay).toBe(false)
      }
      expect(essay.essayText.length).toBeGreaterThan(800)
      expect(essay.officialCommentary.length).toBeGreaterThan(600)
      for (const para of essay.commentaryParagraphs) {
        expect(para.length).toBeGreaterThanOrEqual(80)
      }
    }

    for (const chunk of ragIndex.chunks) {
      for (const key of forbiddenKeys) {
        expect(key in chunk).toBe(false)
      }
      expect(chunk.essayId).toMatch(/^enem-2025-cartilha-2026-amostra-\d{2}$/)
      expect(chunk.excerpt.length).toBeGreaterThanOrEqual(80)
    }
  })
})

describe('Local Pedagogical RAG (retrieveExamples & analyzeEssayDiagnostics)', () => {
  test('targets Competency V when the essay conclusion lacks intervention proposal elements', async () => {
    const essayMissingIntervention = [
      'Segundo a Constituição Federal de 1988, a dignidade da pessoa humana é um fundamento do Brasil. Contudo, na sociedade brasileira contemporânea, as perspectivas acerca do envelhecimento ainda são marcadas pelo etarismo e pela exclusão.',
      'Em primeira análise, cabe destacar que o preconceito contra idosos no mercado de trabalho reduz sua autonomia. De acordo com dados do IBGE, a população idosa cresce rapidamente, mas enfrenta barreiras severas de inserção social.',
      'Ademais, observa-se que a invisibilidade nos meios de comunicação reforça estereótipos negativos sobre a velhice, prejudicando a saúde mental desse grupo.',
      'Portanto, percebe-se que o problema do envelhecimento no Brasil é muito grave e faltam investimentos para que a realidade melhore no futuro.',
    ].join('\n\n')

    const profile = analyzeEssayDiagnostics(essayMissingIntervention)
    expect(profile.detectedTags).toContain('proposta_de_intervencao')
    expect(profile.competencyWeights.V).toBeGreaterThan(3)

    const examples = await retrieveExamples(essayMissingIntervention, 3)
    expect(examples.length).toBeGreaterThan(0)
    expect(examples.length).toBeLessThanOrEqual(3)
    for (const ex of examples) {
      expect(() => correctionReferenceSchema.parse(ex)).not.toThrow()
    }
    expect(examples.some((ex) => ex.relatedCompetencies.includes('V'))).toBe(
      true,
    )
  })

  test('targets Competency IV when the essay has poor cohesion and repeated terms', async () => {
    const essayPoorCohesion =
      'O idoso sofre muito no Brasil porque o idoso não tem apoio e o idoso fica isolado na sociedade porque o idoso precisa de saúde e o idoso não consegue atendimento digno na cidade.'

    const profile = analyzeEssayDiagnostics(essayPoorCohesion)
    expect(profile.detectedTags).toContain('coesao_textual')
    expect(profile.competencyWeights.IV).toBeGreaterThan(3)

    const examples = await retrieveExamples(essayPoorCohesion, 3)
    expect(examples.length).toBeGreaterThan(0)
    expect(examples.length).toBeLessThanOrEqual(3)
    expect(examples.some((ex) => ex.relatedCompetencies.includes('IV'))).toBe(
      true,
    )
  })

  test('targets Competency I when the essay contains informal register, regency errors, or overly long sentences', async () => {
    const essayInformalAndLongSentence = [
      'A gente vê que hoje em dia no Brasil o envelhecimento ocasiona em muitos problemas pra população mais velha que trabalha demais e não tem descanso nem lazer na terceira idade porque todo mundo ignora os direitos deles na sociedade atual.',
      'Isso acarreta em exclusão social, tipo assim, haviam muitos casos onde que os idosos ficavam sem assistência.',
      'Por conseguinte, o Ministério dos Direitos Humanos deve promover campanhas educativas, por meio das redes sociais e de palestras comunitárias, a fim de combater o etarismo.',
    ].join('\n\n')

    const profile = analyzeEssayDiagnostics(essayInformalAndLongSentence)
    expect(profile.detectedTags).toContain('norma_padrao')
    expect(profile.detectedTags).toContain('periodos_longos')

    const examples = await retrieveExamples(essayInformalAndLongSentence, 3)
    expect(examples.length).toBeGreaterThan(0)
    expect(examples.length).toBeLessThanOrEqual(3)
    expect(examples.some((ex) => ex.relatedCompetencies.includes('I'))).toBe(
      true,
    )
  })

  test('degrades gracefully on empty input', async () => {
    expect(await retrieveExamples('', 3)).toEqual([])
    expect(await retrieveExamples('   ', 3)).toEqual([])
  })
})

describe('Access Control, CSRF/Origin Security & Turnstile', () => {
  test('isAllowedEmail enforces strict allowlist with case-insensitive matching and strips quotes', () => {
    const allowlist =
      '"Maria.Estudante@gmail.com, pai@example.com;\nmae@escola.br"'
    expect(isAllowedEmail('maria.estudante@gmail.com', allowlist)).toBe(true)
    expect(isAllowedEmail('  PAI@EXAMPLE.COM ', allowlist)).toBe(true)
    expect(isAllowedEmail('mae@escola.br', allowlist)).toBe(true)
    expect(isAllowedEmail('intruso@gmail.com', allowlist)).toBe(false)
    expect(isAllowedEmail('', allowlist)).toBe(false)
  })

  test('stripQuotes and sanitizeEnv remove surrounding quotes from .env.local values', () => {
    expect(stripQuotes('"http://127.0.0.1:3000"')).toBe('http://127.0.0.1:3000')
    expect(stripQuotes("'gemini-4-argon'")).toBe('gemini-4-argon')
    expect(stripQuotes('  sem-aspas  ')).toBe('sem-aspas')

    const sanitized = sanitizeEnv({
      BETTER_AUTH_URL: '"http://127.0.0.1:3000"',
      DAILY_USER_LIMIT: '"30"',
      MONTHLY_CORRECTION_LIMIT: "'100'",
      ALLOWED_EMAILS: '"aluna@gmail.com"',
      BETTER_AUTH_SECRET: '"segredo-muito-longo-com-mais-de-32-caracteres-123"',
    })
    expect(sanitized.BETTER_AUTH_URL).toBe('http://127.0.0.1:3000')
    expect(sanitized.DAILY_USER_LIMIT).toBe('30')
    expect(sanitized.MONTHLY_CORRECTION_LIMIT).toBe('100')
    expect(sanitized.ALLOWED_EMAILS).toBe('aluna@gmail.com')

    const quotedEnv = makeEnv({
      BETTER_AUTH_URL: '"http://127.0.0.1:3000"',
      BETTER_AUTH_SECRET: '"segredo-muito-longo-com-mais-de-32-caracteres-123"',
    })
    expect(isAuthConfigured(quotedEnv)).toBe(true)
  })

  test('getTrustedOrigins and assertSameOrigin accept both 127.0.0.1 and localhost in local dev while enforcing strict origin in production', () => {
    const localOrigins = getTrustedOrigins('"http://127.0.0.1:3000"')
    expect(localOrigins.has('http://127.0.0.1:3000')).toBe(true)
    expect(localOrigins.has('http://localhost:3000')).toBe(true)
    expect(localOrigins.size).toBe(2)

    const prodOrigins = getTrustedOrigins('https://redacao.example.com')
    expect(prodOrigins.has('https://redacao.example.com')).toBe(true)
    expect(prodOrigins.has('http://localhost:3000')).toBe(false)
    expect(prodOrigins.size).toBe(1)

    const localEnv = makeEnv({ BETTER_AUTH_URL: '"http://127.0.0.1:3000"' })
    const localhostGet = new Request('http://localhost:3000/_serverFn/status', {
      method: 'GET',
    })
    expect(() => assertSameOrigin(localhostGet, localEnv)).not.toThrow()

    const localhostPost = new Request(
      'http://localhost:3000/_serverFn/correct',
      {
        method: 'POST',
        headers: { origin: 'http://localhost:3000' },
      },
    )
    expect(() => assertSameOrigin(localhostPost, localEnv)).not.toThrow()

    const unconfiguredEnv = makeEnv({ BETTER_AUTH_URL: '' })
    const unconfiguredGet = new Request(
      'http://localhost:3000/_serverFn/status',
      {
        method: 'GET',
      },
    )
    expect(() =>
      assertSameOrigin(unconfiguredGet, unconfiguredEnv),
    ).not.toThrow()
  })

  test('assertSameOrigin rejects cross-origin requests and POST without Origin header', () => {
    const env = makeEnv({ BETTER_AUTH_URL: 'https://redacao.example.com' })

    const validPost = new Request('https://redacao.example.com/api/correct', {
      method: 'POST',
      headers: { origin: 'https://redacao.example.com' },
    })
    expect(() => assertSameOrigin(validPost, env)).not.toThrow()

    const validGetWithoutOrigin = new Request('https://redacao.example.com/', {
      method: 'GET',
    })
    expect(() => assertSameOrigin(validGetWithoutOrigin, env)).not.toThrow()

    const postWithoutOrigin = new Request(
      'https://redacao.example.com/api/correct',
      {
        method: 'POST',
      },
    )
    expect(() => assertSameOrigin(postWithoutOrigin, env)).toThrow(AppError)

    const crossOriginPost = new Request(
      'https://redacao.example.com/api/correct',
      {
        method: 'POST',
        headers: { origin: 'https://evil.example.com' },
      },
    )
    expect(isTrustedOrigin(crossOriginPost, env.BETTER_AUTH_URL)).toBe(false)
    expect(() => assertSameOrigin(crossOriginPost, env)).toThrow(AppError)
  })

  test('verifyTurnstileIfConfigured bypasses when disabled and enforces token when both siteKey and secret are set', async () => {
    const envWithoutTurnstile = makeEnv({
      TURNSTILE_SITE_KEY: undefined,
      TURNSTILE_SECRET_KEY: undefined,
    })
    await expect(
      verifyTurnstileIfConfigured(envWithoutTurnstile, undefined),
    ).resolves.toBeUndefined()

    const envOnlySecret = makeEnv({
      TURNSTILE_SITE_KEY: undefined,
      TURNSTILE_SECRET_KEY: 'secret-turnstile-key',
    })
    await expect(
      verifyTurnstileIfConfigured(envOnlySecret, undefined),
    ).resolves.toBeUndefined()

    const envWithTurnstile = makeEnv({
      TURNSTILE_SITE_KEY: '0x4AAAAAAABBBCCC',
      TURNSTILE_SECRET_KEY: 'secret-turnstile-key',
    })
    await expect(
      verifyTurnstileIfConfigured(envWithTurnstile, undefined),
    ).rejects.toThrow('Confirme a verificação de segurança')
  })

  test('getCorrectionResponseSchema produces a valid Gemini OpenAPI Schema without invalid anyOf objects or raw null types', () => {
    const schema = getCorrectionResponseSchema()
    const serialized = JSON.stringify(schema)
    expect(serialized).not.toContain('"anyOf"')
    expect(serialized).not.toContain('"type":"null"')
    expect(schema.properties?.competencies.items?.properties?.score.type).toBe(
      'INTEGER',
    )
    expect(
      schema.properties?.invalidations.properties?.handwritten.properties
        ?.invalid.nullable,
    ).toBe(true)
  })

  test('isHighDemandUnavailableError and providerFailure handle 503 high demand errors', () => {
    const err503 = {
      status: 503,
      message:
        '{"error":{"code":503,"message":"This model is currently experiencing high demand.","status":"UNAVAILABLE"}}',
    }
    expect(isHighDemandUnavailableError(err503)).toBe(true)
    expect(
      isHighDemandUnavailableError({ statusCode: 429, message: 'high demand' }),
    ).toBe(false)
    const mapped = providerFailure(err503)
    expect(mapped.code).toBe('PROVIDER_UNAVAILABLE')
    expect(mapped.message).toContain('alta demanda')
  })
})

describe('D1 Atomic Quotas, Concurrency, Expiration & Cost Ledger', () => {
  test('rejects duplicate requestId and enforces max 1 concurrent correction per user', async () => {
    const { db } = createSqliteD1Stub()
    const env = makeEnv({ DB: db })
    const now = Date.parse('2026-11-04T15:00:00.000Z')

    await reserveUsage(env, 'user-1', 'req-1', now)

    // Duplicate requestId must fail
    await expect(
      reserveUsage(env, 'user-1', 'req-1', now + 100),
    ).rejects.toThrow('Esta solicitação já está em processamento')

    // Second concurrent request from the same user must fail
    await expect(
      reserveUsage(env, 'user-1', 'req-2', now + 200),
    ).rejects.toThrow('Você já possui uma correção em andamento')

    // After finishing req-1, user-1 can reserve req-2
    await finishUsage(
      env,
      'user-1',
      'req-1',
      {
        status: 'succeeded',
        model: 'gemini-4-argon',
        inputTokens: 4_500,
        outputTokens: 1_200,
        thoughtTokens: 800,
        estimatedCostUsd: 0.029,
      },
      now + 1_000,
    )

    await expect(
      reserveUsage(env, 'user-1', 'req-2', now + 1_500),
    ).resolves.toBeUndefined()
  })

  test('enforces global concurrency limit of 2 and releases slots when stale reservations expire', async () => {
    const { db } = createSqliteD1Stub()
    const env = makeEnv({ DB: db, GLOBAL_CONCURRENT_LIMIT: '2' })
    const now = Date.parse('2026-11-04T16:00:00.000Z')

    await reserveUsage(env, 'user-a', 'req-a', now)
    await reserveUsage(env, 'user-b', 'req-b', now + 100)

    // Third concurrent user must be blocked by global concurrency limit (2)
    await expect(
      reserveUsage(env, 'user-c', 'req-c', now + 200),
    ).rejects.toThrow('limite de correções simultâneas')

    // Advance clock past RESERVATION_TTL_MS (3 minutes): stale reservations auto-expire
    const afterTtl = now + RESERVATION_TTL_MS + 1_000
    await expect(
      reserveUsage(env, 'user-c', 'req-c', afterTtl),
    ).resolves.toBeUndefined()
  })

  test('enforces daily per-user limit (10/day) and monthly global limit (50/month)', async () => {
    const { db } = createSqliteD1Stub()
    const env = makeEnv({
      DB: db,
      DAILY_USER_LIMIT: '3',
      MONTHLY_CORRECTION_LIMIT: '5',
    })
    const day1 = Date.parse('2026-11-05T10:00:00.000Z')

    for (let i = 1; i <= 3; i++) {
      await reserveUsage(env, 'user-1', `d1-req-${i}`, day1 + i * 1000)
      await finishUsage(
        env,
        'user-1',
        `d1-req-${i}`,
        {
          status: 'succeeded',
          model: 'gemini-4-argon',
          inputTokens: 1000,
          outputTokens: 500,
          thoughtTokens: 200,
          estimatedCostUsd: 0.009,
        },
        day1 + i * 1000 + 500,
      )
    }

    // 4th attempt on the same UTC day for user-1 hits DAILY_USER_LIMIT (3)
    await expect(
      reserveUsage(env, 'user-1', 'd1-req-4', day1 + 10_000),
    ).rejects.toThrow('limite diário de 3 correções')

    // Another user (user-2) can still run 2 corrections in the same month until MONTHLY_CORRECTION_LIMIT (5) is reached
    for (let i = 1; i <= 2; i++) {
      await reserveUsage(env, 'user-2', `u2-req-${i}`, day1 + 20_000 + i * 1000)
      await finishUsage(
        env,
        'user-2',
        `u2-req-${i}`,
        {
          status: 'succeeded',
          model: 'gemini-4-argon',
          inputTokens: 1000,
          outputTokens: 500,
          thoughtTokens: 200,
          estimatedCostUsd: 0.009,
        },
        day1 + 20_000 + i * 1000 + 500,
      )
    }

    // 6th correction in the month hits MONTHLY_CORRECTION_LIMIT (5) even on a new day
    const day2 = Date.parse('2026-11-06T10:00:00.000Z')
    await expect(reserveUsage(env, 'user-1', 'd2-req-1', day2)).rejects.toThrow(
      'limite mensal de 5 correções',
    )
  })

  test('enforces Cloudflare Rate Limiting binding when burst limit is exceeded', async () => {
    const env = makeEnv({
      BURST_LIMITER: {
        async limit() {
          return { success: false }
        },
      },
    })
    await expect(reserveUsage(env, 'user-1', 'req-burst')).rejects.toThrow(
      'Muitas solicitações em sequência',
    )
  })
})

describe('Client Bundle Secret Isolation', () => {
  function collectFiles(dir: string): string[] {
    const entries = readdirSync(dir)
    const files: string[] = []
    for (const entry of entries) {
      const full = join(dir, entry)
      const st = statSync(full)
      if (st.isDirectory()) {
        files.push(...collectFiles(full))
      } else if (/\.(js|mjs|css|html|json)$/i.test(entry)) {
        files.push(full)
      }
    }
    return files
  }

  test.skipIf(!existsSync(resolve(import.meta.dir, '../../dist/client')))(
    'verifies dist/client contains no server secrets or server-only env identifiers',
    () => {
      const clientDistDir = resolve(import.meta.dir, '../../dist/client')
      const files = collectFiles(clientDistDir)
      expect(files.length).toBeGreaterThan(0)

      const forbiddenPatterns = [
        'GEMINI_API_KEY',
        'GOOGLE_CLIENT_SECRET',
        'ALLOWED_EMAILS',
        'TURNSTILE_SECRET_KEY',
        'MONTHLY_CORRECTION_LIMIT',
        'DAILY_USER_LIMIT',
        'GLOBAL_CONCURRENT_LIMIT',
        'cloudflare:workers',
        'usage_ledger',
        'GoogleGenAI',
        'fixture@example.invalid',
        'fixture-evaluation-1',
        'Ambiente isolado · fixtures',
        'VisualWorkbench',
        'substitua-por-um-segredo-aleatorio',
        'sua-chave-gemini-api-key',
      ]

      for (const file of files) {
        const content = readFileSync(file, 'utf-8')
        for (const forbidden of forbiddenPatterns) {
          expect(content).not.toContain(forbidden)
        }
      }
    },
  )
})
