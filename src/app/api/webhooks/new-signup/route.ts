// src/app/api/webhooks/new-signup/route.ts
// Supabase Database Webhook handler — sends Telegram and optional Discord notifications on new
// user signup. Triggered by INSERT on public.users (the Auth.js users table),
// fired by the notify_new_signup() trigger in 20260516_signup_tracking_fix.sql.
//
// Trigger payload shape:
//   { type, table, schema, record: { id, email, name, image }, old_record }

import { createServerClient } from '@/lib/supabase'
import { sendMessage, getDefaultChatId } from '@/lib/nacho-watch/telegram'
import { sendDiscordSignup } from '@/lib/discord-signup'

type Record = {
  id?: string
  email?: string | null
  name?: string | null
  image?: string | null
}

type Payload = {
  // Only authenticated diagnostic requests set this; database events omit it.
  test?: boolean
  type?: string
  table?: string
  schema?: string
  record?: Record
}

export async function POST(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    console.error('[new-signup] Unauthorized — auth header mismatch')
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const payload = (await request.json()) as Payload
    if (payload.type !== 'INSERT' || payload.table !== 'users' || payload.schema !== 'public') {
      return Response.json({ ok: true, skipped: true })
    }

    const record = payload.record
    if (!record?.id) {
      console.log('[new-signup] No record.id in payload, skipping')
      return Response.json({ ok: true, skipped: true })
    }

    const supabase = createServerClient()

    // Provider lookup: the Auth.js adapter inserts the accounts row in a
    // separate transaction from users, and pg_net fires the webhook
    // asynchronously, so the row may not be visible on the first try. One
    // short retry covers the typical race window; otherwise we ship the
    // message with provider 'unknown' rather than block the notification.
    let provider = 'unknown'
    for (let attempt = 0; attempt < 2; attempt++) {
      const { data } = await supabase
        .from('accounts')
        .select('provider')
        .eq('userId', record.id)
        .maybeSingle()
      if (data?.provider) {
        provider = data.provider
        break
      }
      if (attempt === 0) await new Promise((r) => setTimeout(r, 500))
    }

    // Count from public.users (canonical) — profiles can lag if the app-side
    // createUser handler ever silently fails again.
    const { count } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })

    const name = record.name || 'Anonymous'
    const email = record.email || 'unknown'
    const time = new Date().toLocaleString('en-GB', { timeZone: 'UTC' })

    const message = [
      ...(payload.test === true ? ['🧪 TEST — no account was created', ''] : []),
      `🎾 New signup on PadelNachos!`,
      ``,
      `👤 Name: ${name}`,
      `📧 Email: ${email}`,
      `🔑 Provider: ${provider}`,
      `📅 Time: ${time}`,
      `👥 Total users: ${count ?? '?'}`,
    ].join('\n')

    // Attempt both destinations even if one fails.
    const results = await Promise.allSettled([
      Promise.resolve().then(() => sendMessage(getDefaultChatId(), message, 'HTML')),
      sendDiscordSignup({ provider, total: count, name: record.name, email: record.email, test: payload.test === true }),
    ])
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length) {
      console.error('[new-signup] Notification delivery failed', failures)
      return Response.json({ error: 'Notification delivery failed' }, { status: 502 })
    }
    return Response.json({ ok: true, userId: record.id })
  } catch (err) {
    console.error('[new-signup] Error:', err)
    return Response.json({ error: 'Internal error' }, { status: 500 })
  }
}
