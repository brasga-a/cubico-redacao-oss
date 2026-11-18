import { z } from 'zod'
import {
  HISTORY_LIMIT,
  HISTORY_RETENTION_MS,
  evaluationRecordSchema,
  evaluationSummarySchema,
} from '@/lib/evaluation-history'
import type {
  EvaluationRecord,
  EvaluationSummary,
} from '@/lib/evaluation-history'

/**
 * Device cache of the cloud history (IndexedDB `cubico-cache-v1`, one entry per account).
 *
 * D1 is the source of truth. Stored evaluations are immutable snapshots, so a cached
 * payload never goes stale: only membership changes (new, deleted or expired ids).
 * The cache is written only when that membership or the metadata actually changes.
 * It exists only while cloud history is enabled and is cleared on sign-out, account
 * switch, consent revocation and "Apagar dados locais".
 */

const DB_NAME = 'cubico-cache-v1'
const STORE = 'accounts'
export const CACHE_VERSION = 1

const cacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  summaries: z.array(evaluationSummarySchema).max(HISTORY_LIMIT),
  records: z.array(evaluationRecordSchema).max(HISTORY_LIMIT),
})
export type HistoryCache = z.infer<typeof cacheSchema>

export const emptyCache = (): HistoryCache => ({
  version: CACHE_VERSION,
  summaries: [],
  records: [],
})

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(new Error('Cache local indisponível'))
    request.onblocked = () => reject(new Error('Cache local bloqueado'))
  })
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest | undefined,
): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = action(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request?.result as T)
      tx.onerror = tx.onabort = () =>
        reject(new Error('Não foi possível concluir o cache local'))
    })
  } finally {
    db.close()
  }
}

const available = () => typeof indexedDB !== 'undefined'

/** Returns this account's cache, discarding (and deleting) entries that fail validation. */
export async function readCache(userId: string): Promise<HistoryCache | null> {
  if (!available()) return null
  const raw = await run<unknown>('readonly', (s) => s.get(userId))
  if (raw === undefined) return null
  const parsed = cacheSchema.safeParse(raw)
  if (parsed.success) return applyRetention(parsed.data)
  await clearCache(userId)
  return null
}

export async function writeCache(userId: string, cache: HistoryCache) {
  if (!available()) return
  const valid = cacheSchema.parse(applyRetention(cache))
  await run('readwrite', (s) => s.put(valid, userId))
}

export async function clearCache(userId: string) {
  if (!available()) return
  await run('readwrite', (s) => s.delete(userId))
}

/** Removes cached history of every other account of this browser profile. */
export async function clearOtherAccounts(userId: string) {
  if (!available()) return
  const keys = await run<IDBValidKey[]>('readonly', (s) => s.getAllKeys())
  const others = keys.filter((key) => key !== userId)
  if (others.length)
    await run('readwrite', (s) => {
      for (const key of others) s.delete(key)
      return undefined
    })
}

/** Same policy as the server: newest HISTORY_LIMIT entries within the retention window. */
export function applyRetention(
  cache: HistoryCache,
  now = Date.now(),
): HistoryCache {
  const cutoff = now - HISTORY_RETENTION_MS
  const summaries = [...cache.summaries]
    .filter((s) => Date.parse(s.createdAt) >= cutoff)
    .sort(
      (a, b) =>
        b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
    )
    .slice(0, HISTORY_LIMIT)
  const kept = new Set(summaries.map((s) => s.id))
  return {
    version: CACHE_VERSION,
    summaries,
    records: cache.records.filter((r) => kept.has(r.id)),
  }
}

/**
 * Reconciles the cache with the server listing (the authoritative membership).
 * New ids enter as metadata; ids missing on the server (deleted on another device or
 * expired) leave together with their payload. `changed` is false when nothing differs,
 * so callers skip the write.
 */
export function reconcile(
  cache: HistoryCache | null,
  server: EvaluationSummary[],
  now = Date.now(),
): { cache: HistoryCache; changed: boolean; removed: string[] } {
  const previous = cache ?? emptyCache()
  const next = applyRetention(
    { version: CACHE_VERSION, summaries: server, records: previous.records },
    now,
  )
  const kept = new Set(next.summaries.map((s) => s.id))
  const removed = previous.summaries
    .map((s) => s.id)
    .filter((id) => !kept.has(id))
  const changed =
    cache === null ||
    JSON.stringify(previous.summaries) !== JSON.stringify(next.summaries) ||
    previous.records.length !== next.records.length
  return { cache: next, changed, removed }
}

/**
 * Adds a full record whose summary is already cached (membership comes from the server
 * listing). No write when the record is already cached or not part of the history.
 */
export function withRecord(
  cache: HistoryCache | null,
  record: EvaluationRecord,
): { cache: HistoryCache; changed: boolean } {
  const base = cache ?? emptyCache()
  if (
    base.records.some((r) => r.id === record.id) ||
    !base.summaries.some((s) => s.id === record.id)
  )
    return { cache: base, changed: false }
  return {
    cache: { ...base, records: [record, ...base.records] },
    changed: true,
  }
}

/** Removes one id (or everything) from the cache. */
export function withoutRecord(
  cache: HistoryCache | null,
  evaluationId?: string,
): { cache: HistoryCache; changed: boolean } {
  const base = cache ?? emptyCache()
  if (evaluationId === undefined)
    return {
      cache: emptyCache(),
      changed: base.summaries.length + base.records.length > 0,
    }
  const next = {
    version: CACHE_VERSION,
    summaries: base.summaries.filter((s) => s.id !== evaluationId),
    records: base.records.filter((r) => r.id !== evaluationId),
  } as const
  return {
    cache: next,
    changed:
      next.summaries.length !== base.summaries.length ||
      next.records.length !== base.records.length,
  }
}
