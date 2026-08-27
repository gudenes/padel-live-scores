// apps/ops/src/lib/notification-catalog-types.ts
// Mirrors the main app's CatalogRow shape (src/lib/notification-catalog.ts).
// The ops Notifications console renders these rows; the page server-fetches
// them from /api/internal/notification-catalog.
export type CategoryStatus = 'live' | 'idle' | 'soon'
export type CatalogRow = {
  key: string
  tier: 'free' | 'pro'
  group: string
  comingSoon: boolean
  status: CategoryStatus
  lastFiredAt: string | null
  count7d: number
  recipients7d: number
  failed7d: number
  description: string
  sample: { title: string; body: string }
  sampleScenario?: 'premier' | 'fip' | 'avatar' | 'scheduled_follow' | 'scheduled_bookmark' | 'eliminated'
}
