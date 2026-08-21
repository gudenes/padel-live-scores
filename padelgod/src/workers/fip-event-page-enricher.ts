// Padelgod worker: fetch each FIP event page, parse the rich overview
// fields (venue, prize money, matchscorer code, registration status,
// prize breakdown, schedule notes), and write them to public.tournaments.
//
// Replaces the Vercel `/api/cron/fip-tournaments` cron's enrichment
// pass — discovery itself stays in padelgod's `tournament-discovery`
// worker (the WP-listing pass).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import type { Logger } from 'pino';
import {
  parseEventDates,
  parseMatchscorerIds,
  parseCanonicalEventSlug,
  parseDrawSizes,
  parseOverviewFields,
  parsePrizeBreakdown,
  parseFactsheetUrl,
  isBreakdownInflated,
} from '../parsers/fip-event-page-detail.js';

export interface FipEventPageEnricherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger?: Logger;
}

export interface FipEventPageEnricherResult {
  candidates: number;
  enriched: number;
  errors: number;
}

export interface TournamentRow {
  id: string;
  slug: string | null;
  source: string | null;
  fip_id: string | null;
  matchscorer_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  venue: string | null;
  venue_address: string | null;
  venue_type: string | null;
  signup_fee_eur: number | null;
  schedule_notes: string | null;
  round_schedule: Record<string, string> | null;
  draw_size_md: number | null;
  draw_size_qd: number | null;
  registration_status: string | null;
  prize_money_fip: number | null;
  prize_breakdown: unknown;
  level: string | null;
  factsheet_url: string | null;
}

const FIP_BASE = 'https://www.padelfip.com';
const PAGE_FETCH_HEADERS = { 'User-Agent': 'PadelNachos/1.0 (padelgod)' };
const ENRICH_BATCH_LIMIT = 200;
// Polite throttle between FIP page fetches. Right after deploy the
// worker can burst ~200 sequential page fetches before all rows have
// their gap-fill done. 250ms keeps us well under what padelfip.com's
// CDN considers abusive while still completing a full pass in ~50s.
const FETCH_THROTTLE_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildEventPageUrl(slug: string): string {
  return `${FIP_BASE}/events/${slug}/`;
}

/** Strip the leading 'fip-' prefix off fip_id to get the WP slug. */
function fipIdToSlug(fipId: string | null): string | null {
  if (!fipId) return null;
  return fipId.startsWith('fip-') ? fipId.slice(4) : fipId;
}

/**
 * A row needs enrichment if any of the fields the FIP event page
 * exposes is still null, OR if the row's source is FIP and the event
 * is current/future (so we keep its data fresh as FIP edits the page).
 *
 * Re-fetching is cheap; FIP pages are simple HTML and we throttle
 * politely between requests. For padelapi-survivor rows we only fetch
 * when there's a gap to fill or the registration_status is still
 * relevant — padelapi owns most fields there, so re-fetching is
 * mostly wasted work.
 */
export function needsEnrichment(row: TournamentRow): boolean {
  if (row.matchscorer_url == null) return true;
  if (row.starts_at == null) return true;
  if (row.ends_at == null) return true;
  if (row.venue == null) return true;
  if (row.registration_status == null) return true;
  if (row.prize_money_fip == null) return true;
  if (row.prize_breakdown == null) return true;  // PR 3 — also retry when breakdown is missing

  // Self-heal: a stored breakdown left ×100-inflated by the legacy
  // comma-strip parser must be re-fetched even for past events, so the
  // fixed parser overwrites it. The write path force-overwrites an
  // inflated breakdown (see below) so this can't loop.
  if (isBreakdownInflated(
    row.prize_breakdown as Parameters<typeof isBreakdownInflated>[0],
    row.level,
  )) return true;

  const endsAtMs = row.ends_at ? Date.parse(row.ends_at) : null;
  const isCurrentOrFuture =
    endsAtMs == null || endsAtMs > Date.now() - 24 * 60 * 60 * 1000;

  // FIP-sourced rows: always re-fetch while the event is in the play
  // window so any drift (date edits, prize updates, registration
  // open→closed) lands on the next hourly tick. For padelapi rows we
  // only refresh registration_status during the life cycle.
  return isCurrentOrFuture;
}

export async function runFipEventPageEnricher(
  deps: FipEventPageEnricherDeps,
): Promise<FipEventPageEnricherResult> {
  // 1. Load tournaments that might need enrichment. Filter:
  //    - source = 'fip' OR fip_id IS NOT NULL (we have a way to fetch)
  //    - ends_at IS NULL OR ends_at > now() - 14 days (skip old archives)
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await deps.supabase
    .from('tournaments')
    .select(
      'id, slug, source, fip_id, matchscorer_url, starts_at, ends_at, ' +
        'venue, venue_address, venue_type, signup_fee_eur, schedule_notes, ' +
        'round_schedule, ' +
        'draw_size_md, draw_size_qd, ' +
        'registration_status, prize_money_fip, prize_breakdown, level, ' +
        'factsheet_url',
    )
    .or(`source.eq.fip,fip_id.not.is.null`)
    .or(`ends_at.is.null,ends_at.gte.${cutoff}`)
    .limit(ENRICH_BATCH_LIMIT);
  if (error) throw new Error(`tournaments read failed: ${error.message}`);

  // PostgREST's inferred row type widens to GenericStringError when the
  // select column list is partial (it can't statically know whether the
  // returned shape is the row or an error). We've already checked
  // `error` above so a runtime row is guaranteed to be a row — peel
  // off the error variant via `unknown`.
  const candidates = ((rows ?? []) as unknown) as TournamentRow[];
  const targets = candidates.filter(needsEnrichment);

  let enriched = 0;
  let errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    const slug = t.slug ?? fipIdToSlug(t.fip_id);
    if (!slug) continue;

    // Throttle between fetches — skip the wait on the very first iteration.
    if (i > 0) await sleep(FETCH_THROTTLE_MS);

    try {
      const url = buildEventPageUrl(slug);
      const resp = await deps.httpClient.get(url, { headers: PAGE_FETCH_HEADERS });
      const html = String(resp.data);

      const dates = parseEventDates(html);
      const matchscorer = parseMatchscorerIds(html);
      const canonicalSlug = parseCanonicalEventSlug(html);
      const drawSize = parseDrawSizes(html);
      const overview = parseOverviewFields(html, {
        startsAt: t.starts_at ?? null,
        endsAt: t.ends_at ?? null,
        level: t.level ?? null,
      });
      const prizeBreakdown = parsePrizeBreakdown(html);

      const patch: Record<string, unknown> = {
        last_updated_by: 'padelgod',
        updated_at: new Date().toISOString(),
      };

      // Refresh policy:
      //   - FIP-sourced rows (source='fip'): the FIP page is the source
      //     of truth. Every field the page exposes gets OVERWRITTEN on
      //     each run so any drift on FIP (date changes, prize updates,
      //     venue moves, registration status flips) lands in our DB the
      //     next time the worker fires.
      //   - Padelapi-survivor rows (source='padelapi' with fip_id):
      //     padelapi is primary per source-priority.ts. Keep gap-fill
      //     for those — only write FIP values where padelapi has
      //     nothing.
      const isFipPrimary = t.source === 'fip'
      const writeFromFip = (
        col: string,
        currentVal: unknown,
        newVal: unknown,
      ) => {
        if (newVal == null) return
        if (isFipPrimary || currentVal == null) {
          patch[col] = newVal as unknown
        }
      }

      writeFromFip('starts_at', t.starts_at, dates.startsAt)
      writeFromFip('ends_at', t.ends_at, dates.endsAt)

      // Matchscorer ownership. Crionet hosts ONE bracket per code. FIP
      // often keeps two WP slugs for the same event; both 200 and embed
      // the same code, but rel=canonical names the slug FIP publishes.
      // widget_id_cache.widget_id is UNIQUE, so an alias that won search
      // blocks the canonical row — populator/live-poller then skip it.
      //
      // Rule: canonical → another slug = this row is an alias, do not
      // claim. This page IS canonical (or has no canonical) → claim,
      // moving matchscorer_url + cache off any other owner.
      const isCanonicalPage = !canonicalSlug || canonicalSlug === slug;
      let skipMatchscorerWrite = false;
      if (matchscorer?.code && !isCanonicalPage) {
        skipMatchscorerWrite = true;
        deps.logger?.info?.(
          {
            tournamentId: t.id,
            slug,
            canonicalSlug,
            matchscorerCode: matchscorer.code,
          },
          'fip-event-page-enricher: skipping matchscorer write — page canonical is a different slug',
        );
      }

      if (matchscorer?.code && !skipMatchscorerWrite) {
        const { data: urlOwner, error: urlOwnerErr } = await deps.supabase
          .from('tournaments')
          .select('id, name')
          .eq('matchscorer_url', matchscorer.code)
          .neq('id', t.id)
          .limit(1)
          .maybeSingle();
        if (urlOwnerErr) {
          deps.logger?.warn(
            { tournamentId: t.id, slug, err: urlOwnerErr.message },
            'fip-event-page-enricher: matchscorer_url conflict probe failed — skipping matchscorer write',
          );
          skipMatchscorerWrite = true;
        }

        let cacheOwnerId: string | null = null;
        if (!skipMatchscorerWrite) {
          const { data: cacheOwner, error: cacheOwnerErr } = await deps.supabase
            .schema('padelgod')
            .from('widget_id_cache')
            .select('tournament_id')
            .eq('widget_id', matchscorer.code)
            .neq('tournament_id', t.id)
            .maybeSingle();
          if (cacheOwnerErr) {
            deps.logger?.warn(
              { tournamentId: t.id, slug, err: cacheOwnerErr.message },
              'fip-event-page-enricher: widget_id_cache conflict probe failed — skipping matchscorer write',
            );
            skipMatchscorerWrite = true;
          } else {
            cacheOwnerId =
              (cacheOwner as { tournament_id?: string } | null)?.tournament_id ??
              null;
          }
        }

        const stealFromId = skipMatchscorerWrite
          ? null
          : ((urlOwner as { id?: string } | null)?.id ?? cacheOwnerId);
        if (stealFromId) {
          const { error: clearUrlErr } = await deps.supabase
            .from('tournaments')
            .update({
              matchscorer_url: null,
              last_updated_by: 'padelgod',
              updated_at: new Date().toISOString(),
            })
            .eq('id', stealFromId);
          if (clearUrlErr) {
            deps.logger?.warn(
              { tournamentId: t.id, stealFromId, err: clearUrlErr.message },
              'fip-event-page-enricher: failed to clear alias matchscorer_url',
            );
          }
          const { error: delCacheErr } = await deps.supabase
            .schema('padelgod')
            .from('widget_id_cache')
            .delete()
            .eq('tournament_id', stealFromId);
          if (delCacheErr) {
            deps.logger?.warn(
              { tournamentId: t.id, stealFromId, err: delCacheErr.message },
              'fip-event-page-enricher: failed to delete alias widget_id_cache',
            );
          }
          deps.logger?.info?.(
            {
              tournamentId: t.id,
              slug,
              stealFromId,
              matchscorerCode: matchscorer.code,
            },
            'fip-event-page-enricher: reassigned matchscorer widget to canonical FIP slug',
          );
        }
      }
      if (!skipMatchscorerWrite) {
        writeFromFip('matchscorer_url', t.matchscorer_url, matchscorer?.code ?? null)
      }

      // Mirror the matchscorer code into padelgod.widget_id_cache. Two
      // workers populate that table:
      //   1. widget-code-lookup — searches Crionet's tournament search
      //      by name. Brittle: misspelled names, regional events, or
      //      tournaments crionet doesn't index publicly never get found.
      //   2. THIS enricher — parses the FIP event page directly. The
      //      matchscorer code is embedded in the page HTML for every
      //      tournament Crionet hosts a draw for, so this path is far
      //      more reliable than the search-based one.
      //
      // Without this mirror, downstream workers (oop-fetcher, results-
      // fetcher, fip-draw-populator) all read widget_id_cache to gate
      // their work; tournaments visible to padelfip.com but missing
      // from Crionet's search end up with rich draw_snapshots +
      // entry_list_snapshots and ZERO matches in public.matches.
      //
      // Concrete unblock that motivated this: FIP Silver Leiria (and
      // every other Silver/Gold tournament where widget-code-lookup
      // hit the 12-attempt circuit breaker without finding the code).
      // See `widget-code-lookup` worker + the Tournament Explorer's
      // `padelgod.widget_id_cache` fallback merged in `ef1c036`.
      if (matchscorer?.code && !skipMatchscorerWrite) {
        const { error: cacheErr } = await deps.supabase
          .schema('padelgod')
          .from('widget_id_cache')
          .upsert(
            {
              tournament_id: t.id,
              widget_id: matchscorer.code,
              extracted_at: new Date().toISOString(),
              last_validated_at: new Date().toISOString(),
              is_active: true,
              // 'page_regex' is the closest match in the existing
              // CHECK constraint on extraction_method
              // ('search', 'iframe', 'page_regex', 'manual'). The
              // matchscorer code IS extracted by regex from the
              // event-page HTML so the bucket fits semantically.
              extraction_method: 'page_regex',
            },
            { onConflict: 'tournament_id', ignoreDuplicates: false },
          );
        if (cacheErr) {
          // Don't fail the whole enrichment over a cache mirror —
          // log + continue. The main `tournaments` UPDATE below is
          // the authoritative write; the cache is a denormalisation.
          deps.logger?.warn(
            { tournamentId: t.id, err: cacheErr.message },
            'fip-event-page-enricher: widget_id_cache mirror failed',
          );
        }
      }
      writeFromFip('venue', t.venue, overview.venue)
      writeFromFip('venue_address', t.venue_address, overview.venueAddress)
      writeFromFip('venue_type', t.venue_type, overview.venueType)
      writeFromFip('signup_fee_eur', t.signup_fee_eur, overview.signupFeeEur)
      writeFromFip('schedule_notes', t.schedule_notes, overview.scheduleNotes)
      // Only write when the parser produced something. Empty {} means the
      // scrape didn't carry a parseable Play Order — keep the existing column
      // value (might have been set by a prior run with better data).
      if (Object.keys(overview.roundSchedule).length > 0) {
        writeFromFip('round_schedule', t.round_schedule, overview.roundSchedule)
      }
      writeFromFip('draw_size_md', t.draw_size_md, drawSize.mainDraw)
      writeFromFip('draw_size_qd', t.draw_size_qd, drawSize.qualifyingDraw)
      writeFromFip('prize_money_fip', t.prize_money_fip, drawSize.prizeMoney)
      writeFromFip('prize_breakdown', t.prize_breakdown, prizeBreakdown)
      // Force-overwrite a legacy ×100-inflated breakdown even on
      // padelapi-survivor rows (writeFromFip only gap-fills those). The
      // freshly-parsed value is correct, so replacing the corruption is safe.
      if (
        prizeBreakdown &&
        isBreakdownInflated(
          t.prize_breakdown as Parameters<typeof isBreakdownInflated>[0],
          t.level,
        )
      ) {
        patch.prize_breakdown = prizeBreakdown
      }
      writeFromFip('registration_status', t.registration_status, overview.registrationStatus)

      // Factsheet PDF: detect link from event page. When the URL CHANGES,
      // also reset factsheet_processed_at so the processor cron re-extracts
      // against the new file. If we ever see a re-upload (FACTSHEET-2.pdf
      // replacing FACTSHEET-1.pdf, or a year/month folder bump), this
      // ensures the cached factsheet_data refreshes.
      const newFactsheetUrl = parseFactsheetUrl(html)
      if (newFactsheetUrl && newFactsheetUrl !== t.factsheet_url) {
        patch.factsheet_url = newFactsheetUrl
        patch.factsheet_processed_at = null
      }

      // For padelapi-survivor rows, registration_status still flips
      // open→closed during the life cycle and padelapi doesn't track
      // it — write FIP's value even if the existing column is set,
      // but only while the event is current/future.
      if (!isFipPrimary && overview.registrationStatus) {
        const endsAtMs = t.ends_at ? Date.parse(t.ends_at) : null
        const isCurrentOrFuture =
          endsAtMs == null || endsAtMs > Date.now() - 24 * 60 * 60 * 1000
        if (isCurrentOrFuture) {
          patch.registration_status = overview.registrationStatus
        }
      }

      // Only update if there's something beyond the bookkeeping fields.
      const writeKeys = Object.keys(patch).filter(
        (k) => k !== 'last_updated_by' && k !== 'updated_at',
      );
      if (writeKeys.length === 0) continue;

      const { error: updErr } = await deps.supabase
        .from('tournaments')
        .update(patch)
        .eq('id', t.id);
      if (updErr) throw new Error(`update failed: ${updErr.message}`);
      enriched++;
    } catch (err) {
      errors++;
      const message = err instanceof Error ? err.message : String(err);
      // Surface in Railway logs so spikes in `errors` aren't silent.
      // Includes the slug so an operator can replay one tournament
      // manually if a parse keeps failing.
      deps.logger?.warn(
        { slug, tournamentId: t.id, err: message },
        'fip-event-page-enricher: row failed',
      );
    }
  }

  return { candidates: candidates.length, enriched, errors };
}
