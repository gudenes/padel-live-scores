// Server component: closed-beta campaign widget. Aggregates only (no PII).
// Theme tokens only (light + dark).

import { Panel, EmptyState, Pill } from '@/components/ui'
import { pct } from '@/lib/growth/growth-compute'
import type { BetaSignupStats } from '@/lib/growth/beta-signups'
import { SignupsChart } from './SignupsChart'

export function BetaSignupsPanel({
  stats, closesAt, daysLeft, days,
}: {
  stats: BetaSignupStats | null
  closesAt: string
  daysLeft: number
  days: Array<{ day: string; n: number }>
}) {
  const closed = daysLeft === 0
  return (
    <Panel title="Closed beta signups">
      {stats === null ? (
        <EmptyState title="Signup table not available" hint="prediction_beta_signups doesn't exist in this database." />
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 40, fontWeight: 700, lineHeight: 1 }}>{stats.total.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 4 }}>enrolled</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700 }}>+{stats.last24h.toLocaleString()}</div>
              <div style={{ fontSize: 12, color: 'var(--text-4)' }}>last 24h</div>
            </div>
            <div>
              <div style={{ fontFamily: 'var(--display)', fontSize: 22, fontWeight: 700 }}>{pct(stats.withWhatsapp, stats.total)}%</div>
              <div style={{ fontSize: 12, color: 'var(--text-4)' }}>gave WhatsApp</div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <Pill tone={closed ? 'neutral' : 'lime'} dot={!closed}>{closed ? 'Signups closed' : `Closes in ${daysLeft}d`}</Pill>
              <div style={{ fontSize: 12, color: 'var(--text-4)', marginTop: 6 }}>
                Closes {new Date(closesAt).toISOString().slice(0, 16).replace('T', ' ')} UTC · plays start Oct 10
              </div>
            </div>
          </div>

          <SignupsChart data={days} />

          {stats.byLanguage.length > 0 && (
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-2)' }}>
              {stats.byLanguage.map(l => (
                <span key={l.language}>
                  <span style={{ textTransform: 'uppercase', color: 'var(--text-3)' }}>{l.language}</span>{' '}
                  {l.n.toLocaleString()} · {pct(l.n, stats.total)}%
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </Panel>
  )
}
