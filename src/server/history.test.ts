import { Database } from 'bun:sqlite'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { result as fixtureResult, sampleDraft } from '../../visual/fixtures'
import { correctionResultSchema } from '../lib/correction'
import type { CorrectionRequest } from '../lib/correction'
import {
  HISTORY_LIMIT,
  HISTORY_RETENTION_MS,
  IMPORT_BATCH_SIZE,
} from '../lib/evaluation-history'
import type { EvaluationRecord } from '../lib/evaluation-history'
import { handleCorrection } from './correction-flow.server'
import type { CorrectionDeps } from './correction-flow.server'
import type { Env } from './env.server'
import { AppError } from './errors.server'
import * as api from './history-api.server'
import type { HistoryDeps } from './history-api.server'
import * as store from './history.server'

/**
 * Test-only D1 stand-in on bun:sqlite with every migration applied, foreign keys
 * enforced (as in D1) and `batch` executed as one transaction (as in D1).
 * `failWhen` injects write failures for matching SQL.
 */
function createTestD1(options: { failWhen?: (sql: string) => boolean } = {}) {
  const sqlite = new Database(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  const dir = resolve(import.meta.dir, '../../migrations')
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort())
    sqlite.exec(readFileSync(resolve(dir, file), 'utf8'))

  const state = { failWhen: options.failWhen, statements: [] as string[] }

  type Stmt = D1PreparedStatement & { runSync: () => D1Result }
  const statement = (sql: string, values: unknown[] = []): Stmt => {
    const guard = () => {
      state.statements.push(sql)
      if (state.failWhen?.(sql)) throw new Error('D1_ERROR: injected failure')
    }
    const runSync = (): D1Result => {
      guard()
      const result = sqlite.prepare(sql).run(...(values as never[]))
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
    }
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      runSync,
      run: async () => runSync(),
      first: async (column?: string) => {
        guard()
        const row = sqlite.prepare(sql).get(...(values as never[])) as Record<
          string,
          unknown
        > | null
        if (!row) return null
        return column ? (row[column] ?? null) : row
      },
      all: async () => {
        guard()
        const rows = sqlite.prepare(sql).all(...(values as never[]))
        return { success: true, results: rows, meta: {} }
      },
      raw: async () => [],
    } as unknown as Stmt
  }

  const db = {
    prepare: (sql: string) => statement(sql),
    batch: async (statements: D1PreparedStatement[]) =>
      sqlite.transaction(() => statements.map((s) => (s as Stmt).runSync()))(),
    exec: async (sql: string) => {
      sqlite.exec(sql)
      return { count: 1, duration: 0 }
    },
    dump: async () => new ArrayBuffer(0),
    withSession() {
      return this
    },
  } as unknown as D1Database

  function addUser(id: string, email = `${id}@example.com`) {
    sqlite
      .prepare(
        'INSERT INTO user (id, name, email, emailVerified) VALUES (?, ?, ?, 1)',
      )
      .run(id, id, email)
  }

  return { db, sqlite, state, addUser }
}

const ORIGIN = 'https://redacao.example.com'
const NOW = Date.parse('2026-11-05T12:00:00.000Z')
const result = correctionResultSchema.parse(fixtureResult)

function setup(options: Parameters<typeof createTestD1>[0] = {}) {
  const d1 = createTestD1(options)
  d1.addUser('user-a')
  d1.addUser('user-b')
  const env = {
    DB: d1.db,
    BETTER_AUTH_URL: ORIGIN,
    GEMINI_MODEL: 'gemini-4-argon',
  } as unknown as Env
  const session: { user: string | null } = { user: 'user-a' }
  let now = NOW
  const deps: HistoryDeps = {
    requireUser: async () => {
      if (!session.user)
        throw new AppError('AUTH_REQUIRED', 'Entre com uma conta autorizada.')
      return { id: session.user, email: `${session.user}@x`, name: 'x' }
    },
    now: () => now,
  }
  return {
    ...d1,
    env,
    session,
    deps,
    setNow: (ms: number) => (now = ms),
  }
}

const post = (origin = ORIGIN) =>
  new Request(`${ORIGIN}/_serverFn/x`, { method: 'POST', headers: { origin } })
const get = () => new Request(`${ORIGIN}/_serverFn/x`, { method: 'GET' })

function record(overrides: Partial<EvaluationRecord> = {}): EvaluationRecord {
  return {
    id: crypto.randomUUID(),
    createdAt: new Date(NOW - 60_000).toISOString(),
    input: {
      ...sampleDraft,
      supportingTexts: [...sampleDraft.supportingTexts],
    },
    result,
    rubricVersion: '2026',
    schemaVersion: 1,
    ...overrides,
  }
}

async function enable(ctx: ReturnType<typeof setup>) {
  const res = await api.updateHistoryPreference(
    post(),
    ctx.env,
    { enabled: true, consentVersion: 1 },
    ctx.deps,
  )
  expect(res.ok).toBe(true)
}

function correctionRequest(
  overrides: Partial<CorrectionRequest> = {},
): CorrectionRequest {
  return {
    requestId: crypto.randomUUID(),
    theme: sampleDraft.topic,
    essay: sampleDraft.essay,
    title: '',
    supportingTexts: [],
    ...overrides,
  }
}

function correctionDeps(ctx: ReturnType<typeof setup>) {
  const calls = { inference: 0, finished: [] as string[] }
  const deps: CorrectionDeps = {
    requireUser: ctx.deps.requireUser,
    verifyTurnstile: async () => {},
    reserveUsage: async () => {},
    finishUsage: async (_env, _user, _id, outcome) => {
      calls.finished.push(outcome.status)
    },
    runCorrection: async () => {
      calls.inference++
      return {
        result,
        usage: {
          model: 'gemini-4-argon',
          inputTokens: 1,
          outputTokens: 1,
          thoughtTokens: 0,
          estimatedCostUsd: 0.01,
        },
      }
    },
    now: ctx.deps.now,
  }
  return { deps, calls }
}

describe('Migration 0003', () => {
  test('is additive and keeps auth/usage tables intact', () => {
    const { sqlite } = setup()
    const tables = (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as { name: string }[]
    ).map((t) => t.name)
    for (const name of [
      'user',
      'session',
      'account',
      'verification',
      'usage_ledger',
      'evaluations',
      'evaluation_payloads',
      'history_preferences',
    ])
      expect(tables).toContain(name)
    const usageColumns = (
      sqlite.prepare('PRAGMA table_info(usage_ledger)').all() as {
        name: string
      }[]
    ).map((c) => c.name)
    expect(usageColumns).not.toContain('essay')
  })

  test('rejects inconsistent totals and out-of-scale scores at the database level', () => {
    const { sqlite } = setup()
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO evaluations (id, user_id, request_id, created_at, theme, total_score, c1, c2, c3, c4, c5, rubric_version, schema_version, origin, stored_at)
           VALUES ('x', 'user-a', 'x', 1, 't', 999, 200, 200, 200, 200, 200, '2026', 1, 'correction', 1)`,
        )
        .run(),
    ).toThrow()
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO evaluations (id, user_id, request_id, created_at, theme, total_score, c1, c2, c3, c4, c5, rubric_version, schema_version, origin, stored_at)
           VALUES ('x', 'user-a', 'x', 1, 't', 50, 50, 0, 0, 0, 0, '2026', 1, 'correction', 1)`,
        )
        .run(),
    ).toThrow()
  })
})

describe('Consent', () => {
  test('defaults to disabled, records grant and keeps evaluations on revocation', async () => {
    const ctx = setup()
    const initial = await api.readHistoryPreference(get(), ctx.env, ctx.deps)
    expect(initial).toEqual({
      ok: true,
      data: {
        cloudEnabled: false,
        consentVersion: null,
        consentedAt: null,
        revokedAt: null,
      },
    })
    const missingTerms = await api.updateHistoryPreference(
      post(),
      ctx.env,
      { enabled: true },
      ctx.deps,
    )
    expect(missingTerms.ok).toBe(false)

    await enable(ctx)
    await api.importHistory(post(), ctx.env, { records: [record()] }, ctx.deps)
    const revoked = await api.updateHistoryPreference(
      post(),
      ctx.env,
      { enabled: false },
      ctx.deps,
    )
    expect(revoked.ok && revoked.data.cloudEnabled).toBe(false)
    expect(revoked.ok && revoked.data.revokedAt).toBe(
      new Date(NOW).toISOString(),
    )
    expect(revoked.ok && revoked.data.consentVersion).toBe(1)
    const list = await api.listHistory(get(), ctx.env, {}, ctx.deps)
    expect(list.ok && list.data.items).toHaveLength(1)
  })
})

describe('Automatic persistence after a correction', () => {
  test('stores a valid correction before responding when consented', async () => {
    const ctx = setup()
    await enable(ctx)
    const { deps, calls } = correctionDeps(ctx)
    const req = correctionRequest()
    const res = await handleCorrection(
      post(),
      ctx.env,
      { success: true, data: req },
      deps,
    )
    expect(res.ok && res.data.total).toBe(result.total)
    expect(res.persistence).toEqual({
      status: 'saved',
      evaluationId: req.requestId,
      createdAt: new Date(NOW).toISOString(),
    })
    expect(calls).toEqual({ inference: 1, finished: ['succeeded'] })
    const row = ctx.sqlite
      .prepare(
        'SELECT model_id, rubric_version, schema_version, total_score, origin FROM evaluations WHERE id = ?',
      )
      .get(req.requestId)
    expect(row).toEqual({
      model_id: 'gemini-4-argon',
      rubric_version: '2026',
      schema_version: 1,
      total_score: result.total,
      origin: 'correction',
    })
    const opened = await api.openEvaluation(
      get(),
      ctx.env,
      { id: req.requestId },
      ctx.deps,
    )
    expect(opened.ok && opened.data?.input.essay).toBe(req.essay)
    expect(opened.ok && opened.data?.result).toEqual(result)
  })

  test('does not store without consent and says so explicitly', async () => {
    const ctx = setup()
    const { deps } = correctionDeps(ctx)
    const res = await handleCorrection(
      post(),
      ctx.env,
      { success: true, data: correctionRequest() },
      deps,
    )
    expect(res.ok).toBe(true)
    expect(res.persistence).toEqual({ status: 'disabled' })
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluations').get(),
    ).toEqual({ n: 0 })
  })

  test('a D1 write failure keeps the paid result and its usage accounting', async () => {
    const ctx = setup({
      failWhen: (sql) => sql.includes('INSERT INTO evaluations'),
    })
    await enable(ctx)
    const { deps, calls } = correctionDeps(ctx)
    const res = await handleCorrection(
      post(),
      ctx.env,
      { success: true, data: correctionRequest() },
      deps,
    )
    expect(res.ok && res.data).toEqual(result)
    expect(res.persistence).toEqual({ status: 'failed' })
    expect(calls).toEqual({ inference: 1, finished: ['succeeded'] })
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluation_payloads').get(),
    ).toEqual({ n: 0 })
  })

  test('a payload failure rolls back the metadata row (single transaction)', async () => {
    const ctx = setup({
      failWhen: (sql) => sql.includes('INSERT INTO evaluation_payloads'),
    })
    await enable(ctx)
    const out = await store.persistCorrection(
      ctx.db,
      'user-a',
      correctionRequest(),
      result,
      'm',
      NOW,
    )
    expect(out).toEqual({ status: 'failed' })
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluations').get(),
    ).toEqual({ n: 0 })
  })

  test('a repeated request id returns the stored result without new inference', async () => {
    const ctx = setup()
    await enable(ctx)
    const { deps, calls } = correctionDeps(ctx)
    const req = correctionRequest()
    await handleCorrection(post(), ctx.env, { success: true, data: req }, deps)
    const again = await handleCorrection(
      post(),
      ctx.env,
      { success: true, data: req },
      deps,
    )
    expect(again.ok && again.data).toEqual(result)
    expect(again.persistence?.status).toBe('recovered')
    expect(calls.inference).toBe(1)
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluations').get(),
    ).toEqual({ n: 1 })
  })

  test('concurrent saves of the same request create exactly one record', async () => {
    const ctx = setup()
    await enable(ctx)
    const req = correctionRequest()
    const outcomes = await Promise.all(
      Array.from({ length: 5 }, () =>
        store.persistCorrection(ctx.db, 'user-a', req, result, 'm', NOW),
      ),
    )
    expect(outcomes.every((o) => o.status === 'saved')).toBe(true)
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluation_payloads').get(),
    ).toEqual({ n: 1 })
  })

  test('a revision creates a new evaluation and leaves the original snapshot unchanged', async () => {
    const ctx = setup()
    await enable(ctx)
    const { deps } = correctionDeps(ctx)
    const original = correctionRequest()
    await handleCorrection(
      post(),
      ctx.env,
      { success: true, data: original },
      deps,
    )
    const revision = correctionRequest({
      essay: `${sampleDraft.essay}\n\nParágrafo revisado.`,
      parentId: original.requestId,
    })
    ctx.setNow(NOW + 1000)
    await handleCorrection(
      post(),
      ctx.env,
      { success: true, data: revision },
      deps,
    )
    const list = await api.listHistory(get(), ctx.env, {}, ctx.deps)
    expect(list.ok && list.data.items.map((i) => i.parentId)).toEqual([
      original.requestId,
      null,
    ])
    const first = await api.openEvaluation(
      get(),
      ctx.env,
      { id: original.requestId },
      ctx.deps,
    )
    expect(first.ok && first.data?.input.essay).toBe(original.essay)
  })

  test('the session is checked before any recovery, inference or storage', async () => {
    const ctx = setup()
    await enable(ctx)
    ctx.session.user = null
    const { deps, calls } = correctionDeps(ctx)
    const res = await handleCorrection(
      post(),
      ctx.env,
      { success: true, data: correctionRequest() },
      deps,
    )
    expect(res).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
    expect(calls.inference).toBe(0)
  })
})

describe('Synchronized history', () => {
  async function seed(ctx: ReturnType<typeof setup>, count: number) {
    const ids: string[] = []
    for (let i = 0; i < count; i++) {
      const req = correctionRequest()
      await store.persistCorrection(
        ctx.db,
        'user-a',
        req,
        result,
        'm',
        NOW - (count - i) * 1000,
      )
      ids.push(req.requestId)
    }
    return ids.reverse()
  }

  test('lists metadata only with keyset pagination, newest first', async () => {
    const ctx = setup()
    await enable(ctx)
    const ids = await seed(ctx, 12)
    const seen: string[] = []
    let cursor: string | undefined
    let pages = 0
    do {
      const page = await api.listHistory(
        get(),
        ctx.env,
        { cursor, limit: 5 },
        ctx.deps,
      )
      if (!page.ok) throw new Error(page.error.message)
      for (const item of page.data.items) {
        expect(Object.keys(item).sort()).toEqual(
          [
            'createdAt',
            'id',
            'modelId',
            'origin',
            'parentId',
            'scores',
            'theme',
            'title',
            'totalScore',
            'wordCount',
          ].sort(),
        )
        expect(JSON.stringify(item)).not.toContain(
          sampleDraft.essay.slice(0, 40),
        )
      }
      seen.push(...page.data.items.map((i) => i.id))
      cursor = page.data.nextCursor ?? undefined
      pages++
    } while (cursor)
    expect(pages).toBe(3)
    expect(seen).toEqual(ids)
    expect(
      ctx.state.statements.some(
        (sql) =>
          sql.includes('evaluation_payloads') &&
          sql.includes('SELECT') &&
          !sql.includes('WHERE EXISTS') &&
          !sql.includes('JOIN') &&
          !sql.includes('DELETE'),
      ),
    ).toBe(false)
  })

  test('rejects malformed cursors and page sizes', async () => {
    const ctx = setup()
    for (const input of [{ cursor: "1' OR 1=1 --" }, { limit: 500 }]) {
      const res = await api.listHistory(get(), ctx.env, input, ctx.deps)
      expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
  })

  test('another device of the same account reads the same evaluation without inference', async () => {
    const ctx = setup()
    await enable(ctx)
    const { deps, calls } = correctionDeps(ctx)
    const req = correctionRequest()
    await handleCorrection(post(), ctx.env, { success: true, data: req }, deps)
    // A second browser has no local state: only the session cookie identifies the account.
    const otherDevice = await api.listHistory(get(), ctx.env, {}, ctx.deps)
    expect(otherDevice.ok && otherDevice.data.items[0]?.id).toBe(req.requestId)
    const opened = await api.openEvaluation(
      get(),
      ctx.env,
      { id: req.requestId },
      ctx.deps,
    )
    expect(opened.ok && opened.data?.result).toEqual(result)
    expect(calls.inference).toBe(1)
  })

  test('accounts are isolated for list, open, delete and delete-all', async () => {
    const ctx = setup()
    await enable(ctx)
    const [id] = await seed(ctx, 1)
    ctx.session.user = 'user-b'
    const list = await api.listHistory(get(), ctx.env, {}, ctx.deps)
    expect(list.ok && list.data.items).toEqual([])
    const open = await api.openEvaluation(get(), ctx.env, { id }, ctx.deps)
    expect(open).toEqual({ ok: true, data: null })
    const del = await api.removeEvaluation(post(), ctx.env, { id }, ctx.deps)
    expect(del).toEqual({ ok: true, data: { deleted: false } })
    await api.removeAllEvaluations(post(), ctx.env, { confirm: true }, ctx.deps)
    ctx.session.user = 'user-a'
    const mine = await api.openEvaluation(get(), ctx.env, { id }, ctx.deps)
    expect(mine.ok && mine.data?.id).toBe(id)
  })

  test('deletes one evaluation or the whole history with its payloads, keeping usage records', async () => {
    const ctx = setup()
    await enable(ctx)
    ctx.sqlite
      .prepare(
        "INSERT INTO usage_ledger (request_id, user_id, status, day_key, month_key, created_at, updated_at, expires_at) VALUES ('u1', 'user-a', 'succeeded', 'd', 'm', 1, 1, 1)",
      )
      .run()
    const [first, second, third] = await seed(ctx, 3)
    const one = await api.removeEvaluation(
      post(),
      ctx.env,
      { id: first },
      ctx.deps,
    )
    expect(one).toEqual({ ok: true, data: { deleted: true } })
    expect(
      await api.openEvaluation(get(), ctx.env, { id: first }, ctx.deps),
    ).toEqual({ ok: true, data: null })
    const unconfirmed = await api.removeAllEvaluations(
      post(),
      ctx.env,
      {},
      ctx.deps,
    )
    expect(unconfirmed.ok).toBe(false)
    const all = await api.removeAllEvaluations(
      post(),
      ctx.env,
      { confirm: true },
      ctx.deps,
    )
    expect(all).toEqual({ ok: true, data: { deleted: 2 } })
    expect(second && third).toBeTruthy()
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluation_payloads').get(),
    ).toEqual({ n: 0 })
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM usage_ledger').get(),
    ).toEqual({ n: 1 })
    const pref = await api.readHistoryPreference(get(), ctx.env, ctx.deps)
    expect(pref.ok && pref.data.cloudEnabled).toBe(true)
  })

  test('retention keeps the newest 30 records and expires rows older than 90 days', async () => {
    const ctx = setup()
    await enable(ctx)
    ctx.addUser('inactive')
    // An inactive account's expired row is removed by the bounded global sweep.
    await store.insertEvaluation(
      ctx.db,
      'inactive',
      {
        id: crypto.randomUUID(),
        requestId: crypto.randomUUID(),
        createdAtMs: NOW - HISTORY_RETENTION_MS - 3_600_000,
        input: { ...sampleDraft },
        result,
        parentId: null,
        modelId: null,
        origin: 'import',
      },
      NOW,
    )
    const ids = await seed(ctx, HISTORY_LIMIT + 3)
    const list = await api.listHistory(get(), ctx.env, { limit: 30 }, ctx.deps)
    expect(list.ok && list.data.items.map((i) => i.id)).toEqual(
      ids.slice(0, HISTORY_LIMIT),
    )
    expect(list.ok && list.data.nextCursor).toBeNull()
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluations').get(),
    ).toEqual({ n: HISTORY_LIMIT })
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluation_payloads').get(),
    ).toEqual({ n: HISTORY_LIMIT })

    // 90 days later every row is expired: hidden on read and removed on the next write.
    ctx.setNow(NOW + HISTORY_RETENTION_MS + 1)
    const later = await api.listHistory(get(), ctx.env, {}, ctx.deps)
    expect(later.ok && later.data.items).toEqual([])
    expect(
      await api.openEvaluation(get(), ctx.env, { id: ids[0] }, ctx.deps),
    ).toEqual({ ok: true, data: null })
    await store.enforceRetention(
      ctx.db,
      'user-a',
      NOW + HISTORY_RETENTION_MS + 1,
    )
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluations').get(),
    ).toEqual({ n: 0 })
  })
})

describe('Import from IndexedDB', () => {
  test('requires consent, preserves ids/timestamps/results/revision links and ignores the browser owner', async () => {
    const ctx = setup()
    const parent = record({
      createdAt: new Date(NOW - 7_200_000).toISOString(),
    })
    const child = { ...record({ parentId: parent.id }), owner: 'user-b' }
    const blocked = await api.importHistory(
      post(),
      ctx.env,
      { records: [parent] },
      ctx.deps,
    )
    expect(blocked).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } })

    await enable(ctx)
    const res = await api.importHistory(
      post(),
      ctx.env,
      { records: [parent, child] },
      ctx.deps,
    )
    expect(res).toEqual({
      ok: true,
      data: {
        results: [
          { id: parent.id, status: 'imported' },
          { id: child.id, status: 'imported' },
        ],
      },
    })
    const opened = await api.openEvaluation(
      get(),
      ctx.env,
      { id: child.id },
      ctx.deps,
    )
    expect(opened.ok && opened.data).toEqual({
      id: child.id,
      createdAt: child.createdAt,
      input: child.input,
      result: child.result,
      parentId: parent.id,
      rubricVersion: '2026',
      schemaVersion: 1,
    })
    ctx.session.user = 'user-b'
    const other = await api.listHistory(get(), ctx.env, {}, ctx.deps)
    expect(other.ok && other.data.items).toEqual([])
  })

  test('duplicate and partially completed imports are resumable without duplication', async () => {
    const ctx = setup()
    await enable(ctx)
    const records = Array.from({ length: 4 }, (_, i) =>
      record({ createdAt: new Date(NOW - (i + 1) * 60_000).toISOString() }),
    )
    // First attempt stopped after two records (e.g. tab closed).
    await api.importHistory(
      post(),
      ctx.env,
      { records: records.slice(0, 2) },
      ctx.deps,
    )
    const resumed = await api.importHistory(
      post(),
      ctx.env,
      { records },
      ctx.deps,
    )
    expect(resumed.ok && resumed.data.results.map((r) => r.status)).toEqual([
      'duplicate',
      'duplicate',
      'imported',
      'imported',
    ])
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluations').get(),
    ).toEqual({ n: 4 })
  })

  test('a record already saved by the server correction is reported as duplicate', async () => {
    const ctx = setup()
    await enable(ctx)
    const req = correctionRequest()
    await store.persistCorrection(ctx.db, 'user-a', req, result, 'm', NOW)
    const res = await api.importHistory(
      post(),
      ctx.env,
      { records: [record({ id: req.requestId })] },
      ctx.deps,
    )
    expect(res.ok && res.data.results[0]?.status).toBe('duplicate')
  })

  test("another account's id is a conflict and is never overwritten or revealed", async () => {
    const ctx = setup()
    await enable(ctx)
    const shared = record()
    await api.importHistory(post(), ctx.env, { records: [shared] }, ctx.deps)
    ctx.session.user = 'user-b'
    await enable(ctx)
    const res = await api.importHistory(
      post(),
      ctx.env,
      { records: [{ ...shared, input: { ...shared.input, essay: 'Outro.' } }] },
      ctx.deps,
    )
    expect(res).toEqual({
      ok: true,
      data: {
        results: [{ id: shared.id, status: 'failed', reason: 'conflict' }],
      },
    })
    ctx.session.user = 'user-a'
    const mine = await api.openEvaluation(
      get(),
      ctx.env,
      { id: shared.id },
      ctx.deps,
    )
    expect(mine.ok && mine.data?.input.essay).toBe(shared.input.essay)
  })

  test('reports invalid, oversized, expired and out-of-retention records individually', async () => {
    const ctx = setup()
    await enable(ctx)
    const valid = record()
    const tampered = record({
      result: { ...result, total: result.total + 40 },
    })
    // Rejected by size before parsing (a schema-valid record stays far below the bound).
    const huge = { ...record(), padding: 'x'.repeat(700_000) }
    const expired = record({
      createdAt: new Date(NOW - HISTORY_RETENTION_MS - 1).toISOString(),
    })
    const res = await api.importHistory(
      post(),
      ctx.env,
      { records: [valid, tampered, huge, expired, { id: 7 }] },
      ctx.deps,
    )
    expect(res.ok && res.data.results).toEqual([
      { id: valid.id, status: 'imported' },
      { id: tampered.id, status: 'failed', reason: 'invalid' },
      { id: huge.id, status: 'failed', reason: 'too_large' },
      { id: expired.id, status: 'failed', reason: 'expired' },
      { id: '#5', status: 'failed', reason: 'invalid' },
    ])

    // Older than the newest 30: accepted by validation, then removed by retention.
    for (let i = 0; i < 6; i++)
      await api.importHistory(
        post(),
        ctx.env,
        {
          records: Array.from({ length: IMPORT_BATCH_SIZE }, () =>
            record({ createdAt: new Date(NOW - 1000 - i).toISOString() }),
          ),
        },
        ctx.deps,
      )
    const old = record({ createdAt: new Date(NOW - 86_400_000).toISOString() })
    const late = await api.importHistory(
      post(),
      ctx.env,
      { records: [old] },
      ctx.deps,
    )
    expect(late.ok && late.data.results).toEqual([
      { id: old.id, status: 'failed', reason: 'retention' },
    ])
  })

  test('rejects batches above the limit and non-array payloads', async () => {
    const ctx = setup()
    await enable(ctx)
    for (const input of [
      {
        records: Array.from({ length: IMPORT_BATCH_SIZE + 1 }, () => record()),
      },
      { records: 'x' },
      null,
    ]) {
      const res = await api.importHistory(post(), ctx.env, input, ctx.deps)
      expect(res).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    }
  })

  test('logout between batches stops the import; completed batches remain', async () => {
    const ctx = setup()
    await enable(ctx)
    const first = await api.importHistory(
      post(),
      ctx.env,
      { records: [record()] },
      ctx.deps,
    )
    expect(first.ok).toBe(true)
    ctx.session.user = null
    const second = await api.importHistory(
      post(),
      ctx.env,
      { records: [record()] },
      ctx.deps,
    )
    expect(second).toMatchObject({
      ok: false,
      error: { code: 'AUTH_REQUIRED' },
    })
    expect(
      ctx.sqlite.prepare('SELECT COUNT(*) AS n FROM evaluations').get(),
    ).toEqual({ n: 1 })
  })
})

describe('Access control and failures', () => {
  test('every history operation requires an authenticated session, reads included', async () => {
    const ctx = setup()
    ctx.session.user = null
    const calls = [
      api.listHistory(get(), ctx.env, {}, ctx.deps),
      api.openEvaluation(get(), ctx.env, { id: crypto.randomUUID() }, ctx.deps),
      api.readHistoryPreference(get(), ctx.env, ctx.deps),
      api.removeEvaluation(
        post(),
        ctx.env,
        { id: crypto.randomUUID() },
        ctx.deps,
      ),
      api.removeAllEvaluations(post(), ctx.env, { confirm: true }, ctx.deps),
      api.updateHistoryPreference(
        post(),
        ctx.env,
        { enabled: false },
        ctx.deps,
      ),
      api.importHistory(post(), ctx.env, { records: [record()] }, ctx.deps),
    ]
    for (const res of await Promise.all(calls))
      expect(res).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })

  test('the default (real) auth guard rejects requests without an authorized session', async () => {
    const ctx = setup()
    // Without Better Auth configured there can be no session: the real guard must refuse.
    const res = await api.listHistory(get(), ctx.env, {})
    expect(res).toMatchObject({ ok: false, error: { code: 'AUTH_REQUIRED' } })
  })

  test('cross-origin requests are rejected before authentication', async () => {
    const ctx = setup()
    let authChecked = false
    const deps = {
      ...ctx.deps,
      requireUser: async () => {
        authChecked = true
        return { id: 'user-a', email: 'a', name: 'a' }
      },
    }
    const res = await api.removeAllEvaluations(
      post('https://evil.example'),
      ctx.env,
      { confirm: true },
      deps,
    )
    expect(res).toMatchObject({ ok: false, error: { code: 'CSRF_REJECTED' } })
    expect(authChecked).toBe(false)
  })

  test('invalid ids are rejected and D1 read failures are reported generically', async () => {
    const ctx = setup({ failWhen: (sql) => sql.includes('FROM evaluations e') })
    const bad = await api.openEvaluation(
      get(),
      ctx.env,
      { id: "x' OR 1=1" },
      ctx.deps,
    )
    expect(bad).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } })
    const failed = await api.openEvaluation(
      get(),
      ctx.env,
      { id: crypto.randomUUID() },
      ctx.deps,
    )
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'HISTORY_UNAVAILABLE' },
    })
    expect(JSON.stringify(failed)).not.toContain('D1_ERROR')
  })

  test('a corrupted stored payload is not returned', async () => {
    const ctx = setup()
    await enable(ctx)
    const r = record()
    await api.importHistory(post(), ctx.env, { records: [r] }, ctx.deps)
    ctx.sqlite
      .prepare(
        'UPDATE evaluation_payloads SET result_json = \'{"total":5}\' WHERE evaluation_id = ?',
      )
      .run(r.id)
    const res = await api.openEvaluation(get(), ctx.env, { id: r.id }, ctx.deps)
    expect(res).toMatchObject({ ok: false, error: { code: 'INTERNAL' } })
  })
})

describe('Correction pipelines', () => {
  const dualResult = correctionResultSchema.parse({
    ...result,
    competencies: result.competencies.map((c) => (c.id === 'III' ? { ...c, score: 200, problems: [] } : c)),
    total: result.total + 40,
    execution: { pipeline: 'dual-review', auditStatus: 'completed', changedCompetencies: ['III'] },
  })
  /** What runPipeline returns for a completed dual review (models stubbed). */
  function dualRun() {
    const stageUsage = {
      model: 'gemini-3.8-flash',
      inputTokens: 10,
      outputTokens: 5,
      thoughtTokens: 1,
      cacheReadTokens: 2,
      estimatedCostUsd: 0.001,
    }
    return {
      result: dualResult,
      usage: { ...stageUsage, inputTokens: 20, outputTokens: 10, thoughtTokens: 2, cacheReadTokens: 4, estimatedCostUsd: 0.002 },
      diagnostics: { promptVersion: '2026.2-calibrated', competencies: [] },
      pipeline: 'dual-review' as const,
      auditStatus: 'completed' as const,
      initialResult: result,
      audit: {
        promptVersion: '2026.1-audit',
        initialScores: { I: 160, II: 160, III: 160, IV: 160, V: 200 },
        finalScores: { I: 160, II: 160, III: 200, IV: 160, V: 200 },
        initialTotal: 840,
        finalTotal: 880,
        changes: [
          { competency: 'III' as const, from: 160, to: 200, decision: 'aumentar' as const, accepted: true, justification: 'Atende ao descritor.' },
        ],
        rejectedFindings: 1,
        reclassifiedFindings: 0,
        acceptedMissedDeviations: 0,
      },
      stages: [
        { stage: 'corrector' as const, status: 'succeeded' as const, promptVersion: '2026.2-calibrated', latencyMs: 30_000, attempts: 1, ...stageUsage },
        { stage: 'auditor' as const, status: 'succeeded' as const, promptVersion: '2026.1-audit', latencyMs: 20_000, attempts: 1, ...stageUsage },
      ],
    }
  }

  function pipelineDeps(ctx: ReturnType<typeof setup>) {
    const calls = { inference: 0, outcomes: [] as Parameters<CorrectionDeps['finishUsage']>[3][] }
    const deps: CorrectionDeps = {
      ...correctionDeps(ctx).deps,
      finishUsage: async (_env, _user, _id, outcome) => {
        calls.outcomes.push(outcome)
      },
      runCorrection: async (req) => {
        calls.inference++
        return req.pipeline === 'dual-review'
          ? dualRun()
          : {
              result: { ...result, execution: { pipeline: 'single' as const, auditStatus: 'skipped' as const, changedCompetencies: [] } },
              usage: { model: 'gemini-4-argon', inputTokens: 1, outputTokens: 1, thoughtTokens: 0, estimatedCostUsd: 0.01 },
            }
      },
    }
    return { deps, calls }
  }

  test('dual review stores pipeline, prompt version, audit status and stage metrics', async () => {
    const ctx = setup()
    await enable(ctx)
    const { deps, calls } = pipelineDeps(ctx)
    const req = correctionRequest({ pipeline: 'dual-review' })
    const res = await handleCorrection(post(), ctx.env, { success: true, data: req }, deps)
    expect(res.ok && res.data.execution?.pipeline).toBe('dual-review')
    const row = ctx.sqlite
      .prepare('SELECT pipeline, prompt_version, audit_status, execution_json, model_id FROM evaluations')
      .get() as Record<string, string>
    expect(row).toMatchObject({ pipeline: 'dual-review', prompt_version: '2026.2-calibrated', audit_status: 'completed', model_id: 'gemini-3.8-flash' })
    const details = JSON.parse(row.execution_json)
    expect(details.stages.map((s: { stage: string }) => s.stage)).toEqual(['corrector', 'auditor'])
    expect(details.audit.changes[0]).toMatchObject({ competency: 'III', from: 160, to: 200 })
    // One user operation, one ledger outcome, aggregated usage and a content-free summary.
    expect(calls.outcomes).toHaveLength(1)
    expect(calls.outcomes[0]).toMatchObject({ status: 'succeeded', pipeline: 'dual-review', estimatedCostUsd: 0.002 })
    const summary = JSON.stringify(calls.outcomes[0].audit)
    expect(summary).toContain('"finalTotal":880')
    expect(summary).not.toContain('Atende ao descritor')
    expect(summary).not.toContain(sampleDraft.essay.slice(0, 30))
  })

  test('the same text can be evaluated by both pipelines, kept apart', async () => {
    const ctx = setup()
    await enable(ctx)
    const { deps, calls } = pipelineDeps(ctx)
    for (const pipeline of ['single', 'dual-review'] as const)
      await handleCorrection(post(), ctx.env, { success: true, data: correctionRequest({ pipeline }) }, deps)
    expect(calls.inference).toBe(2)
    expect(
      ctx.sqlite.prepare('SELECT pipeline FROM evaluations ORDER BY pipeline').all(),
    ).toEqual([{ pipeline: 'dual-review' }, { pipeline: 'single' }])
  })

  test('a repeated request id never runs a second inference, whatever the pipeline', async () => {
    const ctx = setup()
    await enable(ctx)
    const { deps, calls } = pipelineDeps(ctx)
    const req = correctionRequest({ pipeline: 'dual-review' })
    await handleCorrection(post(), ctx.env, { success: true, data: req }, deps)
    const again = await handleCorrection(post(), ctx.env, { success: true, data: req }, deps)
    expect(calls.inference).toBe(1)
    expect(again.persistence?.status).toBe('recovered')
    expect(again.ok && again.data.execution?.auditStatus).toBe('completed')
  })

  test('evaluations stored before pipelines existed still open and list normally', async () => {
    const ctx = setup()
    await enable(ctx)
    const old = record()
    await store.insertEvaluation(ctx.db, 'user-a', {
      id: old.id,
      requestId: old.id,
      createdAtMs: NOW - 60_000,
      input: old.input,
      result: old.result,
      parentId: null,
      modelId: 'gemini-4-argon',
      origin: 'correction',
    }, NOW)
    expect(ctx.sqlite.prepare('SELECT pipeline, audit_status FROM evaluations').get()).toEqual({ pipeline: 'single', audit_status: null })
    const opened = await api.openEvaluation(get(), ctx.env, { id: old.id }, ctx.deps)
    expect(opened.ok && opened.data.result.execution).toBeUndefined()
    const listed = await api.listHistory(get(), ctx.env, {}, ctx.deps)
    expect(listed.ok && listed.data.items.map((i) => i.id)).toEqual([old.id])
  })

  test('the usage ledger records pipeline, stages and audit summary', async () => {
    const ctx = setup()
    const { finishUsage } = await import('./usage.server')
    ctx.sqlite
      .prepare(
        `INSERT INTO usage_ledger (request_id, user_id, status, day_key, month_key, model, created_at, updated_at, expires_at)
         VALUES ('r1', 'user-a', 'reserved', '2026-11-05', '2026-11', 'x', 1, 1, 9999999999999)`,
      )
      .run()
    const run = dualRun()
    await finishUsage(ctx.env, 'user-a', 'r1', { status: 'succeeded', ...run.usage, pipeline: 'dual-review', stages: run.stages, audit: { status: 'completed' } }, NOW)
    const row = ctx.sqlite.prepare('SELECT pipeline, stages_json, audit_json, estimated_cost_usd, cache_read_tokens FROM usage_ledger').get() as Record<string, string | number>
    expect(row).toMatchObject({ pipeline: 'dual-review', estimated_cost_usd: 0.002, cache_read_tokens: 4 })
    expect(JSON.parse(String(row.stages_json))).toHaveLength(2)
    expect(JSON.parse(String(row.audit_json))).toEqual({ status: 'completed' })
  })
})
