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
import { timeAgo } from './utils'

const SLUG = 'coverage-matrix'
const API = `/api/ops/docs/${SLUG}`

interface DocRow {
  slug: string
  content: string
  updated_at: string
  updated_by: string | null
}

export default function CoverageMatrixTab() {
  const [doc, setDoc] = useState<DocRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

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

  const onEdit = () => {
    if (!doc) return
    setDraft(doc.content)
    setSaveError(null)
    setEditing(true)
  }

  const onCancel = () => {
    setEditing(false)
    setSaveError(null)
    setDraft('') // discard any in-progress edits so a later entry point can't pick up stale state
  }

  const onSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch(API, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      })
      if (!res.ok) {
        let errMsg = `Save failed (${res.status})`
        try {
          const j = await res.json()
          if (j?.error && typeof j.error === 'string') errMsg = j.error
        } catch {
          // Non-JSON error body — keep the fallback.
        }
        setSaveError(errMsg)
        return
      }
      const json = await res.json()
      setDoc(json.doc as DocRow)
      setEditing(false)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

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
    <div style={{ padding: 16, maxWidth: 1600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Coverage Matrix</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {!editing && (
            <button onClick={onEdit} style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}>
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                onClick={onSave}
                disabled={saving}
                style={{
                  padding: '6px 12px', cursor: saving ? 'wait' : 'pointer',
                  fontSize: 13, fontWeight: 600,
                  background: '#111', color: '#fff', border: 'none', borderRadius: 4,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                onClick={onCancel}
                disabled={saving}
                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <div style={{
          marginBottom: 10, padding: 8, fontSize: 12,
          color: '#b91c1c', background: '#fee2e2', borderRadius: 4,
        }}>
          {saveError}
        </div>
      )}

      {!editing && (
        <div className="prose prose-neutral max-w-none" style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 20 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
        </div>
      )}

      {editing && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, height: 'calc(100vh - 180px)' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            style={{
              width: '100%', height: '100%', resize: 'none',
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 13, lineHeight: 1.5,
              padding: 12, border: '1px solid #e5e7eb', borderRadius: 6,
            }}
          />
          <div
            className="prose prose-neutral max-w-none"
            style={{
              height: '100%', overflow: 'auto',
              background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: 20,
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 11, color: '#888' }}>
        Last edited {timeAgo(doc.updated_at)}
        {doc.updated_by && ` by ${doc.updated_by}`}
      </div>
    </div>
  )
}
