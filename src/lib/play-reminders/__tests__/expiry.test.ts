import { afterEach, it, vi, expect } from 'vitest'
const m = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('firebase-admin', () => ({
  default: { apps: [{}], messaging: () => ({ sendEachForMulticast: m.send }) },
}))
import { sendPushToFcmTokens } from '@/lib/push-fcm'
afterEach(() => {
  vi.useRealTimers()
})
it('expires Android and iOS reminders together without altering normal push defaults', async () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T08:00:00Z'))
  m.send.mockResolvedValue({
    successCount: 1,
    failureCount: 0,
    responses: [{ success: true }],
  })
  await sendPushToFcmTokens(['token'], {
    title: 'Padel',
    body: 'Starts soon',
    ttlSeconds: 600,
  })
  expect(m.send.mock.calls[0][0]).toMatchObject({
    android: { ttl: 600000 },
    apns: { headers: { 'apns-expiration': String(Date.now() / 1000 + 600) } },
  })
  await sendPushToFcmTokens(['token'], { title: 'Result', body: 'Finished' })
  expect(m.send.mock.calls[1][0].android).not.toHaveProperty('ttl')
  expect(m.send.mock.calls[1][0].apns.headers).not.toHaveProperty(
    'apns-expiration'
  )
})
