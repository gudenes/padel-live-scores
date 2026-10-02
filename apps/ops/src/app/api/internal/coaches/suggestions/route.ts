// apps/ops/src/app/api/internal/coaches/suggestions/route.ts
// GET the top pending merge suggestions (ranked by combined pro points) + pending player-link suggestions.
// Reads the coach_merge_queue / coach_link_queue views, which already drop merged/junk coaches.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

const LIMIT = 100

interface MergeQueueRow {
  id: string
  score: number | string
  reason: string
  coach_a: string
  coach_b: string
  a_name: string
  b_name: string
  a_points: number | string
  b_points: number | string
  a_players: number
  b_players: number
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = serviceClient()

  const { data: merges, error, count: mergeTotal } = await supabase
    .from('coach_merge_queue')
    .select('*', { count: 'exact' })
    .order('impact', { ascending: false })
    .limit(LIMIT)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (merges ?? []) as MergeQueueRow[]

  const ids = [...new Set(rows.flatMap((m) => [m.coach_a, m.coach_b]))]
  const variants = new Map<string, string[]>()
  if (ids.length > 0) {
    const { data: aliases, error: aliasErr } = await supabase
      .from('coach_aliases')
      .select('coach_id, example_raw')
      .in('coach_id', ids)
    if (aliasErr) return NextResponse.json({ error: aliasErr.message }, { status: 500 })
    for (const a of aliases ?? []) variants.set(a.coach_id, [...(variants.get(a.coach_id) ?? []), a.example_raw])
  }

  const { data: links, error: linkErr, count: linkTotal } = await supabase
    .from('coach_link_queue')
    .select('*', { count: 'exact' })
    .limit(LIMIT)
  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 })

  return NextResponse.json({
    merges: rows.map((m) => ({
      id: m.id,
      score: Number(m.score),
      reason: m.reason,
      a: {
        coach_id: m.coach_a,
        display_name: m.a_name,
        total_points: Number(m.a_points),
        player_count: m.a_players,
        variants: variants.get(m.coach_a) ?? [],
      },
      b: {
        coach_id: m.coach_b,
        display_name: m.b_name,
        total_points: Number(m.b_points),
        player_count: m.b_players,
        variants: variants.get(m.coach_b) ?? [],
      },
    })),
    mergeTotal: mergeTotal ?? rows.length,
    links: links ?? [],
    linkTotal: linkTotal ?? (links ?? []).length,
  })
}
