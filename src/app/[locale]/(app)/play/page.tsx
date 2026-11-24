'use client'
// src/app/[locale]/(app)/play/page.tsx
//
// Market browsing, positions and trade confirmation share one local route.
// Access is gated server-side in layout.tsx. Lists use real API data.

import { useCallback, useEffect, useMemo, useState, useRef } from 'react'
import {previewBuy} from './_components/market-preview'
import onboardingStyles from './_components/PlayOnboarding.module.css'
import PlayerLoading from './_components/PlayerLoading'
import PlayWelcome from './_components/PlayWelcome'
import FloatingInvite from './_components/FloatingInvite'
import InviteDrawer from '@/components/play-invite/InviteDrawer'
import {useInvitePrompt} from '@/components/play-invite/useInvitePrompt'
import SettlementResults from '@/components/play-results/SettlementResults'
import {useShopWardrobe} from '@/hooks/useShopWardrobe'
import {useAuth} from '@/components/AuthProvider'
import {IdentitySetup,OnboardingGuide,useOnboarding} from './_components/PlayOnboarding'
import { useLocale, useTranslations } from 'next-intl'
import MarketToolbar from './_components/MarketToolbar'
import { unplayedFirst, filterMarkets, type MarketFilter } from './_components/market-filters'
import GlobalHeader from '@/components/nav/GlobalHeader'
import PlayerWallet from './_components/PlayerWallet'
import { PLAY_STYLES } from './_components/styles'
import SubNav, { type SubNavKey } from './_components/SubNav'
import MarketFeed from './_components/MarketFeed'
import ActivityBanner from './_components/ActivityBanner'
import TradeSheet from './_components/TradeSheet'
import MarketDetailSheet from './_components/MarketDetailSheet'
import { type ConfirmedTrade } from './_components/ConfirmScreen'
import QuickTradeConfirmation from './_components/QuickTradeConfirmation'
import PositionsScreen from './_components/PositionsScreen'
import ActivityScreen from './_components/ActivityScreen'
import LeadersScreen from './_components/LeadersScreen'
import { Blank, Press, SkeletonList } from './_components/shared'
import { useApiResource } from './_components/usePlayData'
import {
  parseActivity,
  parseLeaderboard,
  parseMarketOverview,
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
  const onboardT=useTranslations('play.onboarding')
  const {user}=useAuth()
  // Warm the shared wardrobe while onboarding and market requests run.
  useShopWardrobe(process.env.NODE_ENV==='production')
  const onboarding=useOnboarding(user?.id)
  const [loginPreview,setLoginPreview]=useState(false)
  useEffect(()=>{setLoginPreview(process.env.NODE_ENV!=='production'&&new URLSearchParams(window.location.search).get('onboarding')==='login')},[])
  const [firstSuccess,setFirstSuccess]=useState(false)

  const [resultMarket,setResultMarket]=useState<string|null>(null)
  const [linkedMatch, setLinkedMatch] = useState<string | null>(null)
  const landingChosen = useRef(false)
  const [screen, setScreen] = useState<Screen>('deck')
  const [pending, setPending] = useState<{ market: PlayMarket; side: Side; stake: number } | null>(null)
  // The detail sheet is an OVERLAY, not a screen: `screen` stays on 'deck' and
  // the deck index does not move, so closing it returns the card untouched.
  const [detail, setDetail] = useState<PlayMarket | null>(null)
  const [feedTrade, setFeedTrade] = useState<ConfirmedTrade | null>(null)
  const [confirmed, setConfirmed] = useState<ConfirmedTrade | null>(null)
  const invite=useInvitePrompt(user?.id,!!confirmed||!!detail||screen==='trade'||firstSuccess||!!onboarding.progress&&onboarding.progress.step!=='done',onboarding.preview)
  const [justPlayed, setJustPlayed] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)
  // The trade response knows the new balance before /api/play/me is refetched.
  const [balanceAfterTrade, setBalanceAfterTrade] = useState<number | null>(null)
  const [leaderWeek,setLeaderWeek]=useState(0)
  const [leaderPeriod, setLeaderPeriod] = useState<LeaderPeriod>('week')
  const [leadersOpened, setLeadersOpened] = useState(false)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const match = params.get('match')
    if (match && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(match)) { setLinkedMatch(match); landingChosen.current = true }
    const result=params.get('result');if(result&&(result==='all'||/^[a-f0-9-]{36}$/i.test(result)))setResultMarket(result)
    const view = params.get('view')
    if (view === 'mine' || view === 'leaders') {
      landingChosen.current = true
      setScreen(view)
      if (view === 'leaders') setLeadersOpened(true)
    }
  }, [])
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('all')

  // ── Data ──────────────────────────────────────────────────────
  // `locale` is forwarded because the market question, its context line and
  // the pair names are localised server-side from market_templates.question_i18n.
  const markets = useApiResource(`/api/play/markets?locale=${locale}${linkedMatch ? `&matchId=${linkedMatch}` : ''}`, parseMarketOverview, true, 30_000, true)
  const me = useApiResource(`/api/play/me?locale=${locale}`, parseMe, true, 30_000, true)
  const activity = useApiResource(`/api/play/activity?locale=${locale}`, parseActivity, screen === 'activity')
  // Warm standings after the primary screen is ready, before the first tab tap.
  useEffect(()=>{
    if(markets.status!=='ready'||onboarding.loading||onboarding.progress?.step!=='done')return
    const timer=window.setTimeout(()=>setLeadersOpened(true),1200)
    return()=>window.clearTimeout(timer)
  },[markets.status,onboarding.loading,onboarding.progress?.step])
  const leaders = useApiResource(
    `/api/play/leaderboard?period=${leaderPeriod}&week=${leaderWeek}`,
    parseLeaderboard,
    leadersOpened,
    30_000,
    true,
  )

  // Remove optimistic deductions once the server acknowledges those plays.
  useEffect(()=>{
    const acknowledged = new Set(markets.data?.playedMarketIds ?? [])
    setJustPlayed(ids=>ids.some(id=>acknowledged.has(id)) ? ids.filter(id=>!acknowledged.has(id)) : ids)
  },[markets.data])

  // Resolve the default once. Direct links and manual navigation win.
  useEffect(() => {
    if (landingChosen.current || markets.status !== 'ready' || onboarding.loading) return
    // Let new players complete their introduction before choosing the landing tab.
    if (onboarding.progress && onboarding.progress.step !== 'done') return
    landingChosen.current = true
    if (markets.data?.totalAvailable === 0) {
      setScreen('leaders')
      setLeadersOpened(true)
    }
  }, [markets.status, markets.data, onboarding.loading, onboarding.progress])

  // Keep the confirmed balance until the refreshed player payload arrives.
  // Background reloads retain the previous payload to preserve the feed.
  useEffect(() => {
    if (me.status === 'ready') setBalanceAfterTrade(null)
  }, [me.status, me.data])

  const balance = balanceAfterTrade ?? me.data?.balance ?? 0
  // Memoised so the `?? []` fallback doesn't produce a new array identity on
  // every render and churn the deck's layout effects.
  const list = useMemo(() => unplayedFirst(filterMarkets(markets.data?.markets ?? [], marketFilter, new Date()), me.data?.positions ?? []), [markets.data, marketFilter, me.data?.positions])


  // Returning to the market directory must also clear a match deep link.
  // Keep the URL in sync so a reload does not silently restore that restriction.
  const showAllMarkets = useCallback(() => {
    setLinkedMatch(null)
    setMarketFilter('all')
    const url = new URL(window.location.href)
    url.searchParams.delete('match')
    url.searchParams.delete('view')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [])

  // ── Screen switching ──────────────────────────────────────────
  const goto = useCallback((key: SubNavKey) => {
    landingChosen.current = true
    if (key === 'leaders') setLeadersOpened(true)
    if (key === 'markets') showAllMarkets()
    // Leaving the deck dismisses the detail sheet — coming back to a sheet the
    // user navigated away from would be a surprise.
    setDetail(null)
    setScreen(key === 'markets' ? 'deck' : key)
  }, [showAllMarkets])

  const dismissConfirmation = useCallback(() => setConfirmed(null), [])

  // ── Trade flow ────────────────────────────────────────────────
  const onCommit = useCallback((market: PlayMarket, side: Side, stake: number) => {
    setPending({ market, side, stake })
    setTradeError(null)
    setScreen('trade')
  }, [list])

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
      if(onboarding.preview){
        const quote=previewBuy(pending.market,side,guacas)
        if(!quote)return
        setConfirmed({market:pending.market,side,question:pending.market.question,cost:quote.cost,shares:quote.shares,avgPrice:quote.cost/quote.shares})
        setBalanceAfterTrade(balance-guacas);setPending(null);setScreen('deck');setFirstSuccess(true)
        void onboarding.advance('done');void invite.afterPrediction();return
      }
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

        void invite.afterPrediction()
        if(onboarding.progress?.step==='prediction'){setFirstSuccess(true);void onboarding.advance('done').catch(()=>{})}
        const completedTrade: ConfirmedTrade = {
          market: pending.market,
          side,
          question: pending.market.question,
          cost: payload.cost ?? guacas,
          shares: payload.shares ?? 0,
          avgPrice: payload.avgPrice ?? 0,
        }
        setJustPlayed(ids=>[...new Set([...ids,pending.market.id])])
        setConfirmed(completedTrade)
        setFeedTrade(completedTrade)
        if (typeof payload.balance === 'number') setBalanceAfterTrade(payload.balance)
        setPending(null)
        // The trade moved the price — the deck's copy of it is now stale.
        markets.reload()
        me.reload()
        setScreen('deck')
      } catch {
        setTradeError(t('trade.failed'))
      } finally {
        setSubmitting(false)
      }
    },
    [pending, submitting, t, tradeErrors, markets, me, onboarding, balance, invite.afterPrediction],
  )



  const subnavKey = SUBNAV_FOR[screen]

  if(loginPreview)return <PlayWelcome/>
  if(onboarding.loading)return <PlayerLoading/>
  if(!onboarding.progress&&onboarding.error)return <PlayerLoading error onRetry={onboarding.retry}/>
  if(onboarding.progress?.step==='identity')return <IdentitySetup initial={onboarding.progress} onSave={onboarding.identity} preview={onboarding.preview}/>
  const guideStep=firstSuccess?'success':onboarding.progress?.step
  const showGuide=guideStep&&guideStep!=='done'
  const finishGuide=()=>{void onboarding.advance('done').then(()=>setFirstSuccess(false)).catch(()=>{})}

  return (
    <div data-onboarding={showGuide?guideStep:undefined} className={`pl-root${screen === 'deck' || screen === 'trade' ? ' pl-immersive' : ''}${subnavKey ? '' : ' pl-nosub'}`}>
      <style dangerouslySetInnerHTML={{ __html: PLAY_STYLES }} />
      <div className="pl-brand-header"><GlobalHeader playerWallet={<PlayerWallet walletKey={onboarding.preview?undefined:me.data?.walletKey} previewAvatar={onboarding.preview?onboarding.progress?.avatar:undefined} welcome={guideStep==='wallet'} balance={balanceAfterTrade ?? me.data?.balance ?? null} onPositions={() => goto('mine')} />} /></div>

      {subnavKey && (
        <SubNav availableCount={markets.data?.unplayedCount === undefined ? undefined : Math.max(0,markets.data.unplayedCount-justPlayed.filter(id=>!markets.data!.playedMarketIds.includes(id)).length)} myLiveCount={new Set((me.data?.positions ?? []).filter(p => p.live && p.matchId).map(p => p.matchId)).size} active={subnavKey} onSelect={goto} liveCount={(markets.data?.markets ?? []).filter(m => m.live).length} />
      )}

      {(screen === 'mine' || screen === 'activity') && <div className="pl-personal-heading">
        <h2>{screen==='mine'?t('positions.simpleTitle'):t('subnav.activity')}</h2>
        <Press intent="intent-ghost" size="size-sm" onClick={()=>goto(screen==='mine'?'activity':'mine')}>{screen==='mine'?t('subnav.activity'):t('positions.simpleTitle')} ↗</Press>
      </div>}
      <div className="pl-screens">
        {/* ── Deck ────────────────────────────────────────────── */}
        <section hidden={screen !== 'deck' && screen !== 'trade'} className={`pl-screen${screen === 'deck' || screen === 'trade' ? ' pl-on' : ''}`}>
          {showGuide&&<OnboardingGuide step={guideStep} balance={me.data?.balance??null} hasMarkets={list.length>0} trading={screen==='trade'} error={onboarding.error} onSkip={finishGuide} onAdvance={()=>{if(firstSuccess){void onboarding.advance('done').then(()=>{setFirstSuccess(false);goto('mine')}).catch(()=>{});}else void onboarding.advance('prediction').catch(()=>{})}}/>}
          {onboarding.preview&&<p className={onboardingStyles.preview} style={{padding:'4px 16px'}}>{onboardT('preview')}</p>}
          <MarketToolbar markets={markets.data?.markets ?? []} filter={marketFilter}
            onFilter={filter => { setMarketFilter(filter) }}
            />
          <ActivityBanner active={screen === 'deck'} onOpen={() => { activity.reload(); goto('activity') }} />
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
            <Blank icon="deck" title={t(marketFilter === 'all' ? 'deck.empty.title' : 'filters.empty')}
              body={t(marketFilter === 'all' ? 'deck.empty.body' : 'filters.emptyBody')}
              action={linkedMatch || marketFilter !== 'all' ? <Press size="size-sm" onClick={showAllMarkets}>{t('filters.showAll')}</Press> : undefined} />
          )}
          {markets.status === 'ready' && list.length > 0 && (
            <> {linkedMatch && <Press size="size-sm" intent="intent-ghost" onClick={showAllMarkets}>{t('filters.showAll')}</Press>}<MarketFeed
              key={marketFilter}
              markets={list}
              completedTrade={feedTrade}
              positions={onboarding.preview?[]:me.data?.positions ?? []}
              onViewPositions={() => goto('mine')}
              onChoose={(market, side) => onCommit(market, side, onboarding.progress?.step==='prediction'?Math.min(50,balance):DEFAULT_STAKE)}
              onDetail={openDetail}
            /></>
          )}
        </section>

        {/* ── Positions ───────────────────────────────────────── */}
        <section hidden={screen !== 'mine'} className={`pl-screen${screen === 'mine' ? ' pl-on' : ''}`}>
          <PositionsScreen
            me={me.data}
            focusMarket={resultMarket}
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
            available={balanceAfterTrade ?? me.data?.balance ?? null}
            active={screen === 'leaders'}
            board={leaders.data}
            status={leaders.status}
            weekOffset={leaderWeek}
            onWeek={setLeaderWeek}
            period={leaderPeriod}
            onPeriod={setLeaderPeriod}
            onOpenMarkets={() => goto('markets')}
            onRetry={leaders.reload}
          />
        </section>

        {!showGuide&&!invite.open&&!detail&&!confirmed&&screen!=='trade'&&<FloatingInvite label={t('invite.inviteFriends')} onClick={invite.show}/>}

        <SettlementResults key={user?.id} me={me.data} enabled={!invite.open&&!showGuide&&!onboarding.preview&&!detail&&!confirmed&&screen!=='trade'} onView={id=>{setResultMarket(id);goto('mine');window.history.replaceState(null,'',`?view=mine&result=${encodeURIComponent(id)}`)}}/>
        {invite.open&&<InviteDrawer onClose={invite.close} preview={onboarding.preview||process.env.NODE_ENV!=='production'}/> }
        {confirmed && <QuickTradeConfirmation trade={confirmed} onDone={dismissConfirmation}/>}

        {/* ── Detail sheet ────────────────────────────────────── */}
        {detail && screen === 'deck' && (
          <MarketDetailSheet
            // Remount per market so a stale scroll position from the previous
            // card cannot carry over.
            key={detail.id}
            market={detail}
            onChoose={side => { setDetail(null); onCommit(detail, side, DEFAULT_STAKE) }}
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
            onboarding={onboarding.progress?.step==='prediction'}
            previewOnly={onboarding.preview}
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
