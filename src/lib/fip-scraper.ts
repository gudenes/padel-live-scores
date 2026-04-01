/**
 * fip-scraper.ts
 *
 * All scraping/parsing logic for FIP Gold/Silver/Bronze tournament data.
 * Sources:
 *  - padelfip.com WordPress API (tournament listings, media, dates)
 *  - widget.matchscorerlive.com (draw / results HTML)
 *
 * Run tests with: npx vitest run src/lib/__tests__/fip-scraper.test.ts
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const FIP_WP_BASE = 'https://www.padelfip.com'
export const FIP_WP_API = FIP_WP_BASE + '/wp-json/wp/v2'
export const MATCHSCORER_WIDGET = 'https://widget.matchscorerlive.com'

export const FIP_CATEGORY_IDS: Record<string, number> = {
  Gold: 19,
  Silver: 496,
  Bronze: 497,
}

// Reverse lookup: id → level name
const CATEGORY_ID_TO_LEVEL: Record<number, string> = Object.fromEntries(
  Object.entries(FIP_CATEGORY_IDS).map(([level, id]) => [id, level])
)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FipTournament {
  wpId: number
  name: string
  slug: string
  link: string
  featuredMediaId: number
  categoryIds: number[]
  countryTermIds: number[]
  genderTermIds: number[]
  level: string // 'Gold', 'Silver', 'Bronze'
}

export interface EventDates {
  startsAt: string | null // ISO date YYYY-MM-DD
  endsAt: string | null
}

export interface MatchscorerIds {
  year: string
  id: string
  totalDays: number
  code: string // e.g. "FIP-2025-3301"
}

export interface ParsedMatch {
  round: string
  court: string | null
  category: 'men' | 'women'
  status: 'scheduled' | 'finished'
  team1: ParsedTeam
  team2: ParsedTeam
  sets: ParsedSet[]
  winnerTeam: 1 | 2 | null
}

export interface ParsedTeam {
  player1: ParsedPlayer
  player2: ParsedPlayer
}

export interface ParsedPlayer {
  firstName: string
  lastName: string
  country: string | null
  seed: number | null
}

export interface ParsedSet {
  setNumber: number
  team1Games: number
  team2Games: number
}

// ---------------------------------------------------------------------------
// HTML entity decoder (browser-independent)
// ---------------------------------------------------------------------------

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&apos;/g, "'")
}

// ---------------------------------------------------------------------------
// Pure parsing functions
// ---------------------------------------------------------------------------

/**
 * Parse a WP API event JSON object into a FipTournament.
 */
export function parseWpEvent(event: any): FipTournament {
  // Extract level from category IDs
  const categoryIds: number[] = event.categories ?? []
  let level = 'Gold' // default
  for (const id of categoryIds) {
    if (CATEGORY_ID_TO_LEVEL[id]) {
      level = CATEGORY_ID_TO_LEVEL[id]
      break
    }
  }

  // Country and gender are stored in custom taxonomies — acf or custom fields
  // The WP API may expose them via `_links` or embedded `wp:term`
  const countryTermIds: number[] = event['country-fip'] ?? event.country ?? []
  const genderTermIds: number[] = event['gender-fip'] ?? event.gender ?? []

  const rawTitle: string =
    event.title?.rendered ?? event.title ?? ''
  const name = decodeHtmlEntities(rawTitle)

  return {
    wpId: event.id,
    name,
    slug: event.slug ?? '',
    link: event.link ?? '',
    featuredMediaId: event.featured_media ?? 0,
    categoryIds,
    countryTermIds: Array.isArray(countryTermIds) ? countryTermIds : [],
    genderTermIds: Array.isArray(genderTermIds) ? genderTermIds : [],
    level,
  }
}

/**
 * Extract start/end dates from event page HTML.
 * Dates appear as "DD/MM/YYYY - DD/MM/YYYY" in the page body.
 */
export function parseEventDates(html: string): EventDates {
  // Match patterns like "15/03/2025 - 22/03/2025" or "15/03/2025 – 22/03/2025"
  const dateRangeRe =
    /(\d{2})\/(\d{2})\/(\d{4})\s*[-\u2013\u2014]\s*(\d{2})\/(\d{2})\/(\d{4})/

  const rangeMatch = dateRangeRe.exec(html)
  if (rangeMatch) {
    const [, d1, m1, y1, d2, m2, y2] = rangeMatch
    return {
      startsAt: `${y1}-${m1}-${d1}`,
      endsAt: `${y2}-${m2}-${d2}`,
    }
  }

  // Try to extract a single date at minimum
  const singleRe = /(\d{2})\/(\d{2})\/(\d{4})/
  const singleMatch = singleRe.exec(html)
  if (singleMatch) {
    const [, d, m, y] = singleMatch
    return {
      startsAt: `${y}-${m}-${d}`,
      endsAt: null,
    }
  }

  return { startsAt: null, endsAt: null }
}

/**
 * Extract matchscorer IDs from inline JS in event page HTML.
 * Looks for: const eventYear = "2025"; const eventID = "3301"; const totalday = 5;
 */
export function parseMatchscorerIds(html: string): MatchscorerIds | null {
  const yearMatch = /const\s+eventYear\s*=\s*["'](\d+)["']/.exec(html)
  const idMatch = /const\s+eventID\s*=\s*["'](\d+)["']/.exec(html)
  const daysMatch = /const\s+totalday\s*=\s*(\d+)/.exec(html)

  if (!yearMatch || !idMatch) return null

  const year = yearMatch[1]
  const id = idMatch[1]
  const totalDays = daysMatch ? parseInt(daysMatch[1], 10) : 1

  return {
    year,
    id,
    totalDays,
    code: `FIP-${year}-${id}`,
  }
}

// ---------------------------------------------------------------------------
// parseDrawHtml — parse widget.matchscorerlive.com draw HTML
// ---------------------------------------------------------------------------

/**
 * Parse the draw HTML from widget.matchscorerlive.com for a given category.
 */
export function parseDrawHtml(
  html: string,
  category: 'men' | 'women'
): ParsedMatch[] {
  const matches: ParsedMatch[] = []

  // Split by match tables — each match contains "scorebox-header"
  // We look for <table ... > blocks that contain scorebox-header
  // Use a regex to find each table block
  const tableRe = /<table\b[^>]*class="[^"]*w-100[^"]*"[^>]*>([\s\S]*?)<\/table>/gi
  let tableMatch: RegExpExecArray | null

  while ((tableMatch = tableRe.exec(html)) !== null) {
    const tableHtml = tableMatch[0]

    // Only process tables that contain a scorebox-header
    if (!tableHtml.includes('scorebox-header')) continue

    try {
      const parsed = parseMatchTable(tableHtml, category)
      if (parsed) matches.push(parsed)
    } catch {
      // Skip malformed tables
    }
  }

  return matches
}

function parseMatchTable(
  tableHtml: string,
  category: 'men' | 'women'
): ParsedMatch | null {
  // Round
  const roundMatch = /<th[^>]*class="[^"]*round-name[^"]*"[^>]*>[\s\S]*?<small[^>]*>([\s\S]*?)<\/small>/i.exec(
    tableHtml
  )
  const round = roundMatch ? stripTags(roundMatch[1]).trim() : 'Unknown'

  // Court
  const courtMatch = /<span[^>]*class="[^"]*court-name[^"]*"[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i.exec(
    tableHtml
  )
  const court = courtMatch ? stripTags(courtMatch[1]).trim() || null : null

  // Status
  const isCompleted = tableHtml.includes('scorebox-header-completed')
  const status: 'scheduled' | 'finished' = isCompleted ? 'finished' : 'scheduled'

  // Split into team sections
  // Teams are separated by "scorebox-sep-bottom" rows or "draw-item-container" rows
  // or by <!-- Team 2 --> comment
  const teamSections = splitTeamSections(tableHtml)
  if (teamSections.length < 2) return null

  const team1Html = teamSections[0]
  const team2Html = teamSections[1]

  const team1 = parseTeam(team1Html)
  const team2 = parseTeam(team2Html)

  // Winner detection — check for fa-check or "winner" class on team rows
  const team1HasWinner = hasWinnerMarker(team1Html)
  const team2HasWinner = hasWinnerMarker(team2Html)

  let winnerTeam: 1 | 2 | null = null
  if (isCompleted) {
    if (team1HasWinner && !team2HasWinner) winnerTeam = 1
    else if (team2HasWinner && !team1HasWinner) winnerTeam = 2
  }

  // Set scores
  const sets = parseSetScores(team1Html, team2Html)

  return {
    round,
    court,
    category,
    status,
    team1,
    team2,
    sets,
    winnerTeam,
  }
}

function splitTeamSections(tableHtml: string): string[] {
  // Try <!-- Team 2 --> comment split
  const commentIdx = tableHtml.indexOf('<!-- Team 2 -->')
  if (commentIdx !== -1) {
    return [tableHtml.slice(0, commentIdx), tableHtml.slice(commentIdx)]
  }

  // Try splitting by scorebox-sep-bottom rows
  const sepRe = /<tr[^>]*class="[^"]*scorebox-sep-bottom[^"]*"[^>]*>/gi
  const sepMatches: number[] = []
  let m: RegExpExecArray | null
  while ((m = sepRe.exec(tableHtml)) !== null) {
    sepMatches.push(m.index)
  }
  if (sepMatches.length >= 1) {
    return [
      tableHtml.slice(0, sepMatches[0]),
      tableHtml.slice(sepMatches[0]),
    ]
  }

  // Try draw-item-container rows
  const containerRe = /<tr[^>]*class="[^"]*draw-item-container[^"]*"[^>]*>/gi
  const containerMatches: number[] = []
  while ((m = containerRe.exec(tableHtml)) !== null) {
    containerMatches.push(m.index)
  }
  if (containerMatches.length >= 2) {
    return [
      tableHtml.slice(containerMatches[0], containerMatches[1]),
      tableHtml.slice(containerMatches[1]),
    ]
  }

  // Fallback: split in half
  const half = Math.floor(tableHtml.length / 2)
  return [tableHtml.slice(0, half), tableHtml.slice(half)]
}

function parseTeam(teamHtml: string): ParsedTeam {
  // Find all player-names double blocks
  const playerBlocks = extractPlayerBlocks(teamHtml)

  const player1 = playerBlocks[0] ?? defaultPlayer()
  const player2 = playerBlocks[1] ?? defaultPlayer()

  return { player1, player2 }
}

function defaultPlayer(): ParsedPlayer {
  return { firstName: '', lastName: '', country: null, seed: null }
}

function extractPlayerBlocks(html: string): ParsedPlayer[] {
  const players: ParsedPlayer[] = []

  // Each player is in a <div class="d-flex align-items-center"> block
  const blockRe =
    /<div[^>]*class="[^"]*d-flex[^"]*align-items-center[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi
  let match: RegExpExecArray | null

  while ((match = blockRe.exec(html)) !== null) {
    const block = match[0]
    players.push(parsePlayerBlock(block))
  }

  // If above regex didn't capture enough, try wider approach
  if (players.length === 0) {
    const altRe =
      /<div[^>]*class="[^"]*d-flex[^"]*align-items-center[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*d-flex[^"]*align-items-center|<\/div>\s*<\/div>)/gi
    while ((match = altRe.exec(html)) !== null) {
      players.push(parsePlayerBlock(match[0]))
    }
  }

  return players
}

function parsePlayerBlock(block: string): ParsedPlayer {
  // Country: flag img src="/images/flags/ESP.jpg"
  const flagMatch = /src="\/images\/flags\/([A-Z]{2,3})\.(?:jpg|png|svg)"/i.exec(block)
  const country = flagMatch ? flagMatch[1].toUpperCase() : null

  // Name: <span>J.</span><span class="">Castello Lopez</span>
  // first span = firstName, second span = lastName
  const nameDiv =
    /<div[^>]*class="[^"]*(?:ml-2|ms-2)[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(block)
  let firstName = ''
  let lastName = ''

  if (nameDiv) {
    const spanMatches = [...nameDiv[1].matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)]
    if (spanMatches.length >= 2) {
      firstName = stripTags(spanMatches[0][1]).trim().replace(/\.$/, '')
      lastName = stripTags(spanMatches[1][1]).trim()
    } else if (spanMatches.length === 1) {
      // Single span — treat as last name
      lastName = stripTags(spanMatches[0][1]).trim()
    }
  }

  // Seed: <small>(1)</small> or <small class="separator">(1)</small>
  const seedMatch = /<small[^>]*>\((\d+)\)<\/small>/i.exec(block)
  const seed = seedMatch ? parseInt(seedMatch[1], 10) : null

  return { firstName, lastName, country, seed }
}

function hasWinnerMarker(teamHtml: string): boolean {
  // Winner indicated by fa-check icon or "winner" class on the name div
  return teamHtml.includes('fa-check') || /class="[^"]*\bwinner\b[^"]*"/.test(teamHtml)
}

function parseSetScores(team1Html: string, team2Html: string): ParsedSet[] {
  const t1Scores = extractSetCells(team1Html)
  const t2Scores = extractSetCells(team2Html)

  const count = Math.min(t1Scores.length, t2Scores.length)
  const sets: ParsedSet[] = []

  for (let i = 0; i < count; i++) {
    const t1 = t1Scores[i]
    const t2 = t2Scores[i]
    if (t1 === null || t2 === null) continue // unplayed set
    sets.push({
      setNumber: i + 1,
      team1Games: t1,
      team2Games: t2,
    })
  }

  return sets
}

function extractSetCells(html: string): (number | null)[] {
  const scores: (number | null)[] = []
  // Match <td class="set ...">VALUE</td>
  const cellRe = /<td[^>]*class="[^"]*\bset\b[^"]*"[^>]*>([\s\S]*?)<\/td>/gi
  let m: RegExpExecArray | null

  while ((m = cellRe.exec(html)) !== null) {
    const value = stripTags(m[1]).trim()
    if (value === '-' || value === '') {
      scores.push(null) // unplayed
    } else {
      const n = parseInt(value, 10)
      scores.push(isNaN(n) ? null : n)
    }
  }

  return scores
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

// ---------------------------------------------------------------------------
// Module-level cache for country taxonomy
// ---------------------------------------------------------------------------

let countryTermCache: Map<number, string> | null = null

// ---------------------------------------------------------------------------
// HTTP fetcher functions
// ---------------------------------------------------------------------------

const DEFAULT_HEADERS = {
  'User-Agent': 'padel-nacho/1.0',
  Accept: 'application/json',
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Fetch FIP events from WP API. Paginates automatically.
 * @param level Optional level filter ('Gold', 'Silver', 'Bronze')
 */
export async function fetchFipEvents(level?: string): Promise<FipTournament[]> {
  const categoryIds =
    level && FIP_CATEGORY_IDS[level]
      ? [FIP_CATEGORY_IDS[level]]
      : Object.values(FIP_CATEGORY_IDS)

  const all: FipTournament[] = []

  for (const catId of categoryIds) {
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const url = `${FIP_WP_API}/events?categories=${catId}&page=${page}&per_page=20`
      const resp = await fetch(url, { headers: DEFAULT_HEADERS })

      if (!resp.ok) {
        if (resp.status === 400) break // No more pages
        throw new Error(`WP API error: ${resp.status} ${url}`)
      }

      const data = await resp.json()
      if (!Array.isArray(data) || data.length === 0) break

      // Read total pages from header
      const wpTotalPages = resp.headers.get('X-WP-TotalPages')
      if (wpTotalPages) totalPages = parseInt(wpTotalPages, 10)

      for (const event of data) {
        try {
          all.push(parseWpEvent(event))
        } catch {
          // Skip unparseable events
        }
      }

      page++
      if (page <= totalPages) await delay(200)
    }
  }

  return all
}

/**
 * Fetch event page HTML from padelfip.com and extract dates + matchscorer IDs.
 */
export async function fetchEventPageData(
  slug: string
): Promise<{ dates: EventDates; matchscorer: MatchscorerIds | null }> {
  const url = `${FIP_WP_BASE}/events/${slug}/`
  const resp = await fetch(url, {
    headers: { 'User-Agent': 'padel-nacho/1.0' },
  })

  if (!resp.ok) throw new Error(`Failed to fetch event page: ${resp.status} ${url}`)

  const html = await resp.text()
  return {
    dates: parseEventDates(html),
    matchscorer: parseMatchscorerIds(html),
  }
}

/**
 * Fetch WP country taxonomy, cache it, return ISO code for first matching term.
 */
export async function resolveCountryTerms(
  termIds: number[]
): Promise<string | null> {
  if (!countryTermCache) {
    countryTermCache = new Map()
    // Fetch country-fip taxonomy terms
    let page = 1
    let totalPages = 1

    while (page <= totalPages) {
      const url = `${FIP_WP_API}/country-fip?per_page=100&page=${page}`
      try {
        const resp = await fetch(url, { headers: DEFAULT_HEADERS })
        if (!resp.ok) break

        const terms = await resp.json()
        if (!Array.isArray(terms) || terms.length === 0) break

        const wpTotal = resp.headers.get('X-WP-TotalPages')
        if (wpTotal) totalPages = parseInt(wpTotal, 10)

        for (const term of terms) {
          if (term.id && term.slug) {
            // slug is typically ISO code or country name; prefer slug as-is
            countryTermCache.set(term.id, term.slug.toUpperCase())
          }
        }

        page++
        if (page <= totalPages) await delay(200)
      } catch {
        break
      }
    }
  }

  for (const id of termIds) {
    const code = countryTermCache.get(id)
    if (code) return code
  }

  return null
}

/**
 * Fetch draw matches from widget.matchscorerlive.com.
 * Fetches main page, discovers MD/WD sub-pages, parses each.
 */
export async function fetchDrawMatches(
  matchscorerCode: string
): Promise<ParsedMatch[]> {
  const matchscorerHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    Referer: 'https://www.padelfip.com/',
    Accept: 'text/html,application/xhtml+xml',
  }

  const mainUrl = `${MATCHSCORER_WIDGET}/screen/draw/${matchscorerCode}?t=tol`
  const mainResp = await fetch(mainUrl, { headers: matchscorerHeaders })
  if (!mainResp.ok) {
    throw new Error(`Failed to fetch draw main page: ${mainResp.status}`)
  }

  const mainHtml = await mainResp.text()

  // Find nav links for draw categories
  // Pattern: /screen/draw/{code}/{drawCode}/{roundCount}?t=tol
  const navLinkRe =
    new RegExp(
      `/screen/draw/${escapeRegex(matchscorerCode)}/([A-Z]+)/(\\d+)\\?t=tol`,
      'g'
    )

  const drawPages: Array<{ drawCode: string; category: 'men' | 'women' }> = []
  const seen = new Set<string>()

  let linkMatch: RegExpExecArray | null
  while ((linkMatch = navLinkRe.exec(mainHtml)) !== null) {
    const drawCode = linkMatch[1]
    if (seen.has(drawCode)) continue
    seen.add(drawCode)

    // Skip qualifying
    if (drawCode === 'MQ' || drawCode === 'WQ') continue
    // MD = Men's Main Draw, WD = Women's Main Draw
    const category: 'men' | 'women' = drawCode.startsWith('W') ? 'women' : 'men'
    drawPages.push({ drawCode, category })
  }

  const allMatches: ParsedMatch[] = []

  for (const { drawCode, category } of drawPages) {
    // Re-find the round count for this drawCode
    const roundCountMatch = new RegExp(
      `/screen/draw/${escapeRegex(matchscorerCode)}/${drawCode}/(\\d+)\\?t=tol`
    ).exec(mainHtml)
    const roundCount = roundCountMatch ? roundCountMatch[1] : '1'

    const drawUrl = `${MATCHSCORER_WIDGET}/screen/draw/${matchscorerCode}/${drawCode}/${roundCount}?t=tol`
    const drawResp = await fetch(drawUrl, { headers: matchscorerHeaders })

    if (!drawResp.ok) continue

    const drawHtml = await drawResp.text()
    const parsed = parseDrawHtml(drawHtml, category)
    allMatches.push(...parsed)

    await delay(200)
  }

  return allMatches
}

/**
 * Fetch WP media item and return URL, preferring medium size thumbnail.
 */
export async function fetchMediaUrl(mediaId: number): Promise<string | null> {
  if (!mediaId) return null

  const url = `${FIP_WP_API}/media/${mediaId}`
  const resp = await fetch(url, { headers: DEFAULT_HEADERS })
  if (!resp.ok) return null

  const data = await resp.json()

  // Prefer medium size
  const sizes = data.media_details?.sizes
  if (sizes?.medium?.source_url) return sizes.medium.source_url
  if (sizes?.thumbnail?.source_url) return sizes.thumbnail.source_url
  if (data.source_url) return data.source_url

  return null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
