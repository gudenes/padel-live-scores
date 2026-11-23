import { afterEach, expect, it, vi } from 'vitest'
import { formatDiscordSignup, sendDiscordSignup } from '../discord-signup'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('does nothing until Discord is configured', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', '')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await sendDiscordSignup({ provider: 'google', total: 42 })
  expect(fetch).not.toHaveBeenCalled()
})

it('requests confirmed delivery and disables mentions', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', 'https://discord.com/api/webhooks/123/secret')
  const fetch = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  await sendDiscordSignup({ provider: 'google', total: 42, name: '@everyone', email: 'maria@example.com' })
  const [url, options] = fetch.mock.calls[0]
  expect(url.searchParams.get('wait')).toBe('true')
  expect(JSON.parse(options.body)).toEqual({
    content: '🎾 A new user joined PadelNachos!\n👤 Name: @everyone\n📧 Email: maria@example.com\n🔑 Signup method: Google\n👥 Total users: 42',
    allowed_mentions: { parse: [] },
  })
})

it('reports rejected delivery', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', 'https://discord.com/api/webhooks/123/secret')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
  await expect(sendDiscordSignup({ provider: 'google', total: null })).rejects.toThrow('(429)')
})

it('does not leak the webhook secret in network errors', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', 'https://discord.com/api/webhooks/123/secret')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('https://discord.com/api/webhooks/123/secret')))
  await expect(sendDiscordSignup({ provider: 'google', total: null })).rejects.toThrow('Discord signup request failed or timed out')
})

it('rejects invite URLs without making a request', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', 'https://discord.gg/5k7JPc8DV')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(sendDiscordSignup({ provider: 'google', total: null })).rejects.toThrow('Invalid DISCORD_SIGNUP_WEBHOOK_URL')
  expect(fetch).not.toHaveBeenCalled()
})


it('distinguishes tests from real signups and handles missing information', () => {
  const real = formatDiscordSignup({ provider: 'unknown', total: 189, name: '  ', email: null })
  expect(real).not.toContain('TEST')
  expect(real).toContain('Name: Not provided')
  expect(real).toContain('Email: Not available')
  expect(real).toContain('Signup method: Not available')
  expect(formatDiscordSignup({ provider: 'unknown', total: 189, test: true }))
    .toMatch(/^🧪 TEST — no account was created/)
})

it('keeps untrusted names on one line and escapes formatting', () => {
  const message = formatDiscordSignup({ provider: 'apple', total: 0, name: '**Admin**\nFake: value', email: 'a@example.com' })
  expect(message.split('\n')).toHaveLength(5)
  expect(message).toContain(String.raw`Name: \*\*Admin\*\* Fake: value`)
  expect(message).toContain('Signup method: Apple')
  expect(message).toContain('Total users: 0')
})
