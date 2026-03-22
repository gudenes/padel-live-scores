'use client'
// src/app/components/MatchCard.tsx

import { useRouter } from 'next/navigation'
import { Match, pairName, countryFlag, parseSetScore, getCurrentScore } from '@/types/match'

interface MatchCardProps {
  match: Match
  viewerCount: number
  expanded: boolean
  onToggle: () => void
}

export default function MatchCard({ match }: MatchCardProps) {
  const router = useRouter()

  const { pair1Sets, pair2Sets, currentSet, currentGame } = getCurrentScore(match)
  const currentPoint = currentGame?.points?.slice(-1)[0] ?? null
  const [p1Point, p2Point] = currentPoint ? currentPoint.split(':') : [null, null]

  const isFinished = match.status === 'finished'
  const isUpcoming = match.status === 'scheduled'
  const isLive = match.status === 'live'
  const winnerPair = (match as any).winner_pair
  const p1Won = isFinished && winnerPair === 1
  const p2Won = isFinished && winnerPair === 2
  const p1Leading = !isFinished && (p1Point === 'A' || (p1Point && p2Point && p1Point !== 'A' && p2Point !== 'A' && parseInt(p1Point) > parseInt(p2Point)))
  const p2Leading = !isFinished && (p2Point === 'A' || (p1Point && p2Point && p1Point !== 'A' && p2Point !== 'A' && parseInt(p2Point) > parseInt(p1Point)))

  const category = (match as any).category as string | null
  const genderAccent = category === 'men' ? '#60a5fa' : category === 'women' ? '#f87171' : 'transparent'
  const scheduleLabel = (match as any).schedule_label as string | null

  const scheduledTime = (() => {
    // Always prefer schedule_label from API
    if (scheduleLabel) return scheduleLabel
    const src = match.scheduled_at ?? match.started_at
    if (!src) return null
    try {
      const d = new Date(src)
      // Skip midnight UTC placeholder dates — these are fake
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null
      return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).format(d)
    } catch { return null }
  })()

  return (
    <div
      onClick={() => router.push(`/match/${match.id}`)}
      style={{ background: '#1a1a1a', border: '0.5px solid #272727', borderLeft: `3px solid ${genderAccent}`, borderRadius: 10, marginBottom: 5, overflow: 'hidden', cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}
    >
      <div style={{ padding: '5px 10px 6px' }}>
        {isUpcoming ? (
          /* Upcoming layout */
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ borderBottom: '0.5px solid #252525', paddingBottom: 3, marginBottom: 3 }}>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e8e8e8' }}>
                  {match.pair1_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player1.country)}</span>}
                  {pairName(match.pair1_player1, null)}
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#666', marginTop: 1 }}>
                  {match.pair1_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player2.country)}</span>}
                  {pairName(match.pair1_player2, null)}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#e8e8e8' }}>
                  {match.pair2_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player1.country)}</span>}
                  {pairName(match.pair2_player1, null)}
                </div>
                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#666', marginTop: 1 }}>
                  {match.pair2_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player2.country)}</span>}
                  {pairName(match.pair2_player2, null)}
                </div>
              </div>
            </div>
            <div style={{ flexShrink: 0, width: 110, textAlign: 'right' }}>
              {scheduledTime ? (
                <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981', lineHeight: 1.3 }}>{scheduledTime}</span>
              ) : (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#10b981', opacity: 0.5 }}>After previous</span>
              )}
            </div>
          </div>
        ) : (
          /* Live / Finished layout */
          <>
            {/* Status + set headers on same row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {isFinished && <span style={{ fontSize: 8, color: '#3a3a3a', fontWeight: 600 }}>Finished</span>}
                {isFinished && match.round && <span style={{ fontSize: 8, color: '#2a2a2a', background: '#1e1e1e', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>{match.round}</span>}
                {isLive && <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}><span style={{ width: 4, height: 4, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} /><span style={{ fontSize: 8, color: '#ef4444', fontWeight: 700 }}>Live</span></div>}
                {isLive && match.round && <span style={{ fontSize: 8, color: '#3a3a3a', background: '#1e1e1e', borderRadius: 4, padding: '1px 5px', fontWeight: 600 }}>{match.round}</span>}
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {(match.sets ?? []).map((set) => (
                  <span key={set.set_number} style={{ fontSize: 8, width: 20, textAlign: 'center', color: set.is_current ? '#10b981' : '#333', fontWeight: 700 }}>S{set.set_number}</span>
                ))}
                <span style={{ width: 3 }} />
                {isLive && <span style={{ fontSize: 8, width: 20, textAlign: 'center', color: '#555', fontWeight: 700 }}>Pts</span>}
              </div>
            </div>

            {/* Pair 1 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderBottom: '0.5px solid #252525', paddingBottom: 3, marginBottom: 3 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: p1Won ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p2Won ? '#444' : '#e8e8e8' }}>
                  {match.pair1_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player1.country)}</span>}
                  {pairName(match.pair1_player1, null)}
                </div>
                <div style={{ fontSize: 12, fontWeight: p1Won ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p2Won ? '#444' : '#e8e8e8', marginTop: 1 }}>
                  {match.pair1_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair1_player2.country)}</span>}
                  {pairName(match.pair1_player2, null)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                {(match.sets ?? []).map((set) => {
                  const parsed = parseSetScore(set.set_score)
                  const p1WonSet = parsed ? parsed.p1 > parsed.p2 : false
                  return (
                    <span key={set.set_number} style={{ fontSize: 16, fontWeight: 800, width: 20, textAlign: 'center', fontFamily: 'monospace', lineHeight: 1.2, position: 'relative', color: set.is_current ? '#666' : parsed ? (p1WonSet ? '#e8e8e8' : '#2a2a2a') : '#555' }}>
                      {parsed ? parsed.p1 : (set.pair1_games ?? 0)}
                      {parsed?.tb != null && !p1WonSet && <sup style={{ fontSize: 7, color: '#555', position: 'absolute', top: 1, right: -1 }}>{parsed.tb}</sup>}
                    </span>
                  )
                })}
                <span style={{ width: 3 }} />
                {isLive && <span style={{ fontSize: 16, fontWeight: 800, width: 20, textAlign: 'center', fontFamily: 'monospace', lineHeight: 1.2, color: '#10b981' }}>{p1Point ?? pair1Sets}</span>}
              </div>
            </div>

            {/* Pair 2 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: p2Won ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p1Won ? '#444' : '#e8e8e8' }}>
                  {match.pair2_player1?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player1.country)}</span>}
                  {pairName(match.pair2_player1, null)}
                </div>
                <div style={{ fontSize: 12, fontWeight: p2Won ? 700 : 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: p1Won ? '#444' : '#e8e8e8', marginTop: 1 }}>
                  {match.pair2_player2?.country && <span style={{ marginRight: 3 }}>{countryFlag(match.pair2_player2.country)}</span>}
                  {pairName(match.pair2_player2, null)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                {(match.sets ?? []).map((set) => {
                  const parsed = parseSetScore(set.set_score)
                  const p2WonSet = parsed ? parsed.p2 > parsed.p1 : false
                  return (
                    <span key={set.set_number} style={{ fontSize: 16, fontWeight: 800, width: 20, textAlign: 'center', fontFamily: 'monospace', lineHeight: 1.2, position: 'relative', color: set.is_current ? '#666' : parsed ? (p2WonSet ? '#e8e8e8' : '#2a2a2a') : '#555' }}>
                      {parsed ? parsed.p2 : (set.pair2_games ?? 0)}
                      {parsed?.tb != null && !p2WonSet && <sup style={{ fontSize: 7, color: '#555', position: 'absolute', top: 1, right: -1 }}>{parsed.tb}</sup>}
                    </span>
                  )
                })}
                <span style={{ width: 3 }} />
                {isLive && <span style={{ fontSize: 16, fontWeight: 800, width: 20, textAlign: 'center', fontFamily: 'monospace', lineHeight: 1.2, color: '#10b981', opacity: 0.3 }}>{p2Point ?? pair2Sets}</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
