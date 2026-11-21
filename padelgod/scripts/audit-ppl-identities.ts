/** Read-only canonical identity audit of a capture from dryrun-ppl.ts.
 * node --env-file=../../.env.local --import tsx scripts/audit-ppl-identities.ts capture.json
 * Use Node >=22 for the installed supabase-js native WebSocket requirement.
 * This script has no RPC/insert/update/delete calls.
 */
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { loadPplContext, resolvePplSnapshot } from '../src/lib/ppl-resolve.js';
import type { PplSnapshot } from '../src/lib/ppl-adapter.js';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key || !process.argv[2]) throw new Error('Supply environment and captured snapshots JSON');
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const capture: Array<{ snapshot: PplSnapshot }> = JSON.parse(await readFile(process.argv[2], 'utf8'));
const latest = [...new Map(capture.map(x => [x.snapshot.providerId, x.snapshot])).values()];
const reports = [];
for (const slug of new Set(latest.map(s => s.tournamentSlug))) {
  const { data: event, error } = await db.from('tournaments').select('id').eq('source', 'ppl').eq('external_id', slug).maybeSingle();
  if (error) throw error;
  if (!event) { reports.push({ slug, issue: 'event_requires_onboarding' }); continue; }
  const context = await loadPplContext(db, event.id);
  const rows = latest.filter(s => s.tournamentSlug === slug && s.status !== 'scheduled').map(snapshot => ({
    id: snapshot.providerId, result: resolvePplSnapshot(snapshot, context),
  }));
  reports.push({ slug, checked: rows.length, resolved: rows.filter(r => r.result.ok).length,
    issues: rows.filter(r => !r.result.ok), sourceMatchMappings: context.matchMappings.size });
}
console.log(JSON.stringify({ readOnly: true, reports }, null, 2));
