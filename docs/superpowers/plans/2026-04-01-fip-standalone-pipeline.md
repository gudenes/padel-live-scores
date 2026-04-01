# FIP Gold/Silver/Bronze Standalone Pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace padelapi.org as the data source for FIP Gold/Silver/Bronze tournaments using padelfip.com WordPress API + widget.matchscorerlive.com for draws/results.

**Architecture:** Two new cron routes (`fip-tournaments`, `fip-scores`) calling a shared scraper library (`fip-scraper.ts`). Completely independent from existing padelapi sync. Reuses existing DB tables, player-resolver, and ops-logger.

**Tech Stack:** Next.js 16 API routes, Supabase (PostgreSQL), HTML scraping with regex (no DOM parser), padelfip.com WordPress REST API, widget.matchscorerlive.com server-rendered HTML.

---

## Data Flow Discovery (validated 2026-04-01)

The actual data flow differs from the original spec's assumptions. Here's what was validated:

1. **padelfip.com WP API** — post type is `events` (NOT `fip_event`), taxonomy is `category-event`
   - Gold: `GET /wp-json/wp/v2/events?category-event=19`
   - Silver: `GET /wp-json/wp/v2/events?category-event=496`
   - Bronze: `GET /wp-json/wp/v2/events?category-event=497`
   - Returns: `id`, `title.rendered`, `slug`, `link`, `date`, `featured_media`, taxonomy term IDs for `country`, `gender`, `event-year`
   - ACF fields are empty — dates must be scraped from the event page HTML
   - Country codes are 3-letter ISO (e.g. `ROM`, `MEX`) via the `country` taxonomy

2. **padelfip.com event page HTML** — contains inline JS with matchscorer integration:
   - `const eventYear = "2025"; const eventID = "3301"; const totalday = 5;`
   - These build the matchscorerlive tournament code: `FIP-{year}-{id}`
   - Dates appear in text as `DD/MM/YYYY - DD/MM/YYYY` format

3. **widget.matchscorerlive.com** — server-rendered HTML, works with `Referer: https://www.padelfip.com/` header:
   - Draw: `GET /screen/draw/FIP-{year}-{id}?t=tol` — full bracket with all matches
   - Draw sub-pages: `GET /screen/draw/FIP-{year}-{id}/{drawCode}/{roundCount}?t=tol`
     - Draw codes: `MD` (Men's Main Draw), `MQ` (Men's Qualifying), `WD` (Women's Main Draw), `WQ` (Women's Qualifying)
   - OOP: `GET /screen/oopbyday/FIP-{year}-{id}/{day}?t=tol` — order of play by day
   - HTML structure per match:
     - Round: `<th class="round-name text-right"><small>Round of 32</small></th>`
     - Court: `<span class="court-name">PISTA CENTRAL</span>`
     - Player flag: `<img class="flags" src="/images/flags/ESP.jpg"/>`
     - Player name: `<span>J.</span><span class="">Castello Lopez</span>` (inside `div.player-names > div.double`)
     - Winner indicator: `div.ml-2.winner` class on winning team's names
     - Set scores: `<td class="set set-completed">6</td>` (lost sets have additional `set-lost` class)
     - Seed: `<small class="separator">(1)</small>` or `<small>(1)</small>`
     - Match status: `scorebox-header-completed` class on header row

4. **matchscorerlive.com** (main site) returns 403 — only the widget subdomain works.

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/fip-scraper.ts` (NEW) | All scraping logic: WP API calls, event page parsing, matchscorerlive HTML parsing |
| `src/lib/__tests__/fip-scraper.test.ts` (NEW) | Unit tests for parsing logic (pure functions, no HTTP) |
| `src/app/api/cron/fip-tournaments/route.ts` (NEW) | Cron handler: tournament discovery + metadata |
| `src/app/api/cron/fip-scores/route.ts` (NEW) | Cron handler: match result scraping |
| `src/app/api/cron/sync/route.ts` (MODIFY) | Add filter to skip Gold/Silver/Bronze |
| `src/app/api/cron/scores/route.ts` (MODIFY) | Add filter to skip Gold/Silver/Bronze matches |
| `src/app/ops/api/status/route.ts` (MODIFY) | Add FIP cron sources to health check |
| `vercel.json` (MODIFY) | Add two new cron schedules |
| `supabase/migrations/` (NEW) | Add source, fip_slug, matchscorer_url columns to tournaments |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260401000000_add_fip_tournament_columns.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add columns to support FIP standalone pipeline
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'padelapi';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS fip_slug TEXT;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS matchscorer_url TEXT;

-- Index for efficient filtering by source
CREATE INDEX IF NOT EXISTS idx_tournaments_source ON tournaments (source);

COMMENT ON COLUMN tournaments.source IS 'Data pipeline source: padelapi or fip';
COMMENT ON COLUMN tournaments.fip_slug IS 'padelfip.com event slug for URL construction';
COMMENT ON COLUMN tournaments.matchscorer_url IS 'widget.matchscorerlive.com draw URL pattern (e.g. FIP-2025-3301)';
```

- [ ] **Step 2: Run migration via Supabase dashboard**

Copy the SQL above and execute it in the Supabase SQL Editor. Verify the columns exist:

```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'tournaments' AND column_name IN ('source', 'fip_slug', 'matchscorer_url');
```

Expected: 3 rows showing the new columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260401000000_add_fip_tournament_columns.sql
git commit -m "feat: add FIP pipeline columns to tournaments table"
```

---

### Task 2: FIP Scraper — WP API Tournament Parsing

**Files:**
- Create: `src/lib/fip-scraper.ts`
- Create: `src/lib/__tests__/fip-scraper.test.ts`

This task implements the pure parsing functions and the WP API fetcher for tournaments.

- [ ] **Step 1: Write failing tests for WP API response parsing**

```typescript
// src/lib/__tests__/fip-scraper.test.ts
import { describe, it, expect } from 'vitest'
import {
  parseWpEvent,
  parseEventDates,
  parseMatchscorerIds,
  parseDrawHtml,
} from '@/lib/fip-scraper'

describe('parseWpEvent', () => {
  it('extracts tournament metadata from WP API response', () => {
    const wpEvent = {
      id: 293025,
      title: { rendered: 'FIP GOLD BUCHAREST' },
      slug: 'fip-gold-bucharest',
      link: 'https://www.padelfip.com/events/fip-gold-bucharest/',
      date: '2026-01-30T10:49:51',
      featured_media: 12345,
      'category-event': [19],
      country: [210],
      gender: [37, 36],
      'event-year': [705],
    }

    const result = parseWpEvent(wpEvent)

    expect(result).toEqual({
      wpId: 293025,
      name: 'FIP GOLD BUCHAREST',
      slug: 'fip-gold-bucharest',
      link: 'https://www.padelfip.com/events/fip-gold-bucharest/',
      featuredMediaId: 12345,
      categoryIds: [19],
      countryTermIds: [210],
      genderTermIds: [37, 36],
      level: 'Gold',
    })
  })

  it('maps category ID 496 to Silver', () => {
    const wpEvent = {
      id: 1,
      title: { rendered: 'Test' },
      slug: 'test',
      link: '',
      date: '',
      featured_media: 0,
      'category-event': [496],
      country: [],
      gender: [],
      'event-year': [],
    }
    expect(parseWpEvent(wpEvent).level).toBe('Silver')
  })

  it('maps category ID 497 to Bronze', () => {
    const wpEvent = {
      id: 1,
      title: { rendered: 'Test' },
      slug: 'test',
      link: '',
      date: '',
      featured_media: 0,
      'category-event': [497],
      country: [],
      gender: [],
      'event-year': [],
    }
    expect(parseWpEvent(wpEvent).level).toBe('Bronze')
  })
})

describe('parseEventDates', () => {
  it('extracts start and end dates from event page HTML', () => {
    const html = `
      <div class="event-header">
        <span>Bucharest - Romania | 07/09/2026 - 13/09/2026</span>
      </div>
    `
    const result = parseEventDates(html)
    expect(result).toEqual({
      startsAt: '2026-09-07',
      endsAt: '2026-09-13',
    })
  })

  it('returns null for pages with no date pattern', () => {
    const result = parseEventDates('<div>No dates here</div>')
    expect(result).toEqual({ startsAt: null, endsAt: null })
  })
})

describe('parseMatchscorerIds', () => {
  it('extracts eventYear and eventID from inline JS', () => {
    const html = `
      <script>
        const eventYear = "2025";
        const eventID   = "3301";
        const day       = 5;
        const totalday  = 5;
      </script>
    `
    const result = parseMatchscorerIds(html)
    expect(result).toEqual({
      year: '2025',
      id: '3301',
      totalDays: 5,
      code: 'FIP-2025-3301',
    })
  })

  it('returns null when JS variables not found', () => {
    const result = parseMatchscorerIds('<div>No JS here</div>')
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/fip-scraper.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the parsing functions**

```typescript
// src/lib/fip-scraper.ts
// FIP Gold/Silver/Bronze standalone pipeline scraper.
// Handles padelfip.com WP API + widget.matchscorerlive.com HTML parsing.

// ── Constants ─────────────────────────────────────────────────────

export const FIP_WP_BASE = 'https://www.padelfip.com'
export const FIP_WP_API = `${FIP_WP_BASE}/wp-json/wp/v2`
export const MATCHSCORER_WIDGET = 'https://widget.matchscorerlive.com'

/** Category-event taxonomy IDs on padelfip.com */
export const FIP_CATEGORY_IDS: Record<string, number> = {
  Gold: 19,
  Silver: 496,
  Bronze: 497,
}

const CATEGORY_ID_TO_LEVEL: Record<number, string> = {
  19: 'Gold',
  496: 'Silver',
  497: 'Bronze',
}

/** Polite delay between HTTP requests (ms) */
const REQUEST_DELAY_MS = 200

// ── Types ─────────────────────────────────────────────────────────

export interface FipTournament {
  wpId: number
  name: string
  slug: string
  link: string
  featuredMediaId: number
  categoryIds: number[]
  countryTermIds: number[]
  genderTermIds: number[]
  level: string
}

export interface EventDates {
  startsAt: string | null  // ISO date YYYY-MM-DD
  endsAt: string | null    // ISO date YYYY-MM-DD
}

export interface MatchscorerIds {
  year: string
  id: string
  totalDays: number
  code: string  // e.g. "FIP-2025-3301"
}

export interface ParsedMatch {
  round: string               // e.g. "Round of 32", "Quarterfinals", "Final"
  court: string | null
  category: 'men' | 'women'
  status: 'scheduled' | 'finished'
  team1: ParsedTeam
  team2: ParsedTeam
  sets: ParsedSet[]
  winnerTeam: 1 | 2 | null
}

export interface ParsedTeam {
  player1: { firstName: string; lastName: string; country: string | null; seed: number | null }
  player2: { firstName: string; lastName: string; country: string | null; seed: number | null }
}

export interface ParsedSet {
  setNumber: number
  team1Games: number
  team2Games: number
}

// ── WP API Response Parsing ───────────────────────────────────────

export function parseWpEvent(event: any): FipTournament {
  const categoryIds: number[] = event['category-event'] ?? []
  const level = categoryIds
    .map(id => CATEGORY_ID_TO_LEVEL[id])
    .find(l => l != null) ?? 'unknown'

  return {
    wpId: event.id,
    name: (event.title?.rendered ?? 'Unknown').replace(/&#8211;/g, '–').replace(/&amp;/g, '&'),
    slug: event.slug,
    link: event.link,
    featuredMediaId: event.featured_media ?? 0,
    categoryIds,
    countryTermIds: event.country ?? [],
    genderTermIds: event.gender ?? [],
    level,
  }
}

// ── Event Page HTML Parsing ───────────────────────────────────────

/**
 * Extract tournament start/end dates from padelfip.com event page HTML.
 * Dates appear as DD/MM/YYYY - DD/MM/YYYY in the page text.
 */
export function parseEventDates(html: string): EventDates {
  const match = html.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{2})\/(\d{2})\/(\d{4})/)
  if (!match) return { startsAt: null, endsAt: null }

  const [, sd, sm, sy, ed, em, ey] = match
  return {
    startsAt: `${sy}-${sm}-${sd}`,
    endsAt: `${ey}-${em}-${ed}`,
  }
}

/**
 * Extract matchscorerlive event year + ID from inline JavaScript.
 * Looks for: const eventYear = "2025"; const eventID = "3301";
 */
export function parseMatchscorerIds(html: string): MatchscorerIds | null {
  const yearMatch = html.match(/const\s+eventYear\s*=\s*"(\d{4})"/)
  const idMatch = html.match(/const\s+eventID\s*=\s*"(\d+)"/)
  const totalDayMatch = html.match(/const\s+totalday\s*=\s*(\d+)/)

  if (!yearMatch || !idMatch) return null

  const year = yearMatch[1]
  const id = idMatch[1]
  return {
    year,
    id,
    totalDays: totalDayMatch ? parseInt(totalDayMatch[1], 10) : 1,
    code: `FIP-${year}-${id}`,
  }
}

// ── Matchscorerlive Draw HTML Parsing ─────────────────────────────

/**
 * Parse the draw page HTML from widget.matchscorerlive.com.
 * Extracts all matches with player names, scores, rounds.
 *
 * The draw page lists draw categories (MD, MQ, WD, WQ) as navigation links.
 * Each draw sub-page contains <table> elements per match with:
 * - scorebox-header-completed: round name + court
 * - player-names > double: two players per team
 * - set set-completed: set scores
 * - winner class: on winning team's player names
 */
export function parseDrawHtml(html: string, category: 'men' | 'women'): ParsedMatch[] {
  const matches: ParsedMatch[] = []

  // Split by match tables — each match is a <table class="w-100"> block
  // containing scorebox-header and two team rows
  const tableRegex = /<table\s+class="w-100[^"]*">([\s\S]*?)<\/table>/g
  let tableMatch: RegExpExecArray | null

  while ((tableMatch = tableRegex.exec(html)) !== null) {
    const tableHtml = tableMatch[1]

    // Skip tables without scorebox-header (navigation, etc.)
    if (!tableHtml.includes('scorebox-header')) continue

    const parsed = parseMatchTable(tableHtml, category)
    if (parsed) matches.push(parsed)
  }

  return matches
}

function parseMatchTable(tableHtml: string, category: 'men' | 'women'): ParsedMatch | null {
  // Extract round name
  const roundMatch = tableHtml.match(/class="round-name[^"]*"[^>]*>\s*(?:<small[^>]*>)?\s*(.*?)\s*(?:<\/small>)?\s*<\/th>/i)
  const round = roundMatch ? cleanHtml(roundMatch[1]).trim() : 'unknown'

  // Extract court
  const courtMatch = tableHtml.match(/class="court-name"[^>]*>\s*(?:<span>)?(.*?)(?:<\/span>)?\s*<\/span>/i)
  const court = courtMatch ? cleanHtml(courtMatch[1]).trim() : null

  // Determine if match is completed
  const isCompleted = tableHtml.includes('scorebox-header-completed')

  // Extract teams — split by Team 1 / Team 2 comments or draw-item-container/scorebox-sep-bottom rows
  const teamBlocks = tableHtml.split(/<!--\s*Team\s*2\s*-->/)
  if (teamBlocks.length < 2) {
    // Try splitting by the two draw-item-container or scorebox-sep-bottom rows
    const rowRegex = /<tr\s+class="(?:draw-item-container|scorebox-sep-bottom)">([\s\S]*?)<\/tr>/g
    const rows: string[] = []
    let rowMatch: RegExpExecArray | null
    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      rows.push(rowMatch[1])
    }
    if (rows.length < 2) return null

    const team1 = parseTeamBlock(rows[0])
    const team2 = parseTeamBlock(rows[1])
    if (!team1 || !team2) return null

    const sets1 = parseSets(rows[0])
    const sets2 = parseSets(rows[1])
    const hasWinner = rows[0].includes('class="ml-2 winner') || rows[0].includes('fa-check')
    const winnerTeam = hasWinner ? 1 : (rows[1].includes('class="ml-2 winner') || rows[1].includes('fa-check') ? 2 : null)

    return buildMatch(round, court, category, isCompleted, team1, team2, sets1, sets2, winnerTeam)
  }

  const team1Block = teamBlocks[0]
  const team2Block = teamBlocks[1]

  const team1 = parseTeamBlock(team1Block)
  const team2 = parseTeamBlock(team2Block)
  if (!team1 || !team2) return null

  const sets1 = parseSets(team1Block)
  const sets2 = parseSets(team2Block)
  const hasWinner = team1Block.includes('class="ml-2 winner') || team1Block.includes('fa-check')
  const winnerTeam = hasWinner ? 1 : (team2Block.includes('class="ml-2 winner') || team2Block.includes('fa-check') ? 2 : null)

  return buildMatch(round, court, category, isCompleted, team1, team2, sets1, sets2, winnerTeam)
}

function buildMatch(
  round: string, court: string | null, category: 'men' | 'women',
  isCompleted: boolean, team1: ParsedTeam, team2: ParsedTeam,
  sets1: number[], sets2: number[], winnerTeam: 1 | 2 | null
): ParsedMatch {
  const sets: ParsedSet[] = []
  const maxSets = Math.max(sets1.length, sets2.length)
  for (let i = 0; i < maxSets; i++) {
    if ((sets1[i] ?? 0) === 0 && (sets2[i] ?? 0) === 0) continue
    sets.push({
      setNumber: i + 1,
      team1Games: sets1[i] ?? 0,
      team2Games: sets2[i] ?? 0,
    })
  }

  return {
    round,
    court,
    category,
    status: isCompleted && sets.length > 0 ? 'finished' : 'scheduled',
    team1,
    team2,
    sets,
    winnerTeam,
  }
}

function parseTeamBlock(html: string): ParsedTeam | null {
  // Find player name blocks: <span>J.</span><span class="">Castello Lopez</span>
  const playerRegex = /<div\s+class="d-flex align-items-center">\s*<div>\s*(?:<img[^>]*src="\/images\/flags\/([A-Z]{2,3})\.jpg"[^>]*\/>)?\s*<\/div>\s*<div\s+class="ml-2[^"]*">\s*<span>([^<]*)<\/span>\s*<span[^>]*>([^<]*)<\/span>\s*(?:<small[^>]*>\((\d+)\)<\/small>)?\s*<\/div>/g

  const players: Array<{ firstName: string; lastName: string; country: string | null; seed: number | null }> = []
  let m: RegExpExecArray | null

  while ((m = playerRegex.exec(html)) !== null) {
    players.push({
      firstName: m[2].trim(),
      lastName: m[3].trim(),
      country: m[1] ?? null,
      seed: m[4] ? parseInt(m[4], 10) : null,
    })
  }

  if (players.length < 2) return null

  return {
    player1: players[0],
    player2: players[1],
  }
}

function parseSets(html: string): number[] {
  // Find set score cells: <td class="set set-completed">6</td> or <td class="set set-completed set-lost">3</td>
  const setRegex = /<td\s+class="set\s+set-completed[^"]*">\s*(\d+)\s*<\/td>/g
  const scores: number[] = []
  let m: RegExpExecArray | null

  while ((m = setRegex.exec(html)) !== null) {
    scores.push(parseInt(m[1], 10))
  }

  return scores
}

function cleanHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&#\d+;/g, '')
    .replace(/&[a-z]+;/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── HTTP Fetchers ─────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Fetch FIP Gold/Silver/Bronze events from WP API.
 * Returns parsed tournament metadata for all three categories.
 */
export async function fetchFipEvents(level?: string): Promise<FipTournament[]> {
  const levels = level ? [level] : ['Gold', 'Silver', 'Bronze']
  const allEvents: FipTournament[] = []

  for (const lvl of levels) {
    const categoryId = FIP_CATEGORY_IDS[lvl]
    if (!categoryId) continue

    let page = 1
    let hasMore = true

    while (hasMore) {
      const url = `${FIP_WP_API}/events?category-event=${categoryId}&per_page=20&page=${page}&_fields=id,title,slug,link,featured_media,category-event,country,gender,event-year`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'padel-nacho/1.0' },
        signal: AbortSignal.timeout(10000),
      })

      if (!res.ok) {
        console.warn(`[FIP Scraper] WP API error ${res.status} for ${lvl} page ${page}`)
        break
      }

      const events: any[] = await res.json()
      allEvents.push(...events.map(parseWpEvent))

      // WP pagination: check X-WP-TotalPages header
      const totalPages = parseInt(res.headers.get('X-WP-TotalPages') ?? '1', 10)
      hasMore = page < totalPages
      page++

      await delay(REQUEST_DELAY_MS)
    }
  }

  return allEvents
}

/**
 * Fetch a padelfip.com event page and extract dates + matchscorer IDs.
 * Requires the event slug (e.g. "fip-gold-bucharest").
 */
export async function fetchEventPageData(slug: string): Promise<{
  dates: EventDates
  matchscorer: MatchscorerIds | null
}> {
  const url = `${FIP_WP_BASE}/events/${slug}/`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'padel-nacho/1.0' },
    signal: AbortSignal.timeout(15000),
  })

  if (!res.ok) {
    console.warn(`[FIP Scraper] Event page fetch failed: ${res.status} for ${slug}`)
    return { dates: { startsAt: null, endsAt: null }, matchscorer: null }
  }

  const html = await res.text()
  return {
    dates: parseEventDates(html),
    matchscorer: parseMatchscorerIds(html),
  }
}

/**
 * Resolve WP country term IDs to 3-letter ISO country codes.
 * Fetches the country taxonomy once and caches it.
 */
let _countryCache: Map<number, string> | null = null

export async function resolveCountryTerms(termIds: number[]): Promise<string | null> {
  if (termIds.length === 0) return null

  if (!_countryCache) {
    _countryCache = new Map()
    let page = 1
    let hasMore = true

    while (hasMore) {
      const url = `${FIP_WP_API}/country?per_page=100&page=${page}&_fields=id,name`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'padel-nacho/1.0' },
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) break

      const terms: Array<{ id: number; name: string }> = await res.json()
      for (const t of terms) _countryCache.set(t.id, t.name)

      const totalPages = parseInt(res.headers.get('X-WP-TotalPages') ?? '1', 10)
      hasMore = page < totalPages
      page++
    }
  }

  // Return first matching country code
  for (const id of termIds) {
    const code = _countryCache.get(id)
    if (code) return code
  }
  return null
}

/**
 * Fetch the draw page from widget.matchscorerlive.com and parse matches.
 * The main draw page lists all draw categories; we fetch each sub-page.
 */
export async function fetchDrawMatches(matchscorerCode: string): Promise<ParsedMatch[]> {
  const allMatches: ParsedMatch[] = []

  // Fetch the main draw page to discover available draw categories
  const mainUrl = `${MATCHSCORER_WIDGET}/screen/draw/${matchscorerCode}?t=tol`
  const mainRes = await fetch(mainUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      'Referer': 'https://www.padelfip.com/',
    },
    signal: AbortSignal.timeout(15000),
  })

  if (!mainRes.ok) {
    console.warn(`[FIP Scraper] Draw page fetch failed: ${mainRes.status} for ${matchscorerCode}`)
    return []
  }

  const mainHtml = await mainRes.text()

  // Extract draw category links: /screen/draw/FIP-2025-3301/MD/5?t=tol
  const drawLinkRegex = /href="\/screen\/draw\/[^/]+\/([A-Z]{2})\/(\d+)\?t=tol"/g
  const drawCategories: Array<{ code: string; roundCount: string; category: 'men' | 'women' }> = []
  let linkMatch: RegExpExecArray | null

  while ((linkMatch = drawLinkRegex.exec(mainHtml)) !== null) {
    const code = linkMatch[1]
    const roundCount = linkMatch[2]
    const category: 'men' | 'women' = code.startsWith('W') ? 'women' : 'men'
    // Only main draws (MD, WD), skip qualifying (MQ, WQ) for now
    if (code === 'MD' || code === 'WD') {
      drawCategories.push({ code, roundCount, category })
    }
  }

  // Also parse the main page itself (it defaults to the first draw category)
  // Determine what category the main page shows
  const firstActiveLink = mainHtml.match(/page-item draw-type active[\s\S]*?href="\/screen\/draw\/[^/]+\/([A-Z]{2})/)
  const mainCategory: 'men' | 'women' = firstActiveLink?.[1]?.startsWith('W') ? 'women' : 'men'
  const mainMatches = parseDrawHtml(mainHtml, mainCategory)
  allMatches.push(...mainMatches)

  // Fetch additional draw category pages (skip the one already loaded)
  const loadedCode = firstActiveLink?.[1] ?? 'MD'
  for (const dc of drawCategories) {
    if (dc.code === loadedCode) continue

    await delay(REQUEST_DELAY_MS)

    const subUrl = `${MATCHSCORER_WIDGET}/screen/draw/${matchscorerCode}/${dc.code}/${dc.roundCount}?t=tol`
    try {
      const subRes = await fetch(subUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Referer': 'https://www.padelfip.com/',
        },
        signal: AbortSignal.timeout(15000),
      })

      if (subRes.ok) {
        const subHtml = await subRes.text()
        allMatches.push(...parseDrawHtml(subHtml, dc.category))
      }
    } catch (e) {
      console.warn(`[FIP Scraper] Failed to fetch draw ${dc.code} for ${matchscorerCode}:`, e)
    }
  }

  return allMatches
}

/**
 * Fetch featured media URL from WP API (tournament logo).
 */
export async function fetchMediaUrl(mediaId: number): Promise<string | null> {
  if (!mediaId) return null

  try {
    const url = `${FIP_WP_API}/media/${mediaId}?_fields=source_url,media_details`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'padel-nacho/1.0' },
      signal: AbortSignal.timeout(10000),
    })
    if (!res.ok) return null

    const media = await res.json()
    return media.media_details?.sizes?.medium?.source_url
      ?? media.media_details?.sizes?.thumbnail?.source_url
      ?? media.source_url
      ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/fip-scraper.test.ts`
Expected: PASS for parseWpEvent, parseEventDates, parseMatchscorerIds tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/fip-scraper.ts src/lib/__tests__/fip-scraper.test.ts
git commit -m "feat: add FIP scraper with WP API + matchscorerlive parsers"
```

---

### Task 3: FIP Scraper — Draw HTML Parsing Tests

**Files:**
- Modify: `src/lib/__tests__/fip-scraper.test.ts`

Add tests for the draw HTML parsing using realistic HTML snippets from widget.matchscorerlive.com.

- [ ] **Step 1: Add draw parsing tests**

Append to `src/lib/__tests__/fip-scraper.test.ts`:

```typescript
describe('parseDrawHtml', () => {
  it('parses a completed match with two teams and set scores', () => {
    const html = `
      <table class="w-100">
        <tr class="scorebox-header-completed">
          <th colspan="1"><span class="court-name"><span>PISTA CENTRAL</span></span></th>
          <th colspan="4" class="round-name text-right"><small>Final</small></th>
        </tr>
        <!-- Team 1 -->
        <tr class="scorebox-sep-bottom">
          <td class="team" colspan="4">
            <div class="d-flex justify-content-between align-items-center ml-2">
              <div>
                <div class="player-names">
                  <div class="double">
                    <div class="d-flex align-items-center">
                      <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
                      <div class="ml-2 winner line-thin"><span>J.</span><span class="">Castello Lopez</span></div>
                    </div>
                    <div class="d-flex align-items-center">
                      <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
                      <div class="ml-2 winner line-thin"><span>L.</span><span class="">Rufo Ortiz</span><small>(1)</small></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
            </div>
          </td>
          <td></td>
          <td class="set set-completed ">6</td>
          <td class="set set-completed ">6</td>
          <td class="set set-lost ">-</td>
        </tr>
        <!-- Team 2 -->
        <tr>
          <td class="team" colspan="4">
            <div class="d-flex justify-content-between align-items-center ml-2">
              <div>
                <div class="player-names">
                  <div class="double">
                    <div class="d-flex align-items-center">
                      <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
                      <div class="ml-2  line-thin"><span>R.</span><span class="">Eugenio Barrera</span></div>
                    </div>
                    <div class="d-flex align-items-center">
                      <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
                      <div class="ml-2  line-thin"><span>J.</span><span class="">Velasco Postiguillo</span><small>(2)</small></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="mr-2"></div>
            </div>
          </td>
          <td></td>
          <td class="set set-completed set-lost">3</td>
          <td class="set set-completed set-lost">2</td>
          <td class="set set-lost ">-</td>
        </tr>
        <tr class="summary"><td colspan="8"><div class="live-status-summary"><span class="text-uppercase">Completed</span></div></td></tr>
      </table>
    `

    const matches = parseDrawHtml(html, 'women')
    expect(matches).toHaveLength(1)

    const match = matches[0]
    expect(match.round).toBe('Final')
    expect(match.court).toBe('PISTA CENTRAL')
    expect(match.category).toBe('women')
    expect(match.status).toBe('finished')
    expect(match.winnerTeam).toBe(1)

    expect(match.team1.player1.firstName).toBe('J.')
    expect(match.team1.player1.lastName).toBe('Castello Lopez')
    expect(match.team1.player1.country).toBe('ESP')
    expect(match.team1.player2.lastName).toBe('Rufo Ortiz')
    expect(match.team1.player2.seed).toBe(1)

    expect(match.team2.player1.lastName).toBe('Eugenio Barrera')
    expect(match.team2.player2.seed).toBe(2)

    expect(match.sets).toEqual([
      { setNumber: 1, team1Games: 6, team2Games: 3 },
      { setNumber: 2, team1Games: 6, team2Games: 2 },
    ])
  })

  it('parses a match from the draw bracket with draw-item-container rows', () => {
    const html = `
      <table class="w-100">
        <tr class="scorebox-header-completed">
          <th colspan="1"><span class="court-name"><span>CLUB, BMW</span></span></th>
          <th colspan="4" class="round-name text-right"><small class="">Round of 32</small></th>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div class="d-flex justify-content-between align-items-center ml-2">
              <div>
                <div class="player-names">
                  <div class="double">
                    <div class="d-flex align-items-center">
                      <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
                      <div class="ml-2  line-thin"><span>I.</span><span class="">Sager</span></div>
                    </div>
                    <div class="d-flex align-items-center">
                      <div><img class="flags" src="/images/flags/ESP.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
                      <div class="ml-2  line-thin"><span>M.</span><span class="">Ortega</span><small class="separator">(1)</small></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="mr-2"></div>
            </div>
          </td>
          <td></td>
          <td class="set set-completed set-lost">3</td>
          <td class="set set-completed set-lost">4</td>
          <td class="set set-lost ">-</td>
        </tr>
        <tr class="draw-item-container">
          <td class="team">
            <div class="d-flex justify-content-between align-items-center ml-2">
              <div>
                <div class="player-names">
                  <div class="double">
                    <div class="d-flex align-items-center">
                      <div><img class="flags" src="/images/flags/ARG.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
                      <div class="ml-2 winner line-thin"><span>F.</span><span class="">Gonzalez</span></div>
                    </div>
                    <div class="d-flex align-items-center">
                      <div><img class="flags" src="/images/flags/ARG.jpg" style="box-shadow: 0px 0px 2px 2px rgba(0, 0, 0, 0.2);"/></div>
                      <div class="ml-2 winner line-thin"><span>P.</span><span class="">Martinez</span></div>
                    </div>
                  </div>
                </div>
              </div>
              <div class="mr-2"><i class='fa-solid fa-check check-primary'></i></div>
            </div>
          </td>
          <td></td>
          <td class="set set-completed ">6</td>
          <td class="set set-completed ">6</td>
          <td class="set set-lost ">-</td>
        </tr>
      </table>
    `

    const matches = parseDrawHtml(html, 'men')
    expect(matches).toHaveLength(1)

    const match = matches[0]
    expect(match.round).toBe('Round of 32')
    expect(match.winnerTeam).toBe(2)
    expect(match.team1.player1.lastName).toBe('Sager')
    expect(match.team1.player2.seed).toBe(1)
    expect(match.team2.player1.country).toBe('ARG')
    expect(match.sets).toEqual([
      { setNumber: 1, team1Games: 3, team2Games: 6 },
      { setNumber: 2, team1Games: 4, team2Games: 6 },
    ])
  })
})
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run src/lib/__tests__/fip-scraper.test.ts`
Expected: All tests PASS

- [ ] **Step 3: Fix any parsing issues and re-run tests**

If tests fail, adjust the regex patterns in `parseMatchTable`, `parseTeamBlock`, or `parseSets` to match the actual HTML structure. Common issues:
- Whitespace variations in HTML attributes
- Missing closing tags or extra nesting
- Regex greediness (use `[\s\S]*?` not `.*`)

- [ ] **Step 4: Commit**

```bash
git add src/lib/__tests__/fip-scraper.test.ts
git commit -m "test: add draw HTML parsing tests for FIP scraper"
```

---

### Task 4: FIP Tournaments Cron Route

**Files:**
- Create: `src/app/api/cron/fip-tournaments/route.ts`

- [ ] **Step 1: Implement the cron route**

```typescript
// src/app/api/cron/fip-tournaments/route.ts
// FIP Tournament Discovery — syncs Gold/Silver/Bronze tournaments from padelfip.com
// Schedule: every 12 hours (vercel.json)

import { createClient } from '@supabase/supabase-js'
import { logOpsEvent } from '@/lib/ops-logger'
import {
  fetchFipEvents,
  fetchEventPageData,
  fetchMediaUrl,
  resolveCountryTerms,
} from '@/lib/fip-scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await logOpsEvent('cron:fip-tournaments', async () => {
      console.log('[FIP Tournaments] Starting sync...')

      const events = await fetchFipEvents()
      console.log(`[FIP Tournaments] Found ${events.length} events from WP API`)

      let upserted = 0
      let enriched = 0
      let errors = 0

      for (const event of events) {
        try {
          // Check if tournament already exists with full data
          const { data: existing } = await supabase
            .from('tournaments')
            .select('id, starts_at, matchscorer_url, logo_url')
            .eq('fip_slug', event.slug)
            .single()

          // Resolve country from WP taxonomy
          const country = await resolveCountryTerms(event.countryTermIds)

          // Build upsert data
          const tournamentData: Record<string, any> = {
            name: event.name,
            level: event.level,
            country: country ?? null,
            source: 'fip',
            fip_slug: event.slug,
            url: event.link,
            updated_at: new Date().toISOString(),
          }

          // Fetch event page for dates + matchscorer ID (only if missing)
          const needsDates = !existing?.starts_at
          const needsMatchscorer = !existing?.matchscorer_url

          if (needsDates || needsMatchscorer) {
            const pageData = await fetchEventPageData(event.slug)

            if (pageData.dates.startsAt) {
              tournamentData.starts_at = pageData.dates.startsAt
              tournamentData.ends_at = pageData.dates.endsAt
            }

            if (pageData.matchscorer) {
              tournamentData.matchscorer_url = pageData.matchscorer.code
              console.log(`[FIP Tournaments] Matchscorer code for ${event.name}: ${pageData.matchscorer.code}`)
            }

            enriched++
          }

          // Fetch logo if needed
          if (!existing?.logo_url && event.featuredMediaId) {
            const logoUrl = await fetchMediaUrl(event.featuredMediaId)
            if (logoUrl) tournamentData.logo_url = logoUrl
          }

          if (existing) {
            // Update existing
            const { error } = await supabase
              .from('tournaments')
              .update(tournamentData)
              .eq('id', existing.id)
            if (error) throw error
          } else {
            // Insert new — use slug as external_id for FIP tournaments
            tournamentData.external_id = `fip-${event.slug}`
            const { error } = await supabase
              .from('tournaments')
              .upsert(tournamentData, { onConflict: 'external_id' })
            if (error) throw error
          }

          upserted++
        } catch (e) {
          console.error(`[FIP Tournaments] Failed to upsert ${event.name}:`, e)
          errors++
        }
      }

      console.log(`[FIP Tournaments] Done. Upserted: ${upserted}, Enriched: ${enriched}, Errors: ${errors}`)

      return {
        total_events: events.length,
        upserted,
        enriched,
        errors,
      }
    })

    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error('[FIP Tournaments] Fatal error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Test locally**

Run: `curl -s http://localhost:3002/api/cron/fip-tournaments | python3 -m json.tool`
Expected: JSON response with `total_events > 0`, `upserted > 0`

- [ ] **Step 3: Verify data in Supabase**

Check that tournaments table has new rows with `source = 'fip'`, `fip_slug` populated, and `matchscorer_url` for tournaments with published draws.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/fip-tournaments/route.ts
git commit -m "feat: add FIP tournaments cron — discover Gold/Silver/Bronze from padelfip.com"
```

---

### Task 5: FIP Scores Cron Route

**Files:**
- Create: `src/app/api/cron/fip-scores/route.ts`

- [ ] **Step 1: Implement the cron route**

```typescript
// src/app/api/cron/fip-scores/route.ts
// FIP Score Scraper — fetches match results from matchscorerlive.com for active FIP tournaments
// Schedule: every 2 hours (vercel.json)

import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '@/lib/player-resolver'
import { logOpsEvent } from '@/lib/ops-logger'
import { fetchDrawMatches, type ParsedMatch } from '@/lib/fip-scraper'
import { inferWinnerPair } from '@/lib/score-inference'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Round name normalization ──────────────────────────────────────
// matchscorerlive uses names like "Round of 32", "Quarterfinals", etc.
// Normalize to the format used in our DB (matching padelapi conventions)
function normalizeRound(round: string): string {
  const r = round.toLowerCase().trim()
  if (r.includes('final') && !r.includes('quarter') && !r.includes('semi')) return 'F'
  if (r.includes('semi')) return 'SF'
  if (r.includes('quarter')) return 'QF'
  if (r.includes('16') || r.includes('r16')) return 'R16'
  if (r.includes('32') || r.includes('r32')) return 'R32'
  if (r.includes('64') || r.includes('r64')) return 'R64'
  return round  // Return as-is if no match
}

// ── 3-letter to 2-letter ISO country code mapping ─────────────────
// matchscorerlive uses 3-letter codes (ESP, ARG), DB uses 2-letter (ES, AR)
const ISO3_TO_ISO2: Record<string, string> = {
  ESP: 'ES', ARG: 'AR', BRA: 'BR', MEX: 'MX', FRA: 'FR', ITA: 'IT',
  POR: 'PT', GER: 'DE', GBR: 'GB', USA: 'US', CHI: 'CL', COL: 'CO',
  URU: 'UY', PAR: 'PY', BOL: 'BO', PER: 'PE', ECU: 'EC', VEN: 'VE',
  BEL: 'BE', NED: 'NL', SWE: 'SE', NOR: 'NO', DEN: 'DK', FIN: 'FI',
  SUI: 'CH', AUT: 'AT', POL: 'PL', CZE: 'CZ', ROM: 'RO', GRE: 'GR',
  TUR: 'TR', ISR: 'IL', UAE: 'AE', KSA: 'SA', QAT: 'QA', HKG: 'HK',
  JPN: 'JP', AUS: 'AU', RSA: 'ZA', MAR: 'MA', EGY: 'EG', KAZ: 'KZ',
  CAN: 'CA', IRL: 'IE', CRO: 'HR', SRB: 'RS', UKR: 'UA', HUN: 'HU',
  SLO: 'SI', SVK: 'SK', BUL: 'BG', LTU: 'LT', LAT: 'LV', EST: 'EE',
  CYP: 'CY', MLT: 'MT', LUX: 'LU', ISL: 'IS', AND: 'AD', MON: 'MC',
  ALG: 'DZ', TUN: 'TN', SEN: 'SN', CIV: 'CI', CMR: 'CM', GHA: 'GH',
  NGA: 'NG', KEN: 'KE', SGP: 'SG', IND: 'IN', CHN: 'CN', KOR: 'KR',
  TWN: 'TW', THA: 'TH', IDN: 'ID', MAS: 'MY', PHI: 'PH', NZL: 'NZ',
  CRC: 'CR', PAN: 'PA', DOM: 'DO', CUB: 'CU', GTM: 'GT', HON: 'HN',
  ESA: 'SV', NCA: 'NI', JAM: 'JM', TTO: 'TT', GUY: 'GY', SUR: 'SR',
}

function toIso2(iso3: string | null): string | null {
  if (!iso3) return null
  return ISO3_TO_ISO2[iso3.toUpperCase()] ?? null
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  try {
    const result = await logOpsEvent('cron:fip-scores', async () => {
      console.log('[FIP Scores] Starting score sync...')

      // Find active FIP tournaments (between starts_at and ends_at + 1 day)
      const today = new Date().toISOString().slice(0, 10)
      const yesterday = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      const { data: tournaments } = await supabase
        .from('tournaments')
        .select('id, name, matchscorer_url, starts_at, ends_at, level')
        .eq('source', 'fip')
        .not('matchscorer_url', 'is', null)
        .lte('starts_at', today)
        .gte('ends_at', yesterday)

      if (!tournaments || tournaments.length === 0) {
        console.log('[FIP Scores] No active FIP tournaments')
        return { active_tournaments: 0, matches_upserted: 0, matches_skipped: 0 }
      }

      console.log(`[FIP Scores] ${tournaments.length} active tournament(s)`)

      const resolver = new PlayerResolver(supabase)
      await resolver.load()

      let totalUpserted = 0
      let totalSkipped = 0
      let totalErrors = 0

      for (const tournament of tournaments) {
        try {
          console.log(`[FIP Scores] Processing: ${tournament.name} (${tournament.matchscorer_url})`)

          const matches = await fetchDrawMatches(tournament.matchscorer_url)
          console.log(`[FIP Scores] Found ${matches.length} matches for ${tournament.name}`)

          for (const match of matches) {
            try {
              const result = await upsertFipMatch(match, tournament.id, resolver)
              if (result === 'upserted') totalUpserted++
              else totalSkipped++
            } catch (e) {
              console.error(`[FIP Scores] Failed to upsert match:`, e)
              totalErrors++
            }
          }
        } catch (e) {
          console.error(`[FIP Scores] Failed to process ${tournament.name}:`, e)
          totalErrors++
        }
      }

      console.log(`[FIP Scores] Done. Upserted: ${totalUpserted}, Skipped: ${totalSkipped}, Errors: ${totalErrors}`)

      return {
        active_tournaments: tournaments.length,
        matches_upserted: totalUpserted,
        matches_skipped: totalSkipped,
        errors: totalErrors,
      }
    })

    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error('[FIP Scores] Fatal error:', e)
    return Response.json({ error: String(e) }, { status: 500 })
  }
}

async function upsertFipMatch(
  match: ParsedMatch,
  tournamentId: string,
  resolver: PlayerResolver,
): Promise<'upserted' | 'skipped'> {
  // Build a deterministic external ID from the match data
  // Format: fip-{tournament_id}-{category}-{round}-{team1_p1_last}-{team2_p1_last}
  const externalId = buildMatchExternalId(tournamentId, match)

  // Check if match already exists and is fully resolved
  const { data: existing } = await supabase
    .from('matches')
    .select('id, status, winner_pair')
    .eq('external_id', externalId)
    .single()

  // Skip if already finished with winner
  if (existing?.status === 'finished' && existing.winner_pair !== null) {
    return 'skipped'
  }

  // Resolve all 4 players
  const [p1p1, p1p2, p2p1, p2p2] = await Promise.all([
    resolvePlayer(resolver, match.team1.player1, match.category),
    resolvePlayer(resolver, match.team1.player2, match.category),
    resolvePlayer(resolver, match.team2.player1, match.category),
    resolvePlayer(resolver, match.team2.player2, match.category),
  ])

  // Determine winner
  let winnerPair = match.winnerTeam
  if (!winnerPair && match.sets.length >= 2) {
    // Try to infer from set scores
    const setScores = match.sets.map(s => `${s.team1Games}-${s.team2Games}`)
    winnerPair = inferWinnerPair(setScores) as 1 | 2 | null
  }

  // Upsert match
  const matchData: Record<string, any> = {
    external_id: externalId,
    tournament_id: tournamentId,
    status: match.status,
    category: match.category,
    round: normalizeRound(match.round),
    court: match.court,
    winner_pair: winnerPair,
    pair1_player1_id: p1p1,
    pair1_player2_id: p1p2,
    pair2_player1_id: p2p1,
    pair2_player2_id: p2p2,
    coverage: null,
    pusher_channel: null,
    updated_at: new Date().toISOString(),
  }

  if (match.status === 'finished' && !existing) {
    matchData.finished_at = new Date().toISOString()
  }

  const { data: matchRow, error: matchError } = await supabase
    .from('matches')
    .upsert(matchData, { onConflict: 'external_id' })
    .select('id')
    .single()

  if (matchError || !matchRow) {
    throw new Error(`Failed to upsert match ${externalId}: ${matchError?.message}`)
  }

  // Upsert sets
  for (const set of match.sets) {
    const setScore = `${set.team1Games}-${set.team2Games}`
    await supabase
      .from('sets')
      .upsert(
        {
          match_id: matchRow.id,
          set_number: set.setNumber,
          set_score: setScore,
          pair1_games: set.team1Games,
          pair2_games: set.team2Games,
          is_current: false,
          score_source: 'fip',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'match_id, set_number' }
      )
  }

  return 'upserted'
}

function buildMatchExternalId(tournamentId: string, match: ParsedMatch): string {
  const cat = match.category === 'men' ? 'm' : 'w'
  const round = normalizeRound(match.round).toLowerCase()
  const t1 = match.team1.player1.lastName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)
  const t2 = match.team2.player1.lastName.toLowerCase().replace(/[^a-z]/g, '').slice(0, 10)
  return `fip-${tournamentId}-${cat}-${round}-${t1}-${t2}`
}

async function resolvePlayer(
  resolver: PlayerResolver,
  player: { firstName: string; lastName: string; country: string | null; seed: number | null },
  category: 'men' | 'women',
): Promise<string | null> {
  const fullName = `${player.firstName} ${player.lastName}`.trim()
  if (!fullName || fullName === '-') return null

  try {
    const { playerId } = await resolver.resolve({
      name: fullName,
      country: toIso2(player.country),
      category,
    })
    return playerId
  } catch (e) {
    console.error(`[FIP Scores] Failed to resolve player ${fullName}:`, e)
    return null
  }
}
```

- [ ] **Step 2: Test locally**

First ensure the `fip-tournaments` cron has run and populated some tournaments with `matchscorer_url`.

Run: `curl -s http://localhost:3002/api/cron/fip-scores | python3 -m json.tool`
Expected: JSON response. If no tournaments are active today, will show `active_tournaments: 0`. To test with data, temporarily adjust the date range filter.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/fip-scores/route.ts
git commit -m "feat: add FIP scores cron — scrape match results from matchscorerlive.com"
```

---

### Task 6: Filter Existing Crons to Skip Gold/Silver/Bronze

**Files:**
- Modify: `src/app/api/cron/sync/route.ts`
- Modify: `src/app/api/cron/scores/route.ts`

- [ ] **Step 1: Add filter to sync route**

In `src/app/api/cron/sync/route.ts`, modify the `syncTournaments` function. After the tournament list is fetched, filter out Gold/Silver/Bronze:

Find the loop at the start of `syncTournaments` (approximately line 366):
```typescript
    for (const t of tournaments) {
```

Add a filter before it:
```typescript
    // Skip Gold/Silver/Bronze — these are now handled by the FIP standalone pipeline
    const FIP_STANDALONE_LEVELS = ['Gold', 'Silver', 'Bronze']
    const filteredTournaments = tournaments.filter(
      (t: any) => !FIP_STANDALONE_LEVELS.includes(t.level)
    )

    for (const t of filteredTournaments) {
```

Also update the log message to reflect the filter:
```typescript
    console.log(`[Sync] Tournaments synced: ${syncedIds.length}/${filteredTournaments.length} (${tournaments.length - filteredTournaments.length} FIP standalone skipped)`)
```

Similarly, in the match sync section (approximately line 839), add a filter when fetching active tournaments:

Find:
```typescript
        const { data: activeTournaments } = await supabase
          .from('tournaments')
          .select('external_id, name')
          .lte('starts_at', today)
          .gte('ends_at', today)
          .limit(5)
```

Add `.not('source', 'eq', 'fip')` to each tournament query:
```typescript
        const { data: activeTournaments } = await supabase
          .from('tournaments')
          .select('external_id, name')
          .lte('starts_at', today)
          .gte('ends_at', today)
          .not('source', 'eq', 'fip')
          .limit(5)
```

Apply the same `.not('source', 'eq', 'fip')` filter to the `recentTournaments` and `upcomingTournaments` queries too.

- [ ] **Step 2: Add filter to scores route**

In `src/app/api/cron/scores/route.ts`, the score agent works from the padelapi.org `/live` endpoint which only returns Premier Padel matches — Gold/Silver/Bronze are never live there. No functional change needed, but add a comment for clarity.

In the `fetchLiveMatches` function, add a comment:
```typescript
// Note: padelapi.org /live only returns Premier Padel matches.
// Gold/Silver/Bronze are handled by the FIP standalone pipeline (cron:fip-scores).
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/sync/route.ts src/app/api/cron/scores/route.ts
git commit -m "feat: filter Gold/Silver/Bronze from padelapi sync — now FIP standalone"
```

---

### Task 7: Ops Dashboard Integration

**Files:**
- Modify: `src/app/ops/api/status/route.ts`

- [ ] **Step 1: Add FIP cron sources to health check**

In `src/app/ops/api/status/route.ts`, find the `sources` array in `fetchHealth()` (approximately line 39):

```typescript
  const sources = [
    'cron:scores', 'cron:sync', 'cron:sync-matches',
    'cron:rankings', 'cron:articles', 'cron:highlights',
  ]
```

Add the two new sources:
```typescript
  const sources = [
    'cron:scores', 'cron:sync', 'cron:sync-matches',
    'cron:rankings', 'cron:articles', 'cron:highlights',
    'cron:fip-tournaments', 'cron:fip-scores',
  ]
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ops/api/status/route.ts
git commit -m "feat: add FIP cron sources to ops dashboard health check"
```

---

### Task 8: Vercel Cron Schedules

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add cron schedules**

Add the two new cron jobs to `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/cron/scores",
      "schedule": "*/2 * * * *"
    },
    {
      "path": "/api/cron/sync?scope=matches",
      "schedule": "0 */1 * * *"
    },
    {
      "path": "/api/cron/sync",
      "schedule": "0 4 * * 1"
    },
    {
      "path": "/api/cron/sync-fip-rankings",
      "schedule": "0 5 * * *"
    },
    {
      "path": "/api/cron/sync-highlights",
      "schedule": "20 */1 * * *"
    },
    {
      "path": "/api/cron/sync-articles",
      "schedule": "40 */1 * * *"
    },
    {
      "path": "/api/cron/fip-tournaments",
      "schedule": "0 */12 * * *"
    },
    {
      "path": "/api/cron/fip-scores",
      "schedule": "0 */2 * * *"
    }
  ]
}
```

- [ ] **Step 2: Commit**

```bash
git add vercel.json
git commit -m "feat: add FIP tournaments + scores cron schedules to vercel.json"
```

---

### Task 9: Integration Testing

**Files:** None (testing only)

- [ ] **Step 1: Run unit tests**

Run: `npx vitest run src/lib/__tests__/fip-scraper.test.ts`
Expected: All tests PASS

- [ ] **Step 2: Run the full test suite**

Run: `npx vitest run`
Expected: All existing tests continue to pass (no regressions)

- [ ] **Step 3: Build check**

Run: `npm run build`
Expected: Build succeeds with no type errors

- [ ] **Step 4: Manual integration test — tournaments cron**

Run locally: `curl -s http://localhost:3002/api/cron/fip-tournaments | python3 -m json.tool`
Verify:
- `total_events` is > 0
- `upserted` is > 0
- Check Supabase: `SELECT name, level, source, fip_slug, matchscorer_url FROM tournaments WHERE source = 'fip' LIMIT 10;`

- [ ] **Step 5: Manual integration test — scores cron**

Run locally: `curl -s http://localhost:3002/api/cron/fip-scores | python3 -m json.tool`
Verify:
- If active tournaments exist: `matches_upserted > 0`
- Check Supabase: `SELECT m.external_id, m.status, m.round, m.category, t.name FROM matches m JOIN tournaments t ON m.tournament_id = t.id WHERE t.source = 'fip' LIMIT 10;`

- [ ] **Step 6: Commit test results (if any test files updated)**

```bash
git add -A && git commit -m "test: verify FIP pipeline integration"
```
