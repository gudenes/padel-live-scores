// src/app/api/play/leaderboard/route.ts
// GET /api/play/leaderboard?period=week|season|all
//
// Ranks users by NET WORTH = guaca balance + mark-to-market value of every
// open position.
//
// ═══ REAL ROWS ONLY ═════════════════════════════════════════════════════
// `{ rows: [], me: null }` is the correct answer for an empty season. No
// filler entries or placeholder ranks. Local previews can also include recorded
// simulation wallets, explicitly marked and excluded from human prize ranks.
//
// ═══ WHAT `period` ACTUALLY DOES ════════════════════════════════════════
// Net worth is a point-in-time quantity, so a period cannot filter it the way
// it filters a P&L. Rather than invent a weekly figure we cannot compute, the
// parameter scopes WHO is ranked and over WHICH season:
//
//   season (default) — everyone with a balance in the active season
//   all              — same, summed across every season the user has played
//   week             — active season, restricted to users who traded in the
//                      trailing 7 days (an activity filter, not a P&L window)
//
// A true "gain this week" board needs a periodic net-worth snapshot table
// that does not exist yet; deriving it from guaca_ledger would capture
// realised cash movements only and silently ignore unrealised position value,
// which is most of a trader's net worth here. Better to be plainly scoped
// than subtly wrong.

import { localSimulationLeaders } from '@/lib/local-simulation-leaders'
import { paginatedSelect } from '@/lib/db-paginate'
import { requirePlayAccess } from '@/lib/play-access'
import { priceYes } from '@/lib/lmsr'
import {
  UNSETTLED_MARKET_STATUSES,
  getActiveSeason,
  num,
  playNotFound,
  positionValue,
} from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type Period = 'week' | 'season' | 'all'

function parsePeriod(raw: string | null): Period {
  return raw === 'week' || raw === 'all' ? raw : 'season'
}

interface BalanceScanRow {
  user_id: string
  season_id: string
  balance: number
}

interface PositionScanRow {
  user_id: string
  market_id: string
  yes_shares: string | number
  no_shares: string | number
}

interface MarketPriceRow {
  id: string
  q_yes: string | number
  q_no: string | number
  lmsr_b: string | number
}

interface ProfileRow {
  id: string
  display_name: string | null
  avatar_url: string | null
}

export async function GET(req: Request) {
  const access = await requirePlayAccess()
  if (!access) return playNotFound()
  const { supabase, userId } = access

  const period = parsePeriod(new URL(req.url).searchParams.get('period'))

  const season = await getActiveSeason(supabase)
  if (!season && period !== 'all') {
    return Response.json({ error: 'no_active_season' }, { status: 503 })
  }
  const seasonId = season?.id ?? null

  // ── Balances ─────────────────────────────────────────────────────────
  // Paginated per the PostgREST 10k policy: one row per user per season,
  // which grows with the user base rather than being bounded by anything.
  const balances = await paginatedSelect<BalanceScanRow>(
    (start, end) => {
      const q = supabase
        .from('user_guaca_balance')
        .select('user_id, season_id, balance')
        .range(start, end)
      return period === 'all' || !seasonId ? q : q.eq('season_id', seasonId)
    },
    { what: `user_guaca_balance (period=${period})` },
  )



  // ── Open positions, valued at the live book price ────────────────────
  const positions = await paginatedSelect<PositionScanRow>(
    (start, end) =>
      supabase
        .from('market_positions')
        .select('user_id, market_id, yes_shares, no_shares')
        .or('yes_shares.gt.0,no_shares.gt.0')
        .range(start, end),
    { what: 'market_positions (leaderboard)' },
  )

  const priceByMarket = new Map<string, number>()
  if (positions.length > 0) {
    const marketIds = [...new Set(positions.map((p) => p.market_id))]
    const markets = await paginatedSelect<MarketPriceRow>(
      (start, end) =>
        supabase
          .from('markets')
          .select('id, q_yes, q_no, lmsr_b')
          .in('id', marketIds)
          .in('status', UNSETTLED_MARKET_STATUSES)
          .is('settled_at', null)
          .range(start, end),
      { what: 'markets (leaderboard prices)' },
    )
    for (const m of markets) {
      const b = num(m.lmsr_b, 0)
      if (b > 0) priceByMarket.set(m.id, priceYes(num(m.q_yes), num(m.q_no), b))
    }
  }

  // ── Aggregate ────────────────────────────────────────────────────────
  const netWorth = new Map<string, number>()
  for (const row of balances) {
    netWorth.set(row.user_id, (netWorth.get(row.user_id) ?? 0) + row.balance)
  }
  for (const pos of positions) {
    // Markets absent from the price map are settled/void; their payout is the
    // settlement worker's to make, so they contribute nothing here.
    const p = priceByMarket.get(pos.market_id)
    if (p === undefined) continue
    // Only count positions held by users who have a balance row in scope,
    // otherwise `period=season` would leak last season's holdings in.
    if (!netWorth.has(pos.user_id)) continue
    netWorth.set(pos.user_id, netWorth.get(pos.user_id)! + positionValue(pos, p))
  }

  // ── `week`: restrict to users who traded in the trailing 7 days ──────
  let eligible = [...netWorth.keys()]
  if (period === 'week') {
    const since = new Date(Date.now() - WEEK_MS).toISOString()
    const recent = await paginatedSelect<{ user_id: string }>(
      (start, end) =>
        supabase
          .from('market_trades')
          .select('user_id')
          .gte('created_at', since)
          .range(start, end),
      { what: 'market_trades (weekly actives)' },
    )
    const active = new Set(recent.map((r) => r.user_id))
    eligible = eligible.filter((id) => active.has(id))
  }

  // Ties broken by user id so the ordering is stable across requests rather
  // than dependent on Map iteration order.
  const humanRanked = eligible
    .map((id) => ({ userId: id, netWorth: netWorth.get(id)! }))
    .sort((a, b) => b.netWorth - a.netWorth || a.userId.localeCompare(b.userId))

  let simulations: Awaited<ReturnType<typeof localSimulationLeaders>> = []
  try { simulations = await localSimulationLeaders(req, supabase, period) }
  catch { return Response.json({ error: 'simulation_unavailable' }, { status: 503 }) }
  const bots = new Map(simulations.map(b => [b.userId, b]))
  const ranked = [...humanRanked, ...simulations].sort((a,b) => b.netWorth-a.netWorth || a.userId.localeCompare(b.userId))
  if (ranked.length === 0) return Response.json({ rows: [], me: null })

  const myIndex = ranked.findIndex((r) => r.userId === userId)
  const humanRanks = new Map(humanRanked.map((entry, index) => [entry.userId, index + 1]))

  // Return the complete ladder, including players below the caller. Batch profile
  // lookups to stay below PostgREST row and URL limits as participation grows.
  const ids = humanRanked.map(entry => entry.userId)
  const profiles = new Map<string, ProfileRow>()
  for (let offset = 0; offset < ids.length; offset += 200) {
    const { data, error } = await supabase.from('profiles')
      .select('id, display_name, avatar_url').in('id', ids.slice(offset, offset + 200))
    if (error) {
      console.error('[play/leaderboard] profiles query failed:', error.message)
      return Response.json({ error: 'query_failed' }, { status: 500 })
    }
    for (const profile of (data ?? []) as ProfileRow[]) profiles.set(profile.id, profile)
  }

  const toRow = (entry: { userId: string; netWorth: number }, index: number) => ({
    rank: index + 1,
    userId: entry.userId,
    isSimulation: bots.has(entry.userId),
    prizeEligible: !bots.has(entry.userId),
    avatarSeed: bots.get(entry.userId)?.avatarSeed ?? null,
    humanRank: bots.has(entry.userId) ? null : humanRanks.get(entry.userId) ?? null,
    displayName: bots.get(entry.userId)?.displayName || profiles.get(entry.userId)?.display_name?.trim() || null,
    avatarUrl: profiles.get(entry.userId)?.avatar_url ?? null,
    netWorth: entry.netWorth,
    isMe: entry.userId === userId,
  })

  return Response.json({
    period,
    hasSimulation: simulations.length > 0,
    rows: ranked.map(toRow),
    // `me` carries the caller's TRUE rank, computed over the full ranking —
    // independent of where the user has scrolled in the ladder.
    me: myIndex >= 0 ? toRow(ranked[myIndex]!, myIndex) : null,
  })
}
