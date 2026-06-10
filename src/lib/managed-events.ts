// src/lib/managed-events.ts
// Types + pure helpers for operator-curated managed events. No I/O here —
// data reads live in managed-events-server.ts; this module is unit-tested.

export type WatchLink = {
  platform: string
  label: string
  region: string | null
  url: string
  primary?: boolean
}

export type DivisionPlayer = { name: string; country: string | null; player_id?: string | null }
export type DivisionTeam = {
  name: string
  captain?: string | null
  accent_color?: string | null
  players: DivisionPlayer[]
}
export type Division = {
  id: string
  name: string
  badge_color?: string | null
  note?: string | null
  teams: DivisionTeam[]
}

export type FormatDayPoint = { day: string; points: number; label?: string }
export type EventFormat = {
  blurbs?: string[]
  day_points?: FormatDayPoint[]
}

export type EventResults = {
  standings?: Array<{ team: string; points: number }>
  matches?: Array<{ label?: string; teamA: string; teamB: string; score?: string; day?: string }>
}

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
  results: EventResults | null
  sort_weight: number
}

/**
 * Status from explicit override, else derived from the date window.
 * No dates → 'upcoming' (a freshly-created draft event reads as upcoming).
 */
export function effectiveStatus(
  event: Pick<ManagedEvent, 'status_override' | 'starts_at' | 'ends_at'>,
  now: Date = new Date(),
): ManagedEventStatus {
  if (event.status_override) return event.status_override
  const t = now.getTime()
  const start = event.starts_at ? new Date(event.starts_at).getTime() : null
  const end = event.ends_at ? new Date(event.ends_at).getTime() : null
  if (start !== null && t < start) return 'upcoming'
  if (end !== null && t > end) return 'finished'
  if (start === null) return 'upcoming'
  return 'ongoing'
}

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSlug(slug: string): boolean {
  return SLUG_RE.test(slug)
}

/** Derive a kebab-case slug suggestion from a free-text name. */
export function slugifyEventName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Card model consumed by the home Live Tournaments carousel. Shaped like a
 * tournament row plus a `managedEvent` discriminator the card branches on
 * (link target + badge pill). `level: null` keeps the tier pill suppressed.
 */
export interface ManagedEventCarouselCard {
  id: string
  name: string
  starts_at: string
  ends_at: string
  country: string | null
  level: null
  location: string | null
  prize_money: string | null
  logo_url: null
  cover_image_url: string | null
  matchesToday: number
  managedEvent: { slug: string; badgeLabel: string }
}

export function managedEventToCarouselCard(event: ManagedEvent): ManagedEventCarouselCard {
  return {
    id: event.id,
    name: event.name,
    starts_at: event.starts_at ?? new Date().toISOString(),
    ends_at: event.ends_at ?? new Date().toISOString(),
    country: event.country,
    level: null,
    location: event.location,
    prize_money: event.prize_pool,
    logo_url: null,
    cover_image_url: event.cover_image_url,
    matchesToday: 0,
    managedEvent: { slug: event.slug, badgeLabel: event.badge_label },
  }
}
