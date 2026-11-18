/** Authenticated routing regression against an isolated Worker and local D1.
 * Seeds a signed session with test-only credentials; never contacts Google or Gemini.
 */
import { chromium, expect } from '@playwright/test'
import { getPlatformProxy } from 'wrangler'
import { serializeSignedCookie } from 'better-call'
import { toCrossJSON, fromCrossJSON, fromJSON } from 'seroval'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
const directory = path.resolve(
  process.env.ROUTE_SMOKE_DIRECTORY || '/tmp/cubico-routes-check',
)
const baseURL = 'http://127.0.0.1:3700'
const secret = 'local-route-tests-only-secret-with-at-least-32-characters'
if (!directory.startsWith('/tmp/cubico-routes-'))
  throw new Error('Only a disposable route test directory is allowed')
const vars = await readFile(path.join(directory, '.dev.vars'), 'utf8')
if (
  !vars.includes(`BETTER_AUTH_SECRET=${secret}\n`) ||
  !vars.includes(`BETTER_AUTH_URL=${baseURL}\n`) ||
  !vars.includes('GEMINI_API_KEY=\n')
)
  throw new Error('Expected dummy-only auth config with inference disabled')
const token = crypto.randomUUID(),
  recordId = crypto.randomUUID()
process.chdir(directory)
const proxy = await getPlatformProxy({
  configPath: path.join(directory, 'wrangler.jsonc'),
  remoteBindings: false,
})
try {
  const db = proxy.env.DB,
    now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO user (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
    .bind(
      'route-test-owner',
      'Pessoa de teste',
      'fixture@example.invalid',
      1,
      now,
      now,
    )
    .run()
  await db
    .prepare(
      'INSERT INTO account (id,accountId,providerId,userId,createdAt,updatedAt) VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING',
    )
    .bind(
      'route-test-account',
      'route-test-account',
      'google',
      'route-test-owner',
      now,
      now,
    )
    .run()
  await db
    .prepare(
      'INSERT INTO session (id,token,userId,expiresAt,createdAt,updatedAt) VALUES (?,?,?,?,?,?)',
    )
    .bind(
      crypto.randomUUID(),
      token,
      'route-test-owner',
      new Date(Date.now() + 86400000).toISOString(),
      now,
      now,
    )
    .run()
} finally {
  await proxy.dispose()
}
const serialized = await serializeSignedCookie(
  'better-auth.session_token',
  token,
  secret,
  { path: '/', httpOnly: true, sameSite: 'lax' },
)
const pair = serialized.split(';')[0],
  equal = pair.indexOf('=')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
})
let checks = 0
try {
  const guest = await browser.newContext()
  await guest.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  )
  const anonymous = await guest.newPage()
  for (const url of [
    '/',
    '/editor',
    '/historico',
    '/redacao/missing',
    '/processando',
  ]) {
    await anonymous.goto(`${baseURL}${url}`)
    await expect(
      anonymous.getByRole('button', { name: 'Continuar com Google' }),
    ).toBeVisible()
    expect(new URL(anonymous.url()).pathname).toBe('/login')
    checks++
  }
  await guest.close()
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
  })
  await context.addCookies([
    {
      name: pair.slice(0, equal),
      value: pair.slice(equal + 1),
      url: baseURL,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ])
  await context.route('**/*', (route) =>
    ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  )
  const page = await context.newPage(),
    runtimeErrors = []
  let correctionPosts = 0
  page.on('pageerror', () => runtimeErrors.push('pageerror'))
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.includes('/_serverFn/')
    )
      correctionPosts++
  })
  await page.goto(`${baseURL}/editor`)
  await expect(
    page.getByRole('heading', { name: 'Nova redação', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Usar exemplo', exact: true }).click()
  const essay = page.getByRole('textbox', { name: 'Redação', exact: true })
  const sample = await essay.inputValue()
  expect(sample.startsWith('A Lei nº 10.639')).toBe(true)
  const nav = page.getByRole('navigation', { name: 'Principal' })
  await nav.getByRole('link', { name: /Correções/ }).click()
  await expect(page).toHaveURL(`${baseURL}/historico`)
  await page
    .getByRole('button', { name: 'Ativar histórico neste navegador' })
    .click()
  await expect(page.getByText(/Histórico local ativado/)).toBeVisible()
  await nav.getByRole('link', { name: 'Escrever', exact: true }).click()
  await expect(essay).toHaveValue(sample)
  checks++
  await page.evaluate(async (id) => {
    const historyPath = '/src/features/workbench/lib/history.ts',
      fixturePath = '/visual/fixtures.ts'
    const h = await import(historyPath),
      f = await import(fixturePath)
    const record = h.makeRecord('route-test-owner', id, f.sampleDraft, f.result)
    await h.saveHistory('route-test-owner', true, [record])
  }, recordId)
  await page.goto(`${baseURL}/historico`)
  await page.getByRole('link', { name: /840/ }).click()
  expect(new URL(page.url()).pathname).toBe(`/redacao/${recordId}`)
  await expect(
    page.getByRole('tab', { name: 'Resumo', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Competências', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('tab')).toBe('competencies')
  await page.goBack()
  await expect(
    page.getByRole('tab', { name: 'Resumo', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.goForward()
  await expect(
    page.getByRole('tab', { name: 'Competências', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await page.reload()
  await expect(
    page.getByRole('tab', { name: 'Competências', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  checks++
  const other = await context.newPage()
  await other.goto(`${baseURL}/redacao/${recordId}?tab=text`)
  await expect(
    other.getByRole('tab', { name: /Texto comentado/ }),
  ).toHaveAttribute('aria-selected', 'true')
  await other.close()
  checks++
  await page.getByRole('button', { name: 'Revisar texto' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/editor`)
  await essay.fill('Revisão do texto sem alterar o original.')
  const untouched = await page.evaluate(async (id) => {
    const path = '/src/features/workbench/lib/history.ts'
    const h = await import(path),
      data = await h.loadHistory('route-test-owner')
    return (
      data.records.find((record) => record.id === id).input.essay !==
      'Revisão do texto sem alterar o original.'
    )
  }, recordId)
  expect(untouched).toBe(true)
  await page.reload()
  await expect(essay).toHaveValue('Revisão do texto sem alterar o original.')
  checks++
  await page.goto(`${baseURL}/redacao/nonexistent`)
  await expect(
    page.getByRole('heading', {
      name: 'Avaliação indisponível neste navegador',
    }),
  ).toBeVisible()
  await page.goto(`${baseURL}/processando`)
  await expect(
    page.getByRole('heading', {
      name: 'Nenhuma correção em andamento nesta aba',
    }),
  ).toBeVisible()
  checks++
  expect(correctionPosts).toBe(0)
  // UI-only RPC fixtures: inference remains disabled in the Worker. No correction POST reaches it.
  const fixture = await page.evaluate(async () => {
    const path = '/visual/fixtures.ts'
    const f = await import(path)
    return { input: f.sampleDraft, result: f.result }
  })
  const waiting = []
  await context.route('**/_serverFn/**', async (route) => {
    if (route.request().method() === 'POST') {
      const payload = fromJSON(route.request().postDataJSON())
      let release
      const hold = new Promise((resolve) => {
        release = resolve
      })
      waiting.push({ id: payload.data.requestId, release })
      await hold
      return route.fulfill({
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-tss-serialized': 'true',
        },
        body: JSON.stringify(
          toCrossJSON({ result: { ok: true, data: fixture.result } }, {}),
        ),
      })
    }
    const upstream = await route.fetch({ maxRedirects: 0 })
    const data = fromCrossJSON(await upstream.json(), {})
    if (data.result?.ok && data.result.data?.authConfigured)
      data.result.data.configured = true
    return route.fulfill({
      response: upstream,
      body: JSON.stringify(toCrossJSON(data, {})),
    })
  })
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => window.__TSR_ROUTER__.invalidate({ sync: true }))
  await page.getByRole('link', { name: 'Voltar ao editor' }).click()
  await page.getByLabel('Tema', { exact: true }).fill(fixture.input.topic)
  await essay.fill(fixture.input.essay)
  // Exercise the real editor shortcut; the dev-only floating toolbar overlaps its mobile button.
  await essay.press('Control+Enter')
  await expect(page).toHaveURL(`${baseURL}/processando`)
  await expect.poll(() => waiting.length).toBe(1)
  await nav.getByRole('link', { name: /Correções/ }).click()
  waiting[0].release()
  await expect(
    page.getByRole('link', { name: 'Ver avaliação', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(`${baseURL}/historico`)
  await page.getByRole('link', { name: 'Ver avaliação', exact: true }).click()
  expect(new URL(page.url()).pathname).toBe(`/redacao/${waiting[0].id}`)
  checks++
  await nav.getByRole('link', { name: 'Escrever', exact: true }).click()
  await essay.fill(fixture.input.essay + '\n\nNova revisão.')
  // Exercise the real editor shortcut; the dev-only floating toolbar overlaps its mobile button.
  await essay.press('Control+Enter')
  await expect.poll(() => waiting.length).toBe(2)
  await page
    .getByRole('button', { name: 'Voltar ao editor', exact: true })
    .click()
  waiting[1].release()
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(`${baseURL}/editor`)
  const savedCount = await page.evaluate(async () => {
    const path = '/src/features/workbench/lib/history.ts'
    return (await (await import(path)).loadHistory('route-test-owner')).records
      .length
  })
  expect(savedCount).toBe(2)
  checks++
  await essay.fill(fixture.input.essay + '\n\nOutra revisão.')
  // Exercise the real editor shortcut; the dev-only floating toolbar overlaps its mobile button.
  await essay.press('Control+Enter')
  await expect.poll(() => waiting.length).toBe(3)
  await page.getByRole('button', { name: 'Conta de Pessoa de teste' }).click()
  await page.getByRole('menuitem', { name: 'Sair', exact: true }).click()
  await expect(page).toHaveURL(`${baseURL}/login`)
  waiting[2].release()
  await page.waitForLoadState('networkidle')
  await page.goto(`${baseURL}/redacao/${recordId}`)
  await expect(
    page.getByRole('button', { name: 'Continuar com Google' }),
  ).toBeVisible()
  expect(new URL(page.url()).pathname).toBe('/login')
  expect(correctionPosts).toBe(3)
  expect(runtimeErrors).toEqual([])
  checks++
  console.log(
    `PASS ${checks} routing scenarios: real session/guards, draft navigation, local result deep links, tab history/reload, new tab, immutable review, missing result, processing reload, background result, cancelled/late result and logout. Three RPC replies mocked; no provider calls.`,
  )
} finally {
  await browser.close()
}
