#!/usr/bin/env tsx
/**
 * Ad-hoc backfill runner for FIP player profile enrichment.
 *
 * Usage examples:
 *   # Enrich every FIP-id'd player, 100 at a time, ~1 req/sec
 *   npx tsx scripts/backfill-fip-player-profiles.ts --filter=all --limit=100 --throttle-ms=1000
 *
 *   # Just the active-tournament window (= what the cron does, but unbounded)
 *   npx tsx scripts/backfill-fip-player-profiles.ts --filter=tournament --limit=500
 *
 *   # Top-1000 ranked only
 *   npx tsx scripts/backfill-fip-player-profiles.ts --filter=ranked --limit=1000
 *
 *   # Dry run — show counts, no HTTP, no writes
 *   npx tsx scripts/backfill-fip-player-profiles.ts --filter=all --limit=50 --dry-run
 *
 * Resumable: each invocation queries the DB by `profile_attempt_at NULLS FIRST`,
 * so re-running the same command picks up where the previous run stopped.
 * Permanent failures (404 etc.) are skipped automatically once status is set.
 */

import { createClient } from '@supabase/supabase-js'
import axios from 'axios'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runPlayerProfileBatch } from '../padelgod/src/workers/player-profile'
import {
  fetchProfileQueueBatch,
  type QueueMode,
} from '../padelgod/src/db/player-profile-queue'

// Lightweight .env.local loader (we don't import next/env in scripts).
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const k = trimmed.slice(0, eq).trim()
      const v = trimmed.slice(eq + 1).trim()
      if (k && !(k in process.env)) process.env[k] = v
    }
  } catch {
    // no .env.local — rely on shell env
  }
}

interface CliOptions {
  filter: QueueMode
  limit: number
  throttleMs: number
  retryAfterDays: number
  dryRun: boolean
}

function parseArgs(argv: string[]): CliOptions {
  const get = (k: string, fallback?: string): string | undefined => {
    const m = argv.find(a => a.startsWith(`--${k}=`))
    return m ? m.split('=', 2)[1] : fallback
  }
  const filter = (get('filter', 'tournament') ?? 'tournament') as QueueMode
  if (!['tournament', 'ranked', 'all'].includes(filter)) {
    throw new Error(`--filter must be tournament|ranked|all, got: ${filter}`)
  }
  return {
    filter,
    limit: parseInt(get('limit', '100')!, 10),
    throttleMs: parseInt(get('throttle-ms', '1000')!, 10),
    retryAfterDays: parseInt(get('retry-after-days', '30')!, 10),
    dryRun: argv.includes('--dry-run'),
  }
}

async function main() {
  loadEnv()

  const opts = parseArgs(process.argv.slice(2))

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) {
    throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_KEY env vars')
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } })
  const httpClient = axios.create({
    timeout: 15000,
    headers: { 'User-Agent': 'PadelNachos-Backfill/1.0' },
  })

  console.log(
    `[backfill] mode=${opts.filter} limit=${opts.limit} throttle=${opts.throttleMs}ms retry-after=${opts.retryAfterDays}d dry-run=${opts.dryRun}`,
  )

  if (opts.dryRun) {
    const rows = await fetchProfileQueueBatch(supabase, {
      mode: opts.filter,
      limit: opts.limit,
      retryAfterDays: opts.retryAfterDays,
    })
    console.log(`[backfill] dry-run — ${rows.length} player(s) would be processed:`)
    for (const row of rows.slice(0, 20)) {
      console.log(`  - ${row.fip_id}  attempted_at=${row.profile_attempt_at ?? '(never)'}`)
    }
    if (rows.length > 20) console.log(`  ... and ${rows.length - 20} more`)
    return
  }

  const result = await runPlayerProfileBatch(
    { supabase, httpClient },
    {
      mode: opts.filter,
      limit: opts.limit,
      retryAfterDays: opts.retryAfterDays,
      throttleMs: opts.throttleMs,
    },
  )

  console.log(
    `[backfill] done — attempted=${result.attempted} ok=${result.succeeded} fail=${result.failed}`,
  )
}

main().catch(err => {
  console.error('[backfill] fatal:', err)
  process.exit(1)
})
