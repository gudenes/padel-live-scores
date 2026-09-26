import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBetaConfirmationEmail, sendBetaConfirmationEmail } from '../beta-confirmation'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('resend', () => ({ Resend: class { emails = { send } } }))
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 'test-key')
  vi.stubEnv('AUTH_EMAIL_FROM', 'PadelNachos <hello@padelnachos.com>')
  send.mockReset()
  send.mockResolvedValue({ data: { id: 'test-email-id' }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe('beta confirmation email', () => {
  it.each([
    ['en', 'October 10', '15-minute', 'one year of Pro'],
    ['es', '10 de octubre', '15 minutos', 'un año de Pro'],
    ['pt', '10 de outubro', '15 minutos', 'um ano de Pro'],
  ])('renders complete HTML and text for %s', (language, date, interview, reward) => {
    const message = buildBetaConfirmationEmail(language)
    expect(message.locale).toBe(language)
    expect(message.html).toContain(`lang="${language}"`)
    for (const expected of [date, interview, reward]) {
      expect(message.text).toContain(expected)
      expect(message.html).toContain(expected)
    }
    expect(message.html).toContain('https://padelnachos.com/padelnachos-logo-v2.png')
  })
  it('falls back to English for an unsupported locale', () => {
    expect(buildBetaConfirmationEmail('fr').locale).toBe('en')
  })
  it('uses the configured sender, normalized address, and stable idempotency key', async () => {
    await sendBetaConfirmationEmail(' FAN@example.com ', 'es')
    await sendBetaConfirmationEmail('fan@example.com', 'es')
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1])
    expect(send.mock.calls[0][0]).toMatchObject({
      from: 'PadelNachos <hello@padelnachos.com>', to: 'fan@example.com',
      subject: buildBetaConfirmationEmail('es').subject,
      tags: [{ name: 'campaign', value: 'prediction-beta' }, { name: 'language', value: 'es' }],
    })
    expect(send.mock.calls[0][1].idempotencyKey).toMatch(/^prediction-beta-confirmation-[a-f0-9]{64}$/)
  })
  it('detects provider errors returned without throwing', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'rejected' } })
    await expect(sendBetaConfirmationEmail('fan@example.com', 'pt')).rejects.toThrow('email_send_failed')
  })
  it('detects missing configuration', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    await expect(sendBetaConfirmationEmail('fan@example.com', 'en')).rejects.toThrow('email_not_configured')
    expect(send).not.toHaveBeenCalled()
  })
})
