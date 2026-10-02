// apps/ops/src/app/api/internal/coaches/route.ts
// GET coach list from the coach_stats view + KPI counts.
//   ?q=<name> ?status=unreviewed|verified|junk|all (default: all except junk) ?page=1
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const PER_PAGE = 50

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const status = url.searchParams.get('status') ?? 'active'
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
  const from = (page - 1) * PER_PAGE

  const supabase = serviceClient()
  let query = supabase.from('coach_stats').select('*', { count: 'exact' })
  if (q) query = query.ilike('display_name', `%${q}%`)
  if (status === 'active') query = query.neq('status', 'junk')
  else if (status !== 'all') query = query.eq('status', status)

  const { data, error, count } = await query
    .order('total_points', { ascending: false })
    .order('display_name')
    .range(from, from + PER_PAGE - 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const head = { count: 'exact' as const, head: true }
  const [all, unreviewed, junk, pendingMerges, pendingLinks] = await Promise.all([
    supabase.from('coaches').select('id', head).neq('status', 'merged'),
    supabase.from('coaches').select('id', head).eq('status', 'unreviewed'),
    supabase.from('coaches').select('id', head).eq('status', 'junk'),
    supabase.from('coach_merge_suggestions').select('coach_a, coach_b').eq('status', 'pending').limit(2000),
    supabase
      .from('coach_player_link_suggestions')
      .select('coach_id, coach:coaches(status)')
      .eq('status', 'pending')
      .limit(2000),
  ])

  // Pending = suggestions that are still actionable, i.e. no merged coach involved.
  const mergeRows = pendingMerges.data ?? []
  const ids = [...new Set(mergeRows.flatMap((m) => [m.coach_a, m.coach_b]))]
  const merged = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data: rows } = await supabase
      .from('coaches')
      .select('id')
      .eq('status', 'merged')
      .in('id', ids.slice(i, i + 200))
    for (const r of rows ?? []) merged.add(r.id)
  }
  const pendingMergeCount = mergeRows.filter((m) => !merged.has(m.coach_a) && !merged.has(m.coach_b)).length
  const pendingLinkCount = ((pendingLinks.data ?? []) as unknown as { coach: { status: string } | { status: string }[] | null }[])
    .filter((l) => {
      const c = Array.isArray(l.coach) ? l.coach[0] : l.coach
      return c?.status !== 'merged'
    }).length

  return NextResponse.json({
    coaches: data ?? [],
    total: count ?? 0,
    page,
    per_page: PER_PAGE,
    kpis: {
      total: all.count ?? 0,
      unreviewed: unreviewed.count ?? 0,
      junk: junk.count ?? 0,
      pending: pendingMergeCount + pendingLinkCount,
    },
  })
}
