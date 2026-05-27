// apps/ops/src/app/(app)/odds/tournament/[id]/page.tsx
// /odds/tournament/[id] — detail page showing per-pair tournament predictions
// (champ / finalist / SF %, Elo, form) split by category. Text-only in v1;
// Task 5.3 will add a top-5 champ% movement chart.

import { notFound } from 'next/navigation'
import { OddsMovementChart } from '@/components/Odds/OddsMovementChart'
import { PairOddsRow } from '@/components/Odds/PairOddsRow'
import type { TournamentPredictionRow } from '@/lib/odds-data'
import { createServiceClient } from '@/lib/supabase'

export const metadata = { title: 'Tournament Odds · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function TournamentOddsPage({ params }: PageProps) {
  const { id } = await params
  const supabase = createServiceClient()

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, level, status, starts_at, ends_at')
    .eq('id', id)
    .maybeSingle()
  if (!tournament) notFound()

  // Latest tournament predictions for each (category, pair).
  const { data: tournPreds } = await supabase
    .from('model_tournament_predictions')
    .select('*')
    .eq('tournament_id', id)
    .order('created_at', { ascending: false })
    .limit(500)

  const rows = (tournPreds ?? []) as TournamentPredictionRow[]
  const seen = new Set<string>()
  const latestByPair = rows.filter((r) => {
    const k = `${r.category}::${r.pair_player1_id}::${r.pair_player2_id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })

  const playerIds = new Set<string>()
  for (const r of latestByPair) {
    playerIds.add(r.pair_player1_id)
    playerIds.add(r.pair_player2_id)
  }
  const { data: pl } = await supabase.from('players').select('id, name').in('id', [...playerIds])
  const nameById = new Map<string, string>((pl ?? []).map((p) => [p.id, p.name]))
  const pairName = (id1: string, id2: string) =>
    `${nameById.get(id1)?.split(' ').slice(-1)[0] ?? '?'} / ${nameById.get(id2)?.split(' ').slice(-1)[0] ?? '?'}`

  if (latestByPair.length === 0) {
    return (
      <div style={{ padding: 32, maxWidth: 1024 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{tournament.name}</h1>
        <p style={{ color: 'var(--status-neutral)', marginTop: 16 }}>
          No predictions yet for this tournament. Either it&apos;s below v1 scope (Premier + FIP Platinum + FIP Gold only)
          or the snapshot worker hasn&apos;t covered it yet.
        </p>
      </div>
    )
  }

  const byCategory: Record<'men' | 'women', TournamentPredictionRow[]> = { men: [], women: [] }
  for (const r of latestByPair) {
    byCategory[r.category].push(r)
  }
  for (const cat of ['men', 'women'] as const) {
    byCategory[cat].sort((a, b) => Number(b.champ_prob) - Number(a.champ_prob))
  }

  const snapshotAt = latestByPair[0]?.created_at ?? ''

  // Build top-5 series per category for the chart.
  // Parallelize the per-pair history queries — they're independent and we want
  // the page to fan out, not serialize.
  const colors = ['#ff6b2b', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5']

  async function buildSeriesForCategory(cat: 'men' | 'women') {
    const top5 = byCategory[cat].slice(0, 5)
    return Promise.all(
      top5.map(async (p, i) => {
        const { data: history } = await supabase
          .from('model_tournament_predictions')
          .select('created_at, champ_prob')
          .eq('tournament_id', id)
          .eq('category', cat)
          .eq('pair_player1_id', p.pair_player1_id)
          .eq('pair_player2_id', p.pair_player2_id)
          .order('created_at', { ascending: true })
        return {
          name: pairName(p.pair_player1_id, p.pair_player2_id),
          color: colors[i % colors.length]!,
          points: (history ?? []).map((h) => ({ t: h.created_at, value: Number(h.champ_prob) })),
        }
      }),
    )
  }

  const [menSeries, womenSeries] = await Promise.all([
    buildSeriesForCategory('men'),
    buildSeriesForCategory('women'),
  ])
  const chartByCat: Record<'men' | 'women', Array<{ name: string; color: string; points: Array<{ t: string; value: number }> }>> = {
    men: menSeries,
    women: womenSeries,
  }

  return (
    <div style={{ padding: 32, maxWidth: 1024 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{tournament.name}</h1>
      <div style={{ fontSize: 12, color: 'var(--status-neutral)', marginBottom: 24 }}>
        {tournament.level} · {tournament.status} · snapshot {snapshotAt.slice(0, 16)}
      </div>

      {(['men', 'women'] as const).map((cat) => (
        <section key={cat} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>{cat}</h2>
          {byCategory[cat].length === 0 ? (
            <div style={{ color: 'var(--status-neutral)' }}>No {cat} predictions yet.</div>
          ) : (
            <>
              <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
                {byCategory[cat].map((r) => (
                  <div
                    key={`${r.pair_player1_id}::${r.pair_player2_id}`}
                    style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 16 }}
                  >
                    <PairOddsRow
                      name={pairName(r.pair_player1_id, r.pair_player2_id)}
                      seed={r.pair_seed}
                      prob={Number(r.champ_prob)}
                      form={Number(r.team_form)}
                    />
                    <span style={{ minWidth: 56, textAlign: 'right' }}>
                      Final: {(Number(r.finalist_prob) * 100).toFixed(1)}%
                    </span>
                    <span style={{ minWidth: 56, textAlign: 'right' }}>
                      SF: {(Number(r.semi_prob) * 100).toFixed(1)}%
                    </span>
                    <span style={{ minWidth: 56, textAlign: 'right', color: 'var(--status-neutral)' }}>
                      Elo {Math.round(Number(r.team_elo))}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 16 }}>
                <h3 style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Top-5 champ% movement</h3>
                <OddsMovementChart series={chartByCat[cat]} yLabel="Champ %" />
              </div>
            </>
          )}
        </section>
      ))}
    </div>
  )
}
