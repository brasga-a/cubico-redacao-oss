# Histórico de avaliações na nuvem (Cloudflare D1)

O histórico de avaliações concluídas fica no D1 e é sincronizado entre dispositivos da mesma conta. O IndexedDB (`cubico-history-v1`) virou legado: só é lido para oferecer a importação e só é apagado a pedido do usuário. Rascunhos continuam somente no `sessionStorage` do navegador.

## Esquema (`migrations/0003_evaluation_history.sql`, aditiva)

| Tabela | Conteúdo |
|---|---|
| `evaluations` | metadados: `id`, `user_id` (FK `user`, CASCADE), `request_id` (UNIQUE, idempotência), `created_at` (ms), `theme`, `title`, `total_score`, `c1`–`c5` (CHECK na escala oficial; CHECK total = soma), `word_count`, `model_id`, `rubric_version`, `schema_version`, `parent_id`, `origin` (`correction`/`import`), `stored_at` |
| `evaluation_payloads` | `evaluation_id` (PK, FK `evaluations`, CASCADE), `input_json`, `result_json` |
| `history_preferences` | consentimento por usuário: `cloud_enabled`, `consent_version`, `consented_at`, `revoked_at`, `updated_at` |

Índices: `(user_id, created_at DESC, id DESC)` para listagem e `created_at` para a varredura de retenção. Nenhuma tabela de auth ou de consumo é alterada.

## Fluxos

- **Correção** (`src/server/correction-flow.server.ts`): origem → Zod → sessão → (se já houver avaliação salva para o `requestId`, devolve-a com `persistence.status = 'recovered'`, sem inferência) → Turnstile → reserva de quota → Gemini → `finishUsage` → `persistCorrection`. A resposta mantém `{ ok, data }` e acrescenta `persistence: saved | recovered | disabled | failed`. A gravação ocorre após a contabilização; falha de D1 vira `failed` e o resultado é devolvido normalmente.
- **Histórico** (`src/server/history-api.server.ts` + `history.server.ts`): listar (paginação keyset, só metadados), abrir (payload revalidado com Zod), excluir uma, excluir todas (`{ confirm: true }`), ler/alterar preferência, importar. Todas checam origem e sessão (inclusive leituras); o `user_id` vem sempre da sessão.
- **Importação**: o navegador lê o IndexedDB sem alterá-lo, valida cada registro com Zod, mostra quantos podem ser importados e pede confirmação. Envia lotes de 5; o servidor revalida, ignora `owner`, preserva `id`, `createdAt`, resultado e `parentId`, e responde por registro (`imported`, `duplicate`, `failed: invalid|too_large|expired|conflict|retention`). Repetir é seguro (retomável). A cópia local só pode ser apagada depois que todos os registros foram confirmados na nuvem.
- **Consentimento**: desativado por padrão. Ativar exige confirmação explícita (`consentVersion = 1`). Revogar só interrompe novas gravações; nada é apagado silenciosamente. Importar exige consentimento ativo.

## Cache no dispositivo

`src/lib/workbench/history-cache.ts` mantém uma cópia do histórico no IndexedDB (`cubico-cache-v1`, uma entrada por conta). O D1 continua sendo a fonte da verdade.

- Ao abrir o app, a lista aparece pela cópia local e é reconciliada com a listagem do servidor: IDs novos entram como metadados; IDs ausentes no servidor (excluídos em outro dispositivo ou expirados) saem junto com o conteúdo. Sem diferença, nada é gravado.
- Avaliações salvas são imutáveis, então o conteúdo em cache nunca fica desatualizado; avaliação já em cache abre sem chamada ao servidor.
- Só existe com o histórico na nuvem ativado; é apagado no logout, na troca de conta (as entradas de outras contas são removidas), ao revogar o consentimento, ao excluir tudo e em "Apagar dados locais". Cada leitura é validada com Zod; entrada corrompida é descartada.
- Limitações: não é criptografado (quem usa o mesmo perfil do navegador pode lê-lo); um dispositivo offline mantém uma avaliação excluída em outro até a próxima conexão; uma sessão que expira sem logout mantém a cópia até o próximo acesso.

## Retenção

As 30 avaliações mais recentes por conta, por até 90 dias (`src/lib/evaluation-history.ts`). Aplicada no servidor: leituras nunca devolvem linhas fora da política; cada gravação apaga as linhas da conta fora da política e faz uma varredura global limitada (100 linhas) de registros expirados de qualquer conta. Contas totalmente inativas só são limpas quando alguém grava; um Cron Trigger seria a evolução se for preciso garantir prazo exato.

A exclusão remove as linhas do serviço. Backups/time travel do D1 e dados retidos pelo provedor de IA não são controlados pela aplicação.

## Comandos

```fish
bun test src/server/history.test.ts
bun run db:migrate:local        # cf d1 migrations apply <id> --local --dir migrations
# Produção (somente com autorização explícita):
cf d1 migrations list "$CUBICO_D1_ID" --dir migrations
bun run db:migrate:remote       # scripts/d1-migrate.mjs --remote (usa CUBICO_D1_ID)
bun run deploy:dry-run
```

A migration 0003 deve ser aplicada **antes** do deploy do código que a usa: o código novo depende das tabelas, a migration não quebra o código antigo.
