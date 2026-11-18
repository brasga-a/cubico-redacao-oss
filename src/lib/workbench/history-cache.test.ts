import 'fake-indexeddb/auto'
import { describe, expect, test } from 'bun:test'
import { result, sampleDraft } from '../../../visual/fixtures'
import { HISTORY_LIMIT, HISTORY_RETENTION_MS } from '@/lib/evaluation-history'
import type {
  EvaluationRecord,
  EvaluationSummary,
} from '@/lib/evaluation-history'
import {
  applyRetention,
  clearCache,
  clearOtherAccounts,
  emptyCache,
  readCache,
  reconcile,
  withRecord,
  withoutRecord,
  writeCache,
} from './history-cache'

const NOW = Date.parse('2026-11-05T12:00:00.000Z')

function summary(i: number, ageMs = i * 60_000): EvaluationSummary {
  const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`
  return {
    id,
    createdAt: new Date(NOW - ageMs).toISOString(),
    theme: 'Tema',
    title: '',
    totalScore: 680,
    scores: { c1: 160, c2: 120, c3: 120, c4: 160, c5: 120 },
    wordCount: 300,
    parentId: null,
    origin: 'correction',
    modelId: 'm',
  }
}
function full(s: EvaluationSummary): EvaluationRecord {
  return {
    id: s.id,
    createdAt: s.createdAt,
    input: { ...sampleDraft },
    result,
    rubricVersion: '2026',
    schemaVersion: 1,
  }
}

describe('reconcile with the server listing', () => {
  test('first sync writes; an identical listing does not write again', () => {
    const server = [summary(1), summary(2)]
    const first = reconcile(null, server, NOW)
    expect(first.changed).toBe(true)
    const again = reconcile(first.cache, server, NOW)
    expect(again.changed).toBe(false)
    expect(again.removed).toEqual([])
  })

  test('new evaluations from another device enter as metadata only', () => {
    const start = reconcile(null, [summary(2)], NOW).cache
    const next = reconcile(start, [summary(1), summary(2)], NOW)
    expect(next.changed).toBe(true)
    expect(next.cache.summaries.map((s) => s.id)).toEqual([
      summary(1).id,
      summary(2).id,
    ])
    expect(next.cache.records).toEqual([])
  })

  test('deletion on another device removes metadata and cached payload', () => {
    const a = summary(1),
      b = summary(2)
    let cache = reconcile(null, [a, b], NOW).cache
    cache = withRecord(cache, full(a)).cache
    cache = withRecord(cache, full(b)).cache
    const next = reconcile(cache, [b], NOW)
    expect(next.changed).toBe(true)
    expect(next.removed).toEqual([a.id])
    expect(next.cache.records.map((r) => r.id)).toEqual([b.id])
  })

  test('cached payloads are immutable: a known record is never rewritten', () => {
    const a = summary(1)
    const cache = withRecord(reconcile(null, [a], NOW).cache, full(a)).cache
    expect(withRecord(cache, full(a)).changed).toBe(false)
    // A record outside the server membership is not cached.
    expect(withRecord(cache, full(summary(9))).changed).toBe(false)
  })

  test('applies the same retention as the server (30 items, 90 days)', () => {
    const server = [
      ...Array.from({ length: HISTORY_LIMIT + 2 }, (_, i) => summary(i + 1)),
      summary(99, HISTORY_RETENTION_MS + 1),
    ]
    const { cache } = reconcile(null, server, NOW)
    expect(cache.summaries).toHaveLength(HISTORY_LIMIT)
    const expired = applyRetention(
      { ...cache, records: cache.summaries.slice(0, 2).map(full) },
      NOW + HISTORY_RETENTION_MS + 60 * 60_000,
    )
    expect(expired.summaries).toEqual([])
    expect(expired.records).toEqual([])
  })

  test('removing one id or everything', () => {
    const a = summary(1)
    const cache = withRecord(reconcile(null, [a], NOW).cache, full(a)).cache
    expect(withoutRecord(cache, a.id).cache).toEqual(emptyCache())
    expect(withoutRecord(cache, summary(5).id).changed).toBe(false)
    expect(withoutRecord(cache).cache).toEqual(emptyCache())
  })
})

describe('IndexedDB device cache', () => {
  test('per-account storage, validated reads and clearing on sign-out', async () => {
    const recent = summary(1, 60_000)
    recent.createdAt = new Date(Date.now() - 60_000).toISOString()
    const cache = withRecord(
      reconcile(null, [recent]).cache,
      full(recent),
    ).cache
    await writeCache('cache-a', cache)
    expect(await readCache('cache-a')).toEqual(cache)
    expect(await readCache('cache-b')).toBeNull()
    await clearCache('cache-a')
    expect(await readCache('cache-a')).toBeNull()
  })

  test('a corrupted entry is discarded instead of being shown', async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('cubico-cache-v1', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('accounts')
      r.onsuccess = () => resolve(r.result)
    })
    await new Promise<void>((resolve) => {
      const tx = db.transaction('accounts', 'readwrite')
      tx.objectStore('accounts').put({ version: 1, summaries: 'x' }, 'bad')
      tx.oncomplete = () => resolve()
    })
    db.close()
    expect(await readCache('bad')).toBeNull()
    expect(await readCache('bad')).toBeNull()
  })

  test('switching accounts removes the previous account cache', async () => {
    await writeCache('cache-old', emptyCache())
    await writeCache('cache-new', emptyCache())
    await clearOtherAccounts('cache-new')
    expect(await readCache('cache-old')).toBeNull()
    expect(await readCache('cache-new')).toEqual(emptyCache())
  })
})
