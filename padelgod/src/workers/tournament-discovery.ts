import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipWpEvents } from '../parsers/fip-wp-events.js';
import { parseFipWpCountries, type RawCountryTerm } from '../parsers/fip-wp-countries.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_WP_EVENTS_VERSION } from '../lib/parser-versions.js';
import { resolveFipLevel, resolvePremierLevel } from '../lib/fip-categories.js';

export interface TournamentDiscoveryDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface TournamentDiscoveryResult {
  discovered: number;
  scrapeJobId: string;
}

const WP_API_BASE = 'https://www.padelfip.com/wp-json/wp/v2/events';
const WP_COUNTRY_BASE = 'https://www.padelfip.com/wp-json/wp/v2/country';

export async function runTournamentDiscovery(
  deps: TournamentDiscoveryDeps
): Promise<TournamentDiscoveryResult> {
  // 1. Look up max updated_at across tournaments (incremental sync key)
  const { data: latest } = await deps.supabase
    .from('tournaments')
    .select('updated_at')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const params = new URLSearchParams({ per_page: '100', orderby: 'modified', order: 'asc' });
  if (latest?.updated_at) {
    params.set('modified_after', latest.updated_at);
  }
  const targetUrl = `${WP_API_BASE}?${params.toString()}`;

  // 2. Scrape (with job tracking)
  let parsed: ReturnType<typeof parseFipWpEvents> = [];
  const jobResult = await runScrapeJob(
    deps.supabase,
    {
      jobType: 'discover',
      tournamentId: null,
      targetUrl,
      parserVersion: FIP_WP_EVENTS_VERSION,
      captureBody: false,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = JSON.stringify(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseFipWpEvents(response.data);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) {
    return { discovered: 0, scrapeJobId: jobResult.scrapeJobId };
  }

  // 3. Upsert (conflict on slug, which is the canonical FIP id post-Plan-1 rename).
  //
  // `level` is derived from the WP `category-event` taxonomy via
  // resolveFipLevel — that's how Promises/Beyond/Hexagon/Championships
  // tournaments get a non-null level (the Vercel scraper that previously
  // owned this only knew about Gold/Silver/Bronze and is now paused).
  // resolveFipLevel returns null for Premier-tier categories, in which
  // case we fall through to resolvePremierLevel for a gap-fill: write
  // the WP-derived Premier level only when the existing row has null —
  // padelapi remains the primary owner when it has already set a value.

  // Pre-fetch existing rows so we can apply the Premier gap-fill: write
  // `level` only when the existing row has null (padelapi remains the
  // primary owner — but if padelapi never wrote, our WP-derived level
  // keeps the row visible in the public app).
  const slugs = parsed.map((p) => p.slug).filter((s): s is string => !!s);
  const { data: existing } = slugs.length > 0
    ? await deps.supabase.from('tournaments').select('slug, level, country').in('slug', slugs)
    : { data: [] };
  const existingBySlug = new Map<
    string,
    { level: string | null; country: string | null }
  >(
    ((existing ?? []) as Array<{ slug: string; level: string | null; country: string | null }>).map(
      (r) => [r.slug, { level: r.level, country: r.country }],
    ),
  );

  // Fetch the WP `country` taxonomy once per run so we can resolve the
  // `country` term-id arrays on each event into ISO alpha-2 codes. Only
  // worth doing if at least one parsed event carries a country term —
  // saves a (cacheable) round-trip on empty/null deltas.
  const needsCountryMap = parsed.some((p) => p.countryTermIds.length > 0);
  const countryByTermId = needsCountryMap
    ? await fetchFipCountryTaxonomy(deps.httpClient)
    : new Map<number, string | null>();

  const rows = parsed.map((p) => {
    const level = resolveFipLevel(p.categoryTermIds, p.slug);
    const existingLevel = existingBySlug.get(p.slug)?.level;
    const existingCountry = existingBySlug.get(p.slug)?.country;
    const row: Record<string, unknown> = {
      name: p.name,
      slug: p.slug,
      source: 'fip',
      last_updated_by: 'padelgod',
    };

    // Country gap-fill. Source-priority for `tournament.country` is
    // ['padelapi', 'fip'] — padelapi is primary, FIP is fallback. So
    // we only write when the existing row has no country (which is
    // the case for FIP-only tiers like fip_beyond / fip_promises /
    // fip_championship that padelapi doesn't carry at all). For rows
    // padelapi has already populated, we explicitly echo the existing
    // country back into the payload to defeat Supabase's merge-
    // duplicates "missing column → reset to default" behaviour
    // (same gotcha that blanked `level` in the Asuncion P2 incident).
    const firstCountryTerm = p.countryTermIds[0];
    if (firstCountryTerm != null) {
      const resolved = countryByTermId.get(firstCountryTerm) ?? null;
      if (resolved && (existingCountry == null || existingCountry === '')) {
        row.country = resolved;
      } else if (existingCountry != null && existingCountry !== '') {
        row.country = existingCountry;
      }
    } else if (existingCountry != null && existingCountry !== '') {
      row.country = existingCountry;
    }
    if (level) {
      // Authoritative tier (non-Premier) — always write.
      row.level = level;
    } else {
      // Premier-tier or unknown taxonomy. Try the gap-fill first; if
      // it doesn't apply, preserve whatever level the existing row
      // already has by writing it back explicitly.
      //
      // Why explicit-preserve: Supabase `.upsert()` with merge-
      // duplicates resets columns missing from the payload to their
      // DEFAULT on the UPDATE path. A partial payload that omits
      // `level` therefore CLOBBERS existing values to NULL — breaking
      // any tournament whose level was set via padelapi sync, an ops
      // manual link/edit, or a previous run of resolveFipLevel that
      // has since changed (WP taxonomy retagged, slug renamed, …).
      //
      // Concrete repro that motivated this fix: Asuncion P2 2026 had
      // `level='p2'` set via ops manual link; the next discovery run
      // saw resolveFipLevel=null + resolvePremierLevel=null and the
      // upsert reset it to NULL. The tournament then disappeared from
      // the public app's `.in('level', PREMIER_LEVELS)` filter on the
      // FIP tab. (Same bug fired on 2026-04-28 and again 2026-04-29
      // — a one-shot SQL patch each day was the symptom.)
      const premierLevel = resolvePremierLevel(p.categoryTermIds, p.slug);
      if (premierLevel && (existingLevel == null || existingLevel === '')) {
        row.level = premierLevel;
      } else if (existingLevel != null && existingLevel !== '') {
        row.level = existingLevel;
      }
      // else: brand-new row with no level signal — leave undefined,
      // which lets the column's NULL default apply on insert.
    }
    return row;
  });

  const { error: upsertErr } = await deps.supabase
    .from('tournaments')
    .upsert(rows, { onConflict: 'slug', ignoreDuplicates: false });

  if (upsertErr) {
    throw new Error(`Tournament upsert failed: ${upsertErr.message}`);
  }

  return { discovered: parsed.length, scrapeJobId: jobResult.scrapeJobId };
}

// Pulls the full `country` taxonomy from the FIP WP API (≈140 terms,
// fits in 2 pages of 100). Failures degrade gracefully — discovery
// still runs, country gap-fill is just a no-op for that pass.
async function fetchFipCountryTaxonomy(
  httpClient: AxiosInstance,
): Promise<Map<number, string | null>> {
  const all: RawCountryTerm[] = [];
  try {
    for (let page = 1; page <= 5; page++) {
      const url = `${WP_COUNTRY_BASE}?per_page=100&page=${page}`;
      const response = await httpClient.get(url);
      const data = response.data;
      if (!Array.isArray(data) || data.length === 0) break;
      all.push(...(data as RawCountryTerm[]));
      if (data.length < 100) break;
    }
  } catch {
    // Best-effort. Returning whatever we have (possibly empty) is
    // safer than failing discovery over a stale country map.
  }
  return parseFipWpCountries(all);
}
