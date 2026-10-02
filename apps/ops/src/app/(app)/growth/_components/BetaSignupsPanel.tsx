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
              <span>Interview language:</span>
              {stats.byLanguage.map(l => (
                <span key={l.language}>{l.language.toUpperCase()} {l.n}</span>
              ))}
            </div>
          </div>

          <div style={{ textAlign: 'right', marginLeft: 'auto' }}>
            <Pill tone={closed ? 'neutral' : 'lime'} dot={!closed}>{closed ? 'Signups closed' : `Closes in ${daysLeft}d`}</Pill>
            <div style={cap}>{new Date(closesAt).toISOString().slice(5, 16).replace('T', ' ')} UTC · play Oct 10</div>
          </div>
          <section style={{ flexBasis: '100%', overflowX: 'auto' }} aria-label="Signups by campaign source and language">
            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>Source × campaign language · all time</h3>
            <table style={{ width: '100%', textAlign: 'left', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>{['Source', 'Spanish', 'English', 'Portuguese', 'Italian', 'Unknown', 'Total'].map(label => <th key={label} scope="col" style={{ padding: '8px 10px', borderBottom: '1px solid var(--track)' }}>{label}</th>)}</tr></thead>
              <tbody>{['Meta', 'Reddit', 'Other', 'Unknown'].map(source => {
                const rows = stats.byCampaign.filter(row => row.source === source)
                return <tr key={source}><th scope="row" style={{ padding: '8px 10px' }}>{source}</th>
                  {['es', 'en', 'pt', 'it', 'unknown'].map(language => <td key={language} style={{ padding: '8px 10px' }}>{rows.filter(row => row.campaign_language === language).reduce((sum, row) => sum + row.n, 0)}</td>)}
                  <td style={{ padding: '8px 10px', fontWeight: 700 }}>{rows.reduce((sum, row) => sum + row.n, 0)}</td>
                </tr>
              })}</tbody>
            </table>
            <p style={cap}>Campaign language comes from the tracking link. Unknown includes older signups and visits without tracking. Counts are registrations, not conversion rates.</p>
          </section>
        </div>
      )}
    </DismissiblePanel>
  )
}
