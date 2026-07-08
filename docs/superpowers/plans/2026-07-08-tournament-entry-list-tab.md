# Tournament Entry List Tab — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated **Entries** tab to the tournament page that surfaces the entry list as soon as it's published (before the draw), and land the existing "New tournament entry" push on it.

**Architecture:** A new public `tournament_entries` table holds resolved team rows. The existing `fip-entry-list-populator` padelgod worker is extended to build teams from `padelgod.entry_list_snapshots` and write them (delete-then-insert per tournament/category), and to repoint its `player_entered` push at `?tab=entries`. The browser reads `tournament_entries` directly via a `useEntryList` hook and renders the already-built (but unmounted) `EntryList` component as tab #2, feature-flagged.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Supabase (Postgres + RLS), padelgod workers (Node/TS), Vitest, pg migrations applied via `DATABASE_URL`.

**Base branch:** `feat/tournament-entry-list-tab` (worktree `.claude/worktrees/entry-list-tab`, off `main`). All paths below are relative to the repo root.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260708120000_tournament_entries.sql` (create) | `tournament_entries` table + index + RLS + `entry_list_enabled` flag row |
| `src/lib/feature-flags.ts` (modify) | Add `ENTRY_LIST_ENABLED` flag key |
| `padelgod/src/lib/entry-list-teams.ts` (create) | Pure function: collapse per-player snapshot rows → unordered team descriptors |
| `padelgod/src/lib/__tests__/entry-list-teams.test.ts` (create) | Unit tests for the pairing function |
| `padelgod/src/workers/fip-entry-list-populator.ts` (modify) | Extend snapshot select/type; build+resolve+write teams; repoint push URL |
| `padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts` (modify) | Tests for team writes + push URL |
| `src/components/EntryList.tsx` (modify) | Add `showDebutChips` prop (hide Fresh/New chips in v1) |
| `src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts` (create) | Hook: read `tournament_entries` + hydrate `playerMap` |
| `src/app/[locale]/(app)/tournaments/[id]/EntriesTab.tsx` (create) | Thin wrapper: hook → `EntryList`, loading/empty states |
| `src/app/[locale]/(app)/tournaments/[id]/page.tsx` (modify) | Tab type/init, `?tab=entries`, tab array, NEW pill, render, flag |
| `src/messages/{en,es,pt,it,fr}.json` (modify) | `tournament.entries` label |

---

## Task 1: Database migration — `tournament_entries` + flag

**Files:**
- Create: `supabase/migrations/20260708120000_tournament_entries.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260708120000_tournament_entries.sql
-- Resolved team rows for the tournament Entries tab. Populated pre-draw by
-- padelgod's fip-entry-list-populator from padelgod.entry_list_snapshots
-- (delete-then-insert per tournament+category). Public-readable (anon key);
-- writes are service-role only.

create table if not exists public.tournament_entries (
  id               uuid primary key default gen_random_uuid(),
  tournament_id    uuid not null references public.tournaments(id) on delete cascade,
  category         text not null check (category in ('men','women')),
  draw_type        text not null default 'main',   -- 'main' | 'qualifying'
  seed             integer,
  marker           text,                             -- 'Q' for qualifying, else null
  player1_id       uuid references public.players(id) on delete set null,
  player2_id       uuid references public.players(id) on delete set null,
  player1_name     text,
  player2_name     text,
  player1_country  text,
  player2_country  text,
  team_points      integer,
  captured_at      timestamptz not null,
  updated_at       timestamptz not null default now()
);

create index if not exists tournament_entries_tournament_idx
  on public.tournament_entries (tournament_id, category);

alter table public.tournament_entries enable row level security;
drop policy if exists tournament_entries_read on public.tournament_entries;
create policy tournament_entries_read
  on public.tournament_entries for select to anon, authenticated using (true);

-- Feature flag: OFF in prod, ON for localhost dev.
insert into public.feature_flags (key, enabled, enabled_local, label, description)
values (
  'entry_list_enabled',
  false,
  true,
  'Tournament · Entries tab',
  'Pre-draw entry list tab on the tournament page, fed by tournament_entries. OFF in prod.'
)
on conflict (key) do nothing;
```

- [ ] **Step 2: Apply the migration**

Per repo convention (migrations have drift — do NOT use `supabase db push`), apply via the pg driver + `DATABASE_URL`:

Run:
```bash
node -e "const fs=require('fs');const pg=require('pg');(async()=>{const url=fs.readFileSync('.env.local','utf8').match(/DATABASE_URL=(.*)/)[1].trim();const c=new pg.Client({connectionString:url});await c.connect();await c.query(fs.readFileSync('supabase/migrations/20260708120000_tournament_entries.sql','utf8'));console.log('applied');await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})"
```
Expected: prints `applied`.

- [ ] **Step 3: Verify table + flag exist**

Run:
```bash
node -e "const fs=require('fs');const pg=require('pg');(async()=>{const url=fs.readFileSync('.env.local','utf8').match(/DATABASE_URL=(.*)/)[1].trim();const c=new pg.Client({connectionString:url});await c.connect();const t=await c.query(\"select count(*)::int n from information_schema.tables where table_name='tournament_entries'\");const f=await c.query(\"select enabled,enabled_local from feature_flags where key='entry_list_enabled'\");console.log('table',t.rows[0].n,'flag',JSON.stringify(f.rows[0]));await c.end();})()"
```
Expected: `table 1 flag {"enabled":false,"enabled_local":true}`

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260708120000_tournament_entries.sql
git commit -m "feat(db): tournament_entries table + entry_list_enabled flag"
```

---

## Task 2: Feature flag key

**Files:**
- Modify: `src/lib/feature-flags.ts` (the `FLAG_KEYS` object)

- [ ] **Step 1: Add the key**

In `src/lib/feature-flags.ts`, add to `FLAG_KEYS` (after `BETTING_ENABLED`):

```ts
  BETTING_ENABLED:                'betting_enabled',
  ENTRY_LIST_ENABLED:             'entry_list_enabled',
} as const
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no new errors referencing `feature-flags.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/feature-flags.ts
git commit -m "feat(flags): add ENTRY_LIST_ENABLED key"
```

---

## Task 3: Pure team-pairing helper (TDD)

Collapses per-player snapshot rows (each carries its own name/country + a `partner_fip_id`/`partner_name`) into one descriptor per unordered pair. Merges the two rows of a team so both players' countries are captured; falls back to `partner_name` (country null) when the partner has no own row.

**Files:**
- Create: `padelgod/src/lib/entry-list-teams.ts`
- Test: `padelgod/src/lib/__tests__/entry-list-teams.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// padelgod/src/lib/__tests__/entry-list-teams.test.ts
import { describe, it, expect } from 'vitest';
import { buildEntryTeams, type EntrySnapshotInput } from '../entry-list-teams.js';

const base = { tournament_id: 't1', category: 'men' as const };

describe('buildEntryTeams', () => {
  it('collapses the two rows of a pair into one team with both countries', () => {
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'A', name: 'Galán', country: 'ES', seed: 1, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main' },
      { ...base, fip_id: 'B', name: 'Chingotto', country: 'AR', seed: 1, partner_fip_id: 'A', partner_name: 'Galán', draw_type: 'main' },
    ];
    const teams = buildEntryTeams(rows);
    expect(teams).toHaveLength(1);
    const t = teams[0];
    // Ordered by fip_id ascending → A first.
    expect(t.fip1).toBe('A');
    expect(t.country1).toBe('ES');
    expect(t.fip2).toBe('B');
    expect(t.country2).toBe('AR');
    expect(t.seed).toBe(1);
    expect(t.draw_type).toBe('main');
    expect(t.marker).toBeNull();
  });

  it('maps qualifying draw_type to a Q marker', () => {
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'C', name: 'Peña', country: 'CL', seed: null, partner_fip_id: 'D', partner_name: 'Giusto', draw_type: 'qualifying' },
      { ...base, fip_id: 'D', name: 'Giusto', country: 'AR', seed: null, partner_fip_id: 'C', partner_name: 'Peña', draw_type: 'qualifying' },
    ];
    const teams = buildEntryTeams(rows);
    expect(teams).toHaveLength(1);
    expect(teams[0].marker).toBe('Q');
  });

  it('falls back to partner_name (country null) when the partner has no own row', () => {
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'E', name: 'Solo', country: 'BR', seed: null, partner_fip_id: 'F', partner_name: 'Ghost', draw_type: 'main' },
    ];
    const teams = buildEntryTeams(rows);
    expect(teams).toHaveLength(1);
    expect(teams[0].fip1).toBe('E');
    expect(teams[0].name2).toBe('Ghost');
    expect(teams[0].fip2).toBe('F');
    expect(teams[0].country2).toBeNull();
  });

  it('keeps a non-null seed when only one row of the pair carries it', () => {
    const rows: EntrySnapshotInput[] = [
      { ...base, fip_id: 'A', name: 'Galán', country: 'ES', seed: 2, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main' },
      { ...base, fip_id: 'B', name: 'Chingotto', country: 'AR', seed: null, partner_fip_id: 'A', partner_name: 'Galán', draw_type: 'main' },
    ];
    expect(buildEntryTeams(rows)[0].seed).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/entry-list-teams.test.ts`
Expected: FAIL — `Cannot find module '../entry-list-teams.js'`.

- [ ] **Step 3: Implement the helper**

```ts
// padelgod/src/lib/entry-list-teams.ts
//
// Pure: collapse per-player entry_list_snapshots rows into one descriptor
// per unordered pair. Each snapshot row is a single player carrying their
// own name/country plus partner_fip_id/partner_name. A full pair therefore
// appears as two rows (A→B, B→A); we merge them so both countries survive.
// When only one row exists, we fall back to partner_name (country unknown).
//
// fip_ids are expected already normalized (no "fip-" prefix) by the caller.

export interface EntrySnapshotInput {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string;
  name: string | null;
  country: string | null;
  seed: number | null;
  partner_fip_id: string | null;
  partner_name: string | null;
  draw_type: string | null;
}

export interface EntryTeam {
  tournament_id: string;
  category: 'men' | 'women';
  draw_type: string;
  seed: number | null;
  marker: string | null;
  fip1: string;
  name1: string | null;
  country1: string | null;
  fip2: string | null;
  name2: string | null;
  country2: string | null;
}

interface Accum {
  tournament_id: string;
  category: 'men' | 'women';
  draw_type: string;
  seed: number | null;
  // Keyed by fip_id → self player fields seen on that player's own row.
  players: Map<string, { name: string | null; country: string | null }>;
  // Partner-name fallback keyed by fip_id (from the other player's row).
  partnerNames: Map<string, string | null>;
}

function teamKey(a: string, b: string | null): string {
  if (!b) return a;
  return a < b ? `${a}::${b}` : `${b}::${a}`;
}

export function buildEntryTeams(rows: EntrySnapshotInput[]): EntryTeam[] {
  const groups = new Map<string, Accum>();

  for (const r of rows) {
    const key = teamKey(r.fip_id, r.partner_fip_id);
    let g = groups.get(key);
    if (!g) {
      g = {
        tournament_id: r.tournament_id,
        category: r.category,
        draw_type: r.draw_type ?? 'main',
        seed: null,
        players: new Map(),
        partnerNames: new Map(),
      };
      groups.set(key, g);
    }
    g.players.set(r.fip_id, { name: r.name, country: r.country });
    if (r.seed != null && g.seed == null) g.seed = r.seed;
    if (r.draw_type && g.draw_type === 'main') g.draw_type = r.draw_type;
    if (r.partner_fip_id) g.partnerNames.set(r.partner_fip_id, r.partner_name);
  }

  const teams: EntryTeam[] = [];
  for (const [key, g] of groups) {
    const fips = key.split('::');
    const [fA, fB = null] = fips;
    const pA = g.players.get(fA) ?? { name: g.partnerNames.get(fA) ?? null, country: null };
    const pB = fB
      ? (g.players.get(fB) ?? { name: g.partnerNames.get(fB) ?? null, country: null })
      : null;
    teams.push({
      tournament_id: g.tournament_id,
      category: g.category,
      draw_type: g.draw_type,
      seed: g.seed,
      marker: g.draw_type === 'qualifying' ? 'Q' : null,
      fip1: fA,
      name1: pA.name,
      country1: pA.country,
      fip2: fB,
      name2: pB ? pB.name : null,
      country2: pB ? pB.country : null,
    });
  }
  return teams;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/entry-list-teams.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/entry-list-teams.ts padelgod/src/lib/__tests__/entry-list-teams.test.ts
git commit -m "feat(padelgod): pure entry-list team pairing helper"
```

---

## Task 4: Extend the worker to write `tournament_entries` (TDD)

Add a team-writing phase after the existing player upsert. Reads the extra snapshot columns, builds teams, resolves fip_ids → player ids + points, and delete-then-inserts per processed `(tournament_id, category)`.

**Files:**
- Modify: `padelgod/src/workers/fip-entry-list-populator.ts`
- Test: `padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts`

- [ ] **Step 1: Extend the snapshot select + row type**

In `padelgod/src/workers/fip-entry-list-populator.ts`, update the `EntryListSnapshotRow` interface (around line 95) to add the new columns:

```ts
interface EntryListSnapshotRow {
  tournament_id: string;
  category: 'men' | 'women';
  fip_id: string | null;
  name: string | null;
  country: string | null;
  captured_at: string;
  seed: number | null;
  partner_fip_id: string | null;
  partner_name: string | null;
  draw_type: string | null;
}
```

And the snapshot `.select(...)` (around line 137):

```ts
    .select('tournament_id, category, fip_id, name, country, captured_at, seed, partner_fip_id, partner_name, draw_type')
```

And the existing-players `.select(...)` (around line 213) to include `points`:

```ts
    .select('id, fip_id, name, country, category, points')
```

Add `points` to `ExistingPlayerRow`:

```ts
interface ExistingPlayerRow {
  id: string;
  fip_id: string;
  name: string | null;
  country: string | null;
  category: string | null;
  points: number | null;
}
```

- [ ] **Step 2: Write the failing test**

Add to `padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts`. First extend the `SnapshotSeed` interface and the fake supabase so it (a) returns the new snapshot columns and (b) records `tournament_entries` delete + insert. Add these to the `Options`/fake:

```ts
// In SnapshotSeed, add:
//   seed?: number | null; partner_fip_id?: string | null;
//   partner_name?: string | null; draw_type?: string | null;
//
// In fakeSupabase, add a captured store and teach `.from('tournament_entries')`
// to support .delete().eq().eq() and .insert():
const entryDeletes: Array<{ tournament_id: string; category: string }> = [];
const entryInserts: Record<string, unknown>[] = [];

const tournamentEntriesTable = () => {
  const q: any = {
    _t: null as string | null,
    _c: null as string | null,
    delete() { return this; },
    eq(col: string, val: string) {
      if (col === 'tournament_id') this._t = val;
      if (col === 'category') { this._c = val; entryDeletes.push({ tournament_id: this._t, category: val }); return Promise.resolve({ error: null }); }
      return this;
    },
    insert(rows: Record<string, unknown>[]) { entryInserts.push(...rows); return Promise.resolve({ error: null }); },
  };
  return q;
};
// Route .from('tournament_entries') to tournamentEntriesTable() and expose
// entryDeletes / entryInserts on the returned harness.
```

Then the test:

```ts
it('writes one tournament_entries row per pair, resolved with team_points', async () => {
  const { supabase, entryInserts, entryDeletes } = fakeSupabase({
    snapshots: [
      { tournament_id: 't1', category: 'men', fip_id: 'A', name: 'Galán', country: 'ES', captured_at: '2026-07-01T00:00:00Z', seed: 1, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main' },
      { tournament_id: 't1', category: 'men', fip_id: 'B', name: 'Chingotto', country: 'AR', captured_at: '2026-07-01T00:00:00Z', seed: 1, partner_fip_id: 'A', partner_name: 'Galán', draw_type: 'main' },
    ],
    existingPlayers: [
      { id: 'p-A', fip_id: 'A', name: 'Galán', country: 'ES', category: 'men', points: 15000 },
      { id: 'p-B', fip_id: 'B', name: 'Chingotto', country: 'AR', category: 'men', points: 13000 },
    ],
  });

  await runFipEntryListPopulator({ supabase, dryRun: false });

  expect(entryDeletes).toContainEqual({ tournament_id: 't1', category: 'men' });
  expect(entryInserts).toHaveLength(1);
  expect(entryInserts[0]).toMatchObject({
    tournament_id: 't1', category: 'men', draw_type: 'main', seed: 1,
    player1_id: 'p-A', player2_id: 'p-B', team_points: 28000,
  });
});

it('does not touch tournament_entries on dry-run', async () => {
  const { supabase, entryInserts, entryDeletes } = fakeSupabase({
    snapshots: [
      { tournament_id: 't1', category: 'men', fip_id: 'A', name: 'Galán', country: 'ES', captured_at: '2026-07-01T00:00:00Z', seed: 1, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main' },
    ],
  });
  await runFipEntryListPopulator({ supabase, dryRun: true });
  expect(entryDeletes).toHaveLength(0);
  expect(entryInserts).toHaveLength(0);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-entry-list-populator.test.ts -t "tournament_entries"`
Expected: FAIL — no delete/insert recorded (worker doesn't write teams yet).

- [ ] **Step 4: Implement the team-writing phase**

In `runFipEntryListPopulator`, after the existing per-fip_id player upsert loop and the `flushPlayerEntered()` call, add a team-writing phase. It reuses `latestRows` (already latest-snapshot-filtered) and `existingByFipId` (the resolved-players map). Import the helper at the top:

```ts
import { buildEntryTeams, type EntrySnapshotInput } from '../lib/entry-list-teams.js';
```

Add before the function returns (guarded by `!dryRun`, honoring `onlyTournamentIds`):

```ts
  // ── Team phase: write public.tournament_entries ──────────────────────
  // Independent of the events gate — this is the data feed for the Entries
  // tab, not a notification. Skipped on dry-run.
  if (!dryRun) {
    // Group the latest snapshot rows by (tournament_id, category) and build
    // teams per bucket. Normalize fip_id/partner_fip_id (strip "fip-").
    const norm = (s: string | null): string | null => (s ? s.replace(/^fip-/, '') : null);
    const buckets = new Map<string, EntrySnapshotInput[]>();
    for (const r of latestRows) {
      if (!r.fip_id) continue;
      if (deps.onlyTournamentIds && !deps.onlyTournamentIds.has(r.tournament_id)) continue;
      const key = `${r.tournament_id}::${r.category}`;
      const list = buckets.get(key) ?? [];
      list.push({
        tournament_id: r.tournament_id,
        category: r.category,
        fip_id: norm(r.fip_id)!,
        name: r.name,
        country: r.country,
        seed: r.seed,
        partner_fip_id: norm(r.partner_fip_id),
        partner_name: r.partner_name,
        draw_type: r.draw_type,
      });
      buckets.set(key, list);
    }

    for (const [, bucketRows] of buckets) {
      const teams = buildEntryTeams(bucketRows);
      if (teams.length === 0) continue;
      const { tournament_id, category } = bucketRows[0];
      const capturedAt = bucketRows[0]?.tournament_id
        ? latestRows.find((r) => r.tournament_id === tournament_id && r.category === category)?.captured_at ?? new Date().toISOString()
        : new Date().toISOString();

      const insertRows = teams.map((t) => {
        const p1 = existingByFipId.get(t.fip1);
        const p2 = t.fip2 ? existingByFipId.get(t.fip2) : undefined;
        const pts1 = p1?.points ?? null;
        const pts2 = p2?.points ?? null;
        const team_points = pts1 != null && pts2 != null ? pts1 + pts2 : null;
        return {
          tournament_id: t.tournament_id,
          category: t.category,
          draw_type: t.draw_type,
          seed: t.seed,
          marker: t.marker,
          player1_id: p1?.id ?? null,
          player2_id: p2?.id ?? null,
          player1_name: t.name1,
          player2_name: t.name2,
          player1_country: t.country1,
          player2_country: t.country2,
          team_points,
          captured_at: capturedAt,
        };
      });

      // Delete-then-insert: idempotent + handles withdrawals. Only wipes a
      // bucket we have fresh data for.
      const { error: delErr } = await supabase
        .from('tournament_entries')
        .delete()
        .eq('tournament_id', tournament_id)
        .eq('category', category);
      if (delErr) {
        logger?.warn({ tournament_id, category, err: delErr.message }, 'tournament_entries delete failed');
        continue;
      }
      const { error: insErr } = await supabase.from('tournament_entries').insert(insertRows);
      if (insErr) {
        logger?.warn({ tournament_id, category, err: insErr.message }, 'tournament_entries insert failed');
      }
    }
  }
```

> Note: `existingByFipId` (built at line ~220, keyed on normalized fip_id → `ExistingPlayerRow`) is confirmed as the resolved-players map. Its keys are the players' raw `fip_id`; `buildEntryTeams` emits normalized fip_ids, so `existingByFipId.get(t.fip1)` matches.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-entry-list-populator.test.ts`
Expected: PASS (all existing tests + the 2 new ones).

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/fip-entry-list-populator.ts padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts
git commit -m "feat(padelgod): populate tournament_entries from entry-list snapshots"
```

---

## Task 5: Repoint the `player_entered` push at `?tab=entries` (TDD)

**Files:**
- Modify: `padelgod/src/workers/fip-entry-list-populator.ts` (`flushPlayerEntered`)
- Test: `padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts`

- [ ] **Step 1: Write the failing test**

The fake supabase already needs a `notify` capture. If the existing tests assert on `notifyEvent`, extend them; otherwise add a spy. Add:

```ts
it('deep-links the player_entered push to the entries tab', async () => {
  const notified: any[] = [];
  const notify = { /* whatever NotifyDeps shape the worker expects */ } as any;
  const { supabase } = fakeSupabase({
    snapshots: [
      { tournament_id: 't9', category: 'men', fip_id: 'A', name: 'Galán', country: 'ES', captured_at: '2026-07-01T00:00:00Z', seed: 1, partner_fip_id: 'B', partner_name: 'Chingotto', draw_type: 'main' },
    ],
    existingPlayers: [{ id: 'p-A', fip_id: 'A', name: 'Galán', country: 'ES', category: 'men', points: 100 }],
  });
  // Spy notifyEvent via vi.mock at top of file, capturing its first arg into `notified`.
  await runFipEntryListPopulator({ supabase, dryRun: false, eventsEnabled: true, notify });
  const entry = notified.find((n) => n.category === 'player_entered');
  expect(entry?.url).toBe('/tournaments/t9?tab=entries');
});
```

> Implementation detail: mock `notifyEvent` with `vi.mock('../../lib/notify.js', ...)` at the top of the test file and push its first argument into `notified`. Follow the existing mock style in the file if one is present.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-entry-list-populator.test.ts -t "deep-links"`
Expected: FAIL — `url` is `'/tournaments/t9'`.

- [ ] **Step 3: Change the URL**

In `flushPlayerEntered`, change the `url` line:

```ts
          url: `/tournaments/${tournamentId}?tab=entries`,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-entry-list-populator.test.ts -t "deep-links"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/fip-entry-list-populator.ts padelgod/src/__tests__/workers/fip-entry-list-populator.test.ts
git commit -m "feat(padelgod): land player_entered push on the entries tab"
```

---

## Task 6: `EntryList` — hide debut chips in v1

The component always renders the Fresh/New chips. v1 has no debut data, so add a prop to hide them (default keeps existing behaviour for any future caller).

**Files:**
- Modify: `src/components/EntryList.tsx`

- [ ] **Step 1: Add the prop**

In the `EntryListProps` interface, add:

```ts
interface EntryListProps {
  entries: DrawEntry[]
  playerMap: Record<string, PlayerHydration>
  debutStatusMap: Record<string, DebutStatus>
  genderFilter: 'men' | 'women'
  /** Show the Fresh/New filter chips. Default true; the Entries tab passes
   *  false in v1 (no debut data computed yet). */
  showDebutChips?: boolean
}
```

Destructure with a default:

```ts
export function EntryList({ entries, playerMap, debutStatusMap, genderFilter, showDebutChips = true }: EntryListProps) {
```

Wrap the Fresh + New chip buttons (the two `clickChip(...)` buttons in the filter row) so they only render when `showDebutChips`:

```tsx
        {showDebutChips && (
          <>
            <button onClick={() => clickChip('fresh')} style={chipStyle(filter === 'fresh', GREEN)}>
              Fresh partners <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 3 }}>{freshCount}</span>
            </button>
            <button onClick={() => clickChip('newThisSeason')} style={chipStyle(filter === 'newThisSeason', YELLOW)}>
              New this season <span style={{ opacity: 0.7, fontSize: 9, marginLeft: 3 }}>{seasonCount}</span>
            </button>
          </>
        )}
```

(The `All` chip stays. `debutStatusMap` being `{}` already means no pills render.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i entrylist | head`
Expected: no output (no errors in EntryList.tsx).

- [ ] **Step 3: Commit**

```bash
git add src/components/EntryList.tsx
git commit -m "feat(entry-list): showDebutChips prop to hide Fresh/New chips"
```

---

## Task 7: `useEntryList` hook

Reads `tournament_entries` for a tournament and returns `DrawEntry[]` (mapped, with a synthesized `draw_position` ordinal) plus a hydrated `playerMap`.

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { DrawEntry, PlayerHydration } from '@/components/EntryList'

interface EntryRow {
  category: 'men' | 'women'
  draw_type: string
  seed: number | null
  marker: string | null
  player1_id: string | null
  player2_id: string | null
  player1_name: string | null
  player2_name: string | null
  player1_country: string | null
  player2_country: string | null
  team_points: number | null
}

export interface EntryListState {
  entries: DrawEntry[]
  playerMap: Record<string, PlayerHydration>
  loading: boolean
  error: boolean
}

/** Reads tournament_entries (RLS public read) + hydrates player avatars/rankings. */
export function useEntryList(tournamentId: string): EntryListState {
  const [state, setState] = useState<EntryListState>({ entries: [], playerMap: {}, loading: true, error: false })

  useEffect(() => {
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset before async fetch
    setState({ entries: [], playerMap: {}, loading: true, error: false })

    ;(async () => {
      const { data, error } = await supabase
        .from('tournament_entries')
        .select('category, draw_type, seed, marker, player1_id, player2_id, player1_name, player2_name, player1_country, player2_country, team_points')
        .eq('tournament_id', tournamentId)
      if (cancelled) return
      if (error) {
        console.warn('[useEntryList] fetch failed:', error)
        setState({ entries: [], playerMap: {}, loading: false, error: true })
        return
      }
      const rows = (data ?? []) as EntryRow[]

      // Synthesize draw_position: sort by seed (nulls last) then team_points
      // desc within each category, assign an ordinal. Never a real bracket pos.
      const strength = (r: EntryRow) => (r.seed != null ? r.seed : 1000 - (r.team_points ?? 0) / 1e6)
      const sorted = [...rows].sort((a, b) => strength(a) - strength(b))
      const entries: DrawEntry[] = sorted.map((r, i) => ({
        draw_position: i + 1,
        seed: r.seed,
        marker: r.marker,
        category: r.category,
        player1_name: r.player1_name,
        player1_country: r.player1_country,
        player1_id: r.player1_id,
        player2_name: r.player2_name,
        player2_country: r.player2_country,
        player2_id: r.player2_id,
        team_points: r.team_points,
      }))

      // Hydrate avatars + rankings for the referenced players.
      const ids = Array.from(new Set(rows.flatMap((r) => [r.player1_id, r.player2_id]).filter(Boolean))) as string[]
      const playerMap: Record<string, PlayerHydration> = {}
      if (ids.length > 0) {
        const { data: players } = await supabase.from('players').select('id, avatar_url, ranking').in('id', ids)
        for (const p of (players ?? []) as { id: string; avatar_url: string | null; ranking: number | null }[]) {
          playerMap[p.id] = { avatar_url: p.avatar_url, ranking: p.ranking }
        }
      }
      if (cancelled) return
      setState({ entries, playerMap, loading: false, error: false })
    })()

    return () => { cancelled = true }
  }, [tournamentId])

  return state
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i useEntryList | head`
Expected: no output.

> If `DrawEntry`/`PlayerHydration` aren't exported from `EntryList.tsx`, add `export` to those interface declarations (they are already `export interface` per the current file).

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/useEntryList.ts"
git commit -m "feat(tournament): useEntryList hook reading tournament_entries"
```

---

## Task 8: `EntriesTab` wrapper

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/EntriesTab.tsx`

- [ ] **Step 1: Write the wrapper**

```tsx
// src/app/[locale]/(app)/tournaments/[id]/EntriesTab.tsx
'use client'
import { EntryList } from '@/components/EntryList'
import { useEntryList } from './useEntryList'

const MUTED = '#6B7280'

export default function EntriesTab({ tournamentId, genderFilter }: {
  tournamentId: string
  genderFilter: 'men' | 'women'
}) {
  const { entries, playerMap, loading } = useEntryList(tournamentId)
  const genderEntries = entries.filter((e) => e.category === genderFilter)

  if (!loading && genderEntries.length === 0) {
    return (
      <div style={{ padding: '32px 16px', textAlign: 'center', color: MUTED, fontSize: 13 }}>
        The entry list for this event is being prepared. Check back soon.
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 14px 20px' }}>
      <EntryList
        entries={entries}
        playerMap={playerMap}
        debutStatusMap={{}}
        genderFilter={genderFilter}
        showDebutChips={false}
      />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i EntriesTab | head`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/EntriesTab.tsx"
git commit -m "feat(tournament): EntriesTab wrapper with loading/empty states"
```

---

## Task 9: Wire the tab into `page.tsx`

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

- [ ] **Step 1: Import + flag + gate**

Add the import near the other tab imports (`import ProjectionTab from './ProjectionTab'`):

```ts
import EntriesTab from './EntriesTab'
```

After `const projectionFlag = useFeatureFlag(FLAG_KEYS.PROJECTION_ENABLED)` (around line 841) add:

```ts
  const entryListFlag = useFeatureFlag(FLAG_KEYS.ENTRY_LIST_ENABLED)
  const showEntriesTab = useMemo(() => {
    if (!entryListFlag) return false
    if (!activeTournamentObj) return false
    return activeTournamentObj.entry_list_status === 'ready'
  }, [entryListFlag, activeTournamentObj])
```

- [ ] **Step 2: Extend the `pageTab` type + init**

Change the `useState` type (line 237) and add the `entries` init branch:

```ts
  const [pageTab, setPageTabState] = useState<'matches' | 'overview' | 'story' | 'draw' | 'projection' | 'entries'>(
    wantsMatchesAnimation
      ? 'overview'
      : paramTab === 'entries'
      ? 'entries'
      : paramTab === 'projection'
      ? 'projection'
      : paramTab === 'draw'
      ? 'draw'
      : paramTab === 'story' || paramTab === 'recap'
      ? 'story'
      : paramTab === 'matches'
      ? 'matches'
      : 'overview'
  )
```

Also update the `setPageTab` callback's parameter type (search for the other `'matches' | 'overview' | 'story' | 'draw' | 'projection'` union near line 261) to include `'entries'`.

- [ ] **Step 3: Insert the tab into the strip**

In the `SlidingInkTabs` `tabs={...}` array (around line 1172), insert `'entries'` at position 2 (after `overview`, before `projection`) and give it the NEW pill. Replace the array expression's head:

```tsx
          tabs={(['overview', ...(showEntriesTab ? ['entries'] as const : []), ...(showProjectionTab ? ['projection'] as const : []), 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const).map(tab => ({
            key: tab,
            label: (tab === 'projection' || tab === 'entries') && tabsMounted && !(tab === 'projection' ? projectionSeen : entriesSeen) ? (
              <span style={{ position: 'relative' }}>
                {tTournament(tab)}
                <span style={{ marginLeft: 5, fontSize: 8, fontWeight: 800, letterSpacing: 0.3, color: '#06210a', background: '#7ED321', padding: '1px 4px', borderRadius: 3, verticalAlign: 'middle' }}>{tTournament('newBadge')}</span>
              </span>
            ) : tTournament(tab),
          }))}
```

Add the `entriesSeen` state near `projectionSeen` (around line 270):

```ts
  const [entriesSeen, setEntriesSeen] = useState(false)
  const markEntriesSeen = useCallback(() => {
    try { localStorage.setItem('entry_list_tab_seen', '1') } catch {}
    setEntriesSeen(true)
  }, [])
  useEffect(() => {
    const seen = (() => { try { return localStorage.getItem('entry_list_tab_seen') === '1' } catch { return false } })()
    if (seen) markEntriesSeen()
  }, [markEntriesSeen])
```

In the `SlidingInkTabs` `onChange` handler, mark seen when entering entries (mirror the projection branch):

```ts
            if (key === 'entries') { markEntriesSeen(); setPageTab('entries'); return }
```

- [ ] **Step 4: Render the tab body + fallback**

Add next to the projection render block (around line 1387):

```tsx
        {pageTab === 'entries' && activeTournamentObj && showEntriesTab && (
          <EntriesTab tournamentId={tournamentId} genderFilter={genderFilter} />
        )}
```

Add the graceful fallback so `?tab=entries` never sticks on a hidden tab. After `showEntriesTab` is defined, add an effect:

```ts
  useEffect(() => {
    if (pageTab === 'entries' && activeTournamentObj && !showEntriesTab) {
      setPageTabState('overview')
    }
  }, [pageTab, activeTournamentObj, showEntriesTab])
```

- [ ] **Step 5: Typecheck + build**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -iE "tournaments/\[id\]/page" | head`
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/page.tsx"
git commit -m "feat(tournament): mount Entries tab (pos 2) with NEW pill + ?tab=entries"
```

---

## Task 10: i18n label

**Files:**
- Modify: `src/messages/en.json`, `es.json`, `pt.json`, `it.json`, `fr.json`

- [ ] **Step 1: Add the `entries` label under the `tournament` namespace**

Add a sibling of `"draw"` in each file. Translations:

- `en.json`: `"entries": "Entries"`
- `es.json`: `"entries": "Inscritos"`
- `pt.json`: `"entries": "Inscritos"`
- `it.json`: `"entries": "Iscritti"`
- `fr.json`: `"entries": "Inscrits"`

- [ ] **Step 2: Verify JSON parses**

Run: `for f in en es pt it fr; do node -e "require('./src/messages/$f.json').tournament.entries" && echo "$f ok"; done`
Expected: `en ok` … `fr ok`.

- [ ] **Step 3: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(tournament): Entries tab label (5 locales)"
```

---

## Task 11: Backfill + end-to-end verification

**Files:** none (operational)

- [ ] **Step 1: Backfill `tournament_entries` for current `ready` tournaments**

Run the worker once locally (non-dry-run) against current data. If the padelgod runner exposes a one-shot entry, use it; otherwise invoke `runFipEntryListPopulator({ supabase, dryRun: false })` from a small script with the service-role client. Confirm rows landed:

```bash
node -e "const fs=require('fs');const pg=require('pg');(async()=>{const url=fs.readFileSync('.env.local','utf8').match(/DATABASE_URL=(.*)/)[1].trim();const c=new pg.Client({connectionString:url});await c.connect();const r=await c.query('select tournament_id, category, count(*)::int n from tournament_entries group by 1,2 order by 3 desc limit 10');console.table(r.rows);await c.end();})()"
```
Expected: several buckets with non-zero counts.

- [ ] **Step 2: Enable the flag for local + preview the tab**

The migration seeded `enabled_local=true`, so the tab is live on localhost. Start the dev server and open a `ready` tournament (e.g. a Bordeaux P2 / FIP Gold with entries).

Verify with the preview tools:
- The `Entries` tab appears at position 2 with a green NEW pill.
- Content matches the mock: `Player List (N pairs)` header, `All` chip only (no Fresh/New), Top Seeds hero card, Draw compact list with `Q` markers.
- The M/W navbar toggle switches the list.
- Visiting `…/tournaments/<id>?tab=entries` opens directly on the tab; on a non-ready tournament it falls back to Overview.

- [ ] **Step 3: Verify the notification deep-link (optional, if push is testable locally)**

Confirm a `player_entered` push payload carries `url: "/tournaments/<id>?tab=entries"`.

- [ ] **Step 4: Final commit (if any verification tweaks)**

```bash
git add -A && git commit -m "chore(entry-list): backfill + verification tweaks" || echo "nothing to commit"
```

---

## Self-Review notes

- **Spec coverage:** table + RLS (T1), flag (T1/T2), worker team-write via extended snapshot select + pure pairing (T3/T4), delete-then-insert withdrawals handling (T4), notification deep-link + fallback (T5/T9), reuse EntryList with hidden debut chips (T6), hook + wrapper + tab wiring + NEW pill + `?tab=entries` (T7–T9), i18n (T10), backfill + gating verification (T11). Deferred items (debut computation, `/entries` SEO URLs) intentionally excluded.
- **Fidelity:** grouping stays Top Seeds + Draw (no Main/Qualifying split); qualifying surfaces via the existing `Q` marker path.
- **Confirmed:** the worker's resolved-players map is `existingByFipId` (line ~220); Task 4 reuses it rather than re-querying.
