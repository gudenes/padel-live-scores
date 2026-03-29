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

function fipCountryToIso2(code3: string): string {
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

async function fetchOfficialRankings(gender: 'male' | 'female', top: number): Promise<FipRankingPlayer[]> {
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
      console.log(`[sync-fip] official ${gender}: found data at week ${w}`)
      return all
    }
  }

  return []
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

// ── Player map (name → id) ──────────────────────────────────────────────

async function getPlayerMap(category: string): Promise<Map<string, string>> {
  const { data } = await supabase
    .from('players')
    .select('id, name')
    .eq('category', category)

  const map = new Map<string, string>()
  for (const p of data ?? []) {
    map.set(normalize(p.name), p.id)
  }
  return map
}

// ── Main handler ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const typeFilter = searchParams.get('type') // 'official', 'race', or null (both)
  const top = parseInt(searchParams.get('top') ?? '1000')
  const now = new Date().toISOString()

  const results = {
    official: { updated: 0, created: 0, unmatched: 0 },
    race:     { updated: 0, created: 0, unmatched: 0 },
  }

  const genders: Array<{ fip: 'male' | 'female'; db: string }> = [
    { fip: 'male', db: 'men' },
    { fip: 'female', db: 'women' },
  ]

  for (const { fip, db } of genders) {
    // Load existing player map — we'll refresh it after official creates new players
    let playerMap = await getPlayerMap(db)

    // ── Official rankings ──────────────────────────────────────────────
    if (!typeFilter || typeFilter === 'official') {
      const officials = await fetchOfficialRankings(fip, top)
      console.log(`[sync-fip] official ${fip}: ${officials.length} players fetched`)

      for (const p of officials) {
        const fullName = fipFullName(p)
        const normalizedName = normalize(fullName)
        let playerId = playerMap.get(normalizedName)

        if (playerId) {
          // Update existing player
          const { error } = await supabase
            .from('players')
            .update({
              ranking: p.rank,
              points: p.points,
              ranking_move: p.move,
              updated_at: now,
            })
            .eq('id', playerId)

          if (error) console.error(`[sync-fip] update error for ${fullName}:`, error.message)
          else results.official.updated++
        } else {
          // Create new player from FIP data
          const country2 = fipCountryToIso2(p.country_name)
          const { data: inserted, error } = await supabase
            .from('players')
            .insert({
              name: fullName,
              country: country2,
              category: db,
              ranking: p.rank,
              points: p.points,
              ranking_move: p.move,
              avatar_url: p.thumbnail || null,
              profile_url: p.url || null,
              updated_at: now,
            })
            .select('id')
            .single()

          if (error) {
            console.error(`[sync-fip] create error for ${fullName}:`, error.message)
            results.official.unmatched++
          } else {
            results.official.created++
            // Add to map so race ranking can find this player later
            if (inserted) playerMap.set(normalizedName, inserted.id)
          }
        }
      }

      // Refresh map after inserts so race can match them
      if (!typeFilter || typeFilter !== 'official') {
        playerMap = await getPlayerMap(db)
      }
    }

    // ── Race rankings ──────────────────────────────────────────────────
    if (!typeFilter || typeFilter === 'race') {
      const races = await fetchRaceRankings(fip, top)
      console.log(`[sync-fip] race ${fip}: ${races.length} players fetched`)

      for (const p of races) {
        const fullName = fipFullName(p)
        const playerId = playerMap.get(normalize(fullName))

        if (playerId) {
          const { error } = await supabase
            .from('players')
            .update({
              race_ranking: p.race_rank,
              race_points: p.race_points,
              race_move: p.race_move,
              updated_at: now,
            })
            .eq('id', playerId)

          if (error) console.error(`[sync-fip] race update error for ${fullName}:`, error.message)
          else results.race.updated++
        } else {
          // Player not in DB even after official sync — skip race-only players
          results.race.unmatched++
        }
      }
    }
  }

  return NextResponse.json({ ok: true, top, ...results })
}
