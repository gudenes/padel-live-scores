# Home Card → Matches Tab, Animated Arrival + Smart Round Default — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tapping "VER PARTIDOS" on a home TORNEOS EN VIVO card lands on the tournament detail page, briefly mounts on Overview, then animates to Matches; the Matches tab opens on the most-advanced round currently being played (not Q1) for every entry point.

**Architecture:** Two tightly-scoped changes — (a) a new pure helper `pickDefaultRound` extracted from the existing inline auto-select logic, with unit tests, then wired back into the page; (b) a URL-driven animation hint (`?tab=matches&intent=matches`) added to the home card and consumed by a single mount effect on the tournament detail page. No new components, no new dependencies, no migrations. Reuses [SlidingInkTabs](src/components/SlidingInkTabs.tsx)'s existing 360ms spring for the visible animation.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, vitest. Helper goes in `src/lib/`, tests in `src/lib/__tests__/`. Same conventions as [pick-default-round equivalents](src/lib/__tests__/) in that directory.

**Source spec:** [docs/superpowers/specs/2026-05-23-home-card-matches-tab-animated-arrival-design.md](docs/superpowers/specs/2026-05-23-home-card-matches-tab-animated-arrival-design.md)

---

## File Structure

**New files:**
- `src/lib/pick-default-round.ts` — pure helper that picks the most-advanced active round given a list of available rounds and projected match candidates
- `src/lib/__tests__/pick-default-round.test.ts` — unit tests covering the 4-tier fallback chain

**Modified files:**
- `src/app/[locale]/(app)/tournaments/[id]/page.tsx`:
  - Initial-tab `useState` (~line 184) — branch on `intent=matches` to start on `'overview'`
  - Add `userChangedTabRef` + wrap `setPageTab` so a user tap during the dwell wins
  - Add a single mount `useEffect` that schedules the auto-commit to `'matches'` after 280ms (or immediately under reduced-motion) and strips `intent` from the URL
  - Round-auto-select effect (~line 456) — project matches into the helper's shape and replace the inline `hasLive ?? hasToday ?? availableRounds[0]` chain with `pickDefaultRound(...)`
- `src/components/home/TournamentSpotlight.tsx:108` — extend the link `href` to `?tab=matches&intent=matches`

---

## Task 1: Extract `pickDefaultRound` pure helper with unit tests

**Files:**
- Create: `src/lib/pick-default-round.ts`
- Create: `src/lib/__tests__/pick-default-round.test.ts`

The helper is intentionally side-effect free and takes already-normalized data. The caller (tournament page) does the projection from raw match rows. This keeps the helper independent of the page's local `normalizeRoundFull` / `localDateKey` definitions and makes the cases trivial to unit-test.

- [ ] **Step 1: Write the failing test file**

Create `src/lib/__tests__/pick-default-round.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickDefaultRound, type PickDefaultRoundMatch } from '../pick-default-round'

const ROUNDS = ['Q1', 'Q2', 'Q3', 'Round of 32', 'Round of 16', 'Quarterfinals', 'Semifinals', 'Finals']

function m(
  round: string,
  status: string,
  scheduledDateKey: string | null = null,
  tournamentId: string | null = 't1',
): PickDefaultRoundMatch {
  return { normalizedRound: round, status, scheduledDateKey, tournamentId }
}

describe('pickDefaultRound', () => {
  it('returns null when there are no available rounds', () => {
    expect(
      pickDefaultRound({
        availableRounds: [],
        matches: [],
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBeNull()
  })

  it('picks the most-advanced round with a live match', () => {
    const matches = [
      m('Q1', 'live'),
      m('Round of 16', 'live'),
      m('Round of 32', 'finished'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Round of 16')
  })

  it('treats on_court the same as live', () => {
    const matches = [m('Quarterfinals', 'on_court')]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Quarterfinals')
  })

  it('falls back to the most-advanced round scheduled today when nothing is live', () => {
    const matches = [
      m('Q3', 'finished', '2026-05-22'),
      m('Round of 32', 'scheduled', '2026-05-23'),
      m('Round of 16', 'scheduled', '2026-05-23'),
      m('Quarterfinals', 'scheduled', '2026-05-24'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Round of 16')
  })

  it('falls back to the most-advanced finished round when nothing is live or today', () => {
    const matches = [
      m('Q1', 'finished', '2026-05-20'),
      m('Q2', 'finished', '2026-05-21'),
      m('Q3', 'finished', '2026-05-21'),
      m('Round of 32', 'scheduled', '2026-05-25'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q3')
  })

  it('live action beats most-advanced finished — late quals while R32 has only finished matches', () => {
    const matches = [
      m('Q3', 'live'),
      m('Round of 32', 'finished'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q3')
  })

  it('live action beats most-advanced scheduled-today — late quals while R16 only has future-today matches', () => {
    const matches = [
      m('Q3', 'live'),
      m('Round of 16', 'scheduled', '2026-05-23'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q3')
  })

  it('falls back to availableRounds[0] when the tournament has no live/today/finished matches', () => {
    const matches = [
      m('Q1', 'scheduled', '2026-05-25'),
      m('Q2', 'scheduled', '2026-05-25'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q1')
  })

  it('filters matches by activeTournamentId when provided', () => {
    const matches = [
      m('Round of 16', 'live', null, 'OTHER'),
      m('Q3', 'live', null, 't1'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q3')
  })

  it('ignores activeTournamentId filter when null (all-tournaments mode)', () => {
    const matches = [
      m('Round of 16', 'live', null, 'OTHER'),
      m('Q3', 'live', null, 't1'),
    ]
    expect(
      pickDefaultRound({
        availableRounds: ROUNDS,
        matches,
        activeTournamentId: null,
        todayKey: '2026-05-23',
      }),
    ).toBe('Round of 16')
  })

  it('ignores rounds not present in availableRounds', () => {
    const matches = [m('Finals', 'live')]
    expect(
      pickDefaultRound({
        availableRounds: ['Q1', 'Q2'],
        matches,
        activeTournamentId: 't1',
        todayKey: '2026-05-23',
      }),
    ).toBe('Q1')
  })
})
```

- [ ] **Step 2: Run the tests, confirm they fail with "Cannot find module"**

Run:
```bash
npx vitest run src/lib/__tests__/pick-default-round.test.ts
```

Expected: every test fails with an import error from `'../pick-default-round'` (file doesn't exist yet).

- [ ] **Step 3: Implement the helper**

Create `src/lib/pick-default-round.ts`:

```ts
export interface PickDefaultRoundMatch {
  /** Round label, already normalized via the caller's normalizeRoundFull. */
  normalizedRound: string
  /** Match status (e.g. 'live', 'on_court', 'finished', 'scheduled'). */
  status: string
  /** YYYY-MM-DD slice of scheduled_at/started_at in the user's local tz, or null. */
  scheduledDateKey: string | null
  /** Tournament id, used when filtering to a single tournament in multi-tournament views. */
  tournamentId: string | null
}

export interface PickDefaultRoundOptions {
  /** Round labels in tournament progression order (Q1 → Final), already normalized. */
  availableRounds: string[]
  matches: PickDefaultRoundMatch[]
  /** When non-null, only matches with matching tournamentId are considered. */
  activeTournamentId: string | null
  /** Today's date key in the user's local timezone (YYYY-MM-DD). */
  todayKey: string
}

const isLive = (m: PickDefaultRoundMatch) =>
  m.status === 'live' || m.status === 'on_court'

const isFinished = (m: PickDefaultRoundMatch) => m.status === 'finished'

/**
 * Picks the default round to surface on the Matches tab.
 *
 * Priority (most → least preferred):
 *   1. Most-advanced round that has a live (or on_court) match
 *   2. Most-advanced round that has a match scheduled today
 *   3. Most-advanced round that has a finished match
 *   4. Fall back to availableRounds[0] (Q1) so a not-yet-started tournament shows its first round
 *
 * "Most-advanced" = the round nearest the end of `availableRounds`. Live wins over
 * more-advanced-but-finished so a fan opening the page sees the action.
 */
export function pickDefaultRound(opts: PickDefaultRoundOptions): string | null {
  const { availableRounds, matches, activeTournamentId, todayKey } = opts
  if (availableRounds.length === 0) return null

  const inScope = (m: PickDefaultRoundMatch) =>
    !activeTournamentId || m.tournamentId === activeTournamentId

  const reverseRounds = [...availableRounds].reverse()
  const findMostAdvanced = (pred: (m: PickDefaultRoundMatch) => boolean) =>
    reverseRounds.find(r =>
      matches.some(m => m.normalizedRound === r && inScope(m) && pred(m)),
    )

  const isToday = (m: PickDefaultRoundMatch) =>
    m.scheduledDateKey === todayKey

  return (
    findMostAdvanced(isLive)
    ?? findMostAdvanced(isToday)
    ?? findMostAdvanced(isFinished)
    ?? availableRounds[0]
    ?? null
  )
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

Run:
```bash
npx vitest run src/lib/__tests__/pick-default-round.test.ts
```

Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/pick-default-round.ts src/lib/__tests__/pick-default-round.test.ts
git commit -m "feat(lib): extract pickDefaultRound helper with tests"
```

---

## Task 2: Wire `pickDefaultRound` into the tournament page's round-select effect

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx:456-483` (the round-auto-select `useEffect`)

This replaces the existing inline `hasLive ?? hasToday ?? availableRounds[0]` chain with the helper. The `paramRound` branch and the "preserve user's prior selection" branch (`prev && availableRounds.includes(prev)`) are unchanged — operator deep-links and in-session user picks continue to win.

- [ ] **Step 1: Read the current effect to confirm the surrounding context**

Read [src/app/[locale]/(app)/tournaments/[id]/page.tsx:456-483](src/app/[locale]/(app)/tournaments/[id]/page.tsx:456). You should see exactly the block shown in the Edit below as `old_string`.

- [ ] **Step 2: Add the import at the top of the file**

Find the existing block of imports from `'@/lib/...'` (search for `from '@/lib/`). Add:

```ts
import { pickDefaultRound, type PickDefaultRoundMatch } from '@/lib/pick-default-round'
```

Place it alphabetically with the other `@/lib/` imports.

- [ ] **Step 3: Replace the round-select effect body**

Edit `src/app/[locale]/(app)/tournaments/[id]/page.tsx`. Find the existing effect:

```tsx
  // ── Auto-select round: prefer live > today > most advanced ──
  useEffect(() => {
    if (availableRounds.length === 0) return
    const todayKey = localDateKey(new Date())
    const hasLive = availableRounds.find(r =>
      allMatches.some(m =>
        m.status === 'live' &&
        normalizeRoundFull(m.round as string) === r &&
        (!activeTournament || (m as any).tournament?.id === activeTournament)
      )
    )
    const hasToday = availableRounds.find(r =>
      allMatches.some(m => {
        if (activeTournament && (m as any).tournament?.id !== activeTournament) return false
        if (normalizeRoundFull(m.round as string) !== r) return false
        const src = (m as any).scheduled_at ?? (m as any).started_at
        return src && src.slice(0, 10) === todayKey
      })
    )
    setSelectedRound(prev => {
      if (paramRound && !prev) {
        const normalized = normalizeRoundFull(paramRound)
        if (availableRounds.includes(normalized)) return normalized
      }
      if (prev && availableRounds.includes(prev)) return prev
      return hasLive ?? hasToday ?? availableRounds[0] ?? null
    })
  }, [availableRounds, activeTournament, paramRound, allMatches])
```

Replace it with:

```tsx
  // ── Auto-select round: live > today > most-advanced-finished > Q1 ──
  useEffect(() => {
    if (availableRounds.length === 0) return
    const todayKey = localDateKey(new Date())
    const candidates: PickDefaultRoundMatch[] = allMatches.map(m => {
      const src = (m as any).scheduled_at ?? (m as any).started_at
      return {
        normalizedRound: normalizeRoundFull(m.round as string),
        status: m.status as string,
        scheduledDateKey: typeof src === 'string' ? src.slice(0, 10) : null,
        tournamentId: (m as any).tournament?.id ?? null,
      }
    })
    const smartDefault = pickDefaultRound({
      availableRounds,
      matches: candidates,
      activeTournamentId: activeTournament ?? null,
      todayKey,
    })
    setSelectedRound(prev => {
      if (paramRound && !prev) {
        const normalized = normalizeRoundFull(paramRound)
        if (availableRounds.includes(normalized)) return normalized
      }
      if (prev && availableRounds.includes(prev)) return prev
      return smartDefault
    })
  }, [availableRounds, activeTournament, paramRound, allMatches])
```

- [ ] **Step 4: Run lint and the helper tests to confirm nothing regressed**

Run:
```bash
npm run lint
npx vitest run src/lib/__tests__/pick-default-round.test.ts
```

Expected: lint passes, all 11 tests still pass.

- [ ] **Step 5: Manual smoke (optional but recommended)**

If a dev server is convenient, start it and open a tournament where R16 has matches today and Q1 only has finished matches — the round strip should auto-select R16 (matches the current screenshot behavior; this confirms we didn't regress the live/today path). Otherwise, defer to Task 4's manual verification at the end.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/\(app\)/tournaments/\[id\]/page.tsx
git commit -m "feat(tournament): smarter default round on Matches tab

Replace the hasLive/hasToday/Q1 fallback chain with pickDefaultRound,
so a Matches tab opened between live windows lands on the most-advanced
round with any progress (live > today > finished > Q1) instead of Q1."
```

---

## Task 3: Add the `intent=matches` flag to the home spotlight card

**Files:**
- Modify: `src/components/home/TournamentSpotlight.tsx:108`

One-line change. Carries the destination tab (so refresh / no-animation still lands on Matches) plus the intent flag (so we know to animate).

- [ ] **Step 1: Read the link to confirm the surrounding props**

Read [src/components/home/TournamentSpotlight.tsx:100-130](src/components/home/TournamentSpotlight.tsx:100). You should see the `<Link>` element with `href={`/tournaments/${tournament.id}`}` and the chunky-button styling.

- [ ] **Step 2: Edit the href**

Edit `src/components/home/TournamentSpotlight.tsx`. Replace:

```tsx
      href={`/tournaments/${tournament.id}`}
```

with:

```tsx
      href={`/tournaments/${tournament.id}?tab=matches&intent=matches`}
```

If there is more than one `<Link>` with the bare `href`, scope the edit to the one inside the "VER PARTIDOS" / `viewEventDetails` block by using more surrounding context in the Edit `old_string`.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```

Expected: passes.

- [ ] **Step 4: Commit**

```bash
git add src/components/home/TournamentSpotlight.tsx
git commit -m "feat(home): VER PARTIDOS card carries intent=matches flag"
```

---

## Task 4: Animated arrival on the tournament detail page

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`:
  - Initial-tab `useState` block (~line 184)
  - Add `userChangedTabRef` + wrapped `setPageTab`
  - Add a mount `useEffect` that schedules the auto-commit and strips `intent` from the URL

The animation is the existing [SlidingInkTabs](src/components/SlidingInkTabs.tsx) 360ms spring; we just trigger it by changing `pageTab` after a 280ms dwell.

- [ ] **Step 1: Read the current initial-tab block to confirm the surrounding context**

Read [src/app/[locale]/(app)/tournaments/[id]/page.tsx:180-220](src/app/[locale]/(app)/tournaments/[id]/page.tsx:180). You're looking for:

```tsx
  const paramTab = searchParams.get('tab')
  const [pageTab, setPageTab] = useState<...>(/* ternary chain reading paramTab */)
```

Note the exact tuple of tab keys used in the `useState` generic — it's `'matches' | 'overview' | 'story' | 'draw'` based on the explore output. If the file has been touched since, use whatever ordering is actually present.

- [ ] **Step 2: Verify `useCallback`, `useRef`, `usePathname`, `useRouter` are already imported**

In the same file, search the import lines at the top for:
- `useCallback`, `useRef` from `'react'`
- `usePathname`, `useRouter` from `'@/i18n/navigation'` (or wherever the file already imports nav from)

If any are missing, add them to the existing import lines. **Do not duplicate import lines** — extend the existing ones. (`useEffect` and `useState` should already be there.)

- [ ] **Step 3: Replace the initial-tab `useState`**

Edit `src/app/[locale]/(app)/tournaments/[id]/page.tsx`. Find:

```tsx
  const paramTab = searchParams.get('tab')
  const [pageTab, setPageTab] = useState<'matches' | 'overview' | 'story' | 'draw'>(
    paramTab === 'draw'
      ? 'draw'
      : paramTab === 'story' || paramTab === 'recap'
      ? 'story'
      : paramTab === 'matches'
      ? 'matches'
      : 'overview'
  )
```

Replace with:

```tsx
  const paramTab = searchParams.get('tab')
  const wantsMatchesAnimation =
    searchParams.get('intent') === 'matches' && paramTab === 'matches'

  const initialPageTab: 'matches' | 'overview' | 'story' | 'draw' =
    wantsMatchesAnimation
      ? 'overview'
      : paramTab === 'draw'
      ? 'draw'
      : paramTab === 'story' || paramTab === 'recap'
      ? 'story'
      : paramTab === 'matches'
      ? 'matches'
      : 'overview'

  const [pageTab, setPageTabState] = useState<'matches' | 'overview' | 'story' | 'draw'>(initialPageTab)

  // Tracks whether the user has manually changed tabs, so the scheduled
  // animated-arrival commit doesn't override a tap that happens during the dwell.
  const userChangedTabRef = useRef(false)
  const setPageTab = useCallback((next: 'matches' | 'overview' | 'story' | 'draw') => {
    userChangedTabRef.current = true
    setPageTabState(next)
  }, [])
```

**Verify:** any callsite in the file that calls `setPageTab(...)` with one of the four valid keys keeps working (the signature is identical from the caller's perspective). The internal `setPageTabState` is only used by the mount effect added in Step 4.

- [ ] **Step 4: Add the animated-arrival mount effect**

In the same file, immediately after the block you just inserted (and after `pageTab` / `setPageTab` are declared), add:

```tsx
  // Animated arrival from home's "VER PARTIDOS": mount on Overview,
  // slide to Matches after a short beat (or commit immediately under reduced-motion).
  // The visible animation is SlidingInkTabs' existing spring on activeKey change.
  const router = useRouter()
  const pathname = usePathname()
  useEffect(() => {
    if (!wantsMatchesAnimation) return

    const commit = () => {
      if (userChangedTabRef.current) return
      setPageTabState('matches')

      // Strip ?intent so refresh/back doesn't replay the animation.
      const params = new URLSearchParams(searchParams.toString())
      params.delete('intent')
      const qs = params.toString()
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false })
    }

    const reduced = typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      commit()
      return
    }

    const t = window.setTimeout(commit, 280)
    return () => window.clearTimeout(t)
    // Intentionally mount-only — animated arrival fires once per navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
```

**Notes:**
- If `router` and `pathname` are already declared elsewhere in the file (search for `const router = ` and `const pathname = `), do not re-declare them — reuse the existing ones and just add the effect.
- The effect is mount-only by design. The eslint disable is intentional and matches the spec.

- [ ] **Step 5: Run lint**

```bash
npm run lint
```

Expected: passes. If you see a "react-hooks/exhaustive-deps" warning on the new effect, confirm the `eslint-disable-next-line` is on the correct line directly above the closing `}, [])`.

- [ ] **Step 6: Run all unit tests to make sure nothing collateral broke**

```bash
npx vitest run
```

Expected: existing suites pass; the new `pick-default-round.test.ts` passes.

- [ ] **Step 7: Manual verification — the golden path**

Start the dev server:
```bash
npm run dev
```

Open `http://localhost:3002/`. From the "TORNEOS EN VIVO" carousel, tap "VER PARTIDOS" on any live tournament card.

Verify:
1. The detail page mounts with **Overview** active (you'll see Overview content for a fraction of a second).
2. After ~280ms, the ink bar slides across to **Partidos** and the Matches content renders.
3. The active round is the most-advanced one with progress (live > today > finished), not Q1.
4. The URL ends with `?tab=matches` and **does not** contain `intent=matches`.
5. Press Back — you return to the home page, not to a transient `?intent` URL.

- [ ] **Step 8: Manual verification — edge cases**

| Check | How | Pass criteria |
|---|---|---|
| Direct deep-link without intent | Navigate to `/tournaments/<id>?tab=matches` directly (paste into address bar or new tab) | Page lands on Matches immediately; no Overview flash, no animation |
| User tap wins during dwell | Tap "VER PARTIDOS"; within ~200ms of landing, tap "Cuadro" (Draw) | Stays on Draw — the auto-animation does not override your tap |
| Reduced motion | In Chrome DevTools → Rendering → "Emulate CSS media feature prefers-reduced-motion: reduce", then tap "VER PARTIDOS" | Page commits to Matches on first effect with no 280ms dwell, no ink-bar travel animation. A single hydration frame of Overview is acceptable. |
| Round selection regression | Open a tournament where R16 has matches today | R16 is selected (the screenshot case still works) |
| Round selection — gap day | Open a tournament whose SF finished yesterday and F is scheduled tomorrow | SF is selected, NOT Q1 |
| Round selection — not started | Open a tournament where all matches are scheduled for tomorrow or later | Q1 is selected (final fallback survives) |
| Round selection — late quals | Open a tournament where Q3 has a live match and R16 has only future-today matches | Q3 is selected (live beats most-advanced-scheduled-today) |
| Manual round preserved | On the Matches tab, tap a different round, navigate to Overview, tap back to Partidos | Same round you picked is still selected |

If any case fails, capture which one before editing — most likely cause is either the projection in Task 2 dropping a field, or a callsite of `setPageTab` that needs to be checked.

- [ ] **Step 9: Commit**

```bash
git add src/app/\[locale\]/\(app\)/tournaments/\[id\]/page.tsx
git commit -m "feat(tournament): animated arrival on Matches tab from home card

When the home VER PARTIDOS card passes intent=matches, mount on
Overview, then slide to Matches after a 280ms dwell using
SlidingInkTabs' existing spring. Strip the intent flag from the URL
after firing so refresh/back doesn't replay. Reduced-motion users
commit to Matches without the dwell."
```

---

## Final review

- [ ] **Step 1: Confirm git history is clean**

Run:
```bash
git log --oneline main..HEAD
```

Expected: four feature commits on top of the spec commits, in this order:
1. `feat(lib): extract pickDefaultRound helper with tests`
2. `feat(tournament): smarter default round on Matches tab`
3. `feat(home): VER PARTIDOS card carries intent=matches flag`
4. `feat(tournament): animated arrival on Matches tab from home card`

- [ ] **Step 2: Report back to the user**

Tell the user the implementation is complete locally and ready for them to test. Mention:
- The dev server may still be running from Task 4
- The four behavioral changes from Task 4 Step 7-8
- That nothing has been pushed; the branch is ready when they greenlight prod
