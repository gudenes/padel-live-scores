'use client'
// apps/ops/src/components/PlayerDrawer.tsx
// Right-side overlay drawer for editing player details. Mounted at app-shell
// scope by PlayerDrawerHost (see player-drawer-context.tsx) — any surface that
// renders a <PlayerLink /> can open it via useOpenPlayerDrawer().open(id).

import React, { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui'
import { PlayerDetail } from '@/app/(app)/players/_components/types'
import EquipmentTab from '@/app/(app)/players/_components/EquipmentTab'

// ─── Style constants ──────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--text-2)',
  fontWeight: 600,
  display: 'block',
  marginBottom: 2,
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
}
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlayerDrawerProps {
  playerId: string | null
  onClose: () => void
  /**
   * Optional — fires after a successful PATCH save. PlayersTab uses it to
   * refresh the list. Surfaces that don't own a list (e.g. PlayerLink opens
   * from Matches / Draws / OOP) can omit it.
   */
  onSaved?: () => void
  /**
   * Optional — wires the drawer's arrow-key + prev/next button affordance to
   * the surrounding list. Only PlayersTab sets this today.
   */
  onNavigate?: (direction: 'prev' | 'next') => void
}

type TabId = 'profile' | 'ids' | 'equipment'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('')
    .toUpperCase()
}

function countryName(code: string | null): string {
  if (!code) return ''
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatBox({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div
      style={{
        flex: 1,
        background: 'var(--bg-card-2)',
        borderRadius: 'var(--r-xs)',
        padding: '8px 10px',
        textAlign: 'center',
        border: '1px solid var(--border-card)',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-2)', marginTop: 2, fontWeight: 500 }}>{label}</div>
    </div>
  )
}

function TabButton({
  id,
  label,
  active,
  onClick,
}: {
  id: TabId
  label: string
  active: boolean
  onClick: (id: TabId) => void
}) {
  return (
    <button
      onClick={() => onClick(id)}
      style={{
        flex: 1,
        padding: '8px 4px',
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        color: active ? 'var(--text-1)' : 'var(--text-3)',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid var(--lime)' : '2px solid transparent',
        cursor: 'pointer',
        transition: 'color 0.12s, border-color 0.12s',
      }}
    >
      {label}
    </button>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <span style={labelStyle}>{label}</span>
      {children}
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function PlayerDrawer({
  playerId,
  onClose,
  onSaved,
  onNavigate,
}: PlayerDrawerProps) {
  const [player, setPlayer] = useState<PlayerDetail | null>(null)
  const [matchCount, setMatchCount] = useState<number>(0)
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<TabId>('profile')

  // Editable form state (mirrors PlayerDetail fields)
  const [form, setForm] = useState<Record<string, string>>({})
  const [original, setOriginal] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'ok' | 'err' | null>(null)

  const drawerRef = useRef<HTMLDivElement>(null)

  // ── Derived state ────────────────────────────────────────────────────────
  const isDirty = Object.keys(form).some((k) => form[k] !== original[k])

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchPlayer = useCallback(async (id: string) => {
    setLoading(true)
    setSaveMsg(null)
    setTab('profile')
    try {
      const res = await fetch(`/api/internal/players?id=${id}`)
      if (!res.ok) return
      const data = await res.json() as { player: PlayerDetail; matchCount: number }
      setPlayer(data.player)
      setMatchCount(data.matchCount)
      const f: Record<string, string> = {
        name: data.player.name ?? '',
        display_name: data.player.display_name ?? '',
        country: data.player.country ?? '',
        category: data.player.category ?? '',
        side: data.player.side ?? '',
        hand: data.player.hand ?? '',
        height: data.player.height ?? '',
        birthdate: data.player.birthdate ?? '',
        birthplace: data.player.birthplace ?? '',
        external_id: data.player.external_id ?? '',
        fip_id: data.player.fip_id ?? '',
      }
      setForm(f)
      setOriginal(f)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!playerId) {
      setPlayer(null)
      setForm({})
      setOriginal({})
      return
    }
    fetchPlayer(playerId)
  }, [playerId, fetchPlayer])

  // Keyboard: Escape closes, arrows navigate
  useEffect(() => {
    if (!playerId) return

    function handleKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName
      const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'

      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowUp' && !isEditing) {
        e.preventDefault()
        onNavigate?.('prev')
      } else if (e.key === 'ArrowDown' && !isEditing) {
        e.preventDefault()
        onNavigate?.('next')
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [playerId, onClose, onNavigate])

  // ── Handlers ─────────────────────────────────────────────────────────────

  function setField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleSave() {
    if (!player || !isDirty) return
    setSaving(true)
    setSaveMsg(null)

    const updates: Record<string, unknown> = {}
    for (const k of Object.keys(form)) {
      if (form[k] !== original[k]) {
        updates[k] = form[k] === '' ? null : form[k]
      }
    }

    const res = await fetch('/api/internal/players', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: player.id, updates }),
    })

    setSaving(false)

    if (res.ok) {
      setSaveMsg('ok')
      setOriginal(form)
      onSaved?.()
      setTimeout(() => setSaveMsg(null), 2500)
    } else {
      setSaveMsg('err')
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (!playerId) return null

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.5)',
          zIndex: 100,
        }}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        style={{
          // Start below the global header (z-index 120). The header is the
          // app's top-most chrome — the ⌘K palette sits under it too — so the
          // drawer would otherwise slide its top (avatar + nav arrows) behind
          // the search bar. Offsetting by --gh keeps the header usable and the
          // drawer fully visible.
          position: 'fixed',
          top: 'var(--gh)',
          right: 0,
          bottom: 0,
          width: 420,
          background: 'var(--bg-surface)',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: 'var(--shadow-lg)',
          animation: 'slideInRight 0.2s ease-out',
        }}
      >
        <style>{`
          @keyframes slideInRight {
            from { transform: translateX(100%); }
            to   { transform: translateX(0); }
          }
        `}</style>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div
          style={{
            padding: '16px 16px 12px',
            borderBottom: '1px solid var(--border-card)',
            flexShrink: 0,
          }}
        >
          {loading ? (
            <div style={{ height: 64, display: 'flex', alignItems: 'center', color: 'var(--text-3)', fontSize: 13 }}>
              Loading…
            </div>
          ) : player ? (
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
              {/* Avatar */}
              <div style={{ position: 'relative', flexShrink: 0 }}>
                {player.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={player.avatar_url}
                    alt={player.name}
                    style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--border-card)' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      background: 'var(--bg-hover)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'var(--text-2)',
                    }}
                  >
                    {getInitials(player.display_name || player.name)}
                  </div>
                )}
                {player.country && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/flags/${player.country.toLowerCase()}.png`}
                    alt={player.country}
                    style={{
                      position: 'absolute',
                      bottom: 2,
                      right: 2,
                      width: 16,
                      height: 12,
                      borderRadius: 2,
                      objectFit: 'cover',
                      border: '1px solid rgba(255,255,255,0.8)',
                    }}
                  />
                )}
              </div>

              {/* Name + meta */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-1)', lineHeight: 1.2 }}>
                  {player.display_name || player.name}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                  {player.ranking != null && (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 7px',
                        borderRadius: 10,
                        background: 'var(--text-1)',
                        color: 'var(--bg-surface)',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      #{player.ranking}
                    </span>
                  )}
                  {player.country && (
                    <span style={{ fontSize: 12, color: 'var(--text-2)' }}>
                      {countryName(player.country)}
                    </span>
                  )}
                  {player.category && (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        fontWeight: 600,
                        background: player.category === 'men' ? 'var(--men-bg)' : 'var(--women-bg)',
                        color: player.category === 'men' ? 'var(--men)' : 'var(--women)',
                      }}
                    >
                      {player.category === 'men' ? 'Men' : 'Women'}
                    </span>
                  )}
                </div>
              </div>

              {/* Nav + close */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                <Link
                  href={`/players/${player.id}`}
                  title="Open full profile"
                  style={{
                    fontSize: 11,
                    color: 'var(--lime-text)',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    marginBottom: 2,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Open full profile →
                </Link>
                <button
                  onClick={onClose}
                  title="Close (Esc)"
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: 18,
                    color: 'var(--text-2)',
                    lineHeight: 1,
                    padding: '4px 6px',
                    borderRadius: 4,
                  }}
                >
                  ✕
                </button>
                <button
                  onClick={() => onNavigate?.('prev')}
                  title="Previous player (↑)"
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-card)',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--text-2)',
                    lineHeight: 1,
                    padding: '3px 6px',
                    borderRadius: 4,
                  }}
                >
                  ↑
                </button>
                <button
                  onClick={() => onNavigate?.('next')}
                  title="Next player (↓)"
                  style={{
                    background: 'none',
                    border: '1px solid var(--border-card)',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: 'var(--text-2)',
                    lineHeight: 1,
                    padding: '3px 6px',
                    borderRadius: 4,
                  }}
                >
                  ↓
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Quick stats ─────────────────────────────────────────────── */}
        {player && !loading && (
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '10px 16px',
              borderBottom: '1px solid var(--border-card)',
              flexShrink: 0,
            }}
          >
            <StatBox label="Matches" value={matchCount} />
            <StatBox
              label="Win Rate"
              value={player.win_rate != null ? `${Math.round(player.win_rate * 100)}%` : null}
            />
            <StatBox label="Titles" value={player.titles} />
          </div>
        )}

        {/* ── Tab bar ─────────────────────────────────────────────────── */}
        {player && !loading && (
          <div
            style={{
              display: 'flex',
              borderBottom: '1px solid var(--border-card)',
              flexShrink: 0,
            }}
          >
            <TabButton id="profile" label="Profile" active={tab === 'profile'} onClick={setTab} />
            <TabButton id="ids" label="IDs" active={tab === 'ids'} onClick={setTab} />
            <TabButton id="equipment" label="Equipment" active={tab === 'equipment'} onClick={setTab} />
          </div>
        )}

        {/* ── Tab content (scrollable) ─────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
          {loading && (
            <div style={{ color: 'var(--text-3)', fontSize: 13, textAlign: 'center', padding: 32 }}>
              Loading…
            </div>
          )}

          {!loading && player && tab === 'profile' && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '10px 12px',
              }}
            >
              <Field label="Full Name">
                <input
                  className="ui-input"
                  style={inputStyle}
                  value={form.name ?? ''}
                  onChange={(e) => setField('name', e.target.value)}
                />
              </Field>

              <Field label="Display Name">
                <input
                  className="ui-input"
                  style={inputStyle}
                  value={form.display_name ?? ''}
                  placeholder="Optional"
                  onChange={(e) => setField('display_name', e.target.value)}
                />
              </Field>

              <Field label="Country (ISO code)">
                <input
                  className="ui-input"
                  style={inputStyle}
                  value={form.country ?? ''}
                  placeholder="e.g. ES"
                  maxLength={3}
                  onChange={(e) => setField('country', e.target.value.toUpperCase())}
                />
              </Field>

              <Field label="Category">
                <select
                  className="ui-select"
                  style={selectStyle}
                  value={form.category ?? ''}
                  onChange={(e) => setField('category', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="men">Men</option>
                  <option value="women">Women</option>
                </select>
              </Field>

              <Field label="Side">
                <select
                  className="ui-select"
                  style={selectStyle}
                  value={form.side ?? ''}
                  onChange={(e) => setField('side', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                </select>
              </Field>

              <Field label="Hand">
                <select
                  className="ui-select"
                  style={selectStyle}
                  value={form.hand ?? ''}
                  onChange={(e) => setField('hand', e.target.value)}
                >
                  <option value="">—</option>
                  <option value="right">Right</option>
                  <option value="left">Left</option>
                </select>
              </Field>

              <Field label="Height">
                <input
                  className="ui-input"
                  style={inputStyle}
                  value={form.height ?? ''}
                  placeholder="e.g. 185cm"
                  onChange={(e) => setField('height', e.target.value)}
                />
              </Field>

              <Field label="Birthdate">
                <input
                  type="date"
                  className="ui-input"
                  style={inputStyle}
                  value={form.birthdate ?? ''}
                  onChange={(e) => setField('birthdate', e.target.value)}
                />
              </Field>

              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Birthplace">
                  <input
                    className="ui-input"
                  style={inputStyle}
                    value={form.birthplace ?? ''}
                    placeholder="City, Country"
                    onChange={(e) => setField('birthplace', e.target.value)}
                  />
                </Field>
              </div>
            </div>
          )}

          {!loading && player && tab === 'ids' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <Field label="External ID (padelapi.org)">
                <input
                  className="ui-input"
                  style={inputStyle}
                  value={form.external_id ?? ''}
                  onChange={(e) => setField('external_id', e.target.value)}
                />
              </Field>
              <Field label="FIP ID">
                <input
                  className="ui-input"
                  style={inputStyle}
                  value={form.fip_id ?? ''}
                  placeholder="e.g. fip-P200038"
                  onChange={(e) => setField('fip_id', e.target.value)}
                />
              </Field>
              <div style={{ marginTop: 8, padding: '10px 12px', background: 'var(--bg-card-2)', borderRadius: 'var(--r-xs)', border: '1px solid var(--border-card)' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-2)', marginBottom: 4 }}>Internal UUID</div>
                <div style={{ fontSize: 11, color: 'var(--text-1)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {player.id}
                </div>
              </div>
            </div>
          )}

          {!loading && player && tab === 'equipment' && (
            <EquipmentTab
              playerId={player.id}
              player={{
                id: player.id,
                name: player.name,
                display_name: player.display_name,
                country: player.country,
                ranking: player.ranking,
                category: player.category === 'men' || player.category === 'women'
                  ? player.category
                  : null,
                avatar_url: player.avatar_url,
              }}
            />
          )}
        </div>

        {/* ── Sticky Save button ───────────────────────────────────────── */}
        {player && !loading && tab !== 'equipment' && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--border-card)',
              flexShrink: 0,
              background: 'var(--bg-surface)',
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={!isDirty || saving}
              style={{ flex: 1 }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </Button>

            {saveMsg === 'ok' && (
              <span style={{ fontSize: 12, color: 'var(--lime-text)', fontWeight: 600 }}>
                ✓ Saved
              </span>
            )}
            {saveMsg === 'err' && (
              <span style={{ fontSize: 12, color: 'var(--live-text)', fontWeight: 600 }}>
                Save failed
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
}
