import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipWpEvents } from '../parsers/fip-wp-events.js';
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
    ? await deps.supabase.from('tournaments').select('slug, level').in('slug', slugs)
    : { data: [] };
  const existingLevelBySlug = new Map<string, string | null>(
    ((existing ?? []) as Array<{ slug: string; level: string | null }>).map(
      (r) => [r.slug, r.level],
    ),
  );

  const rows = parsed.map((p) => {
    const level = resolveFipLevel(p.categoryTermIds, p.slug);
    const existingLevel = existingLevelBySlug.get(p.slug);
    const row: Record<string, unknown> = {
      name: p.name,
      slug: p.slug,
      source: 'fip',
      last_updated_by: 'padelgod',
    };
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
