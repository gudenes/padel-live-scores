// src/app/api/play/me/route.ts
// GET /api/play/me?locale=en
//
// The caller's wallet: balance (bootstrapped on first touch) plus every open
// position marked to the current LMSR price.

import { requirePlayAccess } from '@/lib/play-access'
import {
  MARKET_SELECT,
  describeMarket,
  ensureBalance,
  num,
  parseLocale,
  playNotFound,
  sidePrice,
  type MarketRow,
  type PositionRow,
} from '../_shared'

export const dynamic = 'force-dynamic'

interface PositionView {
  matchId: string | null
  marketId: string
  publicId: string
  question: string
  context: string
  live: boolean
  status: string
  result: 'won' | 'lost' | 'refunded' | 'pending' | null
  corrected: boolean
  side: 'yes' | 'no'
  shares: number
  costBasis: number
  avgPrice: number
  currentPrice: number
  valueNow: number
  deltaPct: number
}

export async function GET(req: Request) {
  const access = await requirePlayAccess()
  if (!access) return playNotFound()
  const { supabase, userId } = access

  const locale = parseLocale(new URL(req.url).searchParams.get('locale'))

  const wallet = await ensureBalance(supabase, userId)
  if (!wallet) return Response.json({ error: 'no_active_season' }, { status: 503 })

  // RLS is bypassed by the service client, so this `.eq('user_id', …)` is the
  // ONLY thing separating this caller's positions from everyone else's.
  const { data: posData, error: posErr } = await supabase
    .from('market_positions')
    .select('market_id, user_id, yes_shares, no_shares, cost_basis, realised_pnl')
    .eq('user_id', userId)
    .or('yes_shares.gt.0,no_shares.gt.0')

  if (posErr) {
    console.error('[play/me] positions query failed:', posErr.message)
    return Response.json({ error: 'query_failed' }, { status: 500 })
  }

  const [payoutResponse, noticeResponse] = await Promise.all([
    supabase.from('market_payouts').select('market_id,yes_paid,no_paid,revision').eq('user_id', userId),
    supabase.from('play_result_notices').select('id,market_id,outcome,delta,reason,corrected,created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(10),
  ])
  // The local UI can run before the migration is applied. Other failures
  // must not present an unpaid or stale balance as a confirmed result.
  for (const response of [payoutResponse, noticeResponse]) {
    if (response.error && !['42P01', 'PGRST205'].includes(response.error.code)) {
      return Response.json({ error: 'query_failed' }, { status: 503 })
    }
  }
  const payouts = new Map((payoutResponse.data ?? []).map(p => [p.market_id, p]))
  const positions = (posData ?? []) as unknown as PositionRow[]
  let netWorth = wallet.balance
  const views: PositionView[] = []

  if (positions.length > 0) {
    // Fetched as a separate query rather than an embed on market_positions:
    // MARKET_SELECT is already three levels deep (markets → matches → players)
    // and hanging it off a fourth would make one fragile request out of two
    // cheap ones.
    const { data: mktData, error: mktErr } = await supabase
      .from('markets')
      .select(MARKET_SELECT)
      .in('id', positions.map((p) => p.market_id))


    if (mktErr) {
      console.error('[play/me] markets query failed:', mktErr.message)
      return Response.json({ error: 'query_failed' }, { status: 500 })
    }

    const markets = new Map(
      ((mktData ?? []) as unknown as MarketRow[]).map((m) => [m.id, m]),
    )
    const now = Date.now()

    for (const pos of positions) {
      const market = markets.get(pos.market_id)
      if (!market) continue
      const payout = payouts.get(market.id)
      const final = !!payout && ['settled', 'void'].includes(market.status)
      const view = describeMarket(market, locale, now)

      const yes = num(pos.yes_shares)
      const no = num(pos.no_shares)
      const yesValue = yes * view.priceYes
      const noValue = no * (1 - view.priceYes)
      const totalValue = yesValue + noValue
      if (!payout && market.season_id === wallet.seasonId) netWorth += totalValue

      // WHY BOTH ROWS RATHER THAN A NET SIDE: selling is per-side and is
      // checked against `market_positions.yes_shares` / `no_shares`
      // independently, so a user holding 50 yes and 30 no can sell 50 yes —
      // not the netted 20. Emitting a single net row would advertise a
      // sellable quantity that /api/play/trade would then reject.
      //
      // COST BASIS CAVEAT: `market_positions.cost_basis` is one integer for
      // the whole row; the schema records no per-side basis. For a two-sided
      // position we split it by each side's share of current value, so the
      // per-row `avgPrice` is an ALLOCATION, not a price anyone was charged.
      // The two rows still sum to the exact recorded basis. Single-sided
      // positions — the overwhelmingly common case — are exact.
      const sides: Array<{ side: 'yes' | 'no'; shares: number; value: number }> = []
      if (yes > 0) sides.push({ side: 'yes', shares: yes, value: yesValue })
      if (no > 0) sides.push({ side: 'no', shares: no, value: noValue })

      for (const s of sides) {
        const share = yes + no > 0 ? s.shares / (yes + no) : 1 / sides.length
        const basis = pos.cost_basis * share
        const paid = payout ? (s.side === 'yes' ? payout.yes_paid : payout.no_paid) : 0
        const value = payout ? paid : s.value
        const result = final ? market.status === 'void' ? 'refunded'
          : market.outcome === (s.side === 'yes') ? 'won' : 'lost'
          : market.status !== 'open' ? 'pending' : null
        views.push({
          marketId: market.id,
          matchId: market.match_id,
          publicId: market.public_id,
          question: view.question,
          context: view.context,
          live: view.live,
          status: market.status,
          result,
          corrected: (payout?.revision ?? 0) > 1,
          side: s.side,
          shares: s.shares,
          costBasis: basis,
          avgPrice: s.shares > 0 ? basis / s.shares : 0,
          currentPrice: final && market.status === 'settled' ? (result === 'won' ? 1 : 0) : sidePrice(view.priceYes, s.side),
          valueNow: value,
          deltaPct: basis > 0 ? ((value - basis) / basis) * 100 : 0,
        })
      }
    }
  }

  // Biggest exposure first — that is the row a user checks on.
  views.sort((a, b) => b.valueNow - a.valueNow)

  return Response.json({
    balance: wallet.balance,
    // `locked` is always 0 today: this version debits a buy immediately rather
    // than escrowing. The column exists for a future pending/limit-order flow.
    locked: wallet.locked,
    netWorth,
    positions: views,
    notices: (noticeResponse.data ?? []).map(n => ({ ...n, question: views.find(v => v.marketId === n.market_id)?.question ?? '' })),
  })
}
