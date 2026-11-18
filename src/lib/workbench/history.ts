import { z } from 'zod'
import { correctionResultSchema } from '@/lib/correction'
import type { CorrectionResult } from '@/lib/correction'
import {
  HISTORY_LIMIT,
  HISTORY_RETENTION_MS as RETENTION_MS,
  evaluationRecordSchema,
} from '@/lib/evaluation-history'
import type { EvaluationRecord } from '@/lib/evaluation-history'
import type { Draft } from './types'

/**
 * Browser-side evaluation records.
 *
 * The cloud history (D1, via authenticated server functions) is now the source of truth.
 * IndexedDB (`cubico-history-v1`) is legacy: it is only read to offer an optional import
 * and cleared only on explicit request. New evaluations are no longer written to it.
 */
export { HISTORY_LIMIT, RETENTION_MS }
export const draftSchema = z.object({
  topic: z.string().max(2000),
  title: z.string().max(300),
  essay: z.string().max(30000),
  supportingTexts: z.array(z.string()).max(4),
  updatedAt: z.string().nullable(),
})
export const recordSchema = z.object({
  id: z.string(),
  owner: z.string(),
  createdAt: z.string().datetime(),
  input: draftSchema,
  result: correctionResultSchema,
  parentId: z.string().optional(),
  rubricVersion: z.literal('2026'),
  schemaVersion: z.literal(1),
})
export type StoredEvaluation = z.infer<typeof recordSchema>
export function makeRecord(
  owner: string,
  id: string,
  input: Draft,
  result: CorrectionResult,
  parentId?: string,
): StoredEvaluation {
  return recordSchema.parse({
    owner,
    id,
    input: structuredClone(input),
    result: structuredClone(result),
    createdAt: new Date().toISOString(),
    parentId,
    rubricVersion: '2026',
    schemaVersion: 1,
  })
}
export function retained(
  records: StoredEvaluation[],
  owner: string,
  now = Date.now(),
) {
  return records
    .filter(
      (r) => r.owner === owner && Date.parse(r.createdAt) > now - RETENTION_MS,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, HISTORY_LIMIT)
}
async function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('cubico-history-v1', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('accounts')
    request.onsuccess = () => resolve(request.result)
    request.onerror = () =>
      reject(new Error('Armazenamento local indisponível'))
    request.onblocked = () =>
      reject(new Error('Feche outras abas para atualizar o armazenamento'))
  })
}
async function transaction<T>(owner: string, write?: unknown): Promise<T> {
  const db = await database()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(
        'accounts',
        write === undefined ? 'readonly' : 'readwrite',
      )
      const store = tx.objectStore('accounts')
      const req =
        write === undefined ? store.get(owner) : store.put(write, owner)
      let result: T
      req.onsuccess = () => {
        result = req.result as T
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = tx.onabort = () =>
        reject(new Error('Não foi possível concluir o armazenamento local'))
    })
  } finally {
    db.close()
  }
}
export async function loadHistory(owner: string) {
  const raw = await transaction<unknown>(owner)
  if (raw === undefined)
    return { enabled: false, records: [] as StoredEvaluation[] }
  const parsed = z
    .object({ enabled: z.boolean(), records: z.array(recordSchema) })
    .parse(raw)
  const records = retained(parsed.records, owner)
  if (records.length !== parsed.records.length)
    await saveHistory(owner, parsed.enabled, records)
  return { ...parsed, records }
}
export async function saveHistory(
  owner: string,
  enabled: boolean,
  records: StoredEvaluation[],
) {
  await transaction(owner, {
    enabled,
    records: enabled ? retained(records, owner) : [],
  })
}

export type LocalImportScan = {
  /** Records valid for import (owner field ignored by the server; used here only to pick this account's slot). */
  records: EvaluationRecord[]
  invalid: number
}

/** Read-only scan of the legacy local history: never prunes, rewrites or deletes. */
export async function scanLocalHistory(
  owner: string,
): Promise<LocalImportScan> {
  if (typeof indexedDB === 'undefined') return { records: [], invalid: 0 }
  const raw = await transaction<unknown>(owner)
  const list =
    raw && typeof raw === 'object' && 'records' in raw
      ? raw.records
      : []
  if (!Array.isArray(list)) return { records: [], invalid: 0 }
  const records: EvaluationRecord[] = []
  let invalid = 0
  for (const item of list) {
    const parsed = evaluationRecordSchema.safeParse(item)
    if (parsed.success) records.push(parsed.data)
    else invalid++
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { records, invalid }
}

/** Removes this account's legacy local history (drafts live in sessionStorage and are untouched). */
export async function clearLocalHistory(owner: string) {
  await transaction(owner, { enabled: false, records: [] })
}
