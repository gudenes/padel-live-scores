'use client'
// apps/ops/src/components/ResolvePartnerModal.tsx
//
// Two flows: Link to existing player (stores an alias) or Create new player
// (creates row + auto-alias). On success the parent closes the modal and
// instructs the operator to re-seed.

import { useState, useEffect, useCallback } from 'react'

export interface ResolvePartnerContext {
  parsedName: string
  category: 'men' | 'women'
  countryHint: string | null
}

interface SearchHit {
  id: string
  name: string
  country: string | null
  ranking: number | null
  fip_id: string | null
}

export function ResolvePartnerModal({
  ctx,
  onClose,
  onResolved,
}: {
  ctx: ResolvePartnerContext | null
  onClose: () => void
  onResolved: () => void
}) {
  const [tab, setTab] = useState<'link' | 'create'>('link')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createCountry, setCreateCountry] = useState('')

  useEffect(() => {
    if (!ctx) return
    setTab('link')
    setQuery(ctx.parsedName)
    setHits([])
    setBusy(null)
    setError(null)
    setCreateName(ctx.parsedName)
    setCreateCountry(ctx.countryHint ?? '')
  }, [ctx])

  useEffect(() => {
    if (!ctx || !query.trim()) {
      setHits([])
      return
    }
    const handle = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`/api/internal/players/search?q=${encodeURIComponent(query)}&category=${ctx.category}&per_page=25`)
        const b = await r.json()
        setHits(b.players ?? [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(handle)
  }, [query, ctx])

  const link = useCallback(
    async (playerId: string) => {
      if (!ctx) return
      setBusy(playerId)
      setError(null)
      try {
        const r = await fetch('/api/internal/player-aliases', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ playerId, alias: ctx.parsedName }),
        })
        const b = await r.json()
        if (!b.ok) throw new Error(b.error ?? 'link failed')
        onResolved()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'link failed')
      } finally {
        setBusy(null)
      }
    },
    [ctx, onResolved],
  )

  const create = useCallback(async () => {
    if (!ctx) return
    setBusy('__create__')
    setError(null)
    try {
      const r = await fetch('/api/internal/players', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          country: createCountry.trim() || null,
          category: ctx.category,
          sourceName: ctx.parsedName,
        }),
      })
      const b = await r.json()
      if (!b.ok) throw new Error(b.error ?? 'create failed')
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed')
    } finally {
      setBusy(null)
    }
  }, [ctx, createName, createCountry, onResolved])

  if (!ctx) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 20, width: 520, maxHeight: '80vh', overflow: 'auto' }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>Resolve unresolved partner</div>
        <div style={{ fontSize: 12, color: 'var(--status-neutral)', marginBottom: 12 }}>
          <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 3 }}>{ctx.parsedName}</code>{' '}
          ({ctx.category}{ctx.countryHint ? `, ${ctx.countryHint}` : ''})
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['link', 'create'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                border: '1px solid', borderColor: tab === t ? '#3b82f6' : 'var(--border-subtle)',
                background: tab === t ? '#eff6ff' : 'var(--bg-card)',
                color: tab === t ? '#1e40af' : '#555',
                borderRadius: 4, cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {t === 'link' ? 'Link to existing' : 'Create new player'}
            </button>
          ))}
        </div>

        {tab === 'link' && (
          <div>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players by name..."
              style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 4, marginBottom: 8 }}
            />
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
              {searching && <div style={{ padding: 8, fontSize: 12, color: 'var(--status-neutral)' }}>Searching...</div>}
              {!searching && hits.length === 0 && <div style={{ padding: 8, fontSize: 12, color: 'var(--status-neutral)' }}>No matches.</div>}
              {hits.map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', padding: 8, borderBottom: '1px solid var(--border-subtle)', gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 12 }}>
                    <div style={{ fontWeight: 500 }}>{h.name}</div>
                    <div style={{ color: 'var(--status-neutral)', fontSize: 10, fontFamily: 'monospace' }}>
                      {h.country ?? '—'} · rank {h.ranking ?? '—'} · {h.fip_id ?? 'no fip_id'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => link(h.id)}
                    disabled={busy !== null}
                    style={{
                      padding: '4px 10px', fontSize: 11, fontWeight: 700,
                      background: busy === h.id ? '#d1d5db' : '#111',
                      color: '#fff', border: 'none', borderRadius: 4,
                      cursor: busy === h.id ? 'wait' : 'pointer',
                    }}
                  >
                    {busy === h.id ? 'Linking...' : 'Link'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'create' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--status-neutral)' }}>
              Name
              <input value={createName} onChange={(e) => setCreateName(e.target.value)}
                style={{ display: 'block', width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 4, marginTop: 2 }} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--status-neutral)' }}>
              Country (ISO-2, e.g. AL)
              <input value={createCountry} onChange={(e) => setCreateCountry(e.target.value)} maxLength={3}
                style={{ display: 'block', width: 100, padding: '6px 10px', fontSize: 13, border: '1px solid var(--border-subtle)', borderRadius: 4, marginTop: 2 }} />
            </label>
            <button
              type="button"
              onClick={create}
              disabled={busy !== null || !createName.trim()}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 700,
                background: busy ? '#d1d5db' : '#111',
                color: '#fff', border: 'none', borderRadius: 4,
                cursor: busy ? 'wait' : 'pointer', alignSelf: 'flex-start',
              }}
            >
              {busy === '__create__' ? 'Creating...' : 'Create player + alias'}
            </button>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: 8, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 11, color: '#991b1b' }}>{error}</div>
        )}

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={{ padding: '6px 12px', fontSize: 12, background: '#f3f4f6', border: '1px solid var(--border-subtle)', borderRadius: 4, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
