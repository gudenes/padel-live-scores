'use client'
// src/components/BracketView.tsx
// Visual tournament bracket — full draw from first round to Final.
// Generates the complete bracket structure with empty TBD slots for future rounds.
// Mobile-first: horizontal scroll, compact team cards, connecting lines.

import { useMemo } from 'react'
import Link from 'next/link'
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
const MATCH_CARD_H = 56 // single card for both teams
const ROUND_GAP = 24    // horizontal gap between round columns

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
  player1Id: string | null
  player2Name: string | null
  player2Country: string | null
  player2Id: string | null
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

    // Build match lookups from actual matches
    const genderMatches = matches.filter((m: any) => m.category === genderFilter)

    // Primary: match by sorted player IDs
    const matchByIds = new Map<string, any>()
    // Secondary: match by player name pairs (handles cases where IDs don't align)
    const matchByNames = new Map<string, any>()

    for (const m of genderMatches) {
      const ids = [
        (m as any).pair1_player1_id, (m as any).pair1_player2_id,
        (m as any).pair2_player1_id, (m as any).pair2_player2_id,
      ].filter(Boolean).sort().join(',')
      if (ids) matchByIds.set(ids, m)

      // Name-based key: first player last name from each pair
      const n1 = ((m as any).pair1_player1?.name ?? '').split(' ').pop()?.toLowerCase()
      const n2 = ((m as any).pair2_player1?.name ?? '').split(' ').pop()?.toLowerCase()
      if (n1 && n2) {
        matchByNames.set([n1, n2].sort().join('/'), m)
      }
    }

    // Build round-by-round bracket
    const roundMatches: Map<string, MatchNode[]> = new Map()

    // First round: pair up draw entries
    const firstRound = rounds[0]
    const firstRoundMatches: MatchNode[] = []
    for (let i = 0; i < sorted.length; i += 2) {
      const a = sorted[i]
      const b = sorted[i + 1]

      const emptySlot: TeamSlot = { seed: null, marker: null, player1Name: null, player1Country: null, player1Id: null, player2Name: null, player2Country: null, player2Id: null, isEmpty: true }

      const team1: TeamSlot = a ? {
        seed: a.seed, marker: a.marker,
        player1Name: a.player1_name, player1Country: a.player1_country, player1Id: a.player1_id,
        player2Name: a.player2_name, player2Country: a.player2_country, player2Id: a.player2_id,
        isEmpty: a.player1_name === 'Qualifier',
      } : emptySlot

      const team2: TeamSlot = b ? {
        seed: b.seed, marker: b.marker,
        player1Name: b.player1_name, player1Country: b.player1_country, player1Id: b.player1_id,
        player2Name: b.player2_name, player2Country: b.player2_country, player2Id: b.player2_id,
        isEmpty: b.player1_name === 'Qualifier',
      } : emptySlot

      // Find match result
      let score: string[] | null = null
      let winnerTeam: 1 | 2 | null = null
      let isLive = false
      let matchId: string | null = null

      if (a && b) {
        // Try ID-based match first, then name-based fallback
        const ids = [a.player1_id, a.player2_id, b.player1_id, b.player2_id].filter(Boolean).sort().join(',')
        const n1 = a.player1_name.split(' ').pop()?.toLowerCase() ?? ''
        const n2 = b.player1_name.split(' ').pop()?.toLowerCase() ?? ''
        const nameKey = [n1, n2].sort().join('/')
        const match = (ids ? matchByIds.get(ids) : null) ?? matchByNames.get(nameKey)
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
          if (!m) return { seed: null, marker: null, player1Name: null, player1Country: null, player1Id: null, player2Name: null, player2Country: null, player2Id: null, isEmpty: true }
          if (m.winnerTeam === 1) return m.team1
          if (m.winnerTeam === 2) return m.team2
          return { seed: null, marker: null, player1Name: 'TBD', player1Country: null, player1Id: null, player2Name: null, player2Country: null, player2Id: null, isEmpty: true }
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

  // Layout constants
  const GAP = 6
  const HEADER = 24
  const COL_W = SLOT_W + ROUND_GAP
  const baseH = MATCH_CARD_H + GAP

  // Pre-compute every match card position so SVG lines are pixel-perfect
  const positions = new Map<string, { x: number; y: number; midY: number }>()
  for (let c = 0; c < rounds.length; c++) {
    const count = roundMatches.get(rounds[c])?.length ?? 0
    const mult = Math.pow(2, c)
    for (let m = 0; m < count; m++) {
      const x = c * COL_W
      const y = HEADER + (c === 0 ? m * baseH : m * baseH * mult + (mult - 1) * baseH / 2)
      positions.set(`${c}-${m}`, { x, y, midY: y + MATCH_CARD_H / 2 })
    }
  }

  const trophyX = rounds.length * COL_W
  const finalMult = Math.pow(2, rounds.length - 1)
  const trophyY = HEADER + (finalMult - 1) * baseH / 2
  const totalWidth = trophyX + 70
  const totalHeight = firstRoundMatchCount * baseH + HEADER + 20

  // SVG connector lines — computed from exact card positions
  const svgLines: string[] = []
  for (let c = 0; c < rounds.length - 1; c++) {
    const count = roundMatches.get(rounds[c])?.length ?? 0
    const mergeX = c * COL_W + SLOT_W + ROUND_GAP / 2

    for (let m = 0; m < count; m += 2) {
      const topPos = positions.get(`${c}-${m}`)
      const botPos = positions.get(`${c}-${m + 1}`)
      const nextPos = positions.get(`${c + 1}-${Math.floor(m / 2)}`)
      if (!topPos || !nextPos) continue

      const topMidY = topPos.midY
      const botMidY = botPos?.midY ?? topMidY
      const nextMidY = nextPos.midY
      const rightEdge = topPos.x + SLOT_W

      // Top match → horizontal to merge column
      svgLines.push(`M${rightEdge},${topMidY} L${mergeX},${topMidY}`)
      // Bottom match → horizontal to merge column
      if (botPos) svgLines.push(`M${rightEdge},${botMidY} L${mergeX},${botMidY}`)
      // Vertical connecting both
      svgLines.push(`M${mergeX},${topMidY} L${mergeX},${botMidY}`)
      // Merge midpoint → horizontal to next round card
      svgLines.push(`M${mergeX},${nextMidY} L${nextPos.x},${nextMidY}`)
    }
  }

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{
        overflowX: 'auto',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        maxHeight: 'calc(100vh - 260px)',
      }}>
        <div style={{ position: 'relative', width: totalWidth, height: totalHeight, padding: '0 12px 12px' }}>
          {/* SVG connectors — single pixel-perfect layer */}
          <svg style={{ position: 'absolute', top: 0, left: 12, width: totalWidth, height: totalHeight, pointerEvents: 'none', zIndex: 0 }}>
            {svgLines.map((d, i) => (
              <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
            ))}
          </svg>

          {/* Round labels */}
          {rounds.map((round, colIdx) => (
            <div key={`lbl-${round}`} style={{
              position: 'absolute', left: colIdx * COL_W, top: 0, width: SLOT_W,
              fontSize: 9, fontWeight: 800, color: colIdx === rounds.length - 1 ? GREEN : MUTED,
              textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center', padding: '4px 0', zIndex: 2,
            }}>
              {ROUND_LABELS[round]}
            </div>
          ))}

          {/* Match cards */}
          {rounds.map((round, colIdx) => (roundMatches.get(round) ?? []).map((match, matchIdx) => {
            const pos = positions.get(`${colIdx}-${matchIdx}`)!
            return (
              <div key={`${colIdx}-${matchIdx}`} style={{
                position: 'absolute', left: pos.x, top: pos.y, width: SLOT_W, zIndex: 1,
              }}>
                <MatchCard match={match} />
              </div>
            )
          }))}

          {/* Trophy */}
          <div style={{ position: 'absolute', left: trophyX, top: trophyY, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{
              width: 48, height: 48, background: 'rgba(126,211,33,0.08)',
              clipPath: 'polygon(3% 8%, 97% 0%, 98% 92%, 1% 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="1.5">
                <path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2" />
                <path d="M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" />
                <path d="M6 3h12v6a6 6 0 0 1-12 0V3z" />
                <path d="M12 15v3" /><path d="M8 21h8" /><path d="M10 18h4" />
              </svg>
            </div>
            <div style={{ fontSize: 8, fontWeight: 800, color: GREEN, textAlign: 'center', marginTop: 4, letterSpacing: 0.5 }}>WINNER</div>
          </div>
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

// ── Match Card (both teams in one container) ────────────────────
function MatchCard({ match }: { match: MatchNode }) {
  const { team1, team2, score, winnerTeam, isLive } = match
  const bothEmpty = (team1.isEmpty || !team1.player1Name) && (team2.isEmpty || !team2.player1Name)

  if (bothEmpty) {
    return (
      <div style={{
        height: MATCH_CARD_H, background: BG_EMPTY,
        border: `1px solid ${BORDER}`, borderRadius: 4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        opacity: 0.3,
      }}>
        <span style={{ fontSize: 9, color: MUTED, fontWeight: 600 }}>TBD</span>
      </div>
    )
  }

  const Wrapper = match.matchId
    ? ({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) => (
        <Link href={`/match/${match.matchId}`} style={{ ...style, textDecoration: 'none', color: 'inherit', cursor: 'pointer' }}>
          {children}
        </Link>
      )
    : ({ children, style }: { children: React.ReactNode; style: React.CSSProperties }) => (
        <div style={style}>{children}</div>
      )

  return (
    <Wrapper style={{
      display: 'block',
      height: MATCH_CARD_H, background: BG_CARD,
      border: `1px solid ${isLive ? LIVE_RED : BORDER}`,
      borderRadius: 4, overflow: 'hidden', position: 'relative',
    }}>
      {/* Live dot */}
      {isLive && (
        <div style={{
          position: 'absolute', top: 3, right: 3,
          width: 5, height: 5, borderRadius: '50%',
          background: LIVE_RED, animation: 'bracketLive 1.5s ease-in-out infinite',
        }} />
      )}

      {/* Score badge top-right */}
      {score && score.length > 0 && (
        <div style={{
          position: 'absolute', top: 2, right: isLive ? 12 : 4,
          fontSize: 7, color: isLive ? LIVE_RED : MUTED, fontWeight: 700, fontFamily: 'monospace',
        }}>
          {score.join(' ')}
        </div>
      )}

      {/* Team 1 */}
      <TeamRow team={team1} isWinner={winnerTeam === 1} isLoser={winnerTeam === 2} />

      {/* Divider */}
      <div style={{ height: 1, background: BORDER, margin: '0 6px' }} />

      {/* Team 2 */}
      <TeamRow team={team2} isWinner={winnerTeam === 2} isLoser={winnerTeam === 1} />
    </Wrapper>
  )
}

// ── Team Row (single team within a match card) ──────────────────
function TeamRow({ team, isWinner, isLoser }: { team: TeamSlot; isWinner: boolean; isLoser: boolean }) {
  const isEmpty = team.isEmpty || !team.player1Name
  const rowH = (MATCH_CARD_H - 1) / 2 // subtract 1px for divider

  if (isEmpty) {
    return (
      <div style={{ height: rowH, display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.3 }}>
        <span style={{ fontSize: 8, color: MUTED }}>
          {team.player1Name === 'TBD' ? 'TBD' : team.marker === 'Q' ? 'Qualifier' : 'TBD'}
        </span>
      </div>
    )
  }

  return (
    <div style={{
      height: rowH, padding: '2px 6px',
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      opacity: isLoser ? 0.4 : 1,
      borderLeft: isWinner ? `2px solid ${GREEN}` : '2px solid transparent',
    }}>
      {/* Player 1 + seed */}
      <div style={{
        fontSize: 9, fontWeight: 600, color: '#fff',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        lineHeight: 1.2,
      }}>
        {team.player1Country && <span style={{ marginRight: 2, fontSize: 10 }}>{countryFlag(team.player1Country)}</span>}
        {team.player1Id ? (
          <Link href={`/player/${team.player1Id}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
            {toShortName(team.player1Name!)}
          </Link>
        ) : toShortName(team.player1Name!)}
        {team.seed && <span style={{ color: GREEN, fontSize: 7, fontWeight: 700 }}> ({team.seed})</span>}
        {team.marker && (
          <span style={{ fontSize: 6, fontWeight: 700, color: team.marker === 'Q' ? ORANGE : '#4A9EFF', marginLeft: 2 }}>
            {team.marker}
          </span>
        )}
      </div>
      {/* Player 2 */}
      {team.player2Name && (
        <div style={{
          fontSize: 8, fontWeight: 500, color: '#fff',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          lineHeight: 1.2,
        }}>
          {team.player2Country && <span style={{ marginRight: 2, fontSize: 9 }}>{countryFlag(team.player2Country)}</span>}
          {team.player2Id ? (
            <Link href={`/player/${team.player2Id}`} style={{ color: 'inherit', textDecoration: 'none' }} onClick={e => e.stopPropagation()}>
              {toShortName(team.player2Name)}
            </Link>
          ) : toShortName(team.player2Name)}
        </div>
      )}
    </div>
  )
}
