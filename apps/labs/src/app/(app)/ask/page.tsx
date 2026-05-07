'use client'

import { useEffect, useRef, useState } from 'react'
import { ConversationSidebar } from './ConversationSidebar'

type Citation = {
  match_id: string
  played_at: string | null
  tournament_name: string | null
  score: string
  pair1: string
  pair2: string
}

type Msg = {
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
}

export default function AskPage() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load history when a conversation is selected (or cleared on "+ New chat").
  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      return
    }
    let cancelled = false
    ;(async () => {
      const r = await fetch(`/api/v1/conversations/${conversationId}`)
      if (!r.ok) return
      const j = await r.json()
      if (cancelled) return
      setMessages(
        (j.messages || []).map((m: any) => ({
          role: m.role,
          content: m.content,
          citations: m.citations || [],
        })),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [conversationId])

  // Auto-scroll on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, loading])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    setLoading(true)
    try {
      const r = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          conversation_id: conversationId,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.message || j.error || 'Something went wrong.')
        return
      }
      setConversationId(j.conversation_id)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: j.answer, citations: j.citations },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
      <ConversationSidebar activeId={conversationId} onSelect={setConversationId} />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {messages.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                Ask me about padel matches, players, or head-to-heads. I cite every match I reference.
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} />
            ))}
            {loading && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
                Thinking…
              </div>
            )}
            {error && (
              <div style={{ color: '#c62828', fontSize: 13, padding: '12px 0' }}>{error}</div>
            )}
          </div>
        </div>
        <form
          onSubmit={send}
          style={{
            borderTop: '1px solid var(--border)',
            padding: '16px 32px',
            background: 'var(--bg)',
          }}
        >
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about padel matches, players, tournaments…"
              className="input"
              style={{ flex: 1 }}
              disabled={loading}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        margin: '10px 0',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '12px 16px',
          borderRadius: 12,
          background: isUser ? 'var(--accent)' : 'var(--surface)',
          color: isUser ? 'white' : 'var(--text)',
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
        }}
      >
        {msg.content}
        {msg.citations && msg.citations.length > 0 && (
          <details style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
            <summary style={{ cursor: 'pointer' }}>Sources ({msg.citations.length})</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {msg.citations.map((c) => (
                <li key={c.match_id} style={{ marginBottom: 4 }}>
                  {c.pair1} vs {c.pair2} — {c.tournament_name || 'Unknown'}{' '}
                  {c.played_at ? `(${c.played_at.slice(0, 10)})` : ''} {c.score && `· ${c.score}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
