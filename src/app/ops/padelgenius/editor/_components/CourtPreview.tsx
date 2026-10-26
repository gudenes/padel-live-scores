// src/app/ops/padelgenius/editor/_components/CourtPreview.tsx
'use client'
import { useRef } from 'react'
import { W, H, toSvg, playerScale } from '@/lib/padelgenius/projection'
import { introSegments, trajectoryPath } from '@/lib/padelgenius/trajectories'
import type { Question, CourtConfig, PlayerRole, OptionId, PlayerPosition, TrajectoryStyle, Trajectory } from '@/lib/padelgenius/types'
import { DragHandle } from './DragHandle'
import { PlayerSprite, PLAYER_SPRITE_URLS } from '@/app/[locale]/(app)/padelgenius/components/PlayerSprite'
import { BallSprite } from '@/app/[locale]/(app)/padelgenius/components/BallSprite'

export interface CourtPreviewProps {
  court: CourtConfig
  question: Question
  selectedOptionId: OptionId | null
  /** When true, the preview is in "intro mode" — drag handles edit the
      question's intro animation trajectory instead of any option. */
  editingIntro?: boolean
  onChange: (next: Question) => void
}

// Per-segment colors for the intro animation. Cycles when there are more
// segments than colors (rare). Keep in sync with Editor.tsx SEGMENT_COLORS.
const SEGMENT_COLORS = ['#22d3ee', '#f97316', '#ec4899', '#a3e635', '#a78bfa']

// Role-color rings around each player sprite — keeps the chibis visually
// distinguishable when two are close together on the court.
const PLAYER_RING_COLORS: Record<PlayerRole, string> = {
  you:       '#ef4444',
  partner:   '#3b82f6',
  opponent1: '#f97316',
  opponent2: '#22c55e',
}

// When a player has a position override for the selected option, swap the
// ring color for gold so it's obvious which players are being moved on reveal.
const OVERRIDE_RING = '#fde047'

export function CourtPreview({ court, question, selectedOptionId, editingIntro, onChange }: CourtPreviewProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const bounds = court.bounds
  const vs = court.visualSystem
  const sel = question.options.find(o => o.id === selectedOptionId) ?? null

  // Resolve a player's *display* position — overrides win when an option is selected.
  const resolvePos = (p: PlayerPosition): { x: number; y: number; isOverridden: boolean } => {
    if (!sel) return { x: p.x, y: p.y, isOverridden: false }
    const ov = sel.outcome.playerOverrides?.find(o => o.role === p.role)
    return ov ? { x: ov.x, y: ov.y, isOverridden: true } : { x: p.x, y: p.y, isOverridden: false }
  }

  // Depth-sort by *display* y so far players draw under near ones.
  const displayedPlayers = question.court.players
    .map(p => ({ ...p, ...resolvePos(p) }))
    .sort((a, b) => a.y - b.y)

  // Dragging a player updates the OVERRIDE for the selected option when one is
  // selected, otherwise updates the base setup.
  const dragPlayer = (role: PlayerRole, x: number, y: number) => {
    if (!sel) {
      onChange({
        ...question,
        court: { ...question.court, players: question.court.players.map(p => p.role === role ? { ...p, x, y } : p) },
      })
      return
    }
    const optId = sel.id
    onChange({
      ...question,
      options: question.options.map(o => {
        if (o.id !== optId) return o
        const existing = o.outcome.playerOverrides ?? []
        const idx = existing.findIndex(p => p.role === role)
        const nextOverrides = idx >= 0
          ? existing.map(p => p.role === role ? { ...p, x, y } : p)
          : [...existing, { role, x, y }]
        return { ...o, outcome: { ...o.outcome, playerOverrides: nextOverrides } }
      }),
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
      options: question.options.map(o => {
        if (o.id !== id || !o.outcome.trajectory) return o
        return { ...o, outcome: { ...o.outcome, trajectory: { ...o.outcome.trajectory, from: [x, y] } } }
      }),
    })
  }
  const updateTrajectoryTo = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => {
        if (o.id !== id || !o.outcome.trajectory) return o
        return { ...o, outcome: { ...o.outcome, trajectory: { ...o.outcome.trajectory, to: [x, y] } } }
      }),
    })
  }
  /** Resolve the intro's segment list (handles legacy `trajectory + bounce`). */
  const introSegs = introSegments(question.court.intro)
  /** Persist a fresh segments-shaped intro (drops legacy fields on write). */
  const writeIntroSegments = (next: Trajectory[]) => {
    onChange({
      ...question,
      court: {
        ...question.court,
        intro: {
          segments: next,
          durationMs: question.court.intro?.durationMs ?? 1500,
        },
      },
    })
  }
  /** Update one segment's endpoint; cascades `to` changes into the next segment's `from`. */
  const updateSegmentPoint = (
    index: number,
    key: 'from' | 'to' | 'controlPoint',
    x: number, y: number,
  ) => {
    if (index < 0 || index >= introSegs.length) return
    const next = introSegs.map((seg, i) =>
      i === index ? { ...seg, [key]: [x, y] as [number, number] } : seg
    )
    // Cascade: any segment's `to` becomes the next segment's `from`. Also,
    // moving segment 0's `from` doesn't affect later segments.
    if (key === 'to' && index < next.length - 1) {
      next[index + 1] = { ...next[index + 1], from: [x, y] as [number, number] }
    }
    writeIntroSegments(next)
  }
  const updateTrajectoryControl = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => {
        if (o.id !== id || !o.outcome.trajectory) return o
        return { ...o, outcome: { ...o.outcome, trajectory: { ...o.outcome.trajectory, controlPoint: [x, y] } } }
      }),
    })
  }
  const updateBall = (x: number, y: number) => {
    onChange({ ...question, court: { ...question.court, ball: { x, y } } })
  }
  const updateOptionSetupBall = (id: OptionId, x: number, y: number) => {
    onChange({
      ...question,
      options: question.options.map(o => o.id === id
        ? { ...o, outcome: { ...o.outcome, setupBall: { x, y } } }
        : o),
    })
  }

  // Resolve the ball position to render in option mode — per-option override
  // wins, falls back to the question-level setup ball.
  const selSetupBall = sel
    ? (sel.outcome.setupBall ?? question.court.ball ?? null)
    : null
  const selSetupBallIsOverride = !!sel?.outcome.setupBall

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ height: '100%', maxHeight: '100%', width: 'auto', maxWidth: '100%', aspectRatio: '2/3', display: 'block', background: '#0a0a14', borderRadius: 8 }}>
      {/* Court image */}
      <image href={court.imageUrl} x={0} y={0} width={W} height={H} preserveAspectRatio="xMidYMid slice" />

      {/* Selected option's trajectory preview — only when the option has a
          trajectory (rules / positioning options without a shot skip this). */}
      {sel?.outcome.trajectory && (() => {
        const traj = sel.outcome.trajectory
        const from = toSvg(traj.from[0], traj.from[1], bounds)
        const to = toSvg(traj.to[0], traj.to[1], bounds)
        const cp = traj.controlPoint ? toSvg(traj.controlPoint[0], traj.controlPoint[1], bounds) : undefined
        const asset = court.trajectoryAssets?.[traj.style]
        const accentColor = sel.isCorrect ? '#22c55e' : '#1e88e5'

        if (asset?.logoUrl) {
          const chord = Math.hypot(to[0] - from[0], to[1] - from[1])
          const angleDeg = Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI
          const mx = (from[0] + to[0]) / 2
          const my = (from[1] + to[1]) / 2
          const scale = asset.scale ?? 1
          const imgW = chord * scale
          const imgH = chord * 0.5 * scale
          return (
            <g transform={`translate(${mx} ${my}) rotate(${angleDeg})`}>
              <image
                href={asset.logoUrl}
                x={-imgW / 2}
                y={-imgH / 2}
                width={imgW}
                height={imgH}
                preserveAspectRatio="xMidYMid meet"
              />
            </g>
          )
        }
        // Per-style override (color / thickness / dash) — applies to the
        // procedural fallback only. Asset case above is unaffected.
        const ov = court.trajectoryOverrides?.[traj.style]
        const finalColor = ov?.color ?? accentColor
        const baseWidth = ov?.strokeWidth ?? 5
        const dashedFinal = ov?.dashed === undefined ? true : ov.dashed
        return (
          <g>
            {/* Hard cartoon drop-shadow (solid, never dashed) */}
            <path d={trajectoryPath(traj.style, from, to, cp)}
                  stroke="rgba(10,10,20,0.55)" strokeWidth={baseWidth + 4} fill="none"
                  strokeLinecap="round" strokeLinejoin="round"
                  transform="translate(1.6, 2.4)" />
            {/* Dark outline */}
            <path d={trajectoryPath(traj.style, from, to, cp)}
                  stroke="#1a1a2e" strokeWidth={baseWidth + 4} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" />
            {/* Bright accent — dashed by default unless explicitly solidified */}
            <path d={trajectoryPath(traj.style, from, to, cp)}
                  stroke={finalColor} strokeWidth={baseWidth} fill="none"
                  strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={dashedFinal ? '8 6' : undefined} />
            {/* Tangent lines from FROM/TO to the apex — visual cue that the
                apex shapes the curve. Only when controlPoint is explicit. */}
            {cp && (
              <g pointerEvents="none">
                <line x1={from[0]} y1={from[1]} x2={cp[0]} y2={cp[1]} stroke="#a78bfa" strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
                <line x1={to[0]} y1={to[1]} x2={cp[0]} y2={cp[1]} stroke="#a78bfa" strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
              </g>
            )}
            {/* Cartoon arrowhead — doubled, base sits at the line endpoint
                with the tip projecting past it. Tangent from the chord. */}
            {(() => {
              const angle = Math.atan2(to[1] - (cp?.[1] ?? from[1]), to[0] - (cp?.[0] ?? from[0])) * 180 / Math.PI
              const size = Math.max(10, baseWidth * 2)
              const d = `M 0 ${-size * 0.7} L ${size} 0 L 0 ${size * 0.7} Z`
              return (
                <g transform={`translate(${to[0]} ${to[1]}) rotate(${angle})`}>
                  <path d={d} fill="rgba(10,10,20,0.55)" transform="translate(1.8, 2.8)" />
                  <path d={d} fill={finalColor} stroke="#1A1A2E" strokeWidth={2} strokeLinejoin="round" />
                </g>
              )
            })()}
          </g>
        )
      })()}

      {/* Ghost markers — show base position when a player has an override on the selected option */}
      {sel && question.court.players.map(p => {
        const ov = sel.outcome.playerOverrides?.find(o => o.role === p.role)
        if (!ov) return null
        const [bx, by] = toSvg(p.x, p.y, bounds)
        const [tx, ty] = toSvg(ov.x, ov.y, bounds)
        return (
          <g key={`ghost-${p.role}`} pointerEvents="none">
            {/* Dotted line from base → override position */}
            <line x1={bx} y1={by} x2={tx} y2={ty} stroke={OVERRIDE_RING} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.7} />
            {/* Small dot at the base (origin) position */}
            <circle cx={bx} cy={by} r={4} fill="none" stroke={PLAYER_RING_COLORS[p.role]} strokeWidth={1.5} strokeDasharray="2 2" opacity={0.6} />
          </g>
        )
      })}

      {/* Player handles — real chibi sprite, depth-sorted by display position */}
      {displayedPlayers.map(p => {
        const scale = playerScale(p.y, vs)
        const haloR = 24 * scale
        const ringColor = p.isOverridden ? OVERRIDE_RING : PLAYER_RING_COLORS[p.role]
        const ringWidth = p.isOverridden ? 2.5 : 2
        return (
          <DragHandle
            key={p.role}
            x={p.x} y={p.y} bounds={bounds}
            hitRadius={haloR}
            svgRef={svgRef}
            onChange={(x, y) => dragPlayer(p.role, x, y)}
            renderHandle={(px, py) => (
              <g>
                <circle cx={px} cy={py} r={haloR} fill="none"
                        stroke={ringColor} strokeWidth={ringWidth} strokeDasharray="4 3" opacity={0.85} />
                <PlayerSprite
                  role={p.role}
                  x={px} y={py}
                  scale={scale}
                  vs={vs}
                  spriteUrl={PLAYER_SPRITE_URLS[p.role]}
                  faded={false}
                  animatePosition={false}
                />
              </g>
            )}
          />
        )
      })}

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

      {/* Trajectory endpoint handles for the selected option — labeled + larger.
          Hidden when the option has no trajectory. */}
      {sel?.outcome.trajectory && (() => {
        const traj = sel.outcome.trajectory
        // Default apex if no explicit control point — pull it from the existing
        // procedural shape so the handle starts at a sensible spot. Compute by
        // sampling the path's midpoint in SVG space, then projecting back to
        // court coords. For Bezier styles we just use midpoint between from/to
        // shifted toward where the style typically peaks.
        const apexCourt: [number, number] = traj.controlPoint ?? (() => {
          // Fallback default — midpoint biased upward for arc styles
          const mx = (traj.from[0] + traj.to[0]) / 2
          const myMid = (traj.from[1] + traj.to[1]) / 2
          const arcStyles: TrajectoryStyle[] = ['lob', 'bandeja', 'vibora', 'smash', 'chiquita', 'wall-bounce']
          const yOffset = arcStyles.includes(traj.style) ? -15 : 0
          return [mx, Math.max(0, myMid + yOffset)]
        })()
        return (
          <>
            <DragHandle
              x={traj.from[0]} y={traj.from[1]} bounds={bounds}
              hitRadius={18}
              svgRef={svgRef}
              onChange={(x, y) => updateTrajectoryFrom(sel.id, x, y)}
              renderHandle={(px, py) => (
                <g>
                  <circle cx={px} cy={py} r={11} fill="#1e88e5" stroke="#0a0a14" strokeWidth={2.5} />
                  <text x={px} y={py + 3} textAnchor="middle" fontSize={8} fontWeight={900} fill="#fff" letterSpacing={0.4}>FROM</text>
                </g>
              )}
            />
            <DragHandle
              x={traj.to[0]} y={traj.to[1]} bounds={bounds}
              hitRadius={18}
              svgRef={svgRef}
              onChange={(x, y) => updateTrajectoryTo(sel.id, x, y)}
              renderHandle={(px, py) => (
                <g>
                  <circle cx={px} cy={py} r={11} fill="#fde047" stroke="#0a0a14" strokeWidth={2.5} />
                  <text x={px} y={py + 3} textAnchor="middle" fontSize={9} fontWeight={900} fill="#0a0a14" letterSpacing={0.4}>TO</text>
                </g>
              )}
            />
            {/* APEX — purple handle. Solid when explicitly set, dashed-outlined
                when showing the default (drag to commit a custom apex). */}
            <DragHandle
              x={apexCourt[0]} y={apexCourt[1]} bounds={bounds}
              hitRadius={16}
              svgRef={svgRef}
              onChange={(x, y) => updateTrajectoryControl(sel.id, x, y)}
              renderHandle={(px, py) => (
                <g>
                  {traj.controlPoint ? (
                    <circle cx={px} cy={py} r={9} fill="#a78bfa" stroke="#0a0a14" strokeWidth={2} />
                  ) : (
                    <circle cx={px} cy={py} r={9} fill="rgba(167,139,250,0.4)" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="3 2" />
                  )}
                  <text x={px} y={py + 3} textAnchor="middle" fontSize={7} fontWeight={900} fill={traj.controlPoint ? '#fff' : '#a78bfa'} letterSpacing={0.4}>APEX</text>
                </g>
              )}
            />
          </>
        )
      })()}

      {/* Base setup ball (no option selected) — draggable, edits question.court.ball */}
      {question.court.ball && !sel && (
        <DragHandle
          x={question.court.ball.x} y={question.court.ball.y} bounds={bounds}
          hitRadius={14}
          svgRef={svgRef}
          onChange={(x, y) => updateBall(x, y)}
          renderHandle={(px, py) => (
            <g>
              <circle cx={px} cy={py} r={14} fill="none" stroke="#fde047" strokeWidth={1.5} strokeDasharray="3 2" opacity={0.7} />
              <BallSprite x={px} y={py} animatePosition={false} />
            </g>
          )}
        />
      )}

      {/* Per-option setup ball (when an option is selected) — draggable, edits
          outcome.setupBall. Gold ring + dotted leader from base position when overridden. */}
      {sel && selSetupBall && (
        <>
          {selSetupBallIsOverride && question.court.ball && (() => {
            const [bx, by] = toSvg(question.court.ball.x, question.court.ball.y, bounds)
            const [tx, ty] = toSvg(selSetupBall.x, selSetupBall.y, bounds)
            return (
              <g pointerEvents="none">
                <line x1={bx} y1={by} x2={tx} y2={ty} stroke="#fde047" strokeWidth={1.5} strokeDasharray="3 3" opacity={0.7} />
                <circle cx={bx} cy={by} r={4} fill="none" stroke="#fde047" strokeWidth={1.2} strokeDasharray="2 2" opacity={0.5} />
              </g>
            )
          })()}
          <DragHandle
            x={selSetupBall.x} y={selSetupBall.y} bounds={bounds}
            hitRadius={14}
            svgRef={svgRef}
            onChange={(x, y) => updateOptionSetupBall(sel.id, x, y)}
            renderHandle={(px, py) => (
              <g>
                <circle cx={px} cy={py} r={14} fill="none"
                        stroke={selSetupBallIsOverride ? '#fde047' : '#7dd3fc'}
                        strokeWidth={selSetupBallIsOverride ? 2 : 1.5}
                        strokeDasharray="3 2"
                        opacity={selSetupBallIsOverride ? 0.95 : 0.7} />
                <BallSprite x={px} y={py} animatePosition={false} />
              </g>
            )}
          />
        </>
      )}

      {/* INTRO MODE — render trajectory preview + drag handles for every
          segment of the intro animation. Visible only when editingIntro is
          true and the question has at least one segment defined.
          Each segment uses a unique color so they're visually distinguishable. */}
      {editingIntro && introSegs.length > 0 && introSegs.map((seg, idx) => {
        const segColor = SEGMENT_COLORS[idx % SEGMENT_COLORS.length]
        const from = toSvg(seg.from[0], seg.from[1], bounds)
        const to = toSvg(seg.to[0], seg.to[1], bounds)
        const cp = seg.controlPoint ? toSvg(seg.controlPoint[0], seg.controlPoint[1], bounds) : undefined
        const isFirstSeg = idx === 0
        const endpointLabel = idx === introSegs.length - 1 ? 'END' : `P${idx + 1}`
        return (
          <g key={`seg-${idx}`}>
            {/* Segment trajectory line — color-coded per segment */}
            <path d={trajectoryPath(seg.style, from, to, cp)}
                  stroke="rgba(10,10,20,0.5)" strokeWidth={isFirstSeg ? 9 : 7} fill="none"
                  strokeLinecap="round" strokeLinejoin="round"
                  transform="translate(1.6, 2.4)" />
            <path d={trajectoryPath(seg.style, from, to, cp)}
                  stroke="#1a1a2e" strokeWidth={isFirstSeg ? 9 : 7} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" />
            <path d={trajectoryPath(seg.style, from, to, cp)}
                  stroke={segColor} strokeWidth={isFirstSeg ? 5 : 4} fill="none"
                  strokeLinecap="round" strokeLinejoin="round" strokeDasharray="8 6" />
            {/* APEX tangent hint */}
            {cp && (
              <g pointerEvents="none">
                <line x1={from[0]} y1={from[1]} x2={cp[0]} y2={cp[1]} stroke="#a78bfa" strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
                <line x1={to[0]} y1={to[1]} x2={cp[0]} y2={cp[1]} stroke="#a78bfa" strokeWidth={1} strokeDasharray="2 3" opacity={0.55} />
              </g>
            )}
            {/* FROM handle — only on the first segment (later segments auto-track previous TO) */}
            {isFirstSeg && (
              <DragHandle
                x={seg.from[0]} y={seg.from[1]} bounds={bounds}
                hitRadius={18}
                svgRef={svgRef}
                onChange={(x, y) => updateSegmentPoint(idx, 'from', x, y)}
                renderHandle={(px, py) => (
                  <g>
                    <circle cx={px} cy={py} r={11} fill={segColor} stroke="#0a0a14" strokeWidth={2.5} />
                    <text x={px} y={py + 3} textAnchor="middle" fontSize={8} fontWeight={900} fill="#0a0a14" letterSpacing={0.4}>FROM</text>
                  </g>
                )}
              />
            )}
            {/* TO / endpoint handle */}
            <DragHandle
              x={seg.to[0]} y={seg.to[1]} bounds={bounds}
              hitRadius={18}
              svgRef={svgRef}
              onChange={(x, y) => updateSegmentPoint(idx, 'to', x, y)}
              renderHandle={(px, py) => (
                <g>
                  <circle cx={px} cy={py} r={11} fill={endpointLabel === 'END' ? '#fde047' : segColor} stroke="#0a0a14" strokeWidth={2.5} />
                  <text x={px} y={py + 3} textAnchor="middle" fontSize={endpointLabel === 'END' ? 9 : 8} fontWeight={900} fill="#0a0a14" letterSpacing={0.4}>{endpointLabel}</text>
                </g>
              )}
            />
            {/* APEX handle */}
            {(() => {
              const apexCourt: [number, number] = seg.controlPoint ?? [
                (seg.from[0] + seg.to[0]) / 2,
                Math.max(0, ((seg.from[1] + seg.to[1]) / 2) - 15),
              ]
              return (
                <DragHandle
                  x={apexCourt[0]} y={apexCourt[1]} bounds={bounds}
                  hitRadius={16}
                  svgRef={svgRef}
                  onChange={(x, y) => updateSegmentPoint(idx, 'controlPoint', x, y)}
                  renderHandle={(px, py) => (
                    <g>
                      {seg.controlPoint ? (
                        <circle cx={px} cy={py} r={9} fill="#a78bfa" stroke="#0a0a14" strokeWidth={2} />
                      ) : (
                        <circle cx={px} cy={py} r={9} fill="rgba(167,139,250,0.4)" stroke="#a78bfa" strokeWidth={1.5} strokeDasharray="3 2" />
                      )}
                      <text x={px} y={py + 3} textAnchor="middle" fontSize={7} fontWeight={900} fill={seg.controlPoint ? '#fff' : '#a78bfa'} letterSpacing={0.4}>APEX</text>
                    </g>
                  )}
                />
              )
            })()}
          </g>
        )
      })}
    </svg>
  )
}
