'use client'

import { useCallback, useEffect, useState } from 'react'
import { Panel, DataTable, Field, Pill, Button, Skeleton, EmptyState } from '@/components/ui'

type AnnouncementType = 'info' | 'warning' | 'critical'

interface Announcement {
  id: string
  message: string
  type: AnnouncementType
  active: boolean
  starts_at: string | null
  expires_at: string | null
  updated_at: string
  created_at: string
}

const TYPES: AnnouncementType[] = ['info', 'warning', 'critical']
const EMPTY = { message: '', type: 'info' as AnnouncementType, active: false, starts_at: '', expires_at: '' }

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string | null {
  if (!v) return null
  return new Date(v).toISOString()
}

function statusLabel(a: Announcement): { label: string; tone: 'live' | 'neutral' } {
  const now = Date.now()
  const started = !a.starts_at || Date.parse(a.starts_at) <= now
  const expired = !!a.expires_at && Date.parse(a.expires_at) <= now
  if (!a.active) return { label: 'off', tone: 'neutral' }
  if (expired) return { label: 'expired', tone: 'neutral' }
  if (!started) return { label: 'scheduled', tone: 'neutral' }
  return { label: 'LIVE', tone: 'live' }
}

export function AnnouncementsManager() {
  const [rows, setRows] = useState<Announcement[] | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch('/api/internal/announcements')
      .then((r) => r.json())
      .then((d) => setRows((d as { announcements?: Announcement[] }).announcements ?? []))
      .catch(() => setRows([]))
  }, [])

  useEffect(() => { load() }, [load])

  const reset = () => { setForm({ ...EMPTY }); setEditingId(null); setError(null) }

  const edit = (a: Announcement) => {
    setEditingId(a.id)
    setForm({
      message: a.message,
      type: a.type,
      active: a.active,
      starts_at: toLocalInput(a.starts_at),
      expires_at: toLocalInput(a.expires_at),
    })
    setError(null)
  }

  const save = async (publish: boolean) => {
    setSaving(true); setError(null)
    const payload = {
      message: form.message,
      type: form.type,
      active: publish,
      starts_at: fromLocalInput(form.starts_at),
      expires_at: fromLocalInput(form.expires_at),
    }
    const url = editingId ? `/api/internal/announcements/${editingId}` : '/api/internal/announcements'
    const res = await fetch(url, {
      method: editingId ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setError(d.error ?? 'Save failed')
      return
    }
    reset(); load()
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this announcement?')) return
    await fetch(`/api/internal/announcements/${id}`, { method: 'DELETE' })
    if (editingId === id) reset()
    load()
  }

  return (
    <>
      <Panel title={editingId ? 'Edit announcement' : 'New announcement'}>
        <Field label="Message">
          <textarea
            className="ui-input"
            value={form.message}
            onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
            rows={2}
            placeholder="Matches suspended due to court conditions. Updates to follow."
            style={{ width: '100%', resize: 'vertical' }}
          />
        </Field>

        <Field label="Severity">
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            {TYPES.map((t) => (
              <Button key={t} variant={form.type === t ? 'primary' : 'default'} size="sm" onClick={() => setForm((f) => ({ ...f, type: t }))}>
                {t[0].toUpperCase() + t.slice(1)}
              </Button>
            ))}
          </div>
        </Field>

        <div style={{ display: 'flex', gap: 16 }}>
          <Field label="Starts (optional)">
            <input className="ui-input" type="datetime-local" value={form.starts_at} onChange={(e) => setForm((f) => ({ ...f, starts_at: e.target.value }))} />
          </Field>
          <Field label="Expires (optional)">
            <input className="ui-input" type="datetime-local" value={form.expires_at} onChange={(e) => setForm((f) => ({ ...f, expires_at: e.target.value }))} />
          </Field>
        </div>

        {error && <p style={{ color: 'var(--live-text)', marginTop: 8 }}>{error}</p>}

        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Button variant="primary" disabled={saving || !form.message.trim()} onClick={() => void save(true)}>
            {editingId ? 'Save & publish' : 'Publish'}
          </Button>
          <Button variant="default" disabled={saving || !form.message.trim()} onClick={() => void save(false)}>
            Save as off
          </Button>
          {editingId && <Button variant="ghost" onClick={reset}>Cancel</Button>}
        </div>
      </Panel>

      <Panel title="All announcements">
        {rows === null ? (
          <Skeleton />
        ) : rows.length === 0 ? (
          <EmptyState title="No announcements yet." />
        ) : (
          <DataTable>
            <thead>
              <tr><th>Status</th><th>Type</th><th>Message</th><th>Updated</th><th /></tr>
            </thead>
            <tbody>
              {rows.map((a) => {
                const st = statusLabel(a)
                return (
                  <tr key={a.id}>
                    <td><Pill tone={st.tone} dot={st.tone === 'live'} pulse={st.tone === 'live'}>{st.label}</Pill></td>
                    <td>{a.type}</td>
                    <td style={{ maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.message}</td>
                    <td>{new Date(a.updated_at).toLocaleString()}</td>
                    <td style={{ display: 'flex', gap: 8 }}>
                      <Button size="sm" variant="default" onClick={() => edit(a)}>Edit</Button>
                      <Button size="sm" variant="danger" onClick={() => void remove(a.id)}>Delete</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </>
  )
}
