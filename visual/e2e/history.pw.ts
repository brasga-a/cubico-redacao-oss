import { test, expect } from '@playwright/test'

test('real browser IndexedDB preserves snapshots, scope and explicit deletion', async ({
  page,
}) => {
  await page.goto('/visual/index.html?scenario=history-empty')
  const observed = await page.evaluate(async () => {
    const path = '/src/lib/workbench/history.ts',
      fixturePath = '/visual/fixtures.ts'
    const store = await import(path),
      fixtures = await import(fixturePath)
    const owner = 'browser-test-account'
    await store.saveHistory(owner, false, [])
    const before = await store.loadHistory(owner)
    const record = store.makeRecord(
      owner,
      'browser-record',
      fixtures.sampleDraft,
      fixtures.result,
    )
    await store.saveHistory(owner, true, [record])
    const loaded = await store.loadHistory(owner),
      other = await store.loadHistory('another-account')
    await store.saveHistory(owner, false, [])
    const after = await store.loadHistory(owner)
    return {
      before: before.enabled,
      count: loaded.records.length,
      other: other.records.length,
      after: after.records.length,
    }
  })
  expect(observed).toEqual({ before: false, count: 1, other: 0, after: 0 })
})
