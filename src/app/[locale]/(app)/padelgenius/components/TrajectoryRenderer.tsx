// src/app/[locale]/(app)/padelgenius/components/TrajectoryRenderer.tsx
'use client'
import { trajectoryPath, TRAJECTORY_DECOR } from '@/lib/padelgenius/trajectories'
import type { TrajectoryStyle } from '@/lib/padelgenius/types'

export interface TrajectoryRendererProps {
  style: TrajectoryStyle
  from: [number, number]   // SVG pixel coords
  to:   [number, number]
  state: 'preview' | 'correct' | 'wrong'
  /** When true, animate the line drawing via stroke-dashoffset */
  animate?: boolean
  pathId?: string          // for ball animateMotion to reference
}

const STATE_COLORS: Record<TrajectoryRendererProps['state'], string> = {
  preview: '#1e88e5',
  correct: '#22c55e',
  wrong:   '#ef4444',
}

export function TrajectoryRenderer({ style, from, to, state, animate, pathId }: TrajectoryRendererProps) {
  const d = trajectoryPath(style, from, to)
  const decor = TRAJECTORY_DECOR[style]
  const color = decor.isWinner && state !== 'wrong' ? '#ef4444' : STATE_COLORS[state]
  const dasharray = decor.dashed ? '6 4' : state === 'preview' ? '6 5' : undefined

  return (
    <g>
      {/* dark outline behind */}
      <path d={d} stroke="#1A1A2E" strokeWidth={decor.strokeWidth + 3} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* colored line */}
      <path
        id={pathId}
        d={d}
        stroke={color}
        strokeWidth={decor.strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={animate ? '1000' : dasharray}
        strokeDashoffset={animate ? '1000' : undefined}
        style={animate ? {
          animation: 'pg-traj-draw 500ms ease-out forwards',
        } : undefined}
      />
      {/* Spin markers mid-flight */}
      {decor.spinMarkers >= 1 && (() => {
        const [mx, my] = midpoint(from, to)
        return <circle cx={mx} cy={my} r={6} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="3 2" />
      })()}
      {decor.spinMarkers >= 2 && (() => {
        const [mx, my] = midpoint(from, to, 0.7)
        return <circle cx={mx} cy={my} r={5} fill="none" stroke={color} strokeWidth={1.8} strokeDasharray="3 2" />
      })()}
      {/* Bolt at strike point */}
      {decor.bolt && <text x={from[0] - 14} y={from[1] - 4} fill="#fde047" fontSize={16} fontWeight={900}>⚡</text>}
      {/* Star at contact point */}
      {decor.star && <text x={from[0] - 6} y={from[1] - 8} fill="#fde047" fontSize={16} fontWeight={900}>★</text>}
      {/* Impact rays at landing */}
      {decor.rays && <ImpactRays x={to[0]} y={to[1]} color="#fde047" />}
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
