// Server-side data layer for /tournaments.
//
// One round-trip strategy: pull every tournament for the requested year
// in a single query, then a second query for champions of the completed
// ones. ~100 tournaments/year stays comfortably under the PostgREST
// max-rows cap; champions query touches ~50 finals + their player joins.
//
// Live status is derived simply: today between starts_at and ends_at.
// Phase 2 will refine this with a "has live matches in the last hour"
// signal — agreed scope-cut for the first ship.

import { createServerClient } from '@/lib/supabase'
import type {
  TournamentSummary,
  TournamentStatus,
  ChampionPair,
  PremierSpotlightData,
  EventosPageData,
} from './types'

// ── Tier buckets ───────────────────────────────────────────────────
//
// Mirrors the constants in src/components/home/TournamentsView.tsx but
// adds the v2 buckets (top / mid / base) the new design uses. Keep this
// list in sync with src/lib/source-priority.ts and
// padelgod/src/lib/fip-categories.ts when new tiers land.

const PREMIER_LEVELS = ['major', 'p1', 'p2', 'finals'] as const
const FIP_TOP_LEVELS = ['fip_platinum', 'fip_gold'] as const
const FIP_MID_LEVELS = ['fip_silver', 'fip_bronze'] as const
const FIP_BASE_LEVELS = [
  'fip_beyond',
  'fip_promises',
  'fip_other',
  'fip_hexagon',
  'fip_championship',
  'fip_star',
  'fip_rise',
  'fip_promotion',
  'fip_finals',
] as const

function bucketForLevel(
  level: string | null,
): TournamentSummary['tierBucket'] {
  if (!level) return 'fip_base'
  const l = level.toLowerCase()
  if ((PREMIER_LEVELS as readonly string[]).includes(l)) return 'premier'
  if ((FIP_TOP_LEVELS as readonly string[]).includes(l)) return 'fip_top'
  if ((FIP_MID_LEVELS as readonly string[]).includes(l)) return 'fip_mid'
  return 'fip_base'
}

// ── Status derivation ──────────────────────────────────────────────

function deriveStatus(
  startsAt: string,
  endsAt: string,
  now: Date,
): TournamentStatus {
  const start = new Date(startsAt).getTime()
  const end = new Date(endsAt).getTime()
  const t = now.getTime()
  // End-of-day grace: if endsAt is today, treat as still live until the
  // calendar day flips. Avoids a Sunday-final tournament flipping to
  // "completed" mid-afternoon while the final is still being played.
  const endOfEndDay = end + 24 * 60 * 60 * 1000 - 1
  if (t >= start && t <= endOfEndDay) return 'live'
  if (t < start) return 'upcoming'
  return 'completed'
}

function daysBetween(a: Date, b: Date): number {
  const ms = b.getTime() - a.getTime()
  return Math.ceil(ms / (24 * 60 * 60 * 1000))
}

// ── Champion derivation ────────────────────────────────────────────
//
// A champion = winner of the Final round of a tournament. We look at
// every Final-round match across the requested tournament IDs in one
// query, then group by tournament + category. Round-name canonicalisation
// covers the "Final" / "Finals" / "F" variants the populator emits.

interface FinalMatchRow {
  tournament_id: string
  category: 'men' | 'women' | null
  winner_pair: number | null
  pair1_player1: { name: string | null } | { name: string | null }[] | null
  pair1_player2: { name: string | null } | { name: string | null }[] | null
  pair2_player1: { name: string | null } | { name: string | null }[] | null
  pair2_player2: { name: string | null } | { name: string | null }[] | null
}

const FINAL_ROUND_LABELS = ['Final', 'Finals', 'F', 'final', 'finals']

function lastName(full: string | null | undefined): string {
  if (!full) return ''
  const parts = full.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1] : full
}

function firstName(p: FinalMatchRow['pair1_player1']): string | null {
  if (!p) return null
  if (Array.isArray(p)) return p[0]?.name ?? null
  return p.name ?? null
}

async function fetchChampionsForTournaments(
  supabase: ReturnType<typeof createServerClient>,
  tournamentIds: string[],
): Promise<Map<string, ChampionPair[]>> {
  const out = new Map<string, ChampionPair[]>()
  if (tournamentIds.length === 0) return out

  const { data, error } = await supabase
    .from('matches')
    .select(
      `tournament_id, category, winner_pair, round, status,
       pair1_player1:players!matches_pair1_player1_id_fkey(name),
       pair1_player2:players!matches_pair1_player2_id_fkey(name),
       pair2_player1:players!matches_pair2_player1_id_fkey(name),
       pair2_player2:players!matches_pair2_player2_id_fkey(name)`,
    )
    .in('tournament_id', tournamentIds)
    .in('round', FINAL_ROUND_LABELS)
    .eq('status', 'finished')
    .not('winner_pair', 'is', null)

  if (error) {
    console.error('[/tournaments] fetchChampions failed:', error.message)
    return out
  }

  for (const raw of (data ?? []) as unknown as FinalMatchRow[]) {
    if (!raw.tournament_id || !raw.category || !raw.winner_pair) continue
    const winnerSlot = raw.winner_pair === 1 ? 'pair1' : 'pair2'
    const finalistSlot = raw.winner_pair === 1 ? 'pair2' : 'pair1'

    const winner1 = firstName(raw[`${winnerSlot}_player1` as const])
    const winner2 = firstName(raw[`${winnerSlot}_player2` as const])
    const finalist1 = firstName(raw[`${finalistSlot}_player1` as const])
    const finalist2 = firstName(raw[`${finalistSlot}_player2` as const])

    const pairs: ChampionPair[] = []
    if (winner1 && winner2) {
      pairs.push({
        category: raw.category,
        rank: 1,
        player1Name: lastName(winner1),
        player2Name: lastName(winner2),
      })
    }
    if (finalist1 && finalist2) {
      pairs.push({
        category: raw.category,
        rank: 2,
        player1Name: lastName(finalist1),
        player2Name: lastName(finalist2),
      })
    }

    const existing = out.get(raw.tournament_id) ?? []
    out.set(raw.tournament_id, [...existing, ...pairs])
  }

  // Sort each tournament's champions so men's appears first. The
  // Premier Spotlight picks the first gold + first silver via .find(),
  // so this guarantees the men's pair shows up by default. Casual fans
  // are typically more familiar with the men's tour; women's still
  // appears in TournamentCard's full champion list on completed cards.
  for (const [id, pairs] of out) {
    const sorted = [...pairs].sort((a, b) => {
      if (a.category !== b.category) return a.category === 'men' ? -1 : 1
      return a.rank - b.rank
    })
    out.set(id, sorted)
  }
  return out
}

// ── Premier Spotlight derivation ───────────────────────────────────

function deriveSpotlight(
  tournaments: TournamentSummary[],
  now: Date,
): PremierSpotlightData {
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  const recentlyCompletedPremier = tournaments
    .filter(
      (t) =>
        t.tierBucket === 'premier' &&
        t.status === 'completed' &&
        new Date(t.ends_at) >= ninetyDaysAgo &&
        t.champions !== null &&
        t.champions.length > 0,
    )
    .sort(
      (a, b) =>
        new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime(),
    )

  const upcomingPremier = tournaments
    .filter((t) => t.tierBucket === 'premier' && t.status === 'upcoming')
    .sort(
      (a, b) =>
        new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
    )

  return {
    lastChampion: recentlyCompletedPremier[0] ?? null,
    nextPremier: upcomingPremier[0] ?? null,
  }
}

// ── Main entry ─────────────────────────────────────────────────────

interface TournamentRow {
  id: string
  name: string | null
  slug: string | null
  country: string | null
  location: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
  logo_url: string | null
}

export async function fetchEventosPageData(
  year: number = new Date().getUTCFullYear(),
): Promise<EventosPageData> {
  const supabase = createServerClient()
  const now = new Date()

  // Year window — inclusive of the whole calendar year.
  const yearStart = `${year}-01-01T00:00:00Z`
  const yearEnd = `${year + 1}-01-01T00:00:00Z`

  const { data: rows, error } = await supabase
    .from('tournaments')
    .select(
      'id, name, slug, country, location, level, starts_at, ends_at, logo_url',
    )
    .gte('starts_at', yearStart)
    .lt('starts_at', yearEnd)
    .order('starts_at', { ascending: true })

  if (error) {
    console.error('[/tournaments] fetchEventosPageData failed:', error.message)
    return {
      year,
      spotlight: { lastChampion: null, nextPremier: null },
      tournaments: [],
      archiveYears: [],
    }
  }

  // Filter out tournaments missing the dates we need.
  const valid = ((rows ?? []) as TournamentRow[]).filter(
    (r) => r.starts_at != null && r.ends_at != null && r.name != null,
  )

  // Champions for completed-only — saves a join for live + upcoming
  // tournaments which can't have champions yet.
  const completedIds = valid
    .filter((r) => deriveStatus(r.starts_at!, r.ends_at!, now) === 'completed')
    .map((r) => r.id)
  const championsByTournament = await fetchChampionsForTournaments(
    supabase,
    completedIds,
  )

  const tournaments: TournamentSummary[] = valid.map((r) => {
    const status = deriveStatus(r.starts_at!, r.ends_at!, now)
    const startDate = new Date(r.starts_at!)
    const champions = championsByTournament.get(r.id) ?? null
    return {
      id: r.id,
      name: r.name!,
      slug: r.slug,
      country: r.country,
      location: r.location,
      level: r.level,
      starts_at: r.starts_at!,
      ends_at: r.ends_at!,
      logo_url: r.logo_url,
      status,
      daysUntilStart: status === 'upcoming' ? daysBetween(now, startDate) : null,
      champions: status === 'completed' ? champions : null,
      tierBucket: bucketForLevel(r.level),
    }
  })

  const spotlight = deriveSpotlight(tournaments, now)

  // Archive footer — count of tournaments per year, excluding current.
  const archiveYears = await fetchArchiveYears(supabase, year)

  return { year, spotlight, tournaments, archiveYears }
}

async function fetchArchiveYears(
  supabase: ReturnType<typeof createServerClient>,
  excludeYear: number,
): Promise<Array<{ year: number; count: number }>> {
  // Coarse aggregate via three single-year counts. The volume here is
  // ~50 tournaments/year so we can just use Prefer count+limit. Three
  // sequential round-trips is cheap and avoids needing a custom RPC.
  const out: Array<{ year: number; count: number }> = []
  for (let y = excludeYear - 1; y >= excludeYear - 3; y--) {
    const start = `${y}-01-01T00:00:00Z`
    const end = `${y + 1}-01-01T00:00:00Z`
    const { count } = await supabase
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .gte('starts_at', start)
      .lt('starts_at', end)
    if ((count ?? 0) > 0) out.push({ year: y, count: count ?? 0 })
  }
  return out
}
