// Row → Candidate mapping for the market generator.

import { FIXED_SEED_SOURCE, type Candidate } from './market-gates.js'

export interface MatchRow {
  id: string
  tournament_id: string | null
  category: string | null
  round: string | null
  /** Normalised round — 'SF', 'F', 'QF', 'R32'. `round` itself is free-text
   *  from upstream scrapers ('Semifinals', 'SemiFinals', 'Finals', 'Final',
   *  'Quarter', 'Quarterfinals'), so gates must never compare against it. */
  round_canonical: string | null
  scheduled_at: string | null
  /** PostgREST returns numeric columns as strings. */
  pred_pair1_prob: string | number | null
  pair1_player1_id: string | null
  pair1_player2_id: string | null
  pair2_player1_id: string | null
  pair2_player2_id: string | null
}

function bestRanking(row: MatchRow, ranks: Map<string, number>): number | null {
  const ids = [
    row.pair1_player1_id, row.pair1_player2_id,
    row.pair2_player1_id, row.pair2_player2_id,
  ]
  let best: number | null = null
  for (const id of ids) {
    if (!id) continue
    const r = ranks.get(id)
    if (typeof r !== 'number') continue
    if (best === null || r < best) best = r
  }
  return best
}

/**
 * How a template prices the market it opens.
 *
 * `source` is `market_templates.seed_source` verbatim. `fixedProb` is only
 * meaningful for `seed_source='fixed'` and carries the constant the template
 * ships in its params.
 */
export interface SeedSpec {
  source: string
  fixedProb: number | null
}

/**
 * The seed spec of every template that existed before fixed seeds did. Not a
 * guess about a template that forgot to declare one — `seed_source` is NOT NULL
 * with a CHECK, so this default only ever applies to callers that predate the
 * parameter (the unit tests, which are all exercising the elo path).
 */
export const ELO_SEED: SeedSpec = { source: 'elo', fixedProb: null }

/**
 * Read `params.seedProb` off a template.
 *
 * Anything that is not a probability strictly inside (0,1) reads as ABSENT, so
 * a mistyped param makes the gate reject the candidate with "no seed price
 * available" rather than seeding a market at NaN — `seed_prob` carries a
 * CHECK (> 0 AND < 1) and `seedShares` takes ln() of it.
 */
export function fixedSeedProb(params: Record<string, unknown> | null | undefined): number | null {
  const raw = params?.seedProb
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n) || n <= 0 || n >= 1) return null
  return n
}

/** The seed spec for one template row, as the generator reads it. */
export function seedSpecForTemplate(t: {
  seed_source: string
  params: Record<string, unknown>
}): SeedSpec {
  return {
    source: t.seed_source,
    fixedProb: t.seed_source === FIXED_SEED_SOURCE ? fixedSeedProb(t.params) : null,
  }
}

export function matchRowToCandidate(
  row: MatchRow,
  ranks: Map<string, number>,
  templateKey: string,
  subsidyGuacas: number,
  seed: SeedSpec = ELO_SEED,
): Candidate {
  const raw = row.pred_pair1_prob
  const prob = raw === null || raw === undefined ? null : Number(raw)
  const modelProb = prob !== null && Number.isFinite(prob) ? prob : null

  const fixed = seed.source === FIXED_SEED_SOURCE

  return {
    key: `${templateKey}:${row.id}`,
    matchId: row.id,
    tournamentId: row.tournament_id,
    category: row.category === 'women' ? 'women' : row.category === 'men' ? 'men' : null,
    round: row.round_canonical,
    bestRanking: bestRanking(row, ranks),
    // A fixed-seed template asks a question `pred_pair1_prob` does not answer,
    // so the model opinion is DROPPED rather than carried across to it. This is
    // what keeps the competitiveness band and the closeness score from reading
    // a winner probability as if it were about sets.
    modelProb: fixed ? null : modelProb,
    seedSource: seed.source,
    seedProb: fixed ? seed.fixedProb : modelProb,
    scheduledAt: row.scheduled_at ? new Date(row.scheduled_at) : null,
    subsidyGuacas,
  }
}
