'use client'
// src/app/[locale]/(app)/play/page.tsx
//
// Market browsing, positions and trade confirmation share one local route.
// Access is gated server-side in layout.tsx. Lists use real API data.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import GlobalHeader from '@/components/nav/GlobalHeader'
import { PLAY_STYLES } from './_components/styles'
import SubNav, { type SubNavKey } from './_components/SubNav'
import DeckScreen from './_components/DeckScreen'
import TradeSheet from './_components/TradeSheet'
import MarketDetailSheet from './_components/MarketDetailSheet'
import ConfirmScreen, { type ConfirmedTrade } from './_components/ConfirmScreen'
import PositionsScreen from './_components/PositionsScreen'
import ActivityScreen from './_components/ActivityScreen'
import LeadersScreen from './_components/LeadersScreen'
import { Blank, Press, SkeletonList } from './_components/shared'
import { useApiResource } from './_components/usePlayData'
import {
  parseActivity,
  parseLeaderboard,
  parseMarkets,
  parseMe,
  type LeaderPeriod,
  type PlayMarket,
  type Side,
} from './_components/types'

type Screen = 'deck' | 'trade' | 'done' | 'mine' | 'activity' | 'leaders'

/**
 * Stake the trade sheet opens on after a swipe. The deck is a side-picker —
 * committing a side must not commit an amount — so this is only a starting
 * point the sheet lets you change. Matches its first preset.
 */
const DEFAULT_STAKE = 100

/** Keep the market list and navigation in place behind the amount dialog. */
const SUBNAV_FOR: Partial<Record<Screen, SubNavKey>> = {
  deck: 'markets',
  trade: 'markets',
  activity: 'activity',
  leaders: 'leaders',
  mine: 'mine',
}

export default function PlayPage() {
  const t = useTranslations('play')
  const locale = useLocale()

  const [screen, setScreen] = useState<Screen>('deck')
  const [deckIndex, setDeckIndex] = useState(0)
  const [pending, setPending] = useState<{ market: PlayMarket; side: Side; stake: number } | null>(null)
  // The detail sheet is an OVERLAY, not a screen: `screen` stays on 'deck' and
  // the deck index does not move, so closing it returns the card untouched.
  const [detail, setDetail] = useState<PlayMarket | null>(null)
  const [confirmed, setConfirmed] = useState<ConfirmedTrade | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)
  // The trade response knows the new balance before /api/play/me is refetched.
  const [balanceAfterTrade, setBalanceAfterTrade] = useState<number | null>(null)
  const [leaderPeriod, setLeaderPeriod] = useState<LeaderPeriod>('week')
  const [leadersOpened, setLeadersOpened] = useState(false)
  const [activitySeen, setActivitySeen] = useState(false)

  // ── Data ──────────────────────────────────────────────────────
  // `locale` is forwarded because the market question, its context line and
  // the pair names are localised server-side from market_templates.question_i18n.
  const markets = useApiResource(`/api/play/markets?locale=${locale}`, parseMarkets)
  const me = useApiResource(`/api/play/me?locale=${locale}`, parseMe)
  const activity = useApiResource(`/api/play/activity?locale=${locale}`, parseActivity)
  // The leaderboard is the one screen most users never open; don't spend a
  // request on it until they do.
  const leaders = useApiResource(
    `/api/play/leaderboard?period=${leaderPeriod}`,
    parseLeaderboard,
    leadersOpened,
  )

  // A fresh /api/play/me supersedes the balance the trade route reported.
  // Gated on `status === 'ready'` rather than on `me.data` identity: the
  // refetch nulls `data` while it is in flight, and clearing the override
  // then would flash the balance chip to 0 between the trade and the
  // response landing.
  useEffect(() => {
    if (me.status === 'ready') setBalanceAfterTrade(null)
  }, [me.status, me.data])

  const balance = balanceAfterTrade ?? me.data?.balance ?? 0
  // Memoised so the `?? []` fallback doesn't produce a new array identity on
  // every render and churn the deck's layout effects.
  const list = useMemo(() => markets.data ?? [], [markets.data])

  const advance = useCallback(() => setDeckIndex((i) => i + 1), [])

  /**
   * Browsing the deck — the vertical swipe and the Up/Down keys. Takes no side
   * and touches no market state; it is `advance` with a direction.
   *
   * Clamped at zero because every read of the list is `list[deckIndex %
   * list.length]`, and JS `%` keeps the sign of the dividend: a -1 index would
   * ask for slot -1 and render nothing.
   */
  const navigate = useCallback(
    (delta: 1 | -1) => setDeckIndex((i) => Math.max(0, i + delta)),
    [],
  )

  // ── Screen switching ──────────────────────────────────────────
  const goto = useCallback((key: SubNavKey) => {
    if (key === 'leaders') setLeadersOpened(true)
    if (key === 'activity') setActivitySeen(true)
    // Leaving the deck dismisses the detail sheet — coming back to a sheet the
    // user navigated away from would be a surprise.
    setDetail(null)
    setScreen(key === 'markets' ? 'deck' : key)
  }, [])

  // ── Trade flow ────────────────────────────────────────────────
  const onCommit = useCallback((market: PlayMarket, side: Side, stake: number) => {
    setPending({ market, side, stake })
    setTradeError(null)
    setScreen('trade')
  }, [])

  const openDetail = useCallback((market: PlayMarket) => setDetail(market), [])
  const closeDetail = useCallback(() => setDetail(null), [])

  const closeTrade = useCallback(() => {
    setPending(null)
    setScreen('deck')
  }, [])

  const tradeErrors: Record<string, string> = useMemo(
    () => ({
      insufficient_balance: t('trade.insufficient'),
      market_locked: t('trade.locked'),
      market_not_open: t('trade.locked'),
      stake_limit: t('trade.stakeLimit'),
    }),
    [t],
  )

  const confirmTrade = useCallback(
    async (guacas: number, side: Side) => {
      if (!pending || submitting) return
      setSubmitting(true)
      setTradeError(null)
      try {
        const res = await fetch('/api/play/trade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketId: pending.market.id,
            side,
            direction: 'buy',
            guacas,
          }),
        })
        const payload = (await res.json().catch(() => null)) as
          | { ok?: boolean; shares?: number; cost?: number; avgPrice?: number; balance?: number; error?: string }
          | null

        if (!res.ok || !payload || payload.ok !== true) {
          // Error codes are the ones /api/play/trade's `bad()` helper emits.
          // Only the three a user can act on get their own message; the rest
          // (query_failed, market_busy, trade_conflict, unpriceable, …) are
          // infrastructure and read the same to the person tapping Confirm.
          setTradeError(tradeErrors[payload?.error ?? ''] ?? t('trade.failed'))
          return
        }

        setConfirmed({
          side,
          question: pending.market.question,
          cost: payload.cost ?? guacas,
          shares: payload.shares ?? 0,
          avgPrice: payload.avgPrice ?? 0,
        })
        if (typeof payload.balance === 'number') setBalanceAfterTrade(payload.balance)
        setPending(null)
        // The trade moved the price — the deck's copy of it is now stale.
        markets.reload()
        me.reload()
        advance()
        setScreen('done')
      } catch {
        setTradeError(t('trade.failed'))
      } finally {
        setSubmitting(false)
      }
    },
    [pending, submitting, t, tradeErrors, markets, me, advance],
  )

  const upNext = useMemo(
    () => (list.length ? (list[deckIndex % list.length] ?? null) : null),
    [list, deckIndex],
  )

  const subnavKey = SUBNAV_FOR[screen]
  const activityDot = !activitySeen && (activity.data?.length ?? 0) > 0

  return (
    <div className={`pl-root${screen === 'deck' || screen === 'trade' ? ' pl-immersive' : ''}${subnavKey ? '' : ' pl-nosub'}`}>
      <style dangerouslySetInnerHTML={{ __html: PLAY_STYLES }} />
      {screen !== 'deck' && screen !== 'trade' && <GlobalHeader />}

      {subnavKey && screen !== 'deck' && screen !== 'trade' && (
        <SubNav active={subnavKey} balance={balance} activityDot={activityDot} onSelect={goto} />
      )}

      <div className="pl-screens">
        {/* ── Deck ────────────────────────────────────────────── */}
        <section hidden={screen !== 'deck' && screen !== 'trade'} className={`pl-screen${screen === 'deck' || screen === 'trade' ? ' pl-on' : ''}`}>
          {markets.status === 'loading' && (
            <div style={{ paddingTop: 16 }}>
              <SkeletonList rows={1} height={380} />
            </div>
          )}
          {markets.status === 'error' && (
            <Blank
              icon="warning"
              title={t('deck.error.title')}
              body={t('deck.error.body')}
              action={
                <Press size="size-sm" intent="intent-ghost" onClick={markets.reload}>
                  {t('error.retry')}
                </Press>
              }
            />
          )}
          {markets.status === 'ready' && list.length === 0 && (
            <Blank icon="deck" title={t('deck.empty.title')} body={t('deck.empty.body')} />
          )}
          {markets.status === 'ready' && list.length > 0 && (
            // The deck chooses a SIDE, not an amount — the trade sheet owns the
            // stake and opens on this default, which matches its first preset.
            <DeckScreen
              markets={list}
              index={deckIndex}
              onCommit={(market, side) => onCommit(market, side, DEFAULT_STAKE)}
              onNavigate={navigate}
              onDetail={openDetail}
              active={screen === 'deck'}
            />
          )}
        </section>

        {/* ── Positions ───────────────────────────────────────── */}
        <section hidden={screen !== 'mine'} className={`pl-screen${screen === 'mine' ? ' pl-on' : ''}`}>
          <PositionsScreen
            me={me.data}
            status={me.status}
            onExplore={() => goto('markets')}
            onRetry={me.reload}
          />
        </section>

        {/* ── Activity ────────────────────────────────────────── */}
        <section hidden={screen !== 'activity'} className={`pl-screen${screen === 'activity' ? ' pl-on' : ''}`}>
          <ActivityScreen
            trades={activity.data}
            status={activity.status}
            onRetry={activity.reload}
          />
        </section>

        {/* ── Leaders ─────────────────────────────────────────── */}
        <section hidden={screen !== 'leaders'} className={`pl-screen${screen === 'leaders' ? ' pl-on' : ''}`}>
          <LeadersScreen
            board={leaders.data}
            status={leaders.status}
            period={leaderPeriod}
            onPeriod={setLeaderPeriod}
            onRetry={leaders.reload}
          />
        </section>

        {/* ── Confirmation ────────────────────────────────────── */}
        <section hidden={screen !== 'done'} className={`pl-screen${screen === 'done' ? ' pl-on' : ''}`}>
          {confirmed && (
            <ConfirmScreen
              trade={confirmed}
              upNext={upNext}
              onViewPositions={() => goto('mine')}
              onNext={() => goto('markets')}
            />
          )}
        </section>

        {/* ── Detail sheet ────────────────────────────────────── */}
        {detail && screen === 'deck' && (
          <MarketDetailSheet
            // Remount per market so a stale scroll position from the previous
            // card cannot carry over.
            key={detail.id}
            market={detail}
            onClose={closeDetail}
          />
        )}

        {/* ── Trade sheet ─────────────────────────────────────── */}
        {screen === 'trade' && pending && (
          <TradeSheet
            // Remount per (market, side) so the stake picker always opens
            // on the smallest stake.
            key={`${pending.market.id}-${pending.side}`}
            market={pending.market}
            side={pending.side}
            initialStake={pending.stake}
            balance={balance}
            submitting={submitting}
            error={tradeError}
            onConfirm={confirmTrade}
            onClose={closeTrade}
          />
        )}
      </div>
    </div>
  )
}
