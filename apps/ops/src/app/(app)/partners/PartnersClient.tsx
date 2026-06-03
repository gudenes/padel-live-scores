'use client'

import { useCallback, useEffect, useState } from 'react'
import { Panel, DataTable, Field, Button } from '@/components/ui'

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
        <div style={{
          fontSize: 13, color: 'var(--live-text)', background: 'var(--live-bg)',
          border: '1px solid var(--live-border)', borderRadius: 'var(--r-sm)',
          padding: '8px 12px', marginBottom: 16,
        }}>
          {message}
        </div>
      )}

      {/* Partner list */}
      <div style={{ marginBottom: 16 }}>
        <Panel title="Active partners">
          <DataTable>
            <thead>
              <tr>
                <th>Name</th>
                <th>Country</th>
                <th>Fallback URL</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.country_code}</td>
                  <td style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.fallback_url}</td>
                  <td>
                    <Button size="sm" onClick={() => togglePartnerActive(p)}>{p.active ? 'on' : 'off'}</Button>
                  </td>
                  <td>
                    <Button size="sm" variant={selectedId === p.id ? 'primary' : 'default'} onClick={() => setSelectedId(p.id)}>
                      {selectedId === p.id ? 'selected' : 'manage'}
                    </Button>
                  </td>
                </tr>
              ))}
              {partners.length === 0 && (
                <tr><td colSpan={5} style={{ color: 'var(--text-3)' }}>No partners yet.</td></tr>
              )}
            </tbody>
          </DataTable>

          {/* Create-partner form */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 90px 2fr auto', gap: 8, marginTop: 16, alignItems: 'flex-end' }}>
            <Field label="Name">
              <input className="ui-input" placeholder="Name" value={newPartner.name}
                onChange={(e) => setNewPartner({ ...newPartner, name: e.target.value })} />
            </Field>
            <Field label="Country">
              <input className="ui-input" placeholder="BR" maxLength={2}
                value={newPartner.country_code}
                onChange={(e) => setNewPartner({ ...newPartner, country_code: e.target.value.toUpperCase().slice(0, 2) })} />
            </Field>
            <Field label="Fallback URL">
              <input className="ui-input" placeholder="https://partner.example/"
                value={newPartner.fallback_url}
                onChange={(e) => setNewPartner({ ...newPartner, fallback_url: e.target.value })} />
            </Field>
            <Button variant="primary" onClick={createPartner}>Add partner</Button>
          </div>
        </Panel>
      </div>

      {/* Per-racket links for selected partner */}
      {selectedPartner && (
        <Panel title={`Per-racket URLs for ${selectedPartner.name} (${selectedPartner.country_code})`}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
            <Field label="Racket">
              <select className="ui-select" value={newLink.racket_id}
                onChange={(e) => setNewLink({ ...newLink, racket_id: e.target.value })}>
                <option value="">— pick a racket —</option>
                {rackets.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
              </select>
            </Field>
            <Field label="URL">
              <input className="ui-input" placeholder="https://www.torodoro.com.br/produto/..."
                value={newLink.url}
                onChange={(e) => setNewLink({ ...newLink, url: e.target.value })} />
            </Field>
            <Button variant="primary" onClick={addLink}>Save URL</Button>
          </div>

          <DataTable>
            <thead>
              <tr>
                <th>Racket</th>
                <th>URL</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.brand_name ?? '?'} — {l.racket_model}{l.racket_year ? ` (${l.racket_year})` : ''}
                  </td>
                  <td style={{ maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.url}</td>
                  <td>
                    <Button size="sm" variant="danger" onClick={() => removeLink(l.id)}>remove</Button>
                  </td>
                </tr>
              ))}
              {links.length === 0 && (
                <tr><td colSpan={3} style={{ color: 'var(--text-3)' }}>No per-racket overrides — clicks fall through to the partner homepage.</td></tr>
              )}
            </tbody>
          </DataTable>
        </Panel>
      )}
    </>
  )
}
