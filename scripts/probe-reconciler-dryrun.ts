/**
 * Dry-run the new fip-draw-reconciler against the Albania tournament.
 * Validates the negative-detection path: since MD020 and MD011 were
 * fixed by hand earlier, the reconciler should report 0 patches.
 *
 *   npx tsx scripts/probe-reconciler-dryrun.ts
 *   npx tsx scripts/probe-reconciler-dryrun.ts --apply   # commit writes
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runFipDrawReconciler } from '../padelgod/src/workers/fip-draw-reconciler.js'

// Console logger that satisfies the pino subset the worker uses (info/warn/error).
// Avoids the pino dependency at the script's CWD.
const logger = {
  info: (obj: unknown, msg?: string) => console.log(msg ?? '', JSON.stringify(obj)),
  warn: (obj: unknown, msg?: string) => console.warn(msg ?? '', JSON.stringify(obj)),
  error: (obj: unknown, msg?: string) => console.error(msg ?? '', JSON.stringify(obj)),
  debug: () => {},
  fatal: () => {},
  trace: () => {},
  level: 'info',
  child: () => logger,
} as any

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch {}
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)
const ALBANIA_ID = '8a47598a-579b-4503-88c2-135306d274fb'
const APPLY = process.argv.includes('--apply')

async function main() {
  const result = await runFipDrawReconciler({
    supabase,
    logger,
    dryRun: !APPLY,
    onlyTournamentIds: new Set([ALBANIA_ID]),
  })
  console.log('\n=== reconciler result ===')
  console.log(JSON.stringify(result, null, 2))
}
main().catch(e => { console.error(e); process.exit(1) })
