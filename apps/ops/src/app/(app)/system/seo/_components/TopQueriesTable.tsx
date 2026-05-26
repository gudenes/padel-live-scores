// apps/ops/src/app/(app)/system/seo/_components/TopQueriesTable.tsx
import type { TopQuery } from '@/lib/seo/seo-queries'

export function TopQueriesTable({ queries }: { queries: TopQuery[] }) {
  return (
    <section style={{
      padding: '1.25rem',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-subtle)',
      borderRadius: 12,
    }}>
      <h3 style={{
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        color: '#6b7280',
        marginTop: 0,
        marginBottom: '0.75rem',
      }}>
        Top queries · yesterday
      </h3>
      {queries.length === 0 ? (
        <p style={{ color: '#6b7280' }}>No queries available for the latest snapshot.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#6b7280', fontSize: '0.8rem' }}>
              <th style={{ padding: '0.5rem', fontWeight: 500 }}>#</th>
              <th style={{ padding: '0.5rem', fontWeight: 500 }}>Query</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Clicks</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Impressions</th>
              <th style={{ padding: '0.5rem', textAlign: 'right', fontWeight: 500 }}>Position</th>
            </tr>
          </thead>
          <tbody>
            {queries.map(q => (
              <tr key={q.query} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: '0.5rem', color: '#9ca3af' }}>{q.rank}</td>
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
