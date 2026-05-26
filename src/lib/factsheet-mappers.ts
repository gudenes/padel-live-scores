// src/lib/factsheet-mappers.ts
// Pure helpers that map raw factsheet PDF extractions (the
// `factsheet_data` JSONB blob) into canonical column shapes so
// /api/cron/process-factsheets can write to source-priority-gated columns
// instead of leaving the data marooned in factsheet_data alone.
//
// Why this exists:
//   The factsheet pipeline used to write ONLY to factsheet_data (raw
//   audit). Canonical columns like `prize_breakdown` kept their
//   HTML-scraped values, which were buggy for FIP events using European
//   number formatting (9.375 misread as 9.38, 421,88 misread as 42188 —
//   see padelgod/src/parsers/fip-event-page-detail.ts:367). These mappers
//   make the factsheet the authoritative source, with source-priority.ts
//   listing `factsheet_pdf` above `fip` for those fields. The HTML
//   scrape's `source: 'scraped'` (a `fip` source) loses to
//   `source: 'factsheet_pdf'` on conflict.
//
// Design notes:
//   - Pure, side-effect-free, easy to TDD.
//   - Returning `null` is the "do not write" signal — callers should
//     skip the column when this happens (vs. writing an empty object).
//   - Qualifying-round rows (q1/q2/last_of_qualy) are intentionally
//     dropped because `prize_breakdown`'s schema only covers main-draw
//     rounds. They stay in `factsheet_data.prize_money` as audit.

/**
 * Raw row shape produced by /api/cron/process-factsheets in
 * `factsheet_data.prize_money`. `round_label` is free-form from the PDF
 * (Claude prefers the enum hints in the prompt but isn't bound to them).
 * Either money field can be null when the PDF lists a round without a
 * payout (qualifying rounds, typically).
 */
export interface FactsheetPrizeRow {
  round_label?: string
  per_player_eur?: number | null
  total_pair_eur?: number | null
}

/**
 * Canonical `prize_breakdown` JSONB shape. Round keys are the same short
 * codes used by padelgod's `parsePrizeBreakdown` output (winner,
 * finalist, sf, qf, r16, r32, r64, r128). `source` is the data
 * provenance the source-priority guard reads.
 */
export interface PrizeBreakdown {
  [round: string]: number | string | undefined
  currency: string
  per: string
  source: string
}

/**
 * Mapping from factsheet round labels (Claude PDF output) to canonical
 * prize_breakdown keys. Lower-cased on lookup. Qualifying rounds are
 * intentionally absent — see file header for the reasoning.
 */
const LABEL_TO_KEY: Record<string, string> = {
  winner: 'winner',
  finalist: 'finalist',
  semifinalist: 'sf',
  quarterfinalist: 'qf',
  round_16: 'r16',
  round_32: 'r32',
  round_64: 'r64',
  round_128: 'r128',
}

/**
 * Map a factsheet `prize_money` array to canonical `prize_breakdown`.
 *
 * Behavior:
 *  - Drops rows whose `round_label` isn't a recognized main-draw round.
 *  - Drops rows whose `per_player_eur` is null/non-finite (qualifying
 *    rounds typically come back with null amounts).
 *  - Returns `null` when no recognized rows survive — caller should
 *    NOT write the column in that case.
 *  - Otherwise returns the canonical object with `source: 'factsheet_pdf'`
 *    so the source-priority guard knows which pipeline produced it.
 *
 * NOTE: `per_player_eur` is used (not `total_pair_eur`) because canonical
 * `prize_breakdown` is per-player by convention (`per: 'player'`).
 */
export function mapFactsheetPrize(
  rows: FactsheetPrizeRow[] | null | undefined,
): PrizeBreakdown | null {
  if (!Array.isArray(rows) || rows.length === 0) return null
  const out: Record<string, number> = {}
  let hits = 0
  for (const r of rows) {
    if (!r || typeof r.round_label !== 'string') continue
    const key = LABEL_TO_KEY[r.round_label.toLowerCase()]
    if (!key) continue
    if (typeof r.per_player_eur !== 'number' || !Number.isFinite(r.per_player_eur)) continue
    out[key] = r.per_player_eur
    hits++
  }
  if (hits === 0) return null
  return {
    ...out,
    currency: 'EUR',
    per: 'player',
    source: 'factsheet_pdf',
  }
}
