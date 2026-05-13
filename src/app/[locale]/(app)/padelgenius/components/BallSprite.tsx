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
}

export function BallSprite({ x, y, radius = 9, motionPath, motionDuration = 500, outline = '#1A1A2E' }: BallSpriteProps) {
  return (
    <g>
      <circle cx={x} cy={y} r={radius} fill="#FFE600" stroke={outline} strokeWidth={2.5}>
        {motionPath && (
          <animateMotion
            dur={`${motionDuration}ms`}
            path={motionPath}
            fill="freeze"
            rotate="0"
          />
        )}
      </circle>
    </g>
  )
}
