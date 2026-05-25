# Entry-List Unresolved Partners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop silently dropping entry-list partners that the padelgod fetcher can't resolve. Surface them in the ops UI with a MISSING flag and a one-click way to link to an existing player or create a new one. Also extend the fetcher's resolver to use aliases + subset/typo-tolerant fuzzy matching so the next snapshot catches them automatically.

**Architecture:** Two-layer fix.
  - **Resolver layer** (`padelgod/`): add a new `db-resolver.ts` that mirrors the alias + subset fuzzy logic from `src/lib/player-resolver.ts` but stays read-only (no auto-create). Plug it into the entry-list fetcher *before* the FIP-search HTTP fallback. Aliases auto-populate on successful fuzzy match so repeat snapshots are O(1).
  - **Ops UI layer** (`src/app/`): the `padelgod-entry-list` API synthesizes a "ghost" `EntryPlayer` from the surviving teammate's `partner_name` when no resolved partner row exists. The tab renders it with a red MISSING chip that opens a modal. The modal lets the operator either (a) search and link to an existing player (stores an alias) or (b) create a new player row from the parsed name/country/category (also stores an alias). Both flows tell the operator to re-seed.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase REST, Vitest, padelgod TS Node worker on Railway.

**Live verification target:** FIP PLATINUM ALBANIA, men's draw. Tournament UUID `8a47598a-579b-4503-88c2-135306d274fb`, FIP slug `fip-platinum-albania-2026`. After the fix, the four currently-invisible drops (`Alejandro Ruiz Granados`, `Martin Muedini`, `Fjoralb Curri`, `Vladimir Progni`) must appear in the ops UI with MISSING chips; the resolver re-run must rescue `Alejandro Ruiz Granados` by aliasing to existing `Alejandro Ruiz` (P000012).

---

## File Map

**NEW files**
- `padelgod/src/lib/db-resolver.ts` — alias-aware lookup library (read-only)
- `padelgod/src/__tests__/lib/db-resolver.test.ts` — unit tests
- `src/app/api/ops/player-aliases/route.ts` — POST endpoint to upsert alias
- `src/app/api/ops/player-aliases/__tests__/route.test.ts` — auth + happy-path test
- `src/app/ops/UnresolvedPartnerModal.tsx` — link/create modal component

**MODIFIED files**
- `padelgod/src/workers/entry-list-fetcher.ts` — call `db-resolver` instead of inline `resolveFromDb`
- `padelgod/src/__tests__/workers/entry-list-fetcher.test.ts` — cover the alias-rescue path
- `src/app/api/ops/padelgod-entry-list/route.ts` — synthesize ghost player2 from `partner_name`
- `src/app/api/ops/padelgod-entry-list/__tests__/route.test.ts` (create if absent) — ghost-synthesis behavior
- `src/app/api/ops/players/route.ts` — add `POST` handler for ops player creation
- `src/app/ops/PadelgodEntryListTab.tsx` — render ghost partner row + open modal

---

## Task 1: Add the read-only `db-resolver` library skeleton

**Files**
- Create: `padelgod/src/lib/db-resolver.ts`
- Test: `padelgod/src/__tests__/lib/db-resolver.test.ts`

- [ ] **Step 1: Write the failing test for `normalizeName`**

Create `padelgod/src/__tests__/lib/db-resolver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { normalizeName } from '../../lib/db-resolver.js';

describe('normalizeName', () => {
  it('lowercases, strips accents, collapses punctuation', () => {
    expect(normalizeName('Álvaro Mélendez Amaya')).toBe('alvaro melendez amaya');
    expect(normalizeName('Aimar Goñi-Lacabe')).toBe('aimar goni lacabe');
    expect(normalizeName('  Multi   spaces  ')).toBe('multi spaces');
  });
});
```

- [ ] **Step 2: Run test, verify it fails on missing module**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/db-resolver.js'`.

- [ ] **Step 3: Create `padelgod/src/lib/db-resolver.ts` with just `normalizeName`**

```ts
// padelgod/src/lib/db-resolver.ts
//
// Read-only player-lookup library used by the entry-list-fetcher (and any
// future padelgod worker that needs to resolve a parsed player name to a
// canonical fip_id). Mirrors the lookup chain of src/lib/player-resolver.ts
// in the main repo, minus the create-on-miss path — workers should never
// silently mint player rows from PDF data.
//
// Chain (first hit wins):
//   1. exact fip_id (handled by the caller, since fip_ids land via padelapi
//      or FIP-search, not via name parsing)
//   2. ALIAS: entity_external_ids row with source='alias' whose normalized
//      external_id matches the parsed name
//   3. exact normalized-name match in public.players (category-scoped,
//      country-narrowed, ranking-disambiguated)
//   4. SUBSET fuzzy: every token of the shorter side appears in the longer
//      side (catches "Alejandro Ruiz Granados" → "Alejandro Ruiz")
//   5. TYPO-tolerant fuzzy: ≥0.9 token overlap with 1-char edit tolerance on
//      tokens ≥4 chars (catches "Giannina"/"Gianina" class)
//
// Aliases are auto-stored on successful fuzzy match so subsequent snapshots
// hit step 2 instantly.

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
```

- [ ] **Step 4: Run test, verify it passes**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/db-resolver.ts padelgod/src/__tests__/lib/db-resolver.test.ts
git commit -m "feat(padelgod): scaffold db-resolver with normalizeName"
```

---

## Task 2: Add `subsetSimilarity` and `typoTolerantSimilarity`

**Files**
- Modify: `padelgod/src/lib/db-resolver.ts`
- Modify: `padelgod/src/__tests__/lib/db-resolver.test.ts`

- [ ] **Step 1: Write failing tests for both similarity functions**

Append to `padelgod/src/__tests__/lib/db-resolver.test.ts`:

```ts
import { subsetSimilarity, typoTolerantSimilarity } from '../../lib/db-resolver.js';

describe('subsetSimilarity', () => {
  it('returns 1.0 when shorter is a subset of longer', () => {
    // The Alejandro Ruiz Granados → Alejandro Ruiz case
    expect(subsetSimilarity('Alejandro Ruiz Granados', 'Alejandro Ruiz')).toBe(1);
    expect(subsetSimilarity('David Gala', 'David Gala Sanchez')).toBe(1);
  });
  it('returns <1 when tokens partially overlap', () => {
    // 1 of 2 short-side tokens overlap → 0.5
    expect(subsetSimilarity('Pol Hernandez', 'Pedro Hernandez')).toBe(0.5);
  });
  it('returns 0 when no overlap', () => {
    expect(subsetSimilarity('Franco Stupaczuk', 'Juan Lebron')).toBe(0);
  });
});

describe('typoTolerantSimilarity', () => {
  it('tolerates 1-char edit on tokens ≥4 chars', () => {
    // "Giannina" → "Gianina" (Levenshtein 1, both ≥4 chars)
    expect(typoTolerantSimilarity('Giannina Lopez', 'Gianina Lopez')).toBe(1);
  });
  it('does NOT tolerate edits on short tokens (avoid initials false-positives)', () => {
    // "Jon" vs "Joe" differ by 1 char but both length-3 — must NOT match
    expect(typoTolerantSimilarity('Jon Sanz', 'Joe Sanz')).toBe(0.5); // only Sanz matches
  });
});
```

- [ ] **Step 2: Run tests, verify they fail with "not exported"**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: FAIL — both new describe blocks error on import.

- [ ] **Step 3: Implement both functions in `db-resolver.ts`**

Append to `padelgod/src/lib/db-resolver.ts`:

```ts
function tokens(name: string): string[] {
  return normalizeName(name)
    .split(' ')
    .filter((t) => t.length > 1);
}

/** Levenshtein distance (two-row DP). */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n]!;
}

/**
 * Fraction of shorter-side tokens that appear in the longer side.
 * Returns 1.0 when the shorter name is wholly a subset of the longer name.
 * Use to catch PDF-full-name ↔ DB-short-name pairs.
 */
export function subsetSimilarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return overlap / Math.min(ta.size, tb.size);
}

/**
 * Like subsetSimilarity but tolerates 1-char edit-distance on tokens ≥4 chars
 * on BOTH sides. Catches transliteration differences ("Giannina"/"Gianina").
 * Short tokens (initials, "de"/"la") stay strict to avoid false positives.
 */
export function typoTolerantSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const used = new Array<boolean>(tb.length).fill(false);
  let overlap = 0;
  for (const t of ta) {
    for (let i = 0; i < tb.length; i++) {
      if (used[i]) continue;
      const u = tb[i]!;
      if (t === u) {
        overlap++;
        used[i] = true;
        break;
      }
      if (t.length >= 4 && u.length >= 4 && editDistance(t, u) <= 1) {
        overlap++;
        used[i] = true;
        break;
      }
    }
  }
  return overlap / Math.min(ta.length, tb.length);
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/db-resolver.ts padelgod/src/__tests__/lib/db-resolver.test.ts
git commit -m "feat(padelgod): add subset + typo-tolerant similarity to db-resolver"
```

---

## Task 3: Index loaders — `loadDbPlayerIndex` and `loadAliasIndex`

**Files**
- Modify: `padelgod/src/lib/db-resolver.ts`
- Modify: `padelgod/src/__tests__/lib/db-resolver.test.ts`

- [ ] **Step 1: Write failing tests for both loaders**

Append to `padelgod/src/__tests__/lib/db-resolver.test.ts`:

```ts
import { loadDbPlayerIndex, loadAliasIndex } from '../../lib/db-resolver.js';

function fakeSupabase(playerRows: any[], aliasRows: any[]) {
  return {
    from: (table: string) => {
      if (table === 'players') {
        return {
          select: () => ({
            eq: () => ({
              then: (res: any) => Promise.resolve({ data: playerRows, error: null }).then(res),
            }),
          }),
        };
      }
      if (table === 'entity_external_ids') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                then: (res: any) => Promise.resolve({ data: aliasRows, error: null }).then(res),
              }),
            }),
          }),
        };
      }
      throw new Error('unexpected table: ' + table);
    },
  } as any;
}

describe('loadDbPlayerIndex', () => {
  it('keys by normalized name, groups duplicates', async () => {
    const supabase = fakeSupabase(
      [
        { id: 'u1', fip_id: 'P1', name: 'Juan Garcia', normalized_name: 'juan garcia', country: 'ES', ranking: 50, category: 'men' },
        { id: 'u2', fip_id: 'P2', name: 'Juan Garcia', normalized_name: 'juan garcia', country: 'AR', ranking: 200, category: 'men' },
        { id: 'u3', fip_id: 'P3', name: 'Alejandro Ruiz', normalized_name: 'alejandro ruiz', country: 'ES', ranking: 23, category: 'men' },
      ],
      []
    );
    const idx = await loadDbPlayerIndex(supabase, 'men');
    expect(idx.get('juan garcia')?.length).toBe(2);
    expect(idx.get('alejandro ruiz')?.length).toBe(1);
  });
});

describe('loadAliasIndex', () => {
  it('returns normalized-alias → playerId map for player aliases only', async () => {
    const supabase = fakeSupabase(
      [],
      [
        { entity_id: 'u-ruiz', external_id: 'Alejandro Ruiz Granados', metadata: null },
        { entity_id: 'u-gala', external_id: 'David Gala Sanchez', metadata: null },
      ]
    );
    const idx = await loadAliasIndex(supabase);
    expect(idx.get('alejandro ruiz granados')).toBe('u-ruiz');
    expect(idx.get('david gala sanchez')).toBe('u-gala');
    expect(idx.size).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: FAIL — `loadDbPlayerIndex`/`loadAliasIndex` not exported.

- [ ] **Step 3: Implement both loaders**

Append to `padelgod/src/lib/db-resolver.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';

export interface DbPlayerRow {
  id: string;
  fip_id: string | null;
  name: string;
  normalized_name: string | null;
  country: string | null;
  ranking: number | null;
  category: 'men' | 'women' | null;
}

export type DbPlayerIndex = Map<string, DbPlayerRow[]>;
export type AliasIndex = Map<string, string>; // normalized alias → player UUID

/**
 * Build a category-scoped index keyed on normalized name. Multiple players
 * can share a normalized name; we keep them all and let the resolver narrow
 * by country + ranking.
 */
export async function loadDbPlayerIndex(
  supabase: SupabaseClient,
  category: 'men' | 'women'
): Promise<DbPlayerIndex> {
  const { data, error } = await supabase
    .from('players')
    .select('id, fip_id, name, normalized_name, country, ranking, category')
    .eq('category', category);
  if (error) {
    throw new Error(`players read failed for ${category}: ${error.message}`);
  }
  const map: DbPlayerIndex = new Map();
  for (const r of (data ?? []) as DbPlayerRow[]) {
    const key = r.normalized_name ?? normalizeName(r.name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(r);
  }
  return map;
}

/**
 * Load all player aliases from entity_external_ids. Returns a Map keyed on
 * the normalized alias text. Aliases are auto-stored by past fuzzy matches
 * (see storeAlias) so this index grows monotonically over time.
 */
export async function loadAliasIndex(supabase: SupabaseClient): Promise<AliasIndex> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id, metadata')
    .eq('entity_type', 'player')
    .eq('source', 'alias');
  if (error) {
    throw new Error(`alias read failed: ${error.message}`);
  }
  const map: AliasIndex = new Map();
  for (const r of (data ?? []) as Array<{
    entity_id: string;
    external_id: string;
    metadata: { normalized?: string } | null;
  }>) {
    const norm = r.metadata?.normalized ?? normalizeName(r.external_id);
    if (!norm) continue;
    map.set(norm, r.entity_id);
  }
  return map;
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: PASS (6 tests total now).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/db-resolver.ts padelgod/src/__tests__/lib/db-resolver.test.ts
git commit -m "feat(padelgod): add loadDbPlayerIndex + loadAliasIndex to db-resolver"
```

---

## Task 4: The resolver itself — `resolvePlayerByName` (alias → exact → subset → typo)

**Files**
- Modify: `padelgod/src/lib/db-resolver.ts`
- Modify: `padelgod/src/__tests__/lib/db-resolver.test.ts`

- [ ] **Step 1: Write failing tests for the resolution chain**

Append to `padelgod/src/__tests__/lib/db-resolver.test.ts`:

```ts
import { resolvePlayerByName } from '../../lib/db-resolver.js';

function buildIndexes(
  players: Array<{ id: string; fip_id: string | null; name: string; country?: string; ranking?: number }>,
  aliases: Array<{ playerId: string; alias: string }> = []
) {
  const dbIndex: DbPlayerIndex = new Map();
  for (const p of players) {
    const row: DbPlayerRow = {
      id: p.id,
      fip_id: p.fip_id,
      name: p.name,
      normalized_name: normalizeName(p.name),
      country: p.country ?? null,
      ranking: p.ranking ?? null,
      category: 'men',
    };
    const key = row.normalized_name!;
    if (!dbIndex.has(key)) dbIndex.set(key, []);
    dbIndex.get(key)!.push(row);
  }
  const aliasIndex: AliasIndex = new Map();
  for (const a of aliases) {
    aliasIndex.set(normalizeName(a.alias), a.playerId);
  }
  return { dbIndex, aliasIndex };
}

describe('resolvePlayerByName', () => {
  it('hits alias index first when present', () => {
    const { dbIndex, aliasIndex } = buildIndexes(
      [{ id: 'u-ruiz', fip_id: 'P000012', name: 'Alejandro Ruiz', country: 'ES', ranking: 23 }],
      [{ playerId: 'u-ruiz', alias: 'Alejandro Ruiz Granados' }]
    );
    const r = resolvePlayerByName(
      { name: 'Alejandro Ruiz Granados', country: 'ES', ranking: 22 },
      dbIndex,
      aliasIndex
    );
    expect(r).toEqual({ playerId: 'u-ruiz', fipId: 'P000012', matchType: 'alias' });
  });

  it('falls through to exact normalized match', () => {
    const { dbIndex, aliasIndex } = buildIndexes([
      { id: 'u1', fip_id: 'P1', name: 'Juan Lebron', country: 'ES', ranking: 1 },
    ]);
    const r = resolvePlayerByName({ name: 'Juan Lebron', country: 'ES', ranking: 1 }, dbIndex, aliasIndex);
    expect(r?.matchType).toBe('exact');
  });

  it('falls through to subset fuzzy for full-vs-short-name pairs', () => {
    const { dbIndex, aliasIndex } = buildIndexes([
      { id: 'u-ruiz', fip_id: 'P000012', name: 'Alejandro Ruiz', country: 'ES', ranking: 23 },
    ]);
    const r = resolvePlayerByName(
      { name: 'Alejandro Ruiz Granados', country: 'ES', ranking: 22 },
      dbIndex,
      aliasIndex
    );
    expect(r).toEqual({ playerId: 'u-ruiz', fipId: 'P000012', matchType: 'subset' });
  });

  it('blocks subset match when country disagrees', () => {
    const { dbIndex, aliasIndex } = buildIndexes([
      { id: 'u-ruiz', fip_id: 'P000012', name: 'Alejandro Ruiz', country: 'AR', ranking: 23 },
    ]);
    const r = resolvePlayerByName(
      { name: 'Alejandro Ruiz Granados', country: 'ES', ranking: 22 },
      dbIndex,
      aliasIndex
    );
    expect(r).toBeNull();
  });

  it('returns null when no candidate matches', () => {
    const { dbIndex, aliasIndex } = buildIndexes([]);
    const r = resolvePlayerByName(
      { name: 'Martin Muedini', country: 'AL', ranking: 0 },
      dbIndex,
      aliasIndex
    );
    expect(r).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: FAIL — `resolvePlayerByName` not exported.

- [ ] **Step 3: Implement the resolver**

Append to `padelgod/src/lib/db-resolver.ts`:

```ts
import { normalizeCountry } from './country.js';

export interface ResolveInput {
  name: string;
  country: string | null;
  ranking: number;
}

export interface ResolveHit {
  playerId: string;
  fipId: string | null;
  matchType: 'alias' | 'exact' | 'subset' | 'typo';
}

const SUBSET_THRESHOLD = 1.0; // every shorter-side token must appear in longer
const TYPO_THRESHOLD = 0.9;

/**
 * Resolve a parsed PDF entry against pre-loaded indexes.
 * Chain: alias → exact normalized → subset fuzzy (country-narrowed) → typo
 *        fuzzy (country-narrowed). Returns null when no confident match.
 *
 * Country comparison is via normalizeCountry so 3-letter FIP codes (ESP)
 * compare equal to the 2-letter ISO codes (ES) we store in public.players.
 */
export function resolvePlayerByName(
  input: ResolveInput,
  dbIndex: DbPlayerIndex,
  aliasIndex: AliasIndex
): ResolveHit | null {
  const norm = normalizeName(input.name);
  if (!norm) return null;

  // 1. Alias hit
  const aliasPlayerId = aliasIndex.get(norm);
  if (aliasPlayerId) {
    // Look up the player row to surface fip_id alongside the UUID.
    for (const rows of dbIndex.values()) {
      for (const r of rows) {
        if (r.id === aliasPlayerId) {
          return { playerId: r.id, fipId: r.fip_id, matchType: 'alias' };
        }
      }
    }
    // Alias points to a player not in this category's index — treat as miss
    // (probably wrong category; refuse to cross gender boundaries).
  }

  // 2. Exact normalized name
  const exactCandidates = dbIndex.get(norm);
  if (exactCandidates && exactCandidates.length > 0) {
    const pick = pickByCountryAndRanking(exactCandidates, input);
    if (pick) return { playerId: pick.id, fipId: pick.fip_id, matchType: 'exact' };
  }

  // 3. Subset fuzzy — every shorter-side token appears in the longer side
  const wantCountry = normalizeCountry(input.country);
  let bestSubset: { row: DbPlayerRow; score: number } | null = null;
  for (const candidates of dbIndex.values()) {
    for (const c of candidates) {
      if (wantCountry && c.country && normalizeCountry(c.country) !== wantCountry) continue;
      const score = subsetSimilarity(input.name, c.name);
      if (score >= SUBSET_THRESHOLD && (!bestSubset || score > bestSubset.score)) {
        bestSubset = { row: c, score };
      }
    }
  }
  if (bestSubset) {
    return { playerId: bestSubset.row.id, fipId: bestSubset.row.fip_id, matchType: 'subset' };
  }

  // 4. Typo-tolerant fuzzy — same country gate, ≥0.9 threshold
  let bestTypo: { row: DbPlayerRow; score: number } | null = null;
  for (const candidates of dbIndex.values()) {
    for (const c of candidates) {
      if (wantCountry && c.country && normalizeCountry(c.country) !== wantCountry) continue;
      const score = typoTolerantSimilarity(input.name, c.name);
      if (score >= TYPO_THRESHOLD && (!bestTypo || score > bestTypo.score)) {
        bestTypo = { row: c, score };
      }
    }
  }
  if (bestTypo) {
    return { playerId: bestTypo.row.id, fipId: bestTypo.row.fip_id, matchType: 'typo' };
  }

  return null;
}

function pickByCountryAndRanking(
  candidates: DbPlayerRow[],
  input: ResolveInput
): DbPlayerRow | null {
  if (candidates.length === 1) return candidates[0]!;
  const wantCountry = normalizeCountry(input.country);
  const sameCountry = wantCountry
    ? candidates.filter((c) => normalizeCountry(c.country) === wantCountry)
    : candidates;
  if (sameCountry.length === 1) return sameCountry[0]!;
  if (sameCountry.length === 0) return null;
  if (input.ranking > 0) {
    let best = sameCountry[0]!;
    let bestDist = Math.abs((best.ranking ?? Number.MAX_SAFE_INTEGER) - input.ranking);
    for (let i = 1; i < sameCountry.length; i++) {
      const c = sameCountry[i]!;
      const d = Math.abs((c.ranking ?? Number.MAX_SAFE_INTEGER) - input.ranking);
      if (d < bestDist) {
        best = c;
        bestDist = d;
      }
    }
    return best;
  }
  return null;
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/db-resolver.ts padelgod/src/__tests__/lib/db-resolver.test.ts
git commit -m "feat(padelgod): add resolvePlayerByName with alias + subset + typo chain"
```

---

## Task 5: `storeAlias` — write back to entity_external_ids on fuzzy hit

**Files**
- Modify: `padelgod/src/lib/db-resolver.ts`
- Modify: `padelgod/src/__tests__/lib/db-resolver.test.ts`

- [ ] **Step 1: Write failing test**

Append to `padelgod/src/__tests__/lib/db-resolver.test.ts`:

```ts
import { storeAlias } from '../../lib/db-resolver.js';

describe('storeAlias', () => {
  it('upserts an alias row with metadata.normalized', async () => {
    const upserts: any[] = [];
    const supabase = {
      from: (table: string) => {
        expect(table).toBe('entity_external_ids');
        return {
          upsert: (row: any, opts: any) => {
            upserts.push({ row, opts });
            return Promise.resolve({ error: null });
          },
        };
      },
    } as any;
    await storeAlias(supabase, 'u-ruiz', 'Alejandro Ruiz Granados');
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row.entity_type).toBe('player');
    expect(upserts[0].row.entity_id).toBe('u-ruiz');
    expect(upserts[0].row.source).toBe('alias');
    expect(upserts[0].row.external_id).toBe('Alejandro Ruiz Granados');
    expect(upserts[0].row.metadata).toEqual({ normalized: 'alejandro ruiz granados' });
    expect(upserts[0].opts.onConflict).toBe('source,entity_type,external_id');
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: FAIL — `storeAlias` not exported.

- [ ] **Step 3: Implement `storeAlias`**

Append to `padelgod/src/lib/db-resolver.ts`:

```ts
/**
 * Persist a fuzzy-match success as an alias for future O(1) lookup.
 * Idempotent: relies on the entity_external_ids unique index
 * (source, entity_type, external_id).
 * Non-throwing: alias storage is non-critical and must not break resolution.
 */
export async function storeAlias(
  supabase: SupabaseClient,
  playerId: string,
  rawName: string
): Promise<void> {
  const norm = normalizeName(rawName);
  if (!norm) return;
  try {
    await supabase.from('entity_external_ids').upsert(
      {
        entity_type: 'player',
        entity_id: playerId,
        source: 'alias',
        external_id: rawName,
        metadata: { normalized: norm },
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'source,entity_type,external_id' }
    );
  } catch {
    // swallow — best-effort
  }
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd padelgod && npx vitest run src/__tests__/lib/db-resolver.test.ts
```

Expected: PASS (12 tests).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/db-resolver.ts padelgod/src/__tests__/lib/db-resolver.test.ts
git commit -m "feat(padelgod): add storeAlias for fuzzy-match write-back"
```

---

## Task 6: Wire the new resolver into `entry-list-fetcher.ts`

**Files**
- Modify: `padelgod/src/workers/entry-list-fetcher.ts`
- Modify: `padelgod/src/__tests__/workers/entry-list-fetcher.test.ts`

- [ ] **Step 1: Write the failing rescue-via-subset test**

Add to `padelgod/src/__tests__/workers/entry-list-fetcher.test.ts` (alongside existing tests). Mock PDF text to contain a team where one partner needs subset rescue:

```ts
describe('alias + subset rescue', () => {
  it('resolves "Alejandro Ruiz Granados" to existing "Alejandro Ruiz" via subset fuzzy and writes an alias', async () => {
    const pdfText = `Pos Ranking Player Ranking Player Team Points
1 22 Alejandro Ruiz Granados ESP
2500 points 23 Juanlu Esbri ESP
2480 points 4980
`;
    vi.mocked(pdfToText).mockResolvedValueOnce(pdfText);

    const supabase = fakeSupabase({
      activeTournaments: [{
        tournament_id: 't1', tournament_name: 'X', slug: 'x', starts_at: null, ends_at: null,
      }],
      dbPlayers: [
        { id: 'u-ruiz', fip_id: 'P000012', name: 'Alejandro Ruiz', normalized_name: 'alejandro ruiz', country: 'ES', ranking: 23, category: 'men' },
        { id: 'u-esbri', fip_id: 'P000052', name: 'Juanlu Esbri',   normalized_name: 'juanlu esbri',  country: 'ES', ranking: 23, category: 'men' },
      ],
    });
    // Stub the HTTP layer to return canned event-page + PDF URLs, since
    // the alias path must NOT call FIP search.
    const httpClient = stubHttp({ menPdfUrl: 'https://example/men.pdf' });
    const result = await runEntryListFetcher({ supabase, httpClient });
    expect(result.totalPlayersResolved).toBe(2);
    expect(result.totalPlayersUnresolved).toBe(0);
    // Both partners resolved → both fip_ids written
    const ruizRow = supabase.inserted.find((r) => r.fip_id === 'P000012');
    expect(ruizRow).toBeDefined();
    expect(ruizRow!.partner_fip_id).toBe('P000052');
    // Alias was upserted for the long name
    expect(supabase.aliasUpserts).toContainEqual(
      expect.objectContaining({ external_id: 'Alejandro Ruiz Granados', entity_id: 'u-ruiz' })
    );
  });
});
```

The test uses two helpers (`fakeSupabase` already exists in the file; extend it to also record `aliasUpserts`; add a `stubHttp` if not present, modeled on the existing fetch mocks).

- [ ] **Step 2: Run the new test, verify FAIL**

```bash
cd padelgod && npx vitest run src/__tests__/workers/entry-list-fetcher.test.ts -t "alias + subset"
```

Expected: FAIL — current resolver returns null for "Alejandro Ruiz Granados", FIP search fallback runs and either returns null or wrong player.

- [ ] **Step 3: Update `entry-list-fetcher.ts` to use `db-resolver`**

Replace the inline `normalizeName`, `indexPlayersByName`, `resolveFromDb`, `loadDbPlayerIndex` definitions (lines 110-200) and the `resolveTeamPlayer` body. New flow:

```ts
import {
  loadDbPlayerIndex,
  loadAliasIndex,
  resolvePlayerByName,
  storeAlias,
  type DbPlayerIndex,
  type AliasIndex,
} from '../lib/db-resolver.js';

// ... delete the duplicated normalizeName, indexPlayersByName,
//     resolveFromDb, loadDbPlayerIndex inline helpers (now in db-resolver) ...

async function resolveTeamPlayer(
  http: AxiosInstance,
  supabase: SupabaseClient,
  parsedName: string,
  parsedCountry: string,
  parsedRanking: number,
  category: Category,
  dbIndex: DbPlayerIndex,
  aliasIndex: AliasIndex
): Promise<ResolvedPlayer | null> {
  // 1. DB chain: alias → exact → subset → typo
  const hit = resolvePlayerByName(
    { name: parsedName, country: parsedCountry, ranking: parsedRanking },
    dbIndex,
    aliasIndex
  );
  if (hit && hit.fipId) {
    // Persist the alias on every fuzzy hit so the next snapshot is O(1).
    // Skip for 'exact' (would be a no-op) and 'alias' (already there).
    if (hit.matchType === 'subset' || hit.matchType === 'typo') {
      await storeAlias(supabase, hit.playerId, parsedName);
      // Keep in-memory index in sync so subsequent rows in this run also
      // hit the alias path instead of re-running fuzzy.
      aliasIndex.set(parsedName.toLowerCase().trim(), hit.playerId);
    }
    return { fipId: hit.fipId, name: parsedName, country: parsedCountry || null };
  }
  // 2. FIP search fallback (unchanged)
  const fipHit = await searchFipPlayer(http, {
    name: parsedName,
    country: parsedCountry,
    category,
    rankingHint: parsedRanking || null,
  });
  if (!fipHit) return null;
  return { fipId: fipHit.playerId, name: fipHit.fullName, country: fipHit.nationality };
}
```

Also update `processTournament` to pre-load `aliasIndex` once per tournament run alongside the men/women indexes:

```ts
const aliasIndex = await loadAliasIndex(deps.supabase);
// ... pass aliasIndex into processCategory ...
```

And thread `aliasIndex` + `supabase` through `processCategory` → `resolveTeamPlayer`.

- [ ] **Step 4: Run the rescue test + the full fetcher test suite**

```bash
cd padelgod && npx vitest run src/__tests__/workers/entry-list-fetcher.test.ts
```

Expected: PASS (all existing tests still green + new alias rescue test passes).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/entry-list-fetcher.ts padelgod/src/__tests__/workers/entry-list-fetcher.test.ts
git commit -m "feat(padelgod): use db-resolver alias+fuzzy chain in entry-list-fetcher"
```

---

## Task 7: API — `padelgod-entry-list` synthesizes ghost player2 for unresolved partners

**Files**
- Modify: `src/app/api/ops/padelgod-entry-list/route.ts`
- Create: `src/app/api/ops/padelgod-entry-list/__tests__/route.test.ts`

- [ ] **Step 1: Write failing test for ghost synthesis**

Create `src/app/api/ops/padelgod-entry-list/__tests__/route.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { synthesizeGhostPartners } from '../route';

describe('synthesizeGhostPartners', () => {
  it('adds a ghost EntryPlayer for unresolved partners', () => {
    const teams = [
      {
        player1: {
          fipId: 'P000052', name: 'Juanlu Esbri', country: 'ES', seed: 7, drawType: 'main_draw' as const,
          partnerFipId: null, partnerName: 'Alejandro Ruiz Granados',
          resolvedPlayerId: 'u-esbri', resolvedPlayerName: 'Juanlu Esbri', resolutionMethod: 'fip_id' as const,
        },
        player2: null,
        seed: 7,
        drawType: 'main_draw' as const,
      },
    ];
    const out = synthesizeGhostPartners(teams);
    expect(out[0].player2).not.toBeNull();
    expect(out[0].player2!.name).toBe('Alejandro Ruiz Granados');
    expect(out[0].player2!.resolutionMethod).toBe('none');
    expect(out[0].player2!.fipId).toBeNull();
    expect((out[0].player2 as any).isGhostPartner).toBe(true);
  });

  it('leaves fully-resolved teams untouched', () => {
    const teams = [
      {
        player1: { fipId: 'P1', name: 'A', country: 'ES', seed: 1, drawType: 'main_draw' as const, partnerFipId: 'P2', partnerName: 'B', resolvedPlayerId: 'x', resolvedPlayerName: 'A', resolutionMethod: 'fip_id' as const },
        player2: { fipId: 'P2', name: 'B', country: 'ES', seed: null, drawType: 'main_draw' as const, partnerFipId: 'P1', partnerName: 'A', resolvedPlayerId: 'y', resolvedPlayerName: 'B', resolutionMethod: 'fip_id' as const },
        seed: 1, drawType: 'main_draw' as const,
      },
    ];
    const out = synthesizeGhostPartners(teams);
    expect((out[0].player2 as any).isGhostPartner).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
npx vitest run src/app/api/ops/padelgod-entry-list/__tests__/route.test.ts
```

Expected: FAIL — `synthesizeGhostPartners` not exported.

- [ ] **Step 3: Add the synthesizer + extend the EntryPlayer type, and call it in the handler**

In `src/app/api/ops/padelgod-entry-list/route.ts`:

(a) Extend `EntryPlayer` with optional `isGhostPartner: boolean`.

(b) Add the exported helper after the existing `pairKey` helper:

```ts
/**
 * Walk the teams produced by pair-grouping. For any team whose `player2` is
 * null but whose `player1.partnerName` carries a raw PDF name, synthesize a
 * ghost EntryPlayer for player2 so the UI can render the dropped name with a
 * MISSING chip.
 *
 * Exported for unit testing.
 */
export function synthesizeGhostPartners(teams: EntryTeam[]): EntryTeam[] {
  return teams.map((t) => {
    if (t.player2 !== null) return t;
    if (!t.player1.partnerName) return t;
    const ghost: EntryPlayer & { isGhostPartner: true } = {
      fipId: null,
      name: t.player1.partnerName,
      country: null,
      seed: null,
      drawType: t.drawType,
      partnerFipId: t.player1.fipId,
      partnerName: t.player1.name,
      resolvedPlayerId: null,
      resolvedPlayerName: null,
      resolutionMethod: 'none',
      isGhostPartner: true,
    };
    return { ...t, player2: ghost };
  });
}
```

(c) Update the handler — replace the existing sort call with:

```ts
for (const cat of ['men', 'women'] as const) {
  teamsByCategory[cat] = synthesizeGhostPartners(teamsByCategory[cat]);
  teamsByCategory[cat].sort((a, b) => { /* existing sort logic */ });
}
```

(d) Update the stats so ghost players count toward `playersTotal` and `playersMissingFromDb`:

```ts
const categories: CategoryBlock[] = (['men', 'women'] as const).map((cat) => {
  const teams = teamsByCategory[cat];
  // Count player1 + player2 (including ghosts) so the UI's "Players"
  // tile reflects PDF reality, not snapshot-row count.
  const allPlayers = teams.flatMap((t) => (t.player2 ? [t.player1, t.player2] : [t.player1]));
  const playersTotal = allPlayers.length;
  const playersResolved = allPlayers.filter((p) => p.resolvedPlayerId !== null).length;
  const playersWithFipId = allPlayers.filter((p) => !!p.fipId).length;
  const playersMissingFromDb = playersTotal - playersResolved;
  const teamsFullyResolved = teams.filter(
    (t) => t.player1.resolvedPlayerId !== null && t.player2 !== null && t.player2.resolvedPlayerId !== null
  ).length;
  return {
    category: cat,
    teams,
    stats: { playersTotal, playersResolved, playersWithFipId, playersMissingFromDb, teamsTotal: teams.length, teamsFullyResolved },
  };
});
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/app/api/ops/padelgod-entry-list/__tests__/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ops/padelgod-entry-list/route.ts src/app/api/ops/padelgod-entry-list/__tests__/
git commit -m "feat(ops-api): surface unresolved entry-list partners as ghost player2"
```

---

## Task 8: API — `POST /api/ops/player-aliases`

**Files**
- Create: `src/app/api/ops/player-aliases/route.ts`
- Create: `src/app/api/ops/player-aliases/__tests__/route.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/app/api/ops/player-aliases/__tests__/route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ops-auth', () => ({ checkOpsAuth: vi.fn(async () => null) }));

const upserts: any[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      upsert: (row: any, opts: any) => {
        upserts.push({ row, opts });
        return { select: () => ({ single: () => Promise.resolve({ data: { id: 'a1' }, error: null }) }) };
      },
    }),
  }),
}));

import { POST } from '../route';

beforeEach(() => { upserts.length = 0; });

describe('POST /api/ops/player-aliases', () => {
  it('rejects missing fields with 400', async () => {
    const res = await POST(new Request('http://x/', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
  it('upserts an alias row and returns ok', async () => {
    const res = await POST(new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'u-ruiz', alias: 'Alejandro Ruiz Granados' }),
    }));
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row.external_id).toBe('Alejandro Ruiz Granados');
    expect(upserts[0].row.metadata.normalized).toBe('alejandro ruiz granados');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
npx vitest run src/app/api/ops/player-aliases/__tests__/route.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route**

Create `src/app/api/ops/player-aliases/route.ts`:

```ts
// src/app/api/ops/player-aliases/route.ts
//
// POST to upsert a player alias (entity_external_ids row with source='alias').
// Used by the ops "Unresolved Partner" modal when an operator links a parsed
// PDF name to an existing player. Future entry-list snapshots will resolve
// the same parsed string instantly via the alias index.
//
// Auth: reads ops_token cookie via checkOpsAuth.

import { createClient } from '@supabase/supabase-js';
import { checkOpsAuth } from '@/lib/ops-auth';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth();
  if (authErr) return authErr;

  let body: { playerId?: string; alias?: string };
  try { body = await request.json(); } catch { return Response.json({ error: 'invalid json' }, { status: 400 }); }

  const { playerId, alias } = body;
  if (!playerId || !alias || typeof playerId !== 'string' || typeof alias !== 'string') {
    return Response.json({ error: 'missing required fields: playerId, alias' }, { status: 400 });
  }
  const norm = normalizeName(alias);
  if (!norm) return Response.json({ error: 'alias normalizes to empty' }, { status: 400 });

  const { error } = await supabase
    .from('entity_external_ids')
    .upsert(
      {
        entity_type: 'player',
        entity_id: playerId,
        source: 'alias',
        external_id: alias,
        metadata: { normalized: norm },
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'source,entity_type,external_id' },
    )
    .select()
    .single();

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/app/api/ops/player-aliases/__tests__/route.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ops/player-aliases/
git commit -m "feat(ops-api): add POST /api/ops/player-aliases for link-partner flow"
```

---

## Task 9: API — extend `/api/ops/players/route.ts` with `POST` for create-from-entry

**Files**
- Modify: `src/app/api/ops/players/route.ts`
- Create: `src/app/api/ops/players/__tests__/route-post.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/app/api/ops/players/__tests__/route-post.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ops-auth', () => ({ checkOpsAuth: vi.fn(async () => null) }));

const playerInserts: any[] = [];
const aliasUpserts: any[] = [];
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'players') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: () => {
                const id = 'new-' + (playerInserts.length + 1);
                playerInserts.push({ id, ...row });
                return Promise.resolve({ data: { id }, error: null });
              },
            }),
          }),
        };
      }
      if (table === 'entity_external_ids') {
        return {
          upsert: (row: any, opts: any) => {
            aliasUpserts.push({ row, opts });
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error('unexpected table ' + table);
    },
  }),
}));

import { POST } from '../route';

beforeEach(() => { playerInserts.length = 0; aliasUpserts.length = 0; });

describe('POST /api/ops/players', () => {
  it('rejects missing name with 400', async () => {
    const res = await POST(new Request('http://x/', { method: 'POST', body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
  it('creates a player row and auto-aliases the source name', async () => {
    const res = await POST(new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ name: 'Martin Muedini', country: 'AL', category: 'men', sourceName: 'Martin Muedini' }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe('new-1');
    expect(playerInserts[0].name).toBe('Martin Muedini');
    expect(playerInserts[0].country).toBe('AL');
    expect(playerInserts[0].category).toBe('men');
    expect(aliasUpserts).toHaveLength(1);
    expect(aliasUpserts[0].row.external_id).toBe('Martin Muedini');
  });
});
```

- [ ] **Step 2: Run test, verify FAIL**

```bash
npx vitest run src/app/api/ops/players/__tests__/route-post.test.ts
```

Expected: FAIL — `POST` not exported.

- [ ] **Step 3: Add `POST` handler**

Append to `src/app/api/ops/players/route.ts`:

```ts
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// -- POST: Create a new player from ops UI (e.g. unresolved entry-list partner)
//
// Body: { name, country?, category, sourceName? }
//   - name        : canonical display name to store in players.name
//   - country     : ISO-2 code (or whatever 2-3 letter code we got from PDF)
//   - category    : 'men' | 'women' (required so the resolver can scope future lookups)
//   - sourceName  : optional original PDF name to auto-alias for next snapshots
//
// Returns: { id: string }
//
// This route deliberately does NOT touch fip_id / external_id — those land via
// the FIP/padelapi sync workers when (or if) the player appears in the
// official rankings. Operator-created players carry name + country + category
// only, and the alias bridges PDF text to this row until that happens.
export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let body: { name?: string; country?: string; category?: string; sourceName?: string }
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 })
  }
  const { name, country, category, sourceName } = body
  if (!name || typeof name !== 'string') {
    return Response.json({ error: 'missing required field: name' }, { status: 400 })
  }
  if (category !== 'men' && category !== 'women') {
    return Response.json({ error: 'category must be men or women' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('players')
    .insert({
      name,
      country: country ?? null,
      category,
      normalized_name: normalizeName(name),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    return Response.json({ error: error?.message ?? 'create failed' }, { status: 500 })
  }

  // Auto-alias the source PDF name so the next snapshot resolves instantly.
  if (sourceName) {
    await supabase.from('entity_external_ids').upsert(
      {
        entity_type: 'player',
        entity_id: data.id,
        source: 'alias',
        external_id: sourceName,
        metadata: { normalized: normalizeName(sourceName) },
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: 'source,entity_type,external_id' },
    )
  }

  return Response.json({ id: data.id, ok: true })
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
npx vitest run src/app/api/ops/players/__tests__/route-post.test.ts
```

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ops/players/route.ts src/app/api/ops/players/__tests__/
git commit -m "feat(ops-api): add POST /api/ops/players for operator-created players"
```

---

## Task 10: UI — Render ghost partners + MISSING chip in `PadelgodEntryListTab`

**Files**
- Modify: `src/app/ops/PadelgodEntryListTab.tsx`

- [ ] **Step 1: Extend the `EntryPlayer` type with `isGhostPartner`**

Edit the type at lines 24-35 to add the optional flag:

```ts
interface EntryPlayer {
  fipId: string | null
  name: string
  country: string | null
  seed: number | null
  drawType: DrawType
  partnerFipId: string | null
  partnerName: string | null
  resolvedPlayerId: string | null
  resolvedPlayerName: string | null
  resolutionMethod: ResolutionMethod
  isGhostPartner?: boolean
}
```

- [ ] **Step 2: Update the `PlayerCell` to render the ghost differently**

Replace the existing `PlayerCell` (lines 657-666):

```tsx
function PlayerCell({ p, onResolveClick }: { p: EntryPlayer; onResolveClick?: (p: EntryPlayer) => void }) {
  if (p.isGhostPartner) {
    return (
      <div>
        <div style={{ fontWeight: 500, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 6 }}>
          {p.name}
          <button
            onClick={() => onResolveClick?.(p)}
            title="Click to link or create"
            style={{
              fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
              background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca',
              cursor: 'pointer', letterSpacing: '0.03em',
            }}
          >
            RESOLVE
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#666' }}>not in DB / FIP search</div>
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontWeight: 500, color: '#111' }}>{p.name}</div>
      {p.resolvedPlayerId && p.resolvedPlayerName && p.resolvedPlayerName !== p.name && (
        <div style={{ fontSize: 10, color: '#666' }}>→ {p.resolvedPlayerName}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Add the ghost-aware rendering at the row level**

Update the row body in `DrawSection` (lines 609-648). Replace the player2 cell and resolution chips with:

```tsx
<td style={tdStyle}>
  {t.player2 ? <PlayerCell p={t.player2} onResolveClick={onResolveClick} /> : <span style={{ color: '#ccc' }}>—</span>}
</td>
<td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: '#555' }}>
  {t.player1.country ?? '—'}
  {t.player2 && !t.player2.isGhostPartner ? ` / ${t.player2.country ?? '—'}` : t.player2 ? ' / —' : ''}
</td>
<td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: '#777' }}>
  {t.player1.fipId ? t.player1.fipId.replace(/^fip-/, '') : '—'}
  {t.player2 ? ` / ${t.player2.fipId ? t.player2.fipId.replace(/^fip-/, '') : '—'}` : ''}
</td>
<td style={tdStyle}>
  <div style={{ display: 'flex', gap: 4 }}>
    <ResolutionChip p={t.player1} />
    {t.player2 && <ResolutionChip p={t.player2} />}
  </div>
</td>
```

Thread the `onResolveClick` prop down: add it to `DrawSection` signature, then to `CategoryTable`, then to the main component (which will own the modal state in Task 11).

- [ ] **Step 4: Smoke-test the rendering**

Boot the dev server, log into ops, navigate to Tournament Explorer → FIP PLATINUM ALBANIA → Entry List tab.

```bash
npm run dev
```

Manually verify in the browser:
- Main Draw seed 7 row shows `Juanlu Esbri / Alejandro Ruiz Granados` with a red RESOLVE button next to the second name and a MISSING chip in the Resolution column.
- Main Draw seed 24 shows the same for `Martin Muedini`.
- Q seed 17 / 18 show the two Albanian WC partners.
- All four show "not in DB / FIP search" subtitle.

- [ ] **Step 5: Commit**

```bash
git add src/app/ops/PadelgodEntryListTab.tsx
git commit -m "feat(ops-ui): render unresolved entry-list partners with RESOLVE flag"
```

---

## Task 11: UI — `UnresolvedPartnerModal` with link + create flows

**Files**
- Create: `src/app/ops/UnresolvedPartnerModal.tsx`
- Modify: `src/app/ops/PadelgodEntryListTab.tsx`

- [ ] **Step 1: Scaffold the modal component**

Create `src/app/ops/UnresolvedPartnerModal.tsx`:

```tsx
'use client'
// src/app/ops/UnresolvedPartnerModal.tsx
//
// Operator-facing modal for resolving an entry-list partner that the
// fetcher could not match (neither DB lookup nor FIP search returned a
// confident hit). Two flows:
//   1. LINK    → search `public.players` for the right person, click to
//                store an alias (POST /api/ops/player-aliases). Future
//                snapshots resolve instantly via the alias index.
//   2. CREATE  → make a new player row from the parsed name/country/
//                category (POST /api/ops/players) AND auto-alias. Use
//                for WC players who aren't in our DB and aren't in FIP's
//                search index either.
//
// On success the modal closes and the parent tab is expected to prompt
// the operator to click the existing "Re-seed from FIP PDF" button so
// the snapshot gets refreshed with the resolved partner.

import { useState, useEffect, useCallback } from 'react'

export interface UnresolvedPartnerContext {
  parsedName: string
  category: 'men' | 'women'
  countryHint: string | null
}

interface SearchHit {
  id: string
  name: string
  country: string | null
  ranking: number | null
  fip_id: string | null
}

interface UnresolvedPartnerModalProps {
  ctx: UnresolvedPartnerContext | null
  onClose: () => void
  onResolved: () => void
}

export default function UnresolvedPartnerModal({ ctx, onClose, onResolved }: UnresolvedPartnerModalProps) {
  const [tab, setTab] = useState<'link' | 'create'>('link')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [createCountry, setCreateCountry] = useState('')

  // Reset state every time the modal opens for a new partner
  useEffect(() => {
    if (!ctx) return
    setTab('link')
    setQuery(ctx.parsedName)
    setHits([])
    setBusy(null)
    setError(null)
    setCreateName(ctx.parsedName)
    setCreateCountry(ctx.countryHint ?? '')
  }, [ctx])

  // Debounced search
  useEffect(() => {
    if (!ctx || !query.trim()) { setHits([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await fetch(`/api/ops/search-players?q=${encodeURIComponent(query)}&category=${ctx.category}&per_page=25`)
        const b = await r.json()
        setHits(b.players ?? [])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [query, ctx])

  const link = useCallback(async (playerId: string) => {
    if (!ctx) return
    setBusy(playerId)
    setError(null)
    try {
      const r = await fetch('/api/ops/player-aliases', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ playerId, alias: ctx.parsedName }),
      })
      const b = await r.json()
      if (!b.ok) throw new Error(b.error ?? 'link failed')
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'link failed')
    } finally {
      setBusy(null)
    }
  }, [ctx, onResolved])

  const create = useCallback(async () => {
    if (!ctx) return
    setBusy('__create__')
    setError(null)
    try {
      const r = await fetch('/api/ops/players', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          country: createCountry.trim() || null,
          category: ctx.category,
          sourceName: ctx.parsedName,
        }),
      })
      const b = await r.json()
      if (!b.ok) throw new Error(b.error ?? 'create failed')
      onResolved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'create failed')
    } finally {
      setBusy(null)
    }
  }, [ctx, createName, createCountry, onResolved])

  if (!ctx) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#fff', borderRadius: 8, padding: 20, width: 520, maxHeight: '80vh', overflow: 'auto' }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
          Resolve unresolved partner
        </div>
        <div style={{ fontSize: 12, color: '#666', marginBottom: 12 }}>
          <code style={{ background: '#f3f4f6', padding: '1px 5px', borderRadius: 3 }}>{ctx.parsedName}</code>{' '}
          ({ctx.category}{ctx.countryHint ? `, ${ctx.countryHint}` : ''})
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['link', 'create'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '6px 12px', fontSize: 12, fontWeight: 600,
                border: '1px solid', borderColor: tab === t ? '#3b82f6' : '#d1d5db',
                background: tab === t ? '#eff6ff' : '#fff',
                color: tab === t ? '#1e40af' : '#555',
                borderRadius: 4, cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {t === 'link' ? 'Link to existing' : 'Create new player'}
            </button>
          ))}
        </div>

        {tab === 'link' && (
          <div>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search players by name…"
              style={{ width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 8 }}
            />
            <div style={{ maxHeight: 260, overflow: 'auto', border: '1px solid #f3f4f6', borderRadius: 4 }}>
              {searching && <div style={{ padding: 8, fontSize: 12, color: '#999' }}>Searching…</div>}
              {!searching && hits.length === 0 && (
                <div style={{ padding: 8, fontSize: 12, color: '#999' }}>No matches.</div>
              )}
              {hits.map((h) => (
                <div key={h.id} style={{ display: 'flex', alignItems: 'center', padding: 8, borderBottom: '1px solid #f3f4f6', gap: 8 }}>
                  <div style={{ flex: 1, fontSize: 12 }}>
                    <div style={{ fontWeight: 500 }}>{h.name}</div>
                    <div style={{ color: '#666', fontSize: 10, fontFamily: 'monospace' }}>
                      {h.country ?? '—'} · rank {h.ranking ?? '—'} · {h.fip_id ?? 'no fip_id'}
                    </div>
                  </div>
                  <button
                    onClick={() => link(h.id)}
                    disabled={busy !== null}
                    style={{ padding: '4px 10px', fontSize: 11, fontWeight: 700, background: busy === h.id ? '#d1d5db' : '#111', color: '#fff', border: 'none', borderRadius: 4, cursor: busy === h.id ? 'wait' : 'pointer' }}
                  >
                    {busy === h.id ? 'Linking…' : 'Link'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'create' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>
              Name
              <input value={createName} onChange={(e) => setCreateName(e.target.value)} style={{ display: 'block', width: '100%', padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4, marginTop: 2 }} />
            </label>
            <label style={{ fontSize: 11, fontWeight: 600, color: '#666' }}>
              Country (ISO-2, e.g. AL)
              <input value={createCountry} onChange={(e) => setCreateCountry(e.target.value)} maxLength={3} style={{ display: 'block', width: 100, padding: '6px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 4, marginTop: 2 }} />
            </label>
            <button
              onClick={create}
              disabled={busy !== null || !createName.trim()}
              style={{ padding: '6px 12px', fontSize: 12, fontWeight: 700, background: busy ? '#d1d5db' : '#111', color: '#fff', border: 'none', borderRadius: 4, cursor: busy ? 'wait' : 'pointer', alignSelf: 'flex-start' }}
            >
              {busy === '__create__' ? 'Creating…' : 'Create player + alias'}
            </button>
          </div>
        )}

        {error && (
          <div style={{ marginTop: 10, padding: 8, background: '#fee2e2', border: '1px solid #fecaca', borderRadius: 4, fontSize: 11, color: '#991b1b' }}>
            {error}
          </div>
        )}

        <div style={{ marginTop: 14, display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{ padding: '6px 12px', fontSize: 12, background: '#f3f4f6', border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire the modal into `PadelgodEntryListTab.tsx`**

At the top of the component, add state + import:

```tsx
import UnresolvedPartnerModal, { UnresolvedPartnerContext } from './UnresolvedPartnerModal'

// inside the component:
const [resolveCtx, setResolveCtx] = useState<UnresolvedPartnerContext | null>(null)
const [resolveBanner, setResolveBanner] = useState<string | null>(null)

const openResolve = useCallback((p: EntryPlayer) => {
  if (!detail) return
  setResolveCtx({
    parsedName: p.name,
    category: activeCategory,
    countryHint: p.country ?? null,
  })
}, [detail, activeCategory])

const handleResolved = useCallback(() => {
  setResolveCtx(null)
  setResolveBanner('Resolved. Click "Re-seed from FIP PDF" to refresh the snapshot.')
}, [])
```

In the JSX, render the modal at the end of the component:

```tsx
<UnresolvedPartnerModal ctx={resolveCtx} onClose={() => setResolveCtx(null)} onResolved={handleResolved} />
{resolveBanner && (
  <div style={{ marginTop: 12, padding: 10, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 6, fontSize: 12, color: '#065f46' }}>
    {resolveBanner}
  </div>
)}
```

Pass `openResolve` as `onResolveClick` into `CategoryTable` → `DrawSection` → `PlayerCell`.

- [ ] **Step 3: Manual end-to-end verification**

```bash
npm run dev
```

In the browser:
1. Go to FIP PLATINUM ALBANIA entry list.
2. Click the RESOLVE button next to "Alejandro Ruiz Granados".
3. Modal opens with `Alejandro Ruiz Granados` pre-filled in the search box.
4. Search returns existing "Alejandro Ruiz". Click Link → success banner appears.
5. Click "Re-seed from FIP PDF" → re-seed runs → on next refresh the row shows "Alejandro Ruiz Granados → Alejandro Ruiz" with green FIP chips on both sides.
6. Repeat for "Martin Muedini" using the **Create** tab → form pre-filled, Country=AL → Create. Success → re-seed → row resolves.
7. Verify the four originally-missing names are now all resolved (or at least visible).

- [ ] **Step 4: Commit**

```bash
git add src/app/ops/UnresolvedPartnerModal.tsx src/app/ops/PadelgodEntryListTab.tsx
git commit -m "feat(ops-ui): add UnresolvedPartnerModal for link/create flows"
```

---

## Task 12: Wrap up — lint, full test pass, PR

**Files**: none new

- [ ] **Step 1: Run the whole test suite**

```bash
npm run lint
npx vitest run
cd padelgod && npx vitest run && cd ..
```

Expected: no errors, all tests green. Fix any new lint findings inline.

- [ ] **Step 2: Sanity-run the fetcher against this tournament**

After the operator-driven link/create has populated aliases + the player row, re-run the live fetcher locally to confirm the snapshot fills in:

```bash
cd padelgod
set -a; source ../.env.local; set +a
npx tsx scripts/run-entry-list-once.ts 8a47598a-579b-4503-88c2-135306d274fb
```

Expected output: `totalPlayersResolved: 84`, `totalPlayersUnresolved: 0`. Then reload the ops UI — every row in MD + Q has both partners resolved.

- [ ] **Step 3: Push the branch and open the PR**

```bash
git push -u origin claude/zealous-leakey-8296d7
gh pr create --title "fix(entry-list): surface unresolved partners + alias-aware resolver" --body "$(cat <<'EOF'
## Summary
- Stop silently dropping entry-list partners when neither DB lookup nor FIP search resolves them. Surfaces them in the ops UI as ghost rows with a red RESOLVE flag.
- New "Resolve unresolved partner" modal lets the operator either link the parsed name to an existing player (stores an alias in `entity_external_ids`) or create a new player row from the parsed name/country/category (also auto-aliases).
- Ports the main repo's alias-aware resolution chain (alias → exact → subset → typo) into a new `padelgod/src/lib/db-resolver.ts`. The entry-list fetcher now hits aliases + subset fuzzy before falling back to FIP's HTTP search. Recovers names like "Alejandro Ruiz Granados" → "Alejandro Ruiz" automatically.

Root-cause investigation: see ops dashboard for FIP PLATINUM ALBANIA — 4 partners were missing (`Alejandro Ruiz Granados`, `Martin Muedini`, `Fjoralb Curri`, `Vladimir Progni`). Stats showed `Players: 80` vs `Teams: 42` (should be 84). UI rendered them as `—` with no signal.

## Test plan
- [ ] `cd padelgod && npx vitest run` → all green
- [ ] `npx vitest run` (main repo) → all green
- [ ] Open ops UI on FIP PLATINUM ALBANIA → 4 RESOLVE chips render
- [ ] Click RESOLVE on Alejandro Ruiz Granados → Link to existing → resolves on re-seed
- [ ] Click RESOLVE on Martin Muedini → Create → resolves on re-seed
- [ ] `playersResolved` after both flows + re-seed should be 84 / 84
EOF
)"
```

- [ ] **Step 4: Confirm PR URL**

Note the PR URL printed by `gh pr create` and report it.

---

## Self-Review

**Spec coverage check:**
- Visual MISSING chip — Task 10
- Click-to-resolve modal — Task 11
- Link to existing — Task 11 (uses `/api/ops/search-players` + `/api/ops/player-aliases`)
- Create new player — Task 11 (uses `POST /api/ops/players`)
- Padelgod alias + fuzzy resolver port — Tasks 1-5 + integration in Task 6
- Single PR — Task 12

**Placeholder scan:** No "TBD" / "add error handling" / "fill in details" — every step contains the actual code or command.

**Type consistency:** `EntryPlayer.isGhostPartner?`, `ResolveHit.matchType`, `DbPlayerIndex`, `AliasIndex`, `ResolveInput` are defined in earlier tasks and reused consistently in later tasks.
