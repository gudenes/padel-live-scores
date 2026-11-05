import type { SupabaseClient } from '@supabase/supabase-js';
import type { AxiosInstance } from 'axios';
import { WORLD_CUP_ID, WORLD_CUP_EVENT_URL, isWorldCupActive } from '../lib/world-cup-event.js';
import { parseCupStreams } from '../parsers/world-cup-ties.js';
let running = false;
/** Stream announcements describe team ties, not individual rubber match IDs. */
export async function runWorldCupTieFetcher(deps: {
  supabase: SupabaseClient; httpClient: AxiosInstance; dryRun?: boolean;
}) {
  if (!isWorldCupActive()) return { skipped: 'outside-event' };
  if (running) return { skipped: 'already-running' };
  running = true;
  try {
    // FIP includes the live-transmission tab's cards in the event HTML.
    const response = await deps.httpClient.get(WORLD_CUP_EVENT_URL, { timeout: 15000 });
    const fetchedAt = new Date();
    const ties = parseCupStreams(String(response.data), fetchedAt);
    // Preserve the last successful snapshot on upstream markup changes/empty pages.
    if (!ties.length) throw new Error('World Cup event page contained no scheduled or live ties');
    if (deps.dryRun !== false) return { ties: ties.length, updated: false };
    const { error } = await deps.supabase.from('world_cup_tie_snapshots').upsert({
      tournament_id: WORLD_CUP_ID, source_url: WORLD_CUP_EVENT_URL,
      ties, fetched_at: fetchedAt.toISOString(),
    }, { onConflict: 'tournament_id' });
    if (error) throw error;
    return { ties: ties.length, updated: true };
  } finally {
    running = false;
  }
}
