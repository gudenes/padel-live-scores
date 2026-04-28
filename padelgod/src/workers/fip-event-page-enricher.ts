// Padelgod worker: fetch each FIP event page, parse the rich overview
// fields (venue, prize money, matchscorer code, registration status,
// prize breakdown, schedule notes), and write them to public.tournaments.
//
// Replaces the Vercel `/api/cron/fip-tournaments` cron's enrichment
// pass — discovery itself stays in padelgod's `tournament-discovery`
// worker (the WP-listing pass).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
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
  registration_status: string | null;
  prize_money_fip: number | null;
  prize_breakdown: unknown;
  level: string | null;
}

const FIP_BASE = 'https://www.padelfip.com';
const PAGE_FETCH_HEADERS = { 'User-Agent': 'PadelNachos/1.0 (padelgod)' };
const ENRICH_BATCH_LIMIT = 200;

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
  return false;
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
      'id, slug, fip_id, matchscorer_url, starts_at, ends_at, venue, ' +
        'registration_status, prize_money_fip, prize_breakdown, level',
    )
    .or(`source.eq.fip,fip_id.not.is.null`)
    .or(`ends_at.is.null,ends_at.gte.${cutoff}`)
    .limit(ENRICH_BATCH_LIMIT);
  if (error) throw new Error(`tournaments read failed: ${error.message}`);

  const candidates = (rows ?? []) as TournamentRow[];
  const targets = candidates.filter(needsEnrichment);

  let enriched = 0;
  let errors = 0;

  for (const t of targets) {
    const slug = t.slug ?? fipIdToSlug(t.fip_id);
    if (!slug) continue;

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
      if (t.venue == null && overview.venue) patch.venue = overview.venue;
      if (t.registration_status == null && overview.registrationStatus) {
        patch.registration_status = overview.registrationStatus;
      }
      if (t.prize_money_fip == null && drawSize.prizeMoney) {
        patch.prize_money_fip = drawSize.prizeMoney;
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
    } catch {
      errors++;
    }
  }

  return { candidates: candidates.length, enriched, errors };
}
