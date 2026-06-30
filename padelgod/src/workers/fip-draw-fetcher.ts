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
   *  processed. Used by the on-demand refresh endpoint. When set, the
   *  finished-tail skip is bypassed so an operator can force-refresh a
   *  finished event. */
  onlyTournamentIds?: Set<string>;
  /** Injectable clock for tests. Defaults to Date.now. */
  now?: () => number;
}

export interface FipDrawFetcherResult {
  tournamentsProcessed: number;
  tournamentsSkipped: number;
  /** Tournaments skipped because their bracket is static (ended >24h ago). */
  tournamentsSkippedFinished: number;
  totalMatchesInserted: number;
}

// ── Bandwidth optimization: site-wide nonce cache ──────────────────────────
//
// FIP IP-blocks Railway across padelfip.com, so all traffic is metered through
// a residential proxy. The dominant cost is the ~296 KB event-page GET this
// worker did per tournament per hour purely to extract a WP AJAX nonce.
//
// VERIFIED: the `padelfip_ajax.nonce` is SITE-WIDE (same value on every event
// page for anonymous requests) and valid ~12–24h. So ONE page fetch yields a
// nonce usable for ALL tournaments' draw POSTs. We cache it module-level — the
// scheduler is a single long-lived process, so the cache survives across the
// hourly runs. TTL is 6h, comfortably inside FIP's validity window.
//
// Best-effort under overlap: node-cron does not serialize invocations, and the
// operator refresh-tournament path runs in the same process against this same
// cache. Concurrent runs can race `cachedNonce` (e.g. one nulls it during
// stale-nonce recovery while another is mid-loop). This is intentionally
// unguarded — the worst case is a few redundant event-page GETs, never
// corruption: the postID is immutable and draw_snapshots is append-only.
const NONCE_TTL_MS = 6 * 60 * 60 * 1000;
let cachedNonce: { value: string; fetchedAtMs: number } | null = null;

/** Test-only: reset the module-level nonce cache between cases. */
export function __resetFipDrawFetcherCaches(): void {
  cachedNonce = null;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const POST_ID_SOURCE = 'fip_post_id';

/** True if the cached nonce exists and is within its TTL. */
function nonceIsFresh(nowMs: number): boolean {
  return cachedNonce !== null && nowMs - cachedNonce.fetchedAtMs < NONCE_TTL_MS;
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
 * Look up a tournament's stored FIP WP post ID from the entity_external_ids
 * sidecar. The post ID is per-tournament but immutable (it's the event's WP
 * post ID), so once stored we never need the event page again for it.
 */
async function lookupStoredPostId(
  deps: FipDrawFetcherDeps,
  tournamentId: string
): Promise<string | null> {
  const { data, error } = await deps.supabase
    .from('entity_external_ids')
    .select('external_id')
    .eq('entity_type', 'tournament')
    .eq('entity_id', tournamentId)
    .eq('source', POST_ID_SOURCE)
    .maybeSingle();
  if (error) {
    deps.logger?.warn(
      { err: error, tournamentId },
      'fip-draw-fetcher: fip_post_id lookup failed — falling back to page fetch'
    );
    return null;
  }
  return (data?.external_id as string | undefined) ?? null;
}

/** Idempotently persist a tournament's WP post ID for future reuse. */
async function storePostId(
  deps: FipDrawFetcherDeps,
  tournamentId: string,
  postId: string
): Promise<void> {
  const { error } = await deps.supabase.from('entity_external_ids').upsert(
    {
      entity_type: 'tournament',
      entity_id: tournamentId,
      source: POST_ID_SOURCE,
      external_id: postId,
    },
    { onConflict: 'entity_type,entity_id,source' }
  );
  if (error) {
    deps.logger?.warn(
      { err: error, tournamentId, postId },
      'fip-draw-fetcher: fip_post_id upsert failed — will re-fetch next run'
    );
  }
}

/**
 * Fetch one draw type via AJAX, parse it, and insert rows. Returns the
 * number of rows inserted (0 if the draw type is absent, e.g. a small
 * event with no qualifier).
 */
interface DrawFetchOutcome {
  /** Rows inserted into draw_snapshots (0 = empty/absent draw). */
  inserted: number;
  /** True when the response looked like an expired/invalid nonce:
   *  HTTP 403, or a WP sentinel body of `0` / `-1`. */
  staleNonceSignal: boolean;
}

async function fetchAndStoreDraw(
  deps: FipDrawFetcherDeps,
  t: ActiveTournamentWithSlug,
  config: { ajaxUrl: string; nonce: string; postId: string },
  drawCode: DrawCode
): Promise<DrawFetchOutcome> {
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
  let staleNonceSignal = false;

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
        // WP sentinel: admin-ajax returns the bare string `0` (action not
        // registered) or `-1` (nonce check failed) when the security token is
        // bad/expired. Flag it so the caller can refresh the nonce + retry.
        if (typeof response.data === 'string') {
          const trimmed = response.data.trim();
          if (trimmed === '0' || trimmed === '-1') {
            staleNonceSignal = true;
            return { body, contentHash };
          }
        }
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
    // HTTP 403 from FIP is the canonical "nonce rejected" signal — surface it
    // so the caller can refresh the cached nonce and retry once.
    const status = (err as { response?: { status?: number } })?.response?.status;
    deps.logger?.warn(
      { err, tournamentId: t.tournament_id, drawCode },
      'fip-draw-fetcher: AJAX fetch failed for draw code'
    );
    return { inserted: 0, staleNonceSignal: status === 403 };
  }

  if (staleNonceSignal) return { inserted: 0, staleNonceSignal: true };
  if (!responseOk || parsed.length === 0) return { inserted: 0, staleNonceSignal: false };

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) {
    deps.logger?.warn(
      { tournamentId: t.tournament_id, drawCode },
      'fip-draw-fetcher: scrape job row disappeared between write and read — skipping insert'
    );
    return { inserted: 0, staleNonceSignal: false };
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
  return { inserted: rows.length, staleNonceSignal: false };
}

function safeJsonParse(body: string): { error?: number; html?: string; drawType?: string } | null {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * POST all four draw codes for one tournament with the given config.
 * Returns total rows inserted plus whether any draw signalled a stale nonce.
 *
 * The ONLY stale-nonce signals are unambiguous ones: HTTP 403 and the WP
 * sentinel bodies `0` / `-1`. An all-empty result is NOT a stale-nonce signal
 * — a not-yet-published draw (future / early-week event) returns a valid
 * HTTP 200 with empty/absent payload.html, and misreading that as a nonce
 * failure would needlessly null the shared cache and push the next tournament
 * onto the cold path (an extra ~296 KB event-page GET). WP never returns a
 * valid empty 200 for a nonce failure.
 */
async function fetchAllDraws(
  deps: FipDrawFetcherDeps,
  t: ActiveTournamentWithSlug,
  config: { ajaxUrl: string; nonce: string; postId: string }
): Promise<{ inserted: number; staleNonceSignal: boolean }> {
  let inserted = 0;
  let staleNonceSignal = false;
  for (const code of DRAW_CODES) {
    const outcome = await fetchAndStoreDraw(deps, t, config, code);
    inserted += outcome.inserted;
    if (outcome.staleNonceSignal) staleNonceSignal = true;
  }
  return { inserted, staleNonceSignal };
}

/**
 * Run the FIP draw fetcher across all active tournaments (± 7 days of their
 * window). Appends to `padelgod.draw_snapshots` with `source='fip_event_page'`.
 *
 * Bandwidth optimization: after warmup, ZERO event-page GETs per run — a
 * cached site-wide nonce + per-tournament stored postID drive the draw POSTs
 * directly. See the nonce-cache block at the top of this file.
 */
export async function runFipDrawFetcher(
  deps: FipDrawFetcherDeps
): Promise<FipDrawFetcherResult> {
  const now = deps.now ?? Date.now;
  const isAllowlisted = !!(deps.onlyTournamentIds && deps.onlyTournamentIds.size > 0);

  const { data, error } = await deps.supabase.rpc('padelgod_active_tournaments_with_slug');
  if (error) {
    throw new Error(`padelgod_active_tournaments_with_slug RPC failed: ${error.message}`);
  }
  const allTournaments = (data ?? []) as ActiveTournamentWithSlug[];
  const tournaments = isAllowlisted
    ? allTournaments.filter((t) => deps.onlyTournamentIds!.has(t.tournament_id))
    : allTournaments;

  let tournamentsProcessed = 0;
  let tournamentsSkipped = 0;
  let tournamentsSkippedFinished = 0;
  let totalMatchesInserted = 0;

  for (const t of tournaments) {
    const nowMs = now();

    // Finished-tail skip: a bracket is static once the event has been over for
    // >24h, so re-fetching wastes metered bandwidth. Operator refreshes
    // (onlyTournamentIds) bypass this so a finished event can be force-pulled.
    // Null ends_at is never skipped.
    if (
      !isAllowlisted &&
      t.ends_at &&
      Date.parse(t.ends_at) < nowMs - ONE_DAY_MS
    ) {
      tournamentsSkippedFinished += 1;
      continue;
    }

    const storedPostId = await lookupStoredPostId(deps, t.tournament_id);

    // Fast path: stored postID + fresh cached nonce → no event-page GET.
    if (storedPostId && nonceIsFresh(nowMs)) {
      const config = { ajaxUrl: AJAX_URL, nonce: cachedNonce!.value, postId: storedPostId };
      const outcome = await fetchAllDraws(deps, t, config);

      if (outcome.staleNonceSignal) {
        // Cached nonce looks expired — invalidate, refetch the page once for a
        // fresh nonce (+confirm postID), and retry the draws ONCE.
        cachedNonce = null;
        const fresh = await fetchEventPageConfig(deps, t);
        if (!fresh) {
          tournamentsSkipped += 1;
          continue;
        }
        cachedNonce = { value: fresh.nonce, fetchedAtMs: now() };
        await storePostId(deps, t.tournament_id, fresh.postId);
        tournamentsProcessed += 1;
        const retry = await fetchAllDraws(deps, t, fresh);
        totalMatchesInserted += retry.inserted;
        continue;
      }

      tournamentsProcessed += 1;
      totalMatchesInserted += outcome.inserted;
      continue;
    }

    // Cold path: fetch the event page once (no stored postID, or stale nonce).
    const config = await fetchEventPageConfig(deps, t);
    if (!config) {
      tournamentsSkipped += 1;
      continue;
    }
    cachedNonce = { value: config.nonce, fetchedAtMs: now() };
    await storePostId(deps, t.tournament_id, config.postId);
    tournamentsProcessed += 1;
    const outcome = await fetchAllDraws(deps, t, config);
    totalMatchesInserted += outcome.inserted;
  }

  deps.logger?.info(
    {
      tournamentsProcessed,
      tournamentsSkipped,
      tournamentsSkippedFinished,
      totalMatchesInserted,
    },
    'fip-draw-fetcher run complete'
  );

  return {
    tournamentsProcessed,
    tournamentsSkipped,
    tournamentsSkippedFinished,
    totalMatchesInserted,
  };
}
