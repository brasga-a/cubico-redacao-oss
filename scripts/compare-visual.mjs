/** Reproducible browser comparison. Only local synthetic data; never calls a production service. */
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const root = 'docs/design-captures'
for (const dir of ['reference', 'candidate'])
  await mkdir(`${root}/${dir}`, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
})
const settings = {
  locale: 'pt-BR',
  timezoneId: 'America/Sao_Paulo',
  reducedMotion: 'reduce',
}
const seedContext = await browser.newContext(settings),
  seedPage = await seedContext.newPage()
await seedPage.goto(
  'http://127.0.0.1:3200/visual/index.html?scenario=editor-filled',
)
const fixture = await seedPage.evaluate(async () => {
  const f = await import('/visual/fixtures.ts')
  return { draft: f.sampleDraft, evaluation: f.evaluation }
})
const syntheticUser = {
  name: 'Pessoa de teste',
  email: 'fixture@example.invalid',
  initials: 'PT',
}
const fixed = '2026-11-05T12:00:00.000Z'
async function clock(page) {
  await page.clock.install({ time: new Date(fixed) })
  await page.clock.pauseAt(new Date(Date.parse(fixed) + 100))
}
async function block(context) {
  await context.route('**/*', (route) => {
    const u = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(u.hostname)
      ? route.continue()
      : route.abort()
  })
}
// Obtain reference behavior from the original app itself; never import its grader into Cúbico.
const rc = await browser.newContext({
  ...settings,
  viewport: { width: 1440, height: 900 },
})
await block(rc)
await rc.addInitScript(
  ({ draft, user }) => {
    localStorage.setItem('enem-redacao:user', JSON.stringify(user))
    localStorage.setItem('enem-redacao:draft', JSON.stringify(draft))
    localStorage.setItem('enem-redacao:history', '[]')
  },
  { draft: fixture.draft, user: syntheticUser },
)
const rp = await rc.newPage()
await clock(rp)
await rp.goto('http://127.0.0.1:3300/')
await rp.getByRole('button', { name: 'Corrigir redação' }).click()
await rp.clock.runFor(4500)
await rp.getByRole('tab', { name: 'Resumo' }).waitFor()
const referenceEvaluation = await rp.evaluate(
  () => JSON.parse(localStorage.getItem('enem-redacao:history'))[0],
)
await rc.close()
await seedContext.close()
const states = [
  'login',
  'login-loading',
  'login-error',
  'editor-empty',
  'editor-filled',
  'motivators',
  'focus',
  'requirements',
  'editor-menu',
  'dialog',
  'user-menu',
  'saving',
  'processing',
  'error-network',
  'error-service',
  'evaluation',
  'competencies',
  'text',
  'text-filter',
  'text-empty',
  'history-empty',
  'history',
]
const viewports = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
]
const manifest = {
  candidate: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  candidateDirty:
    execFileSync(
      'git',
      [
        'status',
        '--porcelain',
        '--',
        'src',
        'visual',
        'scripts',
        'package.json',
        'bun.lock',
        'vite.visual.config.ts',
        'playwright.config.ts',
      ],
      { encoding: 'utf8' },
    ).trim().length > 0,
  reference: execFileSync(
    'git',
    ['-C', '../web_reference', 'rev-parse', 'HEAD'],
    { encoding: 'utf8' },
  ).trim(),
  browser: browser.version(),
  settings,
  fixture: 'visual/fixtures.ts (synthetic)',
  referenceEvaluation:
    'original prototype evaluation of the same synthetic essay; output differs intentionally',
  pairs: [],
  errors: [],
}
async function prepare(page, kind, state, viewport) {
  if (kind === 'candidate') {
    const scenario = [
      'motivators',
      'focus',
      'requirements',
      'editor-menu',
      'dialog',
      'user-menu',
    ].includes(state)
      ? 'editor-filled'
      : state === 'competencies'
        ? 'evaluation'
        : state === 'text-filter'
          ? 'text'
          : state
    await page.goto(
      `http://127.0.0.1:3200/visual/index.html?scenario=${scenario}`,
    )
  } else {
    await page.goto('http://127.0.0.1:3300/')
    if (state === 'login-loading') {
      await page.getByRole('button', { name: 'Continuar com Google' }).click()
    } else if (state === 'login-error') {
      await page.getByRole('button', { name: 'Demonstração' }).click()
      await page.getByRole('switch').click()
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Continuar com Google' }).click()
      await page.clock.runFor(1400)
    } else if (state === 'history' || state === 'history-empty') {
      await page.getByRole('button', { name: /Correções/ }).click()
    } else if (
      [
        'evaluation',
        'competencies',
        'text',
        'text-filter',
        'text-empty',
      ].includes(state)
    ) {
      await page
        .getByRole('button', { name: /Este texto já foi corrigido/ })
        .click()
    } else if (state === 'saving') {
      await page
        .getByRole('textbox', { name: 'Título (opcional)' })
        .fill('Título de teste')
    } else if (state === 'processing' || state.startsWith('error-')) {
      if (state === 'error-service') {
        await page
          .getByRole('button', { name: 'Conta de Pessoa de teste' })
          .click()
        await page.getByRole('menuitemcheckbox').click()
        await page.keyboard.press('Escape')
      }
      if (state === 'error-network')
        await page.evaluate(() =>
          Object.defineProperty(navigator, 'onLine', { get: () => false }),
        )
      await page.getByRole('button', { name: 'Corrigir redação' }).click()
      if (state.startsWith('error-')) await page.clock.runFor(4500)
    }
  }
  if (state === 'motivators') {
    await page.getByRole('button', { name: /Textos motivadores/ }).click()
    for (let i = 0; i < 2; i++) {
      await page
        .getByRole('button', { name: 'Adicionar texto motivador' })
        .click()
      await page
        .locator(`#supporting-${i}`)
        .fill(
          `Texto motivador ${i + 1} de teste. Conteúdo sintético para comparação visual.`,
        )
    }
  }
  if (state === 'focus' && viewport.width >= 1024)
    await page.getByRole('button', { name: 'Modo foco', exact: true }).click()
  if (state === 'requirements' && viewport.width < 1024)
    await page.getByRole('button', { name: /^Requisitos/ }).click()
  if (state === 'editor-menu')
    await page.getByRole('button', { name: 'Mais opções' }).click()
  if (state === 'dialog') {
    await page.getByRole('button', { name: 'Mais opções' }).click()
    await page.clock.runFor(32)
    await page.getByRole('menuitem', { name: 'Apagar texto' }).click()
  }
  if (state === 'user-menu')
    await page.getByRole('button', { name: 'Conta de Pessoa de teste' }).click()
  if (state === 'competencies') {
    await page.getByRole('tab', { name: 'Competências', exact: true }).click()
    await page.locator('[data-slot=accordion-trigger]').first().click()
  }
  if (
    kind === 'reference' &&
    ['text', 'text-filter', 'text-empty'].includes(state)
  )
    await page.getByRole('tab', { name: /Texto comentado/ }).click()
  if (state === 'text-filter')
    await page.getByRole('button', { name: /^C3 \d/ }).click()
  await page.evaluate(() => document.fonts.ready)
  // Advance animation frames for scroll/focus without running the prototype's 4.2-second grading timer.
  await page.clock.runFor(32)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.clock.runFor(32)
}
for (const viewport of viewports) {
  for (const state of states) {
    const entry = {
      state,
      viewport,
      reference: null,
      candidate: null,
      overflow: {},
      status: 'captured',
    }
    for (const kind of ['reference', 'candidate']) {
      const context = await browser.newContext({ ...settings, viewport })
      await block(context)
      if (kind === 'reference') {
        const logged = !state.startsWith('login')
        const empty = state === 'editor-empty'
        const noHistory = state === 'history-empty'
        const first = {
          ...referenceEvaluation,
          annotations:
            state === 'text-empty' ? [] : referenceEvaluation.annotations,
        }
        await context.addInitScript(
          ({ user, draft, history }) => {
            localStorage.clear()
            if (user)
              localStorage.setItem('enem-redacao:user', JSON.stringify(user))
            localStorage.setItem('enem-redacao:draft', JSON.stringify(draft))
            localStorage.setItem(
              'enem-redacao:history',
              JSON.stringify(history),
            )
          },
          {
            user: logged ? syntheticUser : null,
            draft: empty
              ? {
                  topic: '',
                  title: '',
                  essay: '',
                  supportingTexts: [],
                  updatedAt: null,
                }
              : fixture.draft,
            history: noHistory
              ? []
              : [
                  first,
                  {
                    ...first,
                    id: 'reference-previous',
                    createdAt: '2026-11-04T12:00:00.000Z',
                  },
                ],
          },
        )
      }
      const page = await context.newPage()
      page.setDefaultTimeout(7000)
      page.on('pageerror', (e) =>
        manifest.errors.push({ state, kind, viewport, message: e.message }),
      )
      try {
        await clock(page)
        await prepare(page, kind, state, viewport)
        const file = `${kind}/${state}-${viewport.width}x${viewport.height}.png`
        entry.overflow[kind] = await page.evaluate(() => ({
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
        await page.screenshot({
          path: `${root}/${file}`,
          fullPage: true,
          animations: 'disabled',
          style: '[data-fixture-controls]{visibility:hidden !important}',
        })
        entry[kind] = file
      } catch (e) {
        entry.status = 'failed'
        manifest.errors.push({
          state,
          kind,
          viewport,
          message: String(e).slice(0, 800),
        })
      }
      await context.close()
    }
    manifest.pairs.push(entry)
    console.log(`${viewport.width} ${state}: ${entry.status}`)
    await writeFile(
      `${root}/manifest.json`,
      JSON.stringify(manifest, null, 2) + '\n',
    )
  }
}
await browser.close()
if (manifest.errors.length) {
  console.log(JSON.stringify(manifest.errors))
  process.exitCode = 1
}
