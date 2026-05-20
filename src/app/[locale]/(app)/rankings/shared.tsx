// src/app/[locale]/(app)/rankings/shared.tsx
// Presentational primitives and pure helpers reused by RankingsTable
// (server), RankingsInteractive (client), and SearchModal (client).

import type { ReactNode } from 'react'

// ── Brand colors ───────────────────────────────────────────────
export const GREEN = '#7ED321'
export const GREEN_DIM = 'rgba(126,211,33,0.15)'
export const ORANGE = '#F5A623'
export const BG_BASE = '#1A1A1A'
export const BG_CARD = '#141414'
export const MUTED = '#6B7280'
export const BORDER = 'rgba(255,255,255,0.06)'
export const MEN_BLUE = '#4A9EFF'
export const WOMEN_PURPLE = '#D966FF'

// ── Chunky clip-path presets ───────────────────────────────────
export const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
} as const

// ── Types ──────────────────────────────────────────────────────
export type RankType = 'official' | 'race'
export type Gender = 'men' | 'women'

export interface Player {
  id: string
  name: string
  display_name?: string | null
  country: string | null
  ranking: number | null
  points: number | null
  ranking_move: number | null
  race_ranking: number | null
  race_points: number | null
  race_move: number | null
  avatar_url: string | null
  category: string | null
  updated_at: string | null
  ranking_date: string | null
}

// ── ISO3 → ISO2 (subset that has flag PNGs in /public/flags) ──
const ISO3_TO_2: Record<string, string> = {
  ESP: 'es', ARG: 'ar', BRA: 'br', POR: 'pt', FRA: 'fr', ITA: 'it',
  BEL: 'be', NLD: 'nl', GER: 'de', GBR: 'gb', DEN: 'dk', SWE: 'se',
  URU: 'uy', PAR: 'py', CHI: 'cl', MEX: 'mx', USA: 'us', AUS: 'au',
  QAT: 'qa',
}

// Cache one Intl.DisplayNames instance per locale to avoid re-allocation.
const displayNamesCache = new Map<string, Intl.DisplayNames>()
function getDisplayNames(locale: string): Intl.DisplayNames {
  let dn = displayNamesCache.get(locale)
  if (!dn) {
    dn = new Intl.DisplayNames([locale], { type: 'region' })
    displayNamesCache.set(locale, dn)
  }
  return dn
}

/**
 * Resolve a country code to a localized name. Accepts ISO2 or ISO3.
 * Falls back to the raw code (uppercased) if Intl can't resolve it.
 */
export function countryNameForLocale(code: string | null, locale: string): string {
  if (!code) return 'Unknown'
  const upper = code.toUpperCase()
  const iso2 = upper.length === 3 ? ISO3_TO_2[upper] : upper.length === 2 ? upper.toLowerCase() : null
  const dn = getDisplayNames(locale)
  try {
    if (iso2) {
      const resolved = dn.of(iso2.toUpperCase())
      if (resolved && resolved !== iso2.toUpperCase()) return resolved
    }
    const resolved = dn.of(upper)
    if (resolved && resolved !== upper) return resolved
  } catch {
    // Intl threw on invalid code — fall through to raw
  }
  return upper
}

/** Path to a flag PNG in /public/flags, or null when unknown. */
export function countryFlagUrl(code: string | null): string | null {
  if (!code) return null
  const upper = code.toUpperCase()
  const iso2 = ISO3_TO_2[upper] ?? (upper.length === 2 ? upper.toLowerCase() : null)
  if (!iso2) return null
  return `/flags/${iso2}.png`
}

// ── Presentational primitives ──────────────────────────────────

export function RankBadge({ rank }: { rank: number | null }): ReactNode {
  if (!rank) {
    return <span style={{ color: MUTED, fontSize: 14 }}>--</span>
  }
  const isTop3 = rank <= 3
  const color = rank === 1 ? '#F5A623' : rank === 2 ? '#94A3B8' : rank === 3 ? '#CD7F32' : GREEN
  return (
    <span style={{
      fontWeight: 800, fontSize: isTop3 ? 17 : 15,
      color,
      display: 'block', textAlign: 'right',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {rank}
    </span>
  )
}

export function DeltaChip({ delta }: { delta: number }): ReactNode {
  if (delta === 0) {
    return <span style={{ fontSize: 9, color: MUTED, fontWeight: 600, lineHeight: 1 }}>--</span>
  }
  const up = delta > 0
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, lineHeight: 1,
      color: up ? GREEN : '#FF4655',
      display: 'flex', alignItems: 'center', gap: 1,
    }}>
      {up ? '▲' : '▼'}{Math.abs(delta)}
    </span>
  )
}
