// src/app/api/me/player/route.ts
// GET — o estado do vínculo da conta logada, em uma chamada:
//   { status: 'none' }
//   { status: 'pending', playerName }
//   { status: 'linked', player: { … } }
//
// Existe como rota de servidor porque player_claims é deny-by-default no
// browser: o estado "pending" não é legível pelo cliente anon de jeito nenhum.

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import type { MyPlayerLinked } from '@/lib/player-claim'
import { parseSelfEditPayload } from '@/lib/player-self-edit'
import { planRacketChange } from '@/lib/player-equipment'

export const dynamic = 'force-dynamic'

export async function GET() {
  const session = await auth()
  const userId = session?.user?.id
  // Sem sessão não é erro — é só "não tem vínculo". A UI trata os dois igual.
  if (!userId) return NextResponse.json({ status: 'none' })

  const supabase = createServerClient()

  // Cada consulta abaixo degrada para "sem vínculo" (ou badge nulo, no caso
  // da membership) quando falha, de propósito — o card simplesmente some em
  // vez de quebrar a página. Isso é seguro mas quase impossível de
  // diagnosticar a partir de um relato de bug, então cada falha é logada
  // aqui; o console.warn é o único rastro que sobra.
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('player_id').eq('id', userId).maybeSingle()
  if (profileError) console.warn('[me/player] profile lookup failed:', profileError.message)

  if (!profile?.player_id) {
    const { data: pending, error: pendingError } = await supabase
      .from('player_claims').select('player_name')
      .eq('user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (pendingError) console.warn('[me/player] pending claim lookup failed:', pendingError.message)
    if (pending) return NextResponse.json({ status: 'pending', playerName: pending.player_name })
    return NextResponse.json({ status: 'none' })
  }

  const { data: player, error: playerError } = await supabase
    .from('players').select('id, name, display_name, avatar_url')
    .eq('id', profile.player_id).maybeSingle()
  if (playerError) console.warn('[me/player] player lookup failed:', playerError.message)
  if (!player) return NextResponse.json({ status: 'none' })

  // Insígnia e capitania vêm do vínculo com a equipe na temporada mais
  // recente. Ausência de equipe não é erro — o card mostra só o nome.
  //
  // Ordenar por `created_at` é uma aproximação de "temporada mais recente":
  // funciona hoje porque a importação sazonal grava as linhas em ordem, mas
  // não é uma garantia — se uma temporada passada for reimportada depois de
  // uma atual, isso vai escolher a temporada errada em silêncio. Não dá para
  // ordenar por `team_seasons.label` em vez disso: é um texto tipo "25/26"
  // que ordena errado atravessando uma virada de década.
  const { data: membership, error: membershipError } = await supabase
    .from('team_memberships')
    .select('is_captain, team_season:team_seasons(label, team:teams(name, badge_label))')
    .eq('player_id', player.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (membershipError) console.warn('[me/player] membership lookup failed:', membershipError.message)

  const season = membership?.team_season as unknown as
    { label: string; team: { name: string; badge_label: string | null } | null } | null

  const linked: MyPlayerLinked = {
    id: player.id,
    name: player.display_name?.trim() || player.name,
    avatarUrl: player.avatar_url,
    badgeLabel: season?.team?.badge_label ?? null,
    teamName: season?.team?.name ?? null,
    isCaptain: membership?.is_captain ?? false,
  }

  return NextResponse.json({ status: 'linked', player: linked })
}

// PATCH — o jogador vinculado edita a própria posição e raquete.
//
// O id do jogador NUNCA vem do request: sai de profiles.player_id, que só o
// operador escreve ao aprovar uma claim. Não há como apontar esta rota para
// outra pessoa. Se o operador desvincular a conta, o próximo PATCH cai em
// 403 — o vínculo É a permissão, não há uma segunda lista para manter em dia.
export async function PATCH(req: NextRequest) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const parsed = parseSelfEditPayload(await req.json().catch(() => null))
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status })
  }
  const { patch } = parsed

  const supabase = createServerClient()

  const { data: profile, error: profileErr } = await supabase
    .from('profiles').select('player_id').eq('id', userId).maybeSingle()
  if (profileErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  if (!profile?.player_id) return NextResponse.json({ error: 'not_linked' }, { status: 403 })
  const playerId = profile.player_id as string

  // Validar a raquete ANTES de qualquer escrita. Um id inexistente tem que
  // sair com 400 sem ter tocado no banco — não com a posição já gravada e a
  // raquete não.
  if (patch.racketId) {
    const { data: racket, error: racketErr } = await supabase
      .from('padel_rackets').select('id').eq('id', patch.racketId).maybeSingle()
    if (racketErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
    if (!racket) return NextResponse.json({ error: 'bad_racket' }, { status: 400 })
  }

  // A raquete vai primeiro: é o caminho de múltiplas escritas com risco de
  // ficar pela metade. Rodando antes, uma falha aqui não deixa nada escrito
  // ainda — nem a posição.
  if ('racketId' in patch) {
    const { data: active, error: activeErr } = await supabase
      .from('player_equipment').select('id, racket_id')
      .eq('player_id', playerId).is('ended_at', null).maybeSingle()
    if (activeErr) return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })

    const activeId = (active?.id as string | undefined) ?? null
    const today = new Date().toISOString().split('T')[0]
    const plan = planRacketChange({
      activeRacketId: (active?.racket_id as string | undefined) ?? null,
      nextRacketId: patch.racketId ?? null,
      today,
    })

    if (plan.endActive && activeId) {
      const { error } = await supabase
        .from('player_equipment').update({ ended_at: today }).eq('id', activeId)
      if (error) return NextResponse.json({ error: 'write_failed' }, { status: 500 })
    }
    if (plan.insert) {
      const { error } = await supabase.from('player_equipment').insert({
        player_id: playerId,
        racket_id: plan.insert.racketId,
        started_at: plan.insert.startedAt,
        ended_at: null,
      })
      if (error) {
        // A atribuição antiga já foi fechada. Deixar assim tira a raquete de
        // quem só queria trocar de raquete — pior que o estado de partida.
        // Reabre a anterior e devolve erro, para o usuário tentar de novo.
        if (activeId) {
          await supabase.from('player_equipment')
            .update({ ended_at: null }).eq('id', activeId)
        }
        return NextResponse.json({ error: 'write_failed' }, { status: 500 })
      }
    }
  }

  if ('side' in patch) {
    const { error } = await supabase
      .from('players').update({ side: patch.side ?? null }).eq('id', playerId)
    if (error) {
      return NextResponse.json(
        { error: 'write_failed', applied: 'racketId' in patch ? ['racket'] : [] },
        { status: 500 },
      )
    }
  }

  return NextResponse.json({ ok: true })
}
