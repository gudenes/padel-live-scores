// Recorded human trades plus explicitly labelled, local-only simulation trades.
import { localMarketActivity } from '@/lib/local-market-activity'
import { requirePlayAccess } from '@/lib/play-access'
import {
  MARKET_SELECT,
  describeMarket,
  num,
  parseLocale,
  playNotFound,
  type MarketRow,
} from '../_shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIMIT = 30

interface TradeRow {
  id: number
  market_id: string
  user_id: string
  side: 'yes' | 'no'
  direction: 'buy' | 'sell'
  shares: string | number
  cost_guacas: number
  price: string | number
  created_at: string
}

interface ProfileRow {
  id: string
  avatar_url: string | null
  display_name: string | null
}

export async function GET(req: Request) {
  const access = await requirePlayAccess()
  if (!access) return playNotFound()
  const { supabase } = access

  const params = new URL(req.url).searchParams
  const locale = parseLocale(params.get('locale'))
  const marketId = params.get('marketId')
  if (marketId && !/^[a-f0-9-]{36}$/i.test(marketId)) return Response.json({ error: 'invalid_market' }, { status: 400 })
  const simulated = localMarketActivity(req, marketId)

  let query = supabase
    .from('market_trades')
    .select('id, market_id, user_id, side, direction, shares, cost_guacas, price, created_at')
    .order('created_at', { ascending: false })
    .limit(LIMIT)
  if (marketId) query = query.eq('market_id', marketId)
  const { data: tradeData, error: tradeErr } = await query

  if (tradeErr) {
    console.error('[play/activity] trades query failed:', tradeErr.message)
    return Response.json({ error: 'query_failed' }, { status: 500 })
  }

  const trades = (tradeData ?? []) as unknown as TradeRow[]


  // Two lookups rather than PostgREST embeds: `market_trades` has no FK-named
  // embed to `profiles` that reads cleanly alongside the deep MARKET_SELECT,
  // and 30 rows collapse to a handful of distinct markets and users.
  const marketIds = [...new Set([...trades.map((t) => t.market_id), ...simulated.map(t => t.marketId)])]
  const userIds = [...new Set(trades.map((t) => t.user_id))]

  const [mktRes, profRes] = await Promise.all([
    marketIds.length ? supabase.from('markets').select(MARKET_SELECT).in('id', marketIds) : Promise.resolve({ data: [], error: null }),
    userIds.length ? supabase.from('profiles').select('id, display_name, avatar_url').in('id', userIds) : Promise.resolve({ data: [], error: null }),
  ])

  if (mktRes.error || profRes.error) {
    console.error(
      '[play/activity] join query failed:',
      mktRes.error?.message ?? profRes.error?.message,
    )
    return Response.json({ error: 'query_failed' }, { status: 500 })
  }

  const now = Date.now()
  const markets = new Map(
    ((mktRes.data ?? []) as unknown as MarketRow[]).map((m) => [
      m.id,
      describeMarket(m, locale, now),
    ]),
  )
  const statuses = new Map(((mktRes.data ?? []) as unknown as MarketRow[]).map(m => [m.id,
    m.status === 'open' && Date.parse(m.locks_at) <= now ? 'locked' : m.status]))
  const profiles = new Map(
    ((profRes.data ?? []) as unknown as ProfileRow[]).map((p) => [p.id, p]),
  )

  return Response.json({
    trades: [...trades.map((t) => ({
      id: String(t.id),
      marketId: t.market_id,
      marketStatus: statuses.get(t.market_id) ?? null,
      publicId: markets.get(t.market_id)?.publicId ?? null,
      question: markets.get(t.market_id)?.question ?? null,
      context: markets.get(t.market_id)?.context ?? null,
      // A real user with no display_name set is anonymous, not invented.
      displayName: profiles.get(t.user_id)?.display_name?.trim() || null,
      userId: t.user_id,
      isMe: t.user_id === access.userId,
      isSimulation: false,
      avatarUrl: profiles.get(t.user_id)?.avatar_url ?? null,
      side: t.side,
      direction: t.direction,
      shares: num(t.shares),
      // Magnitude here, matching /api/play/trade's response. The signed value
      // lives in the column; `direction` tells the client which way it went.
      guacas: Math.abs(t.cost_guacas),
      price: num(t.price),
      createdAt: t.created_at,
    })), ...simulated.map(t => ({ ...t, marketStatus: statuses.get(t.marketId) ?? null }))].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, LIMIT),
  }, { headers: { 'Cache-Control': 'private, no-store' } })
}
