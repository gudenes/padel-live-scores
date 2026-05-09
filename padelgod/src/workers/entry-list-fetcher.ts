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
import { runScrapeJob } from '../lib/scrape-job.js';
import { pdfToText } from '../lib/pdf-text.js';

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

interface ActiveTournament {
  tournament_id: string;
  tournament_name: string;
  slug: string | null;
  starts_at: string | null;
  ends_at: string | null;
}

type Category = 'men' | 'women';

interface DbPlayerRow {
  id: string;
  fip_id: string | null;
  name: string;
  normalized_name: string | null;
  country: string | null;
  ranking: number | null;
  category: 'men' | 'women' | null;
}

interface ResolvedPlayer {
  fipId: string;
  name: string;
  country: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Build a category-scoped index keyed on normalized name. Multiple players
 *  may share a normalized name (e.g. two "Juan Garcia" in the men's pool);
 *  we keep them all and let the resolver narrow by country + ranking. */
function indexPlayersByName(rows: DbPlayerRow[]): Map<string, DbPlayerRow[]> {
  const map = new Map<string, DbPlayerRow[]>();
  for (const r of rows) {
    const key = r.normalized_name ?? normalizeName(r.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

/** Resolve a parsed player against the DB index. Returns the fip_id when:
 *  (a) exactly one player matches by name + category, OR
 *  (b) multiple match but exactly one has the same country, OR
 *  (c) multiple match by name+country, narrow by ranking proximity.
 *  Returns null on ambiguity or zero matches — caller falls back to FIP
 *  search. */
function resolveFromDb(
  parsedName: string,
  parsedCountry: string | null,
  parsedRanking: number,
  index: Map<string, DbPlayerRow[]>
): string | null {
  const key = normalizeName(parsedName);
  if (!key) return null;
  const candidates = index.get(key);
  if (!candidates || candidates.length === 0) return null;

  // Single hit → done.
  if (candidates.length === 1) {
    return candidates[0]!.fip_id ?? null;
  }

  // Filter by country (alpha-2 normalized on both sides).
  const wantCountry = normalizeCountry(parsedCountry);
  const sameCountry = wantCountry
    ? candidates.filter((c) => normalizeCountry(c.country) === wantCountry)
    : candidates;
  if (sameCountry.length === 1) return sameCountry[0]!.fip_id ?? null;
  if (sameCountry.length === 0) return null;

  // Still ambiguous — pick by ranking proximity. Skip when the parsed
  // ranking is 0 (PDF didn't show one) since every candidate would be
  // equidistant from 0.
  if (parsedRanking > 0) {
    let best = sameCountry[0]!;
    let bestDist = Math.abs((best.ranking ?? Number.MAX_SAFE_INTEGER) - parsedRanking);
    for (let i = 1; i < sameCountry.length; i++) {
      const c = sameCountry[i]!;
      const d = Math.abs((c.ranking ?? Number.MAX_SAFE_INTEGER) - parsedRanking);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best.fip_id ?? null;
  }

  // Genuinely ambiguous — refuse to guess.
  return null;
}

/** Load candidate players for a category. Bounded: ~5k rows max for the
 *  men/women pool — well under any pagination limit. */
async function loadDbPlayerIndex(
  supabase: SupabaseClient,
  category: Category
): Promise<Map<string, DbPlayerRow[]>> {
  const { data, error } = await supabase
    .from('players')
    .select('id, fip_id, name, normalized_name, country, ranking, category')
    .eq('category', category);
  if (error) {
    throw new Error(`players read failed for ${category}: ${error.message}`);
  }
  return indexPlayersByName((data ?? []) as DbPlayerRow[]);
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
  parsedName: string,
  parsedCountry: string,
  parsedRanking: number,
  category: Category,
  dbIndex: Map<string, DbPlayerRow[]>
): Promise<ResolvedPlayer | null> {
  // 1. DB hit — fastest, no external call.
  const dbFipId = resolveFromDb(parsedName, parsedCountry, parsedRanking, dbIndex);
  if (dbFipId) {
    return { fipId: dbFipId, name: parsedName, country: parsedCountry || null };
  }
  // 2. FIP search fallback for players we don't have yet.
  const hit = await searchFipPlayer(http, {
    name: parsedName,
    country: parsedCountry,
    category,
    rankingHint: parsedRanking || null,
  });
  if (!hit) return null;
  return {
    // Use the raw FIP id (e.g. "P203884"). The legacy "fip-" prefix
    // convention was unwound in the merge-duplicate-players PR — see
    // CLAUDE.md "Player fip_id format" section.
    fipId: hit.playerId,
    name: hit.fullName,
    country: hit.nationality,
  };
}

async function processCategory(
  deps: EntryListFetcherDeps,
  tournamentId: string,
  category: Category,
  pdfUrl: string,
  dbIndex: Map<string, DbPlayerRow[]>
): Promise<{
  snapshotsInserted: number;
  playersResolved: number;
  playersUnresolved: number;
}> {
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
      team.player1.name,
      team.player1.country,
      team.player1.ranking,
      category,
      dbIndex
    );
    const r2 = await resolveTeamPlayer(
      deps.httpClient,
      team.player2.name,
      team.player2.country,
      team.player2.ranking,
      category,
      dbIndex
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

async function processTournament(
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

  // Pre-load the player index ONCE per category, reuse across all teams.
  // Avoids quadratic re-fetching when a tournament has 256 players.
  const [menIndex, womenIndex] = await Promise.all([
    pdfUrls.men ? loadDbPlayerIndex(deps.supabase, 'men') : Promise.resolve(new Map()),
    pdfUrls.women ? loadDbPlayerIndex(deps.supabase, 'women') : Promise.resolve(new Map()),
  ]);

  let snapshotsInserted = 0;
  let playersResolved = 0;
  let playersUnresolved = 0;

  if (pdfUrls.men) {
    const out = await processCategory(deps, t.tournament_id, 'men', pdfUrls.men, menIndex);
    snapshotsInserted += out.snapshotsInserted;
    playersResolved += out.playersResolved;
    playersUnresolved += out.playersUnresolved;
  }
  if (pdfUrls.women) {
    const out = await processCategory(deps, t.tournament_id, 'women', pdfUrls.women, womenIndex);
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
    'padelgod_active_tournaments_with_slug'
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
