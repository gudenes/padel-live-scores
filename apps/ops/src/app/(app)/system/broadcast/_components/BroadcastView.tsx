'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, Panel, Button, DataTable, Field, EmptyState } from '@/components/ui'
import type { NotificationSendRow } from '@/lib/broadcast-queries'

interface DryRunResult {
  recipients_total: number
  web: { fired: number }
  fcm: { fired: number }
  anon: { fired: number }
}

export default function BroadcastView({ initialSends }: { initialSends: NotificationSendRow[] }) {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('/')
  const [label, setLabel] = useState('')
  const [reach, setReach] = useState<DryRunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'ok' | 'err'>('ok')
  const [confirmText, setConfirmText] = useState('')

  // Any edit to the message content invalidates a prior dry-run: collapse the
  // confirm section and clear the typed confirmation so the operator must
  // dry-run again and re-type SEND against the new content.
  function invalidateConfirm() {
    setReach(null)
    setConfirmText('')
  }

  async function post(dryRun: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/internal/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, url, label: label || undefined, dryRun }),
      })
      const json = await r.json()
      if (!r.ok) {
        setMsgTone('err')
        setMsg(`Error: ${json.error ?? r.status}`)
        return null
      }
      return json
    } finally {
      setBusy(false)
    }
  }

  async function onDryRun() {
    // Clear any stale confirmation BEFORE showing the new reach, so a fresh
    // dry-run never arrives pre-armed with a leftover "SEND".
    setConfirmText('')
    const json = await post(true)
    if (json) {
      setReach(json)
      setMsgTone('ok')
      setMsg(`Dry run complete. Reach: ${json.recipients_total} devices.`)
    }
  }

  async function onSend() {
    const json = await post(false)
    if (json) {
      setMsgTone('ok')
      setMsg(`Sent. Accepted ${json.accepted_total}/${json.recipients_total}.`)
      setReach(null)
      setConfirmText('')
      // Refresh the RSC so the new send appears in the history table.
      router.refresh()
    }
  }

  const canDryRun = title.trim().length > 0 && body.trim().length > 0 && !busy
  const armed = reach !== null && confirmText === 'SEND' && !busy

  return (
    <div className="ui-page">
      <PageHeader
        title="Broadcast"
        subtitle="Send one push notification to every installed device. Always dry-run first to see reach before committing."
      />

      <Panel title="Compose">
        <div style={{ display: 'grid', gap: 12, maxWidth: 560 }}>
          <Field label="Title">
            <input
              value={title}
              onChange={(e) => { setTitle(e.target.value); invalidateConfirm() }}
              maxLength={80}
              placeholder="e.g. World Padel Tour Final — starts now"
            />
          </Field>
          <Field label="Body">
            <textarea
              value={body}
              onChange={(e) => { setBody(e.target.value); invalidateConfirm() }}
              maxLength={180}
              rows={3}
              placeholder="Short message shown under the title."
            />
          </Field>
          <Field label="Deep link URL">
            <input
              value={url}
              onChange={(e) => { setUrl(e.target.value); invalidateConfirm() }}
              placeholder="/"
            />
          </Field>
          <Field label="Campaign label (optional)">
            <input
              value={label}
              onChange={(e) => { setLabel(e.target.value); invalidateConfirm() }}
              placeholder="e.g. wpt-final-june"
            />
          </Field>

          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={onDryRun} disabled={!canDryRun}>
              {busy ? 'Working…' : 'Dry run — count reach'}
            </Button>
          </div>

          {reach && (
            <div style={{ display: 'grid', gap: 10, paddingTop: 4 }}>
              <div style={{ fontSize: 13, color: 'var(--text-2)' }}>
                Reach: <strong style={{ color: 'var(--text-1)' }}>{reach.recipients_total}</strong> devices
                {' '}(web {reach.web.fired} · android {reach.fcm.fired} · anon {reach.anon.fired})
              </div>
              <Field label="Type SEND to confirm">
                <input
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder="SEND"
                  autoComplete="off"
                />
              </Field>
              <Button variant="primary" onClick={onSend} disabled={!armed}>
                {busy ? 'Sending…' : 'Send to everyone'}
              </Button>
            </div>
          )}

          {msg && (
            <p style={{
              margin: 0,
              fontSize: 13,
              color: msgTone === 'err' ? 'var(--live)' : 'var(--lime)',
            }}>
              {msg}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Recent sends">
        {initialSends.length === 0 ? (
          <EmptyState title="No sends yet" hint="Dry-run and send your first broadcast above." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>When</th>
                <th>Kind</th>
                <th>Title / Label</th>
                <th>Reach</th>
                <th>Accepted</th>
                <th>Clicks</th>
                <th>Dry</th>
              </tr>
            </thead>
            <tbody>
              {initialSends.map((s) => (
                <tr key={s.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>{new Date(s.created_at).toLocaleString()}</td>
                  <td>{s.kind}</td>
                  <td>{s.label ?? s.title}</td>
                  <td>{s.recipients_total}</td>
                  <td>{s.accepted_total}</td>
                  <td>{s.clicks}</td>
                  <td>{s.dry_run ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>
    </div>
  )
}
