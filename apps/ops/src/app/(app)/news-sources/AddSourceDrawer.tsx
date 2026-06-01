// apps/ops/src/app/(app)/news-sources/AddSourceDrawer.tsx
'use client'

import { useState } from 'react'
import { Field, Button } from '@/components/ui'
import type { DetectedSource } from '@/lib/source-detector'

interface Props {
  onClose: () => void
  onSaved: () => void | Promise<void>
}

type Stage = 'paste' | 'detecting' | 'confirm' | 'manual' | 'saving'

export function AddSourceDrawer({ onClose, onSaved }: Props) {
  const [stage, setStage] = useState<Stage>('paste')
  const [url, setUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [detected, setDetected] = useState<DetectedSource | null>(null)

  // Editable fields once we reach the confirm stage
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [language, setLanguage] = useState('en')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [weight, setWeight] = useState(1.0)
  const [cadence, setCadence] = useState<'hourly' | 'weekly'>('hourly')
  const [lookbackDays, setLookbackDays] = useState(14)
  const [queryKind, setQueryKind] = useState('static')
  const [notes, setNotes] = useState('')

  const detect = async () => {
    setError(null); setStage('detecting')
    try {
      const r = await fetch('/api/news-sources/detect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url }) })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        setError(e.error ?? `HTTP ${r.status}`); setStage('paste'); return
      }
      const d = await r.json() as DetectedSource
      setDetected(d)
      if (d.type === 'unknown') {
        setError(d.notes ?? 'Could not detect feed type.'); setStage('paste')
        return
      }
      setName(d.name ?? new URL(d.url).hostname)
      setLanguage(d.language ?? 'en')
      const slugSeed = (d.name ?? new URL(d.url).hostname).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
      setKey(slugSeed)
      setStage('confirm')
    } catch (e) {
      setError((e as Error).message); setStage('paste')
    }
  }

  const save = async () => {
    if (!detected) return
    setStage('saving')
    const payload = {
      key, name, url: detected.url, source_type: detected.type, language,
      cadence, weight, lookback_days: lookbackDays, query_kind: queryKind, notes,
    }
    const r = await fetch('/api/news-sources', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    if (!r.ok) {
      const e = await r.json().catch(() => ({}))
      setError(e.error ?? `HTTP ${r.status}`); setStage('confirm'); return
    }
    await onSaved()
  }

  return (
    <Drawer onClose={onClose} title="Add Source">
      {(stage === 'paste' || stage === 'detecting') && (
        <div style={{ padding: 20 }}>
          <p style={{ color: 'var(--text-1)', marginBottom: 16 }}>
            Paste a URL — RSS feed, news section, or Google News search.
          </p>
          <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://..."
            className="ui-input" style={{ width: '100%' }} disabled={stage === 'detecting'} />
          {error && <div style={{ marginTop: 12, color: 'var(--live-text)', fontSize: 12 }}>{error}
            <button onClick={() => setStage('manual')} style={{ marginLeft: 8, color: 'var(--lime-text)', background: 'none', border: 0, cursor: 'pointer' }}>Use Advanced mode</button>
          </div>}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={detect} disabled={stage === 'detecting' || !url}>
              {stage === 'detecting' ? 'Detecting...' : 'Detect ->'}
            </Button>
          </div>
        </div>
      )}

      {(stage === 'confirm' || stage === 'saving') && detected && (
        <div style={{ padding: 20 }}>
          <div style={{ color: 'var(--lime-text)', marginBottom: 12 }}>Detected as {detected.type}</div>
          <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} className="ui-input" style={{ width: '100%' }} /></Field>
          <Field label="URL"><code style={{ color: 'var(--text-3)', fontSize: 12, wordBreak: 'break-all' }}>{detected.url}</code></Field>
          <Field label="Language">
            <select value={language} onChange={e => setLanguage(e.target.value)} className="ui-select" style={{ width: '100%' }}>
              {['en','es','pt','it','fr'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </Field>
          <Field label="Key (slug)"><input value={key} onChange={e => setKey(e.target.value)} className="ui-input" style={{ width: '100%' }} /></Field>

          {detected.sample.length > 0 && (
            <Field label="Sample articles">
              <ul style={{ paddingLeft: 16, margin: 0, color: 'var(--text-1)', fontSize: 12 }}>
                {detected.sample.map((s, i) => <li key={i}>{s.title}{s.pubDate ? ` — ${s.pubDate}` : ''}</li>)}
              </ul>
            </Field>
          )}

          <details style={{ marginTop: 16 }} open={showAdvanced} onToggle={e => setShowAdvanced((e.target as HTMLDetailsElement).open)}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-3)' }}>Advanced (weight, cadence, lookback, notes)</summary>
            <div style={{ paddingTop: 12 }}>
              <Field label="Weight"><input type="number" step="0.1" value={weight} onChange={e => setWeight(Number(e.target.value))} className="ui-input" style={{ width: '100%' }} /></Field>
              <Field label="Cadence">
                <select value={cadence} onChange={e => setCadence(e.target.value as 'hourly' | 'weekly')} className="ui-select" style={{ width: '100%' }}>
                  <option value="hourly">hourly</option><option value="weekly">weekly</option>
                </select>
              </Field>
              <Field label="Lookback days"><input type="number" value={lookbackDays} onChange={e => setLookbackDays(Number(e.target.value))} className="ui-input" style={{ width: '100%' }} /></Field>
              <Field label="Query kind">
                <select value={queryKind} onChange={e => setQueryKind(e.target.value)} className="ui-select" style={{ width: '100%' }}>
                  {['static','user-suggested','player','tournament','brand'].map(k => <option key={k} value={k}>{k}</option>)}
                </select>
              </Field>
              <Field label="Notes"><textarea value={notes} onChange={e => setNotes(e.target.value)} maxLength={500} rows={3} className="ui-input" style={{ width: '100%', fontFamily: 'inherit' }} /></Field>
            </div>
          </details>

          {error && <div style={{ marginTop: 12, color: 'var(--live-text)', fontSize: 12 }}>{error}</div>}
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={stage === 'saving'}>
              {stage === 'saving' ? 'Saving...' : 'Save Source'}
            </Button>
          </div>
        </div>
      )}

      {stage === 'manual' && (
        <div style={{ padding: 20 }}>
          <p style={{ color: 'var(--text-1)', marginBottom: 12 }}>
            Manual entry. Use this when detection failed or the source needs custom config.
          </p>
          <Field label="URL"><input value={url} onChange={e => setUrl(e.target.value)} className="ui-input" style={{ width: '100%' }} /></Field>
          <Field label="Name"><input value={name} onChange={e => setName(e.target.value)} className="ui-input" style={{ width: '100%' }} /></Field>
          <Field label="Key"><input value={key} onChange={e => setKey(e.target.value)} className="ui-input" style={{ width: '100%' }} /></Field>
          <Field label="Type">
            <select value={detected?.type ?? 'rss'} onChange={e => setDetected({ type: e.target.value as DetectedSource['type'], url, sample: [] })} className="ui-select" style={{ width: '100%' }}>
              <option value="rss">rss</option><option value="wp-api">wp-api</option><option value="google-news-search">google-news-search</option>
            </select>
          </Field>
          <Field label="Language">
            <select value={language} onChange={e => setLanguage(e.target.value)} className="ui-select" style={{ width: '100%' }}>
              {['en','es','pt','it','fr'].map(l => <option key={l} value={l}>{l.toUpperCase()}</option>)}
            </select>
          </Field>
          <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={() => { setDetected({ type: (detected?.type ?? 'rss') as DetectedSource['type'], url, sample: [] }); setStage('confirm') }}>Continue -&gt;</Button>
          </div>
        </div>
      )}
    </Drawer>
  )
}

export function Drawer({ children, onClose, title }: { children: React.ReactNode; onClose: () => void; title: string }) {
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 80 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, maxWidth: '100vw', background: 'var(--bg-surface)', color: 'var(--text-1)', borderLeft: '1px solid var(--border-card)', zIndex: 81, overflowY: 'auto' }}>
        <header style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 0, color: 'var(--text-3)', cursor: 'pointer', fontSize: 20 }}>x</button>
        </header>
        {children}
      </aside>
    </>
  )
}
