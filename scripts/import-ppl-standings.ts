// Derives franchise records and division rosters from Pro Padel League
// results, and writes them onto team_seasons / team_memberships.
//
// Phase 2a imported rosters straight from upstream's `teamsById` squad block.
// That block is FRANCHISE-wide and identical in the PPL and PPL II payloads,
// so the import claimed each club fielded its whole squad in PPL II — where
// the league's rule is one drafted pairing, and the results agree: every
// franchise has exactly two players who took the court there.
//
// Now that Phase 2b filled in who actually played, participation is ground
// truth and replaces the squad block.
//
// Defaults to a DRY RUN. Pass --apply to write.
// Idempotent: recomputed from results every time, so re-running converges.
//
// Usage:
//   npx tsx scripts/import-ppl-standings.ts
//   npx tsx scripts/import-ppl-standings.ts --apply

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  computeRecords, computePlayerRecords, type TieInput, type ParticipationInput,
} from './lib/ppl-standings'

if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) {
  if (!process.env[k]) throw new Error(`missing ${k}`)
}

const APPLY = process.argv.includes('--apply')
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

async function main() {
  console.log(APPLY ? '*** APPLY MODE — this will write ***' : '--- DRY RUN (pass --apply to write) ---')

  const { data: ties, error: tErr } = await supabase
    .from('league_ties')
    .select('id, home_team_season_id, away_team_season_id')
  if (tErr) throw new Error(`league_ties read failed: ${tErr.message}`)

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, tie_id, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .not('tie_id', 'is', null)
  if (mErr) throw new Error(`matches read failed: ${mErr.message}`)

  const byTie = new Map<string, typeof matches>()
  for (const m of matches ?? []) {
    const k = m.tie_id as string
    if (!byTie.has(k)) byTie.set(k, [])
    byTie.get(k)!.push(m)
  }

  const tieInputs: TieInput[] = (ties ?? []).map((t) => ({
    tieId: t.id as string,
    homeSeasonId: t.home_team_season_id as string,
    awaySeasonId: t.away_team_season_id as string,
    matches: (byTie.get(t.id as string) ?? []).map((m) => ({ winnerPair: m.winner_pair as 1 | 2 | null })),
  }))

  const records = computeRecords(tieInputs)

  // Participation: a player belongs to the season on whose SIDE of the tie
  // they played, which is what pair1/pair2 encodes — pair1 is the tie's home
  // season, pair2 the away one.
  const participation: ParticipationInput[] = []
  for (const t of tieInputs) {
    for (const m of byTie.get(t.tieId) ?? []) {
      const w = m.winner_pair as 1 | 2 | null
      const home = [m.pair1_player1_id, m.pair1_player2_id].filter(Boolean) as string[]
      const away = [m.pair2_player1_id, m.pair2_player2_id].filter(Boolean) as string[]
      if (home.length) participation.push({ seasonId: t.homeSeasonId, playerIds: home, won: w == null ? null : w === 1 })
      if (away.length) participation.push({ seasonId: t.awaySeasonId, playerIds: away, won: w == null ? null : w === 2 })
    }
  }
  const playerRecords = computePlayerRecords(participation)
  const rosters = new Map(
    [...playerRecords].map(([seasonId, byPlayer]) => [seasonId, new Set(byPlayer.keys())]),
  )

  // Report against what is stored today.
  const { data: seasons } = await supabase
    .from('team_seasons').select('id, label, league, team_id').not('league', 'is', null)
  const { data: teams } = await supabase.from('teams').select('id, name').eq('source', 'ppl')
  const teamName = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]))
  const { data: existing } = await supabase.from('team_memberships').select('team_season_id, player_id')
  const storedRoster = new Map<string, Set<string>>()
  for (const r of existing ?? []) {
    const k = r.team_season_id as string
    if (!storedRoster.has(k)) storedRoster.set(k, new Set())
    storedRoster.get(k)!.add(r.player_id as string)
  }

  console.log(`\n=== RECORDS (derived from ${tieInputs.length} ties) ===`)
  let wouldWriteRecords = 0
  for (const s of (seasons ?? []).sort((a, b) =>
    String(a.league).localeCompare(String(b.league)) ||
    (teamName.get(a.team_id as string) ?? '').localeCompare(teamName.get(b.team_id as string) ?? ''))) {
    const rec = records.get(s.id as string)
    if (!rec) continue
    wouldWriteRecords++
    console.log(`  ${String(s.league).padEnd(7)} ${(teamName.get(s.team_id as string) ?? '?').padEnd(22)} ` +
      `ties ${rec.tiesWon}/${rec.tiesPlayed}  courts ${rec.courtsWon}-${rec.courtsLost}`)
  }

  console.log(`\n=== ROSTERS: stored (squad block) vs derived (actually played) ===`)
  let wouldShrink = 0, wouldGrow = 0
  for (const s of seasons ?? []) {
    const derived = rosters.get(s.id as string) ?? new Set<string>()
    const stored = storedRoster.get(s.id as string) ?? new Set<string>()
    if (derived.size === stored.size) continue
    if (derived.size < stored.size) wouldShrink++; else wouldGrow++
    console.log(`  ${String(s.league).padEnd(7)} ${(teamName.get(s.team_id as string) ?? '?').padEnd(22)} ` +
      `${stored.size} -> ${derived.size}`)
  }
  console.log(`\n  seasons shrinking: ${wouldShrink} | growing: ${wouldGrow}`)
  console.log(`  records to write : ${wouldWriteRecords}`)
  console.log(`\n  NOTE: points_for / points_against / ranking are deliberately NOT written.`)
  console.log(`        The league awards those by finishing position (25, 19, 15, 12 …);`)
  console.log(`        they cannot be derived, and a fabricated value would look official.`)

  if (!APPLY) { console.log(`\nDry run complete. Nothing written.`); return }

  console.log(`\n=== APPLYING ===`)
  const nowIso = new Date().toISOString()
  let recordsWritten = 0, membershipsAdded = 0, membershipsRemoved = 0

  for (const s of seasons ?? []) {
    const rec = records.get(s.id as string)
    if (rec) {
      const { error } = await supabase.from('team_seasons').update({
        ties_played: rec.tiesPlayed,
        ties_won: rec.tiesWon,
        courts_won: rec.courtsWon,
        courts_lost: rec.courtsLost,
      }).eq('id', s.id)
      if (error) throw new Error(`team_seasons update failed (${s.id}): ${error.message}`)
      recordsWritten++
    }

    const derived = rosters.get(s.id as string) ?? new Set<string>()
    const stored = storedRoster.get(s.id as string) ?? new Set<string>()

    // Upsert every derived member, not only the new ones: an existing row
    // still needs its games/wins/losses refreshed as more matches land.
    const recs = playerRecords.get(s.id as string)
    for (const playerId of derived) {
      const rec = recs?.get(playerId)
      const { error } = await supabase.from('team_memberships').upsert({
        team_season_id: s.id,
        player_id: playerId,
        games_played: rec?.gamesPlayed ?? null,
        wins: rec?.wins ?? null,
        losses: rec?.losses ?? null,
      }, { onConflict: 'team_season_id,player_id' })
      if (error) throw new Error(`team_memberships upsert failed: ${error.message}`)
      if (!stored.has(playerId)) membershipsAdded++
    }
    // Remove squad-block rows for players who never took the court in this
    // division. That is the whole point — it is what separates PPL from PPL II.
    const toRemove = [...stored].filter((p) => !derived.has(p))
    if (toRemove.length > 0) {
      const { error } = await supabase.from('team_memberships')
        .delete().eq('team_season_id', s.id).in('player_id', toRemove)
      if (error) throw new Error(`team_memberships delete failed: ${error.message}`)
      membershipsRemoved += toRemove.length
    }
  }

  console.log(`  season records written : ${recordsWritten}`)
  console.log(`  memberships added      : ${membershipsAdded}`)
  console.log(`  memberships removed    : ${membershipsRemoved}`)
  console.log(`  (written at ${nowIso})`)
  console.log(`\nApply complete.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
