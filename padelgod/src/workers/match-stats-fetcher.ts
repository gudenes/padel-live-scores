// match-stats-fetcher — polls Crionet's POST /screen/getmatchstats for finished
// matches that have a `crionet_widget` entity_external_ids mapping and no
// `source='crionet_widget'` row in `public.match_stats` yet. Parses the 14
// stat dimensions × (match aggregate + per-set) tabs via parseCrionetMatchStats
// and writes the full schema column set to match_stats.
//
// COVERAGE — PREMIER-TIER ONLY
// ----------------------------
// Crionet publishes per-match stats ONLY for Premier-tier events: P1, P2,
// Major, Premier_Mens, Premier_Womens. FIP-tier (Bronze / Silver / Gold)
// matches still get entity_external_ids → crionet_widget mappings during
// discovery, but the stats endpoint returns nothing useful for them. The
// worker hard-filters to Premier-tier before any HTTP call so we don't:
//   - waste a request to Crionet per FIP match every cron tick,
//   - burn slots in the 20-match-per-run batch budget on non-eligible rows
//     (which would starve genuinely eligible Premier matches), or
//   - pollute scrape_jobs with no-op runs.
// `result.skippedNonPremier` surfaces the count for observability. If a new
// stats source ever covers FIP-tier, widen `isPremierTier()` accordingly.
//
// Design notes:
// - The parser returns 8 counts and 6 percentages. Counts (service_games,
//   return_games, longest_streak) map 1:1 to count columns. Percentages
//   (total_points_won, won_on_1st/2nd_serve, won_on_1st/2nd_return,
//   total_won_on_serve, total_won_on_return) are stored as `(value, 100)`
//   pairs — same convention `/api/match-stats` uses for padelapi-sourced
//   rows, so the UI's `kind="percentage"` bars render identically regardless
//   of source.
// - aces / double_faults / break_points_converted / total_points have no
//   schema columns and are dropped (the UI doesn't display them).
// - source='crionet_widget' marks these rows. Legacy non-crionet rows
//   (premierpadel, padelapi) are overwritten on the next run so they pick up
//   the full column coverage.
// - Batch size caps at MATCH_STATS_BATCH_SIZE per run so we don't hammer the
//   Crionet widget endpoint.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetMatchStats, type ParsedMatchStats } from '../parsers/crionet-match-stats.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_MATCH_STATS_VERSION } from '../lib/parser-versions.js';

export interface MatchStatsFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  /** When set, only matches belonging to a tournament in the allowlist
   *  are processed. Used by the on-demand refresh endpoint. */
  onlyTournamentIds?: Set<string>;
}

export interface MatchStatsFetcherResult {
  candidatesSeen: number;
  fetched: number;
  skipped: number;
  rowsUpserted: number;
  /** Mappings dropped because the match's tournament wasn't Premier-tier
   *  (Crionet only publishes stats for P1/P2/Major/Premier_*). Tracked
   *  separately from the general `skipped` counter so a healthy run on a
   *  mostly-FIP day doesn't look like a regression. */
  skippedNonPremier: number;
}

/**
 * Whether a tournament's `level` column denotes a Premier-tier event.
 *
 * Premier-tier (P1 / P2 / Major / Premier_Mens / Premier_Womens) is the
 * ONLY tier Crionet exposes per-match stats for. FIP-tier (Bronze / Silver
 * / Gold) tournaments return no useful data from the stats endpoint and
 * are filtered out before any HTTP call.
 *
 * Case-insensitive prefix match — `level` strings come from upstream
 * sources in mixed case (e.g. "P1", "Premier_Mens", "Major", "Bronze").
 */
export function isPremierTier(level: string | null): boolean {
  if (!level) return false;
  const n = level.toLowerCase();
  return (
    n.startsWith('p1') ||
    n.startsWith('p2') ||
    n.startsWith('major') ||
    n.startsWith('premier')
  );
}

const STATS_URL = 'https://widget.matchscorerlive.com/screen/getmatchstats?t=tol';
const MATCH_STATS_BATCH_SIZE = 20;

// Maximum number of UUID ids to pass to a single PostgREST `.in()` filter.
//
// 36-char UUIDs + commas at ~37 chars each. Nginx's default request-line
// limit is 8KB; PostgREST + supabase-js adds a few hundred bytes of
// overhead per request (URL prefix, JWT in headers, base PostgREST params).
// 200 ids → ~7.4KB worst case, comfortably under the limit on every
// hosted PostgREST deployment we've seen.
//
// Before this cap existed, the cron path passed every crionet_widget
// match mapping (2,041 ids by 2026-05-16) to a single `.in('id', […])`
// call. The query 414'd silently and the worker hadn't written a single
// match_stats row in five days — see BUE-P1 incident.
const IN_FILTER_CHUNK_SIZE = 200;

/**
 * Run `query(ids)` against successive 200-id slices of `allIds`,
 * accumulating returned IDs into a `Set`. Empty input returns an empty set.
 *
 * Used to filter very large id lists through PostgREST `.in()` without
 * blowing the URL-length budget. The accumulator pattern fits both
 * call sites — both `fetchFinishedMatchIds` and `fetchMatchIdsWithCrionet
 * Stats` end up with `Set<string>` of "ids that matched the filter".
 */
async function inChunksAsSet(
  allIds: string[],
  query: (chunk: string[]) => Promise<Set<string>>,
): Promise<Set<string>> {
  if (allIds.length === 0) return new Set();
  const out = new Set<string>();
  for (let i = 0; i < allIds.length; i += IN_FILTER_CHUNK_SIZE) {
    const chunk = allIds.slice(i, i + IN_FILTER_CHUNK_SIZE);
    const hits = await query(chunk);
    for (const id of hits) out.add(id);
  }
  return out;
}

interface CompositeParts {
  tournamentWidgetId: string; // e.g. "FIP-2026-1701"
  matchWidgetId: string;      // e.g. "MQ012"
  organization: string;       // e.g. "FIP"
  year: string;               // e.g. "2026"
  tournamentId: string;       // numeric string, e.g. "1701"
}

/**
 * Decompose a crionet_widget composite external_id like "FIP-2026-1701:MQ012"
 * into the pieces Crionet's stats POST needs. Returns null for anything that
 * doesn't look like a real widget id (e.g. synthetic draw ids like
 * "draw:men:main_draw:F:1").
 */
export function decomposeWidgetCompositeId(composite: string): CompositeParts | null {
  // Split on the first ':' to separate tournament widget from match widget.
  const colonIdx = composite.indexOf(':');
  if (colonIdx < 0) return null;
  const tournamentWidgetId = composite.slice(0, colonIdx);
  const matchWidgetId = composite.slice(colonIdx + 1);
  if (!tournamentWidgetId || !matchWidgetId) return null;

  // Tournament widget id format: {ORG}-{YEAR}-{NUMERIC_ID}  (e.g. FIP-2026-1701)
  const m = tournamentWidgetId.match(/^([A-Z]+)-(\d{4})-(\d+)$/);
  if (!m) return null;
  const organization = m[1]!;
  const year = m[2]!;
  const tournamentId = m[3]!;

  // Match widget id should look like letters+digits (e.g. MQ012) — reject
  // anything containing ':' which means it's a nested synthetic id.
  if (matchWidgetId.includes(':')) return null;

  return { tournamentWidgetId, matchWidgetId, organization, year, tournamentId };
}

interface CandidateMapping {
  matchId: string;          // public.matches.id UUID
  externalId: string;       // raw composite widget id
  parts: CompositeParts;
}

async function fetchCrionetMatchMappings(
  supabase: SupabaseClient
): Promise<Array<{ entity_id: string; external_id: string }>> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'match')
    .eq('source', 'crionet_widget');
  if (error) throw new Error(`entity_external_ids query failed: ${error.message}`);
  return (data ?? []) as Array<{ entity_id: string; external_id: string }>;
}

/**
 * Returns the set of tournament IDs whose `level` is Premier-tier. The
 * tournaments table is small (~hundreds of rows in total), so we fetch
 * the whole list and filter client-side — much simpler than constructing
 * a PostgREST `or=` filter that enumerates every Premier label.
 */
async function fetchPremierTournamentIds(
  supabase: SupabaseClient,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, level');
  if (error) {
    throw new Error(`tournaments query failed: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ id: string; level: string | null }>;
  return new Set(
    rows.filter((r) => isPremierTier(r.level)).map((r) => r.id),
  );
}

/**
 * For each chunk of candidate match IDs, return a `matchId → tournamentId`
 * map for the matches that are status='finished'. Used by the caller to
 * compute (a) the set of finished match IDs and (b) the subset of those
 * whose tournament is Premier-tier — both from a single chunked query
 * round-trip.
 */
async function fetchFinishedMatchTournamentMap(
  supabase: SupabaseClient,
  matchIds: string[],
): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (matchIds.length === 0) return out;
  for (let i = 0; i < matchIds.length; i += IN_FILTER_CHUNK_SIZE) {
    const chunk = matchIds.slice(i, i + IN_FILTER_CHUNK_SIZE);
    const { data, error } = await supabase
      .from('matches')
      .select('id, tournament_id')
      .in('id', chunk)
      .eq('status', 'finished');
    if (error) throw new Error(`matches query failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; tournament_id: string | null }>;
    for (const r of rows) out.set(r.id, r.tournament_id);
  }
  return out;
}

async function fetchMatchIdsWithCrionetStats(
  supabase: SupabaseClient,
  matchIds: string[]
): Promise<Set<string>> {
  // Only skip matches that already have a crionet_widget row. Legacy rows from
  // older sources (premierpadel, padelapi) DON'T block the fetcher — they get
  // overwritten so the row picks up the full column coverage.
  return inChunksAsSet(matchIds, async (chunk) => {
    const { data, error } = await supabase
      .from('match_stats')
      .select('match_id')
      .in('match_id', chunk)
      .eq('source', 'crionet_widget');
    if (error) throw new Error(`match_stats query failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ match_id: string }>;
    return new Set(rows.map((r) => r.match_id));
  });
}

/**
 * Pair a percentage with `100` so it lands in a (won, played) column pair the
 * UI can render as a percentage bar. `null` stays `null` on both sides — the
 * bar renders as empty rather than 0%.
 */
function pct(value: number | null): { won: number | null; played: number | null } {
  return value == null ? { won: null, played: null } : { won: value, played: 100 };
}

async function upsertParsedStats(
  supabase: SupabaseClient,
  matchId: string,
  matchWidgetId: string,
  parsed: ParsedMatchStats
): Promise<number> {
  if (parsed.perSet.length === 0) return 0;
  const computedAt = new Date().toISOString();

  const rows = parsed.perSet.map((entry) => {
    const t1 = entry.team1;
    const t2 = entry.team2;

    const t1FirstServe = pct(t1.wonOn1stServePct);
    const t1SecondServe = pct(t1.wonOn2ndServePct);
    const t1FirstReturn = pct(t1.wonOn1stReturnPct);
    const t1SecondReturn = pct(t1.wonOn2ndReturnPct);
    const t1TotalPoints = pct(t1.totalPointsWonPct);
    const t1ServePoints = pct(t1.totalWonOnServe);
    const t1ReturnPoints = pct(t1.totalWonOnReturn);

    const t2FirstServe = pct(t2.wonOn1stServePct);
    const t2SecondServe = pct(t2.wonOn2ndServePct);
    const t2FirstReturn = pct(t2.wonOn1stReturnPct);
    const t2SecondReturn = pct(t2.wonOn2ndReturnPct);
    const t2TotalPoints = pct(t2.totalPointsWonPct);
    const t2ServePoints = pct(t2.totalWonOnServe);
    const t2ReturnPoints = pct(t2.totalWonOnReturn);

    return {
      match_id: matchId,
      set_number: entry.setNumber,

      // Service: 1st/2nd serve win % (as value/100), service games (count)
      team1_first_serve_won: t1FirstServe.won,
      team1_first_serve_played: t1FirstServe.played,
      team1_second_serve_won: t1SecondServe.won,
      team1_second_serve_played: t1SecondServe.played,
      team1_service_games: t1.serviceGames,
      team2_first_serve_won: t2FirstServe.won,
      team2_first_serve_played: t2FirstServe.played,
      team2_second_serve_won: t2SecondServe.won,
      team2_second_serve_played: t2SecondServe.played,
      team2_service_games: t2.serviceGames,

      // Return: 1st/2nd return win % (as value/100), return games (count)
      team1_first_return_won: t1FirstReturn.won,
      team1_first_return_played: t1FirstReturn.played,
      team1_second_return_won: t1SecondReturn.won,
      team1_second_return_played: t1SecondReturn.played,
      team1_return_games: t1.returnGames,
      team2_first_return_won: t2FirstReturn.won,
      team2_first_return_played: t2FirstReturn.played,
      team2_second_return_won: t2SecondReturn.won,
      team2_second_return_played: t2SecondReturn.played,
      team2_return_games: t2.returnGames,

      // Totals: total/serve/return points win % (as value/100), longest streak (count)
      team1_total_points_won: t1TotalPoints.won,
      team1_total_points_played: t1TotalPoints.played,
      team1_serve_points_won: t1ServePoints.won,
      team1_serve_points_played: t1ServePoints.played,
      team1_return_points_won: t1ReturnPoints.won,
      team1_return_points_played: t1ReturnPoints.played,
      team1_longest_streak: t1.longestStreak,
      team2_total_points_won: t2TotalPoints.won,
      team2_total_points_played: t2TotalPoints.played,
      team2_serve_points_won: t2ServePoints.won,
      team2_serve_points_played: t2ServePoints.played,
      team2_return_points_won: t2ReturnPoints.won,
      team2_return_points_played: t2ReturnPoints.played,
      team2_longest_streak: t2.longestStreak,

      source: 'crionet_widget',
      source_match_id: matchWidgetId,
      raw_payload: { team1: t1, team2: t2 },
      computed_at: computedAt,
    };
  });

  const { error } = await supabase
    .from('match_stats')
    .upsert(rows, { onConflict: 'match_id,set_number' });
  if (error) throw new Error(`match_stats upsert failed: ${error.message}`);
  return rows.length;
}

async function fetchStatsHtml(
  deps: MatchStatsFetcherDeps,
  candidate: CandidateMapping
): Promise<string | null> {
  const { parts } = candidate;
  let body: string | null = null;

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'match_stats',
      tournamentId: null, // we don't have the public.tournaments UUID here — the composite id encodes only the numeric widget tournament id
      targetUrl: STATS_URL,
      parserVersion: CRIONET_MATCH_STATS_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.post(
        STATS_URL,
        new URLSearchParams({
          matchId: parts.matchWidgetId,
          year: parts.year,
          tournamentId: parts.tournamentId,
          organization: parts.organization,
        }).toString(),
        {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
      const text = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(text).digest('hex')}`;
      body = text;
      return { body: text, contentHash };
    }
  );

  return body;
}

export async function runMatchStatsFetcher(
  deps: MatchStatsFetcherDeps
): Promise<MatchStatsFetcherResult> {
  const mappings = await fetchCrionetMatchMappings(deps.supabase);
  const candidatesSeen = mappings.length;
  if (candidatesSeen === 0) {
    return {
      candidatesSeen: 0,
      fetched: 0,
      skipped: 0,
      rowsUpserted: 0,
      skippedNonPremier: 0,
    };
  }

  // Filter out mappings whose external_id isn't a real widget composite
  // (e.g. synthetic draw ids like "draw:men:main_draw:F:1").
  const parseable: CandidateMapping[] = [];
  let skipped = 0;
  let skippedNonPremier = 0;
  for (const m of mappings) {
    const parts = decomposeWidgetCompositeId(m.external_id);
    if (!parts) {
      skipped++;
      continue;
    }
    parseable.push({ matchId: m.entity_id, externalId: m.external_id, parts });
  }

  if (parseable.length === 0) {
    return {
      candidatesSeen,
      fetched: 0,
      skipped,
      rowsUpserted: 0,
      skippedNonPremier,
    };
  }

  let parseableForRun = parseable;
  if (deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0) {
    // Query matches by tournament_id (bounded by tournament size — typically
    // <200 rows) rather than .in('id', [parseable...]) which would exceed
    // PostgREST's URL-length limit on workers with thousands of crionet_widget
    // mappings across all tournaments.
    const { data: matchRows, error: matchErr } = await deps.supabase
      .from('matches')
      .select('id')
      .in('tournament_id', Array.from(deps.onlyTournamentIds));
    if (matchErr) throw new Error(`matches tournament-filter query failed: ${matchErr.message}`);
    const inTournament = new Set((matchRows ?? []).map((r) => r.id as string));
    const before = parseable.length;
    parseableForRun = parseable.filter((c) => inTournament.has(c.matchId));
    skipped += before - parseableForRun.length;
  }

  // Premier-tier gate (see file header). Drop mappings whose tournament
  // isn't Premier-tier BEFORE the has-stats filter — these matches will
  // never produce a useful stats payload from Crionet, and letting them
  // through would just consume slots in the batch budget.
  //
  // One round-trip pulls finished matches AND their tournament_id; we
  // intersect with `premierTournamentIds` client-side. Two derived sets:
  //   finishedIds      — finished, regardless of tier (kept for symmetry)
  //   premierMatchIds  — finished AND Premier-tier (the actual gate)
  const premierTournamentIds = await fetchPremierTournamentIds(deps.supabase);
  const parseableIds = parseableForRun.map((c) => c.matchId);
  const finishedTournamentMap = await fetchFinishedMatchTournamentMap(
    deps.supabase,
    parseableIds,
  );
  const premierMatchIds = new Set<string>();
  for (const [matchId, tournamentId] of finishedTournamentMap.entries()) {
    if (tournamentId && premierTournamentIds.has(tournamentId)) {
      premierMatchIds.add(matchId);
    }
  }
  const alreadyHaveStats = await fetchMatchIdsWithCrionetStats(
    deps.supabase,
    parseableIds
  );

  const needsFetch: CandidateMapping[] = [];
  for (const c of parseableForRun) {
    const isFinished = finishedTournamentMap.has(c.matchId);
    const isPremier = premierMatchIds.has(c.matchId);
    if (isFinished && !isPremier) {
      // Finished match, but in a non-Premier (FIP) tournament — Crionet
      // won't return useful stats. Skip without an HTTP call.
      skippedNonPremier++;
      skipped++;
      continue;
    }
    if (!isFinished) {
      // Not finished yet (or unknown match). Will get picked up on a
      // future run after the match completes.
      skipped++;
      continue;
    }
    if (alreadyHaveStats.has(c.matchId)) {
      skipped++;
      continue;
    }
    needsFetch.push(c);
  }

  const batch = needsFetch.slice(0, MATCH_STATS_BATCH_SIZE);
  skipped += needsFetch.length - batch.length;

  let fetched = 0;
  let rowsUpserted = 0;
  for (const candidate of batch) {
    const html = await fetchStatsHtml(deps, candidate);
    if (!html) {
      skipped++;
      continue;
    }
    const parsed = parseCrionetMatchStats(html);
    if (parsed.perSet.length === 0) {
      skipped++;
      continue;
    }
    const count = await upsertParsedStats(
      deps.supabase,
      candidate.matchId,
      candidate.parts.matchWidgetId,
      parsed
    );
    rowsUpserted += count;
    fetched++;
  }

  return {
    candidatesSeen,
    fetched,
    skipped,
    rowsUpserted,
    skippedNonPremier,
  };
}
