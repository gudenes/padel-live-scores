/**
 * Probe: compare DB state vs live Crionet OOP for fip-platinum-albania-2026.
 *
 * Usage:
 *   npx tsx scripts/probe-albania-oop.ts
 *
 * Reads .env.local (NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_KEY) and the
 * Crionet OOP widget directly. Pure read-only.
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import axios from 'axios'
import { parseCrionetOop } from '../padelgod/src/parsers/crionet-oop.js'

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

const SLUG = 'fip-platinum-albania-2026'
const FIP_ID = `fip-${SLUG}`

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const http = axios.create({
  timeout: 30_000,
  headers: { 'user-agent': 'padelnachos-probe/1.0' },
})

async function main() {
  // 1. Tournament row
  const { data: tour, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, fip_id, padelapi_id, slug, status, level, country, starts_at, ends_at, timezone')
    .or(`fip_id.eq.${FIP_ID},slug.eq.${SLUG}`)
    .maybeSingle()
  if (tErr) throw tErr
  if (!tour) {
    console.error('No tournament row found for', SLUG)
    process.exit(2)
  }
  console.log('TOURNAMENT', JSON.stringify(tour, null, 2))

  // 2. Widget id
  const { data: wic, error: wErr } = await supabase
    .schema('padelgod')
    .from('widget_id_cache')
    .select('widget_id, is_active')
    .eq('tournament_id', tour.id)
  if (wErr) throw wErr
  console.log('\nWIDGET_ID_CACHE rows:', wic?.length ?? 0)
  for (const row of wic ?? []) console.log(' ', row)
  const activeWidget = (wic ?? []).find(w => w.is_active)?.widget_id
  if (!activeWidget) {
    console.error('No active widget_id for tournament', tour.id)
    process.exit(3)
  }

  // 3. Matches in DB
  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select(`
      id, status, round, round_canonical, court, court_order,
      category, scheduled_at, schedule_label, started_at, finished_at,
      winner_pair, widget_id_composite, padelapi_id,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('tournament_id', tour.id)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  if (mErr) throw mErr
  console.log('\nDB MATCHES:', matches?.length ?? 0)

  const dbByWidget = new Map<string, any>()
  for (const m of matches ?? []) {
    const wid = (m.widget_id_composite ?? '').split(':')[1] ?? ''
    if (wid) dbByWidget.set(wid, m)
  }

  // 4. Latest OOP snapshot rows in DB
  const { data: oop, error: oErr } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select('match_widget_id, day_number, day_date, court, court_position, round_label, scheduled_label, status, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, captured_at')
    .eq('tournament_id', tour.id)
    .order('captured_at', { ascending: false })
    .limit(2000)
  if (oErr) throw oErr
  const latestOop = new Map<string, any>()
  for (const r of oop ?? []) {
    if (!r.match_widget_id) continue
    if (!latestOop.has(r.match_widget_id)) latestOop.set(r.match_widget_id, r)
  }
  console.log('\nDB OOP snapshot widgets (latest per match):', latestOop.size)

  // 5. Live Crionet OOP (all days)
  const liveByWidget = new Map<string, any>()
  const expectedDays = Math.max(
    Math.ceil(
      (new Date(tour.ends_at).getTime() - new Date(tour.starts_at).getTime()) / 86400e3
    ) + 1,
    8,
  )
  let liveTotal = 0
  for (let day = 1; day <= expectedDays; day++) {
    const url = `https://widget.matchscorerlive.com/screen/oopbyday/${activeWidget}/${day}?t=tol`
    try {
      const r = await http.get(url)
      const parsed = parseCrionetOop(String(r.data), day)
      liveTotal += parsed.length
      for (const p of parsed) {
        if (p.matchWidgetId) liveByWidget.set(p.matchWidgetId, { day, ...p })
      }
      console.log(`  day ${day}: parsed ${parsed.length} matches (widget ${activeWidget})`)
    } catch (e: any) {
      console.log(`  day ${day}: fetch error ${e?.message ?? e}`)
    }
  }
  console.log(`\nLIVE OOP total parsed: ${liveTotal}  unique widgets: ${liveByWidget.size}`)

  // 6. Compare
  console.log('\n=== Comparison: DB matches vs LIVE Crionet OOP ===\n')

  const dbWidgets = new Set(dbByWidget.keys())
  const liveWidgets = new Set(liveByWidget.keys())

  const onlyInDb = [...dbWidgets].filter(w => !liveWidgets.has(w))
  const onlyInLive = [...liveWidgets].filter(w => !dbWidgets.has(w))
  const both = [...dbWidgets].filter(w => liveWidgets.has(w))

  console.log(`In both DB and live OOP: ${both.length}`)
  console.log(`In DB but NOT in live OOP (potential removals): ${onlyInDb.length}`)
  console.log(`In live OOP but NOT in DB (would-add): ${onlyInLive.length}`)

  if (onlyInDb.length > 0) {
    console.log('\n--- MATCHES IN DB MISSING FROM LIVE OOP (most relevant) ---')
    for (const w of onlyInDb) {
      const m = dbByWidget.get(w)
      const players = [
        m.pair1_player1?.name, m.pair1_player2?.name,
        '  vs  ',
        m.pair2_player1?.name, m.pair2_player2?.name,
      ].join(' ')
      console.log(`  widget=${w}  status=${m.status}  round=${m.round}  court=${m.court}  cp=${m.court_order}  sched=${m.scheduled_at ?? '-'}  | ${players}`)
      const snap = latestOop.get(w)
      if (snap) {
        console.log(`    latest snapshot: captured=${snap.captured_at} day=${snap.day_number} status=${snap.status} court=${snap.court}`)
      } else {
        console.log(`    no oop_snapshots row ever captured for this widget`)
      }
    }
  }

  if (onlyInLive.length > 0) {
    console.log('\n--- IN LIVE OOP BUT NOT YET IN DB ---')
    for (const w of onlyInLive.slice(0, 20)) {
      const p = liveByWidget.get(w)
      console.log(`  widget=${w}  day=${p.day}  court=${p.court}  round=${p.roundLabel}  cat=${p.category}  status=${p.status}`)
      console.log(`    ${p.team1Player1Name}/${p.team1Player2Name}  vs  ${p.team2Player1Name}/${p.team2Player2Name}`)
    }
    if (onlyInLive.length > 20) console.log(`  ... and ${onlyInLive.length - 20} more`)
  }

  // 7. Status breakdown for DB matches
  console.log('\n--- DB MATCH STATUS BREAKDOWN ---')
  const byStatus = new Map<string, number>()
  for (const m of matches ?? []) {
    byStatus.set(m.status, (byStatus.get(m.status) ?? 0) + 1)
  }
  for (const [s, n] of byStatus) console.log(`  ${s}: ${n}`)

  // 8. The 4 "live" matches — show details
  console.log('\n--- "LIVE" MATCHES IN DB ---')
  for (const m of (matches ?? []).filter((x: any) => x.status === 'live')) {
    const wid = (m.widget_id_composite ?? '').split(':')[1] ?? ''
    const inLive = liveByWidget.has(wid)
    const players = [
      m.pair1_player1?.name, m.pair1_player2?.name,
      'vs',
      m.pair2_player1?.name, m.pair2_player2?.name,
    ].join(' ')
    console.log(`  widget=${wid} inLiveOop=${inLive} round=${m.round} court=${m.court} sched=${m.scheduled_at} started=${m.started_at} | ${players}`)
    if (inLive) {
      const p = liveByWidget.get(wid)
      console.log(`    LIVE OOP status=${p.status} court=${p.court} day=${p.day} cp=${p.courtPosition}`)
    }
  }

  // 8b. NEW: OOP-status mismatch — match exists in latest OOP with
  //     status=finished but DB still shows scheduled/live/ended.
  //     This is the real "removed-from-play" signal: Crionet flips OOP
  //     row to finished when a match is walked-over or otherwise won't be
  //     played, but fip-oop-writer doesn't touch matches.status (it's the
  //     results-writer's job, which feeds from a different widget).
  console.log('\n--- OOP-STATUS MISMATCH (OOP=finished, DB still open) ---')
  const TERMINAL = new Set(['finished', 'walkover', 'retired'])
  const mismatches: Array<{ wid: string; oopStatus: string; m: any }> = []
  for (const [wid, oopRow] of liveByWidget) {
    const oopStatus = (oopRow.status as string) ?? ''
    if (oopStatus !== 'finished' && oopStatus !== 'walkover' && oopStatus !== 'retired') continue
    const dbMatch = dbByWidget.get(wid)
    if (!dbMatch) continue
    if (TERMINAL.has(dbMatch.status)) continue
    mismatches.push({ wid, oopStatus, m: dbMatch })
  }
  console.log(`  count: ${mismatches.length}`)
  for (const { wid, oopStatus, m } of mismatches) {
    const players = [
      `${m.pair1_player1?.name ?? '?'} / ${m.pair1_player2?.name ?? '?'}`,
      'vs',
      `${m.pair2_player1?.name ?? '?'} / ${m.pair2_player2?.name ?? '?'}`,
    ].join('  ')
    console.log(`  widget=${wid}  matchId=${m.id}  round=${m.round}  court=${m.court}  sched=${m.scheduled_at}`)
    console.log(`    DB status: ${m.status}   OOP status: ${oopStatus}`)
    console.log(`    ${players}`)
  }

  // 9. "Vanished from OOP" — widgets present in snapshots from >1h ago but
  //    not in the most recent snapshot batch. This is the real signal for
  //    "removed from OOP".
  console.log('\n--- WIDGETS WITH OLD OOP ROWS BUT MISSING FROM LATEST ---')
  const { data: latestCaptureRow } = await supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .select('captured_at')
    .eq('tournament_id', tour.id)
    .order('captured_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const latestCapture = latestCaptureRow?.captured_at
  console.log('  latest oop_snapshots captured_at:', latestCapture)
  if (latestCapture) {
    // Widgets seen in latest 30 min window
    const cutoff = new Date(new Date(latestCapture).getTime() - 30 * 60_000).toISOString()
    const { data: recentRows } = await supabase
      .schema('padelgod')
      .from('oop_snapshots')
      .select('match_widget_id, captured_at, day_number')
      .eq('tournament_id', tour.id)
      .gte('captured_at', cutoff)
    const recentWidgets = new Set<string>()
    for (const r of recentRows ?? []) if (r.match_widget_id) recentWidgets.add(r.match_widget_id)
    console.log('  widgets in last-30min snapshot window:', recentWidgets.size)

    // All widgets ever captured (limited to recent month, paginated)
    const { data: everSeen } = await supabase
      .schema('padelgod')
      .from('oop_snapshots')
      .select('match_widget_id, captured_at, day_number, court, scheduled_label, round_label, status, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name')
      .eq('tournament_id', tour.id)
      .order('captured_at', { ascending: false })
      .limit(10000)
    const everWidgets = new Map<string, any>()
    for (const r of everSeen ?? []) {
      if (r.match_widget_id && !everWidgets.has(r.match_widget_id)) {
        everWidgets.set(r.match_widget_id, r) // latest row per widget
      }
    }
    console.log('  unique widgets ever in oop_snapshots:', everWidgets.size)

    const vanished = [...everWidgets.entries()].filter(([w]) => !recentWidgets.has(w))
    console.log('\n  >>> Widgets seen historically but NOT in latest 30min window:', vanished.length)
    for (const [w, snap] of vanished) {
      const dbMatch = dbByWidget.get(w)
      const players = [snap.team1_player1_name, snap.team1_player2_name, 'vs', snap.team2_player1_name, snap.team2_player2_name].join(' ')
      console.log(`    widget=${w} last_seen=${snap.captured_at} day=${snap.day_number} status=${snap.status} | ${players}`)
      if (dbMatch) {
        console.log(`      DB: status=${dbMatch.status} round=${dbMatch.round} court=${dbMatch.court} sched=${dbMatch.scheduled_at}`)
      } else {
        console.log(`      DB: no public.matches row`)
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
