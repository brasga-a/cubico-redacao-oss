import { chromium } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const root = 'docs/design-captures'
const manifest = JSON.parse(await readFile(`${root}/manifest.json`, 'utf8'))
if (manifest.pairs.length !== 110 || manifest.errors.length)
  throw new Error('Complete the paired capture first')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
})
const settings = {
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  reducedMotion: 'reduce',
}
const candidate = execFileSync('git', ['rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim()
const source = await browser.newPage()
await source.goto('http://127.0.0.1:3200/visual/index.html')
const fixture = await source.evaluate(async () => {
  const f = await import('/visual/fixtures.ts')
  return f.evaluation
})
await source.close()
manifest.additionalCandidateStates = []
for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]) {
  for (const state of [
    'hover-submit',
    'focus-theme',
    'evaluation-zero',
    'save-error',
    'security-error',
  ]) {
    const paired = ['hover-submit', 'focus-theme'].includes(state)
    const entry = {
      state,
      viewport,
      reference: null,
      candidate: null,
      overflow: {},
      status: 'captured',
      candidateSha: candidate,
    }
    for (const kind of paired ? ['reference', 'candidate'] : ['candidate']) {
      const context = await browser.newContext({ ...settings, viewport })
      await context.route('**/*', (route) =>
        ['127.0.0.1', 'localhost'].includes(
          new URL(route.request().url()).hostname,
        )
          ? route.continue()
          : route.abort(),
      )
      if (kind === 'reference')
        await context.addInitScript(
          ({ fixture }) => {
            localStorage.clear()
            localStorage.setItem(
              'enem-redacao:user',
              JSON.stringify({
                name: 'Pessoa de teste',
                email: 'fixture@example.invalid',
                initials: 'PT',
              }),
            )
            localStorage.setItem(
              'enem-redacao:draft',
              JSON.stringify({
                topic: '',
                title: '',
                essay: '',
                supportingTexts: [],
                updatedAt: null,
              }),
            )
            localStorage.setItem(
              'enem-redacao:history',
              JSON.stringify([fixture, { ...fixture, id: 'previous' }]),
            )
          },
          { fixture },
        )
      const page = await context.newPage()
      await page.goto(
        kind === 'reference'
          ? 'http://127.0.0.1:3300/'
          : `http://127.0.0.1:3200/visual/index.html?scenario=${paired ? 'editor-empty' : state}`,
      )
      await page.evaluate(() => document.fonts.ready)
      if (state === 'hover-submit')
        await page.getByRole('button', { name: /^Corrigir/ }).hover()
      if (state === 'focus-theme')
        await page.getByRole('textbox', { name: 'Tema', exact: true }).focus()
      const file = `${kind}/${state}-${viewport.width}x${viewport.height}.png`
      entry.overflow[kind] = await page.evaluate(() => ({
        viewport: innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }))
      await page.screenshot({
        path: `${root}/${file}`,
        fullPage: true,
        animations: 'disabled',
        style: '[data-fixture-controls]{visibility:hidden!important}',
      })
      entry[kind] = file
      await context.close()
    }
    if (paired) manifest.pairs.push(entry)
    else
      manifest.additionalCandidateStates.push({
        ...entry,
        referenceNotApplicable:
          'Extra state absent from the original UI; candidate-only fixture, not a 1:1 approval',
      })
  }
}
await writeFile(
  `${root}/manifest.json`,
  JSON.stringify(manifest, null, 2) + '\n',
)
await browser.close()
