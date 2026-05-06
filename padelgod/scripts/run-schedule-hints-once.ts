// One-shot runner for the schedule-hints-writer worker.
// Useful for local dev to populate `late_hint` immediately without
// starting the full scheduler. Production runs this every 2 min.
//
// Usage: cd padelgod && SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/run-schedule-hints-once.ts

import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import { runScheduleHintsWriter } from '../src/workers/schedule-hints-writer.js';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });
const supabase = createClient(url, key, { auth: { persistSession: false } });

const dryRun = process.argv.includes('--dry-run');
const expected = Number.parseInt(process.env.EXPECTED_DURATION_MIN ?? '90', 10);

const result = await runScheduleHintsWriter({
  supabase,
  logger,
  dryRun,
  expectedDurationMinutes: expected,
});

console.log('Result:', result);
process.exit(0);
