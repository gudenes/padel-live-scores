// apps/labs/src/app/(app)/ask/page.tsx
'use client'

import { useState } from 'react'

export default function AskPage() {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim()) return
    setLoading(true)
    setAnswer(null)
    try {
      const res = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      })
      const data = await res.json()
      setAnswer(data.answer ?? data.error ?? 'No response')
    } catch (err) {
      setAnswer(`Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main style={{ maxWidth: 768, margin: '0 auto', padding: '40px 32px' }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 6px' }}>Ask</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 28px', fontSize: 14 }}>
        Phase 1 placeholder. Real chat engine ships in Phase 2.
      </p>

      <form onSubmit={submit} style={{ marginBottom: 28 }}>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about padel matches, players, tournaments..."
          rows={4}
          className="input"
          style={{ marginBottom: 12, resize: 'none', fontFamily: 'var(--font-sans)' }}
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="btn btn-primary"
        >
          {loading ? 'Thinking…' : 'Send'}
        </button>
      </form>

      {answer && (
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 20,
            background: 'var(--surface)',
            whiteSpace: 'pre-wrap',
            fontSize: 14,
            lineHeight: 1.6,
            color: 'var(--text)',
          }}
        >
          {answer}
        </div>
      )}
    </main>
  )
}
