/**
 * Seed (or remove) a padeldev live-score key for one tournament.
 *
 * Discovery is manual by design — see the v1 design spec. To find a key:
 *
 *   1. GET https://www.padelfip.com/es/eventos/<slug>/
 *      → scrape `padelfip_ajax.nonce` and
 *        `livescore-tab-container data-post-id="<id>"`
 *   2. POST https://www.padelfip.com/wp-admin/admin-ajax.php
 *        action=livescore_tab_load&security=<nonce>&post_id=<id>
 *   3. the response embeds `...tournament.html?key=<uuid>`
 *
 * An empty `html` in step 3 means that event has no live-score widget.
 *
 *   npx tsx scripts/onboard-padeldev-tournament.ts --tournament <uuid> --key <uuid>
 *   npx tsx scripts/onboard-padeldev-tournament.ts --tournament <uuid> --remove
 */
import { createClient } from '@supabase/supabase-js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const tournamentId = arg('tournament');
  const key = arg('key');
  const remove = process.argv.includes('--remove');
  if (!tournamentId) throw new Error('--tournament <uuid> is required');
  if (!remove && !key) throw new Error('--key <uuid> is required (or pass --remove)');

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error('SUPABASE_URL + SUPABASE_SERVICE_KEY required');
  const supabase = createClient(url, serviceKey);

  const { data: t, error: tErr } = await supabase
    .from('tournaments')
    .select('id, name, level, starts_at, ends_at')
    .eq('id', tournamentId)
    .single();
  if (tErr || !t) throw new Error(`tournament ${tournamentId} not found`);
  console.log(`Tournament: ${t.name} [${t.level}] ${t.starts_at} → ${t.ends_at}`);

  if (remove) {
    const { error } = await supabase
      .from('entity_external_ids')
      .delete()
      .eq('entity_type', 'tournament')
      .eq('source', 'padeldev_live')
      .eq('entity_id', tournamentId);
    if (error) throw error;
    console.log('Removed padeldev_live mapping.');
    return;
  }

  const { error } = await supabase.from('entity_external_ids').upsert(
    {
      entity_type: 'tournament',
      entity_id: tournamentId,
      source: 'padeldev_live',
      external_id: key,
    },
    { onConflict: 'source,entity_type,external_id' },
  );
  if (error) throw error;
  console.log(`Seeded padeldev_live key ${key}.`);
  console.log('Next: dry-run before enabling writes —');
  console.log(`  npx tsx scripts/dryrun-padeldev.ts --key ${key} --tournament ${tournamentId} --all`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
