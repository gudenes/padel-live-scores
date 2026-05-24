// apps/ops/src/components/Sidebar.tsx
// Two-column sidebar shell: SidebarPrimary (icons) + SidebarSecondary (pages)
// + auth footer at the bottom. Owns badge polling for the Needs Review queue.
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

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <SidebarPrimary activeAreaId={activeAreaId} needsReviewCount={needsReviewCount} />

      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <SidebarSecondary
          activeAreaId={activeAreaId}
          activePageHref={activePageHref}
          badges={badges}
        />

        {userEmail && (
          <div
            style={{
              borderTop: '1px solid var(--border-subtle)',
              padding: '12px 16px',
              fontSize: 11,
              color: 'var(--status-neutral)',
              width: 248,
              background: 'var(--bg-card)',
            }}
          >
            <div style={{ marginBottom: 2 }}>Signed in as</div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--brand-primary-fg)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {userEmail}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
