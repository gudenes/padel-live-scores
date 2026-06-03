'use client'

import { useState } from 'react'
import { Field, Button } from '@/components/ui'

interface Props { onClose: () => void; onDone: () => void }

type Focus = 'broad' | 'spanish' | 'italian' | 'french' | 'portuguese' | 'brand' | 'press' | 'custom'

export function DiscoverWithAIModal({ onClose, onDone }: Props) {
  const [focus, setFocus] = useState<Focus>('broad')
  const [customQuery, setCustomQuery] = useState('')
  const [max, setMax] = useState(10)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ candidates_kept: number; candidates_found: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true); setError(null)
    const r = await fetch('/api/news-sources/discover', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ focus, customQuery: focus === 'custom' ? customQuery : undefined, maxCandidates: max }),
    })
    setRunning(false)
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { setError(d.error ?? `HTTP ${r.status}`); return }
    setResult(d)
  }

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 80 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: 'var(--bg-surface)', color: 'var(--text-1)', border: '1px solid var(--border-card)', borderRadius: 'var(--r-lg)', padding: 24, zIndex: 81, minWidth: 420, maxWidth: '90vw' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Discover Sources with AI</h3>
        <p style={{ color: 'var(--text-3)', fontSize: 12, marginTop: 8 }}>Find padel news sources you don&apos;t already ingest. Costs ~$0.50 per run.</p>

        {!result ? (
          <>
            <div style={{ marginTop: 16 }}>
              <Field label="Focus">
                <select value={focus} onChange={e => setFocus(e.target.value as Focus)} className="ui-select" style={{ width: '100%' }}>
                  <option value="broad">Broad -- any padel news site</option>
                  <option value="spanish">Spanish (.es / Argentine / Mexican)</option>
                  <option value="italian">Italian (.it)</option>
                  <option value="french">French (.fr)</option>
                  <option value="portuguese">Portuguese (.pt / .com.br)</option>
                  <option value="brand">Brand &amp; equipment news</option>
                  <option value="press">Official tour press</option>
                  <option value="custom">Custom...</option>
                </select>
              </Field>
              {focus === 'custom' && (
                <input value={customQuery} onChange={e => setCustomQuery(e.target.value)}
                  placeholder="e.g. italian and french blogs about junior players"
                  className="ui-input" style={{ width: '100%', marginTop: 8 }} />
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="Max candidates">
                <select value={max} onChange={e => setMax(Number(e.target.value))} className="ui-select" style={{ width: '100%' }}>
                  {[5, 10, 15].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>

            {error && <div style={{ color: 'var(--live-text)', fontSize: 12, marginTop: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <Button onClick={onClose}>Cancel</Button>
              <Button variant="primary" onClick={run} disabled={running}>{running ? 'Discovering...' : 'Discover'}</Button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <div style={{ color: 'var(--lime-text)', fontSize: 32 }}>OK</div>
            <p style={{ color: 'var(--text-1)' }}>Found {result.candidates_kept} candidates (of {result.candidates_found} Claude returned). Review them in the Suggestions tab.</p>
            <Button variant="primary" onClick={() => { onDone(); onClose() }}>OK</Button>
          </div>
        )}
      </div>
    </>
  )
}
