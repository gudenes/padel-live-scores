// apps/ops/src/app/api/internal/play-markets/route.ts
// List generated Play markets for the ops dashboard.
// Auth: Auth.js session with isOperator flag.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { serviceClient } from '@/lib/supabase'

/**
 * The Play tables are not in the generated Supabase types, so the client
 * cannot infer these selects and falls back to GenericStringError. Declaring
 * the row shapes and casting once keeps the rest of the file properly typed
 * instead of scattering `any`.
 */
type MarketRow = Record<string, unknown>
type JoinRow = Record<string, unknown>

/**
 * Current YES price from the LMSR share counts.
 *
 * MIRROR — this must stay identical to `priceYes` in
 * `padelgod/src/lib/lmsr.ts`, which is the single source for pricing. It is
 * duplicated here only because rendering a market requires a price and the
 * admin does not (and should not) import from the padelgod package. Display
 * only: nothing here is ever written back.
 */
function priceYes(qYes: number, qNo: number, b: number): number {
  return 1 / (1 + Math.exp((qNo - qYes) / b))
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.isOperator) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = serviceClient()

  const { data: markets, error } = await supabase
    .from('markets')
    .select(
      'id, public_id, template_id, match_id, tournament_id, category, resolver_key, ' +
      'lmsr_b, seed_prob, seed_source, q_yes, q_no, volume_guacas, position_count, ' +
      'status, locks_at, proposed_outcome, proposed_at, settles_at, outcome, ' +
      'settled_at, settled_by, void_reason, hold_reason, created_at',
    )
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const rows = (markets ?? []) as unknown as MarketRow[]
  if (rows.length === 0) return Response.json({ markets: [] })

  // Hydrate the bits an operator needs to recognise a market: which template
  // made it, and which match/tournament it is about.
  const templateIds = [...new Set(rows.map((m) => m.template_id as string))]
  const matchIds = [...new Set(rows.map((m) => m.match_id).filter(Boolean) as string[])]
  const tournamentIds = [...new Set(rows.map((m) => m.tournament_id).filter(Boolean) as string[])]

  const [tplRes, matchRes] = await Promise.all([
    supabase.from('market_templates').select('id, key, question_i18n').in('id', templateIds),
    matchIds.length
      ? supabase
          .from('matches')
          .select(
            'id, tournament_id, round_canonical, scheduled_at, status, winner_pair, ' +
            'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name',
          )
          .in('id', matchIds)
      : Promise.resolve({ data: [] as JoinRow[] }),
  ])
  const templates = (tplRes.data ?? []) as unknown as JoinRow[]
  const matches = (matchRes.data ?? []) as unknown as JoinRow[]

  const matchTourIds = matches
    .map((m) => m.tournament_id as string | null)
    .filter(Boolean) as string[]
  const allTourIds = [...new Set([...tournamentIds, ...matchTourIds])]
  const tourRes = allTourIds.length
    ? await supabase.from('tournaments').select('id, name, level').in('id', allTourIds)
    : { data: [] as JoinRow[] }
  const tournaments = (tourRes.data ?? []) as unknown as JoinRow[]

  const tplById = new Map(templates.map((t) => [t.id as string, t]))
  const matchById = new Map(matches.map((m) => [m.id as string, m]))
  const tourById = new Map(tournaments.map((t) => [t.id as string, t]))

  const surname = (n: unknown) =>
    typeof n === 'string' && n.trim() ? n.trim().split(/\s+/).slice(-1)[0] : '?'

  const out = rows.map((m) => {
    const tpl = tplById.get(m.template_id as string)
    const match = m.match_id ? matchById.get(m.match_id as string) : null
    const tour = tourById.get(
      (m.tournament_id as string) ?? ((match?.tournament_id as string) ?? ''),
    )

    // PostgREST returns numeric as strings — coerce before any arithmetic.
    const qYes = Number(m.q_yes)
    const qNo = Number(m.q_no)
    const b = Number(m.lmsr_b)
    const seed = Number(m.seed_prob)
    const price = Number.isFinite(qYes) && Number.isFinite(qNo) && b > 0
      ? priceYes(qYes, qNo, b)
      : null

    return {
      id: m.id,
      publicId: m.public_id,
      templateKey: (tpl?.key as string) ?? '?',
      question: (tpl?.question_i18n as Record<string, string> | null)?.en ?? '—',
      subject: match
        ? `${surname(match.pair1_player1_name)}/${surname(match.pair1_player2_name)}` +
          ` vs ${surname(match.pair2_player1_name)}/${surname(match.pair2_player2_name)}`
        : ((tour?.name as string) ?? '—'),
      tournament: (tour?.name as string) ?? null,
      level: (tour?.level as string) ?? null,
      round: (match?.round_canonical as string) ?? null,
      category: m.category,
      matchStatus: (match?.status as string) ?? null,
      winnerPair: (match?.winner_pair as number | null) ?? null,
      price,
      seedProb: Number.isFinite(seed) ? seed : null,
      // The number an operator actually reads: how far the crowd has moved
      // from where our model opened the market.
      deltaPts: price !== null && Number.isFinite(seed) ? Math.round((price - seed) * 100) : null,
      volume: Number(m.volume_guacas) || 0,
      positions: Number(m.position_count) || 0,
      status: m.status,
      locksAt: m.locks_at,
      proposedOutcome: m.proposed_outcome,
      settlesAt: m.settles_at,
      outcome: m.outcome,
      settledBy: m.settled_by,
      voidReason: m.void_reason,
      holdReason: m.hold_reason,
      createdAt: m.created_at,
    }
  })

  return Response.json({ markets: out })
}
