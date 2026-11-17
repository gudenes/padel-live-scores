/** Explicit operator onboarding. Defaults to preview; --apply writes only the
 * tournament mapping. Run the read-only preflight before enabling the worker.
 */
import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import { CourtbitClient, normalizeCourtbitUrl } from '../src/lib/courtbit-client.js';
const [id, url, expectedName, apply] = process.argv.slice(2);
if (!id || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id) || !url || !expectedName || (apply && apply !== '--apply')) {
  throw new Error('Usage: onboard-courtbit-tournament.ts <UUID> <URL> <event name> [--apply]');
}
const endpoint = normalizeCourtbitUrl(url);
const feed = await new CourtbitClient().fetch(axios.create(), endpoint, expectedName);
if (feed.feed.rejected) throw new Error('Provider schema errors; inspect preflight before onboarding');
const mapping = { entity_type: 'tournament', entity_id: id, source: 'courtbit_live', external_id: new URL(endpoint).origin, metadata: { expectedName } };
if (apply !== '--apply') console.log(JSON.stringify({ preview: true, mapping }, null, 2));
else {
  const dbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!dbUrl || !key) throw new Error('Supabase configuration required');
  const db = createClient(dbUrl, key, { auth: { persistSession: false } });
  const { data, error } = await db.from('tournaments').select('id,name,starts_at,ends_at').eq('id', id).single();
  if (error || !data) throw new Error('Tournament not found');
  // The sidecar allows one URL per source. Refuse hostname reassignment
  // rather than silently stealing another event's mapping.
  const { data: old, error: readError } = await db.from('entity_external_ids').select('entity_id').eq('entity_type', 'tournament').eq('source', 'courtbit_live').eq('external_id', mapping.external_id).maybeSingle();
  if (readError) throw readError;
  if (old && old.entity_id !== id) throw new Error('CourtBit host already belongs to another tournament; review mapping explicitly');
  const { error: writeError } = await db.from('entity_external_ids').upsert(mapping, { onConflict: 'source,entity_type,external_id' });
  if (writeError) throw writeError;
  console.log(JSON.stringify({ onboarded: id, workerStillRequiresEnableFlag: true }));
}
