// src/lib/where-to-watch/circuit-map.ts
//
// Map tournament.level → YouTube channel abbreviation. Used by the
// Where-to-Watch popup to decide whether a circuit has matches scheduled
// today (which in turn drives whether to surface its broadcaster rows).
//
// Why abbreviation, not UUID: youtube_channels.abbreviation is unique +
// human-readable, and the channel records already have it ('PP', 'FIP').
// Avoids hardcoding UUIDs that differ per environment.

export const TOURNAMENT_LEVEL_TO_CHANNEL_ABBR: Record<string, string> = {
  // Premier Padel circuit
  p1: 'PP',
  p2: 'PP',
  major: 'PP',
  finals: 'PP',
  // FIP Tour circuit — all live under the fip_ prefix in tournaments.level
  fip_bronze: 'FIP',
  fip_silver: 'FIP',
  fip_gold: 'FIP',
  fip_platinum: 'FIP',
  fip_promises: 'FIP',
  fip_beyond: 'FIP',
  fip_championship: 'FIP',
  fip_other: 'FIP',
  // Legacy wpt_* levels (deprecated World Padel Tour) intentionally
  // unmapped — they predate Premier Padel and don't license to either
  // current channel.
}

export function levelToChannelAbbr(level: string | null | undefined): string | null {
  if (!level) return null
  return TOURNAMENT_LEVEL_TO_CHANNEL_ABBR[level.toLowerCase()] ?? null
}

/**
 * Given an array of today's matches (with tournament.level), return the set
 * of channel abbreviations whose circuit has at least one match today.
 */
export function circuitsForToday(
  matches: Array<{ tournament?: { level?: string | null } | null }>
): Set<string> {
  const result = new Set<string>()
  for (const m of matches) {
    const abbr = levelToChannelAbbr(m.tournament?.level)
    if (abbr) result.add(abbr)
  }
  return result
}
