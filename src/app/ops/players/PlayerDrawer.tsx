'use client'
// src/app/ops/players/PlayerDrawer.tsx
// Right-side overlay drawer for editing player details.

import React, { useEffect, useRef, useState, useCallback } from 'react'
import { PlayerDetail } from './types'

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

interface Brand {
  id: string
  name: string
  logo_url: string | null
}

interface Racket {
  id: string
  model: string
  year: number | null
  image_url: string | null
  brand: Brand
}

interface EquipmentEntry {
  id: string
  started_at: string | null
  ended_at: string | null
  racket: Racket & { brand: Brand }
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
  const [equipmentHistory, setEquipmentHistory] = useState<EquipmentEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState<TabId>('profile')

  // Editable form state (mirrors PlayerDetail fields)
  const [form, setForm] = useState<Record<string, string>>({})
  const [original, setOriginal] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<'ok' | 'err' | null>(null)

  // Equipment assignment
  const [brands, setBrands] = useState<Brand[]>([])
  const [rackets, setRackets] = useState<Racket[]>([])
  const [selectedBrandId, setSelectedBrandId] = useState<string>('')
  const [selectedRacketId, setSelectedRacketId] = useState<string>('')
  const [showEquipmentPicker, setShowEquipmentPicker] = useState(false)
  const [assigningEquip, setAssigningEquip] = useState(false)

  const drawerRef = useRef<HTMLDivElement>(null)

  // ── Derived state ────────────────────────────────────────────────────────
  const isDirty = Object.keys(form).some((k) => form[k] !== original[k])

  // ── Data fetching ────────────────────────────────────────────────────────

  const fetchPlayer = useCallback(async (id: string) => {
    setLoading(true)
    setSaveMsg(null)
    setTab('profile')
    try {
      const res = await fetch(`/api/ops/players?id=${id}`)
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

  const fetchEquipment = useCallback(async (id: string) => {
    const res = await fetch(`/api/ops/player-equipment?player_id=${id}`)
    if (!res.ok) return
    const data = await res.json() as { equipment: EquipmentEntry[] }
    setEquipmentHistory(data.equipment ?? [])
  }, [])

  const fetchBrands = useCallback(async () => {
    if (brands.length > 0) return
    const res = await fetch('/api/ops/brands')
    if (!res.ok) return
    const data = await res.json() as { brands: Brand[] }
    setBrands(data.brands ?? [])
  }, [brands.length])

  const fetchRackets = useCallback(async (brandId: string) => {
    setRackets([])
    setSelectedRacketId('')
    if (!brandId) return
    const res = await fetch(`/api/ops/rackets?brand_id=${brandId}`)
    if (!res.ok) return
    const data = await res.json() as { rackets: Racket[] }
    setRackets(data.rackets ?? [])
  }, [])

  // ── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!playerId) {
      setPlayer(null)
      setEquipmentHistory([])
      setForm({})
      setOriginal({})
      return
    }
    fetchPlayer(playerId)
    fetchEquipment(playerId)
  }, [playerId, fetchPlayer, fetchEquipment])

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

  // Brand selection → load rackets
  useEffect(() => {
    if (selectedBrandId) fetchRackets(selectedBrandId)
  }, [selectedBrandId, fetchRackets])

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

    const res = await fetch('/api/ops/players', {
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

  async function handleAssignEquipment() {
    if (!player || !selectedRacketId) return
    setAssigningEquip(true)
    const res = await fetch('/api/ops/player-equipment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player_id: player.id, racket_id: selectedRacketId }),
    })
    setAssigningEquip(false)
    if (res.ok) {
      setShowEquipmentPicker(false)
      setSelectedBrandId('')
      setSelectedRacketId('')
      fetchEquipment(player.id)
      onSaved()
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────

  if (!playerId) return null

  const currentEquipment = equipmentHistory.find((e) => !e.ended_at)

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
                    src={`https://flagcdn.com/w20/${player.country.toLowerCase()}.png`}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Current equipment */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 8 }}>
                  CURRENT EQUIPMENT
                </div>
                {currentEquipment ? (
                  <div
                    style={{
                      display: 'flex',
                      gap: 12,
                      alignItems: 'center',
                      padding: '10px 12px',
                      background: '#f9fafb',
                      borderRadius: 8,
                      border: '1px solid #e5e7eb',
                    }}
                  >
                    {currentEquipment.racket.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={currentEquipment.racket.image_url}
                        alt={currentEquipment.racket.model}
                        style={{ width: 48, height: 48, objectFit: 'contain', flexShrink: 0 }}
                      />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#111' }}>
                        {currentEquipment.racket.brand.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#6B7280' }}>
                        {currentEquipment.racket.model}
                        {currentEquipment.racket.year && (
                          <span style={{ color: '#9ca3af', marginLeft: 4 }}>{currentEquipment.racket.year}</span>
                        )}
                      </div>
                      {currentEquipment.started_at && (
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                          Since {currentEquipment.started_at}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => {
                        setShowEquipmentPicker(true)
                        fetchBrands()
                      }}
                      style={{
                        padding: '5px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        border: '1px solid #e5e7eb',
                        borderRadius: 4,
                        background: '#fff',
                        color: '#111',
                        cursor: 'pointer',
                      }}
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: '12px 14px',
                      background: '#fafafa',
                      borderRadius: 8,
                      border: '1px dashed #e5e7eb',
                      color: '#9ca3af',
                      fontSize: 12,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>No equipment assigned</span>
                    <button
                      onClick={() => {
                        setShowEquipmentPicker(true)
                        fetchBrands()
                      }}
                      style={{
                        padding: '5px 10px',
                        fontSize: 11,
                        fontWeight: 600,
                        border: '1px solid #e5e7eb',
                        borderRadius: 4,
                        background: '#fff',
                        color: '#111',
                        cursor: 'pointer',
                      }}
                    >
                      Assign
                    </button>
                  </div>
                )}
              </div>

              {/* Equipment picker */}
              {showEquipmentPicker && (
                <div
                  style={{
                    padding: 12,
                    background: '#f9fafb',
                    borderRadius: 8,
                    border: '1px solid #e5e7eb',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#111' }}>
                    Assign new racket
                  </div>
                  <Field label="Brand">
                    <select
                      style={selectStyle}
                      value={selectedBrandId}
                      onChange={(e) => setSelectedBrandId(e.target.value)}
                    >
                      <option value="">Select brand…</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </Field>
                  {selectedBrandId && (
                    <Field label="Racket">
                      <select
                        style={selectStyle}
                        value={selectedRacketId}
                        onChange={(e) => setSelectedRacketId(e.target.value)}
                      >
                        <option value="">Select racket…</option>
                        {rackets.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.model}{r.year ? ` (${r.year})` : ''}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      onClick={handleAssignEquipment}
                      disabled={!selectedRacketId || assigningEquip}
                      style={{
                        flex: 1,
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 600,
                        background: selectedRacketId && !assigningEquip ? '#111' : '#e5e7eb',
                        color: selectedRacketId && !assigningEquip ? '#fff' : '#9ca3af',
                        border: 'none',
                        borderRadius: 4,
                        cursor: selectedRacketId && !assigningEquip ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {assigningEquip ? 'Saving…' : 'Confirm'}
                    </button>
                    <button
                      onClick={() => {
                        setShowEquipmentPicker(false)
                        setSelectedBrandId('')
                        setSelectedRacketId('')
                      }}
                      style={{
                        padding: '6px 12px',
                        fontSize: 12,
                        fontWeight: 500,
                        background: 'none',
                        border: '1px solid #e5e7eb',
                        borderRadius: 4,
                        cursor: 'pointer',
                        color: '#6B7280',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              {/* Equipment history */}
              {equipmentHistory.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', marginBottom: 8 }}>
                    HISTORY
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {equipmentHistory.map((entry) => (
                      <div
                        key={entry.id}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'center',
                          padding: '8px 10px',
                          background: entry.ended_at ? '#f9fafb' : 'transparent',
                          borderRadius: 6,
                          border: '1px solid #e5e7eb',
                          opacity: entry.ended_at ? 0.7 : 1,
                        }}
                      >
                        {entry.racket.image_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={entry.racket.image_url}
                            alt={entry.racket.model}
                            style={{ width: 32, height: 32, objectFit: 'contain', flexShrink: 0 }}
                          />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>
                            {entry.racket.brand.name} {entry.racket.model}
                          </div>
                          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 1 }}>
                            {entry.started_at ?? '?'}
                            {' → '}
                            {entry.ended_at ?? 'present'}
                          </div>
                        </div>
                        {!entry.ended_at && (
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '2px 6px',
                              background: '#dcfce7',
                              color: '#166534',
                              fontSize: 10,
                              fontWeight: 600,
                              borderRadius: 4,
                            }}
                          >
                            Current
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
