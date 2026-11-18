#!/usr/bin/env bash
# Production deploy through `cf`. Reads secrets from an env file but:
#  - forces BETTER_AUTH_URL to the production origin (the file may hold the local dev URL);
#  - drops keys that cloudflare.config.ts declares as plain variables or settings (CUBICO_*);
#  - refuses to publish any value pointing at localhost/127.0.0.1;
#  - refuses to run while the D1 ID is the local placeholder.
# Secrets are streamed through a pipe; nothing is written to disk or printed.
#
# DEPLOY_ENV_FILE  secrets file (default: .env.production)
# PRODUCTION_URL   public origin (default: https://$CUBICO_DOMAIN)
set -euo pipefail

ENV_FILE="${DEPLOY_ENV_FILE:-.env.production}"
CONFIG_VARS='GEMINI_MODEL|MONTHLY_CORRECTION_LIMIT|DAILY_USER_LIMIT|GLOBAL_CONCURRENT_LIMIT|MAX_OUTPUT_TOKENS|CUBICO_[A-Z0-9_]*'

[[ -f "$ENV_FILE" ]] || { echo "Arquivo de segredos não encontrado: $ENV_FILE" >&2; exit 1; }

DOMAIN="$(node --input-type=module -e "
const { workerConfig, LOCAL_D1_ID } = await import('./cloudflare.config.ts')
if (workerConfig.env.DB.id === LOCAL_D1_ID) {
  console.error('Abortado: defina CUBICO_D1_ID (ambiente ou .env.cloudflare).')
  process.exit(1)
}
process.stdout.write(workerConfig.domains?.[0] ?? '')
")"
PRODUCTION_URL="${PRODUCTION_URL:-${DOMAIN:+https://$DOMAIN}}"
[[ -n "$PRODUCTION_URL" ]] || { echo "Abortado: defina CUBICO_DOMAIN ou PRODUCTION_URL." >&2; exit 1; }

secrets() {
  grep -E '^[A-Z_][A-Z0-9_]*=' "$ENV_FILE" \
    | grep -vE "^(${CONFIG_VARS}|BETTER_AUTH_URL)=" || true
  printf 'BETTER_AUTH_URL="%s"\n' "$PRODUCTION_URL"
}

# Capture first: `grep -q` closing the pipe early would trip pipefail and skip the check.
if grep -qiE '(localhost|127\.0\.0\.1)' <<<"$(secrets)"; then
  echo "Abortado: um segredo de produção aponta para localhost/127.0.0.1." >&2
  exit 1
fi

exec cf deploy --secrets-file <(secrets) "$@"
