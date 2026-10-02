// apps/ops/src/app/api/internal/coaches/suggestions/[id]/reject/route.ts
// POST → mark a merge suggestion "not the same person". Permanent: never re-suggested.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const { error } = await serviceClient()
    .from('coach_merge_suggestions')
    .update({ status: 'rejected', decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
