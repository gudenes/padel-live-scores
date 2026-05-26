// apps/ops/src/app/(app)/system/seo/_components/LocaleGapsPanel.tsx
import type { LocaleGapRow } from '@/lib/seo/seo-queries'

export function LocaleGapsPanel({ rows }: { rows: LocaleGapRow[] }) {
  return (
    <section style={{ padding: '1.25rem', borderRadius: 12, background: 'var(--bg-elev-1, #1f2937)', marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Locale coverage gaps · last 30 days</h3>
      <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: 0 }}>
        English pages winning impressions while their localized counterparts get ≤5% of that traffic.
      </p>
      {rows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No gaps to flag — either no traffic yet, or all locales are tracking close to English.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6 }}>
              <th style={{ padding: '0.5rem' }}>EN URL</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Impr.</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>ES</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>PT</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>IT</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>FR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.en_url} style={{ borderTop: '1px solid var(--border, #374151)' }}>
                <td style={{ padding: '0.5rem', wordBreak: 'break-all' }}>
                  <a href={r.en_url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{r.en_url}</a>
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.en_impressions.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.es_impressions}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.pt_impressions}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.it_impressions}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.fr_impressions}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ opacity: 0.6, fontSize: '0.8rem', marginTop: '0.75rem' }}>
        <strong>Action:</strong> confirm locale variants are in the sitemap and check hreflang block in HTML head for each row.
      </p>
    </section>
  )
}
