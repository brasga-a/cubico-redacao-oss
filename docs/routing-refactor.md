# Páginas com TanStack Start

Branch: `feat/tanstack-route-pages`, criada a partir de `1830a61`. A branch anterior, `master` e `old-version` permanecem preservadas. Alterações locais paralelas no root/ThemeProvider não fizeram parte desta refatoração.

O roteamento segue as [file routes e layouts sem segmento do TanStack Start](https://tanstack.com/start/latest/docs/framework/react/guide/routing). O antigo `WorkbenchApp` com seleção de tela por `useState` foi removido.

| URL                        | Arquivo                                       | Comportamento                                                                                                    |
| -------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `/`                        | `src/routes/index.tsx`                        | Redireciona ao editor; mantém compatibilidade com o retorno OAuth legado `/?error=...`                           |
| `/login`                   | `src/routes/login.tsx`                        | Loader consulta acesso; Google Better Auth, loading, erro e retry; usuário autenticado segue ao editor           |
| `/editor`                  | `src/routes/_app/editor.tsx`                  | Rascunho, exemplo completo, motivadores, Turnstile e submissão explícita                                         |
| `/historico`               | `src/routes/_app/historico.tsx`               | Histórico na nuvem (D1) opt-in, importação do histórico local, métricas, abrir/excluir e nova redação             |
| `/redacao/:evaluationId` | `src/routes/_app/redacao/$evaluationId.tsx` | Durante a correção nesta aba, mostra o card de progresso e esqueletos no mesmo layout do resultado (o ID é o `requestId`), trocados com `motion` quando o resultado chega; depois, abre avaliação por ID local; `?tab=summary`, `competencies` ou `text` preserva a seção em recarga/voltar/avançar |

`_app.tsx` é o layout autenticado: `beforeLoad` consulta a sessão real e redireciona visitantes ao login. O layout compartilha header, links e `Outlet`. Os contratos e as verificações de autorização/allowlist/CSRF/Turnstile/quota/idempotência continuam nas server functions e endpoints existentes; não foi criado um bypass de autenticação.

As rotas em `src/routes/` ficam finas (loaders, `beforeLoad` e composição). A UI fica em `src/components/`, o que permite reutilizar as mesmas telas no catálogo visual sem importar loaders, sessão ou inferência:

| Pasta | Conteúdo |
| --- | --- |
| `src/components/ui/` | Primitives shadcn/Base UI, um de cada; variantes do app (`brand`, `subtle`, `xl`, `muted`) ficam nos próprios `cva` |
| `src/components/screens/` | Telas por página (`*-screen.tsx`) |
| `src/components/layout/` | Header, navegação móvel, avatar, marca, loading e erro de rota |
| `src/components/editor/`, `evaluation/`, `history/`, `auth/` | Componentes de domínio |
| `src/providers/workbench-provider.tsx` | Estado e ações compartilhados |
| `src/lib/workbench/` | Tipos, adaptadores de view-model, anotações e armazenamento local |
| `src/hooks/` | Hooks de UI (`use-autosize`, `use-count-up`, `use-reduced-motion`) |

`src/providers/workbench-provider.tsx` contém somente estado e ações compartilhados: rascunho de sessão por conta, histórico IndexedDB, confirmações e operação assíncrona. Não escolhe qual tela renderizar. O provider permanece entre páginas irmãs e é reinicializado por ID da conta. Header e registros históricos recebem links do Router; permitem abrir em outra aba sem disparar inferência.

OAuth retorna a `/editor`, ou `/login?error=oauth` em falha. O callback registrado no Google continua `/api/auth/callback/google`; não há alteração externa ou deploy nesta execução.

## Persistência e operações

IDs da URL identificam snapshots locais. Um link funciona após reload/outra aba quando o registro está no IndexedDB deste navegador/conta. Sem opt-in, resultados da sessão continuam em memória; após recarga, um ID ausente mostra explicação e acesso ao histórico, sem tentar inferência novamente. Links não sincronizam redações nem expõem um endpoint público de consulta.

Revisar copia o snapshot para o editor e preserva o original. Navegar durante processamento não muda o rascunho nem redireciona inesperadamente ao terminar; a avaliação concluída fica acessível por um link no layout. Parar de aguardar, editar o texto ou sair invalida a apresentação de respostas antigas. O botão não promete interromper cobrança. Nenhuma rota loader inicia correção; envio permanece uma ação explícita do editor.

## Verificação reproduzível sem provedores

Escolha um diretório descartável livre com prefixo `/tmp/cubico-routes-`. Não copie `.dev.vars` ou credenciais do clone real. Exemplo:

```bash
git worktree add --detach /tmp/cubico-routes-demo feat/tanstack-route-pages
cd /tmp/cubico-routes-demo
bun install --frozen-lockfile
bun run build
bun test
bun run db:migrate:local
cat > .dev.vars <<'VARS'
BETTER_AUTH_SECRET=local-route-tests-only-secret-with-at-least-32-characters
BETTER_AUTH_URL=http://127.0.0.1:3700
GOOGLE_CLIENT_ID=local-test.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=local-test-only
ALLOWED_EMAILS=fixture@example.invalid
GEMINI_API_KEY=
VARS
bun x vite dev --host 127.0.0.1 --port 3700 --strictPort
```

Em outro terminal, a partir do clone com os scripts:

```bash
ROUTE_SMOKE_DIRECTORY=/tmp/cubico-routes-demo node scripts/smoke-routes.mjs
AUTH_SMOKE_BASE_URL=http://127.0.0.1:3700 node scripts/smoke-google-auth.mjs
bun run test:visual
bun x tsc --noEmit
bun run lint
```

O smoke valida diretório e credenciais de teste antes de inserir uma conta/sessão no D1 **local**, assina cookie de teste e passa pelos guards reais do Better Auth. Também usa fixtures explícitas de RPC para testar conclusão em background, cancelamento e logout com resposta atrasada; esses POSTs são interceptados no navegador, nunca chegam ao corretor. Google e hosts externos são bloqueados. Não se apresenta essa sessão de fixture como conclusão de OAuth com conta real.

A execução desta refatoração usa `/tmp/cubico-routes-check`. Build Worker em archive sem env, instalação congelada e46 testes passaram.17 testes visuais existentes passaram. Os13 cenários da bateria de rotas passaram e cobrem visitante, rascunho, histórico, URL direta, nova aba, tabs/back/forward/reload, revisão imutável, registro ausente, processamento vazio, respostas em background/canceladas e logout. O smoke de iniciação Google também passou com as novas URLs. TypeScript e lint passaram sem erros. Resultados finais e commits são registrados no checklist.

Não foi repetida a matriz de120 pares de pixels: a mudança é de organização/navegação, com reaproveitamento dos componentes e verificação funcional/responsiva existente. Homologação de OAuth real, revisão visual humana e dispositivo físico continuam separadas.

### Alterações locais paralelas

O lint da versão commitada da refatoração não inclui o ThemeProvider não versionado criado em paralelo. O lint da working tree completa encontrou um erro em `src/components/theme-provider.tsx:91` (`no-unnecessary-condition`), além dos11 warnings existentes. Esse arquivo, o root e o CSS de tema foram preservados sem alterações desta tarefa; o erro não deve ser reportado como lint geral aprovado. TypeScript da working tree passou.
