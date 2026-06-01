// apps/ops/src/app/(app)/system/seo/_components/ReconciliationPanel.tsx
import { Panel, DataTable } from '@/components/ui'
import type { InGscNotInSitemapRow, InSitemapZeroImpressionsSummary } from '@/lib/seo/seo-queries'

interface Props {
  inGscNotInSitemap: InGscNotInSitemapRow[]
  inSitemapZero: InSitemapZeroImpressionsSummary[]
}

export function ReconciliationPanel({ inGscNotInSitemap, inSitemapZero }: Props) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <Panel title="Sitemap reconciliation · last 30 days">
        <div style={{ marginBottom: '1.5rem' }}>
          <h4 style={{
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-3)',
            marginTop: 0,
            marginBottom: '0.25rem',
          }}>
            In GSC, not in sitemap
          </h4>
          <p style={{ color: 'var(--text-3)', fontSize: '0.875rem', marginTop: 0, marginBottom: '0.75rem' }}>
            Pages getting impressions but missing from sitemap.xml. Likely candidates to add.
          </p>
          {inGscNotInSitemap.length === 0 ? (
            <p style={{ color: 'var(--lime-text)' }}>None — every page with impressions is in the sitemap. ✓</p>
          ) : (
            <DataTable>
              <tbody>
                {inGscNotInSitemap.map(r => (
                  <tr key={r.url}>
                    <td style={{ wordBreak: 'break-all' }}>
                      <a href={r.url} target="_blank" rel="noopener" style={{ color: 'var(--men)' }}>{r.url}</a>
                    </td>
                    <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>impr: {r.impressions}</td>
                    <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>pos: {r.position?.toFixed(1) ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
          <p style={{ color: 'var(--text-3)', fontSize: '0.8rem', marginTop: '0.5rem' }}>
            <strong style={{ color: 'var(--lime-text)' }}>Action:</strong> add to sitemap (or noindex if intentional).
          </p>
        </div>

        <div>
          <h4 style={{
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: 'var(--text-3)',
            marginTop: 0,
            marginBottom: '0.25rem',
          }}>
            In sitemap, zero impressions (30d)
          </h4>
          <p style={{ color: 'var(--text-3)', fontSize: '0.875rem', marginTop: 0, marginBottom: '0.75rem' }}>
            URLs submitted but Google has never seen a query against. Count by page type:
          </p>
          {inSitemapZero.length === 0 ? (
            <p style={{ color: 'var(--lime-text)' }}>None — every sitemap URL has received at least one impression.</p>
          ) : (
            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem', color: 'var(--text-2)' }}>
              {inSitemapZero.map(r => (
                <li key={r.page_type} style={{ marginBottom: '0.25rem' }}>
                  <code style={{ background: 'var(--bg-card-2)', padding: '0.125rem 0.375rem', borderRadius: 4 }}>{r.page_type}</code>: {r.url_count.toLocaleString()} URLs
                </li>
              ))}
            </ul>
          )}
          <p style={{ color: 'var(--text-3)', fontSize: '0.8rem', marginTop: '0.5rem', marginBottom: 0 }}>
            <strong style={{ color: 'var(--lime-text)' }}>Action:</strong> triage long-tail; remove dead URLs from sitemap. Full CSV is one psql query away (see plan).
          </p>
        </div>
      </Panel>
    </div>
  )
}
