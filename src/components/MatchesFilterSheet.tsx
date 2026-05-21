'use client'

// src/components/MatchesFilterSheet.tsx
//
// Bottom-sheet filter for the /matches/[date] page. Sibling pattern to
// TournamentsFilterSheet — both filter surfaces open from the bottom on
// mobile for thumb-friendly dismissal and visual consistency.
//
// Renders a portal at document body so it sits above the phone-frame
// layout chrome without z-index gymnastics. Reads + writes filter state
// through useMatchesFilters (localStorage-persisted).
//
// Mobile polish baked in:
//   - body scroll lock while open
//   - backdrop tap closes
//   - ESC key closes
//   - swipe-down-to-close via useSwipeDownToClose
//   - focus moves into the sheet on open

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import {
  type MatchesFilters,
  type LeagueFilter,
  type CategoryFilter,
} from '@/hooks/useMatchesFilters'
import { useSwipeDownToClose } from '@/hooks/useSwipeDownToClose'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

// ── Brand tokens (mirror src/components/home/shared.tsx) ────────────────
const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.15)'
const LIVE_RED = '#FF4655'
const BG_BASE = '#0A0A0A'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'
const BORDER_STRONG = 'rgba(255,255,255,0.10)'

const CHUNKY = {
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
  pill: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
  button: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
}

export interface MatchesFilterSheetProps {
  open: boolean
  filters: MatchesFilters
  onChange: (next: MatchesFilters) => void
  onReset: () => void
  onClose: () => void
}

export default function MatchesFilterSheet({
  open,
  filters,
  onChange,
  onReset,
  onClose,
}: MatchesFilterSheetProps) {
  const t = useTranslations('matches.filters')
  const sheetRef = useRef<HTMLElement>(null)
  const bodyScrollRef = useRef<HTMLDivElement>(null)

  // Mount gate — the portal renders to document.body which doesn't exist
  // during SSR. Returning null until after the first client effect avoids
  // the hydration mismatch we'd otherwise hit when React tries to
  // reconcile the portaled backdrop against an empty server tree.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  // ── Body scroll lock + ESC handler ────────────────────────────────────
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  // Move focus into the sheet when it opens.
  useEffect(() => {
    if (open) sheetRef.current?.focus()
  }, [open])

  // Swipe-down-to-close. Body div (overflowY: auto) is the inner scroll
  // container; gesture is suppressed while it's scrolled away from top
  // so chip taps + content scrolling win.
  const swipe = useSwipeDownToClose({
    onClose,
    scrollRef: bodyScrollRef,
    disabled: !open,
  })

  // Don't render the portal until after hydration — see `mounted` above.
  if (!mounted) return null

  // ── Mutator helpers ───────────────────────────────────────────────────
  const setLeague = (league: LeagueFilter) => onChange({ ...filters, league })
  const setCategory = (category: CategoryFilter) => onChange({ ...filters, category })

  const toggleStatus = (key: 'live' | 'upcoming' | 'finished') =>
    onChange({
      ...filters,
      status: { ...filters.status, [key]: !filters.status[key] },
    })

  // ── Render ────────────────────────────────────────────────────────────
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 220ms ease',
          zIndex: 1100,
        }}
      />

      {/* Sheet */}
      <aside
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        aria-hidden={!open}
        tabIndex={-1}
        {...swipe.bind}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          maxWidth: 500,
          margin: '0 auto',
          // maxHeight rather than fixed height — three small sections
          // don't need 78% of viewport; let content drive size, cap so
          // unusually large fonts can't push past safe area.
          maxHeight: '78vh',
          background: BG_BASE,
          borderTop: `1px solid ${BORDER_STRONG}`,
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1101,
          outline: 'none',
          boxShadow: '0 -20px 50px rgba(0,0,0,0.5)',
          // While the user is dragging the swipe-to-close gesture,
          // overrides transform/transition above so the panel follows
          // their finger.
          ...swipe.style,
        }}
      >
        {/* Drag handle — visual affordance for the swipe-down gesture */}
        <div style={{ paddingTop: 8, flexShrink: 0 }}>
          <div
            aria-hidden
            style={{
              width: 36,
              height: 4,
              background: '#4A4A4A',
              borderRadius: 2,
              margin: '0 auto',
            }}
          />
        </div>

        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 12px 10px',
            borderBottom: `1px solid ${BORDER}`,
            flexShrink: 0,
          }}
        >
          <div style={{ flex: 1, fontSize: 14, fontWeight: 800, color: '#fff', letterSpacing: 0.3 }}>
            {t('title')}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            style={{
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: BG_CARD,
              border: `1px solid ${BORDER}`,
              borderRadius: '50%',
              color: '#fff',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body — scrollable */}
        <div
          ref={bodyScrollRef}
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: 12,
          }}
        >
          {/* League */}
          <Section label={t('league.label')}>
            <Segment
              options={[
                { value: 'all', label: t('league.all') },
                { value: 'premier', label: t('league.premier') },
                { value: 'fip', label: t('league.fip') },
              ]}
              value={filters.league}
              onChange={(v) => setLeague(v as LeagueFilter)}
            />
          </Section>

          {/* Category */}
          <Section label={t('category.label')}>
            <Segment
              options={[
                { value: 'both', label: t('category.both') },
                { value: 'men', label: t('category.men') },
                { value: 'women', label: t('category.women') },
              ]}
              value={filters.category}
              onChange={(v) => setCategory(v as CategoryFilter)}
            />
          </Section>

          {/* Status */}
          <Section label={t('status.label')}>
            <ChipRow>
              <Chip
                on={filters.status.live}
                onClick={() => toggleStatus('live')}
                accent={LIVE_RED}
                accentDim="rgba(255,70,85,0.18)"
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: '50%',
                    background: filters.status.live ? LIVE_RED : MUTED,
                    display: 'inline-block',
                    marginRight: 4,
                    verticalAlign: 'middle',
                  }}
                />
                {t('status.live')}
              </Chip>
              <Chip on={filters.status.upcoming} onClick={() => toggleStatus('upcoming')}>
                {t('status.upcoming')}
              </Chip>
              <Chip on={filters.status.finished} onClick={() => toggleStatus('finished')}>
                {t('status.finished')}
              </Chip>
            </ChipRow>
          </Section>

        </div>

        {/* Footer — sticky reset/apply */}
        <div
          style={{
            padding: '10px 12px 12px',
            borderTop: `1px solid ${BORDER}`,
            display: 'flex',
            gap: 8,
            flexShrink: 0,
            paddingBottom: 'calc(12px + env(safe-area-inset-bottom))',
          }}
        >
          <button
            type="button"
            onClick={onReset}
            style={{
              flex: 1,
              padding: '11px 14px',
              background: 'transparent',
              border: `1px solid ${BORDER_STRONG}`,
              color: MUTED,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              cursor: 'pointer',
              clipPath: CHUNKY.button,
              fontFamily: 'inherit',
            }}
          >
            {t('reset')}
          </button>
          <PressButton
            type="button"
            onClick={onClose}
            {...PRESS_PRESETS.chunkyTilted}
            style={{
              flex: 2,
              height: 40,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
            }}
          >
            {t('apply')}
          </PressButton>
        </div>
      </aside>
    </>,
    document.body,
  )
}

// ── Internal building blocks ───────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: MUTED,
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function Segment<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        gap: 4,
        padding: 3,
        background: BG_CARD,
        border: `1px solid ${BORDER}`,
        clipPath: CHUNKY.pill,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            style={{
              padding: '8px 4px',
              background: active ? GREEN : 'transparent',
              border: 0,
              color: active ? '#0A0A0A' : MUTED,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: 0.3,
              textTransform: 'uppercase',
              cursor: 'pointer',
              clipPath: CHUNKY.pill,
              lineHeight: 1,
              fontFamily: 'inherit',
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
}

function Chip({
  on,
  onClick,
  children,
  accent = GREEN,
  accentDim = GREEN_DIM,
}: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  accent?: string
  accentDim?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        padding: '7px 11px',
        background: on ? accentDim : BG_CARD,
        border: `1px solid ${on ? accent : BORDER}`,
        color: on ? accent : MUTED,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.3,
        cursor: 'pointer',
        clipPath: CHUNKY.pill,
        lineHeight: 1,
        fontFamily: 'inherit',
      }}
    >
      {children}
    </button>
  )
}

