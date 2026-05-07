'use client'

import { useEffect, useState } from 'react'

type Conv = { id: string; title: string | null; updated_at: string }

export function ConversationSidebar(props: {
  activeId: string | null
  onSelect: (id: string | null) => void
}) {
  const [convs, setConvs] = useState<Conv[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/v1/conversations')
      const j = await r.json()
      setConvs(j.conversations ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Re-fetch whenever activeId changes (covers post-send refresh).
  useEffect(() => {
    if (props.activeId) load()
  }, [props.activeId])

  return (
    <aside style={{ borderRight: '1px solid var(--border)', padding: 16, width: 260, overflowY: 'auto' }}>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: '100%', marginBottom: 16 }}
        onClick={() => props.onSelect(null)}
      >
        + New chat
      </button>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        History
      </div>
      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>}
      {!loading && convs.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No conversations yet.</div>
      )}
      {convs.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => props.onSelect(c.id)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 10px',
            margin: '0 0 4px',
            background: c.id === props.activeId ? 'var(--surface)' : 'transparent',
            border: '1px solid transparent',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--text)',
            cursor: 'pointer',
          }}
        >
          {c.title || 'Untitled'}
        </button>
      ))}
    </aside>
  )
}
