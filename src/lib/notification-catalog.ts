// src/lib/notification-catalog.ts
// Pure shaping for the ops Notifications console: join CATEGORY_META with
// notification_sends aggregates and derive a live/idle/soon status.
import { CATEGORY_META, KNOWN_CATEGORIES, type NotificationCategory } from '@/lib/notification-categories'

export type CategoryStatus = 'live' | 'idle' | 'soon'

const LIVE_WINDOW_MS = 7 * 24 * 3600_000

export function deriveCategoryStatus(
  input: { comingSoon: boolean; lastFiredAt: string | null },
  now: number,
): CategoryStatus {
  if (input.lastFiredAt && now - Date.parse(input.lastFiredAt) <= LIVE_WINDOW_MS) return 'live'
  if (input.comingSoon) return 'soon'
  return 'idle'
}

export type SendAgg = {
  category: string
  lastFiredAt: string | null
  count7d: number
  recipients7d: number
  failed7d: number
}

export type CatalogRow = {
  key: NotificationCategory
  tier: 'free' | 'pro'
  group: string
  comingSoon: boolean
  status: CategoryStatus
  lastFiredAt: string | null
  count7d: number
  recipients7d: number
  failed7d: number
}

export function buildCatalog(aggs: SendAgg[], now: number): CatalogRow[] {
  const byCat = new Map(aggs.map((a) => [a.category, a]))
  return KNOWN_CATEGORIES.map((key) => {
    const meta = CATEGORY_META[key]
    const agg = byCat.get(key)
    return {
      key,
      tier: meta.tier,
      group: meta.group,
      comingSoon: meta.comingSoon,
      status: deriveCategoryStatus({ comingSoon: meta.comingSoon, lastFiredAt: agg?.lastFiredAt ?? null }, now),
      lastFiredAt: agg?.lastFiredAt ?? null,
      count7d: agg?.count7d ?? 0,
      recipients7d: agg?.recipients7d ?? 0,
      failed7d: agg?.failed7d ?? 0,
    }
  })
}
