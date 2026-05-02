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
  const result = await messaging.sendEachForMulticast({
    tokens,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: {
      url: payload.url || '/',
      tag: payload.tag || 'match-live',
    },
    android: {
      priority: 'high',
      notification: {
        channelId: 'padel_default',
        sound: 'default',
        tag: payload.tag,
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
