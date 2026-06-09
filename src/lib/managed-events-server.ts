// src/lib/managed-events-server.ts
// Server-only reads for managed events. Uses the public anon client (RLS:
// active rows only). Active-event reads can use the browser-safe client
// because the RLS policy already scopes to active=true.

import { supabase } from '@/lib/supabase'
import type { ManagedEvent } from '@/lib/managed-events'

const EVENT_COLUMNS =
  'id, slug, name, wordmark, badge_label, active, status_override, country, location, venue, starts_at, ends_at, prize_pool, cover_image_url, ticket_url, footnote, watch_links, divisions, format, results, sort_weight'

/** Single active event by slug, or null when missing/inactive. */
export async function getManagedEventBySlug(slug: string): Promise<ManagedEvent | null> {
  const { data, error } = await supabase
    .from('managed_events')
    .select(EVENT_COLUMNS)
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle()
  if (error || !data) return null
  return data as unknown as ManagedEvent
}

/** All active events within the carousel/listing date window (ends_at >= cutoff). */
export async function getActiveManagedEvents(cutoffIso: string): Promise<ManagedEvent[]> {
  const { data, error } = await supabase
    .from('managed_events')
    .select(EVENT_COLUMNS)
    .eq('active', true)
    .gte('ends_at', cutoffIso)
    .order('sort_weight', { ascending: false })
    .order('starts_at', { ascending: true })
  if (error || !data) return []
  return data as unknown as ManagedEvent[]
}
