// src/app/[locale]/(app)/padelgenius/components/Scene.tsx
'use client'
import type { Question, OptionId, PlayerPosition, Outcome } from '@/lib/padelgenius/types'
import { toSvg, playerScale, W, H } from '@/lib/padelgenius/projection'
import { useActiveCourt } from './ActiveCourtProvider'
import { PlayerSprite, PLAYER_SPRITE_URLS } from './PlayerSprite'
import { BallSprite } from './BallSprite'
import { TrajectoryRenderer } from './TrajectoryRenderer'
import { PositionedOptions } from './PositionedOptions'
import { introSegments, trajectoryPath } from '@/lib/padelgenius/trajectories'

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

  // Apply playerOverrides from the active option — picked during reveal, OR
  // selected during preview (so players animate to their new spot on tap, before CONFIRM).
  const activeOptionId = revealing
    ? pickedId
    : phase === 'selecting' ? selectedId : null
  const players: PlayerPosition[] = activeOptionId
    ? applyOverrides(question.court.players, question.options.find(o => o.id === activeOptionId)?.outcome.playerOverrides)
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

  // Resolve the setup ball position during non-reveal phases. When an option
  // is active in selecting phase, prefer its setupBall override; fall back to
  // the question-level court.ball; otherwise no ball is shown.
  const setupBallCoord = (() => {
    if (revealing) return null
    if (phase === 'selecting' && selectedId) {
      const opt = question.options.find(o => o.id === selectedId)
      if (opt?.outcome.setupBall) return opt.outcome.setupBall
    }
    return question.court.ball ?? null
  })()
  const setupBall = setupBallCoord
    ? toSvg(setupBallCoord.x, setupBallCoord.y, bounds)
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

      {/* Setup ball — suppressed during the intro animation (the intro ball
          occupies the same screen role and we don't want two balls visible). */}
      {setupBall && !(question.court.intro && phase !== 'revealing') && <BallSprite x={setupBall[0]} y={setupBall[1]} />}

      {/* Intro animation — plays once on question load before any option is
          tapped. Helps rules / scenario questions ("the ball hits the back
          glass…") by showing the play before asking the question.
          Supports an arbitrary number of segments (floor bounce → wall hit →
          return, double-glass plays, etc.) and conveys height via a soft
          ground shadow + ball scale-pulse. */}
      {question.court.intro && phase !== 'revealing' && (() => {
        const intro = question.court.intro
        const segments = introSegments(intro)
        if (segments.length === 0) return null

        // Project every segment into SVG space. Each segment's `from` is
        // forced to match the previous `to` so the path is always continuous
        // even if the authored data has slight drift.
        type Projected = { from: [number, number]; to: [number, number]; cp?: [number, number]; style: typeof segments[number]['style'] }
        const projected: Projected[] = []
        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]
          const from = i === 0
            ? toSvg(seg.from[0], seg.from[1], bounds)
            : projected[i - 1].to
          const to = toSvg(seg.to[0], seg.to[1], bounds)
          const cp = seg.controlPoint ? toSvg(seg.controlPoint[0], seg.controlPoint[1], bounds) : undefined
          projected.push({ from, to, cp, style: seg.style })
        }

        // Build one combined motion path: first leg keeps its `M`, subsequent
        // legs strip their leading `M x y` so their curve/line commands
        // continue from the previous endpoint.
        let combinedPath = trajectoryPath(projected[0].style, projected[0].from, projected[0].to, projected[0].cp)
        for (let i = 1; i < projected.length; i++) {
          const seg = projected[i]
          const legPath = trajectoryPath(seg.style, seg.from, seg.to, seg.cp)
          combinedPath += ` ${legPath.replace(/^M\s*[\d.-]+\s+[\d.-]+\s*/, '')}`
        }

        const duration = intro.durationMs ?? 1500

        // Ground shadow stays near the bottom of the path's bounding box so
        // the ball appears to rise above it. Sample every endpoint + control
        // point across all segments.
        const ys: number[] = []
        for (const s of projected) {
          ys.push(s.from[1], s.to[1])
          if (s.cp) ys.push(s.cp[1])
        }
        const groundY = Math.max(...ys) + 14
        const shadowStartX = projected[0].from[0]
        const shadowEndX = projected[projected.length - 1].to[0]
        const shadowPath = `M ${shadowStartX} ${groundY} L ${shadowEndX} ${groundY}`

        return (
          <g key={`intro-${question.id}`}>
            {/* Faded trajectory line — covers both legs */}
            <path
              d={combinedPath}
              stroke="rgba(125,211,252,0.65)"
              strokeWidth={3}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="5 4"
            />
            {/* Soft ground shadow — tracks the ball's horizontal sweep */}
            <ellipse cx={0} cy={0} rx={9} ry={3.5} fill="rgba(10,10,20,0.4)">
              <animateMotion dur={`${duration}ms`} path={shadowPath} fill="freeze" />
              {/* Shadow pulses smaller at the curve apex (ball higher = shadow tighter) */}
              <animate
                attributeName="rx"
                values="9;4.5;9"
                dur={`${duration}ms`}
                fill="freeze"
              />
              <animate
                attributeName="opacity"
                values="0.4;0.18;0.4"
                dur={`${duration}ms`}
                fill="freeze"
              />
            </ellipse>
            {/* Ball flies along the combined path with a height-suggesting scale pulse */}
            <circle cx={0} cy={0} r={9} fill="#FFE600" stroke="#1A1A2E" strokeWidth={2.5}>
              <animateMotion dur={`${duration}ms`} path={combinedPath} fill="freeze" rotate="0" />
              <animate
                attributeName="r"
                values="9;12;9"
                dur={`${duration}ms`}
                fill="freeze"
              />
            </circle>
          </g>
        )
      })()}

      {/* Preview trajectory — shown the moment a letter is tapped (before CONFIRM).
          Subtle blue dashed line so the player can see the shot they're picking.
          Skipped entirely when the option has no trajectory (e.g. rules questions). */}
      {phase === 'selecting' && selectedId && (() => {
        const selectedOpt = question.options.find(o => o.id === selectedId)
        if (!selectedOpt?.outcome.trajectory) return null
        const traj = selectedOpt.outcome.trajectory
        const from = toSvg(traj.from[0], traj.from[1], bounds)
        const to = toSvg(traj.to[0], traj.to[1], bounds)
        return (
          <g style={{ opacity: 0.85 }}>
            <TrajectoryRenderer
              style={traj.style}
              from={from}
              to={to}
              state="preview"
              animate={false}
              pathId={`traj-preview-${selectedId}`}
              assetUrl={court.trajectoryAssets?.[traj.style]?.logoUrl}
              assetScale={court.trajectoryAssets?.[traj.style]?.scale}
              controlPoint={traj.controlPoint ? toSvg(traj.controlPoint[0], traj.controlPoint[1], bounds) : undefined}
              override={court.trajectoryOverrides?.[traj.style]}
            />
          </g>
        )
      })()}

      {/* Reveal trajectories — skip the entire flight/ball animation when the
          option has no trajectory; the reveal sheet still slides up with verdict. */}
      {revealedOutcomes.map(({ id, outcome, state }) => {
        if (!outcome.trajectory) {
          // No flight path — sparkle alone on correct so there's still a moment
          // of feedback over the court.
          if (state === 'correct') {
            // No landing point either; sparkle at court centre as a soft win flourish.
            const [cx, cy] = toSvg(50, 50, bounds)
            return <g key={id}><Sparkle x={cx} y={cy} /></g>
          }
          return null
        }
        const traj = outcome.trajectory
        const from = toSvg(traj.from[0], traj.from[1], bounds)
        const to = toSvg(traj.to[0], traj.to[1], bounds)
        const pathId = `traj-${id}`
        return (
          <g key={id}>
            <TrajectoryRenderer
              style={traj.style}
              from={from}
              to={to}
              state={state}
              animate
              pathId={pathId}
              assetUrl={court.trajectoryAssets?.[traj.style]?.logoUrl}
              assetScale={court.trajectoryAssets?.[traj.style]?.scale}
              controlPoint={traj.controlPoint ? toSvg(traj.controlPoint[0], traj.controlPoint[1], bounds) : undefined}
              override={court.trajectoryOverrides?.[traj.style]}
            />
            {/* Ball animates along the path */}
            <BallSprite
              x={from[0]} y={from[1]}
              motionPath={trajectoryPath(
                traj.style,
                from,
                to,
                traj.controlPoint ? toSvg(traj.controlPoint[0], traj.controlPoint[1], bounds) : undefined,
              )}
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
