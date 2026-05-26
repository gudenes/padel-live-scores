/**
 * Find every match in Albania 2026 that references Garrido or Bergamini.
 * Also compare against draw_snapshots to see where the FIP bracket actually
 * places them.
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
const GARRIDO_ID = '916aa820-1c5d-4d9c-9fe7-bbc074c8051c'
const BERGAMINI_ID = '43ac372d-0293-4791-9292-201e985e2ce6'

async function main() {
  const { data: matches } = await supabase
    .from('matches')
    .select(`
      id, widget_id_composite, status, round, round_canonical, court, scheduled_at,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      pair1_seed, pair2_seed, winner_pair,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('tournament_id', TOURNAMENT_ID)
    .or(
      `pair1_player1_id.eq.${GARRIDO_ID},pair1_player2_id.eq.${GARRIDO_ID},pair2_player1_id.eq.${GARRIDO_ID},pair2_player2_id.eq.${GARRIDO_ID},` +
      `pair1_player1_id.eq.${BERGAMINI_ID},pair1_player2_id.eq.${BERGAMINI_ID},pair2_player1_id.eq.${BERGAMINI_ID},pair2_player2_id.eq.${BERGAMINI_ID}`,
    )
  console.log(`public.matches rows mentioning Garrido or Bergamini: ${matches?.length ?? 0}`)
  for (const m of matches ?? []) {
    const wid = (m.widget_id_composite ?? '').split(':')[1]
    console.log(`  widget=${wid}  matchId=${m.id}  round=${m.round} (${m.round_canonical})  status=${m.status}  court=${m.court}  sched=${m.scheduled_at}`)
    console.log(`    pair1 (seed ${m.pair1_seed}): ${(m as any).pair1_player1?.name ?? '?'} / ${(m as any).pair1_player2?.name ?? '?'}`)
    console.log(`    pair2 (seed ${m.pair2_seed}): ${(m as any).pair2_player1?.name ?? '?'} / ${(m as any).pair2_player2?.name ?? '?'}`)
  }

  // Draw snapshots view (FIP truth)
  console.log('\nFIP draw_snapshots mentioning Garrido or Bergamini:')
  const { data: snaps } = await supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .select('match_widget_id, source, round_label, category, draw_position, status, team1_seed, team2_seed, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, captured_at')
    .eq('tournament_id', TOURNAMENT_ID)
    .or('team1_player1_name.ilike.%Garrido%,team1_player2_name.ilike.%Garrido%,team2_player1_name.ilike.%Garrido%,team2_player2_name.ilike.%Garrido%,team1_player1_name.ilike.%Bergamini%,team1_player2_name.ilike.%Bergamini%,team2_player1_name.ilike.%Bergamini%,team2_player2_name.ilike.%Bergamini%')
    .order('captured_at', { ascending: false })
  // Latest per widget+source
  const latest = new Map<string, any>()
  for (const r of snaps ?? []) {
    const k = `${r.match_widget_id}::${r.source}`
    if (!latest.has(k)) latest.set(k, r)
  }
  for (const r of latest.values()) {
    console.log(`  widget=${r.match_widget_id} src=${r.source} round=${r.round_label} pos=${r.draw_position} status=${r.status} seed1=${r.team1_seed ?? '-'} seed2=${r.team2_seed ?? '-'}`)
    console.log(`    T1: ${r.team1_player1_name ?? '-'} / ${r.team1_player2_name ?? '-'}`)
    console.log(`    T2: ${r.team2_player1_name ?? '-'} / ${r.team2_player2_name ?? '-'}`)
  }

  // Also dump every R16 match in DB to see Garrido/Bergamini's expected slot
  console.log('\nAll R16 matches in DB (men):')
  const { data: r16 } = await supabase
    .from('matches')
    .select(`
      id, widget_id_composite, status, round, pair1_seed,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('tournament_id', TOURNAMENT_ID)
    .eq('category', 'men')
    .in('round_canonical', ['R16'])
    .order('widget_id_composite')
  for (const m of r16 ?? []) {
    const wid = (m.widget_id_composite ?? '').split(':')[1]
    const players = `${(m as any).pair1_player1?.name ?? 'TBD'} / ${(m as any).pair1_player2?.name ?? 'TBD'} vs ${(m as any).pair2_player1?.name ?? 'TBD'} / ${(m as any).pair2_player2?.name ?? 'TBD'}`
    console.log(`  ${wid} seed1=${m.pair1_seed ?? '-'} status=${m.status}: ${players}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
