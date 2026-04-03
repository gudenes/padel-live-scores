'use client'

import { useMemo, useState } from 'react'
import { Game, Set as MatchSet, parseSetScore } from '@/types/match'

// ── Types ────────────────────────────────────────────────────────────────────
interface MomentumChartProps {
  sets: MatchSet[]
  pair1Label: string
  pair2Label: string
  isLive: boolean
  pair1Color: string
  pair2Color: string
  pair1Avatars: (string | null)[]
  pair2Avatars: (string | null)[]
  onGameClick?: (setNumber: number, gameNumber: number) => void
}

interface GameSummary {
  gameNumber: number
  setNumber: number
  p1Points: number
  p2Points: number
  winner: 1 | 2 | null
  isCurrent: boolean
  globalIndex: number
}

// ── Colors — same as live feed (amber / teal) ──────────────────────────────
const P1_COLOR = '#F59E0B'
const P2_COLOR = '#14B8A6'
const LIVE_RED = '#FF4455'

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractPointScorers(game: Game): { scorer: 1 | 2 }[] {
  const pts = (game.points ?? []).filter(p => p !== '0:0')
  const result: { scorer: 1 | 2 }[] = []
  const val = (s: string) => s === 'A' ? 50 : s === '40' ? 40 : s === '30' ? 30 : s === '15' ? 15 : 0

  for (let i = 0; i < pts.length; i++) {
    const [p1s, p2s] = pts[i].split(':')
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
    result.push({ scorer })
  }
  return result
}

function computeGameWinner(games: Game[], idx: number): 1 | 2 | null {
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

function buildGameSummaries(sets: MatchSet[]): GameSummary[] {
  const summaries: GameSummary[] = []
  let globalIdx = 0

  for (const set of sets) {
    const games = [...(set.games ?? [])].sort((a, b) => a.game_number - b.game_number)
    for (let i = 0; i < games.length; i++) {
      const game = games[i]
      const points = extractPointScorers(game)
      const winner = computeGameWinner(games, i)

      summaries.push({
        gameNumber: game.game_number,
        setNumber: set.set_number,
        p1Points: points.filter(p => p.scorer === 1).length,
        p2Points: points.filter(p => p.scorer === 2).length,
        winner,
        isCurrent: game.is_current,
        globalIndex: globalIdx++,
      })
    }
  }
  return summaries
}

// ── Player Avatar ───────────────────────────────────────────────────────────

function MiniAvatar({ url, size = 32 }: { url: string | null; size?: number }) {
  const [err, setErr] = useState(false)
  if (url && !err) {
    return (
      <img
        src={url}
        alt=""
        style={{
          width: size, height: size, borderRadius: '50%',
          objectFit: 'cover', flexShrink: 0,
          border: '2px solid var(--bg-card)',
          boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
        }}
        onError={() => setErr(true)}
      />
    )
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: '#1a3550', flexShrink: 0,
      border: '2px solid var(--bg-card)',
      boxShadow: '0 1px 4px rgba(0,0,0,0.4)',
    }} />
  )
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function MomentumChart({ sets, pair1Label, pair2Label, isLive, pair1Avatars, pair2Avatars, onGameClick }: MomentumChartProps) {
  const sortedSets = useMemo(() => [...sets].sort((a, b) => a.set_number - b.set_number), [sets])
  const allGames = useMemo(() => buildGameSummaries(sortedSets), [sortedSets])

  const hasData = allGames.some(g => g.p1Points > 0 || g.p2Points > 0)
  if (!hasData) return null

  const hasCurrentGame = allGames.some(g => g.isCurrent)
  const currentGameIdx = allGames.findIndex(g => g.isCurrent)

  const p1Names = pair1Label.split(' / ')
  const p2Names = pair2Label.split(' / ')
  const p1Short = p1Names[0] ?? 'P1'
  const p2Short = p2Names[0] ?? 'P2'

  const setScores = sortedSets.map(s => {
    const p = parseSetScore(s.set_score)
    return p ? { p1: p.p1, p2: p.p2, label: `${p.p1}-${p.p2}` } : null
  })

  // ── SVG layout ──
  const svgW = 600
  const svgH = 234  // 180 × 1.3 = 234 (30% taller)
  const centerY = svgH / 2
  const pad = { left: 4, right: 4, top: 24, bottom: 8 }
  const chartW = svgW - pad.left - pad.right
  const chartH = svgH - pad.top - pad.bottom
  // Fixed width: assume max 3 sets × 13 games = 39 games
  const maxGames = 39
  const barGap = 3
  const barWidth = Math.max(6, (chartW - barGap * (maxGames - 1)) / maxGames) * 1.15  // 15% wider
  const totalGames = allGames.length
  const totalBarsW = totalGames * barWidth + (totalGames - 1) * barGap
  const barsStartX = pad.left

  const maxPts = Math.max(5, ...allGames.map(g => Math.max(g.p1Points, g.p2Points)))
  const barScale = (chartH / 2 - 6) / maxPts

  // Set boundary positions with winner info
  const setBoundaries: { x: number; score: string; winner: 1 | 2 | null }[] = []
  for (let i = 1; i < allGames.length; i++) {
    if (allGames[i].setNumber !== allGames[i - 1].setNumber) {
      const x1 = barsStartX + (i - 1) * (barWidth + barGap) + barWidth
      const x2 = barsStartX + i * (barWidth + barGap)
      const setIdx = allGames[i - 1].setNumber - 1
      const sc = setScores[setIdx]
      const winner = sc ? (sc.p1 > sc.p2 ? 1 : sc.p2 > sc.p1 ? 2 : null) : null
      setBoundaries.push({ x: (x1 + x2) / 2, score: sc?.label ?? '', winner })
    }
  }

  // Red marker position — stay on previous game until first point is scored in current
  const currentHasPoints = currentGameIdx >= 0 && (allGames[currentGameIdx].p1Points > 0 || allGames[currentGameIdx].p2Points > 0)
  const markerIdx = currentGameIdx >= 0
    ? (currentHasPoints ? currentGameIdx : Math.max(0, currentGameIdx - 1))
    : allGames.length - 1
  const markerGame = allGames[currentGameIdx >= 0 ? currentGameIdx : markerIdx]
  const markerX = barsStartX + markerIdx * (barWidth + barGap) + barWidth + 1

  return (
    <div style={{ background: 'var(--bg-card)', borderBottom: '0.5px solid var(--border-card)', padding: '12px 16px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-dim)' }}>
            Match Journey
          </span>
        </div>
      </div>

      {/* Chart area */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
        {/* Player avatars column */}
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 10, width: 56, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <MiniAvatar url={pair1Avatars[0]} size={34} />
            </div>
            <div style={{ position: 'relative', zIndex: 1, marginLeft: -10 }}>
              <MiniAvatar url={pair1Avatars[1]} size={34} />
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ position: 'relative', zIndex: 2 }}>
              <MiniAvatar url={pair2Avatars[0]} size={34} />
            </div>
            <div style={{ position: 'relative', zIndex: 1, marginLeft: -10 }}>
              <MiniAvatar url={pair2Avatars[1]} size={34} />
            </div>
          </div>
        </div>

        {/* SVG Chart */}
        <div style={{ flex: 1, height: 208 }}>
          <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="barP1g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={P1_COLOR} stopOpacity={0.85} />
                <stop offset="100%" stopColor={P1_COLOR} stopOpacity={0.25} />
              </linearGradient>
              <linearGradient id="barP2g" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={P2_COLOR} stopOpacity={0.85} />
                <stop offset="100%" stopColor={P2_COLOR} stopOpacity={0.25} />
              </linearGradient>
              {/* Chunky clip-path for bars — slight angular cut */}
              <clipPath id="chunkyBarUp" clipPathUnits="objectBoundingBox">
                <polygon points="0.03,0.05 0.97,0 1,0.95 0,1" />
              </clipPath>
              <clipPath id="chunkyBarDown" clipPathUnits="objectBoundingBox">
                <polygon points="0,0.05 1,0 0.97,0.95 0.03,1" />
              </clipPath>
            </defs>

            {/* Center line */}
            <line x1={pad.left} y1={centerY} x2={svgW - pad.right} y2={centerY} stroke="rgba(255,255,255,0.08)" strokeWidth={1} />

            {/* Set boundary lines with large score at top (pair1 won) or bottom (pair2 won) */}
            {setBoundaries.map((b, i) => {
              const color = b.winner === 1 ? P1_COLOR : b.winner === 2 ? P2_COLOR : '#64748B'
              // Position score at top of chart if pair1 won, bottom if pair2 won
              const scoreY = b.winner === 1 ? pad.top + 6 : b.winner === 2 ? svgH - pad.bottom - 6 : centerY
              const anchor = b.winner === 1 ? 'hanging' : b.winner === 2 ? 'auto' : 'middle'
              return (
                <g key={`setb-${i}`}>
                  <line x1={b.x} y1={pad.top} x2={b.x} y2={svgH - pad.bottom} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
                  {/* Large set score — 2x size (was 9, now 20) */}
                  <text
                    x={b.x} y={scoreY}
                    textAnchor="middle" dominantBaseline={anchor}
                    fontSize={20} fontWeight={900}
                    fontFamily="var(--font-mono), monospace"
                    fill={color} opacity={0.85}
                  >
                    {b.score}
                  </text>
                </g>
              )
            })}

            {/* Bars */}
            {allGames.map((game, i) => {
              const x = barsStartX + i * (barWidth + barGap)
              const p1H = game.p1Points * barScale
              const p2H = game.p2Points * barScale
              const hasPoints = game.p1Points > 0 || game.p2Points > 0
              return (
                <g
                  key={`bar-${i}`}
                  style={{ cursor: hasPoints && onGameClick ? 'pointer' : undefined }}
                  onClick={hasPoints && onGameClick ? () => onGameClick(game.setNumber, game.gameNumber) : undefined}
                >
                  {/* Invisible hit area for easier clicking */}
                  {hasPoints && onGameClick && (
                    <rect x={x - 1} y={pad.top} width={barWidth + 2} height={chartH} fill="transparent" />
                  )}
                  {game.p1Points > 0 && (
                    <rect
                      x={x} y={centerY - p1H} width={barWidth} height={p1H}
                      fill="url(#barP1g)"
                      opacity={game.isCurrent ? 0.5 : 0.6}
                      clipPath="url(#chunkyBarUp)"
                    />
                  )}
                  {game.p2Points > 0 && (
                    <rect
                      x={x} y={centerY} width={barWidth} height={p2H}
                      fill="url(#barP2g)"
                      opacity={game.isCurrent ? 0.5 : 0.6}
                      clipPath="url(#chunkyBarDown)"
                    />
                  )}
                </g>
              )
            })}

            {/* Red live marker line + right-side Set/Game indicator */}
            {isLive && hasCurrentGame && (
              <g>
                <line
                  x1={markerX} y1={pad.top - 2}
                  x2={markerX} y2={svgH - pad.bottom + 2}
                  stroke={LIVE_RED} strokeWidth={2}
                  opacity={0.8}
                >
                  <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />
                </line>
                {/* Label right next to the marker line: "Set X" / "Game Y" */}
                {markerGame && (
                  <g>
                    <polygon
                      points={`${markerX + 4},${centerY - 24} ${markerX + 75},${centerY - 25} ${markerX + 74},${centerY + 23} ${markerX + 3},${centerY + 24}`}
                      fill={LIVE_RED} opacity={0.15}
                    />
                    <text
                      x={markerX + 40} y={centerY - 6}
                      textAnchor="middle" dominantBaseline="auto"
                      fontSize={13} fontWeight={800}
                      fontFamily="var(--font-mono), monospace" fill={LIVE_RED}
                    >
                      {`Set ${markerGame.setNumber}`}
                      <animate attributeName="opacity" values="1;0.6;1" dur="1.5s" repeatCount="indefinite" />
                    </text>
                    <text
                      x={markerX + 40} y={centerY + 14}
                      textAnchor="middle" dominantBaseline="auto"
                      fontSize={13} fontWeight={800}
                      fontFamily="var(--font-mono), monospace" fill={LIVE_RED}
                    >
                      {`Game ${markerGame.gameNumber}`}
                      <animate attributeName="opacity" values="1;0.6;1" dur="1.5s" repeatCount="indefinite" />
                    </text>
                  </g>
                )}
              </g>
            )}
          </svg>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, padding: '6px 0 2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 10, height: 6, background: P1_COLOR, clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)', opacity: 0.6 }} />
          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{p1Names.join(' / ')}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 10, height: 6, background: P2_COLOR, clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)', opacity: 0.6 }} />
          <span style={{ fontSize: 8, color: 'var(--text-dim)' }}>{p2Names.join(' / ')}</span>
        </div>
      </div>
    </div>
  )
}

// ── Compact Momentum (for sticky banner) ────────────────────────────────────

interface CompactMomentumProps {
  sets: MatchSet[]
  isLive: boolean
}

export function CompactMomentum({ sets, isLive }: CompactMomentumProps) {
  const sortedSets = useMemo(() => [...sets].sort((a, b) => a.set_number - b.set_number), [sets])
  const allGames = useMemo(() => buildGameSummaries(sortedSets), [sortedSets])

  const hasData = allGames.some(g => g.p1Points > 0 || g.p2Points > 0)
  if (!hasData) return null

  const hasCurrentGame = allGames.some(g => g.isCurrent)
  const currentGameIdx = allGames.findIndex(g => g.isCurrent)

  const svgW = 600
  const svgH = 40
  const centerY = svgH / 2
  const pad = { left: 2, right: 2, top: 2, bottom: 2 }
  const chartW = svgW - pad.left - pad.right
  const chartH = svgH - pad.top - pad.bottom
  const maxGames = 39
  const barGap = 2
  const barWidth = Math.max(4, (chartW - barGap * (maxGames - 1)) / maxGames)
  const totalGames = allGames.length
  const barsStartX = pad.left

  const maxPts = Math.max(5, ...allGames.map(g => Math.max(g.p1Points, g.p2Points)))
  const barScale = (chartH / 2 - 2) / maxPts

  const currentHasPoints = currentGameIdx >= 0 && (allGames[currentGameIdx].p1Points > 0 || allGames[currentGameIdx].p2Points > 0)
  const markerIdx = currentGameIdx >= 0
    ? (currentHasPoints ? currentGameIdx : Math.max(0, currentGameIdx - 1))
    : allGames.length - 1
  const markerX = barsStartX + markerIdx * (barWidth + barGap) + barWidth + 1

  return (
    <div style={{ padding: '0 14px 4px', height: 28 }}>
      <svg viewBox={`0 0 ${svgW} ${svgH}`} style={{ width: '100%', height: '100%' }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="barP1gc" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={P1_COLOR} stopOpacity={0.8} />
            <stop offset="100%" stopColor={P1_COLOR} stopOpacity={0.2} />
          </linearGradient>
          <linearGradient id="barP2gc" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor={P2_COLOR} stopOpacity={0.8} />
            <stop offset="100%" stopColor={P2_COLOR} stopOpacity={0.2} />
          </linearGradient>
          <clipPath id="chunkyBarUpC" clipPathUnits="objectBoundingBox">
            <polygon points="0.03,0.05 0.97,0 1,0.95 0,1" />
          </clipPath>
          <clipPath id="chunkyBarDownC" clipPathUnits="objectBoundingBox">
            <polygon points="0,0.05 1,0 0.97,0.95 0.03,1" />
          </clipPath>
        </defs>

        {/* Center line */}
        <line x1={pad.left} y1={centerY} x2={svgW - pad.right} y2={centerY} stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />

        {/* Bars */}
        {allGames.map((game, i) => {
          const x = barsStartX + i * (barWidth + barGap)
          const p1H = game.p1Points * barScale
          const p2H = game.p2Points * barScale
          return (
            <g key={`cb-${i}`}>
              {game.p1Points > 0 && (
                <rect x={x} y={centerY - p1H} width={barWidth} height={p1H} fill="url(#barP1gc)" opacity={0.6} clipPath="url(#chunkyBarUpC)" />
              )}
              {game.p2Points > 0 && (
                <rect x={x} y={centerY} width={barWidth} height={p2H} fill="url(#barP2gc)" opacity={0.6} clipPath="url(#chunkyBarDownC)" />
              )}
            </g>
          )
        })}

        {/* Red marker */}
        {isLive && hasCurrentGame && (
          <line x1={markerX} y1={0} x2={markerX} y2={svgH} stroke={LIVE_RED} strokeWidth={1.5} opacity={0.8}>
            <animate attributeName="opacity" values="0.9;0.4;0.9" dur="1.5s" repeatCount="indefinite" />
          </line>
        )}
      </svg>
    </div>
  )
}
