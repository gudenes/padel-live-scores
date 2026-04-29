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
//
// Country-code policy (defence in depth): the prop accepts alpha-2
// ("ES", "JP") OR alpha-3 IOC/ISO ("ESP", "JPN", "INA", "HKG"). The
// component runs every input through `normalizeCountry()` before the
// lookup. That means callers can pass whatever the upstream source
// gave them — the FIP draw bracket carries alpha-3, padelapi carries
// alpha-2, players.country is alpha-2, and `pair*_player*_country`
// thin-match rows are alpha-3 — and a flag still resolves regardless.
// Unknown codes resolve to null → empty placeholder span (no broken
// image glyph), same fallback as null input.

import type { CSSProperties } from 'react'
import { normalizeCountry } from '@/lib/country'

interface Props {
  /**
   * Country code, alpha-2 OR alpha-3 IOC/ISO (case-insensitive).
   * `null` renders an empty placeholder. Unknown codes also render the
   * placeholder rather than a broken-image glyph.
   */
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
  // Normalise alpha-3 IOC/ISO ("ESP", "INA", "HKG") down to the alpha-2
  // form `/flags/<code>.png` is keyed on. `normalizeCountry` returns
  // null for empty/unknown input, so a passed alpha-3 we don't have a
  // mapping for falls back to the placeholder instead of a broken
  // <img>. See `src/lib/country.ts` for the canonical map.
  const alpha2 = normalizeCountry(country)
  if (!alpha2) {
    return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  }

  const code = alpha2.toLowerCase()
  // flagcdn.com serves only a fixed set of widths — arbitrary values 404.
  // Pick the smallest supported size that gives ≥ 2x the rendered width
  // (retina-quality without over-fetching).
  const cdnWidth = flagcdnWidth(size)

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${code}.png`}
      alt={alpha2}
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
