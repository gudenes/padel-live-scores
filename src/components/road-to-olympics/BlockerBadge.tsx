'use client'
// src/components/road-to-olympics/BlockerBadge.tsx
//
// Inline "MAIN BLOCKER" badge rendered next to the label on any scorecard row
// where isBlocker === true. Tapping it opens a short popover explaining why
// this row is the critical gap in padel's Olympic case.
//
// Dismiss: outside click, Escape key, or second tap.

import { useRef, useState, useEffect, useCallback, useId } from 'react'
import { BG_CARD, BORDER, CHUNKY } from '@/components/home/shared-constants'

// Warm alert red-orange, distinct from the ORANGE warning colour
const BLOCKER_BG = 'rgba(245, 90, 70, 0.18)'
const BLOCKER_COLOR = '#FF6F4A'

interface BlockerBadgeProps {
  label: string
  explanation: string
}

export default function BlockerBadge({ label, explanation }: BlockerBadgeProps) {
  const [open, setOpen] = useState(false)
  const [positionAbove, setPositionAbove] = useState(true)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

  const close = useCallback(() => setOpen(false), [])

  const checkPosition = useCallback(() => {
    if (!buttonRef.current) return
    const rect = buttonRef.current.getBoundingClientRect()
    setPositionAbove(rect.top > 120)
  }, [])

  const handleToggle = () => {
    if (!open) checkPosition()
    setOpen((prev) => !prev)
  }

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
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        ref={buttonRef}
        onClick={handleToggle}
        aria-expanded={open}
        aria-describedby={open ? popoverId : undefined}
        style={{
          border: 0,
          background: BLOCKER_BG,
          color: BLOCKER_COLOR,
          cursor: 'help',
          font: 'inherit',
          fontSize: 9,
          padding: '2px 7px',
          clipPath: CHUNKY.badge,
          fontWeight: 800,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginLeft: 6,
          display: 'inline-block',
        }}
      >
        {label}
      </button>

      {open && (
        <span
          id={popoverId}
          role="tooltip"
          style={{
            position: 'absolute',
            ...(positionAbove
              ? { bottom: '100%', marginBottom: 8 }
              : { top: '100%', marginTop: 8 }),
            left: 0,
            zIndex: 50,
            width: 250,
            maxWidth: '85vw',
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            clipPath: CHUNKY.card,
            padding: '10px 12px',
            fontSize: 12,
            lineHeight: 1.5,
            color: '#d0d0d0',
            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
            whiteSpace: 'normal',
          }}
        >
          {explanation}
        </span>
      )}
    </span>
  )
}
