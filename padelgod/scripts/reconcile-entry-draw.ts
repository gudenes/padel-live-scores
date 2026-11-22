/** Reconcile the current entry roster with a published main draw.
 * node --env-file=../.env.local --import tsx scripts/reconcile-entry-draw.ts <uuid> [--apply]
 * Defaults to review only. Source entry/draw snapshots remain untouched.
 */
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { reconcileMainDrawEntries, type EntryForDraw, type EntryDrawSnapshot } from '../src/lib/entry-draw-reconciliation.js';
import { paginatedSelect } from '../src/lib/db-paginate.js';

const id = process.argv[2];
if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Pass a tournament UUID');
const apply = process.argv.includes('--apply');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const { data, error } = await db.from('tournament_entries').select('*').eq('tournament_id', id);
if (error) throw error;
const entries = data as Array<EntryForDraw & { id: string }>;
if (apply) {
  mkdirSync('../tmp/entry-draw-backups', { recursive: true });
  writeFileSync(`../tmp/entry-draw-backups/${id}-${Date.now()}.json`, JSON.stringify(entries, null, 2));
}
for (const category of ['men', 'women']) {
  const rows = entries.filter(e => e.category === category);
  const snapshots = await paginatedSelect<EntryDrawSnapshot>((start, end) =>
    db.schema('padelgod').from('draw_snapshots').select('*').eq('tournament_id', id)
      .eq('category', category).eq('source', 'fip_event_page').eq('draw_type', 'main_draw')
      .order('captured_at', { ascending: false }).order('id').range(start, end),
    { what: 'main draw' });
  const result = reconcileMainDrawEntries(rows, snapshots);
  if (!result.applied) { console.log(category, result.reason); continue; }
  const retained = new Set(result.entries.map(e => e.id));
  const removed = rows.filter(e => !retained.has(e.id));
  const changed = result.entries.filter(e => {
    const prev = rows.find(r => r.id === e.id)!;
    return prev.seed !== e.seed || prev.draw_type !== e.draw_type || prev.marker !== e.marker;
  });
  console.log(JSON.stringify({ category, apply, removed: removed.map(e => [e.player1_name, e.player2_name]),
    changed: changed.map(e => ({ pair: [e.player1_name, e.player2_name], seed: e.seed, draw_type: e.draw_type })) }));
  if (!apply) continue;
  for (const e of changed) {
    const { error } = await db.from('tournament_entries').update({ seed: e.seed, draw_type: e.draw_type, marker: e.marker })
      .eq('id', e.id).eq('tournament_id', id);
    if (error) throw error;
  }
  if (removed.length) {
    const { error } = await db.from('tournament_entries').delete().eq('tournament_id', id).in('id', removed.map(e => e.id));
    if (error) throw error;
  }
}
