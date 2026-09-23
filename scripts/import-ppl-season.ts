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
  fetchTournamentIndex,
  PPL_USER_AGENT,
  type Fetcher,
  type PplTournament,
  type PplTeam,
  type PplMatch,
} from './lib/ppl-source'
import { classifyRoster, type ExistingPlayer } from './lib/ppl-classify'
import { parseWallClock, wallClockToUtc, venueTimezone } from './lib/ppl-schedule'

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

/**
 * Fallback only. Slugs now come from upstream's tournaments index — see
 * `fetchTournamentIndex`. This list is what the importer used to guess, and
 * it is kept solely so a broken index does not stop an import cold.
 *
 * It is also the evidence for why discovery replaced it: it says
 * `playa-del-carmen-2026`, and the real slug is `playa-del-carmen`.
 */
const FALLBACK_SLUGS = [
  'new-york-2026',
  'new-york-ppl-ii-2026',
  'los-angeles-2026',
  'los-angeles-ppl-ii-2026',
  'miami-2026',
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

/**
 * Upstream wall-clock + the venue's timezone -> a real instant.
 *
 * Warns and returns null for a venue missing from the timezone table rather
 * than falling back to anything. A country is not specific enough — the US
 * spans four zones — so a guess would be silently hours off.
 */
function scheduledAtFor(tournamentSlug: string, rawDate: string | null): string | null {
  const tz = venueTimezone(tournamentSlug)
  if (!tz) { console.warn(`  no venue timezone for ${tournamentSlug} — scheduled_at left null`); return null }
  const wall = parseWallClock(rawDate)
  if (!wall) return null
  return wallClockToUtc(wall, tz)
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — this will write ***' : '--- DRY RUN (pass --apply to write) ---')

  const buildId = await fetchBuildId(nodeFetch)
  console.log(`buildId: ${buildId}`)

  let slugs: string[]
  try {
    const index = await fetchTournamentIndex(nodeFetch, buildId)
    slugs = index.map((r) => r.slug)
    console.log(`discovered ${slugs.length} events from upstream index`)
    const missing = FALLBACK_SLUGS.filter((s) => !slugs.includes(s))
    if (missing.length) console.log(`  NOTE: known slug(s) absent from index: ${missing.join(', ')}`)
  } catch (e) {
    console.log(`index discovery failed (${(e as Error).message}) — falling back to the hard-coded list`)
    slugs = FALLBACK_SLUGS
  }

  const tournaments: PplTournament[] = []
  for (const slug of slugs) {
    const t = await fetchTournament(nodeFetch, buildId, slug)
    // A 404 here is NOT proof the event is unpublished — that reading is
    // exactly what hid the Playa del Carmen miss. Now that slugs come from
    // upstream's own index, a 404 means the event is listed but has no
    // detail page yet, which is a real state worth naming as such.
    if (!t) { console.log(`  ${slug}: listed, but no detail page (404)`); continue }
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

  const ties = tournaments.reduce((n, t) => n + new Set(t.matches.map((m) => `${m.stage}|${m.sessionNumber ?? ''}|${m.homeTeamSlug}|${m.awayTeamSlug}`)).size, 0)
  const totalMatches = tournaments.reduce((n, t) => n + t.matches.length, 0)
  // Pre-flight: an event whose venue timezone we don't know would write its
  // whole card with scheduled_at NULL, and a dateless match is invisible —
  // it drops off the home carousel and out of today's list. The old code
  // only warned, from inside the write loop, which is after the fact. Fail
  // here instead, while nothing has been written.
  const undated = tournaments.filter((t) => t.matches.length > 0 && !venueTimezone(t.slug))
  if (undated.length > 0) {
    throw new Error(
      `no venue timezone for: ${undated.map((t) => t.slug).join(', ')}. ` +
      `Add them to VENUE_TIMEZONE in scripts/lib/ppl-schedule.ts — importing now ` +
      `would write ${undated.reduce((n, t) => n + t.matches.length, 0)} matches with no date, ` +
      `which renders them invisible rather than merely incomplete.`,
    )
  }

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

  // Rosters are NOT written here.
  //
  // This used to upsert `teamsById`'s squad block. That block is
  // FRANCHISE-wide and byte-identical in the PPL and PPL II payloads, so it
  // claimed each club fielded its whole squad in PPL II, where the league
  // drafts one pairing per club. `import-ppl-standings.ts` derives the real
  // per-division roster from who actually took the court.
  //
  // Leaving the write here would not merely be redundant, it would FIGHT
  // that script: this runs an unconditional upsert, so every season import
  // re-added the 100 squad rows the standings run had just pruned. Observed,
  // not theorised — the Playa del Carmen import took league memberships from
  // 80 back to 180.
  //
  // The squad block is still read, for player discovery above. It is only
  // its use as a per-division roster that is wrong.
  const memberships = 0
  console.log(`team_seasons: ${seasonIdByKey.size} | memberships: not written here (see import-ppl-standings.ts) [${memberships}]`)

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

      // Keyed on tie_key, a non-null natural key the importer composes:
      //   "<stage>|<session or empty>|<homeSlug>|<awaySlug>"
      // The first version keyed on (tournament_id, session_number, stage) and
      // was wrong twice over: several franchise pairings share a session, so
      // that key identifies a time SLOT not a confrontation — it collapsed 52
      // ties into 20 and hung unrelated matches off the same row. It also
      // needed partial indexes for the NULL session_number on podium ties,
      // and PostgREST cannot infer a partial index in ON CONFLICT.
      const tieKey = `${first.stage}|${first.sessionNumber ?? ''}|${first.homeTeamSlug}|${first.awayTeamSlug}`
      const { data: tie, error: tieErr } = await supabase
        .from('league_ties')
        .upsert({
          tournament_id: tournamentId,
          tie_key: tieKey,
          session_number: first.sessionNumber,
          stage: first.stage,
          home_team_season_id: homeSeason,
          away_team_season_id: awaySeason,
        }, { onConflict: 'tournament_id,tie_key' })
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
          // Idempotent re-run: gap-fill only. Never clobber a value already
          // there — another writer may know better than we do.
          await supabase.from('matches').update({ tie_id: tie.id }).eq('id', found.entity_id).is('tie_id', null)
          const when = scheduledAtFor(t.slug, m.scheduledAt)
          if (when) {
            await supabase.from('matches').update({ scheduled_at: when })
              .eq('id', found.entity_id).is('scheduled_at', null)
          }
          matchLinked++
          continue
        }

        // Deliberately NOT setting status / winner_pair / sets — Phase 2b.
        //
        // scheduled_at IS set now, from the venue's timezone. Leaving it null
        // to avoid guessing a zone was the wrong trade: the player profile
        // orders history by date, so 72 correct matches sat invisible at the
        // bottom of every list. Correct-but-undated reads as absent.
        //
        // NEVER set external_id here — sync_matches_id_columns would copy it
        // into padelapi_id.
        const { data: inserted, error: insErr } = await supabase
          .from('matches')
          .insert({
            tournament_id: tournamentId,
            tie_id: tie.id,
            category: m.category,
            round: m.stage,
            scheduled_at: scheduledAtFor(t.slug, m.scheduledAt),
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
