// src/components/icons/FlagIcons.tsx
// Country flag SVGs used by the profile-menu locale switcher.
// 60×36 viewBox; consumer controls actual size via width/height.

type Props = { width?: number; height?: number; className?: string }

export function FlagUK({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <clipPath id="fl-uk-clip"><path d="M0 0v36h60V0z"/></clipPath>
      <path d="M0 0v36h60V0z" fill="#012169"/>
      <g clipPath="url(#fl-uk-clip)">
        <path d="M0 0l60 36m0-36L0 36" stroke="#fff" strokeWidth="6"/>
        <path d="M0 0l60 36m0-36L0 36" stroke="#C8102E" strokeWidth="3"/>
        <path d="M30 0v36M0 18h60" stroke="#fff" strokeWidth="10"/>
        <path d="M30 0v36M0 18h60" stroke="#C8102E" strokeWidth="6"/>
      </g>
    </svg>
  )
}

export function FlagES({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="60" height="36" fill="#AA151B"/>
      <rect y="9" width="60" height="18" fill="#F1BF00"/>
    </svg>
  )
}

export function FlagBR({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="60" height="36" fill="#009C3B"/>
      <polygon points="30,4 54,18 30,32 6,18" fill="#FFDF00"/>
      <circle cx="30" cy="18" r="7" fill="#002776"/>
    </svg>
  )
}

export function FlagIT({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="20" height="36" fill="#009246"/>
      <rect x="20" width="20" height="36" fill="#fff"/>
      <rect x="40" width="20" height="36" fill="#CE2B37"/>
    </svg>
  )
}

export function FlagFR({ width = 28, height = 20, className }: Props) {
  return (
    <svg width={width} height={height} viewBox="0 0 60 36" preserveAspectRatio="xMidYMid slice" className={className}>
      <rect width="20" height="36" fill="#0055A4"/>
      <rect x="20" width="20" height="36" fill="#fff"/>
      <rect x="40" width="20" height="36" fill="#EF4135"/>
    </svg>
  )
}

export const FLAG_BY_LOCALE = {
  en: FlagUK,
  es: FlagES,
  pt: FlagBR,
  it: FlagIT,
  fr: FlagFR,
} as const
