# Tournament Carousel — Add Upcoming Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the home page's `LiveTournamentsCarousel` from "running today" to "running today + starting in the next 7 days," capped at 10 cards, with a new status line for not-yet-started cards (relative countdown: "Starts in 3 days" / "Starts tomorrow" / "Starts today").

**Architecture:** Three layers of change behind one design rule. (1) A pure helper module gets two new functions — `daysUntilStart` and `hasStarted` — with unit-test coverage for boundary cases including DST. (2) The home page widens its Supabase query window and slices the post-sort list to 10. (3) The carousel card branches its status line on `hasStarted`, gating the LIVE chip on the same predicate. Sort comparator and DB schema are unchanged. Premier-first ordering already falls out of the existing `levelTierWeight` map.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Vitest, next-intl (5 locales), Supabase JS client. Pure-function helpers in `src/lib`, tests via Vitest under `src/lib/__tests__`.

**Spec:** [docs/superpowers/specs/2026-05-26-tournament-carousel-upcoming-design.md](../specs/2026-05-26-tournament-carousel-upcoming-design.md)

---

## File Structure

**Modified files:**
- `src/lib/live-tournaments-carousel.ts` — append two pure helpers (`daysUntilStart`, `hasStarted`). The existing `compareTournamentsForCarousel`, `buildMatchInfoMap`, `getLocalDayBoundaryUTC` stay byte-identical.
- `src/lib/__tests__/live-tournaments-carousel.test.ts` — append two new `describe` blocks (`daysUntilStart`, `hasStarted`) and one new `compareTournamentsForCarousel` case proving Premier-future outranks FIP-today across the widened window.
- `src/components/home/LiveTournamentsCarousel.tsx` — replace the `statusLine` and LIVE-chip conditional inside `TournamentCarouselCard`. No prop/type changes.
- `src/app/[locale]/(app)/home/page.tsx` — widen `starts_at` filter in the carousel-live-today fetch (lines ~311–319), bump raw `.limit(20)` to `.limit(40)`, slice the sorted result to 10 before `setCarouselLiveToday`.
- `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json` — add three new keys under `home.liveTournaments` (`startsToday`, `startsTomorrow`, `startsInDays`) with `_context` siblings on `startsInDays`. Remove four orphan keys + their contexts from the same block (`chipLiveToday`, `chipUpcoming`, `startsOn`) — all unused per grep.

**No new files. No DB migration. No env vars. No padelgod changes.**

---

## Task 1: Add `hasStarted` helper with tests

**Files:**
- Modify: `src/lib/live-tournaments-carousel.ts`
- Modify: `src/lib/__tests__/live-tournaments-carousel.test.ts`

- [ ] **Step 1: Write the failing tests**

Append at the **end** of `src/lib/__tests__/live-tournaments-carousel.test.ts` (after the existing `getLocalDayBoundaryUTC` describe block, inside the file's top-level scope):

```typescript
describe('hasStarted', () => {
  it('returns true when starts_at is in the past', () => {
    const now = new Date('2026-05-26T12:00:00Z')
    const startsAt = new Date(now.getTime() - 1).toISOString()
    expect(hasStarted(startsAt, now)).toBe(true)
  })

  it('returns true when starts_at equals now', () => {
    const now = new Date('2026-05-26T12:00:00Z')
    expect(hasStarted(now.toISOString(), now)).toBe(true)
  })

  it('returns false when starts_at is in the future', () => {
    const now = new Date('2026-05-26T12:00:00Z')
    const startsAt = new Date(now.getTime() + 1).toISOString()
    expect(hasStarted(startsAt, now)).toBe(false)
  })

  it('returns false for a tournament starting 7 days from now', () => {
    const now = new Date('2026-05-26T12:00:00Z')
    const startsAt = new Date(now.getTime() + 7 * 86_400_000).toISOString()
    expect(hasStarted(startsAt, now)).toBe(false)
  })
})
```

Also update the import line at the top of the test file (line 2–8) to include `hasStarted`:

```typescript
import {
  compareTournamentsForCarousel,
  buildMatchInfoMap,
  getLocalDayBoundaryUTC,
  hasStarted,
  type TournamentForSort,
  type MatchForAggregation,
} from '../live-tournaments-carousel'
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts`

Expected: Test file fails to load OR all 4 new tests fail with `hasStarted is not defined` / equivalent import error.

- [ ] **Step 3: Implement `hasStarted` in `src/lib/live-tournaments-carousel.ts`**

Append to the end of the file (after `getLocalDayBoundaryUTC`):

```typescript
/**
 * True iff the tournament has begun. Used by the carousel card to branch
 * between "live today / rest day" status lines and "starts in N days /
 * tomorrow / today" status lines. The "equal to now" edge case resolves
 * to true so a tournament whose listed start time is exactly `now` shows
 * the live-today branch rather than flicker into the upcoming branch.
 */
export function hasStarted(startsAt: string, now: Date = new Date()): boolean {
  return new Date(startsAt).getTime() <= now.getTime()
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts`

Expected: All tests pass (existing 11 + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-tournaments-carousel.ts src/lib/__tests__/live-tournaments-carousel.test.ts
git commit -m "feat(carousel): add hasStarted helper for upcoming-tournament branch"
```

---

## Task 2: Add `daysUntilStart` helper with tests

**Files:**
- Modify: `src/lib/live-tournaments-carousel.ts`
- Modify: `src/lib/__tests__/live-tournaments-carousel.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `src/lib/__tests__/live-tournaments-carousel.test.ts` (after the `hasStarted` block from Task 1):

```typescript
describe('daysUntilStart', () => {
  it('returns 0 when starts_at is later today (user local)', () => {
    // 09:00 local now, start at 18:00 local same day
    const now = new Date('2026-05-26T09:00:00')
    const startsAt = new Date('2026-05-26T18:00:00').toISOString()
    expect(daysUntilStart(startsAt, now)).toBe(0)
  })

  it('returns 0 when starts_at was earlier today (defensive — caller branches on hasStarted first)', () => {
    const now = new Date('2026-05-26T23:30:00')
    const startsAt = new Date('2026-05-26T06:00:00').toISOString()
    expect(daysUntilStart(startsAt, now)).toBe(0)
  })

  it('returns 1 when starts_at is tomorrow even with only a few hours gap', () => {
    // 23:30 today, start at 06:00 tomorrow — only 6.5h later but a calendar day away
    const now = new Date('2026-05-26T23:30:00')
    const startsAt = new Date('2026-05-27T06:00:00').toISOString()
    expect(daysUntilStart(startsAt, now)).toBe(1)
  })

  it('returns 7 when starts_at is 7 calendar days from now', () => {
    const now = new Date('2026-05-26T12:00:00')
    const startsAt = new Date('2026-06-02T12:00:00').toISOString()
    expect(daysUntilStart(startsAt, now)).toBe(7)
  })

  it('returns 3 when starts_at is 3 days away regardless of time-of-day', () => {
    // now = 23:00 today, starts_at = 01:00 in 3 days (only ~50 hours later
    // but 3 calendar days). Comparison is calendar-day diff, not 24h chunks.
    const now = new Date('2026-05-26T23:00:00')
    const startsAt = new Date('2026-05-29T01:00:00').toISOString()
    expect(daysUntilStart(startsAt, now)).toBe(3)
  })

  it('handles DST spring-forward without drifting off by 1', () => {
    // US Eastern DST 2026: clocks jump from 02:00 EST → 03:00 EDT on Mar 8.
    // A tournament starting Mar 9 at noon, viewed from Mar 7 at noon, is 2
    // calendar days away even though the wall-clock gap is 47h (not 48h).
    const now = new Date('2026-03-07T12:00:00')
    const startsAt = new Date('2026-03-09T12:00:00').toISOString()
    expect(daysUntilStart(startsAt, now)).toBe(2)
  })
})
```

Also update the import line at the top of the test file to include `daysUntilStart`:

```typescript
import {
  compareTournamentsForCarousel,
  buildMatchInfoMap,
  getLocalDayBoundaryUTC,
  hasStarted,
  daysUntilStart,
  type TournamentForSort,
  type MatchForAggregation,
} from '../live-tournaments-carousel'
```

- [ ] **Step 2: Run tests — confirm they fail**

Run: `npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts`

Expected: 6 new tests fail with `daysUntilStart is not defined` / import error.

- [ ] **Step 3: Implement `daysUntilStart` in `src/lib/live-tournaments-carousel.ts`**

Append to the end of the file (after `hasStarted`):

```typescript
/**
 * Whole-day diff between today (user local) and the calendar day of the
 * tournament's `starts_at`. Returns:
 *   0  → starts today (including earlier today; caller is expected to branch
 *        on hasStarted first if it cares about "already started")
 *   1  → starts tomorrow
 *   N  → starts in N days
 *
 * Uses local-time calendar-day comparison via toLocaleDateString('en-CA'),
 * which produces a stable YYYY-MM-DD string regardless of host locale and
 * is DST-safe (DST shifts the wall clock but not the calendar date).
 */
export function daysUntilStart(startsAt: string, now: Date = new Date()): number {
  const toLocalDateStr = (d: Date) => d.toLocaleDateString('en-CA')
  // Parse YYYY-MM-DDT00:00:00 as local time so the diff is in calendar days,
  // not 24h chunks (which would drift on DST transitions).
  const startOfDay = (s: string) => new Date(`${s}T00:00:00`).getTime()
  const todayMs = startOfDay(toLocalDateStr(now))
  const startMs = startOfDay(toLocalDateStr(new Date(startsAt)))
  // Round to nearest whole day to absorb any sub-millisecond noise from
  // DST math on the underlying Date object.
  return Math.round((startMs - todayMs) / 86_400_000)
}
```

- [ ] **Step 4: Run tests — confirm they pass**

Run: `npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts`

Expected: All tests pass (15 + 6 = 21 total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/live-tournaments-carousel.ts src/lib/__tests__/live-tournaments-carousel.test.ts
git commit -m "feat(carousel): add daysUntilStart helper with DST-safe calendar diff"
```

---

## Task 3: Add mixed-window sort test (Premier-future outranks FIP-today)

**Files:**
- Modify: `src/lib/__tests__/live-tournaments-carousel.test.ts`

This is a verification-only task — proves the existing `compareTournamentsForCarousel` already produces the desired order across the widened window without any comparator change.

- [ ] **Step 1: Add a test case to the existing `compareTournamentsForCarousel` describe block**

Insert this `it` block inside the existing `describe('compareTournamentsForCarousel', ...)` block in `src/lib/__tests__/live-tournaments-carousel.test.ts` (immediately after the existing "sorts a realistic mixed Premier+FIP input end-to-end" test on line ~75):

```typescript
  it('puts a Premier tournament starting in 5 days before a FIP Platinum running today', () => {
    // Regression guard for the 7-day-window carousel: even though the FIP
    // Platinum is happening *now*, the Premier P1 starting later this week
    // should still occupy a higher slot. Tier-first ordering, not date-first.
    const platinumToday = makeT({ id: 'platinum-today', level: 'fip_platinum', starts_at: '2026-05-26T00:00:00Z' })
    const p1InFiveDays = makeT({ id: 'p1-in-5d',        level: 'p1',           starts_at: '2026-05-31T00:00:00Z' })
    const sorted = [platinumToday, p1InFiveDays].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['p1-in-5d', 'platinum-today'])
  })

  it('within the same tier, prefers today over future when both are in the 7-day window', () => {
    // FIP Bronze running today must sort before another FIP Bronze starting
    // in 3 days — confirms the starts_at tiebreaker still works at the
    // bottom of the tier table.
    const bronzeToday    = makeT({ id: 'bronze-today',    level: 'fip_bronze', starts_at: '2026-05-26T00:00:00Z' })
    const bronzeInThree  = makeT({ id: 'bronze-in-3d',    level: 'fip_bronze', starts_at: '2026-05-29T00:00:00Z' })
    const sorted = [bronzeInThree, bronzeToday].sort(compareTournamentsForCarousel)
    expect(sorted.map(t => t.id)).toEqual(['bronze-today', 'bronze-in-3d'])
  })
```

- [ ] **Step 2: Run the tests — they should pass with no production code change**

Run: `npx vitest run src/lib/__tests__/live-tournaments-carousel.test.ts`

Expected: All tests pass (21 + 2 = 23 total). No `live-tournaments-carousel.ts` change needed; the existing comparator already handles this.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/live-tournaments-carousel.test.ts
git commit -m "test(carousel): regression guard for tier-first ordering across 7-day window"
```

---

## Task 4: Remove orphan i18n keys + add three new upcoming-status keys (5 locales)

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

The previous iteration of the carousel left orphan keys (`chipLiveToday`, `chipUpcoming`, `startsOn` plus their `_context` siblings) — confirmed unused by `grep -r 'chipLiveToday\|chipUpcoming\|liveTournaments.startsOn' src`. We remove them and add the three new keys we'll consume in Task 5.

- [ ] **Step 1: Edit `src/messages/en.json`**

Within the `home.liveTournaments` object (around lines 361–374), replace these six lines:

```jsonc
      "chipLiveToday": "Live / Today",
      "_chipLiveToday_context": "Filter chip above the Live Tournaments home-page carousel. Active when a tournament is currently running today (any tier). The slash is literal. Width budget is narrow — keep short.",
      "chipUpcoming": "Upcoming",
      "_chipUpcoming_context": "Filter chip for tournaments starting within the next 7 days. Sibling chip to chipLiveToday. Different from the existing `comingUp` key which refers to upcoming individual matches.",
```

…and the `startsOn` pair (lines 370–371):

```jsonc
      "startsOn": "Starts {date}",
      "_startsOn_context": "Status line on a tournament card under the UPCOMING chip. {date} is a short localised date string (e.g. 'May 22') formatted by next-intl's DATE_SHORT pattern. Adjust prepositions/articles for the language as needed.",
```

…with these three keys + one shared context (preserving the alphabetical placement of `matchesTodayCount`, `restDay`, `viewMatches`):

```jsonc
      "startsInDays": "{count, plural, one {Starts in # day} other {Starts in # days}}",
      "_startsInDays_context": "Status line on a tournament card whose start date is 2+ days away (within the 7-day carousel window). {count} is the whole-day diff between today and the tournament's start date in the user's local timezone. Sibling keys: startsToday (count=0), startsTomorrow (count=1).",
      "startsToday": "Starts today",
      "startsTomorrow": "Starts tomorrow",
```

Final ordering of keys inside `home.liveTournaments` (alphabetical for stability): `matchesTodayCount`, `restDay`, `_restDay_context`, `startsInDays`, `_startsInDays_context`, `startsToday`, `startsTomorrow`, `title`, `viewMatches`, `_viewMatches_context`.

(The exact alphabetical position isn't critical — what matters is that the four orphan keys are removed and the three new keys are present.)

- [ ] **Step 2: Edit `src/messages/es.json` (Spanish)**

Apply the same removals (chip keys + `startsOn` + their contexts) and add:

```jsonc
      "startsInDays": "{count, plural, one {Empieza en # día} other {Empieza en # días}}",
      "_startsInDays_context": "Status line on a tournament card whose start date is 2+ days away (within the 7-day carousel window). {count} is the whole-day diff between today and the tournament's start date in the user's local timezone. Sibling keys: startsToday (count=0), startsTomorrow (count=1).",
      "startsToday": "Empieza hoy",
      "startsTomorrow": "Empieza mañana",
```

- [ ] **Step 3: Edit `src/messages/pt.json` (Portuguese)**

Same removals + add:

```jsonc
      "startsInDays": "{count, plural, one {Começa em # dia} other {Começa em # dias}}",
      "_startsInDays_context": "Status line on a tournament card whose start date is 2+ days away (within the 7-day carousel window). {count} is the whole-day diff between today and the tournament's start date in the user's local timezone. Sibling keys: startsToday (count=0), startsTomorrow (count=1).",
      "startsToday": "Começa hoje",
      "startsTomorrow": "Começa amanhã",
```

- [ ] **Step 4: Edit `src/messages/it.json` (Italian)**

Same removals + add:

```jsonc
      "startsInDays": "{count, plural, one {Inizia tra # giorno} other {Inizia tra # giorni}}",
      "_startsInDays_context": "Status line on a tournament card whose start date is 2+ days away (within the 7-day carousel window). {count} is the whole-day diff between today and the tournament's start date in the user's local timezone. Sibling keys: startsToday (count=0), startsTomorrow (count=1).",
      "startsToday": "Inizia oggi",
      "startsTomorrow": "Inizia domani",
```

- [ ] **Step 5: Edit `src/messages/fr.json` (French)**

Same removals + add:

```jsonc
      "startsInDays": "{count, plural, one {Commence dans # jour} other {Commence dans # jours}}",
      "_startsInDays_context": "Status line on a tournament card whose start date is 2+ days away (within the 7-day carousel window). {count} is the whole-day diff between today and the tournament's start date in the user's local timezone. Sibling keys: startsToday (count=0), startsTomorrow (count=1).",
      "startsToday": "Commence aujourd'hui",
      "startsTomorrow": "Commence demain",
```

- [ ] **Step 6: Verify JSON is still valid in all 5 locales**

Run: `for f in en es pt it fr; do node -e "JSON.parse(require('fs').readFileSync('src/messages/$f.json','utf8'))" && echo "$f OK"; done`

Expected: `en OK`, `es OK`, `pt OK`, `it OK`, `fr OK` — all five lines.

- [ ] **Step 7: Run typecheck — next-intl will validate that the same key set is present in every locale**

Run: `npx tsc --noEmit`

Expected: No new type errors from the i18n changes. (Pre-existing errors unrelated to this change may remain — focus on whether the diff introduces new ones.)

- [ ] **Step 8: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(carousel): add startsToday/Tomorrow/InDays keys, drop unused chip/startsOn keys"
```

---

## Task 5: Card uses the new helpers and i18n keys

**Files:**
- Modify: `src/components/home/LiveTournamentsCarousel.tsx`

- [ ] **Step 1: Update the import block**

In `src/components/home/LiveTournamentsCarousel.tsx`, the file currently doesn't import from `@/lib/live-tournaments-carousel`. Add an import for the two new helpers near the top (after the existing `@/lib/tournament-tier-style` import on line 15):

```typescript
import { daysUntilStart, hasStarted } from '@/lib/live-tournaments-carousel'
```

- [ ] **Step 2: Branch `statusLine` and the LIVE-chip conditional inside `TournamentCarouselCard`**

Currently lines 41–44 read:

```tsx
  const statusLine =
    tournament.matchesToday > 0
      ? t('matchesTodayCount', { count: tournament.matchesToday })
      : t('restDay')
```

Replace with:

```tsx
  const started = hasStarted(tournament.starts_at)
  const statusLine = started
    ? (tournament.matchesToday > 0
        ? t('matchesTodayCount', { count: tournament.matchesToday })
        : t('restDay'))
    : (() => {
        const d = daysUntilStart(tournament.starts_at)
        if (d <= 0) return t('startsToday')
        if (d === 1) return t('startsTomorrow')
        return t('startsInDays', { count: d })
      })()
```

Then change the LIVE chip conditional on line 86 from:

```tsx
        {tournament.matchesToday > 0 && (
```

to:

```tsx
        {started && tournament.matchesToday > 0 && (
```

(Today this gate is a no-op for upcoming cards because the match-counts query is windowed to today's local day, so `matchesToday` is `0` for any not-yet-started tournament. The explicit `started &&` keeps intent obvious to future readers and survives any future widening of the match-count window.)

- [ ] **Step 3: Run the lint check**

Run: `npm run lint -- --quiet src/components/home/LiveTournamentsCarousel.tsx`

Expected: No errors. (Warnings unrelated to this file's diff are fine.)

- [ ] **Step 4: Run the typecheck**

Run: `npx tsc --noEmit`

Expected: No new type errors. The new helpers are exported with explicit types; the card consumes them through the `import` added in Step 1.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/LiveTournamentsCarousel.tsx
git commit -m "feat(carousel): card branches on hasStarted for upcoming status line"
```

---

## Task 6: Home page widens the query and caps the carousel at 10

**Files:**
- Modify: `src/app/[locale]/(app)/home/page.tsx`

- [ ] **Step 1: Widen the `starts_at` filter and bump the raw limit**

In `src/app/[locale]/(app)/home/page.tsx`, lines 311–319 currently read:

```typescript
        wrap(
          supabase
            .from('tournaments')
            .select('id, name, starts_at, ends_at, country, location, level, logo_url, cover_image_url, prize_money')
            .lte('starts_at', new Date().toISOString())
            .gte('ends_at', (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })())
            .limit(20) as any,
          'home:carousel-live-today',
        ),
```

Replace with:

```typescript
        wrap(
          supabase
            .from('tournaments')
            .select('id, name, starts_at, ends_at, country, location, level, logo_url, cover_image_url, prize_money')
            // Window covers two buckets:
            //   - running today: starts_at in past <= now+7d, ends_at >= today-midnight
            //   - starting in next 7 days: starts_at in future <= now+7d, ends_at always future
            .lte('starts_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
            .gte('ends_at', (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.toISOString() })())
            .limit(40) as any,
          'home:carousel-window',
        ),
```

Note that the label string also changes from `'home:carousel-live-today'` to `'home:carousel-window'` so the log line in the `dataOf(i)` failure path (line 346) reflects the new behavior.

- [ ] **Step 2: Slice the post-sort list to top 10 before setting state**

Currently line 371 reads:

```typescript
      setCarouselLiveToday(decorate(carouselLiveRows))
```

Replace with:

```typescript
      // Cap at 10 visible cards. The "Todos los eventos" link in the section
      // header absorbs overflow; deeper discovery happens on /tournaments.
      setCarouselLiveToday(decorate(carouselLiveRows).slice(0, 10))
```

- [ ] **Step 3: Verify the typecheck still passes**

Run: `npx tsc --noEmit`

Expected: No new type errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/\(app\)/home/page.tsx
git commit -m "feat(carousel): widen window to today + next 7 days, cap at 10 cards"
```

---

## Task 7: Manual verification in the browser

**Files:** none (verification only)

The change is observable in the home-page carousel. Per project AGENTS.md and the verification-before-completion principle, run a dev server and confirm the new behavior renders correctly before claiming done.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (or use the project's run skill if it has one configured)

Wait for `Ready in <Xs>` output. The server runs on `localhost:3002`.

- [ ] **Step 2: Open the home page**

Navigate to `http://localhost:3002` in a browser (or use the preview tooling).

- [ ] **Step 3: Confirm the carousel shows mixed today + upcoming cards**

Verify visually that:
- The TORNEOS / Live Tournaments section title still renders
- The carousel scrolls horizontally
- At least one card with a LIVE chip (today, matches scheduled) is visible **if** any tournament is running today
- At least one card without a LIVE chip showing "Starts in N days" / "Starts tomorrow" / "Starts today" is visible **if** any tournament is starting in the next 7 days
- No more than 10 cards total
- Premier-tier cards (look for "P1", "P2", "MAJOR", "FINALS" tier pill) appear before FIP-tier cards regardless of date

If no tournament is currently in the window (live or upcoming), the carousel will be empty — that's the expected fallback behavior (`if (liveToday.length === 0) return null` in `LiveTournamentsCarousel.tsx:179`). Capture a screenshot anyway proving the home page renders.

- [ ] **Step 4: Check the browser console for errors**

In DevTools Console, confirm no errors from i18n (e.g., "missing translation for `startsInDays`") or React (e.g., "Hydration failed").

- [ ] **Step 5: Switch locale to Spanish and verify**

Navigate to `http://localhost:3002/es`. Confirm:
- Today-card status line still reads "X partidos hoy"
- Upcoming-card status line reads "Empieza en X días" / "Empieza mañana" / "Empieza hoy"
- No fallback to English placeholder text or missing-key warnings

- [ ] **Step 6: Capture proof and stop the dev server**

Use the project's preview/screenshot tooling to capture the carousel in both `/` (English) and `/es` (Spanish). Share both with the user.

Stop the dev server (Ctrl+C in the terminal where it was started).

- [ ] **Step 7: Final commit (if anything changed during verification)**

If verification surfaced a bug, fix it in the appropriate file from Tasks 1–6 and add a commit. Otherwise this step is a no-op; the previous task's commits are the final state.

---

## Done

All tasks complete when:
- 23+ passing tests in `src/lib/__tests__/live-tournaments-carousel.test.ts`
- No new typecheck or lint errors
- 5 locale files have `startsToday`, `startsTomorrow`, `startsInDays` and no longer have `chipLiveToday`, `chipUpcoming`, `startsOn`
- Home-page carousel renders today + upcoming cards in correct order with correct status lines, capped at 10
- Browser console clean in both EN and ES

**Branch ready for PR.** Use the `superpowers:finishing-a-development-branch` skill to decide PR vs merge.
