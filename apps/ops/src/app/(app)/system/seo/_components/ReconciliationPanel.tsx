// apps/ops/src/app/(app)/system/seo/_components/ReconciliationPanel.tsx
import type { InGscNotInSitemapRow, InSitemapZeroImpressionsSummary } from '@/lib/seo/seo-queries'

interface Props {
  inGscNotInSitemap: InGscNotInSitemapRow[]
  inSitemapZero: InSitemapZeroImpressionsSummary[]
}

export function ReconciliationPanel({ inGscNotInSitemap, inSitemapZero }: Props) {
  return (
    <section style={{
      padding: '1.25rem',
      borderRadius: 12,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      marginBottom: '1.5rem',
    }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem', marginBottom: '1rem' }}>
        Sitemap reconciliation · last 30 days
      </h3>

      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#6b7280',
          marginTop: 0,
          marginBottom: '0.25rem',
        }}>
          In GSC, not in sitemap
        </h4>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: 0, marginBottom: '0.75rem' }}>
          Pages getting impressions but missing from sitemap.xml. Likely candidates to add.
        </p>
        {inGscNotInSitemap.length === 0 ? (
          <p style={{ color: '#16a34a' }}>None — every page with impressions is in the sitemap. ✓</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <tbody>
              {inGscNotInSitemap.map(r => (
                <tr key={r.url} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <td style={{ padding: '0.5rem', wordBreak: 'break-all' }}>
                    <a href={r.url} target="_blank" rel="noopener" style={{ color: '#2563eb' }}>{r.url}</a>
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', color: '#6b7280' }}>impr: {r.impressions}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right', color: '#6b7280' }}>pos: {r.position?.toFixed(1) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: '0.5rem' }}>
          <strong style={{ color: 'var(--brand-primary-fg)' }}>Action:</strong> add to sitemap (or noindex if intentional).
        </p>
      </div>

      <div>
        <h4 style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: '#6b7280',
          marginTop: 0,
          marginBottom: '0.25rem',
        }}>
          In sitemap, zero impressions (30d)
        </h4>
        <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: 0, marginBottom: '0.75rem' }}>
          URLs submitted but Google has never seen a query against. Count by page type:
        </p>
        {inSitemapZero.length === 0 ? (
          <p style={{ color: '#16a34a' }}>None — every sitemap URL has received at least one impression.</p>
        ) : (
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            {inSitemapZero.map(r => (
              <li key={r.page_type} style={{ marginBottom: '0.25rem' }}>
                <code style={{ background: '#f3f4f6', padding: '0.125rem 0.375rem', borderRadius: 4 }}>{r.page_type}</code>: {r.url_count.toLocaleString()} URLs
              </li>
            ))}
          </ul>
        )}
        <p style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: '0.5rem', marginBottom: 0 }}>
          <strong style={{ color: 'var(--brand-primary-fg)' }}>Action:</strong> triage long-tail; remove dead URLs from sitemap. Full CSV is one psql query away (see plan).
        </p>
      </div>
    </section>
  )
}
