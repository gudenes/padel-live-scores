// Trades and settlement share a database row lock; all trade writes commit together.
import { isTrustedPlayWrite } from '@/lib/play-write-origin'
import { requirePlayAccess } from '@/lib/play-access'
import { priceYes, quoteBuy, quoteSell, type Side } from '@/lib/lmsr'
import { ensureBalance, num, playNotFound, type PositionRow } from '../_shared'

export const dynamic = 'force-dynamic'

/** Fallback if the singleton market_limits row is somehow unreadable. */
const DEFAULT_MAX_STAKE = 2000

/** Shares are numeric(14,4); compare holdings with a tolerance below that. */
const SHARE_EPSILON = 1e-6

interface TradeMarketRow {
  id: string
  season_id: string
  status: string
  locks_at: string
  lmsr_b: string | number
  q_yes: string | number
  q_no: string | number
  volume_guacas: string | number
  position_count: number
}

function bad(code: string, status: number, extra?: Record<string, unknown>) {
  return Response.json({ error: code, ...extra }, { status })
}

export async function POST(req: Request) {
  const access = await requirePlayAccess()
  if (!access) return playNotFound()
  if (!isTrustedPlayWrite(req)) return bad('invalid_origin', 403)
  const { supabase, userId } = access

  // ── Validate input ───────────────────────────────────────────────────
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return bad('invalid_body', 400)

  const marketId = typeof body.marketId === 'string' ? body.marketId.trim() : ''
  const side = body.side === 'yes' || body.side === 'no' ? (body.side as Side) : null
  const direction =
    body.direction === 'buy' || body.direction === 'sell' ? body.direction : null

  if (!marketId) return bad('invalid_market_id', 400)
  if (!side) return bad('invalid_side', 400)
  if (!direction) return bad('invalid_direction', 400)

  let stakeGuacas = 0
  let sellShares = 0

  if (direction === 'buy') {
    const g = body.guacas
    // Guacas are integers by definition — a fractional stake cannot be
    // debited from an integer balance column without silently rounding.
    if (typeof g !== 'number' || !Number.isFinite(g) || !Number.isInteger(g) || g <= 0) {
      return bad('invalid_guacas', 400)
    }
    stakeGuacas = g
  } else {
    const s = body.shares
    // Shares are numeric(14,4) — fractional is legitimate here, since
    // quoteBuy hands back fractional share counts.
    if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) {
      return bad('invalid_shares', 400)
    }
    sellShares = s
  }

  // ── Load the market ──────────────────────────────────────────────────
  const { data: mktData, error: mktErr } = await supabase
    .from('markets')
    .select('id, season_id, status, locks_at, lmsr_b, q_yes, q_no, volume_guacas, position_count')
    .eq('id', marketId)
    .maybeSingle()

  if (mktErr) {
    console.error('[play/trade] market lookup failed:', mktErr.message)
    return bad('query_failed', 500)
  }
  if (!mktData) return bad('market_not_found', 404)

  const market = mktData as unknown as TradeMarketRow
  if (market.status !== 'open') return bad('market_not_open', 409, { status: market.status })
  if (new Date(market.locks_at).getTime() <= Date.now()) return bad('market_locked', 409)

  const b = num(market.lmsr_b, 0)
  if (!(b > 0)) {
    console.error(`[play/trade] market ${marketId} has non-positive lmsr_b`)
    return bad('market_misconfigured', 500)
  }
  const qYes = num(market.q_yes)
  const qNo = num(market.q_no)

  // ── Wallet + existing position ───────────────────────────────────────
  const wallet = await ensureBalance(supabase, userId)
  if (!wallet) return bad('no_active_season', 503)
  if (wallet.seasonId !== market.season_id) {
    // Trading a market from an archived season against the current season's
    // wallet would mix two currencies. Refuse rather than pick one.
    return bad('season_mismatch', 409)
  }

  const { data: posData, error: posErr } = await supabase
    .from('market_positions')
    .select('market_id, user_id, yes_shares, no_shares, cost_basis, realised_pnl')
    .eq('market_id', marketId)
    .eq('user_id', userId) // service client bypasses RLS — this filter is the guard
    .maybeSingle()

  if (posErr) {
    console.error('[play/trade] position lookup failed:', posErr.message)
    return bad('query_failed', 500)
  }
  const position = (posData as unknown as PositionRow | null) ?? null
  const heldYes = num(position?.yes_shares)
  const heldNo = num(position?.no_shares)
  const heldOnSide = side === 'yes' ? heldYes : heldNo
  const costBasis = position?.cost_basis ?? 0
  const realisedPnl = position?.realised_pnl ?? 0

  // ── Quote ────────────────────────────────────────────────────────────
  let shares: number
  let cashDelta: number // signed: negative on buy, positive on sell
  let avgPrice: number
  let qYesAfter: number
  let qNoAfter: number

  try {
    if (direction === 'buy') {
      const q = quoteBuy(qYes, qNo, b, side, stakeGuacas)
      shares = q.shares
      // quoteBuy already rounded UP against the user. Re-rounding here would
      // change the price the book was quoted at.
      cashDelta = -q.cost
      avgPrice = q.avgPrice
      qYesAfter = q.qYesAfter
      qNoAfter = q.qNoAfter
    } else {
      // Ownership is OUR job: quoteSell's internal guard is maker solvency
      // only (can the book afford it), never "does this user hold it".
      //
      // The explicit null check is not redundant with the comparison below:
      // it is what lets the compare-and-set in write 2 assume a position row
      // exists, and it makes a sell against no position a clear 409 rather
      // than an epsilon-dependent one.
      if (!position) {
        return bad('insufficient_shares', 409, { held: 0, requested: sellShares })
      }
      if (sellShares > heldOnSide + SHARE_EPSILON) {
        return bad('insufficient_shares', 409, { held: heldOnSide, requested: sellShares })
      }
      // Clamp to the holding so a client sending a full-exit amount derived
      // from a slightly stale read cannot be rejected on a 1e-9 discrepancy.
      const toSell = Math.min(sellShares, heldOnSide)
      const q = quoteSell(qYes, qNo, b, side, toSell)
      shares = toSell
      cashDelta = q.refund // already rounded DOWN against the user
      avgPrice = q.avgPrice
      qYesAfter = q.qYesAfter
      qNoAfter = q.qNoAfter
    }
  } catch (e) {
    return bad('unpriceable', 400, { detail: e instanceof Error ? e.message : String(e) })
  }

  const magnitude = Math.abs(cashDelta)

  // ── Pre-flight limits ────────────────────────────────────────────────
  if (direction === 'buy') {
    if (wallet.balance < magnitude) {
      return bad('insufficient_balance', 402, { balance: wallet.balance, cost: magnitude })
    }

    const { data: limitsData } = await supabase
      .from('market_limits')
      .select('max_stake_user_market')
      .eq('id', true)
      .maybeSingle()
    const maxStake =
      (limitsData as { max_stake_user_market: number } | null)?.max_stake_user_market ??
      DEFAULT_MAX_STAKE

    // The cap is on TOTAL stake in this market, not per trade: already-paid
    // basis plus what this trade would add.
    if (costBasis + magnitude > maxStake) {
      return bad('stake_limit', 409, { maxStake, currentStake: costBasis, attempted: magnitude })
    }
  }

  // ── Derived post-trade state ─────────────────────────────────────────
  const newYes = side === 'yes' ? heldYes + (direction === 'buy' ? shares : -shares) : heldYes
  const newNo = side === 'no' ? heldNo + (direction === 'buy' ? shares : -shares) : heldNo
  const heldBefore = heldYes + heldNo
  const heldAfter = Math.max(0, newYes) + Math.max(0, newNo)

  // position_count tracks DISTINCT HOLDERS, so it moves only on the
  // transitions into and out of holding anything at all.
  let positionCount = market.position_count
  if (heldBefore <= SHARE_EPSILON && heldAfter > SHARE_EPSILON) positionCount += 1
  else if (heldBefore > SHARE_EPSILON && heldAfter <= SHARE_EPSILON) {
    positionCount = Math.max(0, positionCount - 1)
  }

  // Basis released on a sell, pro-rata over the position's total shares.
  // Exact for a single-sided position (the normal case); an approximation for
  // a hedged one, because the schema stores no per-side basis.
  const basisReleased =
    direction === 'sell' && heldBefore > 0
      ? Math.round(costBasis * (shares / heldBefore))
      : 0

  const newCostBasis =
    direction === 'buy' ? costBasis + magnitude : Math.max(0, costBasis - basisReleased)
  const newRealisedPnl =
    direction === 'sell' ? realisedPnl + (magnitude - basisReleased) : realisedPnl

  const priceAfter = priceYes(qYesAfter, qNoAfter, b)

  const { data: committed, error } = await supabase.rpc('play_commit_trade', {
    p_market_id: marketId, p_user_id: userId,
    p_quote: {
      side, direction, shares, cash: cashDelta, price: Number(avgPrice.toFixed(4)),
      oldYes: market.q_yes, oldNo: market.q_no, newYes: qYesAfter, newNo: qNoAfter,
      heldYes, heldNo, oldBasis: costBasis, positionYes: Math.max(0, newYes),
      positionNo: Math.max(0, newNo), basis: newCostBasis, pnl: newRealisedPnl, positionCount,
    },
  })
  if (error) {
    const conflicts = ['market_not_open', 'market_busy', 'trade_conflict', 'insufficient_balance', 'insufficient_shares', 'stake_limit']
    const code = conflicts.find(code => error.message.includes(code))
    console.error('[play/trade] transaction failed:', error.message)
    return bad(code ?? 'trade_failed', code ? 409 : 503)
  }
  const finalBalance = Number(committed.balance)

  return Response.json({
    ok: true,
    shares,
    // Magnitude, not the signed column value: the caller knows `direction`.
    cost: magnitude,
    avgPrice,
    balance: finalBalance,
    priceYes: priceAfter,
  })
}
