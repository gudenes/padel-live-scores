/**
 * One-shot data-quality audit for a single tournament.
 *
 *   npx tsx scripts/audit-tournament-quality.ts <tournamentId>
 *
 * Checks:
 *   - tournament metadata completeness + cross-source duplicates
 *   - match counts by status / category / round
 *   - matches missing winner_pair / sets / scores
 *   - matches with null player FKs (TBD'd or unresolved)
 *   - duplicate matches (same court + scheduled_at + same pair)
 *   - schedule sanity (midnight-UTC placeholders, missing court/round)
 *   - FIP draws + entry list presence
 *   - external-id sidecar coverage
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
  } catch { /* env may already be set */ }
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const tournamentId = process.argv[2]
if (!tournamentId) {
  console.error('Usage: npx tsx scripts/audit-tournament-quality.ts <tournamentId>')
  process.exit(1)
}

const FINISHED = new Set(['finished', 'retired', 'walkover'])

async function main() {
  const issues: string[] = []
  const ok: string[] = []

  // 1. Tournament row
  const { data: t, error: tErr } = await supabase
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .maybeSingle()
  if (tErr || !t) {
    console.error('Tournament not found:', tErr?.message)
    process.exit(1)
  }

  console.log('━'.repeat(72))
  console.log(`TOURNAMENT: ${t.name}`)
  console.log('━'.repeat(72))
  console.log(`id              ${t.id}`)
  console.log(`source          ${t.source ?? '(null)'}`)
  console.log(`level           ${t.level ?? '(null)'}`)
  console.log(`country         ${t.country ?? '(null)'}`)
  console.log(`starts_at       ${t.starts_at ?? '(null)'}`)
  console.log(`ends_at         ${t.ends_at ?? '(null)'}`)
  console.log(`status          ${t.status ?? '(null)'}`)
  console.log(`padelapi_id     ${t.padelapi_id ?? '(null)'}`)
  console.log(`fip_id          ${t.fip_id ?? '(null)'}`)
  console.log(`fip_slug        ${t.fip_slug ?? '(null)'}`)
  console.log(`external_id     ${t.external_id ?? '(null)'}`)
  console.log(`slug            ${t.slug ?? '(null)'}`)
  console.log(`logo_url        ${t.logo_url ? 'set' : '(null)'}`)
  console.log(`prize_money     ${t.prize_money ?? '(null)'}`)
  console.log(`widget_id_composite ${t.widget_id_composite ?? '(null)'}`)
  console.log()

  // Metadata gaps
  if (!t.starts_at) issues.push('tournament.starts_at is null')
  if (!t.ends_at) issues.push('tournament.ends_at is null')
  if (!t.country) issues.push('tournament.country is null')
  if (!t.level) issues.push('tournament.level is null')
  if (!t.padelapi_id && !t.fip_id) issues.push('tournament has neither padelapi_id nor fip_id')
  if (!t.logo_url) issues.push('tournament.logo_url is null')
  if (!t.widget_id_composite) issues.push('tournament.widget_id_composite is null (no Crionet widget linked → no live scores / draws / OOP)')

  // 2. Cross-source duplicates by name + year
  const year = t.starts_at ? new Date(t.starts_at).getUTCFullYear() : null
  if (year) {
    const { data: dups } = await supabase
      .from('tournaments')
      .select('id, name, level, starts_at, source, padelapi_id, fip_id')
      .neq('id', tournamentId)
      .gte('starts_at', `${year - 1}-12-01`)
      .lte('starts_at', `${year + 1}-02-01`)
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const tNorm = norm(t.name)
    const possible = (dups ?? []).filter((d) => {
      const dn = norm(d.name)
      // crude token-overlap
      const tToks = new Set(tNorm.split(/\s+/).filter((x) => x.length > 2))
      const dToks = dn.split(/\s+/).filter((x) => x.length > 2)
      const overlap = dToks.filter((x) => tToks.has(x)).length
      return overlap >= 2
    })
    if (possible.length > 0) {
      console.log('CROSS-SOURCE DUPLICATE CANDIDATES:')
      possible.forEach((d) =>
        console.log(`  - ${d.id}  ${d.name}  (level=${d.level}, padelapi=${d.padelapi_id ?? '-'}, fip=${d.fip_id ?? '-'})`),
      )
      issues.push(`${possible.length} possible duplicate tournament row(s) — see above`)
      console.log()
    }
  }

  // 3. Matches
  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
  const m = matches ?? []
  console.log(`MATCHES (total=${m.length})`)
  console.log('─'.repeat(72))

  const byStatus = new Map<string, number>()
  const byCategory = new Map<string, number>()
  const byRound = new Map<string, number>()
  const byCourt = new Map<string, number>()
  for (const r of m) {
    byStatus.set(r.status ?? 'null', (byStatus.get(r.status ?? 'null') ?? 0) + 1)
    byCategory.set(r.category ?? 'null', (byCategory.get(r.category ?? 'null') ?? 0) + 1)
    byRound.set(r.round ?? 'null', (byRound.get(r.round ?? 'null') ?? 0) + 1)
    byCourt.set(r.court ?? 'null', (byCourt.get(r.court ?? 'null') ?? 0) + 1)
  }
  console.log('  by status:   ', [...byStatus.entries()].map(([k, v]) => `${k}=${v}`).join(' '))
  console.log('  by category: ', [...byCategory.entries()].map(([k, v]) => `${k}=${v}`).join(' '))
  console.log('  by round:    ', [...byRound.entries()].sort((a,b)=>b[1]-a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
  console.log('  by court:    ', [...byCourt.entries()].sort((a,b)=>b[1]-a[1]).map(([k, v]) => `${k}=${v}`).join(' '))
  console.log()

  // 4. finished matches without winner_pair
  const finishedNoWinner = m.filter((r) => FINISHED.has(r.status) && !r.winner_pair)
  if (finishedNoWinner.length > 0) {
    issues.push(`${finishedNoWinner.length} finished/retired/walkover match(es) missing winner_pair`)
    console.log('FINISHED-BUT-NO-WINNER:')
    finishedNoWinner.slice(0, 5).forEach((r) =>
      console.log(`  ${r.id}  ${r.status}  ${r.round ?? ''}  ${r.scheduled_at ?? ''}`),
    )
    if (finishedNoWinner.length > 5) console.log(`  … +${finishedNoWinner.length - 5} more`)
    console.log()
  } else if (m.some((r) => FINISHED.has(r.status))) {
    ok.push('all finished matches have winner_pair')
  }

  // 5. matches with null player FKs
  const nullPlayers = m.filter(
    (r) => !r.pair1_player1_id || !r.pair1_player2_id || !r.pair2_player1_id || !r.pair2_player2_id,
  )
  if (nullPlayers.length > 0) {
    const finishedNullPlayers = nullPlayers.filter((r) => FINISHED.has(r.status))
    if (finishedNullPlayers.length > 0) {
      issues.push(`${finishedNullPlayers.length} finished match(es) with null player FKs (unresolved)`)
    }
    const liveNullPlayers = nullPlayers.filter((r) => r.status === 'live' || r.status === 'ended')
    if (liveNullPlayers.length > 0) {
      issues.push(`${liveNullPlayers.length} live/ended match(es) with null player FKs`)
    }
    const scheduledNullPlayers = nullPlayers.filter((r) => r.status === 'scheduled')
    if (scheduledNullPlayers.length > 0) {
      // scheduled with TBD is normal early in the bracket; just note it
      ok.push(`${scheduledNullPlayers.length} scheduled match(es) with TBD players (normal pre-draw)`)
    }
  }

  // 6. duplicate matches by court + scheduled_at + pair signature
  const sig = (r: any) => {
    const ids = [r.pair1_player1_id, r.pair1_player2_id, r.pair2_player1_id, r.pair2_player2_id].filter(Boolean).sort()
    return `${r.court ?? '?'}|${r.scheduled_at ?? '?'}|${ids.join(',')}`
  }
  const sigGroups = new Map<string, any[]>()
  for (const r of m) {
    if (!r.scheduled_at || !r.court) continue
    const k = sig(r)
    if (!sigGroups.has(k)) sigGroups.set(k, [])
    sigGroups.get(k)!.push(r)
  }
  const dupeGroups = [...sigGroups.values()].filter((g) => g.length > 1)
  if (dupeGroups.length > 0) {
    issues.push(`${dupeGroups.length} duplicate match group(s) (same court + scheduled_at + pair)`)
    console.log('DUPLICATE MATCHES:')
    dupeGroups.slice(0, 5).forEach((g) => {
      console.log(`  ${g[0].court} ${g[0].scheduled_at}  (${g.length} rows)`)
      g.forEach((r: any) => console.log(`    - ${r.id}  status=${r.status}  round=${r.round ?? ''}`))
    })
    console.log()
  }

  // 7. midnight UTC placeholders (a known schedule-pipeline failure mode)
  const midnight = m.filter((r) => {
    if (!r.scheduled_at) return false
    const d = new Date(r.scheduled_at)
    return d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0
  })
  if (midnight.length > 0) {
    issues.push(`${midnight.length} match(es) with scheduled_at = midnight UTC (likely date-only placeholder)`)
  }

  // 8. matches missing scheduled_at (active tournament should have schedule)
  const noSchedule = m.filter((r) => !r.scheduled_at)
  if (noSchedule.length > 0) {
    const finishedNoSched = noSchedule.filter((r) => FINISHED.has(r.status)).length
    const otherNoSched = noSchedule.length - finishedNoSched
    if (otherNoSched > 0) {
      issues.push(`${otherNoSched} non-finished match(es) without scheduled_at`)
    }
  }

  // 9. matches missing court (live/scheduled need a court)
  const noCourt = m.filter((r) => !r.court && (r.status === 'scheduled' || r.status === 'live'))
  if (noCourt.length > 0) {
    issues.push(`${noCourt.length} scheduled/live match(es) without court`)
  }

  // 10. matches missing round
  const noRound = m.filter((r) => !r.round)
  if (noRound.length > 0) {
    issues.push(`${noRound.length} match(es) without round label`)
  }

  // 11. sets coverage on finished matches
  const matchIds = m.map((r) => r.id)
  if (matchIds.length > 0) {
    // chunk to avoid PostgREST URL length limit
    const setsAll: any[] = []
    for (let i = 0; i < matchIds.length; i += 100) {
      const { data: setsChunk } = await supabase
        .from('sets')
        .select('match_id, set_number, set_score, score_source')
        .in('match_id', matchIds.slice(i, i + 100))
      setsAll.push(...(setsChunk ?? []))
    }
    const setsByMatch = new Map<string, any[]>()
    for (const s of setsAll) {
      if (!setsByMatch.has(s.match_id)) setsByMatch.set(s.match_id, [])
      setsByMatch.get(s.match_id)!.push(s)
    }
    const finishedNoSets = m.filter((r) => FINISHED.has(r.status) && (setsByMatch.get(r.id)?.length ?? 0) === 0)
    if (finishedNoSets.length > 0) {
      issues.push(`${finishedNoSets.length} finished match(es) with zero sets stored`)
    }
    // walkovers correctly have no sets — exclude those when reporting
    const finishedNoSetsExcludingWO = finishedNoSets.filter((r) => r.status === 'finished' || r.status === 'retired')
    if (finishedNoSetsExcludingWO.length === 0 && finishedNoSets.length > 0) {
      // only walkovers — fine
      ok.push(`${finishedNoSets.length} match(es) with no sets (all walkovers — expected)`)
    }
    // sets with null set_score
    const nullScoreSets = setsAll.filter((s) => !s.set_score)
    if (nullScoreSets.length > 0) {
      issues.push(`${nullScoreSets.length} set row(s) with null set_score`)
    }
    const sourceCounts = new Map<string, number>()
    for (const s of setsAll) sourceCounts.set(s.score_source ?? 'null', (sourceCounts.get(s.score_source ?? 'null') ?? 0) + 1)
    console.log(`SETS (total=${setsAll.length})`)
    console.log('  by source:   ', [...sourceCounts.entries()].map(([k, v]) => `${k}=${v}`).join(' '))
    console.log()
  }

  // 12. tournament_draws presence
  const { count: drawCount } = await supabase
    .from('tournament_draws')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId)
  console.log(`TOURNAMENT_DRAWS rows: ${drawCount ?? 0}`)
  if ((drawCount ?? 0) === 0 && t.level && /(gold|silver|bronze|premier|p1|p2|major)/i.test(t.level)) {
    ok.push('no tournament_draws rows (FIP draw not seeded — only an issue if FIP draw was published)')
  }

  // 13. entry list snapshots
  const { data: entrySnap } = await supabase
    .schema('padelgod' as any)
    .from('entry_list_snapshots')
    .select('category', { count: 'exact' })
    .eq('tournament_id', tournamentId)
    .limit(1)
  if (entrySnap !== null) {
    const { count: entryCount } = await supabase
      .schema('padelgod' as any)
      .from('entry_list_snapshots')
      .select('*', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId)
    console.log(`ENTRY_LIST_SNAPSHOTS rows: ${entryCount ?? 0}`)
  }

  // 14. external_ids sidecar
  const { data: extIds } = await supabase
    .from('entity_external_ids')
    .select('source, external_id, metadata')
    .eq('entity_type', 'tournament')
    .eq('entity_id', tournamentId)
  console.log(`SIDECAR external_ids: ${extIds?.length ?? 0}`)
  if (extIds && extIds.length > 0) extIds.forEach((e) => console.log(`  - ${e.source}: ${e.external_id}`))
  console.log()

  // SUMMARY
  console.log('━'.repeat(72))
  console.log('SUMMARY')
  console.log('━'.repeat(72))
  if (ok.length) {
    console.log('OK:')
    ok.forEach((x) => console.log(`  ✓ ${x}`))
  }
  if (issues.length) {
    console.log('ISSUES:')
    issues.forEach((x) => console.log(`  ✗ ${x}`))
  } else {
    console.log('  no data-quality issues found')
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
