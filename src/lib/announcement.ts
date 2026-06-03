// src/lib/announcement.ts
// Pure helpers for the site-wide alert banner. No IO — unit-tested in
// src/lib/__tests__/announcement.test.ts. The API route and the AlertBanner
// component both depend on these so "which banner shows" and "is it dismissed"
// have a single source of truth.

export type AnnouncementType = 'info' | 'warning' | 'critical'

export interface Announcement {
  id: string
  message: string
  type: AnnouncementType
  active: boolean
  starts_at: string | null
  expires_at: string | null
  updated_at: string
}

/**
 * Choose the single banner to show from candidate rows at time `nowMs`.
 * Rules: active, started (starts_at null or <= now), not expired (expires_at
 * null or > now). Among eligible rows, newest `updated_at` wins.
 */
export function selectActiveAnnouncement(
  rows: Announcement[],
  nowMs: number,
): Announcement | null {
  const eligible = rows.filter(
    (r) =>
      r.active &&
      (r.starts_at == null || Date.parse(r.starts_at) <= nowMs) &&
      (r.expires_at == null || Date.parse(r.expires_at) > nowMs),
  )
  if (eligible.length === 0) return null
  return eligible.reduce((a, b) =>
    Date.parse(b.updated_at) > Date.parse(a.updated_at) ? b : a,
  )
}

/** Identity used for dismissal — changes when a new alert is published OR its copy is edited. */
export function dismissalKey(a: Announcement): string {
  return `${a.id}:${a.updated_at}`
}

/** True only when the stored localStorage value matches the current alert's key. */
export function isDismissed(a: Announcement, stored: string | null): boolean {
  return stored != null && stored === dismissalKey(a)
}
