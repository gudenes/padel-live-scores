// apps/ops/src/app/(app)/odds/page.tsx
// /odds landing page — today's matches with odds + tournament outlook cards.
// Server component, reads through odds-data lib at request time.

import { LiveNowSection } from '@/components/Odds/LiveNowSection'
import { LiveOddsTable, type LiveMatchRow } from '@/components/Odds/LiveOddsTable'
import { TournamentOutlookCard } from '@/components/Odds/TournamentOutlookCard'
import { PageHeader, Section, EmptyState } from '@/components/ui'
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

  // Hydrate player names for the match table.
  // IMPORTANT: TBD-pair match rows have null player IDs. Passing nulls through
  // `.in('id', [...])` poisons the entire query and returns zero rows, so every
  // pair would render as "? / ?". Filter to non-empty strings before the call.
  const supabase = createServiceClient()
  const playerIds = new Set<string>()
  const addId = (id: string | null | undefined) => {
    if (typeof id === 'string' && id.length > 0) playerIds.add(id)
  }
  for (const r of dayRows) {
    const m = r.match
    addId(m.pair1_player1_id)
    addId(m.pair1_player2_id)
    addId(m.pair2_player1_id)
    addId(m.pair2_player2_id)
  }
  for (const o of outlooks) {
    addId(o.pair_player1_id)
    addId(o.pair_player2_id)
  }
  const nameById = new Map<string, string>()
  if (playerIds.size > 0) {
    const { data: pl } = await supabase.from('players').select('id, name').in('id', [...playerIds])
    for (const p of pl ?? []) nameById.set(p.id, p.name)
  }
  const fmtPair = (id1: string | null | undefined, id2: string | null | undefined) => {
    const n1 = id1 ? (nameById.get(id1)?.split(' ').slice(-1)[0] ?? '?') : 'TBD'
    const n2 = id2 ? (nameById.get(id2)?.split(' ').slice(-1)[0] ?? '?') : 'TBD'
    return `${n1} / ${n2}`
  }

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
    <div className="ui-page">
      <PageHeader title="Live Odds" />

      <LiveNowSection />

      <Section label={`Matches on ${targetDate}`}>
        <LiveOddsTable rows={liveRows} />
      </Section>

      <Section label="Tournament outlooks">
        {cards.length === 0 ? (
          <EmptyState title="No in-scope tournaments currently active." />
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {cards.map((c) => (
              <TournamentOutlookCard key={`${c.tournamentId}::${c.category}`} {...c} />
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}
