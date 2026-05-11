// src/app/api/cron/sync/route.ts
// Weekly Sync Agent
// Keeps tournaments, players, and match results up to date
// Based on padelapi.org Data Synchronization guide:
// - Tournaments: weekly via /seasons/{id}/tournaments
// - Players: after each tournament week via /players/{id}
// - Matches: per tournament via /tournaments/{id}/matches
// - Handles 302 redirects (merged players/tournaments)
// - Handles 404 (deleted resources)
// - Handles 429 (rate limits)

import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '@/lib/player-resolver'
import { logOpsEvent } from '@/lib/ops-logger'
import { padelapiPausedResponse } from '@/lib/padelapi-pause'
import { filterUpdateByPriority } from '@/lib/source-priority'
import { sanitizeDurationHHMM } from '@/lib/match-duration'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const PADELAPI_BASE = 'https://padelapi.org/api'
const PADELAPI_TOKEN = process.env.PADELAPI_TOKEN!

// ── Rate limit state ───────────────────────────────────────────
let _rateLimitRemaining = 60
let _retryAfter = 0

function isRateLimited(): boolean {
  if (_retryAfter > Date.now()) {
    console.warn(`[Sync] Rate limit backoff until ${new Date(_retryAfter).toISOString()}`)
    return true
  }
  if (_rateLimitRemaining <= 3) {
    console.warn(`[Sync] Rate limit nearly exhausted (${_rateLimitRemaining} remaining)`)
    return true
  }
  return false
}

// ── Fetch wrapper — handles rate limits + redirects ───────────
async function fetchFromApi(
  path: string,
  followRedirects = true
): Promise<{ res: Response; redirectedTo: string | null } | null> {
  if (isRateLimited()) return null

  const res = await fetch(`${PADELAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${PADELAPI_TOKEN}` },
    redirect: followRedirects ? 'follow' : 'manual',
  })

  const remaining = res.headers.get('X-RateLimit-Remaining')
  if (remaining !== null) _rateLimitRemaining = parseInt(remaining, 10)

  if (res.status === 429) {
    const retryAfter = res.headers.get('Retry-After')
    _retryAfter = Date.now() + (retryAfter ? parseInt(retryAfter, 10) : 60) * 1000
    console.error(`[Sync] 429 — backing off`)
    return null
  }

  // 302 redirect — capture the new location
  if (res.status === 302 || (res.redirected && res.url !== `${PADELAPI_BASE}${path}`)) {
    const newUrl = res.url
    const newPath = newUrl.replace(PADELAPI_BASE, '')
    console.log(`[Sync] 302 redirect: ${path} → ${newPath}`)
    return { res, redirectedTo: newPath }
  }

  if (res.status === 404) {
    console.warn(`[Sync] 404 for ${path} — resource no longer exists`)
    return null
  }

  if (!res.ok) {
    console.error(`[Sync] API error ${res.status} for ${path}`)
    return null
  }

  return { res, redirectedTo: null }
}

// ── Timezone inference from country + location ────────────────
// Automatically assigns timezone to tournaments based on country code
// and location name. Priority: location override → country fallback.
// Documented in Notion: Tournament Timezone Mapping
const COUNTRY_TIMEZONES: Record<string, string> = {
  ES: 'Europe/Madrid',
  FR: 'Europe/Paris',
  IT: 'Europe/Rome',
  DE: 'Europe/Berlin',
  PT: 'Europe/Lisbon',
  GB: 'Europe/London',
  US: 'America/New_York',
  MX: 'America/Mexico_City',
  AR: 'America/Argentina/Buenos_Aires',
  BR: 'America/Sao_Paulo',
  SA: 'Asia/Riyadh',
  AE: 'Asia/Dubai',
  QA: 'Asia/Qatar',
  HK: 'Asia/Hong_Kong',
  SG: 'Asia/Singapore',
  JP: 'Asia/Tokyo',
  AU: 'Australia/Sydney',
  ZA: 'Africa/Johannesburg',
  MA: 'Africa/Casablanca',
  EG: 'Africa/Cairo',
  SE: 'Europe/Stockholm',
  NL: 'Europe/Amsterdam',
  BE: 'Europe/Brussels',
  AT: 'Europe/Vienna',
  CH: 'Europe/Zurich',
  PL: 'Europe/Warsaw',
  CZ: 'Europe/Prague',
  RO: 'Europe/Bucharest',
  GR: 'Europe/Athens',
  TR: 'Europe/Istanbul',
  IL: 'Asia/Jerusalem',
  KZ: 'Asia/Almaty',
  UZ: 'Asia/Tashkent',
  KG: 'Asia/Bishkek',
}

// Location overrides — cities that differ from country default
const LOCATION_OVERRIDES: Array<{ pattern: RegExp; timezone: string }> = [
  { pattern: /canc[uú]n/i,        timezone: 'America/Cancun' },
  { pattern: /miami/i,            timezone: 'America/New_York' },
  { pattern: /new york/i,         timezone: 'America/New_York' },
  { pattern: /los angeles|la/i, timezone: 'America/Los_Angeles' },
  { pattern: /las vegas/i,        timezone: 'America/Los_Angeles' },
  { pattern: /chicago/i,          timezone: 'America/Chicago' },
  { pattern: /houston/i,          timezone: 'America/Chicago' },
  { pattern: /denver/i,           timezone: 'America/Denver' },
  { pattern: /riyadh/i,           timezone: 'Asia/Riyadh' },
  { pattern: /dubai/i,            timezone: 'Asia/Dubai' },
  { pattern: /abu dhabi/i,        timezone: 'Asia/Dubai' },
  { pattern: /doha/i,             timezone: 'Asia/Qatar' },
  { pattern: /hong kong/i,        timezone: 'Asia/Hong_Kong' },
  { pattern: /almaty/i,           timezone: 'Asia/Almaty' },
  { pattern: /tashkent/i,         timezone: 'Asia/Tashkent' },
]

function inferTimezone(country: string | null, location: string | null): string | null {
  // Check location overrides first
  if (location) {
    for (const override of LOCATION_OVERRIDES) {
      if (override.pattern.test(location)) {
        return override.timezone
      }
    }
  }
  // Fall back to country
  if (country && COUNTRY_TIMEZONES[country.toUpperCase()]) {
    return COUNTRY_TIMEZONES[country.toUpperCase()]
  }
  return null
}

// ── Normalize player names ────────────────────────────────────
function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// ── Step 1: Sync seasons → get ALL active season IDs ──────────
// API: { data: [{ id, name, status, start_date, end_date, ... }] }
// Paginated so future circuits/tours (regional, youth, etc.) aren't silently dropped.
async function getActiveSeasonIds(): Promise<string[]> {
  const seasons: any[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    if (isRateLimited()) break
    const result = await fetchFromApi(`/seasons?per_page=50&page=${page}`)
    if (!result) break

    try {
      const data = await result.res.json()
      const rows = Array.isArray(data) ? data : (data.data ?? [])
      seasons.push(...rows)
      const lastPage = data.meta?.last_page ?? 1
      hasMore = page < lastPage
      page++
    } catch (e) {
      console.error(`[Sync] Failed to parse seasons page ${page}:`, e)
      break
    }
  }

  if (seasons.length === 0) return []

  // Get all active seasons (can be multiple: Premier Padel + FIP Tour)
  const active = seasons.filter((s: any) => s.status === 'active')

  if (active.length === 0) {
    const fallback = seasons[0]
    if (!fallback?.id) return []
    console.log(`[Sync] No active seasons, using: ${fallback.id} (${fallback.name})`)
    return [String(fallback.id)]
  }

  const ids = active.map((s: any) => String(s.id))
  console.log(`[Sync] Active seasons: ${active.map((s: any) => s.id + ' (' + s.name + ')').join(', ')}`)
  return ids
}

// ── FIP event info lookup ──────────────────────────────────────
// Searches padelfip.com WordPress API by tournament name.
// Returns the logo URL + slug used for overview scraping.
// Only called when logo_url or venue is not yet set.
interface FipEventInfo {
  logoUrl: string | null
  slug: string | null  // e.g. "miami-p1-2026" — used to build the overview URL
}

async function fetchFipEventInfo(tournamentName: string): Promise<FipEventInfo> {
  try {
    // Strip year suffix for better matching ("Miami P1 2026" → "Miami P1")
    const searchTerm = tournamentName.replace(/\s+\d{4}$/, '').trim()
    const url = `https://www.padelfip.com/wp-json/wp/v2/events?search=${encodeURIComponent(searchTerm)}&per_page=3&_fields=id,title,featured_media,link`
    const res = await fetch(url)
    if (!res.ok) return { logoUrl: null, slug: null }
    const events = await res.json()
    if (!Array.isArray(events) || events.length === 0) return { logoUrl: null, slug: null }

    // Pick the best match — prefer title containing the search term
    const best = events.find((e: any) =>
      e.title?.rendered?.toLowerCase().includes(searchTerm.toLowerCase())
    ) ?? events[0]

    // Extract slug from link: ".../es/events/miami-p1-2026/" → "miami-p1-2026"
    let slug: string | null = null
    if (best?.link) {
      const m = (best.link as string).match(/\/events\/([^/?#]+)\/?(?:\?|$)/)
      if (m) slug = m[1]
    }

    // Fetch the logo media record
    let logoUrl: string | null = null
    if (best?.featured_media) {
      const mediaRes = await fetch(
        `https://www.padelfip.com/wp-json/wp/v2/media/${best.featured_media}?_fields=source_url,media_details`
      )
      if (mediaRes.ok) {
        const media = await mediaRes.json()
        // Prefer medium size (212×300) — good balance of quality and size
        logoUrl = media.media_details?.sizes?.medium?.source_url
          ?? media.media_details?.sizes?.thumbnail?.source_url
          ?? media.source_url
          ?? null
      }
    }

    return { logoUrl, slug }
  } catch (e) {
    console.warn(`[Sync] FIP event info lookup failed for "${tournamentName}":`, e)
    return { logoUrl: null, slug: null }
  }
}

// ── FIP overview scraper ───────────────────────────────────────
// Fetches and parses the FIP event overview page (/es/events/{slug}/?tab=Overview)
// Extracts: prize money, venue name, venue address, venue type, n_courts, surface.
// Uses regex on raw HTML — no DOM parser needed in edge/Node runtime.
interface FipOverviewData {
  prize_money: string | null
  venue: string | null
  venue_address: string | null
  venue_type: string | null
  n_courts: number | null
  surface: string | null
}

function cleanHtmlText(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&euro;/gi, '€').replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&[a-z]+;/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

async function fetchFipOverview(slug: string): Promise<FipOverviewData | null> {
  try {
    const url = `https://www.padelfip.com/es/events/${slug}/?tab=Overview`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; padel-app/1.0)' },
    })
    if (!res.ok) return null
    const html = await res.text()
    // Guard against empty/redirect responses
    if (html.length < 2000 || !html.includes('overview__title')) return null

    // ── Parse span.overview__title + p.overview__text — block-based ──────
    // Split into blocks by each overview__title span so values can't cross to
    // a different label (avoids the cross-pairing problem with greedy .*?).
    const pairs: Record<string, string> = {}
    const blockRe = /<span[^>]*class="overview__title"[^>]*>([\s\S]*?)<\/span>([\s\S]*?)(?=<span[^>]*class="overview__title"|$)/gi
    let m: RegExpExecArray | null
    while ((m = blockRe.exec(html)) !== null) {
      const label = cleanHtmlText(m[1]).toLowerCase()
      const block = m[2]
      // Find the first p.overview__text within THIS block only
      const vMatch = block.match(/<p[^>]*class="overview__text"[^>]*>([\s\S]*?)<\/p>/i)
      if (vMatch) {
        const value = cleanHtmlText(vMatch[1])
        if (label && value) pairs[label] = value
      }
    }

    // ── Parse INFORMACIÓN GENERAL block ──────────────────────────────────
    const generalInfo: Record<string, string> = {}
    const genMatch = html.match(/INFORMACI[ÓO]N GENERAL([\s\S]*?)<\/div>\s*<\/div>/i)
    if (genMatch) {
      const block = genMatch[1].replace(/<[^>]+>/g, '\n')
      const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
      for (let i = 0; i + 1 < lines.length; i += 2) {
        generalInfo[lines[i].toLowerCase()] = lines[i + 1]
      }
    }

    // Helper — find first matching value by partial key
    const find = (src: Record<string, string>, keys: string[]): string | null => {
      for (const key of keys) {
        const entry = Object.entries(src).find(([k]) => k.includes(key))
        if (entry) return entry[1]
      }
      return null
    }

    const prize      = find(pairs, ['prize', 'premio', 'inscripci'])
    const venue      = find(pairs, ['venue', 'recinto', 'pabellón', 'pabellon'])
    const address    = find(pairs, ['direcci', 'address'])

    const venueType  = find(generalInfo, ['venue type', 'tipo de pista', 'type', 'tipo'])
    const courtsStr  = find(generalInfo, ['competition court', 'nº court', 'pistas', 'courts'])
    const surface    = find(generalInfo, ['superficie', 'surface'])

    return {
      prize_money:   prize,
      venue:         venue,
      venue_address: address,
      venue_type:    venueType,
      n_courts:      courtsStr ? (parseInt(courtsStr, 10) || null) : null,
      surface:       surface,
    }
  } catch (e) {
    console.warn(`[Sync] FIP overview fetch failed for slug "${slug}":`, e)
    return null
  }
}

// ── Step 2: Sync tournaments for a season ─────────────────────
// Uses list endpoint only — no per-tournament detail calls
// Redirect checks are deferred to reconciliation to save rate limits
// Paginated: follows data.meta.last_page so we don't silently drop tournaments
// when a season has > 50 (full-year Premier + FIP seasons easily exceed this)
async function syncTournaments(seasonId: string): Promise<string[]> {
  const tournaments: any[] = []
  let page = 1
  let hasMore = true

  while (hasMore) {
    if (isRateLimited()) break
    const result = await fetchFromApi(`/seasons/${seasonId}/tournaments?per_page=50&page=${page}`)
    if (!result) break

    try {
      const data = await result.res.json()
      const rows = Array.isArray(data) ? data : (data.data ?? [])
      tournaments.push(...rows)
      const lastPage = data.meta?.last_page ?? 1
      hasMore = page < lastPage
      page++
    } catch (e) {
      console.error(`[Sync] Failed to parse tournaments page ${page} for season ${seasonId}:`, e)
      break
    }
  }

  if (tournaments.length === 0) return []
  console.log(`[Sync] Season ${seasonId}: fetched ${tournaments.length} tournaments across ${page - 1} page(s)`)

  try {
    const syncedIds: string[] = []

    // Fetch existing FIP-enriched fields so we avoid redundant scraping on re-runs
    const externalIds = tournaments.map((t: any) => String(t.id)).filter(Boolean)
    const { data: existing } = await supabase
      .from('tournaments')
      .select('external_id, logo_url, venue, prize_money, venue_type, venue_address, n_courts, surface')
      .in('external_id', externalIds)
    const existingMap = Object.fromEntries(
      (existing ?? []).map((r: any) => [r.external_id, r])
    )

    // FIP tournament source switched back to padelapi.org for higher data quality.
    // FIP standalone pipeline (cron/fip-tournaments + cron/fip-scores) is now paused.
    const filteredTournaments = tournaments

    for (const t of filteredTournaments) {
      if (!t.id) continue
      const externalId = String(t.id)
      const prev = existingMap[externalId] ?? {}

      const needsLogo     = !prev.logo_url
      const needsOverview = !prev.venue  // Scrape overview if venue not yet captured

      let logoUrl = prev.logo_url ?? null
      let overviewData: FipOverviewData | null = null

      if ((needsLogo || needsOverview) && t.name) {
        const info = await fetchFipEventInfo(t.name)
        if (info.logoUrl && needsLogo) {
          logoUrl = info.logoUrl
          console.log(`[Sync] Logo found for ${t.name}: ${info.logoUrl}`)
        }
        if (info.slug && needsOverview) {
          overviewData = await fetchFipOverview(info.slug)
          if (overviewData?.venue) {
            console.log(`[Sync] Overview captured for ${t.name}: prize=${overviewData.prize_money}, venue=${overviewData.venue}`)
          }
        }
      }

      // Upsert directly from list data — no extra API call needed
      // Schema: id, external_id, name, level, location, starts_at, ends_at,
      //         created_at, updated_at, country, timezone, status, season_id, url,
      //         logo_url, venue, venue_address, venue_type, prize_money, n_courts, surface
      const { error } = await supabase
        .from('tournaments')
        .upsert(
          {
            external_id: externalId,
            name: t.name ?? 'Unknown',
            level: t.level ?? 'unknown',
            location: t.location ?? null,
            starts_at: t.start_date ?? null,
            ends_at: t.end_date ?? null,
            country: t.country ?? null,
            timezone: t.timezone ?? inferTimezone(t.country, t.location) ?? null,
            status: t.status ?? null,
            season_id: seasonId,
            url: t.url ?? null,
            logo_url: logoUrl,
            // Overview fields — preserve existing values if we didn't scrape this run
            venue:         overviewData?.venue         ?? prev.venue         ?? null,
            venue_address: overviewData?.venue_address ?? prev.venue_address ?? null,
            venue_type:    overviewData?.venue_type    ?? prev.venue_type    ?? null,
            prize_money:   overviewData?.prize_money   ?? prev.prize_money   ?? null,
            n_courts:      overviewData?.n_courts      ?? prev.n_courts      ?? null,
            surface:       overviewData?.surface       ?? prev.surface       ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'external_id' }
        )

      if (error) {
        console.error(`[Sync] Failed to upsert tournament ${externalId}:`, error)
      } else {
        syncedIds.push(externalId)
      }
    }

    console.log(`[Sync] Tournaments synced: ${syncedIds.length}/${filteredTournaments.length} (${tournaments.length - filteredTournaments.length} FIP standalone skipped)`)
    return syncedIds
  } catch (e) {
    console.error('[Sync] Failed to parse tournaments:', e)
    return []
  }
}

// ── Step 3: Sync ALL matches for a tournament (all statuses, all pages) ──
// Handles pagination (94 matches = 7 pages at 15/page)
// Upserts scheduled matches even without players (draws happen later)
// Response shape: { id, status, category, round, round_name, index,
//   played_at, schedule_label, court, court_order, players: {team_1[], team_2[]} }
async function syncTournamentMatches(tournamentExternalId: string): Promise<number> {
  // Get the tournament DB id first
  const { data: tournamentRow } = await supabase
    .from('tournaments')
    .select('id, timezone, level')
    .eq('external_id', tournamentExternalId)
    .single()

  // Hard guard: padelapi is no longer the source of truth for FIP matches.
  // Padelgod's Crionet pipeline owns those (better timezone-converted
  // scheduled_at, complete winner_pair + sets). This guard catches every
  // caller — the cron loop already filters but the forceTournament path
  // (`?tournament=NNN`) and admin endpoints bypassed it.
  if (tournamentRow?.level && String(tournamentRow.level).startsWith('fip_')) {
    console.log(`[Sync] Skipping tournament ${tournamentExternalId} — FIP-tier (${tournamentRow.level}), padelgod owns this`)
    return 0
  }

  let synced = 0
  let page = 1
  let hasMore = true

  while (hasMore) {
    if (isRateLimited()) break

    const result = await fetchFromApi(
      `/tournaments/${tournamentExternalId}/matches?per_page=50&page=${page}`
    )
    if (!result) break

    try {
      const data = await result.res.json()
      const matches = Array.isArray(data) ? data : (data.data ?? [])
      const lastPage = data.meta?.last_page ?? 1
      hasMore = page < lastPage
      page++

      for (const match of matches) {
        if (isRateLimited()) break
        if (!match.id) continue

        const externalId = String(match.id)
        const status = match.status as string

        // Check existing match state
        const { data: existing } = await supabase
          .from('matches')
          .select('id, winner_pair, status, category, round')
          .eq('external_id', externalId)
          .single()

        // Count how many scored sets this match has
        let scoredSets = 0
        let apiConfirmedSets = 0
        if (existing?.id) {
          const { count } = await supabase
            .from('sets')
            .select('id', { count: 'exact', head: true })
            .eq('match_id', existing.id)
            .not('set_score', 'is', null)
          scoredSets = count ?? 0

          // NEW: count only API-confirmed sets — inferred sets should be overwritten
          const { count: apiCount } = await supabase
            .from('sets')
            .select('id', { count: 'exact', head: true })
            .eq('match_id', existing.id)
            .not('set_score', 'is', null)
            .eq('score_source', 'api')
          apiConfirmedSets = apiCount ?? 0
        }

        // How many sets does the API say this match has?
        const expectedSets = match.score?.length ?? 0

        // Skip only if truly complete:
        // - has winner
        // - is finished
        // - scored sets in DB matches what API reports (handles 2-set AND 3-set matches)
        // - ALL scored sets are API-confirmed (not just 'inferred' from point data)
        const isComplete = existing?.winner_pair !== null
          && (existing?.status as string) === 'finished'
          && expectedSets > 0
          && scoredSets >= expectedSets
          && apiConfirmedSets >= expectedSets  // ← NEW: only skip if all sets are from API

        // Always patch metadata fields even on complete matches
        // category, court, round can be missing from early-synced matches
        if (isComplete) {
          const needsMetadata = !existing?.category || !existing?.round
          if (needsMetadata && existing?.id) {
            await supabase
              .from('matches')
              .update({
                category: match.category ?? null,
                round: match.round_name ?? match.round ?? null,
                court: match.court ?? null,
                court_order: match.court_order ?? null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existing.id)
          }
          continue
        }

        // Parse winner from API format: "team_1" → 1, "team_2" → 2
        const winnerPair = match.winner === 'team_1' ? 1
          : match.winner === 'team_2' ? 2
          : null

        // Parse started_at from started_time
        const startedAt = match.started_time
          ? new Date(match.started_time).toISOString()
          : null

        // Build scheduled_at: combine played_at (date) + schedule_label (time) + timezone
        // If schedule_label has a time (e.g. "Starting at 4:00 PM", "Not before 5:30 PM"),
        // parse it and create a proper UTC timestamp using the tournament timezone.
        // If no time is available, store the date-only value.
        let scheduledAt: string | null = match.played_at ?? null
        if (match.played_at && match.schedule_label) {
          const timeMatch = (match.schedule_label as string).match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
          if (timeMatch && tournamentRow?.timezone) {
            let hours = parseInt(timeMatch[1])
            const minutes = parseInt(timeMatch[2])
            const ampm = timeMatch[3].toUpperCase()
            if (ampm === 'PM' && hours < 12) hours += 12
            if (ampm === 'AM' && hours === 12) hours = 0
            try {
              // Create a date string in tournament local time, then convert to UTC
              // played_at is "YYYY-MM-DD", we add the parsed time
              const localStr = `${match.played_at}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`
              // Use Intl to find the UTC offset for this timezone on this date
              const probe = new Date(localStr + 'Z') // treat as UTC initially
              const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tournamentRow.timezone,
                year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
              })
              // Get the offset by comparing local formatted time with UTC
              const utcParts = formatter.formatToParts(probe)
              const localHour = parseInt(utcParts.find(p => p.type === 'hour')?.value ?? '0')
              const utcHour = probe.getUTCHours()
              const offsetHours = localHour - utcHour
              // Shift the time by the offset to get true UTC
              const utcDate = new Date(`${match.played_at}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00Z`)
              utcDate.setHours(utcDate.getHours() - offsetHours)
              scheduledAt = utcDate.toISOString()
            } catch {
              // Fallback to date-only if timezone conversion fails
              scheduledAt = match.played_at
            }
          }
        }

        // Only include scheduled_at in the upsert if we have a real time
        // (not just a date-only value). This prevents the hourly sync from
        // overwriting OOP-derived times with PadelAPI's date-only played_at.
        const scheduledAtHasTime = scheduledAt && /T\d{2}:\d{2}/.test(scheduledAt) &&
          !scheduledAt.endsWith('T00:00:00') && !scheduledAt.endsWith('T00:00:00.000Z')

        // Upsert match — only columns that exist in DB schema
        const upsertData: Record<string, unknown> = {
              external_id: externalId,
              tournament_id: tournamentRow?.id ?? null,
              status: status,
              winner_pair: winnerPair,
              round: match.round_name ?? match.round ?? null,
              court: match.court ?? null,
              court_order: match.court_order ?? null,
              schedule_label: match.schedule_label ?? null,
              category: match.category ?? null,
              started_at: startedAt,
              duration: sanitizeDurationHHMM(match.duration),
              updated_at: new Date().toISOString(),
        }
        // Only set scheduled_at if we have a proper time, OR the match doesn't exist yet
        // (for new matches, always set it even if date-only so we have the date)
        if (scheduledAtHasTime) {
          upsertData.scheduled_at = scheduledAt
        } else if (scheduledAt) {
          // Date-only: only set if creating a new match (not updating an existing one)
          // We handle this by checking if the match exists first
          const { data: existingMatch } = await supabase
            .from('matches')
            .select('scheduled_at')
            .eq('external_id', externalId)
            .maybeSingle()

          if (!existingMatch) {
            // New match — set date-only scheduled_at
            upsertData.scheduled_at = scheduledAt
          } else if (existingMatch.scheduled_at) {
            const existingDt = new Date(existingMatch.scheduled_at)
            const hasExistingTime = existingDt.getUTCHours() !== 0 || existingDt.getUTCMinutes() !== 0
            if (!hasExistingTime) {
              // Existing match has date-only — safe to update with new date-only
              upsertData.scheduled_at = scheduledAt
            }
            // else: existing has a real time (OOP-set) — don't overwrite with date-only
          }
        }

        const { data: matchRow, error: matchError } = await supabase
          .from('matches')
          .upsert(
            upsertData as {
              external_id: string
              tournament_id: string | null
              status: string
              winner_pair: number | null
              round: string | null
              court: string | null
              court_order: number | null
              schedule_label: string | null
              category: string | null
              started_at: string | null
              duration: number | null
              updated_at: string
              scheduled_at?: string | null
            },
            { onConflict: 'external_id' }
          )
          .select('id')
          .single()

        if (matchError || !matchRow) {
          console.error(`[Sync] Upsert failed for match ${externalId}:`, matchError?.message ?? 'no row returned')
          continue
        }

        // ── Push notification: match just went live ──
        //
        // Historically this trigger lived only in `/api/cron/scores`, which
        // polls padelapi's `/live` endpoint every 2 min. We discovered on
        // 2026-04-23 that `/live` has been returning an empty array for
        // Premier Padel events (Brussels P2) despite our DB showing those
        // matches as `status='live'`. The actual writer of those live
        // transitions is THIS hourly sync cron — but it had no notify call.
        //
        // Result: matches were transitioning to live, but zero users were
        // notified (user_notifications table had zero rows globally, ever).
        // The diagnostic at `scratch-notif-diagnostic.mjs` confirmed the
        // notify endpoint itself works end-to-end; only the trigger was
        // missing.
        //
        // Mirroring the scores-cron pattern: fire-and-forget with CRON_SECRET
        // auth. Notify handles dedup internally (no-op if no recipients) so
        // it's safe to call even when nobody's bookmarked the match. Both
        // crons now call it, which makes the system resilient to either one
        // missing the transition window.
        const wasNotLive = !existing || existing.status !== 'live'
        if (wasNotLive && status === 'live' && matchRow?.id) {
          const baseUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3002'
          fetch(`${baseUrl}/api/push/notify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${process.env.CRON_SECRET}`,
            },
            body: JSON.stringify({ matchId: matchRow.id }),
          }).catch(err => console.error('[Sync] Push notify failed:', err))
        }

        // Upsert players for this match (team_1 = pair1, team_2 = pair2)
        const team1 = match.players?.team_1 ?? []
        const team2 = match.players?.team_2 ?? []

        const [p1p1, p1p2, p2p1, p2p2] = await Promise.all([
          team1[0] ? upsertPlayerFromDetail(team1[0]) : Promise.resolve(null),
          team1[1] ? upsertPlayerFromDetail(team1[1]) : Promise.resolve(null),
          team2[0] ? upsertPlayerFromDetail(team2[0]) : Promise.resolve(null),
          team2[1] ? upsertPlayerFromDetail(team2[1]) : Promise.resolve(null),
        ])

        // Update player IDs on the match if we got any
        if (p1p1 || p1p2 || p2p1 || p2p2) {
          await supabase
            .from('matches')
            .update({
              pair1_player1_id: p1p1,
              pair1_player2_id: p1p2,
              pair2_player1_id: p2p1,
              pair2_player2_id: p2p2,
            })
            .eq('id', matchRow.id)
        }

        // Upsert set scores for finished/retired matches
        // API returns: score: [{ team_1: "7", team_2: "6(7)" }, { team_1: "6", team_2: "0" }]
        if (winnerPair && match.score?.length > 0) {
          for (let i = 0; i < match.score.length; i++) {
            const s = match.score[i]
            const setScore = `${s.team_1}-${s.team_2}`
            await supabase
              .from('sets')
              .upsert(
                {
                  match_id: matchRow.id,
                  set_number: i + 1,
                  set_score: setScore,
                  is_current: false,
                  score_source: 'api' as const,  // ← NEW: authoritative data, overwrites 'inferred'
                  updated_at: new Date().toISOString(),
                },
                { onConflict: 'match_id, set_number' }
              )
          }
          // Delete any orphan null sets
          await supabase
            .from('sets')
            .delete()
            .eq('match_id', matchRow.id)
            .is('set_score', null)
        }

        synced++
      }
    } catch (e) {
      console.error(`[Sync] Failed to parse matches page ${page} for tournament ${tournamentExternalId}:`, e)
      break
    }
  }

  console.log(`[Sync] Tournament ${tournamentExternalId}: ${synced} matches synced`)
  return synced
}

// Shared player resolver — initialized lazily
let _resolver: PlayerResolver | null = null
async function getResolver(): Promise<PlayerResolver> {
  if (!_resolver) {
    _resolver = new PlayerResolver(supabase)
    await _resolver.load()
  }
  return _resolver
}

// Upsert a player from the tournament match detail format
// { id, name, side, connections: { pair } }
async function upsertPlayerFromDetail(player: any): Promise<string | null> {
  if (!player?.id) return null
  try {
    const resolver = await getResolver()
    const { playerId } = await resolver.resolve({
      externalId: String(player.id),
      name: player.name ?? 'Unknown',
      side: player.side ?? null,
    })
    return playerId
  } catch {
    return null
  }
}

// ── Step 4: Sync player rankings + handle redirects ───────────
async function syncPlayers(): Promise<{ synced: number; redirects: number }> {
  // Get players that haven't been synced in the last 7 days
  const { data: players, error } = await supabase
    .from('players')
    .select('id, external_id, name')
    .or(
      `updated_at.is.null,updated_at.lt.${new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()}`
    )
    .limit(30) // Max 30 per run to preserve rate limits

  if (error || !players) {
    console.error('[Sync] Failed to fetch players to sync:', error)
    return { synced: 0, redirects: 0 }
  }

  let synced = 0
  let redirects = 0

  for (const player of players) {
    if (isRateLimited()) break

    const result = await fetchFromApi(`/players/${player.external_id}`, false)
    if (!result) continue

    // Handle 302 redirect — player was merged into another
    if (result.redirectedTo) {
      const newExternalId = result.redirectedTo.split('/').pop()
      if (newExternalId) {
        console.log(`[Sync] Player ${player.external_id} (${player.name}) redirects to ${newExternalId}`)

        // Fetch the canonical player record
        const canonicalResult = await fetchFromApi(`/players/${newExternalId}`)
        if (!canonicalResult) continue

        try {
          const canonicalData = await canonicalResult.res.json()

          // Upsert the canonical player
          await supabase
            .from('players')
            .upsert(
              {
                external_id: newExternalId,
                name: canonicalData.name ?? player.name,
                country: canonicalData.country ?? null,
                ranking: canonicalData.ranking ?? null,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'external_id' }
            )

          // Update all match references from old ID to new ID
          const { data: canonicalRow } = await supabase
            .from('players')
            .select('id')
            .eq('external_id', newExternalId)
            .single()

          if (canonicalRow) {
            // Update all 4 pair columns in matches
            for (const col of ['pair1_player1_id', 'pair1_player2_id', 'pair2_player1_id', 'pair2_player2_id']) {
              await supabase
                .from('matches')
                .update({ [col]: canonicalRow.id })
                .eq(col, player.id)
            }
          }

          // Delete the old duplicate player record
          await supabase.from('players').delete().eq('id', player.id)

          redirects++
        } catch (e) {
          console.error(`[Sync] Failed to handle player redirect:`, e)
        }
      }
      continue
    }

    // Normal player update — refresh rankings, stats and gender
    //
    // Source-priority gate: padelapi can only write fields where it's the
    // primary owner per src/lib/source-priority.ts. After the 2026-05-07
    // FIP-canonical flip, that means avatar_url, win_rate, total_matches
    // get through; name / country / ranking are FIP-owned and stripped.
    // gender + updated_at aren't in the priority list → permissive default.
    try {
      const playerData = await result.res.json()

      const rawPayload = {
        name: playerData.name ?? player.name,
        country: playerData.country ?? null,
        ranking: playerData.ranking ?? null,
        win_rate: playerData.win_rate ?? null,
        total_matches: playerData.total_matches ?? null,
        avatar_url: playerData.avatar_url ?? null,
        gender: playerData.gender ?? null,
      }
      const filtered = filterUpdateByPriority(rawPayload, 'player', 'padelapi')
      // updated_at is metadata, not subject to source priority — always set.
      const update = { ...filtered, updated_at: new Date().toISOString() }

      // Skip if nothing material to write (filtered + updated_at would be a
      // no-op timestamp bump).
      if (Object.keys(filtered).length === 0) {
        synced++
        continue
      }

      await supabase
        .from('players')
        .update(update)
        .eq('id', player.id)

      synced++
    } catch (e) {
      console.error(`[Sync] Failed to update player ${player.external_id}:`, e)
    }
  }

  console.log(`[Sync] Players synced: ${synced}, redirects handled: ${redirects}`)
  return { synced, redirects }
}

// ── Main handler ───────────────────────────────────────────────
export async function GET(request: Request) {
  // Auth check
  if (process.env.NODE_ENV === 'production') {
    const authHeader = request.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Ops kill-switch for all padelapi-consuming crons. Returns early when
  // PADELAPI_PAUSED=true is set. See src/lib/padelapi-pause.ts.
  const paused = padelapiPausedResponse('sync')
  if (paused) return paused

  // Optional query params to scope the sync
  const url = new URL(request.url)
  const scope: string = url.searchParams.get('scope') ?? 'all'
  // ?scope=tournaments → only sync tournaments
  // ?scope=players     → only sync players
  // ?scope=matches     → only sync tournament matches
  // ?scope=all         → full sync (default)
  // ?tournament=123    → sync matches for a specific tournament

  const forceTournament = url.searchParams.get('tournament')

  // Always reset rate limit state at start of each run
  // Each Vercel invocation is a fresh instance — stale in-memory state
  // from a previous run should never block a new invocation
  _rateLimitRemaining = 60
  _retryAfter = 0

  try {
    const result = await logOpsEvent(`cron:sync${scope === 'matches' ? '-matches' : ''}`, async () => {
      console.log(`[Sync] Starting weekly sync (scope: ${scope})...`)
      const innerResult: Record<string, any> = { scope, rateLimitRemaining: _rateLimitRemaining }

      // ── Specific tournament match sync ──
      if (forceTournament) {
        const matchesSynced = await syncTournamentMatches(forceTournament)
        return { tournament: forceTournament, matchesSynced }
      }

      // ── Tournaments ──
      const syncScopes = scope.split(',') // allows comma-separated scopes
      if (syncScopes.includes('all') || syncScopes.includes('tournaments')) {
        const seasonIds = await getActiveSeasonIds()
        let totalTournamentsSynced = 0
        for (const seasonId of seasonIds) {
          if (isRateLimited()) break
          const synced = await syncTournaments(seasonId)
          totalTournamentsSynced += synced.length
        }
        innerResult.tournaments = { synced: totalTournamentsSynced, seasons: seasonIds }
      }

      // ── Matches for active + recently completed tournaments ──
      // Syncs ALL matches for:
      //   - Currently active tournaments (scheduled upcoming matches + live + results)
      //   - Tournaments that ended in the last 14 days (fix any remaining broken results)
      //   - Upcoming tournaments starting within 7 days (early draws + schedules)
      // Date bounds naturally limit the set size; the isRateLimited() guard inside
      // the per-tournament loop is the real safety net. Deterministic ordering by
      // starts_at so repeated runs process the same tournaments in the same order.
      //
      // Gate on external_id (not source). `external_id` on tournaments mirrors
      // padelapi_id via trigger — so "has external_id" == "padelapi knows this
      // tournament." Gating by `source != 'fip'` was too coarse: it silently
      // excluded any tournament whose provenance was FIP but which also carried
      // a valid padelapi_id (e.g., Brussels P2, source='fip', padelapi_id='731').
      // That meant SF/F schedule_label + court + starts_at data from padelapi
      // never landed — user-facing symptom was "upcoming matches for tomorrow
      // aren't showing." See the 2026-04-24 investigation.
      if (syncScopes.includes('all') || syncScopes.includes('matches')) {
        const today = new Date().toISOString().slice(0, 10)
        const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

        // Active tournaments: started and not yet ended
        const { data: activeTournaments } = await supabase
          .from('tournaments')
          .select('external_id, name, level')
          .lte('starts_at', today)
          .gte('ends_at', today)
          .not('external_id', 'is', null)
          .order('starts_at', { ascending: false })

        // Recently completed tournaments
        const { data: recentTournaments } = await supabase
          .from('tournaments')
          .select('external_id, name, level')
          .gte('ends_at', twoWeeksAgo)
          .lt('ends_at', today)
          .not('external_id', 'is', null)
          .order('ends_at', { ascending: false })

        // Upcoming tournaments: starting within the next 7 days
        // Draws and schedules are often published days before the tournament starts
        const oneWeekFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        const { data: upcomingTournaments } = await supabase
          .from('tournaments')
          .select('external_id, name, level')
          .gt('starts_at', today)
          .lte('starts_at', oneWeekFromNow)
          .not('external_id', 'is', null)
          .order('starts_at', { ascending: true })

        const allTournaments = [
          ...(activeTournaments ?? []),
          ...(recentTournaments ?? []),
          ...(upcomingTournaments ?? []),
        ]

        // Deduplicate
        const seen = new Set<string>()
        const uniqueTournaments = allTournaments.filter(t => {
          if (seen.has(t.external_id)) return false
          seen.add(t.external_id)
          return true
        })

        // Skip FIP-tier tournaments — padelgod owns FIP match data via the
        // Crionet widget pipeline (fip-draw-populator + fip-results-writer
        // + fip-oop-writer). Padelapi's FIP coverage is incomplete (missing
        // scheduled_at time conversion in particular) and was creating
        // duplicate rows that fight padelgod for the same physical match.
        // Premier-tier (p1/p2/major/finals) keeps going through padelapi
        // because that's where the live point-by-point Pusher feed runs.
        const fipFiltered = uniqueTournaments.filter(t => t.level?.startsWith('fip_'))
        const eligibleTournaments = uniqueTournaments.filter(t => !t.level?.startsWith('fip_'))

        console.log(`[Sync] Syncing matches for ${eligibleTournaments.length} tournament(s) (skipped ${fipFiltered.length} FIP-tier — padelgod owns those)`)

        let totalMatchesSynced = 0
        for (const t of eligibleTournaments) {
          if (isRateLimited()) break
          const count = await syncTournamentMatches(t.external_id)
          totalMatchesSynced += count
        }
        innerResult.matches = { synced: totalMatchesSynced, tournaments: eligibleTournaments.map(t => t.external_id), skippedFip: fipFiltered.length }
      }

      // ── Players ──
      if (syncScopes.includes('all') || syncScopes.includes('players')) {
        const playerResult = await syncPlayers()
        innerResult.players = playerResult
      }

      innerResult.rateLimitRemaining = _rateLimitRemaining
      // Flat keys for ops dashboard meta consumption
      innerResult.tournaments_synced = innerResult.tournaments?.synced ?? 0
      innerResult.matches_synced = innerResult.matches?.synced ?? 0
      innerResult.players_synced = innerResult.players?.synced ?? innerResult.players?.upserted ?? 0
      console.log('[Sync] Weekly sync complete:', innerResult)
      return innerResult
    })

    return Response.json(result)
  } catch (error) {
    console.error('[Sync] Fatal error:', error)
    return Response.json(
      { error: 'Weekly sync failed', detail: String(error) },
      { status: 500 }
    )
  }
}
