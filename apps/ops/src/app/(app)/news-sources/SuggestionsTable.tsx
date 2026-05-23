'use client'

import { useEffect, useState } from 'react'

interface Suggestion {
  id: string
  url: string
  note: string | null
  suggested_by_email: string | null
  created_at: string
}

export function SuggestionsTable() {
  const [rows, setRows] = useState<Suggestion[] | null>(null)

  useEffect(() => {
    fetch('/api/news-sources/suggestions').then(r => r.json()).then(d => setRows(d.suggestions ?? []))
  }, [])

  const review = async (id: string, status: 'approved' | 'rejected' | 'duplicate', note?: string) => {
    await fetch('/api/news-sources/suggestions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, review_note: note }),
    })
    setRows(rs => rs?.filter(r => r.id !== id) ?? null)
  }

  if (!rows) return <div style={{ color: '#888' }}>Loading...</div>
  if (rows.length === 0) return <div style={{ color: '#888' }}>No pending suggestions.</div>

  return (
    <div>
      {rows.map(r => (
        <div key={r.id} style={{ padding: 16, borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ fontWeight: 700, color: '#fff' }}>{r.url}</div>
          {r.suggested_by_email && <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>by {r.suggested_by_email}</div>}
          {r.note && <div style={{ fontSize: 12, marginTop: 6, color: '#ccc' }}>{r.note}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={() => review(r.id, 'approved')}
              style={btnStyle('#7ED321')}
            >Approve</button>
            <button
              onClick={() => review(r.id, 'rejected', prompt('Reason?') ?? undefined)}
              style={btnStyle('#E53935')}
            >Reject</button>
            <button
              onClick={() => review(r.id, 'duplicate')}
              style={btnStyle('#888')}
            >Duplicate</button>
          </div>
        </div>
      ))}
    </div>
  )
}

function btnStyle(bg: string): React.CSSProperties {
  return {
    background: bg, color: '#0a0a0a',
    border: 0, padding: '6px 12px',
    fontSize: 12, fontWeight: 700, cursor: 'pointer',
    clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  }
}
