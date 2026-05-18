# Rank-updated Nudge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small green dot on the RANKING bottom-nav tab whenever the latest published ranking week is newer than the user's last visit to `/rankings`. Auto-clears on visit.

**Architecture:** A localStorage-backed hook (mirroring `useFeedLastVisit`) stores the last visited week as a `"YYYY-WW"` string. `BottomNavV3.tsx` polls `player_ranking_snapshots` for the latest week as part of its existing 60-second badge poll, and renders a `.v3-nav-rank-dot` element when the latest week differs from the stored value. The `/rankings` page calls `markRankingsVisited(latestWeek)` on mount to clear the dot.

**Tech Stack:** React, Next.js 16, `useSyncExternalStore`, Supabase JS client, `next-intl`, vitest.

**Spec:** [`docs/superpowers/specs/2026-05-18-rank-updated-nudge-design.md`](../specs/2026-05-18-rank-updated-nudge-design.md)

---

## File Structure

**Created:**
- `src/hooks/useRankingsLastVisit.ts` — localStorage-backed hook returning `string | null`, with `markRankingsVisited(week)` writer. Mirrors `useFeedLastVisit.ts`.

**No unit test** for this file: the project's vitest is configured `environment: 'node'` (see `vitest.config.ts`) and has no `@testing-library/react` dep, so `renderHook` won't work without significant tooling additions. The sibling pattern `useFeedLastVisit.ts` has no unit test either — the project verifies hook behaviour through manual browser checks (covered by Task 5).

**Modified:**
- `src/components/nav/BottomNavV3.tsx` — adds `latestRankingsWeek` state, extends `fetchBadges` with a third Supabase query, derives `showRankingNudge`, renders `.v3-nav-rank-dot` conditionally, adds CSS rule to `NAV_STYLES`.
- `src/app/[locale]/(app)/rankings/page.tsx` — adds one `useEffect` that queries the latest snapshot week and calls `markRankingsVisited` once.
- `src/messages/{en,es,pt,it,fr}.json` — one new `nav.rankUpdated` key per locale.

---

## Task 1: Hook implementation

**Files:**
- Create: `src/hooks/useRankingsLastVisit.ts`

**No test file in this task.** The project's vitest is `environment: 'node'` and there's no `@testing-library/react` dep, so `renderHook` isn't available. The sibling hook `useFeedLastVisit.ts` has no test either — same precedent. Behaviour is verified manually in Task 5.

- [ ] **Step 1: Write the hook**

Create `src/hooks/useRankingsLastVisit.ts` with:

```ts
'use client'
// src/hooks/useRankingsLastVisit.ts
// Tracks the ISO year-week the user last viewed on /rankings.
//
// Storage: localStorage key `rankings_last_visited_week` = "YYYY-WW" string.
// First-time users (no value stored) return null, which makes the
// BottomNav's "latest week !== last visited" comparison true and shows
// the rank-updated dot until they tap RANKING.
//
// Same custom-event sync pattern as useFeedLastVisit — `storage` events
// only fire cross-tab, so a custom `rankings-last-visit-changed` event
// covers same-tab listeners (BottomNav badge reading this hook).

import { useSyncExternalStore } from 'react'

const KEY = 'rankings_last_visited_week'
const EVENT = 'rankings-last-visit-changed'

function getSnapshot(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(KEY)
}

function getServerSnapshot(): null {
  return null
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) callback()
  }
  window.addEventListener(EVENT, callback)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(EVENT, callback)
    window.removeEventListener('storage', onStorage)
  }
}

/**
 * React hook — returns the user's last-visited rankings ISO year-week
 * (e.g. "2026-21"), or null if they've never visited.
 */
export function useRankingsLastVisit(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/**
 * Write the given year-week string as the user's last rankings visit
 * and notify any live listeners in the same tab.
 */
export function markRankingsVisited(week: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(KEY, week)
  window.dispatchEvent(new CustomEvent(EVENT, { detail: week }))
}
```

- [ ] **Step 2: Type-check the new file**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: zero new errors related to `useRankingsLastVisit.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useRankingsLastVisit.ts
git commit -m "feat(hooks): useRankingsLastVisit for rank-updated nudge state"
```

---

## Task 2: Add the `nav.rankUpdated` i18n key in all 5 locales

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

The key lives inside the existing `nav.*` namespace. The existing keys are `home`, `matches`, `following`, `feed`, `tournaments`, `ranking`, `search`. Add `rankUpdated` after `ranking` to keep related keys together.

- [ ] **Step 1: Inspect the current `nav` block in `en.json` to find the exact insertion point**

Run: `python3 -c "import json; m=json.load(open('src/messages/en.json')); print(json.dumps(m['nav'], indent=2, ensure_ascii=False))"`
Expected: prints the current nav block. Note the position of the `"ranking"` key — the new key goes right after it.

- [ ] **Step 2: Add the new key to each locale file**

For each of the 5 files, find the `"ranking": "..."` line inside the `"nav": { ... }` block and insert the appropriate locale's translation right after it. Translations:

| File | Insert after `"ranking": "..."` |
|---|---|
| `src/messages/en.json` | `"rankUpdated": "Rankings updated",` |
| `src/messages/es.json` | `"rankUpdated": "Ranking actualizado",` |
| `src/messages/pt.json` | `"rankUpdated": "Ranking atualizado",` |
| `src/messages/it.json` | `"rankUpdated": "Classifica aggiornata",` |
| `src/messages/fr.json` | `"rankUpdated": "Classement mis à jour",` |

Use the Edit tool — match the existing `"ranking": "..."` line exactly (the value will differ per locale) and replace with the two-line version (existing ranking + new rankUpdated).

- [ ] **Step 3: Validate all 5 files parse as JSON**

Run:
```bash
for f in src/messages/{en,es,pt,it,fr}.json; do
  python3 -c "import json; json.load(open('$f')); print('$f OK')"
done
```
Expected: 5 `OK` lines.

- [ ] **Step 4: Confirm the key landed in all 5**

Run:
```bash
for f in src/messages/{en,es,pt,it,fr}.json; do
  python3 -c "import json; m=json.load(open('$f')); print('$f:', m['nav'].get('rankUpdated', 'MISSING'))"
done
```
Expected: 5 lines, each showing the locale's translation, no `MISSING`.

- [ ] **Step 5: Type-check the project**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: no errors related to message keys. next-intl picks up the new key automatically from the JSON.

- [ ] **Step 6: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(nav): add 'rankUpdated' aria-label for the rank-updated dot"
```

---

## Task 3: BottomNavV3 — probe + dot render + CSS

**Files:**
- Modify: `src/components/nav/BottomNavV3.tsx`

This task adds three things in one commit because they all live in the same file and are conceptually one change ("show the dot"):
1. State + probe for `latestRankingsWeek`
2. Hook read for `lastVisitedWeek` + derived `showRankingNudge`
3. Dot render + CSS rule in `NAV_STYLES`

- [ ] **Step 1: Add the import**

In `src/components/nav/BottomNavV3.tsx`, near line 18 where `useFeedLastVisit` is imported, add the new import:

```ts
import { useRankingsLastVisit } from '@/hooks/useRankingsLastVisit'
```

The result should look like (around lines 17-18):

```ts
import { supabase } from '@/lib/supabase'
import { useFeedLastVisit } from '@/hooks/useFeedLastVisit'
import { useRankingsLastVisit } from '@/hooks/useRankingsLastVisit'
```

- [ ] **Step 2: Add the `latestRankingsWeek` state and hook read**

In the `BottomNavV3()` component body, find the line with `const feedLastVisit = useFeedLastVisit()` (around line 140) and add two lines after it:

```ts
  const feedLastVisit = useFeedLastVisit()
  const lastVisitedRankingsWeek = useRankingsLastVisit()
  const [latestRankingsWeek, setLatestRankingsWeek] = useState<string | null>(null)
```

- [ ] **Step 3: Extend `fetchBadges` with the third Supabase query**

Find the `fetchBadges` function inside the `useEffect` block around lines 282-302. The current shape is:

```ts
    async function fetchBadges() {
      try {
        const [liveRes, newsRes] = await Promise.all([
          supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'live'),
          supabase.from('articles').select('*', { count: 'exact', head: true })
            .eq('status', 'active')
            .gt('published_at', feedLastVisit),
        ])
        if (cancelled) return
        setLiveCount(liveRes.count ?? 0)
        setNewsCount(newsRes.count ?? 0)
      } catch { /* silent */ }
    }
```

Replace it with:

```ts
    async function fetchBadges() {
      try {
        const [liveRes, newsRes, rankingsRes] = await Promise.all([
          supabase.from('matches').select('*', { count: 'exact', head: true }).eq('status', 'live'),
          supabase.from('articles').select('*', { count: 'exact', head: true })
            .eq('status', 'active')
            .gt('published_at', feedLastVisit),
          supabase
            .from('player_ranking_snapshots')
            .select('year, week')
            .eq('source', 'padelgod-fip')
            .order('year', { ascending: false })
            .order('week', { ascending: false })
            .limit(1)
            .maybeSingle(),
        ])
        if (cancelled) return
        setLiveCount(liveRes.count ?? 0)
        setNewsCount(newsRes.count ?? 0)
        const row = rankingsRes.data as { year: number; week: number } | null
        setLatestRankingsWeek(
          row ? `${row.year}-${String(row.week).padStart(2, '0')}` : null,
        )
      } catch { /* silent */ }
    }
```

- [ ] **Step 4: Derive `showRankingNudge` near the active-tab logic**

Find the line `const activeKey = tabKeyFromPath(pathname) ?? 'home'` (around line 144) and add right after it:

```ts
  const activeKey = tabKeyFromPath(pathname) ?? 'home'
  const showRankingNudge =
    latestRankingsWeek !== null && latestRankingsWeek !== lastVisitedRankingsWeek
```

- [ ] **Step 5: Render the dot inside the icon wrapper for the ranking tab**

Find the existing badge conditionals around lines 374-385 (the `liveCount` badge on `scores` and the `newsCount` badge on `home`). Right after the `home` badge conditional, add the ranking dot conditional. The result block should look like:

```tsx
                {/* Live badge on scores */}
                {tab.key === 'scores' && liveCount > 0 && (
                  <div className="v3-nav-badge">{liveCount}</div>
                )}
                {/* Unread-news badge on Home — moved from the Feed tab
                    when Feed was demoted out of the bottom nav. The
                    underlying data flow is unchanged: useFeedLastVisit
                    + a count of articles since that timestamp. The
                    badge clears when the user actually visits /feed
                    (the feed page calls markFeedVisited on mount). */}
                {tab.key === 'home' && newsCount > 0 && (
                  <div className="v3-nav-badge">{newsCount > 9 ? '9+' : newsCount}</div>
                )}
                {/* Rank-updated dot on Ranking — appears when a fresh
                    ranking week has been published since the user's
                    last visit to /rankings. Cleared when the rankings
                    page calls markRankingsVisited on mount. Different
                    visual from the red unread-count badges above
                    (green dot, no number) because the semantic is
                    "something new this week", not a counter. */}
                {tab.key === 'ranking' && showRankingNudge && (
                  <div className="v3-nav-rank-dot" aria-label={t('rankUpdated')} />
                )}
```

- [ ] **Step 6: Add the `.v3-nav-rank-dot` CSS rule to `NAV_STYLES`**

Find the `NAV_STYLES` template literal (around line 458) and add the new rule right after the existing `.v3-nav-badge` block (right before the `@keyframes v3-badge-pop` block). The insertion looks like:

```css
  /* Rank-updated nudge dot — distinct from the red unread-count
     badges: solid green to match the active-tab color, no number,
     no animation. Sits in the icon wrapper's top-right corner with
     a dark-bg ring so it reads against icon strokes and the nav. */
  .v3-nav-rank-dot {
    position: absolute;
    top: 0px;
    right: 1px;
    width: 8px;
    height: 8px;
    background: ${GREEN};
    border-radius: 50%;
    box-shadow: 0 0 0 2px rgba(10,10,10,0.96);
    z-index: 3;
  }
```

The result should be inside the template literal, between the existing badge block and its `@keyframes`. Note that `${GREEN}` is interpolated from the constant at the top of the file — this works because `NAV_STYLES` is a template literal (already uses `${INK_BAR_WIDTH}` and `${LIVE_RED}` the same way).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: zero errors related to `BottomNavV3.tsx` or `useRankingsLastVisit`.

- [ ] **Step 8: Commit**

```bash
git add src/components/nav/BottomNavV3.tsx
git commit -m "feat(nav): green-dot nudge on RANKING tab when fresh week published"
```

---

## Task 4: Rankings page calls `markRankingsVisited` on mount

**Files:**
- Modify: `src/app/[locale]/(app)/rankings/page.tsx`

The rankings page is already a `'use client'` component (line 1) and already does Supabase queries. Add one small effect that runs once on mount to query the latest published week from `player_ranking_snapshots` and mark it as visited.

- [ ] **Step 1: Add the import**

In `src/app/[locale]/(app)/rankings/page.tsx`, near the top of the imports (around line 5), add:

```ts
import { markRankingsVisited } from '@/hooks/useRankingsLastVisit'
```

- [ ] **Step 2: Add the mount effect**

The component body starts somewhere around line 200+ — find the main component (`export default function RankingsPage(...)` or similar). Inside, after the existing `useState`/`useEffect`/`useCallback` declarations and before the data-fetching `useEffect`, add this effect:

```ts
  // Mark the latest published ranking week as visited so the bottom-nav
  // green dot clears. Mirrors the `markFeedVisited()` call on /feed.
  // Queries the snapshot table directly (not derived from the players
  // table) so both this call and the BottomNav probe agree on the
  // year-week format.
  useEffect(() => {
    let cancelled = false
    async function markLatestWeek() {
      const { data } = await supabase
        .from('player_ranking_snapshots')
        .select('year, week')
        .eq('source', 'padelgod-fip')
        .order('year', { ascending: false })
        .order('week', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled) return
      const row = data as { year: number; week: number } | null
      if (row) {
        markRankingsVisited(`${row.year}-${String(row.week).padStart(2, '0')}`)
      }
    }
    void markLatestWeek()
    return () => { cancelled = true }
  }, [])
```

Place it near the other `useEffect`s (around line 267-317, before or after `load(rankType, gender)` runs — exact position doesn't matter since it's an independent side effect).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit 2>&1 | head -10`
Expected: zero new errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/\(app\)/rankings/page.tsx
git commit -m "feat(rankings): mark latest week visited on mount to clear nav dot"
```

---

## Task 5: Manual verification + push + PR

**Files:** none modified — verification + ship only.

- [ ] **Step 1: Run the full project unit tests**

Run: `npx vitest run`
Expected: all tests pass — no regressions from the changes in this branch.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: zero new errors. (Pre-existing Babel warnings on `.worktrees/.next` artifacts are noise and unrelated.)

- [ ] **Step 3: Start the dev server**

Run: `npm run dev`
Wait for "Ready in Xms" then open `http://localhost:3002` in a browser. Test the nudge:

   **Test 3a — fresh user sees the dot:**
   - In DevTools → Application → Local Storage → `http://localhost:3002`, delete the `rankings_last_visited_week` key (if present)
   - Hard refresh the page
   - Expected: within ≤60s (or instantly if you also refresh after the BottomNav probe runs once), a small green dot appears in the top-right corner of the RANKING tab icon
   - Inspect the element — it should be a `<div class="v3-nav-rank-dot">` with `aria-label="Rankings updated"` (or your current locale's translation)

   **Test 3b — dot clears on visit:**
   - With the dot visible, tap the RANKING tab
   - Expected: the page loads; within a moment the dot disappears from the bottom nav
   - In DevTools → Application → Local Storage, confirm `rankings_last_visited_week` is now set to something like `"2026-21"`

   **Test 3c — dot stays cleared on re-open:**
   - Navigate away to another tab (HOME or PARTIDOS)
   - Expected: no dot on RANKING
   - Refresh the page (Cmd-R)
   - Expected: still no dot on RANKING

   **Test 3d — simulate a new week:**
   - In DevTools, set `localStorage.setItem('rankings_last_visited_week', '2026-01')` (an old week)
   - Hard refresh
   - Expected: green dot reappears on RANKING

- [ ] **Step 4: Push the branch**

Run: `git push -u origin feat/rank-updated-nudge`
Expected: branch pushed; GitHub prints a PR creation URL.

- [ ] **Step 5: Open the PR**

Run:

```bash
gh pr create --title "Rank-updated green-dot nudge on RANKING tab" --body "$(cat <<'EOF'
## Summary

- Adds a small green dot (no number, no animation) to the RANKING tab in the bottom nav whenever the latest published ranking week is newer than the user's last visit to `/rankings`.
- Auto-clears when the user opens the rankings page (mirrors how `/feed` clears the unread-news badge on Home).
- Latest-week probe piggybacks on the existing 60s `fetchBadges` poll in `BottomNavV3.tsx` — one extra indexed Supabase query per minute.
- New `useRankingsLastVisit` hook stores the user's last-viewed ISO year-week (`"YYYY-WW"`) in localStorage; mirrors `useFeedLastVisit`'s `useSyncExternalStore` + custom-event pattern for same-tab sync.

## Spec

[`docs/superpowers/specs/2026-05-18-rank-updated-nudge-design.md`](docs/superpowers/specs/2026-05-18-rank-updated-nudge-design.md)

## Test plan

- [x] Project type-check + lint clean (`npx tsc --noEmit && npm run lint`)
- [x] Full vitest suite passes — no regressions (`npx vitest run`)
- [x] Manual: fresh user with no localStorage sees the dot on RANKING
- [x] Manual: tapping RANKING clears the dot and writes `"YYYY-WW"` to localStorage
- [x] Manual: dot stays cleared on subsequent refresh
- [x] Manual: forcing an old `"YYYY-WW"` value in localStorage makes the dot reappear

## Visual

Variant A from the 2026-05-18 brainstorm session: 8 px solid green dot in the top-right corner of the RANKING icon, with a 2px dark-bg ring for contrast. Other variants explored (NUEVO pill, pulse halo, sparkle accent) and rejected — preserved in `.superpowers/brainstorm/.../variants.html` for future reference.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL returned. Share with user.

---

## Self-Review Notes

**Spec coverage check:**

- New hook → Task 1 (no unit test — see file-structure note above for justification)
- i18n keys in 5 locales → Task 2
- BottomNav probe extension → Task 3 (Step 3)
- `showRankingNudge` derived state → Task 3 (Step 4)
- Dot render conditional → Task 3 (Step 5)
- `.v3-nav-rank-dot` CSS → Task 3 (Step 6)
- `markRankingsVisited` call on rankings page → Task 4
- Manual verification + ship → Task 5

All spec requirements have at least one task.

**Type consistency:** `useRankingsLastVisit` returns `string | null` consistently across tasks. `markRankingsVisited(week: string)` signature consistent. `latestRankingsWeek` is `string | null`. `showRankingNudge` is `boolean`. Key name `rankings_last_visited_week` matches between Tasks 1 and 5 (Step 3d). i18n key `nav.rankUpdated` matches between Tasks 2 and 3.

**Placeholder scan:** every step has the actual code/command. No "similar to Task N", no "add appropriate error handling", no "TBD". Even the JSON insertions show the full key + value per locale.

**Scope check:** single focused PR, 7 file touches (2 new + 5 modified), ~80 lines of code total. Appropriate for one plan.
