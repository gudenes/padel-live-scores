// src/app/api/user/marketing-prefs/route.ts
// PATCH — updates profiles.marketing_opt_in for the authenticated user.

import { getUserOrFail } from '../_auth'

export async function PATCH(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid optIn' }, { status: 400 })
  }

  const optIn = (body as { optIn?: unknown })?.optIn
  if (typeof optIn !== 'boolean') {
    return Response.json({ error: 'Invalid optIn' }, { status: 400 })
  }

  const { data, error: dbErr } = await supabase
    .from('profiles')
    .update({ marketing_opt_in: optIn })
    .eq('id', user.id)
    .select('marketing_opt_in')
    .single()

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })

  return Response.json({ ok: true, marketing_opt_in: data.marketing_opt_in })
}
