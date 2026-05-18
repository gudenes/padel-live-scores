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
import { ensureAvatarsBucket, rehostAvatarToSupabase } from '@/lib/avatar-rehost'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

type SnapshotRow = {
  player_id: string
  type: 'official' | 'race'
  gender: 'men' | 'women'
  year: number
  week: number
  ranking_date: string  // ISO date "YYYY-MM-DD"
  ranking: number
  points: number | null
  ranking_move: number | null
  source: 'vercel-fip-manual'
}

/** Best-effort historical ranking write. Never throws — logs to console.error on failure. */
async function writeSnapshot(row: SnapshotRow) {
  const { error } = await supabase
    .from('player_ranking_snapshots')
    .upsert(row, {
      onConflict: 'player_id,type,year,week',
      ignoreDuplicates: false,
    })
  if (error) console.error('[sync-fip] snapshot upsert failed:', error.message, row)
}

// ISO 8601 week numbering: Thursday's year decides the week's year; week 1 contains Jan 4.
function isoYearWeek(d: Date): { year: number; week: number; mondayIso: string } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // shift to Thursday of this week
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  const monday = new Date(date)
  monday.setUTCDate(date.getUTCDate() - 3)
  return { year: date.getUTCFullYear(), week, mondayIso: monday.toISOString().slice(0, 10) }
}

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

  // FIP's race endpoint concatenates multiple race series in a single
  // response (Premier-circuit main race followed by what looks like a
  // sub-tier — players with single-digit / low-double-digit points whose
  // `race_rank` numbering RESETS back near 17 even though they appear
  // at position 130+ in the response). Without trimming, those sub-tier
  // players get written with race_rank values that collide with real
  // top-circuit players and surface side-by-side on the public rankings
  // page (e.g. Roper #25 with 22 pts next to Alfonso #25 with 556 pts).
  //
  // Detect the boundary as the first row whose race_rank drops by 50%
  // or more relative to the running max. A "halving" of the rank is a
  // far stronger signal than an absolute delta — within FIP's series 1
  // ranks oscillate freely (men's 2026-05-11 data dips to rank 82 with
  // max 100, women's dips to rank 79 with max 100, both still in the
  // main race), so an absolute threshold of 10 false-trims those. The
  // real boundaries are dramatic: men's series 2 starts at rank 17 vs
  // max 100 (17*2 < 100), women's at rank 20 vs max 100 (20*2 < 100).
  // Guard with `maxRank >= 30` to avoid early-iteration false positives
  // when the running max hasn't grown yet.
  let maxRank = 0
  for (let i = 0; i < all.length; i++) {
    if (maxRank >= 30 && all[i].race_rank * 2 < maxRank) {
      console.log(`[sync-fip] race ${gender}: trimming at pos ${i} (rank ${all[i].race_rank} after max ${maxRank}) — keeping ${i} entries from ${all.length}`)
      return all.slice(0, i)
    }
    if (all[i].race_rank > maxRank) maxRank = all[i].race_rank
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
    avatars:  { rehosted: 0, skipped: 0, failed: 0 },
  }

  // FIP serves player thumbnails on padelfip.com/wp-content/uploads/*. If we
  // store those raw URLs, push-notification largeIcons silently fail whenever
  // padelfip.com hiccups. Instead: don't pass the raw URL to the resolver,
  // collect (playerId, thumbnail) pairs as we go, and rehost in parallel
  // batches after the loop so the daily cron stays well under 120s.
  const avatarJobs: Array<{ playerId: string; thumbnail: string }> = []

  // Bucket creation is idempotent — safe to call before every sync run.
  await ensureAvatarsBucket(supabase)

  // Cron path can split work across 4 invocations (one per gender × type) to
  // stay under Vercel's 120s maxDuration budget. Per-player resolver round
  // trips (2-3 each × 4000 players) blow past 120s on the unsplit path.
  const ALL_GENDERS: Array<{ fip: 'male' | 'female'; db: 'men' | 'women' }> = [
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
      // FIP labels rankings by ISO 8601 year/week (its WP endpoint takes year+week
      // params). We re-derive (year, week, monday) from the FIP-returned Monday via
      // isoYearWeek so storage stays canonical-ISO at year boundaries.
      const officialYearWeek = isoYearWeek(new Date(rankingDate))
      console.log(`[sync-fip] official ${fip}: ${officials.length} players fetched (ranking date: ${rankingDate})`)

      for (const p of officials) {
        const fullName = fipFullName(p)
        // Raw FIP id (no prefix). Legacy "fip-" prefix unwound in
        // merge-duplicate-players PR.
        const fipId = p.player_id
        const country2 = fipCountryToIso2(p.country_name)

        try {
          const resolveResult = await resolver.resolveAndEnrich({
            name: fullName,
            fipId,
            category: db,
            country: country2,
            ranking: p.rank,
            points: p.points,
            rankingMove: p.move,
            // Skip avatar — rehosted to Supabase Storage post-loop. Passing
            // the raw padelfip.com URL would mean a player's largeIcon push
            // notification breaks the moment padelfip.com hiccups.
            avatarUrl: null,
            profileUrl: p.url || null,
            rankingDate,
          })

          if (resolveResult.action === 'created') results.official.created++
          else results.official.updated++

          if (p.thumbnail) {
            avatarJobs.push({ playerId: resolveResult.playerId, thumbnail: p.thumbnail })
          }

          await writeSnapshot({
            player_id: resolveResult.playerId,
            type: 'official',
            gender: db,
            year: officialYearWeek.year,
            week: officialYearWeek.week,
            ranking_date: officialYearWeek.mondayIso,
            ranking: p.rank,
            points: p.points,
            ranking_move: p.move,
            source: 'vercel-fip-manual',
          })
        } catch (err: any) {
          console.error(`[sync-fip] error for ${fullName}:`, err.message)
          results.official.unmatched++
        }
      }
    }

    // ── Race rankings ──────────────────────────────────────────────────
    if (!typeFilter || typeFilter === 'race') {
      const races = await fetchRaceRankings(fip, top)
      const raceYearWeek = isoYearWeek(new Date())
      console.log(`[sync-fip] race ${fip}: ${races.length} players fetched`)

      // Track which player UUIDs got a race row this run so we can NULL
      // race_ranking/race_points/race_move on players who DROPPED OUT
      // of the race since the previous sync. Without this, the page
      // keeps showing stale leaderboard positions for players who are
      // no longer in the current race series (e.g. the multi-series
      // contamination we trim in fetchRaceRankings — players that used
      // to be written from the second series stay stuck at race_rank=23
      // forever otherwise).
      const writtenPlayerIds = new Set<string>()

      for (const p of races) {
        const fullName = fipFullName(p)
        // Raw FIP id (no prefix). See note in officials loop above.
        const fipId = p.player_id

        try {
          const resolveResult = await resolver.resolveAndEnrich({
            name: fullName,
            fipId,
            category: db,
            raceRanking: p.race_rank,
            racePoints: p.race_points,
            raceMove: p.race_move,
          })

          if (resolveResult.action === 'created') results.race.created++
          else results.race.updated++
          writtenPlayerIds.add(resolveResult.playerId)

          await writeSnapshot({
            player_id: resolveResult.playerId,
            type: 'race',
            gender: db,
            year: raceYearWeek.year,
            week: raceYearWeek.week,
            ranking_date: raceYearWeek.mondayIso,
            ranking: p.race_rank,
            points: p.race_points,
            ranking_move: p.race_move,
            source: 'vercel-fip-manual',
          })
        } catch {
          results.race.unmatched++
        }
      }

      // NULL race fields for this category's players that we didn't
      // write this run. Filtered to race_ranking IS NOT NULL so we only
      // touch rows that actually need clearing. UUID list passed via
      // `.not('id','in', ...)` would blow the URL cap at 1000+ ids, so
      // we instead fetch the previously-ranked ids and diff in memory.
      const { data: previouslyRanked } = await supabase
        .from('players')
        .select('id')
        .eq('category', db)
        .not('race_ranking', 'is', null)
      const toClear = (previouslyRanked ?? [])
        .map(r => r.id as string)
        .filter(id => !writtenPlayerIds.has(id))
      if (toClear.length > 0) {
        console.log(`[sync-fip] race ${fip}: clearing race fields on ${toClear.length} players that dropped out of the race`)
        // Chunk to avoid URL-length limits on the IN list.
        const CHUNK = 200
        for (let i = 0; i < toClear.length; i += CHUNK) {
          const slice = toClear.slice(i, i + CHUNK)
          await supabase
            .from('players')
            .update({ race_ranking: null, race_points: null, race_move: null })
            .in('id', slice)
        }
      }
    }
  }

  // ── Avatar rehosting ─────────────────────────────────────────────────
  // After resolving all players, rehost any padelfip thumbnails to
  // Supabase Storage. The helper short-circuits when the player already
  // has a Supabase-hosted avatar, so the steady-state cost after the
  // initial backfill is ~1 SELECT per player (no network downloads).
  const REHOST_BATCH = 20
  for (let i = 0; i < avatarJobs.length; i += REHOST_BATCH) {
    const chunk = avatarJobs.slice(i, i + REHOST_BATCH)
    const outcomes = await Promise.all(
      chunk.map(j => rehostAvatarToSupabase(supabase, j.playerId, j.thumbnail)),
    )
    for (const o of outcomes) {
      if (o.status === 'ok') results.avatars.rehosted++
      else if (o.status.startsWith('skipped')) results.avatars.skipped++
      else {
        results.avatars.failed++
        console.warn(`[sync-fip] avatar rehost ${o.status} for ${o.playerId}: ${o.detail ?? ''}`)
      }
    }
  }

  return NextResponse.json({ ok: true, top, ...results })
}
