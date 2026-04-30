// One-shot: backfill the Leiria MQ011 walkover match.
//
// MQ011 = G. Pereira / G. Morbey Basso (team 1) vs G. Rodriguez Quesada / L. Danuzzo (team 2).
// Team 1 received a W/O — but our crionet-results parser was dropping rows with
// empty set cells, so we never wrote a results_snapshot for this match. With the
// parser fix shipped, future runs will pick it up automatically; this script
// patches the row that was missed.
//
// Defaults to dry-run; pass --apply to mutate.

import { promises as fs } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile('.env.local', 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

const apply = process.argv.includes('--apply')
const MATCH_ID = '9c581eb2-201d-4baa-8a31-604d78a7cf3e'

await loadEnv()
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const { data: m, error } = await s
  .from('matches')
  .select('id, status, winner_pair, finished_at, widget_id_composite, scheduled_at')
  .eq('id', MATCH_ID)
  .single()
if (error) throw error
console.log('Current row:', m)

// finished_at: stamp now if not already set (the widget doesn't carry a precise time)
const patch = {
  status: 'walkover',
  winner_pair: 1,
  finished_at: m.finished_at ?? new Date().toISOString(),
  last_updated_by: 'padelgod',
  updated_at: new Date().toISOString(),
}
console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} patch:`, patch)

if (!apply) {
  console.log('\n[DRY RUN] No writes. Re-run with --apply.')
  process.exit(0)
}

const { error: upErr } = await s.from('matches').update(patch).eq('id', MATCH_ID)
if (upErr) { console.error(upErr); process.exit(1) }
console.log('OK — match updated.')
