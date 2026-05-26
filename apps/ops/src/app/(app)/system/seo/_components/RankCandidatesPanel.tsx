// apps/ops/src/app/(app)/system/seo/_components/RankCandidatesPanel.tsx
import type { RankCandidateRow } from '@/lib/seo/seo-queries'

export function RankCandidatesPanel({ rows }: { rows: RankCandidateRow[] }) {
  return (
    <section style={{ padding: '1.25rem', borderRadius: 12, background: 'var(--bg-elev-1, #1f2937)', marginBottom: '1.5rem' }}>
      <h3 style={{ marginTop: 0, fontSize: '1rem' }}>Rank improvement candidates · last 7 days</h3>
      <p style={{ opacity: 0.6, fontSize: '0.85rem', marginTop: 0 }}>
        Pages ranking 11–30 with &gt; 100 impressions. Best ROI on title/description rewrites since they're close to page 1.
      </p>
      {rows.length === 0 ? (
        <p style={{ opacity: 0.6 }}>No candidates yet — either no traffic on page 2 pages, or no 7d data.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', opacity: 0.6 }}>
              <th style={{ padding: '0.5rem' }}>URL</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Impr.</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>Position</th>
              <th style={{ padding: '0.5rem', textAlign: 'right' }}>CTR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.url} style={{ borderTop: '1px solid var(--border, #374151)' }}>
                <td style={{ padding: '0.5rem', wordBreak: 'break-all' }}>
                  <a href={r.url} target="_blank" rel="noopener" style={{ color: 'inherit' }}>{r.url}</a>
                </td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.impressions.toLocaleString()}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.position.toFixed(1)}</td>
                <td style={{ padding: '0.5rem', textAlign: 'right' }}>{r.ctr ? (r.ctr * 100).toFixed(1) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ opacity: 0.6, fontSize: '0.8rem', marginTop: '0.75rem' }}>
        <strong>Action:</strong> rewrite title + meta description, redeploy, watch position over 14 days.
      </p>
    </section>
  )
}
