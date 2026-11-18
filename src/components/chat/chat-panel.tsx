import { useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { ArrowUp, MessageSquareText, Plus, RotateCcw, Square } from 'lucide-react'
import { ChatMarkdown } from './chat-markdown'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupTextarea,
} from '@/components/ui/input-group'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Spinner } from '@/components/ui/spinner'
import { CHAT_LIMITS, messageText } from '@/lib/chat/contract'
import type { ChatContextId } from '@/lib/chat/contract'

const SUGGESTIONS = [
  'Quais são as cinco competências da redação do ENEM?',
  'Me explique o que é repertório sociocultural, com exemplos.',
  'Como montar uma proposta de intervenção completa?',
]

/**
 * Experimental conversation UI. State lives in useChat (session only, nothing is
 * persisted); the server decides model, instructions and limits for `context`.
 */
export function ChatPanel({ context = 'general' }: { context?: ChatContextId }) {
  const [transport] = useState(
    () => new DefaultChatTransport({ api: '/api/chat', body: { context } }),
  )
  const { messages, sendMessage, status, stop, error, regenerate, setMessages, clearError } =
    useChat({ transport })
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const busy = status === 'submitted' || status === 'streaming'
  const tooLong = input.length > CHAT_LIMITS.maxMessageChars
  const full = messages.length >= CHAT_LIMITS.maxConversationMessages - 1
  const canSend = !busy && !full && !tooLong && input.trim().length > 0

  function send(text: string) {
    const value = text.trim()
    if (!value || busy || full || value.length > CHAT_LIMITS.maxMessageChars) return
    clearError()
    void sendMessage({ text: value })
    setInput('')
  }

  function newConversation() {
    if (busy) void stop()
    setMessages([])
    clearError()
    setInput('')
    inputRef.current?.focus()
  }

  const lastAssistantStreaming =
    status === 'streaming' && messages.at(-1)?.role === 'assistant'

  return (
    <div className="mx-auto flex h-[calc(100dvh-3.5rem-1px)] w-full max-w-3xl flex-col px-4 sm:px-6">
      <div className="flex items-center justify-between gap-3 border-b py-3">
        <div className="min-w-0">
          <h1 className="text-sm font-medium">Chat · laboratório</h1>
          <p className="truncate text-xs text-muted-foreground">
            Gemini 3.8 Flash · experimental · a conversa não é salva
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={newConversation}
          disabled={messages.length === 0 && !error}
        >
          <Plus />
          Nova conversa
        </Button>
      </div>

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="flex-1">
          <MessageScrollerViewport aria-label="Conversa">
            <MessageScrollerContent className="py-6">
              {messages.length === 0 && !error ? (
                <Empty className="my-auto">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <MessageSquareText />
                    </EmptyMedia>
                    <EmptyTitle>Converse com a IA do Cúbico</EmptyTitle>
                    <EmptyDescription>
                      Tire dúvidas sobre a redação do ENEM ou qualquer outro assunto.
                      Esta versão ainda não acessa suas redações e correções.
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <div className="flex flex-col gap-2">
                      {SUGGESTIONS.map((s) => (
                        <Button
                          key={s}
                          variant="outline"
                          className="h-auto justify-start whitespace-normal py-2 text-left"
                          onClick={() => send(s)}
                        >
                          {s}
                        </Button>
                      ))}
                    </div>
                  </EmptyContent>
                </Empty>
              ) : (
                messages.map((message) => {
                  const text = messageText({
                    parts: message.parts.filter(
                      (p): p is { type: 'text'; text: string } => p.type === 'text',
                    ),
                  })
                  return (
                    <MessageScrollerItem
                      key={message.id}
                      messageId={message.id}
                      scrollAnchor={message.role === 'user'}
                    >
                      {message.role === 'user' ? (
                        <Message align="end">
                          <MessageContent>
                            <Bubble variant="secondary" align="end">
                              <BubbleContent className="whitespace-pre-wrap">
                                <span className="sr-only">Você: </span>
                                {text}
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      ) : (
                        <Message>
                          <MessageContent>
                            <Bubble variant="ghost">
                              <BubbleContent>
                                <span className="sr-only">Assistente: </span>
                                <ChatMarkdown>{text}</ChatMarkdown>
                              </BubbleContent>
                            </Bubble>
                          </MessageContent>
                        </Message>
                      )}
                    </MessageScrollerItem>
                  )
                })
              )}

              {status === 'submitted' && (
                <MessageScrollerItem>
                  <Message>
                    <MessageContent>
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Spinner aria-hidden className="text-brand" />
                        Pensando…
                      </p>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )}

              {error && (
                <MessageScrollerItem>
                  <Message>
                    <MessageContent>
                      <Bubble variant="destructive">
                        <BubbleContent role="alert" className="flex flex-col items-start gap-2">
                          {error.message || 'Não foi possível gerar a resposta.'}
                          {messages.length > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                clearError()
                                void regenerate()
                              }}
                            >
                              <RotateCcw />
                              Tentar novamente
                            </Button>
                          )}
                        </BubbleContent>
                      </Bubble>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <p className="sr-only" aria-live="polite">
        {status === 'submitted'
          ? 'Gerando resposta.'
          : lastAssistantStreaming
            ? 'Recebendo resposta.'
            : ''}
      </p>

      <form
        className="pb-4 pt-2"
        onSubmit={(e) => {
          e.preventDefault()
          send(input)
        }}
      >
        {full && (
          <p className="mb-2 text-xs text-muted-foreground">
            Esta conversa atingiu o limite de mensagens. Inicie uma nova conversa.
          </p>
        )}
        <InputGroup>
          <label htmlFor="chat-input" className="sr-only">
            Mensagem
          </label>
          <InputGroupTextarea
            id="chat-input"
            ref={inputRef}
            value={input}
            rows={1}
            placeholder="Escreva sua mensagem…"
            className="max-h-48 min-h-11"
            aria-invalid={tooLong || undefined}
            aria-describedby="chat-hint"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(input)
              }
            }}
          />
          <InputGroupAddon align="block-end">
            <InputGroupText
              id="chat-hint"
              className={tooLong ? 'mr-auto text-destructive' : 'mr-auto max-sm:hidden'}
            >
              {tooLong
                ? `Máximo de ${CHAT_LIMITS.maxMessageChars.toLocaleString('pt-BR')} caracteres`
                : 'Enter envia · Shift+Enter quebra a linha'}
            </InputGroupText>
            {busy ? (
              <InputGroupButton
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => void stop()}
                aria-label="Interromper resposta"
              >
                <Square />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                disabled={!canSend}
                aria-label="Enviar mensagem"
              >
                <ArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}
