// src/app/ops/padelgenius/editor/_components/CourtPreview.tsx
'use client'
import { useRef } from 'react'
import { W, H, toSvg } from '@/lib/padelgenius/projection'
import { trajectoryPath } from '@/lib/padelgenius/trajectories'
import type { Question, CourtConfig, PlayerRole, OptionId } from '@/lib/padelgenius/types'
import { DragHandle } from './DragHandle'

export interface CourtPreviewProps {
  court: CourtConfig
  question: Question
  selectedOptionId: OptionId | null
  onChange: (next: Question) => void
}

const PLAYER_COLORS: Record<PlayerRole, string> = {
  you: '#ef4444', partner: '#3b82f6', opponent1: '#f97316', opponent2: '#22c55e',
}

export function CourtPreview({ court, question, selectedOptionId, onChange }: CourtPreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const bounds = court.bounds
  const sel = question.options.find(o => o.id === selectedOptionId) ?? null

  const updatePlayer = (role: PlayerRole, x: number, y: number) => {
    onChange({
      ...question,
      court: { ...question.court, players: question.court.players.map(p => p.role === role ? { ...p, x, y } : p) },
    })
  }
  const updateLetter = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => o.id === id ? { ...o, letter: { x, y } } : o),
    })
  }
  const updateTrajectoryFrom = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => o.id === id
        ? { ...o, outcome: { ...o.outcome, trajectory: { ...o.outcome.trajectory, from: [x, y] } } }
        : o),
    })
  }
  const updateTrajectoryTo = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => o.id === id
        ? { ...o, outcome: { ...o.outcome, trajectory: { ...o.outcome.trajectory, to: [x, y] }, ball: { x, y } } }
        : o),
    })
  }
  const updateBall = (x: number, y: number) => {
    onChange({ ...question, court: { ...question.court, ball: { x, y } } })
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: 480, aspectRatio: '2/3', display: 'block', background: '#0a0a14', borderRadius: 8 }}>
      {/* Court image */}
      <image href={court.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />

      {/* Selected option's trajectory preview */}
      {sel && (() => {
        const from = toSvg(sel.outcome.trajectory.from[0], sel.outcome.trajectory.from[1], bounds)
        const to = toSvg(sel.outcome.trajectory.to[0], sel.outcome.trajectory.to[1], bounds)
        return (
          <g>
            <path d={trajectoryPath(sel.outcome.trajectory.style, from, to)}
                  stroke="#1a1a2e" strokeWidth={7} fill="none" strokeLinecap="round" strokeLinejoin="round" />
            <path d={trajectoryPath(sel.outcome.trajectory.style, from, to)}
                  stroke={sel.isCorrect ? '#22c55e' : '#1e88e5'} strokeWidth={4} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" strokeDasharray="6 5" />
          </g>
        )
      })()}

      {/* Player handles */}
      {question.court.players.map(p => (
        <DragHandle key={p.role}
          x={p.x} y={p.y} bounds={bounds} radius={7}
          fill={PLAYER_COLORS[p.role]} label={p.role[0].toUpperCase()}
          svgRef={svgRef}
          onChange={(x, y) => updatePlayer(p.role, x, y)} />
      ))}

      {/* Letter handles */}
      {question.options.map(opt => (
        <DragHandle key={`letter-${opt.id}`}
          x={opt.letter.x} y={opt.letter.y} bounds={bounds}
          radius={9}
          fill={opt.isCorrect ? '#22c55e' : '#fff'}
          label={opt.id.toUpperCase()}
          svgRef={svgRef}
          onChange={(x, y) => updateLetter(opt.id, x, y)} />
      ))}

      {/* Trajectory endpoint handles for the selected option only */}
      {sel && (
        <>
          {/* trajectory-from: blue circle, no label glyph */}
          <DragHandle x={sel.outcome.trajectory.from[0]} y={sel.outcome.trajectory.from[1]} bounds={bounds}
            radius={6} fill="#1e88e5" svgRef={svgRef}
            onChange={(x, y) => updateTrajectoryFrom(sel.id, x, y)} />
          {/* trajectory-to: yellow with stroke, no label glyph */}
          <DragHandle x={sel.outcome.trajectory.to[0]} y={sel.outcome.trajectory.to[1]} bounds={bounds}
            radius={6} fill="#fde047" stroke="#ca8a04" svgRef={svgRef}
            onChange={(x, y) => updateTrajectoryTo(sel.id, x, y)} />
        </>
      )}

      {/* Initial ball — yellow filled, no label glyph */}
      {question.court.ball && (
        <DragHandle x={question.court.ball.x} y={question.court.ball.y} bounds={bounds}
          radius={6} fill="#FFE600" svgRef={svgRef}
          onChange={(x, y) => updateBall(x, y)} />
      )}
    </svg>
  )
}
