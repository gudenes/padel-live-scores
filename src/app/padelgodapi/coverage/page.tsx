// src/app/padelgodapi/coverage/page.tsx
// What we cover + feature matrix by tour / level.

import type { Metadata } from 'next'
import { PageHeader } from '../_components/PageHeader'
import { Prose } from '../_components/Prose'
import { Callout } from '../_components/Callout'
import { PrevNextLinks } from '../_components/PrevNextLinks'

export const metadata: Metadata = { title: 'Coverage' }

type Cell = 'yes' | 'partial' | 'no' | 'maybe'

function Mark({ v }: { v: Cell }) {
  const map: Record<Cell, { label: string; className: string }> = {
    yes: { label: '✓', className: 'text-[var(--color-success)] font-bold' },
    partial: { label: '◐', className: 'text-[#F5C542] font-bold' },
    maybe: { label: '?', className: 'text-[var(--text-muted)] font-bold' },
    no: { label: '—', className: 'text-[var(--text-faint)]' },
  }
  return (
    <span className={`inline-block text-center w-6 ${map[v].className}`}>
      {map[v].label}
    </span>
  )
}

const ROWS: Array<{
  tour: string
  note?: string
  live: Cell
  draws: Cell
  oop: Cell
  results: Cell
  stats: Cell
  bios: Cell
}> = [
  { tour: 'Premier Padel P1 / P2', live: 'yes', draws: 'yes', oop: 'yes', results: 'yes', stats: 'yes', bios: 'yes' },
  { tour: 'Premier Padel Major', live: 'yes', draws: 'yes', oop: 'yes', results: 'yes', stats: 'yes', bios: 'yes' },
  { tour: 'FIP Platinum', live: 'yes', draws: 'yes', oop: 'yes', results: 'yes', stats: 'partial', bios: 'yes' },
  { tour: 'FIP Gold', live: 'yes', draws: 'yes', oop: 'yes', results: 'yes', stats: 'partial', bios: 'yes' },
  { tour: 'FIP Silver', live: 'yes', draws: 'yes', oop: 'yes', results: 'yes', stats: 'no', bios: 'yes' },
  { tour: 'FIP Bronze', live: 'yes', draws: 'yes', oop: 'yes', results: 'yes', stats: 'no', bios: 'partial' },
  { tour: 'Cupra FIP Tour', live: 'yes', draws: 'yes', oop: 'yes', results: 'yes', stats: 'no', bios: 'partial' },
  { tour: 'World Padel Tour (WPT)', note: 'legacy tour — not actively tracked', live: 'no', draws: 'no', oop: 'no', results: 'no', stats: 'no', bios: 'no' },
  { tour: 'A1 Padel', note: 'separate provider stack; not yet integrated', live: 'no', draws: 'no', oop: 'no', results: 'no', stats: 'no', bios: 'no' },
  { tour: 'Hexagon Cup', note: 'league format; on the shortlist', live: 'no', draws: 'no', oop: 'no', results: 'no', stats: 'no', bios: 'no' },
]

export default function CoveragePage() {
  return (
    <article>
      <PageHeader
        eyebrow="Overview"
        title="Coverage"
        description="Which tours, levels, and data surfaces we currently track. Feature gaps are marked honestly — no overclaiming."
      />
      <Prose>
        <h2>Feature matrix</h2>
        <p>
          Updated when we onboard a new source or deprecate an existing one.
          <strong> Live</strong> = real-time score polling for in-progress matches.
          <strong> OOP</strong> = Order of Play (daily schedule).
          <strong> Stats</strong> = per-set service/return/points breakdowns.
        </p>

        <div className="my-6 overflow-x-auto rounded-lg border border-[var(--border-base)]">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]">
                  Tour / Level
                </th>
                {['Live scores', 'Draws', 'OOP', 'Results', 'Match stats', 'Player bios'].map(h => (
                  <th
                    key={h}
                    className="border-b border-[var(--border-strong)] bg-[var(--bg-subtle)] px-2 py-2 text-center text-xs font-semibold uppercase tracking-wider text-[var(--text-primary)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ROWS.map(r => (
                <tr key={r.tour} className="hover:bg-[var(--bg-subtle)]">
                  <td className="border-b border-[var(--border-base)] px-3 py-2 align-top">
                    <div className="font-medium text-[var(--text-primary)]">{r.tour}</div>
                    {r.note && <div className="text-xs text-[var(--text-muted)]">{r.note}</div>}
                  </td>
                  <td className="border-b border-[var(--border-base)] px-2 py-2 text-center"><Mark v={r.live} /></td>
                  <td className="border-b border-[var(--border-base)] px-2 py-2 text-center"><Mark v={r.draws} /></td>
                  <td className="border-b border-[var(--border-base)] px-2 py-2 text-center"><Mark v={r.oop} /></td>
                  <td className="border-b border-[var(--border-base)] px-2 py-2 text-center"><Mark v={r.results} /></td>
                  <td className="border-b border-[var(--border-base)] px-2 py-2 text-center"><Mark v={r.stats} /></td>
                  <td className="border-b border-[var(--border-base)] px-2 py-2 text-center"><Mark v={r.bios} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          Legend: <Mark v="yes" /> full · <Mark v="partial" /> partial · <Mark v="maybe" /> maybe ·{' '}
          <Mark v="no" /> none
        </p>

        <h2>What each column means</h2>
        <h3>Live scores</h3>
        <p>
          Polling an active match every ~6 seconds for game-by-game score updates. Point-by-point
          data is reconstructed when the upstream widget exposes it.
        </p>
        <h3>Draws</h3>
        <p>
          The full bracket structure: seeded teams, qualifiers, wildcards, round-by-round matchups,
          final standings.
        </p>
        <h3>OOP (Order of Play)</h3>
        <p>
          Daily schedule. Court assignments, start times (or &quot;Not before&quot; / &quot;Followed
          by&quot; approximations). Scheduled times are stored in UTC and rendered in the viewer&apos;s
          local timezone.
        </p>
        <h3>Results</h3>
        <p>
          Final match state: set scores, retirements, walkovers, winner. Reconstructed from the
          reconciler&apos;s view of snapshot data — authoritative once the match is &quot;finished&quot;.
        </p>
        <h3>Match stats</h3>
        <p>
          Per-set and per-match breakdowns: first-serve percentage, breaks converted, return points won,
          etc. Source depends on level — Premier Padel has a dedicated endpoint; FIP levels typically
          don&apos;t publish this.
        </p>
        <h3>Player bios</h3>
        <p>
          Rich profile data: birthdate, hand, height, birthplace, playing side, avatar, and
          sponsorship info when available.
        </p>

        <Callout variant="note" title="Honesty about gaps">
          Every ✓ in this table has been validated against a live tournament. Every <Mark v="no" />{' '}
          or <Mark v="partial" /> means we genuinely don&apos;t have the data — not that we&apos;ve
          &quot;not got around to it.&quot; If we have partial data, we surface exactly what exists
          and mark the rest <code>null</code>.
        </Callout>

        <h2>Regional coverage</h2>
        <p>
          Most tracked events take place in Europe (Spain, Italy, France, Portugal, Netherlands,
          Belgium, Scandinavia) and Latin America (Argentina, Brazil, Chile, Paraguay, Mexico).
          Regional coverage follows the tours — as FIP expands into new regions (Asia, Africa,
          Oceania, the Middle East), our coverage expands with it. We don&apos;t cover events that
          don&apos;t publish via any of the tracked tours.
        </p>
      </Prose>
      <PrevNextLinks currentHref="/padelgodapi/coverage" />
    </article>
  )
}
