// apps/ops/src/components/Sidebar.tsx
// Two-column sidebar shell: SidebarPrimary (icons + user menu) + SidebarSecondary
// (pages). The signed-in-as / sign-out affordance now lives in the primary
// column's footer (was previously at the bottom of the secondary column).
// Owns badge polling for the Needs Review queue.
'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { SidebarPrimary } from './SidebarPrimary'
import { SidebarSecondary } from './SidebarSecondary'
import { areaFor } from '@/lib/sidebar-areas'

interface Props {
  userEmail: string | null
}

export function Sidebar({ userEmail }: Props) {
  const pathname = usePathname() ?? '/'
  const activeAreaId = areaFor(pathname)
  const activePageHref = pathname.split('?')[0]

  const [needsReviewCount, setNeedsReviewCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const r = await fetch('/api/internal/needs-review/counts', { cache: 'no-store' })
        if (!r.ok) return
        const json = (await r.json()) as { duplicates?: number; duplicatePlayers?: number }
        if (!cancelled) setNeedsReviewCount((json.duplicates ?? 0) + (json.duplicatePlayers ?? 0))
      } catch {
        // silent — badge falls back to 0
      }
    }
    poll()
    const id = setInterval(poll, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  const badges: Record<string, number> =
    needsReviewCount > 0 ? { '/needs-review': needsReviewCount } : {}

  // Both columns are rendered as direct siblings (no flex wrapper) so they
  // participate in the outer AppLayout flex row. This lets each column use
  // `position: sticky` and stay anchored to the viewport on long pages.
  return (
    <>
      <SidebarPrimary
        activeAreaId={activeAreaId}
        needsReviewCount={needsReviewCount}
        userEmail={userEmail}
      />
      <SidebarSecondary
        activeAreaId={activeAreaId}
        activePageHref={activePageHref}
        badges={badges}
      />
    </>
  )
}
