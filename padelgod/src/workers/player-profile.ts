import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipPlayerProfile, type ParsedPlayerProfile } from '../parsers/fip-player-profile.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_PLAYER_PROFILE_VERSION } from '../lib/parser-versions.js';
import { fetchProfileQueueBatch, type QueueMode } from '../db/player-profile-queue.js';

export interface PlayerProfileDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface PlayerProfileTask {
  playerId: string;
  /**
   * Full profile URL (e.g. `https://www.padelfip.com/player/firstname-lastname/`).
   * The DB stores this in `players.profile_url`. If only `slug` is provided,
   * the worker falls back to building the URL from it (legacy callers).
   */
  profileUrl?: string;
  slug?: string;
}

export type ProfileStatus =
  | 'ok'
  | 'missing_page'
  | 'parse_error'
  | 'http_error'
  | 'permanent_failure';

export interface PlayerProfileResult {
  updated: boolean;
  fipId: string | null;
  status: ProfileStatus;
}

/**
 * Pure builder — exported for tests. Returns the partial update payload
 * (just the fields we want to write). Caller is responsible for applying
 * it via Supabase. Source-priority gating is handled at the SOURCE_PRIORITY
 * layer; this builder writes everything FIP owns and lets the priority
 * filter decide what survives if/when applied.
 */
export function buildPlayerProfileUpdate(
  parsed: ParsedPlayerProfile | null,
  status: ProfileStatus,
): Record<string, unknown> {
  const now = new Date().toISOString();
  const updates: Record<string, unknown> = {
    last_updated_by: 'padelgod',
    profile_attempt_at: now,
    profile_status: status,
  };

  if (parsed && status === 'ok') {
    updates.profile_fetched_at = now;
    // DO NOT write parsed.fipId. The parser returns the raw FIP id
    // ('P203884') but the DB stores the padelgod-prefixed form
    // ('fip-P203884') — overwriting would mutate the join key the
    // queue uses. fip_id is set authoritatively by the entry-list
    // populator and rankings worker; the profile worker only enriches.
    if (parsed.birthDate) updates.birthdate = parsed.birthDate;
    if (parsed.birthPlace) updates.birthplace = parsed.birthPlace;
    if (parsed.heightCm) updates.height = parsed.heightCm;
    // Coaches: ALWAYS overwrite (even with empty array) so stale names from a
    // previous sync don't linger when a player switches coaches. The FIP page
    // is the source of truth — if the parser returns [] today, the player
    // really doesn't have coaches listed today.
    updates.coaches = parsed.coaches;
    if (parsed.racketBrand || parsed.racketModel) {
      updates.equipment = {
        brand: parsed.racketBrand ?? null,
        model: parsed.racketModel ?? null,
      };
    }
  }

  return updates;
}

function classifyError(err: unknown): ProfileStatus {
  const message = err instanceof Error ? err.message : String(err);
  if (/\b404\b/.test(message)) return 'missing_page';
  if (/parse|cheerio|JSON/i.test(message)) return 'parse_error';
  return 'http_error';
}

/**
 * Run a single profile scrape + DB write. Returns the outcome.
 */
export async function runPlayerProfile(
  deps: PlayerProfileDeps,
  task: PlayerProfileTask,
): Promise<PlayerProfileResult> {
  const targetUrl = task.profileUrl ?? `https://www.padelfip.com/player/${task.slug}/`;
  let parsed: ParsedPlayerProfile | null = null;
  let status: ProfileStatus = 'ok';

  try {
    await runScrapeJob(
      deps.supabase,
      {
        jobType: 'profile',
        tournamentId: null,
        targetUrl,
        parserVersion: FIP_PLAYER_PROFILE_VERSION,
        captureBody: false,
      },
      async () => {
        const response = await deps.httpClient.get(targetUrl);
        const body = String(response.data);
        const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
        parsed = parseFipPlayerProfile(body);
        return { body, contentHash };
      },
    );
  } catch (err) {
    status = classifyError(err);
  }

  const updates = buildPlayerProfileUpdate(parsed, status);

  const { error } = await deps.supabase
    .from('players')
    .update(updates)
    .eq('id', task.playerId);
  if (error) throw new Error(`Player profile update failed: ${error.message}`);

  const parsedResult = parsed as ParsedPlayerProfile | null;
  return { updated: status === 'ok', fipId: parsedResult?.fipId ?? null, status };
}

export interface RunBatchOptions {
  mode: QueueMode;
  limit: number;
  retryAfterDays?: number;
  throttleMs?: number;
}

export interface BatchResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

/**
 * Real batch driver — replaces the V1.5 stub. Picks N players via the queue
 * helper, runs each profile fetch sequentially with optional throttle,
 * returns per-batch counters for logging.
 */
export async function runPlayerProfileBatch(
  deps: PlayerProfileDeps,
  opts: RunBatchOptions,
): Promise<BatchResult> {
  const batch = await fetchProfileQueueBatch(deps.supabase, {
    mode: opts.mode,
    limit: opts.limit,
    retryAfterDays: opts.retryAfterDays ?? 30,
  });

  let succeeded = 0;
  let failed = 0;

  for (const row of batch) {
    try {
      const result = await runPlayerProfile(deps, {
        playerId: row.id,
        profileUrl: row.profile_url,
      });
      if (result.status === 'ok') succeeded++;
      else failed++;
    } catch {
      failed++;
    }
    if (opts.throttleMs) await new Promise(r => setTimeout(r, opts.throttleMs));
  }

  return { attempted: batch.length, succeeded, failed };
}
