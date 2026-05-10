// src/lib/push.ts
// Server-side web-push helper — wraps VAPID setup and send logic.
// Only import in API routes (server-side only).

// @ts-expect-error — web-push has no type declarations
import webpush from 'web-push'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!

webpush.setVapidDetails(
  'mailto:hello@padelnacho.com',
  VAPID_PUBLIC_KEY,
  VAPID_PRIVATE_KEY,
)

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
  /** Absolute URL to a square image (player avatar or circuit logo).
   *  Surfaced via NotificationOptions.icon — the round thumbnail browsers
   *  render alongside the title/body. Falls back to the brand logo when
   *  unset (see public/sw.js). */
  icon?: string
}

interface PushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

/**
 * Send a push notification to a single subscription.
 * Returns true if sent, false if subscription is stale (410/404).
 */
export async function sendPush(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<boolean> {
  try {
    await webpush.sendNotification(
      {
        endpoint: subscription.endpoint,
        keys: subscription.keys,
      },
      JSON.stringify(payload),
      { TTL: 3600 }
    )
    return true
  } catch (err: any) {
    if (err.statusCode === 410 || err.statusCode === 404) {
      // Subscription is stale — caller should delete it
      return false
    }
    console.error('[Push] Send failed:', err.message)
    return false
  }
}
