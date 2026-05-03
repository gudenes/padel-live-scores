#!/usr/bin/env node
// Merge match rows that share the SAME 4 player UUIDs in the SAME
// tournament. This is the strongest possible duplicate signal — same
// players, same event, definitely the same logical match — and happens
// when padelgod's `findOrCreateMatch` doesn't reconcile against rows
// created by the entry-list path (which sets `widget_id_composite`)
// before inserting a fresh row of its own.
//
// Survivor priority:
//   1. Has `widget_id_composite` (entry-list / draw-populator path —
//      richer source of truth: round, names, seeds)
//   2. If both have it OR neither: older `created_at` wins
// Sets and games on the non-survivor get re-parented to the survivor
// (UPDATE match_id). Then non-survivor's entity_external_ids and the
// row itself are deleted.
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
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}
const apply = process.argv.includes('--apply');

const supabase = createClient(url, key);

console.log(`${apply ? 'APPLY' : 'DRY-RUN'}: scanning for same-player-UUID dupes…`);

// Pull all live/on_court/scheduled matches with player UUIDs
const { data: matches, error } = await supabase
  .from('matches')
  .select(
    'id, tournament_id, status, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, widget_id_composite, padelapi_id, last_updated_by, created_at, started_at, finished_at, duration, court, court_order, round, schedule_label, scheduled_at',
  )
  .in('status', ['live', 'on_court', 'scheduled', 'finished'])
  .not('pair1_player1_id', 'is', null)
  .not('pair2_player1_id', 'is', null);
if (error) {
  console.error('select failed:', error.message);
  process.exit(1);
}

// Group by (tournament_id, sorted 4-UUID tuple)
const groups = new Map();
for (const m of matches) {
  const uuids = [
    m.pair1_player1_id,
    m.pair1_player2_id,
    m.pair2_player1_id,
    m.pair2_player2_id,
  ]
    .filter(Boolean)
    .sort();
  if (uuids.length < 4) continue;
  const key = `${m.tournament_id}::${uuids.join('|')}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(m);
}

const dups = [...groups.values()].filter((g) => g.length > 1);
console.log(`Found ${dups.length} duplicate cluster(s)`);

let merged = 0;
let skipped = 0;
for (const cluster of dups) {
  // Pick survivor: prefer widget_id_composite, else oldest created_at.
  const sorted = [...cluster].sort((a, b) => {
    const aHasWidget = !!a.widget_id_composite;
    const bHasWidget = !!b.widget_id_composite;
    if (aHasWidget && !bHasWidget) return -1;
    if (!aHasWidget && bHasWidget) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
  const survivor = sorted[0];
  const losers = sorted.slice(1);

  console.log(`\nCluster (tournament=${survivor.tournament_id.slice(0, 8)}):`);
  console.log(
    `  SURVIVOR ${survivor.id} status=${survivor.status} widget=${survivor.widget_id_composite ?? 'none'}`,
  );
  for (const loser of losers) {
    console.log(
      `  LOSER    ${loser.id} status=${loser.status} widget=${loser.widget_id_composite ?? 'none'}`,
    );
  }

  // Build survivor patch from loser fields where survivor is null.
  const fieldsToCopy = [
    'status',
    'started_at',
    'finished_at',
    'duration',
    'last_updated_by',
    'court_order',
    'schedule_label',
    'scheduled_at',
  ];
  const patch = {};
  for (const loser of losers) {
    for (const f of fieldsToCopy) {
      if ((survivor[f] === null || survivor[f] === undefined) && loser[f] != null) {
        patch[f] = loser[f];
      }
    }
    // Status precedence: live > on_court > scheduled > finished. If loser
    // is in a more advanced state, promote survivor.
    const rank = (s) => ({ scheduled: 0, on_court: 1, live: 2, finished: 3 })[s] ?? 0;
    if (rank(loser.status) > rank(survivor.status)) {
      patch.status = loser.status;
      if (loser.started_at) patch.started_at = loser.started_at;
      if (loser.finished_at) patch.finished_at = loser.finished_at;
    }
  }

  if (Object.keys(patch).length > 0) {
    console.log(`  → patch survivor:`, patch);
  }

  if (!apply) {
    skipped++;
    continue;
  }

  // 1. Reparent entity_external_ids from each loser to survivor BEFORE
  //    moving children. Without this, padelgod's `lookupByWidgetId` will
  //    fall through to insertMatch and recreate a phantom row on the next
  //    tick (it queries entity_external_ids, NOT the matches.widget_id_composite
  //    column). For each (source, external_id) we collide on, prefer the
  //    fresher last_seen_at — typically the loser's, which the live-poller
  //    just touched.
  for (const loser of losers) {
    const { data: loserMappings } = await supabase
      .from('entity_external_ids')
      .select('source, external_id, metadata, first_seen_at, last_seen_at')
      .eq('entity_type', 'match')
      .eq('entity_id', loser.id);
    for (const m of loserMappings ?? []) {
      // Delete survivor's mapping at the same key (if any), then assign
      // the loser's. Two-step to avoid UNIQUE (source, entity_type, external_id) clash.
      await supabase
        .from('entity_external_ids')
        .delete()
        .eq('entity_type', 'match')
        .eq('entity_id', survivor.id)
        .eq('source', m.source)
        .eq('external_id', m.external_id);
      const { error: upErr } = await supabase
        .from('entity_external_ids')
        .update({ entity_id: survivor.id })
        .eq('entity_type', 'match')
        .eq('entity_id', loser.id)
        .eq('source', m.source)
        .eq('external_id', m.external_id);
      if (upErr) {
        console.warn(`  reparent entity_external_ids (${m.source}/${m.external_id}) failed:`, upErr.message);
      }
    }
  }

  // 2. Reparent sets/games/match_points. If survivor already has a set with
  //    the same set_number, we delete the survivor's stale row first so the
  //    loser's fresher row (with current live data) wins.
  for (const loser of losers) {
    // Sets: respect UNIQUE (match_id, set_number).
    const { data: loserSets } = await supabase
      .from('sets')
      .select('id, set_number')
      .eq('match_id', loser.id);
    for (const s of loserSets ?? []) {
      // Delete any survivor set with the same set_number.
      const { data: stale } = await supabase
        .from('sets')
        .select('id')
        .eq('match_id', survivor.id)
        .eq('set_number', s.set_number);
      for (const st of stale ?? []) {
        // Cascade: delete dependent games/match_points on stale set.
        await supabase.from('match_points').delete().eq('set_id', st.id);
        await supabase.from('games').delete().eq('set_id', st.id);
        await supabase.from('sets').delete().eq('id', st.id);
      }
    }
    for (const table of ['games', 'sets', 'match_points']) {
      const { error: upErr } = await supabase
        .from(table)
        .update({ match_id: survivor.id })
        .eq('match_id', loser.id);
      if (upErr) {
        console.warn(`  reparent ${table} failed:`, upErr.message);
      }
    }
  }

  // 3. Apply patch to survivor (status promotion, copy null fields).
  if (Object.keys(patch).length > 0) {
    const { error: pErr } = await supabase
      .from('matches')
      .update(patch)
      .eq('id', survivor.id);
    if (pErr) console.warn('  patch survivor failed:', pErr.message);
  }

  // 4. Delete losers.
  for (const loser of losers) {
    const { error: delErr } = await supabase.from('matches').delete().eq('id', loser.id);
    if (delErr) {
      console.warn(`  delete loser ${loser.id} failed:`, delErr.message);
    } else {
      console.log(`  ✔ deleted loser ${loser.id}`);
    }
  }

  merged++;
}

console.log(`\nDone: ${apply ? `merged ${merged}` : `would merge ${dups.length}`}, skipped ${skipped}`);
if (!apply) console.log('Re-run with --apply to mutate.');
