// src/app/[locale]/(app)/padelgenius/components/BallSprite.tsx
'use client'

export interface BallSpriteProps {
  x: number              // SVG x (current position when static)
  y: number              // SVG y
  radius?: number        // default 9
  /** When set, ball animates along this SVG path d once, then stays at the end */
  motionPath?: string
  motionDuration?: number // ms
  /** Color of the seam line — usually black */
  outline?: string
  /**
   * When true (default), static position changes animate via CSS transform
   * transition. Ignored when motionPath is set (SMIL animateMotion handles
   * positioning instead). Set false in drag contexts where instantaneous
   * follow is required.
   */
  animatePosition?: boolean
}

export function BallSprite({
  x, y, radius = 9, motionPath, motionDuration = 500,
  outline = '#1A1A2E', animatePosition = true,
}: BallSpriteProps) {
  // Reveal / intro path: SMIL drives positioning. The circle's cx/cy must be
  // (0, 0) — `animateMotion` adds the path's offset on top of the element's
  // existing position, so a non-zero cx/cy here would double-translate the
  // ball outside the court. The `x`/`y` props are intentionally ignored in
  // this branch; the motion path's first `M` command IS the starting point.
  if (motionPath) {
    return (
      <g>
        <circle cx={0} cy={0} r={radius} fill="#FFE600" stroke={outline} strokeWidth={2.5}>
          <animateMotion
            dur={`${motionDuration}ms`}
            path={motionPath}
            fill="freeze"
            rotate="0"
          />
        </circle>
      </g>
    )
  }
  // Static path: position via CSS transform so changes between renders animate
  // smoothly (e.g. base ball → option setupBall during selecting phase).
  return (
    <g
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: animatePosition ? 'transform 700ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
      }}
    >
      <circle cx={0} cy={0} r={radius} fill="#FFE600" stroke={outline} strokeWidth={2.5} />
    </g>
  )
}
