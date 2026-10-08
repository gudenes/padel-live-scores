// Reads the real court schedule; writes only with an explicit --write.
// From repository root: node --env-file=.env.local --import ./padelgod/node_modules/tsx/dist/loader.mjs padelgod/scripts/run-smart-schedule-once.ts
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import { runSmartScheduleWriter } from '../src/workers/smart-schedule-writer.js';
const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Supabase URL/service key missing');
const supabase = createClient(url, key, { auth: { persistSession: false } });
const logger = pino({ level: 'info' });
let running = false;
async function tick() {
  if (running) return;
  running = true;
  try { console.log(await runSmartScheduleWriter({ supabase, logger, dryRun: !process.argv.includes('--write') })); }
  finally { running = false; }
}
await tick();
// Optional local preview loop. Production uses the scheduler, not this script.
if (process.argv.includes('--watch')) setInterval(() => { void tick().catch((err) => logger.error({ err }, 'smart-schedule: preview tick failed')); }, 60_000);
