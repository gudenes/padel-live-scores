import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseCrionetOop } from '../parsers/crionet-oop.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { CRIONET_OOP_VERSION } from '../lib/parser-versions.js';
import {
  linkOopSnapshotsToPublicMatches,
  type PublicMatchCandidate,
} from '../lib/oop-linker.js';

export interface OopFetcherDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface OopFetcherResult {
  tournamentsProcessed: number;
  totalMatchesInserted: number;
}

interface ActiveTournament {
  tournament_id: string;
  widget_id: string;
  expected_days: number;
}

const URL_FOR = (code: string, day: number) =>
  `https://widget.matchscorerlive.com/screen/oopbyday/${code}/${day}?t=tol`;

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

async function fetchOneDay(
  deps: OopFetcherDeps,
  t: ActiveTournament,
  day: number
): Promise<number> {
  const targetUrl = URL_FOR(t.widget_id, day);
  let parsed: ReturnType<typeof parseCrionetOop> = [];

  await runScrapeJob(
    deps.supabase,
    {
      jobType: 'oop',
      tournamentId: t.tournament_id,
      targetUrl,
      parserVersion: CRIONET_OOP_VERSION,
      captureBody: true,
    },
    async () => {
      const response = await deps.httpClient.get(targetUrl);
      const body = String(response.data);
      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      parsed = parseCrionetOop(body, day);
      return { body, contentHash };
    }
  );

  if (parsed.length === 0) return 0;

  const scrapeJobId = await getLatestScrapeJobId(deps.supabase, t.tournament_id, targetUrl);
  if (!scrapeJobId) return 0;

  const rows = parsed.map((m) => ({
    scrape_job_id: scrapeJobId,
    tournament_id: t.tournament_id,
    day_number: m.dayNumber,
    category: m.category,
    round_label: m.roundLabel,
    court: m.court,
    court_position: m.courtPosition,
    scheduled_label: m.scheduledLabel,
    team1_player1_name: m.team1Player1Name,
    team1_player2_name: m.team1Player2Name,
    team2_player1_name: m.team2Player1Name,
    team2_player2_name: m.team2Player2Name,
    match_widget_id: m.matchWidgetId,
    status: m.status,
  }));

  const { error } = await deps.supabase
    .schema('padelgod')
    .from('oop_snapshots')
    .insert(rows);

  if (error) throw new Error(`oop_snapshots insert failed: ${error.message}`);

  // Upsert distinct courts into public.tournament_courts. Lets fan-visible
  // UIs (match lists on /matches, /home, /matches/[date]) sort matches in
  // the same left-to-right court order as the official OOP page. Skipped
  // for matches with courtDisplayOrder === -1 (legacy fallback path — no
  // column wrapper in the HTML, can't know order). See the table's
  // comment in supabase/migrations/20260423000005_tournament_courts.sql
  // for the full rationale.
  await upsertTournamentCourts(deps.supabase, t.tournament_id, parsed);

  // Auto-link OOP snapshots to padelapi-sourced public.matches rows. Without
  // this, matches that were never observed live by the live-poller (e.g.
  // QFs that flipped from scheduled → finished between poll ticks) show as
  // "Unlinked" in the ops Tournament Explorer forever, even though a
  // corresponding public.matches row exists. See oop-linker.ts for why
  // this can't just reuse match-identifier (entry-list gap for Premier).
  await autolinkOopMatches(deps.supabase, t.tournament_id, t.widget_id, parsed);

  return rows.length;
}

/**
 * For every parsed OOP match with a widget id + player names, attempt to
 * write an `entity_external_ids` row linking the Crionet widget id to a
 * real public.matches UUID. Uses `linkOopSnapshotsToPublicMatches` from
 * ../lib/oop-linker.ts — name-overlap + (round, court) scoring.
 *
 * Short-circuits when public.matches has no rows for this tournament yet
 * (tournament_courts would also be empty in that case — nothing to link
 * to). Never creates new public.matches rows: strictly a "link existing
 * padelapi twin" operation. If a link can't be inferred unambiguously,
 * we skip silently — the ops page just keeps showing the row unlinked.
 *
 * Non-fatal on every error: oop_snapshots is the authoritative capture
 * and succeeded already; linking is best-effort enrichment.
 */
async function autolinkOopMatches(
  supabase: SupabaseClient,
  tournamentId: string,
  tournamentWidgetId: string,
  parsed: ReturnType<typeof parseCrionetOop>,
): Promise<void> {
  // Only bother if some parsed row has a widget id AND player names — the
  // linker needs both to score candidates.
  const hasCandidates = parsed.some(
    (m) =>
      !!m.matchWidgetId &&
      (m.team1Player1Name || m.team1Player2Name || m.team2Player1Name || m.team2Player2Name),
  );
  if (!hasCandidates) return;

  // Fetch public.matches for the tournament WITH player names joined in.
  // Shape mirrors what linkOopSnapshotsToPublicMatches expects. The
  // category filter on the linker works by exact match ('men' | 'women')
  // so we select it here too.
  const { data: publicRows, error } = await supabase
    .from('matches')
    .select(
      `id, round, court, category,
       pair1_player1:players!matches_pair1_player1_id_fkey(name),
       pair1_player2:players!matches_pair1_player2_id_fkey(name),
       pair2_player1:players!matches_pair2_player1_id_fkey(name),
       pair2_player2:players!matches_pair2_player2_id_fkey(name)`,
    )
    .eq('tournament_id', tournamentId);
  if (error) {
    console.warn(
      `[oop-fetcher] public.matches read for autolink failed (${tournamentId}): ${error.message}`,
    );
    return;
  }

  // Supabase's embedded-resource joins can return either a single object
  // or an array depending on the FK cardinality hints in the schema. For
  // our `players!matches_pair1_player1_id_fkey(...)` form we get objects
  // in practice, but the generated types assume arrays — normalize either
  // shape to a single name string.
  const firstName = (p: unknown): string | null => {
    if (!p) return null;
    if (Array.isArray(p)) {
      return (p[0] as { name?: string | null } | undefined)?.name ?? null;
    }
    return (p as { name?: string | null }).name ?? null;
  };

  const candidates: PublicMatchCandidate[] = (publicRows ?? []).map(
    (raw): PublicMatchCandidate => {
      const r = raw as {
        id: string;
        round: string | null;
        court: string | null;
        category: 'men' | 'women' | null;
        pair1_player1: unknown;
        pair1_player2: unknown;
        pair2_player1: unknown;
        pair2_player2: unknown;
      };
      return {
        id: r.id,
        round: r.round,
        court: r.court,
        category: r.category,
        pair1Player1Name: firstName(r.pair1_player1),
        pair1Player2Name: firstName(r.pair1_player2),
        pair2Player1Name: firstName(r.pair2_player1),
        pair2Player2Name: firstName(r.pair2_player2),
      };
    },
  );

  const linkages = linkOopSnapshotsToPublicMatches(parsed, candidates, tournamentWidgetId);
  if (linkages.length === 0) return;

  const nowIso = new Date().toISOString();
  const rows = linkages.map((l) => ({
    entity_type: 'match',
    entity_id: l.matchId,
    source: 'crionet_widget',
    external_id: l.compositeExternalId,
    first_seen_at: nowIso,
    last_seen_at: nowIso,
  }));

  // Upsert with onConflict so re-runs don't error when the row is already
  // there (live-poller may have written it in the meantime). We use
  // ignoreDuplicates so an existing row pointing at a DIFFERENT match id
  // is left alone — live-poller's link is canonical when present.
  const { error: upErr } = await supabase
    .from('entity_external_ids')
    .upsert(rows, {
      onConflict: 'source,entity_type,external_id',
      ignoreDuplicates: true,
    });
  if (upErr) {
    console.warn(
      `[oop-fetcher] entity_external_ids upsert failed for ${tournamentId}: ${upErr.message}`,
    );
  }
}

async function upsertTournamentCourts(
  supabase: SupabaseClient,
  tournamentId: string,
  parsed: ReturnType<typeof parseCrionetOop>,
): Promise<void> {
  // Deduplicate by court name — in a single OOP page, every match on the
  // same court shares the same courtDisplayOrder. We only want one row per
  // (tournament_id, court) in tournament_courts.
  const byCourt = new Map<string, number>();
  for (const m of parsed) {
    if (m.courtDisplayOrder < 0) continue; // legacy fallback — skip
    if (!m.court) continue;
    if (!byCourt.has(m.court)) {
      byCourt.set(m.court, m.courtDisplayOrder);
    }
  }
  if (byCourt.size === 0) return;

  const nowIso = new Date().toISOString();
  const rows = Array.from(byCourt.entries()).map(([court_name, display_order]) => ({
    tournament_id: tournamentId,
    court_name,
    display_order,
    updated_at: nowIso,
  }));

  // Upsert with onConflict on the composite PK — each day's OOP parse
  // overwrites the previous value. If court order shifts mid-tournament
  // (rare, but e.g. a final gets moved to Show Court), we converge to the
  // latest day's order, which is what the user sees on the official page.
  const { error } = await supabase
    .from('tournament_courts')
    .upsert(rows, { onConflict: 'tournament_id,court_name' });

  if (error) {
    // Non-fatal: oop_snapshots insert already succeeded and that's the
    // authoritative data. Log the failure but don't throw — next run retries.
    console.warn(
      `[oop-fetcher] tournament_courts upsert failed for ${tournamentId}:`,
      error.message,
    );
  }
}

export async function runOopFetcher(deps: OopFetcherDeps): Promise<OopFetcherResult> {
  const { data: tournaments, error } = await deps.supabase.rpc(
    'padelgod_active_tournaments_for_static_workers'
  );
  if (error) throw new Error(`Active tournaments RPC failed: ${error.message}`);
  const list = (tournaments ?? []) as ActiveTournament[];

  let totalMatchesInserted = 0;
  for (const t of list) {
    // Iterate ALL expected days. The previous "bail after 2 consecutive
    // empty" optimisation broke qualifier coverage: past days often return
    // zero rows from the widget, so a tournament on day 3 would bail after
    // days 1 and 2 and never reach today's live day. Cost of iterating the
    // full range is bounded (~8 HTTP calls/tournament/hour).
    //
    // Floor of 8 is the minimum needed to cover Premier P2 events, which
    // Crionet numbers Day 1 (pre-quals) through Day 8 (Final). The
    // `expected_days` value coming from the RPC is computed from
    // (ends_at - starts_at) + 1 and gives 7 for typical Premier P2 rows —
    // wrong because Crionet's day numbering includes a pre-quals day
    // before our stored starts_at. Symptom: Brussels P2 2026's Final
    // (day 8) was never fetched because maxDay capped at 7. The proper
    // long-term fix is to persist FIP's `totalday` JS variable (which we
    // already parse but discard) into a tournament column; until then,
    // the floor here covers the worst case.
    const maxDay = Math.max(t.expected_days ?? 8, 8);
    for (let day = 1; day <= maxDay; day++) {
      const inserted = await fetchOneDay(deps, t, day);
      totalMatchesInserted += inserted;
    }
  }

  return {
    tournamentsProcessed: list.length,
    totalMatchesInserted,
  };
}
