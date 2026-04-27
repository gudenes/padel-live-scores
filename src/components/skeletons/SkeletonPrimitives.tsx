// src/components/skeletons/SkeletonPrimitives.tsx
//
// Shared shimmer primitives used by every per-tab `loading.tsx`. Each
// page's loading state composes these into a layout that mirrors the
// real page's first paint, so tapping a tab in BottomNav produces an
// instant skeleton that the real content swaps into without shifting.
//
// All primitives are server-renderable (no hooks, no "use client") so
// loading.tsx files stay light and ship over the wire as static markup.

import type { CSSProperties } from 'react'

const BG_CARD = '#141414'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

// Pulsing keyframe — defined once via dangerouslySetInnerHTML on each
// loading page (cheap and side-effect-free). Honours
// prefers-reduced-motion.
export const SKELETON_KEYFRAMES = `
@keyframes skel-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.85; }
}
@media (prefers-reduced-motion: reduce) {
  .skel-block { animation: none !important; }
}
`

export function SkeletonBlock({
  width,
  height,
  mt = 0,
  ml = 0,
  rounded = false,
  shape = 'badge',
}: {
  width: number | string
  height: number
  mt?: number
  ml?: number
  rounded?: boolean
  shape?: 'badge' | 'card' | 'pill'
}) {
  const clipPath =
    shape === 'card'
      ? CHUNKY_CARD
      : shape === 'pill'
        ? 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)'
        : CHUNKY_BADGE
  return (
    <div
      className="skel-block"
      style={{
        width,
        height,
        marginTop: mt,
        marginLeft: ml,
        background: 'rgba(255,255,255,0.05)',
        clipPath: rounded ? undefined : clipPath,
        borderRadius: rounded ? 999 : undefined,
        animation: 'skel-pulse 1.4s ease-in-out infinite',
      }}
    />
  )
}

export function SkeletonCard({
  height = 120,
  style,
}: {
  height?: number
  style?: CSSProperties
}) {
  return (
    <div
      className="skel-block"
      style={{
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        clipPath: CHUNKY_CARD,
        height,
        animation: 'skel-pulse 1.4s ease-in-out infinite',
        ...style,
      }}
    />
  )
}

export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ maxWidth: 500, margin: '0 auto', background: '#1A1A1A', minHeight: '100vh' }}>
      <style dangerouslySetInnerHTML={{ __html: SKELETON_KEYFRAMES }} />
      {children}
    </div>
  )
}

/** Faux app header that matches the sticky bar on home/matches/feed. */
export function SkeletonAppHeader() {
  return (
    <div
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: '#0A0A0A',
        height: 62,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        boxShadow: '0 1px 8px rgba(0,0,0,0.5)',
      }}
    >
      <SkeletonBlock width={88} height={36} />
      <div style={{ flex: 1 }}>
        <SkeletonBlock width="100%" height={36} />
      </div>
      <SkeletonBlock width={36} height={36} rounded />
    </div>
  )
}
