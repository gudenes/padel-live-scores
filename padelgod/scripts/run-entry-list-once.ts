// padelgod/scripts/run-entry-list-once.ts
//
// One-off entry-list fetch for a single tournament, bypassing the
// padelgod_active_tournaments_with_slug 7-day window. Useful when FIP
// publishes a "Lista de jugadores" tab earlier than the standard cron
// considers the tournament active.
//
// Steps:
//   1. Look up tournament by UUID (must have a slug).
//   2. Call processTournament directly (skips the RPC filter).
//   3. Call runFipEntryListPopulator with onlyTournamentIds — populator
//      filters by snapshot recency, not tournament window, so it picks
//      up the freshly-inserted rows.
//
// Usage:
//   set -a; source .env.local; set +a
//   cd padelgod && npx tsx scripts/run-entry-list-once.ts <tournamentId>

import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import pino from 'pino';
import {
  processTournament,
  type ActiveTournament,
} from '../src/workers/entry-list-fetcher.js';
import { runFipEntryListPopulator } from '../src/workers/fip-entry-list-populator.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_KEY in .env.local');
  process.exit(1);
}

const tournamentId = process.argv[2]?.trim().toLowerCase();
if (!tournamentId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tournamentId)) {
  console.error('Usage: npx tsx scripts/run-entry-list-once.ts <tournamentId-uuid>');
  process.exit(1);
}

process.env.SUPABASE_URL = SUPABASE_URL;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

const httpClient = axios.create({
  timeout: 60000,
  headers: { 'User-Agent': 'padelgod/entry-list-adhoc' },
});

const logger = pino({ level: 'info', transport: { target: 'pino-pretty' } });

async function main() {
  const { data: t, error } = await supabase
    .from('tournaments')
    .select('id, name, slug, starts_at, ends_at')
    .eq('id', tournamentId)
    .maybeSingle();
  if (error) throw new Error(`tournament lookup failed: ${error.message}`);
  if (!t) throw new Error(`tournament ${tournamentId} not found`);
  if (!t.slug) throw new Error(`tournament ${tournamentId} has no slug`);

  console.log(`[adhoc] Tournament: ${t.name} (slug=${t.slug}, starts_at=${t.starts_at})`);

  const active: ActiveTournament = {
    tournament_id: t.id,
    tournament_name: t.name,
    slug: t.slug,
    starts_at: t.starts_at,
    ends_at: t.ends_at,
  };

  console.log(`[adhoc] Step 1/2: entry-list-fetcher`);
  const fetcherOutcome = await processTournament(
    { supabase, httpClient },
    active,
  );
  console.log(JSON.stringify(fetcherOutcome, null, 2));

  if (!fetcherOutcome.pdfsFound) {
    console.warn('[adhoc] No PDFs found on FIP event page — nothing to populate.');
    process.exit(0);
  }

  console.log(`[adhoc] Step 2/2: fip-entry-list-populator`);
  const populatorResult = await runFipEntryListPopulator({
    supabase,
    logger,
    dryRun: false,
    onlyTournamentIds: new Set([tournamentId]),
  });
  console.log(JSON.stringify(populatorResult, null, 2));
}

const startedAt = Date.now();
main()
  .then(() => {
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`\n[adhoc] DONE in ${elapsedSec}s`);
    process.exit(0);
  })
  .catch((err) => {
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.error(`\n[adhoc] FAILED after ${elapsedSec}s:`, err);
    process.exit(1);
  });
