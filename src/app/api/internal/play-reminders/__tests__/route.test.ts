import { beforeEach, afterEach, it, vi, expect } from 'vitest'
const m = vi.hoisted(() => ({
  run: vi.fn(),
  create: vi.fn(),
  web: vi.fn(),
  native: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ createServiceClient: m.create }))
vi.mock('@/lib/play-reminders/run', () => ({
  runPlayReminders: m.run,
  productionEmail: vi.fn(),
  pushContent: () => ({
    title: 'Before first serve',
    body: 'Make your picks',
    url: '/play',
    tag: 'reminder',
    icon: 'https://padelnachos.com/photo.png',
  }),
}))
vi.mock('@/lib/push', () => ({ sendPush: m.web }))
vi.mock('@/lib/push-fcm', () => ({ sendPushToFcmTokens: m.native }))
import { POST } from '../route'
const req = (auth = 'Bearer test', body: unknown = {}) =>
  new Request('https://padelnachos.com/api/internal/play-reminders', {
    method: 'POST',
    headers: { authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRON_SECRET', 'test')
  vi.stubEnv('PLAY_REMINDERS_MODE', 'off')
  m.create.mockReturnValue({
    from: (table: string) => ({
      select: () => ({
        eq: async () => ({
          data:
            table === 'push_subscriptions'
              ? [{ endpoint: 'endpoint', keys: { p256dh: 'x', auth: 'y' } }]
              : [{ device_token: 'token' }],
          error: null,
        }),
      }),
    }),
  })
  m.run.mockResolvedValue({ planned: 0, failed: 0 })
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
it('rejects missing or invalid internal credentials before constructing a client', async () => {
  expect((await POST(req('Bearer wrong'))).status).toBe(401)
  vi.stubEnv('CRON_SECRET', '')
  expect((await POST(req('Bearer undefined'))).status).toBe(401)
  expect(m.create).not.toHaveBeenCalled()
})
it('defaults off and cannot send accidentally', async () => {
  expect(await (await POST(req())).json()).toEqual({ enabled: false })
  expect(m.run).not.toHaveBeenCalled()
})
it('dry-run mode cannot be overridden by the request', async () => {
  vi.stubEnv('PLAY_REMINDERS_MODE', 'dry-run')
  expect((await POST(req('Bearer test', { dryRun: false }))).status).toBe(200)
  expect(m.run).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
    dryRun: true,
  })
})
it('applies a match expiry and player image to both mobile transports', async () => {
  vi.stubEnv('PLAY_REMINDERS_MODE', 'live')
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-07T08:00:00Z'))
  m.web.mockResolvedValue(true)
  m.native.mockResolvedValue({ success: 1, invalidTokens: [] })
  m.run.mockImplementation(async (_db, transport) => {
    expect(
      await transport.push(
        'user',
        {
          matches: [
            {
              startsAt: '2026-10-07T08:25:00Z',
              locksAt: '2026-10-07T08:10:00Z',
            },
          ],
        },
        'delivery'
      )
    ).toBe(true)
    return { failed: 0 }
  })
  expect((await POST(req())).status).toBe(200)
  expect(m.web).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      ttlSeconds: 600,
      icon: 'https://padelnachos.com/photo.png',
    }),
    { ttlSeconds: 600 }
  )
  expect(m.native).toHaveBeenCalledWith(
    ['token'],
    expect.objectContaining({ ttlSeconds: 600 })
  )
})
