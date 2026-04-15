import { getUserOrFail } from '../_auth'

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { action, target_id, metadata } = await req.json()
  if (!action) return Response.json({ error: 'Missing action' }, { status: 400 })

  await supabase!.from('user_activity_log').insert({
    user_id: user!.id,
    action,
    target_id: target_id ?? null,
    metadata: metadata ?? null,
  })

  return Response.json({ ok: true })
}
