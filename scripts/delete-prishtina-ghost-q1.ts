/**
 * Delete 3 ghost Q1 men matches on FIP BRONZE PRISHTINA.
 *
 * Pre-flight: re-confirms each row matches the expected ghost shape
 *   - tournament_id matches
 *   - round = 'Q1'
 *   - status = 'finished'
 *   - all four pair*_player*_id FKs are null
 *   - all four pair*_player*_name columns are null
 *   - widget_id_composite is null
 *
 * Refuses to delete anything that doesn't match.
 *
 * Usage:
 *   npx tsx scripts/delete-prishtina-ghost-q1.ts          # dry-run
 *   npx tsx scripts/delete-prishtina-ghost-q1.ts --execute # actually delete
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
for (const line of raw.split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
}

const TOURNAMENT_ID = 'a829852e-6ad6-429d-97c6-28b37c410fc1'
const TARGETS = [
  'db636008-9041-48f6-b175-6203b86ea577',
  '4278d1f6-7eb2-4d28-adf5-025516850e90',
  '21d0d144-2256-4139-b78a-93ab3aedd4ac',
]

const execute = process.argv.includes('--execute')

async function main() {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
  const { data: rows, error } = await supabase
    .from('matches')
    .select('id, tournament_id, round, status, widget_id_composite, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name')
    .in('id', TARGETS)
  if (error) { console.error('fetch error:', error.message); process.exit(1) }
  if (!rows || rows.length !== TARGETS.length) {
    console.error(`expected ${TARGETS.length} rows, got ${rows?.length ?? 0}`); process.exit(1)
  }

  for (const r of rows) {
    const checks = {
      tournament: r.tournament_id === TOURNAMENT_ID,
      round: r.round === 'Q1',
      status: r.status === 'finished',
      noWidget: r.widget_id_composite === null,
      noFKs: !r.pair1_player1_id && !r.pair1_player2_id && !r.pair2_player1_id && !r.pair2_player2_id,
      noNames: !r.pair1_player1_name && !r.pair1_player2_name && !r.pair2_player1_name && !r.pair2_player2_name,
    }
    const allOk = Object.values(checks).every(Boolean)
    console.log(`${r.id}  ${allOk ? '✓ matches ghost shape' : '✗ FAIL: ' + JSON.stringify(checks)}`)
    if (!allOk) { console.error('aborting — row does not match expected ghost shape'); process.exit(1) }
  }

  // Count dependent rows
  const { count: setCount } = await supabase
    .from('sets').select('*', { count: 'exact', head: true }).in('match_id', TARGETS)
  const { count: gameCount } = await supabase
    .from('games').select('*', { count: 'exact', head: true }).in('match_id', TARGETS)
  console.log(`dependent rows: sets=${setCount ?? 0}, games=${gameCount ?? 0}`)

  if (!execute) {
    console.log('\nDRY RUN — pass --execute to actually delete')
    return
  }

  // Execute deletes — children first, then matches
  if ((gameCount ?? 0) > 0) {
    const { error: gErr } = await supabase.from('games').delete().in('match_id', TARGETS)
    if (gErr) { console.error('games delete error:', gErr.message); process.exit(1) }
    console.log(`✓ deleted ${gameCount} games`)
  }
  if ((setCount ?? 0) > 0) {
    const { error: sErr } = await supabase.from('sets').delete().in('match_id', TARGETS)
    if (sErr) { console.error('sets delete error:', sErr.message); process.exit(1) }
    console.log(`✓ deleted ${setCount} sets`)
  }
  const { error: mErr } = await supabase.from('matches').delete().in('id', TARGETS)
  if (mErr) { console.error('matches delete error:', mErr.message); process.exit(1) }
  console.log(`✓ deleted ${TARGETS.length} matches`)

  // Verify
  const { count: remaining } = await supabase
    .from('matches').select('*', { count: 'exact', head: true }).in('id', TARGETS)
  console.log(`verification: ${remaining ?? 0} target rows remaining`)
}
main()
