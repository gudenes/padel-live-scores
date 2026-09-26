import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../route'
import { BETA_SIGNUPS_CLOSE_AT, betaTimeRemaining } from '@/lib/beta-schedule'

const { insert, sendEmail } = vi.hoisted(() => ({ insert: vi.fn(), sendEmail: vi.fn() }))
vi.mock('@/lib/email/beta-confirmation', () => ({ sendBetaConfirmationEmail: sendEmail }))
vi.mock('@/lib/supabase', () => ({
  createServiceClient: () => ({ from: () => ({ insert }) }),
}))

const valid = {
  name: ' Padel Fan ', email: ' FAN@example.com ', language: 'es', locale: 'en',
  commitment: true, contactConsent: true, website: '',
}
function send(body: unknown, origin = 'https://example.com') {
  return POST(new Request('https://example.com/api/beta/signup', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
}

afterEach(() => vi.useRealTimers())
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-25T09:43:57Z')); sendEmail.mockReset(); sendEmail.mockResolvedValue(undefined); insert.mockReset(); insert.mockResolvedValue({ error: null }) })

describe('beta signup', () => {
  it('closes at the fixed deadline without saving a signup', async () => {
    vi.setSystemTime(new Date(BETA_SIGNUPS_CLOSE_AT))
    expect((await send(valid)).status).toBe(410)
    expect(insert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it('accepts signups immediately before the deadline', async () => {
    vi.setSystemTime(new Date(Date.parse(BETA_SIGNUPS_CLOSE_AT) - 1))
    expect((await send(valid)).status).toBe(200)
  })
  it('counts down seven days and clamps expired values to zero', () => {
    expect(betaTimeRemaining(Date.now())).toEqual({ days: 7, hours: 0, minutes: 0, seconds: 0 })
    expect(betaTimeRemaining(Date.parse(BETA_SIGNUPS_CLOSE_AT) + 1000)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 })
  })
  it('saves normalized details, interview language and consent', async () => {
    expect((await send(valid)).status).toBe(200)
    expect(insert).toHaveBeenCalledWith({
      name: 'Padel Fan', email: 'fan@example.com', language: 'es', locale: 'en',
      commitment: true, contact_consent: true, consent_version: '2026-09-25',
    })
  })
  it.each([null, [], { ...valid, name: 12 }, { ...valid, name: ' ' },
    { ...valid, name: 'x'.repeat(81) }, { ...valid, email: 'not-an-email' },
    { ...valid, language: 'fr' }, { ...valid, language: ['en'] }, { ...valid, locale: 'it' },
    { ...valid, commitment: false }, { ...valid, contactConsent: 'true' },
  ])('rejects malformed or unconsented submissions: %j', async body => {
    expect((await send(body)).status).toBe(400)
    expect(insert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it('accepts the public origin behind Railway’s internal host', async () => {
    const response = await POST(new Request('http://localhost:3000/api/beta/signup', {
      method: 'POST', headers: { origin: 'https://padelnachos.com', 'Content-Type': 'application/json' },
      body: JSON.stringify(valid),
    }))
    expect(response.status).toBe(200)
    expect(insert).toHaveBeenCalledOnce()
  })
  it('confirms new signups in the preferred interview language', async () => {
    expect((await send(valid)).status).toBe(200)
    expect(sendEmail).toHaveBeenCalledExactlyOnceWith('fan@example.com', 'es')
  })
  it('keeps the signup successful if email delivery fails', async () => {
    sendEmail.mockRejectedValue(new Error('offline'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await send(valid)).status).toBe(200)
    expect(insert).toHaveBeenCalledOnce()
    log.mockRestore()
  })
  it('rejects cross-origin requests', async () => {
    expect((await send(valid, 'https://another.example')).status).toBe(403)
    expect(insert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it('discards honeypot submissions', async () => {
    expect((await send({ ...valid, website: 'spam.example' })).status).toBe(200)
    expect(insert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it('does not overwrite or disclose an existing signup', async () => {
    insert.mockResolvedValue({ error: { code: '23505' } })
    expect(await (await send(valid)).json()).toEqual({ ok: true })
    expect(sendEmail).not.toHaveBeenCalled()
  })
  it('returns a retryable failure when storage is unavailable', async () => {
    insert.mockRejectedValue(new Error('offline'))
    expect((await send(valid)).status).toBe(503)
  })
  it('rejects invalid JSON', async () => {
    const response = await POST(new Request('https://example.com/api/beta/signup', { method: 'POST', body: '{' }))
    expect(response.status).toBe(400)
  })
  it('rejects oversized submissions', async () => {
    expect((await send({ ...valid, name: 'x'.repeat(4096) })).status).toBe(413)
    expect(insert).not.toHaveBeenCalled()
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
