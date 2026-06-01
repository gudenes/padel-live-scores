// src/lib/ad-injection.ts
// Pure cadence math for injecting feed-inline ads between match cards.
// Position is 1-based across the whole day's feed (not per tournament group).

export const AD_FEED_CADENCE = 6

export function shouldInjectAdAfter(
  position1Based: number,
  cadence: number = AD_FEED_CADENCE,
): boolean {
  if (position1Based <= 0) return false
  if (cadence <= 0) return false
  return position1Based % cadence === 0
}
