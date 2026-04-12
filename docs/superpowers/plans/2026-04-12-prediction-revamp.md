# Prediction Revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 3-step prediction wizard with a single-screen tap-to-predict experience featuring branded SVG icons, inline animations, a simulated community poll, prediction badges on match cards, and post-match result tracking.

**Architecture:** Rewrite PredictionSection as a state-driven component (empty → picked → confirmed → locked). Add crystalBall SVG icon. Add PREDICTED badge to match cards. Add PredictionResult card for finished matches. All client-side, localStorage-only — no backend changes.

**Tech Stack:** React 19, TypeScript, CSS transitions/keyframes, inline styles (matching existing app pattern), BadgeIcon SVG system.

**Spec:** `docs/superpowers/specs/2026-04-12-prediction-revamp-design.md`

---

## File Structure

```
src/components/BadgeIcon.tsx               # Add crystalBall icon path
src/app/match/[id]/page.tsx                # Rewrite PredictionSection + add PredictionResult
src/app/(app)/matches/page.tsx             # Add PREDICTED badge to V3MatchRow
src/app/(app)/tournaments/[id]/page.tsx    # Add PREDICTED badge to V3ScheduledCard
```

---

### Task 1: Add Crystal Ball Icon to BadgeIcon

**Files:**
- Modify: `src/components/BadgeIcon.tsx`

- [ ] **Step 1: Add crystalBall to ICON_PATHS**

In `src/components/BadgeIcon.tsx`, add the `crystalBall` entry to the `ICON_PATHS` record (after the existing `bolt` entry around line 90):

```typescript
crystalBall: (c, s) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="10" r="8"/>
    <path d="M8 18h8"/>
    <path d="M7 21h10"/>
    <path d="M9 14c0-1.5 1-3 3-3s3 1.5 3 3"/>
  </svg>
),
```

- [ ] **Step 2: Commit**

```bash
git add src/components/BadgeIcon.tsx
git commit -m "feat(predictions): add crystalBall SVG icon to BadgeIcon"
```

---

### Task 2: Rewrite PredictionSection + Add PredictionResult

**Files:**
- Modify: `src/app/match/[id]/page.tsx`

This is the main task. Replace the existing `PredictionSection` component (lines ~982-1070) with the new single-screen experience, and add a `PredictionResult` component for finished matches.

The implementing agent should:

1. Read the spec's "Interaction Flow" section carefully for all 4 states (empty, picked, confirmed, locked)
2. Read the spec's "Post-Match Result" section for the 3 result variants
3. Read the spec's "Animations Summary" for all transition timings
4. Read the spec's "Brand Alignment" section for exact colours, shapes, and copy

**Key implementation details:**

#### PredictionSection rewrite

Replace the existing `PredictionSection` function with a new one that handles 4 states internally:

**Props remain the same** — the parent already passes `match`, `pair1Label`, `pair2Label`, `prediction`, `predStep`, `setPredStep`, `setPrediction`, `clearPrediction`.

**Internal state:** Only `selectedPair` (1 | 2 | null) — the `predStep` from parent drives the view.

**State rendering:**

- `predStep === 'pick'` → Show two pair cards side by side + comparison strip
- `predStep === 'margin'` → Selected card highlighted, other dimmed, margin buttons below
- `predStep === 'done'` → Confirmed prediction card + simulated community poll
- Match is live (checked via parent) → Locked card (already handled by parent, but the locked state in the `isLive && prediction` block should use the `lock` SVG icon instead of emoji)

**Community poll simulation function** (place inside the component or as a module-level helper):

```typescript
function simulatePoll(matchId: string): { pair1Pct: number; totalVotes: number } {
  let hash = 0
  for (let i = 0; i < matchId.length; i++) {
    hash = ((hash << 5) - hash) + matchId.charCodeAt(i)
    hash |= 0
  }
  const pair1Pct = 45 + (Math.abs(hash) % 25)
  const totalVotes = 20 + (Math.abs(hash >> 8) % 80)
  return { pair1Pct, totalVotes }
}
```

**SVG icon rendering** — use the ICON_PATHS from BadgeIcon directly. Import the paths or inline the specific SVGs needed:
- `trophy` for "Who takes it?" heading
- `checkmark` for confirmed prediction
- `lock` for locked state (replace emoji in the live prediction block)

Since BadgeIcon's ICON_PATHS aren't exported, the simplest approach is to inline the specific SVG paths needed (they're small — just copy the JSX from BadgeIcon.tsx for the 3-4 icons used).

**Comparison strip** — uses existing player data on the match object:
- Win Rate: `match.pair1_player1?.win_rate` vs `match.pair2_player1?.win_rate`
- Rankings: `match.pair1_player1?.ranking` vs `match.pair2_player1?.ranking`
- Recent form: Use `total_matches` as a proxy (or just show ranking for MVP)

**Chunky shapes** — use the existing `CHUNKY` constant already defined at line 45 in the file.

**Pair colours** — use the existing `PAIR1_COLOR` (#FF6B2B), `PAIR2_COLOR` (#FFD166), `PAIR1_BG`, `PAIR2_BG`, `PAIR1_BORDER`, `PAIR2_BORDER` already defined at lines 37-42.

**European copy** — exact strings from spec:
- "Who takes it?" / "Tap the pair you fancy" / "How does it end?" / "Straight sets" / "Three-set battle" / "Your prediction" / "What others think"

**Animations** — all via CSS `transition` property on the elements:
- Selected card: `transition: transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1), border-color 300ms ease, box-shadow 300ms ease`
- Dimmed card: `transition: opacity 200ms ease-out`
- Poll bar: `transition: width 700ms cubic-bezier(0.25, 0.1, 0.25, 1) 500ms` (500ms delay)
- All wrapped in `@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }` — or check in JS with `window.matchMedia('(prefers-reduced-motion: reduce)').matches`

#### PredictionResult component

Add a new function `PredictionResult` below `PredictionSection`. It shows after a finished match when the user had a prediction.

**Props:** `match: Match`, `prediction: Prediction`, `pair1Label: string`, `pair2Label: string`

**Logic:**
- Determine actual result from `match.winner_pair` and set count
- Compare against `prediction.pair` and `prediction.margin`
- Three variants: correct (pair + margin), close (right pair, wrong margin), wrong (wrong pair)

**Rendering location:** Add it in the parent where `isFinished` is checked, right after the match rating section. Only show if `prediction` exists.

#### Update live locked prediction block

The existing `isLive && prediction` block (around line 810) currently uses emoji 🔒. Replace with the `lock` SVG icon inline, and update the text to use European tone.

- [ ] **Step 1: Read the current PredictionSection** (lines 982-1070) and the live prediction block (lines 805-820) to understand what to replace.

- [ ] **Step 2: Rewrite PredictionSection** with the new 4-state single-screen component following the spec's interaction flow, brand colours, chunky shapes, and European copy. Include the `simulatePoll` function, inline SVG icons, comparison strip, and all CSS transitions.

- [ ] **Step 3: Add PredictionResult** component below PredictionSection. Implement all 3 result variants (correct, close, wrong) with branded icons and European copy.

- [ ] **Step 4: Update the live locked block** (around line 805-820) to use `lock` SVG icon instead of 🔒 emoji.

- [ ] **Step 5: Wire PredictionResult** into the parent render. After the `isFinished && MatchRatingCard` block, add:
```tsx
{isFinished && prediction && (
  <PredictionResult match={match} prediction={prediction} pair1Label={pair1Label} pair2Label={pair2Label} />
)}
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "match/\[id\]"`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/app/match/\[id\]/page.tsx
git commit -m "feat(predictions): rewrite PredictionSection + add PredictionResult

Single-screen tap-to-predict with branded SVG icons, chunky shapes,
simulated community poll, inline margin selector, and post-match
result tracking. European copy throughout."
```

---

### Task 3: Add PREDICTED Badge to Match Cards

**Files:**
- Modify: `src/app/(app)/matches/page.tsx`
- Modify: `src/app/(app)/tournaments/[id]/page.tsx`

Add a small "PREDICTED" badge to match cards where the user has a prediction stored in localStorage.

#### Matches page (`V3MatchRow`)

- [ ] **Step 1: Add prediction check**

At the top of `V3MatchRow` component (around line 142), add a check for whether this match has a prediction:

```typescript
const hasPrediction = (() => {
  try {
    const raw = localStorage.getItem('pn_match_predictions')
    if (!raw) return false
    const all = JSON.parse(raw)
    return !!all[match.id]
  } catch { return false }
})()
```

Note: This needs to be hydration-safe. Wrap in a `useState` + `useEffect` pattern like `useHiddenFeedItems`:

```typescript
const [hasPrediction, setHasPrediction] = useState(false)
useEffect(() => {
  try {
    const raw = localStorage.getItem('pn_match_predictions')
    if (raw) {
      const all = JSON.parse(raw)
      setHasPrediction(!!all[match.id])
    }
  } catch {}
}, [match.id])
```

- [ ] **Step 2: Render the badge**

In the header row of V3MatchRow, after the status badges (LIVE/FINAL) and before the closing `</div>` of the right-side flex container, add:

```tsx
{hasPrediction && !isLive && !isFinished && (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 3,
    background: 'rgba(126,211,33,0.06)',
    padding: '2px 8px',
    clipPath: CHUNKY.badge,
    border: '0.5px solid rgba(126,211,33,0.15)',
  }}>
    <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="10" r="8"/><path d="M8 18h8"/><path d="M7 21h10"/>
    </svg>
    <span style={{ fontSize: 7, fontWeight: 700, color: '#7ED321', letterSpacing: 0.3 }}>PREDICTED</span>
  </div>
)}
```

- [ ] **Step 3: Commit matches page**

```bash
git add src/app/\(app\)/matches/page.tsx
git commit -m "feat(predictions): add PREDICTED badge to match cards"
```

#### Tournament detail page (`V3ScheduledCard`)

- [ ] **Step 4: Add same prediction check + badge to V3ScheduledCard**

Same pattern as above — add `hasPrediction` state with useEffect, render the badge in the header row.

The `V3ScheduledCard` currently doesn't have a header row badge area. Add the badge after the round + court badges:

```tsx
{hasPrediction && (
  <div style={{
    display: 'flex', alignItems: 'center', gap: 3,
    background: 'rgba(126,211,33,0.06)',
    padding: '2px 8px',
    clipPath: CHUNKY.badge,
    border: '0.5px solid rgba(126,211,33,0.15)',
    marginLeft: 'auto',
  }}>
    <svg width={8} height={8} viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="10" r="8"/><path d="M8 18h8"/><path d="M7 21h10"/>
    </svg>
    <span style={{ fontSize: 7, fontWeight: 700, color: '#7ED321', letterSpacing: 0.3 }}>PREDICTED</span>
  </div>
)}
```

- [ ] **Step 5: Commit tournament page**

```bash
git add src/app/\(app\)/tournaments/\[id\]/page.tsx
git commit -m "feat(predictions): add PREDICTED badge to tournament match cards"
```

---

### Task 4: Smoke Test + Polish

- [ ] **Step 1: Run dev server and test**

Run: `npm run dev`
Navigate to: a scheduled match with PBP coverage

Verify:
1. "Who takes it?" heading with trophy-style display
2. Two pair cards with pair colours (orange/yellow), chunky shapes
3. Comparison strip shows win rate / ranking data
4. Tapping a pair card highlights it, dims the other, shows margin selector
5. Tapping 2-0 or 2-1 confirms prediction, shows community poll
6. Poll bar animates from 0 to final width
7. "Change" button resets to pick state
8. On matches page: PREDICTED badge appears on the match card
9. Navigate to a finished match with a prediction → result card shows
10. Navigate to a live match with a prediction → locked card shows with lock icon

- [ ] **Step 2: Fix any issues found**

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "fix(predictions): smoke test polish"
```
