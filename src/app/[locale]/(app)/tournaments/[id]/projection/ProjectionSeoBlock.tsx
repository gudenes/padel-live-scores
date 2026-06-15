// src/app/[locale]/(app)/tournaments/[id]/projection/ProjectionSeoBlock.tsx
// Server-rendered, screen-reader-only SEO surface for projection routes.
// ProjectionTab (the visible UI) is a client island whose markup never
// reaches crawlers, so this block carries the indexable text — the same
// approach layout.tsx uses for the tournament <h1>.

import type { ProjectionRow } from '@/lib/projection-types'

function pairLabel(row: ProjectionRow, nameById: Map<string, string>): string {
  return row.pair_player_ids
    .map((id) => {
      const full = nameById.get(id) ?? id
      const tokens = full.trim().split(/\s+/)
      return tokens[tokens.length - 1] || full
    })
    .join(' / ')
}

const pct = (p: number): string => `${Math.round(p * 100)}%`

export function ProjectionSeoBlock({
  tournamentName,
  category,
  rows,
  nameById,
  pairKey,
}: {
  tournamentName: string
  category: 'men' | 'women'
  rows: ProjectionRow[]
  nameById: Map<string, string>
  pairKey?: string | null
}) {
  const single = pairKey ? rows.find((r) => r.pair_key === pairKey) ?? null : null

  if (single) {
    return (
      <section className="sr-only" aria-hidden={false}>
        <h2>
          {pairLabel(single, nameById)} — road to the title at {tournamentName} ({category})
        </h2>
        <p>Champion probability: {pct(single.champion_prob)}. Finalist: {pct(single.finalist_prob)}. Semifinal: {pct(single.semifinal_prob)}.</p>
        <ul>
          {single.rounds.map((rd) => {
            const opp = rd.opponents[0]
            return (
              <li key={rd.round}>
                {rd.round}: reach {pct(rd.reach_prob)}
                {opp ? ` — likely vs ${opp.names.join(' / ')} (win ${pct(opp.win_prob)})` : ''}
              </li>
            )
          })}
        </ul>
      </section>
    )
  }

  return (
    <section className="sr-only" aria-hidden={false}>
      <h2>{tournamentName} projection — {category} road to the title</h2>
      <ul>
        {rows.map((r) => (
          <li key={r.pair_key}>
            {pairLabel(r, nameById)} — {pct(r.champion_prob)} champion, {pct(r.finalist_prob)} finalist
          </li>
        ))}
      </ul>
    </section>
  )
}
