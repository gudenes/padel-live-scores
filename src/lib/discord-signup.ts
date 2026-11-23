/** Optional server-side signup notifications. Never include account details. */
export async function sendDiscordSignup(provider: string, total: number | null) {
  const webhook = process.env.DISCORD_SIGNUP_WEBHOOK_URL
  if (!webhook) return

  const url = new URL(webhook)
  if (url.protocol !== 'https:' || url.hostname !== 'discord.com'
    || !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[^/]+$/.test(url.pathname)) {
    throw new Error('Invalid DISCORD_SIGNUP_WEBHOOK_URL')
  }
  url.searchParams.set('wait', 'true')
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        content: [
          '🎾 A new user joined PadelNachos!',
          `🔑 Signup method: ${provider.slice(0, 100)}`,
          `👥 Total users: ${total ?? '?'}`,
        ].join('\n'),
        allowed_mentions: { parse: [] },
      }),
    })
  } catch {
    // Do not expose the secret webhook URL in fetch errors or logs.
    throw new Error('Discord signup request failed or timed out')
  }
  if (!response.ok) throw new Error(`Discord signup delivery failed (${response.status})`)
}
