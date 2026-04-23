import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * match-identifier — resolves a Crionet widget match id to a canonical
 * `matches.id` UUID, creating the row if needed.
 *
 * Four-tier lookup:
 *   1. Widget-id direct lookup via `entity_external_ids`
 *      (source='crionet_widget').
 *   2. Padelapi-twin fallback — when padelapi sync has already populated a
 *      row (padelapi_id IS NOT NULL) for the same real-world match on the
 *      same court (case-insensitive), link our Crionet widget id to that
 *      row. Critical for Premier tournaments where our own Crionet
 *      entry-list returns "coming soon" but padelapi still owns the
 *      tournament: without this, every live tick for a match padelapi
 *      already knows about creates a duplicate thin row (no player FKs →
 *      "TBD" in UI).
 *   3. Pair-based fallback — match on unordered {pair1, pair2} player
 *      UUIDs within (tournament_id, category, round). Prevents duplicate
 *      match rows when the draw-reconciler created the row before the
 *      widget id was known. Skipped when any of the four player UUIDs is
 *      null.
 *   4. Fresh INSERT into `matches` + link via `entity_external_ids` using
 *      `onConflict: DO NOTHING` + re-SELECT for concurrent-create safety.
 */

const SOURCE = 'crionet_widget';
const ENTITY_TYPE = 'match';

export interface MatchIdentifierInput {
  tournamentId: string;
  tournamentWidgetId: string; // e.g. "FIP-2026-1701"
  matchWidgetId: string; // e.g. "MQ012"
  category: 'men' | 'women';
  roundLabel: string;
  court?: string | null;
  pair1PlayerIds?: [string | null, string | null];
  pair2PlayerIds?: [string | null, string | null];
}

export interface MatchIdentifierResult {
  matchId: string;
  created: boolean;
  linkedExisting: boolean; // true iff the pair-based fallback linked a pre-existing match
}

export interface Logger {
  warn: (...args: unknown[]) => void;
}

export interface FindOrCreateOptions {
  logger?: Logger;
}

function buildComposite(tournamentWidgetId: string, matchWidgetId: string): string {
  return `${tournamentWidgetId}:${matchWidgetId}`;
}

/**
 * Look up `entity_external_ids` for an existing widget-id mapping.
 * Returns the linked match_id (entity_id) or null.
 */
async function lookupByWidgetId(
  supabase: SupabaseClient,
  composite: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', ENTITY_TYPE)
    .eq('source', SOURCE)
    .eq('external_id', composite)
    .maybeSingle();

  if (error) {
    throw new Error(`entity_external_ids lookup failed: ${error.message}`);
  }
  return data?.entity_id ?? null;
}

interface MatchCandidate {
  id: string;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

function pairsMatchUnordered(
  candidate: MatchCandidate,
  widgetPair1: [string, string],
  widgetPair2: [string, string]
): boolean {
  const dbPair1 = new Set(
    [candidate.pair1_player1_id, candidate.pair1_player2_id].filter(
      (x): x is string => x !== null
    )
  );
  const dbPair2 = new Set(
    [candidate.pair2_player1_id, candidate.pair2_player2_id].filter(
      (x): x is string => x !== null
    )
  );
  if (dbPair1.size !== 2 || dbPair2.size !== 2) return false;

  const widget1 = new Set(widgetPair1);
  const widget2 = new Set(widgetPair2);

  const sameOrder = setEq(dbPair1, widget1) && setEq(dbPair2, widget2);
  const reversed = setEq(dbPair1, widget2) && setEq(dbPair2, widget1);
  return sameOrder || reversed;
}

function setEq(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * Pair-based fallback: find any `matches` row in (tournament_id, category, round)
 * scope whose pair1/pair2 UUID sets match the widget's pairs (unordered).
 *
 * Returns null if no candidates, the single candidate if exactly one matches,
 * or the one without an existing crionet_widget mapping if multiple match.
 */
async function findByPairs(
  supabase: SupabaseClient,
  input: MatchIdentifierInput,
  logger?: Logger
): Promise<MatchCandidate | null> {
  const p1 = input.pair1PlayerIds;
  const p2 = input.pair2PlayerIds;
  if (!p1 || !p2) return null;
  if (p1[0] === null || p1[1] === null || p2[0] === null || p2[1] === null) {
    return null;
  }
  const widgetPair1 = [p1[0], p1[1]] as [string, string];
  const widgetPair2 = [p2[0], p2[1]] as [string, string];

  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id'
    )
    .eq('tournament_id', input.tournamentId)
    .eq('category', input.category)
    .eq('round', input.roundLabel);

  if (error) {
    throw new Error(`matches pair lookup failed: ${error.message}`);
  }

  const candidates = (data ?? []) as MatchCandidate[];
  const matching = candidates.filter((c) =>
    pairsMatchUnordered(c, widgetPair1, widgetPair2)
  );

  if (matching.length === 0) return null;
  if (matching.length === 1) return matching[0]!;

  // Multiple candidates — prefer one without an existing crionet_widget mapping
  logger?.warn(
    {
      tournamentId: input.tournamentId,
      round: input.roundLabel,
      category: input.category,
      candidateIds: matching.map((c) => c.id),
    },
    'match-identifier: multiple pair-based candidates found; preferring unmapped'
  );

  const ids = matching.map((c) => c.id);
  const { data: mapped, error: mappedErr } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', ENTITY_TYPE)
    .eq('source', SOURCE)
    .in('entity_id', ids);

  if (mappedErr) {
    throw new Error(
      `entity_external_ids mapped-check failed: ${mappedErr.message}`
    );
  }

  const mappedIds = new Set((mapped ?? []).map((r: { entity_id: string }) => r.entity_id));
  const unmapped = matching.find((c) => !mappedIds.has(c.id));
  return unmapped ?? null;
}

interface TwinCandidate {
  id: string;
  scheduled_at: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

/**
 * Padelapi-twin fallback: find an existing padelapi-owned `matches` row
 * (padelapi_id IS NOT NULL) on the same (tournament_id, category, round)
 * whose `court` matches the widget's court string case-insensitively.
 *
 * Returns null when no court is provided, zero candidates, or when
 * multiple candidates remain ambiguous after filtering. When multiple
 * candidates exist but only one is unmapped (no crionet_widget external
 * id yet), that one is chosen. When multiple unmapped candidates exist
 * (e.g., same court hosts multiple matches on different slots), pick the
 * one whose `scheduled_at` is closest to NOW — that's the match currently
 * playing. Candidates with a NULL `scheduled_at` are treated as
 * infinitely distant so they never win the tiebreaker.
 *
 * Pair sanity check: if the widget input carries all four player UUIDs,
 * candidates are additionally filtered through `pairsMatchUnordered`.
 * This guards against court swaps — when the tournament moves match X
 * from court A to court B and our DB still has X on court A (because
 * padelapi hasn't pushed the update), a naive court-only lookup will
 * "hijack" whatever unrelated match Y is stored on court B. With the
 * pair check, a mismatched twin is rejected and the caller falls through
 * to `findByPairs`, which can link the widget to X regardless of its
 * stale court. Incident: Brussels P2 women R16 2026-04-23.
 */
async function findPadelapiTwin(
  supabase: SupabaseClient,
  input: MatchIdentifierInput,
  logger?: Logger
): Promise<string | null> {
  if (!input.court) return null;

  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id'
    )
    .eq('tournament_id', input.tournamentId)
    .eq('category', input.category)
    .eq('round', input.roundLabel)
    .ilike('court', input.court)
    .not('padelapi_id', 'is', null);

  if (error) {
    throw new Error(`padelapi-twin lookup failed: ${error.message}`);
  }

  let candidates = (data ?? []) as TwinCandidate[];
  if (candidates.length === 0) return null;

  // Pair sanity check — reject twins whose players don't match the widget's
  // pair. Only applied when all four player UUIDs are present in the input
  // (Premier live-poller path often omits them, which is fine — the court
  // match alone is the only signal available in that case).
  const p1 = input.pair1PlayerIds;
  const p2 = input.pair2PlayerIds;
  const haveFullPairs =
    !!p1 &&
    !!p2 &&
    p1[0] != null &&
    p1[1] != null &&
    p2[0] != null &&
    p2[1] != null;

  if (haveFullPairs) {
    const widgetPair1: [string, string] = [p1[0]!, p1[1]!];
    const widgetPair2: [string, string] = [p2[0]!, p2[1]!];
    const beforeCount = candidates.length;
    const rejected = candidates.filter(
      (c) => !pairsMatchUnordered(c, widgetPair1, widgetPair2)
    );
    candidates = candidates.filter((c) =>
      pairsMatchUnordered(c, widgetPair1, widgetPair2)
    );
    if (candidates.length === 0) {
      logger?.warn(
        {
          tournamentId: input.tournamentId,
          round: input.roundLabel,
          category: input.category,
          court: input.court,
          beforeCount,
          rejectedIds: rejected.map((c) => c.id),
        },
        'match-identifier: all padelapi twins on this court rejected by pair mismatch — falling through to pair-based lookup (likely court swap)'
      );
      return null;
    }
  }

  if (candidates.length === 1) return candidates[0]!.id;

  // Multi-candidate path — same court hosts several matches (different days/slots).
  // Prefer rows without an existing crionet_widget mapping to avoid hijacking
  // another live match's canonical row.
  const ids = candidates.map((c) => c.id);
  const { data: mapped, error: mappedErr } = await supabase
    .from('entity_external_ids')
    .select('entity_id')
    .eq('entity_type', ENTITY_TYPE)
    .eq('source', SOURCE)
    .in('entity_id', ids);

  if (mappedErr) {
    throw new Error(
      `padelapi-twin mapped-check failed: ${mappedErr.message}`
    );
  }

  const mappedIds = new Set(
    (mapped ?? []).map((r: { entity_id: string }) => r.entity_id)
  );
  const unmapped = candidates.filter((c) => !mappedIds.has(c.id));

  if (unmapped.length === 0) {
    // All candidates are already mapped elsewhere — don't hijack.
    logger?.warn(
      {
        tournamentId: input.tournamentId,
        round: input.roundLabel,
        category: input.category,
        court: input.court,
        candidateIds: ids,
      },
      'match-identifier: all padelapi twins already have crionet_widget mappings; skipping'
    );
    return null;
  }
  if (unmapped.length === 1) return unmapped[0]!.id;

  // Multiple unmapped — disambiguate by scheduled_at proximity to NOW.
  const now = Date.now();
  const withDelta = unmapped.map((c) => ({
    id: c.id,
    scheduled_at: c.scheduled_at,
    delta: c.scheduled_at
      ? Math.abs(new Date(c.scheduled_at).getTime() - now)
      : Number.POSITIVE_INFINITY,
  }));
  withDelta.sort((a, b) => a.delta - b.delta);
  const chosen = withDelta[0]!;

  logger?.warn(
    {
      tournamentId: input.tournamentId,
      round: input.roundLabel,
      category: input.category,
      court: input.court,
      candidateIds: unmapped.map((c) => c.id),
      chosen: chosen.id,
      chosenDeltaMs: chosen.delta,
    },
    'match-identifier: multiple unmapped padelapi twins — picking closest scheduled_at to now'
  );
  return chosen.id;
}

/**
 * Insert a new `matches` row with the available fields.
 * Player UUIDs may all be null (thin row — draws not processed yet).
 */
async function insertMatch(
  supabase: SupabaseClient,
  input: MatchIdentifierInput
): Promise<string> {
  const row: Record<string, unknown> = {
    tournament_id: input.tournamentId,
    category: input.category,
    round: input.roundLabel,
    court: input.court ?? null,
    pair1_player1_id: input.pair1PlayerIds?.[0] ?? null,
    pair1_player2_id: input.pair1PlayerIds?.[1] ?? null,
    pair2_player1_id: input.pair2PlayerIds?.[0] ?? null,
    pair2_player2_id: input.pair2PlayerIds?.[1] ?? null,
  };

  const { data, error } = await supabase
    .from('matches')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    throw new Error(`matches insert failed: ${error.message}`);
  }
  if (!data?.id) {
    throw new Error('matches insert returned no id');
  }
  return data.id as string;
}

/**
 * Link a match to its widget id via entity_external_ids.
 * Uses ON CONFLICT DO NOTHING; returns true if our INSERT won, false if
 * another writer won the race (caller should re-SELECT).
 */
async function linkWidgetId(
  supabase: SupabaseClient,
  matchId: string,
  composite: string
): Promise<boolean> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from('entity_external_ids')
    .upsert(
      {
        entity_type: ENTITY_TYPE,
        entity_id: matchId,
        source: SOURCE,
        external_id: composite,
        first_seen_at: nowIso,
        last_seen_at: nowIso,
      },
      {
        onConflict: 'source,entity_type,external_id',
        ignoreDuplicates: true,
      }
    )
    .select('entity_id');

  if (error) {
    throw new Error(`entity_external_ids upsert failed: ${error.message}`);
  }
  // ignoreDuplicates=true returns [] when a conflict occurred.
  return Array.isArray(data) && data.length > 0;
}

/**
 * FK short-circuit lookup: return the matching row's id IFF
 *   (a) an `entity_external_ids` mapping (source='crionet_widget') exists for
 *       `(tournamentWidgetId, matchWidgetId)`, AND
 *   (b) the linked `matches` row has ALL FOUR `pair{1,2}_player{1,2}_id` FKs
 *       populated.
 *
 * Used by the static-reconciler to bypass the `resolveFourNames` gate when
 * we already know the match identity. Needed for tournaments where Crionet's
 * entry-list returns "coming soon" (Premier), so `buildTournamentDictionary`
 * is empty and `resolveFourNames` can never succeed — but padelapi (or an
 * earlier reconciler run) has already populated the FKs, so results can be
 * written safely without re-resolving names.
 *
 * Returns null if the mapping is missing, the match row is missing, or any
 * FK is null. Callers that hit null should fall back to the name-resolution
 * path as before.
 */
export async function findLinkedMatchWithCompleteFks(
  supabase: SupabaseClient,
  tournamentWidgetId: string,
  matchWidgetId: string
): Promise<string | null> {
  const composite = buildComposite(tournamentWidgetId, matchWidgetId);
  const matchId = await lookupByWidgetId(supabase, composite);
  if (!matchId) return null;

  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id'
    )
    .eq('id', matchId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `findLinkedMatchWithCompleteFks: matches lookup failed: ${error.message}`
    );
  }
  if (!data) return null;

  const row = data as MatchCandidate;
  if (
    row.pair1_player1_id == null ||
    row.pair1_player2_id == null ||
    row.pair2_player1_id == null ||
    row.pair2_player2_id == null
  ) {
    return null;
  }
  return row.id;
}

export async function findOrCreateMatch(
  supabase: SupabaseClient,
  input: MatchIdentifierInput,
  opts: FindOrCreateOptions = {}
): Promise<MatchIdentifierResult> {
  const composite = buildComposite(input.tournamentWidgetId, input.matchWidgetId);

  // Step 2: widget-id direct lookup
  const existing = await lookupByWidgetId(supabase, composite);
  if (existing) {
    return { matchId: existing, created: false, linkedExisting: false };
  }

  // Step 2.5: padelapi-twin fallback
  const twinId = await findPadelapiTwin(supabase, input, opts.logger);
  if (twinId) {
    const won = await linkWidgetId(supabase, twinId, composite);
    if (!won) {
      // Race: another writer linked this widget id first. Pick their winner.
      const winner = await lookupByWidgetId(supabase, composite);
      if (winner) {
        return { matchId: winner, created: false, linkedExisting: false };
      }
      throw new Error(
        'match-identifier: widget-id upsert reported conflict but re-select returned null'
      );
    }
    return { matchId: twinId, created: false, linkedExisting: true };
  }

  // Step 3: pair-based fallback
  const paired = await findByPairs(supabase, input, opts.logger);
  if (paired) {
    const won = await linkWidgetId(supabase, paired.id, composite);
    if (!won) {
      // Race: someone else linked a (potentially different) match to this widget id.
      // Re-run the direct lookup to pick the winner.
      const winner = await lookupByWidgetId(supabase, composite);
      if (winner) {
        return { matchId: winner, created: false, linkedExisting: false };
      }
      // Extremely unlikely: upsert said conflict but re-select found nothing.
      throw new Error(
        'match-identifier: widget-id upsert reported conflict but re-select returned null'
      );
    }
    return { matchId: paired.id, created: false, linkedExisting: true };
  }

  // Step 4: create fresh match + link
  const newMatchId = await insertMatch(supabase, input);
  const won = await linkWidgetId(supabase, newMatchId, composite);
  if (!won) {
    // Concurrent create: another worker inserted a matches row AND linked it
    // before us. Our newMatchId is now an orphan thin row, but we return the
    // winner's id so the caller sees consistent state. (Orphan cleanup is out
    // of scope for this lib — a separate reconciler can sweep unlinked rows.)
    const winner = await lookupByWidgetId(supabase, composite);
    if (winner) {
      return { matchId: winner, created: false, linkedExisting: false };
    }
    throw new Error(
      'match-identifier: widget-id upsert reported conflict but re-select returned null'
    );
  }
  return { matchId: newMatchId, created: true, linkedExisting: false };
}
