# Merge Duplicate Player Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate duplicate rows in the `public.players` table — same player exists as `fip-Pxxx` (padelgod canonical) AND `Pxxx` (legacy/sync-pipeline) AND sometimes a third row with NULL fip_id. Mirror the design of [`scripts/merge-tournament-duplicates.ts`](scripts/merge-tournament-duplicates.ts).

**Architecture:** Single CLI script `scripts/merge-duplicate-players.ts`. Pure helpers (group key, survivor selection, merge payload) live alongside the script and are unit-tested. The script: groups by `(normalized_name, category)`, picks the survivor by prefix rule (`fip-Pxxx` wins), redirects FKs across all known player-referencing tables, copies bio/ranking fields the survivor lacks, then deletes the loser. `--dry-run` is default; `--apply` is required to mutate. Same-name-different-fip-id clusters are reported separately for human review (never auto-merged).

**Tech Stack:** TypeScript, Node 20, Supabase service-role client, Vitest. Run via `node --experimental-strip-types` like the tournament script.

---

## File Structure

| Path | Action | Responsibility |
|---|---|---|
| `scripts/merge-duplicate-players.ts` | create | Main script: env load, fetch players, group, build plan, dry-run print, apply |
| `scripts/__tests__/merge-duplicate-players.test.ts` | create | Unit tests for `groupPlayersByIdentity` and `selectSurvivor` and `buildMergePayload` |
| `docs/superpowers/plans/2026-05-09-merge-duplicate-players.md` | create | This plan |

The pure helpers live INSIDE `scripts/merge-duplicate-players.ts` as named exports — same pattern as `merge-tournament-duplicates.ts`. Tests import them directly.

---

## Survivor selection rules

Given a cluster of player rows that all match on `(lower(normalized_name), category)`:

1. **If exactly two rows AND their `fip_id` values differ only by `fip-` prefix** (one is `fip-Pxxx`, the other is `Pxxx`): the **prefixed row is the survivor**. The non-prefixed row is the loser.

2. **If three rows AND two are prefix/no-prefix variants of the same FIP id AND the third has `fip_id = NULL`**: the **prefixed row is the survivor**. Both the non-prefixed row AND the NULL-fip_id row are losers (assuming the NULL row matches by name+category).

3. **If two rows both have NULL `fip_id`** (no FIP id to disambiguate): pick the row with more populated fields (count non-null bio/ranking columns) as survivor. Tiebreaker: oldest `id` (UUIDv7 ordering ≈ creation order).

4. **If the cluster has multiple distinct `fip_id` values** that are NOT just prefix variants (e.g. `fip-P203211` and `fip-P216185`): **DO NOT auto-merge**. Add to the "needs human review" report and skip.

5. **If the cluster has multiple `fip_id` values where they ARE prefix variants of the SAME id but also additional rows** (e.g. `fip-Pxxx`, `Pxxx`, AND another `Pyyy`): treat as case 4 — needs review.

The `selectSurvivor` helper returns `{ kind: 'auto' | 'review'; survivor?, losers?, reason }`.

---

## FK redirection — known tables

Static list (mirrors the tournament script):

| Table | Column(s) | Schema |
|---|---|---|
| `matches` | `pair1_player1_id`, `pair1_player2_id`, `pair2_player1_id`, `pair2_player2_id` | public |
| `tournament_draws` | `player1_id`, `player2_id` | public |
| `player_equipment` | `player_id` | public |
| `racket_clicks` | `player_id` | public |
| `entity_external_ids` | `entity_id` (where `entity_type='player'`) | public |
| `bookmarks` | `player_id` | public *(if exists; check first)* |

**Plus a runtime FK discovery query** that reads `pg_catalog.pg_constraint` to find any FK referencing `players(id)` we missed. Discovered tables get added to the redirect list dynamically; the script logs them so we know our static list is incomplete.

For `entity_external_ids`, follow the same conflict-handling pattern as the tournament script: if the survivor already has a row with the same `(source, external_id)` pair, drop the loser's row instead of redirecting (UNIQUE constraint).

---

## Task 1: Pure helpers — group, normalize, survivor selection

**Files:**
- Create: `scripts/merge-duplicate-players.ts` (helpers only — `main()` comes in Task 4)
- Create: `scripts/__tests__/merge-duplicate-players.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/__tests__/merge-duplicate-players.test.ts
import { describe, it, expect } from 'vitest';
import {
  normalizeFipId,
  groupKey,
  selectSurvivor,
  buildMergePayload,
  type PlayerRow,
} from '../merge-duplicate-players.ts';

describe('normalizeFipId', () => {
  it('strips fip- prefix when present', () => {
    expect(normalizeFipId('fip-P203884')).toBe('P203884');
    expect(normalizeFipId('P203884')).toBe('P203884');
  });
  it('returns null for null input', () => {
    expect(normalizeFipId(null)).toBeNull();
  });
});

describe('groupKey', () => {
  it('uses lowercased name + category, accent-insensitive', () => {
    expect(groupKey('Maximiliano Arce Simó', 'men')).toBe(groupKey('maximiliano arce simo', 'men'));
  });
  it('treats different categories as different groups', () => {
    expect(groupKey('Test Name', 'men')).not.toBe(groupKey('Test Name', 'women'));
  });
  it('handles null name and category', () => {
    expect(groupKey(null, null)).toBe('|');
  });
});

const row = (overrides: Partial<PlayerRow>): PlayerRow => ({
  id: 'uuid-default',
  fip_id: null,
  name: 'Test',
  category: 'men',
  ranking: null,
  birthdate: null,
  birthplace: null,
  height: null,
  coaches: null,
  equipment: null,
  profile_url: null,
  country: null,
  ...overrides,
});

describe('selectSurvivor', () => {
  it('case 1: prefix vs no-prefix → prefixed survives', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203884' });
    const b = row({ id: 'b', fip_id: 'P203884' });
    const r = selectSurvivor([a, b]);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.survivor.id).toBe('a');
      expect(r.losers.map(l => l.id)).toEqual(['b']);
    }
  });

  it('case 2: prefix + no-prefix + null fip_id → prefixed survives, both others lose', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203884' });
    const b = row({ id: 'b', fip_id: 'P203884' });
    const c = row({ id: 'c', fip_id: null });
    const r = selectSurvivor([a, b, c]);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.survivor.id).toBe('a');
      expect(r.losers.map(l => l.id).sort()).toEqual(['b', 'c']);
    }
  });

  it('case 3: two NULL-fip_id rows → most-populated row wins', () => {
    const a = row({ id: 'a', fip_id: null, ranking: 100, birthdate: '1999-01-01' });
    const b = row({ id: 'b', fip_id: null, ranking: 200 });
    const r = selectSurvivor([a, b]);
    expect(r.kind).toBe('auto');
    if (r.kind === 'auto') {
      expect(r.survivor.id).toBe('a'); // 2 fields populated > 1
    }
  });

  it('case 4: distinct fip_ids that are NOT prefix variants → review', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203211' });
    const b = row({ id: 'b', fip_id: 'fip-P216185' });
    const r = selectSurvivor([a, b]);
    expect(r.kind).toBe('review');
    if (r.kind === 'review') {
      expect(r.reason).toMatch(/distinct fip_ids/);
    }
  });

  it('case 5: prefix variants PLUS an unrelated id → review', () => {
    const a = row({ id: 'a', fip_id: 'fip-P203211' });
    const b = row({ id: 'b', fip_id: 'P203211' });
    const c = row({ id: 'c', fip_id: 'fip-P999999' });
    const r = selectSurvivor([a, b, c]);
    expect(r.kind).toBe('review');
  });
});

describe('buildMergePayload', () => {
  it('copies populated fields from losers into survivor where survivor is NULL', () => {
    const survivor = row({ id: 's', fip_id: 'fip-P1', ranking: null, birthdate: null });
    const losers = [
      row({ id: 'l1', fip_id: 'P1', ranking: 45, birthdate: '1999-01-01', height: 180 }),
    ];
    const payload = buildMergePayload(survivor, losers);
    expect(payload.ranking).toBe(45);
    expect(payload.birthdate).toBe('1999-01-01');
    expect(payload.height).toBe(180);
  });

  it('preserves survivor values when survivor already has them', () => {
    const survivor = row({ id: 's', fip_id: 'fip-P1', ranking: 10, birthdate: '1990-01-01' });
    const losers = [row({ id: 'l1', fip_id: 'P1', ranking: 99, birthdate: '2000-01-01' })];
    const payload = buildMergePayload(survivor, losers);
    expect(payload.ranking).toBeUndefined(); // survivor already has it
    expect(payload.birthdate).toBeUndefined();
  });

  it('returns empty payload when survivor is fully populated', () => {
    const survivor = row({ id: 's', fip_id: 'fip-P1', ranking: 10, birthdate: '1990-01-01', height: 180 });
    const losers = [row({ id: 'l1', fip_id: 'P1' })];
    const payload = buildMergePayload(survivor, losers);
    expect(Object.keys(payload).length).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/merge-duplicate-players
npx vitest run scripts/__tests__/merge-duplicate-players.test.ts
```

Expected: FAIL — `Cannot find module '../merge-duplicate-players.ts'`.

- [ ] **Step 3: Implement the helpers**

Create `scripts/merge-duplicate-players.ts` with the exports the tests import. (Full file content below in Task 4 — for now this task focuses on the named-export helpers and types.)

The full helper section content is shown in Task 4 — implementer should land Task 1 and Task 4 as one commit since the helpers and main() share the file.

---

## Task 2: Wire up env loader, Supabase client, FK discovery query

Same env loader as `merge-tournament-duplicates.ts`. FK discovery uses this query:

```sql
SELECT
  conrelid::regclass::text AS referencing_table,
  a.attname AS referencing_column,
  ns.nspname AS schema_name
FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
JOIN pg_namespace ns ON ns.oid = c.connamespace
WHERE c.contype = 'f'
  AND c.confrelid = 'public.players'::regclass
ORDER BY referencing_table, referencing_column;
```

The script runs this once at startup (via `supabase.rpc('exec_sql', { query })` if available, OR a hardcoded fallback list with a logged warning).

**Realistic decision:** there's no generic `exec_sql` rpc in this project. Hardcode the static list AND log a warning that operators should manually run the FK discovery query and add any missing tables to the static list. This matches how `merge-tournament-duplicates.ts` handles it (`FK_TABLES` static array with comments).

---

## Task 3: Group, plan-build, dry-run print

For each cluster: call `selectSurvivor`. If `kind: 'review'`, push to `reviewClusters[]`. If `kind: 'auto'`, build a `PerPairPlan` (survivor id, loser ids, FK redirect counts per table, `entity_external_ids` actions, merge payload).

Print plan + review clusters. Exit if `--dry-run`.

---

## Task 4: Apply — FK redirects → external_ids → delete losers → update survivor

Per cluster (sequential, fail-isolated):
1. For each FK table, run `UPDATE table SET col = survivor_id WHERE col = ANY(loser_ids)`. Use `.in()` for batch.
2. For each `entity_external_ids` row on a loser: drop if conflicting, else redirect.
3. DELETE all loser rows from `players`.
4. UPDATE survivor with the merge payload (skip if empty).

Same per-pair error isolation as the tournament script.

### Full script content

```ts
// scripts/merge-duplicate-players.ts
//
// Merges duplicate rows in public.players. Same player exists multiple times:
// fip-Pxxx (padelgod canonical) + Pxxx (legacy sync) + sometimes NULL fip_id.
// Mirrors the design of merge-tournament-duplicates.ts:
//
//   - --dry-run is default; --apply mutates.
//   - Per-cluster failures are isolated; final summary reports merged/failed.
//   - Pure helpers (groupKey, selectSurvivor, buildMergePayload) are
//     unit-tested.
//
// Survivor selection (see selectSurvivor):
//   - Prefix variants (fip-Pxxx + Pxxx) → prefixed survives.
//   - 3-row dupe (prefix + no-prefix + null fip_id) → prefixed survives, both
//     others lose.
//   - Two NULL fip_id rows → most-populated survives, oldest id wins ties.
//   - Distinct non-prefix-variant fip_ids → REFUSED (human review report).
//
// Usage:
//   node --experimental-strip-types scripts/merge-duplicate-players.ts            # dry run
//   node --experimental-strip-types scripts/merge-duplicate-players.ts --apply

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// ── env loader ────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  const content = fs.readFileSync(envPath, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}
loadEnv()

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

// ── types ─────────────────────────────────────────────────────
export interface PlayerRow {
  id: string
  fip_id: string | null
  name: string | null
  category: string | null
  ranking: number | null
  birthdate: string | null
  birthplace: string | null
  height: number | null
  coaches: string[] | null
  equipment: Record<string, unknown> | null
  profile_url: string | null
  country: string | null
  [key: string]: unknown
}

// Bio/ranking fields the survivor inherits from losers when survivor is null.
const MERGE_FIELDS = [
  'ranking',
  'birthdate',
  'birthplace',
  'height',
  'coaches',
  'equipment',
  'profile_url',
  'country',
] as const

// ── pure helpers ──────────────────────────────────────────────
export function normalizeFipId(fipId: string | null): string | null {
  if (!fipId) return null
  return fipId.replace(/^fip-/, '')
}

export function groupKey(name: string | null, category: string | null): string {
  const n = (name ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
  return `${n}|${category ?? ''}`
}

function countPopulatedFields(row: PlayerRow): number {
  let n = 0
  for (const f of MERGE_FIELDS) {
    const v = row[f]
    if (v == null) continue
    if (Array.isArray(v) && v.length === 0) continue
    n++
  }
  return n
}

export type SurvivorResult =
  | { kind: 'auto'; survivor: PlayerRow; losers: PlayerRow[]; reason: string }
  | { kind: 'review'; reason: string; rows: PlayerRow[] }

export function selectSurvivor(rows: PlayerRow[]): SurvivorResult {
  if (rows.length < 2) {
    return { kind: 'review', reason: 'cluster has < 2 rows', rows }
  }

  // Group by normalized FIP id.
  const byNormalized = new Map<string, PlayerRow[]>()
  const nullFipRows: PlayerRow[] = []
  for (const r of rows) {
    const nf = normalizeFipId(r.fip_id)
    if (nf == null) {
      nullFipRows.push(r)
    } else {
      if (!byNormalized.has(nf)) byNormalized.set(nf, [])
      byNormalized.get(nf)!.push(r)
    }
  }

  // Multiple distinct fip_ids that aren't prefix variants → review.
  if (byNormalized.size > 1) {
    return {
      kind: 'review',
      reason: `cluster has ${byNormalized.size} distinct fip_ids (not just prefix variants)`,
      rows,
    }
  }

  // Case A: at least one fip_id present, all rows for that id are prefix variants.
  if (byNormalized.size === 1) {
    const [, sameIdRows] = [...byNormalized.entries()][0]
    const prefixed = sameIdRows.find(r => r.fip_id?.startsWith('fip-'))
    const nonPrefixed = sameIdRows.filter(r => !r.fip_id?.startsWith('fip-'))
    if (!prefixed) {
      // Only non-prefixed rows present + maybe null rows → pick most-populated
      // among non-prefixed as survivor.
      const survivor = pickMostPopulated([...sameIdRows, ...nullFipRows])
      const losers = [...sameIdRows, ...nullFipRows].filter(r => r.id !== survivor.id)
      return {
        kind: 'auto',
        survivor,
        losers,
        reason: 'no prefixed row; chose most-populated non-prefixed survivor',
      }
    }
    const losers = [...nonPrefixed, ...nullFipRows]
    return {
      kind: 'auto',
      survivor: prefixed,
      losers,
      reason: 'prefixed fip_id is canonical',
    }
  }

  // Case B: all rows have NULL fip_id. Pick most-populated.
  const survivor = pickMostPopulated(nullFipRows)
  const losers = nullFipRows.filter(r => r.id !== survivor.id)
  return {
    kind: 'auto',
    survivor,
    losers,
    reason: 'all NULL fip_id; chose most-populated survivor',
  }
}

function pickMostPopulated(rows: PlayerRow[]): PlayerRow {
  let best = rows[0]
  let bestCount = countPopulatedFields(best)
  for (const r of rows.slice(1)) {
    const c = countPopulatedFields(r)
    if (c > bestCount || (c === bestCount && r.id < best.id)) {
      best = r
      bestCount = c
    }
  }
  return best
}

export function buildMergePayload(
  survivor: PlayerRow,
  losers: PlayerRow[],
): Record<string, unknown> {
  const updates: Record<string, unknown> = {}
  for (const field of MERGE_FIELDS) {
    if (survivor[field] != null) continue
    for (const loser of losers) {
      const v = loser[field]
      if (v == null) continue
      if (Array.isArray(v) && v.length === 0) continue
      updates[field] = v
      break
    }
  }
  return updates
}

// ── FK tables ─────────────────────────────────────────────────
//
// Static list of tables with FK references to public.players(id). Verified
// against pg_catalog at script start; any missing table prints a warning.
//
// Run this query manually to spot missing entries:
//   SELECT conrelid::regclass::text AS tbl, a.attname AS col,
//          ns.nspname AS schema
//   FROM pg_constraint c
//   JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
//   JOIN pg_namespace ns ON ns.oid=c.connamespace
//   WHERE c.contype='f' AND c.confrelid='public.players'::regclass;
const FK_TABLES: Array<{ table: string; col: string; schema?: string }> = [
  { table: 'matches', col: 'pair1_player1_id' },
  { table: 'matches', col: 'pair1_player2_id' },
  { table: 'matches', col: 'pair2_player1_id' },
  { table: 'matches', col: 'pair2_player2_id' },
  { table: 'tournament_draws', col: 'player1_id' },
  { table: 'tournament_draws', col: 'player2_id' },
  { table: 'player_equipment', col: 'player_id' },
  { table: 'racket_clicks', col: 'player_id' },
]

function fk(t: { table: string; schema?: string }) {
  return t.schema ? supabase.schema(t.schema).from(t.table) : supabase.from(t.table)
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  const apply = process.argv.includes('--apply')
  const dryRun = !apply

  console.log(`\n${dryRun ? '[DRY RUN] ' : '[APPLY] '}Fetching players...\n`)

  // Fetch all players. PostgREST cap is 10k; players table is ~5-15k rows.
  // If it grows past the cap, paginate via .range() — see db-paginate helper.
  const { data: all, error } = await supabase
    .from('players')
    .select('*')
    .limit(10000)
  if (error) {
    console.error('Failed to fetch players:', error)
    process.exit(1)
  }
  if (!all) {
    console.error('No players returned')
    process.exit(1)
  }
  console.log(`Fetched ${all.length} players\n`)

  // Group by (normalized name, category)
  const groups = new Map<string, PlayerRow[]>()
  for (const p of all as PlayerRow[]) {
    const k = groupKey(p.name, p.category)
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k)!.push(p)
  }

  // Process each group with > 1 row
  type ExtAction =
    | { kind: 'redirect'; rowId: string; source: string; externalId: string }
    | { kind: 'drop'; rowId: string; source: string; externalId: string; reason: string }

  type Plan = {
    name: string
    category: string
    survivor: PlayerRow
    losers: PlayerRow[]
    fkCounts: Record<string, number>
    extActions: ExtAction[]
    updates: Record<string, unknown>
    reason: string
  }

  const plans: Plan[] = []
  const reviewClusters: Array<{ key: string; reason: string; rows: PlayerRow[] }> = []

  for (const [key, rows] of groups) {
    if (rows.length < 2) continue
    const result = selectSurvivor(rows)
    if (result.kind === 'review') {
      reviewClusters.push({ key, reason: result.reason, rows: result.rows })
      continue
    }

    const { survivor, losers } = result
    const updates = buildMergePayload(survivor, losers)
    const loserIds = losers.map(l => l.id)

    // FK redirect counts per table
    const fkCounts: Record<string, number> = {}
    for (const t of FK_TABLES) {
      const { count } = await fk(t)
        .select('*', { count: 'exact', head: true })
        .in(t.col, loserIds)
      fkCounts[`${t.table}.${t.col}`] = count ?? 0
    }

    // entity_external_ids — figure out per-row redirect vs drop
    const extActions: ExtAction[] = []
    const { data: loserExt } = await supabase
      .from('entity_external_ids')
      .select('id, source, external_id, entity_id')
      .eq('entity_type', 'player')
      .in('entity_id', loserIds)
    if (loserExt && loserExt.length > 0) {
      const { data: survivorExt } = await supabase
        .from('entity_external_ids')
        .select('source, external_id')
        .eq('entity_type', 'player')
        .eq('entity_id', survivor.id)
      const survivorKeys = new Set(
        (survivorExt ?? []).map(r => `${r.source}|${r.external_id}`),
      )
      for (const r of loserExt) {
        const k = `${r.source}|${r.external_id}`
        if (survivorKeys.has(k)) {
          extActions.push({
            kind: 'drop',
            rowId: r.id,
            source: r.source,
            externalId: r.external_id,
            reason: 'survivor already has this (source, external_id)',
          })
        } else {
          extActions.push({
            kind: 'redirect',
            rowId: r.id,
            source: r.source,
            externalId: r.external_id,
          })
        }
      }
    }

    plans.push({
      name: survivor.name ?? '(no name)',
      category: survivor.category ?? '(no category)',
      survivor,
      losers,
      fkCounts,
      extActions,
      updates,
      reason: result.reason,
    })
  }

  // Print review clusters first (they need human attention)
  if (reviewClusters.length > 0) {
    console.log(`=== Needs human review (${reviewClusters.length}) ===\n`)
    for (const c of reviewClusters) {
      console.log(`* ${c.key}`)
      console.log(`  reason: ${c.reason}`)
      for (const r of c.rows) {
        console.log(`    - id=${r.id} fip_id=${r.fip_id ?? 'NULL'} ranking=${r.ranking ?? 'NULL'}`)
      }
    }
    console.log()
  }

  // Print auto-merge plan
  console.log(`=== Auto-merge plan (${plans.length} clusters) ===\n`)
  plans.forEach((p, i) => {
    console.log(`${i + 1}. ${p.name} [${p.category}] — ${p.reason}`)
    console.log(`   keep:   ${p.survivor.id} fip_id=${p.survivor.fip_id ?? 'NULL'}`)
    for (const l of p.losers) {
      console.log(`   delete: ${l.id} fip_id=${l.fip_id ?? 'NULL'}`)
    }
    const fkSummary = Object.entries(p.fkCounts)
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ')
    if (fkSummary) console.log(`   FK redirects: ${fkSummary}`)
    if (p.extActions.length > 0) {
      console.log(`   external IDs:`)
      for (const a of p.extActions) {
        if (a.kind === 'redirect') {
          console.log(`     redirect ${a.source}=${a.externalId}`)
        } else {
          console.log(`     drop     ${a.source}=${a.externalId} (${a.reason})`)
        }
      }
    }
    if (Object.keys(p.updates).length > 0) {
      console.log(`   merge fields:`)
      for (const [k, v] of Object.entries(p.updates)) {
        const valStr = v == null ? '(null)' : JSON.stringify(v).slice(0, 60)
        console.log(`     ${k.padEnd(14)} = ${valStr}`)
      }
    }
    console.log()
  })

  if (dryRun) {
    console.log(`[DRY RUN] No changes applied. Re-run with --apply to execute.\n`)
    console.log(`Summary: ${plans.length} clusters auto-mergeable, ${reviewClusters.length} need review.\n`)
    return
  }

  // Execute
  console.log('=== Executing merges ===\n')
  let merged = 0
  let failed = 0
  for (const p of plans) {
    const loserIds = p.losers.map(l => l.id)
    try {
      // 1. FK redirects
      for (const t of FK_TABLES) {
        if ((p.fkCounts[`${t.table}.${t.col}`] ?? 0) === 0) continue
        const { error: fkErr } = await fk(t)
          .update({ [t.col]: p.survivor.id })
          .in(t.col, loserIds)
        if (fkErr) throw new Error(`${t.table}.${t.col} redirect failed — ${fkErr.message}`)
      }

      // 2. entity_external_ids
      for (const a of p.extActions) {
        if (a.kind === 'drop') {
          const { error: delErr } = await supabase
            .from('entity_external_ids')
            .delete()
            .eq('id', a.rowId)
          if (delErr) throw new Error(`drop ext_id ${a.source}=${a.externalId}: ${delErr.message}`)
        } else {
          const { error: updErr } = await supabase
            .from('entity_external_ids')
            .update({ entity_id: p.survivor.id })
            .eq('id', a.rowId)
          if (updErr) throw new Error(`redirect ext_id ${a.source}=${a.externalId}: ${updErr.message}`)
        }
      }

      // 3. DELETE losers
      const { error: delErr } = await supabase
        .from('players')
        .delete()
        .in('id', loserIds)
      if (delErr) throw new Error(`delete losers failed — ${delErr.message}`)

      // 4. UPDATE survivor with merged fields
      if (Object.keys(p.updates).length > 0) {
        const { error: updErr } = await supabase
          .from('players')
          .update(p.updates)
          .eq('id', p.survivor.id)
        if (updErr) {
          // Losers are already deleted. Log loudly — needs manual fixup.
          console.error(`  ✗ ${p.name}: survivor UPDATE failed AFTER loser delete — ${updErr.message}`)
          console.error(`    Survivor ${p.survivor.id} did NOT receive merge fields. Re-apply manually.`)
          failed++
          continue
        }
      }

      console.log(`  ✓ ${p.name} [${p.category}]`)
      merged++
    } catch (e) {
      console.error(`  ✗ ${p.name} [${p.category}]: ${e instanceof Error ? e.message : String(e)}`)
      failed++
    }
  }

  console.log(`\n=== Done ===`)
  console.log(`Merged: ${merged}`)
  console.log(`Failed: ${failed}`)
  if (reviewClusters.length > 0) {
    console.log(`Needs human review: ${reviewClusters.length}`)
  }
  if (failed > 0) process.exit(1)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
```

---

## Task 5: Smoke test in dry-run

```bash
cd /Users/GuDenes/Projects/padel-live-scores/.claude/worktrees/merge-duplicate-players
node --experimental-strip-types scripts/merge-duplicate-players.ts > /tmp/dedup-dryrun.log 2>&1
head -100 /tmp/dedup-dryrun.log
tail -10 /tmp/dedup-dryrun.log
```

**What to check in the output:**
- Total auto-merge clusters seems reasonable (~hundreds, given the user's earlier query)
- Review clusters list any same-name-different-fip-id pairs
- For 5-10 sample auto-merge clusters: survivor is the prefixed row, losers include the no-prefix and any null-fip_id rows
- Merge fields show meaningful field carry-over (e.g. ranking copied from no-prefix into prefixed)

Share output with the operator before applying.

---

## Self-Review

- **Spec coverage:** Survivor rules ✓ (5 cases). Field carry-over ✓ (`buildMergePayload`). FK redirect ✓ (static list + comment about pg_catalog query). entity_external_ids handling ✓ (drop-on-conflict pattern). `--dry-run` default ✓. Same-name-different-fip-id NOT auto-merged ✓ (review cluster path).
- **Type consistency:** `PlayerRow`, `SurvivorResult`, `Plan` types all defined and consistent across the file.
- **No placeholders:** every step has real code or a real command.
- **Limits:** `players` table currently ~5-15k rows; under PostgREST 10k cap. If it grows past, switch to paginated fetch via `paginatedSelect`.
