import { requirePlayAccess } from '@/lib/play-access'
import { getActiveSeason } from '../_shared'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const headers = { 'Cache-Control': 'private, no-store' }

/** Small read-only wallet probe for headers outside Play. Never creates a wallet. */
export async function GET() {
  const access = await requirePlayAccess()
  if (!access) return Response.json({ allowed: false }, { headers })
  const season = await getActiveSeason(access.supabase)
  if (!season) return Response.json({ allowed: true, balance: null }, { headers })
  const { data, error } = await access.supabase.from('user_guaca_balance')
    .select('balance').eq('user_id', access.userId).eq('season_id', season.id).maybeSingle()
  if (error) return Response.json({ error: 'wallet_unavailable' }, { status: 503, headers })
  return Response.json({ allowed: true, balance: data?.balance ?? null }, { headers })
}
