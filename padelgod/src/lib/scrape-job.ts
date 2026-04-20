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
      const byteSize = Buffer.byteLength(fnResult.body, 'utf8');
      await supabase
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
