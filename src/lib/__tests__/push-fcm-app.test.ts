import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import admin from 'firebase-admin'

// Regression: native-signin initialised the firebase-admin default app first,
// then push-fcm called initializeApp() again and threw
// `Firebase app named "[DEFAULT]" already exists` — failing every app push.

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})
const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'test-project',
  private_key: privateKey,
  client_email: 'test@test-project.iam.gserviceaccount.com',
}

async function freshPushFcm() {
  const { vi } = await import('vitest')
  vi.resetModules()
  return import('../push-fcm')
}

describe('push-fcm getApp', () => {
  beforeEach(() => {
    process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(SERVICE_ACCOUNT)
    process.env.FCM_PROJECT_ID = 'test-project'
  })
  afterEach(async () => {
    await Promise.all(admin.apps.map(a => a?.delete()))
  })

  it('reuses the default app when another route initialised it first', async () => {
    // What /api/auth/native-signin does when it runs before any push.
    const signinApp = admin.initializeApp({
      credential: admin.credential.cert(SERVICE_ACCOUNT as admin.ServiceAccount),
      projectId: 'test-project',
    })
    const { getApp } = await freshPushFcm()
    expect(() => getApp()).not.toThrow()
    expect(getApp()).toBe(signinApp)
  })

  it('initialises the default app when nothing has yet', async () => {
    const { getApp } = await freshPushFcm()
    const app = getApp()
    expect(admin.apps).toHaveLength(1)
    expect(getApp()).toBe(app)
  })
})
