// apps/ops/tests/growth-notifications-compute.test.ts
import { describe, it, expect } from 'vitest'
import { summarizeCatalog, sortCatalog, recentRealSends } from '../src/lib/growth/notifications-compute'
import type { CatalogRow } from '../src/lib/notification-catalog-types'
import type { NotificationSendRow } from '../src/lib/broadcast-queries'

const cat = (o: Partial<CatalogRow>): CatalogRow => ({
  key: 'k', tier: 'free', group: 'g', comingSoon: false, status: 'live', lastFiredAt: null,
  count7d: 0, recipients7d: 0, failed7d: 0, description: '', sample: { title: '', body: '' }, ...o,
})
const send = (o: Partial<NotificationSendRow>): NotificationSendRow => ({
  id: 'i', created_at: '2026-09-30T10:00:00Z', kind: 'match', title: 't', label: null,
  dry_run: false, recipients_total: 1, accepted_total: 1, clicks: 0, ...o,
})

describe('summarizeCatalog', () => {
  it('sums active categories and ignores coming-soon', () => {
    const t = summarizeCatalog([
      cat({ count7d: 5, recipients7d: 50, failed7d: 1 }),
      cat({ count7d: 2, recipients7d: 4, status: 'idle' }),
      cat({ count7d: 99, recipients7d: 99, comingSoon: true, status: 'soon' }),
    ])
    expect(t).toEqual({ sends7d: 7, recipients7d: 54, failed7d: 1, liveCategories: 1 })
  })
})

describe('sortCatalog', () => {
  it('puts live first, then by volume, and drops coming-soon', () => {
    const out = sortCatalog([
      cat({ key: 'idle', status: 'idle', count7d: 50 }),
      cat({ key: 'low', count7d: 1 }),
      cat({ key: 'soon', comingSoon: true, status: 'soon' }),
      cat({ key: 'high', count7d: 9 }),
    ])
    expect(out.map(r => r.key)).toEqual(['high', 'low', 'idle'])
  })
})

describe('recentRealSends', () => {
  it('drops dry runs and old rows, newest first, capped', () => {
    const out = recentRealSends([
      send({ id: 'a', created_at: '2026-09-30T08:00:00Z' }),
      send({ id: 'dry', created_at: '2026-09-30T09:00:00Z', dry_run: true }),
      send({ id: 'old', created_at: '2026-09-28T09:00:00Z' }),
      send({ id: 'b', created_at: '2026-09-30T10:00:00Z' }),
    ], '2026-09-29T00:00:00Z', 1)
    expect(out.map(r => r.id)).toEqual(['b'])
  })
})
