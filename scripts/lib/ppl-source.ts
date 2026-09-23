// Source client for propadelleague.com.
//
// The site is a Next.js Pages Router app. Everything static — franchises,
// rosters, fixtures — is served as JSON at
//   /_next/data/<buildId>/tournament/<slug>.json
// Scores and per-match statistics are NOT here: those come from Firestore at
// runtime and exist only in the rendered DOM. That is Phase 2b.
//
// `buildId` changes on every deploy of their site, so it must be read at
// runtime from the served HTML. Never hardcode it.
//
// Pure except for the injected `fetchFn`, so the parser is fixture-testable.

export type Fetcher = (url: string) => Promise<{ status: number; text: () => Promise<string> }>

export const PPL_ORIGIN = 'https://propadelleague.com'
export const PPL_USER_AGENT = 'padelgod/1.0 (+https://padelnachos.com)'

export interface PplTeam {
  slug: string
  name: string
  location: string | null
  brandColor: string | null
  colorLogo: string | null
  instagramUrl: string | null
  mensPlayerIds: string[]
  womensPlayerIds: string[]
}

export interface PplPlayer {
  slug: string
  name: string
  /** upstream `sex`: 'male' | 'female' */
  sex: string | null
  /** upstream `leagueId`: 'ppl' | 'ppl-ii' */
  league: string | null
  status: string | null
}

export interface PplMatch {
  id: string
  homeTeamSlug: string
  awayTeamSlug: string
  /** our vocabulary, mapped from upstream `game_type` */
  category: 'men' | 'women'
  stage: string
  sessionNumber: number | null
  scheduledAt: string | null
  league: string | null
}

export interface PplTournament {
  slug: string
  name: string
  startDate: string | null
  endDate: string | null
  location: string | null
  league: string
  teams: PplTeam[]
  players: PplPlayer[]
  matches: PplMatch[]
}

export function extractBuildId(html: string): string {
  const m = html.match(/"buildId":"([^"]+)"/)
  if (!m) throw new Error('extractBuildId: no buildId in the served HTML — upstream shape changed')
  return m[1]
}

export async function fetchBuildId(fetchFn: Fetcher): Promise<string> {
  const r = await fetchFn(`${PPL_ORIGIN}/tournaments/`)
  if (r.status !== 200) throw new Error(`fetchBuildId: HTTP ${r.status}`)
  return extractBuildId(await r.text())
}

/** Upstream `game_type` → our `matches.category`. */
function toCategory(gameType: unknown): 'men' | 'women' {
  if (gameType === 'female') return 'women'
  if (gameType === 'male') return 'men'
  throw new Error(`unknown game_type: ${JSON.stringify(gameType)}`)
}

/**
 * Upstream emits two date shapes in the same payload: ISO
 * ("2026-08-13T16:00:00") for group-stage rows and US locale
 * ("8/16/2026 1:00:00 PM") for podium rows. Both are wall-clock in the
 * event's local time with no zone. We keep the raw string here and let the
 * caller decide the timezone — guessing one in the parser would bake in a
 * silent error.
 */
function rawDate(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

/**
 * Removes a quoted nickname from a player name:
 *   `Alejandro "Alex" Ruiz` -> `Alejandro Ruiz`
 *
 * Upstream puts the nickname in BOTH `displayName` AND `firstName`
 * (firstName is literally `Alejandro "Alex"`), so stripping has to happen
 * whichever field we read. Affects 4 of 132 players.
 *
 * ── Why we read `displayName` and not `firstName` + `lastName` ──
 *
 * The separate name fields look like the cleaner source, and an earlier
 * draft of this module preferred them for exactly that reason. Measured
 * against our `players` table on 2026-09-23, that was wrong:
 *
 *   displayName          67 resolved   64 missed
 *   firstName+lastName   46 resolved   85 missed
 *
 * 32 of 132 players (24%) have the two forms disagreeing, and the pattern is
 * that upstream's split fields carry the two Spanish surnames in the WRONG
 * ORDER — `displayName: "Anna Ortiz Gasco"` against
 * `firstName: "Anna", lastName: "Gasco Ortiz"` — and sometimes duplicate one
 * (`"Agueda Perez Ortiz Perez"`). Since the paternal surname comes first in
 * Spanish and that is the order our database holds, the composed form fails
 * to match. Preferring it would have minted 21 duplicate player rows.
 */
export function stripNickname(name: string): string {
  return name
    .replace(/["'“”‘’][^"'“”‘’]*["'“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseTournamentPayload(payload: any, slug: string): PplTournament {
  const props = payload?.pageProps
  const ctx = props?.broadcastContext
  if (!ctx) throw new Error(`parseTournamentPayload(${slug}): no broadcastContext`)

  const hero = props.hero ?? {}

  const teams: PplTeam[] = Object.entries(ctx.teamsById ?? {}).map(([id, row]: [string, any]) => ({
    slug: id,
    name: row.values?.name ?? id,
    location: row.values?.location ?? row.values?.team_location ?? null,
    brandColor: row.values?.color ?? row.values?.teamColor ?? null,
    colorLogo: row.values?.colorLogo ?? null,
    instagramUrl: row.values?.instagramUrl ?? null,
    mensPlayerIds: row.values?.mensPlayerIds ?? [],
    womensPlayerIds: row.values?.womensPlayerIds ?? [],
  }))

  const players: PplPlayer[] = Object.entries(ctx.playerRowsById ?? {}).map(([id, row]: [string, any]) => {
    const v = row.values ?? {}
    const composed = stripNickname(`${v.firstName ?? ''} ${v.lastName ?? ''}`.trim())
    const display = stripNickname(v.displayName ?? '')
    return {
      slug: id,
      // displayName first — see the stripNickname docblock for why the
      // composed first+last form is the WORSE choice despite looking cleaner.
      name: display.length > 0 ? display : composed.length > 0 ? composed : id,
      sex: v.sex ?? null,
      league: v.leagueId ?? null,
      status: v.status ?? null,
    }
  })

  const matches: PplMatch[] = (ctx.matchRows ?? []).map((row: any) => {
    const v = row.values ?? {}
    return {
      id: row.id,
      homeTeamSlug: v.hometeam?.docId ?? '',
      awayTeamSlug: v.awayteam?.docId ?? '',
      category: toCategory(v.game_type),
      stage: v.stage ?? 'Group Stage',
      sessionNumber: typeof v.sessionNumber === 'number' ? v.sessionNumber : null,
      scheduledAt: rawDate(v.date),
      league: v.league?.docId ?? null,
    }
  })

  const league = matches.find((m) => m.league)?.league ?? 'ppl'

  return {
    slug,
    name: hero.title ?? slug,
    startDate: hero.startDate ?? null,
    endDate: hero.endDate ?? null,
    location: hero.location ?? null,
    league,
    teams,
    players,
    matches,
  }
}

export async function fetchTournament(
  fetchFn: Fetcher,
  buildId: string,
  slug: string,
): Promise<PplTournament | null> {
  const url = `${PPL_ORIGIN}/_next/data/${buildId}/tournament/${slug}.json?slug=${slug}`
  const r = await fetchFn(url)
  if (r.status === 404) return null
  if (r.status !== 200) throw new Error(`fetchTournament(${slug}): HTTP ${r.status}`)
  return parseTournamentPayload(JSON.parse(await r.text()), slug)
}
