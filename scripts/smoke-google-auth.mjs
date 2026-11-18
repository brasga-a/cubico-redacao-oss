/** Real Better Auth initiation against an isolated Worker with dummy OAuth credentials.
 * Never completes Google login; external navigation is intercepted before network access.
 */
import { chromium, expect } from '@playwright/test'
const baseURL = process.env.AUTH_SMOKE_BASE_URL || 'http://127.0.0.1:3600'
if (!['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname))
  throw new Error('Only an isolated local auth server is allowed')
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
  headless: true,
})
let oauthTimeout
try {
  // A failed status lookup must not be mislabeled as missing OAuth configuration.
  const unavailable = await browser.newContext()
  let prematureSignIn = false
  await unavailable.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort()
    if (url.pathname.includes('/_serverFn/'))
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      })
    if (url.pathname === '/api/auth/sign-in/social') prematureSignIn = true
    return route.continue()
  })
  const failedPage = await unavailable.newPage()
  await failedPage.goto(baseURL)
  await failedPage.waitForLoadState('networkidle')
  // Initial route data is server-rendered; a client navigation exercises an unavailable protected-route check.
  await failedPage.waitForFunction(() => Boolean(window.__TSR_ROUTER__))
  await failedPage.evaluate(() =>
    window.__TSR_ROUTER__.navigate({ to: '/editor' }),
  )
  await expect(failedPage.getByRole('alert')).toBeVisible()
  await expect(
    failedPage.getByRole('button', { name: 'Continuar com Google' }),
  ).toHaveCount(0)
  await failedPage.getByRole('button', { name: 'Atualizar acesso' }).click()
  await expect(failedPage.getByRole('alert')).toBeVisible()
  await expect(
    failedPage.getByText('O proprietário ainda não configurou o login.'),
  ).toHaveCount(0)
  expect(prematureSignIn).toBe(false)
  await unavailable.close()
  const context = await browser.newContext()
  const page = await context.newPage()
  let posts = 0,
    interceptedGoogle = false
  let resolveOAuth
  const actualOAuth = new Promise((resolve) => {
    resolveOAuth = resolve
  })
  let releaseFailure
  const heldFailure = new Promise((resolve) => {
    releaseFailure = resolve
  })
  await context.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url())
    if (url.hostname === 'accounts.google.com') {
      interceptedGoogle = true
      return route.fulfill({
        contentType: 'text/html',
        body: '<h1>OAuth navigation intercepted locally</h1>',
      })
    }
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort()
    if (url.pathname === '/api/auth/sign-in/social') {
      posts++
      expect(request.method()).toBe('POST')
      expect(request.postDataJSON()).toMatchObject({
        provider: 'google',
        callbackURL: '/editor',
        errorCallbackURL: '/login?error=oauth',
      })
      if (posts === 1) {
        await heldFailure
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            code: 'TEST_UNAVAILABLE',
            message: 'Test failure',
          }),
        })
      }
      const upstream = await route.fetch({ maxRedirects: 0 })
      const payload = await upstream.json()
      resolveOAuth({ status: upstream.status(), payload })
      return route.fulfill({ response: upstream })
    }
    return route.continue()
  })
  await page.goto(baseURL)
  await page.waitForLoadState('networkidle')
  const button = page.getByRole('button', { name: 'Continuar com Google' })
  await expect(button).toBeVisible()
  const firstRequest = page.waitForRequest(
    (r) => new URL(r.url()).pathname === '/api/auth/sign-in/social',
  )
  await button.click()
  await firstRequest
  await expect(
    page.getByRole('button', { name: 'Conectando ao Google…' }),
  ).toBeDisabled()
  expect(posts).toBe(1)
  releaseFailure()
  await expect(
    page.getByText(
      'Não foi possível iniciar o acesso Google. Tente novamente.',
    ),
  ).toBeVisible()
  await expect(button).toBeEnabled()
  // Second attempt reaches the actual Worker/Better Auth/D1, with dummy credentials.
  await button.click()
  const response = await Promise.race([
    actualOAuth,
    new Promise((_, reject) => {
      oauthTimeout = setTimeout(
        () => reject(new Error('Timed out initiating OAuth')),
        15000,
      )
    }),
  ])
  clearTimeout(oauthTimeout)
  expect(response.status).toBe(200)
  const result = response.payload
  expect(result.redirect).toBe(true)
  const target = new URL(result.url)
  expect(target.hostname).toBe('accounts.google.com')
  expect(target.searchParams.get('redirect_uri')).toBe(
    `${baseURL}/api/auth/callback/google`,
  )
  expect(target.searchParams.get('client_id')).toBe(
    'local-test.apps.googleusercontent.com',
  )
  expect(Boolean(target.searchParams.get('state'))).toBe(true)
  await page.waitForURL((url) => url.hostname === 'accounts.google.com')
  expect(interceptedGoogle).toBe(true)
  expect(posts).toBe(2)
  const cookies = await context.cookies(baseURL)
  expect(
    cookies.some(
      (c) =>
        c.name.startsWith('better-auth.') && c.httpOnly && c.sameSite === 'Lax',
    ),
  ).toBe(true)
  const forbidden = await context.request.post(
    `${baseURL}/api/auth/sign-in/social`,
    {
      headers: { origin: 'https://example.invalid' },
      data: { provider: 'google', callbackURL: '/' },
    },
  )
  expect(forbidden.status()).toBe(403)
  console.log(
    'PASS: actual Better Auth Google initiation, OAuth state cookie, loading, failure/retry, unavailable status, and cross-origin rejection; no Google/Gemini network requests',
  )
} finally {
  clearTimeout(oauthTimeout)
  await browser.close()
}
