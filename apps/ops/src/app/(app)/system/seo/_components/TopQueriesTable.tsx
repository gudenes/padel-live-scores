// apps/ops/src/app/(app)/system/seo/_components/TopQueriesTable.tsx
import type { TopQuery } from '@/lib/seo/seo-queries'

export function TopQueriesTable({ queries }: { queries: TopQuery[] }) {
  return (
    <section>
      <h3 style={{ fontSize: '0.85rem', textTransform: 'uppercase', opacity: 0.6, marginBottom: '0.5rem' }}>
        Top queries · yesterday
      </h3>
      {queries.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No queries available for the latest snapshot.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6, fontSize: '0.8rem' }}>
              <th style={{ padding: '0.5rem' }}>#</th>
              <th style={{ padding: '0.5rem' }}>Query</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Clicks</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Impressions</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Position</th>
            </tr>
          </thead>
          <tbody>
            {queries.map(q => (
              <tr key={q.query} style={{ borderTop: '1px solid var(--border, #374151)' }}>
                <td style={{ padding: '0.5rem', opacity: 0.5 }}>{q.rank}</td>
                <td style={{ padding: '0.5rem' }}>{q.query}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{q.clicks.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{q.impressions.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{q.position?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
