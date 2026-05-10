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
  // Data-only payload (no `notification` field). Critical: when the
  // `notification` field is present, FCM auto-displays a system
  // notification on background apps WITHOUT invoking our service —
  // which means we can't set largeIcon. Sending data-only forces every
  // message through PadelMessagingService.onMessageReceived, where we
  // download the icon and build the notification ourselves.
  //
  // Trade-off: requires the new app build. Older app versions without
  // PadelMessagingService won't display data-only messages. Acceptable
  // because we control the rollout and the user is the primary tester.
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
