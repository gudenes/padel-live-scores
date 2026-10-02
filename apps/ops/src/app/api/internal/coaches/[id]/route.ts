// apps/ops/src/app/api/internal/coaches/[id]/route.ts
// GET: coach + aliases + players coached + linked player + pending suggestions.
// PATCH: allow-listed edits (validateCoachPatch). status='merged' only via merge route.
import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'
import { validateCoachPatch, isUuid } from '@/lib/coaches'
import { linkCoachToPlayer } from '@/lib/coach-player-link'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
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

  const failed = [aliases, players, stats, merges, links, linkedPlayer].find((r) => r.error)
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 })

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
  if (!isUuid(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const v = validateCoachPatch(body)
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })

  const supabase = serviceClient()
  // Setting a player goes through the shared helper (also resolves suggestions); apply it after the other fields.
  const { player_id: linkTo, ...rest } = v.update
  const hasLink = 'player_id' in v.update && typeof linkTo === 'string'
  const plain = hasLink ? rest : v.update

  if (Object.keys(plain).length > 0) {
    const { data, error } = await supabase
      .from('coaches')
      .update({ ...plain, updated_at: new Date().toISOString() })
      .eq('id', id)
      .neq('status', 'merged')
      .select('id')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'that player is already linked to another coach' }, { status: 409 })
      if (error.code === '23503') return NextResponse.json({ error: 'player not found' }, { status: 400 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!data) return NextResponse.json({ error: 'Coach not found or already merged' }, { status: 404 })
  }

  if (hasLink) {
    const result = await linkCoachToPlayer(supabase, id, linkTo as string)
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { data: coach, error: readErr } = await supabase.from('coaches').select('*').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!coach) return NextResponse.json({ error: 'Coach not found or already merged' }, { status: 404 })
  return NextResponse.json({ coach })
}
