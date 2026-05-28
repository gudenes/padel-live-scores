'use client'

import { useCallback, useEffect, useState } from 'react'

interface Partner {
  id: string
  name: string
  country_code: string
  fallback_url: string
  active: boolean
}

interface LinkRow {
  id: string
  racket_id: string
  partner_id: string
  url: string
  racket_model: string
  racket_year: number | null
  brand_name: string | null
}

interface RacketOption {
  id: string
  label: string
}

const card: React.CSSProperties = {
  background: 'var(--bg-card)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 16,
}
const input: React.CSSProperties = {
  fontSize: 13,
  padding: '7px 10px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  width: '100%',
  background: 'var(--bg-card)',
  color: 'var(--brand-primary-fg)',
}
const btn: React.CSSProperties = {
  fontSize: 13,
  padding: '7px 12px',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  background: 'var(--bg-card)',
  color: 'var(--brand-primary-fg)',
  cursor: 'pointer',
}
const btnPrimary: React.CSSProperties = {
  ...btn,
  background: 'var(--brand-primary-fg)',
  color: 'var(--bg-canvas)',
  borderColor: 'var(--brand-primary-fg)',
  fontWeight: 600,
}

export function PartnersClient() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [links, setLinks] = useState<LinkRow[]>([])
  const [rackets, setRackets] = useState<RacketOption[]>([])
  const [newPartner, setNewPartner] = useState({ name: '', country_code: '', fallback_url: '' })
  const [newLink, setNewLink] = useState({ racket_id: '', url: '' })
  const [message, setMessage] = useState<string | null>(null)

  const runFetch = useCallback(async (label: string, fetchInput: RequestInfo | URL, init?: RequestInit) => {
    setMessage(null)
    try {
      const res = await fetch(fetchInput, init)
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({})) as { error?: string }
        setMessage(`${label}: ${res.status} ${errBody?.error ?? res.statusText}`)
        return null
      }
      return res
    } catch (err) {
      setMessage(`${label}: ${err instanceof Error ? err.message : 'network error'}`)
      return null
    }
  }, [])

  const loadPartners = useCallback(async () => {
    const res = await runFetch('Load partners', '/api/internal/partners')
    if (!res) return
    const json = await res.json() as { partners?: Partner[] }
    setPartners(json.partners ?? [])
  }, [runFetch])

  const loadLinks = useCallback(async (partnerId: string) => {
    const res = await runFetch('Load per-racket URLs', `/api/internal/racket-partner-links?partner_id=${partnerId}`)
    if (!res) return
    const json = await res.json() as { links?: LinkRow[] }
    setLinks(json.links ?? [])
  }, [runFetch])

  const loadRackets = useCallback(async () => {
    const res = await runFetch('Load rackets', '/api/internal/rackets')
    if (!res) return
    const json = await res.json() as { rackets?: Array<{ id: string; model: string; year: number | null; brand_name: string | null }> }
    const options: RacketOption[] = (json.rackets ?? []).map((r) => ({
      id: r.id,
      label: `${r.brand_name ?? '?'} — ${r.model}${r.year ? ` (${r.year})` : ''}`,
    }))
    setRackets(options)
  }, [runFetch])

  useEffect(() => { void loadPartners(); void loadRackets() }, [loadPartners, loadRackets])
  useEffect(() => { if (selectedId) void loadLinks(selectedId) }, [selectedId, loadLinks])

  const selectedPartner = partners.find((p) => p.id === selectedId) ?? null

  const createPartner = async () => {
    if (!newPartner.name || !newPartner.country_code || !newPartner.fallback_url) return
    const res = await runFetch('Create partner', '/api/internal/partners', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newPartner),
    })
    if (!res) return
    setNewPartner({ name: '', country_code: '', fallback_url: '' })
    void loadPartners()
  }

  const togglePartnerActive = async (p: Partner) => {
    const res = await runFetch('Toggle active', '/api/internal/partners', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, active: !p.active }),
    })
    if (!res) return
    void loadPartners()
  }

  const addLink = async () => {
    if (!selectedId || !newLink.racket_id || !newLink.url) return
    const res = await runFetch('Save per-racket URL', '/api/internal/racket-partner-links', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ partner_id: selectedId, racket_id: newLink.racket_id, url: newLink.url }),
    })
    if (!res) return
    setNewLink({ racket_id: '', url: '' })
    void loadLinks(selectedId)
  }

  const removeLink = async (id: string) => {
    const res = await runFetch('Remove per-racket URL', `/api/internal/racket-partner-links?id=${id}`, { method: 'DELETE' })
    if (!res) return
    if (selectedId) void loadLinks(selectedId)
  }

  return (
    <>
      {message && (
        <div style={{ fontSize: 13, color: 'var(--status-urgent)', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '8px 12px', marginBottom: 16 }}>
          {message}
        </div>
      )}

      {/* Partner list */}
      <section style={card}>
        <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px' }}>Active partners</h3>
        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: 'var(--status-neutral)', fontWeight: 600 }}>
              <th style={{ padding: '6px 8px' }}>Name</th>
              <th style={{ padding: '6px 8px' }}>Country</th>
              <th style={{ padding: '6px 8px' }}>Fallback URL</th>
              <th style={{ padding: '6px 8px' }}>Active</th>
              <th style={{ padding: '6px 8px' }} />
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <tr key={p.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '8px' }}>{p.name}</td>
                <td style={{ padding: '8px' }}>{p.country_code}</td>
                <td style={{ padding: '8px', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.fallback_url}</td>
                <td style={{ padding: '8px' }}>
                  <button type="button" style={btn} onClick={() => togglePartnerActive(p)}>{p.active ? 'on' : 'off'}</button>
                </td>
                <td style={{ padding: '8px' }}>
                  <button type="button" style={btn} onClick={() => setSelectedId(p.id)}>
                    {selectedId === p.id ? 'selected' : 'manage'}
                  </button>
                </td>
              </tr>
            ))}
            {partners.length === 0 && (
              <tr><td colSpan={5} style={{ padding: '16px 8px', color: 'var(--status-neutral)' }}>No partners yet.</td></tr>
            )}
          </tbody>
        </table>

        {/* Create-partner form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 2fr auto', gap: 8, marginTop: 16 }}>
          <input style={input} placeholder="Name" value={newPartner.name}
            onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })} />
          <input style={input} placeholder="BR" maxLength={2}
            value={newPartner.country_code}
            onChange={(e) => setNewPartner({ ...newPartner, country_code: e.target.value.toUpperCase().slice(0, 2) })} />
          <input style={input} placeholder="https://partner.example/"
            value={newPartner.fallback_url}
            onChange={(e) => setNewPartner({ ...newPartner, fallback_url: e.target.value })} />
          <button type="button" style={btnPrimary} onClick={createPartner}>Add partner</button>
        </div>
      </section>

      {/* Per-racket links for selected partner */}
      {selectedPartner && (
        <section style={card}>
          <h3 style={{ fontSize: 14, fontWeight: 700, margin: '0 0 12px' }}>
            Per-racket URLs for {selectedPartner.name} ({selectedPartner.country_code})
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, marginBottom: 16 }}>
            <select style={input} value={newLink.racket_id}
              onChange={(e) => setNewLink({ ...newLink, racket_id: e.target.value })}>
              <option value="">— pick a racket —</option>
              {rackets.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            <input style={input} placeholder="https://www.torodoro.com.br/produto/..."
              value={newLink.url}
              onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
            <button type="button" style={btnPrimary} onClick={addLink}>Save URL</button>
          </div>

          <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--status-neutral)', fontWeight: 600 }}>
                <th style={{ padding: '6px 8px' }}>Racket</th>
                <th style={{ padding: '6px 8px' }}>URL</th>
                <th style={{ padding: '6px 8px' }} />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '8px' }}>
                    {l.brand_name ?? '?'} — {l.racket_model}{l.racket_year ? ` (${l.racket_year})` : ''}
                  </td>
                  <td style={{ padding: '8px', maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.url}</td>
                  <td style={{ padding: '8px' }}>
                    <button type="button" style={btn} onClick={() => removeLink(l.id)}>remove</button>
                  </td>
                </tr>
              ))}
              {links.length === 0 && (
                <tr><td colSpan={3} style={{ padding: '16px 8px', color: 'var(--status-neutral)' }}>No per-racket overrides — clicks fall through to the partner homepage.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
