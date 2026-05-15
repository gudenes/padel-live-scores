// scripts/backfill-broadcasters-channel-id.mjs
// One-shot: set channel_id on every existing broadcasters row.
// All existing rows come from Premier Padel's API → all link to the
// Premier Padel youtube_channel (abbreviation='PP').
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

await loadEnv()
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const { data: ppChannel, error: chErr } = await s
  .from('youtube_channels')
  .select('id, name, abbreviation')
  .eq('abbreviation', 'PP')
  .single()
if (chErr || !ppChannel) {
  console.error('Premier Padel channel not found (expected abbreviation=PP):', chErr)
  process.exit(1)
}
console.log(`Premier Padel channel: ${ppChannel.id} (${ppChannel.name})`)

const { count, error: countErr } = await s
  .from('broadcasters')
  .select('*', { count: 'exact', head: true })
  .is('channel_id', null)
if (countErr) { console.error(countErr); process.exit(1) }
console.log(`Broadcasters with NULL channel_id: ${count}`)

if (count === 0) { console.log('Nothing to backfill.'); process.exit(0) }

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Would set channel_id = ${ppChannel.id} on ${count} rows.`)

if (!apply) {
  console.log('\n[DRY RUN] No writes. Re-run with --apply.')
  process.exit(0)
}

const { error: upErr } = await s
  .from('broadcasters')
  .update({ channel_id: ppChannel.id })
  .is('channel_id', null)
if (upErr) { console.error(upErr); process.exit(1) }
console.log('OK — backfill complete.')
