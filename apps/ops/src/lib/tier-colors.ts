// apps/ops/src/lib/tier-colors.ts
//
// Tier → bar colors, shared by the Tournament Explorer calendar and the
// Data Readiness calendar. Medal-themed for FIP, warm/saturated for Premier
// so headline events pop. Kept as one source of truth (DRY).

export interface TierColor { bg: string; border: string; text: string }

export const TIER_COLOR: Record<string, TierColor> = {
  major:        { bg: '#FF4655', border: '#C8313D', text: '#fff' },
  p1:           { bg: '#FF6B2B', border: '#CC5A23', text: '#fff' },
  p2:           { bg: '#F5A623', border: '#C2841C', text: '#000' },
  finals:       { bg: '#7C2D8E', border: '#5C2169', text: '#fff' },
  fip_platinum: { bg: '#9CA3AF', border: '#6B7280', text: '#000' },
  fip_gold:     { bg: '#D4AF37', border: '#A88A2B', text: '#000' },
  fip_silver:   { bg: '#C0C0C0', border: '#919191', text: '#000' },
  fip_bronze:   { bg: '#CD7F32', border: '#9F6325', text: '#fff' },
  fip_other:    { bg: '#94A3B8', border: '#64748B', text: '#fff' },
}

export const DEFAULT_TIER_COLOR: TierColor = {
  bg: 'var(--bg-hover)', border: 'var(--border-strong)', text: 'var(--text-2)',
}

/** Short tag label for a tier code, e.g. "P1", "Gold". */
export function tierTag(level: string | null): string {
  switch (level) {
    case 'major': return 'M'
    case 'p1': return 'P1'
    case 'p2': return 'P2'
    case 'finals': return 'F'
    case 'fip_platinum': return 'Pt'
    case 'fip_gold': return 'G'
    case 'fip_silver': return 'S'
    case 'fip_bronze': return 'B'
    default: return '·'
  }
}
