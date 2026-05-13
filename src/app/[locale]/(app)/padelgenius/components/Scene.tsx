// src/app/[locale]/(app)/padelgenius/components/Scene.tsx
'use client'
import type { Question, OptionId, PlayerPosition, Outcome } from '@/lib/padelgenius/types'
import { toSvg, playerScale, W, H } from '@/lib/padelgenius/projection'
import { useActiveCourt } from './ActiveCourtProvider'
import { PlayerSprite, PLAYER_SPRITE_URLS } from './PlayerSprite'
import { BallSprite } from './BallSprite'
import { TrajectoryRenderer } from './TrajectoryRenderer'
import { PositionedOptions } from './PositionedOptions'
import { trajectoryPath } from '@/lib/padelgenius/trajectories'

export interface SceneProps {
  question: Question
  phase: 'idle' | 'selecting' | 'revealing'
  selectedId: OptionId | null
  pickedId: OptionId | null
  onSelect: (id: OptionId) => void
  onConfirm: () => void
}

export function Scene({ question, phase, selectedId, pickedId, onSelect, onConfirm }: SceneProps) {
  const court = useActiveCourt()
  const bounds = court.bounds
  const vs = court.visualSystem
  const correctOpt = question.options.find(o => o.isCorrect)!
  const correctId = correctOpt.id
  const revealing = phase === 'revealing'

  // Apply playerOverrides from the picked option during reveal
  const players: PlayerPosition[] = revealing && pickedId
    ? applyOverrides(question.court.players, question.options.find(o => o.id === pickedId)?.outcome.playerOverrides)
    : question.court.players
  const sortedPlayers = [...players].sort((a, b) => a.y - b.y)

  // Trajectory(ies) during reveal
  const revealedOutcomes: { id: OptionId; outcome: Outcome; state: 'correct' | 'wrong' }[] = revealing && pickedId
    ? pickedId === correctId
      ? [{ id: pickedId, outcome: question.options.find(o => o.id === pickedId)!.outcome, state: 'correct' }]
      : [
          { id: pickedId, outcome: question.options.find(o => o.id === pickedId)!.outcome, state: 'wrong' },
          { id: correctId, outcome: correctOpt.outcome, state: 'correct' },
        ]
    : []

  // Deviation 2: hoist ball coordinate calculation (avoids calling toSvg twice)
  const setupBall = question.court.ball && !revealing
    ? toSvg(question.court.ball.x, question.court.ball.y, bounds)
    : null

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ width: '100%', height: '100%', display: 'block' }}>
      {/* Court image */}
      <image href={court.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />

      {/* Branding overlays — sit on court surface, under players */}
      {court.branding.backWall && (
        <image
          href={court.branding.backWall.logoUrl}
          x={W * 0.18} y={H * 0.13} width={W * 0.64} height={H * 0.07}
          preserveAspectRatio="xMidYMid meet"
          opacity={1}
        />
      )}
      {court.branding.sideGlassLeft && (
        <image
          href={court.branding.sideGlassLeft.logoUrl}
          x={W * 0.02} y={H * 0.45} width={W * 0.16} height={H * 0.06}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {court.branding.sideGlassRight && (
        <image
          href={court.branding.sideGlassRight.logoUrl}
          x={W * 0.82} y={H * 0.45} width={W * 0.16} height={H * 0.06}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {court.branding.netBand && (
        <image
          href={court.branding.netBand.logoUrl}
          x={W * 0.10} y={H * 0.50} width={W * 0.80} height={H * 0.02}
          preserveAspectRatio="xMidYMid meet"
        />
      )}
      {court.branding.floorCenter && (
        <image
          href={court.branding.floorCenter.logoUrl}
          x={W * 0.40} y={H * 0.65} width={W * 0.20} height={W * 0.20}
          preserveAspectRatio="xMidYMid meet"
        />
      )}

      {/* Players — sorted by depth so far players draw first */}
      {sortedPlayers.map(p => {
        const [px, py] = toSvg(p.x, p.y, bounds)
        const s = playerScale(p.y, vs)
        return (
          <PlayerSprite
            key={p.role}
            role={p.role}
            x={px}
            y={py}
            scale={s}
            vs={vs}
            spriteUrl={PLAYER_SPRITE_URLS[p.role]}
            faded={false}
          />
        )
      })}

      {/* Existing question ball (if part of the setup, e.g. incoming lob) */}
      {setupBall && <BallSprite x={setupBall[0]} y={setupBall[1]} />}

      {/* Reveal trajectories */}
      {revealedOutcomes.map(({ id, outcome, state }) => {
        const from = toSvg(outcome.trajectory.from[0], outcome.trajectory.from[1], bounds)
        const to = toSvg(outcome.trajectory.to[0], outcome.trajectory.to[1], bounds)
        const pathId = `traj-${id}`
        return (
          <g key={id}>
            <TrajectoryRenderer style={outcome.trajectory.style} from={from} to={to} state={state} animate pathId={pathId} />
            {/* Ball animates along the path */}
            <BallSprite
              x={from[0]} y={from[1]}
              motionPath={trajectoryPath(outcome.trajectory.style, from, to)}
              motionDuration={500}
            />
            {/* Star sparkle on correct */}
            {state === 'correct' && <Sparkle x={to[0]} y={to[1]} />}
          </g>
        )
      })}

      {/* Option letters */}
      <PositionedOptions
        options={question.options}
        phase={phase}
        selectedId={selectedId}
        correctId={revealing ? correctId : null}
        onSelect={onSelect}
        onConfirm={onConfirm}
      />
    </svg>
  )
}

function applyOverrides(base: PlayerPosition[], overrides?: PlayerPosition[]): PlayerPosition[] {
  if (!overrides || overrides.length === 0) return base
  const map = new Map(overrides.map(o => [o.role, o]))
  return base.map(p => map.get(p.role) ?? p)
}

// Deviation 1: inline SVG 5-pointed star path — no unicode/emoji characters
function Sparkle({ x, y }: { x: number; y: number }) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{
        animation: 'pg-sparkle 400ms ease-out forwards',
        transformOrigin: '0 0',
      }}
    >
      {/* Cartoon 5-pointed star — gold fill, navy stroke */}
      <path
        d="M 0 -14 L 4.1 -4.3 L 14.7 -3.4 L 6.5 3.5 L 9 13.7 L 0 8 L -9 13.7 L -6.5 3.5 L -14.7 -3.4 L -4.1 -4.3 Z"
        fill="#fde047"
        stroke="#1A1A2E"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </g>
  )
}
