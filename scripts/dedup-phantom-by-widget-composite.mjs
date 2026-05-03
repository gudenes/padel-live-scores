#!/usr/bin/env node
// Fix matches where the widget composite is split between TWO rows:
//   - Row A (rich): has matches.widget_id_composite column set, has player
//     names + IDs (entry-list / draw-populator path)
//   - Row B (phantom): no players at all, but entity_external_ids registers
//     the same widget composite for it (padelgod created it because
//     lookupByWidgetId only checks entity_external_ids, not the column)
//
// padelgod will keep recreating phantoms every tick until the
// entity_external_ids mapping for the widget composite points to row A.
//
// Fix per cluster:
//   1. Reparent entity_external_ids from phantom → rich row
//   2. Migrate sets/games/match_points from phantom (deleting any
//      conflicting rows on rich row first — phantom has fresher live data)
//   3. Promote rich row status if phantom has a more advanced state
//   4. Delete phantom
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

console.log(`${apply ? 'APPLY' : 'DRY-RUN'}: scanning for widget-composite phantoms…`);

// Find all matches with widget_id_composite set on the column
const { data: richRows, error } = await supabase
  .from('matches')
  .select('id, widget_id_composite, status, started_at, finished_at, duration, last_updated_by, court_order')
  .not('widget_id_composite', 'is', null);
if (error) { console.error(error.message); process.exit(1); }

let fixed = 0;
let skipped = 0;
for (const rich of richRows ?? []) {
  // Look up entity_external_ids for this widget composite
  const { data: mappings } = await supabase
    .from('entity_external_ids')
    .select('id, entity_id')
    .eq('entity_type', 'match')
    .eq('source', 'crionet_widget')
    .eq('external_id', rich.widget_id_composite);
  // Filter to mappings pointing AWAY from the rich row
  const wrongMappings = (mappings ?? []).filter((m) => m.entity_id !== rich.id);
  if (wrongMappings.length === 0) { skipped++; continue; }

  console.log(`\nWidget ${rich.widget_id_composite} → rich row ${rich.id} (status=${rich.status})`);
  for (const wm of wrongMappings) {
    console.log(`  phantom ${wm.entity_id} steals the mapping`);
  }
  if (!apply) continue;

  for (const wm of wrongMappings) {
    const phantomId = wm.entity_id;
    // Pull phantom row
    const { data: phantom } = await supabase
      .from('matches')
      .select('id, status, started_at, finished_at, duration, last_updated_by, court_order, scheduled_at, schedule_label')
      .eq('id', phantomId)
      .maybeSingle();

    // 1. Re-point this entity_external_ids row to the rich match.
    //    First clear any stale mapping at the same key on the rich match.
    await supabase
      .from('entity_external_ids')
      .delete()
      .eq('entity_type', 'match')
      .eq('entity_id', rich.id)
      .eq('source', 'crionet_widget')
      .eq('external_id', rich.widget_id_composite);
    const { error: upErr } = await supabase
      .from('entity_external_ids')
      .update({ entity_id: rich.id })
      .eq('id', wm.id);
    if (upErr) { console.warn(`  reparent mapping failed:`, upErr.message); continue; }
    console.log(`  ✔ reparented mapping → ${rich.id}`);

    // 2. Move children. For sets, resolve UNIQUE conflicts by deleting
    //    rich's stale sets at the same set_number first.
    const { data: phantomSets } = await supabase
      .from('sets').select('id, set_number').eq('match_id', phantomId);
    for (const s of phantomSets ?? []) {
      const { data: rivals } = await supabase
        .from('sets').select('id').eq('match_id', rich.id).eq('set_number', s.set_number);
      for (const r of rivals ?? []) {
        await supabase.from('match_points').delete().eq('set_id', r.id);
        await supabase.from('games').delete().eq('set_id', r.id);
        await supabase.from('sets').delete().eq('id', r.id);
      }
    }
    for (const table of ['games', 'sets', 'match_points']) {
      const { error: upErr2 } = await supabase
        .from(table).update({ match_id: rich.id }).eq('match_id', phantomId);
      if (upErr2) console.warn(`  reparent ${table}:`, upErr2.message);
    }

    // 3. Promote rich's status if phantom is ahead.
    if (phantom) {
      const rank = (s) => ({ scheduled: 1, on_court: 2, live: 3, finished: 4 })[s] ?? 0;
      const patch = {};
      if (rank(phantom.status) > rank(rich.status)) {
        patch.status = phantom.status;
        if (phantom.started_at) patch.started_at = phantom.started_at;
        if (phantom.finished_at) patch.finished_at = phantom.finished_at;
      }
      for (const f of ['duration', 'last_updated_by', 'court_order']) {
        if (rich[f] == null && phantom[f] != null) patch[f] = phantom[f];
      }
      if (Object.keys(patch).length > 0) {
        await supabase.from('matches').update(patch).eq('id', rich.id);
        console.log(`  ✔ patched rich:`, patch);
      }
    }

    // 4. Delete phantom.
    await supabase.from('entity_external_ids').delete()
      .eq('entity_type', 'match').eq('entity_id', phantomId);
    const { error: delErr } = await supabase.from('matches').delete().eq('id', phantomId);
    if (delErr) console.warn(`  delete phantom failed:`, delErr.message);
    else console.log(`  ✔ deleted phantom ${phantomId}`);
    fixed++;
  }
}

console.log(`\nDone: ${apply ? `fixed ${fixed}` : `would fix ${fixed}`}, skipped ${skipped}`);
if (!apply) console.log('Re-run with --apply to mutate.');
