'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PageHeader, Panel, Button, DataTable, EmptyState } from '@/components/ui'
import type { NotificationSendRow } from '@/lib/broadcast-queries'
import styles from './broadcast.module.css'

interface DryRunResult {
  recipients_total: number
  web: { fired: number }
  fcm: { fired: number }
  anon: { fired: number }
}

const ICON_URL = 'https://padelnachos.com/padelnachos-logo-v2.png'
const APP_NAME = 'PadelNachos'

type Platform = 'android' | 'ios'

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
  const [platform, setPlatform] = useState<Platform>('android')

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
    } catch (e) {
      setMsgTone('err')
      setMsg(`Network error: ${(e as Error).message}`)
      return null
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
      setMsg(`Dry run complete — no notifications were sent.`)
    }
  }

  async function onSend() {
    const json = await post(false)
    if (json) {
      setMsgTone('ok')
      setMsg(`Sent. Accepted ${json.accepted_total}/${json.recipients_total}.`)
      setReach(null)
      setConfirmText('')
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

      <div className={styles.grid}>
        {/* ---- left: compose ---- */}
        <div className={styles.composeStack}>
          <Panel title="Compose">
            <div className={styles.form}>
              <div className="ui-field">
                <div className={styles.labelRow}>
                  <label className="ui-field-label">Title</label>
                  <span className={styles.count}>{title.length}/80</span>
                </div>
                <input
                  className="ui-input"
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); invalidateConfirm() }}
                  maxLength={80}
                  placeholder="World Padel Tour Final — starts now"
                />
              </div>

              <div className="ui-field">
                <div className={styles.labelRow}>
                  <label className="ui-field-label">Body</label>
                  <span className={styles.count}>{body.length}/180</span>
                </div>
                <textarea
                  className={`ui-input ${styles.textarea}`}
                  value={body}
                  onChange={(e) => { setBody(e.target.value); invalidateConfirm() }}
                  maxLength={180}
                  rows={3}
                  placeholder="Short message shown under the title."
                />
              </div>

              <div className={styles.row2}>
                <div className="ui-field">
                  <label className="ui-field-label">Deep link URL</label>
                  <input
                    className="ui-input"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); invalidateConfirm() }}
                    placeholder="/"
                  />
                </div>
                <div className="ui-field">
                  <label className="ui-field-label">Campaign label <span style={{ textTransform: 'none', opacity: .7 }}>(optional)</span></label>
                  <input
                    className="ui-input"
                    value={label}
                    onChange={(e) => { setLabel(e.target.value); invalidateConfirm() }}
                    placeholder="wpt-final-june"
                  />
                </div>
              </div>

              <div>
                <Button onClick={onDryRun} disabled={!canDryRun}>
                  {busy ? 'Working…' : 'Dry run — count reach'}
                </Button>
              </div>

              {reach && (
                <div className={styles.reach}>
                  <div className={styles.reachStrip}>
                    <div className={`${styles.reachItem} ${styles.reachItemTotal}`}>
                      <div className={styles.reachNum}>{reach.recipients_total}</div>
                      <div className={styles.reachLabel}>Total reach</div>
                    </div>
                    <div className={styles.reachItem}>
                      <div className={styles.reachNum}>{reach.fcm.fired}</div>
                      <div className={styles.reachLabel}>Android</div>
                    </div>
                    <div className={styles.reachItem}>
                      <div className={styles.reachNum}>{reach.web.fired}</div>
                      <div className={styles.reachLabel}>Web</div>
                    </div>
                    <div className={styles.reachItem}>
                      <div className={styles.reachNum}>{reach.anon.fired}</div>
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
                      {busy ? 'Sending…' : `Send to ${reach.recipients_total}`}
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

        {/* ---- right: live preview ---- */}
        <div className={styles.previewCol}>
          <div className={styles.previewHead}>
            <span className={styles.previewTitle}>Preview</span>
            <div className={styles.seg} role="tablist" aria-label="Preview platform">
              <button
                className={`${styles.segBtn} ${platform === 'android' ? styles.segOn : ''}`}
                onClick={() => setPlatform('android')}
                role="tab"
                aria-selected={platform === 'android'}
              >Android</button>
              <button
                className={`${styles.segBtn} ${platform === 'ios' ? styles.segOn : ''}`}
                onClick={() => setPlatform('ios')}
                role="tab"
                aria-selected={platform === 'ios'}
              >iPhone</button>
            </div>
          </div>

          <NotificationPreview platform={platform} title={title} body={body} />

          <p className={styles.note}>Approximate — actual rendering varies by device & OS.</p>
        </div>
      </div>

      {/* ---- history ---- */}
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

function NotificationPreview({ platform, title, body }: { platform: Platform; title: string; body: string }) {
  const t = title.trim()
  const b = body.trim()
  const titleText = t || 'Your title appears here'
  const bodyText = b || 'Your message shows up on the second line, like this.'
  const empty = !t && !b

  return (
    <div className={styles.phone}>
      <div className={styles.glow} />
      <div className={styles.clockWrap}>
        <div className={styles.clock}>9:41</div>
        <div className={styles.clockDate}>Monday, June 8</div>
      </div>

      {platform === 'android' ? (
        <div key="a" className={`${styles.andro} ${styles.cardEnter}`}>
          <div style={{ minWidth: 0 }}>
            <div className={styles.androHead}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className={styles.androAppIcon} src={ICON_URL} alt="" />
              <span className={styles.androApp}>{APP_NAME} · now</span>
            </div>
            <p className={`${styles.androTitle} ${empty ? styles.placeholder : ''}`}>{titleText}</p>
            <p className={`${styles.androBody} ${empty ? styles.placeholder : ''}`}>{bodyText}</p>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.androLarge} src={ICON_URL} alt="" />
        </div>
      ) : (
        <div key="i" className={`${styles.ios} ${styles.cardEnter}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.iosAppIcon} src={ICON_URL} alt="" />
          <div style={{ minWidth: 0 }}>
            <div className={styles.iosHead}>
              <span className={styles.iosApp}>{APP_NAME}</span>
              <span className={styles.iosWhen}>now</span>
            </div>
            <p className={`${styles.iosTitle} ${empty ? styles.placeholder : ''}`}>{titleText}</p>
            <p className={`${styles.iosBody} ${empty ? styles.placeholder : ''}`}>{bodyText}</p>
          </div>
        </div>
      )}
    </div>
  )
}
