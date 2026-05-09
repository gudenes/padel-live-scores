'use client'
// src/components/road-to-olympics/Term.tsx
//
// Inline tap-to-define tooltip for acronyms on Road-to-Olympics surfaces.
// Renders the abbreviation as a dotted-underlined button. Tap opens a small
// popover anchored above (or below if near the top of the viewport) the term.
//
// Dismiss: outside click, Escape key, or second tap on the button.
// The 50ms listener delay mirrors BadgeTooltip.tsx so the opening tap
// doesn't immediately close the popover.

import { useRef, useState, useEffect, useCallback, useId } from 'react'
import { BG_CARD, BORDER, CHUNKY } from '@/components/home/shared'

interface TermProps {
  short: string
  definition: string
}

export default function Term({ short, definition }: TermProps) {
  const [open, setOpen] = useState(false)
  const [positionAbove, setPositionAbove] = useState(true)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  const close = useCallback(() => setOpen(false), [])

  // Position check: if button is near top of viewport, show below
  const checkPosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    // If less than 120px from top, show below; otherwise show above
    setPositionAbove(rect.top > 120)
  }, [])

  const handleToggle = () => {
    if (!open) checkPosition()
    setOpen((prev) => !prev)
  }

  // Dismiss on outside click + Escape key
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        close()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
    }
    // 50ms delay — mirrors BadgeTooltip so opening tap doesn't dismiss immediately
    const t = setTimeout(() => {
      document.addEventListener('click', onClick)
      document.addEventListener('keydown', onKey)
    }, 50)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  return (
    <span style={{ position: 'relative', display: 'inline' }}>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        style={{
          all: 'unset',
          textDecoration: 'underline dotted',
          textUnderlineOffset: 2,
          cursor: 'help',
          color: 'inherit',
          font: 'inherit',
          display: 'inline',
        }}
      >
        {short}
      </button>

      {open && (
        <span
          id={popoverId}
          role="tooltip"
          style={{
            position: 'absolute',
            ...(positionAbove
              ? { bottom: '100%', marginBottom: 6 }
              : { top: '100%', marginTop: 6 }),
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            width: 240,
            maxWidth: '80vw',
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            clipPath: CHUNKY.card,
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.5,
            color: '#d0d0d0',
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
            // Prevent clipping by overflow:hidden ancestors by staying in flow
            whiteSpace: 'normal',
          }}
        >
          {definition}
        </span>
      )}
    </span>
  )
}
