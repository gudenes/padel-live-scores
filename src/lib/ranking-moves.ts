// src/lib/ranking-moves.ts
// Pure composer for the weekly ranking_updated bulletin. Diffs two official
// snapshot weeks, picks the biggest top-30 climb and the biggest top-30 drop,
// and formats a generic title + "what changed" body. Does not trust
// ranking_move alone: the previous week's ranking is the source of truth,
// with ranking_move only as fallback when that row is missing.

import { playerLastName } from '@/lib/player-name'
import { resolveNotificationIcon } from '@/lib/notification-icon'
import { composeRankingUpdated, rankingFallbackCopy as fallbackTitleBody } from '@/lib/push-copy'

export type RankingSnapshotRow = {
  player_id: string
  ranking: number
  ranking_move: number | null
  gender: 'men' | 'women' | string
  year: number
  week: number
}

export type RankingPlayer = {
  id: string
  name: string | null
  display_name: string | null
  avatar_url: string | null
}

export type RankingMover = {
  playerId: string
  lastName: string
  gender: 'men' | 'women'
  currentRank: number
  previousRank: number | null
  move: number
  avatarUrl: string | null
}

export type RankingHeadlineKind = 'increase' | 'decrease'

export type RankingBulletin = {
  year: number
  week: number
  headlineKind: RankingHeadlineKind
  headline: RankingMover
  biggestIncrease: RankingMover | null
  biggestDecrease: RankingMover | null
  movers: RankingMover[]
  url: string
  icon: string
}

export type RankingYearWeek = { year: number; week: number }

const TOP_N = 30
const MIN_ABS_MOVE = 2

function weekKey(w: RankingYearWeek): number {
  return w.year * 100 + w.week
}

export function pickLatestAndPreviousWeeks(weeks: RankingYearWeek[]): {
  current: RankingYearWeek
  previous: RankingYearWeek
} | null {
  const uniq = new Map<number, RankingYearWeek>()
  for (const w of weeks) uniq.set(weekKey(w), { year: w.year, week: w.week })
  const sorted = [...uniq.values()].sort((a, b) => weekKey(b) - weekKey(a))
  if (sorted.length < 2) return null
  return { current: sorted[0], previous: sorted[1] }
}

function asGender(value: string | null | undefined): 'men' | 'women' {
  return value === 'women' ? 'women' : 'men'
}

function hostedAvatar(url: string | null | undefined): string | null {
  if (url && url.includes('supabase.co/storage')) return url
  return null
}

function indexPlayers(players: RankingPlayer[] | Record<string, RankingPlayer>): Map<string, RankingPlayer> {
  if (Array.isArray(players)) return new Map(players.map((p) => [p.id, p]))
  return new Map(Object.entries(players))
}

function compareClimb(a: RankingMover, b: RankingMover): number {
  if (b.move !== a.move) return b.move - a.move
  if (a.currentRank !== b.currentRank) return a.currentRank - b.currentRank
  return a.lastName.localeCompare(b.lastName)
}

function compareDrop(a: RankingMover, b: RankingMover): number {
  if (a.move !== b.move) return a.move - b.move
  if (a.currentRank !== b.currentRank) return a.currentRank - b.currentRank
  return a.lastName.localeCompare(b.lastName)
}

export function diffOfficialWeeks(
  current: RankingSnapshotRow[],
  previous: RankingSnapshotRow[],
  players: RankingPlayer[] | Record<string, RankingPlayer>,
): RankingBulletin | null {
  if (current.length === 0) return null
  const dir = indexPlayers(players)
  const prevById = new Map(previous.map((r) => [r.player_id, r]))

  const movers: RankingMover[] = []

  for (const row of current) {
    const prev = prevById.get(row.player_id)
    const currentRank = row.ranking
    const previousRank = prev?.ranking ?? null
    const move =
      previousRank != null
        ? previousRank - currentRank
        : typeof row.ranking_move === 'number'
          ? row.ranking_move
          : null
    if (move == null) continue

    const inTopNow = currentRank >= 1 && currentRank <= TOP_N
    const inTopBefore = previousRank != null && previousRank >= 1 && previousRank <= TOP_N
    if (!inTopNow && !inTopBefore) continue
    if (Math.abs(move) < MIN_ABS_MOVE) continue

    const p = dir.get(row.player_id)
    const lastName = playerLastName(p ?? { name: null, display_name: null })
    movers.push({
      playerId: row.player_id,
      lastName,
      gender: asGender(row.gender),
      currentRank,
      previousRank,
      move,
      avatarUrl: hostedAvatar(p?.avatar_url ?? null),
    })
  }

  // Exits: previous top-30 with no current row are skipped (no current rank to show).

  const biggestIncrease = movers.filter((m) => m.move > 0).sort(compareClimb)[0] ?? null
  const biggestDecrease = movers.filter((m) => m.move < 0).sort(compareDrop)[0] ?? null
  const headline = biggestIncrease ?? biggestDecrease
  if (!headline) return null

  const latest = current.reduce(
    (best, r) => (weekKey(r) > weekKey(best) ? r : best),
    current[0],
  )

  return {
    year: latest.year,
    week: latest.week,
    headlineKind: biggestIncrease ? 'increase' : 'decrease',
    headline,
    biggestIncrease,
    biggestDecrease,
    movers: [biggestIncrease, biggestDecrease].filter((m): m is RankingMover => !!m),
    url: `/rankings?gender=${headline.gender}&type=official&highlight=${headline.playerId}`,
    icon: resolveNotificationIcon({
      reason: 'follow',
      tournamentLevel: 'fip_gold',
      followedPlayerAvatarUrl: headline.avatarUrl,
    }),
  }
}

export function composeRankingCopy(
  bulletin: RankingBulletin,
  locale: string,
): { title: string; body: string } {
  return composeRankingUpdated({
    locale,
    increase: bulletin.biggestIncrease
      ? {
          name: bulletin.biggestIncrease.lastName,
          move: bulletin.biggestIncrease.move,
          rank: bulletin.biggestIncrease.currentRank,
        }
      : null,
    decrease: bulletin.biggestDecrease
      ? {
          name: bulletin.biggestDecrease.lastName,
          move: bulletin.biggestDecrease.move,
          rank: bulletin.biggestDecrease.currentRank,
        }
      : null,
  })
}

export function rankingFallbackCopy(locale: string): {
  title: string
  body: string
  url: string
  icon: string
} {
  const copy = fallbackTitleBody(locale)
  return {
    ...copy,
    url: '/rankings?type=official',
    icon: resolveNotificationIcon({ reason: 'bookmark', tournamentLevel: 'fip_gold' }),
  }
}

export function rankingDedupeKey(year: number, week: number): string {
  return `ranking_updated:${year}-${String(week).padStart(2, '0')}`
}
