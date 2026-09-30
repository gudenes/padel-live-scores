// Server component: "Notifications sent" section of the Growth page.
// Numbers come from the same sources as the Notifications and Broadcast tabs.
// Theme tokens only (light + dark).

import Link from 'next/link'
import { Panel, DataTable, EmptyState, Pill } from '@/components/ui'
import type { CatalogRow } from '@/lib/notification-catalog-types'
import type { NotificationSendRow } from '@/lib/broadcast-queries'

const hm = (iso: string) => new Date(iso).toISOString().slice(5, 16).replace('T', ' ')
const num = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' } as const

export function NotificationsPanel({
  catalog, sends,
}: { catalog: CatalogRow[] | null; sends: NotificationSendRow[] }) {
  return (
    <div style={{ marginTop: 14, display: 'grid', gap: 14 }}>
      <Panel title="Notifications by type · last 7 days" padded={!catalog || catalog.length === 0}>
        {catalog === null ? (
          <EmptyState title="Notification catalog unavailable" hint="The main app didn't answer /api/internal/notification-catalog. Check MAIN_APP_URL and CRON_SECRET." />
        ) : catalog.length === 0 ? (
          <EmptyState title="No notification types found." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Type</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Sends</th>
                <th style={{ textAlign: 'right' }}>Recipients</th>
                <th style={{ textAlign: 'right' }}>Failed</th>
                <th>Last fired</th>
              </tr>
            </thead>
            <tbody>
              {catalog.map(c => (
                <tr key={c.key}>
                  <td title={c.description}>{c.key}</td>
                  <td><Pill tone={c.status === 'live' ? 'lime' : 'neutral'} dot={c.status === 'live'}>{c.status}</Pill></td>
                  <td style={num}>{c.count7d.toLocaleString()}</td>
                  <td style={num}>{c.recipients7d.toLocaleString()}</td>
                  <td style={{ ...num, color: c.failed7d > 0 ? 'var(--live-text)' : undefined }}>{c.failed7d.toLocaleString()}</td>
                  <td style={{ color: 'var(--text-3)' }}>{c.lastFiredAt ? hm(c.lastFiredAt) + ' UTC' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Panel>

      <Panel title="Sent in the last 36 hours" padded={sends.length === 0}>
        {sends.length === 0 ? (
          <EmptyState title="No notifications sent in the last 36 hours." />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Kind</th>
                <th>Notification</th>
                <th style={{ textAlign: 'right' }}>Recipients</th>
                <th style={{ textAlign: 'right' }}>Accepted</th>
              </tr>
            </thead>
            <tbody>
              {sends.map(s => (
                <tr key={s.id}>
                  <td style={{ color: 'var(--text-3)' }}>{hm(s.created_at)}</td>
                  <td>{s.kind}</td>
                  <td>{s.label ?? s.title}</td>
                  <td style={num}>{s.recipients_total.toLocaleString()}</td>
                  <td style={num}>{s.accepted_total.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-4)', padding: '8px 14px' }}>
          Click-through isn&apos;t shown: click tracking records nothing yet.{' '}
          <Link href="/system/notifications" style={{ color: 'var(--text-3)' }}>Notifications detail →</Link>
        </div>
      </Panel>
    </div>
  )
}
