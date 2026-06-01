// apps/ops/src/components/TodayRefreshButton.tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui'

export function TodayRefreshButton() {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={() => startTransition(() => router.refresh())}
      disabled={pending}
    >
      {pending ? 'Refreshing…' : 'Refresh'}
    </Button>
  )
}
