// src/components/AmbassadorBadge.tsx
//
// Chunky clip-pathed tier badge for the ambassador system. Three
// sizes for different surfaces: lg (dedicated screen), md (profile
// row), sm (name chip). Smash tier gets a subtle outer glow.

'use client'

import type { AmbassadorTierSpec } from '@/lib/ambassador'

const CHUNKY_BADGE = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'

interface AmbassadorBadgeProps {
  tier: AmbassadorTierSpec
  size?: 'sm' | 'md' | 'lg'
}

export function AmbassadorBadge({ tier, size = 'md' }: AmbassadorBadgeProps) {
  const px = size === 'lg' ? 68 : size === 'md' ? 44 : 22
  const iconSize = size === 'lg' ? 30 : size === 'md' ? 20 : 11

  const glow = tier.id === 'smash'
    ? { boxShadow: `0 0 ${size === 'lg' ? 22 : size === 'md' ? 14 : 8}px ${size === 'lg' ? 3 : 2}px ${tier.color}55` }
    : undefined

  return (
    <div
      aria-label={`${tier.name} ambassador badge`}
      style={{
        position: 'relative',
        width: px,
        height: px,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        clipPath: CHUNKY_BADGE,
        background: tier.bgGradient,
        border: `1.5px solid ${tier.color}`,
        ...glow,
      }}
    >
      <span style={{ fontSize: iconSize, lineHeight: 1 }}>{tier.icon}</span>
    </div>
  )
}
