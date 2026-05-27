# Odds in Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operationalize the Elo + Monte Carlo odds model inside `admin.padelnachos.com` (the `apps/ops/` Next.js app) — per-match decimal odds, per-tournament championship probabilities, in-app methodology page, and calibration monitoring (Brier + log-loss).

**Architecture:** Padelgod (Railway) hosts two append-only snapshot workers (`model-prediction-snapshot` hourly at `:25`, `prediction-scorer` every 10 min at `:03..:53`). Three new Supabase tables receive their writes. The admin app reads the latest snapshot per match/tournament directly via Supabase (no new API routes in v1). Shared math lives in `padelgod/src/lib/elo-model.ts`; the standalone `scripts/simulate-elo-tournaments.ts` is refactored to import from it so both surfaces stay in sync.

**Tech Stack:** TypeScript, Node.js (padelgod), Next.js 16 + React 19 (apps/ops/), Supabase (PostgreSQL), vitest, node-cron, pino, recharts (already in repo).

**Reference materials:**
- Spec: `docs/superpowers/specs/2026-05-27-odds-admin-visibility-design.md`
- Model methodology: `docs/superpowers/specs/2026-05-27-elo-odds-model-design.md`
- Working reference impl: `scripts/simulate-elo-tournaments.ts`

---

## Phase 1 — Foundation

Migration + shared lib + script refactor. Ends with idle tables and a refactored script that produces byte-identical output.

### Task 1.1: Supabase migration — three append-only tables

**Files:**
- Create: `supabase/migrations/20260527_create_model_prediction_tables.sql`

- [ ] **Step 1: Create the migration file with the full SQL**

```sql
-- Append-only snapshot tables for the Elo + Monte Carlo odds model.
-- See docs/superpowers/specs/2026-05-27-odds-admin-visibility-design.md §1.
-- No UPDATEs in normal operation — the latest row per key is the current state.

BEGIN;

-- ─── model_predictions ──────────────────────────────────────────────────────
-- One row per per-match snapshot (hourly cron writes one per upcoming match).

CREATE TABLE IF NOT EXISTS model_predictions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id              UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  pair1_prob            NUMERIC(5,4) NOT NULL CHECK (pair1_prob >= 0 AND pair1_prob <= 1),
  pair2_prob            NUMERIC(5,4) NOT NULL CHECK (pair2_prob >= 0 AND pair2_prob <= 1),
  pair1_decimal_odds    NUMERIC(8,3) NOT NULL CHECK (pair1_decimal_odds >= 1),
  pair2_decimal_odds    NUMERIC(8,3) NOT NULL CHECK (pair2_decimal_odds >= 1),
  pair1_team_elo        NUMERIC(7,2) NOT NULL,
  pair2_team_elo        NUMERIC(7,2) NOT NULL,
  pair1_team_form       NUMERIC(6,2) NOT NULL DEFAULT 0,
  pair2_team_form       NUMERIC(6,2) NOT NULL DEFAULT 0,
  model_version         TEXT NOT NULL,
  training_match_count  INTEGER NOT NULL,
  halflife_days         INTEGER NOT NULL
);

COMMENT ON TABLE model_predictions IS 'Per-match Elo-model odds snapshots. Append-only; latest row per match_id is current.';

CREATE INDEX IF NOT EXISTS model_predictions_match_created_idx
  ON model_predictions (match_id, created_at DESC);

CREATE INDEX IF NOT EXISTS model_predictions_created_idx
  ON model_predictions (created_at);

-- ─── model_tournament_predictions ───────────────────────────────────────────
-- One row per pair per tournament per snapshot.

CREATE TABLE IF NOT EXISTS model_tournament_predictions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id         UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  category              TEXT NOT NULL CHECK (category IN ('men', 'women')),
  pair_player1_id       UUID NOT NULL REFERENCES players(id),
  pair_player2_id       UUID NOT NULL REFERENCES players(id),
  pair_seed             INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  champ_prob            NUMERIC(5,4) NOT NULL CHECK (champ_prob >= 0 AND champ_prob <= 1),
  finalist_prob         NUMERIC(5,4) NOT NULL CHECK (finalist_prob >= 0 AND finalist_prob <= 1),
  semi_prob             NUMERIC(5,4) NOT NULL CHECK (semi_prob >= 0 AND semi_prob <= 1),
  team_elo              NUMERIC(7,2) NOT NULL,
  team_form             NUMERIC(6,2) NOT NULL DEFAULT 0,
  entry_round           TEXT NOT NULL,
  model_version         TEXT NOT NULL,
  mc_runs               INTEGER NOT NULL,
  halflife_days         INTEGER NOT NULL
);

COMMENT ON TABLE model_tournament_predictions IS 'Per-pair Monte Carlo championship/finalist/semi probabilities. Append-only.';

CREATE INDEX IF NOT EXISTS model_tournament_predictions_tcat_created_idx
  ON model_tournament_predictions (tournament_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS model_tournament_predictions_created_idx
  ON model_tournament_predictions (created_at);

-- ─── prediction_scores ──────────────────────────────────────────────────────
-- One row per scored match. UNIQUE(match_id) enforces idempotency.

CREATE TABLE IF NOT EXISTS prediction_scores (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prediction_id            UUID NOT NULL REFERENCES model_predictions(id) ON DELETE CASCADE,
  match_id                 UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  scored_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  actual_winner_pair       INTEGER NOT NULL CHECK (actual_winner_pair IN (1, 2)),
  predicted_prob_winner    NUMERIC(5,4) NOT NULL CHECK (predicted_prob_winner > 0 AND predicted_prob_winner <= 1),
  brier_score              NUMERIC(6,5) NOT NULL CHECK (brier_score >= 0 AND brier_score <= 1),
  log_loss                 NUMERIC(8,5) NOT NULL CHECK (log_loss >= 0),
  model_version            TEXT NOT NULL,
  CONSTRAINT prediction_scores_match_id_unique UNIQUE (match_id)
);

COMMENT ON TABLE prediction_scores IS 'Per-match calibration scoring. UNIQUE(match_id) = one score per match.';

CREATE INDEX IF NOT EXISTS prediction_scores_version_scored_idx
  ON prediction_scores (model_version, scored_at);

COMMIT;
```

- [ ] **Step 2: Verify the SQL parses by running it against a local Supabase if available**

Run: `cd supabase && supabase db push --dry-run 2>&1 | tail -20`
Expected: lists the 3 new tables; no errors. If no local Supabase, skip this step.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260527_create_model_prediction_tables.sql
git commit -m "feat(odds): add model_predictions, model_tournament_predictions, prediction_scores tables"
```

---

### Task 1.2: Shared lib `padelgod/src/lib/elo-model.ts`

Extract all pure math from `scripts/simulate-elo-tournaments.ts` into a testable module. Multiple TDD cycles in one task.

**Files:**
- Create: `padelgod/src/lib/elo-model.ts`
- Create: `padelgod/src/lib/__tests__/elo-model.test.ts`

- [ ] **Step 1: Write the failing tests for the cold-start prior + K-factor + decay**

Create `padelgod/src/lib/__tests__/elo-model.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  fipPriorElo,
  kFactor,
  decayWeight,
  pairWinProbability,
  toDecimal,
  toAmerican,
  toFractional,
  brierScore,
  logLoss,
  MODEL_VERSION,
} from '../elo-model.js';

describe('fipPriorElo', () => {
  it('rank 1 → 2200', () => {
    expect(fipPriorElo(1)).toBeCloseTo(2200, 1);
  });
  it('rank 10 → ~1950', () => {
    expect(fipPriorElo(10)).toBeCloseTo(1950, 0);
  });
  it('rank 200 → ~1225', () => {
    expect(fipPriorElo(200)).toBeCloseTo(1225, 0);
  });
  it('null rank → 1300 default', () => {
    expect(fipPriorElo(null)).toBe(1300);
  });
  it('unranked / 0 / negative → 1300', () => {
    expect(fipPriorElo(0)).toBe(1300);
    expect(fipPriorElo(-5)).toBe(1300);
  });
  it('huge rank → floored at 1100', () => {
    expect(fipPriorElo(999_999)).toBe(1100);
  });
});

describe('kFactor', () => {
  it('major → 36', () => expect(kFactor('major')).toBe(36));
  it('p1 → 36', () => expect(kFactor('p1')).toBe(36));
  it('p2 → 30', () => expect(kFactor('p2')).toBe(30));
  it('fip_platinum → 30', () => expect(kFactor('fip_platinum')).toBe(30));
  it('fip_gold → 24', () => expect(kFactor('fip_gold')).toBe(24));
  it('fip_silver → 20', () => expect(kFactor('fip_silver')).toBe(20));
  it('fip_bronze → 14', () => expect(kFactor('fip_bronze')).toBe(14));
  it('null / unknown → 18', () => {
    expect(kFactor(null)).toBe(18);
    expect(kFactor('something_weird')).toBe(18);
  });
});

describe('decayWeight', () => {
  it('0 days → 1.0', () => {
    expect(decayWeight(0, 180)).toBeCloseTo(1.0, 5);
  });
  it('1 halflife → 0.5', () => {
    expect(decayWeight(180, 180)).toBeCloseTo(0.5, 5);
  });
  it('2 halflives → 0.25', () => {
    expect(decayWeight(360, 180)).toBeCloseTo(0.25, 5);
  });
  it('negative age clamped to 0', () => {
    expect(decayWeight(-10, 180)).toBeCloseTo(1.0, 5);
  });
});

describe('pairWinProbability', () => {
  it('equal Elos → 0.5', () => {
    expect(pairWinProbability(2000, 2000)).toBeCloseTo(0.5, 5);
  });
  it('400-point gap → ~0.909 for higher', () => {
    expect(pairWinProbability(2400, 2000)).toBeCloseTo(0.909, 2);
  });
  it('symmetric: P(a beats b) + P(b beats a) = 1', () => {
    const a = pairWinProbability(2100, 1900);
    const b = pairWinProbability(1900, 2100);
    expect(a + b).toBeCloseTo(1, 5);
  });
});

describe('odds conversions', () => {
  it('toDecimal(0.5) = 2.00', () => {
    expect(toDecimal(0.5)).toBeCloseTo(2.0, 2);
  });
  it('toDecimal(0.25) = 4.00', () => {
    expect(toDecimal(0.25)).toBeCloseTo(4.0, 2);
  });
  it('toAmerican(0.819) ≈ -452', () => {
    expect(toAmerican(0.819)).toBe(-452);
  });
  it('toAmerican(0.181) ≈ +452 (mirror of above)', () => {
    expect(toAmerican(0.181)).toBe(452);
  });
  it('toAmerican(0.5) = -100 (boundary favourite)', () => {
    expect(toAmerican(0.5)).toBe(-100);
  });
  it('toFractional(0.5) = 1/1', () => {
    expect(toFractional(0.5)).toBe('1/1');
  });
  it('toFractional(0.8) returns odds-on form (1/4)', () => {
    expect(toFractional(0.8)).toBe('1/4');
  });
});

describe('calibration scoring', () => {
  it('brierScore: perfect prediction = 0', () => {
    expect(brierScore(1.0, 1)).toBeCloseTo(0, 5);
  });
  it('brierScore: worst prediction = 1', () => {
    expect(brierScore(0.0, 1)).toBeCloseTo(1, 5);
  });
  it('brierScore(0.819, 1) ≈ 0.0328', () => {
    expect(brierScore(0.819, 1)).toBeCloseTo(0.0328, 3);
  });
  it('logLoss: perfect (prob=1) → 0', () => {
    expect(logLoss(1.0)).toBeCloseTo(0, 5);
  });
  it('logLoss(0.819) ≈ 0.1997', () => {
    expect(logLoss(0.819)).toBeCloseTo(0.1997, 3);
  });
  it('logLoss clamps near-zero to avoid +Infinity', () => {
    expect(Number.isFinite(logLoss(1e-12))).toBe(true);
  });
});

describe('MODEL_VERSION', () => {
  it('is a non-empty string', () => {
    expect(MODEL_VERSION).toMatch(/^v\d/);
  });
});
```

- [ ] **Step 2: Run tests, verify they all fail**

Run: `cd padelgod && npm test -- elo-model 2>&1 | tail -30`
Expected: All tests fail with "module not found" or similar.

- [ ] **Step 3: Implement `padelgod/src/lib/elo-model.ts`**

```typescript
// Pure-function module for the Elo + Monte Carlo odds model.
// See docs/superpowers/specs/2026-05-27-elo-odds-model-design.md for full methodology.
// All math is shared between scripts/simulate-elo-tournaments.ts and the
// padelgod workers (model-prediction-snapshot, prediction-scorer).

export const MODEL_VERSION = 'v0-td180-fip-prior';

// ─── Cold-start prior ────────────────────────────────────────────────────────
//   rank 1   → 2200
//   rank 10  → ~1950
//   rank 50  → ~1675
//   rank 200 → ~1225
//   floored at 1100 for very-low-ranked / unranked-but-given-a-number cases
//   defaults to 1300 for null / 0 / negative
export function fipPriorElo(ranking: number | null | undefined): number {
  if (!ranking || ranking <= 0) return 1300;
  return Math.max(1100, 2200 - 250 * Math.log10(ranking));
}

// ─── K-factor by tournament tier ─────────────────────────────────────────────
export function kFactor(level: string | null | undefined): number {
  const l = (level ?? '').toLowerCase();
  if (l === 'major' || l === 'p1' || l === 'premier_p1') return 36;
  if (l === 'p2' || l === 'premier_p2' || l === 'fip_platinum') return 30;
  if (l === 'fip_gold') return 24;
  if (l === 'fip_silver') return 20;
  if (l === 'fip_bronze' || l === 'fip_beyond' || l === 'fip_promises') return 14;
  return 18;
}

// ─── Time decay ──────────────────────────────────────────────────────────────
// K_effective = K_tier × 0.5 ^ (ageDays / halflifeDays). Negative ages
// (defensive — shouldn't happen given asOf anchoring) are clamped to 0.
export function decayWeight(ageDays: number, halflifeDays: number): number {
  const age = Math.max(0, ageDays);
  return Math.pow(0.5, age / halflifeDays);
}

// ─── Per-match win probability ───────────────────────────────────────────────
// Standard Elo logistic. Pair Elo expected to be the arithmetic mean of the
// two players' individual Elos — caller's responsibility.
export function pairWinProbability(eloPair1: number, eloPair2: number): number {
  return 1 / (1 + Math.pow(10, (eloPair2 - eloPair1) / 400));
}

// ─── Odds conversions ────────────────────────────────────────────────────────
// All operate on fair probabilities (no vig). Reading guide for outputs:
//   decimal 1.84   → bet $1, win $0.84 profit
//   american -119  → bet $119 to win $100 profit (favourite)
//   american +217  → bet $100 to win $217 profit (underdog)

export function toDecimal(p: number): number {
  if (p <= 0) return 999.99;
  return 1 / p;
}

export function toAmerican(p: number): number {
  if (p >= 0.5) return -Math.round((100 * p) / (1 - p));
  return Math.round((100 * (1 - p)) / p);
}

export function toFractional(p: number): string {
  if (p <= 0) return '999/1';
  if (p >= 1) return '1/999';
  const ratio = (1 - p) / p;
  if (ratio < 1) {
    const denom = Math.round(1 / ratio);
    return `1/${denom}`;
  }
  // Pick the nicest denominator from 1..6
  const candidates: Array<[number, number]> = [];
  for (let d = 1; d <= 6; d++) {
    const n = Math.round(ratio * d);
    if (n >= 1) candidates.push([n, d]);
  }
  let best = candidates[0]!;
  let bestErr = Infinity;
  for (const [n, d] of candidates) {
    const err = Math.abs(ratio - n / d);
    if (err < bestErr) {
      bestErr = err;
      best = [n, d];
    }
  }
  return `${best[0]}/${best[1]}`;
}

// ─── Calibration scoring ─────────────────────────────────────────────────────
// brierScore: predictedProb is the prob assigned to the side that ACTUALLY
//             won. actual is always 1 in this caller pattern (we pass the
//             prob-for-winner, not prob-for-pair1). Lower is better, perfect=0.
export function brierScore(predictedProbWinner: number, actual: 0 | 1): number {
  return Math.pow(predictedProbWinner - actual, 2);
}

// logLoss: clamped near 0 to avoid +Infinity from numerical edge cases.
export function logLoss(predictedProbWinner: number): number {
  const clamped = Math.max(1e-6, predictedProbWinner);
  return -Math.log(clamped);
}

// ─── Elo training ────────────────────────────────────────────────────────────
// Trains per-player Elo over chronologically-ordered matches.
// asOfIso anchors the time-decay weight so backtests and live use the same
// formula without "now()" drift.

export interface TrainingMatch {
  id: string;
  tournament_id: string | null;
  finished_at: string | null;
  scheduled_at: string | null;
  pair1_player1_id: string | null;
  pair1_player2_id: string | null;
  pair2_player1_id: string | null;
  pair2_player2_id: string | null;
  winner_pair: number | null;
}

export interface PlayerSnapshot {
  id: string;
  name: string;
  ranking: number | null;
  category: string | null;
}

export interface TrainResult {
  elo: Map<string, number>;
  eloFormStart: Map<string, number>;
  halflifeDays: number;
  trainedCount: number;
}

export const FORM_WINDOW_DAYS = 30;

export function trainElo(
  matches: TrainingMatch[],
  players: Map<string, PlayerSnapshot>,
  tournamentLevels: Map<string, string>,
  asOfIso: string,
  halflifeDays: number,
): TrainResult {
  const elo = new Map<string, number>();
  const asOfMs = new Date(asOfIso).getTime();
  const formSnapshotCutoffMs = asOfMs - FORM_WINDOW_DAYS * 86_400_000;
  let eloFormStart: Map<string, number> | null = null;

  const getR = (pid: string): number => {
    let r = elo.get(pid);
    if (r == null) {
      r = fipPriorElo(players.get(pid)?.ranking ?? null);
      elo.set(pid, r);
    }
    return r;
  };

  let trained = 0;
  for (const m of matches) {
    if (
      !m.pair1_player1_id || !m.pair1_player2_id ||
      !m.pair2_player1_id || !m.pair2_player2_id ||
      (m.winner_pair !== 1 && m.winner_pair !== 2)
    ) {
      continue;
    }
    const matchMs = new Date(m.scheduled_at ?? m.finished_at ?? asOfIso).getTime();
    if (!eloFormStart && matchMs >= formSnapshotCutoffMs) {
      eloFormStart = new Map(elo);
    }
    const r1a = getR(m.pair1_player1_id);
    const r1b = getR(m.pair1_player2_id);
    const r2a = getR(m.pair2_player1_id);
    const r2b = getR(m.pair2_player2_id);
    const t1 = (r1a + r1b) / 2;
    const t2 = (r2a + r2b) / 2;
    const expected1 = pairWinProbability(t1, t2);
    const actual1 = m.winner_pair === 1 ? 1 : 0;
    const kBase = kFactor(tournamentLevels.get(m.tournament_id ?? '') ?? null);
    const ageDays = Math.max(0, (asOfMs - matchMs) / 86_400_000);
    const k = kBase * decayWeight(ageDays, halflifeDays);
    const delta = k * (actual1 - expected1);
    elo.set(m.pair1_player1_id, r1a + delta);
    elo.set(m.pair1_player2_id, r1b + delta);
    elo.set(m.pair2_player1_id, r2a - delta);
    elo.set(m.pair2_player2_id, r2b - delta);
    trained++;
  }
  if (!eloFormStart) eloFormStart = new Map(elo);
  return { elo, eloFormStart, halflifeDays, trainedCount: trained };
}
```

- [ ] **Step 4: Run tests, verify they all pass**

Run: `cd padelgod && npm test -- elo-model 2>&1 | tail -30`
Expected: All ~30 tests pass.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/elo-model.ts padelgod/src/lib/__tests__/elo-model.test.ts
git commit -m "feat(odds): shared elo-model lib (Elo, decay, odds conversion, Brier/log-loss)"
```

---

### Task 1.3: Refactor `scripts/simulate-elo-tournaments.ts` to import from the lib

**Files:**
- Modify: `scripts/simulate-elo-tournaments.ts`

The script currently defines `fipPriorElo`, `kFactor`, `trainElo`, `toDecimal`, `toAmerican`, `toFractional`, `MODEL_VERSION` inline. Replace those with imports from `padelgod/src/lib/elo-model.ts`. The script is a one-off run from the repo root, so a relative import works.

- [ ] **Step 1: Snapshot the current script's output for Buenos Aires backtest as a regression baseline**

Run from repo root:

```bash
npx tsx scripts/simulate-elo-tournaments.ts 83ba400e-77d4-4d9d-b525-af417a8d9f4a --from=R32 > /tmp/script-before.txt 2>&1
wc -l /tmp/script-before.txt
```

Expected: ~80 lines of output captured.

- [ ] **Step 2: Modify the script to import the lib**

Top-of-file change (replace the local `MODEL_VERSION`, `fipPriorElo`, `kFactor`, `trainElo`, `toDecimal`, `toAmerican`, `toFractional` definitions with imports):

```typescript
import {
  fipPriorElo,
  kFactor,
  pairWinProbability,
  trainElo,
  toDecimal,
  toAmerican,
  toFractional,
  brierScore,
  logLoss,
  MODEL_VERSION,
  FORM_WINDOW_DAYS,
  type TrainingMatch,
  type PlayerSnapshot,
  type TrainResult,
} from '../padelgod/src/lib/elo-model.js'
```

Delete the now-redundant inline definitions of those same names. Keep the script-only helpers (`canonicalRound`, `loadSurvivingPairs`, `monteCarlo`, output formatters, CLI parsing).

- [ ] **Step 3: Run the script again with identical args, diff against baseline**

```bash
npx tsx scripts/simulate-elo-tournaments.ts 83ba400e-77d4-4d9d-b525-af417a8d9f4a --from=R32 > /tmp/script-after.txt 2>&1
diff /tmp/script-before.txt /tmp/script-after.txt
```

Expected: empty diff (byte-identical output). Monte Carlo numbers will differ by ≤0.1% across runs due to randomness — that's acceptable. Anything bigger is a regression; investigate.

- [ ] **Step 4: Commit**

```bash
git add scripts/simulate-elo-tournaments.ts
git commit -m "refactor(odds): script imports math from padelgod/src/lib/elo-model"
```

---

## Phase 2 — Snapshot worker

### Task 2.1: `model-prediction-snapshot` worker + tests

Worker exports a single `runModelPredictionSnapshot(deps)` function that the scheduler calls.

**Files:**
- Create: `padelgod/src/workers/model-prediction-snapshot.ts`
- Create: `padelgod/src/workers/__tests__/model-prediction-snapshot.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `padelgod/src/workers/__tests__/model-prediction-snapshot.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  isInScopeTier,
  isMainDrawRound,
  type InScopeTournament,
} from '../model-prediction-snapshot.js';

describe('isInScopeTier', () => {
  it('major / p1 / p2 → true', () => {
    expect(isInScopeTier('major')).toBe(true);
    expect(isInScopeTier('p1')).toBe(true);
    expect(isInScopeTier('p2')).toBe(true);
  });
  it('fip_platinum / fip_gold → true', () => {
    expect(isInScopeTier('fip_platinum')).toBe(true);
    expect(isInScopeTier('fip_gold')).toBe(true);
  });
  it('fip_silver / fip_bronze / fip_promises → false', () => {
    expect(isInScopeTier('fip_silver')).toBe(false);
    expect(isInScopeTier('fip_bronze')).toBe(false);
    expect(isInScopeTier('fip_promises')).toBe(false);
  });
  it('null / unknown → false', () => {
    expect(isInScopeTier(null)).toBe(false);
    expect(isInScopeTier('something_weird')).toBe(false);
  });
});

describe('isMainDrawRound', () => {
  it('R32 / R16 / QF / SF / F → true', () => {
    expect(isMainDrawRound('R32')).toBe(true);
    expect(isMainDrawRound('R16')).toBe(true);
    expect(isMainDrawRound('QF')).toBe(true);
    expect(isMainDrawRound('SF')).toBe(true);
    expect(isMainDrawRound('F')).toBe(true);
  });
  it('Q1 / Q2 / Q3 → false', () => {
    expect(isMainDrawRound('Q1')).toBe(false);
    expect(isMainDrawRound('Q2')).toBe(false);
    expect(isMainDrawRound('Q3')).toBe(false);
  });
  it('Round of 32 / Round of 16 (raw form) → true (case-insensitive)', () => {
    expect(isMainDrawRound('Round of 32')).toBe(true);
    expect(isMainDrawRound('Round of 16')).toBe(true);
  });
  it('null / empty / unknown → false', () => {
    expect(isMainDrawRound(null)).toBe(false);
    expect(isMainDrawRound('')).toBe(false);
    expect(isMainDrawRound('group_a')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd padelgod && npm test -- model-prediction-snapshot 2>&1 | tail -20`
Expected: Module-not-found errors.

- [ ] **Step 3: Implement the worker**

Create `padelgod/src/workers/model-prediction-snapshot.ts`:

```typescript
// model-prediction-snapshot — hourly snapshot worker.
// See docs/superpowers/specs/2026-05-27-odds-admin-visibility-design.md §2.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import {
  trainElo,
  pairWinProbability,
  toDecimal,
  fipPriorElo,
  MODEL_VERSION,
  type TrainingMatch,
  type PlayerSnapshot,
  type TrainResult,
} from '../lib/elo-model.js';
import { paginatedSelect } from '../lib/db-paginate.js';

const IN_SCOPE_LEVELS = new Set(['major', 'p1', 'p2', 'fip_platinum', 'fip_gold']);
const MAIN_DRAW_ROUNDS = new Set(['R32', 'R16', 'QF', 'SF', 'F']);
const HALFLIFE_DAYS = 180;
const MC_RUNS = 20_000;
const UPCOMING_HORIZON_DAYS = 14;

export function isInScopeTier(level: string | null | undefined): boolean {
  if (!level) return false;
  return IN_SCOPE_LEVELS.has(level.toLowerCase());
}

export function isMainDrawRound(round: string | null | undefined): boolean {
  if (!round) return false;
  const x = round.toLowerCase();
  if (x === 'r32' || x === 'r16' || x === 'qf' || x === 'sf' || x === 'f') return true;
  if (x === 'round of 32' || x === 'round of 16') return true;
  if (x === 'final' || x === 'semifinal' || x === 'quarterfinal') return true;
  return false;
}

export interface InScopeTournament {
  id: string;
  level: string;
  starts_at: string;
}

export interface ModelPredictionSnapshotDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  dryRun?: boolean;
  /** Override "now" for tests. Defaults to new Date(). */
  now?: () => Date;
}

export interface ModelPredictionSnapshotResult {
  processed: number;
  failed: number;
  matchPredictionsWritten: number;
  tournamentPredictionsWritten: number;
  trainingSize: number;
  durationMs: number;
}

interface SurvivingPair {
  pair_id: string;
  player_ids: [string, string];
  seed: number | null;
  team_elo: number;
  team_form: number;
}

function canonicalRound(r: string | null): string {
  if (!r) return '';
  const x = r.toLowerCase();
  if (x.includes('round of 32') || x === 'r32') return 'R32';
  if (x.includes('round of 16') || x === 'r16') return 'R16';
  if (x === 'qf' || x.includes('quarter')) return 'QF';
  if (x === 'sf' || x.includes('semi')) return 'SF';
  if (x === 'f' || x.includes('final')) return 'F';
  return x.toUpperCase();
}

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'F'];

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function pickWinner(a: SurvivingPair, b: SurvivingPair): SurvivingPair {
  const pA = pairWinProbability(a.team_elo, b.team_elo);
  return Math.random() < pA ? a : b;
}

function monteCarlo(
  pairs: SurvivingPair[],
  runs: number,
): Map<string, { champ: number; finalist: number; semi: number }> {
  const tally = new Map<string, { champ: number; finalist: number; semi: number }>();
  for (const p of pairs) tally.set(p.pair_id, { champ: 0, finalist: 0, semi: 0 });
  if (pairs.length < 2) return tally;
  let bracketSize = 1;
  while (bracketSize < pairs.length) bracketSize *= 2;
  for (let run = 0; run < runs; run++) {
    let alive: (SurvivingPair | null)[] = shuffle(pairs);
    while (alive.length < bracketSize) alive.push(null);
    while (alive.length > 1) {
      if (alive.length === 4) for (const p of alive) if (p) tally.get(p.pair_id)!.semi++;
      if (alive.length === 2) for (const p of alive) if (p) tally.get(p.pair_id)!.finalist++;
      const next: (SurvivingPair | null)[] = [];
      for (let i = 0; i < alive.length; i += 2) {
        const a = alive[i]!;
        const b = alive[i + 1]!;
        if (a && !b) next.push(a);
        else if (!a && b) next.push(b);
        else if (!a && !b) next.push(null);
        else next.push(pickWinner(a, b));
      }
      alive = next;
    }
    if (alive[0]) tally.get(alive[0]!.pair_id)!.champ++;
  }
  return tally;
}

async function loadSurvivingPairs(
  supabase: SupabaseClient,
  tournamentId: string,
  category: 'men' | 'women',
  players: Map<string, PlayerSnapshot>,
  train: TrainResult,
): Promise<{ pairs: SurvivingPair[]; entryRound: string }> {
  const { data: rows } = await supabase
    .from('matches')
    .select(
      'id, round, round_canonical, status, scheduled_at, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed',
    )
    .eq('tournament_id', tournamentId)
    .eq('category', category);

  if (!rows || rows.length === 0) return { pairs: [], entryRound: '' };

  const byRound: Record<string, typeof rows> = {};
  for (const m of rows) {
    const r = canonicalRound(m.round_canonical ?? m.round);
    if (!ROUND_ORDER.includes(r)) continue;
    (byRound[r] ||= []).push(m);
  }

  let entryRound = '';
  for (const r of ROUND_ORDER) {
    const ms = byRound[r] ?? [];
    if (ms.length === 0) continue;
    let assigned = 0;
    for (const m of ms) {
      if (m.pair1_player1_id && m.pair1_player2_id) assigned++;
      if (m.pair2_player1_id && m.pair2_player2_id) assigned++;
    }
    if (assigned >= 4) entryRound = r;
  }
  if (!entryRound) return { pairs: [], entryRound: '' };

  const startIdx = ROUND_ORDER.indexOf(entryRound);
  const collectRounds = ROUND_ORDER.slice(startIdx);
  const matches = collectRounds.flatMap((r) => byRound[r] ?? []);

  const seen = new Set<string>();
  const pairs: SurvivingPair[] = [];
  const addPair = (ids: [string, string], seed: number | null) => {
    const sorted = [...ids].sort() as [string, string];
    const key = sorted.join('::');
    if (seen.has(key)) return;
    seen.add(key);
    const e1 = train.elo.get(ids[0]) ?? fipPriorElo(players.get(ids[0])?.ranking);
    const e2 = train.elo.get(ids[1]) ?? fipPriorElo(players.get(ids[1])?.ranking);
    const e1Prev = train.eloFormStart.get(ids[0]) ?? e1;
    const e2Prev = train.eloFormStart.get(ids[1]) ?? e2;
    const team_elo = (e1 + e2) / 2;
    const team_elo_prev = (e1Prev + e2Prev) / 2;
    pairs.push({
      pair_id: key,
      player_ids: ids,
      seed,
      team_elo,
      team_form: team_elo - team_elo_prev,
    });
  };
  for (const m of matches) {
    if (m.pair1_player1_id && m.pair1_player2_id) {
      addPair([m.pair1_player1_id, m.pair1_player2_id], m.pair1_seed ?? null);
    }
    if (m.pair2_player1_id && m.pair2_player2_id) {
      addPair([m.pair2_player1_id, m.pair2_player2_id], m.pair2_seed ?? null);
    }
  }
  return { pairs, entryRound };
}

export async function runModelPredictionSnapshot(
  deps: ModelPredictionSnapshotDeps,
): Promise<ModelPredictionSnapshotResult> {
  const { supabase, logger, dryRun = false, now = () => new Date() } = deps;
  const startMs = Date.now();
  const nowIso = now().toISOString();
  const horizonIso = new Date(now().getTime() + UPCOMING_HORIZON_DAYS * 86_400_000).toISOString();

  // 1. Load players + tournament levels
  const playerRows = await paginatedSelect<PlayerSnapshot>((s, e) =>
    supabase.from('players').select('id, name, ranking, category').range(s, e),
  );
  const players = new Map(playerRows.map((p) => [p.id, p]));

  const tournamentRows = await paginatedSelect<{ id: string; level: string | null }>((s, e) =>
    supabase.from('tournaments').select('id, level').range(s, e),
  );
  const tournamentLevels = new Map(tournamentRows.map((t) => [t.id, t.level ?? '']));

  // 2. In-scope tournaments: tier match + still in window
  const { data: scopeRows } = await supabase
    .from('tournaments')
    .select('id, level, starts_at, status, ends_at')
    .gte('ends_at', nowIso)
    .order('starts_at', { ascending: true });
  const inScope: InScopeTournament[] = (scopeRows ?? [])
    .filter((t) => isInScopeTier(t.level) && t.starts_at)
    .map((t) => ({ id: t.id, level: t.level!, starts_at: t.starts_at! }));

  logger?.info({ count: inScope.length }, 'in-scope tournaments identified');

  if (inScope.length === 0) {
    return {
      processed: 0,
      failed: 0,
      matchPredictionsWritten: 0,
      tournamentPredictionsWritten: 0,
      trainingSize: 0,
      durationMs: Date.now() - startMs,
    };
  }

  // 3. Load training matches once (we anchor per-tournament during training)
  const training = await paginatedSelect<TrainingMatch>((s, e) =>
    supabase
      .from('matches')
      .select('id, tournament_id, finished_at, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, winner_pair')
      .eq('status', 'finished')
      .not('winner_pair', 'is', null)
      .not('pair1_player1_id', 'is', null)
      .not('pair1_player2_id', 'is', null)
      .not('pair2_player1_id', 'is', null)
      .not('pair2_player2_id', 'is', null)
      .order('scheduled_at', { ascending: true })
      .range(s, e),
  );

  // 4. Process each tournament. Cache trained Elo by starts_at to avoid redundant work.
  const trainCache = new Map<string, TrainResult>();
  let processed = 0;
  let failed = 0;
  let matchWritten = 0;
  let tournWritten = 0;

  for (const t of inScope) {
    try {
      let train = trainCache.get(t.starts_at);
      if (!train) {
        const before = training.filter((m) => (m.scheduled_at ?? '') < t.starts_at);
        train = trainElo(before, players, tournamentLevels, t.starts_at, HALFLIFE_DAYS);
        trainCache.set(t.starts_at, train);
      }

      for (const category of ['men', 'women'] as const) {
        const { pairs, entryRound } = await loadSurvivingPairs(supabase, t.id, category, players, train);
        if (pairs.length < 2) continue;

        // Tournament-level MC
        const tally = monteCarlo(pairs, MC_RUNS);
        const tournRows = pairs.map((p) => ({
          tournament_id: t.id,
          category,
          pair_player1_id: p.player_ids[0],
          pair_player2_id: p.player_ids[1],
          pair_seed: p.seed,
          champ_prob: (tally.get(p.pair_id)!.champ / MC_RUNS).toFixed(4),
          finalist_prob: (tally.get(p.pair_id)!.finalist / MC_RUNS).toFixed(4),
          semi_prob: (tally.get(p.pair_id)!.semi / MC_RUNS).toFixed(4),
          team_elo: p.team_elo.toFixed(2),
          team_form: p.team_form.toFixed(2),
          entry_round: entryRound,
          model_version: MODEL_VERSION,
          mc_runs: MC_RUNS,
          halflife_days: HALFLIFE_DAYS,
        }));
        if (!dryRun) {
          const { error } = await supabase.from('model_tournament_predictions').insert(tournRows);
          if (error) throw error;
        }
        tournWritten += tournRows.length;

        // Per-match snapshots for upcoming main-draw matches
        const { data: upcoming } = await supabase
          .from('matches')
          .select(
            'id, round, round_canonical, scheduled_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id',
          )
          .eq('tournament_id', t.id)
          .eq('category', category)
          .in('status', ['scheduled', 'live'])
          .gte('scheduled_at', nowIso)
          .lte('scheduled_at', horizonIso);

        const matchRows: any[] = [];
        for (const m of upcoming ?? []) {
          if (!isMainDrawRound(m.round_canonical ?? m.round)) continue;
          if (!m.pair1_player1_id || !m.pair1_player2_id || !m.pair2_player1_id || !m.pair2_player2_id) continue;

          const e1a = train.elo.get(m.pair1_player1_id) ?? fipPriorElo(players.get(m.pair1_player1_id)?.ranking);
          const e1b = train.elo.get(m.pair1_player2_id) ?? fipPriorElo(players.get(m.pair1_player2_id)?.ranking);
          const e2a = train.elo.get(m.pair2_player1_id) ?? fipPriorElo(players.get(m.pair2_player1_id)?.ranking);
          const e2b = train.elo.get(m.pair2_player2_id) ?? fipPriorElo(players.get(m.pair2_player2_id)?.ranking);
          const e1aPrev = train.eloFormStart.get(m.pair1_player1_id) ?? e1a;
          const e1bPrev = train.eloFormStart.get(m.pair1_player2_id) ?? e1b;
          const e2aPrev = train.eloFormStart.get(m.pair2_player1_id) ?? e2a;
          const e2bPrev = train.eloFormStart.get(m.pair2_player2_id) ?? e2b;

          const team1 = (e1a + e1b) / 2;
          const team2 = (e2a + e2b) / 2;
          const team1Prev = (e1aPrev + e1bPrev) / 2;
          const team2Prev = (e2aPrev + e2bPrev) / 2;
          const p1 = pairWinProbability(team1, team2);
          const p2 = 1 - p1;

          matchRows.push({
            match_id: m.id,
            pair1_prob: p1.toFixed(4),
            pair2_prob: p2.toFixed(4),
            pair1_decimal_odds: Math.min(999.999, toDecimal(p1)).toFixed(3),
            pair2_decimal_odds: Math.min(999.999, toDecimal(p2)).toFixed(3),
            pair1_team_elo: team1.toFixed(2),
            pair2_team_elo: team2.toFixed(2),
            pair1_team_form: (team1 - team1Prev).toFixed(2),
            pair2_team_form: (team2 - team2Prev).toFixed(2),
            model_version: MODEL_VERSION,
            training_match_count: train.trainedCount,
            halflife_days: HALFLIFE_DAYS,
          });
        }
        if (matchRows.length > 0 && !dryRun) {
          const { error } = await supabase.from('model_predictions').insert(matchRows);
          if (error) throw error;
        }
        matchWritten += matchRows.length;
      }
      processed++;
    } catch (err) {
      failed++;
      logger?.error({ err, tournamentId: t.id }, 'tournament snapshot failed');
    }
  }

  const durationMs = Date.now() - startMs;
  logger?.info(
    {
      processed,
      failed,
      matchPredictionsWritten: matchWritten,
      tournamentPredictionsWritten: tournWritten,
      trainingSize: training.length,
      durationMs,
      dryRun,
    },
    'model-prediction-snapshot complete',
  );

  return {
    processed,
    failed,
    matchPredictionsWritten: matchWritten,
    tournamentPredictionsWritten: tournWritten,
    trainingSize: training.length,
    durationMs,
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd padelgod && npm test -- model-prediction-snapshot 2>&1 | tail -20`
Expected: All ~12 tests in the file pass.

- [ ] **Step 5: Run typecheck**

Run: `cd padelgod && npx tsc --noEmit 2>&1 | tail -20`
Expected: No errors in `model-prediction-snapshot.ts`.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/model-prediction-snapshot.ts padelgod/src/workers/__tests__/model-prediction-snapshot.test.ts
git commit -m "feat(odds): model-prediction-snapshot worker (hourly Elo + MC writes)"
```

---

### Task 2.2: Scheduler wiring + feature flags

**Files:**
- Modify: `padelgod/src/scheduler.ts`

- [ ] **Step 1: Add the import at the top of `padelgod/src/scheduler.ts`**

Locate the existing block of `import { runX } from './workers/x.js'` lines (around line 6-27). Add:

```typescript
import { runModelPredictionSnapshot } from './workers/model-prediction-snapshot.js';
```

- [ ] **Step 2: Add flags to `SchedulerFlags` interface**

Inside the `SchedulerFlags` interface (~line 35-100), add:

```typescript
  enableModelPredictionSnapshot: boolean;
  /** When true, the model-prediction-snapshot worker computes everything
   *  but skips DB writes. Same dry-run pattern as fipDrawPopulator. */
  modelPredictionSnapshotDryRun: boolean;
```

- [ ] **Step 3: Add the schedule entry inside `buildSchedule(flags)`**

Inside the function body (around line 301+), add this block after one of the existing `entries.push(...)` blocks:

```typescript
  if (flags.enableModelPredictionSnapshot) {
    entries.push({
      name: 'model-prediction-snapshot',
      cron: '25 * * * *', // hourly at :25
      run: async (d) =>
        runModelPredictionSnapshot({
          supabase: d.supabase,
          logger: d.logger,
          dryRun: flags.modelPredictionSnapshotDryRun,
        }),
    });
  }
```

- [ ] **Step 4: Update env-flag plumbing**

Locate where `SchedulerFlags` is constructed from env vars (search for `enableFipDrawPopulator` to find the pattern). Add corresponding env-var reads:

```typescript
  enableModelPredictionSnapshot: process.env.ENABLE_MODEL_PREDICTION_SNAPSHOT === 'true',
  modelPredictionSnapshotDryRun: process.env.MODEL_PREDICTION_SNAPSHOT_DRY_RUN !== 'false', // defaults to true
```

- [ ] **Step 5: Verify typecheck**

Run: `cd padelgod && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 6: Verify scheduler tests still pass**

Run: `cd padelgod && npm test -- scheduler 2>&1 | tail -10`
Expected: All scheduler tests pass.

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/scheduler.ts
git commit -m "feat(odds): wire model-prediction-snapshot into padelgod scheduler"
```

---

### Task 2.3: Deploy phase 2 + verify dry-run

This is an operational step — no code changes. Ship phase 1 + 2 to Railway, flip flags to enable in dry-run mode, watch logs.

- [ ] **Step 1: Ensure migration is applied**

```bash
# Run against the project's Supabase. Confirm the 3 tables exist:
psql "$SUPABASE_DB_URL" -c "\dt model_predictions" -c "\dt model_tournament_predictions" -c "\dt prediction_scores"
```

Expected: each command shows the table exists.

- [ ] **Step 2: Deploy padelgod to Railway**

Standard deploy (git push to main / Railway's auto-deploy). Wait for the new container to come up.

- [ ] **Step 3: Set env vars in Railway**

```
ENABLE_MODEL_PREDICTION_SNAPSHOT=true
MODEL_PREDICTION_SNAPSHOT_DRY_RUN=true
```

- [ ] **Step 4: Wait for first `:25` tick and inspect logs**

Look for the structured log line:
```
{"service":"padelgod","level":"info","msg":"model-prediction-snapshot complete","processed":N,"failed":0,...}
```

Expected: `failed = 0`, `processed >= 1`, `trainingSize >= 5000`, `tournamentPredictionsWritten > 0`, `dryRun: true`. No errors.

- [ ] **Step 5: Cross-check against standalone script output**

Run locally:
```bash
npx tsx scripts/simulate-elo-tournaments.ts 8a47598a-579b-4503-88c2-135306d274fb 2>&1 | tail -25
```

Compare the top-5 champ% values to the dry-run logs from step 4 (the worker logs include enough detail to spot-check ordering, even if exact MC numbers differ within ~0.5%). If they're wildly different, investigate before enabling writes.

---

## Phase 3 — Scorer worker + enable writes

### Task 3.1: `prediction-scorer` worker + tests

**Files:**
- Create: `padelgod/src/workers/prediction-scorer.ts`
- Create: `padelgod/src/workers/__tests__/prediction-scorer.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `padelgod/src/workers/__tests__/prediction-scorer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeScoreRow } from '../prediction-scorer.js';
import { MODEL_VERSION } from '../../lib/elo-model.js';

describe('computeScoreRow', () => {
  it('pair1 won, prediction was 0.819 for pair1', () => {
    const row = computeScoreRow({
      prediction_id: 'pred-1',
      match_id: 'match-1',
      pair1_prob: 0.819,
      pair2_prob: 0.181,
      model_version: MODEL_VERSION,
      winner_pair: 1,
    });
    expect(row.actual_winner_pair).toBe(1);
    expect(row.predicted_prob_winner).toBeCloseTo(0.819, 4);
    expect(row.brier_score).toBeCloseTo(0.0328, 3);
    expect(row.log_loss).toBeCloseTo(0.1997, 3);
    expect(row.model_version).toBe(MODEL_VERSION);
    expect(row.match_id).toBe('match-1');
    expect(row.prediction_id).toBe('pred-1');
  });

  it('pair2 won, prediction was 0.181 for pair2 (model was wrong)', () => {
    const row = computeScoreRow({
      prediction_id: 'pred-1',
      match_id: 'match-1',
      pair1_prob: 0.819,
      pair2_prob: 0.181,
      model_version: MODEL_VERSION,
      winner_pair: 2,
    });
    expect(row.actual_winner_pair).toBe(2);
    expect(row.predicted_prob_winner).toBeCloseTo(0.181, 4);
    expect(row.brier_score).toBeCloseTo(0.671, 2);
    expect(row.log_loss).toBeCloseTo(1.710, 2);
  });

  it('perfect prediction: 1.0 for winner → Brier 0, log-loss 0', () => {
    const row = computeScoreRow({
      prediction_id: 'pred-1',
      match_id: 'match-1',
      pair1_prob: 1.0,
      pair2_prob: 0.0,
      model_version: MODEL_VERSION,
      winner_pair: 1,
    });
    expect(row.brier_score).toBeCloseTo(0, 5);
    expect(row.log_loss).toBeCloseTo(0, 5);
  });

  it('zero-prob winner gets clamped (no +Infinity log_loss)', () => {
    const row = computeScoreRow({
      prediction_id: 'pred-1',
      match_id: 'match-1',
      pair1_prob: 1.0,
      pair2_prob: 0.0,
      model_version: MODEL_VERSION,
      winner_pair: 2, // model gave 0% to the actual winner
    });
    expect(Number.isFinite(row.log_loss)).toBe(true);
    expect(row.log_loss).toBeGreaterThan(10); // clamp gives a large but finite number
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd padelgod && npm test -- prediction-scorer 2>&1 | tail -10`
Expected: Module-not-found.

- [ ] **Step 3: Implement the worker**

Create `padelgod/src/workers/prediction-scorer.ts`:

```typescript
// prediction-scorer — scores finished matches against their pre-match snapshot.
// See docs/superpowers/specs/2026-05-27-odds-admin-visibility-design.md §2.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Logger } from 'pino';
import { brierScore, logLoss } from '../lib/elo-model.js';

const LOOKBACK_DAYS = 7;
const BATCH_LIMIT = 200;

export interface PredictionScorerDeps {
  supabase: SupabaseClient;
  logger?: Logger;
  /** Override "now" for tests. */
  now?: () => Date;
}

export interface PredictionScorerResult {
  scored: number;
  skippedNoSnapshot: number;
  errors: number;
  durationMs: number;
}

interface ScoreRowInput {
  prediction_id: string;
  match_id: string;
  pair1_prob: number;
  pair2_prob: number;
  model_version: string;
  winner_pair: 1 | 2;
}

export interface ScoreRow {
  prediction_id: string;
  match_id: string;
  actual_winner_pair: 1 | 2;
  predicted_prob_winner: number;
  brier_score: number;
  log_loss: number;
  model_version: string;
}

export function computeScoreRow(input: ScoreRowInput): ScoreRow {
  const winner = input.winner_pair;
  const predicted = winner === 1 ? input.pair1_prob : input.pair2_prob;
  return {
    prediction_id: input.prediction_id,
    match_id: input.match_id,
    actual_winner_pair: winner,
    predicted_prob_winner: predicted,
    brier_score: brierScore(predicted, 1),
    log_loss: logLoss(predicted),
    model_version: input.model_version,
  };
}

export async function runPredictionScorer(
  deps: PredictionScorerDeps,
): Promise<PredictionScorerResult> {
  const { supabase, logger, now = () => new Date() } = deps;
  const startMs = Date.now();
  const cutoffIso = new Date(now().getTime() - LOOKBACK_DAYS * 86_400_000).toISOString();

  // 1. Find unscored finished matches in the last 7 days
  const { data: unscored, error } = await supabase
    .from('matches')
    .select('id, scheduled_at, finished_at, winner_pair')
    .in('status', ['finished', 'retired', 'walkover'])
    .in('winner_pair', [1, 2])
    .gt('finished_at', cutoffIso)
    .limit(BATCH_LIMIT);
  if (error) {
    logger?.error({ err: error }, 'prediction-scorer match query failed');
    return { scored: 0, skippedNoSnapshot: 0, errors: 1, durationMs: Date.now() - startMs };
  }

  // 2. Filter to those without a prediction_scores row (do it client-side in a small batch)
  const matchIds = (unscored ?? []).map((m) => m.id);
  if (matchIds.length === 0) {
    return { scored: 0, skippedNoSnapshot: 0, errors: 0, durationMs: Date.now() - startMs };
  }
  const { data: alreadyScored } = await supabase
    .from('prediction_scores')
    .select('match_id')
    .in('match_id', matchIds);
  const scoredIds = new Set((alreadyScored ?? []).map((r) => r.match_id));
  const todo = (unscored ?? []).filter((m) => !scoredIds.has(m.id));

  let scored = 0;
  let skippedNoSnapshot = 0;
  let errors = 0;

  for (const m of todo) {
    try {
      // 3. Latest pre-match snapshot
      const { data: snap } = await supabase
        .from('model_predictions')
        .select('id, pair1_prob, pair2_prob, model_version')
        .eq('match_id', m.id)
        .lt('created_at', m.scheduled_at ?? m.finished_at)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!snap) {
        skippedNoSnapshot++;
        logger?.info({ matchId: m.id }, 'no pre-match snapshot, skipping');
        continue;
      }

      const row = computeScoreRow({
        prediction_id: snap.id,
        match_id: m.id,
        pair1_prob: Number(snap.pair1_prob),
        pair2_prob: Number(snap.pair2_prob),
        model_version: snap.model_version,
        winner_pair: m.winner_pair as 1 | 2,
      });

      // 4. Insert with ON CONFLICT DO NOTHING (race-safe)
      const { error: insErr } = await supabase
        .from('prediction_scores')
        .insert({
          ...row,
          predicted_prob_winner: row.predicted_prob_winner.toFixed(4),
          brier_score: row.brier_score.toFixed(5),
          log_loss: row.log_loss.toFixed(5),
        });
      if (insErr) {
        // Unique-constraint hit (race with concurrent scorer) is acceptable
        if (insErr.code === '23505') continue;
        throw insErr;
      }
      scored++;
    } catch (err) {
      errors++;
      logger?.error({ err, matchId: m.id }, 'scoring failed for match');
    }
  }

  const durationMs = Date.now() - startMs;
  logger?.info(
    { scored, skippedNoSnapshot, errors, durationMs },
    'prediction-scorer complete',
  );
  return { scored, skippedNoSnapshot, errors, durationMs };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd padelgod && npm test -- prediction-scorer 2>&1 | tail -15`
Expected: All 4 tests pass.

- [ ] **Step 5: Run typecheck**

Run: `cd padelgod && npx tsc --noEmit 2>&1 | tail -10`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/prediction-scorer.ts padelgod/src/workers/__tests__/prediction-scorer.test.ts
git commit -m "feat(odds): prediction-scorer worker (Brier + log-loss against pre-match snapshot)"
```

---

### Task 3.2: Wire scorer into scheduler

**Files:**
- Modify: `padelgod/src/scheduler.ts`

- [ ] **Step 1: Add import**

```typescript
import { runPredictionScorer } from './workers/prediction-scorer.js';
```

- [ ] **Step 2: Add flag to `SchedulerFlags`**

```typescript
  enablePredictionScorer: boolean;
```

- [ ] **Step 3: Add schedule entry in `buildSchedule`**

```typescript
  if (flags.enablePredictionScorer) {
    entries.push({
      name: 'prediction-scorer',
      cron: '3,13,23,33,43,53 * * * *', // every 10 min, offset from :25 snapshot
      run: async (d) => runPredictionScorer({ supabase: d.supabase, logger: d.logger }),
    });
  }
```

- [ ] **Step 4: Add env-var read**

```typescript
  enablePredictionScorer: process.env.ENABLE_PREDICTION_SCORER === 'true',
```

- [ ] **Step 5: Verify typecheck + scheduler tests**

```bash
cd padelgod && npx tsc --noEmit && npm test -- scheduler
```

Expected: no errors, all scheduler tests pass.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/scheduler.ts
git commit -m "feat(odds): wire prediction-scorer into padelgod scheduler"
```

---

### Task 3.3: Enable writes in Railway + verify scoring works

Operational step.

- [ ] **Step 1: Deploy phase 3 to Railway**

Push to main, wait for Railway deploy.

- [ ] **Step 2: Flip snapshot worker to write mode**

In Railway env vars:
```
MODEL_PREDICTION_SNAPSHOT_DRY_RUN=false
```

Wait for next `:25` tick. Verify rows are appearing in DB:
```bash
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM model_predictions WHERE created_at > now() - interval '1 hour';"
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*) FROM model_tournament_predictions WHERE created_at > now() - interval '1 hour';"
```

Expected: counts > 0.

- [ ] **Step 3: Wait 1-2 hours for some upcoming matches to have predictions, then enable scorer**

In Railway env vars:
```
ENABLE_PREDICTION_SCORER=true
```

- [ ] **Step 4: Wait for the first in-scope match to finish, then verify scoring**

```bash
psql "$SUPABASE_DB_URL" -c "SELECT COUNT(*), AVG(brier_score), AVG(log_loss) FROM prediction_scores WHERE scored_at > now() - interval '1 day';"
```

Expected: at least one row scored, sensible Brier (0-1) and log-loss (0-3 typical range).

---

## Phase 4 — Admin pages (text-only, no charts)

### Task 4.1: Data layer `apps/ops/src/lib/odds-data.ts` + tests

The data layer encapsulates all Supabase queries. Pages call these functions, get plain TypeScript objects back.

**Files:**
- Create: `apps/ops/src/lib/odds-data.ts`
- Create: `apps/ops/tests/odds-data.test.ts`

- [ ] **Step 1: Write failing tests for the data-layer helpers**

Create `apps/ops/tests/odds-data.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeCalibrationKpis, type ScoredRow } from '../src/lib/odds-data.js';

describe('computeCalibrationKpis', () => {
  it('handles empty input', () => {
    const k = computeCalibrationKpis([]);
    expect(k.totalScored).toBe(0);
    expect(k.meanBrier).toBeNull();
    expect(k.meanLogLoss).toBeNull();
    expect(k.favoriteHitRate).toBeNull();
  });

  it('computes means + favorite hit-rate correctly', () => {
    const rows: ScoredRow[] = [
      { brier_score: 0.04, log_loss: 0.2, predicted_prob_winner: 0.8 },  // favorite won
      { brier_score: 0.49, log_loss: 1.6, predicted_prob_winner: 0.3 },  // underdog won
      { brier_score: 0.01, log_loss: 0.1, predicted_prob_winner: 0.9 },  // favorite won
      { brier_score: 0.04, log_loss: 0.2, predicted_prob_winner: 0.8 },  // favorite won
    ];
    const k = computeCalibrationKpis(rows);
    expect(k.totalScored).toBe(4);
    expect(k.meanBrier).toBeCloseTo((0.04 + 0.49 + 0.01 + 0.04) / 4, 4);
    expect(k.meanLogLoss).toBeCloseTo((0.2 + 1.6 + 0.1 + 0.2) / 4, 4);
    // 3 out of 4 had predicted_prob_winner > 0.5 (favorite won 3 times)
    expect(k.favoriteHitRate).toBeCloseTo(0.75, 4);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `cd apps/ops && npm test -- odds-data 2>&1 | tail -10`
Expected: Module not found.

- [ ] **Step 3: Implement the data layer**

Create `apps/ops/src/lib/odds-data.ts`:

```typescript
// Data layer for /odds pages. All Supabase queries live here.
// Pages are server components that call these and pass results to child components.

import { createServiceClient } from './supabase.js';

export interface MatchPredictionRow {
  match_id: string;
  created_at: string;
  pair1_prob: number;
  pair2_prob: number;
  pair1_decimal_odds: number;
  pair2_decimal_odds: number;
  pair1_team_elo: number;
  pair2_team_elo: number;
  pair1_team_form: number;
  pair2_team_form: number;
  model_version: string;
}

export interface TournamentPredictionRow {
  tournament_id: string;
  category: 'men' | 'women';
  pair_player1_id: string;
  pair_player2_id: string;
  pair_seed: number | null;
  created_at: string;
  champ_prob: number;
  finalist_prob: number;
  semi_prob: number;
  team_elo: number;
  team_form: number;
  entry_round: string;
  model_version: string;
}

export interface ScoredRow {
  brier_score: number;
  log_loss: number;
  predicted_prob_winner: number;
}

export interface CalibrationKpis {
  totalScored: number;
  meanBrier: number | null;
  meanLogLoss: number | null;
  favoriteHitRate: number | null;
}

export function computeCalibrationKpis(rows: ScoredRow[]): CalibrationKpis {
  if (rows.length === 0) {
    return { totalScored: 0, meanBrier: null, meanLogLoss: null, favoriteHitRate: null };
  }
  const meanBrier = rows.reduce((a, r) => a + Number(r.brier_score), 0) / rows.length;
  const meanLogLoss = rows.reduce((a, r) => a + Number(r.log_loss), 0) / rows.length;
  const favoriteWins = rows.filter((r) => Number(r.predicted_prob_winner) > 0.5).length;
  const favoriteHitRate = favoriteWins / rows.length;
  return { totalScored: rows.length, meanBrier, meanLogLoss, favoriteHitRate };
}

// Returns the latest match prediction per match_id for matches scheduled on a given day.
export async function getMatchOddsForDay(dateIso: string) {
  const supabase = createServiceClient();
  const dayStart = `${dateIso}T00:00:00`;
  const dayEnd = `${dateIso}T23:59:59`;

  const { data: matches } = await supabase
    .from('matches')
    .select(
      'id, tournament_id, category, round, round_canonical, status, scheduled_at, court, court_order, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed',
    )
    .gte('scheduled_at', dayStart)
    .lte('scheduled_at', dayEnd)
    .order('scheduled_at');

  if (!matches || matches.length === 0) return [];

  // Pull latest prediction per match
  const matchIds = matches.map((m) => m.id);
  const { data: preds } = await supabase
    .from('model_predictions')
    .select('*')
    .in('match_id', matchIds)
    .order('created_at', { ascending: false });
  const latestByMatch = new Map<string, MatchPredictionRow>();
  for (const p of preds ?? []) {
    if (!latestByMatch.has(p.match_id)) latestByMatch.set(p.match_id, p as MatchPredictionRow);
  }

  return matches.map((m) => ({ match: m, prediction: latestByMatch.get(m.id) ?? null }));
}

// Latest tournament predictions per tournament (for landing-page outlook cards).
export async function getOngoingTournamentOutlooks() {
  const supabase = createServiceClient();
  const { data } = await supabase
    .from('model_tournament_predictions')
    .select('*, tournaments!inner(id, name, level, status, ends_at)')
    .gte('tournaments.ends_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(500);
  // De-dupe to latest per (tournament, category, pair)
  const seen = new Set<string>();
  const latest = (data ?? []).filter((r: any) => {
    const k = `${r.tournament_id}::${r.category}::${r.pair_player1_id}::${r.pair_player2_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return latest;
}

// Calibration page data.
export async function getCalibrationData(windowDays: number) {
  const supabase = createServiceClient();
  const cutoff = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  const { data } = await supabase
    .from('prediction_scores')
    .select('brier_score, log_loss, predicted_prob_winner, scored_at, model_version, match_id')
    .gte('scored_at', cutoff);
  return data ?? [];
}

// Data freshness signals (used by ModelFreshnessPanel).
export async function getModelFreshness() {
  const supabase = createServiceClient();
  const { data: latestSnapshot } = await supabase
    .from('model_predictions')
    .select('created_at, training_match_count, model_version')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const cutoff7d = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { count: unscoredFinishedCount } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .in('status', ['finished', 'retired', 'walkover'])
    .in('winner_pair', [1, 2])
    .gt('finished_at', cutoff7d);

  // (Slightly approximate — counts ALL finished matches not just in-scope.
  //  Good enough as a health signal; refine if false-positives appear.)

  return {
    latestSnapshotAt: latestSnapshot?.created_at ?? null,
    trainingMatchCount: latestSnapshot?.training_match_count ?? null,
    modelVersion: latestSnapshot?.model_version ?? null,
    unscoredFinishedLast7d: unscoredFinishedCount ?? 0,
  };
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `cd apps/ops && npm test -- odds-data 2>&1 | tail -10`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/lib/odds-data.ts apps/ops/tests/odds-data.test.ts
git commit -m "feat(odds): odds-data lib for admin pages"
```

---

### Task 4.2: Add "Model & Odds" sidebar group

**Files:**
- Modify: `apps/ops/src/components/Sidebar.tsx`

- [ ] **Step 1: Add the new group to `NAV_GROUPS`**

Find the `NAV_GROUPS` constant (around line 15-54). Insert the new group between "Tournament Ops" and "Catalogs":

```typescript
  {
    label: 'Model & Odds',
    items: [
      { href: '/odds', label: 'Live Odds' },
      { href: '/odds/methodology', label: 'Methodology' },
      { href: '/odds/calibration', label: 'Calibration' },
    ],
  },
```

- [ ] **Step 2: Verify the dev server renders the new group**

```bash
cd apps/ops && npm run dev
```

Open `http://localhost:3004` and verify the sidebar shows "Model & Odds" with three sub-items. The pages 404 for now — that's expected.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/components/Sidebar.tsx
git commit -m "feat(odds): add Model & Odds sidebar group"
```

---

### Task 4.3: Page `/odds` (Live Odds landing) + supporting components

**Files:**
- Create: `apps/ops/src/app/(app)/odds/page.tsx`
- Create: `apps/ops/src/components/Odds/LiveOddsTable.tsx`
- Create: `apps/ops/src/components/Odds/TournamentOutlookCard.tsx`
- Create: `apps/ops/src/components/Odds/PairOddsRow.tsx`

- [ ] **Step 1: Create the shared row component `PairOddsRow.tsx`**

```tsx
// Renders one pair's display info (names, seed, prob, decimal, form).
// Used by LiveOddsTable and TournamentOutlookCard.

import type { ReactNode } from 'react';

export interface PairOddsRowProps {
  name: string;
  seed?: number | null;
  prob?: number;       // 0-1
  decimal?: number;
  form?: number;       // can be positive or negative
  emphasis?: boolean;  // highlight as favorite
}

export function PairOddsRow({ name, seed, prob, decimal, form, emphasis }: PairOddsRowProps) {
  const formChip = form != null ? renderFormChip(form) : null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: emphasis ? 600 : 400 }}>
      {seed ? <span style={{ fontSize: 11, color: 'var(--status-neutral)' }}>[{seed}]</span> : null}
      <span style={{ flex: 1 }}>{name}</span>
      {prob != null && <span style={{ minWidth: 56, textAlign: 'right' }}>{(prob * 100).toFixed(1)}%</span>}
      {decimal != null && (
        <span style={{ minWidth: 56, textAlign: 'right', color: 'var(--brand-primary-fg)' }}>
          {decimal.toFixed(2)}
        </span>
      )}
      {formChip}
    </div>
  );
}

function renderFormChip(form: number): ReactNode {
  const rounded = Math.round(form);
  const sign = rounded > 0 ? '+' : '';
  const color =
    rounded > 20 ? 'var(--status-positive)' :
    rounded < -20 ? 'var(--status-negative)' :
    'var(--status-neutral)';
  return (
    <span style={{ minWidth: 36, fontSize: 11, color, textAlign: 'right' }}>
      {sign}{rounded}
    </span>
  );
}
```

- [ ] **Step 2: Create `LiveOddsTable.tsx`**

```tsx
// Table of today's matches with per-match odds.
import { PairOddsRow } from './PairOddsRow.js';

export interface LiveMatchRow {
  match: {
    id: string;
    category: string;
    round: string | null;
    round_canonical: string | null;
    status: string;
    scheduled_at: string;
    court: string | null;
    pair1_player1_id: string;
    pair1_player2_id: string;
    pair2_player1_id: string;
    pair2_player2_id: string;
    pair1_seed: number | null;
    pair2_seed: number | null;
  };
  prediction: {
    pair1_prob: number;
    pair2_prob: number;
    pair1_decimal_odds: number;
    pair2_decimal_odds: number;
    pair1_team_form: number;
    pair2_team_form: number;
    model_version: string;
  } | null;
  pair1Name: string;
  pair2Name: string;
}

export function LiveOddsTable({ rows }: { rows: LiveMatchRow[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: 16, background: 'var(--bg-canvas)', borderRadius: 4 }}>
        No in-scope matches scheduled for this day.
      </div>
    );
  }

  return (
    <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
      {rows.map(({ match, prediction, pair1Name, pair2Name }) => (
        <a
          key={match.id}
          href={`/odds/match/${match.id}`}
          style={{
            display: 'block',
            padding: 12,
            borderBottom: '1px solid var(--border-subtle)',
            textDecoration: 'none',
            color: 'inherit',
            background: match.status === 'live' ? 'var(--status-warn-bg)' : undefined,
          }}
        >
          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--status-neutral)', marginBottom: 4 }}>
            <span>{match.scheduled_at?.slice(11, 16)}</span>
            <span>{match.court ?? '?'}</span>
            <span>{match.category}</span>
            <span>{match.round_canonical ?? match.round ?? '?'}</span>
            <span>{match.status}</span>
          </div>
          <PairOddsRow
            name={pair1Name}
            seed={match.pair1_seed}
            prob={prediction ? Number(prediction.pair1_prob) : undefined}
            decimal={prediction ? Number(prediction.pair1_decimal_odds) : undefined}
            form={prediction ? Number(prediction.pair1_team_form) : undefined}
            emphasis={prediction != null && Number(prediction.pair1_prob) > 0.5}
          />
          <PairOddsRow
            name={pair2Name}
            seed={match.pair2_seed}
            prob={prediction ? Number(prediction.pair2_prob) : undefined}
            decimal={prediction ? Number(prediction.pair2_decimal_odds) : undefined}
            form={prediction ? Number(prediction.pair2_team_form) : undefined}
            emphasis={prediction != null && Number(prediction.pair2_prob) > 0.5}
          />
        </a>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Create `TournamentOutlookCard.tsx`**

```tsx
// One card per ongoing in-scope tournament showing top 4 pairs.

export interface TournamentOutlookCardProps {
  tournamentId: string;
  tournamentName: string;
  category: 'men' | 'women';
  entryRound: string;
  snapshotAt: string;
  top: Array<{
    pairName: string;
    seed: number | null;
    champ_prob: number;
    finalist_prob: number;
    semi_prob: number;
  }>;
}

export function TournamentOutlookCard(props: TournamentOutlookCardProps) {
  const { tournamentId, tournamentName, category, entryRound, snapshotAt, top } = props;
  return (
    <a
      href={`/odds/tournament/${tournamentId}`}
      style={{
        display: 'block',
        padding: 16,
        border: '1px solid var(--border-subtle)',
        borderRadius: 4,
        textDecoration: 'none',
        color: 'inherit',
        background: 'var(--bg-canvas)',
      }}
    >
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{tournamentName}</div>
        <div style={{ fontSize: 11, color: 'var(--status-neutral)' }}>
          {category} · entry {entryRound} · snapshot {snapshotAt.slice(11, 16)}
        </div>
      </div>
      {top.slice(0, 4).map((p, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
          {p.seed && <span style={{ color: 'var(--status-neutral)' }}>[{p.seed}]</span>}
          <span style={{ flex: 1 }}>{p.pairName}</span>
          <span style={{ minWidth: 48, textAlign: 'right', fontWeight: 600 }}>
            {(p.champ_prob * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </a>
  );
}
```

- [ ] **Step 4: Create the page `apps/ops/src/app/(app)/odds/page.tsx`**

```tsx
import { LiveOddsTable, type LiveMatchRow } from '@/components/Odds/LiveOddsTable';
import { TournamentOutlookCard } from '@/components/Odds/TournamentOutlookCard';
import {
  getMatchOddsForDay,
  getOngoingTournamentOutlooks,
} from '@/lib/odds-data';
import { createServiceClient } from '@/lib/supabase';

export const metadata = { title: 'Live Odds · PadelNachos Admin' };
export const dynamic = 'force-dynamic';

export default async function LiveOddsPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const targetDate = params.date ?? today;

  const [dayRows, outlooks] = await Promise.all([
    getMatchOddsForDay(targetDate),
    getOngoingTournamentOutlooks(),
  ]);

  // Hydrate player names for the match table
  const supabase = createServiceClient();
  const playerIds = new Set<string>();
  for (const r of dayRows) {
    const m = r.match;
    [m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id].forEach((id) => playerIds.add(id));
  }
  for (const o of outlooks) {
    playerIds.add(o.pair_player1_id);
    playerIds.add(o.pair_player2_id);
  }
  const { data: pl } = await supabase.from('players').select('id, name').in('id', [...playerIds]);
  const nameById = new Map((pl ?? []).map((p) => [p.id, p.name]));
  const fmtPair = (id1: string, id2: string) =>
    `${nameById.get(id1)?.split(' ').slice(-1)[0] ?? '?'} / ${nameById.get(id2)?.split(' ').slice(-1)[0] ?? '?'}`;

  const liveRows: LiveMatchRow[] = dayRows.map((r) => ({
    match: r.match as any,
    prediction: r.prediction as any,
    pair1Name: fmtPair(r.match.pair1_player1_id, r.match.pair1_player2_id),
    pair2Name: fmtPair(r.match.pair2_player1_id, r.match.pair2_player2_id),
  }));

  // Group outlooks by tournament + category, take top 4 by champ_prob
  const byTournCat = new Map<string, typeof outlooks>();
  for (const o of outlooks) {
    const k = `${o.tournament_id}::${o.category}`;
    if (!byTournCat.has(k)) byTournCat.set(k, []);
    byTournCat.get(k)!.push(o);
  }
  const cards = [...byTournCat.entries()].map(([k, rows]) => {
    rows.sort((a: any, b: any) => Number(b.champ_prob) - Number(a.champ_prob));
    const first = rows[0] as any;
    return {
      tournamentId: first.tournament_id,
      tournamentName: first.tournaments?.name ?? 'Unknown',
      category: first.category as 'men' | 'women',
      entryRound: first.entry_round,
      snapshotAt: first.created_at,
      top: rows.slice(0, 4).map((r: any) => ({
        pairName: fmtPair(r.pair_player1_id, r.pair_player2_id),
        seed: r.pair_seed,
        champ_prob: Number(r.champ_prob),
        finalist_prob: Number(r.finalist_prob),
        semi_prob: Number(r.semi_prob),
      })),
    };
  });

  return (
    <div style={{ padding: 32, maxWidth: 1280 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Live Odds</h1>

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '24px 0 8px' }}>
        Matches on {targetDate}
      </h2>
      <LiveOddsTable rows={liveRows} />

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '32px 0 8px' }}>Tournament outlooks</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
        {cards.length === 0 && (
          <div style={{ padding: 16, color: 'var(--status-neutral)' }}>
            No in-scope tournaments currently active.
          </div>
        )}
        {cards.map((c) => (
          <TournamentOutlookCard key={`${c.tournamentId}::${c.category}`} {...c} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify the page renders in dev**

```bash
cd apps/ops && npm run dev
```

Open `http://localhost:3004/odds`. Expected: page renders. If no snapshots exist yet, you see "No in-scope matches" and "No in-scope tournaments currently active."

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/\(app\)/odds/page.tsx apps/ops/src/components/Odds/
git commit -m "feat(odds): /odds landing page with match table + tournament outlook cards"
```

---

### Task 4.4: Page `/odds/tournament/[id]` (text-only)

**Files:**
- Create: `apps/ops/src/app/(app)/odds/tournament/[id]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { createServiceClient } from '@/lib/supabase';
import { PairOddsRow } from '@/components/Odds/PairOddsRow';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Tournament Odds · PadelNachos Admin' };
export const dynamic = 'force-dynamic';

interface PageProps { params: Promise<{ id: string }> }

export default async function TournamentOddsPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name, level, status, starts_at, ends_at')
    .eq('id', id)
    .maybeSingle();
  if (!tournament) notFound();

  // Latest tournament predictions for each (category, pair)
  const { data: tournPreds } = await supabase
    .from('model_tournament_predictions')
    .select('*')
    .eq('tournament_id', id)
    .order('created_at', { ascending: false })
    .limit(500);

  const seen = new Set<string>();
  const latestByPair = (tournPreds ?? []).filter((r: any) => {
    const k = `${r.category}::${r.pair_player1_id}::${r.pair_player2_id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const playerIds = new Set<string>();
  latestByPair.forEach((r: any) => {
    playerIds.add(r.pair_player1_id);
    playerIds.add(r.pair_player2_id);
  });
  const { data: pl } = await supabase.from('players').select('id, name').in('id', [...playerIds]);
  const nameById = new Map((pl ?? []).map((p) => [p.id, p.name]));
  const pairName = (id1: string, id2: string) =>
    `${nameById.get(id1)?.split(' ').slice(-1)[0] ?? '?'} / ${nameById.get(id2)?.split(' ').slice(-1)[0] ?? '?'}`;

  if (latestByPair.length === 0) {
    return (
      <div style={{ padding: 32, maxWidth: 1024 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700 }}>{tournament.name}</h1>
        <p style={{ color: 'var(--status-neutral)', marginTop: 16 }}>
          No predictions yet for this tournament. Either it's below v1 scope (Premier + FIP Platinum + FIP Gold only)
          or the snapshot worker hasn't covered it yet.
        </p>
      </div>
    );
  }

  const byCategory = { men: [] as any[], women: [] as any[] };
  for (const r of latestByPair) {
    byCategory[r.category as 'men' | 'women'].push(r);
  }
  for (const cat of ['men', 'women'] as const) {
    byCategory[cat].sort((a, b) => Number(b.champ_prob) - Number(a.champ_prob));
  }

  const snapshotAt = latestByPair[0]?.created_at ?? '';

  return (
    <div style={{ padding: 32, maxWidth: 1024 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{tournament.name}</h1>
      <div style={{ fontSize: 12, color: 'var(--status-neutral)', marginBottom: 24 }}>
        {tournament.level} · {tournament.status} · snapshot {snapshotAt.slice(0, 16)}
      </div>

      {(['men', 'women'] as const).map((cat) => (
        <section key={cat} style={{ marginBottom: 32 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, textTransform: 'uppercase' }}>{cat}</h2>
          {byCategory[cat].length === 0 ? (
            <div style={{ color: 'var(--status-neutral)' }}>No {cat} predictions yet.</div>
          ) : (
            <div style={{ border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
              {byCategory[cat].map((r: any) => (
                <div
                  key={`${r.pair_player1_id}::${r.pair_player2_id}`}
                  style={{ padding: 10, borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: 16 }}
                >
                  <PairOddsRow
                    name={pairName(r.pair_player1_id, r.pair_player2_id)}
                    seed={r.pair_seed}
                    prob={Number(r.champ_prob)}
                    form={Number(r.team_form)}
                  />
                  <span style={{ minWidth: 56, textAlign: 'right' }}>
                    Final: {(Number(r.finalist_prob) * 100).toFixed(1)}%
                  </span>
                  <span style={{ minWidth: 56, textAlign: 'right' }}>
                    SF: {(Number(r.semi_prob) * 100).toFixed(1)}%
                  </span>
                  <span style={{ minWidth: 56, textAlign: 'right', color: 'var(--status-neutral)' }}>
                    Elo {Math.round(Number(r.team_elo))}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify in dev**

Open `http://localhost:3004/odds/tournament/8a47598a-579b-4503-88c2-135306d274fb` (Albania). Expected: page renders. Either shows predictions (if snapshots have run) or empty-state message.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/\(app\)/odds/tournament
git commit -m "feat(odds): /odds/tournament/[id] detail page (text-only)"
```

---

### Task 4.5: Page `/odds/match/[id]` (text-only)

**Files:**
- Create: `apps/ops/src/app/(app)/odds/match/[id]/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
import { createServiceClient } from '@/lib/supabase';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Match Odds · PadelNachos Admin' };
export const dynamic = 'force-dynamic';

interface PageProps { params: Promise<{ id: string }> }

export default async function MatchOddsPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = createServiceClient();

  const { data: match } = await supabase
    .from('matches')
    .select('id, tournament_id, category, round, round_canonical, status, scheduled_at, court, winner_pair, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, pair1_seed, pair2_seed, tournaments(name)')
    .eq('id', id)
    .maybeSingle();
  if (!match) notFound();

  const { data: latestPred } = await supabase
    .from('model_predictions')
    .select('*')
    .eq('match_id', id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: score } = await supabase
    .from('prediction_scores')
    .select('*')
    .eq('match_id', id)
    .maybeSingle();

  const playerIds = [match.pair1_player1_id, match.pair1_player2_id, match.pair2_player1_id, match.pair2_player2_id].filter(Boolean) as string[];
  const { data: pl } = await supabase.from('players').select('id, name, ranking').in('id', playerIds);
  const playerById = new Map((pl ?? []).map((p) => [p.id, p]));
  const pairLabel = (id1: string | null, id2: string | null) => {
    if (!id1 || !id2) return 'TBD';
    return `${playerById.get(id1)?.name ?? '?'} / ${playerById.get(id2)?.name ?? '?'}`;
  };

  const pair1 = pairLabel(match.pair1_player1_id, match.pair1_player2_id);
  const pair2 = pairLabel(match.pair2_player1_id, match.pair2_player2_id);

  return (
    <div style={{ padding: 32, maxWidth: 900 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>
        {(match.tournaments as any)?.name ?? 'Match'} · {match.round_canonical ?? match.round}
      </h1>
      <div style={{ fontSize: 12, color: 'var(--status-neutral)', marginBottom: 24 }}>
        {match.scheduled_at?.slice(0, 16)} · {match.court ?? '?'} · {match.category} · {match.status}
      </div>

      {!latestPred ? (
        <div style={{ color: 'var(--status-neutral)' }}>
          No prediction available. Either the snapshot worker hasn't covered this match yet, or it's below v1 scope.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <PairCard
            name={pair1}
            seed={match.pair1_seed}
            prob={Number(latestPred.pair1_prob)}
            decimal={Number(latestPred.pair1_decimal_odds)}
            elo={Number(latestPred.pair1_team_elo)}
            form={Number(latestPred.pair1_team_form)}
            favorite={Number(latestPred.pair1_prob) > 0.5}
          />
          <PairCard
            name={pair2}
            seed={match.pair2_seed}
            prob={Number(latestPred.pair2_prob)}
            decimal={Number(latestPred.pair2_decimal_odds)}
            elo={Number(latestPred.pair2_team_elo)}
            form={Number(latestPred.pair2_team_form)}
            favorite={Number(latestPred.pair2_prob) > 0.5}
          />
        </div>
      )}

      {score && (
        <div style={{ marginTop: 32, padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Result + calibration</h2>
          <div style={{ fontSize: 13 }}>
            Winner: pair {score.actual_winner_pair} ({score.actual_winner_pair === 1 ? pair1 : pair2})
          </div>
          <div style={{ display: 'flex', gap: 24, marginTop: 8, fontSize: 13 }}>
            <span>Predicted prob for winner: {(Number(score.predicted_prob_winner) * 100).toFixed(1)}%</span>
            <span>Brier: {Number(score.brier_score).toFixed(4)}</span>
            <span>Log-loss: {Number(score.log_loss).toFixed(4)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function PairCard({
  name, seed, prob, decimal, elo, form, favorite,
}: {
  name: string; seed: number | null; prob: number; decimal: number; elo: number; form: number; favorite: boolean;
}) {
  return (
    <div
      style={{
        padding: 16,
        border: `2px solid ${favorite ? 'var(--brand-primary-fg)' : 'var(--border-subtle)'}`,
        borderRadius: 4,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 4 }}>
        {seed ? <span style={{ color: 'var(--status-neutral)' }}>[{seed}] </span> : null}
        {name}
      </div>
      <div style={{ fontSize: 28, fontWeight: 700, color: favorite ? 'var(--brand-primary-fg)' : 'inherit' }}>
        {(prob * 100).toFixed(1)}%
      </div>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, fontSize: 12, color: 'var(--status-neutral)' }}>
        <span>Decimal {decimal.toFixed(2)}</span>
        <span>Elo {Math.round(elo)}</span>
        <span>Form {form > 0 ? '+' : ''}{Math.round(form)}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify in dev**

Open the page using a real match ID from `model_predictions`. Expected: page renders with pair cards. If match is finished and scored, also see the calibration block.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/\(app\)/odds/match
git commit -m "feat(odds): /odds/match/[id] detail page (text-only)"
```

---

### Task 4.6: Page `/odds/calibration` + supporting components

**Files:**
- Create: `apps/ops/src/app/(app)/odds/calibration/page.tsx`
- Create: `apps/ops/src/components/Odds/CalibrationKpiStrip.tsx`
- Create: `apps/ops/src/components/Odds/CalibrationBreakdownTable.tsx`
- Create: `apps/ops/src/components/Odds/ModelFreshnessPanel.tsx`

- [ ] **Step 1: Create `CalibrationKpiStrip.tsx`**

```tsx
export interface CalibrationKpiStripProps {
  totalScored: number;
  meanBrier: number | null;
  meanLogLoss: number | null;
  favoriteHitRate: number | null;
  windowLabel: string;
}

export function CalibrationKpiStrip(props: CalibrationKpiStripProps) {
  const { totalScored, meanBrier, meanLogLoss, favoriteHitRate, windowLabel } = props;
  const fmt = (v: number | null, digits = 4) => (v == null ? '—' : v.toFixed(digits));
  const fmtPct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
      <Kpi label={`Scored (${windowLabel})`} value={String(totalScored)} />
      <Kpi label="Mean Brier" value={fmt(meanBrier)} hint="Lower = better. 0.25 = coin flip." />
      <Kpi label="Mean log-loss" value={fmt(meanLogLoss)} hint="Lower = better. 0.69 = coin flip." />
      <Kpi label="Favorite hit-rate" value={fmtPct(favoriteHitRate)} hint="% of matches where model favorite won." />
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: 16, border: '1px solid var(--border-subtle)', borderRadius: 4 }}>
      <div style={{ fontSize: 11, color: 'var(--status-neutral)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: 10, color: 'var(--status-neutral)', marginTop: 4 }}>{hint}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create `CalibrationBreakdownTable.tsx`**

```tsx
export interface CalibrationBreakdownRow {
  key: string;             // tier name or tournament name
  count: number;
  meanBrier: number;
  meanLogLoss: number;
  favoriteHitRate: number;
}

export function CalibrationBreakdownTable({
  title,
  rows,
}: {
  title: string;
  rows: CalibrationBreakdownRow[];
}) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h3 style={{ fontSize: 13, fontWeight: 700, margin: '0 0 8px' }}>{title}</h3>
      {rows.length === 0 ? (
        <div style={{ color: 'var(--status-neutral)', fontSize: 13 }}>No data yet.</div>
      ) : (
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              <th style={{ textAlign: 'left', padding: 6 }}>Group</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Scored</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Mean Brier</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Mean log-loss</th>
              <th style={{ textAlign: 'right', padding: 6 }}>Fav hit-rate</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={{ padding: 6 }}>{r.key}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{r.count}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{r.meanBrier.toFixed(4)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{r.meanLogLoss.toFixed(4)}</td>
                <td style={{ padding: 6, textAlign: 'right' }}>{(r.favoriteHitRate * 100).toFixed(1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `ModelFreshnessPanel.tsx`**

```tsx
export interface ModelFreshnessPanelProps {
  latestSnapshotAt: string | null;
  trainingMatchCount: number | null;
  modelVersion: string | null;
  unscoredFinishedLast7d: number;
  meanBrier30d: number | null;
  favoriteHitRate30d: number | null;
}

export function ModelFreshnessPanel(props: ModelFreshnessPanelProps) {
  const {
    latestSnapshotAt, trainingMatchCount, modelVersion,
    unscoredFinishedLast7d, meanBrier30d, favoriteHitRate30d,
  } = props;

  const snapshotAgeMin = latestSnapshotAt
    ? Math.round((Date.now() - new Date(latestSnapshotAt).getTime()) / 60_000)
    : null;
  const snapshotColor =
    snapshotAgeMin == null ? 'var(--status-neutral)' :
    snapshotAgeMin <= 90 ? 'var(--status-positive)' :
    snapshotAgeMin <= 180 ? 'var(--status-warn)' :
    'var(--status-negative)';

  const unscoredColor = unscoredFinishedLast7d > 5 ? 'var(--status-negative)' : 'var(--status-positive)';
  const brierColor =
    meanBrier30d == null ? 'var(--status-neutral)' :
    meanBrier30d > 0.25 ? 'var(--status-negative)' :
    'var(--status-positive)';
  const hitRateColor =
    favoriteHitRate30d == null ? 'var(--status-neutral)' :
    favoriteHitRate30d < 0.5 ? 'var(--status-negative)' :
    'var(--status-positive)';

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, fontSize: 12 }}>
      <Chip
        label="Latest snapshot"
        value={snapshotAgeMin == null ? '—' : `${snapshotAgeMin}m ago`}
        color={snapshotColor}
      />
      <Chip
        label="Training set"
        value={trainingMatchCount == null ? '—' : `${trainingMatchCount.toLocaleString()} matches`}
      />
      <Chip
        label="Model version"
        value={modelVersion ?? '—'}
      />
      <Chip
        label="Unscored finished (7d)"
        value={String(unscoredFinishedLast7d)}
        color={unscoredColor}
      />
      <Chip
        label="Mean Brier (30d)"
        value={meanBrier30d == null ? '—' : meanBrier30d.toFixed(4)}
        color={brierColor}
      />
      <Chip
        label="Favorite hit-rate (30d)"
        value={favoriteHitRate30d == null ? '—' : `${(favoriteHitRate30d * 100).toFixed(1)}%`}
        color={hitRateColor}
      />
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      padding: 10,
      border: `1px solid ${color ?? 'var(--border-subtle)'}`,
      borderRadius: 4,
    }}>
      <div style={{ fontSize: 10, color: 'var(--status-neutral)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, color: color ?? 'inherit' }}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Create the calibration page**

```tsx
import { CalibrationKpiStrip } from '@/components/Odds/CalibrationKpiStrip';
import { CalibrationBreakdownTable, type CalibrationBreakdownRow } from '@/components/Odds/CalibrationBreakdownTable';
import { ModelFreshnessPanel } from '@/components/Odds/ModelFreshnessPanel';
import {
  computeCalibrationKpis,
  getCalibrationData,
  getModelFreshness,
} from '@/lib/odds-data';
import { createServiceClient } from '@/lib/supabase';

export const metadata = { title: 'Calibration · PadelNachos Admin' };
export const dynamic = 'force-dynamic';

export default async function CalibrationPage() {
  const supabase = createServiceClient();
  const allRows = await getCalibrationData(99_999); // effectively all-time
  const rows30d = await getCalibrationData(30);
  const freshness = await getModelFreshness();

  const allTime = computeCalibrationKpis(allRows);
  const last30d = computeCalibrationKpis(rows30d);

  // Per-tier breakdown: need to join through matches → tournaments → level.
  const matchIds = [...new Set(allRows.map((r: any) => r.match_id))];
  const { data: matchMeta } = matchIds.length
    ? await supabase
        .from('matches')
        .select('id, tournament_id, tournaments(level, name)')
        .in('id', matchIds)
    : { data: [] as any[] };
  const matchToLevel = new Map<string, string>();
  const matchToTournament = new Map<string, { id: string; name: string }>();
  for (const m of matchMeta ?? []) {
    const lvl = (m as any).tournaments?.level ?? 'unknown';
    matchToLevel.set(m.id, lvl);
    matchToTournament.set(m.id, {
      id: (m as any).tournament_id,
      name: (m as any).tournaments?.name ?? 'Unknown',
    });
  }

  const byTier = new Map<string, any[]>();
  const byTournament = new Map<string, any[]>();
  for (const r of allRows) {
    const tier = matchToLevel.get((r as any).match_id) ?? 'unknown';
    const tourn = matchToTournament.get((r as any).match_id);
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier)!.push(r);
    if (tourn) {
      const k = `${tourn.id}::${tourn.name}`;
      if (!byTournament.has(k)) byTournament.set(k, []);
      byTournament.get(k)!.push(r);
    }
  }

  const tierRows: CalibrationBreakdownRow[] = [...byTier.entries()].map(([k, rows]) => {
    const k0 = computeCalibrationKpis(rows);
    return {
      key: k,
      count: k0.totalScored,
      meanBrier: k0.meanBrier ?? 0,
      meanLogLoss: k0.meanLogLoss ?? 0,
      favoriteHitRate: k0.favoriteHitRate ?? 0,
    };
  }).sort((a, b) => b.count - a.count);

  const tournRows: CalibrationBreakdownRow[] = [...byTournament.entries()]
    .map(([k, rows]) => {
      const [, name] = k.split('::');
      const k0 = computeCalibrationKpis(rows);
      return {
        key: name,
        count: k0.totalScored,
        meanBrier: k0.meanBrier ?? 0,
        meanLogLoss: k0.meanLogLoss ?? 0,
        favoriteHitRate: k0.favoriteHitRate ?? 0,
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return (
    <div style={{ padding: 32, maxWidth: 1024 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>Calibration</h1>

      <CalibrationKpiStrip
        windowLabel="30d"
        totalScored={last30d.totalScored}
        meanBrier={last30d.meanBrier}
        meanLogLoss={last30d.meanLogLoss}
        favoriteHitRate={last30d.favoriteHitRate}
      />

      <CalibrationBreakdownTable title="By tier" rows={tierRows} />
      <CalibrationBreakdownTable title="By tournament (last 10)" rows={tournRows} />

      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '32px 0 12px' }}>Model freshness</h2>
      <ModelFreshnessPanel
        latestSnapshotAt={freshness.latestSnapshotAt}
        trainingMatchCount={freshness.trainingMatchCount}
        modelVersion={freshness.modelVersion}
        unscoredFinishedLast7d={freshness.unscoredFinishedLast7d}
        meanBrier30d={last30d.meanBrier}
        favoriteHitRate30d={last30d.favoriteHitRate}
      />

      <div style={{ marginTop: 24, fontSize: 11, color: 'var(--status-neutral)' }}>
        Showing {allTime.totalScored.toLocaleString()} scored predictions all-time.
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Verify in dev**

Open `http://localhost:3004/odds/calibration`. Expected: page renders. KPI cards show `—` if no scored predictions yet; freshness panel still shows chips with colors.

- [ ] **Step 6: Commit**

```bash
git add apps/ops/src/app/\(app\)/odds/calibration apps/ops/src/components/Odds/Calibration*.tsx apps/ops/src/components/Odds/ModelFreshnessPanel.tsx
git commit -m "feat(odds): /odds/calibration dashboard with KPIs + breakdowns + freshness panel"
```

---

## Phase 5 — Charts + methodology page

### Task 5.1: Methodology page `/odds/methodology`

**Files:**
- Create: `apps/ops/src/app/(app)/odds/methodology/page.tsx`
- Create: `apps/ops/src/components/Odds/MethodologyMarkdown.tsx`

- [ ] **Step 1: Check if a markdown renderer is already in apps/ops**

```bash
cd apps/ops && grep -r "react-markdown\|@uiw/react-markdown\|marked" package.json
```

If none found: `npm install react-markdown remark-gfm` (mature, light, supports tables/checkboxes used in the spec).

- [ ] **Step 2: Create `MethodologyMarkdown.tsx`**

```tsx
'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MethodologyMarkdown({ source }: { source: string }) {
  return (
    <div className="methodology-md" style={{ maxWidth: 900, lineHeight: 1.6 }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{source}</ReactMarkdown>
      <style>{`
        .methodology-md h1 { font-size: 22px; font-weight: 700; margin: 32px 0 12px; }
        .methodology-md h2 { font-size: 18px; font-weight: 700; margin: 28px 0 10px; }
        .methodology-md h3 { font-size: 15px; font-weight: 700; margin: 20px 0 8px; }
        .methodology-md table { border-collapse: collapse; margin: 12px 0; font-size: 13px; }
        .methodology-md th, .methodology-md td { padding: 6px 10px; border: 1px solid var(--border-subtle); text-align: left; }
        .methodology-md code { background: var(--bg-canvas); padding: 1px 4px; border-radius: 2px; font-size: 12px; }
        .methodology-md pre { background: var(--bg-canvas); padding: 12px; border-radius: 4px; overflow: auto; }
        .methodology-md ul, .methodology-md ol { padding-left: 24px; }
      `}</style>
    </div>
  );
}
```

- [ ] **Step 3: Create the page**

```tsx
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MethodologyMarkdown } from '@/components/Odds/MethodologyMarkdown';

export const metadata = { title: 'Methodology · PadelNachos Admin' };
export const dynamic = 'force-dynamic';

export default async function MethodologyPage() {
  // Path is relative to the ops app's cwd at runtime (apps/ops).
  // The spec lives at <repo>/docs/superpowers/specs/2026-05-27-elo-odds-model-design.md.
  const specPath = resolve(process.cwd(), '../../docs/superpowers/specs/2026-05-27-elo-odds-model-design.md');
  let source = '';
  try {
    source = await readFile(specPath, 'utf8');
  } catch {
    source = '# Methodology spec not found\n\nExpected file at `docs/superpowers/specs/2026-05-27-elo-odds-model-design.md`.';
  }

  return (
    <div style={{ padding: 32 }}>
      <MethodologyMarkdown source={source} />
    </div>
  );
}
```

- [ ] **Step 4: Verify in dev**

Open `http://localhost:3004/odds/methodology`. Expected: full spec renders as a clean markdown page with tables.

- [ ] **Step 5: Commit**

```bash
git add apps/ops/src/app/\(app\)/odds/methodology apps/ops/src/components/Odds/MethodologyMarkdown.tsx apps/ops/package.json apps/ops/package-lock.json
git commit -m "feat(odds): /odds/methodology renders model spec markdown in-app"
```

---

### Task 5.2: `OddsMovementChart` component

**Files:**
- Create: `apps/ops/src/components/Odds/OddsMovementChart.tsx`

- [ ] **Step 1: Check what charting library is already in apps/ops**

```bash
cd apps/ops && grep -E "recharts|chart" package.json
```

If none, install: `npm install recharts`.

- [ ] **Step 2: Create the chart component**

```tsx
'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

export interface OddsMovementSeries {
  name: string;
  color: string;
  points: Array<{ t: string; value: number }>; // t = ISO timestamp
}

export function OddsMovementChart({
  series,
  yLabel = 'Probability',
  yDomain = [0, 1] as [number, number],
}: {
  series: OddsMovementSeries[];
  yLabel?: string;
  yDomain?: [number, number];
}) {
  if (series.length === 0 || series.every((s) => s.points.length < 2)) {
    return (
      <div style={{ padding: 24, color: 'var(--status-neutral)', textAlign: 'center', fontSize: 13 }}>
        Insufficient snapshot history. Check back after a few hourly snapshots accumulate.
      </div>
    );
  }
  // Build a single data array keyed by timestamp
  const tSet = new Set<string>();
  for (const s of series) for (const p of s.points) tSet.add(p.t);
  const allT = [...tSet].sort();
  const data = allT.map((t) => {
    const row: Record<string, number | string> = { t: t.slice(5, 16).replace('T', ' ') };
    for (const s of series) {
      const p = s.points.find((q) => q.t === t);
      if (p) row[s.name] = p.value;
    }
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis dataKey="t" fontSize={11} />
        <YAxis domain={yDomain} fontSize={11} tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} label={{ value: yLabel, angle: -90, position: 'insideLeft' }} />
        <Tooltip formatter={(v: number) => `${(v * 100).toFixed(1)}%`} />
        <Legend />
        {series.map((s) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
```

- [ ] **Step 3: Verify typecheck**

```bash
cd apps/ops && npx tsc --noEmit 2>&1 | tail -10
```

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/components/Odds/OddsMovementChart.tsx apps/ops/package.json apps/ops/package-lock.json
git commit -m "feat(odds): OddsMovementChart component (recharts line chart)"
```

---

### Task 5.3: Wire chart into tournament + match detail pages

**Files:**
- Modify: `apps/ops/src/app/(app)/odds/tournament/[id]/page.tsx`
- Modify: `apps/ops/src/app/(app)/odds/match/[id]/page.tsx`

- [ ] **Step 1: Add chart to tournament detail page**

Inside `TournamentOddsPage`, after the existing per-category table, add a chart for the top-5 pairs' `champ_prob` over time.

Add this query before the `return`:

```typescript
  // Build top-5 series per category for the chart
  const chartByCat = { men: [] as any, women: [] as any };
  for (const cat of ['men', 'women'] as const) {
    const top5 = byCategory[cat].slice(0, 5);
    const series: any[] = [];
    const colors = ['#ff6b2b', '#ffd166', '#06d6a0', '#118ab2', '#9b5de5'];
    for (let i = 0; i < top5.length; i++) {
      const p = top5[i];
      const { data: history } = await supabase
        .from('model_tournament_predictions')
        .select('created_at, champ_prob')
        .eq('tournament_id', id)
        .eq('category', cat)
        .eq('pair_player1_id', p.pair_player1_id)
        .eq('pair_player2_id', p.pair_player2_id)
        .order('created_at', { ascending: true });
      series.push({
        name: pairName(p.pair_player1_id, p.pair_player2_id),
        color: colors[i % colors.length],
        points: (history ?? []).map((h: any) => ({ t: h.created_at, value: Number(h.champ_prob) })),
      });
    }
    chartByCat[cat] = series;
  }
```

Import at top:
```typescript
import { OddsMovementChart } from '@/components/Odds/OddsMovementChart';
```

Inside the category section JSX, after the table, add:

```tsx
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Top-5 champ% movement</h3>
            <OddsMovementChart series={chartByCat[cat]} yLabel="Champ %" />
          </div>
```

- [ ] **Step 2: Add chart to match detail page**

In `MatchOddsPage`, before the `return`, query the full prediction history for the chart:

```typescript
  const { data: history } = await supabase
    .from('model_predictions')
    .select('created_at, pair1_prob, pair2_prob')
    .eq('match_id', id)
    .order('created_at', { ascending: true });
```

Add the chart between the pair cards and the score block:

```tsx
      <h2 style={{ fontSize: 14, fontWeight: 700, margin: '32px 0 8px' }}>Probability movement</h2>
      <OddsMovementChart
        series={[
          {
            name: pair1,
            color: '#ff6b2b',
            points: (history ?? []).map((h: any) => ({ t: h.created_at, value: Number(h.pair1_prob) })),
          },
          {
            name: pair2,
            color: '#ffd166',
            points: (history ?? []).map((h: any) => ({ t: h.created_at, value: Number(h.pair2_prob) })),
          },
        ]}
      />
```

Import:
```typescript
import { OddsMovementChart } from '@/components/Odds/OddsMovementChart';
```

- [ ] **Step 3: Verify in dev**

```bash
cd apps/ops && npm run dev
```

Open `/odds/tournament/<id>` and `/odds/match/<id>` for ones with snapshot history. Expected: charts render. With <2 snapshots, the empty-state message renders instead.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/\(app\)/odds/tournament apps/ops/src/app/\(app\)/odds/match
git commit -m "feat(odds): wire OddsMovementChart into tournament + match detail pages"
```

---

## Acceptance verification

Per the spec (§7), v1 is done when:

1. **Migration applied:** `psql ... -c "\dt model_predictions"` shows the table. ✓ (Task 1.1)
2. **Snapshot worker running:** Railway logs show "model-prediction-snapshot complete" every hour at `:25` with `failed=0`. ✓ (Task 2.3)
3. **Scorer worker running:** Railway logs show "prediction-scorer complete" every 10 minutes. ✓ (Task 3.3)
4. **Pages render all empty + populated states:** Dev-verified after each Task 4.x. ✓
5. **Numbers match standalone script** (within MC noise): Spot-checked in Task 2.3 step 5. ✓
6. **Calibration shows non-`—` KPIs within 48h** of going live: Verified after first scored match. ✓ (Task 3.3 step 4)
7. **Freshness chips green** under normal operation: Verified once live. ✓
8. **Methodology page renders without broken layout:** Verified in Task 5.1 step 4. ✓
9. **All tests pass:** Run `npm test` in `padelgod/` and `apps/ops/` at the end.

Run final test sweep:
```bash
cd padelgod && npm test
cd ../apps/ops && npm test
```

Expected: all tests pass.

---

## Phase summary

| Phase | PR scope | Estimate |
|---|---|---|
| 1 | Migration + lib + script refactor | ~2 hrs |
| 2 | Snapshot worker + scheduler + dry-run deploy | ~4 hrs |
| 3 | Scorer worker + enable writes | ~3 hrs |
| 4 | 4 admin pages + sidebar + data layer | ~6 hrs |
| 5 | Methodology page + chart wiring | ~3 hrs |
| **Total** | | **~18 hrs** |

Each phase is independently shippable. Pausable at any boundary. Rollback via feature flags + table drops if needed (no FKs from other tables to these).
