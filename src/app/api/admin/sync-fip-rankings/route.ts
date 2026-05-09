// src/app/api/admin/sync-fip-rankings/route.ts
// Fetches Official + Race rankings from padelfip.com and upserts into DB.
// Creates new player records for FIP players not yet in our DB.
//
// FIP JSON APIs:
//   Official: /wp-json/fip/v1/ranking/load-more/?gender=male&limit=1000&offset=0&...
//   Race:     /wp-json/fip/v1/player/search?search_type=race&q=&gender=male&limit=1000&offset=0&...
//
// Hit: GET /api/admin/sync-fip-rankings
// Optional: ?type=official|race  (default: both)
//           ?top=1000            (default: 1000 — how many to fetch per gender)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '@/lib/player-resolver'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const FIP_BASE = 'https://www.padelfip.com/es/wp-json/fip/v1'

// ── Helpers ──────────────────────────────────────────────────────────────

function currentYearWeek(): { year: number; week: number } {
  const now = new Date()
  const year = now.getFullYear()
  const start = new Date(year, 0, 1)
  const diff = now.getTime() - start.getTime()
  const week = Math.ceil((diff / 86400000 + start.getDay() + 1) / 7)
  return { year, week }
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

function fipFullName(p: { name: string; surname: string }): string {
  return `${p.name} ${p.surname}`.trim()
}

// Map 3-letter country codes (FIP) → 2-letter ISO codes (our DB)
const COUNTRY_3_TO_2: Record<string, string> = {
  ESP: 'ES', ARG: 'AR', BRA: 'BR', POR: 'PT', FRA: 'FR', ITA: 'IT',
  BEL: 'BE', NLD: 'NL', GER: 'DE', GBR: 'GB', DEN: 'DK', SWE: 'SE',
  URU: 'UY', PAR: 'PY', CHI: 'CL', MEX: 'MX', USA: 'US', AUS: 'AU',
  QAT: 'QA', CRC: 'CR', COL: 'CO', PER: 'PE', ECU: 'EC', BOL: 'BO',
  VEN: 'VE', DOM: 'DO', PAN: 'PA', CUB: 'CU', GTM: 'GT', HON: 'HN',
  NIC: 'NI', SLV: 'SV', JAM: 'JM', TTO: 'TT', NZL: 'NZ', JPN: 'JP',
  KOR: 'KR', CHN: 'CN', IND: 'IN', EGY: 'EG', MAR: 'MA', RSA: 'ZA',
  KEN: 'KE', NGR: 'NG', TUN: 'TN', ISR: 'IL', LBN: 'LB', KUW: 'KW',
  BHR: 'BH', UAE: 'AE', KSA: 'SA', FIN: 'FI', NOR: 'NO', POL: 'PL',
  CZE: 'CZ', AUT: 'AT', SUI: 'CH', GRE: 'GR', ROU: 'RO', HUN: 'HU',
  BUL: 'BG', CRO: 'HR', SRB: 'RS', SVK: 'SK', SLO: 'SI', EST: 'EE',
  LAT: 'LV', LTU: 'LT', IRL: 'IE', LUX: 'LU', MON: 'MC', AND: 'AD',
  CYP: 'CY', MLT: 'MT', ISL: 'IS', ALB: 'AL', MKD: 'MK', BIH: 'BA',
  MNE: 'ME', WAL: 'WA', SCO: 'SC', NIR: 'NI', ENG: 'EN',
}

function fipCountryToIso2(code3: string | null | undefined): string | null {
  if (!code3) return null
  return COUNTRY_3_TO_2[code3.toUpperCase()] ?? code3.slice(0, 2).toUpperCase()
}

// ── Fetch functions ──────────────────────────────────────────────────────

interface FipRankingPlayer {
  player_id: string
  name: string
  surname: string
  rank: number
  points: number
  move: number
  url: string
  thumbnail: string
  country_name: string
  country_flag: string
}

interface FipRacePlayer {
  player_id: string
  name: string
  surname: string
  race_rank: number
  race_points: number
  race_move: number
  url: string
  thumbnail: string
  country_name: string
  country_flag: string
}

// Compute the Monday date of a given week (matching currentYearWeek numbering)
function weekToDate(year: number, week: number): string {
  // Reverse of currentYearWeek: find the Monday of the given week number.
  // currentYearWeek uses Sunday-start weeks. The Monday after Sunday-start of
  // week N is `(N-1)*7 - jan1Day + 1` days after Jan 1 (jan1Day uses 0=Sun..6=Sat).
  const jan1 = new Date(year, 0, 1)
  const jan1Day = jan1.getDay()
  const dayOffset = (week - 1) * 7 - jan1Day + 1
  const monday = new Date(year, 0, 1 + dayOffset)
  return monday.toISOString().slice(0, 10) + 'T00:00:00Z'
}

async function fetchOfficialRankings(gender: 'male' | 'female', top: number): Promise<{ players: FipRankingPlayer[]; rankingDate: string }> {
  const { year, week } = currentYearWeek()

  // FIP may not have data for the current week yet — try current, then fall back up to 3 weeks
  for (let w = week; w >= week - 3 && w >= 1; w--) {
    const all: FipRankingPlayer[] = []
    let offset = 0
    const limit = Math.min(top, 500)

    while (all.length < top) {
      const remaining = top - all.length
      const fetchLimit = Math.min(limit, remaining)
      const url = `${FIP_BASE}/ranking/load-more/?gender=${gender}&limit=${fetchLimit}&offset=${offset}&category=master&circuit=premierpadel&year=${year}&week=${w}&lang=es`
      const res = await fetch(url)
      if (!res.ok) { console.error(`[sync-fip] official ${gender} week ${w} ${res.status}`); break }
      const data: FipRankingPlayer[] = await res.json()
      if (!data || data.length === 0) break
      all.push(...data)
      if (data.length < fetchLimit) break
      offset += data.length
    }

    if (all.length > 0) {
      const rankingDate = weekToDate(year, w)
      console.log(`[sync-fip] official ${gender}: found data at week ${w} (${rankingDate})`)
      return { players: all, rankingDate }
    }
  }

  return { players: [], rankingDate: new Date().toISOString() }
}

async function fetchRaceRankings(gender: 'male' | 'female', top: number): Promise<FipRacePlayer[]> {
  const all: FipRacePlayer[] = []
  let offset = 0
  const limit = Math.min(top, 500)

  while (all.length < top) {
    const remaining = top - all.length
    const fetchLimit = Math.min(limit, remaining)
    const url = `${FIP_BASE}/player/search?search_type=race&q=&gender=${gender}&limit=${fetchLimit}&offset=${offset}&category=master&circuit=premierpadel&lang=es`
    const res = await fetch(url)
    if (!res.ok) { console.error(`[sync-fip] race ${gender} ${res.status}`); break }
    const data: FipRacePlayer[] = await res.json()
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < fetchLimit) break
    offset += data.length
  }

  return all
}


// ── Main handler ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const typeFilter = searchParams.get('type') // 'official', 'race', or null (both)
  const genderFilter = searchParams.get('gender') // 'male', 'female', or null (both)
  const top = parseInt(searchParams.get('top') ?? '1000')
  const now = new Date().toISOString()

  const results = {
    official: { updated: 0, created: 0, unmatched: 0 },
    race:     { updated: 0, created: 0, unmatched: 0 },
  }

  // Cron path can split work across 4 invocations (one per gender × type) to
  // stay under Vercel's 120s maxDuration budget. Per-player resolver round
  // trips (2-3 each × 4000 players) blow past 120s on the unsplit path.
  const ALL_GENDERS: Array<{ fip: 'male' | 'female'; db: string }> = [
    { fip: 'male', db: 'men' },
    { fip: 'female', db: 'women' },
  ]
  const genders = genderFilter
    ? ALL_GENDERS.filter(g => g.fip === genderFilter)
    : ALL_GENDERS

  const resolver = new PlayerResolver(supabase)
  await resolver.load()

  for (const { fip, db } of genders) {
    // ── Official rankings ──────────────────────────────────────────────
    if (!typeFilter || typeFilter === 'official') {
      const { players: officials, rankingDate } = await fetchOfficialRankings(fip, top)
      console.log(`[sync-fip] official ${fip}: ${officials.length} players fetched (ranking date: ${rankingDate})`)

      for (const p of officials) {
        const fullName = fipFullName(p)
        // Raw FIP id (no prefix). Legacy "fip-" prefix unwound in
        // merge-duplicate-players PR.
        const fipId = p.player_id
        const country2 = fipCountryToIso2(p.country_name)

        try {
          const { action } = await resolver.resolveAndEnrich({
            name: fullName,
            fipId,
            category: db,
            country: country2,
            ranking: p.rank,
            points: p.points,
            rankingMove: p.move,
            avatarUrl: p.thumbnail || null,
            profileUrl: p.url || null,
            rankingDate,
          })

          if (action === 'created') results.official.created++
          else results.official.updated++
        } catch (err: any) {
          console.error(`[sync-fip] error for ${fullName}:`, err.message)
          results.official.unmatched++
        }
      }
    }

    // ── Race rankings ──────────────────────────────────────────────────
    if (!typeFilter || typeFilter === 'race') {
      const races = await fetchRaceRankings(fip, top)
      console.log(`[sync-fip] race ${fip}: ${races.length} players fetched`)

      for (const p of races) {
        const fullName = fipFullName(p)
        // Raw FIP id (no prefix). See note in officials loop above.
        const fipId = p.player_id

        try {
          const { action } = await resolver.resolveAndEnrich({
            name: fullName,
            fipId,
            category: db,
            raceRanking: p.race_rank,
            racePoints: p.race_points,
            raceMove: p.race_move,
          })

          if (action === 'created') results.race.created++
          else results.race.updated++
        } catch {
          results.race.unmatched++
        }
      }
    }
  }

  return NextResponse.json({ ok: true, top, ...results })
}
