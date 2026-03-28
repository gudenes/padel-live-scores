'use client'
// src/app/match/[id]/page.tsx

import { useState, useEffect, useCallback, use, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, Game, getCurrentScore, pairName, isStarPoint, countryFlag, parseSetScore } from '@/types/match'

type SubTab = 'live' | 'players' | 'h2h'

// ── Point extraction from a game's points array ───────────────────────────────
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

// ── Compute game winner from its score vs the previous game's score ───────────
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

// ── Pair match checker for H2H filtering ─────────────────────────────────────
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
  const [h2hLoading, setH2hLoading] = useState(false)
  const [heroHidden, setHeroHidden] = useState(false)
  const heroSentinelRef = useRef<HTMLDivElement>(null)

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
    const { data } = await supabase
      .from('matches')
      .select(`
        id, external_id, status, round, started_at, winner_pair,
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
      .order('started_at', { ascending: false })
      .limit(80)

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

  const handleSubTab = (tab: SubTab) => {
    setSubTab(tab)
    if (tab === 'h2h' && h2hMatches.length === 0 && !h2hLoading && match) {
      fetchH2H(match)
    }
  }

  if (loading) return (
    <main style={{ background: 'var(--bg-base)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: 'var(--text-dim)', fontSize: 14 }}>Loading match...</div>
    </main>
  )
  if (!match) return (
    <main style={{ background: 'var(--bg-base)', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ color: 'var(--text-dim)', fontSize: 14, marginBottom: 16 }}>Match not found</div>
        <button onClick={handleBack} style={{ color: 'var(--color-accent)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>← Go back</button>
      </div>
    </main>
  )

  const { pair1Sets, pair2Sets, currentSet, currentGame } = getCurrentScore(match)
  const pair1Label = pairName(match.pair1_player1, match.pair1_player2)
  const pair2Label = pairName(match.pair2_player1, match.pair2_player2)

  const currentPoint = currentGame?.points?.filter(p => p !== '0:0').slice(-1)[0] ?? null
  const [p1Point, p2Point] = currentPoint ? currentPoint.split(':') : [null, null]
  const starPoint = currentGame ? isStarPoint(currentGame.points ?? []) : false

  const isFinished = match.status === 'finished'
  const isLive = match.status === 'live'
  const winnerPair = (match as any).winner_pair
  const p1Won = isFinished && winnerPair === 1
  const p2Won = isFinished && winnerPair === 2
  const p1Leading = !isFinished && (p1Point === 'A' || (p1Point && p2Point && p1Point !== 'A' && p2Point !== 'A' && parseInt(p1Point) > parseInt(p2Point)))
  const p2Leading = !isFinished && (p2Point === 'A' || (p1Point && p2Point && p1Point !== 'A' && p2Point !== 'A' && parseInt(p2Point) > parseInt(p1Point)))

  const category = (match as any).category as string | null
  const genderAccent = category === 'men' ? 'var(--color-men)' : category === 'women' ? 'var(--color-women)' : 'var(--text-dim)'
  const duration = (match as any).duration as string | null
  const matchDate = match.started_at ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(match.started_at)) : null

  // ── Shared styles ──────────────────────────────────────────────────────────
  const scoreNumStyle = (won: boolean, dim: boolean): React.CSSProperties => ({
    fontSize: 28, fontWeight: 900, width: 28, textAlign: 'center',
    fontFamily: 'var(--font-mono)', lineHeight: 1,
    color: won ? 'var(--text-primary)' : dim ? '#444' : '#555',
    position: 'relative',
  })

  return (
    <main style={{ background: 'var(--bg-base)', minHeight: '100vh', maxWidth: 500, margin: '0 auto' }}>

      {/* ── Nav bar ───────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-base)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '0.5px solid var(--border-card)', position: 'sticky', top: 0, zIndex: 10 }}>
        <button onClick={handleBack} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-input)', border: '0.5px solid var(--border-strong)', borderRadius: 20, padding: '5px 12px', cursor: 'pointer', color: '#aaa', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)', flexShrink: 0 }}>
          ← Back
        </button>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <img src="/padel-nacho-logo.png" alt="Padel Nacho" style={{ height: 28, width: 'auto', objectFit: 'contain' }} />
        </div>
        {isLive ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--color-live-bg)', border: '0.5px solid var(--color-live-border)', borderRadius: 20, padding: '3px 8px', flexShrink: 0 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-live)', display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
            <span style={{ fontSize: 10, color: 'var(--color-live)', fontWeight: 600 }}>Live</span>
          </div>
        ) : isFinished ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: '#777', background: '#2a2a2a', borderRadius: 6, padding: '2px 8px', border: '0.5px solid #333' }}>Finished</span>
            {duration && <span style={{ fontSize: 10, color: 'var(--text-ghost)', background: 'var(--bg-input)', borderRadius: 6, padding: '2px 6px', fontFamily: 'var(--font-mono)' }}>⏱ {duration}</span>}
          </div>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0 }}>{matchDate}</span>
        )}
      </div>

      {/* ── Compact sticky score (appears when hero scrolls away) ────── */}
      <div style={{
        position: 'sticky', top: 49, zIndex: 8,
        background: 'var(--bg-card)',
        borderBottom: `2px solid ${genderAccent}`,
        overflow: 'hidden',
        maxHeight: heroHidden ? 62 : 0,
        opacity: heroHidden ? 1 : 0,
        transition: 'max-height 0.25s ease, opacity 0.2s ease',
      }}>
        <div style={{ padding: '7px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Pair 1 compact row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: p2Won ? '#666' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {pair1Label}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              {(match.sets ?? []).map(set => {
                const parsed = parseSetScore(set.set_score)
                const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
                return (
                  <span key={set.set_number} style={{ fontSize: 13, fontWeight: 800, width: 18, textAlign: 'center', fontFamily: 'var(--font-mono)', color: p1WonSet && !set.is_current ? 'var(--text-primary)' : '#555' }}>
                    {parsed ? parsed.p1 : (set.pair1_games ?? 0)}
                  </span>
                )
              })}
              {!isFinished && (
                <span style={{ fontSize: 13, fontWeight: 900, width: 28, textAlign: 'center', fontFamily: 'var(--font-mono)', color: starPoint ? 'var(--color-star)' : 'var(--color-live)', marginLeft: 4 }}>
                  {p1Point ?? '0'}
                </span>
              )}
            </div>
          </div>
          {/* Pair 2 compact row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: p1Won ? '#666' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {pair2Label}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
              {(match.sets ?? []).map(set => {
                const parsed = parseSetScore(set.set_score)
                const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
                return (
                  <span key={set.set_number} style={{ fontSize: 13, fontWeight: 800, width: 18, textAlign: 'center', fontFamily: 'var(--font-mono)', color: p2WonSet && !set.is_current ? 'var(--text-primary)' : '#555' }}>
                    {parsed ? parsed.p2 : (set.pair2_games ?? 0)}
                  </span>
                )
              })}
              {!isFinished && (
                <span style={{ fontSize: 13, fontWeight: 900, width: 28, textAlign: 'center', fontFamily: 'var(--font-mono)', color: '#333', marginLeft: 4 }}>
                  {p2Point ?? '0'}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Hero score ────────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', borderTop: `3px solid ${genderAccent}`, padding: '14px 16px 0', borderBottom: '0.5px solid var(--border-card)' }}>

        {/* Court + round + date */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: '#888', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{match.court ?? ''}</span>
          {match.court && match.round && <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555', display: 'inline-block' }} />}
          <span style={{ fontSize: 10, color: '#777' }}>{match.round ?? ''}</span>
          <span style={{ flex: 1 }} />
          {matchDate && <span style={{ fontSize: 10, color: '#666' }}>{matchDate}</span>}
        </div>

        {/* Set column labels */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 4, paddingRight: 2 }}>
          {(match.sets ?? []).map(set => (
            <span key={set.set_number} style={{ fontSize: 9, width: 28, textAlign: 'center', color: set.is_current ? 'var(--color-accent)' : '#555', fontWeight: 700 }}>S{set.set_number}</span>
          ))}
          <span style={{ width: 8 }} />
          {!isFinished && <span style={{ fontSize: 9, width: 36, textAlign: 'center', color: 'var(--text-dim)', fontWeight: 700 }}>Pts</span>}
        </div>

        {/* Pair 1 row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: '0.5px solid var(--border-card)' }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <PlayerSquare player={match.pair1_player1} winner={p1Won} />
            <PlayerSquare player={match.pair1_player2} winner={p1Won} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: p1Won ? 700 : 600, color: p2Won ? '#666' : p2Leading ? '#aaa' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {match.pair1_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player1.country)}</span>}
              {match.pair1_player1?.name ?? 'TBD'}
            </div>
            <div style={{ fontSize: 13, fontWeight: p1Won ? 700 : 600, color: p2Won ? '#666' : p2Leading ? '#aaa' : 'var(--text-primary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {match.pair1_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player2.country)}</span>}
              {match.pair1_player2?.name ?? 'TBD'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {(match.sets ?? []).map(set => {
              const parsed = parseSetScore(set.set_score)
              const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
              return (
                <span key={set.set_number} style={{ ...scoreNumStyle(p1WonSet && !set.is_current, set.is_current || (!!parsed && !p1WonSet)), position: 'relative' }}>
                  {parsed ? parsed.p1 : (set.pair1_games ?? 0)}
                  {parsed?.tb != null && !p1WonSet && <sup style={{ fontSize: 10, color: 'var(--text-dim)', position: 'absolute', top: 2, right: -2 }}>{parsed.tb}</sup>}
                </span>
              )
            })}
            <span style={{ width: 8 }} />
            {!isFinished && (
              <span style={{ fontSize: 28, fontWeight: 900, width: 36, textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, color: starPoint ? 'var(--color-star)' : 'var(--color-live)' }}>
                {p1Point ?? pair1Sets}
              </span>
            )}
          </div>
        </div>

        {/* Game divider */}
        {!isFinished && currentGame && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
            <div style={{ flex: 1, height: '0.5px', background: 'var(--border-card)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-dim)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>
              {starPoint && <span style={{ color: 'var(--color-star)', fontSize: 9, fontWeight: 700, background: 'rgba(245,166,35,0.12)', border: '0.5px solid rgba(245,166,35,0.3)', borderRadius: 4, padding: '1px 5px' }}>★ Star point</span>}
            </span>
            <div style={{ flex: 1, height: '0.5px', background: 'var(--border-card)' }} />
          </div>
        )}
        {isFinished && <div style={{ height: 12 }} />}

        {/* Pair 2 row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 14 }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <PlayerSquare player={match.pair2_player1} winner={p2Won} />
            <PlayerSquare player={match.pair2_player2} winner={p2Won} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: p2Won ? 700 : 600, color: p1Won ? '#666' : p1Leading ? '#aaa' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {match.pair2_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player1.country)}</span>}
              {match.pair2_player1?.name ?? 'TBD'}
            </div>
            <div style={{ fontSize: 13, fontWeight: p2Won ? 700 : 600, color: p1Won ? '#666' : p1Leading ? '#aaa' : 'var(--text-primary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {match.pair2_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player2.country)}</span>}
              {match.pair2_player2?.name ?? 'TBD'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {(match.sets ?? []).map(set => {
              const parsed = parseSetScore(set.set_score)
              const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
              return (
                <span key={set.set_number} style={{ ...scoreNumStyle(p2WonSet && !set.is_current, set.is_current || (!!parsed && !p2WonSet)), position: 'relative' }}>
                  {parsed ? parsed.p2 : (set.pair2_games ?? 0)}
                  {parsed?.tb != null && !p2WonSet && <sup style={{ fontSize: 10, color: 'var(--text-dim)', position: 'absolute', top: 2, right: -2 }}>{parsed.tb}</sup>}
                </span>
              )
            })}
            <span style={{ width: 8 }} />
            {!isFinished && (
              <span style={{ fontSize: 28, fontWeight: 900, width: 36, textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, color: starPoint ? 'rgba(245,166,35,0.3)' : '#333' }}>
                {p2Point ?? pair2Sets}
              </span>
            )}
          </div>
        </div>
        {/* Sentinel: compact bar appears when this scrolls out of view */}
        <div ref={heroSentinelRef} style={{ height: 0 }} />
      </div>

      {/* ── Fan support ───────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-card)', padding: '12px 16px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)', textAlign: 'center', marginBottom: 10 }}>
          Who are you rooting for?
        </div>
        <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '0.5px solid var(--border-card)' }}>
          <div style={{ flex: 1, background: 'rgba(91,168,255,0.06)', borderRight: '0.5px solid var(--border-card)', padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--color-men)', lineHeight: 1 }}>62%</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.3 }}>{pair1Label}</div>
          </div>
          <div style={{ flex: 1, background: 'rgba(244,114,182,0.06)', padding: '10px 8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <div style={{ fontSize: 24, fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--color-women)', lineHeight: 1 }}>38%</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-secondary)', textAlign: 'center', lineHeight: 1.3 }}>{pair2Label}</div>
          </div>
        </div>
        <div style={{ height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--border-card)', display: 'flex', marginTop: 8 }}>
          <div style={{ width: '62%', background: 'linear-gradient(90deg, var(--color-men), rgba(91,168,255,0.5))' }} />
          <div style={{ flex: 1, background: 'linear-gradient(90deg, rgba(244,114,182,0.5), var(--color-women))' }} />
        </div>
        <div style={{ fontSize: 9, color: 'var(--text-dim)', textAlign: 'center', marginTop: 6 }}>3,779 fans voted</div>
      </div>

      {/* ── Sub-tabs ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-card)', background: 'var(--bg-card-alt)', position: 'sticky', top: heroHidden ? 49 + 62 : 49, zIndex: 7, transition: 'top 0.25s ease' }}>
        {(['live', 'players', 'h2h'] as SubTab[]).map(tab => (
          <button key={tab} onClick={() => handleSubTab(tab)} style={{ flex: 1, fontSize: 11, fontWeight: subTab === tab ? 700 : 500, padding: '10px 4px', background: 'transparent', border: 'none', color: subTab === tab ? 'var(--color-accent)' : 'var(--text-dim)', borderBottom: subTab === tab ? '2px solid var(--color-accent)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
            {tab === 'live' ? 'Live Feed' : tab === 'h2h' ? 'H2H' : 'Players'}
          </button>
        ))}
      </div>

      {/* ── Tab content ───────────────────────────────────────────────── */}
      <div style={{ background: 'var(--bg-card-alt)', minHeight: 300 }}>

        {/* LIVE FEED */}
        {subTab === 'live' && (
          <LiveFeedTab match={match} pair1Label={pair1Label} pair2Label={pair2Label} isLive={isLive} />
        )}

        {/* PLAYERS */}
        {subTab === 'players' && (
          <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {match.pair1_player1 && <PlayerCard player={match.pair1_player1} winner={p1Won} accent="var(--color-men)" />}
            {match.pair1_player2 && <PlayerCard player={match.pair1_player2} winner={p1Won} accent="var(--color-men)" />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <div style={{ flex: 1, height: '0.5px', background: '#1A2E3A' }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-dim)', letterSpacing: '2px' }}>VS</span>
              <div style={{ flex: 1, height: '0.5px', background: '#1A2E3A' }} />
            </div>
            {match.pair2_player1 && <PlayerCard player={match.pair2_player1} winner={p2Won} accent="var(--color-women)" />}
            {match.pair2_player2 && <PlayerCard player={match.pair2_player2} winner={p2Won} accent="var(--color-women)" />}
          </div>
        )}

        {/* H2H */}
        {subTab === 'h2h' && (
          <H2HTab
            match={match}
            h2hMatches={h2hMatches}
            h2hLoading={h2hLoading}
            pair1Label={pair1Label}
            pair2Label={pair2Label}
          />
        )}
      </div>
    </main>
  )
}

// ── Live Feed Tab ─────────────────────────────────────────────────────────────
function LiveFeedTab({ match, pair1Label, pair2Label, isLive }: {
  match: Match; pair1Label: string; pair2Label: string; isLive: boolean
}) {
  const sets = [...(match.sets ?? [])].sort((a, b) => b.set_number - a.set_number) // newest set first

  if (sets.length === 0 || sets.every(s => (s.games ?? []).length === 0)) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-dim)', fontSize: 12 }}>
        {isLive ? 'Waiting for first point...' : 'No point data available'}
      </div>
    )
  }

  return (
    <div>
      {/* Live indicator */}
      {isLive && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 16px 4px' }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-live)', display: 'inline-block', animation: 'blink 1.4s ease-in-out infinite' }} />
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-live)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Live · Point history</span>
        </div>
      )}

      {sets.map((set) => {
        const sortedGames = [...(set.games ?? [])].sort((a, b) => a.game_number - b.game_number)
        const reversedGames = [...sortedGames].reverse()

        return (
          <div key={set.set_number}>
            {/* Set header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 4px' }}>
              <div style={{ flex: 1, height: '0.5px', background: 'var(--border-card)' }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--color-accent)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Set {set.set_number}{set.set_score ? ` · ${set.set_score}` : ' · In progress'}
              </span>
              <div style={{ flex: 1, height: '0.5px', background: 'var(--border-card)' }} />
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
                <div key={game.id} style={{ borderTop: '0.5px solid var(--border-card)' }}>
                  {/* Game header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 16px 4px', background: 'rgba(0,0,0,0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', color: 'var(--text-dim)' }}>
                        Game {game.game_number}
                      </span>
                      {isCurrent && isLive
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-live)' }}>● In progress</span>
                        : winner === 1
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-men)' }}>{pair1Label} won</span>
                        : winner === 2
                        ? <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--color-women)' }}>{pair2Label} won</span>
                        : null
                      }
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)' }}>
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
                        borderLeft: `2px solid ${pt.scorer === 1 ? 'rgba(91,168,255,0.3)' : 'rgba(244,114,182,0.3)'}`,
                        background: isLatest ? 'rgba(255,70,85,0.06)' : pt.isSP ? 'rgba(245,166,35,0.04)' : 'transparent',
                        ...(isLatest ? { borderLeftColor: 'var(--color-live)' } : {}),
                      }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', flexShrink: 0, background: pt.scorer === 1 ? 'var(--color-men)' : 'var(--color-women)' }} />
                        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', width: 58, flexShrink: 0, color: pt.scorer === 1 ? 'var(--color-men)' : 'var(--color-women)' }}>
                          {pt.score}
                        </span>
                        <span style={{ flex: 1, fontSize: 10, color: 'var(--text-dim)' }}>
                          {pt.scorer === 1 ? pair1Label : pair2Label}
                        </span>
                        {isLatest && <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--color-live)', letterSpacing: '0.5px' }}>● now</span>}
                        {pt.isSP && !isLatest && <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--color-star)', background: 'rgba(245,166,35,0.12)', border: '0.5px solid rgba(245,166,35,0.25)', borderRadius: 3, padding: '1px 4px' }}>★ SP</span>}
                      </div>
                    )
                  })}

                  {points.length === 0 && isCurrent && (
                    <div style={{ padding: '8px 28px', fontSize: 10, color: 'var(--text-dim)' }}>Waiting for first point...</div>
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

// ── H2H Tab ───────────────────────────────────────────────────────────────────
function H2HTab({ match, h2hMatches, h2hLoading, pair1Label, pair2Label }: {
  match: Match; h2hMatches: any[]; h2hLoading: boolean; pair1Label: string; pair2Label: string
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
    <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-dim)', fontSize: 12 }}>
      Loading H2H history...
    </div>
  )

  return (
    <div>
      {/* Fixed summary header */}
      <div style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-card)', padding: '14px 16px 12px', position: 'sticky', top: 95, zIndex: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--color-men)', lineHeight: 1 }}>{p1Wins}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-men)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair1Label}</div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>H2H</div>
            <div style={{ fontSize: 9, color: 'var(--text-dim)', marginTop: 2 }}>{h2hMatches.length} matches</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'var(--font-mono)', color: 'var(--color-women)', lineHeight: 1 }}>{p2Wins}</div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--color-women)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pair2Label}</div>
          </div>
        </div>
      </div>

      {/* Column headers */}
      {h2hMatches.length > 0 && (
        <div style={{ display: 'flex', padding: '7px 16px', background: 'var(--bg-card-alt)', borderBottom: '0.5px solid var(--border-card)' }}>
          <span style={{ flex: 1, fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tournament · Round</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 48 }}>Score</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.5px', width: 28, textAlign: 'center' }}>W/L</span>
        </div>
      )}

      {/* Match list */}
      {h2hMatches.length === 0 && !h2hLoading && (
        <div style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-dim)', fontSize: 12 }}>
          No previous meetings found
        </div>
      )}

      {h2hMatches.map((m, idx) => {
        const mp1p1 = m.pair1_player1?.id ?? null
        const mp1p2 = m.pair1_player2?.id ?? null
        const ourPairIsMatch1 = pairMatchesIds(mp1p1, mp1p2, p1Ids)
        const ourWon = (ourPairIsMatch1 && m.winner_pair === 1) || (!ourPairIsMatch1 && m.winner_pair === 2)

        const scores = formatSetScores(m)
        const date = formatDate(m.started_at)
        const tournamentName = (m.tournament as any)?.name ?? '—'
        const round = m.round ?? ''

        return (
          <div key={m.id} style={{ padding: '10px 16px', borderBottom: '0.5px solid var(--border-card)', display: 'flex', alignItems: 'center', gap: 8, background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.1)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tournamentName}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>{round}</span>
                {date && <><span style={{ width: 2, height: 2, borderRadius: '50%', background: 'var(--text-dim)', display: 'inline-block' }} /><span>{date}</span></>}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', flexShrink: 0, textAlign: 'right', marginRight: 12 }}>
              {scores || '—'}
            </div>
            <div style={{ width: 28, height: 28, borderRadius: 6, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ourWon ? 'rgba(91,168,255,0.12)' : 'rgba(244,114,182,0.08)', border: `0.5px solid ${ourWon ? 'rgba(91,168,255,0.3)' : 'rgba(244,114,182,0.25)'}` }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: ourWon ? 'var(--color-men)' : 'var(--color-women)' }}>{ourWon ? 'W' : 'L'}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── PlayerCard ────────────────────────────────────────────────────────────────
function PlayerCard({ player, winner, accent }: { player: any; winner?: boolean; accent?: string }) {
  return (
    <div style={{ background: 'var(--bg-card)', borderRadius: 10, overflow: 'hidden', border: winner ? `0.5px solid ${accent ?? 'rgba(255,255,255,0.15)'}` : '0.5px solid var(--border-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '0.5px solid var(--border-card)', gap: 8 }}>
        <PlayerAvatar player={player} size={36} winner={winner} accent={accent} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: winner ? 'var(--text-primary)' : '#888', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {player.country && <span style={{ marginRight: 4 }}>{countryFlag(player.country)}</span>}
            {player.name}
          </div>
          {player.side && <div style={{ fontSize: 10, color: accent ?? 'var(--text-dim)', marginTop: 1 }}>{player.side === 'drive' ? 'Drive' : 'Backhand'}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-accent)' }}>{player.ranking ? `#${player.ranking}` : '—'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Rank</div>
        </div>
        <div style={{ width: '0.5px', height: 28, background: 'var(--border-card)' }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-success)' }}>{player.win_rate ? `${player.win_rate}%` : '—'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Win rate</div>
        </div>
        <div style={{ width: '0.5px', height: 28, background: 'var(--border-card)' }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#aaa' }}>{player.total_matches ?? '—'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Matches</div>
        </div>
      </div>
    </div>
  )
}

// ── PlayerAvatar ──────────────────────────────────────────────────────────────
function PlayerAvatar({ player, size, winner, accent }: { player: any; size: number; winner?: boolean; accent?: string }) {
  const [imgError, setImgError] = useState(false)
  const borderColor = winner ? (accent ?? 'rgba(255,255,255,0.4)') : 'var(--border-strong)'
  if (!player) return <div style={{ width: size, height: size, borderRadius: size / 3, background: 'var(--border-strong)', flexShrink: 0 }} />
  return player.avatar_url && !imgError ? (
    <img src={`/api/img?src=${encodeURIComponent(player.avatar_url)}`} alt={player.name} style={{ width: size, height: size, borderRadius: size / 3, objectFit: 'cover', flexShrink: 0, border: `1.5px solid ${borderColor}` }} onError={() => setImgError(true)} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: size / 3, background: '#0D2540', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.35, color: 'var(--text-secondary)', fontWeight: 700, border: `1.5px solid ${borderColor}` }}>
      {player.name?.[0]}
    </div>
  )
}

// ── PlayerSquare (hero photos) ────────────────────────────────────────────────
function PlayerSquare({ player, winner }: { player: any; winner?: boolean }) {
  const [imgError, setImgError] = useState(false)
  const initials = player?.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('') ?? '?'
  const border = winner ? '2px solid rgba(255,255,255,0.5)' : '1.5px solid var(--border-strong)'
  const bg = winner ? 'rgba(255,255,255,0.05)' : '#0A1A2A'
  if (!player) return <div style={{ width: 56, height: 56, borderRadius: 10, background: bg, border, flexShrink: 0 }} />
  return player.avatar_url && !imgError ? (
    <img src={`/api/img?src=${encodeURIComponent(player.avatar_url)}`} alt={player.name} style={{ width: 56, height: 56, borderRadius: 10, objectFit: 'cover', flexShrink: 0, border }} onError={() => setImgError(true)} />
  ) : (
    <div style={{ width: 56, height: 56, borderRadius: 10, background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: winner ? 'rgba(255,255,255,0.7)' : '#4A6A8A', fontWeight: 700, border }}>
      {initials}
    </div>
  )
}
