// apps/ops/src/app/api/internal/coaches/suggestions/[id]/reject/route.ts
// POST → mark a merge suggestion "not the same person". Permanent: never re-suggested.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { isUuid } from '@/lib/coaches'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const { data, error } = await serviceClient()
    .from('coach_merge_suggestions')
    .update({ status: 'rejected', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'no pending suggestion with that id' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
