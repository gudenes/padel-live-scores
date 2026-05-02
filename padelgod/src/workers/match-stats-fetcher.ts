// match-stats-fetcher — polls Crionet's POST /screen/getmatchstats for finished
// matches that already have a `crionet_widget` entity_external_ids mapping but
// no rows in `public.match_stats` yet. Parses the 14 stat dimensions × (match
// aggregate + per-set) tabs via parseCrionetMatchStats and caches structured
// counts + raw parsed percentages in match_stats.
//
// Design notes:
// - Parser returns percentages (e.g. `totalPointsWonPct: 29`) but the
//   match_stats table stores raw COUNTS (first_serve_won / first_serve_played /
//   ...). We can't back out counts from percentages, so V1 populates ONLY the
//   count-native columns the parser can fill 1:1 (service_games, return_games,
//   longest_streak) and stores the full parsed row in `raw_payload` JSONB so
//   downstream readers (marked source='crionet_widget') can use percentages
//   directly.
// - source='crionet_widget' distinguishes these rows from the premierpadel /
//   padelapi.org-sourced stats that store counts.
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
}

const STATS_URL = 'https://widget.matchscorerlive.com/screen/getmatchstats?t=tol';
const MATCH_STATS_BATCH_SIZE = 20;

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

async function fetchFinishedMatchIds(
  supabase: SupabaseClient,
  matchIds: string[]
): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('matches')
    .select('id')
    .in('id', matchIds)
    .eq('status', 'finished');
  if (error) throw new Error(`matches query failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

async function fetchMatchIdsWithExistingStats(
  supabase: SupabaseClient,
  matchIds: string[]
): Promise<Set<string>> {
  if (matchIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from('match_stats')
    .select('match_id')
    .in('match_id', matchIds);
  if (error) throw new Error(`match_stats query failed: ${error.message}`);
  const rows = (data ?? []) as Array<{ match_id: string }>;
  return new Set(rows.map((r) => r.match_id));
}

async function upsertParsedStats(
  supabase: SupabaseClient,
  matchId: string,
  matchWidgetId: string,
  parsed: ParsedMatchStats
): Promise<number> {
  if (parsed.perSet.length === 0) return 0;
  const computedAt = new Date().toISOString();
  const rows = parsed.perSet.map((entry) => ({
    match_id: matchId,
    set_number: entry.setNumber,
    team1_service_games: entry.team1.serviceGames,
    team2_service_games: entry.team2.serviceGames,
    team1_return_games: entry.team1.returnGames,
    team2_return_games: entry.team2.returnGames,
    team1_longest_streak: entry.team1.longestStreak,
    team2_longest_streak: entry.team2.longestStreak,
    source: 'crionet_widget',
    source_match_id: matchWidgetId,
    raw_payload: { team1: entry.team1, team2: entry.team2 },
    computed_at: computedAt,
  }));

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
    return { candidatesSeen: 0, fetched: 0, skipped: 0, rowsUpserted: 0 };
  }

  // Filter out mappings whose external_id isn't a real widget composite
  // (e.g. synthetic draw ids like "draw:men:main_draw:F:1").
  const parseable: CandidateMapping[] = [];
  let skipped = 0;
  for (const m of mappings) {
    const parts = decomposeWidgetCompositeId(m.external_id);
    if (!parts) {
      skipped++;
      continue;
    }
    parseable.push({ matchId: m.entity_id, externalId: m.external_id, parts });
  }

  if (parseable.length === 0) {
    return { candidatesSeen, fetched: 0, skipped, rowsUpserted: 0 };
  }

  let parseableForRun = parseable;
  if (deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0) {
    const ids = parseable.map((c) => c.matchId);
    const { data: matchRows, error: matchErr } = await deps.supabase
      .from('matches')
      .select('id, tournament_id')
      .in('id', ids);
    if (matchErr) throw new Error(`matches tournament-filter query failed: ${matchErr.message}`);
    const inTournament = new Set(
      (matchRows ?? [])
        .filter((r) => deps.onlyTournamentIds!.has(r.tournament_id as string))
        .map((r) => r.id as string),
    );
    const before = parseable.length;
    parseableForRun = parseable.filter((c) => inTournament.has(c.matchId));
    skipped += before - parseableForRun.length;
  }

  const parseableIds = parseableForRun.map((c) => c.matchId);
  const finishedIds = await fetchFinishedMatchIds(deps.supabase, parseableIds);
  const alreadyHaveStats = await fetchMatchIdsWithExistingStats(
    deps.supabase,
    parseableIds
  );

  const needsFetch: CandidateMapping[] = [];
  for (const c of parseableForRun) {
    if (!finishedIds.has(c.matchId)) {
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

  return { candidatesSeen, fetched, skipped, rowsUpserted };
}
