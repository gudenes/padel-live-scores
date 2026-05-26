// apps/ops/src/app/(app)/system/seo/_components/StaleBanner.tsx
interface Props {
  hoursSinceIngest: number | null
}

export function StaleBanner({ hoursSinceIngest }: Props) {
  if (hoursSinceIngest === null) {
    return (
      <div style={{
        padding: '0.75rem 1rem',
        background: '#1e3a8a',
        borderRadius: 6,
        marginBottom: '1rem',
      }}>
        <strong>No snapshots yet.</strong> Run the snapshot endpoint manually:
        <pre style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
{`curl -X POST -H "Authorization: Bearer $CRON_SECRET" \\
  https://admin.padelnachos.com/api/internal/seo-snapshot`}
        </pre>
      </div>
    )
  }
  if (hoursSinceIngest > 36) {
    return (
      <div style={{
        padding: '0.75rem 1rem',
        background: '#7f1d1d',
        borderRadius: 6,
        marginBottom: '1rem',
      }}>
        <strong>Ingest stale.</strong> Last successful run was {Math.round(hoursSinceIngest)}h ago. Check Vercel cron logs.
      </div>
    )
  }
  return null
}
