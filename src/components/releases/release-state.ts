export const RELEASE_KEY = 'pn_release_world_cup_smart_schedule_2026_11'
export const RELEASE_END = Date.parse('2026-12-01T00:00:00Z')
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
