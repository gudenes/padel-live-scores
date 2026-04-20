import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { createHash } from 'node:crypto';
import { parseFipPlayerProfile } from '../parsers/fip-player-profile.js';
import { runScrapeJob } from '../lib/scrape-job.js';
import { FIP_PLAYER_PROFILE_VERSION } from '../lib/parser-versions.js';

export interface PlayerProfileDeps {
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
}

export interface PlayerProfileTask {
  playerId: string;
  slug: string;
}

export interface PlayerProfileResult {
  updated: boolean;
  fipId: string | null;
}

export async function runPlayerProfile(
  deps: PlayerProfileDeps,
  task: PlayerProfileTask
): Promise<PlayerProfileResult> {
  const targetUrl = `https://www.padelfip.com/player/${task.slug}/`;
  let parsedRef: ReturnType<typeof parseFipPlayerProfile> | null = null;

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
      parsedRef = parseFipPlayerProfile(body);
      return { body, contentHash };
    }
  );

  if (!parsedRef) return { updated: false, fipId: null };

  const parsed = parsedRef as ReturnType<typeof parseFipPlayerProfile>;

  // Update only fields the profile owns. Don't clobber name/country (rankings worker owns those).
  const updates: Record<string, unknown> = { last_updated_by: 'padelgod' };
  if (parsed.fipId) updates.fip_id = parsed.fipId;
  if (parsed.birthDate) updates.birthdate = parsed.birthDate;
  // birth_place, height, affiliation, equipment: stored in db only if columns exist.
  // For V1 the existing players table lacks birth_place/height/affiliation columns,
  // so we skip them and revisit in a follow-up migration.

  const { error } = await deps.supabase
    .from('players')
    .update(updates)
    .eq('id', task.playerId);

  if (error) throw new Error(`Player profile update failed: ${error.message}`);

  return { updated: true, fipId: parsed.fipId };
}
