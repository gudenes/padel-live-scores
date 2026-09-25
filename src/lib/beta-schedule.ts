// Fixed campaign dates: never restart the countdown when a visitor reloads.
export const BETA_STARTS_AT = '2026-10-10T00:00:00+02:00'
export const BETA_SIGNUPS_CLOSE_AT = '2026-10-02T09:43:57Z'

export function betaSignupsClosed(now = Date.now()) {
  return now >= Date.parse(BETA_SIGNUPS_CLOSE_AT)
}

export function betaTimeRemaining(now: number) {
  const seconds = Math.max(0, Math.floor((Date.parse(BETA_SIGNUPS_CLOSE_AT) - now) / 1000))
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor(seconds / 3600) % 24,
    minutes: Math.floor(seconds / 60) % 60,
    seconds: seconds % 60,
  }
}
