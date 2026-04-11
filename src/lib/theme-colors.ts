// src/lib/theme-colors.ts
//
// Single source of truth for all color constants used across the app.
// Each value references a CSS custom property defined in globals.css,
// so toggling the data-theme attribute on <html> automatically switches
// all inline styles between dark and light mode.
//
// USAGE: Replace per-file `const GREEN = '#7ED321'` declarations with:
//   import { GREEN, BG_CARD, MUTED, ... } from '@/lib/theme-colors'

// ── Brand colors (same in both themes, or slightly adjusted) ──
export const GREEN = 'var(--brand-green)'
export const GREEN_DIM = 'var(--brand-green-dim)'
export const ORANGE = 'var(--brand-orange)'
export const LIVE_RED = 'var(--live-red)'
export const MEN_BLUE = 'var(--men-blue)'
export const WOMEN_PURPLE = 'var(--women-purple)'

// ── Backgrounds ───────────────────────────────────────────────
export const BG_BASE = 'var(--bg-base)'
export const BG_CARD = 'var(--bg-card)'
export const BG_CARD2 = 'var(--bg-card-alt)'
export const BG_HEADER = 'var(--bg-header)'
export const BG_SUBTLE = 'var(--bg-subtle)'

// ── Text ──────────────────────────────────────────────────────
export const TEXT_PRIMARY = 'var(--text-primary)'
export const MUTED = 'var(--text-muted)'
export const TEXT_LOSER = 'var(--text-loser)'

// ── Borders ───────────────────────────────────────────────────
export const BORDER = 'var(--border-base)'

// ── Match pair colors ─────────────────────────────────────────
export const PAIR1_COLOR = 'var(--pair1-color)'
export const PAIR2_COLOR = 'var(--pair2-color)'
export const PAIR1_BG = 'var(--pair1-bg)'
export const PAIR2_BG = 'var(--pair2-bg)'
export const PAIR1_BORDER = 'var(--pair1-border)'
export const PAIR2_BORDER = 'var(--pair2-border)'

// ── Chunky clip-path presets (not theme-dependent) ────────────
export const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
  bar: 'polygon(2% 0%, 98% 4%, 100% 100%, 0% 96%)',
} as const
