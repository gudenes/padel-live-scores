// src/lib/notification-events.ts
// Main-app "fire this event once" claim against public.notification_events_sent.
// Returns true iff THIS call inserted the key (i.e. we should fire); false if it
// already existed (someone fired it) or the claim failed (fail closed).
import type { SupabaseClient } from '@supabase/supabase-js'

export async function claimNotificationEvent(
  supabase: Pick<SupabaseClient, 'from'>,
  eventKey: string,
  category: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_events_sent')
    .upsert({ event_key: eventKey, category }, { onConflict: 'event_key', ignoreDuplicates: true })
    .select('event_key')
  if (error) return false // fail closed: don't fire if we can't claim
  // ignoreDuplicates=true returns [] when a conflict occurred.
  return Array.isArray(data) && data.length > 0
}
