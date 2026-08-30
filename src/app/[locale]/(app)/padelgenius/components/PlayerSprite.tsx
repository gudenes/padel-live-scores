// src/app/[locale]/(app)/padelgenius/components/PlayerSprite.tsx
'use client'
import type { PlayerRole, VisualSystem } from '@/lib/padelgenius/types'

export interface PlayerSpriteProps {
  role: PlayerRole
  x: number          // SVG x (already projected) — the feet anchor (x-center)
  y: number          // SVG y (already projected) — the feet anchor (y-bottom)
  scale: number      // perspective scale
  vs: VisualSystem
  spriteUrl: string
  faded?: boolean    // for non-selected during reveal
  /**
   * When true (default), position changes animate via CSS transform transition.
   * Set false in the editor / drag contexts where instantaneous follow is required.
   */
  animatePosition?: boolean
}

const BREATHE_DELAY: Record<PlayerRole, string> = {
  you: '0s', partner: '0.4s', opponent1: '0.8s', opponent2: '1.2s',
}

export function PlayerSprite({ role, x, y, scale, vs, spriteUrl, faded, animatePosition = true }: PlayerSpriteProps) {
  const h = (vs.playerBaseSize * 1.33) * scale  // tall box for portrait PNGs
  const w = vs.playerBaseSize * scale
  // Position via CSS transform on the outer <g> so it can be smoothly transitioned
  // when (x, y) change between renders (e.g. base setup → playerOverrides on reveal).
  return (
    <g
      style={{
        transform: `translate(${x}px, ${y}px)`,
        transition: animatePosition ? 'transform 700ms cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
      }}
    >
      <g style={{ animation: 'pg-breathe 2.5s ease-in-out infinite', animationDelay: BREATHE_DELAY[role] }}>
        <image
          href={spriteUrl}
          x={-w / 2}
          y={-h + 14 * scale}
          width={w}
          height={h}
          preserveAspectRatio="xMidYMax meet"
          opacity={faded ? 0.45 : 1}
          style={{ transition: 'opacity 200ms ease-out' }}
        />
      </g>
    </g>
  )
}

export const PLAYER_SPRITE_URLS: Record<PlayerRole, string> = {
  you: '/padelgenius/you.png',
  partner: '/padelgenius/partner.png',
  opponent1: '/padelgenius/opponent1.png',
  opponent2: '/padelgenius/opponent2.png',
}
