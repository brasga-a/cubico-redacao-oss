import '@tanstack/react-start/server-only'
import { env } from 'cloudflare:workers'
import { sanitizeEnv } from './access-policy'

export { sanitizeEnv }

export interface Env {
  DB: D1Database
  /** Profile photos (private; served only to their owner through /api/avatar). */
  AVATARS?: R2Bucket
  BURST_LIMITER: RateLimit
  BETTER_AUTH_SECRET: string
  BETTER_AUTH_URL: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ALLOWED_EMAILS: string
  GEMINI_API_KEY: string
  GEMINI_MODEL?: string
  GEMINI_FALLBACK_MODEL?: string
  MONTHLY_CORRECTION_LIMIT?: string
  DAILY_USER_LIMIT?: string
  GLOBAL_CONCURRENT_LIMIT?: string
  MAX_OUTPUT_TOKENS?: string
  INPUT_USD_PER_MILLION?: string
  OUTPUT_USD_PER_MILLION?: string
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  /** Experimental chat: messages per user per UTC day (default 50). */
  CHAT_DAILY_MESSAGE_LIMIT?: string
  /** Experimental chat: generation limit per reply (default 2048). */
  CHAT_MAX_OUTPUT_TOKENS?: string
}

export function getEnv(): Env {
  const raw = env as unknown as Record<string, unknown>
  const processEnv = typeof process !== 'undefined' ? process.env : undefined
  return sanitizeEnv(raw, processEnv) as unknown as Env
}
