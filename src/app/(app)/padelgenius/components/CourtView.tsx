'use client'

import React, { useCallback, useRef } from 'react'
import ChibiPlayer, { type PlayerRole } from './ChibiPlayer'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface CourtPlayer {
  role: PlayerRole
  x: number   // normalized 0-100 (0=left wall, 100=right wall)
  y: number   // normalized 0-100 (0=far back wall, 100=near back wall)
}

export interface CourtData {
  players: CourtPlayer[]
  ball?: { x: number; y: number }
  trajectory?: { from: [number, number]; to: [number, number] }
  highlights?: {
    type: 'zone' | 'arrow' | 'label'
    coords: number[]
    label?: string
    color?: string
  }[]
}

export interface CourtOverlay {
  trajectory?: { from: [number, number]; to: [number, number] }
  wrongTrajectory?: { from: [number, number]; to: [number, number]; label?: string }
  label?: string
}

export interface CourtViewProps {
  court: CourtData
  avatarColor?: string
  overlay?: CourtOverlay
  tapMode?: boolean
  onTap?: (x: number, y: number) => void
  tapPoint?: { x: number; y: number } | null
  correctZone?: { x: number; y: number; radius: number } | null
}

/* ------------------------------------------------------------------ */
/*  Constants — SVG canvas                                             */
/* ------------------------------------------------------------------ */

const W = 400
const H = 600

// Court corners in SVG space (perspective trapezoid)
const COURT_FAR_LEFT = 70
const COURT_FAR_RIGHT = 330
const COURT_NEAR_LEFT = 10
const COURT_NEAR_RIGHT = 390
const COURT_TOP = 170   // far baseline y
const COURT_BOT = 560   // near baseline y

/* ------------------------------------------------------------------ */
/*  Projection helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Convert normalized (0-100) court coordinates to SVG pixel coords
 * with perspective projection (far side narrow, near side wide).
 */
function toSvg(nx: number, ny: number): [number, number] {
  const t = ny / 100  // 0 = far, 1 = near
  const leftEdge = COURT_FAR_LEFT + (COURT_NEAR_LEFT - COURT_FAR_LEFT) * t
  const rightEdge = COURT_FAR_RIGHT + (COURT_NEAR_RIGHT - COURT_FAR_RIGHT) * t
  const svgX = leftEdge + (nx / 100) * (rightEdge - leftEdge)
  const svgY = COURT_TOP + t * (COURT_BOT - COURT_TOP)
  return [svgX, svgY]
}

/**
 * Reverse projection: SVG pixel coords -> normalized (0-100) court coords.
 * Used for tap-mode click handling.
 */
function fromSvg(svgX: number, svgY: number): [number, number] {
  const t = (svgY - COURT_TOP) / (COURT_BOT - COURT_TOP)
  if (t < 0 || t > 1) return [-1, -1] // outside court vertically
  const leftEdge = COURT_FAR_LEFT + (COURT_NEAR_LEFT - COURT_FAR_LEFT) * t
  const rightEdge = COURT_FAR_RIGHT + (COURT_NEAR_RIGHT - COURT_FAR_RIGHT) * t
  const nx = ((svgX - leftEdge) / (rightEdge - leftEdge)) * 100
  const ny = t * 100
  return [nx, ny]
}

/** Scale factor based on depth: far = small, near = big */
function playerScale(ny: number): number {
  return 0.5 + (ny / 100) * 0.7  // 0.5 at far wall, 1.2 at near wall
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function CourtDefs() {
  return (
    <defs>
      <linearGradient id="crt-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2a4a3a" />
        <stop offset="40%" stopColor="#1e3a2c" />
        <stop offset="100%" stopColor="#142820" />
      </linearGradient>
      <linearGradient id="crt-surf" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#1565a0" />
        <stop offset="50%" stopColor="#1976b8" />
        <stop offset="100%" stopColor="#1e88cc" />
      </linearGradient>
      <linearGradient id="crt-floor" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2d5a3d" />
        <stop offset="100%" stopColor="#1a4028" />
      </linearGradient>
      <linearGradient id="crt-glass" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="rgba(150,210,220,0.25)" />
        <stop offset="50%" stopColor="rgba(150,210,220,0.08)" />
        <stop offset="100%" stopColor="rgba(150,210,220,0.2)" />
      </linearGradient>
      <linearGradient id="crt-glassL" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stopColor="rgba(150,210,220,0.2)" />
        <stop offset="100%" stopColor="rgba(150,210,220,0.05)" />
      </linearGradient>
      <linearGradient id="crt-glassR" x1="1" y1="0" x2="0" y2="0">
        <stop offset="0%" stopColor="rgba(150,210,220,0.2)" />
        <stop offset="100%" stopColor="rgba(150,210,220,0.05)" />
      </linearGradient>
      <filter id="crt-shadow">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="rgba(0,0,0,0.4)" />
      </filter>
      <filter id="crt-ballGlow">
        <feGaussianBlur stdDeviation="6" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  )
}

function Background() {
  return (
    <>
      <rect width={W} height={H} fill="url(#crt-sky)" />
      {/* Venue stands */}
      <rect x={0} y={60} width={W} height={100} fill="#1a3028" rx={4} />
      <rect x={20} y={65} width={80} height={90} fill="#223830" rx={3} />
      <rect x={110} y={65} width={180} height={90} fill="#223830" rx={3} />
      <rect x={300} y={65} width={80} height={90} fill="#223830" rx={3} />
      {/* Venue lights */}
      <circle cx={60} cy={50} r={6} fill="#FFE" opacity={0.3} />
      <circle cx={200} cy={40} r={8} fill="#FFE" opacity={0.4} />
      <circle cx={340} cy={50} r={6} fill="#FFE" opacity={0.3} />
    </>
  )
}

/** Sponsor zone slots — render nothing by default, just structural positions */
function SponsorSlots() {
  return (
    <>
      {/* SLOT: Back wall banner — <rect x={100} y={148} …> */}
      {/* SLOT: Net band — rendered inside Net component */}
      {/* SLOT: Left side glass wall */}
      {/* SLOT: Right side glass wall */}
      {/* SLOT: Court floor logo */}
    </>
  )
}

function BackWall() {
  return (
    <>
      {/* Back glass wall (far side) */}
      <polygon
        points="70,170 330,170 330,148 70,148"
        fill="url(#crt-glass)"
        stroke="rgba(255,255,255,0.2)"
        strokeWidth={1}
      />
      {/* Frame posts */}
      <rect x={70} y={145} width={4} height={28} fill="#888" rx={1} />
      <rect x={148} y={145} width={3} height={28} fill="#777" rx={1} />
      <rect x={248} y={145} width={3} height={28} fill="#777" rx={1} />
      <rect x={326} y={145} width={4} height={28} fill="#888" rx={1} />
    </>
  )
}

function CourtSurface() {
  return (
    <>
      {/* Floor area */}
      <polygon points={`0,160 ${W},160 ${W},${H} 0,${H}`} fill="url(#crt-floor)" />

      {/* Court surface (perspective trapezoid) */}
      <polygon
        points={`${COURT_FAR_LEFT},${COURT_TOP} ${COURT_FAR_RIGHT},${COURT_TOP} ${COURT_NEAR_RIGHT},${COURT_BOT} ${COURT_NEAR_LEFT},${COURT_BOT}`}
        fill="url(#crt-surf)"
      />
      {/* Court border */}
      <polygon
        points={`${COURT_FAR_LEFT},${COURT_TOP} ${COURT_FAR_RIGHT},${COURT_TOP} ${COURT_NEAR_RIGHT},${COURT_BOT} ${COURT_NEAR_LEFT},${COURT_BOT}`}
        fill="none"
        stroke="rgba(255,255,255,0.5)"
        strokeWidth={2}
      />

      {/* Center line (full court) */}
      <line x1={200} y1={COURT_TOP} x2={200} y2={COURT_BOT} stroke="rgba(255,255,255,0.2)" strokeWidth={1.5} />

      {/* Service line far (~28% depth) */}
      {(() => {
        const [lx, ly] = toSvg(0, 28)
        const [rx] = toSvg(100, 28)
        return <line x1={lx} y1={ly} x2={rx} y2={ly} stroke="rgba(255,255,255,0.6)" strokeWidth={2} />
      })()}
      {/* Service center line far */}
      <line x1={200} y1={COURT_TOP} x2={200} y2={toSvg(50, 28)[1]} stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />

      {/* Service line near (~72% depth) */}
      {(() => {
        const [lx, ly] = toSvg(0, 72)
        const [rx] = toSvg(100, 72)
        return <line x1={lx} y1={ly} x2={rx} y2={ly} stroke="rgba(255,255,255,0.6)" strokeWidth={2} />
      })()}
      {/* Service center line near */}
      <line x1={200} y1={toSvg(50, 72)[1]} x2={200} y2={COURT_BOT} stroke="rgba(255,255,255,0.4)" strokeWidth={1.5} />
    </>
  )
}

function Net() {
  // Net sits at ~48% depth
  const [leftX, netY] = toSvg(0, 48)
  const [rightX] = toSvg(100, 48)
  const postW = 5
  const barH = 4

  return (
    <>
      {/* Net bar */}
      <rect x={leftX - 2} y={netY - 2} width={rightX - leftX + 4} height={barH} fill="#ccc" rx={1} />
      {/* Net posts */}
      <rect x={leftX - 3} y={netY - 12} width={postW} height={18} fill="#999" rx={1} />
      <rect x={rightX - 2} y={netY - 12} width={postW} height={18} fill="#999" rx={1} />
      {/* Net mesh lines */}
      <line x1={leftX} y1={netY} x2={rightX} y2={netY} stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
      <line x1={leftX} y1={netY - 4} x2={rightX} y2={netY - 4} stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
      {/* Net shadow */}
      <rect x={leftX - 2} y={netY + 2} width={rightX - leftX + 4} height={6} fill="rgba(0,0,0,0.1)" rx={1} />
      {/* SLOT: Net band sponsor */}
    </>
  )
}

function SideGlassWalls() {
  return (
    <>
      {/* Left glass wall */}
      <polygon
        points={`${COURT_FAR_LEFT},${COURT_TOP} ${COURT_NEAR_LEFT},${COURT_BOT} ${COURT_NEAR_LEFT},${COURT_BOT - 50} ${COURT_FAR_LEFT},${COURT_TOP - 22}`}
        fill="url(#crt-glassL)"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={1}
      />
      {/* Left glass frame posts */}
      <line x1={COURT_FAR_LEFT} y1={COURT_TOP - 22} x2={COURT_NEAR_LEFT} y2={COURT_BOT - 50} stroke="#777" strokeWidth={2} />
      {/* Left wall solid tint (brown) */}
      <polygon
        points={`${COURT_NEAR_LEFT},${COURT_BOT - 50} ${COURT_NEAR_LEFT},${COURT_BOT} ${COURT_FAR_LEFT},${COURT_TOP} ${COURT_FAR_LEFT},${COURT_TOP - 22}`}
        fill="rgba(100,80,50,0.15)"
      />

      {/* Right glass wall */}
      <polygon
        points={`${COURT_FAR_RIGHT},${COURT_TOP} ${COURT_NEAR_RIGHT},${COURT_BOT} ${COURT_NEAR_RIGHT},${COURT_BOT - 50} ${COURT_FAR_RIGHT},${COURT_TOP - 22}`}
        fill="url(#crt-glassR)"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth={1}
      />
      {/* Right glass frame posts */}
      <line x1={COURT_FAR_RIGHT} y1={COURT_TOP - 22} x2={COURT_NEAR_RIGHT} y2={COURT_BOT - 50} stroke="#777" strokeWidth={2} />
      {/* Right wall solid tint */}
      <polygon
        points={`${COURT_NEAR_RIGHT},${COURT_BOT - 50} ${COURT_NEAR_RIGHT},${COURT_BOT} ${COURT_FAR_RIGHT},${COURT_TOP} ${COURT_FAR_RIGHT},${COURT_TOP - 22}`}
        fill="rgba(100,80,50,0.15)"
      />
    </>
  )
}

function Ball({ x, y, trajectory }: {
  x: number
  y: number
  trajectory?: { from: [number, number]; to: [number, number] }
}) {
  const [bx, by] = toSvg(x, y)
  const ballR = 4 + playerScale(y) * 4  // scales with depth

  // Animated trajectory line from origin to ball
  let trajLine: { x1: number; y1: number; x2: number; y2: number } | null = null
  if (trajectory) {
    const [fx, fy] = toSvg(trajectory.from[0], trajectory.from[1])
    trajLine = { x1: fx, y1: fy, x2: bx, y2: by }
  }

  return (
    <g>
      {/* Animated trajectory line — dashed, flowing toward ball */}
      {trajLine && (
        <>
          {/* Glow behind the line */}
          <line
            x1={trajLine.x1} y1={trajLine.y1}
            x2={trajLine.x2} y2={trajLine.y2}
            stroke="#FFDD00" strokeWidth={4} opacity={0.08}
            filter="url(#crt-ballGlow)"
          />
          {/* Main dashed line with flowing animation */}
          <line
            x1={trajLine.x1} y1={trajLine.y1}
            x2={trajLine.x2} y2={trajLine.y2}
            stroke="#FFDD00" strokeWidth={2} strokeDasharray="8 6"
            opacity={0.4}
          >
            <animate attributeName="stroke-dashoffset" from="28" to="0" dur="1s" repeatCount="indefinite" />
          </line>
          {/* Origin dot (where the ball came from) */}
          <circle cx={trajLine.x1} cy={trajLine.y1} r={3} fill="#FFDD00" opacity={0.25} />
        </>
      )}

      {/* Ball shadow on court — pulses */}
      <ellipse cx={bx + 3} cy={by + ballR * 4} rx={ballR * 1.5} ry={ballR * 0.5} fill="rgba(0,0,0,0.2)">
        <animate attributeName="ry" values={`${ballR * 0.4};${ballR * 0.6};${ballR * 0.4}`} dur="2s" repeatCount="indefinite" />
      </ellipse>
      {/* Ball glow — pulsing */}
      <circle cx={bx} cy={by} r={ballR * 2.5} fill="rgba(204,255,0,0.08)" filter="url(#crt-ballGlow)">
        <animate attributeName="r" values={`${ballR * 2};${ballR * 3.5};${ballR * 2}`} dur="1.5s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.06;0.14;0.06" dur="1.5s" repeatCount="indefinite" />
      </circle>
      {/* The ball — gentle float */}
      <circle cx={bx} cy={by} r={ballR} fill="#CCFF00" stroke="#88aa00" strokeWidth={1.5}>
        <animate attributeName="cy" values={`${by};${by - 3};${by}`} dur="2s" repeatCount="indefinite" />
      </circle>
      {/* Highlight */}
      <circle cx={bx - ballR * 0.25} cy={by - ballR * 0.2} r={ballR * 0.3} fill="rgba(255,255,255,0.4)">
        <animate attributeName="cy" values={`${by - ballR * 0.2};${by - ballR * 0.2 - 3};${by - ballR * 0.2}`} dur="2s" repeatCount="indefinite" />
      </circle>
      {/* Seam */}
      <path
        d={`M${bx - ballR * 0.6},${by - ballR * 0.3} Q${bx},${by - ballR * 0.8} ${bx + ballR * 0.6},${by - ballR * 0.3}`}
        stroke="#88aa00"
        strokeWidth={0.8}
        fill="none"
        opacity={0.5}
      />
    </g>
  )
}

function OverlayTrajectory({ from, to, color, dashed }: {
  from: [number, number]
  to: [number, number]
  color: string
  dashed?: boolean
}) {
  const [x1, y1] = toSvg(from[0], from[1])
  const [x2, y2] = toSvg(to[0], to[1])
  // Arrowhead
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const aLen = 10
  const ax1 = x2 - aLen * Math.cos(angle - 0.4)
  const ay1 = y2 - aLen * Math.sin(angle - 0.4)
  const ax2 = x2 - aLen * Math.cos(angle + 0.4)
  const ay2 = y2 - aLen * Math.sin(angle + 0.4)

  return (
    <g>
      <line
        x1={x1} y1={y1} x2={x2} y2={y2}
        stroke={color}
        strokeWidth={2.5}
        strokeDasharray={dashed ? '8 4' : undefined}
        opacity={0.8}
      />
      <polygon points={`${x2},${y2} ${ax1},${ay1} ${ax2},${ay2}`} fill={color} opacity={0.8} />
    </g>
  )
}

function TapMarker({ x, y, isCorrect }: { x: number; y: number; isCorrect?: boolean }) {
  const [sx, sy] = toSvg(x, y)
  const color = isCorrect === true ? '#7ED321' : isCorrect === false ? '#FF4655' : '#38C8FF'
  return (
    <g>
      {/* Expanding ripple */}
      <circle cx={sx} cy={sy} r={14} fill="none" stroke={color} strokeWidth={2} opacity={0.6}>
        <animate attributeName="r" from="6" to="22" dur="1s" repeatCount="indefinite" />
        <animate attributeName="opacity" from="0.7" to="0" dur="1s" repeatCount="indefinite" />
      </circle>
      <circle cx={sx} cy={sy} r={6} fill={color} stroke="#fff" strokeWidth={2} opacity={0.9} />
    </g>
  )
}

function CorrectZoneMarker({ x, y, radius }: { x: number; y: number; radius: number }) {
  const [sx, sy] = toSvg(x, y)
  // Scale radius with perspective at that depth
  const scale = playerScale(y)
  const r = radius * scale * 3
  return (
    <g>
      <circle cx={sx} cy={sy} r={r} fill="rgba(126,211,33,0.12)" stroke="#7ED321" strokeWidth={2} strokeDasharray="6 3">
        <animate attributeName="opacity" values="0.4;0.8;0.4" dur="2s" repeatCount="indefinite" />
      </circle>
      <circle cx={sx} cy={sy} r={4} fill="#7ED321" opacity={0.7} />
    </g>
  )
}

function HighlightZone({ coords, color, label }: {
  coords: number[]
  color: string
  label?: string
}) {
  const [cx, cy] = toSvg(coords[0], coords[1])
  const r = (coords[2] ?? 10) * playerScale(coords[1]) * 2
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill={color} opacity={0.15} stroke={color} strokeWidth={1.5} strokeDasharray="4 2" />
      {label && (
        <text x={cx} y={cy - r - 6} textAnchor="middle" fill={color} fontSize={10} fontWeight={700}>
          {label}
        </text>
      )}
    </g>
  )
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default function CourtView({
  court,
  avatarColor,
  overlay,
  tapMode,
  onTap,
  tapPoint,
  correctZone,
}: CourtViewProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  const handleClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!tapMode || !onTap || !svgRef.current) return
      const rect = svgRef.current.getBoundingClientRect()
      const scaleX = W / rect.width
      const scaleY = H / rect.height
      const svgX = (e.clientX - rect.left) * scaleX
      const svgY = (e.clientY - rect.top) * scaleY
      const [nx, ny] = fromSvg(svgX, svgY)
      if (nx >= 0 && nx <= 100 && ny >= 0 && ny <= 100) {
        onTap(Math.round(nx), Math.round(ny))
      }
    },
    [tapMode, onTap],
  )

  // Sort players by y (depth) so farther players render first (painter's algorithm)
  const sortedPlayers = [...court.players].sort((a, b) => a.y - b.y)

  // Determine if tap point is "correct" (within correctZone)
  let tapIsCorrect: boolean | undefined
  if (tapPoint && correctZone) {
    const dx = tapPoint.x - correctZone.x
    const dy = tapPoint.y - correctZone.y
    tapIsCorrect = Math.sqrt(dx * dx + dy * dy) <= correctZone.radius
  }

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: '100%', maxHeight: '100%', display: 'block', cursor: tapMode ? 'crosshair' : 'default' }}
      onClick={handleClick}
    >
      <CourtDefs />
      <Background />
      <BackWall />
      <CourtSurface />
      <SponsorSlots />
      <SideGlassWalls />
      <Net />

      {/* Highlights (zones, arrows, labels) under players */}
      {court.highlights?.map((h, i) => {
        if (h.type === 'zone') {
          return <HighlightZone key={i} coords={h.coords} color={h.color ?? '#38C8FF'} label={h.label} />
        }
        if (h.type === 'arrow' && h.coords.length >= 4) {
          return (
            <OverlayTrajectory
              key={i}
              from={[h.coords[0], h.coords[1]]}
              to={[h.coords[2], h.coords[3]]}
              color={h.color ?? '#38C8FF'}
              dashed
            />
          )
        }
        if (h.type === 'label' && h.label) {
          const [lx, ly] = toSvg(h.coords[0], h.coords[1])
          return (
            <text key={i} x={lx} y={ly} textAnchor="middle" fill={h.color ?? '#EEE4CE'} fontSize={11} fontWeight={700}>
              {h.label}
            </text>
          )
        }
        return null
      })}

      {/* Ball (rendered before near-side players for depth) */}
      {court.ball && (
        <Ball x={court.ball.x} y={court.ball.y} trajectory={court.trajectory} />
      )}

      {/* Players — depth-sorted */}
      {sortedPlayers.map((p) => {
        const [px, py] = toSvg(p.x, p.y)
        const scale = playerScale(p.y)
        return (
          <g key={p.role}>
            {/* Pulsing glow ring under "YOU" */}
            {p.role === 'you' && (
              <>
                <circle cx={px} cy={py + 10 * scale} r={22 * scale} fill="none"
                  stroke="rgba(56,200,255,0.2)" strokeWidth={2}>
                  <animate attributeName="r" values={`${18 * scale};${28 * scale};${18 * scale}`} dur="2.5s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.25;0.08;0.25" dur="2.5s" repeatCount="indefinite" />
                </circle>
                <ellipse cx={px} cy={py + 14 * scale} rx={20 * scale} ry={6 * scale}
                  fill="rgba(56,200,255,0.08)">
                  <animate attributeName="rx" values={`${18 * scale};${24 * scale};${18 * scale}`} dur="2.5s" repeatCount="indefinite" />
                </ellipse>
              </>
            )}
            <ChibiPlayer
              role={p.role}
              x={px}
              y={py}
              scale={scale}
              jerseyColor={p.role === 'you' ? avatarColor : undefined}
            />
          </g>
        )
      })}

      {/* Overlay trajectories (explanation view) */}
      {overlay?.trajectory && (
        <OverlayTrajectory
          from={overlay.trajectory.from}
          to={overlay.trajectory.to}
          color="#7ED321"
        />
      )}
      {overlay?.wrongTrajectory && (
        <>
          <OverlayTrajectory
            from={overlay.wrongTrajectory.from}
            to={overlay.wrongTrajectory.to}
            color="#FF4655"
            dashed
          />
          {overlay.wrongTrajectory.label && (() => {
            const [wx, wy] = toSvg(
              overlay.wrongTrajectory.to[0],
              overlay.wrongTrajectory.to[1],
            )
            return (
              <text x={wx} y={wy - 12} textAnchor="middle" fill="#FF4655" fontSize={10} fontWeight={700}>
                {overlay.wrongTrajectory.label}
              </text>
            )
          })()}
        </>
      )}
      {overlay?.label && (
        <text x={W / 2} y={COURT_TOP - 30} textAnchor="middle" fill="#EEE4CE" fontSize={13} fontWeight={700}>
          {overlay.label}
        </text>
      )}

      {/* Tap mode markers */}
      {correctZone && (
        <CorrectZoneMarker x={correctZone.x} y={correctZone.y} radius={correctZone.radius} />
      )}
      {tapPoint && (
        <TapMarker x={tapPoint.x} y={tapPoint.y} isCorrect={tapIsCorrect} />
      )}
    </svg>
  )
}
