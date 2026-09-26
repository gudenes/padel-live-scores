# PPL Phase 1 — Foundations and exclusion gates

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production safe to ingest Pro Padel League data into — schema in place, and every consumer that reads `matches` unfiltered now excludes team-league levels.

**Architecture:** One shared module (`league-levels.ts`, mirrored into padelgod) defines which `tournaments.level` values are team-league rather than circuit. Every gate imports it. The Elo fix goes *inside* `trainElo()` rather than at its call sites, so all four callers — `model-prediction-snapshot`, `tournament-projection-snapshot`, the backtest harness, and `simulate-elo-tournaments` — are protected by one change. The exclusion is a **deny-list**, not an allow-list: an allow-list would shrink the existing training corpus (which currently trains on every tier) and change behaviour far beyond PPL.

**Tech Stack:** TypeScript, Vitest, Supabase/PostgreSQL, Next.js 16.

**Spec:** `docs/superpowers/specs/2026-09-22-pro-padel-league-design.md`

**Scope note:** No PPL data is ingested in this phase and nothing is user-visible. The only observable change is that two new `level` values are recognised and excluded everywhere. Phase 2 (ingestion) must not start until this lands.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/league-levels.ts` | **Create.** Single source of truth for which levels are team-league. Pure, no imports |
| `padelgod/src/lib/league-levels.ts` | **Create.** Byte-identical mirror (padelgod is a separate package and cannot import from `src/`) |
| `src/lib/__tests__/league-levels.test.ts` | **Create.** Tests the shared module and pins the mirror identical |
| `src/lib/tournament-labels.ts` | **Modify.** Add `ppl`/`ppl_ii` to `levelLabel` + `levelTierWeight` |
| `src/lib/tournament-tier-style.ts` | **Modify.** Add `ppl`/`ppl_ii` to `TIER_GRADIENT` + `TIER_PILL` |
| `src/lib/derive-titles.ts` | **Modify.** Skip team-league finals |
| `src/lib/match-quality.ts` | **Modify.** Explicit zero tier weight for team-league |
| `src/app/[locale]/player/[id]/page.tsx` | **Modify.** `LEVEL_TO_CIRCUIT` gains PPL entries |
| `src/lib/earnings/__tests__/tier-from-level.test.ts` | **Create.** Regression test pinning the default-deny |
| `padelgod/src/lib/elo-model.ts` | **Modify.** `trainElo` skips team-league matches |
| `padelgod/src/workers/live-odds-updater.ts` | **Modify.** Level gate on the live-match query |
| `supabase/migrations/20260922120000_ppl_league_foundations.sql` | **Create.** Schema. **Written, not applied** |

---

## Task 1: Shared team-league level module

**Files:**
- Create: `src/lib/league-levels.ts`
- Create: `padelgod/src/lib/league-levels.ts`
- Test: `src/lib/__tests__/league-levels.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/league-levels.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEAGUE_LEVELS, isLeagueLevel } from '../league-levels'

describe('isLeagueLevel', () => {
  it('matches the two PPL levels', () => {
    expect(isLeagueLevel('ppl')).toBe(true)
    expect(isLeagueLevel('ppl_ii')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isLeagueLevel('PPL')).toBe(true)
    expect(isLeagueLevel('Ppl_II')).toBe(true)
  })

  it('rejects every circuit level', () => {
    for (const level of ['major', 'finals', 'p1', 'p2', 'fip_platinum', 'fip_gold', 'fip_silver', 'fip_bronze', 'fip_other']) {
      expect(isLeagueLevel(level)).toBe(false)
    }
  })

  it('treats null, undefined and empty string as not-league', () => {
    expect(isLeagueLevel(null)).toBe(false)
    expect(isLeagueLevel(undefined)).toBe(false)
    expect(isLeagueLevel('')).toBe(false)
  })

  it('exposes the level set', () => {
    expect([...LEAGUE_LEVELS].sort()).toEqual(['ppl', 'ppl_ii'])
  })
})

describe('padelgod mirror', () => {
  it('is byte-identical to the Next.js copy', () => {
    const root = join(__dirname, '..', '..', '..')
    const a = readFileSync(join(root, 'src/lib/league-levels.ts'), 'utf8')
    const b = readFileSync(join(root, 'padelgod/src/lib/league-levels.ts'), 'utf8')
    expect(b).toBe(a)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/league-levels.test.ts`
Expected: FAIL — `Failed to resolve import "../league-levels"`

- [ ] **Step 3: Create the module**

Create `src/lib/league-levels.ts`:

```ts
// Team-league tournament levels.
//
// These are franchise leagues (Pro Padel League), not the individual
// circuit. Their matches ARE stored in `matches` with real player FKs so
// they appear in a player's history — but they must never feed circuit
// metrics: win rate, W-L record, titles, Elo, predictions, prize money.
//
// A different format (team ties, super-tiebreak third set) scored into
// the same numbers as FIP/Premier results would corrupt them.
//
// MIRRORED at padelgod/src/lib/league-levels.ts — padelgod is a separate
// npm package and cannot import from src/. The two files must stay
// byte-identical; a test in src/lib/__tests__/league-levels.test.ts
// enforces it.
//
// Adding a new team league? Add its level here and every gate picks it
// up. Do NOT add circuit tiers to this set.

export const LEAGUE_LEVELS: ReadonlySet<string> = new Set(['ppl', 'ppl_ii'])

export function isLeagueLevel(level: string | null | undefined): boolean {
  if (!level) return false
  return LEAGUE_LEVELS.has(level.toLowerCase())
}
```

- [ ] **Step 4: Create the padelgod mirror**

Run: `cp src/lib/league-levels.ts padelgod/src/lib/league-levels.ts`

The mirror must be byte-identical — copy it, do not retype it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/league-levels.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 6: Commit**

```bash
git add src/lib/league-levels.ts padelgod/src/lib/league-levels.ts src/lib/__tests__/league-levels.test.ts
git commit -m "feat(ppl): shared team-league level module"
```

---

## Task 2: Level labels, pills and sort weight

Without this, a PPL tournament renders the literal string `"ppl"` on screen and sorts via the `?? 50` fallback.

**Files:**
- Modify: `src/lib/tournament-labels.ts`
- Modify: `src/lib/tournament-tier-style.ts`
- Test: `src/lib/__tests__/ppl-level-display.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/ppl-level-display.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { levelLabel, levelTierWeight, isPremierLevel } from '../tournament-labels'
import { getTierPill, getTierGradient, FALLBACK_PILL, FALLBACK_GRADIENT } from '../tournament-tier-style'

describe('PPL level display', () => {
  it('labels both levels', () => {
    expect(levelLabel('ppl')).toBe('PPL')
    expect(levelLabel('ppl_ii')).toBe('PPL II')
  })

  it('sorts below every FIP tier but above the unknown fallback', () => {
    expect(levelTierWeight('ppl')).toBe(30)
    expect(levelTierWeight('ppl_ii')).toBe(31)
    expect(levelTierWeight('ppl')).toBeGreaterThan(levelTierWeight('fip_other'))
    expect(levelTierWeight('ppl_ii')).toBeLessThan(levelTierWeight('something-unknown'))
  })

  it('has its own pill and gradient rather than the fallback', () => {
    expect(getTierPill('ppl')).not.toEqual(FALLBACK_PILL)
    expect(getTierPill('ppl_ii')).not.toEqual(FALLBACK_PILL)
    expect(getTierGradient('ppl')).not.toBe(FALLBACK_GRADIENT)
    expect(getTierGradient('ppl_ii')).not.toBe(FALLBACK_GRADIENT)
  })

  it('is not a Premier level (no PBP / Score Recap / Live Feed)', () => {
    expect(isPremierLevel('ppl')).toBe(false)
    expect(isPremierLevel('ppl_ii')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/ppl-level-display.test.ts`
Expected: FAIL — `expected 'ppl' to be 'PPL'`

- [ ] **Step 3: Add the labels**

In `src/lib/tournament-labels.ts`, inside `levelLabel`'s `map`, add after the `fip_other: 'FIP Tour',` line:

```ts
    fip_other: 'FIP Tour',
    ppl: 'PPL',
    ppl_ii: 'PPL II',
```

- [ ] **Step 4: Add the sort weights**

In the same file, inside `levelTierWeight`'s `map`, add after `fip_other: 25,`:

```ts
    fip_other: 25,
    // Team leagues sort below every circuit tier — they are a separate
    // competition, not a rung on the FIP/Premier ladder. Explicit rather
    // than falling through to `?? 50`, so the ordering is intentional.
    ppl: 30,
    ppl_ii: 31,
```

- [ ] **Step 5: Add the pill and gradient**

In `src/lib/tournament-tier-style.ts`, add a gradient constant after the `SLATE_GRADIENT` line:

```ts
const SLATE_GRADIENT   = 'linear-gradient(135deg, #334155, #64748B)'
const LEAGUE_GRADIENT  = 'linear-gradient(135deg, #0C4A6E, #38C8FF)'
```

Then add to `TIER_GRADIENT`, after `fip_other: SLATE_GRADIENT,`:

```ts
  fip_other:        SLATE_GRADIENT,
  ppl:              LEAGUE_GRADIENT,
  ppl_ii:           LEAGUE_GRADIENT,
```

And to `TIER_PILL`, after `fip_other: { background: SLATE_GRADIENT, color: '#fff' },`:

```ts
  fip_other:        { background: SLATE_GRADIENT,  color: '#fff' },
  ppl:              { background: LEAGUE_GRADIENT, color: '#fff' },
  ppl_ii:           { background: LEAGUE_GRADIENT, color: '#fff' },
```

Also update the file's header comment — it currently claims "All 17 known levels are mapped here". Change that line to:

```
// Keys match production `tournaments.level` values (Premier tiers are bare,
// FIP tiers carry the `fip_` prefix, team leagues use `ppl` / `ppl_ii`).
// All known levels are mapped here; unknown values fall back to
// FALLBACK_GRADIENT / FALLBACK_PILL.
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/ppl-level-display.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 7: Commit**

```bash
git add src/lib/tournament-labels.ts src/lib/tournament-tier-style.ts src/lib/__tests__/ppl-level-display.test.ts
git commit -m "feat(ppl): level labels, tier pill and sort weight"
```

---

## Task 3: Elo training corpus exclusion

**This is the highest-risk gate in the plan.** `model-prediction-snapshot.ts` filters which tournaments *receive* predictions (`isInScopeTier`, line 293) but reads its training corpus with no level filter at all (line 311). PPL results would move real players' Elo ratings.

The fix goes inside `trainElo()`, which already receives `tournamentLevels`. That covers all four callers at once — including `elo-backtest.ts` and `simulate-elo-tournaments.ts`, which have the same bug and are not otherwise touched by this plan.

**Files:**
- Modify: `padelgod/src/lib/elo-model.ts`
- Test: `padelgod/src/lib/__tests__/elo-model-league-exclusion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/elo-model-league-exclusion.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { trainElo, fipPriorElo, type TrainingMatch, type PlayerSnapshot } from '../elo-model.js'

const PLAYERS = new Map<string, PlayerSnapshot>([
  ['a', { id: 'a', name: 'A', ranking: 10, category: 'men' }],
  ['b', { id: 'b', name: 'B', ranking: 10, category: 'men' }],
  ['c', { id: 'c', name: 'C', ranking: 200, category: 'men' }],
  ['d', { id: 'd', name: 'D', ranking: 200, category: 'men' }],
])

function match(id: string, tournamentId: string): TrainingMatch {
  return {
    id,
    tournament_id: tournamentId,
    finished_at: '2026-08-15T12:00:00Z',
    scheduled_at: '2026-08-15T12:00:00Z',
    pair1_player1_id: 'a',
    pair1_player2_id: 'b',
    pair2_player1_id: 'c',
    pair2_player2_id: 'd',
    winner_pair: 2,
  } as TrainingMatch
}

const AS_OF = '2026-09-01T00:00:00Z'

describe('trainElo team-league exclusion', () => {
  it('does not train on a PPL match', () => {
    const levels = new Map([['t-ppl', 'ppl']])
    const result = trainElo([match('m1', 't-ppl')], PLAYERS, levels, AS_OF, 180)
    expect(result.trainedCount).toBe(0)
  })

  it('does not train on a PPL II match', () => {
    const levels = new Map([['t-ppl2', 'ppl_ii']])
    const result = trainElo([match('m1', 't-ppl2')], PLAYERS, levels, AS_OF, 180)
    expect(result.trainedCount).toBe(0)
  })

  it('leaves ratings at their cold-start prior when only league matches exist', () => {
    const levels = new Map([['t-ppl', 'ppl']])
    const result = trainElo([match('m1', 't-ppl')], PLAYERS, levels, AS_OF, 180)
    expect(result.elo.get('a')).toBeUndefined()
    expect(result.elo.get('c')).toBeUndefined()
  })

  it('still trains on circuit matches', () => {
    const levels = new Map([['t-p1', 'p1']])
    const result = trainElo([match('m1', 't-p1')], PLAYERS, levels, AS_OF, 180)
    expect(result.trainedCount).toBe(1)
    expect(result.elo.get('c')!).toBeGreaterThan(fipPriorElo(200))
  })

  it('trains circuit matches in a mixed corpus and skips the league one', () => {
    const levels = new Map([['t-p1', 'p1'], ['t-ppl', 'ppl']])
    const result = trainElo(
      [match('m1', 't-p1'), match('m2', 't-ppl')],
      PLAYERS, levels, AS_OF, 180,
    )
    expect(result.trainedCount).toBe(1)
  })

  it('still trains on an unknown level (deny-list, not allow-list)', () => {
    const levels = new Map([['t-x', 'some_new_tier']])
    const result = trainElo([match('m1', 't-x')], PLAYERS, levels, AS_OF, 180)
    expect(result.trainedCount).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/elo-model-league-exclusion.test.ts`
Expected: FAIL — first test gets `trainedCount: 1`, expected `0`

- [ ] **Step 3: Add the guard to `trainElo`**

In `padelgod/src/lib/elo-model.ts`, add the import at the top of the file, directly below the header comment block and above `export const MODEL_VERSION`:

```ts
import { isLeagueLevel } from './league-levels.js';
```

Then inside `trainElo`'s `for (const m of matches)` loop, insert the level check immediately **after** the existing null/winner guard and **before** the `const matchMs = ...` line:

```ts
    if (
      !m.pair1_player1_id || !m.pair1_player2_id ||
      !m.pair2_player1_id || !m.pair2_player2_id ||
      (m.winner_pair !== 1 && m.winner_pair !== 2)
    ) {
      continue;
    }
    // Team-league results (PPL) never move circuit Elo. Gating here rather
    // than at the call sites covers every caller at once: the two snapshot
    // workers, the backtest harness, and simulate-elo-tournaments — all of
    // which read the training corpus with no level filter of their own.
    if (isLeagueLevel(tournamentLevels.get(m.tournament_id ?? ''))) {
      continue;
    }
    const matchMs = new Date(m.scheduled_at ?? m.finished_at ?? asOfIso).getTime();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd padelgod && npx vitest run src/lib/__tests__/elo-model-league-exclusion.test.ts`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify no existing Elo test regressed**

Run: `cd padelgod && npx vitest run src/lib/__tests__/`
Expected: PASS. The deny-list must not change behaviour for any existing level — if an existing test fails, stop and report rather than adjusting the test.

- [ ] **Step 6: Typecheck padelgod**

Run: `cd padelgod && npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/lib/elo-model.ts padelgod/src/lib/__tests__/elo-model-league-exclusion.test.ts
git commit -m "fix(elo): exclude team-league matches from the training corpus

The prediction workers gate which tournaments receive predictions but
read their training corpus with no level filter, so PPL results would
move real players' circuit Elo. Gate inside trainElo so all four
callers are covered."
```

---

## Task 4: Live odds level gate

`live-odds-updater.ts` selects live matches with no level filter, so a live PPL match would immediately acquire cold-start Elo odds and write rows to `match_live_odds`. Live PPL data is Phase 3+, but this gate must exist before it can ever arrive.

**Files:**
- Modify: `padelgod/src/workers/live-odds-updater.ts`

- [ ] **Step 1: Add the level join and filter**

In `padelgod/src/workers/live-odds-updater.ts`, extend the `MatchRow` interface to carry the tournament level:

```ts
interface MatchRow {
  id: string; status: string
  pair1_player1_id: string | null; pair1_player2_id: string | null
  pair2_player1_id: string | null; pair2_player2_id: string | null
  tournament: { level: string | null } | null
}
```

Add the import alongside the existing `elo-model.js` import:

```ts
import { isLeagueLevel } from '../lib/league-levels.js'
```

Change the query to select the level, and add a `skippedLeague` counter. Replace the query block and the counter declaration:

```ts
  const { supabase, logger } = deps
  let updated = 0, model = 0, coldStart = 0, skippedNoPbp = 0, skippedLeague = 0, errors = 0

  const { data: matches, error } = await supabase
    .from('matches')
    .select('id,status,pair1_player1_id,pair1_player2_id,pair2_player1_id,pair2_player2_id,tournament:tournaments(level)')
    .in('status', LIVE)
    .returns<MatchRow[]>()
  if (error) { logger.error({ worker: 'live-odds-updater', error: error.message }, 'live match query failed'); return { updated, model, coldStart, skippedNoPbp, skippedLeague, errors: 1 } }
```

Inside the `for (const m of matches ?? [])` loop, add the gate as the very first statement in the `try` block, before the `match_points` count query — so a league match costs zero extra round trips:

```ts
    try {
      // Team-league matches get no model odds: their Elo anchor would be
      // meaningless (league results never train the model) and the in-play
      // engine assumes circuit scoring.
      if (isLeagueLevel(m.tournament?.level)) { skippedLeague++; continue }

      const { count } = await supabase.from('match_points')
```

- [ ] **Step 2: Update the return type and every return statement**

Change the function's declared return type:

```ts
export async function runLiveOddsUpdater(deps: SchedulerDeps): Promise<{
  updated: number; model: number; coldStart: number; skippedNoPbp: number; skippedLeague: number; errors: number
}> {
```

Then find the final `return { ... }` at the end of the function and add `skippedLeague` to it, matching the shape above.

- [ ] **Step 3: Typecheck**

Run: `cd padelgod && npm run typecheck`
Expected: no errors. If the scheduler logs this worker's result shape, TypeScript will flag any call site that destructures the old shape — fix those to include `skippedLeague`.

- [ ] **Step 4: Run the padelgod suite**

Run: `cd padelgod && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/workers/live-odds-updater.ts
git commit -m "fix(odds): gate live odds on tournament level

Team-league matches would otherwise acquire cold-start Elo odds from a
model their results never trained."
```

---

## Task 5: Titles exclusion

`deriveTitles` counts any `round === 'F'` win as a career title with no level check. A PPL final would render a trophy on the player profile.

**Files:**
- Modify: `src/lib/derive-titles.ts`
- Test: `src/lib/__tests__/derive-titles-league.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/derive-titles-league.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveTitles, type MatchRowForTitles } from '../derive-titles'

const PLAYER = 'p1'

function final(tournamentId: string, level: string): MatchRowForTitles {
  return {
    id: `m-${tournamentId}`,
    round: 'F',
    status: 'finished',
    winner_pair: 1,
    finished_at: '2026-08-16T18:00:00Z',
    scheduled_at: '2026-08-16T16:00:00Z',
    pair1_player1: { id: PLAYER, name: 'Player One' },
    pair1_player2: { id: 'p2', name: 'Player Two' },
    pair2_player1: { id: 'p3', name: 'Player Three' },
    pair2_player2: { id: 'p4', name: 'Player Four' },
    tournament: { id: tournamentId, name: `T ${tournamentId}`, level },
  } as MatchRowForTitles
}

describe('deriveTitles team-league exclusion', () => {
  it('does not count a PPL final as a title', () => {
    expect(deriveTitles([final('t1', 'ppl')], PLAYER)).toHaveLength(0)
  })

  it('does not count a PPL II final as a title', () => {
    expect(deriveTitles([final('t1', 'ppl_ii')], PLAYER)).toHaveLength(0)
  })

  it('still counts a circuit final', () => {
    const titles = deriveTitles([final('t1', 'p1')], PLAYER)
    expect(titles).toHaveLength(1)
    expect(titles[0].tournamentLevel).toBe('p1')
  })

  it('counts only the circuit final in a mixed list', () => {
    const titles = deriveTitles([final('t1', 'ppl'), final('t2', 'major')], PLAYER)
    expect(titles).toHaveLength(1)
    expect(titles[0].tournamentId).toBe('t2')
  })

  it('still counts a final whose level is null', () => {
    expect(deriveTitles([final('t1', null as unknown as string)], PLAYER)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/derive-titles-league.test.ts`
Expected: FAIL — first test gets length 1, expected 0

- [ ] **Step 3: Add the guard**

In `src/lib/derive-titles.ts`, add the import below the existing one:

```ts
import { resolveMatchRoles, type MatchPlayer } from './match-roles'
import { isLeagueLevel } from './league-levels'
```

Then inside `deriveTitles`'s loop, add the check immediately after the `m.round !== 'F'` guard:

```ts
  for (const m of matches) {
    if (m.round !== 'F') continue
    // Winning a team-league final is not a career title — different
    // competition, different format.
    if (isLeagueLevel(m.tournament?.level)) continue
    if (!m.tournament?.id) continue
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/derive-titles-league.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Verify no existing titles test regressed**

Run: `npx vitest run src/lib/__tests__/derive-titles.test.ts`
Expected: PASS (skip this step if that file does not exist)

- [ ] **Step 6: Commit**

```bash
git add src/lib/derive-titles.ts src/lib/__tests__/derive-titles-league.test.ts
git commit -m "fix(titles): exclude team-league finals from career titles"
```

---

## Task 6: Highlight quality weight

`tierWeight` falls through to `TIER_UNKNOWN_WEIGHT = 0.70`, equal to `fip_silver` — a PPL match could win a highlight slot over a genuine circuit match.

**Files:**
- Modify: `src/lib/match-quality.ts`
- Test: `src/lib/__tests__/match-quality-league.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/match-quality-league.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tierWeight } from '../match-quality'

describe('tierWeight team-league', () => {
  it('scores team-league below every circuit tier', () => {
    expect(tierWeight('ppl')).toBeLessThan(tierWeight('fip_bronze'))
    expect(tierWeight('ppl_ii')).toBeLessThan(tierWeight('fip_bronze'))
  })

  it('scores team-league below the unknown-level fallback', () => {
    expect(tierWeight('ppl')).toBeLessThan(tierWeight('some_new_tier'))
  })

  it('leaves circuit weights untouched', () => {
    expect(tierWeight('p1')).toBe(1.00)
    expect(tierWeight('fip_silver')).toBe(0.70)
    expect(tierWeight(null)).toBe(0.70)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/match-quality-league.test.ts`
Expected: FAIL — `tierWeight('ppl')` returns 0.70, not less than 0.65

- [ ] **Step 3: Add explicit weights**

In `src/lib/match-quality.ts`, add to `TIER_WEIGHT_TABLE` after `fip_bronze: 0.65,`:

```ts
  fip_bronze: 0.65,
  // Team leagues score below every circuit tier so they never outrank a
  // real circuit match for a highlight slot. Explicit rather than falling
  // through to TIER_UNKNOWN_WEIGHT (0.70 — equal to fip_silver).
  ppl: 0.30,
  ppl_ii: 0.20,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/match-quality-league.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/match-quality.ts src/lib/__tests__/match-quality-league.test.ts
git commit -m "fix(highlights): score team-league below every circuit tier"
```

---

## Task 7: Earnings regression test

**No production code changes.** `tierFromLevel` already returns `null` for unknown levels via its `default` case, so PPL earns nothing and never reaches the money leaderboard.

This matters more than it looks: the `money_leaderboard` RPC does not join `tournaments`, so it *cannot* filter by level. That single `default: return null` is the only thing protecting the entire money surface. It needs a test so nobody "tidies" the switch into something that falls through.

**Files:**
- Create: `src/lib/earnings/__tests__/tier-from-level.test.ts`

- [ ] **Step 1: Write the test**

Create `src/lib/earnings/__tests__/tier-from-level.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { tierFromLevel } from '../types'

describe('tierFromLevel default-deny', () => {
  it('returns null for team-league levels', () => {
    expect(tierFromLevel('ppl', 'men')).toBeNull()
    expect(tierFromLevel('ppl', 'women')).toBeNull()
    expect(tierFromLevel('ppl_ii', 'men')).toBeNull()
    expect(tierFromLevel('ppl_ii', 'women')).toBeNull()
  })

  it('returns null for unknown and null levels', () => {
    expect(tierFromLevel('some_new_tier', 'men')).toBeNull()
    expect(tierFromLevel(null, 'men')).toBeNull()
  })

  it('still maps every earning circuit tier', () => {
    expect(tierFromLevel('p1', 'men')).toBe('p1')
    expect(tierFromLevel('p2', 'men')).toBe('p2')
    expect(tierFromLevel('major', 'men')).toBe('major_i')
    expect(tierFromLevel('finals', 'men')).toBe('major_i')
    expect(tierFromLevel('fip_bronze', 'men')).toBe('fip_bronze')
    expect(tierFromLevel('fip_silver', 'men')).toBe('fip_silver')
    expect(tierFromLevel('fip_gold', 'men')).toBe('fip_gold')
    expect(tierFromLevel('fip_platinum', 'men')).toBe('fip_platinum')
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/lib/earnings/__tests__/tier-from-level.test.ts`
Expected: PASS, 3 tests — this documents existing behaviour, so it should pass without any source change. If it fails, stop and report: the default-deny is not holding and the money leaderboard is already exposed.

- [ ] **Step 3: Strengthen the comment on the default case**

In `src/lib/earnings/types.ts`, replace the `default` line inside `tierFromLevel`:

```ts
    // Default-deny is load-bearing: money_leaderboard() does not join
    // tournaments and cannot filter by level, so this is the ONLY thing
    // keeping non-earning levels (fip_beyond, fip_promises, fip_other,
    // team leagues, anything new) out of prize money. Pinned by
    // src/lib/earnings/__tests__/tier-from-level.test.ts — do not
    // refactor into a fall-through.
    default: return null
```

- [ ] **Step 4: Re-run the test**

Run: `npx vitest run src/lib/earnings/__tests__/tier-from-level.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/earnings/__tests__/tier-from-level.test.ts src/lib/earnings/types.ts
git commit -m "test(earnings): pin tierFromLevel default-deny

money_leaderboard cannot filter by level, so this default is the only
guard on the money surface."
```

---

## Task 8: Player profile circuit rollup

The Stats tab buckets W-L by circuit via `LEVEL_TO_CIRCUIT`, falling through to `'Other'`. PPL matches would silently pollute that bucket.

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx:1939-1943`

- [ ] **Step 1: Add PPL to the circuit map**

In `src/app/[locale]/player/[id]/page.tsx`, extend `LEVEL_TO_CIRCUIT`:

```ts
  const LEVEL_TO_CIRCUIT: Record<string, string> = {
    p1: 'Premier Padel', p2: 'Premier Padel', major: 'Premier Padel', finals: 'Premier Padel',
    wpt_master: 'World Padel Tour', wpt_1000: 'World Padel Tour', wpt_500: 'World Padel Tour', wpt_final: 'World Padel Tour',
    fip_platinum: 'FIP', fip_gold: 'FIP', fip_other: 'FIP',
    ppl: 'PPL', ppl_ii: 'PPL',
  }
```

- [ ] **Step 2: Add PPL to the display order**

Two lines below, extend `CIRCUIT_ORDER` so PPL renders after the circuits and before `Other`:

```ts
  const CIRCUIT_ORDER = ['Premier Padel', 'World Padel Tour', 'FIP', 'PPL', 'Other']
```

- [ ] **Step 3: Typecheck**

Run: `npm run lint`
Expected: no new errors

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/page.tsx"
git commit -m "feat(ppl): give team-league its own circuit bucket on the Stats tab"
```

---

## Task 9: Schema migration

**Written, not applied.** Applying this to production is a separate, explicitly-approved step — see *Applying* below.

**Files:**
- Create: `supabase/migrations/20260922120000_ppl_league_foundations.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260922120000_ppl_league_foundations.sql`:

```sql
-- 20260922120000_ppl_league_foundations.sql
-- Schema for Pro Padel League coverage.
-- Spec: docs/superpowers/specs/2026-09-22-pro-padel-league-design.md
--
-- Three parts:
--   1. teams.brand_color        — PPL publishes a per-franchise hex
--   2. team_seasons.league      — a franchise runs TWO parallel seasons
--      + team_seasons.season_year  (PPL and PPL II). Real columns rather
--                                   than encoding the division in `label`,
--                                   so queries don't become LIKE '%PPL II%'.
--   3. league_ties              — a two-sided tie. `team_fixtures` is
--      + matches.tie_id            one-sided (opponent as free text), which
--                                  is right for SNP where only one club is
--                                  tracked. In PPL both sides are our own
--                                  teams, so a one-sided model would store
--                                  every tie twice and force score
--                                  reconciliation between the copies.
--
-- No change to `tournaments` is needed: `level` is plain nullable text with
-- no CHECK, so 'ppl' / 'ppl_ii' are already valid values.

-- 1. Franchise branding ------------------------------------------------------

alter table public.teams
  add column if not exists brand_color text;

comment on column public.teams.brand_color is
  'Franchise brand color as a CSS hex (e.g. "#0187d1"), sourced from the league. Null = fall back to the neutral team treatment.';

-- 2. Division and year on a team season --------------------------------------

alter table public.team_seasons
  add column if not exists league      text,
  add column if not exists season_year integer;

comment on column public.team_seasons.league is
  'Competition key within the team''s source (e.g. "ppl", "ppl-ii"). Null for single-competition sources such as SNP.';
comment on column public.team_seasons.season_year is
  'Calendar year of the season, for ordering and filtering without parsing `label`.';

create index if not exists team_seasons_league_year_idx
  on public.team_seasons (league, season_year)
  where league is not null;

-- 3. Two-sided ties ----------------------------------------------------------

create table if not exists public.league_ties (
  id                  uuid primary key default gen_random_uuid(),
  tournament_id       uuid not null references public.tournaments (id) on delete cascade,
  session_number      integer,
  stage               text not null,
  home_team_season_id uuid not null references public.team_seasons (id) on delete cascade,
  away_team_season_id uuid not null references public.team_seasons (id) on delete cascade,
  scheduled_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint league_ties_distinct_sides check (home_team_season_id <> away_team_season_id)
);

comment on table public.league_ties is
  'A team-vs-team confrontation in a franchise league. One tie produces multiple matches (PPL: one men''s + one women''s), linked via matches.tie_id and distinguished by matches.category.';
comment on column public.league_ties.stage is
  'Upstream stage label, e.g. "Group Stage", "Championship", "3rd Place".';
comment on column public.league_ties.session_number is
  'Upstream grouping for same-session matches. Null for knockout ties, which are identified by stage alone.';

-- Partial unique indexes rather than a table constraint: session_number is
-- null for podium ties, and NULL is not equal to itself in a UNIQUE
-- constraint, so a plain UNIQUE would let duplicate podium ties through.
create unique index if not exists league_ties_session_key
  on public.league_ties (tournament_id, session_number, stage)
  where session_number is not null;

create unique index if not exists league_ties_stage_key
  on public.league_ties (tournament_id, stage)
  where session_number is null;

create index if not exists league_ties_tournament_idx
  on public.league_ties (tournament_id);

alter table public.league_ties enable row level security;

drop policy if exists "league_ties are publicly readable" on public.league_ties;
create policy "league_ties are publicly readable"
  on public.league_ties for select
  using (true);

-- 4. Link matches to their tie -----------------------------------------------

alter table public.matches
  add column if not exists tie_id uuid references public.league_ties (id) on delete set null;

comment on column public.matches.tie_id is
  'The league tie this match belongs to. Null for every circuit match — only franchise-league matches are part of a tie.';

create index if not exists matches_tie_id_idx
  on public.matches (tie_id)
  where tie_id is not null;
```

- [ ] **Step 2: Verify the SQL parses**

This project applies migrations with a pg driver and `DATABASE_URL`, **not** `supabase db push` — the migration history has drift.

Check the syntax without executing by wrapping it in a transaction that rolls back. Against a scratch/branch database only, never production:

```bash
psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
  -c 'begin' -f supabase/migrations/20260922120000_ppl_league_foundations.sql -c 'rollback'
```

Expected: no errors. If no scratch database is available, skip this step and note it — Step 3 does not depend on it.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260922120000_ppl_league_foundations.sql
git commit -m "feat(ppl): schema for franchise league ties and divisions

Written, not applied."
```

### Applying

**Do not apply this migration as part of executing this plan.** It changes the production database.

When Gustavo approves applying it:
- Use the pg-driver script with `DATABASE_URL`, not `supabase db push`.
- Every statement is `if not exists` / `or replace`, so it is safe to re-run.
- It is additive only — no column is dropped and no data is rewritten, so there is no data-loss path to roll back from. Reverting means dropping `league_ties`, `matches.tie_id`, `teams.brand_color` and the two `team_seasons` columns.

---

## Task 10: Full-suite verification

- [ ] **Step 1: Run the Next.js test suite**

Run: `npx vitest run`
Expected: PASS. Any failure here is a regression introduced by this plan — report it, do not adjust the failing test.

- [ ] **Step 2: Run the padelgod suite**

Run: `cd padelgod && npm test`
Expected: PASS

- [ ] **Step 3: Typecheck both packages**

Run: `npm run lint && cd padelgod && npm run typecheck`
Expected: no errors

- [ ] **Step 4: Confirm the mirror is still identical**

Run: `diff src/lib/league-levels.ts padelgod/src/lib/league-levels.ts`
Expected: no output

- [ ] **Step 5: Report**

Summarise: tests added, gates closed, and the fact that the migration is written but unapplied.

---

## Discovered during execution (2026-09-22)

**The plan missed a mirror.** `apps/ops` is a separate npm package whose tsconfig resolves `@/*` to its own `./src/*`, so it does not import from the root `src/`. It carries a **byte-identical copy of `src/lib/match-quality.ts`**, which the ops highlight picker consumes via `@/lib/match-quality`.

Task 6 added the PPL tier weights to the root copy only. That left the ops highlight picker still scoring a team-league match at the `fip_silver` fallback — the exact bug Task 6 exists to prevent, surviving in the admin surface.

Fixed in commit `f35f3b2d8`: the mirror was re-synced and an identity test added to `src/lib/__tests__/match-quality-league.test.ts`. The test lives in the root suite deliberately — `apps/ops` has no installed test harness, so an assertion placed there would never run.

**Generalisation for later phases:** before changing anything under `src/lib/`, check for copies:

```bash
find apps padelgod relay -name "<file>.ts" -not -path "*/node_modules/*"
```

Then confirm whether each copy was byte-identical on `origin/main` (a maintained mirror that must be updated) or already divergent (an independent copy that must not be touched).

Two known cases as of this phase:
- `apps/ops/src/lib/match-quality.ts` — **maintained mirror**, now test-enforced
- `apps/ops/src/lib/earnings/types.ts` — **already divergent** on `origin/main` (pre-existing drift; it carries its own `EarningTerminalCode`). Task 7's comment-only change was not propagated. Its `tierFromLevel` still has the same `default: return null`, so the money surface is protected on both sides — but the drift is untested and will widen.

## Deliberately not in this phase

- **`model-prediction-snapshot.ts` and `tournament-projection-snapshot.ts` are not modified.** Their unfiltered training reads are fixed centrally by Task 3. Filtering at the call sites too would be redundant and would leave the backtest harness — which has the same bug — still exposed.
- **`kFactor`'s `return 18` fallback is not changed.** With Task 3 in place, a team-league match never reaches `kFactor`. Changing the fallback would alter behaviour for existing unknown levels, which is out of scope.
- **`prediction-scorer.ts` is not modified.** A PPL match has no `model_predictions` row (gated at `model-prediction-snapshot.ts:293`), so it no-ops. Left alone deliberately — revisit if PPL ever gets predictions.
- **The `TournamentsView` tabs are not modified.** PPL matches neither the Premier nor FIP tab, so it is already invisible there. That is the intended behaviour: PPL is reached through its own section.
- **Player profile `officialMatches` / `allMatches` split (`player/[id]/page.tsx:353`) and the Season tab W-L bars (`SeasonTab.tsx:162-195`).** The spec lists both under *Enforcing the exclusion*, and they are genuinely required — but they are a two-array refactor of the surfaces that render history, so they belong with the UI work in Phase 4. Until PPL data exists there is nothing for them to exclude, and doing the refactor blind of the rows that consume it would be guesswork.

  **Phase 4 must not ship without them.** Everything else in this plan is a gate that holds with no data present; these two only matter once data arrives, which is exactly why they are easy to forget.
