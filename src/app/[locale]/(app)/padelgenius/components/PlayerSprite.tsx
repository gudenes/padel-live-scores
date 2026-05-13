// src/app/[locale]/(app)/padelgenius/components/PlayerSprite.tsx
'use client'
import type { PlayerRole, VisualSystem } from '@/lib/padelgenius/types'

export interface PlayerSpriteProps {
  role: PlayerRole
  x: number          // SVG x (already projected)
  y: number          // SVG y (already projected, the feet anchor)
  scale: number      // perspective scale
  vs: VisualSystem
  spriteUrl: string
  faded?: boolean    // for non-selected during reveal
}

const BREATHE_DELAY: Record<PlayerRole, string> = {
  you: '0s', partner: '0.4s', opponent1: '0.8s', opponent2: '1.2s',
}

export function PlayerSprite({ role, x, y, scale, vs, spriteUrl, faded }: PlayerSpriteProps) {
  const h = (vs.playerBaseSize * 1.33) * scale  // tall box for portrait PNGs
  const w = vs.playerBaseSize * scale
  return (
    <g style={{ animation: 'pg-breathe 2.5s ease-in-out infinite', animationDelay: BREATHE_DELAY[role] }}>
      <image
        href={spriteUrl}
        x={x - w / 2}
        y={y - h + 14 * scale}
        width={w}
        height={h}
        preserveAspectRatio="xMidYMax meet"
        opacity={faded ? 0.45 : 1}
        style={{ transition: 'opacity 200ms ease-out' }}
      />
    </g>
  )
}

export const PLAYER_SPRITE_URLS: Record<PlayerRole, string> = {
  you: '/padelgenius/you.png',
  partner: '/padelgenius/partner.png',
  opponent1: '/padelgenius/opponent1.png',
  opponent2: '/padelgenius/opponent2.png',
}
