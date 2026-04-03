'use client'
// src/app/match/[id]/page.tsx
// V3 Match Detail — chunky clip-path brand language, no border-radius except circles.

import { useState, useEffect, useCallback, use, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { Match, Game, getCurrentScore, pairName, isStarPoint, parseSetScore, toShortName } from '@/types/match'
import MomentumChart from './MomentumChart'
import BottomNav from '@/app/v3/components/BottomNavV3'
import Spinner from '@/app/components/Spinner'
import { useMatchPrediction, Prediction } from '@/hooks/useMatchPrediction'
import { useMatchRating } from '@/hooks/useMatchRating'

type SubTab = 'recap' | 'live' | 'players' | 'h2h'

// ── V3 Brand colors ─────────────────────────────────────────────────────────
const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.15)'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const MEN_BLUE = '#4A9EFF'
const WOMEN_PURPLE = '#D966FF'

// ── Pair identity colors ────────────────────────────────────────────────────
const PAIR1_COLOR = '#F59E0B'         // amber
const PAIR2_COLOR = '#14B8A6'         // teal
const PAIR1_BG    = 'rgba(245,158,11,0.08)'
const PAIR2_BG    = 'rgba(20,184,166,0.08)'
const PAIR1_BORDER = 'rgba(245,158,11,0.28)'
const PAIR2_BORDER = 'rgba(20,184,166,0.28)'

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
      src={`https://flagcdn.com/w40/${code}.png`}
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
    const { data, error } = await supabase
      .from('matches')
      .select(`
        *,
        tournament:tournaments(id, name, starts_at, ends_at, country, timezone),
        pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, external_id, ranking, win_rate, total_matches, avatar_url, side),
        sets(*, games(*))
      `)
      .eq('id', id)
      .single()

    if (error || !data) { setLoading(false); return }

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
    setLoading(false)
  }, [id])

  const fetchH2H = useCallback(async (m: Match) => {
    const p1Ids = [m.pair1_player1?.id, m.pair1_player2?.id].filter(Boolean) as string[]
    const p2Ids = [m.pair2_player1?.id, m.pair2_player2?.id].filter(Boolean) as string[]
    if (p1Ids.length === 0 || p2Ids.length === 0) return
    setH2hLoading(true)

    const allIds = [...p1Ids, ...p2Ids]
    const { data: rawData } = await supabase
      .from('matches')
      .select(`
        id, external_id, status, round, started_at, finished_at, scheduled_at, winner_pair,
        tournament:tournaments(name),
        pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country),
        pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country),
        pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country),
        pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country),
        sets(set_score, set_number)
      `)
      .or(`pair1_player1_id.in.(${allIds.join(',')}),pair2_player1_id.in.(${allIds.join(',')})`)
      .eq('status', 'finished')
      .neq('id', m.id)
      .order('finished_at', { ascending: false, nullsFirst: false })
      .limit(80)

    // Sort by best available date: finished_at > started_at > scheduled_at
    const data = rawData?.sort((a: any, b: any) => {
      const dateA = a.finished_at ?? a.started_at ?? a.scheduled_at ?? ''
      const dateB = b.finished_at ?? b.started_at ?? b.scheduled_at ?? ''
      return dateB.localeCompare(dateA)
    }) ?? null

    if (data) {
      const filtered = data.filter((hm: any) => {
        const mp1p1 = hm.pair1_player1?.id ?? null
        const mp1p2 = hm.pair1_player2?.id ?? null
        const mp2p1 = hm.pair2_player1?.id ?? null
        const mp2p2 = hm.pair2_player2?.id ?? null
        const fwd = pairMatchesIds(mp1p1, mp1p2, p1Ids) && pairMatchesIds(mp2p1, mp2p2, p2Ids)
        const rev = pairMatchesIds(mp1p1, mp1p2, p2Ids) && pairMatchesIds(mp2p1, mp2p2, p1Ids)
        return fwd || rev
      }).slice(0, 10)
      setH2hMatches(filtered)

      // Extract last 5 matches per pair (any opponent, from the broader dataset)
      const p1Recent = data.filter((hm: any) => {
        const ids = [hm.pair1_player1?.id, hm.pair1_player2?.id, hm.pair2_player1?.id, hm.pair2_player2?.id]
        return p1Ids.every(pid => ids.includes(pid))
      }).slice(0, 5)
      const p2Recent = data.filter((hm: any) => {
        const ids = [hm.pair1_player1?.id, hm.pair1_player2?.id, hm.pair2_player1?.id, hm.pair2_player2?.id]
        return p2Ids.every(pid => ids.includes(pid))
      }).slice(0, 5)
      setPair1Recent(p1Recent)
      setPair2Recent(p2Recent)
    }
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
  }, [match?.status])

  useEffect(() => {
    if (!match || match.status !== 'scheduled') return
    const scheduledAt = (match as any).starts_at
    if (!scheduledAt) return
    const tick = () => {
      const diff = Math.max(0, (new Date(scheduledAt).getTime() - Date.now()) / 1000)
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
  const p1TotalGames = useMemo(() => matchSets.reduce((s, st) => s + (parseSetScore(st.set_score)?.p1 ?? 0), 0), [matchSets])
  const p2TotalGames = useMemo(() => matchSets.reduce((s, st) => s + (parseSetScore(st.set_score)?.p2 ?? 0), 0), [matchSets])
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

  if (loading) return (
    <>
    <main style={{ background: BG_BASE, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Spinner fullHeight />
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
  const isFinished = match.status === 'finished'
  const isLive = match.status === 'live'
  const winnerPair = (match as any).winner_pair
  const p1Won = isFinished && winnerPair === 1
  const p2Won = isFinished && winnerPair === 2
  const p1Leading = !isFinished && (p1Point === 'A' || (p1Point && p2Point && p1Point !== 'A' && p2Point !== 'A' && parseInt(p1Point) > parseInt(p2Point)))
  const p2Leading = !isFinished && (p2Point === 'A' || (p1Point && p2Point && p1Point !== 'A' && p2Point !== 'A' && parseInt(p2Point) > parseInt(p1Point)))

  const category = (match as any).category as string | null
  const duration = (match as any).duration as string | null
  const matchDate = match.started_at ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(match.started_at)) : null

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
        borderBottom: `1px solid ${BORDER}`,
        position: 'sticky', top: 0, zIndex: 100,
        background: 'rgba(10,10,10,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
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
          <div style={{ fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-0.5px', textTransform: 'uppercase' as const }}>Match Detail</div>
        </div>
        {isLive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'rgba(255,68,85,0.15)', border: '1px solid rgba(255,68,85,0.4)', clipPath: CHUNKY.badge, padding: '4px 10px', flexShrink: 0 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: LIVE_RED, display: 'inline-block', animation: 'blink 1.2s ease-in-out infinite' }} />
            <span style={{ fontSize: 11, fontWeight: 800, color: LIVE_RED, letterSpacing: '0.5px' }}>LIVE</span>
          </div>
        )}
      </div>

      {/* ── Winner banner ────────────────────────────────────────────── */}
      {isFinished && winnerPair && (
        <WinnerBanner match={match} winnerPair={winnerPair} pair1Label={pair1Label} pair2Label={pair2Label} nextMatchId={nextMatchId} />
      )}

      {/* ── Tournament link ──────────────────────────────────────────── */}
      {(match as any).tournament?.id && (
        <Link href={`/v3/tournaments/${(match as any).tournament.id}`} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 16px', background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`,
          textDecoration: 'none',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', flexShrink: 0 }}>Tournament</span>
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
                const parsed = parseSetScore(set.set_score)
                const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
                return (
                  <span key={set.set_number} style={{ fontSize: 13, fontWeight: 800, width: 18, textAlign: 'center', fontFamily: 'monospace', color: p1WonSet && !set.is_current ? '#fff' : '#555' }}>
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
                const parsed = parseSetScore(set.set_score)
                const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
                return (
                  <span key={set.set_number} style={{ fontSize: 13, fontWeight: 800, width: 18, textAlign: 'center', fontFamily: 'monospace', color: p2WonSet && !set.is_current ? '#fff' : '#555' }}>
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
            <PlayerNameLink player={match.pair1_player2} dim={!!p2Won} muted={!!p2Leading} bold={!!p1Won} router={router} style={{ marginTop: 4 }} />
          </div>
          {!isScheduled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {(match.sets ?? []).map(set => {
                const parsed = parseSetScore(set.set_score)
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
            <PlayerNameLink player={match.pair2_player2} dim={!!p1Won} muted={!!p1Leading} bold={!!p2Won} router={router} style={{ marginTop: 4 }} />
          </div>
          {!isScheduled && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
              {(match.sets ?? []).map(set => {
                const parsed = parseSetScore(set.set_score)
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
      {isScheduled && (
        <>
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
          <ScheduledSection match={match} pair1Label={pair1Label} pair2Label={pair2Label} countdown={countdown} tz={tz} />
        </>
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

      {/* ── LIVE / FINISHED: sub-tabs ─────────────────────────────────── */}
      {!isScheduled && (
        <>
          {isFinished && (
            <MatchRatingCard rating={rating} setRating={setRating} avgRating={avgRating} ratingCount={ratingCount} />
          )}
          <div style={{ display: 'flex', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD }}>
            {(isFinished ? ['recap', 'live', 'players', 'h2h'] as SubTab[] : ['live', 'players', 'h2h'] as SubTab[]).map(tab => (
              <button key={tab} onClick={() => handleSubTab(tab)} style={{ flex: 1, fontSize: 11, fontWeight: subTab === tab ? 700 : 500, padding: '10px 4px', background: 'transparent', border: 'none', color: subTab === tab ? GREEN : MUTED, borderBottom: subTab === tab ? `2px solid ${GREEN}` : '2px solid transparent', cursor: 'pointer', fontFamily: 'inherit' }}>
                {tab === 'recap' ? 'Score Recap' : tab === 'live' ? 'Live Feed' : tab === 'h2h' ? 'H2H' : 'Players'}
              </button>
            ))}
          </div>
          <div style={{ background: BG_CARD, minHeight: 300 }}>
            {subTab === 'recap' && isFinished && (
              <FinishedStatsSection match={match} pair1Label={pair1Label} pair2Label={pair2Label} />
            )}
            {subTab === 'live' && (
              <LiveFeedTab match={match} pair1Label={pair1Label} pair2Label={pair2Label} isLive={isLive} />
            )}
            {subTab === 'players' && (
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
            {subTab === 'h2h' && (
              <H2HTab match={match} h2hMatches={h2hMatches} h2hLoading={h2hLoading} pair1Label={pair1Label} pair2Label={pair2Label} pair1Recent={pair1Recent} pair2Recent={pair2Recent} />
            )}
          </div>
        </>
      )}
    </main>
    <BottomNav />
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
      {toShortName(player?.name ?? 'TBD')}
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

// ── Prediction Section (Scheduled matches) ─────────────────────────────────
function PredictionSection({ match, pair1Label, pair2Label, prediction, predStep, setPredStep, setPrediction, clearPrediction }: {
  match: Match; pair1Label: string; pair2Label: string
  prediction: Prediction | null
  predStep: 'pick' | 'margin' | 'done'
  setPredStep: (s: 'pick' | 'margin' | 'done') => void
  setPrediction: (p: Prediction) => void
  clearPrediction: () => void
}) {
  const [selectedPair, setSelectedPair] = useState<1 | 2 | null>(prediction?.pair ?? null)

  const handlePickPair = (pair: 1 | 2) => {
    setSelectedPair(pair)
    setPredStep('margin')
  }

  const handlePickMargin = (margin: '2-0' | '2-1') => {
    if (!selectedPair) return
    setPrediction({ pair: selectedPair, margin })
    setPredStep('done')
  }

  const handleChange = () => {
    clearPrediction()
    setSelectedPair(null)
    setPredStep('pick')
  }

  const p1Short = pair1Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')
  const p2Short = pair2Label.split(' / ').map(n => n.split(' ').pop()).join(' / ')

  return (
    <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '16px' }}>
      <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1.5px', textAlign: 'center', marginBottom: 14 }}>
        Make your prediction
      </div>

      {/* Step 1: Pick the winner */}
      {predStep === 'pick' && (
        <div style={{ display: 'flex', gap: 8 }}>
          {([1, 2] as const).map(pair => {
            const label = pair === 1 ? p1Short : p2Short
            const color = pair === 1 ? PAIR1_COLOR : PAIR2_COLOR
            const bg = pair === 1 ? PAIR1_BG : PAIR2_BG
            const border = pair === 1 ? PAIR1_BORDER : PAIR2_BORDER
            const p1 = pair === 1 ? match.pair1_player1 : match.pair2_player1
            const p2 = pair === 1 ? match.pair1_player2 : match.pair2_player2
            return (
              <button key={pair} onClick={() => handlePickPair(pair)} style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                padding: '14px 8px', clipPath: CHUNKY.card,
                background: bg, border: `1px solid ${border}`,
                cursor: 'pointer', fontFamily: 'inherit',
              }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <PlayerAvatar player={p1} size={28} />
                  <PlayerAvatar player={p2} size={28} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 700, color, textAlign: 'center', lineHeight: 1.3 }}>{label}</span>
              </button>
            )
          })}
        </div>
      )}

      {/* Step 2: Pick the margin */}
      {predStep === 'margin' && selectedPair && (
        <div>
          <div style={{ textAlign: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: selectedPair === 1 ? PAIR1_COLOR : PAIR2_COLOR }}>
              {selectedPair === 1 ? p1Short : p2Short}
            </span>
            <span style={{ fontSize: 11, color: MUTED }}> wins...</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => handlePickMargin('2-0')} style={{
              flex: 1, padding: '12px 8px', clipPath: CHUNKY.button,
              background: GREEN_DIM, border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: GREEN, fontFamily: 'monospace' }}>2-0</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(126,211,33,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Straight sets</span>
            </button>
            <button onClick={() => handlePickMargin('2-1')} style={{
              flex: 1, padding: '12px 8px', clipPath: CHUNKY.button,
              background: 'rgba(245,166,35,0.08)', border: 'none', cursor: 'pointer', fontFamily: 'inherit',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              <span style={{ fontSize: 18, fontWeight: 900, color: ORANGE, fontFamily: 'monospace' }}>2-1</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(245,166,35,0.6)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>3-set battle</span>
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Confirmation */}
      {predStep === 'done' && prediction && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(126,211,33,0.04)', border: `0.5px solid rgba(126,211,33,0.15)`, clipPath: CHUNKY.card }}>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(126,211,33,0.5)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 4 }}>Your prediction</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: GREEN }}>
              {prediction.pair === 1 ? p1Short : p2Short} win {prediction.margin}
            </div>
          </div>
          <button onClick={handleChange} style={{
            background: 'transparent', border: `0.5px solid rgba(126,211,33,0.2)`, clipPath: CHUNKY.badge,
            padding: '4px 10px', cursor: 'pointer', fontFamily: 'inherit',
            fontSize: 9, fontWeight: 700, color: GREEN,
          }}>
            Change
          </button>
        </div>
      )}
    </div>
  )
}

// ── Scheduled Section ───────────────────────────────────────────────────────
function ScheduledSection({ match, pair1Label, pair2Label, countdown, tz }: {
  match: Match; pair1Label: string; pair2Label: string
  countdown: { h: number; m: number; s: number }; tz: string
}) {
  const pad = (n: number) => String(n).padStart(2, '0')
  const tournamentName = ((match as any).tournament)?.name ?? null
  return (
    <>
      {/* Countdown */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px', textAlign: 'center' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 10 }}>Starts in</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
          {[{ n: countdown.h, l: 'HRS' }, { n: countdown.m, l: 'MIN' }, { n: countdown.s, l: 'SEC' }].map(({ n, l }, i) => (
            <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {i > 0 && <span style={{ fontSize: 22, fontWeight: 900, color: BORDER, marginTop: -6 }}>:</span>}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 26, fontWeight: 900, fontFamily: 'monospace', color: GREEN, lineHeight: 1 }}>{pad(n)}</div>
                <div style={{ fontSize: 8, color: MUTED, marginTop: 2, letterSpacing: '0.5px' }}>{l}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tournament info */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
        {[
          tournamentName && { key: 'Tournament', val: tournamentName },
          match.round && { key: 'Round', val: match.round },
          match.court && { key: 'Court', val: match.court },
          { key: 'Timezone', val: tz.replace(/_/g, ' ') },
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
const REACTION_LABELS: Record<number, string> = { 1: 'Boring', 2: 'Meh', 3: 'Decent', 4: 'Great match!', 5: 'Epic' }

function MatchRatingCard({ rating, setRating, avgRating, ratingCount }: {
  rating: number | null
  setRating: (n: number) => void
  avgRating: number | null
  ratingCount: number
}) {
  const [justRated, setJustRated] = useState<number | null>(null)
  const [collapsed, setCollapsed] = useState(rating != null)
  const [particles, setParticles] = useState<{ id: number; x: number; y: number; color: string }[]>([])

  const handleRate = (n: number) => {
    setRating(n)
    setJustRated(n)

    // Generate particles
    const colors = [GREEN, ORANGE, GREEN, '#fff', ORANGE, GREEN, ORANGE, GREEN]
    const newParticles = colors.map((color, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 80,
      y: (Math.random() - 0.5) * 80,
      color,
    }))
    setParticles(newParticles)

    // Collapse after 2s
    setTimeout(() => {
      setCollapsed(true)
      setJustRated(null)
      setParticles([])
    }, 2000)
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
              <span style={{ fontSize: 10, color: MUTED }}>avg {avgRating}</span>
            </>
          )}
        </div>
      </div>
    )
  }

  // Celebration burst state (just tapped)
  if (justRated != null) {
    return (
      <div style={{ padding: '20px 16px', borderBottom: `0.5px solid ${BORDER}`, background: BG_CARD, textAlign: 'center', position: 'relative', overflow: 'hidden' }}>
        <style>{`
          @keyframes pn-burst {
            0% { transform: translate(0,0) scale(1); opacity: 1; }
            100% { transform: translate(var(--tx), var(--ty)) scale(0); opacity: 0; }
          }
          @keyframes pn-scale-up {
            0% { transform: scale(1); }
            50% { transform: scale(1.4); }
            100% { transform: scale(1.3); }
          }
          @keyframes pn-fade-in {
            0% { opacity: 0; transform: translateY(6px); }
            100% { opacity: 1; transform: translateY(0); }
          }
        `}</style>
        <div style={{ position: 'relative', display: 'inline-block' }}>
          {/* Particles */}
          {particles.map(p => (
            <div key={p.id} style={{
              position: 'absolute', top: '50%', left: '50%',
              width: 6, height: 6, borderRadius: '50%', background: p.color,
              '--tx': `${p.x}px`, '--ty': `${p.y}px`,
              animation: 'pn-burst 0.6s ease-out forwards',
              pointerEvents: 'none',
            } as React.CSSProperties} />
          ))}
          {/* Badge */}
          <div style={{
            width: 48, height: 48, clipPath: CHUNKY.badge, background: GREEN,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'pn-scale-up 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
          }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: '#000' }}>{justRated}</span>
          </div>
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
        Rate this match
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>Boring</span>
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
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>Epic</span>
      </div>
    </div>
  )
}

// ── Finished Stats Section ──────────────────────────────────────────────────
function FinishedStatsSection({ match, pair1Label, pair2Label }: { match: Match; pair1Label: string; pair2Label: string }) {
  const sets = [...(match.sets ?? [])].sort((a, b) => a.set_number - b.set_number)
  const p1Games = sets.reduce((s, set) => s + (parseSetScore(set.set_score)?.p1 ?? 0), 0)
  const p2Games = sets.reduce((s, set) => s + (parseSetScore(set.set_score)?.p2 ?? 0), 0)
  const totalGames = p1Games + p2Games || 1

  const StatRow = ({ label, p1, p2 }: { label: string; p1: number; p2: number }) => {
    const total = p1 + p2 || 1
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, width: 28, textAlign: 'right', fontFamily: 'monospace', color: PAIR1_COLOR }}>{p1}</span>
        <div style={{ flex: 1, display: 'flex', gap: 2, height: 4, overflow: 'hidden', clipPath: CHUNKY.badge }}>
          <div style={{ flex: p1 / total, background: PAIR1_COLOR, opacity: 0.8 }} />
          <div style={{ flex: p2 / total, background: PAIR2_COLOR, opacity: 0.8 }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, width: 28, fontFamily: 'monospace', color: PAIR2_COLOR }}>{p2}</span>
        <span style={{ fontSize: 9, color: MUTED, width: 72, flexShrink: 0 }}>{label}</span>
      </div>
    )
  }

  return (
    <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px' }}>Match stats</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: PAIR1_COLOR }}>{pair1Label.split(' / ')[0]}</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: PAIR2_COLOR }}>{pair2Label.split(' / ')[0]}</span>
        </div>
      </div>
      <StatRow label="Games won" p1={p1Games} p2={p2Games} />
      {sets.map(set => {
        const parsed = parseSetScore(set.set_score)
        if (!parsed) return null
        return <StatRow key={set.set_number} label={`Set ${set.set_number} games`} p1={parsed.p1} p2={parsed.p2} />
      })}
    </div>
  )
}

// ── Live Feed Tab ───────────────────────────────────────────────────────────
function LiveFeedTab({ match, pair1Label, pair2Label, isLive }: {
  match: Match; pair1Label: string; pair2Label: string; isLive: boolean
}) {
  const allSets = [...(match.sets ?? [])].sort((a, b) => b.set_number - a.set_number) // newest set first
  const [setFilter, setSetFilter] = useState<number | 'all'>('all')

  if (allSets.length === 0 || allSets.every(s => (s.games ?? []).length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: MUTED, fontSize: 12 }}>
        {isLive ? 'Waiting for first point...' : 'No point data available'}
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
            All Sets
          </button>
          {[...allSets].reverse().map(s => {
            const active = setFilter === s.set_number
            const parsed = parseSetScore(s.set_score)
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
                Set {s.set_number}{scoreLabel}
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
                Set {set.set_number}{set.set_score ? ` · ${set.set_score}` : ' · In progress'}
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
                        Game {game.game_number}
                      </span>
                      {isCurrent && isLive
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: LIVE_RED }}>In progress</span>
                        : winner === 1
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: PAIR1_COLOR }}>{pair1Label} won</span>
                        : winner === 2
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: PAIR2_COLOR }}>{pair2Label} won</span>
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
                        {isLatest && <span style={{ fontSize: 8, fontWeight: 700, color: LIVE_RED, letterSpacing: '0.5px' }}>now</span>}
                        {pt.isSP && !isLatest && <span style={{ fontSize: 8, fontWeight: 700, color: ORANGE, background: 'rgba(245,166,35,0.12)', border: '0.5px solid rgba(245,166,35,0.25)', clipPath: CHUNKY.badge, padding: '1px 5px' }}>SP</span>}
                      </div>
                    )
                  })}

                  {points.length === 0 && isCurrent && (
                    <div style={{ padding: '8px 28px', fontSize: 10, color: MUTED }}>Waiting for first point...</div>
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
      return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(d)
    } catch { return '' }
  }

  if (h2hLoading) return (
    <Spinner size={22} />
  )

  return (
    <div>
      {/* Fixed summary header */}
      <div style={{ background: BG_CARD, borderBottom: `0.5px solid ${BORDER}`, padding: '14px 16px 12px', position: 'sticky', top: 95, zIndex: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: PAIR1_COLOR, lineHeight: 1 }}>{p1Wins}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: PAIR1_COLOR, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair1Label}</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px' }}>H2H</div>
            <div style={{ fontSize: 9, color: MUTED, marginTop: 2 }}>{h2hMatches.length} matches</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: PAIR2_COLOR, lineHeight: 1 }}>{p2Wins}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: PAIR2_COLOR, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair2Label}</div>
          </div>
        </div>
      </div>

      {/* Column headers */}
      {h2hMatches.length > 0 && (
        <div style={{ display: 'flex', padding: '7px 16px', background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
          <span style={{ flex: 1, fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tournament · Round</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 48 }}>Score</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', width: 28, textAlign: 'center' }}>W/L</span>
        </div>
      )}

      {/* Match list */}
      {h2hMatches.length === 0 && !h2hLoading && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: MUTED, fontSize: 12 }}>
          No previous meetings found
        </div>
      )}

      {h2hMatches.map((m, idx) => {
        const mp1p1 = m.pair1_player1?.id ?? null
        const mp1p2 = m.pair1_player2?.id ?? null
        const ourPairIsMatch1 = pairMatchesIds(mp1p1, mp1p2, p1Ids)
        const ourWon = (ourPairIsMatch1 && m.winner_pair === 1) || (!ourPairIsMatch1 && m.winner_pair === 2)

        const scores = formatSetScores(m)
        const date = formatDate(m.finished_at ?? m.started_at)
        const tournamentName = (m.tournament as any)?.name ?? '\u2014'
        const round = m.round ?? ''

        return (
          <Link key={m.id} href={`/match/${m.id}`} style={{ padding: '10px 16px', borderBottom: `0.5px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8, background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.1)', textDecoration: 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tournamentName}
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>{round}</span>
                {date && <><span style={{ width: 2, height: 2, borderRadius: '50%', background: MUTED, display: 'inline-block' }} /><span>{date}</span></>}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: MUTED, flexShrink: 0, textAlign: 'right', marginRight: 12 }}>
              {scores || '\u2014'}
            </div>
            <div style={{ width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ourWon ? PAIR1_BG : PAIR2_BG, border: `0.5px solid ${ourWon ? PAIR1_BORDER : PAIR2_BORDER}`, clipPath: CHUNKY.badge }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: ourWon ? PAIR1_COLOR : PAIR2_COLOR }}>{ourWon ? 'W' : 'L'}</span>
            </div>
          </Link>
        )
      })}

      {/* ── Last 5 Matches per pair ───────────────────────────────── */}
      {(pair1Recent.length > 0 || pair2Recent.length > 0) && (
        <>
          {/* Section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 16px 8px' }}>
            <div style={{ flex: 1, height: '0.5px', background: BORDER }} />
            <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '1px' }}>Last 5 Matches</span>
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
                <div style={{ padding: '16px 10px', fontSize: 10, color: MUTED, textAlign: 'center' }}>No recent data</div>
              ) : pair1Recent.map((m, idx) => {
                const isPair1InSlot1 = pairMatchesIds(m.pair1_player1?.id, m.pair1_player2?.id, p1Ids)
                const won = (isPair1InSlot1 && m.winner_pair === 1) || (!isPair1InSlot1 && m.winner_pair === 2)
                const opponentNames = isPair1InSlot1
                  ? [m.pair2_player1?.name, m.pair2_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                  : [m.pair1_player1?.name, m.pair1_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
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
                <div style={{ padding: '16px 10px', fontSize: 10, color: MUTED, textAlign: 'center' }}>No recent data</div>
              ) : pair2Recent.map((m, idx) => {
                const p2Ids = [match.pair2_player1?.id, match.pair2_player2?.id].filter(Boolean) as string[]
                const isPair2InSlot1 = pairMatchesIds(m.pair1_player1?.id, m.pair1_player2?.id, p2Ids)
                const won = (isPair2InSlot1 && m.winner_pair === 1) || (!isPair2InSlot1 && m.winner_pair === 2)
                const opponentNames = isPair2InSlot1
                  ? [m.pair2_player1?.name, m.pair2_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
                  : [m.pair1_player1?.name, m.pair1_player2?.name].filter(Boolean).map((n: string) => toShortName(n)).join(' / ')
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
    <div style={{ background: BG_CARD, overflow: 'hidden', border: winner ? `0.5px solid ${accent ?? 'rgba(255,255,255,0.15)'}` : `0.5px solid ${BORDER}`, clipPath: CHUNKY.card }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: `0.5px solid ${BORDER}`, gap: 8 }}>
        <PlayerAvatar player={player} size={36} winner={winner} accent={accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: winner ? '#fff' : '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
            {player.country && <FlagImg country={player.country} size={14} />}
            {toShortName(player.name)}
          </div>
          {player.side && <div style={{ fontSize: 10, color: accent ?? MUTED, marginTop: 1 }}>{player.side === 'drive' ? 'Drive' : 'Backhand'}</div>}
        </div>
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
  const initials = player?.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('') ?? '?'
  const border = winner ? `2px solid rgba(126,211,33,0.5)` : `1.5px solid ${BORDER}`
  const bg = winner ? 'rgba(126,211,33,0.05)' : '#0A1A2A'
  const handleClick = player?.id ? (e: React.MouseEvent) => { e.stopPropagation(); router.push(`/player/${player.id}`) } : undefined
  const cursor = player?.id ? 'pointer' : 'default'
  if (!player) return <div style={{ width: 56, height: 56, clipPath: CHUNKY.card, background: bg, border, flexShrink: 0 }} />
  return player.avatar_url && !imgError ? (
    <img onClick={handleClick} src={player.avatar_url} alt={player.name} style={{ width: 56, height: 56, clipPath: CHUNKY.card, objectFit: 'cover', flexShrink: 0, border, cursor }} onError={() => setImgError(true)} />
  ) : (
    <div onClick={handleClick} style={{ width: 56, height: 56, clipPath: CHUNKY.card, background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: winner ? 'rgba(126,211,33,0.7)' : '#4A6A8A', fontWeight: 700, border, cursor }}>
      {initials}
    </div>
  )
}
