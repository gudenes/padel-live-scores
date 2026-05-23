'use client'
// src/app/ops/players/PlayerDrawer.tsx
// Right-side overlay drawer for editing player details.

import React, { useEffect, useRef, useState, useCallback } from 'react'
import Link from 'next/link'
import { PlayerDetail } from './types'
import EquipmentTab from './EquipmentTab'

// ─── Style constants ──────────────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  color: '#6B7280',
  fontWeight: 600,
  display: 'block',
  marginBottom: 2,
}
const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: 12,
  border: '1px solid #e5e7eb',
  borderRadius: 4,
  color: '#111',
  boxSizing: 'border-box',
  background: '#fff',
}
const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlayerDrawerProps {
  playerId: string | null
  onClose: () => void
  onSaved: () => void
  onNavigate: (direction: 'prev' | 'next') => void
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
        background: '#f9fafb',
        borderRadius: 6,
        padding: '8px 10px',
        textAlign: 'center',
        border: '1px solid #e5e7eb',
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: '#111' }}>
        {value ?? '—'}
      </div>
      <div style={{ fontSize: 10, color: '#6B7280', marginTop: 2, fontWeight: 500 }}>{label}</div>
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
        color: active ? '#111' : '#6B7280',
        background: 'none',
        border: 'none',
        borderBottom: active ? '2px solid #111' : '2px solid transparent',
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
        onNavigate('prev')
      } else if (e.key === 'ArrowDown' && !isEditing) {
        e.preventDefault()
        onNavigate('next')
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
      onSaved()
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
          background: 'rgba(0,0,0,0.25)',
          zIndex: 100,
        }}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          background: '#fff',
          zIndex: 101,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.12)',
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
            borderBottom: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          {loading ? (
            <div style={{ height: 64, display: 'flex', alignItems: 'center', color: '#9ca3af', fontSize: 13 }}>
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
                    style={{ width: 64, height: 64, borderRadius: '50%', objectFit: 'cover', border: '2px solid #e5e7eb' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: '50%',
                      background: '#e5e7eb',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      fontWeight: 700,
                      color: '#6B7280',
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
                <div style={{ fontSize: 16, fontWeight: 700, color: '#111', lineHeight: 1.2 }}>
                  {player.display_name || player.name}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                  {player.ranking != null && (
                    <span
                      style={{
                        display: 'inline-block',
                        padding: '2px 7px',
                        borderRadius: 10,
                        background: '#111',
                        color: '#fff',
                        fontSize: 11,
                        fontWeight: 600,
                      }}
                    >
                      #{player.ranking}
                    </span>
                  )}
                  {player.country && (
                    <span style={{ fontSize: 12, color: '#6B7280' }}>
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
                        background: player.category === 'men' ? '#DBEAFE' : '#FCE7F3',
                        color: player.category === 'men' ? '#1E40AF' : '#9D174D',
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
                    color: '#2563EB',
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
                    color: '#6B7280',
                    lineHeight: 1,
                    padding: '4px 6px',
                    borderRadius: 4,
                  }}
                >
                  ✕
                </button>
                <button
                  onClick={() => onNavigate('prev')}
                  title="Previous player (↑)"
                  style={{
                    background: 'none',
                    border: '1px solid #e5e7eb',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: '#6B7280',
                    lineHeight: 1,
                    padding: '3px 6px',
                    borderRadius: 4,
                  }}
                >
                  ↑
                </button>
                <button
                  onClick={() => onNavigate('next')}
                  title="Next player (↓)"
                  style={{
                    background: 'none',
                    border: '1px solid #e5e7eb',
                    cursor: 'pointer',
                    fontSize: 12,
                    color: '#6B7280',
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
              borderBottom: '1px solid #e5e7eb',
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
              borderBottom: '1px solid #e5e7eb',
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
            <div style={{ color: '#9ca3af', fontSize: 13, textAlign: 'center', padding: 32 }}>
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
                  style={inputStyle}
                  value={form.name ?? ''}
                  onChange={(e) => setField('name', e.target.value)}
                />
              </Field>

              <Field label="Display Name">
                <input
                  style={inputStyle}
                  value={form.display_name ?? ''}
                  placeholder="Optional"
                  onChange={(e) => setField('display_name', e.target.value)}
                />
              </Field>

              <Field label="Country (ISO code)">
                <input
                  style={inputStyle}
                  value={form.country ?? ''}
                  placeholder="e.g. ES"
                  maxLength={3}
                  onChange={(e) => setField('country', e.target.value.toUpperCase())}
                />
              </Field>

              <Field label="Category">
                <select
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
                  style={inputStyle}
                  value={form.height ?? ''}
                  placeholder="e.g. 185cm"
                  onChange={(e) => setField('height', e.target.value)}
                />
              </Field>

              <Field label="Birthdate">
                <input
                  type="date"
                  style={inputStyle}
                  value={form.birthdate ?? ''}
                  onChange={(e) => setField('birthdate', e.target.value)}
                />
              </Field>

              <div style={{ gridColumn: '1 / -1' }}>
                <Field label="Birthplace">
                  <input
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
                  style={inputStyle}
                  value={form.external_id ?? ''}
                  onChange={(e) => setField('external_id', e.target.value)}
                />
              </Field>
              <Field label="FIP ID">
                <input
                  style={inputStyle}
                  value={form.fip_id ?? ''}
                  placeholder="e.g. fip-P200038"
                  onChange={(e) => setField('fip_id', e.target.value)}
                />
              </Field>
              <div style={{ marginTop: 8, padding: '10px 12px', background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#6B7280', marginBottom: 4 }}>Internal UUID</div>
                <div style={{ fontSize: 11, color: '#111', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                  {player.id}
                </div>
              </div>
            </div>
          )}

          {!loading && player && tab === 'equipment' && (
            <EquipmentTab playerId={player.id} />
          )}
        </div>

        {/* ── Sticky Save button ───────────────────────────────────────── */}
        {player && !loading && tab !== 'equipment' && (
          <div
            style={{
              padding: '12px 16px',
              borderTop: '1px solid #e5e7eb',
              flexShrink: 0,
              background: '#fff',
              display: 'flex',
              gap: 10,
              alignItems: 'center',
            }}
          >
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              style={{
                flex: 1,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: isDirty && !saving ? '#111' : '#e5e7eb',
                color: isDirty && !saving ? '#fff' : '#9ca3af',
                border: 'none',
                borderRadius: 6,
                cursor: isDirty && !saving ? 'pointer' : 'not-allowed',
                transition: 'background 0.15s',
              }}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>

            {saveMsg === 'ok' && (
              <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>
                ✓ Saved
              </span>
            )}
            {saveMsg === 'err' && (
              <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
                Save failed
              </span>
            )}
          </div>
        )}
      </div>
    </>
  )
}
