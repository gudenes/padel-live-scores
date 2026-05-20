// apps/ops/src/components/TodayRefreshButton.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

export function TodayRefreshButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
      style={{
        background: 'transparent',
        border: '1px solid var(--border-subtle)',
        borderRadius: 8,
        padding: '6px 12px',
        fontSize: 12,
        color: 'var(--status-neutral)',
        cursor: pending ? 'wait' : 'pointer',
      }}
    >
      {pending ? 'Refreshing…' : 'Refresh'}
    </button>
  )
}
