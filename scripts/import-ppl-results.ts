// Scrapes results, lineups and statistics for Pro Padel League matches.
//
// Phase 2a imported 72 matches with ZERO player FKs, because upstream's
// static payload publishes only franchise-versus-franchise. Who actually took
// the court lives in the rendered DOM of each match page, behind Firestore.
// This script fills that in — it is what makes a PPL match appear on a
// player's profile.
//
// Defaults to a DRY RUN. Pass --apply to write.
// Idempotent: a match that already has four player FKs and a winner is
// skipped unless --force.
//
// Usage:
//   npx tsx scripts/import-ppl-results.ts                  # dry run, all
//   npx tsx scripts/import-ppl-results.ts --limit 5        # dry run, first 5
//   npx tsx scripts/import-ppl-results.ts --match <ppl-id> # dry run, one
//   npx tsx scripts/import-ppl-results.ts --apply
//
// Requires a Playwright browser. If the local machine has none:
//   npx playwright install chromium
// or run this from the Railway container, which already has it.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium, type Browser } from 'playwright'
import { extractMatchDom, type RawMatchDom } from './lib/ppl-match-dom'
import { parseMatchDom, type PplMatchResult } from './lib/ppl-match-parse'

// .env.local is how this runs on a laptop. On the Railway container the
// variables are already in the environment and the file does not exist, so
// its absence is not an error — the plan calls for running from there when
// no local Playwright browser is available.
if (fs.existsSync('.env.local')) {
  for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
  }
}
for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY']) {
  if (!process.env[k]) throw new Error(`missing ${k} — set it in .env.local or the environment`)
}

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')
function argValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}
const LIMIT = argValue('limit') ? Number(argValue('limit')) : null
const ONLY_MATCH = argValue('match')

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

const ORIGIN = 'https://propadelleague.com'

interface Target {
  matchId: string
  pplMatchId: string
  tournamentSlug: string
  category: string | null
  complete: boolean
  homeTeam: string | null
  awayTeam: string | null
  url: string
}

/**
 * Franchise names are compared between our `teams.name` and what the page
 * prints, so they must normalise to the same thing.
 *
 * The page appends a status marker to a disqualified franchise —
 * "Houston Volts (DQ)" after their New York disqualification — which our
 * team row obviously does not carry. A trailing parenthetical is a status
 * annotation, never part of the name, so it is stripped before comparing.
 * The marker itself is still worth knowing about; it is reported, not
 * silently discarded.
 */
function normTeam(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/\s*\([^)]*\)\s*$/, '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

/**
 * `matches.duration` is TEXT and every existing row is HH:MM. Upstream gives
 * HH:MM:SS; seconds are dropped rather than introducing a second format in
 * the same column.
 */
function formatDuration(seconds: number | null): string | null {
  if (seconds == null) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Any trailing "(…)" the page attached to a franchise name, e.g. "DQ". */
function teamMarker(s: string | null | undefined): string | null {
  const m = (s ?? '').match(/\(([^)]*)\)\s*$/)
  return m ? m[1].trim() : null
}

async function loadTargets(): Promise<Target[]> {
  const { data: matches, error } = await supabase
    .from('matches')
    .select('id, tie_id, category, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, tournament_id')
    .not('tie_id', 'is', null)
  if (error) throw new Error(`matches read failed: ${error.message}`)

  const { data: eei } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'match').eq('source', 'ppl')
  const pplIdByMatch = new Map((eei ?? []).map((r) => [r.entity_id as string, r.external_id as string]))

  const { data: tours } = await supabase
    .from('tournaments').select('id, external_id').eq('source', 'ppl')
  const slugByTournament = new Map((tours ?? []).map((r) => [r.id as string, r.external_id as string]))

  // Tie -> the two franchise names, so a scraped team can be mapped to pair1/pair2.
  const { data: ties } = await supabase
    .from('league_ties')
    .select('id, home_team_season_id, away_team_season_id')
  const { data: seasons } = await supabase.from('team_seasons').select('id, team_id')
  const { data: teams } = await supabase.from('teams').select('id, name').eq('source', 'ppl')
  const teamNameById = new Map((teams ?? []).map((t) => [t.id as string, t.name as string]))
  const teamBySeason = new Map((seasons ?? []).map((s) => [s.id as string, teamNameById.get(s.team_id as string) ?? null]))
  const tieSides = new Map(
    (ties ?? []).map((t) => [t.id as string, {
      home: teamBySeason.get(t.home_team_season_id as string) ?? null,
      away: teamBySeason.get(t.away_team_season_id as string) ?? null,
    }]),
  )

  const out: Target[] = []
  for (const m of matches ?? []) {
    const pplMatchId = pplIdByMatch.get(m.id as string)
    const tournamentSlug = slugByTournament.get(m.tournament_id as string)
    if (!pplMatchId || !tournamentSlug) continue
    const sides = tieSides.get(m.tie_id as string)
    out.push({
      matchId: m.id as string,
      pplMatchId,
      tournamentSlug,
      category: (m.category as string) ?? null,
      complete: Boolean(
        m.winner_pair && m.pair1_player1_id && m.pair1_player2_id && m.pair2_player1_id && m.pair2_player2_id,
      ),
      homeTeam: sides?.home ?? null,
      awayTeam: sides?.away ?? null,
      url: `${ORIGIN}/tournament/${tournamentSlug}/match/${pplMatchId}/`,
    })
  }
  out.sort((a, b) => a.pplMatchId.localeCompare(b.pplMatchId))
  return out
}

async function loadSlugMap(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('entity_external_ids')
      .select('entity_id, external_id')
      .eq('entity_type', 'player').eq('source', 'ppl')
      .range(start, start + 999)
    if (error) throw new Error(`player slug map read failed: ${error.message}`)
    for (const r of data) out.set(r.external_id as string, r.entity_id as string)
    if (data.length < 1000) break
  }
  return out
}

async function scrapeOne(browser: Browser, t: Target): Promise<PplMatchResult> {
  const page = await browser.newPage()
  try {
    // NEVER networkidle — the page holds an open Firestore long-poll and the
    // call would hang forever rather than time out.
    await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('.match-h2h-board__set-pill', { timeout: 30_000 })
    const raw = (await page.evaluate(extractMatchDom)) as RawMatchDom
    return parseMatchDom(raw)
  } finally {
    await page.close()
  }
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — this will write ***' : '--- DRY RUN (pass --apply to write) ---')

  let targets = await loadTargets()
  if (ONLY_MATCH) targets = targets.filter((t) => t.pplMatchId === ONLY_MATCH)
  const skippedComplete = FORCE ? [] : targets.filter((t) => t.complete)
  if (!FORCE) targets = targets.filter((t) => !t.complete)
  if (LIMIT != null) targets = targets.slice(0, LIMIT)

  const slugMap = await loadSlugMap()
  console.log(`targets: ${targets.length} | already complete, skipped: ${skippedComplete.length} | ppl player slugs known: ${slugMap.size}`)
  if (targets.length === 0) { console.log('nothing to do'); return }

  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const plan: Array<{ t: Target; r: PplMatchResult; pair1: string[]; pair2: string[]; winnerPair: 1 | 2; sets: Array<{ setNumber: number; pair1Games: number; pair2Games: number }>; stats: Record<string, unknown> }> = []
  let parseFailed = 0, unresolvedSlug = 0, teamMismatch = 0, markedTeams = 0, orientationFailed = 0

  try {
    for (const t of targets) {
      let r: PplMatchResult
      try {
        r = await scrapeOne(browser, t)
      } catch (e) {
        // Per-match and non-fatal. One bad page must not abort a 72-page run.
        parseFailed++
        console.warn(`  FAIL ${t.pplMatchId}: ${(e as Error).message.split('\n')[0].slice(0, 150)}`)
        continue
      }

      // Map the scraped pairs onto pair1/pair2 using the tie's home/away teams.
      const byTeam = new Map(r.pairs.map((p) => [normTeam(p.team), p]))
      const homePair = byTeam.get(normTeam(t.homeTeam))
      const awayPair = byTeam.get(normTeam(t.awayTeam))
      if (!homePair || !awayPair) {
        teamMismatch++
        console.warn(`  TEAM MISMATCH ${t.pplMatchId}: tie says "${t.homeTeam}" vs "${t.awayTeam}", page says ${r.pairs.map((p) => `"${p.team}"`).join(' vs ')}`)
        continue
      }

      const resolve = (slugs: string[]) => slugs.map((s) => slugMap.get(s) ?? null)
      const pair1 = resolve(homePair.players.map((p) => p.slug))
      const pair2 = resolve(awayPair.players.map((p) => p.slug))
      const missing = [...homePair.players, ...awayPair.players].filter((p) => !slugMap.has(p.slug))
      if (missing.length > 0) {
        unresolvedSlug++
        console.warn(`  UNRESOLVED SLUG ${t.pplMatchId}: ${missing.map((p) => p.slug).join(', ')}`)
        continue
      }

      // Orient every score to pair1/pair2. The parser reports in SCOREBOARD
      // row order, which is not the tie's home/away order on most matches —
      // conflating the two reversed every set written on the first run.
      const flip = homePair.rowIndex === 1
      const orientedSets = r.sets.map((s0) => ({
        setNumber: s0.setNumber,
        pair1Games: flip ? s0.row1 : s0.row0,
        pair2Games: flip ? s0.row0 : s0.row1,
      }))
      const orientPct = (v: { row0: number | null; row1: number | null }) =>
        flip ? { pair1: v.row1, pair2: v.row0 } : { pair1: v.row0, pair2: v.row1 }
      const orientedStats = Object.fromEntries(
        Object.entries(r.stats).map(([k, v]) => [k, orientPct(v as { row0: number | null; row1: number | null })]),
      )

      // Cross-check: the pair that won more sets must be the pair marked the
      // winner. If those disagree the orientation is wrong, and writing it
      // would be worse than skipping.
      let p1Sets = 0, p2Sets = 0
      for (const s0 of orientedSets) {
        if (s0.pair1Games > s0.pair2Games) p1Sets++
        else if (s0.pair2Games > s0.pair1Games) p2Sets++
      }
      const impliedWinner = p1Sets > p2Sets ? 1 : 2
      const declaredWinner = homePair.won ? 1 : 2
      if (impliedWinner !== declaredWinner) {
        orientationFailed++
        console.warn(`  ORIENTATION MISMATCH ${t.pplMatchId}: sets imply pair${impliedWinner}, page marks pair${declaredWinner}`)
        continue
      }

      plan.push({
        t, r,
        pair1: pair1 as string[],
        pair2: pair2 as string[],
        winnerPair: declaredWinner,
        sets: orientedSets,
        stats: orientedStats,
      })
      const markers = [homePair, awayPair].map((p) => teamMarker(p.team)).filter(Boolean)
      if (markers.length > 0) markedTeams++
      console.log(`  ok ${t.pplMatchId.padEnd(38)} ${orientedSets.map((s0) => `${s0.pair1Games}-${s0.pair2Games}`).join(' ')}  winner=pair${declaredWinner}${markers.length ? `  [team marker: ${markers.join(', ')}]` : ''}`)
    }
  } finally {
    await browser.close()
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`  scraped ok            : ${plan.length}`)
  console.log(`  skipped, already done : ${skippedComplete.length}`)
  console.log(`  parse failed          : ${parseFailed}`)
  console.log(`  unresolved slug       : ${unresolvedSlug}`)
  console.log(`  team mismatch         : ${teamMismatch}`)
  console.log(`  orientation mismatch  : ${orientationFailed}`)
  console.log(`  with a team marker    : ${markedTeams}  (e.g. "(DQ)" on a disqualified franchise)`)
  console.log(`\n  would set lineups     : ${plan.length} matches (4 player FKs each)`)
  console.log(`  would set results     : ${plan.filter((p) => p.r.isFinal).length} final`)
  console.log(`  would write set rows  : ${plan.reduce((n, p) => n + p.sets.length, 0)}`)
  console.log(`  would write stat rows : ${plan.length}`)

  if (!APPLY) { console.log(`\nDry run complete. Nothing written.`); return }

  console.log(`\n=== APPLYING ===`)
  let matchesWritten = 0, setsWritten = 0, statsWritten = 0
  const nowIso = new Date().toISOString()

  for (const { t, r, pair1, pair2, winnerPair, sets, stats } of plan) {
    // NEVER set matches.external_id — sync_matches_id_columns is
    // unconditional and would copy it into padelapi_id, a column reserved
    // for padelapi's numeric ids.
    const { error: mErr } = await supabase
      .from('matches')
      .update({
        pair1_player1_id: pair1[0], pair1_player2_id: pair1[1],
        pair2_player1_id: pair2[0], pair2_player2_id: pair2[1],
        winner_pair: winnerPair,
        status: r.isFinal ? 'finished' : 'scheduled',
        // `duration` is TEXT and the house format is HH:MM — upstream gives
        // HH:MM:SS. Match the existing convention rather than inventing a
        // third format in the same column.
        duration: formatDuration(r.durationSeconds),
        last_updated_by: 'manual',
        updated_at: nowIso,
      })
      .eq('id', t.matchId)
    if (mErr) throw new Error(`matches update failed (${t.pplMatchId}): ${mErr.message}`)
    matchesWritten++

    for (const set of sets) {
      const { error: sErr } = await supabase.from('sets').upsert({
        match_id: t.matchId,
        set_number: set.setNumber,
        set_score: `${set.pair1Games}-${set.pair2Games}`,
        pair1_games: set.pair1Games,
        pair2_games: set.pair2Games,
        is_current: false,
        score_source: 'api',
        updated_at: nowIso,
      }, { onConflict: 'match_id,set_number' })
      if (sErr) throw new Error(`sets upsert failed (${t.pplMatchId} set ${set.setNumber}): ${sErr.message}`)
      setsWritten++
    }

    // Every match_stats numeric column is a won/played COUNT pair. PPL
    // publishes percentages with no denominator, so none of them can be
    // filled honestly — the whole payload goes to raw_payload until a screen
    // needs it queryable, which is what the spec calls for.
    const { error: stErr } = await supabase.from('match_stats').upsert({
      match_id: t.matchId,
      set_number: 0,
      source: 'ppl',
      source_match_id: t.pplMatchId,
      computed_at: nowIso,
      raw_payload: {
        scrapedAt: nowIso,
        url: r.url,
        stats,
        pairs: r.pairs.map((p) => ({
          team: p.team,
          won: p.won,
          players: p.players.map((pl) => ({
            slug: pl.slug, name: pl.name,
            firstServeInPct: pl.firstServeInPct, aces: pl.aces, doubleFaults: pl.doubleFaults,
            winners: pl.winners,
          })),
        })),
      },
    }, { onConflict: 'match_id,set_number' })
    if (stErr) throw new Error(`match_stats upsert failed (${t.pplMatchId}): ${stErr.message}`)
    statsWritten++
  }

  console.log(`  matches updated : ${matchesWritten}`)
  console.log(`  set rows        : ${setsWritten}`)
  console.log(`  stat rows       : ${statsWritten}`)
  console.log(`\nApply complete.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
