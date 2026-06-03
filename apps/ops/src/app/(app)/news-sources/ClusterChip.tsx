// apps/ops/src/app/(app)/news-sources/ClusterChip.tsx
// Small chip showing whether an article is unique / primary +N / sibling.

import { Pill } from '@/components/ui'

interface Props {
  role: 'unique' | 'primary' | 'sibling'
  siblingCount?: number
  primaryId?: string | null
  onSiblingClick?: (primaryId: string) => void
}

export function ClusterChip({ role, siblingCount, primaryId, onSiblingClick }: Props) {
  if (role === 'unique') {
    return <Pill tone="neutral">unique</Pill>
  }
  if (role === 'primary') {
    return <Pill tone="lime">primary +{siblingCount ?? 0}</Pill>
  }
  // sibling — interactive, jumps to the primary article
  return (
    <button
      type="button"
      onClick={() => primaryId && onSiblingClick?.(primaryId)}
      title={primaryId ? `Jump to primary (${primaryId})` : 'Sibling'}
      style={{
        fontSize: 10, fontWeight: 700,
        color: 'var(--orange-text)', background: 'transparent',
        padding: '2px 6px', border: '1px solid var(--orange-border)',
        borderRadius: 'var(--r-xs)', cursor: primaryId ? 'pointer' : 'default',
      }}
    >sibling</button>
  )
}
