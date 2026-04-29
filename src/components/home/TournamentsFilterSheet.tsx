'use client'
// src/components/home/TournamentsFilterSheet.tsx
// Bottom-sheet modal for the Events listing filters. Sibling of
// TournamentsView; not a sub-folder per the project's colocation
// preference.
//
// Three filter dimensions for v1:
//   - País      multi-select, grouped by region. Search at the top.
//   - Cuándo    single-select radios: todas / este mes / 30 días / 90 días.
//   - Estado    multi-select pills: live / upcoming / completed.
//
// "Categoría" (men/women) was on the design but isn't wired here — gender
// lives per-match, not per-tournament, so filtering at this level would
// need a separate query path. Punted to a follow-up if there's demand.

import { useState, useEffect, useMemo } from 'react'
import { GREEN, ORANGE, LIVE_RED, BG_CARD, MUTED, BORDER, CHUNKY } from './shared'

// ── Magnifier — same SVG used by the home header's global search box.
//    Keeps the visual language consistent across search inputs.
function MagnifierIcon({ size = 12, color = MUTED }: { size?: number; color?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2.5" strokeLinecap="round"
      style={{ flexShrink: 0 }}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>
  )
}

// ── Regional country groupings ─────────────────────────────────────
//
// Bucketing is opinionated — Turkey lives with Europa (UEFA convention),
// Israel with Medio Oriente (geographic), México with Latinoamérica
// (cultural). Anything not in the maps below falls into "Otros".

const REGIONS: Array<{ key: string; label: string; codes: string[] }> = [
  {
    key: 'europa',
    label: 'Europa',
    codes: ['ES', 'IT', 'PT', 'FR', 'GB', 'DE', 'NL', 'SE', 'FI', 'BE', 'DK', 'CY', 'HR', 'AT', 'CH', 'TR', 'PL', 'CZ', 'RO', 'GR', 'NO', 'IE', 'EE', 'LV', 'LT', 'HU', 'BG', 'SI', 'SK', 'RS', 'AD', 'LU'],
  },
  {
    key: 'latam',
    label: 'Latinoamérica',
    codes: ['AR', 'MX', 'CL', 'BR', 'EC', 'BO', 'PY', 'UY', 'CO', 'PE', 'PA', 'DO', 'VE'],
  },
  {
    key: 'middle_east',
    label: 'Medio Oriente',
    codes: ['AE', 'QA', 'SA', 'KW', 'IL'],
  },
  {
    key: 'asia_oceania',
    label: 'Asia / Oceanía',
    codes: ['SG', 'HK', 'CN', 'IN', 'PH', 'MY', 'JP', 'AU', 'TH', 'ID', 'KZ', 'NZ', 'KR'],
  },
  {
    key: 'africa',
    label: 'África',
    codes: ['EG', 'ZA', 'MA', 'TN', 'KE', 'CI', 'NG'],
  },
]

// Country code → display name (ES). Spread thinly — only the codes we
// expect to see. Missing codes render with the raw code (still readable).
const COUNTRY_NAMES_ES: Record<string, string> = {
  ES: 'España', IT: 'Italia', PT: 'Portugal', FR: 'Francia', GB: 'Reino Unido',
  DE: 'Alemania', NL: 'Países Bajos', SE: 'Suecia', FI: 'Finlandia', BE: 'Bélgica',
  DK: 'Dinamarca', CY: 'Chipre', HR: 'Croacia', AT: 'Austria', CH: 'Suiza',
  TR: 'Turquía', PL: 'Polonia', CZ: 'Chequia', RO: 'Rumanía', GR: 'Grecia',
  AR: 'Argentina', MX: 'México', CL: 'Chile', BR: 'Brasil', EC: 'Ecuador',
  BO: 'Bolivia', PY: 'Paraguay', UY: 'Uruguay', CO: 'Colombia', PE: 'Perú',
  AE: 'Emiratos Árabes', QA: 'Qatar', SA: 'Arabia Saudí', KW: 'Kuwait', IL: 'Israel',
  SG: 'Singapur', HK: 'Hong Kong', CN: 'China', IN: 'India', PH: 'Filipinas',
  MY: 'Malasia', JP: 'Japón', AU: 'Australia', TH: 'Tailandia', ID: 'Indonesia',
  KZ: 'Kazajistán', EG: 'Egipto', ZA: 'Sudáfrica', MA: 'Marruecos', TN: 'Túnez',
  KE: 'Kenia', CI: 'Costa de Marfil', NG: 'Nigeria',
}

function countryDisplayName(code: string): string {
  return COUNTRY_NAMES_ES[code] ?? code
}

// Flag emoji from ISO alpha-2 — same trick used elsewhere in the app.
function flagEmoji(code: string): string {
  if (!code || code.length !== 2) return '🏳'
  const A = 0x1F1E6
  return String.fromCodePoint(A + (code.charCodeAt(0) - 65), A + (code.charCodeAt(1) - 65))
}

// ── Filter state shape ─────────────────────────────────────────────

export interface TournamentFilters {
  /** Calendar year of the tournament's `starts_at`. Defaults to current
   *  year so the page opens on "this season" out of the box. */
  year: number
  countries: Set<string>
  when: 'all' | 'this_month' | 'next_30' | 'next_90'
  estado: {
    live: boolean
    upcoming: boolean
    completed: boolean
  }
}

const CURRENT_YEAR = new Date().getFullYear()

export const DEFAULT_FILTERS: TournamentFilters = {
  year: CURRENT_YEAR,
  countries: new Set(),
  when: 'all',
  estado: { live: true, upcoming: true, completed: true },
}

export function activeFilterCount(f: TournamentFilters): number {
  let n = 0
  // Year only counts when it's not the current year — the default state
  // shouldn't contribute to the badge.
  if (f.year !== CURRENT_YEAR) n += 1
  n += f.countries.size
  if (f.when !== 'all') n += 1
  if (!f.estado.live || !f.estado.upcoming || !f.estado.completed) n += 1
  return n
}

// ── Sheet component ────────────────────────────────────────────────

interface SheetProps {
  open: boolean
  onClose: () => void
  /** Country codes that actually exist in the loaded tournament set —
   *  the picker only shows countries the user could possibly select. */
  availableCountries: Set<string>
  /** Years that actually have tournaments in the data — sorted descending
   *  so the latest season appears first. Always includes the current year
   *  even if no events landed yet. */
  availableYears: number[]
  /** Current applied filters — sheet starts pre-filled with these. */
  current: TournamentFilters
  /** Live count of tournaments that match the in-sheet pending state.
   *  Parent computes this on every change; we just render it. */
  pendingCount: number
  /** Called whenever the user changes anything inside the sheet, so the
   *  parent can recompute pendingCount. */
  onPendingChange: (next: TournamentFilters) => void
  /** Called when the user taps Apply — commits pending → applied. */
  onApply: (next: TournamentFilters) => void
  /** Called when the user taps Limpiar — resets pending to defaults. */
  onClear: () => void
}

export default function TournamentsFilterSheet({
  open, onClose, availableCountries, availableYears, current, pendingCount,
  onPendingChange, onApply, onClear,
}: SheetProps) {
  // Local "pending" mirror so the user can fiddle without committing.
  // Re-syncs from `current` whenever the sheet opens.
  const [pending, setPending] = useState<TournamentFilters>(current)
  useEffect(() => {
    if (open) setPending({ ...current, countries: new Set(current.countries) })
  }, [open, current])

  // Whenever pending changes, notify parent so the live count updates.
  useEffect(() => {
    if (open) onPendingChange(pending)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  const [search, setSearch] = useState('')
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(
    () => new Set(['europa', 'latam']),
  )

  // Build region -> available country list once.
  const regionCountries = useMemo(() => {
    const byRegion = new Map<string, string[]>()
    for (const r of REGIONS) {
      const present = r.codes.filter(c => availableCountries.has(c))
      if (present.length > 0) byRegion.set(r.key, present)
    }
    // Anything in availableCountries but not assigned to a region.
    const assigned = new Set(REGIONS.flatMap(r => r.codes))
    const orphans = [...availableCountries].filter(c => !assigned.has(c))
    if (orphans.length > 0) byRegion.set('otros', orphans)
    return byRegion
  }, [availableCountries])

  const matchesSearch = (code: string): boolean => {
    if (!search) return true
    const q = search.toLowerCase().trim()
    if (!q) return true
    if (code.toLowerCase().includes(q)) return true
    return countryDisplayName(code).toLowerCase().includes(q)
  }

  const toggleCountry = (code: string) => {
    setPending(prev => {
      const next = new Set(prev.countries)
      if (next.has(code)) next.delete(code); else next.add(code)
      return { ...prev, countries: next }
    })
  }

  const toggleRegion = (key: string) => {
    setExpandedRegions(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  const toggleEstado = (k: keyof TournamentFilters['estado']) => {
    setPending(prev => ({
      ...prev,
      estado: { ...prev.estado, [k]: !prev.estado[k] },
    }))
  }

  if (!open) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
          zIndex: 200, animation: 'tfs-fade-in 0.18s ease',
        }}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filtros de torneos"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          maxWidth: 500, margin: '0 auto',
          background: '#0A0A0A', borderTop: `1px solid ${BORDER}`,
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          zIndex: 201, height: '78%',
          display: 'flex', flexDirection: 'column',
          boxShadow: '0 -20px 50px rgba(0,0,0,0.5)',
          animation: 'tfs-slide-up 0.22s cubic-bezier(0.2,0,0.2,1)',
        }}
      >
        <style>{`
          @keyframes tfs-fade-in { from { opacity: 0 } to { opacity: 1 } }
          @keyframes tfs-slide-up { from { transform: translateY(100%) } to { transform: translateY(0) } }
        `}</style>

        {/* Drag handle */}
        <div style={{ paddingTop: 8, flexShrink: 0 }}>
          <div style={{
            width: 36, height: 4, background: '#4A4A4A',
            borderRadius: 2, margin: '0 auto',
          }} />
        </div>

        {/* Head */}
        <div style={{
          padding: '14px 16px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          borderBottom: `1px solid ${BORDER}`, flexShrink: 0,
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 800, letterSpacing: '-0.015em', margin: 0, color: '#fff' }}>
            Filtros
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              width: 28, height: 28, background: BG_CARD,
              border: `1px solid ${BORDER}`, borderRadius: '50%',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: MUTED, fontSize: 14, padding: 0,
              fontFamily: 'inherit',
            }}
          >
            ✕
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px 14px' }}>

          {/* ── TEMPORADA (year) ─────────────────────────────── */}
          <Section title="Temporada">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {availableYears.map(y => {
                const selected = pending.year === y
                return (
                  <button
                    key={y}
                    type="button"
                    onClick={() => setPending(prev => ({ ...prev, year: y }))}
                    style={{
                      padding: '7px 14px',
                      background: selected ? GREEN : BG_CARD,
                      border: `1px solid ${selected ? GREEN : BORDER}`,
                      color: selected ? '#0A0A0A' : '#B5B5B5',
                      fontSize: 12, fontWeight: selected ? 800 : 700,
                      letterSpacing: '0.02em',
                      clipPath: CHUNKY.button,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    {y}
                    {y === CURRENT_YEAR && (
                      <span style={{
                        marginLeft: 6,
                        fontSize: 9,
                        opacity: selected ? 0.7 : 0.6,
                        fontWeight: 700,
                      }}>
                        actual
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </Section>

          {/* ── PAÍS ────────────────────────────────────────── */}
          <Section title="País">
            <div style={{ position: 'relative', marginBottom: 12 }}>
              <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', display: 'flex' }}>
                <MagnifierIcon size={13} color={GREEN} />
              </span>
              <input
                type="text"
                placeholder="Buscar país…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  width: '100%', padding: '9px 12px 9px 34px',
                  background: BG_CARD, border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.bar,
                  color: '#fff', fontSize: 12,
                  fontFamily: 'inherit',
                  outline: 'none',
                }}
              />
            </div>

            {regionCountries.size === 0 && (
              <div style={{ padding: '8px 0', fontSize: 12, color: MUTED }}>
                No hay países en este filtro.
              </div>
            )}

            {[...REGIONS, { key: 'otros', label: 'Otros', codes: [] }].map(({ key, label }) => {
              const codes = regionCountries.get(key)
              if (!codes || codes.length === 0) return null
              const visible = codes.filter(matchesSearch)
              const expanded = expandedRegions.has(key) || !!search.trim()
              return (
                <div key={key} style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={() => toggleRegion(key)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      width: '100%', padding: '8px 0',
                      background: 'none', border: 'none', cursor: 'pointer',
                      fontFamily: 'inherit', color: 'inherit',
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ color: MUTED, fontSize: 11 }}>{expanded ? '▾' : '▸'}</span>
                      {label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-mono, "SF Mono", monospace)',
                      fontSize: 10, color: MUTED, letterSpacing: '0.04em',
                    }}>
                      {codes.length} {codes.length === 1 ? 'país' : 'países'}
                    </span>
                  </button>
                  {expanded && (
                    <div style={{
                      display: 'flex', gap: 6, flexWrap: 'wrap',
                      padding: '6px 0 4px',
                    }}>
                      {visible.map(code => {
                        const selected = pending.countries.has(code)
                        return (
                          <button
                            key={code}
                            type="button"
                            onClick={() => toggleCountry(code)}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              padding: '5px 12px',
                              background: selected ? GREEN : BG_CARD,
                              border: `1px solid ${selected ? GREEN : BORDER}`,
                              color: selected ? '#0A0A0A' : '#B5B5B5',
                              fontSize: 11, fontWeight: selected ? 700 : 600,
                              clipPath: CHUNKY.badge,
                              cursor: 'pointer',
                              fontFamily: 'inherit',
                            }}
                          >
                            <span style={{ fontSize: 12 }}>{flagEmoji(code)}</span>
                            {countryDisplayName(code)}
                          </button>
                        )
                      })}
                      {visible.length === 0 && (
                        <div style={{ fontSize: 11, color: MUTED, padding: '4px 0' }}>
                          Ningún país coincide con la búsqueda.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </Section>

          {/* ── CUÁNDO ──────────────────────────────────────── */}
          <Section title="Cuándo">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {([
                { v: 'all', label: 'Todas las fechas' },
                { v: 'this_month', label: 'Este mes' },
                { v: 'next_30', label: 'Próximos 30 días' },
                { v: 'next_90', label: 'Próximos 90 días' },
              ] as const).map(opt => {
                const selected = pending.when === opt.v
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setPending(prev => ({ ...prev, when: opt.v }))}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px',
                      background: selected ? 'rgba(126,211,33,0.04)' : BG_CARD,
                      border: `1px solid ${selected ? GREEN : BORDER}`,
                      clipPath: CHUNKY.card,
                      cursor: 'pointer',
                      fontSize: 12, color: selected ? '#fff' : '#B5B5B5',
                      textAlign: 'left', fontFamily: 'inherit',
                    }}
                  >
                    <span style={{
                      width: 14, height: 14,
                      border: `1.5px solid ${selected ? GREEN : MUTED}`,
                      borderRadius: '50%', flexShrink: 0,
                      position: 'relative',
                    }}>
                      {selected && (
                        <span style={{
                          position: 'absolute', inset: 2,
                          background: GREEN, borderRadius: '50%',
                        }} />
                      )}
                    </span>
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </Section>

          {/* ── ESTADO ──────────────────────────────────────── */}
          <Section title="Estado">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <EstadoPill
                label="En vivo"
                color={LIVE_RED}
                selected={pending.estado.live}
                onClick={() => toggleEstado('live')}
              />
              <EstadoPill
                label="Próximas"
                color={ORANGE}
                selected={pending.estado.upcoming}
                onClick={() => toggleEstado('upcoming')}
              />
              <EstadoPill
                label="Completadas"
                color={MUTED}
                selected={pending.estado.completed}
                onClick={() => toggleEstado('completed')}
              />
            </div>
          </Section>

        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 16px',
          borderTop: `1px solid ${BORDER}`,
          display: 'flex', gap: 10,
          background: '#0A0A0A',
          flexShrink: 0,
        }}>
          <button
            type="button"
            onClick={() => {
              setPending({
                year: CURRENT_YEAR,
                countries: new Set(),
                when: 'all',
                estado: { live: true, upcoming: true, completed: true },
              })
              onClear()
            }}
            style={{
              padding: '11px 18px',
              background: 'transparent',
              border: `1px solid ${BORDER}`,
              color: MUTED,
              clipPath: CHUNKY.button,
              fontSize: 12, fontWeight: 800,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => onApply(pending)}
            style={{
              flex: 1,
              padding: '11px 18px',
              background: GREEN,
              border: `1px solid ${GREEN}`,
              color: '#0A0A0A',
              clipPath: CHUNKY.button,
              fontSize: 12, fontWeight: 800,
              letterSpacing: '0.04em',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Aplicar ({pendingCount} {pendingCount === 1 ? 'evento' : 'eventos'})
          </button>
        </div>
      </div>
    </>
  )
}

// ── Local sub-components ───────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: '14px 0', borderBottom: `1px solid ${BORDER}` }}>
      <h3 style={{
        fontSize: 12, fontWeight: 800, letterSpacing: '0.12em',
        textTransform: 'uppercase', marginBottom: 10, color: '#fff',
      }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

function EstadoPill({
  label, color, selected, onClick,
}: {
  label: string; color: string; selected: boolean; onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 14px',
        background: selected ? `${color}26` : BG_CARD, // 26 ≈ 15% alpha
        border: `1px solid ${selected ? color : BORDER}`,
        color: selected ? color : MUTED,
        fontSize: 11, fontWeight: selected ? 700 : 600,
        clipPath: CHUNKY.badge,
        cursor: 'pointer',
        fontFamily: 'inherit',
      }}
    >
      <span style={{
        width: 8, height: 8, borderRadius: '50%',
        background: color, opacity: selected ? 1 : 0.4,
      }} />
      {label}
    </button>
  )
}
