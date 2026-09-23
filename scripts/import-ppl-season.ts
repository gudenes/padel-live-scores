// Imports one Pro Padel League season's STATIC layer: franchises, divisions,
// rosters, events, ties and match skeletons. Scores and per-match statistics
// are Phase 2b and are NOT touched here.
//
// Defaults to a DRY RUN. Pass --apply to write.
// Idempotent: re-running with the same inputs updates in place, never
// duplicates. Modelled on scripts/import-amateur-season.ts.
//
// Usage:
//   npx tsx scripts/import-ppl-season.ts                      # dry run, all 2026 events
//   npx tsx scripts/import-ppl-season.ts --map map.json       # dry run with overrides
//   npx tsx scripts/import-ppl-season.ts --apply --map map.json
//
// --map takes a JSON object of { "<ppl-player-slug>": "<players.id uuid>" }
// used to resolve names that match more than one existing player. --apply
// REFUSES to run while any ambiguity is unmapped.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import {
  fetchBuildId,
  fetchTournament,
  PPL_USER_AGENT,
  type Fetcher,
  type PplTournament,
  type PplTeam,
  type PplMatch,
} from './lib/ppl-source'
import { classifyRoster, type ExistingPlayer } from './lib/ppl-classify'

const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const APPLY = process.argv.includes('--apply')

function argValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

const MAP_FILE = argValue('map')

const SEASON_SLUGS = [
  'new-york-2026',
  'new-york-ppl-ii-2026',
  'los-angeles-2026',
  'los-angeles-ppl-ii-2026',
  'playa-del-carmen-2026',
  'playa-del-carmen-ppl-ii-2026',
  'guadalajara-2026',
  'guadalajara-ppl-ii-2026',
  'miami-2026',
  'miami-ppl-ii-2026',
]

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

const nodeFetch: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': PPL_USER_AGENT } })
  return { status: r.status, text: () => r.text() }
}

async function loadExistingPlayers(): Promise<ExistingPlayer[]> {
  const rows: ExistingPlayer[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('players')
      .select('id,name,display_name,normalized_name,category,tier')
      .range(start, start + 999)
    if (error) throw new Error(`players read failed: ${error.message}`)
    rows.push(...(data as ExistingPlayer[]))
    if (data.length < 1000) break
  }
  return rows
}

async function loadRegisteredSlugs(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('entity_external_ids')
      .select('entity_id,external_id')
      .eq('entity_type', 'player')
      .eq('source', 'ppl')
      .range(start, start + 999)
    if (error) throw new Error(`entity_external_ids read failed: ${error.message}`)
    for (const r of data as Array<{ entity_id: string; external_id: string }>) {
      out.set(r.external_id, r.entity_id)
    }
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — this will write ***' : '--- DRY RUN (pass --apply to write) ---')

  const buildId = await fetchBuildId(nodeFetch)
  console.log(`buildId: ${buildId}`)

  const tournaments: PplTournament[] = []
  for (const slug of SEASON_SLUGS) {
    const t = await fetchTournament(nodeFetch, buildId, slug)
    if (!t) { console.log(`  ${slug}: not published yet (404)`); continue }
    console.log(`  ${slug}: ${t.matches.length} matches, ${t.teams.length} teams, league=${t.league}`)
    tournaments.push(t)
  }
  if (tournaments.length === 0) throw new Error('no tournaments fetched — aborting')

  // Roster is the union across events; a player can appear in several.
  const roster = new Map<string, (typeof tournaments)[number]['players'][number]>()
  for (const t of tournaments) for (const p of t.players) if (!roster.has(p.slug)) roster.set(p.slug, p)
  console.log(`\nunique players across payloads: ${roster.size}`)

  const overrides = new Map<string, string>()
  if (MAP_FILE) {
    const raw = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) as Record<string, string>
    for (const [k, v] of Object.entries(raw)) overrides.set(k, v)
    console.log(`overrides loaded: ${overrides.size} from ${MAP_FILE}`)
  }

  const [existing, registered] = await Promise.all([loadExistingPlayers(), loadRegisteredSlugs()])
  console.log(`our players: ${existing.length} | already registered by ppl slug: ${registered.size}`)

  const c = classifyRoster([...roster.values()], existing, registered, overrides)

  console.log(`\n=== PLAYERS ===`)
  console.log(`  already linked : ${c.linked.length}`)
  console.log(`  to link        : ${c.toLink.length}`)
  console.log(`  to create      : ${c.toCreate.length}`)
  console.log(`  AMBIGUOUS      : ${c.ambiguous.length}`)

  if (c.toCreate.length > 0) {
    console.log(`\n--- would CREATE ---`)
    for (const x of c.toCreate) console.log(`  ${x.player.name}  (${x.category}, ${x.player.league}, slug=${x.player.slug})`)
  }

  if (c.ambiguous.length > 0) {
    console.log(`\n--- AMBIGUOUS — map these before --apply ---`)
    const suggestion: Record<string, string> = {}
    for (const a of c.ambiguous) {
      console.log(`  "${a.player.name}" (slug=${a.player.slug}) matches ${a.candidates.length}:`)
      for (const cand of a.candidates) console.log(`      ${cand.id}  ${cand.name}  [${cand.category}]`)
      suggestion[a.player.slug] = 'PUT-THE-CORRECT-UUID-HERE'
    }
    console.log(`\n  starter map file:\n${JSON.stringify(suggestion, null, 2)}`)
  }

  const ties = tournaments.reduce((n, t) => n + new Set(t.matches.map((m) => `${m.stage}|${m.sessionNumber}`)).size, 0)
  const totalMatches = tournaments.reduce((n, t) => n + t.matches.length, 0)
  console.log(`\n=== EVENTS ===`)
  console.log(`  tournaments : ${tournaments.length}`)
  console.log(`  ties        : ${ties}`)
  console.log(`  matches     : ${totalMatches}`)

  if (!APPLY) { console.log(`\nDry run complete. Nothing written.`); return }

  if (c.ambiguous.length > 0) {
    throw new Error(`refusing to apply: ${c.ambiguous.length} ambiguous player(s) unmapped. Use --map.`)
  }

  // ── Phase 1 — players ──────────────────────────────────────────────────

  const { PlayerResolver } = await import('../src/lib/player-resolver')
  const { registerSourceId } = await import('../src/lib/external-id-registry')
  const resolver = new PlayerResolver(supabase)

  const playerIdBySlug = new Map<string, string>()
  for (const x of c.linked) playerIdBySlug.set(x.player.slug, x.playerId)
  for (const x of c.toLink) playerIdBySlug.set(x.player.slug, x.playerId)

  for (const x of c.toCreate) {
    // No externalId / fipId on purpose: PlayerResolver's own docblock warns
    // that synthesising an external_id from a name minted 838 fake padelapi
    // IDs in 2026-03. A plain insert leaves tier defaulting to 'pro' and
    // ranking NULL, which is what the spec calls for.
    const res = await resolver.resolve({ name: x.player.name, category: x.category })
    playerIdBySlug.set(x.player.slug, res.playerId)
    console.log(`  player ${res.action}: ${x.player.name} -> ${res.playerId}`)
  }

  // Register EVERY slug, including ones linked by name — that is what makes
  // the future recurring worker a pure lookup with no fuzzy matching.
  for (const [slug, playerId] of playerIdBySlug) {
    await registerSourceId(supabase, {
      entityType: 'player', entityId: playerId, source: 'ppl', externalId: slug,
    })
  }
  console.log(`players: ${playerIdBySlug.size} registered`)

  // ── Phase 2 — teams ───────────────────────────────────────────────────

  const teamIdBySlug = new Map<string, string>()
  const allTeams = new Map<string, PplTeam>()
  for (const t of tournaments) for (const tm of t.teams) if (!allTeams.has(tm.slug)) allTeams.set(tm.slug, tm)

  for (const tm of allTeams.values()) {
    const { data, error } = await supabase
      .from('teams')
      .upsert({
        slug: `ppl-${tm.slug}`,      // teams.slug is globally unique — prefix avoids colliding with a future club
        name: tm.name,
        city: tm.location,
        crest_url: tm.colorLogo,
        brand_color: tm.brandColor,
        badge_label: 'Pro Padel League',
        short_name: 'PPL',
        source: 'ppl',
        external_id: tm.slug,
      }, { onConflict: 'source,external_id' })
      .select('id')
      .single()
    if (error) throw new Error(`teams upsert failed (${tm.slug}): ${error.message}`)
    teamIdBySlug.set(tm.slug, data.id)
  }
  console.log(`teams: ${teamIdBySlug.size}`)

  // ── Phase 3 — team seasons and rosters ──────────────────────────────────

  const seasonIdByKey = new Map<string, string>()   // `${teamSlug}|${league}`
  const leagues = [...new Set(tournaments.map((t) => t.league))]

  for (const league of leagues) {
    const label = league === 'ppl-ii' ? '2026 PPL II' : '2026 PPL'
    for (const [teamSlug, teamId] of teamIdBySlug) {
      const { data, error } = await supabase
        .from('team_seasons')
        .upsert({ team_id: teamId, label, league, season_year: 2026 }, { onConflict: 'team_id,label' })
        .select('id')
        .single()
      if (error) throw new Error(`team_seasons upsert failed (${teamSlug}/${league}): ${error.message}`)
      seasonIdByKey.set(`${teamSlug}|${league}`, data.id)
    }
  }

  let memberships = 0
  for (const t of tournaments) {
    for (const tm of t.teams) {
      const seasonId = seasonIdByKey.get(`${tm.slug}|${t.league}`)
      if (!seasonId) continue
      for (const slug of [...tm.mensPlayerIds, ...tm.womensPlayerIds]) {
        const playerId = playerIdBySlug.get(slug)
        if (!playerId) { console.warn(`  roster: unresolved slug ${slug} on ${tm.slug}`); continue }
        const { error } = await supabase
          .from('team_memberships')
          .upsert({ team_season_id: seasonId, player_id: playerId }, { onConflict: 'team_season_id,player_id' })
        if (error) throw new Error(`team_memberships upsert failed (${slug}): ${error.message}`)
        memberships++
      }
    }
  }
  console.log(`team_seasons: ${seasonIdByKey.size} | membership upserts: ${memberships}`)

  // ── Phase 4 — tournaments ────────────────────────────────────────────────

  const tournamentIdBySlug = new Map<string, string>()
  for (const t of tournaments) {
    const level = t.league === 'ppl-ii' ? 'ppl_ii' : 'ppl'
    const { data, error } = await supabase
      .from('tournaments')
      .upsert({
        name: t.name,
        level,
        source: 'ppl',
        external_id: t.slug,
        starts_at: t.startDate,
        ends_at: t.endDate,
        location: t.location,
        last_updated_by: 'manual',
        updated_at: new Date().toISOString(),
        // NOTE: deliberately NOT setting `slug` — sync_tournaments_id_columns
        // would copy it into fip_id, minting a fake FIP id in a unique column.
      }, { onConflict: 'external_id' })
      .select('id')
      .single()
    if (error) throw new Error(`tournaments upsert failed (${t.slug}): ${error.message}`)
    tournamentIdBySlug.set(t.slug, data.id)
  }
  console.log(`tournaments: ${tournamentIdBySlug.size}`)

  // ── Phase 5 — ties and match skeletons ──────────────────────────────────

  let tieCount = 0, matchInserts = 0, matchLinked = 0
  for (const t of tournaments) {
    const tournamentId = tournamentIdBySlug.get(t.slug)!
    // A tie is (stage, sessionNumber, home, away) — it yields one men's and
    // one women's match between the same two franchises.
    const tieGroups = new Map<string, PplMatch[]>()
    for (const m of t.matches) {
      const key = `${m.stage}|${m.sessionNumber ?? 'null'}|${m.homeTeamSlug}|${m.awayTeamSlug}`
      if (!tieGroups.has(key)) tieGroups.set(key, [])
      tieGroups.get(key)!.push(m)
    }

    for (const group of tieGroups.values()) {
      const first = group[0]
      const homeSeason = seasonIdByKey.get(`${first.homeTeamSlug}|${t.league}`)
      const awaySeason = seasonIdByKey.get(`${first.awayTeamSlug}|${t.league}`)
      if (!homeSeason || !awaySeason) { console.warn(`  tie: missing season for ${first.id}`); continue }

      const { data: tie, error: tieErr } = await supabase
        .from('league_ties')
        .upsert({
          tournament_id: tournamentId,
          session_number: first.sessionNumber,
          stage: first.stage,
          home_team_season_id: homeSeason,
          away_team_season_id: awaySeason,
        }, { onConflict: first.sessionNumber == null ? 'tournament_id,stage' : 'tournament_id,session_number,stage' })
        .select('id')
        .single()
      if (tieErr) throw new Error(`league_ties upsert failed (${first.id}): ${tieErr.message}`)
      tieCount++

      for (const m of group) {
        const { data: found } = await supabase
          .from('entity_external_ids')
          .select('entity_id')
          .eq('entity_type', 'match').eq('source', 'ppl').eq('external_id', m.id)
          .maybeSingle()

        if (found?.entity_id) {
          // Idempotent re-run: only ever gap-fill the tie link.
          await supabase.from('matches').update({ tie_id: tie.id }).eq('id', found.entity_id).is('tie_id', null)
          matchLinked++
          continue
        }

        // Deliberately NOT setting status / winner_pair / sets — Phase 2b.
        // scheduled_at stays NULL too: upstream emits zone-less wall-clock in
        // two different formats and guessing the timezone would bake in a
        // silent error.
        // NEVER set external_id here — sync_matches_id_columns would copy it
        // into padelapi_id.
        const { data: inserted, error: insErr } = await supabase
          .from('matches')
          .insert({
            tournament_id: tournamentId,
            tie_id: tie.id,
            category: m.category,
            round: m.stage,
            last_updated_by: 'manual',
          })
          .select('id')
          .single()
        if (insErr) throw new Error(`matches insert failed (${m.id}): ${insErr.message}`)
        matchInserts++

        const nowIso = new Date().toISOString()
        await supabase.from('entity_external_ids').upsert({
          entity_type: 'match', entity_id: inserted.id, source: 'ppl', external_id: m.id,
          first_seen_at: nowIso, last_seen_at: nowIso,
        }, { onConflict: 'source,entity_type,external_id', ignoreDuplicates: true })
      }
    }
  }
  console.log(`ties: ${tieCount} | matches inserted: ${matchInserts} | already existed, tie linked: ${matchLinked}`)
  console.log('\nApply complete.')
}

main().catch((e) => { console.error(e); process.exit(1) })
