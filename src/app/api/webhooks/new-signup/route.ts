// src/app/api/webhooks/new-signup/route.ts
// Supabase Database Webhook handler — sends a Telegram notification on new user signup.
// Triggered by INSERT on public.profiles (fired by handle_new_user trigger).

import { createServerClient } from '@/lib/supabase'
import { sendMessage, getDefaultChatId } from '@/lib/nacho-watch/telegram'

interface WebhookPayload {
  type: 'INSERT'
  table: string
  schema: string
  record: {
    id: string
    display_name: string | null
    avatar_url: string | null
    created_at: string
  }
  old_record: null
}

export async function POST(request: Request) {
  // Verify the request is authorized
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload: WebhookPayload = await request.json()

  if (payload.type !== 'INSERT' || payload.table !== 'profiles') {
    return Response.json({ ok: true, skipped: true })
  }

  const { id, display_name, created_at } = payload.record

  // Look up the user's email from auth.users (not stored in profiles)
  const supabase = createServerClient()
  const { data: authUser } = await supabase.auth.admin.getUserById(id)
  const email = authUser?.user?.email ?? 'unknown'
  const provider = authUser?.user?.app_metadata?.provider ?? 'unknown'

  // Count total users for context
  const { count } = await supabase
    .from('profiles')
    .select('*', { count: 'exact', head: true })

  const chatId = getDefaultChatId()

  const message = [
    `🎾 *New signup on PadelNachos!*`,
    ``,
    `👤 *Name:* ${escapeMarkdown(display_name || 'Anonymous')}`,
    `📧 *Email:* ${escapeMarkdown(email)}`,
    `🔑 *Provider:* ${provider}`,
    `📅 *Time:* ${new Date(created_at).toLocaleString('en-GB', { timeZone: 'UTC' })}`,
    `👥 *Total users:* ${count ?? '?'}`,
  ].join('\n')

  await sendMessage(chatId, message)

  return Response.json({ ok: true, userId: id })
}

/** Escape special Markdown characters for Telegram */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}
