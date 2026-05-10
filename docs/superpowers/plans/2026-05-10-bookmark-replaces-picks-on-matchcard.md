# Bookmark Replaces Picks on MatchCard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace MatchCard's corner prediction element (PICK / YOUR PICK / locked / result badge) with a single universal `<FollowButton variant="star" type="match" />`. Picks UI lives only on the match detail page after this change.

**Architecture:** Two-step refactor of a single file (`src/components/MatchCard.tsx`). Step 1 swaps the JSX (FollowButton in, CornerElement + inline PredictionPanel out) — leaves the prediction state hooks alive but unused so the file still compiles. Step 2 cleans up the orphaned state, callbacks, useEffects, imports, and the now-dead helper functions (CornerElement, LockedPill). The match detail page is untouched — its `PredictionPanel` rendering stays, so existing pick data remains accessible there.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl, FollowButton (existing), useFollowing (existing).

**Spec:** [`docs/superpowers/specs/2026-05-10-bookmark-replaces-picks-on-matchcard-design.md`](../specs/2026-05-10-bookmark-replaces-picks-on-matchcard-design.md)
**Mockup:** [`public/mockup-bookmark-vs-picks.html`](../../../public/mockup-bookmark-vs-picks.html) (mode: **Strict · always star**)

---

## File Map

**Modify (only):**
- `src/components/MatchCard.tsx` — swap corner JSX, then clean up orphaned prediction state/callbacks/helpers.

**No other files touched.** No new files, no test files (repo has no React Testing Library setup; verification is via lint + manual browser smoke). No i18n changes (the `<FollowButton>` already pulls localized labels from `followButton.{bookmarkMatch,removeBookmark}` which exist in all five locales).

---

## Task 1: Replace corner element with FollowButton star

**Files:**
- Modify: `src/components/MatchCard.tsx`

This task swaps the JSX. After it lands the card renders a star instead of the prediction CTA, but several state hooks become unused (lint warnings tolerated until Task 2). The file still compiles and the picks system is gone from the card.

- [ ] **Step 1: Add the FollowButton import**

In `src/components/MatchCard.tsx`, find the existing import block (around lines 23–34). Add a `FollowButton` import alongside the others. The current block ends with:

```typescript
import { shouldShowDayIndicator, formatDayChipLabel } from '@/lib/tournament-day-indicator'
import { countryToTimezone } from '@/lib/country-timezone'
```

After those two lines, insert:

```typescript
import FollowButton from '@/components/FollowButton'
```

- [ ] **Step 2: Insert the FollowButton star inside the card body**

The card body `<div>` has `position: relative` and `overflow: hidden` (around [line 427–439](../../../src/components/MatchCard.tsx#L427)). Inside that div, find the live-glow halo block (around [line 453](../../../src/components/MatchCard.tsx#L453)) which is the second positioned child. Insert the FollowButton just before the live-glow halo so it lives at top-right of every card regardless of state:

Find:

```typescript
        {/* Left gender accent bar — runs the full height of the card */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            bottom: 0,
            width: 3,
            background: genderColor,
          }}
        />

        {/* Live glow halo */}
```

Insert between the gender-accent bar and the live-glow halo:

```typescript
        {/* Bookmark star — universal corner action. FollowButton handles
            preventDefault + stopPropagation internally so taps don't
            navigate the wrapping <Link> to match detail. */}
        <FollowButton
          type="match"
          targetId={match.id}
          variant="star"
          size={20}
          style={{ position: 'absolute', top: 10, right: 12, zIndex: 3 }}
        />

        {/* Live glow halo */}
```

- [ ] **Step 3: Remove the chip-row CornerElement render**

Find the meta-row block where the prediction corner is rendered (around [line 548](../../../src/components/MatchCard.tsx#L548)):

```typescript
          {LATE_HINTS_ENABLED && !isPredictionEnabled && (
            ...
          )}
        </div>

        {isPredictionEnabled && (
          <CornerElement
            match={match}
            prediction={prediction}
            isLive={isLive}
            isFinished={isFinished}
            isOpen={isOpen}
            onToggle={toggleOpen}
            tPred={tPred}
          />
        )}
```

Delete the `{isPredictionEnabled && (<CornerElement … />)}` block entirely (the 9-line conditional). Leave the `</div>` and the `LATE_HINTS_ENABLED` block alone for now — Task 2 loosens that gate.

- [ ] **Step 4: Remove the expandable insights panel block**

Find the prediction-enabled expandable panel (around [line 842–880](../../../src/components/MatchCard.tsx#L842)). It looks like:

```typescript
        {/* Expandable insights panel — only mounted on prediction-enabled
            (Premier-tier) matches. */}
        {isPredictionEnabled && (
          <div
            style={{
              maxHeight: isOpen ? 600 : 0,
              ...
            }}
            onClick={(e) => { e.preventDefault(); e.stopPropagation() }}
          >
            {isOpen && (
              <>
                <PredictionPanel match={match} onLocked={handleLocked} />
              <button
                ...
              >
                <span style={{ fontSize: 11, lineHeight: 1 }}>▴</span>
                {tPred('tapToClose')}
                <span style={{ fontSize: 11, lineHeight: 1 }}>▴</span>
              </button>
            </>
            )}
          </div>
        )}
```

Delete the entire `{isPredictionEnabled && (<div>…</div>)}` block (everything from the comment through the closing `)}`). Leave the surrounding card body content intact.

- [ ] **Step 5: Run lint to confirm compile passes**

Run: `npx eslint src/components/MatchCard.tsx 2>&1 | tail -20`

Expected: pre-existing warnings/errors only (4 errors + 1 warning from prior commits). New unused-variable warnings on `prediction`, `isOpen`, `setIsOpen`, `closeTimer`, `refreshPrediction`, `toggleOpen`, `handleLocked`, `isPredictionEnabled`, `tPred`, `Prediction`, `classifyResult`, `PredictionPanel` are EXPECTED at this point (Task 2 cleans them up).

- [ ] **Step 6: Smoke-check the matches page renders**

If the dev server is running on port 3000, hit:

```bash
curl -sI -m 5 'http://localhost:3000/pt/matches/2026-05-10' | head -1
```

Expected: `HTTP/1.1 200 OK`. A 500 means a runtime error — investigate before committing.

Then check that 5 stars render in the SSR HTML (one per match group, plus several per matches list — should be many):

```bash
curl -s 'http://localhost:3000/pt/matches/2026-05-10' 2>/dev/null | grep -oE 'aria-label="(Bookmark|Remove bookmark|[^"]*ookmark[^"]*)"' | wc -l
```

Expected: a non-zero count (one per match card on the page; ~30+ on a busy day).

If the dev server isn't running, start it via the preview MCP (`preview_start` with name `Next.js (frontend)`) before the smoke test. If port 3000 is held by another dev server, kill it first or skip this step and rely on Task 2's final verification.

- [ ] **Step 7: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(matches): replace corner picks element with bookmark star

Drops <CornerElement /> + the inline expandable PredictionPanel from
MatchCard's render path, replacing the corner with a universal
<FollowButton variant=\"star\" type=\"match\" />. Picks UI is now reachable
only from the match detail page.

State + callbacks for the prediction system stay alive in the file as
unused vars — the next commit prunes them so this commit reads as a
pure JSX swap.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Remove orphaned prediction state, callbacks, imports, and helpers

**Files:**
- Modify: `src/components/MatchCard.tsx`

This task removes the dead code left behind by Task 1's JSX swap. After it lands the file is lint-clean and ~250 lines lighter.

- [ ] **Step 1: Remove prediction-specific imports**

In `src/components/MatchCard.tsx`, find the imports near the top of the file. Delete these three lines:

```typescript
import type { Prediction } from '@/lib/predictions/types'
import { classifyResult } from '@/lib/predictions/scoring'
```

```typescript
import { PredictionPanel } from '@/components/prediction/PredictionPanel'
```

(Two import statements total — the first two on consecutive lines around 27–28, the third around line 31.)

- [ ] **Step 2: Remove the `tPred` translation hook**

In the component body, find:

```typescript
  const tPred = useTranslations('prediction')
```

(Around [line 221](../../../src/components/MatchCard.tsx#L221).) Delete this line.

- [ ] **Step 3: Remove the `isPredictionEnabled` gate**

Find:

```typescript
  // Gate the entire prediction game on tournament tier. Only Premier-tier
  // matches get full point-by-point coverage via padelapi.org's Pusher
  // relay; everything else (FIP Bronze/Silver/Gold/Platinum/etc.) doesn't
  // make sense for live-tracked predictions, so the card stays a plain
  // link to the match detail page.
  const isPredictionEnabled = isPremierLevel(tournamentLevel)
```

(Around [line 232–237](../../../src/components/MatchCard.tsx#L232).) Delete the entire comment block + the `const` line.

- [ ] **Step 4: Check whether `isPremierLevel` is still used**

Run:

```bash
grep -n "isPremierLevel" src/components/MatchCard.tsx
```

Expected after Step 3: only the import line remains (no callers). If so, delete the import:

```typescript
import { isPremierLevel } from '@/lib/tournament-labels'
```

(Around [line 29](../../../src/components/MatchCard.tsx#L29).) If grep shows other callers (unlikely but possible if a future change added one), leave the import.

- [ ] **Step 5: Remove the prediction state, refs, callbacks, and effects**

Find the block that opens with the comment "Hydration-safe prediction read" (around [line 239–289](../../../src/components/MatchCard.tsx#L239)):

```typescript
  // ── Hydration-safe prediction read (unified for all card states) ─────
  // Re-reads localStorage on mount AND every time the panel closes — the
  // PredictionPanel writes via its own useMatchPrediction hook, which has
  // a separate useState, so the corner needs an explicit resync after the
  // user locks in.
  const [prediction, setPredictionLocal] = useState<Prediction | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const closeTimer = useRef<NodeJS.Timeout | null>(null)

  const refreshPrediction = useCallback(() => {
    try {
      const raw = localStorage.getItem('pn_match_predictions')
      if (!raw) { setPredictionLocal(null); return }
      const all = JSON.parse(raw)
      const p = all[match.id]
      if (!p) { setPredictionLocal(null); return }
      if ('multiplier' in p && 'probability' in p) setPredictionLocal(p as Prediction)
      else setPredictionLocal({
        matchId: match.id, pair: p.pair, margin: p.margin,
        probability: 0.5, multiplier: 2.0, isFallback: true,
        createdAt: new Date(0).toISOString(),
      })
    } catch {}
  }, [match.id])

  useEffect(() => { refreshPrediction() }, [refreshPrediction])

  // Resync after the panel closes — covers auto-collapse + manual close +
  // any case where PredictionPanel wrote to storage while we were open.
  useEffect(() => {
    if (!isOpen) refreshPrediction()
  }, [isOpen, refreshPrediction])

  const toggleOpen = useCallback((e?: React.MouseEvent) => {
    // The corner pill is inside the outer <Link>; preventDefault cancels
    // the Link navigation. Without this, tapping the corner would both
    // toggle the panel AND navigate to match detail.
    e?.preventDefault()
    e?.stopPropagation()
    setIsOpen(o => !o)
  }, [])

  const handleLocked = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    // Lock confirmation animation runs ~2.7s. Auto-close shortly after
    // so the card returns to its compact state without user action.
    closeTimer.current = setTimeout(() => setIsOpen(false), 2900)
  }, [])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
```

Delete this entire block (the comment header through the final cleanup useEffect).

- [ ] **Step 6: Loosen the late-hint EST chip gate**

Find the late-hint inline EST chip (around [line 523](../../../src/components/MatchCard.tsx#L523)):

```typescript
          {LATE_HINTS_ENABLED && !isPredictionEnabled && (
```

Replace with:

```typescript
          {LATE_HINTS_ENABLED && (
```

(Drops the `!isPredictionEnabled` condition since picks no longer compete for visual real estate. The EST chip now shows on every tier.)

- [ ] **Step 7: Delete the CornerElement function definition**

Find the section heading and the entire `CornerElement` function (around [line 933–1044](../../../src/components/MatchCard.tsx#L933)):

```typescript
// ── CornerElement — prediction state machine ────────────────────────────

function CornerElement({
  match, prediction, isLive, isFinished, isOpen, onToggle, tPred,
}: {
  ...
}) {
  ...
}
```

Delete from the `// ── CornerElement` header through the function's closing `}` (everything including the section divider comment).

- [ ] **Step 8: Delete the LockedPill function definition**

Find the section heading + the `LockedPill` function (around [line 1046–1097](../../../src/components/MatchCard.tsx#L1046)):

```typescript
// ── LockedPill — grayed-out PICK pill for live matches ──────────────────
//
// Mirrors the active green PICK pill (lightbulb icon + "PICK" label) but
// ...

function LockedPill({ tPred }: { tPred: ReturnType<typeof useTranslations> }) {
  ...
}
```

Delete from the `// ── LockedPill` header through the function's closing `}`.

- [ ] **Step 9: Run lint**

```bash
npx eslint src/components/MatchCard.tsx 2>&1 | tail -10
```

Expected: only the pre-existing 4 errors + 1 warning from before this PR. No new unused-variable warnings (Task 1's leftovers should all be gone now). If new warnings appear, search for the named symbol in the file and either remove it (if dead) or check whether a previous step missed an edit.

- [ ] **Step 10: Run vitest**

```bash
npx vitest run 2>&1 | tail -8
```

Expected: existing test suite passes (729+ tests). No tests reference MatchCard directly (no RTL setup); the cleanup is verified by lint + manual browser smoke.

- [ ] **Step 11: Manual browser verification**

If the dev server is running on port 3000, navigate to `/pt/matches/2026-05-10` and confirm:

1. **Star renders top-right of every match card** regardless of state (scheduled, live, finished, retired, walkover). Grey outline when not bookmarked, gold filled when bookmarked.
2. **Tap the star toggles state** without navigating to match detail.
3. **Tap anywhere else on the card** navigates to match detail as before.
4. **Match detail page** for a Premier-tier match still shows the PredictionPanel.
5. **No `PICK` / `YOUR PICK` / result badges** appear anywhere on the matches list.
6. **Late-hint "EST" chip** now appears on Premier-tier scheduled matches with a `late_hint` value (was previously suppressed).
7. **Browser console** has no new errors (open DevTools, hard refresh).

Capture a screenshot of a matches list with stars visible (some bookmarked, some not) for the PR description.

If the dev server isn't running OR a foreign dev server holds port 3000 and refuses a second instance, fall back to SSR HTML inspection:

```bash
curl -s 'http://localhost:3000/pt/matches/2026-05-10' 2>/dev/null | python3 -c "
import sys, re
html = sys.stdin.read()
print('Star buttons:', len(re.findall(r'aria-label=\"(?:Bookmark|Remove bookmark|[A-Za-z ]*ookmark[^\"]*)\"', html)))
print('PICK pills (should be 0):', len(re.findall(r'>(?:PICK|Pick|Escolhe|YOUR PICK)<', html)))
print('CORRECT/WRONG badges (should be 0):', len(re.findall(r'>(?:CORRECT|WRONG|Correct|Wrong)<', html)))
"
```

Expected: stars > 0, PICK = 0, CORRECT/WRONG = 0.

- [ ] **Step 12: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "refactor(matches): prune orphaned prediction state from MatchCard

Removes the prediction-specific state hooks, callbacks, useEffects,
imports, and the CornerElement + LockedPill helper functions left
unused by the JSX swap in the previous commit. Also loosens the
late-hint chip gate so the EST chip surfaces on Premier-tier
scheduled matches now that picks no longer compete for the slot.

File drops ~250 lines net.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- Spec §3.1 (corner) → Task 1 Step 2 inserts `<FollowButton variant="star" />` at top-right.
- Spec §3.2 (iOS push flow inherited) → no task needed; FollowButton already wires to `useFollowing` → BookmarkToast → tryEnablePushOrShowInstallNudge chain.
- Spec §3.3 (what goes away from card) → Task 1 Steps 3–4 remove the corner switch + inline panel.
- Spec §4.1 "Removed" list (imports, state, callbacks, useEffects, isPredictionEnabled, CornerElement, LockedPill) → Task 2 Steps 1, 2, 3, 5, 7, 8.
- Spec §4.1 "Kept" list (`_matchCardPrev`, `mc-locked-pop`, `mc-score-sweep`, `fipStreamPulse`, `mc-day-tip-pop`) → not touched by any task. ✓
- Spec §4.2 (click semantics) → relies on FollowButton's existing preventDefault/stopPropagation; verified in Step 11 of Task 2 ("tap star ≠ navigate").
- Spec §4.3 (match detail unchanged) → no task touches detail page; cross-checked in Task 2 Step 11.
- Spec §4.4 (backwards compatibility) → naturally preserved (existing localStorage picks readable by detail page; existing follow set drives star fill state).
- Spec §5 edge cases → Task 2 Step 11 manual checklist covers tournament/match-detail reuse, anonymous user, signed-in user, double-tap isolation. The "already-bookmarked tournament gets a new match" case requires no special handling — covered automatically by the per-match bookmark target.
- Spec §6 testing → Task 2 Step 11 lists every test point.
- Spec §7 rollout (single PR) → tasks intentionally split into two commits on the same branch for review legibility. PR contains both commits.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "appropriate error handling". Every step shows the exact text to find and the exact change.

**Type consistency:** No new types or function signatures introduced. All references (`<FollowButton>`, `useFollowing`, props) are pre-existing and verified by reading their source. Task 1's JSX-only change preserves runtime correctness; Task 2's pure-deletion never introduces new identifiers.

**Gap check:** No spec requirement is missing a task. The "future" items in spec §8 (match-detail star, tournamentLevel prop cleanup) are explicitly out of scope and have no task — correct.
