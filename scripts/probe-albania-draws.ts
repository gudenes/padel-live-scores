/**
 * Dump tournament_draws rows for the 12 OOP-finished R32 widgets to see what
 * the draw populator was working from.
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
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const TOURNAMENT_ID = '8a47598a-579b-4503-88c2-135306d274fb'
const WIDGETS = ['MD029','WD028','MD019','MD028','WD029','MD020','WD025','MD022','MD021','WD030','MD017','MD018']

async function main() {
  const { data, error } = await supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .select('match_widget_id, source, category, round_label, draw_position, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, team1_fip_id, team2_fip_id, team1_seed, team2_seed, status, captured_at')
    .eq('tournament_id', TOURNAMENT_ID)
    .order('captured_at', { ascending: false })
    .limit(2000)
  if (error) { console.error('error:', error.message); process.exit(1) }
  console.log(`draw_snapshots rows: ${data?.length ?? 0}`)

  // Latest per (match_widget_id, source)
  const latest = new Map<string, any>()
  for (const r of data ?? []) {
    const k = `${r.match_widget_id}::${r.source}`
    if (!latest.has(k)) latest.set(k, r)
  }

  const widgetSet = new Set(WIDGETS)
  for (const wid of WIDGETS) {
    console.log(`\n=== ${wid} ===`)
    let found = 0
    for (const [k, r] of latest) {
      if (r.match_widget_id !== wid) continue
      found++
      console.log(`  source=${r.source} round=${r.round_label} cat=${r.category} draw_pos=${r.draw_position} status=${r.status} seed1=${r.team1_seed ?? '-'} seed2=${r.team2_seed ?? '-'}`)
      console.log(`    T1 (fip=${r.team1_fip_id ?? '-'}): ${r.team1_player1_name ?? '-'} / ${r.team1_player2_name ?? '-'}`)
      console.log(`    T2 (fip=${r.team2_fip_id ?? '-'}): ${r.team2_player1_name ?? '-'} / ${r.team2_player2_name ?? '-'}`)
    }
    if (found === 0) console.log('  (no draw_snapshots row for this widget)')
  }
}
main().catch(e => { console.error(e); process.exit(1) })
