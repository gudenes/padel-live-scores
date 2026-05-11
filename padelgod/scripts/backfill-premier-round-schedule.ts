/**
 * Re-run parseScheduleNotes with `level` for Premier (p1/p2/major/finals)
 * tournaments whose round_schedule is missing r64/r32 due to the old
 * non-level-aware parser. One-shot — once this branch is deployed, the
 * fip-event-page-enricher worker will keep round_schedule in sync.
 *
 *   npx tsx scripts/backfill-premier-round-schedule.ts            # dry run, all
 *   npx tsx scripts/backfill-premier-round-schedule.ts --apply    # write
 *   npx tsx scripts/backfill-premier-round-schedule.ts --tournament=<uuid> --apply
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseScheduleNotes } from '../src/parsers/fip-schedule-notes.js';

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '..', '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
    }
  } catch {
    // env may already be set
  }
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const tournamentArg = process.argv.find((a) => a.startsWith('--tournament='))?.split('=')[1] ?? null;

const PREMIER_LEVELS = ['p1', 'p2', 'major', 'finals'];

async function main() {
  let query = supabase
    .from('tournaments')
    .select('id, name, level, starts_at, ends_at, schedule_notes, round_schedule')
    .in('level', PREMIER_LEVELS)
    .not('schedule_notes', 'is', null);

  if (tournamentArg) {
    query = query.eq('id', tournamentArg);
  }

  const { data, error } = await query;
  if (error) {
    console.error('query failed', error);
    process.exit(1);
  }

  let touched = 0;
  let skipped = 0;
  let unchanged = 0;

  for (const t of data ?? []) {
    if (!t.schedule_notes || !t.starts_at || !t.ends_at) {
      skipped++;
      continue;
    }

    const recomputed = parseScheduleNotes(
      t.schedule_notes,
      t.starts_at,
      t.ends_at,
      { level: t.level },
    );

    const current = (t.round_schedule ?? {}) as Record<string, string>;
    const merged = { ...current, ...recomputed };

    const isDifferent = JSON.stringify(merged) !== JSON.stringify(current);
    const addedKeys = Object.keys(recomputed).filter(k => !(k in current));

    if (!isDifferent) {
      unchanged++;
      continue;
    }

    console.log(`\n[${apply ? 'APPLY' : 'DRY-RUN'}] ${t.name} (${t.id}) level=${t.level}`);
    console.log(`  current: ${JSON.stringify(current)}`);
    console.log(`  new:     ${JSON.stringify(merged)}`);
    console.log(`  added:   ${addedKeys.join(', ') || '(none — only changes)'}`);

    if (apply) {
      const { error: upErr } = await supabase
        .from('tournaments')
        .update({ round_schedule: merged, updated_at: new Date().toISOString() })
        .eq('id', t.id);
      if (upErr) {
        console.error(`  UPDATE failed:`, upErr);
        continue;
      }
      touched++;
    }
  }

  console.log(`\nSummary: touched=${touched} unchanged=${unchanged} skipped(no notes/dates)=${skipped} apply=${apply}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
