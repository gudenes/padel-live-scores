// apps/ops/src/app/api/internal/coaches/suggestions/route.ts
// GET pending merge suggestions (sorted by combined points) + pending player-link suggestions.
// Suggestions involving a merged coach are dropped (stale until the next suggester run).
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { sortByImpact, type CoachStatsRow } from '@/lib/coaches'

const LIMIT = 100

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()

  const { data: merges, error } = await supabase
    .from('coach_merge_suggestions')
    .select('id, coach_a, coach_b, score, reason')
    .eq('status', 'pending')
    .limit(2000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = [...new Set((merges ?? []).flatMap((m) => [m.coach_a, m.coach_b]))]
  const stats = new Map<string, CoachStatsRow>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('coach_stats').select('*').in('coach_id', ids.slice(i, i + 200))
    for (const s of (data ?? []) as CoachStatsRow[]) stats.set(s.coach_id, s)
  }
  const aliasRows: { coach_id: string; example_raw: string }[] = []
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('coach_aliases').select('coach_id, example_raw').in('coach_id', ids.slice(i, i + 200))
    aliasRows.push(...(data ?? []))
  }
  const variants = new Map<string, string[]>()
  for (const a of aliasRows) variants.set(a.coach_id, [...(variants.get(a.coach_id) ?? []), a.example_raw])

  const side = (id: string) => ({
    ...(stats.get(id) ?? { coach_id: id, display_name: '?', total_points: 0, player_count: 0 }),
    variants: variants.get(id) ?? [],
  })
  // Only suggestions where both coaches are live (present in coach_stats).
  const live = (merges ?? []).filter((m) => stats.has(m.coach_a) && stats.has(m.coach_b))
  const mergeRows = sortByImpact(
    live.map((m) => ({ id: m.id, score: Number(m.score), reason: m.reason, a: side(m.coach_a), b: side(m.coach_b) })),
  ).slice(0, LIMIT)

  const { data: linkData } = await supabase
    .from('coach_player_link_suggestions')
    .select('coach_id, player_id, coach:coaches(id, display_name, status), player:players(id, name, country, tier, ranking, category)')
    .eq('status', 'pending')
    .limit(500)
  const links = ((linkData ?? []) as unknown as { coach: { status: string } | { status: string }[] | null }[])
    .filter((l) => {
      const c = Array.isArray(l.coach) ? l.coach[0] : l.coach
      return c && c.status !== 'merged'
    })
    .slice(0, LIMIT)

  return NextResponse.json({ merges: mergeRows, mergeTotal: live.length, links })
}
