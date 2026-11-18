# Configurações e perfil

Rota `/configuracoes` (`src/routes/_app/configuracoes.tsx` + `src/components/screens/settings-screen.tsx`), acessível pelo menu do avatar. Reúne:

- **Perfil:** nome (1–80 caracteres, sem caracteres de controle) e foto. O e-mail vem do Google e não é editável.
- **Histórico na nuvem:** chave de ativação (com confirmação), retenção e "Excluir todo o histórico".
- **Histórico antigo neste navegador:** importação para a nuvem e limpeza da cópia local (só aparece se houver registros).
- **Dados deste navegador:** apaga rascunho, cache do histórico e histórico antigo locais.

A página `/historico` mostra apenas uma linha com link para as configurações quando o histórico está desativado ou há importação pendente.

## Foto de perfil (R2)

- Migration `0004_user_avatar.sql`: coluna `user.avatarKey` (aditiva). `user.image` continua com a foto do Google, usada como alternativa (apenas `https://*.googleusercontent.com`).
- Binding `AVATARS` (bucket privado `cubico-avatars`) em `cloudflare.config.ts` (nome configurável por `CUBICO_R2_BUCKET`); o `vite dev` recebe o mesmo valor pelo `vite.config.ts`.
- Upload por server function (`FormData`): até 2 MB; PNG, JPEG ou WebP, identificados pelos bytes iniciais (o tipo declarado pelo navegador é ignorado; SVG é recusado). Chave `avatars/<userId>/<uuid>`; a foto anterior é apagada depois que o banco aponta para a nova; se o banco falhar, o objeto novo é removido.
- Leitura por `GET /api/avatar`: exige sessão e devolve somente a foto do próprio usuário (nenhuma chave ou ID é aceito na URL), com `Cache-Control: private`, `nosniff` e CSP restritiva.

## Produção (somente com autorização)

```fish
cf r2 buckets create cubico-avatars
bun run db:migrate:remote   # aplica a 0004 (usa CUBICO_D1_ID)
bun run deploy
```
