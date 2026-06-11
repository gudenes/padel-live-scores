# Data-driven live point-by-point detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app's "this match is live with point-by-point" decision data-driven instead of tier-driven, so any FIP-tier match that Crionet actually feeds point-by-point (e.g. FIP Gold Shangay) gets full live treatment.

**Architecture:** Add a `hasLivePointByPoint(sets)` helper that detects real PBP evidence in already-loaded game data (`server_player_id` set, or non-empty `points`), then make `isPresenceOnlyLive` fall back to it: a non-Premier live match is only "presence-only" when no PBP data is present. Wire the match's `sets` through the three call sites, and widen the match-detail Live Feed tab to follow PBP presence rather than raw tier. No DB migration.

**Tech Stack:** TypeScript, React 19, Next.js 16, vitest. Spec: [docs/superpowers/specs/2026-06-11-data-driven-live-pbp-detection-design.md](../specs/2026-06-11-data-driven-live-pbp-detection-design.md).

---

## File Structure

- **Modify** `src/lib/tournament-tier.ts` — add `hasLivePointByPoint`; change `isPresenceOnlyLive` to accept `sets` and use the helper.
- **Modify** `src/lib/__tests__/tournament-tier.test.ts` — add helper tests + new PBP-present cases.
- **Modify** `src/components/MatchCard.tsx` — pass `match.sets` into `statusChip`'s and the body's `isPresenceOnlyLive` calls.
- **Modify** `src/components/home/LiveMatchCard.tsx` — pass `match.sets` into its `isPresenceOnlyLive` call.
- **Modify** `src/app/[locale]/match/[id]/page.tsx` — pass `sets` into the hero `presenceOnly` + deep-link guard; widen Live Feed `showLive` and the live default sub-tab to follow PBP presence.
- **Modify** `src/lib/fetch-matches-day.ts` — declare the `games` shape on `MatchesDaySet` (already selected at runtime) so the data is typed, not opaque.

> Note: `MatchesTournamentGroup.tsx` needs **no** change — it casts `GroupMatch` to `Match` and forwards to `MatchCard`, where the wiring lives.

---

## Task 1: Detection helper + data-driven `isPresenceOnlyLive`

**Files:**
- Modify: `src/lib/tournament-tier.ts`
- Test: `src/lib/__tests__/tournament-tier.test.ts`

- [ ] **Step 1: Add failing tests**

In `src/lib/__tests__/tournament-tier.test.ts`, update the import line and append two new `describe` blocks. Change the import at the top of the file from:

```ts
import { isPremierTier, isLiveStatus, isPresenceOnlyLive } from '../tournament-tier'
```

to:

```ts
import {
  isPremierTier,
  isLiveStatus,
  isPresenceOnlyLive,
  hasLivePointByPoint,
} from '../tournament-tier'
```

Append at the end of the file:

```ts
describe('hasLivePointByPoint', () => {
  it('returns false for null/undefined/empty sets', () => {
    expect(hasLivePointByPoint(null)).toBe(false)
    expect(hasLivePointByPoint(undefined)).toBe(false)
    expect(hasLivePointByPoint([])).toBe(false)
  })

  it('returns false when games carry no server and no points', () => {
    expect(hasLivePointByPoint([
      { games: [{ server_player_id: null, points: [] }] },
    ])).toBe(false)
    expect(hasLivePointByPoint([{ games: null }])).toBe(false)
    expect(hasLivePointByPoint([{}])).toBe(false)
  })

  it('returns true when a game has a server assignment', () => {
    expect(hasLivePointByPoint([
      { games: [{ server_player_id: 'player-uuid', points: [] }] },
    ])).toBe(true)
  })

  it('returns true when a game has a non-empty points array', () => {
    expect(hasLivePointByPoint([
      { games: [{ server_player_id: null, points: ['1', '2'] }] },
    ])).toBe(true)
  })
})

describe('isPresenceOnlyLive with live PBP data', () => {
  it('returns false for a non-Premier live match once PBP data is present', () => {
    expect(isPresenceOnlyLive(
      {
        status: 'live',
        sets: [{ games: [{ server_player_id: 'p1-uuid', points: [] }] }],
      },
      { level: 'fip_gold' },
    )).toBe(false)
  })

  it('stays presence-only for a non-Premier live match with no PBP data yet', () => {
    expect(isPresenceOnlyLive(
      { status: 'live', sets: [{ games: [{ server_player_id: null, points: [] }] }] },
      { level: 'fip_gold' },
    )).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/tournament-tier.test.ts`
Expected: FAIL — `hasLivePointByPoint` is not exported; the new `isPresenceOnlyLive` cases fail because the current signature ignores `sets`.

- [ ] **Step 3: Implement the helper and rewrite `isPresenceOnlyLive`**

In `src/lib/tournament-tier.ts`, replace the existing `isPresenceOnlyLive` function (the block from the `// True when the match is flagged live...` comment through its closing brace) with:

```ts
// Minimal structural shape of the loaded set→game data we inspect for
// point-by-point evidence. Compatible with both the full `Match['sets']`
// type and the daily-page `MatchesDaySet[]` shape.
type SetWithGames = {
  games?: ReadonlyArray<{
    server_player_id?: string | null
    points?: readonly unknown[] | null
  }> | null
}

// True when any loaded game carries point-by-point evidence — a server
// assignment or a non-empty points array. Both fields are only ever
// populated by padelgod's Crionet live-poller, so their presence means
// real PBP is flowing for this match, regardless of tournament tier.
export function hasLivePointByPoint(
  sets: ReadonlyArray<SetWithGames> | null | undefined,
): boolean {
  if (!sets) return false
  return sets.some((s) =>
    s.games?.some(
      (g) => g.server_player_id != null || (g.points?.length ?? 0) > 0,
    ) ?? false,
  )
}

// True when the match is flagged live in the DB but we have no point-by-point
// data to render. Premier Padel + fip_platinum get PBP via Crionet and are
// never presence-only. For any other tier the decision is data-driven: as soon
// as real PBP data lands (hasLivePointByPoint), the match graduates to the full
// live treatment. Treat unknown tiers (null level) as presence-only until PBP
// data proves otherwise — the calmer default is correct when we don't know.
export function isPresenceOnlyLive(
  match: { status: string; sets?: ReadonlyArray<SetWithGames> | null },
  tournament: { level: string | null },
): boolean {
  if (!isLiveStatus(match.status)) return false
  if (isPremierLevel(tournament.level)) return false
  return !hasLivePointByPoint(match.sets)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/tournament-tier.test.ts`
Expected: PASS — all prior cases (no-`sets` calls default to presence-only via the `hasLivePointByPoint(undefined) === false` path) plus the new cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournament-tier.ts src/lib/__tests__/tournament-tier.test.ts
git commit -m "feat(live): data-driven hasLivePointByPoint + presence-only detection"
```

---

## Task 2: Wire `MatchCard` to pass `sets`

**Files:**
- Modify: `src/components/MatchCard.tsx`

`statusChip(match, tournamentLevel)` and the component body both call `isPresenceOnlyLive` with only `{ status }`. The `match` object is the full `Match` type, which carries `sets?: Set[]` (each `Set` has `games?: Game[]` with `server_player_id` + `points`). Pass it through.

- [ ] **Step 1: Pass `sets` in `statusChip`**

In `src/components/MatchCard.tsx`, find (around line 114):

```ts
  if (isPresenceOnlyLive({ status }, { level: tournamentLevel ?? null })) {
```

Replace with:

```ts
  if (isPresenceOnlyLive({ status, sets: match.sets }, { level: tournamentLevel ?? null })) {
```

- [ ] **Step 2: Pass `sets` in the component body**

In the same file, find (around line 308):

```ts
  const presenceOnlyLive = isPresenceOnlyLive(
    { status: match.status as string },
    { level: tournamentLevel ?? null },
  )
```

Replace with:

```ts
  const presenceOnlyLive = isPresenceOnlyLive(
    { status: match.status as string, sets: match.sets },
    { level: tournamentLevel ?? null },
  )
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "MatchCard" || echo "no MatchCard type errors"`
Expected: `no MatchCard type errors` (the `Match['sets']` type is structurally compatible with `ReadonlyArray<SetWithGames>`).

- [ ] **Step 4: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(live): MatchCard uses PBP data for presence-only detection"
```

---

## Task 3: Wire `home/LiveMatchCard` to pass `sets`

**Files:**
- Modify: `src/components/home/LiveMatchCard.tsx`

The home query selects `sets(*, games(*))`, so `match.sets` carries `games` with `server_player_id`/`points` at runtime.

- [ ] **Step 1: Pass `sets`**

In `src/components/home/LiveMatchCard.tsx`, find (around line 66):

```ts
  const presenceOnly = isPresenceOnlyLive(
    { status: match.status as string },
    { level: (match as any).tournament?.level ?? null },
  )
```

Replace with:

```ts
  const presenceOnly = isPresenceOnlyLive(
    { status: match.status as string, sets: (match as any).sets ?? null },
    { level: (match as any).tournament?.level ?? null },
  )
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "LiveMatchCard" || echo "no LiveMatchCard type errors"`
Expected: `no LiveMatchCard type errors`.

- [ ] **Step 3: Commit**

```bash
git add src/components/home/LiveMatchCard.tsx
git commit -m "feat(live): home LiveMatchCard uses PBP data for presence-only detection"
```

---

## Task 4: Wire match-detail page (hero, deep-link guard, Live Feed tab, default sub-tab)

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

This page loads the full `sets(*, games(*))`. Four spots need to become PBP-aware. Import `hasLivePointByPoint` alongside the existing `isPresenceOnlyLive` import.

- [ ] **Step 1: Extend the import**

Find (around line 26):

```ts
import { isPresenceOnlyLive } from '@/lib/tournament-tier'
```

Replace with:

```ts
import { isPresenceOnlyLive, hasLivePointByPoint } from '@/lib/tournament-tier'
```

- [ ] **Step 2: Hero `presenceOnly` — pass `sets`**

Find (around line 485):

```ts
  const presenceOnly = isPresenceOnlyLive(
    { status: match.status as string },
    { level: (match as any).tournament?.level ?? null },
  )
```

Replace with:

```ts
  const presenceOnly = isPresenceOnlyLive(
    { status: match.status as string, sets: (match as any).sets ?? null },
    { level: (match as any).tournament?.level ?? null },
  )
```

- [ ] **Step 3: Deep-link guard effect — pass `sets`**

Find (around line 257):

```ts
    const presenceOnlyHere = isPresenceOnlyLive(
      { status: match.status as string },
      { level: (match as any)?.tournament?.level ?? null },
    )
```

Replace with:

```ts
    const presenceOnlyHere = isPresenceOnlyLive(
      { status: match.status as string, sets: (match as any)?.sets ?? null },
      { level: (match as any)?.tournament?.level ?? null },
    )
```

- [ ] **Step 4: Live default sub-tab — follow presence-only, not raw tier**

Find the effect (around lines 245-250):

```ts
    const tournamentLevel = (match as any)?.tournament?.level as string | null | undefined
    const isPremier = isPremierLevel(tournamentLevel)
    if (match?.status === 'finished') setSubTab(isPremier ? 'recap' : 'players')
    else if (match?.status === 'scheduled') setSubTab('players')
    else if (match && !isPremier) setSubTab('players') // live + non-Premier
```

Replace with:

```ts
    const tournamentLevel = (match as any)?.tournament?.level as string | null | undefined
    const isPremier = isPremierLevel(tournamentLevel)
    const presenceOnlyDefault = isPresenceOnlyLive(
      { status: (match?.status as string) ?? '', sets: (match as any)?.sets ?? null },
      { level: tournamentLevel ?? null },
    )
    if (match?.status === 'finished') setSubTab(isPremier ? 'recap' : 'players')
    else if (match?.status === 'scheduled') setSubTab('players')
    else if (match && presenceOnlyDefault) setSubTab('players') // live, no PBP
```

- [ ] **Step 5: Live Feed tab visibility — show when PBP present or Premier**

Find (around line 1138):

```ts
        const showLive = isPremier && !presenceOnly
```

Replace with:

```ts
        // Live Feed (point-by-point) shows for Premier events and for any
        // match where real PBP data is present (e.g. a FIP event Crionet
        // actually feeds). Stays hidden for live FIP rows with no points.
        const showLive = isPremier || hasLivePointByPoint((match as any).sets ?? null)
```

- [ ] **Step 6: Verify types compile**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "match/\[id\]/page" || echo "no match-page type errors"`
Expected: `no match-page type errors`.

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/match/[id]/page.tsx"
git commit -m "feat(live): match detail surfaces Live Feed + full live state on PBP presence"
```

---

## Task 5: Type the `games` shape on `MatchesDaySet`

**Files:**
- Modify: `src/lib/fetch-matches-day.ts`

The query already selects `games(id, game_number, game_score, points, is_current, server_player_id)`, but the `MatchesDaySet` interface omits `games`, so the data arrives untyped. Declare it. This keeps the daily-page data structurally aligned with `SetWithGames` and avoids `as any` if a future consumer reads it directly.

- [ ] **Step 1: Add the `games` field to `MatchesDaySet`**

Find (around lines 34-41):

```ts
export interface MatchesDaySet {
  id: string
  set_number: number | null
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  is_current: boolean | null
}
```

Replace with:

```ts
export interface MatchesDayGame {
  id: string
  game_number: number | null
  game_score: string | null
  points: string[] | null
  is_current: boolean | null
  server_player_id: string | null
}

export interface MatchesDaySet {
  id: string
  set_number: number | null
  set_score: string | null
  pair1_games: number | null
  pair2_games: number | null
  is_current: boolean | null
  games: MatchesDayGame[] | null
}
```

- [ ] **Step 2: Verify the project type-checks**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | tail -20`
Expected: no new errors introduced by this change (pre-existing unrelated errors, if any, are out of scope — confirm none mention `fetch-matches-day`, `tournament-tier`, `MatchCard`, `LiveMatchCard`, or `match/[id]/page`).

- [ ] **Step 3: Commit**

```bash
git add src/lib/fetch-matches-day.ts
git commit -m "chore(types): declare games shape on MatchesDaySet"
```

---

## Task 6: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the unit suite for the changed lib**

Run: `npx vitest run src/lib/__tests__/tournament-tier.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 2: Lint the changed files**

Run: `npm run lint 2>&1 | tail -20`
Expected: no new lint errors in the touched files.

- [ ] **Step 3: Production build sanity (optional but recommended)**

Run: `npm run build 2>&1 | tail -25`
Expected: build completes; no type errors in the touched files.

- [ ] **Step 4: Manual verification in the running app**

Per the repo's "test locally" rule, verify in the dev server. With `npm run dev` (localhost:3002), open a live FIP-tier match that is currently receiving Crionet point-by-point (e.g. the FIP Gold Shangay match while live). Confirm:
- The status pill renders red **LIVE** (not amber ON COURT).
- The presence-only info hint is **not** shown.
- The serve indicator + live score render as for a Premier match.
- On the match-detail page, the **Live Feed** tab is present; **Score Recap/Stats** behaves as before (Premier-only).

If no such live match is available at implementation time, verify the inverse instead: a live FIP match with **no** point data still shows the calm ON COURT + presence-only hint, and the unit tests cover the PBP-present flip.

---

## Self-Review Notes

- **Spec coverage:** helper (Task 1), `isPresenceOnlyLive` change (Task 1), four call sites — MatchCard ×2 (Task 2), LiveMatchCard (Task 3), match page hero + guard (Task 4); status pill + hint follow automatically; Live Feed tab + default sub-tab (Task 4); Score Recap left Premier-gated (untouched); type cleanup (Task 5); tests (Task 1); manual verify (Task 6). All spec sections mapped.
- **`MatchesTournamentGroup`:** intentionally not modified — it forwards a `Match`-cast object to `MatchCard`, where Task 2's wiring applies. (Spec listed it as a surface; the wiring is centralized in MatchCard.)
- **Type consistency:** helper named `hasLivePointByPoint` everywhere; `isPresenceOnlyLive` signature `(match: { status; sets? }, tournament: { level })` used identically at all call sites; `SetWithGames` structural type accepts `Match['sets']`, `MatchesDaySet[]`, and inline test literals.
