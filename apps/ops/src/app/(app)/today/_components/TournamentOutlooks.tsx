// apps/ops/src/app/(app)/today/_components/TournamentOutlooks.tsx
// Async server component: the "Tournament outlooks" section ported from the old
// /odds landing onto the Today scoreboard. Streamed inside a <Suspense> on the
// Today page so the heavy getOngoingTournamentOutlooks() walk doesn't block the
// board's first paint.
//
// Server-only (uses the service client) — must NOT be imported into any
// 'use client' file. It's rendered only from the server page.tsx, inside Suspense.

import { TournamentOutlookCard } from '@/components/Odds/TournamentOutlookCard'
import { Section, EmptyState } from '@/components/ui'
import { getOngoingTournamentOutlooks } from '@/lib/odds-data'
import { createServiceClient } from '@/lib/supabase'
import { displayName } from '../_lib/scoreboard-data'

export async function TournamentOutlooks() {
  const outlooks = await getOngoingTournamentOutlooks()

  // Hydrate player names. Use the broadcast-style displayName so pairs match the
  // scoreboard above. Filter to non-empty strings before `.in()` — null IDs
  // poison the whole query.
  const supabase = createServiceClient()
  const playerIds = new Set<string>()
  const addId = (id: string | null | undefined) => {
    if (typeof id === 'string' && id.length > 0) playerIds.add(id)
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
    const n1 = id1 ? displayName(nameById.get(id1) ?? null) : 'TBD'
    const n2 = id2 ? displayName(nameById.get(id2) ?? null) : 'TBD'
    return [n1, n2].join(' / ')
  }

  // Group outlooks by tournament + category, take top 4 by champ_prob.
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
  )
}
