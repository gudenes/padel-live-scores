// apps/ops/src/app/(app)/system/seo/_components/TopQueriesTable.tsx
import { Panel, DataTable, EmptyState } from '@/components/ui'
import type { TopQuery } from '@/lib/seo/seo-queries'

export function TopQueriesTable({ queries }: { queries: TopQuery[] }) {
  return (
    <Panel title="Top queries · yesterday" padded={queries.length === 0}>
      {queries.length === 0 ? (
        <EmptyState title="No queries available for the latest snapshot." />
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>#</th>
              <th>Query</th>
              <th style={{ textAlign: 'right' }}>Clicks</th>
              <th style={{ textAlign: 'right' }}>Impressions</th>
              <th style={{ textAlign: 'right' }}>Position</th>
            </tr>
          </thead>
          <tbody>
            {queries.map(q => (
              <tr key={q.query}>
                <td style={{ color: 'var(--text-4)' }}>{q.rank}</td>
                <td>{q.query}</td>
                <td style={{ textAlign: 'right' }}>{q.clicks.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{q.impressions.toLocaleString()}</td>
                <td style={{ textAlign: 'right' }}>{q.position?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Panel>
  )
}
