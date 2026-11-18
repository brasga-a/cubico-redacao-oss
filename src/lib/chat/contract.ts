import { z } from 'zod'

/**
 * Experimental chat contract, shared by the client and the /api/chat route.
 * Independent from the essay-correction contracts.
 */

/**
 * Conversation contexts. Only `general` exists today. Planned: `pre-writing` (theme,
 * planning, repertoire and arguments before writing) and `post-evaluation` (explaining an
 * existing evaluation). Each new mode adds an id here and an entry in the server context
 * registry (src/server/chat/contexts.server.ts); the client can never send instructions.
 */
export const CHAT_CONTEXT_IDS = ['general'] as const
export type ChatContextId = (typeof CHAT_CONTEXT_IDS)[number]

export const CHAT_LIMITS = {
  /** Characters of one user message. */
  maxMessageChars: 4_000,
  /** Messages kept in the client conversation (older ones must start a new chat). */
  maxConversationMessages: 40,
  /** Most recent messages sent to the model (context window). */
  maxContextMessages: 20,
  /** Characters of all messages sent to the model. */
  maxContextChars: 24_000,
} as const

const textPart = z.object({
  type: z.literal('text'),
  text: z.string().max(CHAT_LIMITS.maxMessageChars * 4),
})

/**
 * Only plain text parts from the user and the assistant are accepted. Anything else a
 * client could inject (system messages, tool calls, files, extra fields) is rejected or
 * stripped, so instructions and model choice stay on the server.
 */
export const chatMessageSchema = z.object({
  id: z.string().min(1).max(100),
  role: z.enum(['user', 'assistant']),
  parts: z
    .array(z.union([textPart, z.object({ type: z.literal('step-start') })]))
    .max(50),
})
export type ChatMessage = z.infer<typeof chatMessageSchema>

export const chatRequestSchema = z.object({
  id: z.string().min(1).max(100).optional(),
  context: z.enum(CHAT_CONTEXT_IDS).default('general'),
  messages: z
    .array(chatMessageSchema)
    .min(1)
    .max(CHAT_LIMITS.maxConversationMessages),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>

export function messageText(message: Pick<ChatMessage, 'parts'>): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
}
