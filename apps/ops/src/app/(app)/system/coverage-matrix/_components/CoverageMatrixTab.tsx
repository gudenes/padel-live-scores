'use client'
// apps/ops/src/app/(app)/system/coverage-matrix/_components/CoverageMatrixTab.tsx
//
// Ops tab that hosts the coverage capability matrix as a single
// editable markdown document. Read-only view by default; click "Edit"
// for a split textarea + live react-markdown preview.
//
// Backend: GET / PUT /api/internal/docs/coverage-matrix.
// Auth piggybacks on the Auth.js session (isOperator).
// Lifted from src/app/ops/CoverageMatrixTab.tsx (Plan 3b-extra Task 2).

import { useEffect, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { PageHeader, Panel, Button, EmptyState } from '@/components/ui'
import { timeAgo } from '../../_shared/ops-status-types'

const SLUG = 'coverage-matrix'
const API = `/api/internal/docs/${SLUG}`

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
    return (
      <div className="ui-page">
        <PageHeader title="Coverage Matrix" />
        <div style={{ color: 'var(--text-2)' }}>Loading...</div>
      </div>
    )
  }
  if (error) {
    return (
      <div className="ui-page">
        <PageHeader title="Coverage Matrix" />
        <EmptyState title={error} hint={<Button size="sm" onClick={load}>Retry</Button>} />
      </div>
    )
  }
  if (!doc) return null

  return (
    <div className="ui-page" style={{ maxWidth: 1600 }}>
      <PageHeader
        title="Coverage Matrix"
        actions={
          !editing ? (
            <Button size="sm" onClick={onEdit}>Edit</Button>
          ) : (
            <>
              <Button size="sm" variant="primary" onClick={onSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </Button>
              <Button size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
            </>
          )
        }
      />

      {saveError && (
        <div style={{
          marginBottom: 10, padding: 8, fontSize: 12,
          color: 'var(--live-text)', background: 'var(--live-bg)', border: '1px solid var(--live-border)', borderRadius: 'var(--r-sm)',
        }}>
          {saveError}
        </div>
      )}

      {!editing && (
        <Panel>
          <div className="prose prose-neutral max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{doc.content}</ReactMarkdown>
          </div>
        </Panel>
      )}

      {editing && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, height: 'calc(100vh - 180px)' }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="ui-input"
            style={{
              width: '100%', height: '100%', resize: 'none',
              fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
              fontSize: 13, lineHeight: 1.5,
            }}
          />
          <div
            className="prose prose-neutral max-w-none"
            style={{
              height: '100%', overflow: 'auto',
              background: 'var(--bg-card)', border: '1px solid var(--border-card)', borderRadius: 'var(--r-md)', padding: 20,
            }}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </div>
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-3)' }}>
        Last edited {timeAgo(doc.updated_at)}
        {doc.updated_by && ` by ${doc.updated_by}`}
      </div>
    </div>
  )
}
