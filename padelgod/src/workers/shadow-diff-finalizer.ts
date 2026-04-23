import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  inferWinnerFromSets,
  joinedScoreString,
  type SetRow,
} from '../lib/shadow-winner-inference.js';
import {
  normalizePadelapiPoint,
  normalizePadelgodPoint,
  pointEq,
  type CanonicalPoint,
} from '../lib/point-normalizer.js';

export interface ShadowDiffFinalizerDeps {
  supabase: SupabaseClient;
  logger?: Logger;
}

export interface ShadowDiffFinalizerResult {
  finalStateRowsWritten: number;
  perPointRowsWritten: number;
  matchesConsidered: number;
}

interface CandidateMatch {
  id: string;
  tournament_id: string;
  winner_pair: number | null;
}

interface PublicSetRow {
  id: string;
  match_id: string;
  set_number: number;
  set_score: string | null;
  pair1_games: number | null;
  pair2_games: number | null;
}

interface ShadowSetRow {
  match_id: string;
  set_number: number;
  set_score: string | null;
  pair1_games: number | null;
  pair2_games: number | null;
}

interface ShadowMatchPointRow {
  match_id: string;
  set_number: number;
  game_number: number;
  point_number: number;
  score_after: string;
}

interface PublicGameRow {
  match_id: string;
  set_id: string;
  game_number: number;
  points: string[] | null;
}

interface ExistingDiffRow {
  match_id: string;
  comparison_type: string;
}

interface ShadowDiffInsertBase {
  tournament_id: string;
  match_id: string;
  comparison_type: 'final_state' | 'per_point_sequence';
  divergence_reason: string | null;
}

interface FinalStateDiffInsert extends ShadowDiffInsertBase {
  comparison_type: 'final_state';
  padelapi_winner_pair: number | null;
  padelgod_winner_pair: number | null;
  winner_match: boolean;
  padelapi_final_score: string;
  padelgod_final_score: string;
  score_match: boolean;
}

interface PerPointDiffInsert extends ShadowDiffInsertBase {
  comparison_type: 'per_point_sequence';
  padelapi_point_count: number;
  padelgod_point_count: number;
  point_sequence_match: boolean;
  first_divergence_index: number | null;
  first_divergence_detail: string | null;
}

/**
 * Runs the shadow-diff finalizer: for every finished match inside a
 * shadow-enrolled tournament, computes two comparison types if they haven't
 * already been written:
 *
 *   1. `final_state` — winner_pair + joined set-score string agreement between
 *      canonical padelapi data and inferred padelgod shadow data.
 *   2. `per_point_sequence` — element-wise comparison of padelapi `points[]`
 *      (from `public.games`, concatenated in set/game order) vs padelgod
 *      `shadow_match_points.score_after`, after normalizing both via the shared
 *      `CanonicalPoint` shape.
 *
 * Idempotent via partial unique indexes in migration 019 — a second run for
 * the same match is a no-op.
 */
export async function runShadowDiffFinalizer(
  deps: ShadowDiffFinalizerDeps
): Promise<ShadowDiffFinalizerResult> {
  const { supabase, logger } = deps;

  // Step 1: which tournaments are shadow-enrolled?
  const { data: tourRows, error: tourErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('shadow_enabled', true);
  if (tourErr) {
    throw new Error(`tournaments read failed: ${tourErr.message}`);
  }
  const tourIds = ((tourRows ?? []) as { id: string }[]).map((r) => r.id);
  if (tourIds.length === 0) {
    return { finalStateRowsWritten: 0, perPointRowsWritten: 0, matchesConsidered: 0 };
  }

  // Step 2: candidate finished matches in those tournaments.
  const { data: matchRows, error: matchErr } = await supabase
    .from('matches')
    .select('id, tournament_id, winner_pair')
    .eq('status', 'finished')
    .in('tournament_id', tourIds);
  if (matchErr) {
    throw new Error(`matches read failed: ${matchErr.message}`);
  }
  const matches = (matchRows ?? []) as CandidateMatch[];
  if (matches.length === 0) {
    return { finalStateRowsWritten: 0, perPointRowsWritten: 0, matchesConsidered: 0 };
  }

  const matchIds = matches.map((m) => m.id);

  // Step 3: what diffs have already been written?
  const { data: existingDiffRows, error: existErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .select('match_id, comparison_type')
    .in('match_id', matchIds);
  if (existErr) {
    throw new Error(`shadow_diff read failed: ${existErr.message}`);
  }
  const existing = new Set<string>();
  for (const row of (existingDiffRows ?? []) as ExistingDiffRow[]) {
    existing.add(`${row.match_id}::${row.comparison_type}`);
  }

  let finalStateRowsWritten = 0;
  let perPointRowsWritten = 0;

  for (const match of matches) {
    // ── final_state ────────────────────────────────────────────────────────
    const finalKey = `${match.id}::final_state`;
    if (!existing.has(finalKey)) {
      const wrote = await computeAndWriteFinalState(supabase, match, logger);
      if (wrote) finalStateRowsWritten += 1;
    }

    // ── per_point_sequence ─────────────────────────────────────────────────
    const perPointKey = `${match.id}::per_point_sequence`;
    if (!existing.has(perPointKey)) {
      const wrote = await computeAndWritePerPoint(supabase, match, logger);
      if (wrote) perPointRowsWritten += 1;
    }
  }

  logger?.info(
    {
      matchesConsidered: matches.length,
      finalStateRowsWritten,
      perPointRowsWritten,
    },
    'shadow-diff-finalizer run complete'
  );

  return {
    finalStateRowsWritten,
    perPointRowsWritten,
    matchesConsidered: matches.length,
  };
}

// ─── final_state comparison ─────────────────────────────────────────────────

async function computeAndWriteFinalState(
  supabase: SupabaseClient,
  match: CandidateMatch,
  logger?: Logger
): Promise<boolean> {
  // Canonical sets.
  const { data: publicSetsRaw, error: pubSetsErr } = await supabase
    .from('sets')
    .select('id, match_id, set_number, set_score, pair1_games, pair2_games')
    .eq('match_id', match.id)
    .order('set_number', { ascending: true });
  if (pubSetsErr) {
    throw new Error(
      `public.sets read failed (match=${match.id}): ${pubSetsErr.message}`
    );
  }
  const publicSets = (publicSetsRaw ?? []) as PublicSetRow[];

  // Shadow sets.
  const { data: shadowSetsRaw, error: shadowErr } = await supabase
    .schema('padelgod')
    .from('shadow_sets')
    .select('match_id, set_number, set_score, pair1_games, pair2_games')
    .eq('match_id', match.id)
    .order('set_number', { ascending: true });
  if (shadowErr) {
    throw new Error(
      `shadow_sets read failed (match=${match.id}): ${shadowErr.message}`
    );
  }
  const shadowSets = (shadowSetsRaw ?? []) as ShadowSetRow[];

  const padelapiWinnerPair = match.winner_pair;
  const padelgodWinnerPair = inferWinnerFromSets(shadowSets as SetRow[]);
  const winnerMatch =
    padelapiWinnerPair != null &&
    padelgodWinnerPair != null &&
    padelapiWinnerPair === padelgodWinnerPair;

  const padelapiFinalScore = joinedScoreString(publicSets as SetRow[]);
  const padelgodFinalScore = joinedScoreString(shadowSets as SetRow[]);
  const scoreMatch =
    padelapiFinalScore.length > 0 &&
    padelgodFinalScore.length > 0 &&
    padelapiFinalScore === padelgodFinalScore;

  let divergenceReason: string | null = null;
  if (shadowSets.length === 0) {
    divergenceReason = 'missing_sets_in_shadow';
  } else if (!winnerMatch) {
    divergenceReason = 'winner_disagreement';
  } else if (!scoreMatch) {
    divergenceReason = 'set_score_diff';
  }

  const insertRow: FinalStateDiffInsert = {
    tournament_id: match.tournament_id,
    match_id: match.id,
    comparison_type: 'final_state',
    padelapi_winner_pair: padelapiWinnerPair,
    padelgod_winner_pair: padelgodWinnerPair,
    winner_match: winnerMatch,
    padelapi_final_score: padelapiFinalScore,
    padelgod_final_score: padelgodFinalScore,
    score_match: scoreMatch,
    divergence_reason: divergenceReason,
  };

  const { error: insErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .insert(insertRow);
  if (insErr) {
    // Duplicate-key (Postgres 23505) against the partial unique index
    // `uniq_shadow_diff_final` just means the row was already computed on
    // a previous run — the comparison is idempotent and finalized, so
    // there's nothing to do. This is BY FAR the most common outcome once
    // the backlog is caught up (observed ~230 / 1.5h on Brussels day).
    // Log at debug only so prod logs stay focused on real issues; retain
    // warn for any other failure (schema drift, connectivity, etc.).
    const isDuplicate = (insErr as { code?: string }).code === '23505';
    if (isDuplicate) {
      logger?.debug(
        { matchId: match.id, type: 'final_state' },
        'shadow_diff final_state already computed — skipping'
      );
    } else {
      logger?.warn(
        { err: insErr.message, code: (insErr as { code?: string }).code, matchId: match.id, type: 'final_state' },
        'shadow_diff final_state insert failed'
      );
    }
    return false;
  }
  return true;
}

// ─── per_point_sequence comparison ──────────────────────────────────────────

async function computeAndWritePerPoint(
  supabase: SupabaseClient,
  match: CandidateMatch,
  logger?: Logger
): Promise<boolean> {
  // Shadow points first — if empty, skip (task spec: only run when ≥1 exists).
  const { data: shadowPointsRaw, error: sppErr } = await supabase
    .schema('padelgod')
    .from('shadow_match_points')
    .select('match_id, set_number, game_number, point_number, score_after')
    .eq('match_id', match.id)
    .order('set_number', { ascending: true })
    .order('game_number', { ascending: true })
    .order('point_number', { ascending: true });
  if (sppErr) {
    throw new Error(
      `shadow_match_points read failed (match=${match.id}): ${sppErr.message}`
    );
  }
  const shadowPoints = (shadowPointsRaw ?? []) as ShadowMatchPointRow[];
  if (shadowPoints.length === 0) return false;

  // Canonical: fetch sets (for set_number ordering) + games.
  const { data: setsRaw, error: setsErr } = await supabase
    .from('sets')
    .select('id, set_number')
    .eq('match_id', match.id);
  if (setsErr) {
    throw new Error(
      `public.sets read failed (match=${match.id}): ${setsErr.message}`
    );
  }
  const setIdToSetNumber = new Map<string, number>();
  for (const s of (setsRaw ?? []) as { id: string; set_number: number }[]) {
    setIdToSetNumber.set(s.id, s.set_number);
  }

  const { data: gamesRaw, error: gamesErr } = await supabase
    .from('games')
    .select('match_id, set_id, game_number, points')
    .eq('match_id', match.id);
  if (gamesErr) {
    throw new Error(
      `public.games read failed (match=${match.id}): ${gamesErr.message}`
    );
  }
  const games = (gamesRaw ?? []) as PublicGameRow[];

  // Order games by (set_number via map, game_number) — games not tied to a
  // known set_id are placed after all known sets by assigning Infinity.
  games.sort((a, b) => {
    const sa = setIdToSetNumber.get(a.set_id) ?? Number.POSITIVE_INFINITY;
    const sb = setIdToSetNumber.get(b.set_id) ?? Number.POSITIVE_INFINITY;
    if (sa !== sb) return sa - sb;
    return a.game_number - b.game_number;
  });

  // Build padelapi point string array by concatenating games[].points in order.
  const padelapiRawPoints: string[] = [];
  for (const g of games) {
    if (g.points == null) continue;
    for (const pt of g.points) padelapiRawPoints.push(pt);
  }

  // Normalize both sides, silently skipping unparseable entries (they may be
  // non-point markers like 'Game' that padelapi emits as delimiters).
  const padelapiCanonical: CanonicalPoint[] = [];
  for (const raw of padelapiRawPoints) {
    try {
      padelapiCanonical.push(normalizePadelapiPoint(raw));
    } catch {
      // Skip unparseable — probably a delimiter token.
    }
  }

  const padelgodCanonical: CanonicalPoint[] = [];
  for (const row of shadowPoints) {
    try {
      padelgodCanonical.push(normalizePadelgodPoint(row.score_after));
    } catch {
      // Skip unparseable.
    }
  }

  const lenA = padelapiCanonical.length;
  const lenB = padelgodCanonical.length;

  let firstDivergenceIndex: number | null = null;
  let firstDivergenceDetail: string | null = null;

  const overlap = Math.min(lenA, lenB);
  for (let i = 0; i < overlap; i++) {
    if (!pointEq(padelapiCanonical[i]!, padelgodCanonical[i]!)) {
      firstDivergenceIndex = i;
      firstDivergenceDetail = `point ${i + 1}: padelapi=${padelapiRawPoints[i]}, padelgod=${shadowPoints[i]!.score_after}`;
      break;
    }
  }

  if (firstDivergenceIndex === null && lenA !== lenB) {
    firstDivergenceIndex = overlap;
    firstDivergenceDetail = `sequence length mismatch: padelapi=${lenA}, padelgod=${lenB}`;
  }

  const pointSequenceMatch =
    firstDivergenceIndex === null && lenA === lenB;

  const insertRow: PerPointDiffInsert = {
    tournament_id: match.tournament_id,
    match_id: match.id,
    comparison_type: 'per_point_sequence',
    padelapi_point_count: lenA,
    padelgod_point_count: lenB,
    point_sequence_match: pointSequenceMatch,
    first_divergence_index: firstDivergenceIndex,
    first_divergence_detail: firstDivergenceDetail,
    divergence_reason: pointSequenceMatch ? null : 'point_sequence_mismatch',
  };

  const { error: insErr } = await supabase
    .schema('padelgod')
    .from('shadow_diff')
    .insert(insertRow);
  if (insErr) {
    // Same idempotent semantics as final_state above (see that comment
    // for the full rationale). Duplicate-key against the partial unique
    // index `uniq_shadow_diff_per_point` = already computed = OK, log
    // at debug. Anything else is a real failure → warn.
    const isDuplicate = (insErr as { code?: string }).code === '23505';
    if (isDuplicate) {
      logger?.debug(
        { matchId: match.id, type: 'per_point_sequence' },
        'shadow_diff per_point_sequence already computed — skipping'
      );
    } else {
      logger?.warn(
        { err: insErr.message, code: (insErr as { code?: string }).code, matchId: match.id, type: 'per_point_sequence' },
        'shadow_diff per_point_sequence insert failed'
      );
    }
    return false;
  }
  return true;
}
