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
  /** Count of FIP events that matched an existing padelapi twin and
   *  were merged into the existing row instead of inserted as a
   *  duplicate. Should be 0 in steady state — non-zero values flag
   *  data we'd otherwise have had to clean up retroactively. */
  twinMerges: number;
}

const WP_API_BASE = 'https://www.padelfip.com/wp-json/wp/v2/events';
const WP_COUNTRY_BASE = 'https://www.padelfip.com/wp-json/wp/v2/country';

// ── Cross-source twin detection ────────────────────────────────────────
//
// Mirrors `tokenize()` and `groupKey()` from src/lib/source-matcher.ts +
// scripts/merge-tournament-duplicates.ts. Inlined because padelgod runs
// as a separate Railway service and doesn't share imports with the
// Next.js app — same trade-off used by `normalizeRoundShort` in
// fip-oop-writer.ts. The token list and rules must stay in lock-step
// with that file; if you tweak one, mirror the other.
//
// Why this exists: padelapi-imported tournament rows have `slug = null`,
// while padelgod's tournament-discovery upserts on `onConflict: 'slug'`.
// Result: every padelapi-sourced tournament that also has a FIP page
// gets a SECOND row inserted instead of being enriched in place. Cross-
// source duplicates accumulate, downstream writers (fip-event-page-
// enricher, fip-draw-populator, OOP writer) split work between the two
// rows, and the public app shows duplicates / orphan UPCOMING matches.
//
// Detection: name-token subset match + same year against the existing
// padelapi-linked rows. Match → write FIP fields onto that row instead
// of inserting a new one.
const TOURNAMENT_NOISE_TOKENS: ReadonlySet<string> = new Set([
  'premier', 'padel', 'tour', 'open', 'season', 'championship', 'championships',
  'master', 'masters', 'cup', 'club', 'aniversario', 'edition',
]);

function tournamentTokenize(s: string | null | undefined): string[] {
  if (!s) return [];
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !TOURNAMENT_NOISE_TOKENS.has(t));
}

function tournamentGroupKey(name: string | null, startsAt: string | null): string | null {
  if (!name) return null;
  const tokens = tournamentTokenize(name);
  if (tokens.length === 0) return null;
  const year = startsAt?.slice(0, 4) ?? '0000';
  return `${tokens.sort().join(' ')}|${year}`;
}

interface TwinCandidate {
  id: string;
  slug: string | null;
  fip_id: string | null;
  padelapi_id: string | null;
  level: string | null;
  country: string | null;
}

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

  // `_embed=true` makes the WP API expand `featured_media` into a
  // `_embedded['wp:featuredmedia']` block carrying the actual image URL.
  // We use that URL as the auto-fallback cover image (ops manual uploads
  // continue to win — see the cover_image_url gap-fill below).
  const params = new URLSearchParams({
    per_page: '100',
    orderby: 'modified',
    order: 'asc',
    _embed: 'true',
  });
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
    return { discovered: 0, scrapeJobId: jobResult.scrapeJobId, twinMerges: 0 };
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
    ? await deps.supabase
        .from('tournaments')
        .select('slug, level, country, live_source, cover_image_url')
        .in('slug', slugs)
    : { data: [] };
  const existingBySlug = new Map<
    string,
    {
      level: string | null;
      country: string | null;
      live_source: string | null;
      cover_image_url: string | null;
    }
  >(
    (
      (existing ?? []) as Array<{
        slug: string;
        level: string | null;
        country: string | null;
        live_source: string | null;
        cover_image_url: string | null;
      }>
    ).map((r) => [
      r.slug,
      {
        level: r.level,
        country: r.country,
        live_source: r.live_source,
        cover_image_url: r.cover_image_url,
      },
    ]),
  );

  // Twin detection: pull every padelapi-linked tournament that doesn't
  // already carry a FIP slug/id. Any of these is a candidate to absorb
  // a parsed FIP event whose name+year matches. Bounded by year-of-the-
  // parsed-events so we don't drag the whole archive into memory.
  // FIP slugs follow `fip-{level}-{location}-{year}` (e.g.
  // `fip-silver-club-la-calzada-2026`). Pull the year from the slug
  // when present — that gives us a tighter twin search window than
  // falling back to publishedGmt (which often lags actual event year).
  const parsedYears = new Set<string>();
  for (const p of parsed) {
    const slugYear = p.slug.match(/-(\d{4})(?:-|$)/)?.[1];
    const pubYear = p.publishedGmt?.slice(0, 4);
    const y = slugYear ?? pubYear;
    if (y && /^(19|20)\d{2}$/.test(y)) parsedYears.add(y);
  }
  const twinByGroupKey = new Map<string, TwinCandidate>();
  if (parsedYears.size > 0) {
    const yearStart = `${[...parsedYears].sort()[0]}-01-01`;
    const yearEnd = `${[...parsedYears].sort().pop()}-12-31`;
    const { data: cand } = await deps.supabase
      .from('tournaments')
      .select('id, slug, fip_id, padelapi_id, level, country, name, starts_at')
      .not('padelapi_id', 'is', null)
      .is('fip_id', null)
      .gte('starts_at', yearStart)
      .lte('starts_at', yearEnd);
    for (const c of (cand ?? []) as Array<TwinCandidate & { name: string; starts_at: string | null }>) {
      const key = tournamentGroupKey(c.name, c.starts_at);
      if (key) twinByGroupKey.set(key, c);
    }
  }

  // Fetch the WP `country` taxonomy once per run so we can resolve the
  // `country` term-id arrays on each event into ISO alpha-2 codes. Only
  // worth doing if at least one parsed event carries a country term —
  // saves a (cacheable) round-trip on empty/null deltas.
  const needsCountryMap = parsed.some((p) => p.countryTermIds.length > 0);
  const countryByTermId = needsCountryMap
    ? await fetchFipCountryTaxonomy(deps.httpClient)
    : new Map<number, string | null>();

  // Track twin redirects for telemetry — every match here is one
  // duplicate row that would have been created pre-fix.
  const twinMerges: Array<{ twinId: string; slug: string; name: string }> = [];

  // twinIds is populated during the map below (twinMerges accumulates as
  // we iterate), so we define a live Set here and fill it incrementally.
  // The downstream batch-split code references the same Set after the map.
  const twinIds = new Set<string>();

  const rows = parsed.map((p) => {
    const level = resolveFipLevel(p.categoryTermIds, p.slug);

    // Twin lookup: if a padelapi-imported row exists with the same
    // name+year and no FIP slug yet, route this event INTO that row.
    // The slug lands on the existing row, so subsequent runs hit the
    // normal `onConflict: 'slug'` path and update in place.
    //
    // Source priority is preserved: we don't overwrite name (padelapi
    // is primary), and country/level gap-fills check the existing
    // values just like the standard branch below.
    const slugYear = p.slug.match(/-(\d{4})(?:-|$)/)?.[1];
    const groupKey = tournamentGroupKey(
      p.name,
      slugYear ? `${slugYear}-01-01` : (p.publishedGmt ?? null),
    );
    const twin = groupKey ? twinByGroupKey.get(groupKey) : null;

    const existingLevel = twin?.level ?? existingBySlug.get(p.slug)?.level;
    const existingCountry = twin?.country ?? existingBySlug.get(p.slug)?.country;
    const row: Record<string, unknown> = {
      ...(twin ? { id: twin.id } : {}),
      name: p.name,
      slug: p.slug,
      source: 'fip',
      last_updated_by: 'padelgod',
    };
    if (twin) {
      // Mark the lookup so the future `onConflict: 'id'` path updates
      // the existing row, and remove from the slug map so we don't
      // double-count it in the upsert telemetry.
      twinMerges.push({ twinId: twin.id, slug: p.slug, name: p.name });
      twinIds.add(twin.id);
    }

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

    // Cover image gap-fill. FIP's WP API exposes the event poster via
    // _embedded['wp:featuredmedia'][0].source_url (already extracted by
    // the parser). We write it as the cover ONLY when the row has no
    // cover yet — ops manual uploads through /api/ops/tournaments/[id]/
    // cover always win. Existing non-null covers are echoed back into
    // the payload to defeat Supabase upsert's "missing column → reset
    // to default" behavior (same gotcha that motivated the level/
    // country preservation above).
    const existingCover =
      twin == null ? existingBySlug.get(p.slug)?.cover_image_url ?? null : null;
    if (p.featuredMediaUrl && (existingCover == null || existingCover === '')) {
      row.cover_image_url = p.featuredMediaUrl;
    } else if (existingCover != null && existingCover !== '') {
      row.cover_image_url = existingCover;
    }

    // Auto-flip: new tournaments default to padelgod-owned. Existing rows
    // are NEVER touched — never silently flip an in-flight tournament.
    // Per spec: docs/superpowers/specs/2026-05-02-padelapi-departure-design.md §3
    const existingForSlug = existingBySlug.get(p.slug);
    const isTwinUpdate = typeof row.id === 'string' && twinIds.has(row.id);
    if (!existingForSlug && !isTwinUpdate) {
      row.live_source = 'padelgod';
    } else if (existingForSlug?.live_source != null) {
      // Echo existing value back into the payload to defeat Supabase
      // upsert's "missing column → reset to default" behavior on UPDATE
      // (same gotcha as level/country preservation above).
      row.live_source = existingForSlug.live_source;
    }

    return row;
  });

  // Split into two upsert batches: rows targeting an existing padelapi
  // twin go through `onConflict: 'id'` (update by primary key — the
  // safe, normal way to mutate a known row). The rest go through the
  // historical `onConflict: 'slug'` path (insert when new, update on
  // slug match). Doing both in one batch with `onConflict: 'slug'`
  // would fail for twins because they don't yet have a slug to match.
  // (twinIds was populated incrementally during the map above)
  const twinRows = rows.filter((r) => typeof r.id === 'string' && twinIds.has(r.id));
  const newRows = rows.filter((r) => !twinRows.includes(r));

  if (twinRows.length > 0) {
    const { error: twinErr } = await deps.supabase
      .from('tournaments')
      .upsert(twinRows, { onConflict: 'id', ignoreDuplicates: false });
    if (twinErr) {
      throw new Error(`Tournament twin-merge upsert failed: ${twinErr.message}`);
    }
  }

  if (newRows.length > 0) {
    const { error: upsertErr } = await deps.supabase
      .from('tournaments')
      .upsert(newRows, { onConflict: 'slug', ignoreDuplicates: false });
    if (upsertErr) {
      throw new Error(`Tournament upsert failed: ${upsertErr.message}`);
    }
  }

  return {
    discovered: parsed.length,
    scrapeJobId: jobResult.scrapeJobId,
    twinMerges: twinMerges.length,
  };
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
