// src/components/home/shared-constants.ts
//
// Plain string / object constants extracted from shared.tsx so server
// components can import them without crossing the React Server Components
// client/server boundary. shared.tsx has 'use client' (because it exports
// React components that use hooks); when a server component imports a
// string constant from it, Next.js can sometimes leave a runtime client-
// reference instead of inlining the value, which then throws at render
// time with: "Attempted to call X() from the server but X is on the client."
//
// All consumers that ONLY need constants (not the React components or
// hooks-using helpers) should import from THIS file. shared.tsx still
// works for client components.

// ── Brand colors ───────────────────────────────────────────────
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

// ── Chunky clip-path presets ───────────────────────────────────
export const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  bar: 'polygon(2% 0%, 98% 4%, 100% 100%, 0% 96%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
  section: 'polygon(0% 2%, 100% 0%, 100% 98%, 0% 100%)',
}
