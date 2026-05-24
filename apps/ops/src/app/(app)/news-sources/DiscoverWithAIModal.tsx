'use client'

import { useState } from 'react'

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
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 80 }} />
      <div style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', background: '#0f0f0f', color: '#fff', border: '1px solid #2a2a2a', padding: 24, zIndex: 81, minWidth: 420, maxWidth: '90vw' }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Discover Sources with AI</h3>
        <p style={{ color: '#aaa', fontSize: 12, marginTop: 8 }}>Find padel news sources you don&apos;t already ingest. Costs ~$0.50 per run.</p>

        {!result ? (
          <>
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Focus</div>
              <select value={focus} onChange={e => setFocus(e.target.value as Focus)} style={selectStyle}>
                <option value="broad">Broad -- any padel news site</option>
                <option value="spanish">Spanish (.es / Argentine / Mexican)</option>
                <option value="italian">Italian (.it)</option>
                <option value="french">French (.fr)</option>
                <option value="portuguese">Portuguese (.pt / .com.br)</option>
                <option value="brand">Brand &amp; equipment news</option>
                <option value="press">Official tour press</option>
                <option value="custom">Custom...</option>
              </select>
              {focus === 'custom' && (
                <input value={customQuery} onChange={e => setCustomQuery(e.target.value)}
                  placeholder="e.g. italian and french blogs about junior players"
                  style={{ ...selectStyle, marginTop: 8 }} />
              )}
            </div>
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: '#888', fontWeight: 700, textTransform: 'uppercase' }}>Max candidates</div>
              <select value={max} onChange={e => setMax(Number(e.target.value))} style={selectStyle}>
                {[5, 10, 15].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>

            {error && <div style={{ color: '#E53935', fontSize: 12, marginTop: 12 }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 20 }}>
              <button onClick={onClose} style={btnSecondary}>Cancel</button>
              <button onClick={run} disabled={running} style={btnPrimary}>{running ? 'Discovering...' : 'Discover'}</button>
            </div>
          </>
        ) : (
          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <div style={{ color: '#7ED321', fontSize: 32 }}>OK</div>
            <p style={{ color: '#ccc' }}>Found {result.candidates_kept} candidates (of {result.candidates_found} Claude returned). Review them in the Suggestions tab.</p>
            <button onClick={() => { onDone(); onClose() }} style={btnPrimary}>OK</button>
          </div>
        )}
      </div>
    </>
  )
}

const selectStyle: React.CSSProperties = { width: '100%', background: '#1a1a1a', color: '#fff', border: '1px solid #2a2a2a', padding: 8, fontSize: 13 }
const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '8px 16px', cursor: 'pointer' }
