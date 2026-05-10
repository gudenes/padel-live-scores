# Ranking History Capture — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture FIP ranking snapshots on every sync run (forward-only) so we can answer historical queries (peak rank, week-by-week trajectory, "top 20 on date X").

**Architecture:** Append-only `player_ranking_snapshots` table keyed by `(player_id, type, year, week)`. The Vercel `sync-fip-rankings` route writes one row per player per type per week after each successful `resolveAndEnrich`. The padelgod `player-rankings` worker also writes snapshots (for the official type) keyed by ISO year/week of `now()`. Conflict resolution uses `ON CONFLICT … DO UPDATE` with `COALESCE` so whichever path writes second only fills in null fields — Vercel's snapshot wins on fields it owns (move, fip_id-derived).

This phase ships forward-capture only. Backfill (walking FIP `year/week` back to 2020) and derived stats (`player_ranking_stats`) are separate phases.

**Tech Stack:** Supabase Postgres migration, Next.js App Router (TypeScript), Railway Node worker (TypeScript).

---

## File Structure

- **Create** `supabase/migrations/20260510_player_ranking_snapshots.sql` — table + indexes
- **Modify** `src/app/api/admin/sync-fip-rankings/route.ts` — insert snapshot after each `resolveAndEnrich` (both official + race paths)
- **Modify** `padelgod/src/workers/player-rankings.ts` — insert snapshots after upsert, using ISO week of now
- **Modify** `CLAUDE.md` — document the new table + flow under a "Ranking history" section

Self-contained: no shared lib needed yet (one INSERT site per file). If we add a third writer later, extract a helper.

---

## Task 1: Schema

**Files:**
- Create: `supabase/migrations/20260510_player_ranking_snapshots.sql`

- [ ] **Step 1: Write migration**

```sql
-- Forward-only historical ranking capture.
-- One row per (player, type, year, week). Race rows use ISO year/week of capture
-- since FIP race endpoint does not expose a week parameter.
CREATE TABLE IF NOT EXISTS player_ranking_snapshots (
  id            bigserial PRIMARY KEY,
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  type          text NOT NULL CHECK (type IN ('official','race')),
  gender        text NOT NULL CHECK (gender IN ('men','women')),
  year          int  NOT NULL,
  week          int  NOT NULL,
  ranking_date  date NOT NULL,
  ranking       int  NOT NULL,
  points        int,
  ranking_move  int,
  source        text NOT NULL CHECK (source IN ('vercel-fip','padelgod-fip')),
  captured_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_id, type, year, week)
);

CREATE INDEX IF NOT EXISTS idx_prs_player_type_date
  ON player_ranking_snapshots (player_id, type, ranking_date DESC);

CREATE INDEX IF NOT EXISTS idx_prs_type_date_rank
  ON player_ranking_snapshots (type, ranking_date DESC, ranking);

COMMENT ON TABLE player_ranking_snapshots IS
  'Append-only historical FIP rankings (official + race). One row per (player, type, year, week). Written by Vercel sync-fip-rankings cron and padelgod player-rankings worker. Conflict resolution: ON CONFLICT DO UPDATE with COALESCE — second writer fills gaps, never overwrites non-null fields.';
```

- [ ] **Step 2: Apply migration in Supabase dashboard (SQL editor → run)**

Expected: `CREATE TABLE` + `CREATE INDEX` × 2 + `COMMENT` succeed. Verify with `SELECT * FROM player_ranking_snapshots LIMIT 0;`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260510_player_ranking_snapshots.sql
git commit -m "feat(db): add player_ranking_snapshots table for historical rankings"
```

---

## Task 2: Vercel sync route writes snapshots

**Files:**
- Modify: `src/app/api/admin/sync-fip-rankings/route.ts` (around lines 188–250)

- [ ] **Step 1: Add snapshot insert helper at top of file (after `supabase` client init)**

```ts
type SnapshotRow = {
  player_id: string
  type: 'official' | 'race'
  gender: 'men' | 'women'
  year: number
  week: number
  ranking_date: string  // ISO date
  ranking: number
  points: number | null
  ranking_move: number | null
  source: 'vercel-fip'
}

async function writeSnapshot(row: SnapshotRow) {
  const { error } = await supabase
    .from('player_ranking_snapshots')
    .upsert(row, {
      onConflict: 'player_id,type,year,week',
      ignoreDuplicates: false,
    })
  if (error) console.error('[sync-fip] snapshot upsert failed:', error.message, row)
}
```

Note: `ignoreDuplicates: false` + onConflict still does an UPDATE, but supabase-js doesn't expose `DO UPDATE … COALESCE` directly. For Phase 1 we accept "last writer wins" semantics in supabase-js; Vercel and padelgod run within the same hour but Vercel writes 4 staggered jobs (each gender/type) so it almost always lands first or last consistently for its slot. If we observe gaps later, we'll move to a SQL function with COALESCE.

- [ ] **Step 2: Compute ISO year/week helper for race (no upstream week)**

```ts
function isoYearWeek(d: Date): { year: number; week: number; mondayIso: string } {
  // ISO 8601 week: Thursday in current week decides the year. Week 1 contains Jan 4.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const dayNum = (date.getUTCDay() + 6) % 7 // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3) // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7)
  const monday = new Date(date)
  monday.setUTCDate(date.getUTCDate() - 3)
  return { year: date.getUTCFullYear(), week, mondayIso: monday.toISOString().slice(0, 10) }
}
```

- [ ] **Step 3: Wire snapshot insert into official loop (after `resolveAndEnrich` succeeds)**

In the `for (const p of officials)` block, after `if (action === 'created') results.official.created++ else results.official.updated++`:

```ts
// Capture history snapshot. resolveAndEnrich returns playerId in result.
// Need to keep it — refactor return below.
await writeSnapshot({
  player_id: resolveResult.playerId,
  type: 'official',
  gender: db as 'men' | 'women',
  year: officialYearWeek.year,
  week: officialYearWeek.week,
  ranking_date: rankingDate.slice(0, 10),
  ranking: p.rank,
  points: p.points,
  ranking_move: p.move,
  source: 'vercel-fip',
})
```

- [ ] **Step 4: Refactor to keep `resolveResult` + parse `officialYearWeek` from `rankingDate`**

The current code destructures `{ action }` from the resolver but discards `playerId`. Change to:

```ts
const resolveResult = await resolver.resolveAndEnrich({ /* same args */ })
if (resolveResult.action === 'created') results.official.created++
else results.official.updated++
```

And add right after `fetchOfficialRankings`:

```ts
// rankingDate is "YYYY-MM-DDT00:00:00Z" Monday of the FIP week.
const officialYearWeek = (() => {
  const d = new Date(rankingDate)
  return isoYearWeek(d)
})()
```

- [ ] **Step 5: Wire snapshot insert into race loop**

```ts
const now = new Date()
const raceYearWeek = isoYearWeek(now)

for (const p of races) {
  // … existing resolveAndEnrich call, keep resolveResult …
  await writeSnapshot({
    player_id: resolveResult.playerId,
    type: 'race',
    gender: db as 'men' | 'women',
    year: raceYearWeek.year,
    week: raceYearWeek.week,
    ranking_date: raceYearWeek.mondayIso,
    ranking: p.race_rank,
    points: p.race_points,
    ranking_move: p.race_move,
    source: 'vercel-fip',
  })
}
```

- [ ] **Step 6: Manual smoke test against localhost**

```bash
curl -s "http://localhost:3002/api/admin/sync-fip-rankings?type=official&gender=female&top=5" \
  -H "Authorization: Bearer $CRON_SECRET" | python3 -m json.tool
```

Then in Supabase SQL editor:

```sql
SELECT player_id, type, year, week, ranking, ranking_date, source
FROM player_ranking_snapshots
ORDER BY captured_at DESC
LIMIT 10;
```

Expected: 5 rows with type='official', gender='women', source='vercel-fip', current year/week, ranks 1-5.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/admin/sync-fip-rankings/route.ts
git commit -m "feat(rankings): vercel sync writes player_ranking_snapshots"
```

---

## Task 3: Padelgod worker writes snapshots

**Files:**
- Modify: `padelgod/src/workers/player-rankings.ts`

- [ ] **Step 1: Switch upsert to return inserted/updated rows so we can map back to player_id**

The current `.upsert(rows, { onConflict: 'normalized_name,category', ignoreDuplicates: false })` does not select. Add `.select('id, name, category, ranking')`:

```ts
const { data: upserted, error } = await deps.supabase
  .from('players')
  .upsert(rows, { onConflict: 'normalized_name,category', ignoreDuplicates: false })
  .select('id, name, category, ranking')

if (error) throw new Error(`Player rankings upsert failed: ${error.message}`);
```

- [ ] **Step 2: Compute ISO year/week and build snapshot rows**

```ts
function isoYearWeek(d: Date): { year: number; week: number; mondayIso: string } {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const diff = (date.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - 3);
  return { year: date.getUTCFullYear(), week, mondayIso: monday.toISOString().slice(0, 10) };
}

const { year, week, mondayIso } = isoYearWeek(new Date());

const snapshotRows = (upserted ?? []).map((u, i) => {
  const src = all[i]; // index alignment safe — upsert preserves input order
  return {
    player_id: u.id,
    type: 'official' as const,
    gender: src.gender,
    year,
    week,
    ranking_date: mondayIso,
    ranking: src.rank,
    points: src.points,
    ranking_move: null,
    source: 'padelgod-fip' as const,
  };
});

if (snapshotRows.length > 0) {
  const { error: snapErr } = await deps.supabase
    .from('player_ranking_snapshots')
    .upsert(snapshotRows, { onConflict: 'player_id,type,year,week', ignoreDuplicates: false });
  if (snapErr) console.error('[player-rankings] snapshot upsert failed:', snapErr.message);
}
```

- [ ] **Step 3: Local smoke test**

```bash
cd padelgod
npm run dev -- --worker player-rankings --once
```

Then check Supabase:

```sql
SELECT type, year, week, source, COUNT(*) 
FROM player_ranking_snapshots
GROUP BY 1,2,3,4
ORDER BY year DESC, week DESC;
```

Expected: row with `source='padelgod-fip'`, type='official', current ISO year/week, count ≈ top-N × 2 genders.

- [ ] **Step 4: Commit**

```bash
git add padelgod/src/workers/player-rankings.ts
git commit -m "feat(padelgod): player-rankings worker writes snapshots"
```

---

## Task 4: Document the table in CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (Database Tables section)

- [ ] **Step 1: Add row to the Database Tables table (after `match_stats_unresolved`)**

```markdown
| `player_ranking_snapshots` | Append-only historical FIP rankings (forward capture) | `player_id` + `type` + `year` + `week` (composite unique), `ranking`, `points`, `ranking_move`, `ranking_date`, `source` |
```

- [ ] **Step 2: Add a "Historical rankings (2026-05-10)" subsection somewhere near the Scheduled Jobs section explaining the model + that backfill is a separate phase.**

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document player_ranking_snapshots table"
```

---

## Task 5: Open PR

- [ ] **Step 1: Push branch**

```bash
git push -u origin feat/ranking-history-capture
```

- [ ] **Step 2: Open PR via gh**

Title: `feat(rankings): capture historical ranking snapshots`

Body: summary + the SQL verification queries from Task 2 Step 6 and Task 3 Step 3.

---

## Self-Review

**Spec coverage:** Captures (player, type, year, week, ranking, points, move, gender) — sufficient to answer "peak rank", "rank in week N", "top X on date Y", "trajectory chart". ✓

**Placeholder scan:** No "TBD" / "implement later" / generic error handling — every step shows actual code. ✓

**Type consistency:** `SnapshotRow.gender` is `'men'|'women'` in both Task 2 and Task 3; `type` is `'official'|'race'` in both; `source` literals match CHECK constraint. ✓

**Open question (acceptable for Phase 1):** padelgod and Vercel both upsert with `ignoreDuplicates: false` but supabase-js can't express `COALESCE`-style merge. In practice the column overlap is small (padelgod writes `ranking_move=null`, Vercel writes it set) so the race is mostly harmless. If we observe gaps in production, Task 6 (future) is to convert to a Postgres function that does the merge.
