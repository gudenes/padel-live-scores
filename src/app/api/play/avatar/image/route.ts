import { requirePlayAccess } from '@/lib/play-access'
import { readLocalAvatar } from '@/lib/avatar-local-store'
import { isLocalAvatarRequest } from '@/lib/avatar-generation'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(req: Request) {
  if (!isLocalAvatarRequest(req)) return new Response(null, { status: 404 })
  const access = await requirePlayAccess()
  if (!access) return new Response(null, { status: 404 })
  try {
    const bytes = await readLocalAvatar(access.userId, new URL(req.url).searchParams.get('id') ?? '')
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
  } catch { return new Response(null, { status: 404 }) }
}
