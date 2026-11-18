const STRING_ENV_KEYS = [
  'BETTER_AUTH_SECRET',
  'BETTER_AUTH_URL',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'ALLOWED_EMAILS',
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GEMINI_FALLBACK_MODEL',
  'MONTHLY_CORRECTION_LIMIT',
  'DAILY_USER_LIMIT',
  'GLOBAL_CONCURRENT_LIMIT',
  'MAX_OUTPUT_TOKENS',
  'INPUT_USD_PER_MILLION',
  'OUTPUT_USD_PER_MILLION',
  'TURNSTILE_SITE_KEY',
  'TURNSTILE_SECRET_KEY',
  'CHAT_DAILY_MESSAGE_LIMIT',
  'CHAT_MAX_OUTPUT_TOKENS',
] as const

export function stripQuotes(value: string): string {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim()
  }
  return trimmed
}

export function sanitizeEnv<T extends Record<string, unknown>>(
  rawEnv: T,
  fallbackEnv?: Record<string, string | undefined>,
): T {
  const normalized: Record<string, unknown> = { ...rawEnv }
  for (const key of STRING_ENV_KEYS) {
    const rawValue = normalized[key] ?? fallbackEnv?.[key]
    if (typeof rawValue === 'string') {
      normalized[key] = stripQuotes(rawValue)
    }
  }
  return normalized as T
}

export function isAllowedEmail(email: string, allowedEmails: string): boolean {
  const allowed = new Set(
    stripQuotes(allowedEmails)
      .split(/[;,\n]/)
      .map((value) => stripQuotes(value).toLowerCase())
      .filter(Boolean),
  )
  return allowed.has(stripQuotes(email).toLowerCase())
}

export function getTrustedOrigins(baseURL: string | undefined): Set<string> {
  const origins = new Set<string>()
  if (!baseURL) return origins
  try {
    const cleaned = stripQuotes(baseURL)
    if (!cleaned) return origins
    const url = new URL(cleaned)
    origins.add(url.origin)
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      const port = url.port ? `:${url.port}` : ''
      origins.add(`${url.protocol}//127.0.0.1${port}`)
      origins.add(`${url.protocol}//localhost${port}`)
    }
  } catch {
    // Invalid URL leaves the set empty.
  }
  return origins
}

export function isTrustedOrigin(request: Request, baseURL: string): boolean {
  try {
    const trusted = getTrustedOrigins(baseURL)
    if (trusted.size === 0) return false
    const originHeader = request.headers.get('origin')?.trim()
    if (!originHeader) return false
    const requestOrigin = new URL(request.url).origin
    return trusted.has(originHeader) && trusted.has(requestOrigin)
  } catch {
    return false
  }
}

