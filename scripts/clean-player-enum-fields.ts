// scripts/clean-player-enum-fields.ts
//
// One-shot cleanup of players.side / players.hand / players.country, which
// were free-text inputs in the ops admin until the constrained controls
// landed. The old `side` field was even labelled "(left|right)" while every
// consumer tests it against 'drive' | 'backhand', so operators wrote values
// no screen has ever read.
//
//   npx tsx scripts/clean-player-enum-fields.ts            # dry run
//   npx tsx scripts/clean-player-enum-fields.ts --apply
//
// Rules, and why each is safe:
//
//   side   '--'                                        ->  NULL
//          An upstream placeholder for "unknown". Nulling it loses nothing.
//
//   side   'left' | 'right' (any case)                 ->  left alone
//          NOT garbage: players.side is written raw from padelapi's `side`
//          field (src/app/api/cron/sync/route.ts:802), and padelapi emits two
//          vocabularies — drive/backhand for most players, left/right for a
//          handful including Tapia, Coello and Chingotto. By padel convention
//          the drive side is the right and the backhand (revés) the left, so
//          the mapping looks lossless — but it is a claim about real players'
//          game, and nobody here established it. Pass --map-sides to apply
//          left->backhand / right->drive once a human has confirmed it.
//
//   hand   'Left' | 'Right' | 'LEFT' | ...             ->  lowercase
//          Pure case normalisation. The meaning is unambiguous, so this is a
//          conversion, not a guess.
//
//   country  'br' | 'Es' | ...                         ->  uppercase
//          FlagImage already normalises case on read, so nothing is visibly
//          broken — this just stops the column drifting further.
//
// Anything already valid is left alone. Re-running changes nothing.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const APPLY = process.argv.includes('--apply')
const MAP_SIDES = process.argv.includes('--map-sides')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const VALID_SIDE = new Set(['drive', 'backhand'])
const VALID_HAND = new Set(['left', 'right'])

// Padel convention: the drive side is the right of the court, the backhand
// (revés) the left. Only applied behind --map-sides.
const SIDE_FROM_COURT_SIDE: Record<string, string> = { left: 'backhand', right: 'drive' }

interface Row {
  id: string
  name: string
  tier: string | null
  side: string | null
  hand: string | null
  country: string | null
}

interface Change {
  id: string
  name: string
  tier: string
  field: 'side' | 'hand' | 'country'
  from: string
  to: string | null
}

function planFor(row: Row): Change[] {
  const changes: Change[] = []
  const tier = row.tier ?? 'pro'

  if (row.side != null && !VALID_SIDE.has(row.side)) {
    const lowered = row.side.toLowerCase()
    if (lowered === '--') {
      changes.push({ id: row.id, name: row.name, tier, field: 'side', from: row.side, to: null })
    } else if (SIDE_FROM_COURT_SIDE[lowered] && MAP_SIDES) {
      changes.push({
        id: row.id, name: row.name, tier,
        field: 'side', from: row.side, to: SIDE_FROM_COURT_SIDE[lowered],
      })
    }
    // Anything else — including left/right without --map-sides — is left as
    // it is. Better a value no screen reads than a wrong claim about a player.
  }
  if (row.hand != null && !VALID_HAND.has(row.hand)) {
    const lowered = row.hand.toLowerCase()
    // Only case differed — otherwise we have no idea what it meant.
    const to = VALID_HAND.has(lowered) ? lowered : null
    changes.push({ id: row.id, name: row.name, tier, field: 'hand', from: row.hand, to })
  }
  if (row.country != null && row.country !== row.country.toUpperCase()) {
    changes.push({
      id: row.id, name: row.name, tier,
      field: 'country', from: row.country, to: row.country.toUpperCase(),
    })
  }

  return changes
}

async function main() {
  const { data, error } = await supabase
    .from('players')
    .select('id, name, tier, side, hand, country')
    .or('side.not.is.null,hand.not.is.null,country.not.is.null')

  if (error) throw new Error(`Failed to read players: ${error.message}`)

  const rows = (data ?? []) as Row[]
  const changes = rows.flatMap(planFor)

  if (changes.length === 0) {
    console.log(`Scanned ${rows.length} players. Nothing to clean.`)
    return
  }

  const byField = new Map<string, Change[]>()
  for (const c of changes) {
    const list = byField.get(c.field) ?? []
    list.push(c)
    byField.set(c.field, list)
  }

  console.log(`Scanned ${rows.length} players. ${changes.length} field(s) to fix:\n`)
  for (const [field, list] of byField) {
    console.log(`${field} — ${list.length}`)
    for (const c of list) {
      console.log(`  ${c.from.padEnd(8)} -> ${String(c.to).padEnd(8)}  ${c.name} (${c.tier})`)
    }
    console.log('')
  }

  if (!APPLY) {
    console.log('Dry run — nothing written. Re-run with --apply to commit.')
    return
  }

  // Group per player so each row takes a single UPDATE.
  const perPlayer = new Map<string, Record<string, string | null>>()
  for (const c of changes) {
    const patch = perPlayer.get(c.id) ?? {}
    patch[c.field] = c.to
    perPlayer.set(c.id, patch)
  }

  let updated = 0
  for (const [id, patch] of perPlayer) {
    const { error: upErr } = await supabase.from('players').update(patch).eq('id', id)
    if (upErr) throw new Error(`Failed to update ${id}: ${upErr.message}`)
    updated++
  }

  console.log(`Done. ${updated} player(s) updated.`)
}

main().catch(err => { console.error(err.message); process.exit(1) })
