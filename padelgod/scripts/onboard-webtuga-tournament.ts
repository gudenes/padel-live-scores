/**
 * One-off: attach a webtuga live tracker base URL to a tournament so the
 * webtuga-live-fetcher worker discovers it. Idempotent (upsert).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *     npx tsx scripts/onboard-webtuga-tournament.ts <tournamentId> <baseUrl>
 *
 * Example (FIP Platinum Lusitania 2026):
 *   ... 8d5e9a69-f2d9-473d-bc2e-42334e2e8096 https://portugalmasterpadel.win.webtuga.net
 */
import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const [tournamentId, baseUrl] = process.argv.slice(2);
  if (!tournamentId || !baseUrl) {
    console.error('Usage: onboard-webtuga-tournament.ts <tournamentId> <baseUrl>');
    process.exit(1);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tournamentId)) {
    console.error('tournamentId must be a UUID');
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { error } = await supabase.from('entity_external_ids').upsert(
    {
      entity_type: 'tournament',
      entity_id: tournamentId,
      source: 'webtuga_live',
      external_id: baseUrl,
    },
    // Conflict on the entity-keyed constraint (entity_type, entity_id, source)
    // so re-running with a corrected baseUrl UPDATES the tournament's row
    // instead of inserting a second webtuga_live row the worker would also poll.
    { onConflict: 'entity_type,entity_id,source' },
  );

  if (error) {
    console.error('upsert failed:', error.message);
    process.exit(1);
  }
  console.log(`onboarded ${tournamentId} -> ${baseUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
