'use client'
// src/app/ops/CoverageMatrixTab.tsx
//
// Ops tab that hosts the coverage capability matrix as a single
// editable markdown document. Read-only view by default; click "Edit"
// for a split textarea + live react-markdown preview.
//
// Backend: GET / PUT /api/ops/docs/coverage-matrix. Auth piggybacks on
// the ops_token cookie set by middleware on /ops?token=$CRON_SECRET.

import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const SLUG = 'coverage-matrix'
const API = `/api/ops/docs/${SLUG}`

interface DocRow {
  slug: string
  content: string
  updated_at: string
  updated_by: string | null
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

export default function CoverageMatrixTab() {
  const [doc, setDoc] = useState<DocRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(API, { credentials: 'include' })
      if (!res.ok) {
        setError(`Load failed (${res.status})`)
        return
      }
      const json = await res.json()
      if (!json.doc) {
        setError('Doc not found — re-run the seed migration.')
        return
      }
      setDoc(json.doc as DocRow)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div style={{ padding: 16, color: '#666' }}>Loading…</div>
  }
  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ color: '#b91c1c', marginBottom: 8 }}>{error}</div>
        <button onClick={load} style={{ padding: '6px 12px', cursor: 'pointer' }}>Retry</button>
      </div>
    )
  }
  if (!doc) return null

  return (
    <div style={{ padding: 16, maxWidth: 1200 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Coverage Matrix</h2>
      </div>
      <div className="markdown-body" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 20 }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
      </div>
      <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
        Last edited {timeAgo(doc.updated_at)}
        {doc.updated_by && ` by ${doc.updated_by}`}
      </div>
    </div>
  )
}
