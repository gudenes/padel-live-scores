// src/components/icons/index.tsx
// Shared outline-SVG icon set. Used by the profile hero, activity rows,
// and any surface that needs a plain icon (not a badge tile). All icons
// are stroke 2.5 with rounded caps on a 24×24 viewBox so they render
// crisply at 14–24px.

interface IconProps {
  size?: number
  color?: string
  strokeWidth?: number
}

function baseProps(size: number, color: string, strokeWidth: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

export function FlameIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M12 22c4-2.5 7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 3 8.5 7 11z"/>
      <path d="M12 22c-1.5-1.5-3-4-3-7a3 3 0 0 1 6 0c0 3-1.5 5.5-3 7z"/>
    </svg>
  )
}

export function TrophyIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/>
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/>
      <path d="M4 22h16"/>
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/>
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/>
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
    </svg>
  )
}

export function GearIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.2.48.66.84 1.22 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

export function BellIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
      <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
    </svg>
  )
}

export function BookmarkIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    </svg>
  )
}

export function SearchIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <circle cx="11" cy="11" r="8"/>
      <path d="M21 21l-4.35-4.35"/>
    </svg>
  )
}

export function ChevronRightIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <polyline points="9 18 15 12 9 6"/>
    </svg>
  )
}

export function ArrowLeftIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg {...baseProps(size, color, strokeWidth)}>
      <path d="M19 12H5"/>
      <path d="M12 19l-7-7 7-7"/>
    </svg>
  )
}

// --- Brand glyphs -----------------------------------------------------------
// DELIBERATE EXCEPTION to the stroke-outline convention above: social brand
// logos are only recognizable as FILLED glyphs, so these use fill={color}
// (no stroke). They keep the 24×24 viewBox and the {size,color} prop shape so
// they drop into the same call sites and theme via currentColor.

export function InstagramIcon({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="2" y="2" width="20" height="20" rx="5" stroke={color} strokeWidth="2" />
      <circle cx="12" cy="12" r="4.2" stroke={color} strokeWidth="2" />
      <circle cx="17.4" cy="6.6" r="1.3" fill={color} />
    </svg>
  )
}

export function XIcon({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
    </svg>
  )
}

export function TikTokIcon({ size = 18, color = 'currentColor' }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <path d="M16.6 5.82a4.28 4.28 0 0 1-1.06-2.82h-3.2v12.93a2.59 2.59 0 1 1-2.59-2.59c.27 0 .53.04.78.12v-3.3a5.88 5.88 0 0 0-.78-.05 5.89 5.89 0 1 0 5.89 5.89V9.4a7.46 7.46 0 0 0 4.32 1.38V7.58a4.28 4.28 0 0 1-3.36-1.76Z" />
    </svg>
  )
}
