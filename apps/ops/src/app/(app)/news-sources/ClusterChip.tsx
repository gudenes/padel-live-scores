// apps/ops/src/app/(app)/news-sources/ClusterChip.tsx
// Small chip showing whether an article is unique / primary +N / sibling.

interface Props {
  role: 'unique' | 'primary' | 'sibling'
  siblingCount?: number
  primaryId?: string | null
  onSiblingClick?: (primaryId: string) => void
}

export function ClusterChip({ role, siblingCount, primaryId, onSiblingClick }: Props) {
  if (role === 'unique') {
    return (
      <span style={{
        fontSize: 10, color: 'var(--status-neutral)',
        padding: '2px 6px', border: '1px solid var(--border-subtle)',
        borderRadius: 3,
      }}>unique</span>
    )
  }
  if (role === 'primary') {
    return (
      <span style={{
        fontSize: 10, fontWeight: 700,
        color: 'var(--brand-primary-fg)', background: 'var(--brand-primary)',
        padding: '2px 6px', borderRadius: 3,
      }}>primary +{siblingCount ?? 0}</span>
    )
  }
  // sibling
  return (
    <button
      type="button"
      onClick={() => primaryId && onSiblingClick?.(primaryId)}
      title={primaryId ? `Jump to primary (${primaryId})` : 'Sibling'}
      style={{
        fontSize: 10, fontWeight: 700,
        color: 'var(--status-warn)', background: 'transparent',
        padding: '2px 6px', border: '1px solid var(--status-warn)',
        borderRadius: 3, cursor: primaryId ? 'pointer' : 'default',
      }}
    >sibling</button>
  )
}
