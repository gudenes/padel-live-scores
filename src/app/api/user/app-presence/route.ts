import { getUserOrFail } from '../_auth'
import { isTrustedPlayWrite } from '@/lib/play-write-origin'
export const dynamic = 'force-dynamic'
export async function POST(req: Request) {
  const { user, supabase, error } = await getUserOrFail()
  if (error) return error
  if (!isTrustedPlayWrite(req))
    return Response.json({ error: 'invalid_origin' }, { status: 403 })
  // Server time and an atomic per-account throttle, shared across devices/tabs.
  const r = await supabase.rpc('record_app_foreground', { p_user: user.id })
  if (r.error) return Response.json({ error: 'unavailable' }, { status: 503 })
  return Response.json(
    { ok: true },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
}
