// Hard delete every padelapi-only row from a single tournament.
// Used after a manual review confirms these rows are placeholders
// with no useful data (empty players, midnight UTC scheduled_at, etc.).
//
// Defaults to dry-run; pass --apply to mutate.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

await loadEnv()
const apply = process.argv.includes('--apply')
const tournamentId = process.argv.find(a => /^[0-9a-f-]{36}$/i.test(a))
if (!tournamentId) {
  console.error('Usage: node scripts/delete-padelapi-only-from-tournament.mjs <tournament-id> [--apply]')
  process.exit(1)
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const { data: t } = await sb.from('tournaments').select('name, level, ends_at').eq('id', tournamentId).single()
if (!t) { console.error('tournament not found'); process.exit(1) }

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Delete padelapi-only rows from`)
console.log(`  ${t.name}  (${t.level}, ends ${t.ends_at?.slice(0, 10)})`)
console.log()

// Find all padelapi-only rows
const { data: targets } = await sb
  .from('matches')
  .select('id, padelapi_id, status, round, category')
  .eq('tournament_id', tournamentId)
  .not('padelapi_id', 'is', null)
  .is('widget_id_composite', null)

if (!targets?.length) {
  console.log('No padelapi-only rows in this tournament.')
  process.exit(0)
}

console.log(`Rows to delete: ${targets.length}`)
const byRoundCat = {}
for (const m of targets) {
  const k = `${m.category ?? '?'} ${m.round ?? '?'}`
  byRoundCat[k] = (byRoundCat[k] || 0) + 1
}
for (const [k, c] of Object.entries(byRoundCat).sort()) {
  console.log(`  ${k.padEnd(28)} ${c}`)
}
console.log()

if (!apply) {
  console.log('[DRY RUN] No writes. Re-run with --apply to delete.')
  process.exit(0)
}

console.log('[APPLY] Deleting children + match rows…\n')
const ids = targets.map(t => t.id)
let setsDeleted = 0
let gamesDeleted = 0
let matchesDeleted = 0
let failed = 0

// Children first to satisfy any FK constraints
for (const id of ids) {
  try {
    const { count: sn, error: e1 } = await sb.from('sets').delete({ count: 'exact' }).eq('match_id', id)
    if (e1) throw new Error(`sets: ${e1.message}`)
    setsDeleted += sn ?? 0
    const { count: gn, error: e2 } = await sb.from('games').delete({ count: 'exact' }).eq('match_id', id)
    if (e2) throw new Error(`games: ${e2.message}`)
    gamesDeleted += gn ?? 0
    const { error: e3 } = await sb.from('matches').delete().eq('id', id)
    if (e3) throw new Error(`match: ${e3.message}`)
    matchesDeleted++
  } catch (e) {
    console.error(`  ✗ ${id.slice(0, 8)}.. — ${e.message}`)
    failed++
  }
}

console.log(`Done.`)
console.log(`  matches deleted: ${matchesDeleted}`)
console.log(`  sets deleted:    ${setsDeleted}`)
console.log(`  games deleted:   ${gamesDeleted}`)
console.log(`  failed:          ${failed}`)
