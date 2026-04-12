'use client'
// src/components/BadgeIcon.tsx
//
// Renders a branded SVG badge icon in the chunky clip-path shape.
// Tier determines the gradient background, border, and stroke color.
// Locked badges render at 15% opacity with white strokes.

import type { JSX } from 'react'
import { TIER_META, type TierNumber } from '@/lib/badges'

const CHUNKY_BADGE = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'

interface BadgeIconProps {
  svgIcon: string
  tier: TierNumber | null  // null = locked
  size?: number            // px, default 48
  isPremium?: boolean      // premium badges get gold glow regardless of tier
}

// SVG path data for each icon identifier
const ICON_PATHS: Record<string, (color: string, size: number) => JSX.Element> = {
  checkmark: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
  ),
  star: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>
  ),
  lightbulb: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>
    </svg>
  ),
  bell: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  ),
  search: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
  ),
  globe: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  ),
  bookmark: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  document: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
    </svg>
  ),
  play: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
  ),
  share: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  ),
  flame: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c4-2.5 7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 3 8.5 7 11z"/><path d="M12 22c-1.5-1.5-3-4-3-7a3 3 0 0 1 6 0c0 3-1.5 5.5-3 7z"/>
    </svg>
  ),
  diamond: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12l4 6-10 13L2 9z"/><path d="M2 9h20"/>
    </svg>
  ),
  paddle: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6"/><line x1="12" y1="14" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/>
    </svg>
  ),
  bolt: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
    </svg>
  ),
  crystalBall: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="10" r="8"/>
      <path d="M8 18h8"/>
      <path d="M7 21h10"/>
      <path d="M9 14c0-1.5 1-3 3-3s3 1.5 3 3"/>
    </svg>
  ),
  trophy: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
    </svg>
  ),
  crown: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 20h20"/><path d="M4 20V10l4 4 4-8 4 8 4-4v10"/>
    </svg>
  ),
  lock: (c, s) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  ),
}

export function BadgeIcon({ svgIcon, tier, size = 48, isPremium }: BadgeIconProps) {
  const isLocked = tier === null
  const tierMeta = tier ? TIER_META[tier] : null

  // Premium badges (e.g. Founding Member) always use gold color + glow
  const PREMIUM_COLOR = '#FFD166'
  const color = isLocked ? '#ffffff' : isPremium ? PREMIUM_COLOR : tierMeta!.color
  const iconSize = Math.round(size * 0.44)

  // Background gradient
  const bg = isLocked
    ? 'rgba(255,255,255,0.03)'
    : isPremium
      ? `linear-gradient(135deg, ${PREMIUM_COLOR}50 0%, ${PREMIUM_COLOR}15 100%)`
      : `linear-gradient(135deg, ${color}40 0%, ${color}10 100%)`
  const borderColor = isLocked
    ? 'rgba(255,255,255,0.08)'
    : color

  // Padel Genius OR premium glow
  const glow = (tier === 4 || isPremium)
    ? { boxShadow: `0 0 ${Math.round(size * 0.35)}px 3px ${color}66` }
    : undefined

  const renderIcon = ICON_PATHS[svgIcon] ?? ICON_PATHS.lock

  return (
    <div
      style={{
        width: size,
        height: size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        clipPath: CHUNKY_BADGE,
        background: bg,
        border: `1.5px solid ${borderColor}`,
        flexShrink: 0,
        opacity: isLocked ? 0.3 : 1,
        ...glow,
      }}
    >
      {renderIcon(color, iconSize)}
    </div>
  )
}
