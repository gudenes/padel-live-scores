import { supabase } from '@/lib/supabase'

/** One row as returned by the public.money_leaderboard RPC. */
export interface MoneyLeaderboardRpcRow {
  player_id: string
  name: string
  display_name: string | null
  country: string | null
  avatar_url: string | null
  total_eur: number
  event_count: number
}

/** RPC row plus its computed competition rank for display. */
export interface RankedMoneyRow extends MoneyLeaderboardRpcRow {
  rank: number
}

/**
 * Assign competition ranks over rows already sorted by total_eur DESC (the RPC's
 * ORDER BY). Equal totals share a competition rank (ties share a rank; the next distinct value skips — 1,1,3) —
 * mirroring the official-tab RankBadge ties.
 */
export function toRankedMoneyRows(rows: MoneyLeaderboardRpcRow[]): RankedMoneyRow[] {
  let lastTotal: number | null = null
  let lastRank = 0
  return rows.map((r, i) => {
    const rank = r.total_eur === lastTotal ? lastRank : i + 1
    lastTotal = r.total_eur
    lastRank = rank
    return { ...r, rank }
  })
}

/**
 * Fetch the YTD money leaderboard for a gender. Returns ranked rows ready to
 * render. Throws on RPC error so callers can surface an empty/error state.
 */
export async function fetchMoneyLeaderboard(
  gender: 'men' | 'women',
  year: number,
  limit = 500,
): Promise<RankedMoneyRow[]> {
  const { data, error } = await supabase.rpc('money_leaderboard', {
    p_category: gender,
    p_year: year,
    p_limit: limit,
  })
  if (error) throw error
  return toRankedMoneyRows((data ?? []) as MoneyLeaderboardRpcRow[])
}
