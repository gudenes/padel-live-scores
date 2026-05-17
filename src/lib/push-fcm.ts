// src/lib/push-fcm.ts
// Server-side FCM v1 send. Sibling to src/lib/push.ts (Web Push).
// Lazy-initialises firebase-admin on first call so test envs without
// FCM env vars don't crash at module import.

import admin from 'firebase-admin'

let app: admin.app.App | null = null

function getApp(): admin.app.App {
  if (app) return app
  const json = process.env.FCM_SERVICE_ACCOUNT_JSON
  if (!json) throw new Error('FCM_SERVICE_ACCOUNT_JSON env var missing')
  const credentials = JSON.parse(json)
  app = admin.initializeApp({
    credential: admin.credential.cert(credentials),
    projectId: process.env.FCM_PROJECT_ID,
  })
  return app
}

export interface FcmPayload {
  title: string
  body: string
  url?: string
  tag?: string
  /** Absolute URL to a square image (player avatar or circuit logo).
   *  Sent in the data payload — PadelMessagingService on Android downloads
   *  the URL and sets it as the notification's largeIcon (the round
   *  avatar on the right of the row). When unset, the system falls back
   *  to the default app icon. */
  icon?: string
}

export interface FcmSendResult {
  success: number
  failed: number
  /** Tokens FCM rejected as unregistered/invalid — caller should
   *  delete these from native_push_subscriptions. */
  invalidTokens: string[]
}

export async function sendPushToFcmTokens(
  tokens: string[],
  payload: FcmPayload,
): Promise<FcmSendResult> {
  if (tokens.length === 0) return { success: 0, failed: 0, invalidTokens: [] }

  const messaging = admin.messaging(getApp())
  // Per-platform payload:
  //
  // - ANDROID gets a data-only message (no top-level `notification`).
  //   This forces every message through PadelMessagingService.onMessage-
  //   Received, where we download `icon` and set it as the round
  //   largeIcon on the right of the notification row. With a top-level
  //   `notification` field, FCM auto-displays for background apps via
  //   the system path and skips our service — losing the custom icon.
  //
  // - iOS uses the `apns.payload.aps.alert` block to display. iOS does
  //   NOT display data-only messages — the WebView app has no
  //   Notification Service Extension to intercept silent pushes, so
  //   they arrive but are never rendered. Pre-fix (2026-05-17) Lia's
  //   TestFlight build received `fcm_sent: 1` events with zero visible
  //   notifications. Adding the `apns.alert` block makes iOS render
  //   the banner via the standard APNs alert path while still leaving
  //   the `data` block intact for any client-side handling (deep
  //   link routing on tap, etc.).
  //
  // The cost is that we lose the custom-largeIcon feature on iOS —
  // iOS just shows the app icon for now. Acceptable. The Android
  // largeIcon-via-PadelMessagingService path keeps working unchanged.
  const result = await messaging.sendEachForMulticast({
    tokens,
    data: {
      title: payload.title,
      body: payload.body,
      url: payload.url || '/',
      tag: payload.tag || 'match-live',
      ...(payload.icon ? { icon: payload.icon } : {}),
    },
    android: {
      priority: 'high',
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: {
        aps: {
          alert: {
            title: payload.title,
            body: payload.body,
          },
          sound: 'default',
          // Group notifications by tag so multiple match updates collapse
          // into a single thread on the lock screen — matches Android's
          // `tag`-based replacement behaviour.
          'thread-id': payload.tag || 'match-live',
        },
      },
      ...(payload.icon ? { fcmOptions: { imageUrl: payload.icon } } : {}),
    },
  })

  const invalid: string[] = []
  result.responses.forEach((r, i) => {
    if (!r.success && r.error) {
      const code = r.error.code
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        invalid.push(tokens[i])
      }
    }
  })

  return {
    success: result.successCount,
    failed: result.failureCount,
    invalidTokens: invalid,
  }
}
