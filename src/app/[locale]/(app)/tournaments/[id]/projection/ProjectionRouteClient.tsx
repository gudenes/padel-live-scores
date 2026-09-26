// src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionRouteClient.tsx
'use client'

import { useCallback, useRef } from 'react'
import { useRouter, usePathname } from '@/i18n/navigation'
import SlidingInkTabs from '@/components/SlidingInkTabs'
import { useTranslations } from 'next-intl'
import ProjectionTab from '../ProjectionTab'

type TabKey = 'overview' | 'entries' | 'story' | 'matches' | 'draw'

export default function ProjectionRouteClient({
  tournamentId,
  category,
  initialPairKey,
  tournamentLevel,
  roundSchedule,
  pairKeyToSlug,
  showDrawTab,
  tournamentName,
}: {
  tournamentId: string
  category: 'men' | 'women'
  initialPairKey: string | null
  tournamentLevel: string | null
  roundSchedule: Record<string, string> | null
  pairKeyToSlug: Record<string, string>
  showDrawTab: boolean
  tournamentName?: string | null
}) {
  const t = useTranslations('tournament')
  const router = useRouter()
  const pathname = usePathname()

  // Base path of THIS route, minus any /<pair> segment, so URL sync targets
  // /tournaments/<id>/projection[/<slug>]. usePathname() is locale-stripped
  // by @/i18n/navigation, so it starts at /tournaments/...
  const projectionBase = `/tournaments/${tournamentId}/projection`

  const lastSyncedRef = useRef<string | null>(initialPairKey ?? null)

  const onPairChange = useCallback((pairKey: string | null) => {
    if (pairKey === lastSyncedRef.current) return
    lastSyncedRef.current = pairKey
    const slug = pairKey ? pairKeyToSlug[pairKey] : null
    const target = slug
      ? `${projectionBase}/${slug}`
      : `${projectionBase}?category=${category}`
    // Avoid redundant navigations when already on target.
    if (pathname !== target.split('?')[0]) {
      router.replace(target, { scroll: false })
    }
  }, [pairKeyToSlug, projectionBase, category, pathname, router])

  // This route IS the entries tab's projected phase — tapping it is a no-op.
  // Everything else goes back to the in-page tabs.
  const onTabChange = useCallback((key: TabKey) => {
    if (key === 'entries') return
    router.push(`/tournaments/${tournamentId}?tab=${key}`)
  }, [router, tournamentId])

  const tabs = (['overview', 'entries', 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const)
    .map((key) => ({ key, label: t(key) }))

  return (
    <>
      <SlidingInkTabs
        tabs={tabs}
        activeKey="entries"
        onChange={onTabChange}
        containerStyle={{ position: 'sticky', top: 0, zIndex: 19, background: '#0A0A0A', borderBottom: '1px solid rgba(255,255,255,0.06)' }}
      />
      <ProjectionTab
        tournamentId={tournamentId}
        matches={[]}
        category={category}
        tournamentLevel={tournamentLevel}
        roundSchedule={roundSchedule}
        initialPairKey={initialPairKey}
        onPairChange={onPairChange}
        tournamentName={tournamentName}
      />
    </>
  )
}
