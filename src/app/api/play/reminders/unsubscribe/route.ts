import { createServiceClient } from '@/lib/supabase'
import { reminderCopy, reminderLocale } from '@/lib/play-reminders/copy'
import { escapeHtml } from '@/lib/play-reminders/email'
export const dynamic = 'force-dynamic'
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
// GET is a confirmation only: mail scanners must never unsubscribe a user.
export async function GET(req: Request) {
  const u = new URL(req.url),
    c = reminderCopy[reminderLocale(u.searchParams.get('locale'))],
    token = u.searchParams.get('token') ?? ''
  if (!uuid.test(token)) return new Response('Invalid link', { status: 400 })
  return new Response(
    `<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#111713;color:#f5f1e5;font:16px Arial;padding:40px"><img src="/padelnachos-logo-v2.png" width="120" alt="Padel Nachos"><form method="post"><input type="hidden" name="token" value="${escapeHtml(
      token
    )}"><input type="hidden" name="locale" value="${reminderLocale(
      u.searchParams.get('locale')
    )}"><button style="margin-top:24px;background:#85dc20;color:#101809;border:0;border-bottom:5px solid #416e0d;padding:16px;font-weight:bold">${
      c.confirm
    }</button></form></body></html>`,
    {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    }
  )
}
export async function POST(req: Request) {
  const url = new URL(req.url),
    form = await req.formData().catch(() => null),
    token = url.searchParams.get('token') ?? String(form?.get('token') ?? '')
  if (!uuid.test(token)) return new Response('Invalid link', { status: 400 })
  const r = await createServiceClient()
    .from('play_reminder_preferences')
    .update({ email_enabled: false, updated_at: new Date().toISOString() })
    .eq('unsubscribe_token', token)
  if (r.error) return new Response('Please try again', { status: 503 })
  const c =
    reminderCopy[
      reminderLocale(
        url.searchParams.get('locale') ?? String(form?.get('locale') ?? '')
      )
    ]
  return new Response(c.done, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
