'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import type { Circuit, Gender } from '@/lib/matches-filters'

const GREEN = '#7ED321'
const GREEN_DIM = 'rgba(126,211,33,0.12)'
const MEN_BLUE = '#4A9EFF'
const MEN_DIM = 'rgba(74,158,255,0.14)'
const WOMEN_PURPLE = '#D966FF'
const WOMEN_DIM = 'rgba(217,102,255,0.14)'
const BG_CARD = '#141414'
const BG_ELEV = '#1E1E1E'
const MUTED = '#6B7280'
const MUTED_2 = '#9CA3AF'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const CHUNKY_BTN   = 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)'

export interface FilterSheetValue {
  circuits: Set<Circuit>
  genders: Set<Gender>
  levels: Set<string>
  favouritesOnly: boolean
  hideQualifiers: boolean
}

const LEVEL_KEYS = ['major', 'p1', 'p2', 'fip_gold', 'fip_silver'] as const

export default function MatchesFilterSheet({
  open,
  initial,
  onApply,
  onClose,
}: {
  open: boolean
  initial: FilterSheetValue
  onApply: (next: FilterSheetValue) => void
  onClose: () => void
}) {
  const t = useTranslations('matches.filters')
  // Local draft so the sheet can be cancelled without mutating parent state.
  const [draft, setDraft] = useState<FilterSheetValue>(initial)
  // Resync draft whenever the sheet re-opens with new initial state
  useEffect(() => { if (open) setDraft({
    circuits: new Set(initial.circuits),
    genders: new Set(initial.genders),
    levels: new Set(initial.levels),
    favouritesOnly: initial.favouritesOnly,
    hideQualifiers: initial.hideQualifiers,
  }) }, [open, initial])

  if (!open) return null

  const toggleInSet = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set)
    if (next.has(v)) next.delete(v); else next.add(v)
    return next
  }

  const countApplied = countAppliedFilters(draft)

  const reset: FilterSheetValue = {
    circuits: new Set(['premier', 'fip']),
    genders: new Set(['men', 'women']),
    levels: new Set(),
    favouritesOnly: false,
    hideQualifiers: false,
  }

  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(3px)',
        zIndex: 400,
        animation: 'pn-sheet-fade 0.2s ease',
      }} />
      <div role="dialog" aria-modal="true" style={{
        position: 'fixed',
        left: '50%', bottom: 0,
        transform: 'translateX(-50%)',
        width: '100%', maxWidth: 500,
        background: BG_CARD,
        borderTop: '1px solid rgba(255,255,255,0.12)',
        padding: '18px 18px 24px',
        zIndex: 401,
        boxShadow: '0 -12px 40px rgba(0,0,0,0.5)',
        animation: 'pn-sheet-in 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}>
        <div style={{ width: 44, height: 4, background: 'rgba(255,255,255,0.2)', margin: '0 auto 16px' }} />

        {/* Circuit */}
        <SheetSection title={t('circuit')}>
          <PillRow>
            <Pill on={draft.circuits.has('premier')} onClick={() => setDraft({ ...draft, circuits: toggleInSet(draft.circuits, 'premier') })}>{t('premierPadel')}</Pill>
            <Pill on={draft.circuits.has('fip')} onClick={() => setDraft({ ...draft, circuits: toggleInSet(draft.circuits, 'fip') })}>{t('fipTour')}</Pill>
          </PillRow>
        </SheetSection>

        {/* Gender */}
        <SheetSection title={t('gender')}>
          <PillRow>
            <Pill tint={{ on: MEN_DIM, color: MEN_BLUE }} on={draft.genders.has('men')} onClick={() => setDraft({ ...draft, genders: toggleInSet(draft.genders, 'men') })}>{t('men')}</Pill>
            <Pill tint={{ on: WOMEN_DIM, color: WOMEN_PURPLE }} on={draft.genders.has('women')} onClick={() => setDraft({ ...draft, genders: toggleInSet(draft.genders, 'women') })}>{t('women')}</Pill>
          </PillRow>
        </SheetSection>

        {/* Level */}
        <SheetSection title={t('level')}>
          <PillRow>
            {LEVEL_KEYS.map(k => {
              const labelKey = k === 'fip_gold' ? 'fipGold' : k === 'fip_silver' ? 'fipSilver' : k
              return (
                <Pill key={k} on={draft.levels.has(k)} onClick={() => setDraft({ ...draft, levels: toggleInSet(draft.levels, k) })}>
                  {t(labelKey as any)}
                </Pill>
              )
            })}
          </PillRow>
        </SheetSection>

        {/* Toggles */}
        <SheetSection>
          <ToggleRow
            name={t('favouritesOnly')}
            sub={t('favouritesHint')}
            on={draft.favouritesOnly}
            onChange={v => setDraft({ ...draft, favouritesOnly: v })}
          />
          <ToggleRow
            name={t('hideQualifiers')}
            sub={t('hideQualifiersHint')}
            on={draft.hideQualifiers}
            onChange={v => setDraft({ ...draft, hideQualifiers: v })}
          />
        </SheetSection>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
          <button onClick={() => onApply(reset)} style={{
            flex: 1, padding: 14, cursor: 'pointer', border: `1px solid ${BORDER}`,
            background: BG_ELEV, color: MUTED_2,
            fontSize: 13, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
            clipPath: CHUNKY_BTN,
          }}>
            {t('reset')}
          </button>
          <button onClick={() => onApply(draft)} style={{
            flex: 1, padding: 14, cursor: 'pointer', border: 'none',
            background: GREEN, color: '#0A0A0A',
            fontSize: 13, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase',
            clipPath: CHUNKY_BTN,
          }}>
            {t('apply')}
            {countApplied > 0 && (
              <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.7 }}>
                · {t('applyCount', { count: countApplied })}
              </span>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes pn-sheet-fade { from { opacity: 0 } to { opacity: 1 } }
        @keyframes pn-sheet-in  { from { transform: translate(-50%, 100%); opacity: 0 } to { transform: translate(-50%, 0); opacity: 1 } }
      `}</style>
    </>
  )
}

// ── Sub-components ──────────────────────────────────────

function SheetSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      {title && (
        <h4 style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase', color: MUTED }}>
          {title}
        </h4>
      )}
      {children}
    </div>
  )
}

function PillRow({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>
}

function Pill({ on, onClick, children, tint }: {
  on: boolean
  onClick: () => void
  children: React.ReactNode
  tint?: { on: string; color: string }
}) {
  const activeBg = tint?.on ?? GREEN_DIM
  const activeColor = tint?.color ?? GREEN
  return (
    <button onClick={onClick} style={{
      padding: '8px 14px',
      fontSize: 12, fontWeight: 800,
      background: on ? activeBg : BG_ELEV,
      color: on ? activeColor : MUTED_2,
      border: on ? '1px solid transparent' : `1px solid ${BORDER}`,
      clipPath: CHUNKY_BADGE,
      cursor: 'pointer',
      display: 'inline-flex', alignItems: 'center', gap: 6,
    }}>
      {on && <span aria-hidden style={{ fontSize: 11, fontWeight: 900 }}>✓</span>}
      {children}
    </button>
  )
}

function ToggleRow({ name, sub, on, onChange }: {
  name: string
  sub: string
  on: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 0', borderTop: `1px solid ${BORDER}`,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{name}</div>
        <div style={{ fontSize: 10, color: MUTED, fontWeight: 600 }}>{sub}</div>
      </div>
      <button role="switch" aria-checked={on} onClick={() => onChange(!on)} style={{
        width: 44, height: 26, position: 'relative',
        background: on ? GREEN : BG_ELEV,
        border: on ? '1px solid transparent' : `1px solid ${BORDER}`,
        cursor: 'pointer', padding: 0,
        transition: 'background 0.2s',
      }}>
        <span style={{
          position: 'absolute', top: 2, left: on ? 20 : 2,
          width: 20, height: 20,
          background: on ? '#0A0A0A' : '#fff',
          transition: 'left 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }} />
      </button>
    </div>
  )
}

// Exported so the page can badge the filter trigger.
// Only `size === 1` counts as a filter; size 0 ("nothing selected") and
// size 2 ("everything selected") are both treated as "no constraint" by
// applyFilters, so the badge stays quiet in either case.
export function countAppliedFilters(v: FilterSheetValue): number {
  return (
    (v.circuits.size === 1 ? 1 : 0) +
    (v.genders.size === 1 ? 1 : 0) +
    v.levels.size +
    (v.favouritesOnly ? 1 : 0) +
    (v.hideQualifiers ? 1 : 0)
  )
}
