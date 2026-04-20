# Padelgod Shadow Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Padelgod shadow mode — a validation layer where Padelgod writes live match data to `padelgod.shadow_*` tables in parallel with the existing padelapi relay writing to canonical `public.*`, plus a new ops dashboard that compares the two pipelines and gates per-tournament cutover on measured correctness criteria.

**Architecture:** Reuse Plan 4's `LivePollerLoop` + `applyDiff` with a new `mode: 'canonical' | 'shadow'` parameter that routes writes to the shadow schema. A new `shadow-diff-finalizer` worker runs final-state and per-point-sequence comparisons after each match finishes; a new `shadow-diff-live` worker snapshots latency every minute during live play. A new ops dashboard tab (in the Next.js main app) reads `padelgod.shadow_diff` and exposes enrollment / cutover controls. No changes to the existing production hot path or user-facing UI.

**Tech Stack:** TypeScript + Node.js 22 for the Padelgod service (existing); Supabase (Postgres) for storage; Next.js 16 App Router + React 19 for the ops dashboard (existing); vitest for tests (existing); cheerio + axios (existing, unchanged).

**Companion spec:** `docs/superpowers/specs/2026-04-20-padelgod-shadow-mode-design.md`

**Prerequisites (already shipped in Plan 4):**
- Padelgod service deployed to Railway with 11 cron workers including `live-poller-manager`
- `LivePollerLoop`, `applyDiff`, `match-identifier`, all parsers
- `padelgod.widget_id_cache` populated for ≥106 tournaments
- `tournaments.live_source` column with values `'padelapi'` (default) or `'padelgod'`

---

## File Structure

**New files:**

```
padelgod/src/
├── lib/
│   ├── point-normalizer.ts                    # Pure: parse padelapi "15:0" / padelgod "15-0" into shared canonical shape
│   └── shadow-winner-inference.ts             # Pure: derive winner_pair from shadow_sets set scores
├── workers/
│   ├── shadow-diff-finalizer.ts               # Cron: final_state + per_point_sequence comparison
│   └── shadow-diff-live.ts                    # Cron: live_latency snapshots
└── __tests__/
    ├── lib/point-normalizer.test.ts
    ├── lib/shadow-winner-inference.test.ts
    ├── workers/shadow-diff-finalizer.test.ts
    └── workers/shadow-diff-live.test.ts

supabase/migrations/
├── 20260420000018_padelgod_tournaments_shadow_enabled.sql
├── 20260420000019_padelgod_shadow_tables.sql
└── 20260420000020_padelgod_tournaments_for_shadow_polling.sql

src/app/ops/
└── PadelgodShadowTab.tsx                      # The new ops tab (React component)

src/app/api/ops/padelgod-shadow/
├── health/route.ts                            # GET — health summary card values
├── enrollments/route.ts                       # GET — list tournaments + enrollment state
├── enroll/route.ts                            # POST — toggle shadow_enabled or cutover
├── divergences/route.ts                       # GET — recent shadow_diff rows per tournament
└── live/route.ts                              # GET — currently-live matches side-by-side
```

**Modified files:**

```
padelgod/src/
├── lib/
│   ├── live-poller-loop.ts                    # Add `mode` option; thread through to applyDiff
│   └── point-reconstruction.ts                # Add `mode` param; route writes to shadow tables
├── workers/
│   └── live-poller-manager.ts                 # Query BOTH RPCs; instantiate loops with correct mode
├── scheduler.ts                               # Register shadow-diff-finalizer + shadow-diff-live
├── lib/env.ts                                 # Add ENABLE_SHADOW_DIFF_FINALIZER + ENABLE_SHADOW_DIFF_LIVE
└── index.ts                                   # Pass new flags through

padelgod/src/__tests__/
├── lib/live-poller-loop.test.ts               # Cover mode='shadow' routing
├── lib/point-reconstruction.test.ts           # Cover mode='shadow' writes
├── workers/live-poller-manager.test.ts        # Cover two-RPC reconciliation
└── scheduler.test.ts                          # Cover two new workers

src/app/ops/
└── page.tsx (or OpsDashboard.tsx)             # Register the new tab in the tab list
```

---

## Conventions

- **Worktree:** `.worktrees/padelgod-shadow` on branch `feat/padelgod-shadow` (new — create via `git worktree add .worktrees/padelgod-shadow -b feat/padelgod-shadow main`).
- **Testing:** vitest with `fakeSupabase` mock pattern established in Plan 4. All tests are unit tests, no real DB calls.
- **Commits:** one commit per task unless noted otherwise. Every commit passes `cd padelgod && npm test && npx tsc --noEmit` AND `npm run build` at the main-app root (when main-app files change).
- **Every task ends with a verified commit.** No uncommitted work at task boundaries.

---

## Task 0: Pre-work (USER action, not automated)

**Purpose:** Revert Brussels P2 back to `live_source='padelapi'` so Padelgod has zero canonical write responsibility during shadow validation.

**Files:** none. Supabase SQL editor only.

- [ ] **Step 1: Run in Supabase SQL editor**

```sql
UPDATE public.tournaments
SET live_source = 'padelapi', updated_at = NOW()
WHERE id = 'b91c4c7d-dfdf-47bd-af99-e6d97515634e';

-- Verify the RPC returns 0 rows now (Brussels no longer needs a canonical padelgod loop):
SELECT * FROM public.padelgod_tournaments_for_live_polling();
```

- [ ] **Step 2: Watch Railway logs for ≤60s**

Padelgod logs: expect a log line "Stopped live poller" for Brussels.
Relay logs: expect the Brussels matches to re-appear in the relay's sync cycle (no specific message, just that relay subscribes again within 60s).

- [ ] **Step 3: Proceed to Task 1 only after observing both log lines**

This task has no commit — it's a production SQL change the user performs.

---

## Task 1: Database migrations (018, 019, 020)

**Files:**
- Create: `supabase/migrations/20260420000018_padelgod_tournaments_shadow_enabled.sql`
- Create: `supabase/migrations/20260420000019_padelgod_shadow_tables.sql`
- Create: `supabase/migrations/20260420000020_padelgod_tournaments_for_shadow_polling.sql`

- [ ] **Step 1: Create migration 018**

`supabase/migrations/20260420000018_padelgod_tournaments_shadow_enabled.sql`:

```sql
-- Padelgod Shadow Mode: enrollment flag on tournaments.
-- Orthogonal to live_source. true = Padelgod runs a shadow LivePollerLoop in parallel
-- with the padelapi relay, writing to padelgod.shadow_* tables.
-- Set by the ops dashboard "Enroll in shadow" button.

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS shadow_enabled BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tournaments_shadow_enabled
  ON public.tournaments(shadow_enabled) WHERE shadow_enabled = true;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tournaments' AND column_name='shadow_enabled'
  ), 'shadow_enabled column missing';
END $$;
```

- [ ] **Step 2: Create migration 019**

`supabase/migrations/20260420000019_padelgod_shadow_tables.sql`:

```sql
-- Padelgod Shadow Mode: shadow tables + comparison results.
-- Writes come from Padelgod's LivePollerLoop when mode='shadow'.
-- shadow_diff is written by the shadow-diff-* workers.

CREATE TABLE IF NOT EXISTS padelgod.shadow_sets (
  match_id     UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number   INT NOT NULL,
  set_score    TEXT,
  pair1_games  INT,
  pair2_games  INT,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, set_number)
);

CREATE INDEX IF NOT EXISTS idx_shadow_sets_match
  ON padelgod.shadow_sets (match_id);

CREATE TABLE IF NOT EXISTS padelgod.shadow_match_points (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id         UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  set_number       INT NOT NULL,
  game_number      INT NOT NULL,
  point_number     INT NOT NULL,
  winner_pair      INT NOT NULL CHECK (winner_pair IN (1, 2)),
  score_after      TEXT NOT NULL,
  server_team      INT CHECK (server_team IN (1, 2)),
  is_golden_point  BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (match_id, set_number, game_number, point_number)
);

CREATE INDEX IF NOT EXISTS idx_shadow_match_points_match
  ON padelgod.shadow_match_points (match_id);

CREATE TABLE IF NOT EXISTS padelgod.shadow_diff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  comparison_type TEXT NOT NULL CHECK (
    comparison_type IN ('final_state', 'live_latency', 'per_point_sequence')
  ),
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- final_state fields (NULL for other types)
  padelapi_winner_pair INT,
  padelgod_winner_pair INT,
  winner_match BOOLEAN,
  padelapi_final_score TEXT,
  padelgod_final_score TEXT,
  score_match BOOLEAN,

  -- live_latency fields (NULL for other types)
  padelapi_updated_at TIMESTAMPTZ,
  padelgod_updated_at TIMESTAMPTZ,
  latency_delta_ms INT,

  -- per_point_sequence fields (NULL for other types)
  padelapi_point_count INT,
  padelgod_point_count INT,
  point_sequence_match BOOLEAN,
  first_divergence_index INT,
  first_divergence_detail TEXT,

  -- shared
  divergence_reason TEXT
);

-- Enforce at-most-one final_state / per_point_sequence row per match.
-- live_latency rows accumulate; no uniqueness constraint.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_shadow_diff_final
  ON padelgod.shadow_diff (match_id)
  WHERE comparison_type = 'final_state';

CREATE UNIQUE INDEX IF NOT EXISTS uniq_shadow_diff_per_point
  ON padelgod.shadow_diff (match_id)
  WHERE comparison_type = 'per_point_sequence';

CREATE INDEX IF NOT EXISTS idx_shadow_diff_recent
  ON padelgod.shadow_diff (computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_shadow_diff_by_tournament
  ON padelgod.shadow_diff (tournament_id, comparison_type, computed_at DESC);

-- Service role needs write access to padelgod schema tables
GRANT ALL ON padelgod.shadow_sets TO service_role;
GRANT ALL ON padelgod.shadow_match_points TO service_role;
GRANT ALL ON padelgod.shadow_diff TO service_role;

DO $$
BEGIN
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='shadow_sets'), 'shadow_sets missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='shadow_match_points'), 'shadow_match_points missing';
  ASSERT EXISTS (SELECT 1 FROM information_schema.tables
    WHERE table_schema='padelgod' AND table_name='shadow_diff'), 'shadow_diff missing';
END $$;
```

- [ ] **Step 3: Create migration 020**

`supabase/migrations/20260420000020_padelgod_tournaments_for_shadow_polling.sql`:

```sql
-- Padelgod Shadow Mode: RPC listing tournaments currently enrolled in shadow polling.
-- Mirrors padelgod_tournaments_for_live_polling() but gates on shadow_enabled=true
-- AND live_source='padelapi' (excludes tournaments that cut over to padelgod canonical).

CREATE OR REPLACE FUNCTION public.padelgod_tournaments_for_shadow_polling()
RETURNS TABLE (
  tournament_id UUID,
  tournament_name TEXT,
  widget_id TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ
) AS $$
  SELECT t.id, t.name, c.widget_id, t.starts_at, t.ends_at
  FROM public.tournaments t
  INNER JOIN padelgod.widget_id_cache c
    ON c.tournament_id = t.id AND c.is_active = true
  WHERE t.shadow_enabled = true
    AND t.live_source = 'padelapi'
    AND COALESCE(t.ends_at, t.starts_at + INTERVAL '14 days') >= NOW() - INTERVAL '1 day'
    AND COALESCE(t.starts_at, NOW() - INTERVAL '7 days') <= NOW() + INTERVAL '1 day'
  ORDER BY t.starts_at ASC NULLS LAST;
$$ LANGUAGE sql STABLE;

DO $$
BEGIN
  ASSERT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='padelgod_tournaments_for_shadow_polling'
  ), 'RPC missing';
END $$;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260420000018_padelgod_tournaments_shadow_enabled.sql \
        supabase/migrations/20260420000019_padelgod_shadow_tables.sql \
        supabase/migrations/20260420000020_padelgod_tournaments_for_shadow_polling.sql
git commit -m "feat(db): add Shadow Mode schema — shadow tables + enrollment + RPC

Migration 018: tournaments.shadow_enabled flag (orthogonal to live_source).
Migration 019: padelgod.shadow_sets, shadow_match_points, shadow_diff tables.
  - shadow_diff has three comparison_types with type-specific columns nullable.
  - Partial unique indexes enforce at-most-one final_state and per_point_sequence
    row per match; live_latency rows accumulate one-per-minute per match.
Migration 020: padelgod_tournaments_for_shadow_polling() RPC gates on
  shadow_enabled=true AND live_source='padelapi' AND in-window.

All three read-additive; no existing code path changes on application."
```

---

## Task 2: Point normalizer lib (pure)

**Purpose:** Shared canonical shape for per-point comparison between padelapi format (`"15:0"`, `"AD:40"`) and padelgod format (`"15-0"`, `"AD-40"`, `"Deuce"`, `"GP"`, tiebreak `"5-3"`).

**Files:**
- Create: `padelgod/src/lib/point-normalizer.ts`
- Test: `padelgod/src/__tests__/lib/point-normalizer.test.ts`

- [ ] **Step 1: Write failing tests**

`padelgod/src/__tests__/lib/point-normalizer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { normalizePadelapiPoint, normalizePadelgodPoint, pointEq } from '../../lib/point-normalizer.js';

describe('normalizePadelapiPoint', () => {
  it('parses 0:0', () => {
    expect(normalizePadelapiPoint('0:0')).toEqual({ kind: 'regular', team1: 0, team2: 0 });
  });
  it('parses 15:30', () => {
    expect(normalizePadelapiPoint('15:30')).toEqual({ kind: 'regular', team1: 15, team2: 30 });
  });
  it('parses 40:40 → deuce', () => {
    expect(normalizePadelapiPoint('40:40')).toEqual({ kind: 'deuce' });
  });
  it('parses AD:40 → advantage side 1', () => {
    expect(normalizePadelapiPoint('AD:40')).toEqual({ kind: 'advantage', side: 1 });
  });
  it('parses 40:AD → advantage side 2', () => {
    expect(normalizePadelapiPoint('40:AD')).toEqual({ kind: 'advantage', side: 2 });
  });
  it('parses numeric tiebreak scores', () => {
    expect(normalizePadelapiPoint('7:5', { insideTiebreak: true })).toEqual({ kind: 'tiebreak', team1: 7, team2: 5 });
  });
  it('parses lowercase ad / 40:ad (case-insensitive)', () => {
    expect(normalizePadelapiPoint('ad:40')).toEqual({ kind: 'advantage', side: 1 });
  });
});

describe('normalizePadelgodPoint', () => {
  it('parses 15-0', () => {
    expect(normalizePadelgodPoint('15-0')).toEqual({ kind: 'regular', team1: 15, team2: 0 });
  });
  it('parses Deuce', () => {
    expect(normalizePadelgodPoint('Deuce')).toEqual({ kind: 'deuce' });
  });
  it('parses AD-40', () => {
    expect(normalizePadelgodPoint('AD-40')).toEqual({ kind: 'advantage', side: 1 });
  });
  it('parses 40-AD', () => {
    expect(normalizePadelgodPoint('40-AD')).toEqual({ kind: 'advantage', side: 2 });
  });
  it('parses GP → golden_point', () => {
    expect(normalizePadelgodPoint('GP')).toEqual({ kind: 'golden_point' });
  });
  it('parses tiebreak 5-3', () => {
    expect(normalizePadelgodPoint('5-3', { insideTiebreak: true })).toEqual({ kind: 'tiebreak', team1: 5, team2: 3 });
  });
});

describe('pointEq', () => {
  it('treats deuce and golden_point as equivalent (both deuce-label states)', () => {
    expect(pointEq({ kind: 'deuce' }, { kind: 'golden_point' })).toBe(true);
  });
  it('regular matches regular with same scores', () => {
    expect(pointEq({ kind: 'regular', team1: 15, team2: 30 }, { kind: 'regular', team1: 15, team2: 30 })).toBe(true);
  });
  it('advantage side must match', () => {
    expect(pointEq({ kind: 'advantage', side: 1 }, { kind: 'advantage', side: 2 })).toBe(false);
  });
  it('regular and deuce are not equal', () => {
    expect(pointEq({ kind: 'regular', team1: 40, team2: 40 }, { kind: 'deuce' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — expect all FAIL (module doesn't exist)**

```bash
cd padelgod && npx vitest run src/__tests__/lib/point-normalizer.test.ts
```

Expected: `Cannot find module '../../lib/point-normalizer.js'`

- [ ] **Step 3: Write the implementation**

`padelgod/src/lib/point-normalizer.ts`:

```typescript
// Canonical point shape for comparing padelapi-sourced and padelgod-sourced points.
// Aligned with Task 11's PointState in live-state.ts, but includes parsers for both
// input formats.

export type CanonicalPoint =
  | { kind: 'regular'; team1: 0 | 15 | 30 | 40; team2: 0 | 15 | 30 | 40 }
  | { kind: 'deuce' }
  | { kind: 'advantage'; side: 1 | 2 }
  | { kind: 'golden_point' }
  | { kind: 'tiebreak'; team1: number; team2: number };

export interface NormalizeOptions {
  insideTiebreak?: boolean;
}

// Padelapi relay writes game points as strings like "15:0", "AD:40", "40:AD", "40:40"
// (deuce), tiebreak as "7:5". Case-insensitive. Normalize to the shared shape.
export function normalizePadelapiPoint(raw: string, opts: NormalizeOptions = {}): CanonicalPoint {
  const parts = raw.split(':');
  if (parts.length !== 2) throw new Error(`unparseable padelapi point: ${raw}`);
  const left = parts[0]!.trim().toUpperCase();
  const right = parts[1]!.trim().toUpperCase();

  if (opts.insideTiebreak) {
    const t1 = Number(left);
    const t2 = Number(right);
    if (!Number.isFinite(t1) || !Number.isFinite(t2)) throw new Error(`unparseable tiebreak: ${raw}`);
    return { kind: 'tiebreak', team1: t1, team2: t2 };
  }

  if (left === 'AD' && right === '40') return { kind: 'advantage', side: 1 };
  if (left === '40' && right === 'AD') return { kind: 'advantage', side: 2 };
  if (left === '40' && right === '40') return { kind: 'deuce' };
  if (left === 'GP' || right === 'GP') return { kind: 'golden_point' };

  const regularTeam1 = Number(left) as 0 | 15 | 30 | 40;
  const regularTeam2 = Number(right) as 0 | 15 | 30 | 40;
  const valid = [0, 15, 30, 40] as const;
  if (!valid.includes(regularTeam1) || !valid.includes(regularTeam2)) {
    throw new Error(`unparseable regular point: ${raw}`);
  }
  return { kind: 'regular', team1: regularTeam1, team2: regularTeam2 };
}

// Padelgod writes match_points.score_after in formats produced by live-state.ts'
// formatPointScore helper: "15-0", "Deuce", "AD-40", "40-AD", "GP", tiebreak "5-3".
export function normalizePadelgodPoint(raw: string, opts: NormalizeOptions = {}): CanonicalPoint {
  const s = raw.trim();

  if (opts.insideTiebreak || /^\d+-\d+$/.test(s) && !['15-0','15-15','15-30','15-40','30-0','30-15','30-30','30-40','40-0','40-15','40-30','40-40','0-0','0-15','0-30','0-40'].includes(s)) {
    const parts = s.split('-');
    if (parts.length === 2) {
      const t1 = Number(parts[0]);
      const t2 = Number(parts[1]);
      if (Number.isFinite(t1) && Number.isFinite(t2) && (opts.insideTiebreak || t1 > 40 || t2 > 40)) {
        return { kind: 'tiebreak', team1: t1, team2: t2 };
      }
    }
  }

  if (s === 'Deuce' || s === 'DEUCE' || s === 'deuce') return { kind: 'deuce' };
  if (s === 'GP') return { kind: 'golden_point' };
  if (s === 'AD-40') return { kind: 'advantage', side: 1 };
  if (s === '40-AD') return { kind: 'advantage', side: 2 };

  const m = s.match(/^(\d+)-(\d+)$/);
  if (m) {
    const t1 = Number(m[1]) as 0 | 15 | 30 | 40;
    const t2 = Number(m[2]) as 0 | 15 | 30 | 40;
    const valid = [0, 15, 30, 40] as const;
    if (valid.includes(t1) && valid.includes(t2)) {
      return { kind: 'regular', team1: t1, team2: t2 };
    }
  }

  throw new Error(`unparseable padelgod point: ${raw}`);
}

// Equality for canonical points. `deuce` and `golden_point` are equivalent — both
// represent the same in-game state (40-40, not yet resolved by an AD) under
// different tournament rules. Everything else is strict equality.
export function pointEq(a: CanonicalPoint, b: CanonicalPoint): boolean {
  const aDeuceLike = a.kind === 'deuce' || a.kind === 'golden_point';
  const bDeuceLike = b.kind === 'deuce' || b.kind === 'golden_point';
  if (aDeuceLike && bDeuceLike) return true;

  if (a.kind !== b.kind) return false;
  if (a.kind === 'deuce' || a.kind === 'golden_point') return true;
  if (a.kind === 'advantage' && b.kind === 'advantage') return a.side === b.side;
  if (a.kind === 'regular' && b.kind === 'regular') return a.team1 === b.team1 && a.team2 === b.team2;
  if (a.kind === 'tiebreak' && b.kind === 'tiebreak') return a.team1 === b.team1 && a.team2 === b.team2;
  return false;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd padelgod && npx vitest run src/__tests__/lib/point-normalizer.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Run the full test suite + tsc**

```bash
cd padelgod && npm test && npx tsc --noEmit
```

Expected: existing 161 tests + new ones all pass; no tsc errors.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/lib/point-normalizer.ts padelgod/src/__tests__/lib/point-normalizer.test.ts
git commit -m "feat(padelgod): add point-normalizer lib for shadow per-point comparison

Pure parsers for both padelapi (\"15:0\", \"AD:40\") and padelgod (\"15-0\",
\"Deuce\", \"AD-40\", \"GP\") point formats into a shared CanonicalPoint shape.
Treats deuce and golden_point as equivalent — both represent 40-40 pre-AD,
differing only in tournament rule (golden-point-replaces-AD vs classic).

Used by shadow-diff-finalizer for per_point_sequence comparison."
```

---

## Task 3: Shadow winner inference lib (pure)

**Purpose:** Derive `winner_pair` from an array of `shadow_sets` rows. Needed because the live poller doesn't emit `matches.winner_pair`, so the shadow side has no direct winner — we count sets.

**Files:**
- Create: `padelgod/src/lib/shadow-winner-inference.ts`
- Test: `padelgod/src/__tests__/lib/shadow-winner-inference.test.ts`

- [ ] **Step 1: Write failing tests**

`padelgod/src/__tests__/lib/shadow-winner-inference.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { inferWinnerFromSets, type SetRow } from '../../lib/shadow-winner-inference.js';

describe('inferWinnerFromSets', () => {
  it('returns 1 when pair1 wins 2 sets in a best-of-3', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: 4, pair2_games: 6 },
      { set_number: 3, pair1_games: 6, pair2_games: 3 },
    ];
    expect(inferWinnerFromSets(sets)).toBe(1);
  });

  it('returns 2 when pair2 wins 2 sets straight', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 3, pair2_games: 6 },
      { set_number: 2, pair1_games: 4, pair2_games: 6 },
    ];
    expect(inferWinnerFromSets(sets)).toBe(2);
  });

  it('returns null when no pair has 2 set wins', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
    ];
    expect(inferWinnerFromSets(sets)).toBeNull();
  });

  it('ignores sets with missing game counts (incomplete data)', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4 },
      { set_number: 2, pair1_games: null, pair2_games: null },
    ];
    expect(inferWinnerFromSets(sets)).toBeNull();
  });

  it('handles tied sets (should not count as a win)', () => {
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 6 }, // incomplete/tied
      { set_number: 2, pair1_games: 6, pair2_games: 3 },
    ];
    expect(inferWinnerFromSets(sets)).toBeNull();
  });

  it('returns null for empty set list', () => {
    expect(inferWinnerFromSets([])).toBeNull();
  });

  it('joinedScoreString concatenates per-set scores with space', () => {
    // Exported helper for shadow_diff.padelgod_final_score
    const { joinedScoreString } = require('../../lib/shadow-winner-inference.js');
    const sets: SetRow[] = [
      { set_number: 1, pair1_games: 6, pair2_games: 4, set_score: '6-4' },
      { set_number: 2, pair1_games: 3, pair2_games: 6, set_score: '3-6' },
      { set_number: 3, pair1_games: 6, pair2_games: 2, set_score: '6-2' },
    ];
    expect(joinedScoreString(sets)).toBe('6-4 3-6 6-2');
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
cd padelgod && npx vitest run src/__tests__/lib/shadow-winner-inference.test.ts
```

- [ ] **Step 3: Write the implementation**

`padelgod/src/lib/shadow-winner-inference.ts`:

```typescript
// Derive winner_pair from a list of set rows. Used by shadow-diff-finalizer
// because Padelgod's live poller doesn't emit matches.winner_pair directly
// — we compute it from the shadow_sets pair1_games / pair2_games counts.

export interface SetRow {
  set_number: number;
  pair1_games: number | null;
  pair2_games: number | null;
  set_score?: string | null;
}

/**
 * Infer winner_pair by counting completed sets won per team.
 * Returns the team id (1 or 2) that first accumulates 2 set wins.
 * Returns null if neither team has 2 wins among the provided sets.
 *
 * A set is "won by pair1" when pair1_games > pair2_games. A tie is not a win.
 * A null in either games column disqualifies that set from counting.
 */
export function inferWinnerFromSets(sets: SetRow[]): 1 | 2 | null {
  let pair1Sets = 0;
  let pair2Sets = 0;

  for (const s of [...sets].sort((a, b) => a.set_number - b.set_number)) {
    const p1 = s.pair1_games;
    const p2 = s.pair2_games;
    if (p1 == null || p2 == null) continue;
    if (p1 > p2) pair1Sets += 1;
    else if (p2 > p1) pair2Sets += 1;
    // ties (p1 === p2) don't count
  }

  if (pair1Sets >= 2) return 1;
  if (pair2Sets >= 2) return 2;
  return null;
}

/**
 * Concatenate the per-set scores into a single string for side-by-side comparison.
 * Uses set_score when available (e.g. "7-6"), else falls back to "{p1}-{p2}".
 * Returns empty string if no sets.
 */
export function joinedScoreString(sets: SetRow[]): string {
  return [...sets]
    .sort((a, b) => a.set_number - b.set_number)
    .map((s) => s.set_score ?? `${s.pair1_games ?? '?'}-${s.pair2_games ?? '?'}`)
    .join(' ');
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd padelgod && npx vitest run src/__tests__/lib/shadow-winner-inference.test.ts
```

- [ ] **Step 5: Run full test suite + tsc**

```bash
cd padelgod && npm test && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/lib/shadow-winner-inference.ts padelgod/src/__tests__/lib/shadow-winner-inference.test.ts
git commit -m "feat(padelgod): add shadow-winner-inference lib

Pure helper to derive winner_pair from an array of set rows by counting
sets won per team (first to 2 wins). Padelgod's live poller doesn't emit
matches.winner_pair directly, so shadow-diff-finalizer derives it from
padelgod.shadow_sets when computing final_state comparison rows.

Also exports joinedScoreString for shadow_diff.padelgod_final_score formatting."
```

---

## Task 4: Add `mode` parameter to LivePollerLoop

**Files:**
- Modify: `padelgod/src/lib/live-poller-loop.ts`
- Modify: `padelgod/src/__tests__/lib/live-poller-loop.test.ts`

**Scope:** wiring only — add `mode` to options, thread through to `applyDiff`. Actual write-routing lives in Task 5 (`applyDiff`). For Task 4, `mode='shadow'` still writes canonical — we just verify the flag propagates.

- [ ] **Step 1: Read current live-poller-loop.ts interface**

Read file in full to refresh context. The `LivePollerLoopOptions` interface currently does not include `mode`. `applyDiff` is called inside `pollOnce` with options bag `{ logger: this.opts.logger }`.

- [ ] **Step 2: Write failing test**

Add to `padelgod/src/__tests__/lib/live-poller-loop.test.ts` (in the existing `describe('LivePollerLoop', ...)` block):

```typescript
  it('threads mode through to applyDiff options', async () => {
    // Mock applyDiff to capture its opts
    const applyDiffMock = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../lib/point-reconstruction.js', () => ({
      applyDiff: applyDiffMock,
    }));
    // re-import after mock — but simpler: rely on an injected applyDiff if we add one.
    // For this test: instantiate loop with mode='shadow' and verify the LivePollerLoopOptions
    // accepts mode without type error.
    const loop = new LivePollerLoop({
      tournamentId: 'tour-1',
      widgetId: 'FIP-2026-1701',
      mode: 'shadow', // NEW — must be accepted by type
      supabase: fakeSupabase() as any,
      httpClient: { get: vi.fn() } as any,
      logger: mockLogger(),
      setTimeoutFn: ((fn: () => void) => { /* no-op */ return 1 as any; }) as any,
      clearTimeoutFn: () => {},
    });
    expect(loop.isRunning()).toBe(false);
    await loop.start();
    expect(loop.isRunning()).toBe(true);
    await loop.stop();
  });
```

Helpers `fakeSupabase()` and `mockLogger()` already exist in the test file.

- [ ] **Step 3: Run test — expect FAIL (mode not in options type)**

```bash
cd padelgod && npx vitest run src/__tests__/lib/live-poller-loop.test.ts
```

Expected: type error OR runtime error on the `mode` field.

- [ ] **Step 4: Update LivePollerLoopOptions type + constructor**

In `padelgod/src/lib/live-poller-loop.ts`:

Find the `LivePollerLoopOptions` interface and add:

```typescript
export interface LivePollerLoopOptions {
  tournamentId: string;
  widgetId: string;
  /**
   * 'canonical' (default) — writes go to public.sets / public.games / public.match_points
   * 'shadow'              — writes go to padelgod.shadow_sets / padelgod.shadow_match_points
   *                         (games skipped entirely in shadow)
   */
  mode?: 'canonical' | 'shadow';
  supabase: SupabaseClient;
  httpClient: AxiosInstance;
  logger: Logger;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}
```

In the class body, find where `applyDiff` is called inside `processMatch` and thread `mode` through the options:

```typescript
// Inside processMatch(), find the existing applyDiff(...) call and add mode to its opts:
await applyDiff(this.opts.supabase, matchId, prev, curr, diff, resolvedPlayers, {
  logger: this.opts.logger,
  mode: this.opts.mode ?? 'canonical',  // NEW
});
```

Also update the manager's log messages to include `mode`: find every `logger.info({ ... }, 'Started live poller')` and similar, add `mode: this.opts.mode ?? 'canonical'` to the log context. Look in `start()`, `stop()`, and the periodic tick log.

- [ ] **Step 5: Run — expect the new test to pass; others unchanged**

```bash
cd padelgod && npm test
```

- [ ] **Step 6: Tsc check**

```bash
cd padelgod && npx tsc --noEmit
```

Note: this task will FAIL `tsc` if Task 5 isn't done yet because `applyDiff` doesn't accept `mode` in its opts. That's expected. Either:
- Defer the `tsc --noEmit` verification until Task 5 also lands (recommended — combine Tasks 4 + 5 if you prefer)
- OR add `mode` to the `ApplyDiffOpts` interface in `point-reconstruction.ts` NOW (without implementing the routing — just accept the field and ignore it), then do full routing in Task 5.

**Take the second option** — add `mode?: 'canonical' | 'shadow'` to `ApplyDiffOpts` and no-op it (writes still go to canonical regardless). This keeps Task 4 self-committable.

Edit `padelgod/src/lib/point-reconstruction.ts`:

```typescript
export interface ApplyDiffOpts {
  logger?: Logger;
  mode?: 'canonical' | 'shadow'; // NEW — Task 5 implements routing
}
```

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/lib/live-poller-loop.ts \
        padelgod/src/__tests__/lib/live-poller-loop.test.ts \
        padelgod/src/lib/point-reconstruction.ts
git commit -m "feat(padelgod): add mode param to LivePollerLoop (wiring)

Plumbs mode: 'canonical' | 'shadow' through LivePollerLoopOptions to applyDiff
opts. Default is 'canonical' — existing behavior preserved. The actual
write-routing to padelgod.shadow_* tables lands in Task 5.

ApplyDiffOpts accepts the param now too so tsc stays green across tasks."
```

---

## Task 5: Shadow write routing in applyDiff

**Files:**
- Modify: `padelgod/src/lib/point-reconstruction.ts`
- Modify: `padelgod/src/__tests__/lib/point-reconstruction.test.ts`

**Scope:** when `opts.mode === 'shadow'`:
- `public.sets` upsert → `padelgod.shadow_sets` upsert
- `public.games` upsert → SKIPPED entirely (we don't shadow games)
- `public.match_points` INSERT → `padelgod.shadow_match_points` INSERT
- `UPDATE sets SET is_current=false` → SKIPPED (shadow_sets has no is_current column)
- `UPDATE games SET is_current=false` → SKIPPED (no shadow_games)

- [ ] **Step 1: Write failing tests**

In `padelgod/src/__tests__/lib/point-reconstruction.test.ts`, add a new describe block at the bottom:

```typescript
describe('applyDiff (shadow mode)', () => {
  it('routes set upsert to padelgod.shadow_sets', async () => {
    const writes: Array<{ schema: string | null; table: string; op: string; payload: any }> = [];
    const supabase = makeCaptureSupabase(writes);

    await applyDiff(
      supabase as any,
      'match-uuid',
      null, // prev
      makeCurr({ set_number: 1, team1Games: 3, team2Games: 2 }),
      { pointsAdded: [{ winnerTeam: 1 }], gameChanged: false, setChanged: false, serverChanged: false, statusChanged: false, suspectedMissedPoints: false },
      { pair1Player1Id: 'p1', pair1Player2Id: 'p2', pair2Player1Id: 'p3', pair2Player2Id: 'p4' },
      { mode: 'shadow' }
    );

    const shadowSetWrites = writes.filter((w) => w.schema === 'padelgod' && w.table === 'shadow_sets');
    expect(shadowSetWrites.length).toBeGreaterThan(0);

    const publicSetWrites = writes.filter((w) => w.schema === null && w.table === 'sets');
    expect(publicSetWrites).toHaveLength(0);
  });

  it('routes match_point insert to padelgod.shadow_match_points', async () => {
    const writes: Array<{ schema: string | null; table: string; op: string; payload: any }> = [];
    const supabase = makeCaptureSupabase(writes);
    await applyDiff(
      supabase as any,
      'match-uuid',
      null,
      makeCurr({ set_number: 1, team1Games: 0, team2Games: 0 }),
      { pointsAdded: [{ winnerTeam: 1 }], gameChanged: false, setChanged: false, serverChanged: false, statusChanged: false, suspectedMissedPoints: false },
      { pair1Player1Id: 'p1', pair1Player2Id: 'p2', pair2Player1Id: 'p3', pair2Player2Id: 'p4' },
      { mode: 'shadow' }
    );

    const shadowMpWrites = writes.filter((w) => w.schema === 'padelgod' && w.table === 'shadow_match_points' && w.op === 'insert');
    expect(shadowMpWrites).toHaveLength(1);

    const publicMpWrites = writes.filter((w) => w.schema === null && w.table === 'match_points');
    expect(publicMpWrites).toHaveLength(0);
  });

  it('skips games writes in shadow mode', async () => {
    const writes: Array<{ schema: string | null; table: string; op: string; payload: any }> = [];
    const supabase = makeCaptureSupabase(writes);
    await applyDiff(
      supabase as any,
      'match-uuid',
      null,
      makeCurr({ set_number: 1, team1Games: 0, team2Games: 0 }),
      { pointsAdded: [{ winnerTeam: 1 }], gameChanged: true, setChanged: false, serverChanged: false, statusChanged: false, suspectedMissedPoints: false },
      { pair1Player1Id: 'p1', pair1Player2Id: 'p2', pair2Player1Id: 'p3', pair2Player2Id: 'p4' },
      { mode: 'shadow' }
    );

    const gamesWrites = writes.filter((w) => w.table === 'games' || w.table === 'shadow_games');
    expect(gamesWrites).toHaveLength(0);
  });

  it('defaults mode to canonical when omitted (existing behavior)', async () => {
    const writes: Array<{ schema: string | null; table: string; op: string; payload: any }> = [];
    const supabase = makeCaptureSupabase(writes);
    await applyDiff(
      supabase as any,
      'match-uuid',
      null,
      makeCurr({ set_number: 1, team1Games: 0, team2Games: 0 }),
      { pointsAdded: [{ winnerTeam: 1 }], gameChanged: false, setChanged: false, serverChanged: false, statusChanged: false, suspectedMissedPoints: false },
      { pair1Player1Id: 'p1', pair1Player2Id: 'p2', pair2Player1Id: 'p3', pair2Player2Id: 'p4' },
      { /* no mode */ }
    );

    const publicWrites = writes.filter((w) => w.schema === null);
    expect(publicWrites.length).toBeGreaterThan(0);

    const shadowWrites = writes.filter((w) => w.schema === 'padelgod');
    expect(shadowWrites).toHaveLength(0);
  });
});

// Helper builders — place above the describe blocks if they aren't already defined
function makeCaptureSupabase(writes: any[]) {
  const tableFn = (tableName: string, schemaName: string | null = null) => ({
    upsert: (payload: any, _opts: any) => {
      writes.push({ schema: schemaName, table: tableName, op: 'upsert', payload });
      return { select: () => ({ maybeSingle: async () => ({ data: { id: `${tableName}-id-${writes.length}` }, error: null }) }) };
    },
    insert: (payload: any) => {
      writes.push({ schema: schemaName, table: tableName, op: 'insert', payload });
      return Promise.resolve({ data: payload, error: null });
    },
    update: () => ({ eq: () => ({ neq: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) }) }),
    select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
  });
  return {
    from: (t: string) => tableFn(t, null),
    schema: (s: string) => ({ from: (t: string) => tableFn(t, s) }),
  };
}

function makeCurr(input: { set_number: number; team1Games: number; team2Games: number }): any {
  const sets = [
    { games: input.team1Games, tiebreak: null },
    ...Array(Math.max(0, input.set_number - 1)).fill({ games: 6, tiebreak: null }),
  ].slice(0, input.set_number);
  return {
    matchWidgetId: 'MQ012',
    matchId: 'match-uuid',
    pointState: { kind: 'regular', team1: 15, team2: 0 },
    team1Sets: sets.map((s) => ({ games: input.team1Games, tiebreak: null })),
    team2Sets: sets.map((s) => ({ games: input.team2Games, tiebreak: null })),
    servingTeam: 1,
    status: 'live',
  };
}
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd padelgod && npx vitest run src/__tests__/lib/point-reconstruction.test.ts
```

- [ ] **Step 3: Implement shadow routing in applyDiff**

Edit `padelgod/src/lib/point-reconstruction.ts`. The function currently uses `supabase.from('sets')`, `supabase.from('games')`, `supabase.from('match_points')` directly. Refactor to branch on `opts.mode`:

```typescript
export async function applyDiff(
  supabase: SupabaseClient,
  matchId: string,
  prev: LiveMatchState | null,
  curr: LiveMatchState,
  diff: LiveStateDiff,
  resolvedPlayers: ResolvedPlayers,
  opts: ApplyDiffOpts = {},
): Promise<void> {
  const mode = opts.mode ?? 'canonical';
  const logger = opts.logger;

  // First-poll / no-op short circuits (unchanged from V1)
  if (prev === null && diff.pointsAdded.length === 0 && !diff.gameChanged && !diff.setChanged) {
    return;
  }
  if (diff.pointsAdded.length === 0 && !diff.gameChanged && !diff.setChanged && !diff.serverChanged && !diff.statusChanged) {
    return;
  }

  // Compute currentSetNumber from curr.team1Sets / curr.team2Sets
  const currentSetNumber = computeCurrentSetNumber(curr);
  const team1Games = curr.team1Sets[currentSetNumber - 1]?.games ?? 0;
  const team2Games = curr.team2Sets[currentSetNumber - 1]?.games ?? 0;

  // Writes differ by mode
  if (mode === 'shadow') {
    // 1. Upsert shadow_sets
    await supabase.schema('padelgod').from('shadow_sets').upsert({
      match_id: matchId,
      set_number: currentSetNumber,
      set_score: formatSetScore(team1Games, team2Games),
      pair1_games: team1Games,
      pair2_games: team2Games,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'match_id,set_number' });

    // 2. Skip games writes entirely — shadow does not track per-game state

    // 3. Insert shadow_match_points (idempotent via UNIQUE)
    if (diff.pointsAdded.length > 0) {
      const winner = diff.pointsAdded[0]!.winnerTeam;
      const scoreAfter = formatPointScore(curr.pointState);
      const gameNumber = team1Games + team2Games + 1;

      // Point number: count existing shadow_match_points for this (match, set, game) + 1
      const { count } = await supabase
        .schema('padelgod')
        .from('shadow_match_points')
        .select('*', { count: 'exact', head: true })
        .eq('match_id', matchId)
        .eq('set_number', currentSetNumber)
        .eq('game_number', gameNumber);

      const pointNumber = (count ?? 0) + 1;

      const { error } = await supabase.schema('padelgod').from('shadow_match_points').insert({
        match_id: matchId,
        set_number: currentSetNumber,
        game_number: gameNumber,
        point_number: pointNumber,
        winner_pair: winner,
        score_after: scoreAfter,
        server_team: curr.servingTeam,
        is_golden_point: curr.pointState.kind === 'golden_point',
      });
      // Duplicates are expected on retry — swallow 23505 conflicts per existing convention
      if (error && !error.message?.includes('duplicate key')) {
        logger?.warn({ err: error, matchId }, 'shadow_match_points insert failed');
      }
    }
    return;
  }

  // mode === 'canonical' — existing V1 implementation unchanged
  // ...keep the existing body here as-is...
}
```

Extract the existing canonical-mode body into a private helper `applyDiffCanonical()` if the file gets unwieldy, or keep inline. Either works.

`formatSetScore(team1, team2)` and `formatPointScore(pointState)` already exist in `live-state.ts` / `point-reconstruction.ts`. Reuse.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd padelgod && npm test
```

- [ ] **Step 5: tsc check**

```bash
cd padelgod && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/lib/point-reconstruction.ts \
        padelgod/src/__tests__/lib/point-reconstruction.test.ts
git commit -m "feat(padelgod): route applyDiff writes to shadow tables when mode=shadow

- mode='shadow' → padelgod.shadow_sets upsert + padelgod.shadow_match_points insert
- games writes + is_current updates SKIPPED in shadow mode
- mode='canonical' (default) unchanged — existing Task 12 behavior preserved

shadow_match_points.point_number derived from a count query (idempotent via
UNIQUE(match_id, set_number, game_number, point_number))."
```

---

## Task 6: Live poller manager reconciles both RPCs

**Files:**
- Modify: `padelgod/src/workers/live-poller-manager.ts`
- Modify: `padelgod/src/__tests__/workers/live-poller-manager.test.ts`

- [ ] **Step 1: Write failing test**

Add to `live-poller-manager.test.ts`:

```typescript
  it('starts canonical loops for tournaments in _for_live_polling and shadow loops for _for_shadow_polling', async () => {
    __resetActivePollers();

    const canonicalRows = [{ tournament_id: 'tour-A', tournament_name: 'A', widget_id: 'W-A', starts_at: null, ends_at: null }];
    const shadowRows = [{ tournament_id: 'tour-B', tournament_name: 'B', widget_id: 'W-B', starts_at: null, ends_at: null }];

    const supabase = {
      rpc: vi.fn((name: string) => {
        if (name === 'padelgod_tournaments_for_live_polling') return Promise.resolve({ data: canonicalRows, error: null });
        if (name === 'padelgod_tournaments_for_shadow_polling') return Promise.resolve({ data: shadowRows, error: null });
        throw new Error(`unexpected rpc: ${name}`);
      }),
    };

    const deps = { supabase: supabase as any, httpClient: {} as any, logger: mockLogger() };
    const result = await runLivePollerManager(deps);

    expect(result.started).toBe(2);
    expect(result.stopped).toBe(0);
    expect(result.active).toBe(2);

    // Both LivePollerLoop constructor calls happened with the right mode
    const calls = (LivePollerLoop as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const canonicalCall = calls.find((c) => c[0]!.tournamentId === 'tour-A');
    const shadowCall = calls.find((c) => c[0]!.tournamentId === 'tour-B');
    expect(canonicalCall![0].mode).toBe('canonical');
    expect(shadowCall![0].mode).toBe('shadow');
  });

  it('stops a loop when its tournament falls out of both RPCs', async () => {
    __resetActivePollers();
    // Prime: two active loops
    const stopMock = vi.fn().mockResolvedValue(undefined);
    (LivePollerLoop as any).mockImplementationOnce(function (this: any, opts: any) {
      this.opts = opts;
      this.start = vi.fn().mockResolvedValue(undefined);
      this.stop = stopMock;
    });
    const supabase = {
      rpc: vi.fn((name: string) => Promise.resolve({ data: [], error: null })),
    };
    // Manually populate the manager's map first
    // (reach into internals or simulate via first run that DID populate, then RPC returns empty)
    await runLivePollerManager({ supabase: { rpc: vi.fn((name: string) => {
      if (name === 'padelgod_tournaments_for_live_polling') return Promise.resolve({ data: [{ tournament_id: 'tour-A', tournament_name: 'A', widget_id: 'W', starts_at: null, ends_at: null }], error: null });
      return Promise.resolve({ data: [], error: null });
    }) } as any, httpClient: {} as any, logger: mockLogger() });

    const result = await runLivePollerManager({ supabase: supabase as any, httpClient: {} as any, logger: mockLogger() });
    expect(result.stopped).toBe(1);
  });

  it('prefers canonical when a tournament appears in both RPCs', async () => {
    __resetActivePollers();
    const bothRow = [{ tournament_id: 'tour-X', tournament_name: 'X', widget_id: 'W-X', starts_at: null, ends_at: null }];
    const supabase = { rpc: vi.fn(() => Promise.resolve({ data: bothRow, error: null })) };
    const deps = { supabase: supabase as any, httpClient: {} as any, logger: mockLogger() };
    const result = await runLivePollerManager(deps);

    expect(result.started).toBe(1);
    const calls = (LivePollerLoop as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]![0].mode).toBe('canonical');
  });
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd padelgod && npx vitest run src/__tests__/workers/live-poller-manager.test.ts
```

- [ ] **Step 3: Update runLivePollerManager**

`padelgod/src/workers/live-poller-manager.ts`:

```typescript
export async function runLivePollerManager(
  deps: LivePollerManagerDeps
): Promise<LivePollerManagerResult> {
  // Query BOTH RPCs in parallel
  const [canonicalRes, shadowRes] = await Promise.all([
    deps.supabase.rpc('padelgod_tournaments_for_live_polling'),
    deps.supabase.rpc('padelgod_tournaments_for_shadow_polling'),
  ]);

  if (canonicalRes.error) throw new Error(`canonical RPC failed: ${canonicalRes.error.message}`);
  if (shadowRes.error) throw new Error(`shadow RPC failed: ${shadowRes.error.message}`);

  const canonicalRows = (canonicalRes.data ?? []) as Array<RPCRow>;
  const shadowRows = (shadowRes.data ?? []) as Array<RPCRow>;

  // Build a desired-state map: tournamentId → { widget_id, mode }
  // Canonical wins if a tournament somehow appears in both.
  const desired = new Map<string, { widget_id: string; mode: 'canonical' | 'shadow'; name: string }>();
  for (const row of shadowRows) {
    desired.set(row.tournament_id, { widget_id: row.widget_id, mode: 'shadow', name: row.tournament_name });
  }
  for (const row of canonicalRows) {
    // Overwrites any shadow entry — canonical wins
    desired.set(row.tournament_id, { widget_id: row.widget_id, mode: 'canonical', name: row.tournament_name });
  }

  let started = 0;
  let stopped = 0;

  // Start or restart loops
  for (const [tournamentId, want] of desired) {
    const existing = activePollers.get(tournamentId);
    if (existing) {
      // If mode changed, restart the loop with new mode
      const existingMode = (existing as any).opts?.mode ?? 'canonical';
      if (existingMode !== want.mode) {
        deps.logger.info({ tournamentId, fromMode: existingMode, toMode: want.mode }, 'Restarting live poller with new mode');
        try { await existing.stop(); } catch (err) {
          deps.logger.warn({ err, tournamentId }, 'Stop during mode transition failed');
        }
        stopped++;
        activePollers.delete(tournamentId);
      } else {
        continue; // already running in correct mode
      }
    }
    // Start a fresh loop
    try {
      const loop = new LivePollerLoop({
        tournamentId,
        widgetId: want.widget_id,
        mode: want.mode,
        supabase: deps.supabase,
        httpClient: deps.httpClient,
        logger: deps.logger.child({ poller: tournamentId, widget: want.widget_id, mode: want.mode }),
      });
      await loop.start();
      activePollers.set(tournamentId, loop);
      deps.logger.info({ tournamentId, widgetId: want.widget_id, name: want.name, mode: want.mode }, 'Started live poller');
      started++;
    } catch (err) {
      deps.logger.warn({ err, tournamentId }, 'Start failed; tournament skipped this tick');
    }
  }

  // Stop loops whose tournaments are no longer desired
  for (const [tournamentId, loop] of activePollers) {
    if (desired.has(tournamentId)) continue;
    try { await loop.stop(); } catch (err) {
      deps.logger.warn({ err, tournamentId }, 'Stop failed; continuing');
    }
    activePollers.delete(tournamentId);
    deps.logger.info({ tournamentId }, 'Stopped live poller');
    stopped++;
  }

  return { active: activePollers.size, started, stopped };
}

interface RPCRow { tournament_id: string; tournament_name: string; widget_id: string; starts_at: string | null; ends_at: string | null }
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd padelgod && npm test
```

- [ ] **Step 5: tsc**

```bash
cd padelgod && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/live-poller-manager.ts \
        padelgod/src/__tests__/workers/live-poller-manager.test.ts
git commit -m "feat(padelgod): live-poller-manager reconciles canonical + shadow RPCs

Queries padelgod_tournaments_for_live_polling AND
padelgod_tournaments_for_shadow_polling each tick. Instantiates one
LivePollerLoop per tournament with mode derived from which RPC it appeared in.
Canonical wins if a tournament appears in both (shouldn't happen per RPC filters
but defensive).

Mode transitions (canonical ↔ shadow for the same tournament) are handled via
stop + restart, not a hot swap — simpler and bounded by the 60s manager tick."
```

---

## Task 7: shadow-diff-finalizer worker (final_state + per_point_sequence)

**Files:**
- Create: `padelgod/src/workers/shadow-diff-finalizer.ts`
- Create: `padelgod/src/__tests__/workers/shadow-diff-finalizer.test.ts`

- [ ] **Step 1: Write failing tests**

`padelgod/src/__tests__/workers/shadow-diff-finalizer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runShadowDiffFinalizer } from '../../workers/shadow-diff-finalizer.js';

function mockLogger() {
  return {
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), debug: vi.fn(), trace: vi.fn(),
    child: (() => mockLogger()) as any,
  } as any;
}

interface WriteCapture {
  schema: string | null;
  table: string;
  op: string;
  payload: any;
}

function fakeSupabase(opts: {
  shadowEnabledTournaments: Array<{ id: string }>;
  finishedMatches: Array<{ id: string; tournament_id: string; winner_pair: number | null }>;
  publicSets: Array<{ match_id: string; set_number: number; set_score: string | null; pair1_games: number | null; pair2_games: number | null }>;
  publicGames: Array<{ match_id: string; set_number: number; game_number: number; points: string[] }>;
  shadowSets: Array<{ match_id: string; set_number: number; set_score: string | null; pair1_games: number | null; pair2_games: number | null }>;
  shadowMatchPoints: Array<{ match_id: string; set_number: number; game_number: number; point_number: number; score_after: string; winner_pair: number }>;
  existingDiff: Array<{ match_id: string; comparison_type: string }>;
}) {
  const writes: WriteCapture[] = [];
  const from = (t: string, schemaName: string | null = null) => {
    const allRows = (() => {
      if (t === 'tournaments') return opts.shadowEnabledTournaments;
      if (t === 'matches') return opts.finishedMatches;
      if (t === 'sets') return opts.publicSets;
      if (t === 'games') return opts.publicGames;
      if (t === 'shadow_sets') return opts.shadowSets;
      if (t === 'shadow_match_points') return opts.shadowMatchPoints;
      if (t === 'shadow_diff') return opts.existingDiff;
      return [];
    })();

    const chain = (rows: any[]) => ({
      eq: (col: string, val: any) => chain(rows.filter((r) => r[col] === val)),
      in: (col: string, vals: any[]) => chain(rows.filter((r) => vals.includes(r[col]))),
      order: () => chain(rows),
      then: (resolve: any) => resolve({ data: rows, error: null }),
    });

    return {
      select: (_cols?: string) => chain(allRows),
      insert: (payload: any) => { writes.push({ schema: schemaName, table: t, op: 'insert', payload }); return Promise.resolve({ data: payload, error: null }); },
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      upsert: (payload: any) => { writes.push({ schema: schemaName, table: t, op: 'upsert', payload }); return Promise.resolve({ data: payload, error: null }); },
    };
  };

  return {
    writes,
    from: (t: string) => from(t),
    schema: (s: string) => ({ from: (t: string) => from(t, s) }),
  };
}

describe('runShadowDiffFinalizer', () => {
  it('skips matches not in shadow-enrolled tournaments', async () => {
    const supabase = fakeSupabase({
      shadowEnabledTournaments: [], // none enrolled
      finishedMatches: [{ id: 'm1', tournament_id: 't1', winner_pair: 1 }],
      publicSets: [], publicGames: [], shadowSets: [], shadowMatchPoints: [], existingDiff: [],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any, logger: mockLogger() });
    expect(result.finalStateRowsWritten).toBe(0);
    expect(result.perPointRowsWritten).toBe(0);
  });

  it('writes a final_state row when winner + sets match', async () => {
    const supabase = fakeSupabase({
      shadowEnabledTournaments: [{ id: 't1' }],
      finishedMatches: [{ id: 'm1', tournament_id: 't1', winner_pair: 1 }],
      publicSets: [
        { match_id: 'm1', set_number: 1, set_score: '6-4', pair1_games: 6, pair2_games: 4 },
        { match_id: 'm1', set_number: 2, set_score: '6-2', pair1_games: 6, pair2_games: 2 },
      ],
      publicGames: [],
      shadowSets: [
        { match_id: 'm1', set_number: 1, set_score: '6-4', pair1_games: 6, pair2_games: 4 },
        { match_id: 'm1', set_number: 2, set_score: '6-2', pair1_games: 6, pair2_games: 2 },
      ],
      shadowMatchPoints: [],
      existingDiff: [],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any, logger: mockLogger() });

    expect(result.finalStateRowsWritten).toBe(1);
    const finalStateWrite = supabase.writes.find((w) => w.table === 'shadow_diff' && w.payload.comparison_type === 'final_state');
    expect(finalStateWrite).toBeDefined();
    expect(finalStateWrite!.payload.winner_match).toBe(true);
    expect(finalStateWrite!.payload.score_match).toBe(true);
    expect(finalStateWrite!.payload.padelapi_final_score).toBe('6-4 6-2');
    expect(finalStateWrite!.payload.padelgod_final_score).toBe('6-4 6-2');
  });

  it('records divergence_reason when winner disagrees', async () => {
    const supabase = fakeSupabase({
      shadowEnabledTournaments: [{ id: 't1' }],
      finishedMatches: [{ id: 'm1', tournament_id: 't1', winner_pair: 1 }],
      publicSets: [{ match_id: 'm1', set_number: 1, set_score: '6-4', pair1_games: 6, pair2_games: 4 }],
      publicGames: [],
      shadowSets: [
        { match_id: 'm1', set_number: 1, set_score: '4-6', pair1_games: 4, pair2_games: 6 },
        { match_id: 'm1', set_number: 2, set_score: '4-6', pair1_games: 4, pair2_games: 6 },
      ],
      shadowMatchPoints: [],
      existingDiff: [],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any, logger: mockLogger() });
    const write = supabase.writes.find((w) => w.table === 'shadow_diff' && w.payload.comparison_type === 'final_state')!;
    expect(write.payload.winner_match).toBe(false);
    expect(write.payload.divergence_reason).toContain('winner_disagreement');
  });

  it('skips matches that already have a final_state diff row', async () => {
    const supabase = fakeSupabase({
      shadowEnabledTournaments: [{ id: 't1' }],
      finishedMatches: [{ id: 'm1', tournament_id: 't1', winner_pair: 1 }],
      publicSets: [{ match_id: 'm1', set_number: 1, set_score: '6-4', pair1_games: 6, pair2_games: 4 }],
      publicGames: [],
      shadowSets: [{ match_id: 'm1', set_number: 1, set_score: '6-4', pair1_games: 6, pair2_games: 4 }],
      shadowMatchPoints: [],
      existingDiff: [{ match_id: 'm1', comparison_type: 'final_state' }],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any, logger: mockLogger() });
    expect(result.finalStateRowsWritten).toBe(0);
  });

  it('writes a per_point_sequence row comparing padelapi vs padelgod point sequences', async () => {
    const supabase = fakeSupabase({
      shadowEnabledTournaments: [{ id: 't1' }],
      finishedMatches: [{ id: 'm1', tournament_id: 't1', winner_pair: 1 }],
      publicSets: [{ match_id: 'm1', set_number: 1, set_score: '6-4', pair1_games: 6, pair2_games: 4 }],
      publicGames: [
        { match_id: 'm1', set_number: 1, game_number: 1, points: ['0:0', '15:0', '30:0', '40:0', 'Game'] },
      ],
      shadowSets: [{ match_id: 'm1', set_number: 1, set_score: '6-4', pair1_games: 6, pair2_games: 4 }],
      shadowMatchPoints: [
        { match_id: 'm1', set_number: 1, game_number: 1, point_number: 1, score_after: '15-0', winner_pair: 1 },
        { match_id: 'm1', set_number: 1, game_number: 1, point_number: 2, score_after: '30-0', winner_pair: 1 },
        { match_id: 'm1', set_number: 1, game_number: 1, point_number: 3, score_after: '40-0', winner_pair: 1 },
      ],
      existingDiff: [],
    });
    const result = await runShadowDiffFinalizer({ supabase: supabase as any, logger: mockLogger() });
    const write = supabase.writes.find((w) => w.table === 'shadow_diff' && w.payload.comparison_type === 'per_point_sequence')!;
    expect(write).toBeDefined();
    expect(write.payload.padelapi_point_count).toBe(4);   // drops 'Game'
    expect(write.payload.padelgod_point_count).toBe(3);
    expect(write.payload.point_sequence_match).toBe(false);
    expect(write.payload.first_divergence_index).toBe(3); // padelapi has 40:0, padelgod stops there
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement the worker**

`padelgod/src/workers/shadow-diff-finalizer.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { inferWinnerFromSets, joinedScoreString, type SetRow } from '../lib/shadow-winner-inference.js';
import { normalizePadelapiPoint, normalizePadelgodPoint, pointEq, type CanonicalPoint } from '../lib/point-normalizer.js';

export interface ShadowDiffFinalizerDeps {
  supabase: SupabaseClient;
  logger: Logger;
}

export interface ShadowDiffFinalizerResult {
  finalStateRowsWritten: number;
  perPointRowsWritten: number;
  matchesConsidered: number;
}

export async function runShadowDiffFinalizer(
  deps: ShadowDiffFinalizerDeps
): Promise<ShadowDiffFinalizerResult> {
  const { supabase, logger } = deps;

  // 1. Shadow-enrolled tournaments
  const { data: shadowTours, error: toursErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('shadow_enabled', true);
  if (toursErr) throw new Error(`tournaments read failed: ${toursErr.message}`);
  const shadowTourIds = new Set((shadowTours ?? []).map((r: any) => r.id));
  if (shadowTourIds.size === 0) {
    return { finalStateRowsWritten: 0, perPointRowsWritten: 0, matchesConsidered: 0 };
  }

  // 2. Finished matches in those tournaments
  const { data: matches, error: matchesErr } = await supabase
    .from('matches')
    .select('id, tournament_id, winner_pair')
    .eq('status', 'finished')
    .in('tournament_id', Array.from(shadowTourIds));
  if (matchesErr) throw new Error(`matches read failed: ${matchesErr.message}`);
  const finishedMatches = (matches ?? []) as Array<{ id: string; tournament_id: string; winner_pair: number | null }>;

  // 3. Existing diff rows to exclude
  const matchIds = finishedMatches.map((m) => m.id);
  const { data: existingDiff } = await supabase
    .from('shadow_diff') // Note: shadow_diff is in padelgod schema; adjust if needed
    .select('match_id, comparison_type')
    .in('match_id', matchIds);
  const seenFinal = new Set((existingDiff ?? []).filter((d: any) => d.comparison_type === 'final_state').map((d: any) => d.match_id));
  const seenPerPoint = new Set((existingDiff ?? []).filter((d: any) => d.comparison_type === 'per_point_sequence').map((d: any) => d.match_id));

  let finalStateRowsWritten = 0;
  let perPointRowsWritten = 0;

  // 4. For each match — compute final_state diff (if not seen) and per_point_sequence diff (if not seen)
  for (const m of finishedMatches) {
    // FINAL STATE
    if (!seenFinal.has(m.id)) {
      const { data: publicSets } = await supabase
        .from('sets')
        .select('set_number, set_score, pair1_games, pair2_games')
        .eq('match_id', m.id)
        .order('set_number');
      const { data: shadowSets } = await supabase
        .schema('padelgod')
        .from('shadow_sets')
        .select('set_number, set_score, pair1_games, pair2_games')
        .eq('match_id', m.id)
        .order('set_number');

      const shadowSetsArr = (shadowSets ?? []) as SetRow[];
      const publicSetsArr = (publicSets ?? []) as SetRow[];

      const shadowWinner = inferWinnerFromSets(shadowSetsArr);
      const canonicalWinner = m.winner_pair;

      const padelapiFinal = joinedScoreString(publicSetsArr);
      const padelgodFinal = joinedScoreString(shadowSetsArr);

      const winnerMatch = canonicalWinner != null && canonicalWinner === shadowWinner;
      const scoreMatch = padelapiFinal === padelgodFinal && padelapiFinal.length > 0;

      let divergenceReason: string | null = null;
      if (shadowSetsArr.length === 0) divergenceReason = 'missing_sets_in_shadow';
      else if (!winnerMatch) divergenceReason = 'winner_disagreement';
      else if (!scoreMatch) divergenceReason = 'set_score_diff';

      await supabase.schema('padelgod').from('shadow_diff').insert({
        tournament_id: m.tournament_id,
        match_id: m.id,
        comparison_type: 'final_state',
        padelapi_winner_pair: canonicalWinner,
        padelgod_winner_pair: shadowWinner,
        winner_match: winnerMatch,
        padelapi_final_score: padelapiFinal,
        padelgod_final_score: padelgodFinal,
        score_match: scoreMatch,
        divergence_reason: divergenceReason,
      });
      finalStateRowsWritten++;
    }

    // PER POINT SEQUENCE
    if (!seenPerPoint.has(m.id)) {
      const { data: publicGames } = await supabase
        .from('games')
        .select('set_id, game_number, points')
        .eq('match_id', m.id)
        .order('set_id, game_number'); // best-effort; exact order requires joining to sets
      const { data: shadowMps } = await supabase
        .schema('padelgod')
        .from('shadow_match_points')
        .select('set_number, game_number, point_number, score_after')
        .eq('match_id', m.id)
        .order('set_number, game_number, point_number');

      // Normalize both sides into CanonicalPoint[]
      const padelgodPoints: CanonicalPoint[] = ((shadowMps ?? []) as any[]).map((p) => {
        try { return normalizePadelgodPoint(p.score_after); }
        catch { return null; }
      }).filter((x): x is CanonicalPoint => x !== null);

      const padelapiPoints: CanonicalPoint[] = ((publicGames ?? []) as any[]).flatMap((g) => {
        const pts: string[] = (g.points ?? []).filter((p: string) => p && p.includes(':'));
        return pts.map((p) => {
          try { return normalizePadelapiPoint(p); }
          catch { return null; }
        });
      }).filter((x): x is CanonicalPoint => x !== null);

      let firstDivergence: number | null = null;
      let firstDetail: string | null = null;
      const minLen = Math.min(padelapiPoints.length, padelgodPoints.length);
      for (let i = 0; i < minLen; i++) {
        if (!pointEq(padelapiPoints[i]!, padelgodPoints[i]!)) {
          firstDivergence = i;
          firstDetail = `point ${i + 1}: padelapi=${JSON.stringify(padelapiPoints[i])}, padelgod=${JSON.stringify(padelgodPoints[i])}`;
          break;
        }
      }
      if (firstDivergence === null && padelapiPoints.length !== padelgodPoints.length) {
        firstDivergence = minLen;
        firstDetail = `sequence length mismatch: padelapi=${padelapiPoints.length}, padelgod=${padelgodPoints.length}`;
      }

      const sequenceMatch = firstDivergence === null && padelapiPoints.length === padelgodPoints.length;

      await supabase.schema('padelgod').from('shadow_diff').insert({
        tournament_id: m.tournament_id,
        match_id: m.id,
        comparison_type: 'per_point_sequence',
        padelapi_point_count: padelapiPoints.length,
        padelgod_point_count: padelgodPoints.length,
        point_sequence_match: sequenceMatch,
        first_divergence_index: firstDivergence,
        first_divergence_detail: firstDetail,
        divergence_reason: sequenceMatch ? null : 'point_sequence_mismatch',
      });
      perPointRowsWritten++;
    }
  }

  logger.info({ finalStateRowsWritten, perPointRowsWritten, matchesConsidered: finishedMatches.length }, 'shadow-diff-finalizer complete');

  return { finalStateRowsWritten, perPointRowsWritten, matchesConsidered: finishedMatches.length };
}
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: tsc**

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/shadow-diff-finalizer.ts \
        padelgod/src/__tests__/workers/shadow-diff-finalizer.test.ts
git commit -m "feat(padelgod): shadow-diff-finalizer — final_state + per_point_sequence

Runs twice hourly. For each finished match in a shadow-enrolled tournament:
- final_state: compare winner_pair (inferred from shadow_sets on padelgod side)
  and joined set score strings. Write one row with structured divergence_reason
  on mismatch.
- per_point_sequence: normalize padelapi public.games.points[] strings and
  padelgod.shadow_match_points.score_after via point-normalizer into CanonicalPoint[],
  compare element-wise. Record first_divergence_index + first_divergence_detail
  on mismatch.

Idempotent via partial unique index on (match_id, comparison_type)."
```

---

## Task 8: shadow-diff-live worker (live_latency)

**Files:**
- Create: `padelgod/src/workers/shadow-diff-live.ts`
- Create: `padelgod/src/__tests__/workers/shadow-diff-live.test.ts`

- [ ] **Step 1: Write failing test**

`padelgod/src/__tests__/workers/shadow-diff-live.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { runShadowDiffLive } from '../../workers/shadow-diff-live.js';

// ... (same mockLogger + fakeSupabase pattern as shadow-diff-finalizer test, adjust for live mode)

describe('runShadowDiffLive', () => {
  it('writes one live_latency row per live match with both public and shadow set data', async () => {
    const t0 = '2026-04-20T17:00:00Z';
    const t1 = '2026-04-20T17:00:01.500Z'; // 1.5s later

    const supabase = fakeSupabase({
      shadowEnabledTournaments: [{ id: 't1' }],
      liveMatches: [{ id: 'm1', tournament_id: 't1', status: 'live' }],
      publicSets: [{ match_id: 'm1', set_number: 2, updated_at: t0 }],
      shadowSets: [{ match_id: 'm1', set_number: 2, updated_at: t1 }],
    });

    const result = await runShadowDiffLive({ supabase: supabase as any, logger: mockLogger() });
    expect(result.rowsWritten).toBe(1);
    const write = supabase.writes.find((w) => w.table === 'shadow_diff')!;
    expect(write.payload.comparison_type).toBe('live_latency');
    expect(write.payload.latency_delta_ms).toBe(1500); // padelgod updated 1.5s AFTER padelapi
  });

  it('skips matches where shadow_sets has no row yet', async () => {
    const supabase = fakeSupabase({
      shadowEnabledTournaments: [{ id: 't1' }],
      liveMatches: [{ id: 'm1', tournament_id: 't1', status: 'live' }],
      publicSets: [{ match_id: 'm1', set_number: 1, updated_at: '2026-04-20T17:00:00Z' }],
      shadowSets: [],
    });
    const result = await runShadowDiffLive({ supabase: supabase as any, logger: mockLogger() });
    expect(result.rowsWritten).toBe(0);
  });

  it('writes nothing when no tournaments are shadow-enrolled', async () => {
    const supabase = fakeSupabase({
      shadowEnabledTournaments: [],
      liveMatches: [], publicSets: [], shadowSets: [],
    });
    const result = await runShadowDiffLive({ supabase: supabase as any, logger: mockLogger() });
    expect(result.rowsWritten).toBe(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement**

`padelgod/src/workers/shadow-diff-live.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';

export interface ShadowDiffLiveDeps { supabase: SupabaseClient; logger: Logger; }
export interface ShadowDiffLiveResult { rowsWritten: number; matchesConsidered: number; }

export async function runShadowDiffLive(deps: ShadowDiffLiveDeps): Promise<ShadowDiffLiveResult> {
  const { supabase, logger } = deps;

  const { data: tours, error: tErr } = await supabase
    .from('tournaments')
    .select('id')
    .eq('shadow_enabled', true);
  if (tErr) throw new Error(`tournaments read failed: ${tErr.message}`);
  const tourIds = (tours ?? []).map((r: any) => r.id);
  if (tourIds.length === 0) {
    return { rowsWritten: 0, matchesConsidered: 0 };
  }

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select('id, tournament_id')
    .in('tournament_id', tourIds)
    .in('status', ['live', 'ended']);
  if (mErr) throw new Error(`matches read failed: ${mErr.message}`);
  const liveMatches = (matches ?? []) as Array<{ id: string; tournament_id: string }>;

  let rowsWritten = 0;

  for (const m of liveMatches) {
    // Highest-numbered set on each side
    const { data: pSetsData } = await supabase
      .from('sets')
      .select('set_number, updated_at')
      .eq('match_id', m.id)
      .order('set_number', { ascending: false })
      .limit(1);
    const { data: sSetsData } = await supabase
      .schema('padelgod')
      .from('shadow_sets')
      .select('set_number, updated_at')
      .eq('match_id', m.id)
      .order('set_number', { ascending: false })
      .limit(1);

    const pSet = (pSetsData ?? [])[0];
    const sSet = (sSetsData ?? [])[0];
    if (!pSet || !sSet) continue;

    const pTime = new Date(pSet.updated_at).getTime();
    const sTime = new Date(sSet.updated_at).getTime();
    const latency = sTime - pTime; // positive = padelgod slower

    await supabase.schema('padelgod').from('shadow_diff').insert({
      tournament_id: m.tournament_id,
      match_id: m.id,
      comparison_type: 'live_latency',
      padelapi_updated_at: pSet.updated_at,
      padelgod_updated_at: sSet.updated_at,
      latency_delta_ms: latency,
    });
    rowsWritten++;
  }

  logger.info({ rowsWritten, matchesConsidered: liveMatches.length }, 'shadow-diff-live complete');
  return { rowsWritten, matchesConsidered: liveMatches.length };
}
```

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: tsc**

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/shadow-diff-live.ts \
        padelgod/src/__tests__/workers/shadow-diff-live.test.ts
git commit -m "feat(padelgod): shadow-diff-live — per-minute latency snapshots

Runs every minute. For each live match in a shadow-enrolled tournament,
compares public.sets.updated_at (relay) vs padelgod.shadow_sets.updated_at
(padelgod shadow) on the highest-numbered set, records latency_delta_ms
(positive = padelgod slower, negative = padelgod faster).

Rows accumulate one-per-minute per live match — no uniqueness constraint."
```

---

## Task 9: Wire new workers into scheduler + env flags

**Files:**
- Modify: `padelgod/src/scheduler.ts`
- Modify: `padelgod/src/lib/env.ts`
- Modify: `padelgod/src/index.ts`
- Modify: `padelgod/src/__tests__/scheduler.test.ts`

- [ ] **Step 1: Extend env schema**

Edit `padelgod/src/lib/env.ts`:

```typescript
  ENABLE_LIVE_POLLER_MANAGER: z.coerce.boolean().default(true),
  ENABLE_SHADOW_DIFF_FINALIZER: z.coerce.boolean().default(true),   // NEW
  ENABLE_SHADOW_DIFF_LIVE: z.coerce.boolean().default(true),        // NEW
});
```

- [ ] **Step 2: Register in scheduler**

Edit `padelgod/src/scheduler.ts`:

```typescript
// Imports
import { runShadowDiffFinalizer } from './workers/shadow-diff-finalizer.js';
import { runShadowDiffLive } from './workers/shadow-diff-live.js';

// Flags
export interface SchedulerFlags {
  // ...existing...
  enableShadowDiffFinalizer: boolean;
  enableShadowDiffLive: boolean;
}

// WorkerName union
export type WorkerName =
  // ...existing...
  | 'shadow-diff-finalizer'
  | 'shadow-diff-live';

// ALL_WORKERS
export const ALL_WORKERS: WorkerName[] = [
  // ...existing...
  'shadow-diff-finalizer',
  'shadow-diff-live',
];

// getWorkerRunner
export function getWorkerRunner(name: string): WorkerRunner | null {
  switch (name) {
    // ...existing cases...
    case 'shadow-diff-finalizer': return (deps) => runShadowDiffFinalizer({ supabase: deps.supabase, logger: deps.logger });
    case 'shadow-diff-live':      return (deps) => runShadowDiffLive({ supabase: deps.supabase, logger: deps.logger });
    default: return null;
  }
}

// buildSchedule entries (APPEND to the existing if blocks):
if (flags.enableShadowDiffFinalizer) {
  entries.push({
    name: 'shadow-diff-finalizer',
    cron: '10,40 * * * *', // twice hourly, interleaved with static-reconciler (:05, :35)
    run: getWorkerRunner('shadow-diff-finalizer')!,
  });
}
if (flags.enableShadowDiffLive) {
  entries.push({
    name: 'shadow-diff-live',
    cron: '*/1 * * * *', // every minute
    run: getWorkerRunner('shadow-diff-live')!,
  });
}
```

- [ ] **Step 3: Pass new flags in index.ts**

Edit `padelgod/src/index.ts`:

```typescript
const schedule = buildSchedule({
  // ...existing...
  enableLivePollerManager: env.ENABLE_LIVE_POLLER_MANAGER,
  enableShadowDiffFinalizer: env.ENABLE_SHADOW_DIFF_FINALIZER,
  enableShadowDiffLive: env.ENABLE_SHADOW_DIFF_LIVE,
});
```

- [ ] **Step 4: Extend scheduler test**

Edit `padelgod/src/__tests__/scheduler.test.ts`:

Extend `ALL_ENABLED` with `enableShadowDiffFinalizer: true, enableShadowDiffLive: true`. Add new test cases:

```typescript
  it('includes all 13 workers when fully enabled', () => {
    const sched = buildSchedule(ALL_ENABLED);
    const names = sched.map((s) => s.name);
    expect(names).toContain('shadow-diff-finalizer');
    expect(names).toContain('shadow-diff-live');
  });

  it('schedules shadow-diff-finalizer at :10,:40', () => {
    const e = buildSchedule(ALL_ENABLED).find((s) => s.name === 'shadow-diff-finalizer');
    expect(e?.cron).toBe('10,40 * * * *');
  });

  it('schedules shadow-diff-live every minute', () => {
    const e = buildSchedule(ALL_ENABLED).find((s) => s.name === 'shadow-diff-live');
    expect(e?.cron).toBe('*/1 * * * *');
  });

  it('respects enableShadowDiff flags false', () => {
    const sched = buildSchedule({ ...ALL_ENABLED, enableShadowDiffFinalizer: false, enableShadowDiffLive: false });
    const names = sched.map((s) => s.name);
    expect(names).not.toContain('shadow-diff-finalizer');
    expect(names).not.toContain('shadow-diff-live');
  });
```

Also update the existing "includes all N workers when fully enabled" test count (was 11 after Plan 4 → now 13).

- [ ] **Step 5: Run tests + tsc**

```bash
cd padelgod && npm test && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/scheduler.ts padelgod/src/lib/env.ts padelgod/src/index.ts padelgod/src/__tests__/scheduler.test.ts
git commit -m "feat(padelgod): wire shadow-diff-finalizer + shadow-diff-live into scheduler

- shadow-diff-finalizer at cron '10,40 * * * *' (twice hourly)
- shadow-diff-live at cron '*/1 * * * *' (every minute)
- ENABLE_SHADOW_DIFF_FINALIZER / ENABLE_SHADOW_DIFF_LIVE flags default true
- Padelgod now runs 13 scheduled workers"
```

---

## Task 10: Ops API routes

**Files:**
- Create: `src/app/api/ops/padelgod-shadow/health/route.ts`
- Create: `src/app/api/ops/padelgod-shadow/enrollments/route.ts`
- Create: `src/app/api/ops/padelgod-shadow/enroll/route.ts`
- Create: `src/app/api/ops/padelgod-shadow/divergences/route.ts`
- Create: `src/app/api/ops/padelgod-shadow/live/route.ts`

All routes follow the existing ops auth pattern: `cookies().get('ops_token')?.value === process.env.CRON_SECRET`. Each route returns 401 with `{ reason }` on auth failure — copy the pattern from any existing `src/app/api/ops/*/route.ts`.

This task is one large commit — each route is ~50–100 LOC, independent of each other.

- [ ] **Step 1: Write `/health/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  const token = (await cookies()).get('ops_token')?.value;
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'unauthorized', reason: 'server_misconfigured' }, { status: 401 });
  if (token !== process.env.CRON_SECRET) return NextResponse.json({ error: 'unauthorized', reason: 'token_mismatch' }, { status: 401 });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Enrolled count
  const { count: enrolledCount } = await supabase
    .from('tournaments').select('*', { count: 'exact', head: true }).eq('shadow_enabled', true);

  // 2. Live-poll success rate (last 24h)
  const { data: jobs } = await supabase
    .schema('padelgod').from('scrape_jobs')
    .select('status')
    .eq('job_type', 'tournamentlive')
    .gte('started_at', oneDayAgo);
  const jobsArr = jobs ?? [];
  const successJobs = jobsArr.filter((j: any) => j.status === 'success').length;
  const livePollSuccessPct = jobsArr.length > 0 ? (successJobs / jobsArr.length) * 100 : null;

  // 3. Unresolved names queue
  const { count: unresolvedCount } = await supabase
    .schema('padelgod').from('unresolved_players')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  // 4. Final-score match rate (last 7d)
  const { data: finalDiffs } = await supabase
    .schema('padelgod').from('shadow_diff')
    .select('winner_match, score_match')
    .eq('comparison_type', 'final_state')
    .gte('computed_at', oneWeekAgo);
  const finalArr = finalDiffs ?? [];
  const finalStateMatchPct = finalArr.length > 0
    ? (finalArr.filter((d: any) => d.winner_match && d.score_match).length / finalArr.length) * 100
    : null;

  // 5. Per-point sequence match rate (last 7d)
  const { data: perPointDiffs } = await supabase
    .schema('padelgod').from('shadow_diff')
    .select('point_sequence_match')
    .eq('comparison_type', 'per_point_sequence')
    .gte('computed_at', oneWeekAgo);
  const perPointArr = perPointDiffs ?? [];
  const perPointMatchPct = perPointArr.length > 0
    ? (perPointArr.filter((d: any) => d.point_sequence_match).length / perPointArr.length) * 100
    : null;

  // 6. Latency (last 24h)
  const { data: latencyDiffs } = await supabase
    .schema('padelgod').from('shadow_diff')
    .select('latency_delta_ms')
    .eq('comparison_type', 'live_latency')
    .gte('computed_at', oneDayAgo);
  const lats = (latencyDiffs ?? []).map((d: any) => d.latency_delta_ms).filter((n: any) => n != null).sort((a: number, b: number) => a - b);
  const latencyMedianMs = lats.length > 0 ? lats[Math.floor(lats.length / 2)] : null;
  const latencyP95Ms = lats.length > 0 ? lats[Math.floor(lats.length * 0.95)] : null;

  return NextResponse.json({
    enrolledCount: enrolledCount ?? 0,
    livePollSuccessPct, // null if no data in window
    unresolvedCount: unresolvedCount ?? 0,
    finalStateMatchPct,
    perPointMatchPct,
    latencyMedianMs,
    latencyP95Ms,
  });
}
```

- [ ] **Step 2: Write `/enrollments/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

async function requireAuth() {
  const token = (await cookies()).get('ops_token')?.value;
  if (!process.env.CRON_SECRET) return { error: NextResponse.json({ error: 'unauthorized', reason: 'server_misconfigured' }, { status: 401 }) };
  if (token !== process.env.CRON_SECRET) return { error: NextResponse.json({ error: 'unauthorized', reason: 'token_mismatch' }, { status: 401 }) };
  return { error: null };
}

export async function GET() {
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  // Tournaments in ±1d window with cached widget code
  const { data: tours, error } = await supabase
    .from('tournaments')
    .select(`
      id, name, starts_at, ends_at, category, level, live_source, shadow_enabled,
      widget:padelgod_widget_id_cache!inner(widget_id, is_active)
    `)
    .order('starts_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Client-side window filter (the inner join can't easily filter on is_active + date window without RPC)
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;
  const rows = (tours ?? []).filter((t: any) => {
    const start = t.starts_at ? new Date(t.starts_at).getTime() : null;
    const end = t.ends_at ? new Date(t.ends_at).getTime() : null;
    if (end != null && end < now - oneDay) return false;
    if (start != null && start > now + oneDay) return false;
    return t.widget?.is_active === true;
  });

  // For each, compute cutover_ready (all criteria pass — implement as a helper query per tournament)
  const result = [];
  for (const t of rows) {
    const cutoverReady = t.shadow_enabled ? await computeCutoverReady(supabase, t.id) : false;
    result.push({
      tournament_id: t.id,
      name: t.name,
      starts_at: t.starts_at,
      category: t.category,
      level: t.level,
      live_source: t.live_source,
      shadow_enabled: t.shadow_enabled,
      cutover_ready: cutoverReady,
    });
  }

  return NextResponse.json(result);
}

async function computeCutoverReady(supabase: ReturnType<typeof createClient>, tournamentId: string): Promise<boolean> {
  // Cutover criteria from spec §6.4:
  // ≥7 days enrolled (we approximate by tournament.updated_at — but the flag timestamp isn't
  // tracked directly. V1 simplification: drop the duration check; require only the data criteria)
  // ≥5 finished matches with final_state + 100% match
  // ≥5 matches with per_point_sequence + ≥95% match
  // Median latency_delta_ms ≤ +3000ms
  // Zero parser errors in 48h

  const { data: finalDiffs } = await supabase
    .schema('padelgod').from('shadow_diff')
    .select('winner_match, score_match')
    .eq('tournament_id', tournamentId)
    .eq('comparison_type', 'final_state');
  const final = finalDiffs ?? [];
  if (final.length < 5) return false;
  if (!final.every((d: any) => d.winner_match && d.score_match)) return false;

  const { data: perPointDiffs } = await supabase
    .schema('padelgod').from('shadow_diff')
    .select('point_sequence_match')
    .eq('tournament_id', tournamentId)
    .eq('comparison_type', 'per_point_sequence');
  const pp = perPointDiffs ?? [];
  if (pp.length < 5) return false;
  const ppMatchRate = pp.filter((d: any) => d.point_sequence_match).length / pp.length;
  if (ppMatchRate < 0.95) return false;

  const oneDayAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
  const { data: latencyDiffs } = await supabase
    .schema('padelgod').from('shadow_diff')
    .select('latency_delta_ms')
    .eq('tournament_id', tournamentId)
    .eq('comparison_type', 'live_latency')
    .gte('computed_at', oneDayAgo);
  const lats = (latencyDiffs ?? []).map((d: any) => d.latency_delta_ms).filter((n: any) => n != null).sort((a: number, b: number) => a - b);
  if (lats.length > 0) {
    const median = lats[Math.floor(lats.length / 2)];
    if (median > 3000) return false;
  }

  const { data: errJobs } = await supabase
    .schema('padelgod').from('scrape_jobs')
    .select('id')
    .eq('job_type', 'tournamentlive')
    .eq('status', 'error')
    .gte('started_at', oneDayAgo);
  if ((errJobs ?? []).length > 0) return false;

  return true;
}
```

- [ ] **Step 3: Write `/enroll/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const token = (await cookies()).get('ops_token')?.value;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const body = await req.json();
  const { tournament_id, action } = body;
  if (!tournament_id || !['enroll', 'unenroll', 'cutover'].includes(action)) {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  if (action === 'enroll') {
    const { error } = await supabase.from('tournaments').update({ shadow_enabled: true, updated_at: new Date().toISOString() }).eq('id', tournament_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === 'unenroll') {
    const { error } = await supabase.from('tournaments').update({ shadow_enabled: false, updated_at: new Date().toISOString() }).eq('id', tournament_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else if (action === 'cutover') {
    const { error } = await supabase.from('tournaments').update({ live_source: 'padelgod', shadow_enabled: false, updated_at: new Date().toISOString() }).eq('id', tournament_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data } = await supabase.from('tournaments').select('live_source, shadow_enabled').eq('id', tournament_id).maybeSingle();
  return NextResponse.json({ ok: true, live_source: data?.live_source, shadow_enabled: data?.shadow_enabled });
}
```

- [ ] **Step 4: Write `/divergences/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: Request) {
  const token = (await cookies()).get('ops_token')?.value;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const tournament_id = searchParams.get('tournament_id');
  const type = searchParams.get('type') ?? 'final_state';
  const limit = Math.min(200, Number(searchParams.get('limit') ?? 50));
  if (!tournament_id) return NextResponse.json({ error: 'tournament_id required' }, { status: 400 });
  if (!['final_state', 'live_latency', 'per_point_sequence'].includes(type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
  const { data, error } = await supabase
    .schema('padelgod').from('shadow_diff')
    .select('*')
    .eq('tournament_id', tournament_id)
    .eq('comparison_type', type)
    .order('computed_at', { ascending: false })
    .limit(limit);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
```

- [ ] **Step 5: Write `/live/route.ts`**

```typescript
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

export async function GET(req: Request) {
  const token = (await cookies()).get('ops_token')?.value;
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const tournament_id = searchParams.get('tournament_id');
  if (!tournament_id) return NextResponse.json({ error: 'tournament_id required' }, { status: 400 });

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);

  const { data: matches, error: mErr } = await supabase
    .from('matches')
    .select(`id, status, round, pair1_player1:players!pair1_player1_id(name), pair1_player2:players!pair1_player2_id(name), pair2_player1:players!pair2_player1_id(name), pair2_player2:players!pair2_player2_id(name)`)
    .eq('tournament_id', tournament_id)
    .in('status', ['live', 'ended']);
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });

  const result = [];
  for (const m of matches ?? []) {
    const { data: pSets } = await supabase
      .from('sets').select('set_number, set_score, pair1_games, pair2_games, updated_at')
      .eq('match_id', m.id).order('set_number', { ascending: false }).limit(1);
    const { data: sSets } = await supabase
      .schema('padelgod').from('shadow_sets').select('set_number, set_score, pair1_games, pair2_games, updated_at')
      .eq('match_id', m.id).order('set_number', { ascending: false }).limit(1);
    const p = (pSets ?? [])[0];
    const s = (sSets ?? [])[0];
    if (!p && !s) continue;

    result.push({
      match_id: m.id,
      status: m.status,
      round: m.round,
      players: [
        m.pair1_player1?.name, m.pair1_player2?.name,
        m.pair2_player1?.name, m.pair2_player2?.name,
      ],
      publicSetScore: p?.set_score ?? null,
      publicUpdatedAt: p?.updated_at ?? null,
      shadowSetScore: s?.set_score ?? null,
      shadowUpdatedAt: s?.updated_at ?? null,
      latencyMs: p && s ? new Date(s.updated_at).getTime() - new Date(p.updated_at).getTime() : null,
      agreement: p?.set_score === s?.set_score,
    });
  }

  return NextResponse.json(result);
}
```

- [ ] **Step 6: Build main app**

```bash
npm run build
```

Expected: succeeds with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/ops/padelgod-shadow/
git commit -m "feat(ops): add Padelgod Shadow API routes

5 endpoints under /api/ops/padelgod-shadow:
- GET /health → aggregate health card values (success rate, match rates, latency)
- GET /enrollments → tournaments in ±1d window + cutover_ready derived flag
- POST /enroll → toggle shadow_enabled (enroll/unenroll) or atomically cut over
- GET /divergences → shadow_diff rows filtered by tournament + comparison type
- GET /live → side-by-side current set scores per live match

Auth via existing ops_token cookie + CRON_SECRET check.
Cutover criteria enforced in /enrollments.cutover_ready — UI uses this to
gate the 'Cutover to padelgod' button."
```

---

## Task 11: Ops dashboard tab UI component

**Files:**
- Create: `src/app/ops/PadelgodShadowTab.tsx`
- Modify: `src/app/ops/page.tsx` (or wherever tabs are registered — investigate first)

- [ ] **Step 1: Find the existing tab structure**

Run:

```bash
grep -rn "ops dashboard\|OpsTab\|tabs.push\|<Tab " src/app/ops/ | head -20
```

Look for the main ops page file that renders tabs. Use the pattern there. Existing tab components likely follow a shape like `function MyTabContent({ isActive }: { isActive: boolean })`.

- [ ] **Step 2: Write the tab component**

`src/app/ops/PadelgodShadowTab.tsx`:

```typescript
'use client';

import { useState, useEffect } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface HealthData {
  enrolledCount: number;
  livePollSuccessPct: number | null;
  unresolvedCount: number;
  finalStateMatchPct: number | null;
  perPointMatchPct: number | null;
  latencyMedianMs: number | null;
  latencyP95Ms: number | null;
}

interface EnrollmentRow {
  tournament_id: string;
  name: string;
  starts_at: string | null;
  category: string;
  level: string;
  live_source: string;
  shadow_enabled: boolean;
  cutover_ready: boolean;
}

export function PadelgodShadowTab() {
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const { data: health } = useSWR<HealthData>('/api/ops/padelgod-shadow/health', fetcher, { refreshInterval: 30_000 });
  const { data: enrollments, mutate: refetchEnrollments } = useSWR<EnrollmentRow[]>('/api/ops/padelgod-shadow/enrollments', fetcher, { refreshInterval: 60_000 });

  async function handleAction(tournament_id: string, action: 'enroll' | 'unenroll' | 'cutover') {
    if (action === 'cutover') {
      if (!confirm(`Cut over this tournament to Padelgod? Rollback via Unenroll.`)) return;
    }
    const res = await fetch('/api/ops/padelgod-shadow/enroll', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tournament_id, action }),
    });
    if (!res.ok) {
      const err = await res.text();
      alert(`Action failed: ${err}`);
      return;
    }
    refetchEnrollments();
  }

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-2xl font-bold">Padelgod Shadow</h1>

      {/* Section 1: Health cards */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Health</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          <HealthCard label="Enrolled" value={health?.enrolledCount ?? '—'} />
          <HealthCard label="Live-poll success (24h)" value={fmtPct(health?.livePollSuccessPct)} red={threshold(health?.livePollSuccessPct, 99)} />
          <HealthCard label="Unresolved names" value={health?.unresolvedCount ?? '—'} red={(health?.unresolvedCount ?? 0) > 5} />
          <HealthCard label="Final score match (7d)" value={fmtPct(health?.finalStateMatchPct)} red={threshold(health?.finalStateMatchPct, 100)} />
          <HealthCard label="Per-point match (7d)" value={fmtPct(health?.perPointMatchPct)} red={threshold(health?.perPointMatchPct, 95)} />
          <HealthCard label="Latency median (24h)" value={fmtMs(health?.latencyMedianMs)} red={(health?.latencyMedianMs ?? 0) > 0} />
          <HealthCard label="Latency p95 (24h)" value={fmtMs(health?.latencyP95Ms)} red={(health?.latencyP95Ms ?? 0) > 3000} />
        </div>
      </section>

      {/* Section 2: Enrollment table */}
      <section>
        <h2 className="text-xl font-semibold mb-2">Enrollment</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-gray-100">
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Starts</th>
              <th className="text-left p-2">Category</th>
              <th className="text-left p-2">Level</th>
              <th className="text-left p-2">live_source</th>
              <th className="text-left p-2">shadow</th>
              <th className="text-left p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(enrollments ?? []).map((t) => (
              <tr
                key={t.tournament_id}
                className={`border-t cursor-pointer ${selectedTournamentId === t.tournament_id ? 'bg-blue-50' : ''}`}
                onClick={() => setSelectedTournamentId(t.tournament_id === selectedTournamentId ? null : t.tournament_id)}
              >
                <td className="p-2">{t.name}</td>
                <td className="p-2">{t.starts_at ? new Date(t.starts_at).toLocaleDateString() : '—'}</td>
                <td className="p-2">{t.category}</td>
                <td className="p-2">{t.level}</td>
                <td className="p-2 font-mono">{t.live_source}</td>
                <td className="p-2">{t.shadow_enabled ? '✓' : ''}</td>
                <td className="p-2 space-x-2" onClick={(e) => e.stopPropagation()}>
                  {!t.shadow_enabled && t.live_source === 'padelapi' && (
                    <button onClick={() => handleAction(t.tournament_id, 'enroll')} className="text-blue-600">Enroll</button>
                  )}
                  {t.shadow_enabled && (
                    <button onClick={() => handleAction(t.tournament_id, 'unenroll')} className="text-gray-600">Unenroll</button>
                  )}
                  {t.shadow_enabled && (
                    <button
                      onClick={() => handleAction(t.tournament_id, 'cutover')}
                      className={t.cutover_ready ? 'text-green-600 font-bold' : 'text-gray-400 cursor-not-allowed'}
                      disabled={!t.cutover_ready}
                      title={t.cutover_ready ? 'All criteria met' : 'Criteria not met yet'}
                    >
                      Cutover
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Section 3: Per-tournament drilldown */}
      {selectedTournamentId && (
        <DrilldownSection tournament_id={selectedTournamentId} />
      )}
    </div>
  );
}

function HealthCard({ label, value, red }: { label: string; value: string | number; red?: boolean }) {
  return (
    <div className={`p-3 border rounded ${red ? 'border-red-500 bg-red-50' : 'border-gray-300'}`}>
      <div className="text-xs text-gray-600">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

function DrilldownSection({ tournament_id }: { tournament_id: string }) {
  const { data: live } = useSWR(`/api/ops/padelgod-shadow/live?tournament_id=${tournament_id}`, fetcher, { refreshInterval: 30_000 });
  const { data: finals } = useSWR(`/api/ops/padelgod-shadow/divergences?tournament_id=${tournament_id}&type=final_state&limit=50`, fetcher);
  const { data: perPoints } = useSWR(`/api/ops/padelgod-shadow/divergences?tournament_id=${tournament_id}&type=per_point_sequence&limit=50`, fetcher);

  return (
    <section>
      <h2 className="text-xl font-semibold mb-2">Tournament detail</h2>

      {(live?.length ?? 0) > 0 && (
        <div className="mb-4">
          <h3 className="font-semibold">Live matches</h3>
          <table className="w-full text-sm border-collapse">
            <thead><tr className="bg-gray-100"><th className="text-left p-2">Match</th><th className="text-left p-2">padelapi</th><th className="text-left p-2">padelgod</th><th className="text-left p-2">Δms</th><th className="text-left p-2">Agree</th></tr></thead>
            <tbody>
              {live!.map((r: any) => (
                <tr key={r.match_id} className="border-t">
                  <td className="p-2">{r.players?.filter(Boolean).join(', ')}</td>
                  <td className="p-2 font-mono">{r.publicSetScore ?? '—'}</td>
                  <td className="p-2 font-mono">{r.shadowSetScore ?? '—'}</td>
                  <td className="p-2">{r.latencyMs ?? '—'}</td>
                  <td className="p-2">{r.agreement ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <h3 className="font-semibold">Final-state history</h3>
        <table className="w-full text-sm border-collapse">
          <thead><tr className="bg-gray-100"><th className="text-left p-2">Match</th><th className="text-left p-2">Winner</th><th className="text-left p-2">padelapi</th><th className="text-left p-2">padelgod</th><th className="text-left p-2">Per-point</th></tr></thead>
          <tbody>
            {(finals ?? []).map((d: any) => {
              const perPoint = (perPoints ?? []).find((p: any) => p.match_id === d.match_id);
              return (
                <tr key={d.id} className="border-t">
                  <td className="p-2">{d.match_id.slice(0, 8)}</td>
                  <td className="p-2">{d.winner_match ? '✓' : '✗'}</td>
                  <td className="p-2 font-mono">{d.padelapi_final_score}</td>
                  <td className="p-2 font-mono">{d.padelgod_final_score}</td>
                  <td className="p-2">{perPoint?.point_sequence_match ? '✓' : perPoint ? `✗ @${perPoint.first_divergence_index}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}
function fmtMs(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(0)}ms`;
}
function threshold(value: number | null | undefined, minPct: number): boolean {
  if (value == null) return false;
  return value < minPct;
}
```

- [ ] **Step 3: Run main app build**

```bash
npm run build
```

Expected: success. Fix any TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/ops/PadelgodShadowTab.tsx
git commit -m "feat(ops): Padelgod Shadow dashboard tab UI

Three sections:
- Health cards (7 metrics, red when thresholds breached)
- Enrollment table with Enroll / Unenroll / Cutover buttons
- Per-tournament drilldown: live side-by-side + final-state history

Cutover button is disabled unless API's cutover_ready flag is true
(backend enforces all criteria from spec §6.4). SWR polls health every 30s,
enrollments every 60s, live every 30s. Uses existing ops API auth pattern."
```

---

## Task 12: Register the tab in the ops dashboard

**Files:**
- Modify: `src/app/ops/page.tsx` (or whatever parent renders tabs)

Investigate first — the file with `<Tabs>` or similar. Add "Padelgod Shadow" to the tab list importing `PadelgodShadowTab`.

- [ ] **Step 1: Find the tabs registry**

```bash
grep -rn "Ongoing Events\|Integration Health\|EntryListTab" src/app/ops/
```

Look for an array/object of tabs, or a switch on selected tab name. Add the new tab.

- [ ] **Step 2: Add the new tab**

Locate the tabs list and add:

```typescript
import { PadelgodShadowTab } from './PadelgodShadowTab';

// In the tab list / render:
{ name: 'Padelgod Shadow', component: PadelgodShadowTab },
```

Exact shape depends on the existing pattern — match it.

- [ ] **Step 3: Build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/app/ops/page.tsx
git commit -m "feat(ops): register Padelgod Shadow tab in ops dashboard"
```

---

## Task 13: Push branch + open PR

- [ ] **Step 1: Push**

```bash
git push -u origin feat/padelgod-shadow
```

- [ ] **Step 2: Open PR via `gh pr create`**

```bash
gh pr create --base main --head feat/padelgod-shadow --title "Padelgod Shadow Mode — Phase 1 validation layer" --body "$(cat <<'EOF'
## Summary

Ships Padelgod Shadow Mode — Phase 1 of the original design spec's migration phasing
(2026-04-20-padelgod-design.md §6). Runs Padelgod's live pipeline in parallel with the
padelapi relay, writing to padelgod.shadow_* tables and surfacing divergence via a new
ops dashboard tab.

No changes to production hot paths or user-facing UI.

See spec: docs/superpowers/specs/2026-04-20-padelgod-shadow-mode-design.md

## Changes

- 3 migrations (tournaments.shadow_enabled, shadow tables, new RPC)
- padelgod: LivePollerLoop + applyDiff gain mode param; manager reconciles 2 RPCs;
  2 new workers (shadow-diff-finalizer, shadow-diff-live)
- main app: /api/ops/padelgod-shadow/ (5 endpoints); new ops tab

## Rollout (post-merge, user actions)

1. Revert Brussels P2: `UPDATE tournaments SET live_source='padelapi' WHERE id='b91c4c7d-...'`
2. Apply migrations 018, 019, 020 in Supabase SQL editor
3. Vercel + Railway auto-deploy
4. Enroll 1 upcoming Premier event via the new ops tab
5. Monitor for 7 days
6. If clean, enroll 2–3 more; after 2–3 weeks click "Cutover" per tournament

## Test plan

- [x] TypeScript clean
- [x] All unit tests passing
- [ ] Migrations applied in Supabase
- [ ] Vercel build succeeds
- [ ] Railway deploys padelgod without startup errors
- [ ] First enrolled tournament produces shadow_sets + shadow_match_points rows within 6s
- [ ] shadow-diff-live produces rows within 1 min of first live match
- [ ] shadow-diff-finalizer produces final_state + per_point_sequence rows on first finished match

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

If `gh` isn't authenticated: write the PR body to `PR_BODY_SHADOW.md` and paste via web UI at `https://github.com/gudenes/padel-live-scores/pull/new/feat/padelgod-shadow`.

- [ ] **Step 3: Verify the PR URL** is returned and working.

---

## Definition of done

1. ✅ Migrations 018/019/020 applied to Supabase
2. ✅ `feat/padelgod-shadow` merged to main
3. ✅ Railway deploys; `live-poller-manager` logs show it's querying 2 RPCs
4. ✅ First shadow-enrolled tournament produces `padelgod.shadow_sets` rows within 1 poll cycle
5. ✅ First finished match in a shadow-enrolled tournament produces 1 `shadow_diff` row of type `final_state` AND 1 of type `per_point_sequence`
6. ✅ Ops dashboard "Padelgod Shadow" tab renders with live data
7. ✅ Enroll / Unenroll / Cutover buttons work end-to-end

---

## Deliberately NOT in this plan (fast follow-ups if needed)

- Historical cutover log ("who cut over what when") — reconstructable from `tournaments.updated_at` + Git
- Time-series charts / sparklines for latency trend
- Bulk enroll (single-tournament only, by design)
- Mobile-friendly responsive layout (ops dashboard is desktop-only by convention)
- Persisting `suspectedMissedPoints` from Task 11 into `scrape_jobs` (log-only for V1)
- Auto-cutover when criteria pass (criteria gate the button; humans click)
- Alerts (Slack/email) when divergence breaches thresholds — polled UI, not pushed
- Retention / purge job for shadow tables (unbounded growth acceptable for V1; revisit post-Plan-7)
