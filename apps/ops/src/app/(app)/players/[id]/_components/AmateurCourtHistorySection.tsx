'use client'
// apps/ops/src/app/(app)/players/[id]/_components/AmateurCourtHistorySection.tsx
// Sibling to MatchHistorySection, rendered instead of it when the player is
// tier='amateur'. Deliberately a separate component rather than a branch
// inside MatchHistorySection: the two rows shapes are genuinely different —
// a tour match has an opponent and a per-set score, a team-league court has
// neither, only a round, a court block, won/lost, and how many sets it
// lasted. Forcing them into one row type would mean inventing fields for
// data that doesn't exist.
//
// "Match history" is the wrong vocabulary here — there's no 1v1 opponent,
// just a team fielded across five courts per round — so the panel heading
// is "Team court history" instead.

import { Panel } from '@/components/ui'

export interface AmateurCourtHistoryPartner {
  id: string
  name: string
}

export interface AmateurCourtHistoryRow {
  slotId: string
  seasonLabel: string
  teamName: string
  fixtureCode: string
  fixtureLabel: string
  fixtureComplete: boolean
  worth: number
  result: 'W' | 'L' | null
  sets: number | null
  /** True only when this court's pairing is certain (see courtBlockLabel note below). */
  exact: boolean
  courtCount: number
  partners: AmateurCourtHistoryPartner[]
}

function courtBlockLabel(worth: number): string {
  if (worth === 3) return 'Courts 1–2'
  if (worth === 2) return 'Courts 3–5'
  return `Worth ${worth}`
}

function PartnersCell({ row }: { row: AmateurCourtHistoryRow }) {
  if (row.partners.length === 0) {
    return <span style={{ color: 'var(--text-3)' }}>—</span>
  }
  const names = row.partners.map((p) => p.name).join(', ')
  if (row.exact) {
    return <span style={{ color: 'var(--text-1)' }}>{names}</span>
  }
  // A slot spanning more than one court (or an unconfirmed pairing) can't
  // pin down who actually partnered whom — surface that as a possibility,
  // never as fact.
  return (
    <span
      style={{ color: 'var(--text-3)', fontStyle: 'italic' }}
      title="Court count > 1 or pairing unconfirmed in the import — this list of names is a possibility, not a confirmed pairing."
    >
      Possibly: {names}
    </span>
  )
}

export default function AmateurCourtHistorySection({
  games,
}: {
  games: AmateurCourtHistoryRow[]
}) {
  if (games.length === 0) {
    return (
      <Panel title="Team court history">
        <div className="text-xs" style={{ color: 'var(--text-3)' }}>
          No court appearances found.
        </div>
      </Panel>
    )
  }

  return (
    <Panel title={`Team court history (${games.length})`}>
      <table className="w-full text-xs">
        <thead
          className="border-b"
          style={{ color: 'var(--text-3)', borderColor: 'var(--border-inner)' }}
        >
          <tr>
            <th className="text-left font-medium py-1.5">Team / Season</th>
            <th className="text-left font-medium">Round</th>
            <th className="text-left font-medium">Court</th>
            <th className="text-left font-medium">Result</th>
            <th className="text-left font-medium">Sets</th>
            <th className="text-left font-medium">Partner(s)</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr
              key={g.slotId}
              className="border-b"
              style={{ borderColor: 'var(--border-inner)' }}
            >
              <td className="py-1.5" style={{ color: 'var(--text-2)' }}>
                {g.teamName} <span style={{ color: 'var(--text-3)' }}>({g.seasonLabel})</span>
              </td>
              <td style={{ color: 'var(--text-1)' }}>
                {g.fixtureCode}
                {!g.fixtureComplete && (
                  <span
                    className="ml-1.5 px-1 py-0.5 rounded"
                    style={{
                      fontSize: 10,
                      color: 'var(--text-3)',
                      border: '1px solid var(--border-card)',
                    }}
                    title="This round isn't fully recorded yet — treat it as a partial record."
                  >
                    Partial
                  </span>
                )}
              </td>
              <td style={{ color: 'var(--text-3)' }}>{courtBlockLabel(g.worth)}</td>
              <td
                className={g.result === 'W' ? 'font-semibold' : undefined}
                style={{
                  color:
                    g.result === 'W'
                      ? 'var(--lime-text)'
                      : g.result === 'L'
                        ? 'var(--text-3)'
                        : 'var(--text-3)',
                }}
              >
                {g.result ?? '—'}
              </td>
              <td style={{ color: 'var(--text-3)' }}>{g.sets ?? '—'}</td>
              <td>
                <PartnersCell row={g} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
