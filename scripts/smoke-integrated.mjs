/** Production build smoke: local, unauthenticated, no OAuth or inference calls. */
import { chromium, expect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
const baseURL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3500'
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
  throw new Error('Smoke permits local isolated servers only')
const directory = 'docs/integration-captures'
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
})
const entries = []
try {
  for (const [width, height] of [
    [1440, 900],
    [1024, 768],
    [768, 1024],
    [390, 844],
    [360, 800],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      locale: 'pt-BR',
      reducedMotion: 'reduce',
    })
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url())
      return ['localhost', '127.0.0.1'].includes(url.hostname)
        ? route.continue()
        : route.abort()
    })
    const page = await context.newPage(),
      errors = []
    page.on('pageerror', () => errors.push('pageerror'))
    await page.goto(baseURL)
    await expect(
      page.getByRole('heading', { name: 'Corrija sua redação do ENEM' }),
    ).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    )
    if (overflow) throw new Error(`Horizontal overflow at ${width}`)
    await page.screenshot({
      path: `${directory}/login-${width}.png`,
      fullPage: true,
    })
    // This environment has no auth/provider secrets; the client must show the honest failure.
    await page.getByRole('button', { name: 'Continuar com Google' }).click()
    await expect(
      page.getByText('O proprietário ainda não configurou o login.'),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Atualizar acesso' }),
    ).toBeVisible()
    await page.screenshot({
      path: `${directory}/login-error-${width}.png`,
      fullPage: true,
    })
    if (errors.length) throw new Error(`Runtime error at ${width}`)
    entries.push({
      width,
      height,
      overflow,
      errors,
      states: ['login', 'auth-not-configured'],
    })
    await context.close()
  }
} finally {
  await browser.close()
}
await writeFile(
  `${directory}/manifest.json`,
  JSON.stringify(
    {
      sourceSha:
        process.env.SMOKE_SOURCE_SHA ||
        execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      baseURL,
      kind: 'real production build, guest only, no secrets',
      entries,
      excludes: [
        'live OAuth',
        'authenticated end-to-end flow',
        'paid inference',
      ],
    },
    null,
    2,
  ),
)
console.log(
  'Integrated production-build smoke passed: 5 viewports, 10 captures, no provider calls',
)
