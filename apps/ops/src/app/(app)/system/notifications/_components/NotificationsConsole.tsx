'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, Panel, Button, Pill, DataTable, EmptyState } from '@/components/ui'
import type { CatalogRow, CategoryStatus } from '@/lib/notification-catalog-types'
import styles from './console.module.css'

type EntityType = 'player' | 'tournament' | 'match'

interface DryRunReach {
  recipients: number
  anonWould: number
}

const STATUS_TONE: Record<CategoryStatus, 'lime' | 'neutral' | 'warn'> = {
  live: 'lime',
  idle: 'neutral',
  soon: 'warn',
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export default function NotificationsConsole({ initialCategories }: { initialCategories: CatalogRow[] }) {
  const router = useRouter()

  // ── compose fields ──
  const [category, setCategory] = useState(initialCategories[0]?.key ?? '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')

  // ── send-to-followers entity ──
  const [entityType, setEntityType] = useState<EntityType>('player')
  const [entityId, setEntityId] = useState('')

  // ── confirm state machine ──
  const [reach, setReach] = useState<DryRunReach | null>(null)
  const [confirmText, setConfirmText] = useState('')

  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [msgTone, setMsgTone] = useState<'ok' | 'err'>('ok')

  // Any edit to content/entity invalidates a prior dry-run: collapse the
  // confirm section and clear the typed confirmation so the operator must
  // dry-run again and re-type SEND against the new payload.
  function invalidateConfirm() {
    setReach(null)
    setConfirmText('')
  }

  // Group the catalog rows for the health table.
  const grouped = useMemo(() => {
    const map = new Map<string, CatalogRow[]>()
    for (const row of initialCategories) {
      const arr = map.get(row.group) ?? []
      arr.push(row)
      map.set(row.group, arr)
    }
    return [...map.entries()]
  }, [initialCategories])

  async function postTrigger(dryRun: boolean) {
    setBusy(true)
    setMsg(null)
    try {
      const r = await fetch('/api/internal/notify-trigger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          entityType,
          entityId: entityId.trim(),
          title,
          body,
          url: url.trim() || undefined,
          dryRun,
        }),
      })
      const json = await r.json()
      if (!r.ok || json.ok === false) {
        setMsgTone('err')
        setMsg(`Error: ${json.error ?? json.message ?? r.status}`)
        return null
      }
      return json
    } catch (e) {
      setMsgTone('err')
      setMsg(`Network error: ${(e as Error).message}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function onDryRun() {
    // Clear any stale confirmation BEFORE showing the new reach.
    setConfirmText('')
    const json = await postTrigger(true)
    if (json) {
      setReach({ recipients: json.recipients ?? 0, anonWould: json.anonWould ?? 0 })
      setMsgTone('ok')
      setMsg('Dry run complete — no notifications were sent.')
    }
  }

  async function onSend() {
    const json = await postTrigger(false)
    if (json) {
      setMsgTone('ok')
      const accepted = (json.webSent ?? 0) + (json.fcmSent ?? 0) + (json.anonSent ?? 0)
      setMsg(`Sent to category "${category}". Recipients ${json.recipients ?? 0}, accepted ${accepted}.`)
      setReach(null)
      setConfirmText('')
      router.refresh()
    }
  }

  async function onTestSelf() {
    setTesting(true)
    setMsg(null)
    try {
      const r = await fetch('/api/internal/notify-test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, body, url: url.trim() || undefined }),
      })
      const json = await r.json()
      if (!r.ok) {
        setMsgTone('err')
        setMsg(`Error: ${json.error ?? r.status}`)
        return
      }
      const delivered = (json.sent ?? 0) + (json.fcm_sent ?? 0)
      const found = (json.subscriptions_found ?? 0) + (json.fcm_subscriptions_found ?? 0)
      if (found === 0) {
        setMsgTone('err')
        setMsg(`No push subscription found for ${json.email}. Enable notifications on padelnachos.com (or the app) on this device first.`)
      } else if (delivered === 0) {
        setMsgTone('err')
        setMsg(`Found ${found} subscription${found === 1 ? '' : 's'} for ${json.email} but delivered 0 — the send failed. Check server logs.`)
      } else {
        setMsgTone('ok')
        setMsg(`Test sent to ${json.email} — ${delivered} device${delivered === 1 ? '' : 's'}. Check your device.`)
      }
    } catch (e) {
      setMsgTone('err')
      setMsg(`Network error: ${(e as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  const anyBusy = busy || testing
  const filledIn = title.trim().length > 0 && body.trim().length > 0
  const canTest = filledIn && !anyBusy
  const canDryRun = filledIn && category.length > 0 && entityId.trim().length > 0 && !anyBusy
  const armed = reach !== null && confirmText === 'SEND' && !anyBusy

  return (
    <div className="ui-page">
      <PageHeader
        title="Notifications"
        subtitle="Category catalog + 7-day health, plus a guarded trigger to fan a notification out to an entity's followers."
        actions={<Button variant="ghost" onClick={() => router.refresh()}>Refresh</Button>}
      />

      {/* ── Region A: catalog & health ── */}
      <Panel title="Catalog & health (last 7 days)">
        {initialCategories.length === 0 ? (
          <EmptyState
            title="No catalog data"
            hint="The catalog endpoint returned nothing — the main app may be unreachable, or no categories are defined yet."
          />
        ) : (
          grouped.map(([group, rows]) => (
            <div key={group}>
              <div className={styles.groupLabel}>{group}</div>
              <DataTable>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Tier</th>
                    <th>Status</th>
                    <th>Last fired</th>
                    <th>7d fires</th>
                    <th>7d recipients</th>
                    <th>7d failed</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.key}</td>
                      <td><Pill tone={row.tier === 'pro' ? 'lime' : 'neutral'}>{row.tier}</Pill></td>
                      <td><Pill tone={STATUS_TONE[row.status]}>{row.status}</Pill></td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(row.lastFiredAt)}</td>
                      <td className={styles.num}>{row.count7d}</td>
                      <td className={styles.num}>{row.recipients7d}</td>
                      <td className={styles.num}>{row.failed7d}</td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            </div>
          ))
        )}
      </Panel>

      {/* ── Region B: trigger ── */}
      <Panel title="Trigger">
        <div className={styles.form}>
          <div className="ui-field">
            <label className="ui-field-label">Category</label>
            <select
              className="ui-input"
              value={category}
              onChange={(e) => { setCategory(e.target.value); invalidateConfirm() }}
            >
              {initialCategories.length === 0 && <option value="">No categories</option>}
              {initialCategories.map((c) => (
                <option key={c.key} value={c.key}>{c.key} ({c.tier})</option>
              ))}
            </select>
          </div>

          <div className="ui-field">
            <label className="ui-field-label">Title</label>
            <input
              className="ui-input"
              value={title}
              onChange={(e) => { setTitle(e.target.value); invalidateConfirm() }}
              placeholder="Match starting soon"
            />
          </div>

          <div className="ui-field">
            <label className="ui-field-label">Body</label>
            <textarea
              className={`ui-input ${styles.textarea}`}
              value={body}
              onChange={(e) => { setBody(e.target.value); invalidateConfirm() }}
              rows={3}
              placeholder="Short message shown under the title."
            />
          </div>

          <div className="ui-field">
            <label className="ui-field-label">Deep link URL <span style={{ textTransform: 'none', opacity: .7 }}>(optional)</span></label>
            <input
              className="ui-input"
              value={url}
              onChange={(e) => { setUrl(e.target.value); invalidateConfirm() }}
              placeholder="/match/…"
            />
          </div>

          <div className={styles.actions}>
            <Button variant="ghost" onClick={onTestSelf} disabled={!canTest}>
              {testing ? 'Sending…' : 'Send test to me'}
            </Button>
          </div>

          <hr style={{ border: 0, borderTop: '1px solid var(--border-inner)', margin: '4px 0' }} />

          <div className={styles.row2}>
            <div className="ui-field">
              <label className="ui-field-label">Entity type</label>
              <select
                className="ui-input"
                value={entityType}
                onChange={(e) => { setEntityType(e.target.value as EntityType); invalidateConfirm() }}
              >
                <option value="player">player</option>
                <option value="tournament">tournament</option>
                <option value="match">match</option>
              </select>
            </div>
            <div className="ui-field">
              <label className="ui-field-label">Entity id (UUID)</label>
              <input
                className="ui-input"
                value={entityId}
                onChange={(e) => { setEntityId(e.target.value); invalidateConfirm() }}
                placeholder="paste a UUID"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className={styles.actions}>
            <Button onClick={onDryRun} disabled={!canDryRun}>
              {busy ? 'Working…' : 'Dry run — count reach'}
            </Button>
          </div>

          {reach && (
            <div className={styles.reach}>
              <div className={styles.reachStrip}>
                <div className={`${styles.reachItem} ${styles.reachItemTotal}`}>
                  <div className={styles.reachNum}>{reach.recipients}</div>
                  <div className={styles.reachLabel}>Recipients</div>
                </div>
                <div className={styles.reachItem}>
                  <div className={styles.reachNum}>{reach.anonWould}</div>
                  <div className={styles.reachLabel}>Anon</div>
                </div>
              </div>

              <div className={styles.confirmRow}>
                <div className="ui-field">
                  <label className="ui-field-label">Type SEND to confirm</label>
                  <input
                    className="ui-input"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="SEND"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
                <Button variant="primary" onClick={onSend} disabled={!armed}>
                  {busy ? 'Sending…' : `Send to ${reach.recipients}`}
                </Button>
              </div>
            </div>
          )}

          {msg && (
            <p className={`${styles.hint} ${msgTone === 'err' ? styles.hintErr : styles.hintOk}`}>{msg}</p>
          )}
        </div>
      </Panel>
    </div>
  )
}
