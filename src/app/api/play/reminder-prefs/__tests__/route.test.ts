import { beforeEach, it, vi, expect } from 'vitest'
const m = vi.hoisted(() => ({
  access: vi.fn(),
  origin: vi.fn(),
  upsert: vi.fn(),
  read: vi.fn(),
}))
vi.mock('@/lib/play-access', () => ({ requirePlayAccess: m.access }))
vi.mock('@/lib/play-write-origin', () => ({ isTrustedPlayWrite: m.origin }))
import { GET, PATCH } from '../route'
const req = (b: unknown) =>
  new Request('https://padelnachos.com/api/play/reminder-prefs', {
    method: 'PATCH',
    body: JSON.stringify(b),
  })
beforeEach(() => {
  vi.clearAllMocks()
  m.access.mockResolvedValue({
    userId: 'current-user',
    supabase: {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: m.read }) }),
        upsert: m.upsert,
      }),
    },
  })
  m.origin.mockReturnValue(true)
  m.read.mockResolvedValue({ data: null, error: null })
  m.upsert.mockResolvedValue({ error: null })
})
it('requires Play access on reads and writes', async () => {
  m.access.mockResolvedValue(null)
  expect((await GET()).status).toBe(404)
  expect((await PATCH(req({}))).status).toBe(404)
  expect(m.upsert).not.toHaveBeenCalled()
})
it('starts with both reminders off; no inferred email consent', async () =>
  expect(await (await GET()).json()).toEqual({
    email_enabled: false,
    push_enabled: false,
    timezone: null,
  }))
it('rejects cross-origin writes and invalid zones', async () => {
  m.origin.mockReturnValue(false)
  expect((await PATCH(req({}))).status).toBe(403)
  m.origin.mockReturnValue(true)
  expect(
    (
      await PATCH(
        req({ email_enabled: true, push_enabled: false, timezone: 'Mars/City' })
      )
    ).status
  ).toBe(400)
  expect(m.upsert).not.toHaveBeenCalled()
})
it('saves explicit preferences for the current user only', async () => {
  expect(
    (
      await PATCH(
        req({
          user_id: 'someone-else',
          email_enabled: true,
          push_enabled: false,
          timezone: 'Europe/Madrid',
        })
      )
    ).status
  ).toBe(200)
  expect(m.upsert).toHaveBeenCalledWith(
    expect.objectContaining({
      user_id: 'current-user',
      email_enabled: true,
      push_enabled: false,
      timezone: 'Europe/Madrid',
    }),
    { onConflict: 'user_id' }
  )
})
