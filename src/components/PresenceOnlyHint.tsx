// PresenceOnlyHint — small info-icon trigger that opens a chunky info
// popover explaining why a FIP-tier match shows ON COURT without any
// live point-by-point data ticking. Mirrors the LateHintPill visual
// pattern (clip-path, gradient, accent-tinted inner shadow, 4.5s
// auto-dismiss, Escape-to-close, posthog shown/tapped events).
//
// Two render variants:
//   - 'row'  → compact, sits next to the ON COURT chip on a MatchCard row
//   - 'hero' → slightly larger label, used on the match-detail hero
//
// The popover renders through a React portal into document.body so it
// escapes the MatchCard's clipPath (which creates a stacking context AND
// visually clips descendants — z-index can't fix either). The position
// is computed from the trigger's bounding-rect each time it opens, and
// clamped to the viewport so it doesn't overflow on narrow screens.

'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import posthog from 'posthog-js'

const ORANGE = '#F5A623'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const POPOVER_MAX_WIDTH = 280
const POPOVER_MARGIN = 8

const POP_KEYFRAMES = `
@keyframes presence-only-hint-pop {
  0%   { opacity: 0; transform: translateY(-4px) scale(0.96); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
`

export interface PresenceOnlyHintProps {
  matchId: string
  variant?: 'row' | 'hero'
}

export default function PresenceOnlyHint({ matchId, variant = 'row' }: PresenceOnlyHintProps) {
  const t = useTranslations('match.presenceOnly')
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 })
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setMounted(true) }, [])

  // Fire 'shown' once per mount. `variant` is fixed per render-site
  // (a row never becomes a hero), so we intentionally omit it from
  // the dep array — including it would re-fire the analytics event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    posthog.capture('presence_only_live_shown', { matchId, variant })
  }, [matchId])

  // Position the popover when it opens. useLayoutEffect avoids first-paint
  // flicker — we set position before the browser paints.
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    const popWidth = Math.min(POPOVER_MAX_WIDTH, window.innerWidth - 2 * POPOVER_MARGIN)
    // Center horizontally under the trigger, then clamp to viewport so
    // the right edge never extends off-screen.
    let left = rect.left + rect.width / 2 - popWidth / 2
    const maxLeft = window.innerWidth - popWidth - POPOVER_MARGIN
    if (left > maxLeft) left = maxLeft
    if (left < POPOVER_MARGIN) left = POPOVER_MARGIN
    setPos({ left, top: rect.bottom + 6 })
  }, [open])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen((prev) => !prev)
    if (!open) {
      posthog.capture('presence_only_live_tapped', { matchId, variant })
    }
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    if (!open) {
      dismissTimerRef.current = setTimeout(() => setOpen(false), 4500)
    }
  }

  useEffect(() => () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current) }, [])

  // Escape closes; click outside the popover (anywhere else on screen)
  // also closes. Both registered only while open.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      if (buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const iconSize = variant === 'hero' ? 16 : 14
  const popoverWidth = Math.min(POPOVER_MAX_WIDTH, typeof window !== 'undefined' ? window.innerWidth - 2 * POPOVER_MARGIN : POPOVER_MAX_WIDTH)

  return (
    <>
      <style>{POP_KEYFRAMES}</style>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        aria-label={t('ariaLabel')}
        aria-expanded={open}
        style={{
          width: 32,
          height: 32,
          padding: 0,
          border: 0,
          background: 'transparent',
          color: ORANGE,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.85,
        }}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01" />
          <path d="M11 12h1v4h1" />
        </svg>
      </button>
      {open && mounted && createPortal(
        <div
          ref={popoverRef}
          role="tooltip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
          style={{
            position: 'fixed',
            left: pos.left,
            top: pos.top,
            zIndex: 9999,
            width: popoverWidth,
            padding: '10px 12px 10px 14px',
            backgroundColor: '#131316',
            backgroundImage: 'linear-gradient(135deg, #1A1A1D 0%, #131316 100%)',
            clipPath: CHUNKY_BADGE,
            boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 0 24px ${ORANGE}10`,
            cursor: 'pointer',
            animation: 'presence-only-hint-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8h.01" />
              <path d="M11 12h1v4h1" />
            </svg>
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{
              fontSize: 9,
              fontWeight: 800,
              color: ORANGE,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              marginBottom: 3,
              lineHeight: 1.2,
            }}>
              {t('popoverTitle')}
            </div>
            <div style={{
              color: '#D8D8DD',
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.4,
            }}>
              {t('popoverBody')}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
