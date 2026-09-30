// apps/ops/src/lib/growth/notifications-compute.ts
// Pure helpers for the Growth page "Notifications sent" section. Inputs are the
// same shapes the Notifications tab (CatalogRow) and Broadcast tab
// (NotificationSendRow) already use, so all three surfaces agree.

import type { CatalogRow } from '@/lib/notification-catalog-types'
import type { NotificationSendRow } from '@/lib/broadcast-queries'

export interface CatalogTotals { sends7d: number; recipients7d: number; failed7d: number; liveCategories: number }

/** Coming-soon categories never fire, so they are excluded from the totals. */
export function summarizeCatalog(rows: CatalogRow[]): CatalogTotals {
  const active = rows.filter(r => !r.comingSoon)
  return {
    sends7d: active.reduce((a, r) => a + r.count7d, 0),
    recipients7d: active.reduce((a, r) => a + r.recipients7d, 0),
    failed7d: active.reduce((a, r) => a + r.failed7d, 0),
    liveCategories: active.filter(r => r.status === 'live').length,
  }
}

const STATUS_ORDER: Record<CatalogRow['status'], number> = { live: 0, idle: 1, soon: 2 }

/** Live first, then by 7-day volume; coming-soon rows are dropped. */
export function sortCatalog(rows: CatalogRow[]): CatalogRow[] {
  return rows
    .filter(r => !r.comingSoon)
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.count7d - a.count7d)
}

/** Real (non-dry-run) sends since `sinceIso`, newest first, capped at `limit`. */
export function recentRealSends(rows: NotificationSendRow[], sinceIso: string, limit: number): NotificationSendRow[] {
  return rows
    .filter(r => !r.dry_run && r.created_at >= sinceIso)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, limit)
}
