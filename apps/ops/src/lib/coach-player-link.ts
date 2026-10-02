// Shared coach <-> player link/reject logic for PATCH /coaches/[id] and POST /coaches/player-links.
import type { SupabaseClient } from '@supabase/supabase-js'
import { isUuid } from '@/lib/coaches'

export type LinkResult = { ok: true } | { ok: false; status: number; error: string }

const PARTIAL = 'the link itself succeeded, but updating suggestions failed: '

export async function linkCoachToPlayer(
  supabase: SupabaseClient,
  coachId: string,
  playerId: string,
  opts: { onlyIfUnlinked?: boolean } = {},
): Promise<LinkResult> {
  if (!isUuid(playerId)) return { ok: false, status: 400, error: 'invalid id' }
  const now = new Date().toISOString()
  let upd = supabase
    .from('coaches')
    .update({ player_id: playerId, updated_at: now })
    .eq('id', coachId)
    .neq('status', 'merged')
  if (opts.onlyIfUnlinked) upd = upd.or(`player_id.is.null,player_id.eq.${playerId}`)
  const { data, error } = await upd.select('id').maybeSingle()
  if (error) {
    if (error.code === '23505') return { ok: false, status: 409, error: 'that player is already linked to another coach' }
    if (error.code === '23503') return { ok: false, status: 400, error: 'player not found' }
    return { ok: false, status: 500, error: error.message }
  }
  if (!data) {
    if (opts.onlyIfUnlinked) {
      const { data: cur } = await supabase.from('coaches').select('status, player_id').eq('id', coachId).maybeSingle()
      if (cur && cur.status !== 'merged' && cur.player_id && cur.player_id !== playerId) {
        return { ok: false, status: 409, error: 'coach is already linked to a different player' }
      }
    }
    return { ok: false, status: 404, error: 'Coach not found or already merged' }
  }

  const marked = await supabase
    .from('coach_player_link_suggestions')
    .upsert({ coach_id: coachId, player_id: playerId, status: 'linked', decided_at: now }, { onConflict: 'coach_id,player_id' })
  if (marked.error) return { ok: false, status: 500, error: PARTIAL + marked.error.message }

  const otherPlayers = await supabase
    .from('coach_player_link_suggestions')
    .update({ status: 'rejected', decided_at: now })
    .eq('coach_id', coachId)
    .eq('status', 'pending')
    .neq('player_id', playerId)
  if (otherPlayers.error) return { ok: false, status: 500, error: PARTIAL + otherPlayers.error.message }

  const otherCoaches = await supabase
    .from('coach_player_link_suggestions')
    .update({ status: 'rejected', decided_at: now })
    .eq('player_id', playerId)
    .eq('status', 'pending')
    .neq('coach_id', coachId)
  if (otherCoaches.error) return { ok: false, status: 500, error: PARTIAL + otherCoaches.error.message }

  return { ok: true }
}

export async function rejectCoachPlayerLink(
  supabase: SupabaseClient,
  coachId: string,
  playerId: string,
): Promise<LinkResult> {
  const { data, error } = await supabase
    .from('coach_player_link_suggestions')
    .update({ status: 'rejected', decided_at: new Date().toISOString() })
    .eq('coach_id', coachId)
    .eq('player_id', playerId)
    .eq('status', 'pending')
    .select('coach_id')
  if (error) return { ok: false, status: 500, error: error.message }
  if (!data || data.length === 0) return { ok: false, status: 404, error: 'no pending suggestion for that pair' }
  return { ok: true }
}
