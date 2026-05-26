// apps/ops/src/app/(app)/system/seo/_components/ReconciliationPanel.tsx
import type { InGscNotInSitemapRow, InSitemapZeroImpressionsSummary } from '@/lib/seo/seo-queries'

interface Props {
  inGscNotInSitemap: InGscNotInSitemapRow[]
  inSitemapZero: InSitemapZeroImpressionsSummary[]
}

export function ReconciliationPanel({ inGscNotInSitemap, inSitemapZero }: Props) {
  return (
    <section style={{ padding: '1.25rem', borderRadius: 12, background: 'var(--bg-elev-1, #1f2937)', marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Sitemap reconciliation · last 30 days</h3>

      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.7 }}>In GSC, not in sitemap</h4>
        <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: 0 }}>
          Pages getting impressions but missing from sitemap.xml. Likely candidates to add.
        </p>
        {inGscNotInSitemap.length === 0 ? (
          <p style={{ opacity: 0.6 }}>None — every page with impressions is in the sitemap. ✓</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <tbody>
              {inGscNotInSitemap.map(r => (
                <tr key={r.url} style={{ borderTop: '1px solid var(--border, #374151)' }}>
                  <td style={{ padding: '0.5rem', wordBreak: 'break-all' }}>
                    <a href={r.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{r.url}</a>
                  </td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>impr: {r.impressions}</td>
                  <td style={{ padding: '0.5rem', textAlign: 'right' }}>pos: {r.position?.toFixed(1) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p style={{ opacity: 0.6, fontSize: '0.8rem', marginTop: '0.5rem' }}>
          <strong>Action:</strong> add to sitemap (or noindex if intentional).
        </p>
      </div>

      <div>
        <h4 style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.7 }}>In sitemap, zero impressions (30d)</h4>
        <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: 0 }}>
          URLs submitted but Google's never seen a query against. Count by page type:
        </p>
        {inSitemapZero.length === 0 ? (
          <p style={{ opacity: 0.6 }}>None — every sitemap URL has received at least one impression.</p>
        ) : (
          <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
            {inSitemapZero.map(r => (
              <li key={r.page_type} style={{ marginBottom: '0.25rem' }}>
                <code>{r.page_type}</code>: {r.url_count.toLocaleString()} URLs
              </li>
            ))}
          </ul>
        )}
        <p style={{ opacity: 0.6, fontSize: '0.8rem', marginTop: '0.5rem' }}>
          <strong>Action:</strong> triage long-tail; remove dead URLs from sitemap. Full CSV is one psql query away (see plan).
        </p>
      </div>
    </section>
  )
}
