// apps/ops/src/app/(app)/odds/page.tsx
// /odds landing page — today's matches with odds + tournament outlook cards.
// Server component, reads through odds-data lib at request time.

import { LiveOddsTable, type LiveMatchRow } from '@/components/Odds/LiveOddsTable'
import { TournamentOutlookCard } from '@/components/Odds/TournamentOutlookCard'
import {
  getMatchOddsForDay,
  getOngoingTournamentOutlooks,
} from '@/lib/odds-data'
import { createServiceClient } from '@/lib/supabase'

export const metadata = { title: 'Live Odds · PadelNachos Admin' }
export const dynamic = 'force-dynamic'

export default async function LiveOddsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams
  const today = new Date().toISOString().slice(0, 10)
  const targetDate = params.date ?? today

  const [dayRows, outlooks] = await Promise.all([
    getMatchOddsForDay(targetDate),
    getOngoingTournamentOutlooks(),
  ])

  // Hydrate player names for the match table
  const supabase = createServiceClient()
  const playerIds = new Set<string>()
  for (const r of dayRows) {
    const m = r.match
    playerIds.add(m.pair1_player1_id)
    playerIds.add(m.pair1_player2_id)
    playerIds.add(m.pair2_player1_id)
    playerIds.add(m.pair2_player2_id)
  }
  for (const o of outlooks) {
    playerIds.add(o.pair_player1_id)
    playerIds.add(o.pair_player2_id)
  }
  const { data: pl } = await supabase.from('players').select('id, name').in('id', [...playerIds])
  const nameById = new Map<string, string>((pl ?? []).map((p) => [p.id, p.name]))
  const fmtPair = (id1: string, id2: string) =>
    `${nameById.get(id1)?.split(' ').slice(-1)[0] ?? '?'} / ${nameById.get(id2)?.split(' ').slice(-1)[0] ?? '?'}`

  const liveRows: LiveMatchRow[] = dayRows.map((r) => ({
    match: r.match as LiveMatchRow['match'],
    prediction: r.prediction as LiveMatchRow['prediction'],
    pair1Name: fmtPair(r.match.pair1_player1_id, r.match.pair1_player2_id),
    pair2Name: fmtPair(r.match.pair2_player1_id, r.match.pair2_player2_id),
  }))

  // Group outlooks by tournament + category, take top 4 by champ_prob
  const byTournCat = new Map<string, typeof outlooks>()
  for (const o of outlooks) {
    const k = `${o.tournament_id}::${o.category}`
    if (!byTournCat.has(k)) byTournCat.set(k, [])
    byTournCat.get(k)!.push(o)
  }
  const cards = [...byTournCat.entries()].map(([, rows]) => {
    rows.sort((a, b) => Number(b.champ_prob) - Number(a.champ_prob))
    const first = rows[0]
    return {
      tournamentId: first.tournament_id as string,
      tournamentName: (first.tournaments?.name as string) ?? 'Unknown',
      category: first.category as 'men' | 'women',
      entryRound: first.entry_round as string,
      snapshotAt: first.created_at as string,
      top: rows.slice(0, 4).map((r) => ({
        pairName: fmtPair(r.pair_player1_id, r.pair_player2_id),
        seed: r.pair_seed as number | null,
        champ_prob: Number(r.champ_prob),
        finalist_prob: Number(r.finalist_prob),
        semi_prob: Number(r.semi_prob),
      })),
    }
  })

  return (
    <div style={{ padding: 32, maxWidth: 1280 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Live Odds</h1>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 8px' }}>
        Matches on {targetDate}
      </h2>
      <LiveOddsTable rows={liveRows} />

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '32px 0 8px' }}>Tournament outlooks</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {cards.length === 0 && (
          <div style={{ padding: 16, color: 'var(--status-neutral)' }}>
            No in-scope tournaments currently active.
          </div>
        )}
        {cards.map((c) => (
          <TournamentOutlookCard key={`${c.tournamentId}::${c.category}`} {...c} />
        ))}
      </div>
    </div>
  )
}
