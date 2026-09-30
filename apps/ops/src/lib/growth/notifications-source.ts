// apps/ops/src/lib/growth/notifications-source.ts
// Data for the Growth "Notifications sent" section. Same sources as the
// Notifications tab (catalog API on the main app) and Broadcast tab
// (notification_sends). Each degrades to null/[] instead of breaking the page.

import type { CatalogRow } from '@/lib/notification-catalog-types'
import { listRecentSends, type NotificationSendRow } from '@/lib/broadcast-queries'

/** null = catalog unavailable (main app unreachable / auth failed). */
export async function fetchNotificationCatalog(): Promise<CatalogRow[] | null> {
  const target = process.env.MAIN_APP_URL ?? 'https://padelnachos.com'
  try {
    const r = await fetch(`${target}/api/internal/notification-catalog`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!r.ok) return null
    return ((await r.json()).categories ?? []) as CatalogRow[]
  } catch {
    return null
  }
}

export async function fetchRecentSends(): Promise<NotificationSendRow[]> {
  try {
    return await listRecentSends(150)
  } catch {
    return []
  }
}
