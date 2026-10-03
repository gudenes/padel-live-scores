// src/app/[locale]/(app)/padelgenius/components/TrajectoryRenderer.tsx
'use client'
import { useEffect, useRef, useState } from 'react'
import { trajectoryPath, TRAJECTORY_DECOR } from '@/lib/padelgenius/trajectories'
import type { TrajectoryStyle, TrajectoryStyleOverride } from '@/lib/padelgenius/types'

export interface TrajectoryRendererProps {
  style: TrajectoryStyle
  from: [number, number]   // SVG pixel coords
  to:   [number, number]
  state: 'preview' | 'correct' | 'wrong'
  /** When true, animate the line drawing via stroke-dashoffset */
  animate?: boolean
  pathId?: string          // for ball animateMotion to reference
  /**
   * Optional uploaded asset URL for this style. When set, the asset is
   * rendered as a translucent-rotated overlay between from and to, replacing
   * the procedural dashed line.
   */
  assetUrl?: string
  /** Multiplier for asset width relative to chord length (default 1.0). */
  assetScale?: number
  /**
   * Optional Bezier control point in SVG pixel coords. When set, the curve
   * bends through this apex instead of using the style's preset shape.
   */
  controlPoint?: [number, number]
  /**
   * Optional visual override for the procedural line — color, thickness,
   * dash pattern, decoration intensity. Only applies when no `assetUrl` is set.
   */
  override?: TrajectoryStyleOverride
}

const STATE_COLORS: Record<TrajectoryRendererProps['state'], string> = {
  preview: '#1e88e5',
  correct: '#22c55e',
  wrong:   '#ef4444',
}

export function TrajectoryRenderer({ style, from, to, state, animate, pathId, assetUrl, assetScale = 1, controlPoint, override }: TrajectoryRendererProps) {
  const d = trajectoryPath(style, from, to, controlPoint)
  const decor = TRAJECTORY_DECOR[style]
  // Override wins for color, otherwise the style+state combo decides.
  const stateColor = decor.isWinner && state !== 'wrong' ? '#ef4444' : STATE_COLORS[state]
  const color = override?.color ?? stateColor
  // Stroke width override
  const strokeWidth = override?.strokeWidth ?? decor.strokeWidth
  // Dash pattern — explicit true/false wins, otherwise fall back to style + state defaults
  const dashedFinal = override?.dashed ?? decor.dashed
  const dasharray = dashedFinal ? '6 4' : state === 'preview' ? '6 5' : undefined
  // Hide every decoration in one switch
  const showDecorations = override?.showDecorations ?? true

  // Tangent at the END of the path — used to orient the arrowhead. We measure
  // it from the rendered SVG so it works correctly for any shape (Bezier,
  // zigzag, straight), including the user's APEX override.
  const measureRef = useRef<SVGPathElement>(null)
  const [tipAngle, setTipAngle] = useState<number | null>(null)
  useEffect(() => {
    const el = measureRef.current
    if (!el || typeof el.getTotalLength !== 'function') return
    const total = el.getTotalLength()
    if (!Number.isFinite(total) || total < 2) return
    const p1 = el.getPointAtLength(Math.max(0, total - 1))
    const p2 = el.getPointAtLength(total)
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI
    setTipAngle(angle)
  }, [d])

  // Arrow size — doubled. Base sits AT the line's endpoint, tip projects past
  // it so the arrow lives at the very end (not overlapping the trajectory).
  const arrowSize = Math.max(10, strokeWidth * 2)
  const arrowAngle = tipAngle ?? Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI
  // Arrow geometry: base on the y-axis at x=0, tip at x=+arrowSize.
  const arrowD = `M 0 ${-arrowSize * 0.7} L ${arrowSize} 0 L 0 ${arrowSize * 0.7} Z`
  const arrowhead = (
    <g transform={`translate(${to[0]} ${to[1]}) rotate(${arrowAngle})`}>
      {/* Hard drop-shadow — proportional offset */}
      <path
        d={arrowD}
        fill="rgba(10,10,20,0.55)"
        transform="translate(1.8, 2.8)"
      />
      {/* Navy stroked + colored fill — single path for crisp cartoon edge */}
      <path
        d={arrowD}
        fill={color}
        stroke="#1A1A2E"
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </g>
  )

  // Measurement path — invisible, fixed across both render branches. Lets
  // useEffect compute the tangent regardless of whether the visible render is
  // the procedural stroke or a custom asset.
  const measurePath = (
    <path
      ref={measureRef}
      d={d}
      stroke="none"
      fill="none"
      style={{ pointerEvents: 'none' }}
    />
  )

  // If a custom asset is uploaded for this style, render that instead of the
  // procedural line. We still emit the invisible path so ball animateMotion has
  // something to follow.
  if (assetUrl) {
    const [fx, fy] = from
    const [tx, ty] = to
    const chord = Math.hypot(tx - fx, ty - fy)
    const angleDeg = Math.atan2(ty - fy, tx - fx) * 180 / Math.PI
    const mx = (fx + tx) / 2
    const my = (fy + ty) / 2
    const imgW = chord * assetScale
    const imgH = chord * 0.5 * assetScale // 1:2 aspect band; meet preserves intrinsic ratio
    return (
      <g>
        {/* Invisible path purely for ball animateMotion to follow + tangent measurement */}
        <path id={pathId} d={d} stroke="none" fill="none" />
        {measurePath}
        {/* Rotated custom asset centred on the chord midpoint */}
        <g transform={`translate(${mx} ${my}) rotate(${angleDeg})`}>
          <image
            href={assetUrl}
            x={-imgW / 2}
            y={-imgH / 2}
            width={imgW}
            height={imgH}
            preserveAspectRatio="xMidYMid meet"
            style={animate ? { animation: 'pg-traj-draw 500ms ease-out forwards', opacity: 1 } : undefined}
          />
        </g>
        {/* Directional arrowhead at the landing */}
        {arrowhead}
      </g>
    )
  }

  return (
    <g>
      {/* Hard cartoon drop-shadow — solid (no dashes) for chunky feel */}
      <path
        d={d}
        stroke="rgba(10,10,20,0.55)"
        strokeWidth={strokeWidth + 3}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(1.6, 2.4)"
      />
      {/* Dark outline */}
      <path d={d} stroke="#1A1A2E" strokeWidth={strokeWidth + 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* Colored line — also serves as the measurement path for the arrowhead tangent */}
      <path
        id={pathId}
        ref={measureRef}
        d={d}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={animate ? '1000' : dasharray}
        strokeDashoffset={animate ? '1000' : undefined}
        style={animate ? {
          animation: 'pg-traj-draw 500ms ease-out forwards',
        } : undefined}
      />
      {/* Spin markers mid-flight — hidden by showDecorations=false */}
      {showDecorations && decor.spinMarkers >= 1 && (() => {
        const [mx, my] = midpoint(from, to)
        return <circle cx={mx} cy={my} r={6} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="3 2" />
      })()}
      {showDecorations && decor.spinMarkers >= 2 && (() => {
        const [mx, my] = midpoint(from, to, 0.7)
        return <circle cx={mx} cy={my} r={5} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="3 2" />
      })()}
      {/* Bolt at strike point */}
      {showDecorations && decor.bolt && <BoltGlyph x={from[0]} y={from[1]} />}
      {/* Star at contact point */}
      {showDecorations && decor.star && <StarGlyph x={from[0]} y={from[1]} />}
      {/* Impact rays at landing */}
      {showDecorations && decor.rays && <ImpactRays x={to[0]} y={to[1]} color="#fde047" />}
      {/* Directional arrowhead at the landing — points where the ball is going */}
      {arrowhead}
    </g>
  )
}

// Inline SVG bolt — replaces the emoji literal that was here previously.
function BoltGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 14} ${y - 12})`}>
      <path d="M 6 0 L 0 8 L 4 8 L 2 16 L 8 7 L 4 7 Z" fill="#fde047" stroke="#1A1A2E" strokeWidth={0.8} strokeLinejoin="round" />
    </g>
  )
}

// Inline SVG five-pointed star — replaces the emoji literal that was here previously.
function StarGlyph({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 6} ${y - 8})`}>
      <path
        d="M 0 -7 L 2 -2.2 L 7.4 -1.7 L 3.3 1.7 L 4.5 6.9 L 0 4 L -4.5 6.9 L -3.3 1.7 L -7.4 -1.7 L -2 -2.2 Z"
        fill="#fde047" stroke="#1A1A2E" strokeWidth={0.8} strokeLinejoin="round" />
    </g>
  )
}

function midpoint(from: [number, number], to: [number, number], t = 0.5): [number, number] {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]
}

function ImpactRays({ x, y, color }: { x: number; y: number; color: string }) {
  return (
    <g transform={`translate(${x} ${y})`} stroke={color} strokeWidth={2.5} strokeLinecap="round">
      <line x1="0" y1="0" x2="-10" y2="14" />
      <line x1="0" y1="0" x2="10" y2="14" />
      <line x1="0" y1="0" x2="-14" y2="2" />
      <line x1="0" y1="0" x2="14" y2="2" />
      <line x1="0" y1="0" x2="-7" y2="-7" />
      <line x1="0" y1="0" x2="7" y2="-7" />
    </g>
  )
}
