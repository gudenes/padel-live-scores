// apps/ops/src/app/(app)/system/seo/_components/LocaleGapsPanel.tsx
import type { LocaleGapRow } from '@/lib/seo/seo-queries'

export function LocaleGapsPanel({ rows }: { rows: LocaleGapRow[] }) {
  return (
    <section style={{
      padding: '1.25rem',
      borderRadius: 12,
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      marginBottom: '1.5rem',
    }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem', marginBottom: '0.25rem' }}>
        Locale coverage gaps · last 30 days
      </h3>
      <p style={{ color: '#6b7280', fontSize: '0.875rem', marginTop: 0, marginBottom: '1rem' }}>
        English pages winning impressions while their localized counterparts get ≤5% of that traffic.
      </p>
      {rows.length === 0 ? (
        <p style={{ color: '#6b7280' }}>
          No gaps to flag — either no traffic yet, or all locales are tracking close to English.
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#6b7280', fontSize: '0.8rem' }}>
              <th style={{ padding: '0.5rem', fontWeight: 500 }}>EN URL</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Impr.</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>ES</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>PT</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>IT</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>FR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.en_url} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.5rem', wordBreak: 'break-all' }}>
                  <a href={r.en_url} target="_blank" rel="noopener" style={{ color: '#2563eb' }}>{r.en_url}</a>
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
      <p style={{ color: '#6b7280', fontSize: '0.8rem', marginTop: '1rem', marginBottom: 0 }}>
        <strong style={{ color: 'var(--brand-primary-fg)' }}>Action:</strong> confirm locale variants are in the sitemap and check hreflang block in HTML head for each row.
      </p>
    </section>
  )
}
