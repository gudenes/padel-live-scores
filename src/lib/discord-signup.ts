type SignupNotification = {
  provider: string
  total: number | null
  name?: string | null
  email?: string | null
  test?: boolean
}

// Keep user-supplied text on one line and prevent Discord Markdown formatting.
function plainText(value: string | null | undefined, fallback: string, limit: number) {
  return (value?.replace(/\s+/g, ' ').trim().slice(0, limit) || fallback)
    .replace(/([\\`*_{}\[\]()<>~|])/g, '\\$1')
}

export function formatDiscordSignup({ provider, total, name, email, test }: SignupNotification) {
  const methods: Record<string, string> = { google: 'Google', apple: 'Apple', resend: 'Email magic link' }
  return [
    ...(test ? ['🧪 TEST — no account was created', ''] : []),
    '🎾 A new user joined PadelNachos!',
    `👤 Name: ${plainText(name, 'Not provided', 100)}`,
    `📧 Email: ${plainText(email, 'Not available', 320)}`,
    `🔑 Signup method: ${Object.hasOwn(methods, provider) ? methods[provider] : 'Not available'}`,
    `👥 Total users: ${total ?? 'Not available'}`,
  ].join('\n')
}

/** Optional server-side notifications for the configured signup channel. */
export async function sendDiscordSignup(signup: SignupNotification) {
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
        content: formatDiscordSignup(signup),
        allowed_mentions: { parse: [] },
      }),
    })
  } catch {
    // Do not expose the secret webhook URL in fetch errors or logs.
    throw new Error('Discord signup request failed or timed out')
  }
  if (!response.ok) throw new Error(`Discord signup delivery failed (${response.status})`)
}
