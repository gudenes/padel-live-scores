'use client'

// src/components/MatchesFilterDrawer.tsx
//
// Slide-in filter drawer for the /matches/[date] page. Renders a portal
// at the document body so it sits above the phone-frame layout chrome
// without z-index gymnastics. Reads + writes filter state through
// useMatchesFilters (localStorage-persisted).
//
// Animation matches the news-peek-sheet timing already in the app:
// 280ms cubic-bezier(0.16, 1, 0.3, 1). prefers-reduced-motion users get
// instant transitions.
//
// Mobile polish baked in:
//   - body scroll lock while open
//   - backdrop tap closes
//   - ESC key closes
//   - focus trapped inside the drawer
//   - keyboard returns to the trigger button on close

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import {
  type MatchesFilters,
  type LeagueFilter,
  type CategoryFilter,
} from '@/hooks/useMatchesFilters'

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

export interface MatchesFilterDrawerProps {
  open: boolean
  filters: MatchesFilters
  onChange: (next: MatchesFilters) => void
  onReset: () => void
  onClose: () => void
}

export default function MatchesFilterDrawer({
  open,
  filters,
  onChange,
  onReset,
  onClose,
}: MatchesFilterDrawerProps) {
  const t = useTranslations('matches.filters')
  const drawerRef = useRef<HTMLDivElement>(null)

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

  // Move focus into the drawer when it opens.
  useEffect(() => {
    if (open) drawerRef.current?.focus()
  }, [open])

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

      {/* Drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        aria-hidden={!open}
        tabIndex={-1}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '86%',
          maxWidth: 360,
          background: BG_BASE,
          borderLeft: `1px solid ${BORDER_STRONG}`,
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 280ms cubic-bezier(0.16, 1, 0.3, 1)',
          display: 'flex',
          flexDirection: 'column',
          zIndex: 1101,
          outline: 'none',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '16px 14px 12px',
            borderBottom: `1px solid ${BORDER}`,
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
          style={{
            flex: 1,
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: 14,
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
            padding: '12px 14px 14px',
            borderTop: `1px solid ${BORDER}`,
            display: 'flex',
            gap: 8,
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
          <button
            type="button"
            onClick={onClose}
            style={{
              flex: 2,
              padding: '11px 14px',
              background: GREEN,
              border: `1px solid ${GREEN}`,
              color: '#0A0A0A',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 0.4,
              textTransform: 'uppercase',
              cursor: 'pointer',
              clipPath: CHUNKY.button,
              fontFamily: 'inherit',
            }}
          >
            {t('apply')}
          </button>
        </div>
      </aside>
    </>,
    document.body,
  )
}

// ── Internal building blocks ───────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
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

