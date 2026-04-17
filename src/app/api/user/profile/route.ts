import { getUserOrFail } from '../_auth'

const SELECT_COLUMNS = 'id, display_name, avatar_url, preferred_country, marketing_opt_in'
const ALLOWED_KEYS = ['display_name', 'avatar_url', 'preferred_country', 'marketing_opt_in']

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data } = await supabase
    .from('profiles')
    .select(SELECT_COLUMNS)
    .eq('id', user.id)
    .single()

  return Response.json(data)
}

export async function PATCH(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (key in body) updates[key] = body[key]
  }

  const { data, error: dbErr } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', user.id)
    .select(SELECT_COLUMNS)
    .single()

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json(data)
}
