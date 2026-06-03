// One-shot backfill: capture the high-res FIP photo for already-profiled
// players that don't have one yet (profile_url present, photo_url null).
// Reuses runPlayerProfile, which now parses + rehosts the photo.
//
// Bounded per run (default 200) to stay well under the PostgREST 10k cap;
// re-run until it reports "Found 0 players".
//
// Usage:
//   cd padelgod && SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     npx tsx scripts/backfill-player-photos.ts [--limit=200] [--dry-run]

import { createClient } from '@supabase/supabase-js';
import { createHttpClient, PADELGOD_USER_AGENT } from '../src/lib/http-client.js';
import { runPlayerProfile } from '../src/workers/player-profile.js';
import { ensureAvatarsBucket } from '../src/lib/avatar-rehost.js';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '200', 10) : 200;
const dryRun = process.argv.includes('--dry-run');

const supabase = createClient(url, key, { auth: { persistSession: false } });
const httpClient = createHttpClient({ userAgent: PADELGOD_USER_AGENT });

await ensureAvatarsBucket(supabase);

const { data: rows, error } = await supabase
  .from('players')
  .select('id, profile_url')
  .not('profile_url', 'is', null)
  .is('photo_url', null)
  .limit(limit);
if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

console.log(`Found ${rows?.length ?? 0} players to backfill (limit ${limit}).`);
let ok = 0;
let fail = 0;
for (const row of rows ?? []) {
  if (dryRun) {
    console.log(`[dry-run] would backfill ${row.id} (${row.profile_url})`);
    continue;
  }
  try {
    const r = await runPlayerProfile(
      { supabase, httpClient },
      { playerId: row.id, profileUrl: row.profile_url as string },
    );
    if (r.status === 'ok') ok++;
    else fail++;
    console.log(`${row.id}: ${r.status}`);
  } catch (e) {
    fail++;
    console.error(`${row.id}: error`, e instanceof Error ? e.message : e);
  }
}
console.log(`Done. ok=${ok} fail=${fail}`);
process.exit(0);
