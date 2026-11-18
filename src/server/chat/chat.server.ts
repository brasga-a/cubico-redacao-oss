import '@tanstack/react-start/server-only'

import { convertToModelMessages, streamText } from 'ai'
import type { LanguageModel, UIMessage } from 'ai'
import {
  CHAT_LIMITS,
  chatRequestSchema,
  messageText,
} from '../../lib/chat/contract'
import type { ChatMessage } from '../../lib/chat/contract'
import { modelCost } from '../../lib/pricing'
import type { AuthorizedUser } from '../auth.server'
import type { Env } from '../env.server'
import { AppError } from '../errors.server'
import { getChatContext } from './contexts.server'
import {
  DEFAULT_CHAT_DAILY_LIMIT,
  recordChatUsage,
  reserveChatMessage,
} from './usage.server'

/** Gemini API id (checked on the official pricing page). Fixed: no client choice, no fallback. */
export const CHAT_MODEL = 'gemini-3.8-flash'
export const CHAT_MODEL_NAME = 'Gemini 3.8 Flash'
/** Thinking level sent to Gemini. */
export const CHAT_EFFORT = 'medium'
export const CHAT_TIMEOUT_MS = 60_000
export const DEFAULT_CHAT_MAX_OUTPUT_TOKENS = 2_048
/** Raw request body bound, checked before parsing. */
const MAX_BODY_CHARS = 200_000

export type ChatDeps = {
  requireUser: (request: Request, env: Env) => Promise<AuthorizedUser>
  /** The language model for an allowlisted Gemini id; tests inject a mock instead. */
  model: (env: Env, apiId: string) => Promise<LanguageModel>
  now: () => number
}

export const defaultChatDeps: ChatDeps = {
  requireUser: async (request, env) =>
    (await import('../auth.server')).requireAuthorizedUser(request, env),
  model: async (env, apiId) => {
    const { createGoogle } = await import('@ai-sdk/google')
    return createGoogle({ apiKey: env.GEMINI_API_KEY })(apiId)
  },
  now: () => Date.now(),
}

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}

function positive(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

/**
 * Most recent messages that fit the context limits, starting with a user turn. The last
 * (current) message is always kept.
 */
export function contextWindow(messages: ChatMessage[]): ChatMessage[] {
  const window = messages.slice(-CHAT_LIMITS.maxContextMessages)
  let total = window.reduce((n, m) => n + messageText(m).length, 0)
  while (window.length > 1 && total > CHAT_LIMITS.maxContextChars) {
    total -= messageText(window.shift()!).length
  }
  while (window.length > 1 && window[0].role !== 'user') window.shift()
  return window
}

/** Safe, user-facing message for a provider or transport failure. */
export function chatErrorMessage(
  error: unknown,
  modelName = 'modelo',
): string {
  const e = (error ?? {}) as {
    statusCode?: unknown
    status?: unknown
    name?: unknown
    message?: unknown
    lastError?: unknown
    cause?: unknown
  }
  const inner = (e.lastError ?? e.cause ?? {}) as { statusCode?: unknown }
  const status = e.statusCode ?? e.status ?? inner.statusCode
  const message = typeof e.message === 'string' ? e.message : ''
  if (e.name === 'TimeoutError' || /timed? ?out|timeout/i.test(message))
    return 'A resposta demorou demais e foi interrompida. Tente novamente.'
  if (status === 429)
    return `O ${modelName} está limitando solicitações agora. Aguarde um pouco e tente novamente.`
  if (status === 503 || /high demand|UNAVAILABLE/.test(message))
    return `O ${modelName} está indisponível no momento. Tente novamente em instantes.`
  if (status === 401 || status === 403)
    return 'O serviço de IA recusou a autenticação do servidor.'
  return 'Não foi possível gerar a resposta. Tente novamente.'
}

/**
 * POST /api/chat. Origin → session/allowlist → burst limit → payload validation → daily
 * limit → streamText with a server-defined context. Responds with the AI SDK UI message
 * stream; failures before streaming are plain-text responses with an HTTP status.
 */
export async function handleChat(
  request: Request,
  env: Env,
  deps: ChatDeps = defaultChatDeps,
): Promise<Response> {
  let user: AuthorizedUser
  try {
    const { assertSameOrigin } = await import('../security.server')
    assertSameOrigin(request, env)
    user = await deps.requireUser(request, env)
  } catch (error) {
    if (error instanceof AppError && error.code === 'CSRF_REJECTED')
      return plain(403, 'Origem da solicitação não autorizada.')
    return plain(401, 'Entre com uma conta autorizada para usar o chat.')
  }

  // Required bindings can be absent in a misconfigured Worker; keep this runtime guard.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (env.BURST_LIMITER) {
    const burst = await env.BURST_LIMITER.limit({ key: `chat:${user.id}` })
    if (!burst.success)
      return plain(429, 'Muitas mensagens em sequência. Aguarde um minuto.')
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_CHARS)
    return plain(413, 'A conversa ficou longa demais. Inicie uma nova conversa.')
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return plain(400, 'Solicitação inválida.')
  }
  const parsed = chatRequestSchema.safeParse(body)
  if (!parsed.success) {
    const tooMany = parsed.error.issues.some(
      (i) => i.path[0] === 'messages' && i.code === 'too_big',
    )
    return tooMany
      ? plain(413, 'A conversa atingiu o limite de mensagens. Inicie uma nova conversa.')
      : plain(400, 'Solicitação inválida.')
  }
  const { messages, context } = parsed.data
  const last = messages.at(-1)!
  const lastText = messageText(last).trim()
  if (last.role !== 'user' || !lastText)
    return plain(400, 'Escreva uma mensagem.')
  if (
    messages.some(
      (m) => m.role === 'user' && messageText(m).length > CHAT_LIMITS.maxMessageChars,
    )
  )
    return plain(
      413,
      `A mensagem passa de ${CHAT_LIMITS.maxMessageChars.toLocaleString('pt-BR')} caracteres.`,
    )

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (!env.DB) return plain(503, 'O controle de uso do chat não está disponível.')
  // A secret can be absent in a misconfigured Worker despite the declared type.
  if (typeof env.GEMINI_API_KEY !== 'string' || !env.GEMINI_API_KEY.trim())
    return plain(503, 'O serviço de IA não está configurado no servidor.')
  const now = deps.now()
  const allowed = await reserveChatMessage(
    env.DB,
    user.id,
    now,
    positive(env.CHAT_DAILY_MESSAGE_LIMIT, DEFAULT_CHAT_DAILY_LIMIT),
  )
  if (!allowed)
    return plain(429, 'Você atingiu o limite diário de mensagens do chat. Tente amanhã.')

  const model = await deps.model(env, CHAT_MODEL)
  const definition = getChatContext(context)
  let recorded = false
  const record = async (
    usage: { inputTokens?: number; outputTokens?: number; outputTokenDetails?: { reasoningTokens?: number }; inputTokenDetails?: { cacheReadTokens?: number } } | undefined,
    failed: boolean,
  ) => {
    if (recorded) return
    recorded = true
    const thoughts = usage?.outputTokenDetails?.reasoningTokens ?? 0
    const counts = {
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: Math.max(0, (usage?.outputTokens ?? 0) - thoughts),
      thoughtTokens: thoughts,
      cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
    }
    await recordChatUsage(env.DB, user.id, now, {
      ...counts,
      estimatedCostUsd: modelCost(CHAT_MODEL, counts, env),
      failed,
    }).catch(() => {
      // Accounting must never break the conversation; no content is involved here.
    })
  }

  const result = streamText({
    model,
    system: definition.system,
    messages: await convertToModelMessages(
      contextWindow(messages) as unknown as UIMessage[],
    ),
    maxOutputTokens: positive(env.CHAT_MAX_OUTPUT_TOKENS, DEFAULT_CHAT_MAX_OUTPUT_TOKENS),
    providerOptions: { google: { thinkingConfig: { thinkingLevel: CHAT_EFFORT } } },
    // Measure 3.8 Flash as it is: no hidden retries and no fallback model.
    maxRetries: 0,
    abortSignal: AbortSignal.any([request.signal, AbortSignal.timeout(CHAT_TIMEOUT_MS)]),
    onFinish: ({ totalUsage }) => record(totalUsage, false),
    onError: () => record(undefined, true),
    onAbort: () => record(undefined, true),
  })
  return result.toUIMessageStreamResponse({
    headers: { 'Cache-Control': 'no-store' },
    onError: (error) => chatErrorMessage(error, CHAT_MODEL_NAME),
  })
}
