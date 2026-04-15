import { getUserOrFail } from '../_auth'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, preferred_country')
    .eq('id', user.id)
    .single()

  return Response.json(data)
}

export async function PATCH(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await req.json()
  const allowed = ['display_name', 'avatar_url', 'preferred_country']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error: dbErr } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select('id, display_name, avatar_url, preferred_country')
    .single()

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json(data)
}
