// padelgod/src/workers/entry-list-fetcher.ts
//
// Tier 1 fetcher: discovers FIP entry-list PDFs, parses them, resolves
// players to fip_ids, and appends rows to padelgod.entry_list_snapshots
// tagged with draw_type ('main_draw' | 'qualifying'). The downstream
// fip-entry-list-populator (cron :46) consumes these snapshots and
// upserts public.players.
//
// History
// -------
// This worker used to point at the Crionet widget URL
// (`widget.matchscorerlive.com/screen/entrylist/...`), but Crionet renders
// entry lists client-side via AJAX so the GET returned an empty body.
// The worker silently produced 0 rows for months, which is why operators
// had to upload PDFs manually through the ops dashboard. PR 2 of the
// "ingest every FIP level" plan rewires this worker to FIP PDFs, the same
// source of truth the manual ops flow uses — so the entry-list pipeline
// becomes fully automated end-to-end.
//
// Source priority
// ---------------
// FIP/Crionet is the canonical source for entry lists across all tiers
// (Premier P1/P2 + Cupra-FIP-Tour Platinum/Gold/Silver/Bronze + Promises
// + Beyond + Hexagon + Championships). No padelapi calls.
//
// Pipeline per tournament
// -----------------------
//  1. RPC `padelgod_active_tournaments_with_slug` → active tournaments
//     within ±7 days of their date window.
//  2. GET https://www.padelfip.com/es/events/{slug}/ → extract WordPress
//     nonce + post_id.
//  3. POST /wp-admin/admin-ajax.php with action=load_entrylist_tab → JSON
//     containing the per-gender PDF URLs.
//  4. Download each PDF, run pdf-parse → text.
//  5. parseEntryListText → ParsedTeam[] tagged with drawType.
//  6. Resolve each parsed player to a fip_id:
//     a. DB lookup: pre-loaded `public.players` index by (category +
//        normalized name + country); narrow by ranking proximity if
//        ambiguous.
//     b. FIP search fallback for players the DB doesn't have yet.
//     c. Skip if both miss — the Tier 2 populator drops fip_id-less
//        snapshot rows on the floor (lesson #1 in the populator file:
//        "thin records pollute search").
//  7. Insert snapshots with draw_type + fip_id + partner_fip_id + seed.

import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import {
  parseEntryListText,
  type DrawType,
  type ParsedTeam,
} from '../parsers/fip-entry-list-pdf.js';
import {
  ADMIN_AJAX_URL,
  buildEntryListAjaxBody,
  buildEventPageUrl,
  extractNonceAndPostId,
  extractPdfUrlsFromAjaxResponse,
  type EntryListPdfUrls,
} from '../lib/fip-event-page.js';
import { searchFipPlayer } from '../lib/fip-player-search.js';
import { normalizeCountry } from '../lib/country.js';
import { activeTournamentArgs } from '../lib/active-tournament-args.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { pdfToText } from '../lib/pdf-text.js';
import {
  normalizeName,
  loadDbPlayerIndex,
  loadAliasIndex,
  resolvePlayerByName,
  storeAlias,
  type DbPlayerIndex,
  type AliasIndex,
} from '../lib/db-resolver.js';

export interface EntryListFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  /** When set, only tournaments whose UUID is in the allowlist are
   *  processed. Used by the on-demand refresh endpoint. */
  onlyTournamentIds?: Set<string>;
}

export interface EntryListFetcherResult {
  tournamentsConsidered: number;
  tournamentsProcessed: number;
  tournamentsSkippedNoPdfs: number;
  totalSnapshotsInserted: number;
  totalPlayersResolved: number;
  totalPlayersUnresolved: number;
}

export interface ActiveTournament {
  tournament_id: string;
  tournament_name: string;
  slug: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

type Category = 'men' | 'women';

interface ResolvedPlayer {
  fipId: string;
  name: string;
  country: string | null;
}

// ── Per-tournament work ──────────────────────────────────────────────────

interface TournamentOutcome {
  snapshotsInserted: number;
  playersResolved: number;
  playersUnresolved: number;
  pdfsFound: boolean;
}

async function fetchPdfUrls(
  http: AxiosInstance,
  slug: string
): Promise<EntryListPdfUrls> {
  // Step 1: GET event page for nonce + post_id.
  const eventPageUrl = buildEventPageUrl(slug);
  const eventPage = await http.get(eventPageUrl);
  const html = String(eventPage.data ?? '');
  const ajax = extractNonceAndPostId(html);
  if (!ajax) return {};

  // Step 2: POST admin-ajax for the entry-list tab JSON.
  const body = buildEntryListAjaxBody(ajax);
  const ajaxRes = await http.post(ADMIN_AJAX_URL, body, {
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'x-requested-with': 'XMLHttpRequest',
    },
  });
  return extractPdfUrlsFromAjaxResponse(
    typeof ajaxRes.data === 'string' ? ajaxRes.data : JSON.stringify(ajaxRes.data)
  );
}

async function downloadPdfText(http: AxiosInstance, url: string): Promise<string> {
  const res = await http.get(url, { responseType: 'arraybuffer' });
  const buf = Buffer.from(res.data as ArrayBuffer);
  return pdfToText(buf);
}

interface SnapshotRow {
  scrape_job_id: string;
  tournament_id: string;
  category: Category;
  draw_type: 'main_draw' | 'qualifying';
  fip_id: string;
  name: string;
  country: string | null;
  seed: number | null;
  partner_fip_id: string | null;
  partner_name: string;
}

const DRAW_TYPE_DB: Record<DrawType, 'main_draw' | 'qualifying'> = {
  main: 'main_draw',
  qualifying: 'qualifying',
};

async function resolveTeamPlayer(
  http: AxiosInstance,
  supabase: SupabaseClient,
  parsedName: string,
  parsedCountry: string,
  parsedRanking: number,
  category: Category,
  dbIndex: DbPlayerIndex,
  aliasIndex: AliasIndex
): Promise<ResolvedPlayer | null> {
  // 1. DB chain: alias → exact → subset → typo (via db-resolver).
  const hit = resolvePlayerByName(
    { name: parsedName, country: parsedCountry, ranking: parsedRanking },
    dbIndex,
    aliasIndex
  );
  if (hit && hit.fipId) {
    // Persist the alias on every fuzzy hit so the next snapshot is O(1).
    // Skip for 'exact' (would be a no-op) and 'alias' (already there).
    if (hit.matchType === 'subset' || hit.matchType === 'typo') {
      await storeAlias(supabase, hit.playerId, parsedName);
      // Keep the in-memory index in sync so subsequent rows in this same
      // fetcher run hit the alias path instead of re-running fuzzy.
      aliasIndex.set(normalizeName(parsedName), hit.playerId);
    }
    return { fipId: hit.fipId, name: parsedName, country: parsedCountry || null };
  }
  // 2. FIP search fallback for players we don't have yet.
  const fipHit = await searchFipPlayer(http, {
    name: parsedName,
    country: parsedCountry,
    category,
    rankingHint: parsedRanking || null,
  });
  if (!fipHit) return null;
  return {
    // Use the raw FIP id (e.g. "P203884"). The legacy "fip-" prefix
    // convention was unwound in the merge-duplicate-players PR — see
    // CLAUDE.md "Player fip_id format" section.
    fipId: fipHit.playerId,
    name: fipHit.fullName,
    country: fipHit.nationality,
  };
}

async function processCategory(
  deps: EntryListFetcherDeps,
  tournamentId: string,
  category: Category,
  pdfUrl: string,
  dbIndex: DbPlayerIndex,
  aliasIndex: AliasIndex
): Promise<{
  snapshotsInserted: number;
  playersResolved: number;
  playersUnresolved: number;
}> {
  const supabase = deps.supabase;
  let parsedTeams: ParsedTeam[] = [];

  // Wrap the network + parse work in a scrape_job for audit-trail parity
  // with the legacy worker. captureBody=false because the body is binary
  // PDF bytes — keeping them in the DB is wasteful and risks PII storage.
  const job = await runScrapeJob(
    deps.supabase,
    {
      jobType: 'discover',
      tournamentId,
      targetUrl: pdfUrl,
      parserVersion: 'fip_pdf_entry_list_v1',
      captureBody: false,
    },
    async () => {
      const text = await downloadPdfText(deps.httpClient, pdfUrl);
      const parsed = parseEntryListText(text);
      parsedTeams = parsed.teams;
      const contentHash = `sha256:${createHash('sha256').update(text).digest('hex')}`;
      return { body: text, contentHash };
    }
  );

  if (parsedTeams.length === 0) {
    return { snapshotsInserted: 0, playersResolved: 0, playersUnresolved: 0 };
  }

  const rows: SnapshotRow[] = [];
  let resolved = 0;
  let unresolved = 0;

  for (const team of parsedTeams) {
    const r1 = await resolveTeamPlayer(
      deps.httpClient,
      supabase,
      team.player1.name,
      team.player1.country,
      team.player1.ranking,
      category,
      dbIndex,
      aliasIndex
    );
    const r2 = await resolveTeamPlayer(
      deps.httpClient,
      supabase,
      team.player2.name,
      team.player2.country,
      team.player2.ranking,
      category,
      dbIndex,
      aliasIndex
    );

    if (r1) resolved++;
    else unresolved++;
    if (r2) resolved++;
    else unresolved++;

    // Skip the team only when neither side resolved — no useful signal.
    // When exactly one side resolved, store that player's row anyway so
    // downstream consumers (the draw populator's nameToFipId map) can still
    // map them to a fip_id. The unresolved partner shows up as
    // `partner_name` (raw parsed string) with `partner_fip_id: null`. This
    // breaks the cascade where one unresolvable player (e.g. a late-add
    // wildcard, a player not yet in FIP's search index) drops their
    // teammate from the snapshot too.
    if (!r1 && !r2) continue;

    const draw_type = DRAW_TYPE_DB[team.drawType];

    if (r1) {
      rows.push({
        scrape_job_id: job.scrapeJobId,
        tournament_id: tournamentId,
        category,
        draw_type,
        fip_id: r1.fipId,
        name: r1.name,
        country: normalizeCountry(r1.country),
        seed: team.position,
        partner_fip_id: r2 ? r2.fipId : null,
        partner_name: r2 ? r2.name : team.player2.name,
      });
    }
    if (r2) {
      rows.push({
        scrape_job_id: job.scrapeJobId,
        tournament_id: tournamentId,
        category,
        draw_type,
        fip_id: r2.fipId,
        name: r2.name,
        country: normalizeCountry(r2.country),
        // Seed lives on player1's row by convention. When player1 didn't
        // resolve and only this row gets written, fall back to recording
        // the seed here so the team position isn't lost.
        seed: r1 ? null : team.position,
        partner_fip_id: r1 ? r1.fipId : null,
        partner_name: r1 ? r1.name : team.player1.name,
      });
    }
  }

  if (rows.length === 0) {
    return { snapshotsInserted: 0, playersResolved: resolved, playersUnresolved: unresolved };
  }

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('entry_list_snapshots')
    .insert(rows);
  if (error) {
    throw new Error(`entry_list_snapshots insert failed: ${error.message}`);
  }

  return {
    snapshotsInserted: rows.length,
    playersResolved: resolved,
    playersUnresolved: unresolved,
  };
}

export async function processTournament(
  deps: EntryListFetcherDeps,
  t: ActiveTournament
): Promise<TournamentOutcome> {
  if (!t.slug) {
    return { snapshotsInserted: 0, playersResolved: 0, playersUnresolved: 0, pdfsFound: false };
  }

  const pdfUrls = await fetchPdfUrls(deps.httpClient, t.slug);
  if (!pdfUrls.men && !pdfUrls.women) {
    return { snapshotsInserted: 0, playersResolved: 0, playersUnresolved: 0, pdfsFound: false };
  }

  // Pre-load the player index ONCE per category and the alias index once
  // per tournament run. Reuse across all teams to avoid quadratic fetching.
  const [menIndex, womenIndex, aliasIndex] = await Promise.all([
    pdfUrls.men ? loadDbPlayerIndex(deps.supabase, 'men') : Promise.resolve(new Map() as DbPlayerIndex),
    pdfUrls.women ? loadDbPlayerIndex(deps.supabase, 'women') : Promise.resolve(new Map() as DbPlayerIndex),
    loadAliasIndex(deps.supabase),
  ]);

  let snapshotsInserted = 0;
  let playersResolved = 0;
  let playersUnresolved = 0;

  if (pdfUrls.men) {
    const out = await processCategory(deps, t.tournament_id, 'men', pdfUrls.men, menIndex, aliasIndex);
    snapshotsInserted += out.snapshotsInserted;
    playersResolved += out.playersResolved;
    playersUnresolved += out.playersUnresolved;
  }
  if (pdfUrls.women) {
    const out = await processCategory(deps, t.tournament_id, 'women', pdfUrls.women, womenIndex, aliasIndex);
    snapshotsInserted += out.snapshotsInserted;
    playersResolved += out.playersResolved;
    playersUnresolved += out.playersUnresolved;
  }

  return { snapshotsInserted, playersResolved, playersUnresolved, pdfsFound: true };
}

// ── Entry point ──────────────────────────────────────────────────────────

export async function runEntryListFetcher(
  deps: EntryListFetcherDeps
): Promise<EntryListFetcherResult> {
  // RPC returns active tournaments with their FIP slug — the FIP-PDF flow
  // doesn't need a Crionet widget code (the legacy worker wanted that).
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_with_slug',
    activeTournamentArgs(deps.onlyTournamentIds),
  );
  if (error) {
    throw new Error(`Active tournaments RPC failed: ${error.message}`);
  }
  const allList = (tournaments ?? []) as ActiveTournament[];
  const list = deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0
    ? allList.filter((t) => deps.onlyTournamentIds!.has(t.tournament_id))
    : allList;

  let tournamentsProcessed = 0;
  let tournamentsSkippedNoPdfs = 0;
  let totalSnapshotsInserted = 0;
  let totalPlayersResolved = 0;
  let totalPlayersUnresolved = 0;

  for (const t of list) {
    let outcome: TournamentOutcome;
    try {
      outcome = await processTournament(deps, t);
    } catch (err) {
      // One failing tournament must NOT take down the rest of the cron tick.
      // The scrape_job row already records the failure for ops visibility.
      // Surface a soft skip and move on.
      console.error(
        `[entry-list-fetcher] tournament ${t.tournament_id} (${t.slug}) failed:`,
        err instanceof Error ? err.message : err
      );
      continue;
    }

    if (!outcome.pdfsFound) {
      tournamentsSkippedNoPdfs++;
      continue;
    }
    tournamentsProcessed++;
    totalSnapshotsInserted += outcome.snapshotsInserted;
    totalPlayersResolved += outcome.playersResolved;
    totalPlayersUnresolved += outcome.playersUnresolved;
  }

  return {
    tournamentsConsidered: list.length,
    tournamentsProcessed,
    tournamentsSkippedNoPdfs,
    totalSnapshotsInserted,
    totalPlayersResolved,
    totalPlayersUnresolved,
  };
}
