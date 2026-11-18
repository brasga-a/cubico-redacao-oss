import { existsSync, readFileSync } from 'node:fs'

export interface CloudflareWorkerConfig {
  name: string
  compatibilityDate: string
  compatibilityFlags?: string[]
  entrypoint?: string
  domains?: string[]
  env?: Record<string, unknown>
}

export interface CloudflareProjectConfig {
  worker: CloudflareWorkerConfig
}

function defineConfig<T extends CloudflareProjectConfig>(config: T): T {
  return config
}

/**
 * Placeholder D1 ID used for local development when `CUBICO_D1_ID` is unset.
 * Remote migrations and deploys refuse to run with it.
 */
export const LOCAL_D1_ID = '00000000-0000-4000-8000-000000000000'

/**
 * Deployment-specific, non-secret settings (worker name, domain, D1, R2).
 * They come from the process environment or from an optional, git-ignored
 * `.env.cloudflare` file next to this config (see `.env.cloudflare.example`).
 * Secrets never belong here: they go to `.dev.vars` / `cf deploy --secrets-file`.
 */
function readEnvFile(file: URL): Record<string, string> {
  if (!existsSync(file)) return {}
  const values: Record<string, string> = {}
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line)
    if (match) values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return values
}

const settings: Record<string, string | undefined> = {
  ...readEnvFile(new URL('./.env.cloudflare', import.meta.url)),
  ...process.env,
}

function setting(key: string, fallback: string): string {
  return settings[key]?.trim() || fallback
}

const domain = settings.CUBICO_DOMAIN?.trim()

export const workerConfig = {
  name: setting('CUBICO_WORKER_NAME', 'cubico-redacao'),
  compatibilityDate: '2025-09-02',
  compatibilityFlags: ['nodejs_compat'],
  entrypoint: '@tanstack/react-start/server-entry',
  ...(domain ? { domains: [domain] } : {}),
  env: {
    DB: {
      type: 'd1',
      name: setting('CUBICO_D1_NAME', 'cubico-redacao-db'),
      id: setting('CUBICO_D1_ID', LOCAL_D1_ID),
    },
    AVATARS: {
      type: 'r2',
      name: setting('CUBICO_R2_BUCKET', 'cubico-avatars'),
    },
    BURST_LIMITER: {
      type: 'rate-limit',
      namespace: setting('CUBICO_RATE_LIMIT_NAMESPACE', '1001'),
      simple: {
        limit: 10,
        period: 60,
      },
    },
    GEMINI_MODEL: {
      type: 'text',
      value: 'gemini-4-argon',
    },
    MONTHLY_CORRECTION_LIMIT: {
      type: 'text',
      value: '50',
    },
    DAILY_USER_LIMIT: {
      type: 'text',
      value: '30',
    },
    GLOBAL_CONCURRENT_LIMIT: {
      type: 'text',
      value: '2',
    },
    MAX_OUTPUT_TOKENS: {
      type: 'text',
      value: '12000',
    },
  },
} satisfies CloudflareWorkerConfig

export default defineConfig({
  worker: workerConfig,
})
