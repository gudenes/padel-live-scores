#!/usr/bin/env node
// Revert matches stuck at status='live' / 'on_court' with NO scoring data.
//
// Symptoms of a phantom-live match:
//   - status IN ('live', 'on_court')
//   - started_at IS NULL (never actually started)
//   - No sets (no game data captured)
//
// Cause: padelgod's pre-fix stampObservedStatus would write 'live' based
// on the widget label alone, even when the parser saw an empty match
// briefly. The new stampObservedStatus (commit 22447c9) only writes 'live'
// when there's scoring evidence, but stale rows from before the fix
// landed remain stuck.
//
// Defaults to dry-run; pass --apply to mutate.

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

try {
  const env = readFileSync('.env.local', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
const apply = process.argv.includes('--apply');
const supabase = createClient(url, key);

console.log(`${apply ? 'APPLY' : 'DRY-RUN'}: scanning for phantom-live matches…`);

const { data: matches, error } = await supabase
  .from('matches')
  .select('id, status, started_at, scheduled_at, last_updated_by, schedule_label, sets(set_number)')
  .in('status', ['live', 'on_court'])
  .is('started_at', null);

if (error) {
  console.error(error.message);
  process.exit(1);
}

const phantoms = (matches ?? []).filter((m) => !m.sets || m.sets.length === 0);
console.log(`Found ${phantoms.length} phantom-live match(es) (${matches.length} total live with no started_at)`);

let reverted = 0;
for (const m of phantoms) {
  console.log(
    `  ${m.id} status=${m.status} sched=${m.scheduled_at} label="${m.schedule_label ?? ''}" updated_by=${m.last_updated_by ?? 'null'}`,
  );
  if (!apply) continue;
  const { error: upErr } = await supabase
    .from('matches')
    .update({ status: 'scheduled', started_at: null })
    .eq('id', m.id)
    // Belt-and-suspenders: don't overwrite if something genuinely flipped
    // it to live with started_at between our select and update.
    .is('started_at', null)
    .in('status', ['live', 'on_court']);
  if (upErr) {
    console.warn(`    update failed: ${upErr.message}`);
    continue;
  }
  reverted++;
}

console.log(`\nDone: ${apply ? `reverted ${reverted}` : `would revert ${phantoms.length}`}`);
if (!apply) console.log('Re-run with --apply to mutate.');
