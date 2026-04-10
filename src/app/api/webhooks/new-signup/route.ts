// src/app/api/webhooks/new-signup/route.ts
// Supabase Database Webhook handler — sends a Telegram notification on new user signup.
// Triggered by INSERT on public.profiles (fired by handle_new_user trigger).

import { createServerClient } from '@/lib/supabase'
import { sendMessage, getDefaultChatId } from '@/lib/nacho-watch/telegram'

export async function POST(request: Request) {
  // Verify the request is authorized
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[new-signup] Unauthorized — auth header mismatch')
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload: any = await request.json()
    console.log('[new-signup] Received webhook:', JSON.stringify(payload).slice(0, 500))

    const record = payload.record
    if (!record?.id) {
      console.log('[new-signup] No record.id in payload, skipping')
      return Response.json({ ok: true, skipped: true })
    }

    const { id, display_name, created_at } = record

    // Look up the user's email from auth.users (not stored in profiles)
    const supabase = createServerClient()
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(id)
    if (authError) console.error('[new-signup] getUserById error:', authError.message)

    const email = authUser?.user?.email ?? 'unknown'
    const provider = authUser?.user?.app_metadata?.provider ?? 'unknown'

    // Count total users for context
    const { count } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })

    const chatId = getDefaultChatId()

    const name = display_name || 'Anonymous'
    const time = created_at
      ? new Date(created_at).toLocaleString('en-GB', { timeZone: 'UTC' })
      : 'just now'

    const message = [
      `🎾 New signup on PadelNachos!`,
      ``,
      `👤 Name: ${name}`,
      `📧 Email: ${email}`,
      `🔑 Provider: ${provider}`,
      `📅 Time: ${time}`,
      `👥 Total users: ${count ?? '?'}`,
    ].join('\n')

    await sendMessage(chatId, message, 'HTML')

    console.log('[new-signup] Telegram message sent for user', id)
    return Response.json({ ok: true, userId: id })
  } catch (err) {
    console.error('[new-signup] Error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
