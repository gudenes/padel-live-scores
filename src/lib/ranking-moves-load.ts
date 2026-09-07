// src/lib/ranking-moves-load.ts
// Loads the latest official week vs the previous official week from
// player_ranking_snapshots and runs the pure composer. Shared by
// /api/push/notify-ranking (prod) and /api/admin/test-push (operator Test).

import type { SupabaseClient } from '@supabase/supabase-js'
import { paginatedSelect } from '@/lib/db-paginate'
import {
  composeRankingCopy,
  diffOfficialWeeks,
  pickLatestAndPreviousWeeks,
  rankingDedupeKey,
  rankingFallbackCopy,
  type RankingBulletin,
  type RankingPlayer,
  type RankingSnapshotRow,
  type RankingYearWeek,
} from '@/lib/ranking-moves'

type Supa = Pick<SupabaseClient, 'from'>

export async function loadLiveRankingBulletin(supabase: Supa): Promise<RankingBulletin | null> {
  const weekRows = await paginatedSelect<RankingYearWeek>(
    (start, end) =>
      supabase
        .from('player_ranking_snapshots')
        .select('year, week')
        .eq('type', 'official')
        .order('year', { ascending: false })
        .order('week', { ascending: false })
        .range(start, end),
    { what: 'player_ranking_snapshots weeks', pageSize: 2000, maxRows: 6000 },
  )
  const pair = pickLatestAndPreviousWeeks(weekRows)
  if (!pair) return null

  const snapshots = await paginatedSelect<RankingSnapshotRow>(
    (start, end) =>
      supabase
        .from('player_ranking_snapshots')
        .select('player_id, ranking, ranking_move, gender, year, week')
        .eq('type', 'official')
        .or(
          `and(year.eq.${pair.current.year},week.eq.${pair.current.week}),and(year.eq.${pair.previous.year},week.eq.${pair.previous.week})`,
        )
        .range(start, end),
    { what: 'player_ranking_snapshots pair', pageSize: 2000, maxRows: 20_000 },
  )

  const current = snapshots.filter((r) => r.year === pair.current.year && r.week === pair.current.week)
  const previous = snapshots.filter((r) => r.year === pair.previous.year && r.week === pair.previous.week)
  const ids = [...new Set([...current, ...previous].map((r) => r.player_id))]
  if (ids.length === 0) return null

  const players: RankingPlayer[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('players')
      .select('id, name, display_name, avatar_url')
      .in('id', ids.slice(i, i + 200))
    if (error) {
      console.error('[ranking-moves] players read failed:', error.message)
      continue
    }
    players.push(...((data ?? []) as RankingPlayer[]))
  }

  return diffOfficialWeeks(current, previous, players)
}

export function rankingPushFromBulletin(
  bulletin: RankingBulletin,
  locale: string,
): {
  title: string
  body: string
  url: string
  icon: string
  year: number
  week: number
  dedupeKey: string
} {
  const copy = composeRankingCopy(bulletin, locale)
  return {
    ...copy,
    url: bulletin.url,
    icon: bulletin.icon,
    year: bulletin.year,
    week: bulletin.week,
    dedupeKey: rankingDedupeKey(bulletin.year, bulletin.week),
  }
}

export async function composeRankingTestPayload(
  supabase: Supa,
  locale = 'en',
): Promise<{ title: string; body: string; url: string; icon: string; usedFallback: boolean }> {
  try {
    const bulletin = await loadLiveRankingBulletin(supabase)
    if (!bulletin) return { ...rankingFallbackCopy(locale), usedFallback: true }
    const payload = rankingPushFromBulletin(bulletin, locale)
    return {
      title: payload.title,
      body: payload.body,
      url: payload.url,
      icon: payload.icon,
      usedFallback: false,
    }
  } catch (err) {
    console.error('[ranking-moves] composeRankingTestPayload failed:', (err as Error).message)
    return { ...rankingFallbackCopy(locale), usedFallback: true }
  }
}
