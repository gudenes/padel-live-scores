// apps/ops/src/app/(app)/news-sources/EditSourceDrawer.tsx
'use client'

import { useEffect, useState } from 'react'
import { Field, Button } from '@/components/ui'
import { Drawer } from './AddSourceDrawer'

interface Source {
  id: string
  key: string
  name: string
  url: string
  source_type: string
  language: string
  cadence: string
  weight: number
  lookback_days: number
  enabled: boolean
  articles_last_7d: number
  last_fetch_at: string | null
  last_fetch_status: string | null
  query_kind: string | null
  notes: string | null
  extraction_quality_pct: number | null
  auto_disabled_at: string | null
}

interface Props {
  source: Source
  onClose: () => void
  onSaved: () => void | Promise<void>
  onDeleted: () => void | Promise<void>
}

export function EditSourceDrawer({ source, onClose, onSaved, onDeleted }: Props) {
  const [name, setName] = useState(source.name)
  const [url, setUrl] = useState(source.url)
  const [language, setLanguage] = useState(source.language)
  const [weight, setWeight] = useState(source.weight)
  const [cadence, setCadence] = useState(source.cadence)
  const [lookbackDays, setLookbackDays] = useState(source.lookback_days)
  const [enabled, setEnabled] = useState(source.enabled)
  const [notes, setNotes] = useState(source.notes ?? '')

  const [recentArticles, setRecentArticles] = useState<Array<{ title: string; published_at: string }>>([])
  const [retestResult, setRetestResult] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/news-sources/recent-articles?source_id=${source.id}`)
      .then(r => r.ok ? r.json() : { articles: [] })
      .then(d => setRecentArticles(d.articles ?? []))
      .catch(() => {})
  }, [source.id])

  const save = async () => {
    setSaving(true); setError(null)
    const body = { id: source.id, name, url, language, weight, cadence, lookback_days: lookbackDays, enabled, notes }
    const r = await fetch('/api/news-sources', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    setSaving(false)
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); return }
    await onSaved()
  }

  const del = async () => {
    if (!confirm(`Delete source "${source.name}"? This cannot be undone.`)) return
    setDeleting(true)
    const r = await fetch(`/api/news-sources/${source.id}`, { method: 'DELETE' })
    setDeleting(false)
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? `HTTP ${r.status}`); return }
    await onDeleted()
  }

  const retest = async () => {
    setRetestResult('Testing...')
    const r = await fetch('/api/news-sources/test-fetch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: source.id }) })
    const d = await r.json().catch(() => ({}))
    setRetestResult(r.ok ? `OK - ${d.articles_found ?? 0} articles` : `Failed: ${d.error ?? r.status}`)
  }

  const reEnable = async () => {
    const r = await fetch('/api/news-sources', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: source.id, enabled: true }) })
    if (r.ok) await onSaved()
  }

  return (
    <Drawer onClose={onClose} title={`Edit - ${source.name}`}>
      <div style={{ padding: 20 }}>
        {/* Health banner */}
        <div style={{ padding: 12, background: 'var(--bg-card-2)', borderRadius: 'var(--r-sm)', marginBottom: 16, fontSize: 12, color: 'var(--text-1)' }}>
          <div>
            Quality: {source.extraction_quality_pct == null ? 'no data yet' : `${source.extraction_quality_pct.toFixed(0)}% over last 30 days`}
          </div>
          <div style={{ marginTop: 4 }}>
            Last fetch: {source.last_fetch_at ? new Date(source.last_fetch_at).toLocaleString() : 'never'} - {source.last_fetch_status ?? 'unknown'}
          </div>
        </div>

        {/* Auto-disabled banner */}
        {source.auto_disabled_at && (
          <div style={{ padding: 12, background: 'var(--orange-bg)', borderLeft: '3px solid var(--orange)', marginBottom: 16, fontSize: 12 }}>
            Auto-disabled on {new Date(source.auto_disabled_at).toLocaleString()}.
            <div style={{ marginTop: 8 }}>
              <Button variant="primary" size="sm" onClick={reEnable}>Re-enable</Button>
            </div>
          </div>
        )}

        <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} className="ui-input" style={{ width: '100%' }} /></Field>
        <Field label="URL"><input value={url} onChange={e => setUrl(e.target.value)} className="ui-input" style={{ width: '100%' }} /></Field>
        <Field label="Language">
          <select value={language} onChange={e => setLanguage(e.target.value)} className="ui-select" style={{ width: '100%' }}>
            {['en','es','pt','it','fr'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
          </select>
        </Field>
        <Field label="Weight"><input type="number" step="0.1" value={weight} onChange={e => setWeight(Number(e.target.value))} className="ui-input" style={{ width: '100%' }} /></Field>
        <Field label="Cadence">
          <select value={cadence} onChange={e => setCadence(e.target.value)} className="ui-select" style={{ width: '100%' }}>
            <option value="hourly">hourly</option><option value="weekly">weekly</option>
          </select>
        </Field>
        <Field label="Lookback days"><input type="number" value={lookbackDays} onChange={e => setLookbackDays(Number(e.target.value))} className="ui-input" style={{ width: '100%' }} /></Field>
        <Field label="Enabled">
          <label style={{ color: 'var(--text-1)' }}><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Active</label>
        </Field>
        <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} className="ui-input" style={{ width: '100%', fontFamily: 'inherit' }} /></Field>

        {recentArticles.length > 0 && (
          <Field label="Last 10 articles from this source">
            <ul style={{ paddingLeft: 16, margin: 0, fontSize: 12, color: 'var(--text-3)' }}>
              {recentArticles.slice(0, 10).map((a, i) => <li key={i}>{a.title} - {new Date(a.published_at).toLocaleDateString()}</li>)}
            </ul>
          </Field>
        )}

        {retestResult && <div style={{ fontSize: 12, color: 'var(--lime-text)', marginTop: 8 }}>{retestResult}</div>}
        {error && <div style={{ marginTop: 12, color: 'var(--live-text)', fontSize: 12 }}>{error}</div>}

        <div style={{ marginTop: 20, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <Button variant="danger" onClick={del} disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={retest}>Re-test</Button>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </div>
    </Drawer>
  )
}
