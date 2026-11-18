import type { Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url())
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return route.abort()
    return route.continue()
  })
})
const open = async (page: Page, scenario: string) => {
  await page.goto(`/visual/index.html?scenario=${scenario}`)
  await page.locator('[data-fixture-controls]').evaluate((el) => {
    ;(el as HTMLElement).style.bottom = '100px'
  })
}
test('editor validates, adds/removes texts and preserves a draft when cancelling wait', async ({
  page,
}) => {
  await open(page, 'editor-empty')
  await page.getByRole('button', { name: 'Corrigir redação' }).click()
  await expect(page.getByLabel('Tema', { exact: true })).toBeFocused()
  await page.getByLabel('Tema', { exact: true }).fill('Tema de teste')
  await page
    .getByRole('textbox', { name: 'Redação', exact: true })
    .fill(
      'Texto escrito durante o teste. Sem número mínimo artificial de linhas.',
    )
  await page.getByRole('button', { name: /Textos motivadores/ }).click()
  await page.getByRole('button', { name: 'Adicionar texto motivador' }).click()
  await page
    .getByRole('textbox', { name: 'TEXTO I', exact: true })
    .fill('Texto de apoio')
  await page.getByRole('button', { name: 'Remover Texto I' }).click()
  await page
    .getByRole('textbox', { name: 'Redação', exact: true })
    .press('Control+Enter')
  await expect(
    page.getByText('Aguardando a correção', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveCount(0)
  await page.getByRole('button', { name: 'Voltar ao editor' }).click()
  await expect(
    page.getByRole('textbox', { name: 'Redação', exact: true }),
  ).toHaveValue(
    'Texto escrito durante o teste. Sem número mínimo artificial de linhas.',
  )
})
test('menus and confirmation support Escape and cancel without losing data', async ({
  page,
}) => {
  await open(page, 'editor-filled')
  const original = await page
    .getByRole('textbox', { name: 'Redação', exact: true })
    .inputValue()
  await page.getByRole('button', { name: 'Mais opções' }).click()
  await page.getByRole('menuitem', { name: 'Apagar texto' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: 'Redação', exact: true }),
  ).toHaveValue(original)
  await page.getByRole('button', { name: 'Temas anteriores' }).click()
  await expect(page.getByRole('menu')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Temas anteriores' }),
  ).toBeFocused()
})
test('evaluation tabs, keyboard marks, filters and revision preserve the original', async ({
  page,
}) => {
  await open(page, 'text')
  await expect(
    page.getByRole('tab', { name: /Texto comentado/ }),
  ).toHaveAttribute('aria-selected', 'true')
  const marks = page.locator('mark[role=button]')
  await expect(marks).toHaveCount(2)
  await marks.first().focus()
  await page.keyboard.press('Enter')
  await expect(marks.first()).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'C1 0', exact: true }).click()
  await expect(
    page.getByText('Nenhum apontamento com estes filtros'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Limpar filtros' }).click()
  await expect(marks).toHaveCount(2)
  await page.getByRole('button', { name: 'Revisar texto' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Substituir rascunho' }).click()
  await page.getByLabel('Título (opcional)').fill('Revisão')
  await page.getByRole('button', { name: 'Correções 2' }).click()
  await expect(page.getByRole('button', { name: /840/ })).toHaveCount(2)
})
for (const [width, height] of [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
  [360, 800],
]) {
  test(`all fixture screens render without horizontal overflow at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height })
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    for (const scenario of [
      'login',
      'login-loading',
      'login-error',
      'editor-empty',
      'editor-filled',
      'processing',
      'error-network',
      'error-service',
      'evaluation',
      'evaluation-zero',
      'text',
      'text-empty',
      'history-empty',
      'history',
      'saving',
      'save-error',
      'security-error',
    ]) {
      await open(page, scenario)
      await expect(page.locator('h1')).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        scenario,
      ).toBe(true)
    }
    expect(errors).toEqual([])
  })
}

for (const scenario of [
  'login',
  'editor-empty',
  'evaluation',
  'text',
  'history',
]) {
  test(`WCAG automated checks: ${scenario}`, async ({ page }) => {
    await open(page, scenario)
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()
    expect(
      results.violations.map((v) => ({
        id: v.id,
        description: v.description,
        nodes: v.nodes.map((n) => n.target),
      })),
    ).toEqual([])
  })
}

test('zero and unannotated scenarios are distinct from the default result', async ({
  page,
}) => {
  await open(page, 'evaluation-zero')
  await expect(
    page.getByRole('img', { name: '0 de 1000 pontos' }),
  ).toBeVisible()
  await open(page, 'text-empty')
  await expect(page.locator('mark')).toHaveCount(0)
  await expect(
    page.getByText('Nenhum apontamento com estes filtros'),
  ).toBeVisible()
})

for (const width of [390, 360]) {
  test(`requirements popover is reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/visual/index.html?scenario=editor-filled')
    const requirementLeft = (await page
      .getByRole('button', { name: /^Requisitos/ })
      .boundingBox())!.x
    const visibleStatRight = await page
      .getByTestId('editor-stats')
      .evaluate((el) =>
        Math.max(
          ...Array.from(el.children)
            .filter((child) => getComputedStyle(child).display !== 'none')
            .map((child) => child.getBoundingClientRect().right),
        ),
      )
    expect(visibleStatRight).toBeLessThanOrEqual(requirementLeft)
    await page.getByRole('button', { name: /^Requisitos/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: /^Requisitos/ }),
    ).toBeFocused()
  })
}
