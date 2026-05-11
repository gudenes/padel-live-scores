// Inspect schedule_notes for the P2 events flagged in the dry-run that
// have r64+r16 but no r32. Helps verify whether "1st ROUND" should map
// to R64 (56-draw) or R32 (32-draw) on those events.
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '..', '.env.local'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1');
    }
  } catch {}
}
loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const ids = [
  '01af21ed-fb52-4e6c-a308-36c46c4ff5d4', // Brussels P2
  'b91c4c7d-dfdf-47bd-af99-e6d97515634e', // Brussels P2 2026
  '3ca92963-6465-4482-9b93-140481a8c1e5', // Gijón P2 2026
  'effc53ac-2cc6-4c94-87e2-469e0a2f7863', // Newgiza P2
  'c6d16736-b115-4c95-93e1-3017407de5bc', // Cupra Germany P2
  'ecff588b-84d4-4d1e-bc65-53003d8a0a3e', // Asuncion P2 (sanity check — has r32)
];

const { data } = await supabase
  .from('tournaments')
  .select('id, name, level, draw_size_md, schedule_notes')
  .in('id', ids);

for (const t of data ?? []) {
  console.log(`\n========== ${t.name} (${t.id}) level=${t.level} draw_size_md=${t.draw_size_md} ==========`);
  console.log(t.schedule_notes);
}
