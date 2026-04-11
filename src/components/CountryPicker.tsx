'use client'
// src/components/CountryPicker.tsx
//
// Branded custom dropdown for picking the user's region. Native <select>
// can't render images or colored SVGs in <option> elements (browser
// limitation), so this is a custom replacement that supports:
//
// - Real flag images (from flagcdn.com, same source the rest of the
//   app uses for FlagImg)
// - A green stroke "map pin" SVG for the auto/use-my-location option
// - Click-outside-to-close
// - Keyboard escape to close
// - Scrollable list capped at ~280px so it doesn't dominate the screen
// - Mobile-friendly (positioned below the trigger, doesn't try to
//   anchor to viewport edges)

import { useEffect, useRef, useState } from 'react'
import { GREEN, MUTED, BG_CARD, BG_CARD2, BORDER, CHUNKY } from '@/lib/theme-colors'

export interface CountryOption {
  iso2: string
  name: string
}

interface CountryPickerProps {
  options: CountryOption[]
  value: string                              // '' means "auto"
  onChange: (value: string) => void | Promise<void>
  disabled?: boolean
}

const CHUNKY_BUTTON = CHUNKY.button

export default function CountryPicker({ options, value, onChange, disabled }: CountryPickerProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  // Look up the currently selected option (or null = auto)
  const selected = value ? options.find(c => c.iso2 === value) ?? null : null

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* ── Trigger button (closed state shows current selection) ── */}
      <button
        type="button"
        onClick={() => !disabled && setOpen(o => !o)}
        disabled={disabled}
        style={{
          width: '100%',
          background: BG_CARD,
          color: '#fff',
          border: `1px solid ${BORDER}`,
          padding: '10px 12px',
          fontSize: 13,
          fontFamily: 'inherit',
          clipPath: CHUNKY_BUTTON,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CurrentDisplay selected={selected} />
        <span style={{ flex: 1 }} />
        <Chevron open={open} />
      </button>

      {/* ── Popover dropdown list ── */}
      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            clipPath: CHUNKY_BUTTON,
            maxHeight: 280,
            overflowY: 'auto',
            zIndex: 50,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
          }}
        >
          {/* Auto option (always at the top) */}
          <Option
            isAuto
            isSelected={value === ''}
            onClick={() => {
              void onChange('')
              setOpen(false)
            }}
          />

          {/* Divider */}
          <div style={{ height: 1, background: BORDER, margin: '2px 0' }} />

          {/* Country options */}
          {options.map(c => (
            <Option
              key={c.iso2}
              country={c}
              isSelected={value === c.iso2}
              onClick={() => {
                void onChange(c.iso2)
                setOpen(false)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function CurrentDisplay({ selected }: { selected: CountryOption | null }) {
  if (selected) {
    return (
      <>
        <FlagImg country={selected.iso2} size={20} />
        <span style={{ color: '#fff', fontSize: 13 }}>{selected.name}</span>
      </>
    )
  }
  return (
    <>
      <LocationIcon />
      <span style={{ color: '#fff', fontSize: 13 }}>Use my location (auto)</span>
    </>
  )
}

function Option({
  country,
  isAuto = false,
  isSelected,
  onClick,
}: {
  country?: CountryOption
  isAuto?: boolean
  isSelected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="option"
      aria-selected={isSelected}
      style={{
        width: '100%',
        background: isSelected ? BG_CARD2 : 'transparent',
        color: '#fff',
        border: 'none',
        padding: '10px 14px',
        fontSize: 13,
        fontFamily: 'inherit',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        textAlign: 'left',
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'transparent'
      }}
    >
      {isAuto ? <LocationIcon /> : country && <FlagImg country={country.iso2} size={20} />}
      <span style={{ flex: 1 }}>{isAuto ? 'Use my location (auto)' : country?.name}</span>
      {isSelected && <Check />}
    </button>
  )
}

function FlagImg({ country, size }: { country: string; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${country.toLowerCase()}.png`}
      alt=""
      width={size}
      height={Math.round(size * 0.75)}
      style={{
        width: size,
        height: Math.round(size * 0.75),
        objectFit: 'cover',
        flexShrink: 0,
        borderRadius: 1,
      }}
    />
  )
}

function LocationIcon() {
  // Lucide-style stroke "map-pin", colored with the brand green.
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke={GREEN}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={MUTED}
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{
        flexShrink: 0,
        transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 0.15s',
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

function Check() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={GREEN}
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
