import { afterEach, expect, it, vi } from 'vitest'
import { sendDiscordSignup } from '../discord-signup'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

it('does nothing until Discord is configured', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', '')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await sendDiscordSignup('google', 42)
  expect(fetch).not.toHaveBeenCalled()
})

it('requests confirmed delivery and disables mentions', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', 'https://discord.com/api/webhooks/123/secret')
  const fetch = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetch)
  await sendDiscordSignup('@everyone', 42)
  const [url, options] = fetch.mock.calls[0]
  expect(url.searchParams.get('wait')).toBe('true')
  expect(JSON.parse(options.body)).toEqual({
    content: '🎾 A new user joined PadelNachos!\n🔑 Signup method: @everyone\n👥 Total users: 42',
    allowed_mentions: { parse: [] },
  })
})

it('reports rejected delivery', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', 'https://discord.com/api/webhooks/123/secret')
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })))
  await expect(sendDiscordSignup('google', null)).rejects.toThrow('(429)')
})

it('does not leak the webhook secret in network errors', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', 'https://discord.com/api/webhooks/123/secret')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('https://discord.com/api/webhooks/123/secret')))
  await expect(sendDiscordSignup('google', null)).rejects.toThrow('Discord signup request failed or timed out')
})

it('rejects invite URLs without making a request', async () => {
  vi.stubEnv('DISCORD_SIGNUP_WEBHOOK_URL', 'https://discord.gg/5k7JPc8DV')
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)
  await expect(sendDiscordSignup('google', null)).rejects.toThrow('Invalid DISCORD_SIGNUP_WEBHOOK_URL')
  expect(fetch).not.toHaveBeenCalled()
})
