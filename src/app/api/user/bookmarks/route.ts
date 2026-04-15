import { getUserOrFail } from '../_auth'

export async function GET() {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { data } = await supabase
    .from('user_bookmarks')
    .select('bookmark_type, target_id')
    .eq('user_id', user.id)

  return Response.json(data ?? [])
}

export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { bookmark_type, target_id } = await req.json()
  if (!bookmark_type || !target_id) {
    return Response.json({ error: 'Missing bookmark_type or target_id' }, { status: 400 })
  }

  const { error: dbErr } = await supabase
    .from('user_bookmarks')
    .upsert(
      { user_id: user.id, bookmark_type, target_id },
      { onConflict: 'user_id,bookmark_type,target_id' }
    )

  if (dbErr) return Response.json({ error: dbErr.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error

  const { bookmark_type, target_id } = await req.json()
  if (!bookmark_type || !target_id) {
    return Response.json({ error: 'Missing bookmark_type or target_id' }, { status: 400 })
  }

  await supabase
    .from('user_bookmarks')
    .delete()
    .eq('user_id', user.id)
    .eq('bookmark_type', bookmark_type)
    .eq('target_id', target_id)

  return Response.json({ ok: true })
}
