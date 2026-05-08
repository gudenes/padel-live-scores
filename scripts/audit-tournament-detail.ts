/**
 * Drill-down for Prishtina audit findings:
 *  - 11 finished matches with null player FKs
 *  - 24 R32 rows split between "R32" and "Round of 32" labels — possible dupe pattern
 *  - check actual duplicate tournaments (refined name-token match, not noise)
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

const TID = 'a829852e-6ad6-429d-97c6-28b37c410fc1'

async function main() {
  // 1. Refined cross-source dup: only flag if the unique token (city) overlaps
  const { data: all } = await supabase
    .from('tournaments')
    .select('id, name, level, starts_at, fip_id, fip_slug, padelapi_id, source, country')
    .neq('id', TID)
    .gte('starts_at', '2026-04-01')
    .lte('starts_at', '2026-06-01')
  const stop = new Set(['fip', 'bronze', 'silver', 'gold', 'premier', 'p1', 'p2', '2026', 'padel', 'open', 'tournament', 'masters', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'])
  const tToks = new Set(['prishtina'])
  const realDupes = (all ?? []).filter((t) => {
    const toks: string[] = String(t.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((x: string) => x && !stop.has(x))
    return toks.some((x: string) => tToks.has(x))
  })
  console.log('REAL CROSS-SOURCE DUPES (filtered):')
  if (realDupes.length === 0) console.log('  none')
  else realDupes.forEach((t) => console.log(`  ${t.id}  ${t.name}  ${t.starts_at}`))
  console.log()

  // 2. Matches with null player FKs and FINISHED status
  const { data: matches } = await supabase
    .from('matches')
    .select('id, status, round, court, scheduled_at, category, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, padelapi_id, external_id, winner_pair, widget_id_composite, pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name')
    .eq('tournament_id', TID)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  const m = matches ?? []
  const FINISHED = new Set(['finished', 'retired', 'walkover'])

  const nullPlayerFinished = m.filter(
    (r) => FINISHED.has(r.status) && (!r.pair1_player1_id || !r.pair1_player2_id || !r.pair2_player1_id || !r.pair2_player2_id),
  )
  console.log(`FINISHED MATCHES WITH NULL PLAYER FKS: ${nullPlayerFinished.length}`)
  nullPlayerFinished.forEach((r) => {
    const fks = [r.pair1_player1_id, r.pair1_player2_id, r.pair2_player1_id, r.pair2_player2_id]
      .map((x) => (x ? '✓' : '✗'))
      .join('')
    const names = `${r.pair1_player1_name ?? '?'}/${r.pair1_player2_name ?? '?'} vs ${r.pair2_player1_name ?? '?'}/${r.pair2_player2_name ?? '?'}`
    console.log(`  ${r.id.slice(0, 8)}  ${r.status}  ${(r.round ?? '-').padEnd(15)}  ${r.category}  fks=${fks}  widget=${r.widget_id_composite ?? '-'}  names="${names}"`)
  })
  console.log()

  // 3. Round-label split: R32 vs "Round of 32" — same matches?
  console.log('ROUND-LABEL DISTRIBUTION:')
  const byRoundCat: Record<string, number> = {}
  for (const r of m) {
    const k = `${r.round ?? '-'} | ${r.category ?? '-'}`
    byRoundCat[k] = (byRoundCat[k] ?? 0) + 1
  }
  Object.entries(byRoundCat).sort().forEach(([k, v]) => console.log(`  ${k.padEnd(25)} ${v}`))
  console.log()

  // 4. Sample R32 vs Round of 32 — see if they're duplicate matches
  console.log('SAMPLE R32 (first 5):')
  m.filter((r) => r.round === 'R32').slice(0, 5).forEach((r) =>
    console.log(`  ${r.id.slice(0, 8)}  ${r.status}  ${r.category}  court=${r.court ?? '-'}  scheduled=${r.scheduled_at ?? '-'}  padelapi=${r.padelapi_id ?? '-'}`),
  )
  console.log()
  console.log('SAMPLE "Round of 32" (first 5):')
  m.filter((r) => r.round === 'Round of 32').slice(0, 5).forEach((r) =>
    console.log(`  ${r.id.slice(0, 8)}  ${r.status}  ${r.category}  court=${r.court ?? '-'}  scheduled=${r.scheduled_at ?? '-'}  padelapi=${r.padelapi_id ?? '-'}`),
  )
  console.log()

  // 5. Check pair-overlap dupes between R32 and Round of 32 buckets
  const r32Set = m.filter((r) => r.round === 'R32')
  const ro32Set = m.filter((r) => r.round === 'Round of 32')
  const sigOf = (r: any) => {
    const ids = [r.pair1_player1_id, r.pair1_player2_id, r.pair2_player1_id, r.pair2_player2_id].filter(Boolean).sort().join(',')
    return ids
  }
  console.log('R32 ↔ Round of 32 PAIR-OVERLAP:')
  const overlaps: any[] = []
  for (const a of r32Set) {
    for (const b of ro32Set) {
      const aSig = sigOf(a)
      const bSig = sigOf(b)
      if (aSig && bSig && aSig === bSig && a.category === b.category) {
        overlaps.push([a, b])
      }
    }
  }
  if (overlaps.length === 0) console.log('  no pair-signature overlaps')
  else overlaps.forEach(([a, b]) => console.log(`  ${a.id.slice(0, 8)} (R32, ${a.status}) ↔ ${b.id.slice(0, 8)} (Round of 32, ${b.status})  pair=${sigOf(a).slice(0,40)}…`))
  console.log()

  // 6. Schedule completeness for unfinished matches
  console.log('UNFINISHED MATCHES MISSING SCHEDULE:')
  const noSched = m.filter((r) => !FINISHED.has(r.status) && !r.scheduled_at)
  console.log(`  count=${noSched.length}`)
  const byRoundNoSched: Record<string, number> = {}
  for (const r of noSched) {
    const k = `${r.round ?? '-'} | ${r.category ?? '-'}`
    byRoundNoSched[k] = (byRoundNoSched[k] ?? 0) + 1
  }
  Object.entries(byRoundNoSched).sort().forEach(([k, v]) => console.log(`    ${k.padEnd(25)} ${v}`))
  console.log()

  // 7. expected vs observed match count: a 32-draw → 31 matches per gender, 16 R32 each
  console.log('DRAW SHAPE (matches by category × round):')
  const shape: Record<string, Record<string, number>> = { men: {}, women: {} }
  for (const r of m) {
    if (!shape[r.category ?? '-']) shape[r.category ?? '-'] = {}
    shape[r.category ?? '-'][r.round ?? '-'] = (shape[r.category ?? '-'][r.round ?? '-'] ?? 0) + 1
  }
  console.log(JSON.stringify(shape, null, 2))
}

main().catch((e) => { console.error(e); process.exit(1) })
