import { hasSameLocalOrigin } from '../../../../../../../src/lib/local-request-origin'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const id = new URL(req.url).searchParams.get('marketId')
  if (!id || !/^[a-f0-9-]{36}$/i.test(id)) return Response.json({ error: 'Invalid market' }, { status: 400 })
  const { data, error } = await serviceClient().from('markets').select('settlement_revision,status,outcome').eq('id', id).single()
  if (error) return Response.json({ error: 'Settlement is unavailable. Check that its database migration has been applied.' }, { status: 503 })
  return Response.json(data, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return Response.json({ error: 'unauthorized' }, { status: 401 })
  if (!(req.headers.get('origin') === new URL(req.url).origin || (process.env.NODE_ENV === 'development' && hasSameLocalOrigin(req)))) return Response.json({ error: 'Invalid origin' }, { status: 403 })
  const body = await req.json().catch(() => null)
  if (!body || !/^[a-f0-9-]{36}$/i.test(body.marketId ?? '') || !['yes', 'no', 'void'].includes(body.outcome)
    || typeof body.reason !== 'string' || body.reason.trim().length < 10 || body.reason.length > 1000
    || !Number.isInteger(body.revision) || body.revision < 0) {
    return Response.json({ error: 'Choose an outcome and provide a reason of at least 10 characters.' }, { status: 400 })
  }
  const db = serviceClient()
  const current = await db.from('markets').select('status').eq('id', body.marketId).single()
  if (current.error || !['locked', 'proposed', 'held', 'settled', 'void'].includes(current.data?.status ?? '')) {
    return Response.json({ error: 'Only closed markets can be settled or corrected.' }, { status: 409 })
  }
  const { data, error } = await db.rpc('play_settle_market', {
    p_market_id: body.marketId, p_outcome: body.outcome, p_reason: body.reason.trim(),
    p_actor: `operator:${session.user.id}`, p_expected_revision: body.revision,
  })
  if (error) return Response.json({ error: 'Settlement could not be confirmed. Refresh before retrying.' }, { status: 409 })
  return Response.json(data)
}
