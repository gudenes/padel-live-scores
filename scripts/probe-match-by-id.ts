/**
 * Look up a single match by UUID, with full context.
 *   npx tsx scripts/probe-match-by-id.ts <matchId>
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

const id = process.argv[2]
if (!id) { console.error('Usage: probe-match-by-id <id>'); process.exit(1) }

async function main() {
  const { data: m, error } = await supabase
    .from('matches')
    .select(`
      *,
      pair1_player1:players!matches_pair1_player1_id_fkey(id,name),
      pair1_player2:players!matches_pair1_player2_id_fkey(id,name),
      pair2_player1:players!matches_pair2_player1_id_fkey(id,name),
      pair2_player2:players!matches_pair2_player2_id_fkey(id,name),
      tournament:tournaments(id,name,fip_id,slug)
    `)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!m) { console.error('No match with id', id); process.exit(2) }
  console.log(JSON.stringify(m, null, 2))

  // Sets
  const { data: sets } = await supabase
    .from('sets')
    .select('*')
    .eq('match_id', id)
    .order('set_number')
  console.log('\nSETS:', JSON.stringify(sets, null, 2))

  // OOP snapshots for this widget
  const wid = (m.widget_id_composite ?? '').split(':')[1]
  if (wid) {
    const { data: oop } = await supabase
      .schema('padelgod')
      .from('oop_snapshots')
      .select('captured_at, day_number, day_date, court, court_position, scheduled_label, round_label, status, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name')
      .eq('tournament_id', m.tournament_id)
      .eq('match_widget_id', wid)
      .order('captured_at', { ascending: false })
      .limit(10)
    console.log(`\nLATEST 10 OOP SNAPSHOTS for widget ${wid}:`)
    for (const r of oop ?? []) console.log(' ', r.captured_at, 'day=' + r.day_number, 'status=' + r.status, 'court=' + r.court, 'cp=' + r.court_position, 'sched=' + r.scheduled_label)
  }

  // entity_external_ids
  const { data: ext } = await supabase
    .from('entity_external_ids')
    .select('source, external_id, first_seen_at, last_seen_at, metadata')
    .eq('entity_type', 'match')
    .eq('entity_id', id)
  console.log('\nEXTERNAL IDS:', ext)
}
main().catch(e => { console.error(e); process.exit(1) })
