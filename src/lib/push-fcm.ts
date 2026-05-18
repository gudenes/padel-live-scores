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
  // Data fields (no top-level `notification` field). Critical for Android:
  // when the `notification` field is present, FCM auto-displays a system
  // notification on background apps WITHOUT invoking our service —
  // which means we can't set largeIcon. Sending data-only forces every
  // message through PadelMessagingService.onMessageReceived, where we
  // download the icon and build the notification ourselves.
  //
  // For iOS we also need an `apns.payload.aps.alert` block — iOS only
  // shows a notification when there's an alert in the apns payload, and
  // `mutable-content: 1` makes iOS run our Notification Service Extension
  // (ios/App/PadelNotificationService/NotificationService.swift) before
  // display. The NSE reads `userInfo["icon"]` (FCM merges data fields
  // into userInfo on iOS), downloads the image, and attaches it as a
  // UNNotificationAttachment — that's how the round avatar appears on
  // the right side of the iOS notification row.
  //
  // Trade-off: requires both app builds to be live. Older Android builds
  // without PadelMessagingService won't display data-only messages.
  // Older iOS builds will still get title+body (apns alert auto-displays)
  // but won't render the image attachment.
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
      payload: {
        aps: {
          alert: {
            title: payload.title,
            body: payload.body,
          },
          mutableContent: true,
          sound: 'default',
        },
      },
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
