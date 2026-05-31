import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

/**
 * Merge duplicate match rows that represent the SAME Crionet widget but
 * store the identity in two different places:
 *
 *   - sidecar row: entity_external_ids (source='crionet_widget') points to
 *     it; matches.widget_id_composite column is NULL. Created by the
 *     live-poller / OOP path (findOrCreateMatch).
 *   - column row:  matches.widget_id_composite is set. Created by
 *     fip-draw-populator, which (before the 2026-05 fix) only deduped on
 *     the column and never consulted the sidecar — so it inserted a second
 *     row for a widget the live-poller had already created.
 *
 * The root-cause code fix (fip-draw-populator now consults the sidecar)
 * stops NEW duplicates. This script cleans up the ~111 existing pairs.
 *
 * No user-state risk: match_ratings / predictions have zero rows on these
 * matches and bookmarks/follows are client-side (localStorage). The merge
 * only consolidates match data (sets / games / match_points / match_stats).
 *
 * Per pair (both rows exist):
 *   1. Pick the KEEPER = the data-richer row (most sets w/ games, then most
 *      advanced status, then most recently updated). Either store may hold
 *      the richer row — polarity is not assumed.
 *   2. Reparent the crionet_widget mapping to the keeper.
 *   3. Migrate sets/games/match_points/match_stats from loser → keeper,
 *      keeping the keeper's version on any (set_number) / (match_id,
 *      set_number) conflict (keeper is the richer row by construction).
 *   4. Backfill keeper.widget_id_composite if NULL.
 *   5. NULL-only promote status/winner_pair/scheduled_at/court/round/
 *      court_order from loser (never clobber keeper's values).
 *   6. Delete loser (FK CASCADE removes any remaining children).
 *
 * Defaults to DRY-RUN. Pass --apply to mutate.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.SUPABASE_SERVICE_KEY!;
const apply = process.argv.includes('--apply');
// Live matches are actively written by the live-poller (sidecar row) and the
// results/oop writers (composite-column row). Merging mid-play risks a write
// landing on a row that's being deleted/reparented. Skip them by default and
// re-run after they finish. --include-live overrides (not recommended while
// matches are in play).
const includeLive = process.argv.includes('--include-live');
const supabase = createClient(url, key);

const SOURCE = 'crionet_widget';
// Statuses that mean "in play right now" — excluded from the merge unless
// --include-live is passed. `ended` is transitional (score may still be
// settling) so it counts as in-play.
const IN_PLAY = new Set(['live', 'on_court', 'ended']);

interface MatchRow {
  id: string;
  widget_id_composite: string | null;
  status: string | null;
  winner_pair: number | null;
  scheduled_at: string | null;
  court: string | null;
  round: string | null;
  court_order: number | null;
  updated_at: string | null;
}

const STATUS_RANK: Record<string, number> = {
  scheduled: 1,
  on_court: 2,
  live: 3,
  ended: 4,
  walkover: 5,
  retired: 5,
  finished: 6,
};

function statusRank(s: string | null): number {
  return (s && STATUS_RANK[s]) ?? 0;
}

async function setRichness(matchId: string): Promise<{ sets: number; gamefulSets: number }> {
  const { data: sets } = await supabase
    .from('sets')
    .select('id, pair1_games, pair2_games')
    .eq('match_id', matchId);
  const rows = sets ?? [];
  const gamefulSets = rows.filter(
    (s: { pair1_games: number | null; pair2_games: number | null }) =>
      (s.pair1_games ?? 0) > 0 || (s.pair2_games ?? 0) > 0,
  ).length;
  return { sets: rows.length, gamefulSets };
}

/** Compare two rows; returns the keeper (richer) and loser. */
async function pickKeeper(
  a: MatchRow,
  b: MatchRow,
): Promise<{ keeper: MatchRow; loser: MatchRow }> {
  const ra = await setRichness(a.id);
  const rb = await setRichness(b.id);
  // 1. more game-ful sets, 2. more sets, 3. more advanced status,
  // 4. more recently updated.
  const score = (
    r: { sets: number; gamefulSets: number },
    m: MatchRow,
  ): [number, number, number, number] => [
    r.gamefulSets,
    r.sets,
    statusRank(m.status),
    m.updated_at ? Date.parse(m.updated_at) : 0,
  ];
  const sa = score(ra, a);
  const sb = score(rb, b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i]! > sb[i]!) return { keeper: a, loser: b };
    if (sa[i]! < sb[i]!) return { keeper: b, loser: a };
  }
  return { keeper: a, loser: b }; // tie → arbitrary but stable
}

async function migrateChildren(
  loserId: string,
  keeperId: string,
): Promise<void> {
  // sets: resolve set_number UNIQUE conflicts by KEEPING the keeper's set
  // (keeper is the richer row) and dropping the loser's conflicting set.
  const { data: keeperSets } = await supabase
    .from('sets')
    .select('id, set_number')
    .eq('match_id', keeperId);
  const keeperSetNumbers = new Set(
    (keeperSets ?? []).map((s: { set_number: number }) => s.set_number),
  );
  const { data: loserSets } = await supabase
    .from('sets')
    .select('id, set_number')
    .eq('match_id', loserId);
  for (const ls of loserSets ?? []) {
    if (keeperSetNumbers.has(ls.set_number)) {
      // conflict — drop loser's set + its children
      await supabase.from('match_points').delete().eq('set_id', ls.id);
      await supabase.from('games').delete().eq('set_id', ls.id);
      await supabase.from('sets').delete().eq('id', ls.id);
    }
  }
  // Reparent the survivors (loser sets without a set_number conflict) and
  // any match-level children keyed by match_id.
  for (const table of ['games', 'sets', 'match_points']) {
    const { error } = await supabase
      .from(table)
      .update({ match_id: keeperId })
      .eq('match_id', loserId);
    if (error) console.warn(`  reparent ${table}: ${error.message}`);
  }
  // match_stats: PK (match_id, set_number). Drop loser rows whose set_number
  // already exists on keeper, then reparent the rest.
  const { data: keeperStats } = await supabase
    .from('match_stats')
    .select('set_number')
    .eq('match_id', keeperId);
  const keeperStatSets = new Set(
    (keeperStats ?? []).map((r: { set_number: number }) => r.set_number),
  );
  const { data: loserStats } = await supabase
    .from('match_stats')
    .select('set_number')
    .eq('match_id', loserId);
  for (const lr of loserStats ?? []) {
    if (keeperStatSets.has(lr.set_number)) {
      await supabase
        .from('match_stats')
        .delete()
        .eq('match_id', loserId)
        .eq('set_number', lr.set_number);
    }
  }
  const { error: statErr } = await supabase
    .from('match_stats')
    .update({ match_id: keeperId })
    .eq('match_id', loserId);
  if (statErr) console.warn(`  reparent match_stats: ${statErr.message}`);
}

async function main() {
  console.log(`${apply ? 'APPLY' : 'DRY-RUN'}: sidecar-vs-composite match dedup\n`);

  // 1. All crionet_widget sidecar mappings.
  const { data: ext, error: extErr } = await supabase
    .from('entity_external_ids')
    .select('id, entity_id, external_id')
    .eq('entity_type', 'match')
    .eq('source', SOURCE);
  if (extErr) throw extErr;
  const sidecarByComposite = new Map<string, { mappingId: string; matchId: string }[]>();
  for (const e of ext ?? []) {
    const arr = sidecarByComposite.get(e.external_id) ?? [];
    arr.push({ mappingId: e.id, matchId: e.entity_id });
    sidecarByComposite.set(e.external_id, arr);
  }

  // 2. All matches with a non-null composite column.
  const { data: cols, error: colErr } = await supabase
    .from('matches')
    .select('id, widget_id_composite')
    .not('widget_id_composite', 'is', null);
  if (colErr) throw colErr;

  // 3. Build the universe of involved match ids and verify existence.
  const involvedIds = new Set<string>();
  for (const m of cols ?? []) {
    for (const sc of sidecarByComposite.get(m.widget_id_composite!) ?? []) {
      if (sc.matchId !== m.id) {
        involvedIds.add(m.id);
        involvedIds.add(sc.matchId);
      }
    }
  }
  const ids = [...involvedIds];
  const rowById = new Map<string, MatchRow>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase
      .from('matches')
      .select(
        'id, widget_id_composite, status, winner_pair, scheduled_at, court, round, court_order, updated_at',
      )
      .in('id', ids.slice(i, i + 200));
    for (const r of (data ?? []) as MatchRow[]) rowById.set(r.id, r);
  }

  // 4. Form pairs; classify real (both rows exist) vs stale (sidecar target
  //    no longer a match row).
  interface Pair {
    composite: string;
    columnRow: MatchRow;
    sidecarMatchId: string;
    sidecarMappingId: string;
  }
  const realPairs: Pair[] = [];
  const staleMappings: { composite: string; mappingId: string; matchId: string }[] = [];
  for (const m of cols ?? []) {
    const colRow = rowById.get(m.id);
    for (const sc of sidecarByComposite.get(m.widget_id_composite!) ?? []) {
      if (sc.matchId === m.id) continue;
      if (rowById.has(sc.matchId) && colRow) {
        realPairs.push({
          composite: m.widget_id_composite!,
          columnRow: colRow,
          sidecarMatchId: sc.matchId,
          sidecarMappingId: sc.mappingId,
        });
      } else {
        staleMappings.push({ composite: m.widget_id_composite!, mappingId: sc.mappingId, matchId: sc.matchId });
      }
    }
  }

  console.log(`Real duplicate pairs (both rows exist): ${realPairs.length}`);
  console.log(`Stale sidecar mappings (target match gone): ${staleMappings.length}\n`);

  let merged = 0;
  let skippedLive = 0;
  for (const p of realPairs) {
    const sidecarRow = rowById.get(p.sidecarMatchId)!;

    // Skip pairs touching an in-play match unless explicitly opted in.
    if (
      !includeLive &&
      (IN_PLAY.has(p.columnRow.status ?? '') || IN_PLAY.has(sidecarRow.status ?? ''))
    ) {
      skippedLive++;
      console.log(
        `${p.composite}: SKIP (in play — ${p.columnRow.id}=${p.columnRow.status} / ${sidecarRow.id}=${sidecarRow.status})`,
      );
      continue;
    }

    const { keeper, loser } = await pickKeeper(p.columnRow, sidecarRow);
    const keeperIsSidecar = keeper.id === p.sidecarMatchId;
    console.log(
      `${p.composite}: keep ${keeper.id} (${keeper.status}, ${keeperIsSidecar ? 'sidecar' : 'column'}) ` +
        `← drop ${loser.id} (${loser.status})`,
    );
    if (!apply) continue;

    // Reparent mapping to keeper (idempotent unique key: delete any keeper
    // mapping at this composite first, then point loser's mapping at keeper).
    if (keeperIsSidecar) {
      // sidecar mapping already points to keeper — nothing to reparent.
    } else {
      await supabase
        .from('entity_external_ids')
        .delete()
        .eq('entity_type', 'match')
        .eq('source', SOURCE)
        .eq('external_id', p.composite)
        .eq('entity_id', keeper.id);
      const { error: upErr } = await supabase
        .from('entity_external_ids')
        .update({ entity_id: keeper.id })
        .eq('id', p.sidecarMappingId);
      if (upErr) {
        console.warn(`  reparent mapping failed: ${upErr.message}`);
        continue;
      }
    }

    await migrateChildren(loser.id, keeper.id);

    // Delete the loser BEFORE backfilling the keeper's composite. The
    // widget_id_composite column has a partial UNIQUE index — if the loser
    // is the column row it still holds this composite, so writing it onto
    // the keeper while the loser exists would violate the constraint.
    await supabase
      .from('entity_external_ids')
      .delete()
      .eq('entity_type', 'match')
      .eq('entity_id', loser.id);
    const { error: delErr } = await supabase.from('matches').delete().eq('id', loser.id);
    if (delErr) {
      console.warn(`  delete loser failed: ${delErr.message} — skipping keeper patch`);
      continue;
    }

    // Now the composite is free: backfill it onto the keeper + NULL-only
    // field promotion.
    const patch: Record<string, unknown> = {};
    if (keeper.widget_id_composite == null) patch.widget_id_composite = p.composite;
    for (const f of ['status', 'winner_pair', 'scheduled_at', 'court', 'round', 'court_order'] as const) {
      if (keeper[f] == null && loser[f] != null) {
        // status: only promote if loser is genuinely more advanced.
        if (f === 'status' && statusRank(loser.status) <= statusRank(keeper.status)) continue;
        patch[f] = loser[f];
      }
    }
    if (Object.keys(patch).length > 0) {
      const { error: patchErr } = await supabase.from('matches').update(patch).eq('id', keeper.id);
      if (patchErr) console.warn(`  keeper patch failed: ${patchErr.message}`);
    }
    merged++;
  }

  console.log(
    `\n${apply ? `Merged ${merged} pairs.` : `Would merge ${realPairs.length - skippedLive} pairs.`}`,
  );
  if (skippedLive > 0)
    console.log(
      `Skipped ${skippedLive} in-play pair(s) — re-run after they finish` +
        `${includeLive ? '' : ' (or pass --include-live to force, not recommended)'}.`,
    );
  console.log(
    `Stale mappings: ${staleMappings.length} (NOT touched by this script — orphaned ` +
      `entity_external_ids rows whose target match no longer exists; harmless, ` +
      `clean up separately if desired).`,
  );
  if (!apply) console.log('\nRe-run with --apply to mutate.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
