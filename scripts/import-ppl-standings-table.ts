// Scrapes the Pro Padel League's published standings into league_standings.
//
// The points column IS the standing, and it is not derivable: in their own
// PPL II women's table a 6-0 franchise ranks below a 4-2 one. So it is read
// from the source. ties_won / courts_won on team_seasons remain derived by
// import-ppl-standings.ts; the two are complementary, not competing.
//
// Defaults to a DRY RUN. Pass --apply to write.
// Idempotent: upserts on (team_season_id, scope, event_key).
//
// Usage:
//   npx tsx scripts/import-ppl-standings-table.ts
//   npx tsx scripts/import-ppl-standings-table.ts --season-only
//   npx tsx scripts/import-ppl-standings-table.ts --apply
//
// Requires a Playwright browser (the table is Firestore-at-runtime, DOM only):
//   npx playwright install chromium

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { chromium, type Browser } from 'playwright'
import { extractStandingsDom, type RawStandingsDom } from './lib/ppl-standings-dom'
import {
  parseStandingsTable, checkPointsIdentity, type ParsedStandingsRow,
} from './lib/ppl-standings-parse'
import { fetchBuildId, fetchTournamentIndex, PPL_ORIGIN, PPL_USER_AGENT, type Fetcher } from './lib/ppl-source'

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
const SEASON_ONLY = process.argv.includes('--season-only')
const SEASON_KEY = 'season-2026'

function argValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

// Capture and write are separable on purpose.
//
// Capture needs a browser; this project's laptops do not have a working
// Playwright install (the download stalls at ~2MB of ~170MB) while the
// Railway container does. Writing needs the service key, which lives here.
// So `--emit-capture` prints a self-contained script to run over there, and
// `--capture` reads its output back for parsing and writing here.
//
// The extractor is serialised from `extractStandingsDom` rather than
// copy-pasted, so the remote script cannot drift from the tested source.
const EMIT_CAPTURE = argValue('emit-capture')
const CAPTURE_FILE = argValue('capture')

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const nodeFetch: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': PPL_USER_AGENT } })
  return { status: r.status, text: () => r.text() }
}

/** Their division param -> our scope. */
const SCOPES = [
  { param: 'teams', scope: 'all' as const },
  { param: 'mens', scope: 'men' as const },
  { param: 'womens', scope: 'women' as const },
]

/**
 * Which scopes each division actually publishes.
 *
 * PPL II has NO overall table — its page offers only MEN'S and WOMEN'S,
 * because each club fields a single drafted pairing, so a club's overall
 * record and its gendered record are the same thing.
 *
 * Requesting `division=teams` for ppl-ii does not error. It silently serves
 * the MEN'S table — verified byte-identical, five franchises. Scraping it
 * would have written a fake PPL II "overall" standing holding half the
 * league. Hence an explicit per-division list rather than a cross product.
 *
 * Keys are their league id, which happens to match team_seasons.league —
 * unlike tournaments.level, which spells the division ppl_ii.
 */
const LEAGUE_SCOPES: Record<string, Array<'all' | 'men' | 'women'>> = {
  'ppl': ['all', 'men', 'women'],
  'ppl-ii': ['men', 'women'],
}
const LEAGUES = Object.keys(LEAGUE_SCOPES)

interface View {
  league: string
  scope: 'all' | 'men' | 'women'
  eventKey: string
  url: string
}

function viewUrl(league: string, divisionParam: string, eventKey: string): string {
  return `${PPL_ORIGIN}/league/standings/?division=${divisionParam}&league=${league}&event=${eventKey}`
}

async function scrapeView(browser: Browser, v: View): Promise<ParsedStandingsRow[]> {
  const page = await browser.newPage({ userAgent: PPL_USER_AGENT })
  try {
    // NOT networkidle — these pages hold an open Firestore long-poll and it
    // never fires. See the note in ppl-standings-dom.ts.
    await page.goto(v.url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForSelector('.standings-table__table tbody a[href*="/league/team/"]', { timeout: 30_000 })
    const raw = (await page.evaluate(extractStandingsDom)) as RawStandingsDom
    return parseStandingsTable(raw)
  } finally {
    await page.close()
  }
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — this will write ***' : '--- DRY RUN (pass --apply to write) ---')

  // Event keys come from upstream's index, not a hand-written list. The
  // season importer learned that lesson the hard way with playa-del-carmen.
  const buildId = await fetchBuildId(nodeFetch)
  const index = await fetchTournamentIndex(nodeFetch, buildId)

  const views: View[] = []
  for (const league of LEAGUES) {
    const eventKeys = SEASON_ONLY
      ? [SEASON_KEY]
      : [SEASON_KEY, ...index.filter((e) => e.league === league).map((e) => e.slug)]
    for (const eventKey of eventKeys) {
      for (const s of SCOPES) {
        if (!LEAGUE_SCOPES[league].includes(s.scope)) continue
        views.push({ league, scope: s.scope, eventKey, url: viewUrl(league, s.param, eventKey) })
      }
    }
  }
  console.log(`views to scrape: ${views.length}`)

  if (EMIT_CAPTURE) {
    // Self-contained ESM for the Railway container: no TypeScript, no repo
    // imports, no Supabase. It only opens pages and prints JSON.
    const script = `// GENERATED by import-ppl-standings-table.ts --emit-capture. Do not edit.
const VIEWS = ${JSON.stringify(views, null, 1)}
const extractStandingsDom = ${extractStandingsDom.toString()}
;(async () => {
  const pw = await import('playwright')
  const b = await pw.chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  const out = {}
  for (const v of VIEWS) {
    const key = v.league + '|' + v.scope + '|' + v.eventKey
    const p = await b.newPage()
    // extractStandingsDom is serialised from TypeScript, and the compiler
    // wraps named functions in its own __name() helper. That helper does not
    // exist in the page, so the evaluate throws ReferenceError before running
    // a single selector. Define an identity stand-in first.
    await p.addInitScript(() => { globalThis.__name = (f) => f })
    try {
      // NOT networkidle: these pages hold an open Firestore long-poll and it
      // never fires, so the call would hang instead of erroring.
      await p.goto(v.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await p.waitForSelector('.standings-table__table tbody a[href*="/league/team/"]', { timeout: 30000 })
      out[key] = await p.evaluate(extractStandingsDom)
    } catch (e) {
      out[key] = { error: String(e && e.message ? e.message : e).split('\\n')[0] }
    } finally {
      await p.close()
    }
  }
  await b.close()
  console.log('BEGIN_JSON')
  console.log(JSON.stringify(out))
  process.exit(0)
})()
`
    fs.writeFileSync(EMIT_CAPTURE, script)
    console.log(`\nwrote capture script: ${EMIT_CAPTURE} (${script.length} bytes)`)
    console.log(`run it on the container, then feed the JSON back with --capture`)
    return
  }

  // Resolve our side once: upstream team slug -> team_seasons.id per league.
  const { data: teams, error: teamErr } = await supabase
    .from('teams').select('id,name,external_id').eq('source', 'ppl')
  if (teamErr) throw new Error(`teams read failed: ${teamErr.message}`)
  const { data: seasons, error: seasonErr } = await supabase
    .from('team_seasons').select('id,team_id,league').not('league', 'is', null)
  if (seasonErr) throw new Error(`team_seasons read failed: ${seasonErr.message}`)
  const { data: tours } = await supabase
    .from('tournaments').select('id,external_id').eq('source', 'ppl')

  const teamBySlug = new Map((teams ?? []).map((t) => [t.external_id as string, t]))
  const seasonFor = (slug: string, league: string): string | null => {
    const team = teamBySlug.get(slug)
    if (!team) return null
    return (seasons ?? []).find((s) => s.team_id === team.id && s.league === league)?.id ?? null
  }
  const tournamentFor = (eventKey: string): string | null =>
    (tours ?? []).find((t) => t.external_id === eventKey)?.id ?? null

  // Playwright's default here is the chrome-headless-shell build, which
  // `npx playwright install chromium-headless-shell` provides. Do not pin
  // `channel: 'chromium'` — that asks for the full browser, which is a
  // separate download and was only half-present on this machine.
  const captured = new Map<string, ParsedStandingsRow[]>()
  const empty: string[] = []
  const report = (v: View, rows: ParsedStandingsRow[]) => {
    captured.set(`${v.league}|${v.scope}|${v.eventKey}`, rows)
    if (rows.length === 0) empty.push(`${v.league}/${v.scope}/${v.eventKey}`)
    const pts = rows.map((r) => r.points).filter((p): p is number => p != null)
    console.log(
      `  ${v.league.padEnd(6)} ${v.scope.padEnd(5)} ${v.eventKey.padEnd(30)} ` +
      `rows=${String(rows.length).padStart(2)} points=${pts.length ? `${Math.min(...pts)}..${Math.max(...pts)}` : '-'}`,
    )
  }

  if (CAPTURE_FILE) {
    const raw = JSON.parse(fs.readFileSync(CAPTURE_FILE, 'utf8')) as Record<string, RawStandingsDom & { error?: string }>
    console.log(`reading captured DOM from ${CAPTURE_FILE} (${Object.keys(raw).length} views)`)
    for (const v of views) {
      const dom = raw[`${v.league}|${v.scope}|${v.eventKey}`]
      if (!dom) { console.log(`  ${v.league}/${v.scope}/${v.eventKey}: absent from capture`); continue }
      if (dom.error) { console.log(`  ${v.league}/${v.scope}/${v.eventKey}: capture error (${dom.error})`); continue }
      report(v, parseStandingsTable(dom))
    }
  } else {
    const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
    try {
      for (const v of views) {
        try {
          report(v, await scrapeView(browser, v))
        } catch (e) {
          console.log(`  ${v.league}/${v.scope}/${v.eventKey}: FAILED (${(e as Error).message.split('\n')[0]})`)
        }
      }
    } finally {
      await browser.close()
    }
  }

  // Upstream's own arithmetic as a gate: overall points must equal the sum
  // of the two gendered tables. A mismatch means the scrape drifted onto the
  // wrong columns, or the league changed its scoring — either way, writing
  // would put a wrong number where an official one is implied.
  console.log(`\n=== POINTS IDENTITY (overall == men + women) ===`)
  let identityFailures = 0
  for (const league of LEAGUES) {
    const keys = [...new Set([...captured.keys()]
      .filter((k) => k.startsWith(`${league}|`))
      .map((k) => k.split('|')[2]))]
    for (const eventKey of keys) {
      const all = captured.get(`${league}|all|${eventKey}`)
      const men = captured.get(`${league}|men|${eventKey}`)
      const women = captured.get(`${league}|women|${eventKey}`)
      if (!all || !men || !women) continue
      const bad = checkPointsIdentity(all, men, women)
      if (bad.length === 0) {
        console.log(`  OK   ${league}/${eventKey} (${all.length} franchises)`)
      } else {
        identityFailures += bad.length
        console.log(`  FAIL ${league}/${eventKey}:`)
        for (const b of bad) console.log(`         ${b.slug}: overall=${b.overall} but men+women=${b.sum}`)
      }
    }
  }

  // Build the rows we would write, and report resolution gaps.
  const toWrite: Array<Record<string, unknown>> = []
  const unresolved = new Set<string>()
  for (const [key, rows] of captured) {
    const [league, scope, eventKey] = key.split('|')
    for (const r of rows) {
      const seasonId = seasonFor(r.slug, league)
      if (!seasonId) { unresolved.add(`${r.slug} (${league})`); continue }
      toWrite.push({
        team_season_id: seasonId,
        scope,
        event_key: eventKey,
        tournament_id: tournamentFor(eventKey),
        rank: r.rank, points: r.points, matches_played: r.matchesPlayed,
        wins: r.wins, losses: r.losses,
        pct_matches_won: r.pctMatches, pct_sets_won: r.pctSets,
        pct_games_won: r.pctGames, pct_points_won: r.pctPoints,
        source: 'ppl',
        captured_at: new Date().toISOString(),
      })
    }
  }

  console.log(`\n=== SUMMARY ===`)
  console.log(`  views scraped      : ${captured.size}/${views.length}`)
  console.log(`  empty tables       : ${empty.length}${empty.length ? ` (${empty.join(', ')})` : ''}`)
  console.log(`  rows to write      : ${toWrite.length}`)
  console.log(`  unresolved teams   : ${unresolved.size}${unresolved.size ? ` (${[...unresolved].join(', ')})` : ''}`)
  console.log(`  identity failures  : ${identityFailures}`)
  console.log(`  rows with no tournament_id: ${toWrite.filter((r) => r.tournament_id == null).length}` +
    ` (expected — upstream publishes standings for events with no detail page)`)

  if (!APPLY) { console.log(`\nDry run complete. Nothing written.`); return }

  // A scope that is byte-identical to another is not a scope — it is their
  // server quietly serving a fallback. `division=teams` on ppl-ii returns the
  // men's table verbatim rather than 404ing, and writing it would invent an
  // overall standing covering half the league. LEAGUE_SCOPES already avoids
  // asking; this catches the case where that list is wrong.
  const dupes: string[] = []
  for (const [k1, rows1] of captured) {
    for (const [k2, rows2] of captured) {
      const [l1, s1, e1] = k1.split('|')
      const [l2, s2, e2] = k2.split('|')
      if (l1 !== l2 || e1 !== e2 || s1 >= s2) continue
      if (rows1.length === 0) continue
      if (JSON.stringify(rows1) === JSON.stringify(rows2)) dupes.push(`${l1}/${e1}: ${s1} == ${s2}`)
    }
  }
  if (dupes.length > 0) {
    throw new Error(
      `refusing to write: identical tables served for different scopes — ${dupes.join('; ')}. ` +
      `Upstream serves a fallback instead of erroring for a scope a division does not publish.`,
    )
  }

  // An empty capture passes every other gate VACUOUSLY: no rows means no
  // points, which means checkPointsIdentity finds nothing to disagree with
  // and reports success. Observed for real — the first Railway run captured
  // the table's loading skeleton (10 blank rows, no team links, no points
  // column) and every check was green. Absence of contradiction is not
  // evidence, so require actual rows.
  if (empty.length > 0) {
    throw new Error(
      `refusing to write: ${empty.length} view(s) produced no rows (${empty.join(', ')}). ` +
      `An empty table passes the points-identity check vacuously — most likely the page ` +
      `was captured before its data loaded.`,
    )
  }
  if (toWrite.length === 0) {
    throw new Error('refusing to write: nothing captured at all.')
  }

  if (identityFailures > 0) {
    throw new Error(
      `refusing to write: ${identityFailures} franchise(s) fail upstream's own points identity. ` +
      `Writing would put a wrong number where an official one is implied.`,
    )
  }
  if (unresolved.size > 0) {
    throw new Error(`refusing to write: ${unresolved.size} team slug(s) unresolved: ${[...unresolved].join(', ')}`)
  }

  console.log(`\n=== APPLYING ===`)
  let written = 0
  for (let i = 0; i < toWrite.length; i += 100) {
    const batch = toWrite.slice(i, i + 100)
    const { error } = await supabase
      .from('league_standings')
      .upsert(batch, { onConflict: 'team_season_id,scope,event_key' })
    if (error) throw new Error(`league_standings upsert failed: ${error.message}`)
    written += batch.length
  }
  console.log(`  rows written: ${written}`)
  console.log(`\nApply complete.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
