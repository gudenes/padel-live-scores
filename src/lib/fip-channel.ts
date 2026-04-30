// src/lib/fip-channel.ts
//
// Hardcoded constants for the FIP International Padel Federation
// YouTube channel. Used as the canonical source for FIP-tier match
// livestreams + replays (Bronze/Silver/Gold/Platinum/Promises).

export const FIP_CHANNEL_HANDLE = 'padelfip'

// YouTube channel ID for the FIP International Padel Federation.
// Channel URL: https://www.youtube.com/@padelfip
export const FIP_CHANNEL_ID = 'UCo2fCPOJnS95_PNOta5Jafg'

// uploads playlist ID is derived from channel ID: replace 'UC' prefix with 'UU'.
export const FIP_UPLOADS_PLAYLIST_ID = `UU${FIP_CHANNEL_ID.slice(2)}`

// Use the @-handle URL — YouTube deprecated the /c/ vanity URLs in 2023
// and they don't always redirect for channels that haven't claimed one.
export const FIP_CHANNEL_URL = `https://www.youtube.com/@${FIP_CHANNEL_HANDLE}`

export const FIP_TOURNAMENT_LEVELS = [
  'fip_bronze',
  'fip_silver',
  'fip_gold',
  'fip_platinum',
  'fip_promises',
  'fip_other',
] as const

export type FipTournamentLevel = (typeof FIP_TOURNAMENT_LEVELS)[number]

export function isFipTier(level: string | null | undefined): level is FipTournamentLevel {
  return !!level && (FIP_TOURNAMENT_LEVELS as readonly string[]).includes(level)
}
