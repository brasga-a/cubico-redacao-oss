# Chat com IA (laboratório)

Primeira etapa da conversa com IA: um chat geral, isolado do corretor, usado para validar a infraestrutura com o **Gemini 3.8 Flash**. Fica em **`/laboratorio/chat`**, dentro do layout autenticado (mesmo login e lista de e-mails permitidos do resto do app). A página não aparece na navegação; acessa-se pela URL.

## Arquivos

| Camada | Arquivo |
|---|---|
| Contrato (cliente e servidor): limites, modos de contexto e validação Zod | `src/lib/chat/contract.ts` |
| Contextos (instruções de sistema; só no servidor) | `src/server/chat/contexts.server.ts` |
| Orquestração: origem, autenticação, limites, `streamText` e erros | `src/server/chat/chat.server.ts` |
| Contagem diária por usuário (sem conteúdo) | `src/server/chat/usage.server.ts`, `migrations/0006_chat_usage.sql` |
| Rota HTTP (streaming) | `src/routes/api/chat.ts` (`POST /api/chat`) |
| Interface | `src/components/chat/chat-panel.tsx`, `src/components/chat/chat-markdown.tsx` |
| Página experimental | `src/routes/_app/laboratorio/chat.tsx` |
| Testes | `src/server/chat/chat.test.ts` |

Nada disso importa o pipeline de correção. Do resto do app, só reaproveita autenticação (`requireAuthorizedUser`), proteção de origem (`assertSameOrigin`), o limitador por minuto (`BURST_LIMITER`, com a chave `chat:<usuário>`) e a tabela de preços (`modelCost`).

## Fluxo

1. O `useChat` (`@ai-sdk/react`) envia as mensagens da sessão por `DefaultChatTransport` para `POST /api/chat`, com `context: 'general'`.
2. No servidor, nesta ordem:
   - origem (`403`) e sessão com e-mail permitido (`401`);
   - limite por minuto (`429`);
   - corpo de no máximo 200 mil caracteres (`413`);
   - validação Zod (`400`): só mensagens `user` e `assistant` com partes de texto, no máximo 40 mensagens, e a última precisa ser do usuário e não vazia;
   - mensagem do usuário com até 4.000 caracteres (`413`);
   - limite diário (`429`).
3. A janela de contexto pega as 20 mensagens mais recentes, com até 24 mil caracteres no total, começando por uma mensagem do usuário.
4. O `streamText` chama o `gemini-3.8-flash` com:
   - a instrução de sistema do contexto (definida no servidor);
   - `thinkingLevel: 'medium'`;
   - `maxOutputTokens` de 2.048 (ajustável por `CHAT_MAX_OUTPUT_TOKENS`);
   - `maxRetries: 0` e **sem fallback**;
   - tempo limite de 60 s, também interrompido se o cliente cancelar.
5. A resposta volta como UI message stream (`toUIMessageStreamResponse`), e a interface a renderiza progressivamente. Erros do provedor viram mensagens legíveis no próprio stream:
   - `429`: "está limitando solicitações";
   - `503`: "indisponível no momento";
   - tempo esgotado: "demorou demais".
6. Ao terminar, falhar ou ser cancelada, a resposta soma na tabela `chat_usage` os tokens, o custo estimado e se falhou. Só contagens, nunca o texto.

**O que o cliente não controla:** modelo, esforço, instruções, limites e contexto. Campos extras como `model`, `effort` e `system` são descartados; um papel `system` ou um contexto desconhecido devolvem `400`.

## Modelo e esforço

Fixos no servidor: **Gemini 3.8 Flash** com esforço **médio** (`thinkingConfig.thinkingLevel: 'medium'`). O cliente não escolhe nenhum dos dois; um campo `model` ou `effort` no pedido é descartado.

## Interface

Usa os componentes AI Elements que já existiam no projeto: `MessageScroller` (rolagem automática que respeita a leitura do usuário, com botão "ir ao fim"), `Message`, `Bubble`, `InputGroup`, `Empty`, `Spinner` e `Button`. Tem:
- estado vazio com sugestões;
- Enter envia e Shift+Enter quebra a linha;
- botão para interromper a resposta e botão "Nova conversa";
- indicador "Pensando…" e anúncios para leitor de tela;
- erro com "Tentar novamente";
- Markdown seguro: HTML cru aparece como texto, links abrem em nova aba sem referrer, `javascript:` é removido e imagens viram links.

## Configuração

- `CHAT_DAILY_MESSAGE_LIMIT`: mensagens por usuário por dia UTC (padrão 50).
- `CHAT_MAX_OUTPUT_TOKENS`: limite de geração por resposta (padrão 2.048).
- **Migração 0006** (`chat_usage`): precisa ser aplicada no D1, local e remoto, antes de usar o chat.

## Pontos de extensão

Os modos `pre-writing` e `post-evaluation` estão descritos em `src/lib/chat/contract.ts` e em `contexts.server.ts`, mas não estão implementados. Para adicionar um modo:
1. acrescentar o id em `CHAT_CONTEXT_IDS`;
2. criar uma entrada no registro de contextos com a instrução de sistema e, se preciso, modelo e limites próprios;
3. no caso de `post-evaluation`, carregar a avaliação **no servidor**, para o dono autenticado, a partir de um id validado, nunca do payload do cliente;
4. passar `context` ao `ChatPanel`.

## Limitações

- A conversa vive só na sessão da aba: recarregar a página apaga tudo. Não há histórico no D1.
- Na única chamada real feita, o `gemini-3.8-flash` respondeu **503 "high demand" depois de 77 s**. O identificador é válido, mas a disponibilidade estava ruim no momento. Ainda não houve nenhuma resposta real bem-sucedida.
- O fluxo de streaming foi validado com o modelo simulado do AI SDK e com capturas da interface usando respostas simuladas, não com o Gemini respondendo de verdade.
- A interface não tem teste automatizado de componente (o projeto não tem testing-library).
