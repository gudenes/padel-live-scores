// src/lib/activity-log.ts
//
// Lightweight, fire-and-forget event logger. Inserts into
// user_activity_log for badge evaluation. Never blocks the UI.

import { supabase } from '@/lib/supabase'

/**
 * Log a user action. Call fire-and-forget: `void logActivity(...)`.
 * Only logs when a user is authenticated (needs user_id for RLS).
 */
export async function logActivity(
  userId: string,
  action: string,
  targetId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('user_activity_log').insert({
      user_id: userId,
      action,
      target_id: targetId ?? null,
      metadata: metadata ?? null,
    })
  } catch (e) {
    // Silent — never block UI for logging
    console.warn('[activity-log] insert failed:', (e as Error)?.message)
  }
}
