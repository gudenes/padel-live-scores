// apps/ops/src/app/api/internal/coaches/route.ts
// GET coach list from the coach_stats view + KPI counts.
//   ?q=<name> ?status=unreviewed|verified|junk|all (default: all except junk) ?page=1
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { escapeLike, normalizeCoachName } from '@/lib/coaches'

const PER_PAGE = 50
const STATUSES = ['active', 'unreviewed', 'verified', 'junk', 'all']

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const status = url.searchParams.get('status') ?? 'active'
  if (!STATUSES.includes(status)) return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const from = (page - 1) * PER_PAGE

  const supabase = serviceClient()
  let query = supabase.from('coach_stats').select('*', { count: 'exact' })
  const nq = normalizeCoachName(q)
  if (nq) query = query.ilike('normalized_name', `%${escapeLike(nq)}%`)
  if (status === 'active') query = query.neq('status', 'junk')
  else if (status !== 'all') query = query.eq('status', status)

  const { data, error, count } = await query
    .order('total_points', { ascending: false })
    .order('display_name')
    .range(from, from + PER_PAGE - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const head = { count: 'exact' as const, head: true }
  const [all, unreviewed, junk, pendingMerges, pendingLinks] = await Promise.all([
    supabase.from('coaches').select('id', head).not('status', 'in', '(junk,merged)'),
    supabase.from('coaches').select('id', head).eq('status', 'unreviewed'),
    supabase.from('coaches').select('id', head).eq('status', 'junk'),
    supabase.from('coach_merge_queue').select('id', head),
    supabase.from('coach_link_queue').select('coach_id', head),
  ])
  const kpiError = [all, unreviewed, junk, pendingMerges, pendingLinks].find((r) => r.error)
  if (kpiError?.error) return NextResponse.json({ error: kpiError.error.message }, { status: 500 })

  return NextResponse.json({
    coaches: data ?? [],
    total: count ?? 0,
    page,
    per_page: PER_PAGE,
    kpis: {
      total: all.count ?? 0,
      unreviewed: unreviewed.count ?? 0,
      junk: junk.count ?? 0,
      pending: (pendingMerges.count ?? 0) + (pendingLinks.count ?? 0),
    },
  })
}
