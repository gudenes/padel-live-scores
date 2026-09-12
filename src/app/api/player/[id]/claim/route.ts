// src/app/api/player/[id]/claim/route.ts
// POST — o usuário logado pede o vínculo com um jogador amador.
// A decisão mora em src/lib/player-claim.ts; aqui só montamos o contexto,
// gravamos, e traduzimos a recusa em status HTTP.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { auth } from '@/auth'
import { evaluateClaim, NOTE_MAX_LENGTH, type PlayerTier } from '@/lib/player-claim'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: playerId } = await params
  const session = await auth()
  const userId = session?.user?.id ?? null

  const body = (await req.json().catch(() => ({}))) as { note?: unknown }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, NOTE_MAX_LENGTH) : null

  const supabase = createServerClient()

  // Um pedido anônimo não daria ao operador nada para julgar — e sem userId
  // as três consultas abaixo não fazem sentido. Corta antes.
  if (!userId) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  }

  const [playerRes, ownerRes, accountRes, pendingRes] = await Promise.all([
    supabase.from('players').select('id, tier, name, display_name').eq('id', playerId).maybeSingle(),
    supabase.from('profiles').select('id').eq('player_id', playerId).maybeSingle(),
    supabase.from('profiles').select('player_id').eq('id', userId).maybeSingle(),
    supabase.from('player_claims').select('id')
      .eq('user_id', userId).eq('player_id', playerId).eq('status', 'pending').maybeSingle(),
  ])

  // Todas as quatro consultas têm que ter SUCEDIDO para o veredito valer.
  // Checar só o jogador deixava as outras três falharem em silêncio: numa
  // falha transitória do Supabase, `data` vem nulo e a guarda correspondente
  // ("já é de outra conta", "esta conta já tem jogador", "já há pedido")
  // passaria batido. Uma consulta que não pôde ser feita tem que bloquear a
  // escrita, não liberá-la.
  if (playerRes.error || ownerRes.error || accountRes.error || pendingRes.error) {
    console.warn(
      '[claim] lookup failed:',
      playerRes.error?.message ?? ownerRes.error?.message ?? accountRes.error?.message ?? pendingRes.error?.message,
    )
    return NextResponse.json({ error: 'lookup_failed' }, { status: 500 })
  }

  const verdict = evaluateClaim({
    userId,
    // players.tier vem do supabase-js como string solta; a constraint do
    // banco (`check (tier in ('pro','amateur'))`) garante que só esses dois
    // valores existem em produção, então asserimos aqui — é a única fronteira
    // entre a linha crua e o tipo estreito que evaluateClaim exige.
    player: playerRes.data
      ? { id: playerRes.data.id, tier: playerRes.data.tier as PlayerTier | null }
      : null,
    playerOwnerUserId: ownerRes.data?.id ?? null,
    accountPlayerId: accountRes.data?.player_id ?? null,
    hasPendingClaim: !!pendingRes.data,
  })
  if (!verdict.ok) {
    return NextResponse.json({ error: verdict.reason }, { status: verdict.status })
  }

  const { error } = await supabase.from('player_claims').insert({
    player_id: playerId,
    player_name: playerRes.data!.display_name ?? playerRes.data!.name,
    user_id: userId,
    user_email: session?.user?.email ?? null,
    note,
  })
  if (error) {
    // 23505 = violação do índice único parcial: uma corrida entre dois cliques
    // rápidos. Do ponto de vista de quem clicou, o pedido está na fila.
    if (error.code === '23505') return NextResponse.json({ error: 'pending' }, { status: 409 })
    return NextResponse.json({ error: 'insert_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, status: 'pending' })
}
