'use client'
// src/components/BracketView.tsx
// Visual tournament bracket — full draw from first round to Final.
// Generates the complete bracket structure with empty TBD slots for future rounds.
// Mobile-first: horizontal scroll, compact team cards, connecting lines.

import { useMemo } from 'react'
import { Match, countryFlag, toShortName } from '@/types/match'

// ── Brand constants ─────────────────────────────────────────────
const GREEN = '#7ED321'
const MUTED = '#6B7280'
const BG_CARD = '#141414'
const BG_EMPTY = '#0F0F0F'
const BORDER = 'rgba(255,255,255,0.06)'
const LIVE_RED = '#FF4655'
const ORANGE = '#F5A623'
const CONNECTOR = 'rgba(255,255,255,0.08)'

const ROUND_ORDER = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'] as const
const ROUND_LABELS: Record<string, string> = {
  R128: 'R128', R64: 'R64', R32: 'R32', R16: 'R16',
  QF: 'QF', SF: 'SF', F: 'Final',
}

// ── Slot dimensions (px) ────────────────────────────────────────
const SLOT_W = 140
const SLOT_H = 52
const MATCH_GAP = 6  // gap between two teams in a match
const ROUND_GAP = 24 // horizontal gap between round columns (room for connector lines)

interface DrawEntry {
  draw_position: number
  round: string | null
  seed: number | null
  marker: string | null
  category: string
  player1_name: string
  player1_country: string | null
  player1_id: string | null
  player2_name: string
  player2_country: string | null
  player2_id: string | null
  team_points: number | null
}

interface TeamSlot {
  seed: number | null
  marker: string | null
  player1Name: string | null
  player1Country: string | null
  player2Name: string | null
  player2Country: string | null
  isEmpty: boolean
}

interface MatchNode {
  team1: TeamSlot
  team2: TeamSlot
  score: string[] | null
  winnerTeam: 1 | 2 | null
  isLive: boolean
  matchId: string | null
}

interface Props {
  drawEntries: DrawEntry[]
  matches: Match[]
  genderFilter: 'men' | 'women'
}

export default function BracketView({ drawEntries, matches, genderFilter }: Props) {
  const bracket = useMemo(() => {
    const entries = drawEntries.filter(d => d.category === genderFilter)
    if (entries.length === 0) return null

    // Determine draw size and starting round
    const drawSize = entries.length
    const startIdx = drawSize > 64 ? 0 : drawSize > 32 ? 1 : drawSize > 16 ? 2 : drawSize > 8 ? 3 : drawSize > 4 ? 4 : drawSize > 2 ? 5 : 6
    const rounds = ROUND_ORDER.slice(startIdx)

    // Sort entries by draw_position
    const sorted = [...entries].sort((a, b) => a.draw_position - b.draw_position)

    // Build match lookup from actual matches
    const genderMatches = matches.filter((m: any) => m.category === genderFilter)
    const matchMap = new Map<string, any>()
    for (const m of genderMatches) {
      const ids = [
        (m as any).pair1_player1_id, (m as any).pair1_player2_id,
        (m as any).pair2_player1_id, (m as any).pair2_player2_id,
      ].filter(Boolean).sort().join(',')
      if (ids) matchMap.set(ids, m)
    }

    // Build round-by-round bracket
    const roundMatches: Map<string, MatchNode[]> = new Map()

    // First round: pair up draw entries
    const firstRound = rounds[0]
    const firstRoundMatches: MatchNode[] = []
    for (let i = 0; i < sorted.length; i += 2) {
      const a = sorted[i]
      const b = sorted[i + 1]

      const team1: TeamSlot = a ? {
        seed: a.seed, marker: a.marker,
        player1Name: a.player1_name, player1Country: a.player1_country,
        player2Name: a.player2_name, player2Country: a.player2_country,
        isEmpty: a.player1_name === 'Qualifier',
      } : { seed: null, marker: null, player1Name: null, player1Country: null, player2Name: null, player2Country: null, isEmpty: true }

      const team2: TeamSlot = b ? {
        seed: b.seed, marker: b.marker,
        player1Name: b.player1_name, player1Country: b.player1_country,
        player2Name: b.player2_name, player2Country: b.player2_country,
        isEmpty: b.player1_name === 'Qualifier',
      } : { seed: null, marker: null, player1Name: null, player1Country: null, player2Name: null, player2Country: null, isEmpty: true }

      // Find match result
      let score: string[] | null = null
      let winnerTeam: 1 | 2 | null = null
      let isLive = false
      let matchId: string | null = null

      if (a && b) {
        const ids = [a.player1_id, a.player2_id, b.player1_id, b.player2_id].filter(Boolean).sort().join(',')
        const match = matchMap.get(ids)
        if (match) {
          matchId = match.id
          isLive = match.status === 'live'
          winnerTeam = match.winner_pair
          score = (match.sets ?? [])
            .sort((x: any, y: any) => x.set_number - y.set_number)
            .map((s: any) => `${s.pair1_games}-${s.pair2_games}`)
        }
      }

      firstRoundMatches.push({ team1, team2, score, winnerTeam, isLive, matchId })
    }
    roundMatches.set(firstRound, firstRoundMatches)

    // Generate subsequent rounds with TBD slots
    for (let r = 1; r < rounds.length; r++) {
      const round = rounds[r]
      const prevMatches = roundMatches.get(rounds[r - 1]) ?? []
      const thisRoundMatches: MatchNode[] = []

      for (let i = 0; i < prevMatches.length; i += 2) {
        const matchA = prevMatches[i]
        const matchB = prevMatches[i + 1]

        // Winner of matchA is team1, winner of matchB is team2
        const getWinner = (m: MatchNode | undefined): TeamSlot => {
          if (!m) return { seed: null, marker: null, player1Name: null, player1Country: null, player2Name: null, player2Country: null, isEmpty: true }
          if (m.winnerTeam === 1) return m.team1
          if (m.winnerTeam === 2) return m.team2
          return { seed: null, marker: null, player1Name: 'TBD', player1Country: null, player2Name: null, player2Country: null, isEmpty: true }
        }

        thisRoundMatches.push({
          team1: getWinner(matchA),
          team2: getWinner(matchB),
          score: null, winnerTeam: null, isLive: false, matchId: null,
        })
      }
      roundMatches.set(round, thisRoundMatches)
    }

    return { rounds, roundMatches }
  }, [drawEntries, matches, genderFilter])

  if (!bracket) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: MUTED, fontSize: 13 }}>
        No draw data available for this category.
      </div>
    )
  }

  const { rounds, roundMatches } = bracket
  const firstRoundMatchCount = roundMatches.get(rounds[0])?.length ?? 0

  // Calculate total bracket height based on first round
  const matchHeight = SLOT_H * 2 + MATCH_GAP
  const betweenMatches = 8
  const totalHeight = firstRoundMatchCount * matchHeight + (firstRoundMatchCount - 1) * betweenMatches + 40

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{
        overflowX: 'auto',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        maxHeight: 'calc(100vh - 260px)',
      }}>
        <div style={{
          display: 'flex',
          gap: ROUND_GAP,
          padding: '0 12px 12px',
          minWidth: rounds.length * (SLOT_W + ROUND_GAP),
          minHeight: totalHeight,
          position: 'relative',
        }}>
          {rounds.map((round, colIdx) => {
            const matchesInRound = roundMatches.get(round) ?? []
            const multiplier = Math.pow(2, colIdx)

            return (
              <div key={round} style={{ flex: `0 0 ${SLOT_W}px`, position: 'relative' }}>
                {/* Round label */}
                <div style={{
                  fontSize: 9, fontWeight: 800, color: colIdx === rounds.length - 1 ? GREEN : MUTED,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  textAlign: 'center', padding: '4px 0 6px',
                  position: 'sticky', top: 0, background: '#1A1A1A', zIndex: 2,
                }}>
                  {ROUND_LABELS[round]}
                </div>

                {/* Matches */}
                {matchesInRound.map((match, matchIdx) => {
                  // Vertical position: center this match between the two matches it feeds from
                  const baseMatchH = matchHeight + betweenMatches
                  const topOffset = colIdx === 0
                    ? matchIdx * baseMatchH
                    : matchIdx * baseMatchH * multiplier + (multiplier - 1) * baseMatchH / 2

                  return (
                    <div
                      key={matchIdx}
                      style={{
                        position: 'absolute',
                        top: topOffset + 24, // 24px for header
                        left: 0,
                        width: SLOT_W,
                      }}
                    >
                      {/* Team 1 */}
                      <TeamCard
                        team={match.team1}
                        isWinner={match.winnerTeam === 1}
                        isLoser={match.winnerTeam === 2}
                        isLive={match.isLive}
                        score={match.score}
                        showScore
                      />

                      {/* Connector between teams */}
                      <div style={{
                        height: MATCH_GAP, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <div style={{ width: '80%', height: 1, background: CONNECTOR }} />
                      </div>

                      {/* Team 2 */}
                      <TeamCard
                        team={match.team2}
                        isWinner={match.winnerTeam === 2}
                        isLoser={match.winnerTeam === 1}
                        isLive={match.isLive}
                      />

                      {/* Connector line to next round */}
                      {colIdx < rounds.length - 1 && (
                        <div style={{
                          position: 'absolute',
                          right: -ROUND_GAP,
                          top: SLOT_H + MATCH_GAP / 2 - 0.5,
                          width: ROUND_GAP,
                          height: 1,
                          background: CONNECTOR,
                        }} />
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      <style>{`
        @keyframes bracketLive {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  )
}

// ── Team Card ───────────────────────────────────────────────────
function TeamCard({ team, isWinner, isLoser, isLive, score, showScore }: {
  team: TeamSlot
  isWinner: boolean
  isLoser: boolean
  isLive: boolean
  score?: string[] | null
  showScore?: boolean
}) {
  const isEmpty = team.isEmpty || !team.player1Name

  return (
    <div style={{
      height: SLOT_H,
      background: isEmpty ? BG_EMPTY : BG_CARD,
      border: `1px solid ${isLive ? LIVE_RED : isWinner ? 'rgba(126,211,33,0.25)' : BORDER}`,
      borderRadius: 4,
      padding: '4px 7px',
      opacity: isLoser ? 0.4 : isEmpty ? 0.3 : 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Live dot */}
      {isLive && (
        <div style={{
          position: 'absolute', top: 3, right: 3,
          width: 5, height: 5, borderRadius: '50%',
          background: LIVE_RED,
          animation: 'bracketLive 1.5s ease-in-out infinite',
        }} />
      )}

      {isEmpty ? (
        <div style={{ fontSize: 9, color: MUTED, textAlign: 'center', fontWeight: 600 }}>
          {team.player1Name === 'TBD' ? 'TBD' : team.marker === 'Q' ? 'Qualifier' : 'TBD'}
        </div>
      ) : (
        <>
          {/* Top row: badges + score */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginBottom: 1 }}>
            {team.seed && (
              <span style={{
                fontSize: 7, fontWeight: 800, color: GREEN,
                background: 'rgba(126,211,33,0.12)',
                padding: '0 3px', borderRadius: 2, lineHeight: '14px',
              }}>
                {team.seed}
              </span>
            )}
            {team.marker && (
              <span style={{
                fontSize: 6, fontWeight: 800,
                color: team.marker === 'Q' ? ORANGE : '#4A9EFF',
                background: team.marker === 'Q' ? 'rgba(245,166,35,0.12)' : 'rgba(74,158,255,0.12)',
                padding: '0 3px', borderRadius: 2, lineHeight: '12px',
              }}>
                {team.marker}
              </span>
            )}
            {showScore && score && score.length > 0 && (
              <span style={{ fontSize: 8, color: isLive ? LIVE_RED : MUTED, marginLeft: 'auto', fontWeight: 700, fontFamily: 'monospace' }}>
                {score.join(' ')}
              </span>
            )}
          </div>

          {/* Player 1 */}
          <div style={{
            fontSize: 9, fontWeight: 600,
            color: isWinner ? GREEN : '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            lineHeight: 1.2,
          }}>
            {team.player1Country && <span style={{ marginRight: 2, fontSize: 10 }}>{countryFlag(team.player1Country)}</span>}
            {toShortName(team.player1Name!)}
          </div>

          {/* Player 2 */}
          {team.player2Name && (
            <div style={{
              fontSize: 9, fontWeight: 500,
              color: isWinner ? 'rgba(126,211,33,0.7)' : 'rgba(255,255,255,0.5)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              lineHeight: 1.2,
            }}>
              {team.player2Country && <span style={{ marginRight: 2, fontSize: 10 }}>{countryFlag(team.player2Country)}</span>}
              {toShortName(team.player2Name)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
