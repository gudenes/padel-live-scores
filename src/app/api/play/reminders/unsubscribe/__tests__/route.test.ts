import { it, vi, expect, beforeEach } from 'vitest'
const m = vi.hoisted(() => ({ update: vi.fn(), eq: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({ from: () => ({ update: m.update }) }),
}))
import { GET, POST } from '../route'
const token = '00000000-0000-4000-8000-000000000001',
  url = `https://padelnachos.com/api/play/reminders/unsubscribe?token=${token}&locale=es`
beforeEach(() => {
  vi.clearAllMocks()
  m.update.mockReturnValue({ eq: m.eq })
  m.eq.mockResolvedValue({ error: null })
})
it('mail scanners GET the confirmation without changing preferences', async () => {
  const r = await GET(new Request(url))
  expect(r.status).toBe(200)
  expect(await r.text()).toContain('Desactivar')
  expect(m.update).not.toHaveBeenCalled()
})
it('one-click POST only disables email and preserves push preferences', async () => {
  const r = await POST(
    new Request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })
  )
  expect(r.status).toBe(200)
  expect(m.update).toHaveBeenCalledWith(
    expect.objectContaining({ email_enabled: false })
  )
  expect(m.update.mock.calls[0][0]).not.toHaveProperty('push_enabled')
  expect(m.eq).toHaveBeenCalledWith('unsubscribe_token', token)
})
it('invalid tokens never reach the database', async () => {
  expect(
    (
      await POST(
        new Request(
          'https://padelnachos.com/api/play/reminders/unsubscribe?token=no',
          { method: 'POST' }
        )
      )
    ).status
  ).toBe(400)
  expect(m.update).not.toHaveBeenCalled()
})
