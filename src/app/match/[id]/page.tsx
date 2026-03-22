'use client'
// src/app/match/[id]/page.tsx

import { useState, useEffect, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Match, getCurrentScore, pairName, isStarPoint, getLastNPoints, countryFlag, parseSetScore } from '@/types/match'

type SubTab = 'players' | 'summary' | 'points'

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const handleBack = () => {
    if (window.history.length > 1) router.back()
    else router.push('/')
  }

  const [match, setMatch] = useState<Match | null>(null)
  const [loading, setLoading] = useState(true)
  const [subTab, setSubTab] = useState<SubTab>('players')
  const [stats, setStats] = useState<any>(null)
  const [statsLoading, setStatsLoading] = useState(false)

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

  const handleSubTab = async (tab: SubTab) => {
    setSubTab(tab)
    if (tab === 'summary' && !stats && !statsLoading && match) {
      setStatsLoading(true)
      try {
        const externalId = (match as any).external_id
        const res = await fetch(`/api/match-stats?id=${externalId}`)
        if (res.ok) setStats(await res.json())
      } catch (e) { console.error('Failed to fetch stats', e) }
      setStatsLoading(false)
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
        <button onClick={handleBack} style={{ color: 'var(--color-success)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}>← Go back</button>
      </div>
    </main>
  )

  const { pair1Sets, pair2Sets, currentSet, currentGame } = getCurrentScore(match)
  const pair1Label = pairName(match.pair1_player1, match.pair1_player2)
  const pair2Label = pairName(match.pair2_player1, match.pair2_player2)

  const currentPoint = currentGame?.points?.slice(-1)[0] ?? null
  const [p1Point, p2Point] = currentPoint ? currentPoint.split(':') : [null, null]
  const starPoint = currentGame ? isStarPoint(currentGame.points ?? []) : false
  const last10 = getLastNPoints(currentSet, 10)

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

  const computeGameWinners = (set: any) => {
    if (!set) return []
    const games = [...(set.games ?? [])].sort((a: any, b: any) => a.game_number - b.game_number)
    return games.map((game: any, i: number) => {
      const score = game.game_score
      if (!score || score === '0-0') return null
      const prevGame = i > 0 ? games[i - 1] : null
      const prevScore = prevGame?.game_score
      if (!prevScore || prevScore === '0-0') {
        const [p1, p2] = score.split('-').map(Number)
        return p1 > p2 ? 1 : 2
      }
      const [p1, p2] = score.split('-').map(Number)
      const [pp1, pp2] = prevScore.split('-').map(Number)
      if (p1 > pp1) return 1
      if (p2 > pp2) return 2
      return null
    })
  }

  return (
    <main style={{ background: 'var(--bg-base)', minHeight: '100vh', maxWidth: 500, margin: '0 auto' }}>

      {/* Nav bar */}
      <div style={{ background: 'var(--bg-base)', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '0.5px solid var(--border-base)', position: 'sticky', top: 0, zIndex: 10 }}>
        <button
          onClick={handleBack}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--bg-input)', border: '0.5px solid var(--border-strong)', borderRadius: 20, padding: '5px 12px', cursor: 'pointer', color: '#aaa', fontSize: 12, fontWeight: 600, fontFamily: 'var(--font-sans)', flexShrink: 0 }}
        >
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

      {/* Hero score */}
      <div style={{ background: 'var(--bg-card)', borderTop: `3px solid ${genderAccent}`, padding: '16px 18px 16px', borderBottom: '0.5px solid var(--border-base)' }}>

        {/* Court + round info */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <span style={{ fontSize: 10, color: '#888', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{match.court ?? ''}</span>
          {match.court && match.round && <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555', display: 'inline-block' }} />}
          <span style={{ fontSize: 10, color: '#777' }}>{match.round ?? ''}</span>
          <span style={{ flex: 1 }} />
          {matchDate && <span style={{ fontSize: 10, color: '#666' }}>{matchDate}</span>}
        </div>

        {/* Set column labels */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginBottom: 4, paddingRight: 2 }}>
          {(match.sets ?? []).map(set => (
            <span key={set.set_number} style={{ fontSize: 9, width: 32, textAlign: 'center', color: set.is_current ? 'var(--color-success)' : '#555', fontWeight: 700 }}>S{set.set_number}</span>
          ))}
          <span style={{ width: 8 }} />
          {!isFinished && <span style={{ fontSize: 9, width: 32, textAlign: 'center', color: 'var(--text-muted)', fontWeight: 700 }}>Pts</span>}
        </div>

        {/* Pair 1 row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 12, borderBottom: '0.5px solid var(--border-base)' }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <PlayerSquare player={match.pair1_player1} winner={p1Won} />
            <PlayerSquare player={match.pair1_player2} winner={p1Won} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: p1Won ? 700 : 600, color: p2Won ? '#777' : p2Leading ? '#aaa' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {match.pair1_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player1.country)}</span>}
              {match.pair1_player1?.name ?? 'TBD'}
            </div>
            <div style={{ fontSize: 13, fontWeight: p1Won ? 700 : 600, color: p2Won ? '#777' : p2Leading ? '#aaa' : 'var(--text-primary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {match.pair1_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player2.country)}</span>}
              {match.pair1_player2?.name ?? 'TBD'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {(match.sets ?? []).map(set => {
              const parsed = parseSetScore(set.set_score)
              const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
              return (
                <span key={set.set_number} style={{ fontSize: 28, fontWeight: 900, width: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, position: 'relative', color: set.is_current ? '#777' : parsed ? (p1WonSet ? 'var(--text-primary)' : '#555') : 'var(--text-muted)' }}>
                  {parsed ? parsed.p1 : (set.pair1_games ?? 0)}
                  {parsed?.tb != null && !p1WonSet && <sup style={{ fontSize: 10, color: 'var(--text-muted)', position: 'absolute', top: 2, right: -1 }}>{parsed.tb}</sup>}
                </span>
              )
            })}
            <span style={{ width: 8 }} />
            {!isFinished && (
              <span style={{ fontSize: 28, fontWeight: 900, width: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, color: starPoint ? 'var(--color-star)' : 'var(--color-success)' }}>
                {p1Point ?? pair1Sets}
              </span>
            )}
          </div>
        </div>

        {/* Game divider */}
        {!isFinished && currentGame && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
            <div style={{ flex: 1, height: '0.5px', background: 'var(--border-base)' }} />
            <span style={{ fontSize: 10, color: 'var(--text-ghost)', fontWeight: 600 }}>
              {starPoint && <span style={{ color: 'var(--color-star)', marginRight: 4 }}>SP ·</span>}
              Game {currentGame.game_number}
            </span>
            <div style={{ flex: 1, height: '0.5px', background: 'var(--border-base)' }} />
          </div>
        )}
        {isFinished && <div style={{ height: 12 }} />}

        {/* Pair 2 row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
            <PlayerSquare player={match.pair2_player1} winner={p2Won} />
            <PlayerSquare player={match.pair2_player2} winner={p2Won} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: p2Won ? 700 : 600, color: p1Won ? '#777' : p1Leading ? '#aaa' : 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {match.pair2_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player1.country)}</span>}
              {match.pair2_player1?.name ?? 'TBD'}
            </div>
            <div style={{ fontSize: 13, fontWeight: p2Won ? 700 : 600, color: p1Won ? '#777' : p1Leading ? '#aaa' : 'var(--text-primary)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {match.pair2_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player2.country)}</span>}
              {match.pair2_player2?.name ?? 'TBD'}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {(match.sets ?? []).map(set => {
              const parsed = parseSetScore(set.set_score)
              const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
              return (
                <span key={set.set_number} style={{ fontSize: 28, fontWeight: 900, width: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, position: 'relative', color: set.is_current ? '#777' : parsed ? (p2WonSet ? 'var(--text-primary)' : '#555') : 'var(--text-muted)' }}>
                  {parsed ? parsed.p2 : (set.pair2_games ?? 0)}
                  {parsed?.tb != null && !p2WonSet && <sup style={{ fontSize: 10, color: 'var(--text-muted)', position: 'absolute', top: 2, right: -1 }}>{parsed.tb}</sup>}
                </span>
              )
            })}
            <span style={{ width: 8 }} />
            {!isFinished && (
              <span style={{ fontSize: 28, fontWeight: 900, width: 32, textAlign: 'center', fontFamily: 'var(--font-mono)', lineHeight: 1, color: starPoint ? 'rgba(245,158,11,0.35)' : 'var(--color-success)' }}>
                {p2Point ?? pair2Sets}
              </span>
            )}
          </div>
        </div>

        {/* Last 10 points */}
        {isLive && last10.length > 1 && (
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '0.5px solid var(--border-base)' }}>
            <div style={{ fontSize: 9, color: 'var(--text-ghost)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Last {last10.length} points</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {last10.map((pt, i) => (
                <div key={i} style={{ width: 24, height: 24, borderRadius: 5, background: pt.winner === 1 ? 'rgba(16,185,129,0.2)' : 'rgba(129,140,248,0.2)', border: pt.winner === 1 ? '0.5px solid rgba(16,185,129,0.4)' : '0.5px solid rgba(129,140,248,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: pt.winner === 1 ? 'var(--color-p1)' : 'var(--color-p2)' }} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 12, marginTop: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-p1)' }} /><span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{pair1Label}</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--color-p2)' }} /><span style={{ fontSize: 9, color: 'var(--text-dim)' }}>{pair2Label}</span></div>
            </div>
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border-base)', background: 'var(--bg-card-alt)', position: 'sticky', top: 49, zIndex: 9 }}>
        {(['players', 'summary', 'points'] as SubTab[]).map(tab => (
          <button key={tab} onClick={() => handleSubTab(tab)} style={{ flex: 1, fontSize: 11, fontWeight: subTab === tab ? 600 : 500, padding: '10px 4px', background: 'transparent', border: 'none', color: subTab === tab ? 'var(--color-success)' : 'var(--text-dim)', borderBottom: subTab === tab ? '2px solid var(--color-success)' : '2px solid transparent', cursor: 'pointer', fontFamily: 'var(--font-sans)' }}>
            {tab === 'points' ? 'Point by Point' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ background: 'var(--bg-card-alt)', minHeight: 300, padding: '12px' }}>

        {/* PLAYERS */}
        {subTab === 'players' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {match.pair1_player1 && <PlayerCard player={match.pair1_player1} winner={p1Won} />}
            {match.pair1_player2 && <PlayerCard player={match.pair1_player2} winner={p1Won} />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
              <div style={{ flex: 1, height: '0.5px', background: '#222' }} />
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-ghost)', letterSpacing: '2px' }}>VS</span>
              <div style={{ flex: 1, height: '0.5px', background: '#222' }} />
            </div>
            {match.pair2_player1 && <PlayerCard player={match.pair2_player1} winner={p2Won} />}
            {match.pair2_player2 && <PlayerCard player={match.pair2_player2} winner={p2Won} />}
          </div>
        )}

        {/* SUMMARY */}
        {subTab === 'summary' && (
          <div>
            {statsLoading ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)', fontSize: 12 }}>Loading stats...</div>
            ) : stats ? (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-p1)' }}>{pair1Label}</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-p2)' }}>{pair2Label}</span>
                </div>
                {[
                  { key: 'total_points_won', label: 'Points won' },
                  { key: 'break_points_converted', label: 'Break pts' },
                  { key: 'won_on_1st_serve', label: '1st serve won' },
                  { key: 'won_on_2nd_serve', label: '2nd serve won' },
                  { key: 'total_won_on_return', label: 'Return pts' },
                  { key: 'longest_streak', label: 'Longest streak' },
                ].map(({ key, label }) => {
                  const d = stats.match?.[key]
                  if (!d) return null
                  const v1 = parseInt(d.team_1)
                  const v2 = parseInt(d.team_2)
                  const total = v1 + v2 || 1
                  return (
                    <div key={key} style={{ marginBottom: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-p1)', fontFamily: 'var(--font-mono)' }}>{d.team_1}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{label}</span>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-p2)', fontFamily: 'var(--font-mono)' }}>{d.team_2}</span>
                      </div>
                      <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', background: 'var(--border-card)' }}>
                        <div style={{ width: `${(v1 / total) * 100}%`, background: 'var(--color-p1)' }} />
                        <div style={{ width: 2, background: 'var(--bg-card-alt)', flexShrink: 0 }} />
                        <div style={{ flex: 1, background: 'var(--color-p2)' }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)', fontSize: 12 }}>Stats not available</div>
            )}
          </div>
        )}

        {/* POINT BY POINT */}
        {subTab === 'points' && (
          <div style={{ overflowX: 'auto' }}>
            {(match.sets ?? []).map(set => {
              const gameWinners = computeGameWinners(set)
              const isTiebreak = set.set_score ? (set.set_score.includes('(') || (parseSetScore(set.set_score)?.p1 === 7 && parseSetScore(set.set_score)?.p2 === 6)) : false
              return (
                <div key={set.set_number} style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <span style={{ fontSize: 10, color: 'var(--color-success)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Set {set.set_number}</span>
                    {set.set_score && <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{set.set_score}</span>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11, color: '#aaa', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pair1Label}</span>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {gameWinners.map((winner, i) => {
                          const isTB = isTiebreak && i === gameWinners.length - 1
                          return (
                            <div key={i} style={{ width: 22, height: 22, borderRadius: 4, flexShrink: 0, background: winner === 1 ? 'rgba(16,185,129,0.2)' : 'var(--bg-input)', border: winner === 1 ? (isTB ? '0.5px solid rgba(245,158,11,0.4)' : '0.5px solid rgba(16,185,129,0.4)') : '0.5px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {winner === 1 && <div style={{ width: 7, height: 7, borderRadius: '50%', background: isTB ? 'var(--color-star)' : 'var(--color-p1)' }} />}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pair2Label}</span>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {gameWinners.map((winner, i) => {
                          const isTB = isTiebreak && i === gameWinners.length - 1
                          return (
                            <div key={i} style={{ width: 22, height: 22, borderRadius: 4, flexShrink: 0, background: winner === 2 ? 'rgba(129,140,248,0.2)' : 'var(--bg-input)', border: winner === 2 ? (isTB ? '0.5px solid rgba(245,158,11,0.4)' : '0.5px solid rgba(129,140,248,0.4)') : '0.5px solid var(--border-card)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              {winner === 2 && <div style={{ width: 7, height: 7, borderRadius: '50%', background: isTB ? 'var(--color-star)' : 'var(--color-p2)' }} />}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 16, paddingTop: 8, borderTop: '0.5px solid var(--border-base)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-p1)' }} /><span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{pair1Label}</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-p2)' }} /><span style={{ fontSize: 10, color: 'var(--text-dim)' }}>{pair2Label}</span></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-star)' }} /><span style={{ fontSize: 10, color: 'var(--text-dim)' }}>Tiebreak</span></div>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}

function PlayerAvatar({ player, size, winner }: { player: any; size: number; winner?: boolean }) {
  const [imgError, setImgError] = useState(false)
  if (!player) return <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--border-strong)', flexShrink: 0 }} />
  return player.avatar_url && !imgError ? (
    <img src={`/api/img?src=${encodeURIComponent(player.avatar_url)}`} alt={player.name} style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: winner ? '1.5px solid var(--color-success)' : '1.5px solid var(--border-strong)' }} onError={() => setImgError(true)} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'var(--border-strong)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: size * 0.35, color: 'var(--text-muted)', fontWeight: 700, border: winner ? '1.5px solid var(--color-success)' : '1.5px solid var(--border-strong)' }}>
      {player.name?.[0]}
    </div>
  )
}

function PlayerCard({ player, winner }: { player: any; winner?: boolean }) {
  return (
    <div style={{ background: 'var(--bg-input)', borderRadius: 10, overflow: 'hidden', border: winner ? '0.5px solid rgba(16,185,129,0.25)' : '0.5px solid var(--border-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', borderBottom: '0.5px solid var(--border-card)', gap: 6 }}>
        {player.country && <span style={{ fontSize: 13 }}>{countryFlag(player.country)}</span>}
        <span style={{ fontSize: 13, fontWeight: 700, color: winner ? 'var(--text-primary)' : '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{player.name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {player.side && <>
          <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-side)' }}>{player.side === 'drive' ? 'DR' : 'BH'}</div>
            <div style={{ fontSize: 10, color: '#666' }}>Side</div>
          </div>
          <div style={{ width: '0.5px', height: 28, background: 'var(--border-card)' }} />
        </>}
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-rank)' }}>{player.ranking ? `#${player.ranking}` : '—'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Rank</div>
        </div>
        <div style={{ width: '0.5px', height: 28, background: 'var(--border-card)' }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-success)' }}>{player.win_rate ? `${player.win_rate}%` : '—'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Win</div>
        </div>
        <div style={{ width: '0.5px', height: 28, background: 'var(--border-card)' }} />
        <div style={{ flex: 1, textAlign: 'center', padding: '7px 0' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#aaa' }}>{player.total_matches ?? '—'}</div>
          <div style={{ fontSize: 10, color: '#666' }}>Matches</div>
        </div>
      </div>
    </div>
  )
}

function PlayerSquare({ player, winner }: { player: any; size?: number; winner?: boolean }) {
  const [imgError, setImgError] = useState(false)
  const initials = player?.name?.split(' ').map((n: string) => n[0]).slice(0, 2).join('') ?? '?'
  const border = winner ? '2px solid var(--color-success)' : '0.5px solid #2a2a2a'
  const bg = winner ? 'rgba(16,185,129,0.08)' : 'var(--bg-subtle)'
  if (!player) return <div style={{ width: 56, height: 56, borderRadius: 8, background: bg, border, flexShrink: 0 }} />
  return player.avatar_url && !imgError ? (
    <img
      src={`/api/img?src=${encodeURIComponent(player.avatar_url)}`}
      alt={player.name}
      style={{ width: 56, height: 56, borderRadius: 8, objectFit: 'cover', flexShrink: 0, border }}
      onError={() => setImgError(true)}
    />
  ) : (
    <div style={{ width: 56, height: 56, borderRadius: 8, background: bg, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, color: winner ? 'var(--color-success)' : '#555', fontWeight: 700, border }}>
      {initials}
    </div>
  )
}
