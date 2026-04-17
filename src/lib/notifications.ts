// src/lib/notifications.ts
//
// Phase 2 stub for the Notifications row unread count. Returns 0
// synchronously so the UI can render the row without a network
// round-trip. Phase 3 swaps this to a real query against a
// `notifications` table (or user_activity_log, TBD by that spec).
//
// The row already supports the red "N new" treatment when this
// returns > 0 — no UI change will be needed when the real source
// lands.

export function getUnreadNotificationCount(): number {
  return 0
}
