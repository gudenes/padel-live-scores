// apps/ops/src/app/(app)/system/seo/_components/StaleBanner.tsx
interface Props {
  hoursSinceIngest: number | null
}

export function StaleBanner({ hoursSinceIngest }: Props) {
  if (hoursSinceIngest === null) {
    return (
      <div style={{
        padding: '0.875rem 1rem',
        background: '#eff6ff',          // blue-50
        border: '1px solid #bfdbfe',    // blue-200
        color: '#1e3a8a',                // blue-900
        borderRadius: 8,
        marginBottom: '1rem',
        fontSize: '0.875rem',
      }}>
        <strong>No snapshots yet.</strong> Run the snapshot endpoint manually:
        <pre style={{
          marginTop: '0.5rem',
          marginBottom: 0,
          fontSize: '0.75rem',
          background: 'white',
          border: '1px solid #bfdbfe',
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
        background: '#fef2f2',           // red-50
        border: '1px solid #fecaca',     // red-200
        color: '#991b1b',                // red-800
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
