# Pair-aware player resolver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fuzzy-only short-form resolution in `padelgod/src/workers/fip-draw-populator.ts` with a two-pass tiered resolver that uses entry-list partner pairs and per-match bracket long-form names as structural disambiguation signals.

**Architecture:** Two new pure-function helpers (`buildPairIndex`, `buildBracketOverlay`) feed a refactored `resolveFourPlayers` that runs Pass 1 (per-slot lookup across four tiers) then Pass 2 (pair-anchor sweep + mis-pair sanity check + late-swap telemetry). Wiring into `runFipDrawPopulator` is additive — existing call sites without the new options keep current behavior.

**Tech Stack:** TypeScript, Vitest, Supabase JS client, pino logger. All work lives in `padelgod/`.

**Spec:** [docs/superpowers/specs/2026-05-12-pair-aware-resolver-design.md](../specs/2026-05-12-pair-aware-resolver-design.md) — [PR #314](https://github.com/gudenes/padel-live-scores/pull/314).

**Branch strategy:** Implementation on a new `feat/pair-aware-resolver` branch off `main`. Spec PR #314 lands first; impl PR opens after. The implementation only references the spec — it doesn't import from the spec branch.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `padelgod/src/workers/fip-draw-populator.ts` | Modify | Add `isShortFormConsistentWith` + `doShortFormInitialsMatch` helpers, `buildPairIndex`, `buildBracketOverlay`, extended `Tier` + `ResolvedFour` types, refactored `resolveFourPlayers` (Pass 1 reorder + Pass 2 sweep), wire new helpers in `runFipDrawPopulator` main loop. |
| `padelgod/src/__tests__/workers/fip-draw-populator.test.ts` | Modify | ~12 new test cases across 3 layers (helpers, resolver tiers, integration). All existing 78 tests stay green. |
| `scripts/audit-mispaired-matches.ts` | Create | One-shot operator script: lists `public.matches` rows whose `pair*_player_id` FKs disagree with entry-list partner pairs. Dry-run by default. |

---

## Task 1: Add `isShortFormConsistentWith` + `doShortFormInitialsMatch` helpers

**Files:**
- Modify: `padelgod/src/workers/fip-draw-populator.ts` (add helpers near the existing `normalizeName` / `shortenName` block, ~line 280)
- Test: `padelgod/src/__tests__/workers/fip-draw-populator.test.ts` (new `describe('isShortFormConsistentWith')` + `describe('doShortFormInitialsMatch')` blocks)

These pure helpers underpin both the bracket-overlay scan and the partner-anchor consistency gate. Pulling them out keeps the resolver readable and the rules unit-testable in isolation.

- [ ] **Step 1: Write the failing tests**

Append to the end of `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`:

```typescript
import {
  shortenName,
  buildShortFormMap,
  normalizeName,
  resolveFourPlayers,
  runFipDrawPopulator,
  // NEW exports added by this plan:
  isShortFormConsistentWith,
  doShortFormInitialsMatch,
} from '../../workers/fip-draw-populator';

// (Place near other describe blocks — order doesn't matter)

describe('isShortFormConsistentWith', () => {
  it('returns true when initial matches and at least one surname token overlaps', () => {
    expect(isShortFormConsistentWith('J. Ruiz', 'Javier Ruiz Gonzalez')).toBe(true);
    expect(isShortFormConsistentWith('J. Ruiz', 'Jorge Nieto Ruiz')).toBe(true);
    expect(isShortFormConsistentWith('G. Rubio', 'Gonzalo Rubio')).toBe(true);
  });

  it('returns true when both sides are long-form and match exactly', () => {
    expect(isShortFormConsistentWith('Gonzalo Rubio', 'Gonzalo Rubio')).toBe(true);
  });

  it('returns false when initials disagree', () => {
    expect(isShortFormConsistentWith('M. Ruiz', 'Javier Ruiz Gonzalez')).toBe(false);
  });

  it('returns false when initial matches but no surname token overlaps (late-swap case)', () => {
    expect(isShortFormConsistentWith('J. Rubini', 'Javier Ruiz Gonzalez')).toBe(false);
  });

  it('handles diacritics and case-insensitivity', () => {
    expect(isShortFormConsistentWith('D. García', 'Diego Garcia Garcia')).toBe(true);
    expect(isShortFormConsistentWith('a. miranda', 'Adrian Maria Miranda')).toBe(true);
  });

  it('returns false on null or empty inputs', () => {
    expect(isShortFormConsistentWith(null as never, 'Gonzalo Rubio')).toBe(false);
    expect(isShortFormConsistentWith('G. Rubio', null as never)).toBe(false);
    expect(isShortFormConsistentWith('', 'Gonzalo Rubio')).toBe(false);
  });
});

describe('doShortFormInitialsMatch', () => {
  it('returns true when first initials agree', () => {
    expect(doShortFormInitialsMatch('J. Rubini', 'Javier Ruiz Gonzalez')).toBe(true);
  });

  it('returns false when first initials disagree', () => {
    expect(doShortFormInitialsMatch('M. Ruiz', 'Javier Ruiz Gonzalez')).toBe(false);
  });

  it('returns false on null inputs', () => {
    expect(doShortFormInitialsMatch(null as never, 'Javier Ruiz Gonzalez')).toBe(false);
    expect(doShortFormInitialsMatch('J. Ruiz', null as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts
```

Expected: failures with `isShortFormConsistentWith is not a function` / `doShortFormInitialsMatch is not a function` (import errors).

- [ ] **Step 3: Implement helpers**

In `padelgod/src/workers/fip-draw-populator.ts`, find the existing `normalizeName` function (~line 250). Right after `shortenName` (~line 281), add:

```typescript
/**
 * Returns true when a short-form input ("J. Ruiz") is consistent with a
 * long-form name ("Javier Ruiz Gonzalez"). The rule is permissive on
 * purpose — callers decide what to do with multiple consistent
 * candidates:
 *   - bracket overlay requires EXACTLY ONE consistent bracket name
 *   - partner anchor trusts the sibling's entry-list partner declaration
 *
 * Consistency =
 *   (1) same first letter on the first token (handles "J. " short or
 *       "Javier" long), AND
 *   (2) at least one shared surname token between the input's surname
 *       tokens (everything after the first token) and the long-form's
 *       surname tokens.
 *
 * Returns false on null / empty / single-token inputs (a single token
 * can't be confidently mapped to a multi-token long-form by this rule).
 */
export function isShortFormConsistentWith(
  shortOrLong: string,
  longForm: string,
): boolean {
  if (!shortOrLong || !longForm) return false;
  const sTokens = normalizeName(shortOrLong).split(' ').filter(Boolean);
  const lTokens = normalizeName(longForm).split(' ').filter(Boolean);
  if (sTokens.length < 2 || lTokens.length < 2) return false;
  // Initial match: compare first letter of first token, ignoring the
  // trailing dot if present ("j." vs "javier" both start with "j").
  const sInitial = sTokens[0]!.charAt(0);
  const lInitial = lTokens[0]!.charAt(0);
  if (sInitial !== lInitial) return false;
  // Surname overlap: any token after the first in s appears anywhere
  // after the first in l.
  const lSurnames = new Set(lTokens.slice(1));
  return sTokens.slice(1).some((t) => lSurnames.has(t));
}

/**
 * Returns true when only the first-token initial agrees between two
 * names. Used by the late-swap detector — if initials match but
 * `isShortFormConsistentWith` is false, the OOP shorthand may indicate
 * a real pair swap rather than a resolver error.
 */
export function doShortFormInitialsMatch(
  shortOrLong: string,
  longForm: string,
): boolean {
  if (!shortOrLong || !longForm) return false;
  const sTokens = normalizeName(shortOrLong).split(' ').filter(Boolean);
  const lTokens = normalizeName(longForm).split(' ').filter(Boolean);
  if (sTokens.length === 0 || lTokens.length === 0) return false;
  return sTokens[0]!.charAt(0) === lTokens[0]!.charAt(0);
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts
```

Expected: all tests pass (previously 78, now 78 + ~9 new = 87+).

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/pair-aware-resolver
git add padelgod/src/workers/fip-draw-populator.ts padelgod/src/__tests__/workers/fip-draw-populator.test.ts
git commit -m "$(cat <<'EOF'
feat(fip-draw-populator): add isShortFormConsistentWith helpers

Pulls the name-consistency rule out as two pure helpers ahead of the
bracket-overlay and partner-anchor work. isShortFormConsistentWith is
permissive (callers handle the multi-candidate case);
doShortFormInitialsMatch is the late-swap detector signal.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `buildPairIndex` — entry-list reader with partner pairs

**Files:**
- Modify: `padelgod/src/workers/fip-draw-populator.ts` (add types + helper, replacing/wrapping the existing `loadEntryListNameMap`)
- Test: `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`

The new helper extends `loadEntryListNameMap` with a per-fip_id partner index. Keep `loadEntryListNameMap` exported for back-compat with anyone calling it directly, but `runFipDrawPopulator` will call `buildPairIndex`.

- [ ] **Step 1: Write the failing tests**

Append to the test file:

```typescript
import {
  // ...prior imports...
  buildPairIndex,
  type PairIndex,
} from '../../workers/fip-draw-populator';

describe('buildPairIndex', () => {
  // Lightweight stub matching the shape paginatedSelect expects.
  const fakeSupabase = (rows: Array<{
    name: string | null;
    fip_id: string | null;
    category: 'men' | 'women';
    partner_fip_id: string | null;
    partner_name: string | null;
    captured_at: string;
  }>) => ({
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            range: (start: number, end: number) => {
              const slice = rows.slice(start, end + 1);
              return Promise.resolve({ data: slice, error: null });
            },
          }),
        }),
      }),
    }),
  });

  it('returns nameToFipId + fipIdToPartner from the latest captured_at per category', async () => {
    const supabase = fakeSupabase([
      { name: 'Gonzalo Rubio', fip_id: 'fip-P000029', category: 'men', partner_fip_id: 'fip-P000021', partner_name: 'Javier Ruiz Gonzalez', captured_at: '2026-05-12T05:00:00Z' },
      { name: 'Javier Ruiz Gonzalez', fip_id: 'fip-P000021', category: 'men', partner_fip_id: 'fip-P000029', partner_name: 'Gonzalo Rubio', captured_at: '2026-05-12T05:00:00Z' },
    ]);
    const idx = await buildPairIndex(supabase as never, 'tour-1');
    expect(idx.nameToFipId.get('gonzalo rubio')).toBe('fip-P000029');
    expect(idx.nameToFipId.get('javier ruiz gonzalez')).toBe('fip-P000021');
    expect(idx.fipIdToPartner.get('fip-P000029')).toEqual({
      partnerFipId: 'fip-P000021',
      partnerNormName: 'javier ruiz gonzalez',
    });
    expect(idx.fipIdToPartner.get('fip-P000021')).toEqual({
      partnerFipId: 'fip-P000029',
      partnerNormName: 'gonzalo rubio',
    });
  });

  it('falls back to partner_name when partner_fip_id is null', async () => {
    const supabase = fakeSupabase([
      { name: 'Gonzalo Rubio', fip_id: 'fip-P000029', category: 'men', partner_fip_id: null, partner_name: 'Javier Ruiz Gonzalez', captured_at: '2026-05-12T05:00:00Z' },
    ]);
    const idx = await buildPairIndex(supabase as never, 'tour-1');
    expect(idx.fipIdToPartner.get('fip-P000029')).toEqual({
      partnerFipId: null,
      partnerNormName: 'javier ruiz gonzalez',
    });
  });

  it('skips rows missing both partner_fip_id AND partner_name (no partner data)', async () => {
    const supabase = fakeSupabase([
      { name: 'Gonzalo Rubio', fip_id: 'fip-P000029', category: 'men', partner_fip_id: null, partner_name: null, captured_at: '2026-05-12T05:00:00Z' },
    ]);
    const idx = await buildPairIndex(supabase as never, 'tour-1');
    expect(idx.nameToFipId.get('gonzalo rubio')).toBe('fip-P000029');
    expect(idx.fipIdToPartner.has('fip-P000029')).toBe(false);
  });

  it('isolates men and women categories — older men captured_at does not get displaced by newer women', async () => {
    const supabase = fakeSupabase([
      { name: 'Gonzalo Rubio', fip_id: 'fip-P000029', category: 'men', partner_fip_id: 'fip-P000021', partner_name: 'Javier Ruiz Gonzalez', captured_at: '2026-05-12T05:00:00Z' },
      { name: 'Alejandra Salazar', fip_id: 'fip-P000300', category: 'women', partner_fip_id: 'fip-P000301', partner_name: 'Alejandra Alonso', captured_at: '2026-05-12T06:00:00Z' },
    ]);
    const idx = await buildPairIndex(supabase as never, 'tour-1');
    expect(idx.nameToFipId.get('gonzalo rubio')).toBe('fip-P000029');
    expect(idx.nameToFipId.get('alejandra salazar')).toBe('fip-P000300');
  });

  it('dedupes by latest captured_at within a category (newer snapshot wins)', async () => {
    const supabase = fakeSupabase([
      // Older snapshot: Rubio paired with someone else (stale)
      { name: 'Gonzalo Rubio', fip_id: 'fip-P000029', category: 'men', partner_fip_id: 'fip-P000999', partner_name: 'Old Partner', captured_at: '2026-05-10T05:00:00Z' },
      // Latest snapshot: Rubio paired with Javier
      { name: 'Gonzalo Rubio', fip_id: 'fip-P000029', category: 'men', partner_fip_id: 'fip-P000021', partner_name: 'Javier Ruiz Gonzalez', captured_at: '2026-05-12T05:00:00Z' },
    ]);
    const idx = await buildPairIndex(supabase as never, 'tour-1');
    expect(idx.fipIdToPartner.get('fip-P000029')?.partnerFipId).toBe('fip-P000021');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t buildPairIndex
```

Expected: failures with `buildPairIndex is not a function`.

- [ ] **Step 3: Implement `buildPairIndex`**

In `padelgod/src/workers/fip-draw-populator.ts`, after the existing `loadEntryListNameMap` (~line 1442), add:

```typescript
/**
 * Pair-aware entry-list index.
 *
 *   nameToFipId: same flat map loadEntryListNameMap returns — used by
 *                Pattern 1/2/3 short-form resolution unchanged.
 *
 *   fipIdToPartner: for every entry-list row that has either
 *                   partner_fip_id OR partner_name, the partner's
 *                   normalized long-form name (and fip_id when known).
 *                   Powers the Pass 2 partner-anchor sweep.
 *
 * Both maps reflect the latest captured_at per (category, fip_id).
 */
export interface PairIndex {
  nameToFipId: Map<string, string>;
  fipIdToPartner: Map<string, {
    partnerFipId: string | null;
    partnerNormName: string;
  }>;
}

export async function buildPairIndex(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<PairIndex> {
  interface Row {
    name: string | null;
    fip_id: string | null;
    category: 'men' | 'women';
    partner_fip_id: string | null;
    partner_name: string | null;
    captured_at: string;
  }
  const rows = await paginatedSelect<Row>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('entry_list_snapshots')
        .select('name, fip_id, category, partner_fip_id, partner_name, captured_at')
        .eq('tournament_id', tournamentId)
        .range(start, end),
    { what: `entry_list_snapshots (tournament=${tournamentId})` },
  );

  // Latest captured_at per category (same rule as loadEntryListNameMap).
  const maxByCat = new Map<string, string>();
  for (const r of rows) {
    const prev = maxByCat.get(r.category);
    if (!prev || r.captured_at > prev) maxByCat.set(r.category, r.captured_at);
  }

  const nameToFipId = new Map<string, string>();
  const fipIdToPartner = new Map<string, { partnerFipId: string | null; partnerNormName: string }>();
  for (const r of rows) {
    if (r.captured_at !== maxByCat.get(r.category)) continue;
    if (r.name && r.fip_id) nameToFipId.set(normalizeName(r.name), r.fip_id);
    if (r.fip_id && (r.partner_fip_id || r.partner_name)) {
      const partnerNormName = r.partner_name ? normalizeName(r.partner_name) : '';
      if (partnerNormName || r.partner_fip_id) {
        fipIdToPartner.set(r.fip_id, {
          partnerFipId: r.partner_fip_id,
          partnerNormName,
        });
      }
    }
  }

  return { nameToFipId, fipIdToPartner };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t buildPairIndex
```

Expected: all 5 buildPairIndex tests pass; existing tests remain green.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/fip-draw-populator.ts padelgod/src/__tests__/workers/fip-draw-populator.test.ts
git commit -m "$(cat <<'EOF'
feat(fip-draw-populator): buildPairIndex — entry-list reader with partner pairs

Extends loadEntryListNameMap with a per-fip_id partner index. Both
maps reflect the latest captured_at per category. Sets up the data
plumbing for the Pass 2 partner-anchor sweep coming next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `buildBracketOverlay` — bye-skip-bypassing bracket name harvester

**Files:**
- Modify: `padelgod/src/workers/fip-draw-populator.ts`
- Test: `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`

Reads `draw_snapshots` rows where `source='fip_event_page'` without applying the main-loop bye-skip. Walkover rows with one side null still contribute the populated side's long-form names. Keyed by `match_widget_id`, dedupe rule is latest `captured_at`.

- [ ] **Step 1: Write the failing tests**

```typescript
import {
  // ...prior imports...
  buildBracketOverlay,
  type BracketOverlayEntry,
  type BracketOverlay,
} from '../../workers/fip-draw-populator';

describe('buildBracketOverlay', () => {
  const fakeSupabase = (rows: Array<{
    match_widget_id: string | null;
    team1_player1_name: string | null;
    team1_player2_name: string | null;
    team2_player1_name: string | null;
    team2_player2_name: string | null;
    team1_fip_id: string | null;
    team2_fip_id: string | null;
    captured_at: string;
  }>) => ({
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              range: (start: number, end: number) => {
                const slice = rows.slice(start, end + 1);
                return Promise.resolve({ data: slice, error: null });
              },
            }),
          }),
        }),
      }),
    }),
  });

  it('harvests bye-skipped walkover rows where t1 is null but t2 has long-form names', async () => {
    const supabase = fakeSupabase([
      {
        match_widget_id: 'MD042',
        team1_player1_name: null,
        team1_player2_name: null,
        team2_player1_name: 'Gonzalo Rubio',
        team2_player2_name: 'Javier Ruiz Gonzalez',
        team1_fip_id: null,
        team2_fip_id: null,
        captured_at: '2026-05-11T20:00:00Z',
      },
    ]);
    const overlay = await buildBracketOverlay(supabase as never, 'tour-1');
    expect(overlay.get('MD042')).toEqual({
      team1_player1_name: null,
      team1_player2_name: null,
      team2_player1_name: 'Gonzalo Rubio',
      team2_player2_name: 'Javier Ruiz Gonzalez',
      team1_fip_id: null,
      team2_fip_id: null,
    });
  });

  it('keeps the latest captured_at per match_widget_id', async () => {
    const supabase = fakeSupabase([
      // Older — stale "TBD" names
      {
        match_widget_id: 'MD042',
        team1_player1_name: null, team1_player2_name: null,
        team2_player1_name: null, team2_player2_name: null,
        team1_fip_id: null, team2_fip_id: null,
        captured_at: '2026-05-09T10:00:00Z',
      },
      // Latest — real names land
      {
        match_widget_id: 'MD042',
        team1_player1_name: null, team1_player2_name: null,
        team2_player1_name: 'Gonzalo Rubio', team2_player2_name: 'Javier Ruiz Gonzalez',
        team1_fip_id: null, team2_fip_id: null,
        captured_at: '2026-05-11T20:00:00Z',
      },
    ]);
    const overlay = await buildBracketOverlay(supabase as never, 'tour-1');
    expect(overlay.get('MD042')?.team2_player1_name).toBe('Gonzalo Rubio');
    expect(overlay.get('MD042')?.team2_player2_name).toBe('Javier Ruiz Gonzalez');
  });

  it('returns an empty map when no rows exist', async () => {
    const supabase = fakeSupabase([]);
    const overlay = await buildBracketOverlay(supabase as never, 'tour-1');
    expect(overlay.size).toBe(0);
  });

  it('skips rows with null match_widget_id (un-keyable)', async () => {
    const supabase = fakeSupabase([
      {
        match_widget_id: null,
        team1_player1_name: 'Stray', team1_player2_name: 'Names',
        team2_player1_name: null, team2_player2_name: null,
        team1_fip_id: null, team2_fip_id: null,
        captured_at: '2026-05-11T20:00:00Z',
      },
    ]);
    const overlay = await buildBracketOverlay(supabase as never, 'tour-1');
    expect(overlay.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t buildBracketOverlay
```

Expected: failures with `buildBracketOverlay is not a function`.

- [ ] **Step 3: Implement `buildBracketOverlay`**

In `padelgod/src/workers/fip-draw-populator.ts`, after `buildPairIndex` from Task 2, add:

```typescript
/**
 * Per-match bracket long-form name overlay. Keyed by match_widget_id,
 * one entry per match the bracket has touched (including bye-skipped
 * walkover rows where one side is null but the other has real names).
 * The Pass 1 bracket_overlay tier scans the 4 names here looking for
 * exactly one consistent with the OOP shorthand.
 *
 * Reads only source='fip_event_page' rows — Crionet OOP rows are NOT
 * authoritative for player identity (they're short-form anyway, which
 * is the problem we're solving).
 */
export interface BracketOverlayEntry {
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_fip_id: string | null;
  team2_fip_id: string | null;
}

export type BracketOverlay = Map<string, BracketOverlayEntry>;

export async function buildBracketOverlay(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<BracketOverlay> {
  interface Row {
    match_widget_id: string | null;
    team1_player1_name: string | null;
    team1_player2_name: string | null;
    team2_player1_name: string | null;
    team2_player2_name: string | null;
    team1_fip_id: string | null;
    team2_fip_id: string | null;
    captured_at: string;
  }
  const rows = await paginatedSelect<Row>(
    (start, end) =>
      supabase
        .schema('padelgod')
        .from('draw_snapshots')
        .select(
          'match_widget_id, team1_player1_name, team1_player2_name, ' +
          'team2_player1_name, team2_player2_name, ' +
          'team1_fip_id, team2_fip_id, captured_at',
        )
        .eq('tournament_id', tournamentId)
        .eq('source', 'fip_event_page')
        .range(start, end),
    { what: `draw_snapshots overlay (tournament=${tournamentId})` },
  );

  // Latest captured_at per match_widget_id.
  const latestByMid = new Map<string, Row>();
  for (const r of rows) {
    if (!r.match_widget_id) continue;
    const prev = latestByMid.get(r.match_widget_id);
    if (!prev || r.captured_at > prev.captured_at) latestByMid.set(r.match_widget_id, r);
  }

  const overlay: BracketOverlay = new Map();
  for (const [mid, r] of latestByMid) {
    overlay.set(mid, {
      team1_player1_name: r.team1_player1_name,
      team1_player2_name: r.team1_player2_name,
      team2_player1_name: r.team2_player1_name,
      team2_player2_name: r.team2_player2_name,
      team1_fip_id: r.team1_fip_id,
      team2_fip_id: r.team2_fip_id,
    });
  }
  return overlay;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t buildBracketOverlay
```

Expected: 4 buildBracketOverlay tests pass.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/fip-draw-populator.ts padelgod/src/__tests__/workers/fip-draw-populator.test.ts
git commit -m "$(cat <<'EOF'
feat(fip-draw-populator): buildBracketOverlay — per-match name overlay

Reads draw_snapshots (source=fip_event_page) without the main-loop
bye-skip so walkover rows with long-form names on one side still
contribute. Keyed by match_widget_id, dedupes to latest captured_at.
Powers the bracket_overlay tier coming in Task 4.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Tier type + Pass 1 reorder + bracket-overlay tier in `resolveFourPlayers`

**Files:**
- Modify: `padelgod/src/workers/fip-draw-populator.ts` (extend types, refactor `resolveFourPlayers` Pass 1)
- Test: `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`

Pass 1 changes:
1. New `Tier` type and extended `ResolvedFour` with optional `tiers`.
2. `resolveFourPlayers` accepts a new `options` parameter (`{ fipIdToPartner?, bracketOverlay? }`); when omitted, behavior is identical to today (existing tests stay green).
3. Per-slot lookup order: exact_long → bracket_overlay → short_unique → middle-strip.
4. Bracket overlay scans all 4 overlay names by `isShortFormConsistentWith`; substitutes when EXACTLY ONE is consistent AND resolves via `nameToFipId`.

Pass 2 (partner-anchor / mis-pair / late-swap) is introduced in Tasks 5–7.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('resolveFourPlayers — tier-aware Pass 1', () => {
  const nameToFipId = new Map<string, string>([
    ['javier ruiz gonzalez', 'fip-P000021'],
    ['jorge nieto ruiz', 'fip-P000017'],
    ['gonzalo rubio', 'fip-P000029'],
    ['santiago pineda cabello', 'fip-P100958'],
    ['diego garcia garcia', 'fip-P101099'],
  ]);
  const shortFormToFipId = buildShortFormMap(nameToFipId);
  const fipIdToPlayerId = new Map<string, string>([
    ['fip-P000021', 'uuid-javier'],
    ['fip-P000017', 'uuid-jorge'],
    ['fip-P000029', 'uuid-gonzalo'],
    ['fip-P100958', 'uuid-pineda'],
    ['fip-P101099', 'uuid-diego'],
  ]);

  it('tags exact long-form hits as exact_long', () => {
    const draw = {
      team1_player1_name: 'Gonzalo Rubio',
      team1_player2_name: 'Javier Ruiz Gonzalez',
      team2_player1_name: null,
      team2_player2_name: null,
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, undefined, {},
    );
    expect(resolved.p1p1).toBe('uuid-gonzalo');
    expect(resolved.tiers?.p1p1).toBe('exact_long');
    expect(resolved.tiers?.p1p2).toBe('exact_long');
  });

  it('tags short-form hits as short_unique when there is no bracket overlay', () => {
    const draw = {
      team1_player1_name: 'G. Rubio',
      team1_player2_name: null,
      team2_player1_name: null,
      team2_player2_name: null,
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, undefined, {},
    );
    expect(resolved.p1p1).toBe('uuid-gonzalo');
    expect(resolved.tiers?.p1p1).toBe('short_unique');
  });

  it('upgrades to bracket_overlay when the bracket has exactly one consistent long-form for the slot', () => {
    // BA MD042 setup: bracket has t2 = [Rubio, Javier Ruiz Gonzalez], t1 null
    const bracketOverlay = {
      team1_player1_name: null,
      team1_player2_name: null,
      team2_player1_name: 'Gonzalo Rubio',
      team2_player2_name: 'Javier Ruiz Gonzalez',
      team1_fip_id: null,
      team2_fip_id: null,
    };
    const draw = {
      team1_player1_name: 'S. Pineda Cabello',
      team1_player2_name: 'D. Garcia Garcia',
      team2_player1_name: 'J. Ruiz',   // ambiguous via short-form (Pattern 3 collision)
      team2_player2_name: 'G. Rubio',
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, undefined,
      { bracketOverlay },
    );
    // p2p1: bracket scan finds only "Javier Ruiz Gonzalez" consistent with "J. Ruiz" → upgrade
    expect(resolved.p2p1).toBe('uuid-javier');
    expect(resolved.tiers?.p2p1).toBe('bracket_overlay');
    // p2p2: same scan finds only "Gonzalo Rubio" consistent with "G. Rubio" → upgrade
    expect(resolved.p2p2).toBe('uuid-gonzalo');
    expect(resolved.tiers?.p2p2).toBe('bracket_overlay');
  });

  it('does not fire bracket_overlay when multiple bracket names are consistent (ambiguous)', () => {
    // Hypothetical: bracket has two "J. Something" names; OOP "J. Ruiz" matches both initials but neither uniquely
    // Use Jorge Nieto Ruiz + Javier Ruiz Gonzalez — both have initial J + surname token "ruiz"
    const bracketOverlay = {
      team1_player1_name: null,
      team1_player2_name: null,
      team2_player1_name: 'Jorge Nieto Ruiz',
      team2_player2_name: 'Javier Ruiz Gonzalez',
      team1_fip_id: null,
      team2_fip_id: null,
    };
    const draw = {
      team1_player1_name: null, team1_player2_name: null,
      team2_player1_name: 'J. Ruiz',
      team2_player2_name: null,
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, undefined,
      { bracketOverlay },
    );
    // Two consistent candidates → bracket overlay declines → falls to short_form
    // (which is also ambiguous after PR #313's Pattern 3 → null)
    expect(resolved.p2p1).toBe(null);
    expect(resolved.tiers?.p2p1).toBe('unresolved');
  });

  it('preserves back-compat: no options arg means no tiers field (legacy callers untouched)', () => {
    const draw = {
      team1_player1_name: 'Gonzalo Rubio',
      team1_player2_name: null,
      team2_player1_name: null,
      team2_player2_name: null,
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId,
    );
    expect(resolved.p1p1).toBe('uuid-gonzalo');
    expect(resolved.tiers).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t "tier-aware Pass 1"
```

Expected: failures around tier field being undefined / unknown options arg.

- [ ] **Step 3: Refactor types + `resolveFourPlayers` for Pass 1 with tiers**

In `padelgod/src/workers/fip-draw-populator.ts`, find the existing `ResolvedFour` interface (search for `interface ResolvedFour` — it's near `resolveFourPlayers`). Replace it:

```typescript
export type Tier =
  | 'exact_long'
  | 'bracket_overlay'
  | 'short_unique'
  | 'partner_anchor'
  | 'unresolved';

export interface ResolvedFour {
  p1p1: string | null;
  p1p2: string | null;
  p2p1: string | null;
  p2p2: string | null;
  // Populated only when caller passes the options arg in resolveFourPlayers.
  // Legacy callers (no options) get undefined — back-compat with the
  // existing 78 tests.
  tiers?: {
    p1p1: Tier;
    p1p2: Tier;
    p2p1: Tier;
    p2p2: Tier;
  };
}

export interface ResolveOptions {
  /** Per-fip_id partner index from buildPairIndex. Enables Pass 2. */
  fipIdToPartner?: Map<string, { partnerFipId: string | null; partnerNormName: string }>;
  /** Per-match bracket long-form names from buildBracketOverlay. */
  bracketOverlay?: BracketOverlayEntry;
}
```

Then replace the `resolveFourPlayers` function body with the new tier-aware Pass 1 version. Find the existing function (search `export function resolveFourPlayers`) and replace the entire function body:

```typescript
export function resolveFourPlayers(
  d: DrawRow,
  nameToFipId: Map<string, string>,
  shortFormToFipId: Map<string, string | null>,
  fipIdToPlayerId: Map<string, string>,
  logger?: Logger,
  options?: ResolveOptions,
): ResolvedFour {
  const useTiers = options != null;
  const bracketOverlay = options?.bracketOverlay;
  const bracketPool = bracketOverlay
    ? [
        bracketOverlay.team1_player1_name,
        bracketOverlay.team1_player2_name,
        bracketOverlay.team2_player1_name,
        bracketOverlay.team2_player2_name,
      ].filter((n): n is string => !!n)
    : [];

  // Per-slot lookup. Returns { fipId, tier } where tier is the new tier
  // tag and fipId is null when nothing resolved.
  const lookup = (name: string | null): { fipId: string | null; tier: Tier } => {
    if (!name) return { fipId: null, tier: 'unresolved' };
    const norm = normalizeName(name);

    // Tier 1: exact long-form
    const exact = nameToFipId.get(norm);
    if (exact) return { fipId: fipIdToPlayerId.get(exact) ?? null, tier: 'exact_long' };

    // Tier 2: bracket overlay — exactly one consistent name in the pool
    if (bracketPool.length > 0) {
      const matches = bracketPool.filter((b) => isShortFormConsistentWith(name, b));
      if (matches.length === 1) {
        const longForm = matches[0]!;
        const fipId = nameToFipId.get(normalizeName(longForm));
        if (fipId) {
          return { fipId: fipIdToPlayerId.get(fipId) ?? null, tier: 'bracket_overlay' };
        }
      }
    }

    // Tier 3: short-form lookup (Pattern 1/2/3 from PR #313)
    if (shortFormToFipId.has(norm)) {
      const sfFipId = shortFormToFipId.get(norm) ?? null;
      if (sfFipId == null) {
        logger?.warn(
          { name },
          'fip-draw-populator: short-form name is ambiguous — leaving unresolved',
        );
        return { fipId: null, tier: 'unresolved' };
      }
      return { fipId: fipIdToPlayerId.get(sfFipId) ?? null, tier: 'short_unique' };
    }

    // Tier 3b: middle-strip / prefix fallback (existing logic, same tier as short_unique)
    const tokens = norm.split(' ').filter(Boolean);
    if (tokens.length >= 3) {
      const candidates = new Set<string>();
      for (let skip = 1; skip < tokens.length - 1; skip++) {
        const candidate = [
          ...tokens.slice(0, skip),
          ...tokens.slice(skip + 1),
        ].join(' ');
        const cFipId = nameToFipId.get(candidate);
        if (cFipId) candidates.add(cFipId);
      }
      for (let len = tokens.length - 1; len >= 2; len--) {
        const prefix = tokens.slice(0, len).join(' ');
        const pFipId = nameToFipId.get(prefix);
        if (pFipId) candidates.add(pFipId);
      }
      if (candidates.size > 1) {
        logger?.warn(
          { name, candidates: Array.from(candidates) },
          'fip-draw-populator: middle-strip/prefix match is ambiguous — leaving unresolved',
        );
        return { fipId: null, tier: 'unresolved' };
      }
      if (candidates.size === 1) {
        const only = candidates.values().next().value as string;
        return { fipId: fipIdToPlayerId.get(only) ?? null, tier: 'short_unique' };
      }
    }

    return { fipId: null, tier: 'unresolved' };
  };

  const r1 = lookup(d.team1_player1_name);
  const r2 = lookup(d.team1_player2_name);
  const r3 = lookup(d.team2_player1_name);
  const r4 = lookup(d.team2_player2_name);

  const out: ResolvedFour = {
    p1p1: r1.fipId,
    p1p2: r2.fipId,
    p2p1: r3.fipId,
    p2p2: r4.fipId,
  };
  if (useTiers) {
    out.tiers = {
      p1p1: r1.tier,
      p1p2: r2.tier,
      p2p1: r3.tier,
      p2p2: r4.tier,
    };
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts
```

Expected: all new Pass 1 tier tests pass; existing 78+ tests stay green (back-compat via `useTiers` flag).

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/fip-draw-populator.ts padelgod/src/__tests__/workers/fip-draw-populator.test.ts
git commit -m "$(cat <<'EOF'
feat(fip-draw-populator): tier-aware Pass 1 with bracket overlay

Refactors resolveFourPlayers to emit Tier per slot and accept a
ResolveOptions arg carrying the bracket overlay. Pass 1 order:
exact_long → bracket_overlay → short_unique → middle-strip. Bracket
overlay fires only when EXACTLY ONE of the 4 bracket names is
consistent with the OOP shorthand AND resolves via nameToFipId —
ambiguous matches fall through. Back-compat preserved: legacy callers
without options arg get the old return shape (no tiers field) and
identical resolution semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Pass 2 — partner-anchor sweep (happy path)

**Files:**
- Modify: `padelgod/src/workers/fip-draw-populator.ts`
- Test: `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`

When exactly one slot in a pair is resolved AND the unresolved slot's OOP shorthand is consistent with the resolved slot's entry-list partner, assign the partner's fip_id at tier `partner_anchor`.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('resolveFourPlayers — Pass 2 partner-anchor', () => {
  // Real BA P1 MD042 setup: J. Ruiz / G. Rubio short-forms, no bracket overlay
  const nameToFipId = new Map<string, string>([
    ['javier ruiz gonzalez', 'fip-P000021'],
    ['jorge nieto ruiz', 'fip-P000017'],
    ['gonzalo rubio', 'fip-P000029'],
    ['jon sanz', 'fip-P000038'],
    ['santiago pineda cabello', 'fip-P100958'],
    ['diego garcia garcia', 'fip-P101099'],
  ]);
  const shortFormToFipId = buildShortFormMap(nameToFipId);
  const fipIdToPlayerId = new Map<string, string>([
    ['fip-P000021', 'uuid-javier'],
    ['fip-P000017', 'uuid-jorge'],
    ['fip-P000029', 'uuid-gonzalo'],
    ['fip-P000038', 'uuid-jon'],
    ['fip-P100958', 'uuid-pineda'],
    ['fip-P101099', 'uuid-diego'],
  ]);
  const fipIdToPartner = new Map<string, { partnerFipId: string | null; partnerNormName: string }>([
    ['fip-P000029', { partnerFipId: 'fip-P000021', partnerNormName: 'javier ruiz gonzalez' }],
    ['fip-P000021', { partnerFipId: 'fip-P000029', partnerNormName: 'gonzalo rubio' }],
    ['fip-P000017', { partnerFipId: 'fip-P000038', partnerNormName: 'jon sanz' }],
    ['fip-P000038', { partnerFipId: 'fip-P000017', partnerNormName: 'jorge nieto ruiz' }],
    ['fip-P100958', { partnerFipId: 'fip-P101099', partnerNormName: 'diego garcia garcia' }],
    ['fip-P101099', { partnerFipId: 'fip-P100958', partnerNormName: 'santiago pineda cabello' }],
  ]);

  it('resolves "J. Ruiz" to Javier Ruiz Gonzalez via partner-anchor when sibling Rubio is resolved', () => {
    const draw = {
      team1_player1_name: 'S. Pineda Cabello',
      team1_player2_name: 'D. Garcia Garcia',
      team2_player1_name: 'J. Ruiz',   // Pattern 3 ambiguity → null after Pass 1
      team2_player2_name: 'G. Rubio',  // unique via short_unique
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, undefined,
      { fipIdToPartner },
    );
    expect(resolved.p2p1).toBe('uuid-javier');
    expect(resolved.tiers?.p2p1).toBe('partner_anchor');
    expect(resolved.p2p2).toBe('uuid-gonzalo');
  });

  it('does not fire partner-anchor when the unresolved slot is missing (sibling has no partner info)', () => {
    // Remove Rubio's partner info — anchor should not fire
    const noPartner = new Map(fipIdToPartner);
    noPartner.delete('fip-P000029');
    const draw = {
      team1_player1_name: null, team1_player2_name: null,
      team2_player1_name: 'J. Ruiz',
      team2_player2_name: 'G. Rubio',
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, undefined,
      { fipIdToPartner: noPartner },
    );
    expect(resolved.p2p1).toBe(null);
    expect(resolved.tiers?.p2p1).toBe('unresolved');
  });

  it('does not fire partner-anchor when both slots are already resolved unambiguously', () => {
    const draw = {
      team1_player1_name: null, team1_player2_name: null,
      team2_player1_name: 'Javier Ruiz Gonzalez',  // exact long-form
      team2_player2_name: 'Gonzalo Rubio',          // exact long-form
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, undefined,
      { fipIdToPartner },
    );
    expect(resolved.tiers?.p2p1).toBe('exact_long');
    expect(resolved.tiers?.p2p2).toBe('exact_long');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t "Pass 2 partner-anchor"
```

Expected: `p2p1` resolves to `null` (not `uuid-javier`) — Pass 2 sweep not implemented yet.

- [ ] **Step 3: Add Pass 2 partner-anchor logic to `resolveFourPlayers`**

In `padelgod/src/workers/fip-draw-populator.ts`, find the end of the new `resolveFourPlayers` body where `out` is built. Add Pass 2 BEFORE the `return out;` statement. The full Pass 2 block (we'll extend it in Tasks 6 + 7):

```typescript
  // Pass 2 — pair-anchor sweep. Only runs when caller passes
  // fipIdToPartner via options. For each of the two pairs:
  //   - If exactly one slot resolved AND the unresolved slot's raw
  //     shorthand is consistent with the resolved slot's entry-list
  //     partner → assign the partner's fip_id at tier 'partner_anchor'.
  const fipIdToPartner = options?.fipIdToPartner;
  if (useTiers && fipIdToPartner) {
    const slotsByPair: Array<{
      anchorTier: Tier | undefined;
      anchorFipId: string | null;
      anchorRawName: string | null;
      otherTier: Tier | undefined;
      otherFipId: string | null;
      otherRawName: string | null;
      assignOther: (fipId: string | null, tier: Tier) => void;
    }> = [
      {
        anchorTier: out.tiers?.p1p1,
        anchorFipId: out.p1p1,
        anchorRawName: d.team1_player1_name,
        otherTier: out.tiers?.p1p2,
        otherFipId: out.p1p2,
        otherRawName: d.team1_player2_name,
        assignOther: (fk, tier) => { out.p1p2 = fk; if (out.tiers) out.tiers.p1p2 = tier; },
      },
      {
        anchorTier: out.tiers?.p1p2,
        anchorFipId: out.p1p2,
        anchorRawName: d.team1_player2_name,
        otherTier: out.tiers?.p1p1,
        otherFipId: out.p1p1,
        otherRawName: d.team1_player1_name,
        assignOther: (fk, tier) => { out.p1p1 = fk; if (out.tiers) out.tiers.p1p1 = tier; },
      },
      {
        anchorTier: out.tiers?.p2p1,
        anchorFipId: out.p2p1,
        anchorRawName: d.team2_player1_name,
        otherTier: out.tiers?.p2p2,
        otherFipId: out.p2p2,
        otherRawName: d.team2_player2_name,
        assignOther: (fk, tier) => { out.p2p2 = fk; if (out.tiers) out.tiers.p2p2 = tier; },
      },
      {
        anchorTier: out.tiers?.p2p2,
        anchorFipId: out.p2p2,
        anchorRawName: d.team2_player2_name,
        otherTier: out.tiers?.p2p1,
        otherFipId: out.p2p1,
        otherRawName: d.team2_player1_name,
        assignOther: (fk, tier) => { out.p2p1 = fk; if (out.tiers) out.tiers.p2p1 = tier; },
      },
    ];

    // Map the resolved player UUID back to the underlying fip_id so we
    // can look up its entry-list partner.
    const playerIdToFipId = new Map<string, string>();
    for (const [fipId, playerId] of fipIdToPlayerId) playerIdToFipId.set(playerId, fipId);

    for (const slot of slotsByPair) {
      if (slot.anchorFipId == null) continue;        // anchor not resolved → can't anchor
      if (slot.otherFipId != null) continue;          // other already resolved → no work
      if (!slot.otherRawName) continue;               // no shorthand to validate against

      const anchorFip = playerIdToFipId.get(slot.anchorFipId);
      if (!anchorFip) continue;

      const partner = fipIdToPartner.get(anchorFip);
      if (!partner || !partner.partnerNormName) continue;

      if (isShortFormConsistentWith(slot.otherRawName, partner.partnerNormName)) {
        const partnerFip = partner.partnerFipId;
        if (partnerFip) {
          const partnerPlayerId = fipIdToPlayerId.get(partnerFip);
          if (partnerPlayerId) {
            slot.assignOther(partnerPlayerId, 'partner_anchor');
            logger?.info(
              {
                slot: '<see telemetry payload>',
                anchorFipId: anchorFip,
                anchorTier: slot.anchorTier,
                partnerFipId: partnerFip,
                rawShortForm: slot.otherRawName,
                partnerNormName: partner.partnerNormName,
              },
              'partner_anchor_resolved',
            );
          }
        }
      }
    }
  }
```

(Note: the literal `'<see telemetry payload>'` placeholder gets replaced when Task 7 adds the proper slot-identity tracking. For now this satisfies the happy-path test.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts
```

Expected: 3 new Pass 2 partner-anchor tests pass; existing tests stay green.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/fip-draw-populator.ts padelgod/src/__tests__/workers/fip-draw-populator.test.ts
git commit -m "$(cat <<'EOF'
feat(fip-draw-populator): Pass 2 partner-anchor sweep

When exactly one slot in a pair is resolved and the unresolved slot's
OOP shorthand is consistent with the resolved slot's entry-list
partner name, assign the partner's fip_id at tier partner_anchor.
Replicates the BA P1 MD042 fix without depending on Pattern 3's
null-fallback. Mis-pair sanity check + suspected_late_swap telemetry
ship in Tasks 6-7.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Pass 2 — mis-pair sanity check

**Files:**
- Modify: `padelgod/src/workers/fip-draw-populator.ts`
- Test: `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`

When both slots in a pair resolve but they're not entry-list partners of each other, drop the lower-confidence slot. Equal tiers → drop both.

- [ ] **Step 1: Write the failing tests**

```typescript
describe('resolveFourPlayers — Pass 2 mis-pair sanity', () => {
  const nameToFipId = new Map<string, string>([
    ['javier ruiz gonzalez', 'fip-P000021'],
    ['jorge nieto ruiz', 'fip-P000017'],
    ['gonzalo rubio', 'fip-P000029'],
    ['jon sanz', 'fip-P000038'],
  ]);
  const shortFormToFipId = buildShortFormMap(nameToFipId);
  const fipIdToPlayerId = new Map<string, string>([
    ['fip-P000021', 'uuid-javier'],
    ['fip-P000017', 'uuid-jorge'],
    ['fip-P000029', 'uuid-gonzalo'],
    ['fip-P000038', 'uuid-jon'],
  ]);
  const fipIdToPartner = new Map<string, { partnerFipId: string | null; partnerNormName: string }>([
    ['fip-P000029', { partnerFipId: 'fip-P000021', partnerNormName: 'javier ruiz gonzalez' }],
    ['fip-P000021', { partnerFipId: 'fip-P000029', partnerNormName: 'gonzalo rubio' }],
    ['fip-P000017', { partnerFipId: 'fip-P000038', partnerNormName: 'jon sanz' }],
    ['fip-P000038', { partnerFipId: 'fip-P000017', partnerNormName: 'jorge nieto ruiz' }],
  ]);

  it('drops the lower-confidence slot when both resolve but are not entry-list partners', () => {
    // Build a 1-token-Ruiz collision via the nameToFipId map directly
    // (skip Pattern 3 for this test setup). Inject "Jorge Nieto Ruiz" as
    // also generating "j. ruiz" short-form by adding to shortFormToFipId.
    const customShortForm = new Map(shortFormToFipId);
    customShortForm.set('j. ruiz', 'fip-P000017'); // map "J. Ruiz" → Jorge Nieto Ruiz (the bug)
    const draw = {
      team1_player1_name: null, team1_player2_name: null,
      team2_player1_name: 'J. Ruiz',  // resolves to Jorge Nieto Ruiz (short_unique)
      team2_player2_name: 'Gonzalo Rubio',  // resolves exactly (exact_long)
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, customShortForm, fipIdToPlayerId, undefined,
      { fipIdToPartner },
    );
    // Mis-pair detected: Jorge's partner is Jon, not Gonzalo. Rubio's
    // anchor is exact_long (higher tier than Jorge's short_unique) →
    // drop Jorge to unresolved, keep Rubio.
    expect(resolved.p2p1).toBe(null);
    expect(resolved.tiers?.p2p1).toBe('unresolved');
    expect(resolved.p2p2).toBe('uuid-gonzalo');
    expect(resolved.tiers?.p2p2).toBe('exact_long');
  });

  it('drops both slots when mis-paired AND tiers are equal', () => {
    // Both slots resolve at short_unique tier, but they're not partners.
    const customShortForm = new Map(shortFormToFipId);
    customShortForm.set('j. ruiz', 'fip-P000017');  // Jorge Nieto Ruiz
    customShortForm.set('g. rubio', 'fip-P000029'); // Gonzalo Rubio
    const draw = {
      team1_player1_name: null, team1_player2_name: null,
      team2_player1_name: 'J. Ruiz',
      team2_player2_name: 'G. Rubio',
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, customShortForm, fipIdToPlayerId, undefined,
      { fipIdToPartner },
    );
    // Both short_unique tier, not partners → drop both
    expect(resolved.p2p1).toBe(null);
    expect(resolved.tiers?.p2p1).toBe('unresolved');
    expect(resolved.p2p2).toBe(null);
    expect(resolved.tiers?.p2p2).toBe('unresolved');
  });

  it('keeps both slots when they are entry-list partners (no mis-pair)', () => {
    const draw = {
      team1_player1_name: null, team1_player2_name: null,
      team2_player1_name: 'Javier Ruiz Gonzalez',
      team2_player2_name: 'Gonzalo Rubio',
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, undefined,
      { fipIdToPartner },
    );
    expect(resolved.p2p1).toBe('uuid-javier');
    expect(resolved.p2p2).toBe('uuid-gonzalo');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t "Pass 2 mis-pair"
```

Expected: first two tests fail (Jorge stays resolved instead of being dropped).

- [ ] **Step 3: Add mis-pair sanity check to Pass 2**

In `padelgod/src/workers/fip-draw-populator.ts`, BEFORE the partner-anchor sweep loop in Pass 2 (right after `playerIdToFipId` is built), add a tier-priority helper and the mis-pair sweep. Insert this BEFORE the `for (const slot of slotsByPair)` loop from Task 5:

```typescript
    const tierRank: Record<Tier, number> = {
      exact_long: 4,
      bracket_overlay: 3,
      short_unique: 2,
      partner_anchor: 1,
      unresolved: 0,
    };

    // Mis-pair sanity check. For each pair, if both slots resolved and
    // they're NOT entry-list partners, drop the lower-tier slot (or
    // both when tiers are equal).
    const pairsForMispair: Array<{
      aTier: Tier | undefined; aFipId: string | null;
      bTier: Tier | undefined; bFipId: string | null;
      dropA: () => void;
      dropB: () => void;
    }> = [
      {
        aTier: out.tiers?.p1p1, aFipId: out.p1p1,
        bTier: out.tiers?.p1p2, bFipId: out.p1p2,
        dropA: () => { out.p1p1 = null; if (out.tiers) out.tiers.p1p1 = 'unresolved'; },
        dropB: () => { out.p1p2 = null; if (out.tiers) out.tiers.p1p2 = 'unresolved'; },
      },
      {
        aTier: out.tiers?.p2p1, aFipId: out.p2p1,
        bTier: out.tiers?.p2p2, bFipId: out.p2p2,
        dropA: () => { out.p2p1 = null; if (out.tiers) out.tiers.p2p1 = 'unresolved'; },
        dropB: () => { out.p2p2 = null; if (out.tiers) out.tiers.p2p2 = 'unresolved'; },
      },
    ];

    for (const pair of pairsForMispair) {
      if (pair.aFipId == null || pair.bFipId == null) continue;
      const aFip = playerIdToFipId.get(pair.aFipId);
      const bFip = playerIdToFipId.get(pair.bFipId);
      if (!aFip || !bFip) continue;
      const aPartner = fipIdToPartner.get(aFip);
      // Mis-pair detected when A's entry-list partner is NOT B
      if (aPartner && aPartner.partnerFipId && aPartner.partnerFipId !== bFip) {
        const aRank = tierRank[pair.aTier ?? 'unresolved'];
        const bRank = tierRank[pair.bTier ?? 'unresolved'];
        if (aRank > bRank) {
          pair.dropB();
          logger?.warn(
            { keptTier: pair.aTier, droppedTier: pair.bTier, keptFipId: aFip, droppedFipId: bFip },
            'mispair_detected',
          );
        } else if (bRank > aRank) {
          pair.dropA();
          logger?.warn(
            { keptTier: pair.bTier, droppedTier: pair.aTier, keptFipId: bFip, droppedFipId: aFip },
            'mispair_detected',
          );
        } else {
          pair.dropA();
          pair.dropB();
          logger?.warn(
            { keptTier: null, droppedTier: pair.aTier, droppedFipIds: [aFip, bFip] },
            'mispair_detected',
          );
        }
      }
    }
```

The partner-anchor sweep stays as it was. Run order is mis-pair sanity FIRST (so partner-anchor can refill the dropped slot in a subsequent sweep).

Wait — to keep mis-pair-then-anchor working in one pass, the partner-anchor loop iterates over the same `slotsByPair` array which reads from `out` at iteration time. Since mis-pair runs first and mutates `out`, the anchor sweep will see the updated state. Good.

But `slotsByPair` was built BEFORE the mis-pair sweep ran. The fields like `anchorTier` and `anchorFipId` are captured by value at the time `slotsByPair` was created. We need to rebuild them after mis-pair, OR read them lazily from `out` at iteration time.

Adjust: replace the `slotsByPair` building from Task 5 with a lazy version. Update the Task 5 block:

Replace:
```typescript
    const slotsByPair: Array<{ ... }> = [ /* fixed values */ ];
```

With:
```typescript
    const slotsByPair = [
      { anchor: 'p1p1', other: 'p1p2' },
      { anchor: 'p1p2', other: 'p1p1' },
      { anchor: 'p2p1', other: 'p2p2' },
      { anchor: 'p2p2', other: 'p2p1' },
    ] as const;

    const rawNameFor = (slot: 'p1p1' | 'p1p2' | 'p2p1' | 'p2p2'): string | null => {
      switch (slot) {
        case 'p1p1': return d.team1_player1_name;
        case 'p1p2': return d.team1_player2_name;
        case 'p2p1': return d.team2_player1_name;
        case 'p2p2': return d.team2_player2_name;
      }
    };
```

And then the partner-anchor loop body becomes:

```typescript
    for (const { anchor, other } of slotsByPair) {
      const anchorFipId = out[anchor];
      const otherFipId = out[other];
      if (anchorFipId == null) continue;
      if (otherFipId != null) continue;
      const otherRawName = rawNameFor(other);
      if (!otherRawName) continue;

      const anchorFip = playerIdToFipId.get(anchorFipId);
      if (!anchorFip) continue;
      const partner = fipIdToPartner.get(anchorFip);
      if (!partner || !partner.partnerNormName) continue;

      if (isShortFormConsistentWith(otherRawName, partner.partnerNormName)) {
        const partnerFip = partner.partnerFipId;
        if (partnerFip) {
          const partnerPlayerId = fipIdToPlayerId.get(partnerFip);
          if (partnerPlayerId) {
            out[other] = partnerPlayerId;
            if (out.tiers) out.tiers[other] = 'partner_anchor';
            logger?.info(
              {
                slot: other,
                anchorFipId: anchorFip,
                anchorTier: out.tiers?.[anchor],
                partnerFipId: partnerFip,
                rawShortForm: otherRawName,
                partnerNormName: partner.partnerNormName,
              },
              'partner_anchor_resolved',
            );
          }
        }
      }
    }
```

This lazily reads `out[anchor]` / `out[other]` at iteration time, so it correctly sees post-mis-pair state. The slot-identity strings flow into the telemetry payload too.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts
```

Expected: all mis-pair tests pass; partner-anchor tests still pass; existing tests stay green.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/fip-draw-populator.ts padelgod/src/__tests__/workers/fip-draw-populator.test.ts
git commit -m "$(cat <<'EOF'
feat(fip-draw-populator): Pass 2 mis-pair sanity check

When both slots in a pair resolve but their entry-list partner index
disagrees, drop the lower-tier slot (or both when tiers are equal).
Tier ranking: exact_long > bracket_overlay > short_unique >
partner_anchor > unresolved. Mis-pair sweep runs before partner-anchor
so the anchor pass can refill the dropped slot in the same call.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Pass 2 — suspected late-swap telemetry

**Files:**
- Modify: `padelgod/src/workers/fip-draw-populator.ts`
- Test: `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`

When the partner-anchor pass would have fired but the OOP shorthand surname doesn't match the entry-list partner's surname (initials still agree), emit `suspected_late_swap` and leave the slot unresolved.

- [ ] **Step 1: Write the failing test**

```typescript
describe('resolveFourPlayers — Pass 2 suspected late swap', () => {
  const nameToFipId = new Map<string, string>([
    ['javier ruiz gonzalez', 'fip-P000021'],
    ['gonzalo rubio', 'fip-P000029'],
  ]);
  const shortFormToFipId = buildShortFormMap(nameToFipId);
  const fipIdToPlayerId = new Map<string, string>([
    ['fip-P000021', 'uuid-javier'],
    ['fip-P000029', 'uuid-gonzalo'],
  ]);
  const fipIdToPartner = new Map<string, { partnerFipId: string | null; partnerNormName: string }>([
    ['fip-P000029', { partnerFipId: 'fip-P000021', partnerNormName: 'javier ruiz gonzalez' }],
    ['fip-P000021', { partnerFipId: 'fip-P000029', partnerNormName: 'gonzalo rubio' }],
  ]);

  it('emits suspected_late_swap and leaves slot null when OOP partner shorthand initials match but surname does not', () => {
    const warnSpy = vi.fn();
    const logger = { info: vi.fn(), warn: warnSpy, debug: vi.fn() } as never;

    const draw = {
      team1_player1_name: null, team1_player2_name: null,
      team2_player1_name: 'J. Rubini',  // initial J matches Javier but surname Rubini ≠ Ruiz / Gonzalez
      team2_player2_name: 'G. Rubio',
    } as never;
    const resolved = resolveFourPlayers(
      draw, nameToFipId, shortFormToFipId, fipIdToPlayerId, logger,
      { fipIdToPartner },
    );

    expect(resolved.p2p1).toBe(null);
    expect(resolved.tiers?.p2p1).toBe('unresolved');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        slot: 'p2p1',
        rawShortForm: 'J. Rubini',
        expectedPartnerNormName: 'javier ruiz gonzalez',
        expectedPartnerFipId: 'fip-P000021',
      }),
      'suspected_late_swap',
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t "suspected late swap"
```

Expected: `warnSpy` was not called with `'suspected_late_swap'`.

- [ ] **Step 3: Add late-swap branch to partner-anchor sweep**

In the partner-anchor loop (Task 5 / Task 6), find the `if (isShortFormConsistentWith(...))` block. Replace it with this expanded form that handles the late-swap case:

```typescript
      if (isShortFormConsistentWith(otherRawName, partner.partnerNormName)) {
        const partnerFip = partner.partnerFipId;
        if (partnerFip) {
          const partnerPlayerId = fipIdToPlayerId.get(partnerFip);
          if (partnerPlayerId) {
            out[other] = partnerPlayerId;
            if (out.tiers) out.tiers[other] = 'partner_anchor';
            logger?.info(
              {
                slot: other,
                anchorFipId: anchorFip,
                anchorTier: out.tiers?.[anchor],
                partnerFipId: partnerFip,
                rawShortForm: otherRawName,
                partnerNormName: partner.partnerNormName,
              },
              'partner_anchor_resolved',
            );
          }
        }
      } else if (doShortFormInitialsMatch(otherRawName, partner.partnerNormName)) {
        // Initials match but surname doesn't — likely a real late swap.
        // Decline the anchor and emit telemetry for ops review.
        logger?.warn(
          {
            slot: other,
            rawShortForm: otherRawName,
            expectedPartnerNormName: partner.partnerNormName,
            expectedPartnerFipId: partner.partnerFipId,
          },
          'suspected_late_swap',
        );
      }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t "suspected late swap"
```

Expected: test passes. Run the full file to confirm nothing else regressed:

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/fip-draw-populator.ts padelgod/src/__tests__/workers/fip-draw-populator.test.ts
git commit -m "$(cat <<'EOF'
feat(fip-draw-populator): Pass 2 suspected_late_swap telemetry

When the partner-anchor pass declines because the OOP shorthand
surname disagrees with the entry-list partner's surname (initials
still match), emit suspected_late_swap warn telemetry and leave the
slot unresolved. Ops can review these for genuine bracket changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Wire new helpers into `runFipDrawPopulator`

**Files:**
- Modify: `padelgod/src/workers/fip-draw-populator.ts`
- Test: `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`

Build `pairIndex` and `bracketOverlay` once per tournament. Pass `bracketOverlay.get(d.match_widget_id) ?? undefined` and `pairIndex.fipIdToPartner` to `resolveFourPlayers` via the new options arg.

- [ ] **Step 1: Write the failing integration tests**

Append to the test file (near the existing `runFipDrawPopulator` integration tests):

```typescript
describe('runFipDrawPopulator — pair-aware resolver wiring', () => {
  it('inserts MD042 with Javier Ruiz Gonzalez via partner-anchor (no bracket overlay)', async () => {
    // Setup: entry list has Rubio + Javier as partners + Pineda/Garcia in qualifying;
    //        no bracket draw_snapshot for MD042 (or only OOP-merged);
    //        OOP delivers MD042 with short-form "J. Ruiz / G. Rubio"
    //        Expected: insert lands with pair2_player1_id = uuid-javier
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'BA P1', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [],
      oop: [
        {
          tournament_id: TOURNAMENT_ID,
          match_widget_id: 'MD042',
          category: 'men',
          round_label: 'R64',
          team1_player1_name: 'S. Pineda Cabello',
          team1_player2_name: 'D. Garcia Garcia',
          team2_player1_name: 'J. Ruiz',
          team2_player2_name: 'G. Rubio',
          captured_at: '2026-05-11T22:00:00Z',
        },
      ],
      entryList: [
        { name: 'Javier Ruiz Gonzalez', fip_id: 'fip-P000021', category: 'men',
          partner_fip_id: 'fip-P000029', partner_name: 'Gonzalo Rubio',
          captured_at: '2026-05-12T05:00:00Z', draw_type: 'main_draw' },
        { name: 'Gonzalo Rubio', fip_id: 'fip-P000029', category: 'men',
          partner_fip_id: 'fip-P000021', partner_name: 'Javier Ruiz Gonzalez',
          captured_at: '2026-05-12T05:00:00Z', draw_type: 'main_draw' },
        { name: 'Santiago Pineda Cabello', fip_id: 'fip-P100958', category: 'men',
          partner_fip_id: 'fip-P101099', partner_name: 'Diego Garcia Garcia',
          captured_at: '2026-05-12T05:00:00Z', draw_type: 'qualifying' },
        { name: 'Diego Garcia Garcia', fip_id: 'fip-P101099', category: 'men',
          partner_fip_id: 'fip-P100958', partner_name: 'Santiago Pineda Cabello',
          captured_at: '2026-05-12T05:00:00Z', draw_type: 'qualifying' },
      ],
      players: [
        { id: 'uuid-javier', fip_id: 'fip-P000021' },
        { id: 'uuid-gonzalo', fip_id: 'fip-P000029' },
        { id: 'uuid-pineda', fip_id: 'fip-P100958' },
        { id: 'uuid-diego', fip_id: 'fip-P101099' },
      ],
    });
    await runFipDrawPopulator({ supabase: supabase as any, dryRun: false });
    const inserted = supabase.matchesInserted();
    const md042 = inserted.find((m: any) => m.widget_id_composite === `${TOURNAMENT_WIDGET}:MD042`);
    expect(md042).toBeDefined();
    expect(md042.pair2_player1_id).toBe('uuid-javier');
    expect(md042.pair2_player2_id).toBe('uuid-gonzalo');
  });

  it('inserts MD042 via bracket overlay when fip_event_page draw_snapshot has long-form names for one side', async () => {
    const supabase = fakeSupabase({
      tournaments: [
        { tournament_id: TOURNAMENT_ID, tournament_name: 'BA P1', slug: TOURNAMENT_SLUG },
      ],
      widgetCodeByTournament: { [TOURNAMENT_ID]: TOURNAMENT_WIDGET },
      draws: [
        // Bye-skipped walkover row with long-form t2 names
        {
          tournament_id: TOURNAMENT_ID,
          match_widget_id: 'MD042',
          category: 'men',
          round_label: 'R64',
          team1_player1_name: null,
          team1_player2_name: null,
          team2_player1_name: 'Gonzalo Rubio',
          team2_player2_name: 'Javier Ruiz Gonzalez',
          team1_fip_id: null,
          team2_fip_id: null,
          team1_seed: null,
          team2_seed: null,
          status: 'walkover',
          captured_at: '2026-05-11T08:00:00Z',
          source: 'fip_event_page',
        },
      ],
      oop: [
        {
          tournament_id: TOURNAMENT_ID,
          match_widget_id: 'MD042',
          category: 'men',
          round_label: 'R64',
          team1_player1_name: 'S. Pineda Cabello',
          team1_player2_name: 'D. Garcia Garcia',
          team2_player1_name: 'J. Ruiz',
          team2_player2_name: 'G. Rubio',
          captured_at: '2026-05-11T22:00:00Z',
        },
      ],
      entryList: [
        // Entry list does NOT include partner info for Rubio — so partner-anchor can't fire.
        // Bracket overlay carries the load.
        { name: 'Javier Ruiz Gonzalez', fip_id: 'fip-P000021', category: 'men',
          partner_fip_id: null, partner_name: null,
          captured_at: '2026-05-12T05:00:00Z', draw_type: 'main_draw' },
        { name: 'Gonzalo Rubio', fip_id: 'fip-P000029', category: 'men',
          partner_fip_id: null, partner_name: null,
          captured_at: '2026-05-12T05:00:00Z', draw_type: 'main_draw' },
        { name: 'Santiago Pineda Cabello', fip_id: 'fip-P100958', category: 'men',
          partner_fip_id: null, partner_name: null,
          captured_at: '2026-05-12T05:00:00Z', draw_type: 'qualifying' },
        { name: 'Diego Garcia Garcia', fip_id: 'fip-P101099', category: 'men',
          partner_fip_id: null, partner_name: null,
          captured_at: '2026-05-12T05:00:00Z', draw_type: 'qualifying' },
      ],
      players: [
        { id: 'uuid-javier', fip_id: 'fip-P000021' },
        { id: 'uuid-gonzalo', fip_id: 'fip-P000029' },
        { id: 'uuid-pineda', fip_id: 'fip-P100958' },
        { id: 'uuid-diego', fip_id: 'fip-P101099' },
      ],
    });
    await runFipDrawPopulator({ supabase: supabase as any, dryRun: false });
    const inserted = supabase.matchesInserted();
    const md042 = inserted.find((m: any) => m.widget_id_composite === `${TOURNAMENT_WIDGET}:MD042`);
    expect(md042).toBeDefined();
    expect(md042.pair2_player1_id).toBe('uuid-javier');
    expect(md042.pair2_player2_id).toBe('uuid-gonzalo');
  });
});
```

(Note: the `fakeSupabase` harness used in existing integration tests may need a minor extension to support the `oop` seed source returning rows for `oop_snapshots` table and the new `partner_fip_id`/`partner_name`/`draw_type` columns on `entry_list_snapshots`, plus a `source` column on `draw_snapshots`. If the existing harness already handles these — confirm by reading `fakeSupabase` definition near line 90–340 of the test file. If columns are missing, extend the harness inline.)

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts -t "pair-aware resolver wiring"
```

Expected: failures — `inserted` is empty or has wrong FK because `runFipDrawPopulator` isn't using the new helpers yet.

- [ ] **Step 3: Wire `runFipDrawPopulator` to use new helpers**

In `padelgod/src/workers/fip-draw-populator.ts`, find the existing `runFipDrawPopulator` function body. Locate the section where `nameToFipId` and `shortFormToFipId` are built (search for `loadEntryListNameMap` — around line 606). Replace:

```typescript
    // OLD:
    const nameToFipId = await loadEntryListNameMap(supabase, t.tournament_id);
    const shortFormToFipId = buildShortFormMap(nameToFipId);
```

with:

```typescript
    // NEW: pair-aware index + bracket overlay
    const pairIndex = await buildPairIndex(supabase, t.tournament_id);
    const { nameToFipId, fipIdToPartner } = pairIndex;
    const shortFormToFipId = buildShortFormMap(nameToFipId);
    const bracketOverlay = await buildBracketOverlay(supabase, t.tournament_id);
```

Then find the call to `resolveFourPlayers` in the main loop (~line 734). Replace:

```typescript
      // OLD:
      const resolved = resolveFourPlayers(d, nameToFipId, shortFormToFipId, fipIdToPlayerId, logger);
```

with:

```typescript
      // NEW:
      const resolved = resolveFourPlayers(
        d,
        nameToFipId,
        shortFormToFipId,
        fipIdToPlayerId,
        logger,
        {
          fipIdToPartner,
          bracketOverlay: d.match_widget_id ? bracketOverlay.get(d.match_widget_id) : undefined,
        },
      );
```

- [ ] **Step 4: Run all populator tests**

```bash
cd padelgod && npm test -- src/__tests__/workers/fip-draw-populator.test.ts
```

Expected: 2 new integration tests pass; all existing tests stay green; full file ≥90 tests passing.

If `fakeSupabase` harness needs extension for `oop`/`source`/partner columns, extend it minimally and re-run.

- [ ] **Step 5: Run full padelgod suite + typecheck**

```bash
cd padelgod && npm test && npm run typecheck
```

Expected: only the 2 pre-existing failures on `main` (`fip-event-page-detail` and `player-profile`) remain. All other tests green; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/fip-draw-populator.ts padelgod/src/__tests__/workers/fip-draw-populator.test.ts
git commit -m "$(cat <<'EOF'
feat(fip-draw-populator): wire pair-aware resolver in main loop

Replaces loadEntryListNameMap with buildPairIndex; loads
buildBracketOverlay once per tournament; passes fipIdToPartner and
the per-match bracket overlay to resolveFourPlayers via the new
options arg. Two new integration tests cover the partner-anchor and
bracket-overlay paths end-to-end via fakeSupabase.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Audit script for mis-paired matches

**Files:**
- Create: `scripts/audit-mispaired-matches.ts`

One-shot operator script. Reads every `public.matches` row with both pair FKs set, cross-references against `entry_list_snapshots.partner_fip_id`, prints mismatches grouped by tournament. Dry-run by default; `--apply` flag NULLs the lower-confidence slot.

- [ ] **Step 1: Create the script**

Create `scripts/audit-mispaired-matches.ts`:

```typescript
/**
 * Audit script: find public.matches rows whose pair FKs disagree with
 * entry_list_snapshots.partner_fip_id.
 *
 * Dry-run by default. Use --apply to NULL the lower-confidence slot
 * (operator triggers the next fip-draw-populator run to re-fill).
 *
 *   npx tsx scripts/audit-mispaired-matches.ts
 *   npx tsx scripts/audit-mispaired-matches.ts --apply
 *   npx tsx scripts/audit-mispaired-matches.ts --tournament <uuid>
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

try {
  const raw = readFileSync('/Users/GuDenes/Projects/padel-live-scores/.env.local', 'utf8');
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
} catch {}

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

const APPLY = process.argv.includes('--apply');
const tournamentFlag = process.argv.indexOf('--tournament');
const TOURNAMENT_FILTER = tournamentFlag >= 0 ? process.argv[tournamentFlag + 1] : null;

interface Match {
  id: string;
  tournament_id: string;
  category: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
}

interface EntryRow {
  fip_id: string | null;
  partner_fip_id: string | null;
  category: string;
}

interface Player {
  id: string;
  fip_id: string | null;
}

async function main() {
  // 1. Load matches with both pair FKs filled
  let q = s
    .from('matches')
    .select('id, tournament_id, category, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .not('pair1_player1_id', 'is', null)
    .not('pair1_player2_id', 'is', null)
    .not('pair2_player1_id', 'is', null)
    .not('pair2_player2_id', 'is', null);
  if (TOURNAMENT_FILTER) q = q.eq('tournament_id', TOURNAMENT_FILTER);
  const { data: matches } = await q;
  console.log(`Loaded ${matches?.length ?? 0} matches with all 4 pair FKs filled${TOURNAMENT_FILTER ? ` for tournament ${TOURNAMENT_FILTER}` : ''}`);

  // 2. Build player_id → fip_id map for all FK player ids we'll touch
  const playerIds = new Set<string>();
  for (const m of (matches ?? []) as Match[]) {
    if (m.pair1_player1_id) playerIds.add(m.pair1_player1_id);
    if (m.pair1_player2_id) playerIds.add(m.pair1_player2_id);
    if (m.pair2_player1_id) playerIds.add(m.pair2_player1_id);
    if (m.pair2_player2_id) playerIds.add(m.pair2_player2_id);
  }
  const playerIdToFipId = new Map<string, string>();
  if (playerIds.size > 0) {
    const { data: players } = await s.from('players').select('id, fip_id').in('id', Array.from(playerIds));
    for (const p of (players ?? []) as Player[]) {
      if (p.fip_id) playerIdToFipId.set(p.id, p.fip_id);
    }
  }

  // 3. For each match's tournament+category, load entry-list partner map
  type TKey = string; // `${tournament_id}::${category}`
  const partnerMapCache = new Map<TKey, Map<string, string>>();
  const loadPartnerMap = async (tournamentId: string, category: string): Promise<Map<string, string>> => {
    const key: TKey = `${tournamentId}::${category}`;
    const cached = partnerMapCache.get(key);
    if (cached) return cached;
    const { data: rows } = await s
      .schema('padelgod')
      .from('entry_list_snapshots')
      .select('fip_id, partner_fip_id, category, captured_at')
      .eq('tournament_id', tournamentId)
      .eq('category', category);
    // Use latest captured_at across the category
    const max = (rows ?? []).reduce<string>((acc, r: any) => (r.captured_at > acc ? r.captured_at : acc), '');
    const map = new Map<string, string>();
    for (const r of (rows ?? []) as Array<EntryRow & { captured_at: string }>) {
      if (r.captured_at !== max) continue;
      if (r.fip_id && r.partner_fip_id) map.set(r.fip_id, r.partner_fip_id);
    }
    partnerMapCache.set(key, map);
    return map;
  };

  // 4. Compare and emit mismatches
  type Mismatch = {
    matchId: string;
    tournamentId: string;
    pairLabel: 'pair1' | 'pair2';
    slotA: string; // 'pair1_player1_id'
    slotB: string;
    fipA: string;
    fipB: string;
    expectedPartnerOfA: string;
  };
  const mismatches: Mismatch[] = [];

  for (const m of (matches ?? []) as Match[]) {
    if (!m.category) continue;
    const partnerMap = await loadPartnerMap(m.tournament_id, m.category);
    if (partnerMap.size === 0) continue;

    for (const [aCol, bCol, label] of [
      ['pair1_player1_id', 'pair1_player2_id', 'pair1'] as const,
      ['pair2_player1_id', 'pair2_player2_id', 'pair2'] as const,
    ]) {
      const aPlayerId = m[aCol] as string | null;
      const bPlayerId = m[bCol] as string | null;
      if (!aPlayerId || !bPlayerId) continue;
      const aFip = playerIdToFipId.get(aPlayerId);
      const bFip = playerIdToFipId.get(bPlayerId);
      if (!aFip || !bFip) continue;
      const expectedPartner = partnerMap.get(aFip);
      if (!expectedPartner) continue;
      if (expectedPartner !== bFip) {
        mismatches.push({
          matchId: m.id,
          tournamentId: m.tournament_id,
          pairLabel: label,
          slotA: aCol, slotB: bCol,
          fipA: aFip, fipB: bFip,
          expectedPartnerOfA: expectedPartner,
        });
      }
    }
  }

  console.log(`\nFound ${mismatches.length} mis-paired slot(s).`);
  const byTournament = new Map<string, Mismatch[]>();
  for (const x of mismatches) {
    const arr = byTournament.get(x.tournamentId) ?? [];
    arr.push(x);
    byTournament.set(x.tournamentId, arr);
  }
  for (const [tid, list] of byTournament) {
    console.log(`\n=== Tournament ${tid} — ${list.length} mismatches ===`);
    for (const x of list) {
      console.log(`  match=${x.matchId}  ${x.pairLabel}  ${x.fipA} (paired with ${x.fipB}, expected ${x.expectedPartnerOfA})`);
    }
  }

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to NULL the mis-paired slot B on each match.');
    console.log('(After applying, run fip-draw-populator manually or wait for the next hourly run to re-fill.)');
    return;
  }

  console.log('\n--apply: NULLing the mis-paired slot B FK on each match...');
  for (const x of mismatches) {
    const patch: Record<string, null> = { [x.slotB]: null };
    const { error } = await s.from('matches').update(patch).eq('id', x.matchId);
    if (error) console.error(`  FAIL match=${x.matchId} (${x.slotB}): ${error.message}`);
    else console.log(`  OK   match=${x.matchId} → ${x.slotB} = NULL`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Manual dry-run against production**

```bash
npx tsx scripts/audit-mispaired-matches.ts --tournament 83ba400e-77d4-4d9d-b525-af417a8d9f4a 2>&1 | head -40
```

Expected: prints a list of mis-paired slots for Buenos Aires P1 (zero or a small number after the MD042 patch). If output is unexpected, debug before proceeding.

- [ ] **Step 3: Commit**

```bash
git add scripts/audit-mispaired-matches.ts
git commit -m "$(cat <<'EOF'
feat(scripts): audit-mispaired-matches — entry-list partner cross-check

One-shot operator script. Reads matches with all 4 pair FKs filled,
cross-references against entry_list_snapshots.partner_fip_id, prints
mismatches grouped by tournament. Dry-run by default; --apply NULLs
the lower-confidence slot so the next fip-draw-populator run re-fills
via the new tier-aware resolver.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Final verification + open PR

**Files:** none modified — verification only.

- [ ] **Step 1: Run full test suite + typecheck from padelgod**

```bash
cd padelgod && npm test 2>&1 | tail -15 && npm run typecheck 2>&1 | tail -5
```

Expected: only the 2 pre-existing failures (`fip-event-page-detail` "Main draw" date, `player-profile` row update) remain unrelated. Typecheck clean.

- [ ] **Step 2: Verify branch is up to date with main**

```bash
git fetch origin
git log origin/main..HEAD --oneline
```

Expected: only the commits from Tasks 1-9 (no surprise commits).

- [ ] **Step 3: Push and open PR**

```bash
git push -u origin feat/pair-aware-resolver

gh pr create --title "feat(fip-draw-populator): pair-aware tier-based player resolver" --body "$(cat <<'EOF'
## Summary
Implements the pair-aware resolver design from [spec PR #314](https://github.com/gudenes/padel-live-scores/pull/314) (or merged commit, depending on order).

Replaces fuzzy-only short-form resolution with a two-pass tier-based algorithm:
- **Pass 1** per-slot lookup across 4 tiers: \`exact_long → bracket_overlay → short_unique → middle-strip\`
- **Pass 2** pair-anchor sweep + mis-pair sanity check + suspected_late_swap telemetry

Two structural signals replace the heuristics:
1. \`entry_list_snapshots.partner_fip_id\` / \`partner_name\` — every player's entry-list teammate
2. \`draw_snapshots\` long-form names (source=fip_event_page) — even bye-skipped walkover rows contribute via the new \`buildBracketOverlay\` helper

## What this fixes
BA P1 2026-05-12 R64 MD042 class of bug — short-form \`"J. Ruiz"\` now resolves to Javier Ruiz Gonzalez (#41) via either bracket overlay or partner anchor (Rubio's entry-list partner). Previously resolved silently to Jorge Nieto Ruiz (#10) via Pattern 2 last-token short-form collision.

## Test plan
- [x] \`npm test\` — populator suite 90+/90+ tests; 2 pre-existing unrelated failures on main
- [x] \`npm run typecheck\` — clean
- [x] Dry-run of \`scripts/audit-mispaired-matches.ts\` against production
- [ ] After merge: run \`scripts/audit-mispaired-matches.ts --apply\` on production to NULL historical mis-pairings; next populator run re-fills with new resolver

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Confirm PR URL printed**

PR URL goes to stdout from `gh pr create`. Capture it.

---

## Self-review notes

**Spec coverage check** — every section in the spec maps to one or more tasks:

| Spec section | Tasks |
|---|---|
| Components & data flow → buildPairIndex | Task 2 |
| Components & data flow → buildBracketOverlay | Task 3 |
| Components & data flow → wiring | Task 8 |
| Resolution algorithm → Pass 1 tier order + bracket overlay | Task 4 |
| Resolution algorithm → Pass 2 partner-anchor | Task 5 |
| Resolution algorithm → Pass 2 mis-pair sanity | Task 6 |
| Resolution algorithm → Pass 2 late-swap telemetry | Task 7 |
| Telemetry (3 events) | Tasks 5–7 (one event per task) |
| Testing — Layer 1 unit (helpers) | Tasks 1–3 |
| Testing — Layer 2 resolver tiers | Tasks 4–7 |
| Testing — Layer 3 integration | Task 8 |
| Audit script | Task 9 |
| Rollout | Task 10 |

**Type consistency** — `Tier`, `PairIndex`, `BracketOverlay`, `BracketOverlayEntry`, `ResolveOptions`, `ResolvedFour.tiers` introduced in Task 4 and referenced consistently in Tasks 5–8. `isShortFormConsistentWith` / `doShortFormInitialsMatch` introduced in Task 1 and consumed in Tasks 4–7. No naming drift.

**Scope** — single PR, single resolver subsystem, ~12 new tests, ~250 LOC added to one TS file + one new script. Manageable in one implementation session.

**Pre-existing failures** — `fip-event-page-detail` and `player-profile` test failures on `main` are unrelated and reproduce with stashed changes. Documented in Task 10 step 1.
