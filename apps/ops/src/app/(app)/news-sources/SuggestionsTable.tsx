'use client'

import { useEffect, useState } from 'react'

interface Suggestion {
  id: string
  url: string
  note: string | null
  suggested_by_email: string | null
  created_at: string
  submitted_by_kind: 'user' | 'ai_discovery'
  detected_type: string | null
  detected_payload: { name?: string; language?: string; sample?: Array<{ title: string }>; notes?: string } | null
}

export function SuggestionsTable() {
  const [rows, setRows] = useState<Suggestion[] | null>(null)

  useEffect(() => { void refresh() }, [])
  async function refresh() {
    const r = await fetch('/api/news-sources/suggestions')
    const d = await r.json()
    setRows(d.suggestions ?? [])
  }

  const approveAndAdd = async (s: Suggestion) => {
    if (s.detected_type === 'unknown' || !s.detected_type) {
      alert('No cached detection — open the URL manually and use Add Source instead.')
      return
    }
    const name = s.detected_payload?.name ?? new URL(s.url).hostname
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    const r = await fetch('/api/news-sources', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key, name,
        url: s.url,
        source_type: s.detected_type,
        language: s.detected_payload?.language ?? 'en',
        cadence: 'hourly',
        query_kind: s.submitted_by_kind === 'ai_discovery' ? 'ai-discovered' : 'user-suggested',
        from_suggestion_id: s.id,
      }),
    })
    if (!r.ok) { alert(`Failed: ${(await r.json().catch(() => ({}))).error ?? r.status}`); return }
    await refresh()
  }

  const reject = async (id: string) => {
    const note = prompt('Reason? (optional)') ?? undefined
    await fetch('/api/news-sources/suggestions', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, status: 'rejected', review_note: note }),
    })
    setRows(rs => rs?.filter(r => r.id !== id) ?? null)
  }

  if (!rows) return <div style={{ color: '#888' }}>Loading...</div>
  if (rows.length === 0) return <div style={{ color: '#888', padding: 16 }}>No pending suggestions.</div>

  return (
    <div>
      {rows.map(r => (
        <div key={r.id} style={{ padding: 16, borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={kindChip(r.submitted_by_kind)}>{r.submitted_by_kind === 'ai_discovery' ? 'AI' : 'USER'}</span>
            <a href={r.url} target="_blank" rel="noopener" style={{ fontWeight: 700, color: '#fff' }}>{r.url}</a>
          </div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
            {r.suggested_by_email ? `${r.suggested_by_email} · ` : ''}
            {new Date(r.created_at).toLocaleString()}
          </div>
          {r.note && <div style={{ fontSize: 12, marginTop: 6, color: '#ccc' }}>{r.note}</div>}
          {r.detected_type && r.detected_type !== 'unknown' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#7ED321' }}>
              Detected as {r.detected_type} — {r.detected_payload?.sample?.length ?? 0} recent articles
              {r.detected_payload?.sample?.length ? (
                <ul style={{ paddingLeft: 16, marginTop: 4, color: '#aaa', fontSize: 11 }}>
                  {r.detected_payload.sample.slice(0, 3).map((s, i) => <li key={i}>{s.title}</li>)}
                </ul>
              ) : null}
            </div>
          )}
          {r.detected_type === 'unknown' && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#F5A623' }}>Detection failed — manual review needed</div>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => approveAndAdd(r)} style={btnPrimary}>Approve &amp; Add</button>
            <button onClick={() => reject(r.id)} style={btnSecondary}>Reject</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function kindChip(kind: 'user' | 'ai_discovery'): React.CSSProperties {
  const isAi = kind === 'ai_discovery'
  return {
    display: 'inline-block',
    padding: '2px 8px',
    fontSize: 10,
    fontWeight: 700,
    color: isAi ? '#0a0a0a' : '#ccc',
    background: isAi ? '#7ED321' : '#2a2a2a',
    borderRadius: 3,
    letterSpacing: 0.5,
  }
}

const btnPrimary: React.CSSProperties = { background: '#7ED321', color: '#0a0a0a', border: 0, padding: '6px 12px', fontSize: 12, fontWeight: 700, cursor: 'pointer', clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)' }
const btnSecondary: React.CSSProperties = { background: '#1a1a1a', color: '#ccc', border: 0, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }
