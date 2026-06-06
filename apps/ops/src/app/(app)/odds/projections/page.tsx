// apps/ops/src/app/(app)/odds/projections/page.tsx
// QA surface for the Road to Trophy "Projection" feature. Reads
// tournament_projections across ALL tiers (Premier ships publicly; lower tiers
// are QA-only here). Server component → projection-data helpers.
import { getProjectionTournaments, getProjectionRows } from '@/lib/projection-data'

export const dynamic = 'force-dynamic'

const pct = (n: number) => `${(n * 100).toFixed(1)}%`
const pct0 = (n: number) => `${Math.round(n * 100)}%`

export default async function ProjectionsQAPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string; c?: string }>
}) {
  const sp = await searchParams
  const tournaments = await getProjectionTournaments()
  const selT = sp.t ?? tournaments[0]?.tournament_id
  const selC = sp.c ?? tournaments.find((x) => x.tournament_id === selT)?.category ?? 'men'
  const rows = selT ? await getProjectionRows(selT, selC) : []

  return (
    <div className="ui-page">
      <h1>Projection QA — all tiers</h1>
      <p>
        Per-pair champion odds + projected road from the Elo Monte-Carlo engine.
        Premier ships publicly; lower tiers are QA-only. {tournaments.length} tournament/category
        snapshots available.
      </p>

      {tournaments.length === 0 && (
        <p>
          No projections yet. Run the <code>tournament-projection-snapshot</code> worker
          (it only writes for tournaments with a live main-draw frontier).
        </p>
      )}

      <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0 }}>
        {tournaments.map((t) => {
          const active = t.tournament_id === selT && t.category === selC
          return (
            <li key={`${t.tournament_id}:${t.category}`}>
              <a
                href={`?t=${t.tournament_id}&c=${t.category}`}
                style={{ fontWeight: active ? 700 : 400, textDecoration: active ? 'underline' : 'none' }}
              >
                {t.name} · {t.category} · {t.level ?? '—'} ({t.pairs})
              </a>
            </li>
          )
        })}
      </ul>

      {rows.length > 0 && (
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Pair</th>
              <th>Champ%</th>
              <th>Final%</th>
              <th>SF%</th>
              <th style={{ textAlign: 'left' }}>Projected road</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.pair_key}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.pair_player_ids.join(' / ')}</td>
                <td style={{ textAlign: 'center' }}>{pct(r.champion_prob)}</td>
                <td style={{ textAlign: 'center' }}>{pct(r.finalist_prob)}</td>
                <td style={{ textAlign: 'center' }}>{pct(r.semifinal_prob)}</td>
                <td>
                  {r.rounds.map((rd) => {
                    const top = rd.opponents[0]
                    return (
                      <div key={rd.round}>
                        <b>{rd.round}</b> (reach {pct0(rd.reach_prob)})
                        {top
                          ? ` vs ${top.names.join('/')} — face ${pct0(top.reach_prob)}, win ${pct0(top.win_prob)}${rd.opponents.length > 1 ? ` (+${rd.opponents.length - 1} more)` : ''}`
                          : ' — bye/unknown'}
                      </div>
                    )
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
