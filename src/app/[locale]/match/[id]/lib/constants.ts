// V3 brand colors, pair identity colors, chunky clip-paths, and score-flash tracking maps.

// ── V3 Brand colors ──────────────────────────────────────────────────────────
export const GREEN = '#7ED321'
export const GREEN_DIM = 'rgba(126,211,33,0.15)'
export const ORANGE = '#F5A623'
export const LIVE_RED = '#FF4655'
export const BG_BASE = '#1A1A1A'
export const BG_CARD = '#141414'
export const MUTED = '#6B7280'
export const BORDER = 'rgba(255,255,255,0.06)'
export const MEN_BLUE = '#4A9EFF'
export const WOMEN_PURPLE = '#D966FF'

// ── Pair identity colors ─────────────────────────────────────────────────────
export const PAIR1_COLOR = '#FF6B2B'         // brand orange
export const PAIR2_COLOR = '#FFD166'         // brand yellow
export const PAIR1_BG    = 'rgba(255,107,43,0.08)'
export const PAIR2_BG    = 'rgba(255,209,102,0.08)'
export const PAIR1_BORDER = 'rgba(255,107,43,0.28)'
export const PAIR2_BORDER = 'rgba(255,209,102,0.28)'

// ── Chunky clip-path presets ─────────────────────────────────────────────────
export const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

// ── Score-flash tracking (module-level, survives remounts) ───────────────────
export const PT_ORD: Record<string, number> = { '0': 0, '15': 1, '30': 2, '40': 3, 'A': 4, 'AD': 4 }
export const _matchPrevScores = new Map<string, { p1Games: number; p2Games: number; p1Pts: string; p2Pts: string }>()
