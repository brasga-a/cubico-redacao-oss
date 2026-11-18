#!/usr/bin/env node
/**
 * Applies D1 migrations through `cf`, using the database ID resolved by
 * cloudflare.config.ts (CUBICO_D1_ID / .env.cloudflare).
 *   node scripts/d1-migrate.mjs --local    # local simulation (default)
 *   node scripts/d1-migrate.mjs --remote   # production database: needs explicit intent
 */
import { spawnSync } from 'node:child_process'
import { LOCAL_D1_ID, workerConfig } from '../cloudflare.config.ts'

const remote = process.argv.includes('--remote')
const id = workerConfig.env.DB.id

if (remote && id === LOCAL_D1_ID) {
  console.error(
    'Abortado: defina CUBICO_D1_ID (ambiente ou .env.cloudflare) antes de migrar o D1 remoto.',
  )
  process.exit(1)
}

const args = ['d1', 'migrations', 'apply', id, '--dir', 'migrations']
if (!remote) args.push('--local')
const result = spawnSync('cf', args, { stdio: 'inherit' })
process.exit(result.status ?? 1)
