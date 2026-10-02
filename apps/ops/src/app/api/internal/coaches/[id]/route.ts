// apps/ops/src/app/api/internal/coaches/[id]/route.ts
// GET: coach + aliases + players coached + linked player + pending suggestions.
// PATCH: allow-listed edits (validateCoachPatch). status='merged' only via merge route.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { validateCoachPatch } from '@/lib/coaches'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  const supabase = serviceClient()

  const { data: coach, error } = await supabase.from('coaches').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!coach) return NextResponse.json({ error: 'Coach not found' }, { status: 404 })

  const [aliases, players, stats, merges, links, linkedPlayer] = await Promise.all([
    supabase.from('coach_aliases').select('normalized_alias, example_raw, source').eq('coach_id', id).order('normalized_alias'),
    supabase
      .from('player_coaches')
      .select('raw_name, position, player:players(id, name, display_name, category, ranking, points, tier, country)')
      .eq('coach_id', id),
    supabase.from('coach_stats').select('*').eq('coach_id', id).maybeSingle(),
    supabase
      .from('coach_merge_suggestions')
      .select('id, score, reason, a:coaches!coach_merge_suggestions_coach_a_fkey(id, display_name), b:coaches!coach_merge_suggestions_coach_b_fkey(id, display_name)')
      .eq('status', 'pending')
      .or(`coach_a.eq.${id},coach_b.eq.${id}`),
    supabase
      .from('coach_player_link_suggestions')
      .select('player:players(id, name, country, tier, ranking)')
      .eq('coach_id', id)
      .eq('status', 'pending'),
    coach.player_id
      ? supabase.from('players').select('id, name, display_name, country, ranking, tier').eq('id', coach.player_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  return NextResponse.json({
    coach,
    stats: stats.data,
    aliases: aliases.data ?? [],
    players: players.data ?? [],
    mergeSuggestions: merges.data ?? [],
    linkSuggestions: links.data ?? [],
    linkedPlayer: linkedPlayer.data,
  })
}

export async function PATCH(request: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const v = validateCoachPatch(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const supabase = serviceClient()
  const { data, error } = await supabase
    .from('coaches')
    .update({ ...v.update, updated_at: new Date().toISOString() })
    .eq('id', id)
    .neq('status', 'merged')
    .select('*')
    .maybeSingle()
  if (error) {
    // 23505 = unique violation on coaches_player_id_unique
    const status = error.code === '23505' ? 409 : 500
    const message = error.code === '23505' ? 'that player is already linked to another coach' : error.message
    return NextResponse.json({ error: message }, { status })
  }
  if (!data) return NextResponse.json({ error: 'Coach not found or already merged' }, { status: 404 })

  // Linking a player resolves any pending link suggestions for this coach.
  if ('player_id' in v.update && v.update.player_id) {
    await supabase
      .from('coach_player_link_suggestions')
      .update({ status: 'rejected', decided_at: new Date().toISOString() })
      .eq('coach_id', id)
      .eq('status', 'pending')
      .neq('player_id', v.update.player_id)
    await supabase
      .from('coach_player_link_suggestions')
      .update({ status: 'linked', decided_at: new Date().toISOString() })
      .eq('coach_id', id)
      .eq('player_id', v.update.player_id)
  }
  return NextResponse.json({ coach: data })
}
