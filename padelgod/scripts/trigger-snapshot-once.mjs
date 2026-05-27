// One-shot manual trigger for the model-prediction-snapshot worker.
// Runs against prod Supabase using credentials from <repo>/.env.local.
// Writes are LIVE — use --dry-run to skip the INSERTs.
//
//   node padelgod/scripts/trigger-snapshot-once.mjs            # writes for real
//   node padelgod/scripts/trigger-snapshot-once.mjs --dry-run  # logs intent only

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import pino from 'pino'

// Load .env.local from repo root
const repoRoot = resolve(import.meta.dirname, '../..')
const envText = readFileSync(resolve(repoRoot, '.env.local'), 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
  }
}

const dryRun = process.argv.includes('--dry-run')

console.log(`Running model-prediction-snapshot (dryRun=${dryRun})...`)
console.log(`Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`)

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
)

const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:HH:MM:ss', ignore: 'pid,hostname' },
  },
})

// Import the worker (its NodeNext .js extension still resolves under tsx)
const { runModelPredictionSnapshot } = await import('../src/workers/model-prediction-snapshot.ts')

const result = await runModelPredictionSnapshot({ supabase, logger, dryRun })
console.log('\n=== result ===')
console.log(JSON.stringify(result, null, 2))
