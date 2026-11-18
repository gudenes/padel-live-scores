/** No Supabase client or write path. Captures normalized public scores for a
 * bounded local preview. --watch N polls N times; --out writes local JSON only.
 * npx tsx scripts/dryrun-ppl.ts <event-slug> [--watch 10] [--out capture.json]
 */
import { writeFile } from 'node:fs/promises';
import axios from 'axios';
import { PplClient } from '../src/lib/ppl-client.js';
import { pplToSnapshot } from '../src/lib/ppl-adapter.js';

const args = process.argv.slice(2), slug = args[0];
const value = (key: string) => args[args.indexOf(key) + 1];
const ticks = args.includes('--watch') ? Number(value('--watch')) : 1;
if (!slug || !Number.isInteger(ticks) || ticks < 1 || ticks > 1200) throw new Error('Supply event slug; --watch must be 1..1200');
const http = axios.create(), client = new PplClient();
const event = (await client.index(http)).find(e => e.slug === slug);
if (!event) throw new Error('Event not published or hidden');
const capture: unknown[] = [];
const previous = new Map<string, string>();
for (let tick = 0; tick < ticks; tick++) {
  const started = Date.now(), page = await client.event(http, event);
  const targets = page.fixtures.map(f => f.id);
  const rows = [], errors = [];
  // Bounded concurrency avoids 24 serial request latencies on the first tick.
  let cursor = 0;
  await Promise.all([0, 1, 2].map(async () => {
    while (cursor < targets.length) {
      const id = targets[cursor++]!;
      try {
        const doc = await client.match(http, id);
        const snapshot = pplToSnapshot(doc.data, id, doc.revision, page);
        rows.push(snapshot);
        if (previous.get(id) !== doc.revision) capture.push({ observedAt: new Date().toISOString(), snapshot });
        previous.set(id, doc.revision);
      } catch (error) { errors.push({ id, error: error instanceof Error ? error.message : String(error) }); }
    }
  }));
  console.log(JSON.stringify({ readOnly: true, event: slug, tick: tick + 1, ms: Date.now() - started,
    scheduled: rows.filter(r => r.status === 'scheduled').length, live: rows.filter(r => r.status === 'live').length,
    finished: rows.filter(r => r.status === 'finished').length, awaitingTeams: page.matchIds.length - targets.length, errors }));
  if (errors.length) process.exitCode = 1;
  if (args.includes('--out')) await writeFile(value('--out')!, JSON.stringify(capture, null, 2));
  if (tick + 1 < ticks) await new Promise(r => setTimeout(r, Math.max(0, 3000 - (Date.now() - started))));
}
