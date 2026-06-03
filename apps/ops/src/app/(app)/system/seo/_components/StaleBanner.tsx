// apps/ops/src/app/(app)/system/seo/_components/StaleBanner.tsx
interface Props {
  hoursSinceIngest: number | null
}

export function StaleBanner({ hoursSinceIngest }: Props) {
  if (hoursSinceIngest === null) {
    return (
      <div style={{
        padding: '0.875rem 1rem',
        background: 'var(--men-bg)',
        border: '1px solid var(--men-border)',
        color: 'var(--text-1)',
        borderRadius: 8,
        marginBottom: '1rem',
        fontSize: '0.875rem',
      }}>
        <strong>No snapshots yet.</strong> Run the snapshot endpoint manually:
        <pre style={{
          marginTop: '0.5rem',
          marginBottom: 0,
          fontSize: '0.75rem',
          background: 'var(--bg-card)',
          color: 'var(--text-2)',
          border: '1px solid var(--men-border)',
          padding: '0.5rem 0.75rem',
          borderRadius: 6,
          overflowX: 'auto',
        }}>
{`curl -X POST -H "Authorization: Bearer $CRON_SECRET" \\
  https://admin.padelnachos.com/api/internal/seo-snapshot`}
        </pre>
      </div>
    )
  }
  if (hoursSinceIngest > 36) {
    return (
      <div style={{
        padding: '0.875rem 1rem',
        background: 'var(--live-bg)',
        border: '1px solid var(--live-border)',
        color: 'var(--live-text)',
        borderRadius: 8,
        marginBottom: '1rem',
        fontSize: '0.875rem',
      }}>
        <strong>Ingest stale.</strong> Last successful run was {Math.round(hoursSinceIngest)}h ago. Check Vercel cron logs.
      </div>
    )
  }
  return null
}
