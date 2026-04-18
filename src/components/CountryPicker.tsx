'use client'
// src/components/CountryPicker.tsx
//
// Branded searchable region picker. Native <select> can't render flag
// images and doesn't support inline search, so this is a custom combobox.
//
// Features:
// - Flag images with the V3 chunky badge clip-path (same silhouette as
//   every other flag chip across the app)
// - Typeahead filter — user types, list narrows (case- + diacritic-
//   insensitive match on country name OR ISO code)
// - "Use my location (auto)" option pinned at the top
// - Click-outside / Escape to close
// - Keyboard navigation: ↑ ↓ to move highlight, Enter to commit
// - Empty-state message when the filter matches nothing
//
// Mobile-friendly: input auto-focuses on open, popover anchored below
// the trigger, max-height 280px.
//
// The trigger and popover share the V3 CHUNKY_BUTTON clip-path so the
// whole thing reads as one unit.

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'

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

const GREEN = '#7ED321'
const MUTED = '#6B7280'
const BG_CARD = '#141414'
const BG_CARD2 = '#0F0F0F'
const BORDER = 'rgba(255,255,255,0.10)'

const CHUNKY_BUTTON = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'
// Same angular shape BadgeIcon uses — matches the rest of the app's chunky flags.
const CHUNKY_FLAG = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'

// Normalize a string for fuzzy search: lowercase + strip diacritics.
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

export default function CountryPicker({ options, value, onChange, disabled }: CountryPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Close on click outside / Escape
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey as unknown as EventListener)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey as unknown as EventListener)
    }
  }, [open])

  // Focus the search input when opening + reset query
  useEffect(() => {
    if (open) {
      setQuery('')
      setHighlight(0)
      // rAF ensures the input exists before focusing
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const selected = value ? options.find(c => c.iso2 === value) ?? null : null

  // Filtered option list. Empty query = all options; the auto-option is
  // rendered separately so it stays above the divider.
  const filtered = useMemo(() => {
    const q = norm(query.trim())
    if (!q) return options
    return options.filter(c =>
      norm(c.name).includes(q) || c.iso2.toLowerCase().includes(q),
    )
  }, [options, query])

  // Keep highlight in range when the filter changes
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(Math.max(0, filtered.length - 1))
  }, [filtered.length, highlight])

  // Scroll highlighted item into view
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.querySelector<HTMLElement>(`[data-idx="${highlight}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlight, filtered.length])

  function commit(iso2: string) {
    void onChange(iso2)
    setOpen(false)
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight(h => Math.min(h + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight(h => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtered[highlight]
      if (item) commit(item.iso2)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
      {/* ── Trigger (closed) ── */}
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
        {selected ? (
          <>
            <ChunkyFlag country={selected.iso2} size={22} />
            <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>{selected.name}</span>
          </>
        ) : (
          <>
            <LocationIcon />
            <span style={{ color: '#fff', fontSize: 13, flex: 1 }}>Use my location (auto)</span>
          </>
        )}
        <Chevron open={open} />
      </button>

      {/* ── Popover ── */}
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            background: BG_CARD,
            border: `1px solid ${BORDER}`,
            clipPath: CHUNKY_BUTTON,
            zIndex: 50,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Search input */}
          <div style={{ padding: 10, borderBottom: `1px solid ${BORDER}` }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: BG_CARD2,
              border: `1px solid ${BORDER}`,
              padding: '6px 10px',
              clipPath: CHUNKY_BUTTON,
            }}>
              <SearchIcon />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => { setQuery(e.target.value); setHighlight(0) }}
                onKeyDown={onInputKey}
                placeholder="Search country…"
                aria-label="Search country"
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  color: '#fff',
                  fontSize: 13,
                  fontFamily: 'inherit',
                  padding: 0,
                }}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); inputRef.current?.focus() }}
                  aria-label="Clear search"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: MUTED,
                    cursor: 'pointer',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <ClearIcon />
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div
            ref={listRef}
            role="listbox"
            style={{ maxHeight: 240, overflowY: 'auto', padding: '4px 0' }}
          >
            {/* Auto option — always first, only shown when query is empty */}
            {query.trim() === '' && (
              <>
                <Option
                  isAuto
                  isSelected={value === ''}
                  onClick={() => commit('')}
                />
                <div style={{ height: 1, background: BORDER, margin: '2px 8px' }} />
              </>
            )}

            {filtered.length === 0 ? (
              <div style={{
                padding: '16px 14px',
                fontSize: 12,
                color: MUTED,
                textAlign: 'center',
              }}>
                No country matches "{query}"
              </div>
            ) : (
              filtered.map((c, idx) => (
                <Option
                  key={c.iso2}
                  country={c}
                  isSelected={value === c.iso2}
                  isHighlighted={idx === highlight}
                  dataIdx={idx}
                  onClick={() => commit(c.iso2)}
                  onMouseEnter={() => setHighlight(idx)}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Sub-components ─────────────────────────────────────────────

function Option({
  country,
  isAuto = false,
  isSelected,
  isHighlighted,
  dataIdx,
  onClick,
  onMouseEnter,
}: {
  country?: CountryOption
  isAuto?: boolean
  isSelected: boolean
  isHighlighted?: boolean
  dataIdx?: number
  onClick: () => void
  onMouseEnter?: () => void
}) {
  const bg = isSelected
    ? BG_CARD2
    : isHighlighted
      ? 'rgba(255,255,255,0.05)'
      : 'transparent'
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={isSelected}
      data-idx={dataIdx}
      style={{
        width: '100%',
        background: bg,
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
    >
      {isAuto ? <LocationIcon /> : country && <ChunkyFlag country={country.iso2} size={22} />}
      <span style={{ flex: 1 }}>{isAuto ? 'Use my location (auto)' : country?.name}</span>
      {isSelected && <Check />}
    </button>
  )
}

function ChunkyFlag({ country, size }: { country: string; size: number }) {
  // flagcdn.com covers every ISO 3166-1 alpha-2 country — used here because
  // CountryPicker lists all 250+ world regions, whereas the local
  // public/flags/ folder only ships ~58 PNGs for padel-active countries
  // (match cards, player cards) to keep the bundle light.
  //
  // Use flagcdn's PNG raster served at a size matching the rendered chip,
  // doubled for retina. Fallback to local PNG on CDN failure keeps things
  // working offline / if flagcdn is ever unavailable.
  const code = country.toLowerCase()
  const cdnWidth = Math.round(size * 2) // 2x for retina
  return (
    <div
      style={{
        width: size,
        height: Math.round(size * 0.75),
        clipPath: CHUNKY_FLAG,
        overflow: 'hidden',
        flexShrink: 0,
      }}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://flagcdn.com/w${cdnWidth}/${code}.png`}
        alt=""
        width={size}
        height={Math.round(size * 0.75)}
        loading="lazy"
        onError={(e) => {
          const img = e.currentTarget
          if (img.dataset.fallbackTried) return
          img.dataset.fallbackTried = '1'
          img.src = `/flags/${code}.png`
        }}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block',
        }}
      />
    </div>
  )
}

function LocationIcon() {
  return (
    <svg
      width="18" height="18" viewBox="0 0 24 24"
      fill="none" stroke={GREEN} strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke={MUTED} strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg
      width="12" height="12" viewBox="0 0 24 24"
      fill="none" stroke="currentColor" strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke={MUTED} strokeWidth="2.5"
      strokeLinecap="round" strokeLinejoin="round"
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
      width="14" height="14" viewBox="0 0 24 24"
      fill="none" stroke={GREEN} strokeWidth="3"
      strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}
