// src/components/FlagImage.tsx
// Shared country-flag renderer with local-first + flagcdn.com fallback.
//
// Why: public/flags/ ships ~58 PNGs for padel-active countries to keep
// the bundle small. Players from countries outside that set (Kazakhstan,
// Greece, Senegal, etc. — ~70 players across 18 countries at last count)
// were 404'ing and showing broken-image glyphs.
//
// Rendering order:
//   1. Try local /flags/{code}.png — fast, same-origin, CDN-cached
//   2. On error, fall back to flagcdn.com at 2x the rendered size (retina)
//
// This replaces ten near-identical inline `FlagImg` functions previously
// scattered across match, player, tournament, ranking, home, etc.

import type { CSSProperties } from 'react'

interface Props {
  /** ISO 3166-1 alpha-2 country code (case-insensitive). null renders a placeholder. */
  country: string | null | undefined
  /** Rendered width in px. Height derives as size × 0.75 (4:3 flag aspect). */
  size?: number
  /** Optional small border radius (used on the home rankings rows). */
  rounded?: boolean
  /** Escape hatch for the rare case where a caller needs extra styling. */
  style?: CSSProperties
}

// flagcdn.com serves raster PNGs only at these widths (2025 catalog).
// See https://flagcdn.com. Requesting any other value 404s.
const FLAGCDN_WIDTHS = [20, 40, 80, 160, 320, 640, 1280, 2560]

/** Smallest flagcdn-supported width ≥ 2× the rendered size (retina-quality). */
export function flagcdnWidth(size: number): number {
  const target = size * 2
  for (const w of FLAGCDN_WIDTHS) if (w >= target) return w
  return FLAGCDN_WIDTHS[FLAGCDN_WIDTHS.length - 1]
}

export function FlagImage({ country, size = 16, rounded = false, style }: Props) {
  if (!country) {
    return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  }

  const code = country.toLowerCase()
  // flagcdn.com serves only a fixed set of widths — arbitrary values 404.
  // Pick the smallest supported size that gives ≥ 2x the rendered width
  // (retina-quality without over-fetching).
  const cdnWidth = flagcdnWidth(size)

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      loading="lazy"
      onError={(e) => {
        const img = e.currentTarget
        if (img.dataset.fbTried) return
        img.dataset.fbTried = '1'
        img.src = `https://flagcdn.com/w${cdnWidth}/${code}.png`
      }}
      style={{
        objectFit: 'cover',
        display: 'block',
        flexShrink: 0,
        ...(rounded ? { borderRadius: 2 } : {}),
        ...style,
      }}
    />
  )
}
