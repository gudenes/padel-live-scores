import type { SupabaseClient } from '@supabase/supabase-js';
import type { ScrapeJobType } from './db-types.js';

export interface ScrapeJobOptions {
  jobType: ScrapeJobType;
  tournamentId: string | null;
  targetUrl: string;
  parserVersion: string;
  captureBody: boolean;
}

export interface ScrapeJobFnResult {
  body: string;
  contentHash: string;
}

export interface ScrapeJobResult {
  status: 'success' | 'failed';
  scrapeJobId: string;
  durationMs: number;
}

export async function runScrapeJob(
  supabase: SupabaseClient,
  opts: ScrapeJobOptions,
  fn: () => Promise<ScrapeJobFnResult>
): Promise<ScrapeJobResult> {
  const startedAt = Date.now();

  // Insert running row
  const { data: jobRow, error: insertErr } = await supabase
    .schema('padelgod')
    .from('scrape_jobs')
    .insert({
      job_type: opts.jobType,
      tournament_id: opts.tournamentId,
      target_url: opts.targetUrl,
      status: 'running',
      parser_version: opts.parserVersion,
    })
    .select()
    .single();

  if (insertErr || !jobRow) {
    throw new Error(`Failed to insert scrape_jobs row: ${insertErr?.message}`);
  }

  const scrapeJobId = jobRow.id as string;

  try {
    const fnResult = await fn();

    if (opts.captureBody && fnResult.body) {
      await maybeStoreRawPayload(supabase, scrapeJobId, opts, fnResult);
    }

    const durationMs = Date.now() - startedAt;
    await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .update({
        status: 'success',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
      })
      .eq('id', scrapeJobId);

    return { status: 'success', scrapeJobId, durationMs };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    await supabase
      .schema('padelgod')
      .from('scrape_jobs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        duration_ms: durationMs,
        error_message: errorMessage.slice(0, 4000),
      })
      .eq('id', scrapeJobId);
    throw err;
  }
}

// ── Dedup-at-write for raw_payloads ────────────────────────────────────
//
// raw_payloads is a write-only debug/replay archive. ~93% of historical
// rows were byte-identical re-captures. We skip storing a body that
// matches the target's last stored body, but force a re-store at least
// every RAW_PAYLOAD_HEARTBEAT_DAYS so every active target keeps a body
// younger than the prune retention window. Dedup state lives in
// padelgod.raw_payload_latest, keyed by (job_type, target_url).
//
// Config is read from process.env (not the zod env) because runScrapeJob
// is a shared lib called by ~10 workers; threading flags through every
// caller is impractical. Defaults: enabled, 7-day heartbeat.

function dedupConfig(): { enabled: boolean; heartbeatMs: number } {
  const enabled = process.env.RAW_PAYLOAD_DEDUP_ENABLED !== 'false'; // default on
  const days = Number(process.env.RAW_PAYLOAD_HEARTBEAT_DAYS ?? '7');
  const heartbeatDays = Number.isFinite(days) && days > 0 ? days : 7;
  return { enabled, heartbeatMs: heartbeatDays * 24 * 3600 * 1000 };
}

async function shouldStoreBody(
  supabase: SupabaseClient,
  jobType: string,
  targetUrl: string,
  contentHash: string,
): Promise<boolean> {
  const { enabled, heartbeatMs } = dedupConfig();
  if (!enabled) return true;
  try {
    const { data, error } = await supabase
      .schema('padelgod')
      .from('raw_payload_latest')
      .select('last_content_hash, last_stored_at')
      .eq('job_type', jobType)
      .eq('target_url', targetUrl)
      .maybeSingle();
    if (error) return true;           // fail-open: never drop data on infra error
    if (!data) return true;           // first capture for this target
    if (data.last_content_hash !== contentHash) return true; // content changed
    const lastStored = Date.parse(data.last_stored_at as string);
    if (!Number.isFinite(lastStored)) return true;
    if (Date.now() - lastStored >= heartbeatMs) return true; // heartbeat re-store
    return false;                     // unchanged within heartbeat → skip
  } catch {
    return true;                      // fail-open
  }
}

async function maybeStoreRawPayload(
  supabase: SupabaseClient,
  scrapeJobId: string,
  opts: ScrapeJobOptions,
  fnResult: ScrapeJobFnResult,
): Promise<void> {
  const store = await shouldStoreBody(
    supabase, opts.jobType, opts.targetUrl, fnResult.contentHash,
  );
  if (!store) return;

  const byteSize = Buffer.byteLength(fnResult.body, 'utf8');
  const { error: insertErr } = await supabase
    .schema('padelgod')
    .from('raw_payloads')
    .insert({
      scrape_job_id: scrapeJobId,
      content_hash: fnResult.contentHash,
      body: fnResult.body,
      byte_size: byteSize,
    })
    .select()
    .single();
  if (insertErr) {
    // Body was NOT stored — do NOT update raw_payload_latest, or the next
    // scrape would see the hash and skip storing, losing this body for good.
    console.warn(`[scrape-job] raw_payloads insert failed: ${insertErr.message}`);
    return;
  }

  // Dedup-state write is best-effort: it must NEVER fail a scrape. The
  // try/catch guards against a thrown call (not just an error return) so
  // the body — already stored above — is never undone by a state-write
  // hiccup. Worst case is a redundant store next cycle.
  try {
    const { error: upsertErr } = await supabase
      .schema('padelgod')
      .from('raw_payload_latest')
      .upsert(
        {
          job_type: opts.jobType,
          target_url: opts.targetUrl,
          tournament_id: opts.tournamentId,
          last_content_hash: fnResult.contentHash,
          last_stored_at: new Date().toISOString(),
        },
        { onConflict: 'job_type,target_url' },
      );
    if (upsertErr) {
      console.warn(`[scrape-job] raw_payload_latest upsert failed: ${upsertErr.message}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[scrape-job] raw_payload_latest upsert threw: ${msg}`);
  }
}
