import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './visual/e2e',
  testMatch: '**/*.pw.ts',
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3200',
    viewport: { width: 1440, height: 900 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    reducedMotion: 'reduce',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    },
  },
  webServer: {
    command: 'bun run visual:dev',
    url: 'http://127.0.0.1:3200/visual/index.html',
    reuseExistingServer: true,
  },
  reporter: 'list',
})
