import { getUserOrFail } from '../_auth'

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { endpoint, keys, expirationTime } = await req.json()
  if (!endpoint || !keys) return Response.json({ error: 'Missing endpoint or keys' }, { status: 400 })

  const { error: dbErr } = await supabase
    .from('push_subscriptions')
    .upsert(
      { user_id: user.id, endpoint, keys, expiration_time: expirationTime ?? null },
      { onConflict: 'user_id,endpoint' }
    )

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { endpoint } = await req.json()
  if (!endpoint) return Response.json({ error: 'Missing endpoint' }, { status: 400 })

  await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', user.id)
    .eq('endpoint', endpoint)

  return Response.json({ ok: true })
}
