import 'fake-indexeddb/auto'
import { expect, test } from 'bun:test'
import { result, sampleDraft } from '../../../visual/fixtures'
import {
  clearLocalHistory,
  loadHistory,
  makeRecord,
  saveHistory,
  scanLocalHistory,
} from './history'

test('local scan is read-only, per account and validates each record', async () => {
  const valid = makeRecord('scan-a', crypto.randomUUID(), sampleDraft, result)
  const legacyId = makeRecord('scan-a', 'not-a-uuid', sampleDraft, result)
  await saveHistory('scan-a', true, [valid, legacyId])
  const scan = await scanLocalHistory('scan-a')
  expect(scan.records.map((r) => r.id)).toEqual([valid.id])
  expect(scan.invalid).toBe(1)
  // The browser `owner` is never part of what is sent to the server.
  expect('owner' in scan.records[0]).toBe(false)
  expect((await scanLocalHistory('scan-b')).records).toEqual([])
  // Scanning does not delete or rewrite anything.
  expect((await loadHistory('scan-a')).records).toHaveLength(2)
  await clearLocalHistory('scan-a')
  expect((await scanLocalHistory('scan-a')).records).toEqual([])
})
