export type PriceOverrides = {
  INPUT_USD_PER_MILLION?: string
  OUTPUT_USD_PER_MILLION?: string
}

export type TokenRates = {
  inputUsdPerMillion: number
  outputUsdPerMillion: number
}

export const GEMINI_PRICE_CHANGE_DATE = '2026-12-01'

const GEMINI_PRICES = {
  beforeChange: { inputUsdPerMillion: 2, outputUsdPerMillion: 10 },
  afterChange: { inputUsdPerMillion: 4, outputUsdPerMillion: 20 },
} as const

function parseRate(value: string | undefined, fallback: number): number {
  if (!value?.trim()) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Invalid Gemini token rate configuration.')
  }
  return parsed
}

export function getGeminiTokenRates(
  overrides: PriceOverrides,
  date = new Date(),
): TokenRates {
  const defaultRates =
    date.toISOString().slice(0, 10) < GEMINI_PRICE_CHANGE_DATE
      ? GEMINI_PRICES.beforeChange
      : GEMINI_PRICES.afterChange

  return {
    inputUsdPerMillion: parseRate(
      overrides.INPUT_USD_PER_MILLION,
      defaultRates.inputUsdPerMillion,
    ),
    outputUsdPerMillion: parseRate(
      overrides.OUTPUT_USD_PER_MILLION,
      defaultRates.outputUsdPerMillion,
    ),
  }
}

export function calculateGeminiCost(
  rates: TokenRates,
  inputTokens: number,
  outputTokens: number,
  thoughtTokens: number,
): number {
  const rawCost =
    (inputTokens * rates.inputUsdPerMillion +
      (outputTokens + thoughtTokens) * rates.outputUsdPerMillion) /
    1_000_000
  return Number(rawCost.toFixed(8))
}

/**
 * Flash models with the same published standard paid-tier rates (Gemini API pricing
 * page, checked 2026-11-05): input US$ 0.75 / output incl. thinking US$ 3.75 /
 * context-cache read US$ 0.075 per 1M tokens through 2026-12-31, then 1.50 / 7.50 / 0.15.
 */
const FLASH_MODELS: readonly string[] = ['gemini-3.6-flash', 'gemini-3.8-flash']

/**
 * Gemini 2.5 Pro (deprecated). Standard paid tier, checked 2026-11-05: per 1M tokens,
 * prompts up to 200k tokens: input 1.25 / output incl. thinking 10.00 / cache read 0.125;
 * longer prompts: 2.50 / 15.00 / 0.25. From 2026-12-01 every request to this id is
 * routed to gemini-3.8-flash and billed at Flash rates.
 */
const PRO_25 = 'gemini-2.5-pro'
export const PRO_25_ROUTED_FROM = '2026-12-01'

function pro25Cost(usage: {
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  cacheReadTokens?: number
}): number {
  const long = usage.inputTokens > 200_000
  const input = long ? 2.5 : 1.25,
    output = long ? 15 : 10,
    cacheRate = long ? 0.25 : 0.125
  const cache = Math.min(usage.inputTokens, usage.cacheReadTokens ?? 0)
  return Number(
    (
      ((usage.inputTokens - cache) * input +
        cache * cacheRate +
        (usage.outputTokens + usage.thoughtTokens) * output) /
      1e6
    ).toFixed(8),
  )
}

export function modelCost(
  model: string,
  usage: {
    inputTokens: number
    outputTokens: number
    thoughtTokens: number
    cacheReadTokens?: number
  },
  overrides: PriceOverrides = {},
  date = new Date(),
): number {
  if (!['gemini-4-argon', PRO_25, ...FLASH_MODELS].includes(model))
    throw new Error('No configured pricing for this model.')
  const day = date.toISOString().slice(0, 10)
  // From the routing date Google serves and bills 2.5 Pro calls as 3.8 Flash.
  if (model === PRO_25 && day < PRO_25_ROUTED_FROM) return pro25Cost(usage)
  const flash = model === PRO_25 || FLASH_MODELS.includes(model),
    later = day >= '2027-01-01',
    argonLater = date.toISOString().slice(0, 10) >= GEMINI_PRICE_CHANGE_DATE
  const rates = flash
    ? {
        inputUsdPerMillion: later ? 1.5 : 0.75,
        outputUsdPerMillion: later ? 7.5 : 3.75,
      }
    : getGeminiTokenRates(overrides, date)
  const cache = Math.min(usage.inputTokens, usage.cacheReadTokens ?? 0),
    cacheRate = flash ? (later ? 0.15 : 0.075) : argonLater ? 0.2 : 0.1
  return Number(
    (
      ((usage.inputTokens - cache) * rates.inputUsdPerMillion +
        cache * cacheRate +
        (usage.outputTokens + usage.thoughtTokens) *
          rates.outputUsdPerMillion) /
      1e6
    ).toFixed(8),
  )
}
