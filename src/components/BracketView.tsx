'use client'
// src/components/BracketView.tsx
// Visual tournament bracket — horizontal scrollable draw from first round to Final.
// Shows team names, seeds, markers, and match results when available.

import { useMemo } from 'react'
import { Match, countryFlag, toShortName } from '@/types/match'

// ── Brand constants ─────────────────────────────────────────────
const GREEN = '#7ED321'
const MUTED = '#6B7280'
const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'
const LIVE_RED = '#FF4655'
const ORANGE = '#F5A623'

// Round ordering (left to right in bracket)
const ROUND_COLUMNS = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']
const ROUND_LABELS: Record<string, string> = {
  R128: 'Round of 128',
  R64: 'Round of 64',
  R32: 'Round of 32',
  R16: 'Round of 16',
  QF: 'Quarterfinals',
  SF: 'Semifinals',
  F: 'Final',
}

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

interface BracketSlot {
  drawPosition: number
  round: string
  roundIndex: number // position within the round (0-based)
  seed: number | null
  marker: string | null
  player1Name: string
  player1Country: string | null
  player2Name: string
  player2Country: string | null
  matchResult: {
    matchId: string
    status: string
    winnerPair: number | null
    sets: string[]
    isLive: boolean
  } | null
}

interface Props {
  drawEntries: DrawEntry[]
  matches: Match[]
  genderFilter: 'men' | 'women'
}

export default function BracketView({ drawEntries, matches, genderFilter }: Props) {
  const bracketData = useMemo(() => {
    const genderEntries = drawEntries.filter(d => d.category === genderFilter)
    if (genderEntries.length === 0) return null

    // Determine which rounds exist
    const roundSet = new Set(genderEntries.map(d => d.round).filter(Boolean) as string[])

    // If no round data, infer from draw size
    if (roundSet.size === 0) {
      const size = genderEntries.length
      const startRound = size > 64 ? 'R128' : size > 32 ? 'R64' : size > 16 ? 'R32' : size > 8 ? 'R16' : size > 4 ? 'QF' : size > 2 ? 'SF' : 'F'
      genderEntries.forEach(d => { d.round = startRound })
      roundSet.add(startRound)
    }

    // Filter ROUND_COLUMNS to only rounds that exist
    const activeRounds = ROUND_COLUMNS.filter(r => roundSet.has(r))

    // Group entries by round
    const entriesByRound = new Map<string, DrawEntry[]>()
    for (const entry of genderEntries) {
      const round = entry.round ?? activeRounds[0]
      const arr = entriesByRound.get(round) ?? []
      arr.push(entry)
      entriesByRound.set(round, arr)
    }

    // Sort each round by draw_position
    for (const [, entries] of entriesByRound) {
      entries.sort((a, b) => a.draw_position - b.draw_position)
    }

    // Build match lookup: find matches by player IDs
    const genderMatches = matches.filter((m: any) => m.category === genderFilter)
    const matchByPlayers = new Map<string, Match>()
    for (const m of genderMatches) {
      const p1 = (m as any).pair1_player1_id
      const p2 = (m as any).pair1_player2_id
      const p3 = (m as any).pair2_player1_id
      const p4 = (m as any).pair2_player2_id
      if (p1 && p3) {
        // Key by sorted player IDs to find match regardless of pair order
        const key = [p1, p2, p3, p4].filter(Boolean).sort().join(',')
        matchByPlayers.set(key, m)
      }
    }

    // Build bracket slots with match results
    const columns: { round: string; label: string; slots: BracketSlot[] }[] = []

    for (const round of activeRounds) {
      const entries = entriesByRound.get(round) ?? []
      const slots: BracketSlot[] = []

      // Process entries in pairs (two teams play each other)
      for (let j = 0; j < entries.length; j += 2) {
        const entryA = entries[j]
        const entryB = entries[j + 1]

        // Try to find matching match
        let matchResult: BracketSlot['matchResult'] = null
        if (entryA && entryB) {
          const playerIds = [
            entryA.player1_id, entryA.player2_id,
            entryB.player1_id, entryB.player2_id,
          ].filter(Boolean).sort().join(',')

          const match = matchByPlayers.get(playerIds)
          if (match) {
            const sets = ((match as any).sets ?? [])
              .sort((a: any, b: any) => a.set_number - b.set_number)
              .map((s: any) => `${s.pair1_games}-${s.pair2_games}`)

            matchResult = {
              matchId: match.id,
              status: (match as any).status,
              winnerPair: (match as any).winner_pair,
              sets,
              isLive: (match as any).status === 'live',
            }
          }
        }

        if (entryA) {
          slots.push({
            drawPosition: entryA.draw_position,
            round,
            roundIndex: j / 2,
            seed: entryA.seed,
            marker: entryA.marker,
            player1Name: entryA.player1_name,
            player1Country: entryA.player1_country,
            player2Name: entryA.player2_name,
            player2Country: entryA.player2_country,
            matchResult,
          })
        }

        if (entryB) {
          slots.push({
            drawPosition: entryB.draw_position,
            round,
            roundIndex: j / 2,
            seed: entryB.seed,
            marker: entryB.marker,
            player1Name: entryB.player1_name,
            player1Country: entryB.player1_country,
            player2Name: entryB.player2_name,
            player2Country: entryB.player2_country,
            matchResult,
          })
        }
      }

      columns.push({ round, label: ROUND_LABELS[round] ?? round, slots })
    }

    return { columns, totalRounds: activeRounds.length }
  }, [drawEntries, matches, genderFilter])

  if (!bracketData || bracketData.columns.length === 0) {
    return (
      <div style={{ padding: 20, textAlign: 'center', color: MUTED, fontSize: 13 }}>
        No draw data available for this category.
      </div>
    )
  }

  const firstRoundSlots = bracketData.columns[0]?.slots.length ?? 0
  const slotHeight = 64
  const slotGap = 4
  const matchGap = 8

  return (
    <div style={{ padding: '12px 0' }}>
      <div style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        paddingBottom: 12,
      }}>
        <div style={{
          display: 'flex',
          gap: 2,
          minWidth: bracketData.columns.length * 160,
          padding: '0 12px',
        }}>
          {bracketData.columns.map((col, colIdx) => {
            // Each subsequent round has half the slots — add spacing to vertically center
            const roundMultiplier = Math.pow(2, colIdx)
            const slotTotalHeight = slotHeight + slotGap
            const matchHeight = slotTotalHeight * 2 + matchGap

            return (
              <div key={col.round} style={{ flex: '0 0 150px', minWidth: 150 }}>
                {/* Round header */}
                <div style={{
                  fontSize: 9, fontWeight: 800, color: MUTED,
                  textTransform: 'uppercase', letterSpacing: 0.5,
                  textAlign: 'center', padding: '6px 0 8px',
                }}>
                  {col.label}
                </div>

                {/* Slots */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {col.slots.map((slot, slotIdx) => {
                    const isTopOfMatch = slotIdx % 2 === 0
                    const isBottomOfMatch = slotIdx % 2 === 1

                    // Determine if this team won/lost
                    const matchPairNum = isTopOfMatch ? 1 : 2
                    const isWinner = slot.matchResult?.winnerPair === matchPairNum
                    const isLoser = slot.matchResult?.winnerPair != null && !isWinner
                    const isLive = slot.matchResult?.isLive

                    // Vertical spacing for alignment with previous round
                    const topPadding = colIdx === 0
                      ? 0
                      : isTopOfMatch
                        ? (roundMultiplier - 1) * slotTotalHeight + (roundMultiplier - 1) * matchGap / 2
                        : slotGap

                    const isQualifier = slot.player1Name === 'Qualifier'

                    return (
                      <div
                        key={slot.drawPosition}
                        style={{
                          marginTop: isTopOfMatch ? topPadding : slotGap,
                          marginBottom: isBottomOfMatch ? matchGap : 0,
                          background: BG_CARD,
                          border: `1px solid ${isLive ? LIVE_RED : isWinner ? 'rgba(126,211,33,0.3)' : BORDER}`,
                          borderRadius: 4,
                          padding: '5px 8px',
                          opacity: isLoser ? 0.5 : isQualifier ? 0.4 : 1,
                          position: 'relative',
                          minHeight: slotHeight - 8,
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'center',
                        }}
                      >
                        {/* Live indicator */}
                        {isLive && (
                          <div style={{
                            position: 'absolute', top: 3, right: 3,
                            width: 6, height: 6, borderRadius: '50%',
                            background: LIVE_RED,
                            animation: 'livePulse 1.5s ease-in-out infinite',
                          }} />
                        )}

                        {/* Seed / Marker badges */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          {slot.seed && (
                            <span style={{
                              fontSize: 8, fontWeight: 800, color: GREEN,
                              background: 'rgba(126,211,33,0.12)',
                              padding: '0 4px', borderRadius: 2,
                            }}>
                              {slot.seed}
                            </span>
                          )}
                          {slot.marker && (
                            <span style={{
                              fontSize: 7, fontWeight: 800,
                              color: slot.marker === 'Q' ? ORANGE : '#4A9EFF',
                              background: slot.marker === 'Q' ? 'rgba(245,166,35,0.12)' : 'rgba(74,158,255,0.12)',
                              padding: '0 3px', borderRadius: 2,
                            }}>
                              {slot.marker}
                            </span>
                          )}
                          {/* Score */}
                          {slot.matchResult && slot.matchResult.sets.length > 0 && isTopOfMatch && (
                            <span style={{ fontSize: 8, color: MUTED, marginLeft: 'auto' }}>
                              {slot.matchResult.sets.join(' ')}
                            </span>
                          )}
                        </div>

                        {/* Player 1 */}
                        <div style={{
                          fontSize: 10, fontWeight: 600,
                          color: isWinner ? GREEN : '#fff',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          lineHeight: 1.3,
                        }}>
                          {slot.player1Country && <span style={{ marginRight: 3 }}>{countryFlag(slot.player1Country)}</span>}
                          {isQualifier ? 'TBD (Qualifier)' : toShortName(slot.player1Name)}
                        </div>

                        {/* Player 2 */}
                        {!isQualifier && (
                          <div style={{
                            fontSize: 10, fontWeight: 500,
                            color: isWinner ? 'rgba(126,211,33,0.7)' : 'rgba(255,255,255,0.6)',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            lineHeight: 1.3,
                          }}>
                            {slot.player2Country && <span style={{ marginRight: 3 }}>{countryFlag(slot.player2Country)}</span>}
                            {toShortName(slot.player2Name)}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <style>{`
        @keyframes livePulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.3); }
        }
      `}</style>
    </div>
  )
}
