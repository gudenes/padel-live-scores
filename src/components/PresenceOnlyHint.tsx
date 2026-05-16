// PresenceOnlyHint — small dotted-underline trigger that opens a chunky
// info popover explaining why a FIP-tier match shows ON COURT without
// any live point-by-point data ticking. Mirrors the LateHintPill visual
// pattern (clip-path, gradient, accent-tinted inner shadow, 4.5s
// auto-dismiss, Escape-to-close, posthog shown/tapped events).
//
// Two render variants:
//   - 'row'  → compact, sits next to the ON COURT chip on a MatchCard row
//   - 'hero' → slightly larger label, used on the match-detail hero
//
// The trigger is always orange (matches the ON COURT badge color) so
// the user can map "this hint belongs to that badge" visually.

'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import posthog from 'posthog-js'

const ORANGE = '#F5A623'

// Local copies of the chunky-popover primitives — kept inline because
// only this file and MatchCard's LateHintPill currently use them. If a
// third hint surfaces, extract to a shared <ChunkyHintPopover> primitive.
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const POP_KEYFRAMES = `
@keyframes presence-only-hint-pop {
  0%   { opacity: 0; transform: translateY(-4px) scale(0.95); }
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
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fire 'shown' once per mount
  useEffect(() => {
    posthog.capture('presence_only_live_shown', { matchId, variant })
  }, [matchId, variant])

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

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const labelFontSize = variant === 'hero' ? 10 : 9
  const popoverRight = variant === 'hero' ? 0 : 12
  const popoverBottom = variant === 'hero' ? -8 : 6

  return (
    <>
      <style>{POP_KEYFRAMES}</style>
      <button
        type="button"
        onClick={handleClick}
        aria-label={t('ariaLabel')}
        aria-expanded={open}
        style={{
          marginTop: 2,
          padding: '4px 0',
          border: 0,
          background: 'transparent',
          color: ORANGE,
          opacity: 0.85,
          fontSize: labelFontSize,
          fontWeight: 600,
          letterSpacing: 0.2,
          cursor: 'pointer',
          borderBottom: `1px dotted ${ORANGE}66`,
          lineHeight: 1.2,
          alignSelf: variant === 'hero' ? 'center' : 'flex-end',
        }}
      >
        {t('label')}
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
          style={{
            position: 'absolute',
            right: popoverRight,
            bottom: popoverBottom,
            zIndex: 4,
            maxWidth: 260,
            padding: '10px 12px 10px 14px',
            background: 'linear-gradient(135deg, #1A1A1D 0%, #131316 100%)',
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
            {/* Info circle: outline + 'i' glyph, no emoji per project convention */}
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8h.01" />
              <path d="M11 12h1v4h1" />
            </svg>
          </span>
          <div style={{ minWidth: 0 }}>
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
        </div>
      )}
    </>
  )
}
