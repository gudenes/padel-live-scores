// src/lib/notification-icon.ts
// Resolves the icon URL for a push notification.
//
//   reason='follow' + player has avatar  → followed player's avatar
//   reason='follow' + no avatar          → circuit logo (fallback)
//   reason='bookmark'                    → circuit logo
//
// Circuit logo picker is keyed off `tournament.level`:
//   Premier-tier (P1/P2/Major/Premier_Mens/Premier_Womens) → Padel Star
//   FIP-tier     (fip_bronze/fip_silver/fip_gold)          → Cupra FIP Tour
//
// All returns are absolute URLs — FCM and Web Push both need fully-qualified
// URLs so the client can fetch the image from outside the origin context.

const BASE_URL = 'https://padelnachos.com'

const PREMIER_ICON_URL = `${BASE_URL}/branding/premier-padel-star.png`
const FIP_ICON_URL = `${BASE_URL}/branding/fip-tour-icon.png`

export interface NotificationIconContext {
  reason: 'bookmark' | 'follow'
  tournamentLevel: string | null
  followedPlayerAvatarUrl?: string | null
}

export function resolveNotificationIcon(ctx: NotificationIconContext): string {
  if (ctx.reason === 'follow' && ctx.followedPlayerAvatarUrl) {
    return ctx.followedPlayerAvatarUrl
  }
  return circuitIconUrl(ctx.tournamentLevel)
}

export function circuitIconUrl(level: string | null): string {
  if (!level) return FIP_ICON_URL
  const normalized = level.toLowerCase()
  if (
    normalized.startsWith('p1') ||
    normalized.startsWith('p2') ||
    normalized.startsWith('major') ||
    normalized.startsWith('premier')
  ) {
    return PREMIER_ICON_URL
  }
  return FIP_ICON_URL
}
