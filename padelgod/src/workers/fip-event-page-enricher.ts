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
  parseDrawSizes,
  parseOverviewFields,
  parsePrizeBreakdown,
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
  fip_id: string | null;
  matchscorer_url: string | null;
  starts_at: string | null;
  ends_at: string | null;
  venue: string | null;
  venue_address: string | null;
  venue_type: string | null;
  signup_fee_eur: number | null;
  schedule_notes: string | null;
  draw_size_md: number | null;
  draw_size_qd: number | null;
  registration_status: string | null;
  prize_money_fip: number | null;
  prize_breakdown: unknown;
  level: string | null;
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
 * exposes is still null. Re-fetching is cheap; the upstream HTML is
 * static for finished events.
 */
export function needsEnrichment(row: TournamentRow): boolean {
  if (row.matchscorer_url == null) return true;
  if (row.starts_at == null) return true;
  if (row.ends_at == null) return true;
  if (row.venue == null) return true;
  if (row.registration_status == null) return true;
  if (row.prize_money_fip == null) return true;
  // Even when fully populated, refresh current/upcoming events so we
  // pick up the registration_status flip from open → closed during
  // the tournament life cycle. The actual write is gated below — fields
  // already populated stay untouched (gap-fill semantics).
  const endsAtMs = row.ends_at ? Date.parse(row.ends_at) : null;
  const isCurrentOrFuture =
    endsAtMs == null || endsAtMs > Date.now() - 24 * 60 * 60 * 1000;
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
      'id, slug, fip_id, matchscorer_url, starts_at, ends_at, ' +
        'venue, venue_address, venue_type, signup_fee_eur, schedule_notes, ' +
        'draw_size_md, draw_size_qd, ' +
        'registration_status, prize_money_fip, prize_breakdown, level',
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
      const drawSize = parseDrawSizes(html);
      const overview = parseOverviewFields(html);
      const prizeBreakdown = parsePrizeBreakdown(html);

      const patch: Record<string, unknown> = {
        last_updated_by: 'padelgod',
        updated_at: new Date().toISOString(),
      };

      // Gap-fill: only write fields where the existing row is null.
      // We don't want to overwrite manual operator edits or padelapi-
      // primary fields like name/level/country.
      if (t.starts_at == null && dates.startsAt) patch.starts_at = dates.startsAt;
      if (t.ends_at == null && dates.endsAt) patch.ends_at = dates.endsAt;
      if (t.matchscorer_url == null && matchscorer?.code) {
        patch.matchscorer_url = matchscorer.code;
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
      if (matchscorer?.code) {
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
              extraction_method: 'fip_event_page_enricher',
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
      if (t.venue == null && overview.venue) patch.venue = overview.venue;
      if (t.registration_status == null && overview.registrationStatus) {
        patch.registration_status = overview.registrationStatus;
      }
      if (t.prize_money_fip == null && drawSize.prizeMoney) {
        patch.prize_money_fip = drawSize.prizeMoney;
      }
      if (t.venue_address == null && overview.venueAddress) {
        patch.venue_address = overview.venueAddress;
      }
      if (t.venue_type == null && overview.venueType) {
        patch.venue_type = overview.venueType;
      }
      if (t.signup_fee_eur == null && overview.signupFeeEur != null) {
        patch.signup_fee_eur = overview.signupFeeEur;
      }
      if (t.schedule_notes == null && overview.scheduleNotes) {
        patch.schedule_notes = overview.scheduleNotes;
      }
      if (t.draw_size_md == null && drawSize.mainDraw != null) {
        patch.draw_size_md = drawSize.mainDraw;
      }
      if (t.draw_size_qd == null && drawSize.qualifyingDraw != null) {
        patch.draw_size_qd = drawSize.qualifyingDraw;
      }
      if (t.prize_breakdown == null && prizeBreakdown) {
        patch.prize_breakdown = prizeBreakdown;
      }

      // Refresh registration_status on every pass for upcoming events
      // (it changes during life-cycle: open → closed). Override the
      // gap-fill above when the event hasn't ended yet.
      const endsAtMs = t.ends_at ? Date.parse(t.ends_at) : null;
      const isCurrentOrFuture =
        endsAtMs == null || endsAtMs > Date.now() - 24 * 60 * 60 * 1000;
      if (isCurrentOrFuture && overview.registrationStatus) {
        patch.registration_status = overview.registrationStatus;
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
