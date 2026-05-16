'use client'
// src/app/match/[id]/page.tsx
// V3 Match Detail — orchestrator, hero, score grid. Chunky clip-path brand language, no border-radius except circles.

import { useState, useEffect, useCallback, use, useRef, useMemo } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { Match, getCurrentScore, pairName, isStarPoint, parseSetScore, parseSetFromGames, parseAndHealSet, toShortName } from '@/types/match'
import { fetchMatchById } from '@/lib/match-fetch'
import MomentumChart from './MomentumChart'
import BottomNav from '@/components/nav/BottomNavV3'
import DetailPageSkeleton from '@/components/skeletons/DetailPageSkeleton'
import { DATE_WITH_WEEKDAY } from '@/lib/format-patterns'
import { useMatchPrediction } from '@/hooks/useMatchPrediction'
import { useMatchRating } from '@/hooks/useMatchRating'
import FollowButton from '@/components/FollowButton'
import { FlagImage } from '@/components/FlagImage'
import { MatchStatsView } from '@/components/MatchStatsView'
import { computeBreaks } from './break-stats'
import { SwipeTabView } from '@/components/SwipeTabView'
import { useAuth } from '@/components/AuthProvider'
import { logActivity } from '@/lib/activity-log'
import { isPremierLevel } from '@/lib/tournament-labels'
import { Capacitor } from '@capacitor/core'
import { Share } from '@capacitor/share'

import { WinnerBanner } from './WinnerBanner'
import { PredictionSection, PredictionResult } from './PredictionSection'
import { ScheduledSection } from './ScheduledSection'
import { MatchRatingCard } from './MatchRatingCard'
import { LiveFeedTab } from './LiveFeedTab'
import { H2HTab } from './H2HTab'
import { PlayerCard, PlayerSquare } from './PlayerCard'
import {
  GREEN, ORANGE, LIVE_RED, BG_BASE, BG_CARD, MUTED, BORDER,
  PAIR1_COLOR, PAIR2_COLOR, CHUNKY,
  PT_ORD, _matchPrevScores,
} from './lib/constants'
import { WhereToWatchBanner } from '@/components/where-to-watch/WhereToWatchBanner'
import { levelToChannelAbbr } from '@/lib/where-to-watch/circuit-map'
import type { LiveChannel as WtwLiveChannel, BroadcasterRow, ChannelMeta } from '@/lib/where-to-watch/group-builder'

type SubTab = 'recap' | 'live' | 'players' | 'h2h'

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const tMatch = useTranslations('matchDetail')
  const tPred = useTranslations('prediction')
  const format = useFormatter()
  const handleBack = () => { if (window.history.length > 1) router.back(); else router.push('/') }

  const [match, setMatch] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [subTab, setSubTab] = useState<SubTab>('live')
  const [h2hMatches, setH2hMatches] = useState<any[]>([])
  const [pair1Recent, setPair1Recent] = useState<any[]>([])
  const [pair2Recent, setPair2Recent] = useState<any[]>([])
  const [h2hLoading, setH2hLoading] = useState(false)
  const [heroHidden, setHeroHidden] = useState(false)
  const [headerVisible, setHeaderVisible] = useState(true)
  const lastScrollY = useRef(0)
  const heroSentinelRef = useRef<HTMLDivElement>(null)
  const [countdown, setCountdown] = useState({ h: 0, m: 0, s: 0 })
  const [nextMatchId, setNextMatchId] = useState<string | null>(null)
  const { prediction, setPrediction, clearPrediction } = useMatchPrediction(id)
  const [predStep, setPredStep] = useState<'pick' | 'margin' | 'done'>('pick')
  const { rating, setRating, avgRating, ratingCount } = useMatchRating(
    id,
    (match as any)?.avg_rating ?? null,
    (match as any)?.rating_count ?? 0
  )
  const [shareToast, setShareToast] = useState(false)
  const [wtwBroadcasters, setWtwBroadcasters] = useState<BroadcasterRow[]>([])
  const [wtwLiveChannels, setWtwLiveChannels] = useState<WtwLiveChannel[]>([])
  const [wtwChannelsMeta, setWtwChannelsMeta] = useState<ChannelMeta[]>([])
  const [wtwGeoCountry, setWtwGeoCountry] = useState<string | null>(null)
  const { user } = useAuth()

  const fetchNextMatch = useCallback(async (m: Match) => {
    const wp = (m as any).winner_pair as number | null
    if (!wp) return
    const winnerP1 = wp === 1 ? m.pair1_player1?.id : m.pair2_player1?.id
    const tournamentId = (m as any).tournament?.id
    if (!winnerP1 || !tournamentId) return

    // Find matches in the same tournament/category where winning player1 appears
    const { data } = await supabase
      .from('matches')
      .select('id, scheduled_at')
      .eq('tournament_id', tournamentId)
      .eq('category', (m as any).category)
      .neq('id', m.id)
      .or(`pair1_player1_id.eq.${winnerP1},pair1_player2_id.eq.${winnerP1},pair2_player1_id.eq.${winnerP1},pair2_player2_id.eq.${winnerP1}`)
      .order('scheduled_at', { ascending: true })
      .limit(10)

    if (!data || data.length === 0) return
    // Pick the match scheduled after the current one (next round)
    const currentDate = m.scheduled_at ?? m.started_at ?? ''
    const next = data.find(d => (d.scheduled_at ?? '') > currentDate) ?? data[data.length - 1]
    if (next) setNextMatchId(next.id)
  }, [id])

  const fetchMatch = useCallback(async () => {
    const safetyTimeout = setTimeout(() => {
      console.warn('[Match] fetchMatch safety timeout — releasing loading state')
      setLoading(false)
    }, 12_000)
    try {
      // Shared fetcher — same projection used by useLiveMatch on the
      // card surfaces. Guarantees a single source of truth for the
      // match data shape across home / matches / tournament / detail.
      const next = await fetchMatchById(supabase, id, { label: 'match:detail' })
      if (next) setMatch(next)
    } catch (e) {
      console.error('[Match] fetchMatch exception:', e)
    } finally {
      clearTimeout(safetyTimeout)
      setLoading(false)
    }
  }, [id])

  const fetchH2H = useCallback(async (m: Match) => {
    const p1Ids = [m.pair1_player1?.id, m.pair1_player2?.id].filter(Boolean) as string[]
    const p2Ids = [m.pair2_player1?.id, m.pair2_player2?.id].filter(Boolean) as string[]
    if (p1Ids.length === 0 || p2Ids.length === 0) return
    setH2hLoading(true)

    const matchSelect = `
      id, external_id, status, round, started_at, finished_at, scheduled_at, winner_pair,
      tournament:tournaments(name),
      pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country),
      pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country),
      pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country),
      pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country),
      sets(set_score, set_number)
    `

    // Push H2H filter to Supabase: matches where both pairs overlap (in either direction)
    const p1 = p1Ids.join(',')
    const p2 = p2Ids.join(',')
    const h2hFilter = [
      `and(pair1_player1_id.in.(${p1}),pair1_player2_id.in.(${p1}),pair2_player1_id.in.(${p2}),pair2_player2_id.in.(${p2}))`,
      `and(pair1_player1_id.in.(${p2}),pair1_player2_id.in.(${p2}),pair2_player1_id.in.(${p1}),pair2_player2_id.in.(${p1}))`,
    ].join(',')

    // Parallel: strict H2H query + looser per-pair recent queries
    const allIds = [...p1Ids, ...p2Ids]
    const [h2hRes, recentRes] = await Promise.all([
      supabase
        .from('matches')
        .select(matchSelect)
        .or(h2hFilter)
        .eq('status', 'finished')
        .neq('id', m.id)
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(50),
      supabase
        .from('matches')
        .select(matchSelect)
        .or(`pair1_player1_id.in.(${allIds.join(',')}),pair2_player1_id.in.(${allIds.join(',')})`)
        .eq('status', 'finished')
        .neq('id', m.id)
        .order('finished_at', { ascending: false, nullsFirst: false })
        .limit(50),
    ])

    // Sort by best available date: finished_at > started_at > scheduled_at
    const sortByDate = (arr: any[]) => arr.sort((a: any, b: any) => {
      const dateA = a.finished_at ?? a.started_at ?? a.scheduled_at ?? ''
      const dateB = b.finished_at ?? b.started_at ?? b.scheduled_at ?? ''
      return dateB.localeCompare(dateA)
    })

    const h2hData = h2hRes.data ? sortByDate(h2hRes.data) : []
    setH2hMatches(h2hData)

    // Extract last 5 matches per pair (any opponent)
    const recentData = recentRes.data ? sortByDate(recentRes.data) : []
    const p1Recent = recentData.filter((hm: any) => {
      const ids = [hm.pair1_player1?.id, hm.pair1_player2?.id, hm.pair2_player1?.id, hm.pair2_player2?.id]
      return p1Ids.every(pid => ids.includes(pid))
    }).slice(0, 5)
    const p2Recent = recentData.filter((hm: any) => {
      const ids = [hm.pair1_player1?.id, hm.pair1_player2?.id, hm.pair2_player1?.id, hm.pair2_player2?.id]
      return p2Ids.every(pid => ids.includes(pid))
    }).slice(0, 5)
    setPair1Recent(p1Recent)
    setPair2Recent(p2Recent)

    setH2hLoading(false)
  }, [])

  useEffect(() => {
    fetchMatch()
    const channel = supabase
      .channel(`match-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `id=eq.${id}` }, fetchMatch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sets', filter: `match_id=eq.${id}` }, fetchMatch)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `match_id=eq.${id}` }, fetchMatch)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [fetchMatch, id])

  useEffect(() => {
    const el = heroSentinelRef.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => setHeroHidden(!entry.isIntersecting),
      { threshold: 0 }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [match])

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY
      if (y < 10) setHeaderVisible(true)
      else if (y > lastScrollY.current + 4) setHeaderVisible(false)
      else if (y < lastScrollY.current - 4) setHeaderVisible(true)
      lastScrollY.current = y
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (match && match.status === 'finished' && (match as any).winner_pair) fetchNextMatch(match)
  }, [match, fetchNextMatch])

  useEffect(() => {
    if (prediction) setPredStep('done')
  }, [prediction])

  useEffect(() => {
    // For Premier Padel finished matches, land on Score Recap (the
    // stats view). Non-Premier finished matches don't have stats —
    // skip Recap and Live Feed entirely and start on Players.
    const tournamentLevel = (match as any)?.tournament?.level as string | null | undefined
    const isPremier = isPremierLevel(tournamentLevel)
    if (match?.status === 'finished') setSubTab(isPremier ? 'recap' : 'players')
    else if (match?.status === 'scheduled') setSubTab('players')
    else if (match && !isPremier) setSubTab('players') // live + non-Premier
  }, [match?.status, (match as any)?.tournament?.level])

  useEffect(() => {
    if (!match || match.status !== 'scheduled') return
    const scheduledAt = match.scheduled_at
    if (!scheduledAt) return
    // Skip countdown if scheduled_at is date-only (midnight UTC — no real time)
    const d = new Date(scheduledAt)
    if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return
    const tick = () => {
      const diff = Math.max(0, (d.getTime() - Date.now()) / 1000)
      setCountdown({ h: Math.floor(diff / 3600), m: Math.floor((diff % 3600) / 60), s: Math.floor(diff % 60) })
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [match])

  const handleSubTab = (tab: SubTab) => {
    setSubTab(tab)
    if (tab === 'h2h' && h2hMatches.length === 0 && !h2hLoading && match) {
      fetchH2H(match)
    }
  }

  // ── Score-change flash animation (hooks must be before early returns) ─────
  const [flashPair, setFlashPair] = useState<1 | 2 | null>(null)
  const flashKeyRef = useRef(0)
  const matchSets = match?.sets ?? []
  const p1TotalGames = useMemo(() => matchSets.reduce((s, st) => s + ((parseSetScore(st.set_score) ?? parseSetFromGames(st.pair1_games, st.pair2_games))?.p1 ?? 0), 0), [matchSets])
  const p2TotalGames = useMemo(() => matchSets.reduce((s, st) => s + ((parseSetScore(st.set_score) ?? parseSetFromGames(st.pair1_games, st.pair2_games))?.p2 ?? 0), 0), [matchSets])
  // Extract current point for flash detection (same logic used below for
  // display). Falls back to game_score when points[] is empty — keeps the
  // animation responsive even when only game_score is being written.
  const _cg = match ? getCurrentScore(match).currentGame : null
  const _cp =
    _cg?.points?.filter(p => p !== '0:0').slice(-1)[0]
    ?? (_cg?.game_score && _cg.game_score !== '0-0' ? _cg.game_score : null)
    ?? null
  const _cpParts = _cp ? _cp.split(/[:\-]/) : null
  const _p1Pt = _cpParts ? _cpParts[0] : '0'
  const _p2Pt = _cpParts ? _cpParts[1] : '0'
  const _isLive = match?.status === 'live' || (match?.status as string) === 'on_court'

  useEffect(() => {
    if (!_isLive) { _matchPrevScores.delete(id); return }
    const cur = { p1Games: p1TotalGames, p2Games: p2TotalGames, p1Pts: _p1Pt, p2Pts: _p2Pt }
    const prev = _matchPrevScores.get(id)
    if (prev && (prev.p1Games !== cur.p1Games || prev.p2Games !== cur.p2Games || prev.p1Pts !== cur.p1Pts || prev.p2Pts !== cur.p2Pts)) {
      let scorer: 1 | 2 | null = null
      if (cur.p1Games > prev.p1Games) scorer = 1
      else if (cur.p2Games > prev.p2Games) scorer = 2
      else {
        const curP1 = PT_ORD[cur.p1Pts] ?? 0, curP2 = PT_ORD[cur.p2Pts] ?? 0
        const prevP1 = PT_ORD[prev.p1Pts] ?? 0, prevP2 = PT_ORD[prev.p2Pts] ?? 0
        if (curP1 > prevP1) scorer = 1
        else if (curP2 > prevP2) scorer = 2
        else if (prevP1 > prevP2 && curP1 <= curP2) scorer = 2
        else if (prevP2 > prevP1 && curP2 <= curP1) scorer = 1
      }
      _matchPrevScores.set(id, cur)
      if (scorer) {
        flashKeyRef.current += 1
        setFlashPair(scorer)
        const t = setTimeout(() => setFlashPair(null), 2800)
        return () => clearTimeout(t)
      }
    } else {
      _matchPrevScores.set(id, cur)
    }
  }, [_isLive, id, p1TotalGames, p2TotalGames, _p1Pt, _p2Pt])

  // Log match view for badge tracking
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!user || !match) return
    void logActivity(user.id, 'match_view', match.id)
  }, [match?.id, user?.id])

  const tournamentChannelAbbr = useMemo(
    () => levelToChannelAbbr((match as any)?.tournament?.level),
    [match],
  )

  useEffect(() => {
    const cookieMatch = typeof document !== 'undefined'
      ? document.cookie.match(/(?:^|;\s*)geo-country=([^;]*)/)
      : null
    const country = cookieMatch?.[1]?.toLowerCase() || null
    setWtwGeoCountry(country)

    if (!tournamentChannelAbbr) {
      setWtwBroadcasters([])
      setWtwLiveChannels([])
      setWtwChannelsMeta([])
      return
    }

    let cancelled = false
    const STALE_MS = 30 * 60 * 1000

    const broadcastersP = supabase
      .from('broadcasters')
      .select('id, name, url, logo_url, is_free, display_order, country_iso2, channel_id')
      .eq('active', true)
      .not('channel_id', 'is', null)
      .order('country_iso2', { ascending: true })
      .order('display_order', { ascending: true })
      .order('is_free', { ascending: false })

    const liveChannelsP = supabase
      .from('youtube_channel_live')
      .select(`video_id, title, channel:youtube_channels!inner(id, name, abbreviation, color_hex, display_order)`)
      .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
      .eq('channel.is_active', true)
      .eq('channel.abbreviation', tournamentChannelAbbr)

    const channelsMetaP = supabase
      .from('youtube_channels')
      .select('id, name, abbreviation, color_hex, display_order')
      .eq('is_active', true)
      .eq('abbreviation', tournamentChannelAbbr)

    Promise.all([broadcastersP, liveChannelsP, channelsMetaP]).then(([bRes, lcRes, cmRes]) => {
      if (cancelled) return
      setWtwBroadcasters(((bRes.data ?? []) as BroadcasterRow[]))
      const liveRows = (lcRes.data ?? []).map((r: any) => {
        const ch = Array.isArray(r.channel) ? r.channel[0] : r.channel
        if (!ch) return null
        return {
          videoId: r.video_id as string,
          title: r.title as string,
          channel: {
            id: ch.id as string,
            name: ch.name as string,
            abbreviation: ch.abbreviation as string,
            colorHex: ch.color_hex as string,
            displayOrder: ch.display_order as number,
          },
        }
      }).filter((x: WtwLiveChannel | null): x is WtwLiveChannel => x !== null)
      setWtwLiveChannels(liveRows)
      const channelsMeta = (cmRes.data ?? []).map((r: any) => ({
        id: r.id as string,
        name: r.name as string,
        abbreviation: r.abbreviation as string,
        colorHex: r.color_hex as string,
        displayOrder: r.display_order as number,
      }))
      setWtwChannelsMeta(channelsMeta)
    }).catch(err => {
      if (!cancelled) console.warn('[match:wtw] fetch failed:', err)
    })

    return () => { cancelled = true }
  }, [tournamentChannelAbbr])

  if (loading) return (
    <>
    <main style={{ background: BG_BASE, minHeight: '100vh' }}>
      <DetailPageSkeleton variant="match" />
    </main>
    <BottomNav />
    </>
  )
  if (!match) return (
    <>
    <main style={{ background: BG_BASE, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: MUTED, fontSize: 14, marginBottom: 16 }}>Match not found</div>
        <button onClick={handleBack} style={{ color: GREEN, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>← Go back</button>
      </div>
    </main>
    <BottomNav />
    </>
  )

  const { pair1Sets, pair2Sets, currentSet, currentGame } = getCurrentScore(match)
  const pair1Label = pairName(match.pair1_player1, match.pair1_player2)
  const pair2Label = pairName(match.pair2_player1, match.pair2_player2)

  // Accept both point-score separators: ':' (padelapi/relay canonical writes)
  // and '-' (padelgod via formatPointScore). Also filter the empty
  // start-of-game placeholder in either format.
  //
  // Fallback to game_score when points[] is empty/null — production padelgod
  // always writes game_score on every tick, but games.points[] is only
  // populated by builds that have the canonical-mode mirror (added 2026-05-03).
  // The fallback keeps live points rendering during the deploy window and
  // for any historical/in-flight game whose points array never got written.
  const currentPoint =
    currentGame?.points?.filter(p => p !== '0:0' && p !== '0-0').slice(-1)[0]
    ?? (currentGame?.game_score && currentGame.game_score !== '0-0' ? currentGame.game_score : null)
    ?? null
  const [p1Point, p2Point] = currentPoint ? currentPoint.split(/[:\-]/) : [null, null]
  const starPoint = currentGame ? isStarPoint(currentGame.points ?? []) : false

  // Defensive "looks finished" detection — sometimes the upstream pipeline
  // writes per-set scores from the results widget but the status flip to
  // 'finished' fails. If 2+ sets are won by one pair AND no set is
  // currently in progress, treat the match as finished for display.
  const _matchSetsArr = match.sets ?? []
  const _matchSetsLookFinished = (() => {
    if (_matchSetsArr.length < 2) return false
    if (_matchSetsArr.some((s) => s.is_current)) return false
    let p1Sets = 0
    let p2Sets = 0
    for (const s of _matchSetsArr) {
      const p1 = s.pair1_games ?? 0
      const p2 = s.pair2_games ?? 0
      if (p1 > p2) p1Sets++
      else if (p2 > p1) p2Sets++
    }
    return p1Sets >= 2 || p2Sets >= 2
  })()
  const _dbScheduled = match.status === 'scheduled'
  const isScheduled = _dbScheduled && !_matchSetsLookFinished
  const isFinished =
    ['finished', 'retired', 'walkover'].includes(match.status) ||
    (_dbScheduled && _matchSetsLookFinished)
  const isRetired = match.status === 'retired'
  const isWalkover = match.status === 'walkover'
  const isLive = match.status === 'live' || (match.status as string) === 'on_court'

  // Serving indicator — server_player_id is populated for live matches by
  // the canonical /scores cron and by padelgod's dual-write. Parser only
  // knows which PAIR is serving; stored as the pair's player1 UUID.
  const serverId = isLive ? (currentGame as any)?.server_player_id ?? null : null
  const pair1IsServing = !!serverId && (
    serverId === match.pair1_player1?.id || serverId === match.pair1_player2?.id
  )
  const pair2IsServing = !!serverId && (
    serverId === match.pair2_player1?.id || serverId === match.pair2_player2?.id
  )
  // Derive winner_pair from sets when the upstream didn't stamp it but
  // the sets clearly show a winner (matches the same fallback logic
  // MatchCard uses for finished-display).
  const _rawWinnerPair = (match as any).winner_pair as 1 | 2 | null
  const winnerPair: 1 | 2 | null = (() => {
    if (_rawWinnerPair === 1 || _rawWinnerPair === 2) return _rawWinnerPair
    if (!isFinished) return null
    let p1Sets = 0
    let p2Sets = 0
    for (const s of _matchSetsArr) {
      const p1 = s.pair1_games ?? 0
      const p2 = s.pair2_games ?? 0
      if (p1 > p2) p1Sets++
      else if (p2 > p1) p2Sets++
    }
    if (p1Sets > p2Sets) return 1
    if (p2Sets > p1Sets) return 2
    return null
  })()
  const p1Won = isFinished && winnerPair === 1
  const p2Won = isFinished && winnerPair === 2
  const isAdv = (s: string | null) => s === 'A' || s === 'AD'
  const p1Leading = !isFinished && (isAdv(p1Point) || (p1Point && p2Point && !isAdv(p1Point) && !isAdv(p2Point) && parseInt(p1Point) > parseInt(p2Point)))
  const p2Leading = !isFinished && (isAdv(p2Point) || (p1Point && p2Point && !isAdv(p1Point) && !isAdv(p2Point) && parseInt(p2Point) > parseInt(p1Point)))

  const category = (match as any).category as string | null
  const duration = (match as any).duration as string | null
  const matchDate = match.started_at ? format.dateTime(new Date(match.started_at), DATE_WITH_WEEKDAY) : null

  const tz = ((match as any).tournament)?.timezone ?? 'UTC'

  // ── Shared styles ──────────────────────────────────────────────────────────
  const scoreNumStyle = (won: boolean, dim: boolean, live: boolean): React.CSSProperties => ({
    fontSize: 22, fontWeight: 900, width: 22, textAlign: 'center',
    fontFamily: 'monospace', lineHeight: 1,
    color: live ? GREEN : won ? '#fff' : dim ? '#444' : '#555',
    position: 'relative',
  })

  return (
    <>
    <style>{`
      @keyframes pn-score-roll {
        0%   { transform: translateY(-120%); opacity: 0; }
        15%  { transform: translateY(-120%); opacity: 0; }
        45%  { transform: translateY(6%); opacity: 1; }
        65%  { transform: translateY(-3%); }
        80%  { transform: translateY(1%); }
        100% { transform: translateY(0); }
      }
    `}</style>
    <main style={{ background: BG_BASE, minHeight: '100vh', maxWidth: 500, margin: '0 auto', paddingBottom: 64, overflowX: 'hidden' }}>

      {/* ── Nav bar ───────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '12px 16px',
        borderBottom: 'none', boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
        position: 'sticky', top: 0, zIndex: 100,
        background: '#0A0A0A',
        height: 62,
        transform: headerVisible ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.3s ease',
      }}>
        <button
          onClick={handleBack}
          style={{
            width: 36, height: 36,
            clipPath: CHUNKY.badge,
            background: 'rgba(255,255,255,0.06)',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer',
          }}
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><polyline points="12 19 5 12 12 5" />
          </svg>
        </button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', textTransform: 'uppercase' as const }}>{tMatch('matchDetail')}</div>
        </div>
        {isLive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,68,85,0.15)', border: '1px solid rgba(255,68,85,0.4)', clipPath: CHUNKY.badge, padding: '4px 10px', flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: LIVE_RED, display: 'inline-block', animation: 'blink 1.2s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: LIVE_RED, letterSpacing: '0.5px' }}>LIVE</span>
          </div>
        )}
        <button
          onClick={async () => {
            if (!match) return
            const shareUrl = `https://padelnachos.com/match/${match.id}`
            const scores = (match.sets ?? [])
              .sort((a: any, b: any) => a.set_number - b.set_number)
              .map((s: any) => {
                const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
                return parsed ? `${parsed.p1}-${parsed.p2}` : null
              })
              .filter(Boolean)
              .join(', ')
            const tournamentName = (match as any).tournament?.name ?? ''
            const round = (match as any).round ?? ''
            const status = isLive ? 'LIVE' : isFinished ? 'Final' : 'Upcoming'
            const title = `${pair1Label} vs ${pair2Label}`
            const text = [
              title,
              scores ? `${status}: ${scores}` : status,
              [tournamentName, round].filter(Boolean).join(' · '),
            ].filter(Boolean).join('\n')

            // Three platform tiers:
            // - Capacitor native (Android/iOS app): Share plugin opens
            //   the native sheet. `navigator.share` is undefined inside
            //   the WebView, so gating on it would skip the native path.
            // - Web Share API (modern browsers): Share plugin proxies to
            //   navigator.share. Level 2 file attachment is only
            //   reachable via direct navigator.share — Capacitor's Share
            //   takes file:// URI strings, not File objects.
            // - Fallback (older browsers): copy URL to clipboard.
            const canShareViaCapacitor = Capacitor.isNativePlatform()
            const canShareViaWebShare = typeof navigator !== 'undefined' && 'share' in navigator
            const canShare = canShareViaCapacitor || canShareViaWebShare

            // Try to include the dynamic OG image as a file attachment via
            // Web Share API Level 2 (iOS 15+, Chrome Android). Only reachable
            // through navigator.share, so skip on Capacitor native (where
            // we'd just throw the file away anyway).
            //
            // Best-effort — we cap the image fetch at 3s so a slow render
            // never blocks the share sheet from opening.
            let imageFile: File | null = null
            if (canShareViaWebShare) {
              try {
                const controller = new AbortController()
                const timeout = setTimeout(() => controller.abort(), 3000)
                const res = await fetch(`/match/${match.id}/opengraph-image`, { signal: controller.signal })
                clearTimeout(timeout)
                if (res.ok) {
                  const blob = await res.blob()
                  imageFile = new File([blob], `padelnachos-match-${match.id}.png`, { type: blob.type || 'image/png' })
                }
              } catch {
                // Image fetch failed or timed out — fall through to URL-only share
              }
            }

            try {
              if (canShare) {
                const canShareFiles =
                  imageFile !== null &&
                  canShareViaWebShare &&
                  typeof navigator.canShare === 'function' &&
                  navigator.canShare({ files: [imageFile] })

                if (canShareFiles && imageFile) {
                  // Web Share API Level 2 file attachment.
                  await navigator.share({ title, text, url: shareUrl, files: [imageFile] })
                } else {
                  // URL-only share via Capacitor — opens native sheet on
                  // Android/iOS, proxies to navigator.share on web.
                  await Share.share({ title, text, url: shareUrl, dialogTitle: title })
                }
              } else {
                await navigator.clipboard.writeText(shareUrl)
                setShareToast(true)
                setTimeout(() => setShareToast(false), 2200)
              }
            } catch {
              // user cancelled or share failed
            }
          }}
          style={{
            width: 36, height: 36,
            clipPath: CHUNKY.badge,
            background: 'rgba(255,255,255,0.06)',
            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', cursor: 'pointer', flexShrink: 0,
          }}
          aria-label="Share"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      </div>

      {/* ── Winner banner ────────────────────────────────────────────── */}
      {isFinished && winnerPair && (
        <WinnerBanner match={match} winnerPair={winnerPair} pair1Label={pair1Label} pair2Label={pair2Label} nextMatchId={nextMatchId} />
      )}

      {/* ── Tournament link ──────────────────────────────────────────── */}
      {(match as any).tournament?.id && (
        <Link href={`/tournaments/${(match as any).tournament.id}`} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`,
          textDecoration: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', flexShrink: 0 }}>{tMatch('tournament')}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#ccc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(match as any).tournament.name}</span>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </Link>
      )}

      {/* ── Separator between tournament info and scoring ────────────── */}
      <div style={{ height: 6, background: BG_BASE }} />

      {/* ── Compact sticky score (appears when hero scrolls away) ────── */}
      <div style={{
        position: 'sticky', top: headerVisible ? 49 : 0, zIndex: 8,
        background: BG_CARD,
        borderBottom: `0.5px solid ${BORDER}`,
        overflow: 'hidden',
        maxHeight: heroHidden ? 68 : 0,
        opacity: heroHidden ? 1 : 0,
        transition: 'top 0.3s ease, max-height 0.25s ease, opacity 0.2s ease',
      }}>
        <div style={{ padding: '7px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Avatars + Names column */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', flexShrink: 0 }}>
                <img src={match.pair1_player1?.avatar_url ?? ''} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', border: `1.5px solid ${BG_CARD}` }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                <img src={match.pair1_player2?.avatar_url ?? ''} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', border: `1.5px solid ${BG_CARD}`, marginLeft: -6 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: p2Won ? '#666' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {pair1Label}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ display: 'flex', flexShrink: 0 }}>
                <img src={match.pair2_player1?.avatar_url ?? ''} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', border: `1.5px solid ${BG_CARD}` }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                <img src={match.pair2_player2?.avatar_url ?? ''} alt="" style={{ width: 18, height: 18, borderRadius: '50%', objectFit: 'cover', border: `1.5px solid ${BG_CARD}`, marginLeft: -6 }} onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              </div>
              <div style={{ fontSize: 11, fontWeight: 600, color: p1Won ? '#666' : '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {pair2Label}
              </div>
            </div>
          </div>
          {/* Live indicator column */}
          {isLive && currentSet && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: LIVE_RED, display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite', flexShrink: 0 }} />
              <span style={{ fontSize: 8, fontWeight: 700, color: LIVE_RED, textTransform: 'uppercase', letterSpacing: '0.3px', whiteSpace: 'nowrap' }}>
                Set {currentSet.set_number} · Game {currentGame?.game_number ?? 1}
              </span>
            </div>
          )}
          {/* Scores column */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {(match.sets ?? []).map(set => {
                const healed = parseAndHealSet(set)
                const p1WonSet = healed.p1 > healed.p2
                return (
                  <span key={set.set_number} style={{ fontSize: 13, fontWeight: 800, width: 18, textAlign: 'center', fontFamily: 'monospace', color: set.is_current ? GREEN : p1WonSet ? '#fff' : '#B0B5BE' }}>
                    {healed.p1}
                  </span>
                )
              })}
              {!isFinished && (
                <span style={{ fontSize: 13, fontWeight: 900, width: 28, textAlign: 'center', fontFamily: 'monospace', color: starPoint ? ORANGE : LIVE_RED, marginLeft: 4 }}>
                  {p1Point ?? '0'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              {(match.sets ?? []).map(set => {
                const healed = parseAndHealSet(set)
                const p2WonSet = healed.p2 > healed.p1
                return (
                  <span key={set.set_number} style={{ fontSize: 13, fontWeight: 800, width: 18, textAlign: 'center', fontFamily: 'monospace', color: set.is_current ? GREEN : p2WonSet ? '#fff' : '#B0B5BE' }}>
                    {healed.p2}
                  </span>
                )
              })}
              {!isFinished && (
                <span style={{ fontSize: 13, fontWeight: 900, width: 28, textAlign: 'center', fontFamily: 'monospace', color: starPoint ? ORANGE : LIVE_RED, marginLeft: 4 }}>
                  {p2Point ?? '0'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div style={{ background: BG_CARD, padding: '14px 16px 0', borderBottom: `0.5px solid ${BORDER}` }}>

        {/* Court + round + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: isScheduled ? 14 : 12 }}>
          <span style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{match.court ?? ''}</span>
          {match.court && match.round && <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555', display: 'inline-block' }} />}
          <span style={{ fontSize: 10, color: '#777' }}>{match.round ?? ''}</span>
          {duration && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555', display: 'inline-block' }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, background: 'rgba(255,255,255,0.06)', clipPath: CHUNKY.badge, padding: '2px 7px' }}>{duration}</span>
            </>
          )}
          <span style={{ flex: 1 }} />
          {matchDate && !isScheduled && <span style={{ fontSize: 10, color: '#666' }}>{matchDate}</span>}
          <FollowButton type="match" targetId={match.id} variant="star" size={20} />
        </div>


        {/* Set column labels (live/finished only) */}
        {!isScheduled && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 4, paddingRight: 2 }}>
            {(match.sets ?? []).map(set => (
              <span key={set.set_number} style={{ fontSize: 9, width: 22, textAlign: 'center', color: set.is_current ? GREEN : '#555', fontWeight: 700 }}>S{set.set_number}</span>
            ))}
            <span style={{ width: 8 }} />
            {!isFinished && <span style={{ fontSize: 9, width: 28, textAlign: 'center', color: MUTED, fontWeight: 700 }}>Pts</span>}
          </div>
        )}

        {/* Pair 1 row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, ...(!isLive && !isScheduled ? { borderBottom: `0.5px solid ${BORDER}` } : {}) }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <PlayerSquare player={match.pair1_player1} winner={p1Won} router={router} />
            <PlayerSquare player={match.pair1_player2} winner={p1Won} router={router} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PlayerNameLink player={match.pair1_player1} dim={!!p2Won} muted={!!p2Leading} bold={!!p1Won} router={router} />
              {pair1IsServing && (
                <span
                  aria-label="serving"
                  title="Serving"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#F5D523',
                    boxShadow: '0 0 4px rgba(245, 213, 35, 0.6)',
                    flexShrink: 0,
                    display: 'inline-block',
                  }}
                />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <PlayerNameLink player={match.pair1_player2} dim={!!p2Won} muted={!!p2Leading} bold={!!p1Won} router={router} />
              {isRetired && p2Won && <span style={{ fontSize: 8, fontWeight: 700, color: '#F5A623', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 6px', flexShrink: 0 }}>RET</span>}
              {isWalkover && p2Won && <span style={{ fontSize: 8, fontWeight: 700, color: '#F5A623', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 6px', flexShrink: 0 }}>W/O</span>}
            </div>
          </div>
          {!isScheduled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {(match.sets ?? []).map(set => {
                const healed = parseAndHealSet(set)
                const p1WonSet = healed.p1 > healed.p2
                return (
                  <span key={set.set_number} style={{ ...scoreNumStyle(p1WonSet && !set.is_current, !p1WonSet && !set.is_current, !!set.is_current), position: 'relative' }}>
                    {healed.p1}
                    {healed.tb != null && !p1WonSet && <sup style={{ fontSize: 9, color: MUTED, position: 'absolute', top: 2, right: -2 }}>{healed.tb}</sup>}
                  </span>
                )
              })}
              <span style={{ width: 8 }} />
              {!isFinished && (
                <span
                  key={flashPair === 1 ? `p1-${flashKeyRef.current}` : 'p1'}
                  style={{
                    display: 'inline-block',
                    fontSize: 22, fontWeight: 900, width: 28, textAlign: 'center', fontFamily: 'monospace', lineHeight: 1,
                    color: starPoint ? ORANGE : LIVE_RED,
                    ...(flashPair === 1 ? { animation: 'pn-score-roll 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both' } : {}),
                  }}
                >
                  {/* Fallback is '0' (start-of-game default), NOT pair1Sets —
                      the sets-won count is a different concept and would leak
                      into the Pts column when points[] is empty or filtered to
                      empty (e.g., only the '0:0' placeholder). Matches the
                      fallback used in the compact variant above. */}
                  {p1Point ?? '0'}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Star point indicator (no divider line) */}
        {isLive && currentGame && starPoint && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 0' }}>
            <span style={{ color: ORANGE, fontSize: 9, fontWeight: 700, background: 'rgba(245,166,35,0.12)', border: '0.5px solid rgba(245,166,35,0.3)', clipPath: CHUNKY.badge, padding: '2px 6px' }}>Star point</span>
          </div>
        )}
        {/* VS divider (scheduled) or spacer (finished) */}
        {isScheduled && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
            <span style={{ fontSize: 10, fontWeight: 900, color: MUTED, letterSpacing: '2px' }}>VS</span>
            <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
          </div>
        )}
        {isFinished && <div style={{ height: 12 }} />}

        {/* Pair 2 row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <PlayerSquare player={match.pair2_player1} winner={p2Won} router={router} />
            <PlayerSquare player={match.pair2_player2} winner={p2Won} router={router} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <PlayerNameLink player={match.pair2_player1} dim={!!p1Won} muted={!!p1Leading} bold={!!p2Won} router={router} />
              {pair2IsServing && (
                <span
                  aria-label="serving"
                  title="Serving"
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: '#F5D523',
                    boxShadow: '0 0 4px rgba(245, 213, 35, 0.6)',
                    flexShrink: 0,
                    display: 'inline-block',
                  }}
                />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <PlayerNameLink player={match.pair2_player2} dim={!!p1Won} muted={!!p1Leading} bold={!!p2Won} router={router} />
              {isRetired && p1Won && <span style={{ fontSize: 8, fontWeight: 700, color: '#F5A623', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 6px', flexShrink: 0 }}>RET</span>}
              {isWalkover && p1Won && <span style={{ fontSize: 8, fontWeight: 700, color: '#F5A623', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 6px', flexShrink: 0 }}>W/O</span>}
            </div>
          </div>
          {!isScheduled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {(match.sets ?? []).map(set => {
                const healed = parseAndHealSet(set)
                const p2WonSet = healed.p2 > healed.p1
                return (
                  <span key={set.set_number} style={{ ...scoreNumStyle(p2WonSet && !set.is_current, !p2WonSet && !set.is_current, !!set.is_current), position: 'relative' }}>
                    {healed.p2}
                    {healed.tb != null && !p2WonSet && <sup style={{ fontSize: 9, color: MUTED, position: 'absolute', top: 2, right: -2 }}>{healed.tb}</sup>}
                  </span>
                )
              })}
              <span style={{ width: 8 }} />
              {!isFinished && (
                <span
                  key={flashPair === 2 ? `p2-${flashKeyRef.current}` : 'p2'}
                  style={{
                    display: 'inline-block',
                    fontSize: 22, fontWeight: 900, width: 28, textAlign: 'center', fontFamily: 'monospace', lineHeight: 1,
                    color: starPoint ? ORANGE : LIVE_RED,
                    ...(flashPair === 2 ? { animation: 'pn-score-roll 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both' } : {}),
                  }}
                >
                  {/* Fallback '0' matches the pair1 side above. See comment there. */}
                  {p2Point ?? '0'}
                </span>
              )}
            </div>
          )}
        </div>
        {/* Sentinel: compact bar appears when this scrolls out of view */}
        <div ref={heroSentinelRef} style={{ height: 0 }} />
      </div>

      {/* ── SCHEDULED: prediction + countdown + info ─────────────────── */}
      {isScheduled && (() => {
        // Only show predictions for tournaments with PBP coverage (padelapi source)
        const tournamentSource = ((match as any).tournament)?.source as string | null
        const hasPbp = tournamentSource === 'padelapi' || !!(match as any).padelapi_id || !!(match as any).external_id
        return (
          <>
            {hasPbp && (
              <PredictionSection
                match={match}
                pair1Label={pair1Label}
                pair2Label={pair2Label}
                prediction={prediction}
                predStep={predStep}
                setPredStep={setPredStep}
                setPrediction={setPrediction}
                clearPrediction={clearPrediction}
              />
            )}
            <ScheduledSection match={match} pair1Label={pair1Label} pair2Label={pair2Label} countdown={countdown} tz={tz} />
          </>
        )
      })()}

      {/* ── LIVE: show prediction result (locked, no changes allowed) ── */}
      {isLive && prediction && (
        <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, clipPath: CHUNKY.card }}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(126,211,33,0.5)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>
              {tPred('yourPrediction')}
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>
              {tPred('win', { pair: prediction.pair === 1 ? pair1Label : pair2Label, margin: prediction.margin })}
            </div>
            <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>
              {tPred('locked')}
            </div>
          </div>
        </div>
      )}

      {/* ── Rate this match (above journey for prominence) ────────── */}
      {isFinished && (
        <MatchRatingCard rating={rating} setRating={setRating} avgRating={avgRating} ratingCount={ratingCount} />
      )}

      {/* ── Post-match prediction result ─────────────────────────── */}
      {isFinished && prediction && (
        <PredictionResult match={match} prediction={prediction} pair1Label={pair1Label} pair2Label={pair2Label} />
      )}

      {/* ── Where to Watch banner ────────────────────────────────── */}
      <WhereToWatchBanner
        matchStatus={match.status}
        liveChannels={wtwLiveChannels}
        broadcasters={wtwBroadcasters}
        channelsMeta={wtwChannelsMeta}
        todayCircuits={tournamentChannelAbbr ? [tournamentChannelAbbr] : []}
        geoCountry={wtwGeoCountry}
      />

      {/* ── Match Journey chart ───────────────────────────────────── */}
      {!isScheduled && (match.sets ?? []).length > 0 && (
        <MomentumChart
          sets={match.sets ?? []}
          pair1Label={pair1Label}
          pair2Label={pair2Label}
          isLive={isLive}
          pair1Color={PAIR1_COLOR}
          pair2Color={PAIR2_COLOR}
          pair1Avatars={[match.pair1_player1?.avatar_url ?? null, match.pair1_player2?.avatar_url ?? null]}
          pair2Avatars={[match.pair2_player1?.avatar_url ?? null, match.pair2_player2?.avatar_url ?? null]}
          pair1PlayerIds={[match.pair1_player1?.id ?? null, match.pair1_player2?.id ?? null]}
          pair2PlayerIds={[match.pair2_player1?.id ?? null, match.pair2_player2?.id ?? null]}
          onGameClick={(setNum, gameNum) => {
            setSubTab('live')
            // Wait for the SwipeTabView's 350ms transform animation to finish
            // before scrolling. If we scroll while the LIVE panel is still
            // mid-animation off-screen, scrollIntoView's inline-axis logic
            // shifts the document horizontally and bleeds the next tab into
            // view. inline: 'nearest' is the default but explicit is safer.
            setTimeout(() => {
              const el = document.getElementById(`game-s${setNum}-g${gameNum}`)
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
                el.style.background = 'rgba(126,211,33,0.08)'
                setTimeout(() => { el.style.background = '' }, 1500)
              }
            }, 380)
          }}
        />
      )}

      {/* ── Sub-tabs: scheduled shows Players + H2H, live/finished shows all ──
          Score Recap (stats) and Live Feed (point-by-point) only make
          sense for Premier Padel events — that's where padelapi feeds
          the data. For non-Premier (FIP) tournaments, hide both tabs
          and just show Players + H2H. */}
      {(() => {
        const tournamentLevel = ((match as any).tournament)?.level as string | null | undefined
        const isPremier = isPremierLevel(tournamentLevel)

        const breaks = computeBreaks(match)

        const recapTab = { key: 'recap', label: tMatch('scoreRecap') }
        const liveTab = { key: 'live', label: tMatch('liveFeed') }
        const playersTab = { key: 'players', label: tMatch('players') }
        const h2hTab = { key: 'h2h', label: tMatch('h2h') }

        // Show recap (Stats) for Premier matches always, and for non-Premier
        // matches when we have break data to surface. MatchStatsView handles
        // the "breaks-only" path when premier stats are unavailable.
        const showRecap = isPremier || breaks.hasData

        const tabList: { key: string; label: string }[] = isFinished
          ? showRecap
            ? [recapTab, ...(isPremier ? [liveTab] : []), playersTab, h2hTab]
            : [playersTab, h2hTab]
          : isScheduled
            ? [playersTab, h2hTab]
            : isPremier
              ? [liveTab, playersTab, h2hTab]
              : [playersTab, h2hTab]

        const tabKeys = tabList.map(t => t.key)
        const currentIdx = Math.max(0, tabKeys.indexOf(subTab))

        return (
          <SwipeTabView
            tabs={tabList}
            currentTab={currentIdx}
            onTabChange={(idx) => handleSubTab(tabKeys[idx] as SubTab)}
          >
            {tabList.map(t => (
              <div key={t.key} style={{ background: BG_CARD, minHeight: 300 }}>
                {t.key === 'recap' && isFinished && (
                  <MatchStatsView matchId={match.id} breaks={breaks} />
                )}
                {t.key === 'live' && (
                  <LiveFeedTab match={match} pair1Label={pair1Label} pair2Label={pair2Label} isLive={isLive} />
                )}
                {t.key === 'players' && (
                  <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {match.pair1_player1 && <PlayerCard player={match.pair1_player1} winner={p1Won} accent={PAIR1_COLOR} />}
                    {match.pair1_player2 && <PlayerCard player={match.pair1_player2} winner={p1Won} accent={PAIR1_COLOR} />}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                      <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
                      <span style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: '2px' }}>VS</span>
                      <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
                    </div>
                    {match.pair2_player1 && <PlayerCard player={match.pair2_player1} winner={p2Won} accent={PAIR2_COLOR} />}
                    {match.pair2_player2 && <PlayerCard player={match.pair2_player2} winner={p2Won} accent={PAIR2_COLOR} />}
                  </div>
                )}
                {t.key === 'h2h' && (
                  <H2HTab match={match} h2hMatches={h2hMatches} h2hLoading={h2hLoading} pair1Label={pair1Label} pair2Label={pair2Label} pair1Recent={pair1Recent} pair2Recent={pair2Recent} />
                )}
              </div>
            ))}
          </SwipeTabView>
        )
      })()}
    </main>
    <BottomNav />
    {shareToast && (
      <div style={{
        position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
        background: '#7ED321', color: '#000', padding: '8px 20px',
        borderRadius: 8, fontSize: 13, fontWeight: 700, zIndex: 1000,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      }}>
        {tMatch('linkCopied')}
      </div>
    )}
    </>
  )
}

// ── Clickable player name in hero ─────────────────────────────────────────────
function PlayerNameLink({ player, dim, muted, bold, router, style }: {
  player: any; dim?: boolean; muted?: boolean; bold?: boolean
  router: ReturnType<typeof import('next/navigation').useRouter>
  style?: React.CSSProperties
}) {
  const color = dim ? '#555' : muted ? '#aaa' : '#fff'
  return (
    <div
      onClick={player?.id ? () => router.push(`/player/${player.id}`) : undefined}
      style={{ fontSize: 11, fontWeight: bold ? 700 : 600, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: player?.id ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4, ...style }}
    >
      {player?.country && <FlagImage country={player.country} size={12} />}
      {toShortName(player?.display_name ?? player?.name ?? 'TBD')}
    </div>
  )
}
