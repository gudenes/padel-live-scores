'use client'
// src/components/road-to-olympics/CriteriaPillButton.tsx
//
// Tappable pill badge for CriteriaScorecard rows. Renders the status pill
// (Done / On track / Building) as a clickable button. On tap, opens a small
// popover anchored above (or below if near the top of the viewport) with an
// explanation of what the criteria means and why padel scores as it does.
//
// Dismiss: outside click, Escape key, or second tap on the button.
// The 50ms listener delay mirrors Term.tsx so the opening tap doesn't dismiss.

import { useRef, useState, useEffect, useCallback, useId } from 'react'
import { BG_CARD, BORDER, CHUNKY } from '@/components/home/shared-constants'

interface CriteriaPillButtonProps {
  pillText: string
  pillBg: string
  pillColor: string
  explanation: string
}

export default function CriteriaPillButton({
  pillText,
  pillBg,
  pillColor,
  explanation,
}: CriteriaPillButtonProps) {
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
          background: pillBg,
          color: pillColor,
          cursor: 'help',
          font: 'inherit',
          fontSize: 10,
          padding: '3px 7px',
          clipPath: CHUNKY.badge,
          fontWeight: 700,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          // subtle dotted underline signals interactivity
          textDecoration: 'underline dotted',
          textUnderlineOffset: 2,
          display: 'inline-block',
        }}
      >
        {pillText}
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
            right: 0,
            zIndex: 50,
            width: 260,
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
