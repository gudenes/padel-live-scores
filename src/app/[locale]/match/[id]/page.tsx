'use client'
// src/app/match/[id]/page.tsx
// V3 Match Detail — chunky clip-path brand language, no border-radius except circles.

import { useState, useEffect, useCallback, use, useRef, useMemo } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import { useRouter, Link } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { Match, Game, getCurrentScore, pairName, isStarPoint, parseSetScore, parseSetFromGames, toShortName } from '@/types/match'
import MomentumChart from './MomentumChart'
import BottomNav from '@/components/nav/BottomNavV3'
import Spinner from '@/app/components/Spinner'
import BrandedLoader, { LOADER_HINTS } from '@/app/components/BrandedLoader'
import { withTimeout } from '@/lib/with-timeout'
import { DATE_WITH_WEEKDAY, MONTH_YEAR } from '@/lib/format-patterns'
import { useMatchPrediction, Prediction } from '@/hooks/useMatchPrediction'
import { useMatchRating } from '@/hooks/useMatchRating'
import FollowButton from '@/components/FollowButton'
import { MatchStatsView } from '@/components/MatchStatsView'
import { SwipeTabView } from '@/components/SwipeTabView'
import { useAuth } from '@/components/AuthProvider'
import { logActivity } from '@/lib/activity-log'
import { spawnConfetti } from '@/lib/confetti'

type SubTab = 'recap' | 'live' | 'players' | 'h2h'

// ── V3 Brand colors ─────────────────────────────────────────────────────────
const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.15)'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_BASE = '#1A1A1A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

// ── Pair identity colors ────────────────────────────────────────────────────
const PAIR1_COLOR = '#FF6B2B'         // brand orange
const PAIR2_COLOR = '#FFD166'         // brand yellow
const PAIR1_BG    = 'rgba(255,107,43,0.08)'
const PAIR2_BG    = 'rgba(255,209,102,0.08)'
const PAIR1_BORDER = 'rgba(255,107,43,0.28)'
const PAIR2_BORDER = 'rgba(255,209,102,0.28)'

// ── Chunky clip-path presets ────────────────────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── FlagImg (replaces emoji flags) ──────────────────────────────────────────
function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  if (!country) return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  const code = country.toLowerCase()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      style={{ objectFit: 'cover', display: 'inline-block', flexShrink: 0, verticalAlign: 'middle' }}
    />
  )
}

// ── Score-flash tracking (module-level, survives remounts) ──────────────────
const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4 }
const _matchPrevScores = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()

// ── Point extraction from a game's points array ─────────────────────────────
function extractGamePoints(game: Game): { scorer: 1 | 2; score: string; isSP: boolean }[] {
  const pts = (game.points ?? []).filter(p => p !== '0:0')
  const result: { scorer: 1 | 2; score: string; isSP: boolean }[] = []
  const val = (s: string) => s === 'A' ? 50 : s === '40' ? 40 : s === '30' ? 30 : s === '15' ? 15 : 0
  const fmt = (s: string) => s === 'A' ? 'Adv' : s

  for (let i = 0; i < pts.length; i++) {
    const pt = pts[i]
    const [p1s, p2s] = pt.split(':')
    const p1v = val(p1s), p2v = val(p2s)
    let scorer: 1 | 2 | null = null

    if (i === 0) {
      scorer = p1v > 0 ? 1 : p2v > 0 ? 2 : null
    } else {
      const [p1sPrev, p2sPrev] = pts[i - 1].split(':')
      if (p1v > val(p1sPrev)) scorer = 1
      else if (p2v > val(p2sPrev)) scorer = 2
    }
    if (!scorer) continue
    const isSP = pt === '40:40' && pts.slice(0, i).some(p => p === 'A:40' || p === '40:A')
    result.push({ scorer, score: `${fmt(p1s)} – ${fmt(p2s)}`, isSP })
  }
  return result
}

// ── Compute game winner from its score vs the previous game's score ─────────
function computeGameWinner(games: any[], idx: number): 1 | 2 | null {
  const game = games[idx]
  const score = game?.game_score
  if (!score || score === '0-0') return null
  const [p1, p2] = score.split('-').map(Number)
  if (idx === 0) return p1 > p2 ? 1 : 2
  const prev = games[idx - 1]?.game_score
  if (!prev || prev === '0-0') return p1 > p2 ? 1 : 2
  const [pp1, pp2] = prev.split('-').map(Number)
  if (p1 > pp1) return 1
  if (p2 > pp2) return 2
  return null
}

// ── Pair match checker for H2H filtering ────────────────────────────────────
function pairMatchesIds(p1Id: string | null, p2Id: string | null, targetIds: string[]): boolean {
  return targetIds.includes(p1Id ?? '') && targetIds.includes(p2Id ?? '')
}

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const tMatch = useTranslations('matchDetail')
  const tPred = useTranslations('prediction')
  const tCommon = useTranslations('common')
  const tRating = useTranslations('rating')
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
      const result = await withTimeout<{ data: any; error: any }>(
        supabase
          .from('matches')
          .select(`
            *,
            tournament:tournaments(id, name, starts_at, ends_at, country, timezone, source),
            pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
            sets(*, games(*))
          `)
          .eq('id', id)
          .single() as unknown as Promise<{ data: any; error: any }>,
        10_000,
        'match:detail'
      )
      const { data, error } = result

      if (error || !data) return

      const sorted = {
        ...data,
        sets: (data.sets ?? [])
          .sort((a: any, b: any) => a.set_number - b.set_number)
          .map((set: any) => ({
            ...set,
            games: (set.games ?? []).sort((a: any, b: any) => a.game_number - b.game_number),
          })),
      }
      setMatch(sorted as Match)
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
    if (match?.status === 'finished') setSubTab('recap')
    else if (match?.status === 'scheduled') setSubTab('players')
  }, [match?.status])

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
  // Extract current point for flash detection (same logic used below for display)
  const _cg = match ? getCurrentScore(match).currentGame : null
  const _cp = _cg?.points?.filter(p => p !== '0:0').slice(-1)[0] ?? null
  const _p1Pt = _cp ? _cp.split(':')[0] : '0'
  const _p2Pt = _cp ? _cp.split(':')[1] : '0'
  const _isLive = match?.status === 'live'

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

  if (loading) return (
    <>
    <main style={{ background: BG_BASE, minHeight: '100vh' }}>
      <BrandedLoader hints={[...LOADER_HINTS.match]} />
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

  const currentPoint = currentGame?.points?.filter(p => p !== '0:0').slice(-1)[0] ?? null
  const [p1Point, p2Point] = currentPoint ? currentPoint.split(':') : [null, null]
  const starPoint = currentGame ? isStarPoint(currentGame.points ?? []) : false

  const isScheduled = match.status === 'scheduled'
  const isFinished = ['finished', 'retired', 'walkover'].includes(match.status)
  const isRetired = match.status === 'retired'
  const isWalkover = match.status === 'walkover'
  const isLive = match.status === 'live'
  const winnerPair = (match as any).winner_pair
  const p1Won = isFinished && winnerPair === 1
  const p2Won = isFinished && winnerPair === 2
  const p1Leading = !isFinished && (p1Point === 'A' || (p1Point && p2Point && p1Point !== 'A' && p2Point !== 'A' && parseInt(p1Point) > parseInt(p2Point)))
  const p2Leading = !isFinished && (p2Point === 'A' || (p1Point && p2Point && p1Point !== 'A' && p2Point !== 'A' && parseInt(p2Point) > parseInt(p1Point)))

  const category = (match as any).category as string | null
  const duration = (match as any).duration as string | null
  const matchDate = match.started_at ? format.dateTime(new Date(match.started_at), DATE_WITH_WEEKDAY) : null

  const tz = ((match as any).tournament)?.timezone ?? 'UTC'
  const scheduledAt = (match as any).starts_at as string | null
  const scheduledTimeStr = scheduledAt ? new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(scheduledAt)) : null
  const scheduledDateStr = scheduledAt ? new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(scheduledAt)) : matchDate

  // ── Shared styles ──────────────────────────────────────────────────────────
  const scoreNumStyle = (won: boolean, dim: boolean): React.CSSProperties => ({
    fontSize: 28, fontWeight: 900, width: 28, textAlign: 'center',
    fontFamily: 'monospace', lineHeight: 1,
    color: won ? '#fff' : dim ? '#444' : '#555',
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
    <main style={{ background: BG_BASE, minHeight: '100vh', maxWidth: 500, margin: '0 auto', paddingBottom: 64 }}>

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
            try {
              if (typeof navigator !== 'undefined' && navigator.share) {
                await navigator.share({ title, text, url: shareUrl })
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
                const parsed = parseSetScore(set.set_score) ?? parseSetFromGames(set.pair1_games, set.pair2_games)
                const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
                return (
                  <span key={set.set_number} style={{ fontSize: 13, fontWeight: 800, width: 18, textAlign: 'center', fontFamily: 'monospace', color: set.is_current ? GREEN : p1WonSet ? '#fff' : '#B0B5BE' }}>
                    {parsed ? parsed.p1 : (set.pair1_games ?? 0)}
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
                const parsed = parseSetScore(set.set_score) ?? parseSetFromGames(set.pair1_games, set.pair2_games)
                const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
                return (
                  <span key={set.set_number} style={{ fontSize: 13, fontWeight: 800, width: 18, textAlign: 'center', fontFamily: 'monospace', color: set.is_current ? GREEN : p2WonSet ? '#fff' : '#B0B5BE' }}>
                    {parsed ? parsed.p2 : (set.pair2_games ?? 0)}
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

        {/* Scheduled: big time display */}
        {isScheduled && scheduledTimeStr && (
          <div style={{ textAlign: 'center', padding: '10px 0 16px', background: 'linear-gradient(180deg, rgba(126,211,33,0.04) 0%, transparent 100%)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: GREEN, marginBottom: 6 }}>Match starts at</div>
            <div style={{ fontSize: 52, fontWeight: 900, letterSpacing: '-2px', color: '#fff', fontFamily: 'monospace', lineHeight: 1 }}>{scheduledTimeStr}</div>
            <div style={{ fontSize: 11, color: MUTED, marginTop: 5 }}>{scheduledDateStr} · {tz.replace('_', ' ')}</div>
            {match.court && <div style={{ fontSize: 10, color: GREEN, fontWeight: 600, marginTop: 6 }}>{match.court}</div>}
          </div>
        )}

        {/* Set column labels (live/finished only) */}
        {!isScheduled && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 4, paddingRight: 2 }}>
            {(match.sets ?? []).map(set => (
              <span key={set.set_number} style={{ fontSize: 9, width: 28, textAlign: 'center', color: set.is_current ? GREEN : '#555', fontWeight: 700 }}>S{set.set_number}</span>
            ))}
            <span style={{ width: 8 }} />
            {!isFinished && <span style={{ fontSize: 9, width: 36, textAlign: 'center', color: MUTED, fontWeight: 700 }}>Pts</span>}
          </div>
        )}

        {/* Pair 1 row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, ...(!isLive && !isScheduled ? { borderBottom: `0.5px solid ${BORDER}` } : {}) }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <PlayerSquare player={match.pair1_player1} winner={p1Won} router={router} />
            <PlayerSquare player={match.pair1_player2} winner={p1Won} router={router} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <PlayerNameLink player={match.pair1_player1} dim={!!p2Won} muted={!!p2Leading} bold={!!p1Won} router={router} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <PlayerNameLink player={match.pair1_player2} dim={!!p2Won} muted={!!p2Leading} bold={!!p1Won} router={router} />
              {isRetired && p2Won && <span style={{ fontSize: 8, fontWeight: 700, color: '#F5A623', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 6px', flexShrink: 0 }}>RET</span>}
            </div>
          </div>
          {!isScheduled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {(match.sets ?? []).map(set => {
                const parsed = parseSetScore(set.set_score) ?? parseSetFromGames(set.pair1_games, set.pair2_games)
                const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
                return (
                  <span key={set.set_number} style={{ ...scoreNumStyle(p1WonSet && !set.is_current, set.is_current || (!!parsed && !p1WonSet)), position: 'relative' }}>
                    {parsed ? parsed.p1 : (set.pair1_games ?? 0)}
                    {parsed?.tb != null && !p1WonSet && <sup style={{ fontSize: 10, color: MUTED, position: 'absolute', top: 2, right: -2 }}>{parsed.tb}</sup>}
                  </span>
                )
              })}
              <span style={{ width: 8 }} />
              {!isFinished && (
                <span
                  key={flashPair === 1 ? `p1-${flashKeyRef.current}` : 'p1'}
                  style={{
                    display: 'inline-block',
                    fontSize: 28, fontWeight: 900, width: 36, textAlign: 'center', fontFamily: 'monospace', lineHeight: 1,
                    color: starPoint ? ORANGE : LIVE_RED,
                    ...(flashPair === 1 ? { animation: 'pn-score-roll 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both' } : {}),
                  }}
                >
                  {p1Point ?? pair1Sets}
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
            <PlayerNameLink player={match.pair2_player1} dim={!!p1Won} muted={!!p1Leading} bold={!!p2Won} router={router} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4 }}>
              <PlayerNameLink player={match.pair2_player2} dim={!!p1Won} muted={!!p1Leading} bold={!!p2Won} router={router} />
              {isRetired && p1Won && <span style={{ fontSize: 8, fontWeight: 700, color: '#F5A623', background: 'rgba(245,166,35,0.12)', border: '1px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 6px', flexShrink: 0 }}>RET</span>}
            </div>
          </div>
          {!isScheduled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {(match.sets ?? []).map(set => {
                const parsed = parseSetScore(set.set_score) ?? parseSetFromGames(set.pair1_games, set.pair2_games)
                const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
                return (
                  <span key={set.set_number} style={{ ...scoreNumStyle(p2WonSet && !set.is_current, set.is_current || (!!parsed && !p2WonSet)), position: 'relative' }}>
                    {parsed ? parsed.p2 : (set.pair2_games ?? 0)}
                    {parsed?.tb != null && !p2WonSet && <sup style={{ fontSize: 10, color: MUTED, position: 'absolute', top: 2, right: -2 }}>{parsed.tb}</sup>}
                  </span>
                )
              })}
              <span style={{ width: 8 }} />
              {!isFinished && (
                <span
                  key={flashPair === 2 ? `p2-${flashKeyRef.current}` : 'p2'}
                  style={{
                    display: 'inline-block',
                    fontSize: 28, fontWeight: 900, width: 36, textAlign: 'center', fontFamily: 'monospace', lineHeight: 1,
                    color: starPoint ? ORANGE : LIVE_RED,
                    ...(flashPair === 2 ? { animation: 'pn-score-roll 0.9s cubic-bezier(0.34, 1.56, 0.64, 1) both' } : {}),
                  }}
                >
                  {p2Point ?? pair2Sets}
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
          onGameClick={(setNum, gameNum) => {
            setSubTab('live')
            setTimeout(() => {
              const el = document.getElementById(`game-s${setNum}-g${gameNum}`)
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' })
                el.style.background = 'rgba(126,211,33,0.08)'
                setTimeout(() => { el.style.background = '' }, 1500)
              }
            }, 100)
          }}
        />
      )}

      {/* ── Sub-tabs: scheduled shows Players + H2H, live/finished shows all ── */}
      {(() => {
        const tabList: { key: string; label: string }[] = isFinished
          ? [{ key: 'recap', label: tMatch('scoreRecap') }, { key: 'live', label: tMatch('liveFeed') }, { key: 'players', label: tMatch('players') }, { key: 'h2h', label: tMatch('h2h') }]
          : isScheduled
            ? [{ key: 'players', label: tMatch('players') }, { key: 'h2h', label: tMatch('h2h') }]
            : [{ key: 'live', label: tMatch('liveFeed') }, { key: 'players', label: tMatch('players') }, { key: 'h2h', label: tMatch('h2h') }]

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
                  <MatchStatsView matchId={match.id} />
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

// ── Clickable player name in hero ───────────────────────────────────────────
function PlayerNameLink({ player, dim, muted, bold, router, style }: {
  player: any; dim?: boolean; muted?: boolean; bold?: boolean
  router: ReturnType<typeof import('next/navigation').useRouter>
  style?: React.CSSProperties
}) {
  const color = dim ? '#555' : muted ? '#aaa' : '#fff'
  return (
    <div
      onClick={player?.id ? () => router.push(`/player/${player.id}`) : undefined}
      style={{ fontSize: 13, fontWeight: bold ? 700 : 600, color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: player?.id ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4, ...style }}
    >
      {player?.country && <FlagImg country={player.country} size={14} />}
      {toShortName(player?.display_name ?? player?.name ?? 'TBD')}
    </div>
  )
}

// ── Live Banner (unused — LIVE badge now in nav bar) ───────────────────────
function LiveBanner(_props: { match: Match; currentSet: any; currentGame: any }) {
  return null
}

// ── Winner Banner ───────────────────────────────────────────────────────────
function WinnerBanner({ match, winnerPair, pair1Label, pair2Label, nextMatchId }: { match: Match; winnerPair: number; pair1Label: string; pair2Label: string; nextMatchId: string | null }) {
  const winnerLabel = winnerPair === 1 ? pair1Label : pair2Label
  const round = (match.round ?? '').toLowerCase()
  const isFinal = round.includes('final') && !round.includes('semifinal') && !round.includes('quarter')
  const advancement = round.includes('semifinal') ? { badge: 'Finals', text: 'Advances to the Finals' }
    : round.includes('quarter') ? { badge: 'Semifinals', text: 'Advances to the Semifinals' }
    : isFinal ? { badge: 'Champion', text: 'Tournament Champion!' }
    : null
  return (
    <div style={{ padding: '14px 16px', background: 'linear-gradient(135deg, rgba(126,211,33,0.04), rgba(126,211,33,0.01))', borderBottom: `0.5px solid rgba(126,211,33,0.2)`, position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at 50% -20%, rgba(126,211,33,0.09) 0%, transparent 65%)', pointerEvents: 'none' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: GREEN_DIM, clipPath: CHUNKY.badge, flexShrink: 0 }}>
          <span style={{ fontSize: 16, color: GREEN, fontWeight: 900 }}>W</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(126,211,33,0.6)', textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 3 }}>Winner</div>
          <div style={{ fontSize: 17, fontWeight: 900, color: GREEN, lineHeight: 1.2 }}>{winnerLabel}</div>
        </div>
        {advancement && (
          <div style={{ background: GREEN_DIM, border: `0.5px solid rgba(126,211,33,0.25)`, clipPath: CHUNKY.badge, padding: '4px 10px', flexShrink: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: GREEN }}>{advancement.badge}</span>
          </div>
        )}
      </div>
      {!isFinal && nextMatchId && (
        <Link href={`/match/${nextMatchId}`} style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 42, marginTop: 8, textDecoration: 'none' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: GREEN }}>{advancement ? advancement.text : 'Next match'}</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" /><polyline points="12 5 19 12 12 19" />
          </svg>
        </Link>
      )}
      {isFinal && advancement && (
        <div style={{ fontSize: 10, color: 'rgba(126,211,33,0.4)', paddingLeft: 42, marginTop: 6 }}>{advancement.text}</div>
      )}
    </div>
  )
}

// ── Simulated community poll (deterministic from match ID) ──────────────────
function simulatePoll(matchId: string): { pair1Pct: number; totalVotes: number; straightPct: number } {
  let hash = 0
  for (let i = 0; i < matchId.length; i++) {
    hash = ((hash << 5) - hash) + matchId.charCodeAt(i)
    hash |= 0
  }
  const pair1Pct = 45 + (Math.abs(hash) % 25) // 45-69%
  const totalVotes = 20 + (Math.abs(hash >> 8) % 80) // 20-99
  const straightPct = 30 + (Math.abs(hash >> 16) % 35) // 30-64%
  return { pair1Pct, totalVotes, straightPct }
}

// ── Prediction Section (Scheduled matches) ─────────────────────────────────
function PredictionSection({ match, pair1Label, pair2Label, prediction, predStep, setPredStep, setPrediction, clearPrediction }: {
  match: Match; pair1Label: string; pair2Label: string
  prediction: Prediction | null
  predStep: 'pick' | 'margin' | 'done'
  setPredStep: (s: 'pick' | 'margin' | 'done') => void
  setPrediction: (p: Prediction) => void
  clearPrediction: () => void
}) {
  const tPred = useTranslations('prediction')
  const [selectedPair, setSelectedPair] = useState<1 | 2 | null>(prediction?.pair ?? null)
  const [pollAnimated, setPollAnimated] = useState(false)

  const handlePickPair = (pair: 1 | 2) => {
    setSelectedPair(pair)
    setPredStep('margin')
  }

  const handlePickMargin = (margin: '2-0' | '2-1') => {
    if (!selectedPair) return
    setPrediction({ pair: selectedPair, margin })
    setPredStep('done')
    setPollAnimated(false)
    // Trigger poll bar animation after mount
    setTimeout(() => setPollAnimated(true), 50)
  }

  const handleChange = () => {
    clearPrediction()
    setSelectedPair(null)
    setPredStep('pick')
    setPollAnimated(false)
  }

  // Trigger poll animation on mount if already confirmed
  useEffect(() => {
    if (predStep === 'done' && prediction) {
      const t = setTimeout(() => setPollAnimated(true), 50)
      return () => clearTimeout(t)
    }
  }, [predStep, prediction])

  const p1Short = pair1Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')
  const p2Short = pair2Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')

  const poll = useMemo(() => simulatePoll(match.id), [match.id])
  const pair2Pct = 100 - poll.pair1Pct

  // Player rankings for comparison strip
  const p1r1 = match.pair1_player1?.ranking
  const p1r2 = match.pair1_player2?.ranking
  const p2r1 = match.pair2_player1?.ranking
  const p2r2 = match.pair2_player2?.ranking
  const avgRankP1 = p1r1 && p1r2 ? Math.round((p1r1 + p1r2) / 2) : (p1r1 ?? p1r2 ?? null)
  const avgRankP2 = p2r1 && p2r2 ? Math.round((p2r1 + p2r2) / 2) : (p2r1 ?? p2r2 ?? null)

  // Reduced motion check
  const prefersReduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

  return (
    <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '16px' }}>
      {/* Heading */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={MUTED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
        </svg>
        <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '2px' }}>
          {tPred('whoTakesIt')}
        </span>
      </div>

      {/* ── Pick / Margin state: show pair cards ── */}
      {(predStep === 'pick' || predStep === 'margin') && (
        <>
          {/* Two pair cards */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            {([1, 2] as const).map(pair => {
              const label = pair === 1 ? p1Short : p2Short
              const color = pair === 1 ? PAIR1_COLOR : PAIR2_COLOR
              const isSelected = selectedPair === pair
              const isDimmed = selectedPair !== null && selectedPair !== pair
              const p1 = pair === 1 ? match.pair1_player1 : match.pair2_player1
              const p2 = pair === 1 ? match.pair1_player2 : match.pair2_player2
              const ranking = pair === 1 ? avgRankP1 : avgRankP2

              return (
                <button
                  key={pair}
                  onClick={() => handlePickPair(pair)}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                    padding: '14px 10px', clipPath: CHUNKY.card,
                    background: isSelected ? (pair === 1 ? 'rgba(255,107,43,0.12)' : 'rgba(255,209,102,0.12)') : (pair === 1 ? PAIR1_BG : PAIR2_BG),
                    border: isSelected ? `2px solid ${color}` : `1.5px solid ${isDimmed ? BORDER : (pair === 1 ? PAIR1_BORDER : PAIR2_BORDER)}`,
                    boxShadow: isSelected ? `0 0 16px ${pair === 1 ? 'rgba(255,107,43,0.12)' : 'rgba(255,209,102,0.12)'}` : 'none',
                    cursor: 'pointer', fontFamily: 'inherit', position: 'relative',
                    opacity: isDimmed ? 0.35 : 1,
                    transform: isSelected ? 'scale(1.02)' : 'scale(1)',
                    transition: prefersReduced ? 'none' : 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 300ms ease, box-shadow 300ms ease, opacity 200ms ease-out',
                  }}
                >
                  {isSelected && (
                    <div style={{ position: 'absolute', top: 5, right: 8 }}>
                      <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </div>
                  )}
                  <div style={{ display: 'flex' }}>
                    <PlayerAvatar player={p1} size={32} accent={isSelected ? color : undefined} />
                    <div style={{ marginLeft: -6 }}>
                      <PlayerAvatar player={p2} size={32} accent={isSelected ? color : undefined} />
                    </div>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isDimmed ? '#555' : color, textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
                  {ranking && !isDimmed && (
                    <span style={{ fontSize: 9, color: MUTED }}>Avg #{ranking}</span>
                  )}
                  {isSelected && (
                    <span style={{ fontSize: 8, fontWeight: 700, color, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{tPred('yourPick')}</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Comparison strip */}
          <div style={{ display: 'flex', marginBottom: 14, clipPath: CHUNKY.card }}>
            <div style={{ flex: 1, padding: '7px 8px', background: '#1F1F1F', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Ranking</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR1_COLOR }}>{avgRankP1 ? `#${avgRankP1}` : '–'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR2_COLOR }}>{avgRankP2 ? `#${avgRankP2}` : '–'}</span>
              </div>
            </div>
            <div style={{ flex: 1, padding: '7px 8px', background: '#1F1F1F', textAlign: 'center', borderRight: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Matches</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR1_COLOR }}>{match.pair1_player1?.total_matches ?? '–'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR2_COLOR }}>{match.pair2_player1?.total_matches ?? '–'}</span>
              </div>
            </div>
            <div style={{ flex: 1, padding: '7px 8px', background: '#1F1F1F', textAlign: 'center' }}>
              <div style={{ fontSize: 7, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 2 }}>Win rate</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 6px' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR1_COLOR }}>{match.pair1_player1?.win_rate != null ? `${Math.round(match.pair1_player1.win_rate)}%` : '–'}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: PAIR2_COLOR }}>{match.pair2_player1?.win_rate != null ? `${Math.round(match.pair2_player1.win_rate)}%` : '–'}</span>
              </div>
            </div>
          </div>

          {/* Prompt or margin selector */}
          {predStep === 'pick' && (
            <div style={{ textAlign: 'center', fontSize: 9, color: '#4A6F8E' }}>{tPred('tapThePair')}</div>
          )}

          {predStep === 'margin' && selectedPair && (
            <div>
              <div style={{ textAlign: 'center', fontSize: 9, color: '#6889A5', fontWeight: 600, marginBottom: 8 }}>{tPred('howDoesItEnd')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => handlePickMargin('2-0')} style={{
                  flex: 1, padding: '12px 8px', clipPath: CHUNKY.button,
                  background: 'rgba(126,211,33,0.06)', border: '1.5px solid rgba(126,211,33,0.25)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: GREEN, fontFamily: 'monospace' }}>2–0</span>
                  <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(126,211,33,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tPred('straightSets')}</span>
                </button>
                <button onClick={() => handlePickMargin('2-1')} style={{
                  flex: 1, padding: '12px 8px', clipPath: CHUNKY.button,
                  background: 'rgba(245,166,35,0.06)', border: '1.5px solid rgba(245,166,35,0.25)',
                  cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: ORANGE, fontFamily: 'monospace' }}>2–1</span>
                  <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(245,166,35,0.5)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{tPred('threeSetBattle')}</span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Confirmed state: prediction card + community poll ── */}
      {predStep === 'done' && prediction && (
        <>
          {/* Prediction card */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', marginBottom: 14, clipPath: CHUNKY.card,
            background: 'rgba(126,211,33,0.04)', border: '1px solid rgba(126,211,33,0.15)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <div>
                <div style={{ fontSize: 8, fontWeight: 700, color: 'rgba(126,211,33,0.45)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>{tPred('yourPrediction')}</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>
                  {tPred('win', { pair: prediction.pair === 1 ? p1Short : p2Short, margin: prediction.margin === '2-0' ? '2–0' : '2–1' })}
                </div>
              </div>
            </div>
            <button onClick={handleChange} style={{
              background: 'transparent', border: '0.5px solid rgba(126,211,33,0.2)', clipPath: CHUNKY.badge,
              padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
              fontSize: 8, fontWeight: 700, color: GREEN,
            }}>
              {tPred('change')}
            </button>
          </div>

          {/* Community poll */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 8, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1.5px', marginBottom: 8, textAlign: 'center' }}>
              {tPred('whatOthersThink')}
            </div>
            <div style={{ position: 'relative', height: 34, overflow: 'hidden', clipPath: CHUNKY.card, background: '#1F1F1F' }}>
              <div style={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: pollAnimated ? `${poll.pair1Pct}%` : '0%',
                background: 'linear-gradient(90deg, rgba(255,107,43,0.25), rgba(255,107,43,0.08))',
                display: 'flex', alignItems: 'center', paddingLeft: 10,
                transition: prefersReduced ? 'none' : 'width 700ms cubic-bezier(0.25, 0.1, 0.25, 1) 500ms',
              }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: PAIR1_COLOR }}>{poll.pair1Pct}%</span>
                <span style={{ fontSize: 9, color: 'rgba(255,107,43,0.6)', marginLeft: 5, whiteSpace: 'nowrap' }}>{p1Short}</span>
              </div>
              <div style={{
                position: 'absolute', right: 0, top: 0, bottom: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 10,
              }}>
                <span style={{ fontSize: 9, color: 'rgba(255,209,102,0.6)', marginRight: 5, whiteSpace: 'nowrap' }}>{p2Short}</span>
                <span style={{ fontSize: 12, fontWeight: 800, color: PAIR2_COLOR }}>{pair2Pct}%</span>
              </div>
            </div>
            <div style={{ fontSize: 9, color: '#4A6F8E', marginTop: 5, textAlign: 'center' }}>
              {tPred('fansHavePredicted', { count: poll.totalVotes })}{' '}
              {prediction.pair === 1
                ? (poll.pair1Pct >= 50 ? `· ${tPred('withMajority')}` : `· ${tPred('boldPick')}`)
                : (pair2Pct >= 50 ? `· ${tPred('withMajority')}` : `· ${tPred('boldPick')}`)}
            </div>
          </div>

          {/* Margin breakdown */}
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, padding: 9, background: '#1F1F1F', textAlign: 'center', clipPath: CHUNKY.card }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: GREEN, fontFamily: 'monospace' }}>2–0</div>
              <div style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>{poll.straightPct}% {tPred('predict')}</div>
            </div>
            <div style={{ flex: 1, padding: 9, background: '#1F1F1F', textAlign: 'center', clipPath: CHUNKY.card }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: ORANGE, fontFamily: 'monospace' }}>2–1</div>
              <div style={{ fontSize: 8, color: MUTED, marginTop: 2 }}>{100 - poll.straightPct}% {tPred('predict')}</div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Post-Match Prediction Result ────────────────────────────────────────────
function PredictionResult({ match, prediction, pair1Label, pair2Label }: {
  match: Match; prediction: Prediction; pair1Label: string; pair2Label: string
}) {
  const tPred = useTranslations('prediction')
  const ref = useRef<HTMLDivElement>(null)
  const p1Short = pair1Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')
  const p2Short = pair2Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')

  const winnerPair = match.winner_pair as 1 | 2 | null
  if (!winnerPair) return null

  // Count sets to determine actual margin
  const sets = match.sets ?? []
  const p1Sets = sets.filter(s => (s.pair1_games ?? 0) > (s.pair2_games ?? 0)).length
  const p2Sets = sets.filter(s => (s.pair2_games ?? 0) > (s.pair1_games ?? 0)).length
  const actualMargin = winnerPair === 1 ? `${p1Sets}-${p2Sets}` : `${p2Sets}-${p1Sets}`
  const winnerLabel = winnerPair === 1 ? p1Short : p2Short
  const loserLabel = winnerPair === 1 ? p2Short : p1Short

  const pairCorrect = prediction.pair === winnerPair
  const marginCorrect = pairCorrect && (prediction.margin === '2-0' ? actualMargin === '2-0' : actualMargin === '2-1')

  // Determine variant
  let variant: 'correct' | 'close' | 'wrong'
  if (pairCorrect && marginCorrect) variant = 'correct'
  else if (pairCorrect) variant = 'close'
  else variant = 'wrong'

  const config = {
    correct: {
      bg: 'rgba(126,211,33,0.05)', border: 'rgba(126,211,33,0.15)', color: GREEN,
      title: tPred('spotOn'),
      desc: tPred('calledIt', { pair: winnerLabel, margin: actualMargin }),
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      ),
    },
    close: {
      bg: 'rgba(245,166,35,0.04)', border: 'rgba(245,166,35,0.12)', color: ORANGE,
      title: tPred('closeCall'),
      desc: prediction.margin === '2-0'
        ? tPred('wrongMarginThree')
        : tPred('wrongMarginTwo'),
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
        </svg>
      ),
    },
    wrong: {
      bg: 'rgba(255,70,85,0.04)', border: 'rgba(255,70,85,0.12)', color: LIVE_RED,
      title: tPred('notThisTime'),
      desc: tPred('youBacked', { picked: prediction.pair === 1 ? p1Short : p2Short, winner: winnerLabel, margin: actualMargin }),
      icon: (
        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke={LIVE_RED} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 20h20"/><path d="M4 20V10l4 4 4-8 4 8 4-4v10"/>
        </svg>
      ),
    },
  }

  const c = config[variant]

  return (
    <div ref={ref} style={{ padding: '0 16px 0', background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
      <div style={{
        padding: 16, clipPath: CHUNKY.card, textAlign: 'center',
        background: c.bg, border: `1px solid ${c.border}`,
      }}>
        <div style={{ marginBottom: 4 }}>{c.icon}</div>
        <div style={{ fontSize: 14, fontWeight: 800, color: c.color, marginBottom: 4 }}>{c.title}</div>
        <div style={{ fontSize: 11, color: '#9AAEC4', marginBottom: variant === 'correct' ? 10 : 0 }}>{c.desc}</div>
        {variant === 'close' && (
          <div style={{ marginTop: 8 }}>
            <span style={{ clipPath: CHUNKY.badge, padding: '4px 10px', background: 'rgba(245,166,35,0.08)', fontSize: 10, fontWeight: 700, color: ORANGE }}>
              {tPred('rightPairWrongMargin')}
            </span>
          </div>
        )}
        {variant === 'correct' && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <span style={{ clipPath: CHUNKY.badge, padding: '4px 10px', background: 'rgba(126,211,33,0.08)', fontSize: 10, fontWeight: 700, color: GREEN, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22c4-2.5 7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 3 8.5 7 11z"/><path d="M12 22c-1.5-1.5-3-4-3-7a3 3 0 0 1 6 0c0 3-1.5 5.5-3 7z"/>
              </svg>
              {tPred('nailedIt')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Scheduled Section ───────────────────────────────────────────────────────
function ScheduledSection({ match, pair1Label, pair2Label, countdown, tz }: {
  match: Match; pair1Label: string; pair2Label: string
  countdown: { h: number; m: number; s: number }; tz: string
}) {
  const tMatch = useTranslations('matchDetail')
  const tCommon = useTranslations('common')
  const pad = (n: number) => String(n).padStart(2, '0')
  const tournamentName = ((match as any).tournament)?.name ?? null
  const scheduleLabel = (match as any).schedule_label as string | null
  const isApproximate = /not before|followed by/i.test(scheduleLabel ?? '')
  const hasTime = match.scheduled_at
    ? (() => { const d = new Date(match.scheduled_at); return d.getUTCHours() !== 0 || d.getUTCMinutes() !== 0 })()
    : false
  const hasCountdown = hasTime && (countdown.h > 0 || countdown.m > 0 || countdown.s > 0)

  return (
    <>
      {/* Countdown */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px', textAlign: 'center' }}>
        {hasCountdown ? (
          <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            {isApproximate ? tMatch('estimatedStartIn') : tMatch('startsIn')}
          </div>
        ) : (
          <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>
            {hasTime ? tMatch('startingSoon') : tMatch('startTimeTbd')}
          </div>
        )}
        {hasCountdown ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
              {[{ n: countdown.h, l: tCommon('hrs') }, { n: countdown.m, l: tCommon('min') }, { n: countdown.s, l: tCommon('sec') }].map(({ n, l }, i) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {i > 0 && <span style={{ fontSize: 22, fontWeight: 900, color: BORDER, marginTop: -6 }}>:</span>}
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: isApproximate ? '#F5A623' : GREEN, lineHeight: 1 }}>{pad(n)}</div>
                    <div style={{ fontSize: 8, color: MUTED, marginTop: 2, letterSpacing: '0.5px' }}>{l}</div>
                  </div>
                </div>
              ))}
            </div>
            {isApproximate && (
              <div style={{ fontSize: 9, color: '#F5A623', marginTop: 8, fontWeight: 600 }}>
                ⚠ {tMatch('timeEstimated')}
              </div>
            )}
          </>
        ) : hasTime ? (
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>Match is about to start</div>
        ) : (
          <div style={{ fontSize: 11, color: MUTED }}>Schedule will be updated when available</div>
        )}
      </div>

      {/* Tournament info */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
        {[
          tournamentName && { key: tMatch('tournament'), val: tournamentName },
          match.round && { key: tMatch('round'), val: match.round },
          match.court && { key: tMatch('court'), val: match.court },
          { key: tMatch('timezone'), val: tz.replace(/_/g, ' ') },
        ].filter(Boolean).map((row: any) => (
          <div key={row.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderBottom: `0.5px solid ${BORDER}` }}>
            <span style={{ fontSize: 11, color: MUTED, fontWeight: 600 }}>{row.key}</span>
            <span style={{ fontSize: 11, color: '#ccc', fontWeight: 600 }}>{row.val}</span>
          </div>
        ))}
      </div>
    </>
  )
}

// ── Match Rating Card ───────────────────────────────────────────────────────
function useReactionLabels(): Record<number, string> {
  const t = useTranslations('rating')
  return { 1: t('boring'), 2: t('meh'), 3: t('decent'), 4: t('greatMatch'), 5: t('epic') }
}

function MatchRatingCard({ rating, setRating, avgRating, ratingCount }: {
  rating: number | null
  setRating: (n: number) => void
  avgRating: number | null
  ratingCount: number
}) {
  const t = useTranslations('rating')
  const REACTION_LABELS = useReactionLabels()
  const [justRated, setJustRated] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(rating != null)
  const [showPoints, setShowPoints] = useState(false)
  const badgeRef = useRef<HTMLDivElement>(null)

  const handleRate = (n: number) => {
    setRating(n)
    setJustRated(n)
    setShowPoints(true)

    // Fire confetti from the widget
    setTimeout(() => {
      if (badgeRef.current) spawnConfetti(badgeRef.current)
    }, 150)

    // Hide points floater
    setTimeout(() => { setShowPoints(false) }, 1400)

    // Collapse after celebration
    setTimeout(() => {
      setCollapsed(true)
      setJustRated(null)
    }, 2500)
  }

  // Already rated on a previous visit — show compact immediately
  if (collapsed || (rating != null && justRated == null)) {
    return (
      <div style={{ padding: '12px 16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, clipPath: CHUNKY.badge, background: GREEN,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: '#000' }}>{rating}</span>
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(126,211,33,0.7)' }}>
            {REACTION_LABELS[rating!]}
          </span>
          {ratingCount >= 10 && avgRating != null && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555', display: 'inline-block' }} />
              <span style={{ fontSize: 10, color: MUTED }}>{t('avg', { value: avgRating })}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  // Celebration state (just tapped)
  if (justRated != null) {
    return (
      <div style={{ padding: '20px 16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD, textAlign: 'center', position: 'relative', overflow: 'visible' }}>
        <style>{`
          @keyframes pn-scale-up {
            0% { transform: scale(0.8); }
            50% { transform: scale(1.5); }
            100% { transform: scale(1.3); }
          }
          @keyframes pn-fade-in {
            0% { opacity: 0; transform: translateY(6px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          @keyframes pn-pts-float {
            0%   { opacity: 0; transform: translateY(0) scale(0.5); }
            20%  { opacity: 1; transform: translateY(-10px) scale(1); }
            70%  { opacity: 1; transform: translateY(-35px) scale(1); }
            100% { opacity: 0; transform: translateY(-55px) scale(0.8); }
          }
        `}</style>
        <div ref={badgeRef} style={{ position: 'relative', display: 'inline-block' }}>
          {/* Badge */}
          <div style={{
            width: 48, height: 48, clipPath: CHUNKY.badge, background: GREEN,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'pn-scale-up 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: '#000' }}>{justRated}</span>
          </div>
          {/* +10 pts floater */}
          {showPoints && (
            <div style={{
              position: 'absolute', top: -8, left: '50%',
              transform: 'translateX(-50%)',
              animation: 'pn-pts-float 1.4s ease-out forwards',
              pointerEvents: 'none', zIndex: 10,
            }}>
              <div style={{
                padding: '4px 12px', background: GREEN,
                clipPath: CHUNKY.badge,
                fontSize: 12, fontWeight: 900, color: '#000',
                whiteSpace: 'nowrap',
              }}>
                {t('pts')}
              </div>
            </div>
          )}
        </div>
        <div style={{
          fontSize: 14, fontWeight: 900, color: GREEN, marginTop: 10,
          animation: 'pn-fade-in 0.3s ease 0.15s both',
        }}>
          {REACTION_LABELS[justRated]}
        </div>
      </div>
    )
  }

  // Unrated state — show picker
  return (
    <div style={{ padding: '16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1.5px', textAlign: 'center', marginBottom: 14 }}>
        {t('rateThisMatch')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>{t('boring')}</span>
        {[1, 2, 3, 4, 5].map(n => (
          <button key={n} onClick={() => handleRate(n)} style={{
            width: 36, height: 36,
            clipPath: CHUNKY.badge,
            background: 'rgba(255,255,255,0.06)',
            border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'background 0.15s ease',
          }}>
            <span style={{ fontSize: 14, fontWeight: 900, color: MUTED }}>{n}</span>
          </button>
        ))}
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>{t('epic')}</span>
      </div>
    </div>
  )
}

// ── Live Feed Tab ───────────────────────────────────────────────────────────
function LiveFeedTab({ match, pair1Label, pair2Label, isLive }: {
  match: Match; pair1Label: string; pair2Label: string; isLive: boolean
}) {
  const t = useTranslations('matchDetail')
  const allSets = [...(match.sets ?? [])].sort((a, b) => b.set_number - a.set_number) // newest set first
  const [setFilter, setSetFilter] = useState<number | 'all'>('all')

  if (allSets.length === 0 || allSets.every(s => (s.games ?? []).length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: MUTED, fontSize: 12 }}>
        {isLive ? t('waitingForFirstPoint') : t('noPointData')}
      </div>
    )
  }

  const sets = setFilter === 'all' ? allSets : allSets.filter(s => s.set_number === setFilter)

  return (
    <div>
      {/* Set filter sub-tabs */}
      {allSets.length > 1 && (
        <div style={{ display: 'flex', gap: 6, padding: '8px 16px', borderBottom: `0.5px solid ${BORDER}`, background: 'rgba(0,0,0,0.2)', overflowX: 'auto' }}>
          <button
            onClick={() => setSetFilter('all')}
            style={{
              fontSize: 10, fontWeight: setFilter === 'all' ? 700 : 500,
              padding: '4px 12px',
              background: setFilter === 'all' ? 'rgba(126,211,33,0.12)' : 'rgba(255,255,255,0.04)',
              border: `0.5px solid ${setFilter === 'all' ? 'rgba(126,211,33,0.3)' : BORDER}`,
              color: setFilter === 'all' ? GREEN : MUTED,
              clipPath: CHUNKY.badge,
              cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
            }}
          >
            {t('allSets')}
          </button>
          {[...allSets].reverse().map(s => {
            const active = setFilter === s.set_number
            const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
            const scoreLabel = parsed ? ` (${parsed.p1}-${parsed.p2})` : s.is_current ? ' ·  Live' : ''
            return (
              <button
                key={s.set_number}
                onClick={() => setSetFilter(s.set_number)}
                style={{
                  fontSize: 10, fontWeight: active ? 700 : 500,
                  padding: '4px 12px',
                  background: active ? 'rgba(126,211,33,0.12)' : 'rgba(255,255,255,0.04)',
                  border: `0.5px solid ${active ? 'rgba(126,211,33,0.3)' : BORDER}`,
                  color: active ? GREEN : MUTED,
                  clipPath: CHUNKY.badge,
                  cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
                }}
              >
                {t('set', { number: s.set_number })}{scoreLabel}
              </button>
            )
          })}
        </div>
      )}

      {sets.map((set) => {
        const sortedGames = [...(set.games ?? [])].sort((a, b) => a.game_number - b.game_number)
        const reversedGames = [...sortedGames].reverse()

        return (
          <div key={set.set_number}>
            {/* Set header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 4px' }}>
              <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: GREEN, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                {t('set', { number: set.set_number })}{set.set_score ? ` · ${set.set_score}` : ` · ${t('inProgress')}`}
              </span>
              <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
            </div>

            {reversedGames.map((game, revIdx) => {
              const gameIdx = sortedGames.length - 1 - revIdx
              const points = extractGamePoints(game as unknown as Game)
              const winner = computeGameWinner(sortedGames, gameIdx)
              const isCurrent = game.is_current

              // Cumulative set score at START of this game
              let p1Before = 0, p2Before = 0
              for (let i = 0; i < gameIdx; i++) {
                const w = computeGameWinner(sortedGames, i)
                if (w === 1) p1Before++
                else if (w === 2) p2Before++
              }

              return (
                <div key={game.id} id={`game-s${set.set_number}-g${game.game_number}`} style={{ borderTop: `0.5px solid ${BORDER}` }}>
                  {/* Game header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 16px 4px', background: 'rgba(0,0,0,0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: MUTED }}>
                        {t('game', { number: game.game_number })}
                      </span>
                      {isCurrent && isLive
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: LIVE_RED }}>{t('inProgress')}</span>
                        : winner === 1
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: PAIR1_COLOR }}>{t('won', { pair: pair1Label })}</span>
                        : winner === 2
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: PAIR2_COLOR }}>{t('won', { pair: pair2Label })}</span>
                        : null
                      }
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', color: MUTED }}>
                      {p1Before} – {p2Before}
                    </span>
                  </div>

                  {/* Points — newest first */}
                  {[...points].reverse().map((pt, ptIdx) => {
                    const isLatest = isCurrent && ptIdx === 0
                    return (
                      <div key={ptIdx} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '5px 16px 5px 28px',
                        borderLeft: `2px solid ${isLatest ? LIVE_RED : pt.scorer === 1 ? PAIR1_BORDER : PAIR2_BORDER}`,
                        background: isLatest ? 'rgba(255,70,85,0.06)' : pt.isSP ? 'rgba(245,166,35,0.04)' : 'transparent',
                      }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: pt.scorer === 1 ? PAIR1_COLOR : PAIR2_COLOR }} />
                        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', width: 58, flexShrink: 0, color: pt.scorer === 1 ? PAIR1_COLOR : PAIR2_COLOR }}>
                          {pt.score}
                        </span>
                        <span style={{ flex: 1, fontSize: 10, color: MUTED }}>
                          {pt.scorer === 1 ? pair1Label : pair2Label}
                        </span>
                        {isLatest && <span style={{ fontSize: 8, fontWeight: 700, color: LIVE_RED, letterSpacing: '0.5px' }}>{t('now')}</span>}
                        {pt.isSP && !isLatest && <span style={{ fontSize: 8, fontWeight: 700, color: ORANGE, background: 'rgba(245,166,35,0.12)', border: '0.5px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 5px' }}>SP</span>}
                      </div>
                    )
                  })}

                  {points.length === 0 && isCurrent && (
                    <div style={{ padding: '8px 28px', fontSize: 10, color: MUTED }}>{t('waitingForFirstPoint')}</div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

// ── H2H Tab ─────────────────────────────────────────────────────────────────
function H2HTab({ match, h2hMatches, h2hLoading, pair1Label, pair2Label, pair1Recent, pair2Recent }: {
  match: Match; h2hMatches: any[]; h2hLoading: boolean; pair1Label: string; pair2Label: string; pair1Recent: any[]; pair2Recent: any[]
}) {
  const t = useTranslations('matchDetail')
  const format = useFormatter()
  const [showAll, setShowAll] = useState(false)
  const p1Ids = [match.pair1_player1?.id, match.pair1_player2?.id].filter(Boolean) as string[]

  // Compute overall record
  let p1Wins = 0, p2Wins = 0
  h2hMatches.forEach(m => {
    const mp1p1 = m.pair1_player1?.id ?? null
    const mp1p2 = m.pair1_player2?.id ?? null
    const ourPairIsMatch1 = pairMatchesIds(mp1p1, mp1p2, p1Ids)
    if ((ourPairIsMatch1 && m.winner_pair === 1) || (!ourPairIsMatch1 && m.winner_pair === 2)) p1Wins++
    else p2Wins++
  })

  const formatSetScores = (m: any): string => {
    const sets = [...(m.sets ?? [])].sort((a: any, b: any) => a.set_number - b.set_number)
    return sets.map((s: any) => s.set_score ?? '').filter(Boolean).join('  ')
  }

  const formatDate = (dateStr: string | null): string => {
    if (!dateStr) return ''
    try {
      const d = new Date(dateStr)
      return format.dateTime(d, MONTH_YEAR)
    } catch { return '' }
  }

  const visibleMatches = showAll ? h2hMatches : h2hMatches.slice(0, 5)

  if (h2hLoading) return (
    <Spinner size={22} />
  )

  return (
    <div>
      {/* Summary header */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: PAIR1_COLOR, lineHeight: 1 }}>{p1Wins}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: PAIR1_COLOR, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair1Label}</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('h2h')}</div>
            <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{t('h2hMatches', { count: h2hMatches.length })}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: PAIR2_COLOR, lineHeight: 1 }}>{p2Wins}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: PAIR2_COLOR, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair2Label}</div>
          </div>
        </div>
      </div>

      {/* Match list */}
      {h2hMatches.length === 0 && !h2hLoading && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: MUTED, fontSize: 12 }}>
          {t('noPreviousMeetings')}
        </div>
      )}

      {visibleMatches.map((m) => {
        // Perspective: figure out whether the historical match's pair1
        // corresponds to CURRENT team 1 (from the match we're viewing).
        // If yes, render historical pair1 on top; otherwise swap so
        // current team 1 is always on top (orange) and current team 2
        // always on the bottom (yellow).
        const mp1p1 = m.pair1_player1?.id ?? null
        const mp1p2 = m.pair1_player2?.id ?? null
        const ourPairIsMatch1 = pairMatchesIds(mp1p1, mp1p2, p1Ids)

        const topP1 = ourPairIsMatch1 ? m.pair1_player1 : m.pair2_player1
        const topP2 = ourPairIsMatch1 ? m.pair1_player2 : m.pair2_player2
        const botP1 = ourPairIsMatch1 ? m.pair2_player1 : m.pair1_player1
        const botP2 = ourPairIsMatch1 ? m.pair2_player2 : m.pair1_player2

        const topName = pairName(topP1, topP2)
        const botName = pairName(botP1, botP2)

        const team1Won = (ourPairIsMatch1 && m.winner_pair === 1) || (!ourPairIsMatch1 && m.winner_pair === 2)
        const team2Won = m.winner_pair != null && !team1Won
        const accentColor = team1Won ? PAIR1_COLOR : team2Won ? PAIR2_COLOR : MUTED

        // Per-set games for each side, in top-row / bottom-row orientation.
        const sortedSets = [...(m.sets ?? [])].sort((a: any, b: any) => a.set_number - b.set_number)
        const setGames: { top: number | string; bot: number | string }[] = sortedSets.map((s: any) => {
          const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
          const p1g = parsed?.p1 ?? s.pair1_games ?? 0
          const p2g = parsed?.p2 ?? s.pair2_games ?? 0
          return ourPairIsMatch1
            ? { top: p1g, bot: p2g }
            : { top: p2g, bot: p1g }
        })

        const date = formatDate(m.finished_at ?? m.started_at)
        const tournamentName = (m.tournament as any)?.name ?? '\u2014'
        const round = m.round ?? ''

        return (
          <Link
            key={m.id}
            href={`/match/${m.id}`}
            style={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              margin: '6px 10px',
            }}
          >
            <div style={{
              position: 'relative',
              background: 'rgba(255,255,255,0.03)',
              clipPath: CHUNKY.card,
              padding: '6px 10px 6px 14px',
              overflow: 'hidden',
            }}>
              {/* Left accent bar — winner's team color */}
              <div style={{
                position: 'absolute',
                top: 0, left: 0, bottom: 0,
                width: 3,
                background: accentColor,
              }} />

              {/* Pills row: tournament, round, date */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px',
                  clipPath: CHUNKY.badge, textTransform: 'uppercase',
                  background: 'rgba(255,255,255,0.08)', color: '#fff',
                  letterSpacing: 0.3,
                  maxWidth: 180,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {tournamentName}
                </span>
                {round && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px',
                    clipPath: CHUNKY.badge, textTransform: 'uppercase',
                    background: 'rgba(255,255,255,0.06)', color: MUTED,
                    letterSpacing: 0.3,
                  }}>
                    {round}
                  </span>
                )}
                {date && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px',
                    clipPath: CHUNKY.badge, textTransform: 'uppercase',
                    background: 'rgba(255,255,255,0.06)', color: MUTED,
                    letterSpacing: 0.3,
                  }}>
                    {date}
                  </span>
                )}
              </div>

              {/* Team 1 row (always current team 1 — orange) */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '2px 0',
                opacity: team1Won || m.winner_pair == null ? 1 : 0.65,
              }}>
                {/* Flag stack */}
                <div style={{ position: 'relative', width: 22, height: 16, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImg country={topP1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 1 }}>
                    <FlagImg country={topP2?.country ?? null} size={14} />
                  </div>
                </div>
                <span style={{
                  flex: 1, minWidth: 0,
                  fontSize: 12,
                  fontWeight: team1Won ? 700 : 600,
                  color: team1Won ? '#fff' : '#B0B5BE',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {topName}
                </span>
                {team1Won && (
                  <span style={{
                    width: 14, height: 14, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: PAIR1_COLOR, clipPath: CHUNKY.badge,
                    fontSize: 8, fontWeight: 800, color: '#000',
                  }}>
                    W
                  </span>
                )}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {setGames.map((sg, i) => (
                    <span key={i} style={{
                      fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                      color: Number(sg.top) > Number(sg.bot) ? '#fff' : '#B0B5BE',
                      minWidth: 13, textAlign: 'center',
                    }}>
                      {sg.top}
                    </span>
                  ))}
                </div>
              </div>

              {/* Team 2 row (always current team 2 — yellow) */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '2px 0',
                opacity: team2Won || m.winner_pair == null ? 1 : 0.65,
              }}>
                <div style={{ position: 'relative', width: 22, height: 16, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImg country={botP1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 1 }}>
                    <FlagImg country={botP2?.country ?? null} size={14} />
                  </div>
                </div>
                <span style={{
                  flex: 1, minWidth: 0,
                  fontSize: 12,
                  fontWeight: team2Won ? 700 : 600,
                  color: team2Won ? '#fff' : '#B0B5BE',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {botName}
                </span>
                {team2Won && (
                  <span style={{
                    width: 14, height: 14, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: PAIR2_COLOR, clipPath: CHUNKY.badge,
                    fontSize: 8, fontWeight: 800, color: '#000',
                  }}>
                    W
                  </span>
                )}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {setGames.map((sg, i) => (
                    <span key={i} style={{
                      fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                      color: Number(sg.bot) > Number(sg.top) ? '#fff' : '#B0B5BE',
                      minWidth: 13, textAlign: 'center',
                    }}>
                      {sg.bot}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Link>
        )
      })}

      {h2hMatches.length > 5 && (
        <button
          onClick={() => setShowAll(s => !s)}
          style={{
            display: 'block',
            width: 'calc(100% - 20px)',
            margin: '8px 10px 4px',
            padding: '10px 12px',
            background: 'rgba(255,255,255,0.04)',
            border: 'none',
            clipPath: CHUNKY.card,
            fontSize: 11,
            fontWeight: 700,
            color: GREEN,
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            cursor: 'pointer',
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {showAll ? t('showLess') : t('showAll', { count: h2hMatches.length })}
        </button>
      )}

      {/* ── Last 5 Matches per pair ───────────────────────────────── */}
      {(pair1Recent.length > 0 || pair2Recent.length > 0) && (
        <>
          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 8px' }}>
            <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px' }}>{t('last5Matches')}</span>
            <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
          </div>

          {/* Two-column layout */}
          <div style={{ display: 'flex', gap: 0 }}>
            {/* Pair 1 column */}
            <div style={{ flex: 1, borderRight: `0.5px solid ${BORDER}` }}>
              <div style={{ padding: '6px 10px 4px', borderBottom: `0.5px solid ${BORDER}`, background: PAIR1_BG }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: PAIR1_COLOR, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair1Label}</div>
              </div>
              {pair1Recent.length === 0 ? (
                <div style={{ padding: '16px 10px', fontSize: 10, color: MUTED, textAlign: 'center' }}>{t('noRecentData')}</div>
              ) : pair1Recent.map((m, idx) => {
                const isPair1InSlot1 = pairMatchesIds(m.pair1_player1?.id, m.pair1_player2?.id, p1Ids)
                const won = (isPair1InSlot1 && m.winner_pair === 1) || (!isPair1InSlot1 && m.winner_pair === 2)
                const opponentNames = isPair1InSlot1
                  ? [m.pair2_player1?.display_name ?? m.pair2_player1?.name, m.pair2_player2?.display_name ?? m.pair2_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                  : [m.pair1_player1?.display_name ?? m.pair1_player1?.name, m.pair1_player2?.display_name ?? m.pair1_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                const scores = formatSetScores(m)
                return (
                  <Link key={m.id} href={`/match/${m.id}`} style={{ display: 'block', padding: '6px 10px', borderBottom: `0.5px solid ${BORDER}`, background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.08)', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <div style={{
                        width: 18, height: 18, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: won ? 'rgba(126,211,33,0.15)' : 'rgba(255,68,85,0.15)',
                        border: `0.5px solid ${won ? 'rgba(126,211,33,0.3)' : 'rgba(255,68,85,0.3)'}`,
                        clipPath: CHUNKY.badge,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color: won ? GREEN : LIVE_RED }}>{won ? 'W' : 'L'}</span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        {opponentNames || 'TBD'}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 600, fontFamily: 'monospace', color: MUTED, paddingLeft: 22 }}>
                      {scores || '\u2014'}
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* Pair 2 column */}
            <div style={{ flex: 1 }}>
              <div style={{ padding: '6px 10px 4px', borderBottom: `0.5px solid ${BORDER}`, background: PAIR2_BG }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: PAIR2_COLOR, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair2Label}</div>
              </div>
              {pair2Recent.length === 0 ? (
                <div style={{ padding: '16px 10px', fontSize: 10, color: MUTED, textAlign: 'center' }}>{t('noRecentData')}</div>
              ) : pair2Recent.map((m, idx) => {
                const p2Ids = [match.pair2_player1?.id, match.pair2_player2?.id].filter(Boolean) as string[]
                const isPair2InSlot1 = pairMatchesIds(m.pair1_player1?.id, m.pair1_player2?.id, p2Ids)
                const won = (isPair2InSlot1 && m.winner_pair === 1) || (!isPair2InSlot1 && m.winner_pair === 2)
                const opponentNames = isPair2InSlot1
                  ? [m.pair2_player1?.display_name ?? m.pair2_player1?.name, m.pair2_player2?.display_name ?? m.pair2_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                  : [m.pair1_player1?.display_name ?? m.pair1_player1?.name, m.pair1_player2?.display_name ?? m.pair1_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                const scores = formatSetScores(m)
                return (
                  <Link key={m.id} href={`/match/${m.id}`} style={{ display: 'block', padding: '6px 10px', borderBottom: `0.5px solid ${BORDER}`, background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.08)', textDecoration: 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      <div style={{
                        width: 18, height: 18, flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: won ? 'rgba(126,211,33,0.15)' : 'rgba(255,68,85,0.15)',
                        border: `0.5px solid ${won ? 'rgba(126,211,33,0.3)' : 'rgba(255,68,85,0.3)'}`,
                        clipPath: CHUNKY.badge,
                      }}>
                        <span style={{ fontSize: 9, fontWeight: 800, color: won ? GREEN : LIVE_RED }}>{won ? 'W' : 'L'}</span>
                      </div>
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#ccc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                        {opponentNames || 'TBD'}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 600, fontFamily: 'monospace', color: MUTED, paddingLeft: 22 }}>
                      {scores || '\u2014'}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── PlayerCard ──────────────────────────────────────────────────────────────
function PlayerCard({ player, winner, accent }: { player: any; winner?: boolean; accent?: string }) {
  return (
    <Link href={`/player/${player.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
    <div style={{ background: BG_CARD, overflow: 'hidden', border: winner ? `0.5px solid ${accent ?? 'rgba(255,255,255,0.15)'}` : `0.5px solid ${BORDER}`, clipPath: CHUNKY.card, cursor: 'pointer' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `0.5px solid ${BORDER}`, gap: 8 }}>
        <PlayerAvatar player={player} size={36} winner={winner} accent={accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: winner ? '#fff' : '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            {player.country && <FlagImg country={player.country} size={14} />}
            {toShortName(player.display_name ?? player.name)}
          </div>
          {player.side && <div style={{ fontSize: 10, color: accent ?? MUTED, marginTop: 1 }}>{player.side === 'drive' ? 'Drive' : 'Backhand'}</div>}
        </div>
        {/* Chevron indicator */}
        <span style={{ fontSize: 14, color: MUTED, flexShrink: 0 }}>›</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{player.ranking ? `#${player.ranking}` : '\u2014'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Rank</div>
        </div>
        <div style={{ width: '0.5px', height: 28, background: BORDER }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: GREEN }}>{player.win_rate ? `${player.win_rate}%` : '\u2014'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Win rate</div>
        </div>
        <div style={{ width: '0.5px', height: 28, background: BORDER }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#aaa' }}>{player.total_matches ?? '\u2014'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Matches</div>
        </div>
      </div>
    </div>
    </Link>
  )
}

// ── PlayerAvatar ────────────────────────────────────────────────────────────
function PlayerAvatar({ player, size, winner, accent }: { player: any; size: number; winner?: boolean; accent?: string }) {
  const [imgError, setImgError] = useState(false)
  const borderColor = winner ? (accent ?? 'rgba(255,255,255,0.4)') : BORDER
  if (!player) return <div style={{ width: size, height: size, borderRadius: '50%', background: BORDER, flexShrink: 0 }} />
  return player.avatar_url && !imgError ? (
    <img src={player.avatar_url} alt={player.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: `1.5px solid ${borderColor}` }} onError={() => setImgError(true)} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#0D2540', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.35, color: '#ccc', fontWeight: 700, border: `1.5px solid ${borderColor}` }}>
      {player.name?.[0]}
    </div>
  )
}

// ── PlayerSquare (hero photos) ──────────────────────────────────────────────
function PlayerSquare({ player, winner, router }: { player: any; winner?: boolean; router: ReturnType<typeof import('next/navigation').useRouter> }) {
  const [imgError, setImgError] = useState(false)
  const displayName = player?.display_name ?? player?.name
  const initials = displayName?.split(' ').map((n: string) => n[0]).slice(0, 2).join('') ?? '?'
  const border = winner ? `2px solid rgba(126,211,33,0.5)` : `1.5px solid ${BORDER}`
  const bg = winner ? 'rgba(126,211,33,0.05)' : '#0A1A2A'
  const handleClick = player?.id ? (e: React.MouseEvent) => { e.stopPropagation(); router.push(`/player/${player.id}`) } : undefined
  const cursor = player?.id ? 'pointer' : 'default'
  const ranking = player?.ranking

  const rankBadge = ranking ? (
    <div style={{
      position: 'absolute', bottom: -2, right: -2, zIndex: 2,
      minWidth: 14, height: 12, padding: '0 3px',
      background: PAIR2_COLOR, clipPath: CHUNKY.badge,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 7, fontWeight: 900, color: '#000',
      lineHeight: 1,
    }}>
      #{ranking}
    </div>
  ) : null

  if (!player) return <div style={{ width: 56, height: 56, clipPath: CHUNKY.card, background: bg, border, flexShrink: 0 }} />
  return (
    <div style={{ position: 'relative', flexShrink: 0 }}>
      {player.avatar_url && !imgError ? (
        <img onClick={handleClick} src={player.avatar_url} alt={player.name} style={{ width: 56, height: 56, clipPath: CHUNKY.card, objectFit: 'cover', border, cursor, display: 'block' }} onError={() => setImgError(true)} />
      ) : (
        <div onClick={handleClick} style={{ width: 56, height: 56, clipPath: CHUNKY.card, background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: winner ? 'rgba(126,211,33,0.7)' : '#4A6A8A', fontWeight: 700, border, cursor }}>
          {initials}
        </div>
      )}
      {rankBadge}
    </div>
  )
}
