// apps/ops/src/app/(app)/system/seo/_components/RankCandidatesPanel.tsx
import { Panel, DataTable } from '@/components/ui'
import type { RankCandidateRow } from '@/lib/seo/seo-queries'

export function RankCandidatesPanel({ rows }: { rows: RankCandidateRow[] }) {
  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <Panel title="Rank improvement candidates · last 7 days">
        <p style={{ color: 'var(--text-3)', fontSize: '0.875rem', marginTop: 0, marginBottom: '1rem' }}>
          Pages ranking 11–30 with &gt; 100 impressions. Best ROI on title/description rewrites since they&apos;re close to page 1.
        </p>
        {rows.length === 0 ? (
          <p style={{ color: 'var(--text-3)' }}>
            No candidates yet — either no traffic on page 2 pages, or no 7d data.
          </p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>URL</th>
                <th style={{ textAlign: 'right' }}>Impr.</th>
                <th style={{ textAlign: 'right' }}>Position</th>
                <th style={{ textAlign: 'right' }}>CTR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.url}>
                  <td style={{ wordBreak: 'break-all' }}>
                    <a href={r.url} target="_blank" rel="noopener" style={{ color: 'var(--men)' }}>{r.url}</a>
                  </td>
                  <td style={{ textAlign: 'right' }}>{r.impressions.toLocaleString()}</td>
                  <td style={{ textAlign: 'right' }}>{r.position.toFixed(1)}</td>
                  <td style={{ textAlign: 'right' }}>{r.ctr ? (r.ctr * 100).toFixed(1) + '%' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
        <p style={{ color: 'var(--text-3)', fontSize: '0.8rem', marginTop: '1rem', marginBottom: 0 }}>
          <strong style={{ color: 'var(--lime-text)' }}>Action:</strong> rewrite title + meta description, redeploy, watch position over 14 days.
        </p>
      </Panel>
    </div>
  )
}
