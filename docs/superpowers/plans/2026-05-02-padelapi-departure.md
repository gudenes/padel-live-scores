# Padelapi Departure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop ingesting match data from padelapi.org. Padelgod becomes the sole match-data pipeline across all tiers (Premier + FIP Bronze/Silver/Promises/etc.). Premier stats keep coming from premierpadel.com via the existing Vercel cron.

**Architecture:** The change has three concrete parts: (1) unblock Premier in `fip-draw-populator` by deleting an env-var denylist; (2) flip `tournaments.live_source` from `'padelapi'` to `'padelgod'` for active rows + auto-set the new default on tournament-discovery INSERTs; (3) retire `/api/cron/scores`, `/api/cron/sync`, and the Railway Pusher relay since they have no remaining work. Pre-deploy gates verify each upstream feed before flipping.

**Tech Stack:** TypeScript, Vitest, Next.js 16 (Vercel cron), Node.js (Railway scheduler), Supabase / PostgreSQL.

**Spec:** [docs/superpowers/specs/2026-05-02-padelapi-departure-design.md](../specs/2026-05-02-padelapi-departure-design.md)

**Asuncion P2 IDs (used throughout):**
- Tournament UUID: `5027936c-9fd5-4309-83e7-44ee4620a207`
- Crionet widget ID: `FIP-2026-2111`
- Padelapi ID: `733`

---

## Phase 0 — Pre-deploy gates

These three tasks must all pass before any production-mutating step in Phase 1+.

### Task 1: Verify Crionet draw scrape works for Asuncion

**Why:** `fip-draw-populator` reads from `padelgod.draw_snapshots`. If `draw-fetcher`'s Crionet parser doesn't produce rows for Premier brackets, removing the denylist accomplishes nothing.

**Files:**
- Create: `scripts/verify-asuncion-draw-snapshot.ts`

- [ ] **Step 1: Write a one-shot verification script**

```typescript
// scripts/verify-asuncion-draw-snapshot.ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const TID = '5027936c-9fd5-4309-83e7-44ee4620a207'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { count, error } = await s
    .schema('padelgod' as never)
    .from('draw_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', TID)
  if (error) throw error
  console.log(`draw_snapshots for Asuncion: ${count} rows`)

  const { data: latest } = await s
    .schema('padelgod' as never)
    .from('draw_snapshots')
    .select('captured_at, category, draw_type, round, position')
    .eq('tournament_id', TID)
    .order('captured_at', { ascending: false })
    .limit(5)
  console.table(latest)

  if ((count ?? 0) === 0) {
    console.error('GATE FAIL: no draw snapshots for Asuncion. Wait for next :20 draw-fetcher run, then retry.')
    process.exit(1)
  }
  console.log('GATE PASS')
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run it**

Run:
```bash
cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && npx tsx scripts/verify-asuncion-draw-snapshot.ts
```

Expected: `GATE PASS` with row count > 0 and rows showing categories like `men`/`women` and draw_type `main_draw` or `qualifying`.

If `count = 0` and the next `:20` run is more than 30 minutes away, manually trigger by SSH-ing into the Railway scheduler and running the worker, or wait. Re-run the script. Do not proceed past this task with a failing gate.

- [ ] **Step 3: Commit the script**

```bash
git add scripts/verify-asuncion-draw-snapshot.ts
git commit -m "tools: gate script for Asuncion draw snapshot verification"
```

### Task 2: Populator dry-run for Asuncion

**Why:** Confirm `fip-draw-populator` can parse the draw snapshots into valid match rows without actually writing.

**Files:**
- Create: `scripts/dry-run-populator-asuncion.ts`

- [ ] **Step 1: Write the dry-run script**

```typescript
// scripts/dry-run-populator-asuncion.ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import pino from 'pino'
import { runFipDrawPopulator } from '../padelgod/src/workers/fip-draw-populator.js'

const ASUNCION = '5027936c-9fd5-4309-83e7-44ee4620a207'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })

async function main() {
  const result = await runFipDrawPopulator({
    supabase: s,
    logger: pino({ level: 'info' }),
    dryRun: true,
    onlyTournamentIds: new Set([ASUNCION]),
    excludeLevels: new Set(),     // override the env denylist locally
  })
  console.log(JSON.stringify(result, null, 2))

  if (result.dryRun !== true) {
    console.error('GATE FAIL: dryRun flag was not honored — actual writes occurred')
    process.exit(1)
  }
  if (result.tournamentsProcessed === 0) {
    console.error('GATE FAIL: tournament was filtered out — check allowlist/denylist composition')
    process.exit(1)
  }
  if (result.drawRowsConsidered === 0) {
    console.error('GATE FAIL: no draw rows for Asuncion — Task 1 should have caught this')
    process.exit(1)
  }
  console.log(`GATE PASS — would insert ${result.inserted}, update ${result.updated}, skip ${result.skippedPlayerUnresolved} player-unresolved`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run it**

```bash
cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && npx tsx scripts/dry-run-populator-asuncion.ts
```

Expected: GATE PASS with non-zero `inserted` count. If `skippedPlayerUnresolved` is high, the entry-list-populator hasn't resolved Asuncion's roster yet — wait for the next `:46` run and retry.

- [ ] **Step 3: Commit**

```bash
git add scripts/dry-run-populator-asuncion.ts
git commit -m "tools: gate script for Asuncion populator dry-run"
```

### Task 3: Live-poller no-op test on a Bronze tournament

**Why:** After the bulk flip, FIP Bronze loops will run in canonical mode (writing to `public.matches`) instead of shadow mode (writing only to snapshots). Confirm the loop doesn't write garbage when Crionet has no live point data.

**Files:**
- Create: `scripts/probe-bronze-loop-canonical.ts`

- [ ] **Step 1: Pick a Bronze tournament currently active and not in any live match**

Run:
```bash
cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && npx tsx -e '
import {createClient} from "@supabase/supabase-js";
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const {data}=await s.from("tournaments").select("id,name,starts_at,ends_at").eq("level","fip_bronze").lte("starts_at",new Date().toISOString()).gte("ends_at",new Date().toISOString()).limit(3);
console.table(data);
' 2>&1 | tail -20
```

Pick the first tournament UUID from the output. Save as `BRONZE_TID`.

- [ ] **Step 2: Snapshot baseline match-row state for that tournament**

```bash
npx tsx -e '
import {createClient} from "@supabase/supabase-js";
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const TID="<paste BRONZE_TID>";
const {data,count}=await s.from("matches").select("id,status,updated_at",{count:"exact"}).eq("tournament_id",TID).order("updated_at",{ascending:false}).limit(5);
console.log("count:",count); console.table(data);
'
```

Note `count` and the most recent `updated_at`. Save as `BASELINE`.

- [ ] **Step 3: Flip live_source for the chosen tournament**

```bash
npx tsx -e '
import {createClient} from "@supabase/supabase-js";
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const TID="<paste BRONZE_TID>";
const {data,error}=await s.from("tournaments").update({live_source:"padelgod"}).eq("id",TID).select("id,name,live_source");
console.log({data,error});
'
```

- [ ] **Step 4: Wait 90 seconds (one live-poller-manager reconcile tick)**

```bash
sleep 90
```

- [ ] **Step 5: Re-snapshot match-row state**

Re-run the same query as Step 2.

Expected: `count` unchanged from BASELINE; the `updated_at` of the top row equal to BASELINE (or only changed by other workers like fip-oop-writer at `:52` if you crossed a slot boundary). No NEW rows. No `status` regressions.

If new rows appeared OR existing rows show garbage updates: GATE FAIL. Revert step 3 and stop the rollout — investigate `live-poller-loop.ts` write paths before continuing.

- [ ] **Step 6: Revert the flip**

```bash
npx tsx -e '
import {createClient} from "@supabase/supabase-js";
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const TID="<paste BRONZE_TID>";
const {data}=await s.from("tournaments").update({live_source:"padelapi"}).eq("id",TID).select("id,live_source");
console.log(data);
'
```

This restores baseline so the bulk flip in Task 11 has a clean target set. No commit — the steps above are exploratory.

---

## Phase 1 — Premier match creation (Asuncion goes live on padelgod)

### Task 4: Remove `FIP_DRAW_POPULATOR_EXCLUDE_LEVELS` env var on Railway

**Why:** Unblocks the populator for Premier-tier tournaments. Asuncion's draw snapshots will start producing match rows on the next `:47` run.

**Files:** none (Railway dashboard action)

- [ ] **Step 1: Open Railway dashboard for the padelgod service**

Navigate to the padelgod service's Variables tab.

- [ ] **Step 2: Delete `FIP_DRAW_POPULATOR_EXCLUDE_LEVELS`**

Click the row, choose Delete. Railway redeploys automatically — the scheduler restarts within ~30s.

- [ ] **Step 3: Verify in Railway logs that scheduler restarted cleanly**

Check the deployment log. Look for the line `tournament discovery / fip-draw-populator entries registered`. No errors.

### Task 5: Verify Asuncion matches arrive in production

**Why:** Confirm the populator processed Asuncion on its next `:47` run. Catch any production-only failure modes the dry-run missed (network, RLS, schema drift).

- [ ] **Step 1: Wait for the next `:47` slot**

If current time is past `:47`, wait until next hour. If before `:47`, wait until that slot, then 90 seconds for the worker to finish.

- [ ] **Step 2: Query for new Asuncion matches**

```bash
cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && npx tsx -e '
import {createClient} from "@supabase/supabase-js";
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const TID="5027936c-9fd5-4309-83e7-44ee4620a207";
const {data,count}=await s.from("matches").select("id,status,round,category,widget_id_composite,padelapi_id",{count:"exact"}).eq("tournament_id",TID).order("created_at",{ascending:false}).limit(10);
console.log("count:",count);
console.table(data);
const nullComposite=(data||[]).filter(m=>!m.widget_id_composite);
if(nullComposite.length) console.error("WARN: rows with NULL widget_id_composite:",nullComposite.length);
'
```

Expected: `count` > 0; every row shows a non-null `widget_id_composite` like `FIP-2026-2111:WD001`; `padelapi_id` is null on the new rows.

If `count = 0`: check Railway logs for the populator run — search for the Asuncion tournament UUID. If errors, investigate before continuing.

---

## Phase 2 — Tournament-discovery auto-flip code change

### Task 6: Extend `existing` lookup to include `live_source`

**Why:** Foundation for the auto-flip. Need to know whether each parsed row corresponds to an existing tournament or is a new insert.

**Files:**
- Modify: `padelgod/src/workers/tournament-discovery.ts:139`
- Modify: `padelgod/src/workers/tournament-discovery.ts:141-148`

- [ ] **Step 1: Update the SELECT to fetch `live_source`**

Current code at line 139:
```typescript
    ? await deps.supabase.from('tournaments').select('slug, level, country').in('slug', slugs)
```

Change to:
```typescript
    ? await deps.supabase.from('tournaments').select('slug, level, country, live_source').in('slug', slugs)
```

- [ ] **Step 2: Update the `existingBySlug` Map type and population**

Current code at lines 141-148:
```typescript
  const existingBySlug = new Map<
    string,
    { level: string | null; country: string | null }
  >(
    ((existing ?? []) as Array<{ slug: string; level: string | null; country: string | null }>).map(
      (r) => [r.slug, { level: r.level, country: r.country }],
    ),
  );
```

Change to:
```typescript
  const existingBySlug = new Map<
    string,
    { level: string | null; country: string | null; live_source: string | null }
  >(
    ((existing ?? []) as Array<{ slug: string; level: string | null; country: string | null; live_source: string | null }>).map(
      (r) => [r.slug, { level: r.level, country: r.country, live_source: r.live_source }],
    ),
  );
```

- [ ] **Step 3: Run the existing test suite to confirm nothing breaks**

```bash
cd padelgod && npm run test -- tournament-discovery 2>&1 | tail -20
```

Expected: all tests pass. The `existingBySlug` shape change is additive; existing call sites that read `.level` and `.country` keep working.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/workers/tournament-discovery.ts
git commit -m "refactor(padelgod): include live_source in existing-tournament lookup"
```

### Task 7: Write failing test for INSERT auto-flip behavior

**Files:**
- Modify: `padelgod/src/__tests__/workers/tournament-discovery.test.ts`

- [ ] **Step 1: Open the test file and inspect the existing fakeSupabase shape**

```bash
sed -n '1,80p' padelgod/src/__tests__/workers/tournament-discovery.test.ts
```

Confirm the fake captures `upserted` payloads with `{ table, rows, opts }`. We'll assert against `rows[i].live_source`.

- [ ] **Step 2: Add a new test for INSERT auto-flip**

Append at the end of the existing `describe('runTournamentDiscovery', () => { … })` block:

```typescript
  it("sets live_source='padelgod' on new tournament INSERTs", async () => {
    const supa = fakeSupabase('2026-01-01T00:00:00Z')
    const httpClient = {
      get: vi.fn().mockResolvedValue({
        data: [
          {
            id: 999,
            slug: 'fip-bronze-newtown-2026',
            title: { rendered: 'FIP BRONZE NEWTOWN' },
            modified_gmt: '2026-05-01T00:00:00',
            // minimal acmf_event-style fields the parser expects:
            acmf_event: {
              accommodation_start_date: '2026-06-01',
              accommodation_end_date: '2026-06-07',
            },
            tournament_category: [497],   // fip-bronze category id
            country: [],
          },
        ],
      }),
    } as never
    await runTournamentDiscovery({ supabase: supa as never, httpClient, logger: console as never })
    const tournamentUpserts = supa.upserted.filter((u: any) => u.table === 'tournaments')
    expect(tournamentUpserts.length).toBeGreaterThan(0)
    const insertedRow = tournamentUpserts[0].rows[0]
    expect(insertedRow.live_source).toBe('padelgod')
  })
```

- [ ] **Step 3: Run the test — expect failure**

```bash
cd padelgod && npm run test -- tournament-discovery -t 'sets live_source' 2>&1 | tail -15
```

Expected: FAIL with assertion that `insertedRow.live_source` is `undefined` instead of `'padelgod'`.

If the test passes already, the fakeSupabase shape doesn't surface `live_source` and you've measured the wrong thing — re-check the assertion.

### Task 8: Implement INSERT auto-flip

**Files:**
- Modify: `padelgod/src/workers/tournament-discovery.ts` (inside the `parsed.map(...)` callback that builds each row, near the existing level/country logic around line 281)

- [ ] **Step 1: Pre-compute the twin-id set BEFORE the `rows.map` block**

Currently `twinIds` is defined at line ~290, AFTER `rows = parsed.map(...)`. The map callback needs access to it, so move the definition up. Find the line:

```typescript
  const twinIds = new Set(twinMerges.map((t) => t.twinId));
```

(currently after the map). Cut it. Paste it immediately BEFORE the `const rows = parsed.map((p) => {` line. The downstream `const twinRows = rows.filter(...)` keeps using `twinIds` unchanged.

- [ ] **Step 2: Add the live_source logic inside the row-building map, just above `return row;`**

Right above the closing `return row;`:

```typescript
    // Auto-flip: new tournaments default to padelgod-owned. Existing rows
    // are NEVER touched — never silently flip an in-flight tournament.
    // Per spec: docs/superpowers/specs/2026-05-02-padelapi-departure-design.md §3
    const existingForSlug = existingBySlug.get(p.slug);
    const isTwinUpdate = typeof row.id === 'string' && twinIds.has(row.id);
    if (!existingForSlug && !isTwinUpdate) {
      row.live_source = 'padelgod';
    } else if (existingForSlug?.live_source != null) {
      // Echo existing value back into the payload to defeat Supabase
      // upsert's "missing column → reset to default" behavior on UPDATE
      // (same gotcha as level/country preservation above).
      row.live_source = existingForSlug.live_source;
    }
```

- [ ] **Step 3: Run the new test — expect pass**

```bash
cd padelgod && npm run test -- tournament-discovery -t 'sets live_source' 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Run the full tournament-discovery test suite**

```bash
cd padelgod && npm run test -- tournament-discovery 2>&1 | tail -15
```

Expected: all tests pass — no regressions.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/tournament-discovery.ts padelgod/src/__tests__/workers/tournament-discovery.test.ts
git commit -m "feat(padelgod): auto-flip live_source=padelgod on tournament INSERT"
```

### Task 9: Write failing test for UPDATE preserve behavior

**Files:**
- Modify: `padelgod/src/__tests__/workers/tournament-discovery.test.ts`

- [ ] **Step 1: Add the UPDATE test**

Append:

```typescript
  it("preserves existing live_source on tournament UPDATE (never silently flips)", async () => {
    const supa = fakeSupabase('2026-01-01T00:00:00Z')
    // Simulate an EXISTING tournament with live_source='padelapi' (legacy)
    const ORIGINAL_FROM = supa.from
    supa.from = (table: string) => {
      const base = ORIGINAL_FROM(table)
      if (table === 'tournaments') {
        return {
          ...base,
          select: (cols: string) => ({
            ...base.select(cols),
            in: async (_col: string, _values: string[]) => ({
              data: [{ slug: 'fip-bronze-existing-2026', level: 'fip_bronze', country: 'PY', live_source: 'padelapi' }],
              error: null,
            }),
          }),
        }
      }
      return base
    }
    const httpClient = {
      get: vi.fn().mockResolvedValue({
        data: [
          {
            id: 1000,
            slug: 'fip-bronze-existing-2026',
            title: { rendered: 'FIP BRONZE EXISTING' },
            modified_gmt: '2026-05-01T00:00:00',
            acmf_event: { accommodation_start_date: '2026-06-01', accommodation_end_date: '2026-06-07' },
            tournament_category: [497],
            country: [],
          },
        ],
      }),
    } as never
    await runTournamentDiscovery({ supabase: supa as never, httpClient, logger: console as never })
    const tournamentUpserts = supa.upserted.filter((u: any) => u.table === 'tournaments')
    expect(tournamentUpserts.length).toBeGreaterThan(0)
    const upsertedRow = tournamentUpserts[0].rows[0]
    // Must NOT silently flip to padelgod — must echo 'padelapi' back
    expect(upsertedRow.live_source).toBe('padelapi')
  })
```

- [ ] **Step 2: Run — should already pass given Task 8's `else if` branch**

```bash
cd padelgod && npm run test -- tournament-discovery -t 'preserves existing live_source' 2>&1 | tail -10
```

Expected: PASS.

If it fails, the `else if` branch in Task 8 isn't echoing the existing value back. Fix the implementation, then re-run.

- [ ] **Step 3: Commit**

```bash
git add padelgod/src/__tests__/workers/tournament-discovery.test.ts
git commit -m "test(padelgod): UPDATE preserves existing live_source"
```

### Task 10: Push the auto-flip change

- [ ] **Step 1: Push the branch**

```bash
git push origin claude/nervous-mcnulty-82d476
```

- [ ] **Step 2: Merge to main**

Per the user's PR-workflow preference, the branch goes through main via merge from the parent worktree:

```bash
git -C /Users/GuDenes/Projects/padel-live-scores fetch origin main && \
git -C /Users/GuDenes/Projects/padel-live-scores checkout main && \
git -C /Users/GuDenes/Projects/padel-live-scores pull --ff-only origin main && \
git -C /Users/GuDenes/Projects/padel-live-scores merge --no-ff origin/claude/nervous-mcnulty-82d476 -m "Merge claude/nervous-mcnulty-82d476: padelapi departure" && \
git -C /Users/GuDenes/Projects/padel-live-scores push origin main
```

- [ ] **Step 3: Wait for Railway redeploy**

Padelgod auto-deploys on push to `main`. Watch the Railway deployment log; expect `tournament discovery worker registered` and a clean startup within ~2 minutes.

---

## Phase 3 — Retire padelapi crons

### Task 11: Bulk flip live_source for active tournaments

**Why:** With the populator now creating Premier matches and the live-poller running canonical for everyone, no tournament should be flagged padelapi. This SQL is the cosmetic alignment — and it's the gate that makes Phase 3's cron retirement safe (Vercel scores cron skips `live_source='padelgod'` tournaments).

Wait — that gate doesn't exist yet because we're going to retire scores cron entirely. The flip is here to align the data model, not to gate anything. Does Phase 3's cron retirement actually need the flip? It does not — retiring the cron makes the flag irrelevant. But the flip makes the system honest about who owns each tournament, and `padelgod_tournaments_for_live_polling()` reads `live_source='padelgod'` to spawn canonical loops. Without the flip, those 61 tournaments would keep running shadow-mode loops forever, never escalating to canonical. So: do the flip.

**Files:**
- Create: `scripts/bulk-flip-live-source.ts`

- [ ] **Step 1: Write the bulk-flip script**

```typescript
// scripts/bulk-flip-live-source.ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const APPLY = process.argv.includes('--apply')
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })

async function main() {
  // Active or future window: skip tournaments that finished more than 7 days ago.
  // Two passes — rows with ends_at, then rows where ends_at is null but starts_at is recent.
  const cutoffEnd = new Date(Date.now() - 7 * 86400e3).toISOString()
  const cutoffStart = new Date(Date.now() - 14 * 86400e3).toISOString()
  const [{ data: withEnd }, { data: nullEnd }] = await Promise.all([
    s.from('tournaments').select('id, name, level, starts_at, ends_at, live_source').eq('live_source', 'padelapi').gte('ends_at', cutoffEnd),
    s.from('tournaments').select('id, name, level, starts_at, ends_at, live_source').eq('live_source', 'padelapi').is('ends_at', null).gte('starts_at', cutoffStart),
  ])
  const candidates = [...(withEnd ?? []), ...(nullEnd ?? [])]
  const error = null as Error | null
  if (error) throw error
  console.log(`Candidates to flip: ${candidates?.length ?? 0}`)
  console.table((candidates ?? []).slice(0, 20).map((t) => ({ name: t.name, level: t.level, starts: t.starts_at?.slice(0, 10) })))

  if (!APPLY) {
    console.log('\nDRY-RUN. Re-run with --apply to mutate.')
    return
  }
  const ids = (candidates ?? []).map((t) => t.id)
  const { error: upErr, count } = await s
    .from('tournaments')
    .update({ live_source: 'padelgod' }, { count: 'exact' })
    .in('id', ids)
  if (upErr) throw upErr
  console.log(`Flipped: ${count} rows`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Dry-run**

```bash
cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && npx tsx scripts/bulk-flip-live-source.ts
```

Expected: list of ~61 candidates (more if Phase 0 has been running for hours and tournament-discovery has added new ones).

Eyeball the list. Anything surprising — non-padel tournaments, weird dates, levels you don't recognize? If yes, stop and investigate.

- [ ] **Step 3: Apply**

```bash
npx tsx scripts/bulk-flip-live-source.ts --apply
```

Expected: `Flipped: <N> rows` matching the dry-run candidate count.

- [ ] **Step 4: Verify**

```bash
npx tsx -e '
import {createClient} from "@supabase/supabase-js";
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const cutoff=new Date(Date.now()-7*86400e3).toISOString();
const {count}=await s.from("tournaments").select("*",{count:"exact",head:true}).eq("live_source","padelapi").gte("ends_at",cutoff);
console.log("active tournaments still on padelapi:",count);
'
```

Expected: 0.

- [ ] **Step 5: Commit the script**

```bash
git add scripts/bulk-flip-live-source.ts
git commit -m "tools: bulk live_source flip for padelapi departure"
```

### Task 12: Wait for first canonical-mode poll cycle on flipped Bronze/Silver

**Why:** Task 3 verified one tournament. Now 61 tournaments flipped. Confirm none of them surface bad writes within one full poll cycle (60s + a margin).

- [ ] **Step 1: Sleep 3 minutes**

```bash
sleep 180
```

- [ ] **Step 2: Spot-check 5 random flipped tournaments**

```bash
cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && npx tsx -e '
import {createClient} from "@supabase/supabase-js";
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const {data:tids}=await s.from("tournaments").select("id,name").eq("live_source","padelgod").neq("level","p2").limit(5);
for (const t of tids ?? []) {
  const {count}=await s.from("matches").select("*",{count:"exact",head:true}).eq("tournament_id",t.id);
  const {data:recent}=await s.from("matches").select("id,status,updated_at").eq("tournament_id",t.id).order("updated_at",{ascending:false}).limit(1);
  console.log(t.name,"matches:",count,"latest_update:",recent?.[0]?.updated_at);
}
' 2>&1 | tail -10
```

Eyeball: `latest_update` should be a normal timestamp (likely earlier today from oop-writer or results-writer), NOT a fresh timestamp from the last 3 minutes (which would suggest the canonical loop is over-writing).

If you see suspicious fresh updates: revert the bulk flip immediately:
```bash
npx tsx -e 'import {createClient} from "@supabase/supabase-js"; const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}}); const {count}=await s.from("tournaments").update({live_source:"padelapi"},{count:"exact"}).eq("live_source","padelgod").neq("level","p2"); console.log("reverted:",count);'
```

### Task 13: Retire padelapi crons in `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Inspect current cron entries**

```bash
cat /Users/GuDenes/Projects/padel-live-scores/vercel.json | grep -A1 'scores\|sync\b'
```

- [ ] **Step 2: Edit `vercel.json`**

Open `/Users/GuDenes/Projects/padel-live-scores/vercel.json`. In the `crons` array, delete the two entries whose `path` is:
- `/api/cron/scores`
- `/api/cron/sync` (also delete the weekly entry if present; both cron lines pointing at `/api/cron/sync`)

Keep all other entries. Do not modify `/api/cron/premier-stats`, `/api/cron/premier-discovery`, `/api/cron/sync-articles`, `/api/cron/sync-highlights`, `/api/cron/sync-fip-rankings`, `/api/cron/fip-streams-discover`, `/api/cron/social-drafts`, `/api/cron/oop-monitor`.

- [ ] **Step 3: Validate JSON**

```bash
node -e 'console.log(JSON.parse(require("fs").readFileSync("/Users/GuDenes/Projects/padel-live-scores/vercel.json","utf8")).crons.length, "crons remaining")'
```

Expected: 2 fewer crons than before (or 3 if both `/api/cron/sync` entries existed).

- [ ] **Step 4: Commit + push from the worktree**

The worktree has its own copy of `vercel.json` at the worktree root.

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/nervous-mcnulty-82d476
git add vercel.json
git commit -m 'feat: retire /api/cron/scores and /api/cron/sync (padelapi departure)'
git push origin claude/nervous-mcnulty-82d476
```

- [ ] **Step 5: Merge to main**

Same merge pattern as Task 10 step 2.

- [ ] **Step 6: Confirm Vercel picked up the change**

Open the Vercel dashboard → project → Crons tab. Verify `/api/cron/scores` and `/api/cron/sync` are no longer listed.

### Task 14: Stop the Railway Pusher relay service

**Why:** With nobody on `live_source='padelapi'`, the relay has no channels to subscribe to.

**Files:** none (Railway dashboard action)

- [ ] **Step 1: Open Railway dashboard for the relay service**

It's a separate service from padelgod — usually named `relay` or similar. Confirm it serves `relay/index.js`.

- [ ] **Step 2: Click the service → Settings → Stop**

Do NOT delete the service or its env vars. We want fast rollback for ~30 days.

- [ ] **Step 3: Verify health check fails (service is genuinely off)**

```bash
curl -fsS "$RELAY_URL/health" 2>&1 | head -5
```

(`$RELAY_URL` from `.env.local`). Expect connection refused or 502.

- [ ] **Step 4: Verify no DB writes from the relay's service-account in the next 5 minutes**

The relay tags writes via the service-key user. After stopping:
```bash
sleep 300
cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && npx tsx -e '
import {createClient} from "@supabase/supabase-js";
const s=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
const since=new Date(Date.now()-5*60e3).toISOString();
const {count}=await s.from("matches").select("*",{count:"exact",head:true}).gte("updated_at",since);
console.log("matches updated in last 5 min:",count);
'
```

Some are normal (from padelgod workers). What you do not want is a flood. Eyeball-judge.

---

## Phase 4 — Soak monitoring (48 hours)

### Task 15: Soak verification

**Why:** Catch slow-burn issues that don't show up in the immediate post-deploy minutes.

**Files:**
- Create: `scripts/soak-asuncion.ts`

- [ ] **Step 1: Write the soak script**

```typescript
// scripts/soak-asuncion.ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const TID = '5027936c-9fd5-4309-83e7-44ee4620a207'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })

async function main() {
  console.log(`Soak report — ASUNCION P2 — ${new Date().toISOString()}`)

  // 1. Match count + composite coverage
  const { count: matchCount } = await s.from('matches').select('*', { count: 'exact', head: true }).eq('tournament_id', TID)
  const { count: nullComposite } = await s.from('matches').select('*', { count: 'exact', head: true }).eq('tournament_id', TID).is('widget_id_composite', null)
  console.log(`matches: ${matchCount} (NULL composite: ${nullComposite})`)

  // 2. Match-stats coverage
  const { data: matchIds } = await s.from('matches').select('id, status').eq('tournament_id', TID)
  const finishedIds = (matchIds ?? []).filter((m) => m.status === 'finished').map((m) => m.id)
  if (finishedIds.length) {
    const { count: statsCount } = await s.from('match_stats').select('*', { count: 'exact', head: true }).in('match_id', finishedIds).eq('set_number', 0)
    console.log(`finished matches: ${finishedIds.length}, with stats row: ${statsCount}`)
  }

  // 3. Scrape-job health
  const { data: recentJobs } = await s
    .schema('padelgod' as never)
    .from('scrape_jobs')
    .select('worker_name, status, started_at, error_message')
    .eq('tournament_id', TID)
    .order('started_at', { ascending: false })
    .limit(10)
  console.table(recentJobs)
  const failed = (recentJobs ?? []).filter((j) => j.status === 'error')
  if (failed.length) console.error(`!! ${failed.length} failed scrape jobs in last 10`)

  // 4. Unresolved queue
  const { count: unresolved } = await s.from('match_stats_unresolved').select('*', { count: 'exact', head: true }).is('resolved_at', null)
  console.log(`global match_stats_unresolved (open): ${unresolved}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run at ~T+6h, T+24h, T+48h**

```bash
cd /Users/GuDenes/Projects/padel-live-scores && set -a && . ./.env.local && set +a && npx tsx scripts/soak-asuncion.ts
```

At each sample, capture the output to a scratch file. Look for:
- `matches` count growing as the draw fills (Day 1 qualifiers, then main draw)
- `NULL composite` always 0
- `finished matches` having `with stats row` close to 1:1 ratio after `:13` cron
- `failed scrape jobs` count = 0; if any, click into the error message
- `match_stats_unresolved` not climbing

- [ ] **Step 3: At T+48h, run the cross-pipeline duplicate check**

```bash
node --experimental-strip-types scripts/dedup-pattern-b-multi-pipeline.mjs --dry-run 2>&1 | tail -20
```

Expected: no new clusters involving Asuncion or any flipped Bronze/Silver tournament. If new clusters appear, investigate before declaring success.

- [ ] **Step 4: Commit the soak script**

```bash
git add scripts/soak-asuncion.ts
git commit -m "tools: 48h soak report for Asuncion + flipped tournaments"
```

---

## Self-review checklist

Before considering the plan executable, the engineer should verify:

- Phase 0 gates all pass (no tasks skipped under time pressure)
- Tasks 4 and 13 are the only ones that touch Vercel/Railway dashboards directly (everything else is git-tracked)
- `padelapi_id` is preserved as a hot column on existing rows (the spec defers its removal)
- `/api/cron/premier-stats` and `/api/cron/premier-discovery` survive every change (search the diff)
- `live_source='padelgod'` is set on INSERT only — UPDATE preserves whatever was there (Task 9 test enforces)
- The bulk flip in Task 11 has a date floor so historical rows stay untouched

## Rollback summary

| Failure | Revert | Time |
|---|---|---|
| Asuncion populator creates duplicates | Re-add `FIP_DRAW_POPULATOR_EXCLUDE_LEVELS` env var on Railway; flip Asuncion `live_source='padelapi'` | ~3 min |
| Bronze/Silver canonical loops misbehave after Task 11 | Run the revert SQL embedded in Task 12 step 2 | ~5 min |
| Premier scoring stops mid-tournament | Revert Asuncion only; restart Railway relay service | ~5 min |
| Vercel cron retirement (Task 13) hides a regression | Restore the two cron entries in `vercel.json`; redeploy | ~5 min |
