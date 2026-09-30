// Server component: compact closed-beta campaign widget. Aggregates only (no PII).
// Theme tokens only (light + dark).

import { EmptyState, Pill } from '@/components/ui'
import { pct } from '@/lib/growth/growth-compute'
import type { BetaSignupStats } from '@/lib/growth/beta-signups'
import { DismissiblePanel } from './DismissiblePanel'

const stat = { fontFamily: 'var(--display)', fontWeight: 700, lineHeight: 1 } as const
const cap = { fontSize: 11, color: 'var(--text-4)', marginTop: 3 } as const

export function BetaSignupsPanel({
  stats, closesAt, daysLeft, days,
}: {
  stats: BetaSignupStats | null
  closesAt: string
  daysLeft: number
  days: Array<{ day: string; n: number }>
}) {
  const closed = daysLeft === 0
  const max = Math.max(...days.map(d => d.n), 1)
  return (
    <DismissiblePanel storageKey="growth.betaSignups.hidden" title="Closed beta signups" restoreLabel="Show closed beta signups">
      {stats === null ? (
        <EmptyState title="Signup table not available" hint="prediction_beta_signups doesn't exist in this database." />
      ) : (
        <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap' }}>
          <div>
            <div style={{ ...stat, fontSize: 30 }}>{stats.total.toLocaleString()}</div>
            <div style={cap}>enrolled</div>
          </div>
          <div>
            <div style={{ ...stat, fontSize: 18 }}>+{stats.last24h.toLocaleString()}</div>
            <div style={cap}>last 24h</div>
          </div>
          <div>
            <div style={{ ...stat, fontSize: 18 }}>{pct(stats.withWhatsapp, stats.total)}%</div>
            <div style={cap}>WhatsApp</div>
          </div>

          <div style={{ flex: '1 1 160px', minWidth: 140 }} aria-label="Signups per day, last 30 days">
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32 }}>
              {days.map(d => (
                <div key={d.day} title={`${d.day}: ${d.n}`} style={{
                  flex: 1, minHeight: 2, height: `${Math.max((d.n / max) * 100, 6)}%`,
                  background: d.n > 0 ? 'var(--lime)' : 'var(--track)', borderRadius: 1,
                }} />
              ))}
            </div>
            <div style={{ ...cap, display: 'flex', gap: 10 }}>
              {stats.byLanguage.map(l => (
                <span key={l.language}>{l.language.toUpperCase()} {l.n}</span>
              ))}
            </div>
          </div>

          <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
            <Pill tone={closed ? 'neutral' : 'lime'} dot={!closed}>{closed ? 'Signups closed' : `Closes in ${daysLeft}d`}</Pill>
            <div style={cap}>{new Date(closesAt).toISOString().slice(5, 16).replace('T', ' ')} UTC · play Oct 10</div>
          </div>
        </div>
      )}
    </DismissiblePanel>
  )
}
