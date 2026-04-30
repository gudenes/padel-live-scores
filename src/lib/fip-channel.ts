// src/lib/fip-channel.ts
//
// Hardcoded constants for the FIP International Padel Federation
// YouTube channel. Used as the canonical source for FIP-tier match
// livestreams + replays (Bronze/Silver/Gold/Platinum/Promises).

export const FIP_CHANNEL_HANDLE = 'fipinternationalpadelfederation'

// YouTube channel ID, format: UC<22 chars>. Resolve once during
// implementation by hitting:
//   https://www.googleapis.com/youtube/v3/channels?forHandle=fipinternationalpadelfederation&part=id&key=...
// then paste the `id` value here.
export const FIP_CHANNEL_ID = 'UC4QobU6STFB0P71PMvOGN5A'

// uploads playlist ID is derived from channel ID: replace 'UC' prefix with 'UU'.
export const FIP_UPLOADS_PLAYLIST_ID = `UU${FIP_CHANNEL_ID.slice(2)}`

export const FIP_CHANNEL_URL = `https://www.youtube.com/c/${FIP_CHANNEL_HANDLE}`

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
