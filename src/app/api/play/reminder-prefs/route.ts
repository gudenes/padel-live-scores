import { requirePlayAccess } from '@/lib/play-access'
import { isTrustedPlayWrite } from '@/lib/play-write-origin'
import { validTimezone } from '@/lib/play-reminders/plan'
export const dynamic = 'force-dynamic'
const reply = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
export async function GET() {
  const access = await requirePlayAccess()
  if (!access) return reply({ error: 'not_found' }, 404)
  const r = await access.supabase
    .from('play_reminder_preferences')
    .select('email_enabled,push_enabled,timezone')
    .eq('user_id', access.userId)
    .maybeSingle()
  if (r.error) return reply({ error: 'unavailable' }, 503)
  return reply(
    r.data ?? { email_enabled: false, push_enabled: false, timezone: null }
  )
}
export async function PATCH(req: Request) {
  const access = await requirePlayAccess()
  if (!access) return reply({ error: 'not_found' }, 404)
  if (!isTrustedPlayWrite(req)) return reply({ error: 'invalid_origin' }, 403)
  const b = await req.json().catch(() => null)
  if (
    !b ||
    !validTimezone(b.timezone) ||
    typeof b.email_enabled !== 'boolean' ||
    typeof b.push_enabled !== 'boolean'
  )
    return reply({ error: 'invalid_preferences' }, 400)
  const r = await access.supabase.from('play_reminder_preferences').upsert(
    {
      user_id: access.userId,
      email_enabled: b.email_enabled,
      push_enabled: b.push_enabled,
      timezone: b.timezone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  )
  if (r.error) return reply({ error: 'unavailable' }, 503)
  return reply({ ok: true })
}
