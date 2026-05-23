'use client'
// apps/ops/src/app/(app)/players/[id]/_components/EarningsSection.tsx
// Earnings grouped by year (DESC), with per-year subtotals and an all-time
// total in the heading. The aggregator orders rows by `earned_at` DESC; the
// `player_tournament_earnings` table has no `year` column, so we derive the
// year client-side from `earned_at` (TIMESTAMPTZ).
//
// Amounts come from `per_player_eur` (per-player split, already in EUR).
// Null amounts are treated as 0 in both totals and per-row rendering so a
// missing payout never NaN's the heading.

export interface Earning {
  id: string
  tournament_id: string
  category: string | null
  round_eliminated: string | null
  per_player_eur: number | null
  source: string | null
  earned_at: string
  tournament: { name: string; level: string | null } | null
}

const eurFormat = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

export default function EarningsSection({ earnings }: { earnings: Earning[] }) {
  const allTime = earnings.reduce((sum, e) => sum + (e.per_player_eur ?? 0), 0)

  if (earnings.length === 0) {
    return (
      <section className="bg-white border border-gray-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-gray-900 mb-2">Earnings</h2>
        <div className="text-xs text-gray-400">No earnings recorded.</div>
      </section>
    )
  }

  // Group rows by year derived from earned_at. Map preserves insertion order;
  // since the aggregator already sorts earned_at DESC the year keys arrive
  // newest-first, but we still sort explicitly so a future re-order upstream
  // doesn't silently flip the section.
  const byYear = new Map<number, Earning[]>()
  for (const e of earnings) {
    const year = e.earned_at ? new Date(e.earned_at).getFullYear() : NaN
    if (Number.isNaN(year)) continue // skip malformed / missing earned_at
    const bucket = byYear.get(year)
    if (bucket) bucket.push(e)
    else byYear.set(year, [e])
  }
  const years = [...byYear.keys()].sort((a, b) => b - a)

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-4">
      <h2 className="text-sm font-semibold text-gray-900 mb-3">
        Earnings — {eurFormat.format(allTime)} all-time
      </h2>
      <div className="space-y-4">
        {years.map((year) => {
          const rows = byYear.get(year) ?? []
          const subtotal = rows.reduce(
            (sum, e) => sum + (e.per_player_eur ?? 0),
            0,
          )
          return (
            <div key={year}>
              <h3 className="text-xs font-semibold text-gray-700 mb-1.5">
                {year} — {eurFormat.format(subtotal)}
              </h3>
              <ul className="text-xs">
                {rows.map((e) => (
                  <li
                    key={e.id}
                    className="flex justify-between py-1 border-b border-gray-50 last:border-b-0"
                  >
                    <span className="text-gray-900">
                      {e.tournament?.name ?? e.tournament_id}
                    </span>
                    <span className="text-gray-700 tabular-nums">
                      {eurFormat.format(e.per_player_eur ?? 0)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </section>
  )
}
