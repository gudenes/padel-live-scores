#!/usr/bin/env node
// Backfill public.games.points[] from public.match_points for matches whose
// games row has no points array.
//
// Why: canonical-mode applyDiff in padelgod historically wrote per-point rows
// to public.match_points but did NOT mirror them into public.games.points[].
// The match detail page's Live Feed + momentum chart consume games.points[],
// so any padelgod-only match (no padelapi_id) showed empty points.
//
// Forward-fix: src/lib/point-reconstruction.ts now mirrors after every insert.
// This script catches the in-flight matches that already lost points.
//
// Usage:
//   node scripts/backfill-games-points-from-match-points.mjs                 # all live padelgod matches
//   node scripts/backfill-games-points-from-match-points.mjs <matchId>...    # specific matches

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Load .env.local
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

const supabase = createClient(url, key);

const explicitIds = process.argv.slice(2);

async function getMatchIds() {
  if (explicitIds.length) return explicitIds;
  const { data, error } = await supabase
    .from('matches')
    .select('id')
    .in('status', ['live', 'on_court'])
    .is('padelapi_id', null);
  if (error) throw error;
  return data.map((r) => r.id);
}

function normalizeScoreAfter(s) {
  if (!s) return null;
  // match_points stores "30-15" / "AD-40"; UI expects colon + "A"
  const v = s.replace('-', ':').replace('AD', 'A');
  return v || null;
}

async function backfillMatch(matchId) {
  const { data: games, error: gamesErr } = await supabase
    .from('games')
    .select('id, set_id, game_number, points')
    .eq('match_id', matchId);
  if (gamesErr) throw gamesErr;

  let updated = 0;
  let skipped = 0;
  for (const g of games) {
    const { data: pts, error: ptsErr } = await supabase
      .from('match_points')
      .select('score_after, point_number')
      .eq('game_id', g.id)
      .order('point_number');
    if (ptsErr) {
      console.warn(`  game ${g.id}: failed to read match_points: ${ptsErr.message}`);
      continue;
    }
    const arr = (pts ?? [])
      .map((p) => normalizeScoreAfter(p.score_after))
      .filter(Boolean);
    if (arr.length === 0) {
      skipped++;
      continue;
    }
    // Skip if already populated and matches length (idempotent)
    if (Array.isArray(g.points) && g.points.length === arr.length) {
      skipped++;
      continue;
    }
    const { error: upErr } = await supabase
      .from('games')
      .update({ points: arr })
      .eq('id', g.id);
    if (upErr) {
      console.warn(`  game ${g.id}: update failed: ${upErr.message}`);
      continue;
    }
    updated++;
  }
  console.log(`  match ${matchId}: ${updated} games updated, ${skipped} skipped`);
}

const ids = await getMatchIds();
console.log(`Backfilling ${ids.length} match(es)...`);
for (const id of ids) {
  await backfillMatch(id);
}
console.log('Done.');
