// apps/ops/src/app/(app)/system/seo/_components/LocaleGapsPanel.tsx
import { Panel, DataTable } from '@/components/ui'
import type { LocaleGapRow } from '@/lib/seo/seo-queries'

export function LocaleGapsPanel({ rows }: { rows: LocaleGapRow[] }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <Panel title="Locale coverage gaps · last 30 days">
        <p style={{ color: 'var(--text-3)', fontSize: '0.875rem', marginTop: 0, marginBottom: '1rem' }}>
          English pages winning impressions while their localized counterparts get ≤5% of that traffic.
        </p>
        {rows.length === 0 ? (
          <p style={{ color: 'var(--text-3)' }}>
            No gaps to flag — either no traffic yet, or all locales are tracking close to English.
          </p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>EN URL</th>
                <th style={{ textAlign: 'right' }}>Impr.</th>
                <th style={{ textAlign: 'right' }}>ES</th>
                <th style={{ textAlign: 'right' }}>PT</th>
                <th style={{ textAlign: 'right' }}>IT</th>
                <th style={{ textAlign: 'right' }}>FR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.en_url}>
                  <td style={{ wordBreak: 'break-all' }}>
                    <a href={r.en_url} target="_blank" rel="noopener" style={{ color: 'var(--men)' }}>{r.en_url}</a>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.en_impressions.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{r.es_impressions}</td>
                  <td style={{ textAlign: 'right' }}>{r.pt_impressions}</td>
                  <td style={{ textAlign: 'right' }}>{r.it_impressions}</td>
                  <td style={{ textAlign: 'right' }}>{r.fr_impressions}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <p style={{ color: 'var(--text-3)', fontSize: '0.8rem', marginTop: '1rem', marginBottom: 0 }}>
          <strong style={{ color: 'var(--lime-text)' }}>Action:</strong> confirm locale variants are in the sitemap and check hreflang block in HTML head for each row.
        </p>
      </Panel>
    </div>
  )
}
