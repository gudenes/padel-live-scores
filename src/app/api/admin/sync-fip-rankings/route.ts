// src/app/api/admin/sync-fip-rankings/route.ts
// Fetches Official + Race rankings from padelfip.com and upserts into DB.
//
// FIP exposes clean JSON APIs:
//   Official: /wp-json/fip/v1/ranking/load-more/?gender=male&limit=100&offset=0&category=master&circuit=premierpadel&year=2026&week=13&lang=es
//   Race:     /wp-json/fip/v1/player/search?search_type=race&q=&gender=male&limit=100&offset=0&category=master&circuit=premierpadel&lang=es
//
// Hit: GET /api/admin/sync-fip-rankings
// Optional: ?type=official|race  (default: both)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const FIP_BASE = 'https://www.padelfip.com/es/wp-json/fip/v1'

// Current year + approximate ISO week number
function currentYearWeek(): { year: number; week: number } {
  const now = new Date()
  const year = now.getFullYear()
  const start = new Date(year, 0, 1)
  const diff = now.getTime() - start.getTime()
  const week = Math.ceil((diff / 86400000 + start.getDay() + 1) / 7)
  return { year, week }
}

// ── Fetch official rankings ───────────────────────────────────────────────

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

async function fetchOfficialRankings(gender: 'male' | 'female'): Promise<FipRankingPlayer[]> {
  const { year, week } = currentYearWeek()
  const all: FipRankingPlayer[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const url = `${FIP_BASE}/ranking/load-more/?gender=${gender}&limit=${limit}&offset=${offset}&category=master&circuit=premierpadel&year=${year}&week=${week}&lang=es`
    const res = await fetch(url)
    if (!res.ok) { console.error(`[sync-fip] official ${gender} ${res.status}`); break }
    const data: FipRankingPlayer[] = await res.json()
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < limit) break
    offset += limit
  }

  return all
}

// ── Fetch race rankings ──────────────────────────────────────────────────

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

async function fetchRaceRankings(gender: 'male' | 'female'): Promise<FipRacePlayer[]> {
  const all: FipRacePlayer[] = []
  let offset = 0
  const limit = 100

  while (true) {
    const url = `${FIP_BASE}/player/search?search_type=race&q=&gender=${gender}&limit=${limit}&offset=${offset}&category=master&circuit=premierpadel&lang=es`
    const res = await fetch(url)
    if (!res.ok) { console.error(`[sync-fip] race ${gender} ${res.status}`); break }
    const data: FipRacePlayer[] = await res.json()
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < limit) break
    offset += limit
  }

  return all
}

// ── Name matching ────────────────────────────────────────────────────────
// FIP returns separate name/surname; our DB has a single "name" field.
// Match by combining and normalizing.

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
}

async function getPlayerMap(category: string): Promise<Map<string, string>> {
  // Map normalized name → player id
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

function fipFullName(p: { name: string; surname: string }): string {
  return `${p.name} ${p.surname}`.trim()
}

// ── Main handler ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const typeFilter = searchParams.get('type') // 'official', 'race', or null (both)

  const results = { official: { matched: 0, unmatched: 0 }, race: { matched: 0, unmatched: 0 } }

  const genders: Array<{ fip: 'male' | 'female'; db: string }> = [
    { fip: 'male', db: 'men' },
    { fip: 'female', db: 'women' },
  ]

  for (const { fip, db } of genders) {
    const playerMap = await getPlayerMap(db)

    // ── Official rankings ──────────────────────────────────────────────
    if (!typeFilter || typeFilter === 'official') {
      const officials = await fetchOfficialRankings(fip)
      console.log(`[sync-fip] official ${fip}: ${officials.length} players`)

      for (const p of officials) {
        const fullName = fipFullName(p)
        const playerId = playerMap.get(normalize(fullName))

        if (playerId) {
          const { error } = await supabase
            .from('players')
            .update({
              ranking: p.rank,
              points: p.points,
              ranking_move: p.move,
              updated_at: new Date().toISOString(),
            })
            .eq('id', playerId)

          if (error) console.error(`[sync-fip] official update error for ${fullName}:`, error.message)
          else results.official.matched++
        } else {
          results.official.unmatched++
        }
      }
    }

    // ── Race rankings ──────────────────────────────────────────────────
    if (!typeFilter || typeFilter === 'race') {
      const races = await fetchRaceRankings(fip)
      console.log(`[sync-fip] race ${fip}: ${races.length} players`)

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
              updated_at: new Date().toISOString(),
            })
            .eq('id', playerId)

          if (error) console.error(`[sync-fip] race update error for ${fullName}:`, error.message)
          else results.race.matched++
        } else {
          results.race.unmatched++
        }
      }
    }
  }

  return NextResponse.json({ ok: true, ...results })
}
