// apps/ops/src/app/(app)/odds/match/[id]/page.tsx
// /odds/match/[id] — per-match detail page. Shows pair cards side-by-side
// with the model's win probability + decimal odds, and a calibration block
// once the match has finished and prediction-scorer has run. Text-only in v1;
// Task 5.3 will wire in the movement chart.

import { notFound } from 'next/navigation'
import { OddsMovementChart } from '@/components/Odds/OddsMovementChart'
import { PageHeader, Section, Panel } from '@/components/ui'
import { createServiceClient } from '@/lib/supabase'

export const metadata = { title: 'Match Odds · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

// Supabase returns embedded relations as either an object or null when the FK
// is single-valued, but the typegen falls back to `any` for ad-hoc selects.
// Spelling out the shape here keeps `match.tournaments?.name` type-safe.
interface MatchRow {
  id: string
  tournament_id: string | null
  category: 'men' | 'women' | null
  round: string | null
  round_canonical: string | null
  status: string | null
  scheduled_at: string | null
  court: string | null
  winner_pair: number | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
  pair1_seed: number | null
  pair2_seed: number | null
  tournaments: { name: string | null } | null
}

interface PredictionRow {
  pair1_prob: number
  pair2_prob: number
  pair1_decimal_odds: number
  pair2_decimal_odds: number
  pair1_team_elo: number
  pair2_team_elo: number
  pair1_team_form: number
  pair2_team_form: number
}

interface ScoreRow {
  actual_winner_pair: number
  predicted_prob_winner: number
  brier_score: number
  log_loss: number
}

export default async function MatchOddsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: match } = await supabase
    .from('matches')
    .select(
      'id, tournament_id, category, round, round_canonical, status, scheduled_at, court, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed, tournaments(name)',
    )
    .eq('id', id)
    .maybeSingle<MatchRow>()
  if (!match) notFound()

  const { data: latestPred } = await supabase
    .from('model_predictions')
    .select('*')
    .eq('match_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle<PredictionRow>()

  const { data: score } = await supabase
    .from('prediction_scores')
    .select('*')
    .eq('match_id', id)
    .maybeSingle<ScoreRow>()

  const playerIds = [
    match.pair1_player1_id,
    match.pair1_player2_id,
    match.pair2_player1_id,
    match.pair2_player2_id,
  ].filter((v): v is string => Boolean(v))
  const { data: pl } = await supabase
    .from('players')
    .select('id, name, ranking')
    .in('id', playerIds)
  const playerById = new Map<string, { id: string; name: string; ranking: number | null }>(
    (pl ?? []).map((p) => [p.id, p]),
  )
  const pairLabel = (id1: string | null, id2: string | null) => {
    if (!id1 || !id2) return 'TBD'
    return `${playerById.get(id1)?.name ?? '?'} / ${playerById.get(id2)?.name ?? '?'}`
  }

  const pair1 = pairLabel(match.pair1_player1_id, match.pair1_player2_id)
  const pair2 = pairLabel(match.pair2_player1_id, match.pair2_player2_id)

  const { data: history } = await supabase
    .from('model_predictions')
    .select('created_at, pair1_prob, pair2_prob')
    .eq('match_id', id)
    .order('created_at', { ascending: true })

  return (
    <div className="ui-page">
      <PageHeader
        title={`${match.tournaments?.name ?? 'Match'} · ${match.round_canonical ?? match.round}`}
        subtitle={`${match.scheduled_at?.slice(0, 16)} · ${match.court ?? '?'} · ${match.category} · ${match.status}`}
      />

      {!latestPred ? (
        <div style={{ color: 'var(--text-3)' }}>
          No prediction available. Either the snapshot worker hasn&apos;t covered this match yet,
          or it&apos;s below v1 scope.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <PairCard
            name={pair1}
            seed={match.pair1_seed}
            prob={Number(latestPred.pair1_prob)}
            decimal={Number(latestPred.pair1_decimal_odds)}
            elo={Number(latestPred.pair1_team_elo)}
            form={Number(latestPred.pair1_team_form)}
            favorite={Number(latestPred.pair1_prob) > 0.5}
          />
          <PairCard
            name={pair2}
            seed={match.pair2_seed}
            prob={Number(latestPred.pair2_prob)}
            decimal={Number(latestPred.pair2_decimal_odds)}
            elo={Number(latestPred.pair2_team_elo)}
            form={Number(latestPred.pair2_team_form)}
            favorite={Number(latestPred.pair2_prob) > 0.5}
          />
        </div>
      )}

      <Section label="Probability movement">
        <OddsMovementChart
          series={[
            {
              name: pair1,
              color: 'var(--lime)',
              points: (history ?? []).map((h) => ({ t: h.created_at, value: Number(h.pair1_prob) })),
            },
            {
              name: pair2,
              color: 'var(--orange)',
              points: (history ?? []).map((h) => ({ t: h.created_at, value: Number(h.pair2_prob) })),
            },
          ]}
        />
      </Section>

      {score && (
        <div style={{ marginTop: 32 }}>
          <Panel title="Result + calibration">
            <div style={{ fontSize: 13 }}>
              Winner: pair {score.actual_winner_pair} ({score.actual_winner_pair === 1 ? pair1 : pair2})
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 13 }}>
              <span>
                Predicted prob for winner: {(Number(score.predicted_prob_winner) * 100).toFixed(1)}%
              </span>
              <span>Brier: {Number(score.brier_score).toFixed(4)}</span>
              <span>Log-loss: {Number(score.log_loss).toFixed(4)}</span>
            </div>
          </Panel>
        </div>
      )}
    </div>
  )
}

function PairCard({
  name,
  seed,
  prob,
  decimal,
  elo,
  form,
  favorite,
}: {
  name: string
  seed: number | null
  prob: number
  decimal: number
  elo: number
  form: number
  favorite: boolean
}) {
  return (
    <div
      style={{
        padding: 16,
        border: `2px solid ${favorite ? 'var(--lime-border)' : 'var(--border-card)'}`,
        borderRadius: 'var(--r-md)',
        background: favorite ? 'var(--lime-bg)' : 'var(--bg-card)',
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
        {seed ? <span style={{ color: 'var(--text-3)' }}>[{seed}] </span> : null}
        {name}
      </div>
      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: favorite ? 'var(--lime-text)' : 'inherit',
        }}
      >
        {(prob * 100).toFixed(1)}%
      </div>
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 8,
          fontSize: 12,
          color: 'var(--text-3)',
        }}
      >
        <span>Decimal {decimal.toFixed(2)}</span>
        <span>Elo {Math.round(elo)}</span>
        <span>
          Form {form > 0 ? '+' : ''}
          {Math.round(form)}
        </span>
      </div>
    </div>
  )
}
