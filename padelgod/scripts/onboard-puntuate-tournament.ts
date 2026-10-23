/**
 * One-off: attach a puntuate live tracker base URL to a tournament so the
 * puntuate-live-fetcher worker discovers it. Idempotent (upsert).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *     npx tsx scripts/onboard-puntuate-tournament.ts <tournamentId> <baseUrl>
 *
 * Example (FIP Gold Melilla 2026):
 *   ... <tournament UUID> https://fipmelilla.puntuate.com/ordenJuegoFip.aspx?idTorneo=2310
 */
import { normalizePuntuateUrl } from '../src/lib/puntuate-client.js';
import { createClient } from '@supabase/supabase-js';

async function main(): Promise<void> {
  const [tournamentId, inputUrl] = process.argv.slice(2);
  if (!tournamentId || !inputUrl) {
    console.error('Usage: onboard-puntuate-tournament.ts <tournamentId> <baseUrl>');
    process.exit(1);
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tournamentId)) {
    console.error('tournamentId must be a UUID');
    process.exit(1);
  }

  const baseUrl = normalizePuntuateUrl(inputUrl);
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // Delete-then-insert rather than upsert: the only ON CONFLICT-usable unique
  // constraint is (source, entity_type, external_id), which is keyed on the URL,
  // so an upsert wouldn't replace a *corrected* baseUrl — it would leave the old
  // row behind for the worker to also poll. (The entity-keyed uniqueness is a
  // partial index PostgREST can't target for ON CONFLICT.) Clearing this
  // tournament's puntuate_live row first guarantees exactly one mapping.
  const { error: delError } = await supabase
    .from('entity_external_ids')
    .delete()
    .eq('entity_type', 'tournament')
    .eq('entity_id', tournamentId)
    .eq('source', 'puntuate_live');
  if (delError) {
    console.error('clearing existing mapping failed:', delError.message);
    process.exit(1);
  }

  const { error } = await supabase.from('entity_external_ids').insert({
    entity_type: 'tournament',
    entity_id: tournamentId,
    source: 'puntuate_live',
    external_id: baseUrl,
  });

  if (error) {
    console.error('insert failed:', error.message);
    process.exit(1);
  }
  console.log(`onboarded ${tournamentId} -> ${baseUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
