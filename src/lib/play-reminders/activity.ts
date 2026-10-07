/** Recent foreground use suppresses promotional mobile reminders only. */
export const RECENT_APP_WINDOW_MS = 30 * 60 * 1000
export function hasRecentAppActivity(
  lastSeen: string | null | undefined,
  now: number
) {
  if (!lastSeen) return false
  const time = Date.parse(lastSeen)
  return Number.isFinite(time) && time >= now - RECENT_APP_WINDOW_MS
}
