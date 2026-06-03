import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import { createHash } from 'node:crypto';
import {
  parseFipEventDraw,
  categoryAndTypeFromDrawCode,
  type DrawCode,
  type ParsedFipDrawMatch,
} from '../parsers/fip-event-draw.js';
import { parseFipEventPageConfig } from '../parsers/fip-event-page-config.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_EVENT_DRAW_VERSION } from '../lib/parser-versions.js';
import { fipCountryNameToAlpha2 } from '../lib/country.js';
import { activeTournamentArgs } from '../lib/active-tournament-args.js';

/**
 * FIP event-page draw fetcher.
 *
 * Fetches full brackets (MD/WD/MQ/WQ) from padelfip.com for every active
 * tournament and appends rows to `padelgod.draw_snapshots` with the
 * `match_widget_id` + `team*_fip_id` columns populated.
 *
 * Flow per tournament
 * -------------------
 *   1. GET  https://www.padelfip.com/es/events/{slug}/?tab=Cuadros
 *      → extract `padelfip_ajax.nonce` + `ajax_object.post_id`
 *   2. POST https://www.padelfip.com/wp-admin/admin-ajax.php
 *      x4 (one per draw code MD/WD/MQ/WQ) with
 *      `action=handle_ajax_request&drawType=<code>&gender=<M|F>&postID=<id>&security=<nonce>`
 *   3. Parse each response → insert batch into `draw_snapshots`
 *
 * Why this exists
 * ---------------
 * The Crionet draw widget (widget.matchscorerlive.com/screen/draw/...) only
 * surfaces matches once they're scheduled/live/finished — so QFs are invisible
 * in the widget until ~3 days into the tournament. The FIP event-page AJAX
 * response gives us the complete bracket (including Bye-vs-Bye placeholders
 * for unseeded future rounds) along with the `data-match-id` widget IDs that
 * serve as our deterministic join key to public.matches. This worker is a
 * sibling of the existing Crionet `draw-fetcher` — same output table, richer
 * source.
 *
 * PR 1 scope: this worker ONLY writes to padelgod.draw_snapshots. It does
 * NOT mutate public.matches, public.tournament_draws, or entity_external_ids.
 * The populator/linker (PR 2) reads these snapshots and performs the
 * cross-table writes under review.
 */

export interface FipDrawFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger?: Logger;
  /** When set, only tournaments whose UUID is in the allowlist are
   *  processed. Used by the on-demand refresh endpoint. */
  onlyTournamentIds?: Set<string>;
}

export interface FipDrawFetcherResult {
  tournamentsProcessed: number;
  tournamentsSkipped: number;
  totalMatchesInserted: number;
}

interface ActiveTournamentWithSlug {
  tournament_id: string;
  tournament_name: string;
  slug: string;
  starts_at: string | null;
  ends_at: string | null;
}

// Order matters only for log readability — we fetch all four per tournament.
const DRAW_CODES: DrawCode[] = ['MD', 'WD', 'MQ', 'WQ'];

const EVENT_PAGE_URL = (slug: string) =>
  `https://www.padelfip.com/es/events/${slug}/?tab=Cuadros`;

const AJAX_URL = 'https://www.padelfip.com/wp-admin/admin-ajax.php';

/** Best-effort status normalization from the raw parse output. */
function mappedStatus(
  s: ParsedFipDrawMatch['status']
): 'scheduled' | 'live' | 'finished' | 'walkover' | 'retired' {
  return s;
}

async function getLatestScrapeJobId(
  supabase: SupabaseClient,
  tournamentId: string,
  targetUrl: string
): Promise<string | null> {
  const { data } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .select('id')
    .eq('tournament_id', tournamentId)
    .eq('target_url', targetUrl)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Fetch the event page + extract the WP AJAX nonce/post_id.
 * Wrapped in a scrape_job so failures are auditable.
 */
async function fetchEventPageConfig(
  deps: FipDrawFetcherDeps,
  t: ActiveTournamentWithSlug
): Promise<{ ajaxUrl: string; nonce: string; postId: string } | null> {
  const targetUrl = EVENT_PAGE_URL(t.slug);
  let configResult: ReturnType<typeof parseFipEventPageConfig> = null;

  try {
    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'discover', // event page discovery — reuse existing enum member
        tournamentId: t.tournament_id,
        targetUrl,
        parserVersion: FIP_EVENT_DRAW_VERSION,
        captureBody: false,
      },
      async () => {
        const response = await deps.httpClient.get(targetUrl);
        const body = String(response.data);
        const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
        configResult = parseFipEventPageConfig(body);
        if (!configResult) {
          // Surface this as a failed scrape job so the ops dashboard shows
          // it in the failed-jobs view — these are the cases where FIP
          // changed their page structure.
          throw new Error('event_page_config_missing');
        }
        return { body, contentHash };
      }
    );
  } catch (err) {
    deps.logger?.warn(
      { err, tournamentId: t.tournament_id, slug: t.slug },
      'fip-draw-fetcher: event page fetch or parse failed — skipping tournament'
    );
    return null;
  }
  return configResult;
}

/**
 * Fetch one draw type via AJAX, parse it, and insert rows. Returns the
 * number of rows inserted (0 if the draw type is absent, e.g. a small
 * event with no qualifier).
 */
async function fetchAndStoreDraw(
  deps: FipDrawFetcherDeps,
  t: ActiveTournamentWithSlug,
  config: { ajaxUrl: string; nonce: string; postId: string },
  drawCode: DrawCode
): Promise<number> {
  const gender = drawCode.startsWith('M') ? 'M' : 'F';
  // URL-encoded form body — matches the shape the browser sends.
  // We keep `juniorCat` empty: padelfip's JS sets it only for youth events.
  const params = new URLSearchParams();
  params.set('action', 'handle_ajax_request');
  params.set('drawType', drawCode);
  params.set('gender', gender);
  params.set('juniorCat', '');
  params.set('postID', config.postId);
  params.set('security', config.nonce);

  // The target URL we record in scrape_jobs includes the drawCode as a
  // pseudo-query so each draw code gets its own latest-job row. Without
  // this, all four draws would share one row and getLatestScrapeJobId
  // would race.
  const targetUrl = `${config.ajaxUrl}?drawType=${drawCode}&postID=${config.postId}`;

  let parsed: ParsedFipDrawMatch[] = [];
  let responseOk = false;

  try {
    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'draw',
        tournamentId: t.tournament_id,
        targetUrl,
        parserVersion: FIP_EVENT_DRAW_VERSION,
        captureBody: true,
      },
      async () => {
        const response = await deps.httpClient.post(config.ajaxUrl, params.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            Referer: EVENT_PAGE_URL(t.slug),
          },
        });
        const body =
          typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
        const payload = typeof response.data === 'object'
          ? (response.data as { error?: number; html?: string; drawType?: string })
          : safeJsonParse(body);
        if (!payload || !payload.html) {
          // Payload has no html — treat as a valid-but-empty draw (e.g. no
          // qualifier for this event). Don't throw; return empty.
          return { body, contentHash };
        }
        if (payload.drawType && payload.drawType !== drawCode) {
          // Sanity check — FIP echoes the requested drawType. Any mismatch
          // means we got someone else's payload; bail without parsing.
          throw new Error(
            `drawType mismatch: requested ${drawCode} got ${payload.drawType}`
          );
        }
        // CRITICAL: pass drawType so the parser uses Q1/Q2/Q3 labels for
        // qualifier draws (MQ/WQ codes) instead of falling back to main-draw
        // labels (R16/R32/QF/SF/F). Without this, qualifier matches end up
        // mislabeled as R16/R32 and the tournament page shows them in the
        // wrong stage strip section.
        const drawTypeForParser: 'main_draw' | 'qualifying' =
          drawCode === 'MQ' || drawCode === 'WQ' ? 'qualifying' : 'main_draw';
        parsed = parseFipEventDraw(payload.html, drawTypeForParser);
        responseOk = true;
        return { body, contentHash };
      }
    );
  } catch (err) {
    deps.logger?.warn(
      { err, tournamentId: t.tournament_id, drawCode },
      'fip-draw-fetcher: AJAX fetch failed for draw code'
    );
    return 0;
  }

  if (!responseOk || parsed.length === 0) return 0;

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) {
    deps.logger?.warn(
      { tournamentId: t.tournament_id, drawCode },
      'fip-draw-fetcher: scrape job row disappeared between write and read — skipping insert'
    );
    return 0;
  }

  const { category, drawType } = categoryAndTypeFromDrawCode(drawCode);

  const rows = parsed.map((m) => ({
    scrape_job_id: scrapeJobId,
    tournament_id: t.tournament_id,
    category,
    draw_type: drawType,
    round_label: m.roundLabel,
    draw_position: m.drawPosition,
    team1_player1_name: m.team1.isBye ? null : m.team1.player1Name,
    team1_player2_name: m.team1.isBye ? null : m.team1.player2Name,
    team2_player1_name: m.team2.isBye ? null : m.team2.player1Name,
    team2_player2_name: m.team2.isBye ? null : m.team2.player2Name,
    team1_seed: m.team1.seed,
    team2_seed: m.team2.seed,
    // FIP country names → alpha-2. We use the dedicated `fipCountryNameToAlpha2`
    // helper (NOT normalizeCountry) because FIP's flag-filename convention is
    // full English country NAMES (e.g. "Spain", "TheNetherlands"), not ISO
    // alpha-3 codes. Running them through normalizeCountry would emit one
    // console.warn per team → 995 spurious "error" lines in Railway in 2 min
    // during the 2026-04-23 dry-run. Unknowns return null silently.
    team1_country: fipCountryNameToAlpha2(m.team1.country),
    team2_country: fipCountryNameToAlpha2(m.team2.country),
    set_scores: m.setScores,
    winner_team: m.winnerTeam,
    status: mappedStatus(m.status),
    // FIP-specific columns from the 20260424000002 migration
    match_widget_id: m.matchWidgetId,
    team1_fip_id: m.team1.fipTeamId,
    team2_fip_id: m.team2.fipTeamId,
    source: 'fip_event_page',
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('draw_snapshots')
    .insert(rows);

  if (error) {
    throw new Error(`draw_snapshots insert failed (${drawCode}): ${error.message}`);
  }
  return rows.length;
}

function safeJsonParse(body: string): { error?: number; html?: string; drawType?: string } | null {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Run the FIP draw fetcher across all active tournaments (± 7 days of their
 * window). Appends to `padelgod.draw_snapshots` with `source='fip_event_page'`.
 */
export async function runFipDrawFetcher(
  deps: FipDrawFetcherDeps
): Promise<FipDrawFetcherResult> {
  const { data, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_with_slug',
    activeTournamentArgs(deps.onlyTournamentIds),
  );
  if (error) {
    throw new Error(`padelgod_active_tournaments_with_slug RPC failed: ${error.message}`);
  }
  const allTournaments = (data ?? []) as ActiveTournamentWithSlug[];
  const tournaments = deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0
    ? allTournaments.filter((t) => deps.onlyTournamentIds!.has(t.tournament_id))
    : allTournaments;

  let tournamentsProcessed = 0;
  let tournamentsSkipped = 0;
  let totalMatchesInserted = 0;

  for (const t of tournaments) {
    const config = await fetchEventPageConfig(deps, t);
    if (!config) {
      tournamentsSkipped += 1;
      continue;
    }
    tournamentsProcessed += 1;
    for (const code of DRAW_CODES) {
      const inserted = await fetchAndStoreDraw(deps, t, config, code);
      totalMatchesInserted += inserted;
    }
  }

  deps.logger?.info(
    {
      tournamentsProcessed,
      tournamentsSkipped,
      totalMatchesInserted,
    },
    'fip-draw-fetcher run complete'
  );

  return { tournamentsProcessed, tournamentsSkipped, totalMatchesInserted };
}
