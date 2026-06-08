// src/app/api/pro/waitlist/route.ts
// POST → joins the Pro waitlist for the signed-in user. Idempotent (UNIQUE user_id).
import { getUserOrFail } from '../../user/_auth'

export async function POST(request: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await request.json().catch(() => ({})) as { locale?: unknown }
  const locale = typeof body.locale === 'string' ? body.locale : null

  const { error: dbErr } = await supabase
    .from('pro_waitlist')
    .upsert(
      { user_id: user.id, email: user.email ?? null, locale },
      { onConflict: 'user_id' },
    )
  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ ok: true })
}
