// src/lib/nacho-watch/telegram.ts
// Telegram Bot API helpers for NachoWatch health monitor agent.

const TELEGRAM_API = 'https://api.telegram.org/bot'

function botUrl(method: string): string {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN not set')
  return `${TELEGRAM_API}${token}/${method}`
}

/** Send a text message to a Telegram chat */
export async function sendMessage(
  chatId: string | number,
  text: string,
  parseMode: 'Markdown' | 'HTML' | 'MarkdownV2' = 'Markdown'
): Promise<void> {
  const res = await fetch(botUrl('sendMessage'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }),
  })
  if (!res.ok) {
    const err = await res.text()
    console.error('[Telegram] sendMessage failed:', err)
  }
}

/** Send "typing..." indicator to a chat */
export async function sendTypingAction(chatId: string | number): Promise<void> {
  await fetch(botUrl('sendChatAction'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {}) // non-critical, swallow errors
}

/** Verify that an incoming request is from Telegram */
export function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET
  if (!secret) return false
  const header = request.headers.get('x-telegram-bot-api-secret-token')
  return header === secret
}

/** Get the default chat ID for proactive messages (daily reports, alerts) */
export function getDefaultChatId(): string {
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID not set')
  return chatId
}
