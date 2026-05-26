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
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const T = '8a47598a-579b-4503-88c2-135306d274fb'

async function main() {
  // Latest snapshot per widget that mentions Leal or Guerrero
  const { data } = await s
    .schema('padelgod')
    .from('draw_snapshots')
    .select('match_widget_id, source, round_label, draw_position, status, team1_seed, team2_seed, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, captured_at')
    .eq('tournament_id', T)
    .or('team1_player1_name.ilike.%Leal%,team1_player2_name.ilike.%Leal%,team2_player1_name.ilike.%Leal%,team2_player2_name.ilike.%Leal%,team1_player1_name.ilike.%Guerrero%,team1_player2_name.ilike.%Guerrero%,team2_player1_name.ilike.%Guerrero%,team2_player2_name.ilike.%Guerrero%')
    .order('captured_at', { ascending: false })
  const latest = new Map<string, any>()
  for (const r of data ?? []) {
    const k = `${r.match_widget_id}::${r.source}`
    if (!latest.has(k)) latest.set(k, r)
  }
  console.log('Latest draw_snapshots mentioning Leal or Guerrero:')
  for (const r of latest.values()) {
    console.log(`  widget=${r.match_widget_id} src=${r.source} round=${r.round_label} pos=${r.draw_position} status=${r.status} seed1=${r.team1_seed ?? '-'} seed2=${r.team2_seed ?? '-'}`)
    console.log(`    T1: ${r.team1_player1_name ?? '-'} / ${r.team1_player2_name ?? '-'}`)
    console.log(`    T2: ${r.team2_player1_name ?? '-'} / ${r.team2_player2_name ?? '-'}`)
  }

  console.log('\nDraw_snapshots history for MD020 / MD011 / MD023:')
  for (const w of ['MD020', 'MD011', 'MD023']) {
    const { data: hist } = await s
      .schema('padelgod')
      .from('draw_snapshots')
      .select('source, round_label, status, team1_seed, team2_seed, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, captured_at')
      .eq('tournament_id', T)
      .eq('match_widget_id', w)
      .order('captured_at', { ascending: false })
    console.log(`\n  ${w}: ${hist?.length ?? 0} snapshots`)
    for (const r of (hist ?? []).slice(0, 6)) {
      console.log(`    ${r.captured_at} src=${r.source} status=${r.status} seed1=${r.team1_seed ?? '-'} seed2=${r.team2_seed ?? '-'}`)
      console.log(`      T1: ${r.team1_player1_name ?? '-'} / ${r.team1_player2_name ?? '-'}    T2: ${r.team2_player1_name ?? '-'} / ${r.team2_player2_name ?? '-'}`)
    }
  }
}
main().catch(e => { console.error(e); process.exit(1) })
