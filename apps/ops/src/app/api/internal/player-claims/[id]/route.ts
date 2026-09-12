// apps/ops/src/app/api/internal/player-claims/[id]/route.ts
// Admin actions on a single player-profile claim:
//   { action: 'approve', note? } → link profiles.player_id, mark approved
//   { action: 'reject',  note? } → mark rejected
//   { action: 'unlink',  note? } → clear profiles.player_id on an approved claim
//
// Auth: Auth.js session with isOperator check (same as other /api/internal/*).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as {
    action?: string
    note?: string
  }

  if (body.action !== 'approve' && body.action !== 'reject' && body.action !== 'unlink') {
    return NextResponse.json({ error: 'bad_action' }, { status: 400 })
  }
  const action = body.action

  const supabase = serviceClient()
  const reviewer = session.user.email ?? 'ops'

  const { data: claim, error: loadErr } = await supabase
    .from('player_claims').select('id, player_id, user_id, status').eq('id', id).maybeSingle()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!claim) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  if (action === 'approve' || action === 'reject') {
    // Same class of risk as the unlink guard below: acting on a claim that
    // isn't 'pending' anymore can strand a link with no way back through the
    // admin (see the approve rollback comment further down).
    if (claim.status !== 'pending') {
      return NextResponse.json({ error: 'not_pending' }, { status: 409 })
    }
  }

  if (action === 'approve') {
    const { data: updated, error: linkErr } = await supabase
      .from('profiles')
      .update({ player_id: claim.player_id })
      .eq('id', claim.user_id)
      .select('id')
    if (linkErr) {
      // 23505 = profiles_player_id_uk. O jogador foi vinculado a outra conta
      // entre o carregamento da lista e este clique. Recusar é o certo: a
      // alternativa é sobrescrever o vínculo de outra pessoa em silêncio.
      if (linkErr.code === '23505') {
        return NextResponse.json({ error: 'already_claimed' }, { status: 409 })
      }
      return NextResponse.json({ error: linkErr.message }, { status: 500 })
    }
    // Zero linhas = não existe profile para este user_id. Não é para acontecer,
    // mas marcar a claim como aprovada sem vínculo criaria um estado mentiroso.
    if (!updated || updated.length === 0) {
      return NextResponse.json({ error: 'profile_missing' }, { status: 409 })
    }
  }

  if (action === 'unlink') {
    // Only an approved claim ever created a link through this pipeline.
    // Allowing unlink from any status would let a stray direct POST clear
    // profiles.player_id for a user this route never linked — e.g. one set
    // manually, or belonging to an unrelated claim that raced to 'rejected'.
    if (claim.status !== 'approved') {
      return NextResponse.json({ error: 'not_approved' }, { status: 409 })
    }
    const { error: unlinkErr } = await supabase
      .from('profiles').update({ player_id: null }).eq('id', claim.user_id)
    if (unlinkErr) return NextResponse.json({ error: unlinkErr.message }, { status: 500 })
  }

  // player_claims.status has a 3-way check constraint (pending/approved/
  // rejected) — there's no 'unlinked' value. An unlink is recorded as
  // 'rejected' with review_note 'unlinked' so the claim no longer counts as
  // an active approval, without needing a schema change.
  const newStatus = action === 'approve' ? 'approved' : 'rejected'
  // On unlink, 'unlinked' is the ONLY thing in the All list that distinguishes
  // this from a genuine rejection (both collapse to status='rejected') — it
  // must not be overwritable by a caller-supplied note.
  const reviewNote = action === 'unlink' ? 'unlinked' : (body.note ?? null)
  const { error: statusErr } = await supabase
    .from('player_claims')
    .update({
      status: newStatus,
      reviewed_by: reviewer,
      reviewed_at: new Date().toISOString(),
      review_note: reviewNote,
    })
    .eq('id', id)
  if (statusErr) {
    // A escrita do vínculo já passou. Deixar assim produz o pior estado
    // possível: conta ligada, claim ainda 'pending', e o botão Unlink — que
    // só aparece em linhas aprovadas — fora de alcance. Desfaz o vínculo e
    // devolve erro, para o operador simplesmente tentar de novo.
    if (action === 'approve') {
      await supabase.from('profiles').update({ player_id: null }).eq('id', claim.user_id)
    }
    return NextResponse.json({ error: statusErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status: newStatus })
}
