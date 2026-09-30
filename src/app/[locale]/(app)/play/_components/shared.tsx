'use client'
// src/app/[locale]/(app)/play/_components/shared.tsx
//
// Small pieces every Play screen needs: the class-driven press button,
// number/price formatting, relative timestamps and the blank states.
//
// `Press` is NOT src/components/PressButton.tsx. That one drives colour and
// shape through inline styles, which suits one-off CTAs. Play composes from
// the named classes in globals.css (`shape-* intent-* size-*`), which is
// what the design system's mockups specify. Same three-node markup, same
// :active behaviour — different authoring model.

import type { ReactNode } from 'react'

// ── Press button ────────────────────────────────────────────────

export type PressShape = 'shape-chunky-tilted' | 'shape-pill'
export type PressIntent = 'intent-primary' | 'intent-live' | 'intent-neutral' | 'intent-ghost'
export type PressSize = 'size-sm' | 'size-md' | 'size-lg'

export interface PressProps {
  children: ReactNode
  shape?: PressShape
  intent?: PressIntent
  size?: PressSize
  /** Adds `btn-round` — the 58px circular YES/NO buttons. */
  round?: boolean
  /** Sets data-block="1" → display:block; width:100%. */
  block?: boolean
  disabled?: boolean
  onClick?: () => void
  ariaExpanded?: boolean
  ariaHasPopup?: "dialog"
  ariaLabel?: string
  className?: string
}

export function Press({
  children,
  shape = 'shape-chunky-tilted',
  intent = 'intent-primary',
  size = 'size-md',
  round = false,
  block = false,
  disabled = false,
  onClick,
  ariaLabel,
  ariaExpanded,
  ariaHasPopup,
  className,
}: PressProps) {
  const classes = ['pn-press', shape, intent, size]
  if (round) classes.push('btn-round')
  if (className) classes.push(className)
  return (
    <button
      type="button"
      className={classes.join(' ')}
      {...(block ? { 'data-block': '1' } : {})}
      disabled={disabled}
      onClick={onClick}
      aria-label={ariaLabel}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
    >
      <span className="pn-press-skirt" />
      <span className="pn-press-face">{children}</span>
    </button>
  )
}

// ── Formatting ──────────────────────────────────────────────────

/** Grouped integer in the active locale. Guacas are always whole. */
export function formatGuacas(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(Math.round(n))
}

/** Share counts can be fractional in the DB; one decimal is plenty. */
export function formatShares(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)
}

/** A 0..1 price as the two-decimal per-share figure users trade on. */
export function formatPrice(p: number): string {
  return p.toFixed(2)
}

/** A 0..1 probability as a whole percentage. */
export function toPct(p: number): number {
  return Math.round(p * 100)
}

/**
 * Compact "how long ago" for the activity feed: 12s · 4m · 3h · 2d.
 * `nowMs` is passed in rather than read from Date.now() inside so a list
 * render produces one consistent clock and never causes a hydration split.
 */
export function relativeShort(
  iso: string | null,
  nowMs: number,
  labels: { now: string; s: (n: number) => string; m: (n: number) => string; h: (n: number) => string; d: (n: number) => string },
): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((nowMs - then) / 1000))
  if (secs < 5) return labels.now
  if (secs < 60) return labels.s(secs)
  const mins = Math.round(secs / 60)
  if (mins < 60) return labels.m(mins)
  const hours = Math.round(mins / 60)
  if (hours < 24) return labels.h(hours)
  return labels.d(Math.round(hours / 24))
}

// ── Blank states ────────────────────────────────────────────────

export type BlankIcon = 'deck' | 'wallet' | 'pulse' | 'trophy' | 'warning'

function BlankGlyph({ icon }: { icon: BlankIcon }) {
  switch (icon) {
    case 'wallet':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18a2 2 0 0 1 2 2v1" />
          <rect x="3" y="8" width="18" height="11" rx="2" />
          <path d="M16.5 13.5h.01" />
        </svg>
      )
    case 'pulse':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M3 12h4l2.5-6 4 12L16 12h5" />
        </svg>
      )
    case 'trophy':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      )
    case 'warning':
      return (
        <svg viewBox="0 0 24 24">
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4" />
          <path d="M12 17h.01" />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 24 24">
          <rect x="2.8" y="7.2" width="11.4" height="13.6" rx="2" />
          <path d="M8.4 4.6h9.2a2 2 0 0 1 2 2v9.6" />
        </svg>
      )
  }
}

export function Blank({
  icon = 'deck',
  title,
  body,
  action,
}: {
  icon?: BlankIcon
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="pl-blank">
      <div className="pl-blank-icon">
        <BlankGlyph icon={icon} />
      </div>
      <h4>{title}</h4>
      <p>{body}</p>
      {action && <div className="pl-blank-cta">{action}</div>}
    </div>
  )
}

/** Shimmering placeholder used while a screen's first fetch is in flight. */
export function SkeletonList({ rows = 4, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 14px' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="pl-skel" style={{ height }} aria-hidden />
      ))}
    </div>
  )
}
