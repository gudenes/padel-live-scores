// apps/ops/src/types/managed-events.ts
// Mirror of the public ManagedEvent shape (apps/ops is an independent package,
// so we keep a local copy rather than importing across app boundaries).

export type WatchLink = { platform: string; label: string; region: string | null; url: string; primary?: boolean }
export type DivisionPlayer = { name: string; country: string | null }
export type DivisionTeam = { name: string; captain?: string | null; accent_color?: string | null; players: DivisionPlayer[] }
export type Division = { id: string; name: string; badge_color?: string | null; note?: string | null; teams: DivisionTeam[] }
export type FormatDayPoint = { day: string; points: number; label?: string }
export type EventFormat = { blurbs?: string[]; day_points?: FormatDayPoint[] }
export type ManagedEventStatus = 'upcoming' | 'ongoing' | 'finished'

export interface ManagedEvent {
  id: string
  slug: string
  name: string
  wordmark: string | null
  badge_label: string
  active: boolean
  status_override: ManagedEventStatus | null
  country: string | null
  location: string | null
  venue: string | null
  starts_at: string | null
  ends_at: string | null
  prize_pool: string | null
  cover_image_url: string | null
  ticket_url: string | null
  footnote: string | null
  watch_links: WatchLink[]
  divisions: Division[]
  format: EventFormat
  results: unknown | null
  sort_weight: number
  updated_at?: string
  created_at?: string
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export function isValidSlug(slug: string): boolean { return SLUG_RE.test(slug) }

// Whitelist of operator-writable columns. Anything else in the body is ignored.
export function buildWritablePayload(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const strFields = ['wordmark', 'badge_label', 'country', 'location', 'venue', 'starts_at', 'ends_at', 'prize_pool', 'cover_image_url', 'ticket_url', 'footnote', 'status_override']
  for (const f of strFields) if (body[f] !== undefined) out[f] = body[f]
  if (body.active !== undefined) out.active = !!body.active
  if (body.sort_weight !== undefined) out.sort_weight = Number(body.sort_weight) || 0
  for (const j of ['watch_links', 'divisions', 'format', 'results']) if (body[j] !== undefined) out[j] = body[j]
  if (body.badge_label === undefined || body.badge_label === '') out.badge_label = out.badge_label ?? 'Event'
  return out
}
