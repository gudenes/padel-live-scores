export const RELEASE_KEY = 'pn_release_world_cup_smart_schedule_2026_11'
// Fifteen days after the November 4 production release (09:52:32 UTC).
export const RELEASE_END = Date.parse('2026-11-19T09:52:32Z')
let seenInMemory = false

export function releaseEligible(pathname: string, now = Date.now()) {
  return now < RELEASE_END && /^\/(home|matches|tournaments|rankings|following)\/?$/.test(pathname)
}

export function hasSeenRelease() {
  if (seenInMemory) return true
  try { return localStorage.getItem(RELEASE_KEY) === 'seen' } catch { return false }
}

export function markReleaseSeen() {
  seenInMemory = true
  try { localStorage.setItem(RELEASE_KEY, 'seen') } catch { /* In-memory fallback for blocked storage. */ }
}
