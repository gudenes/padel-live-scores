# OOP by Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-tournament court grouping on `/matches/[date]` with one chronological list (live + upcoming first, finished at the bottom under a green divider), hide the bookmark on finished cards, and add a duration chip.

**Architecture:** Pure-function bucketing utility + small render swap in `MatchesTournamentGroup`. Read the existing `matches.duration` column (HH:MM string already sanitized to ≤240min upstream) instead of computing from timestamps. No backend changes; no new tables; no new fetches.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Vitest for unit tests, next-intl for i18n. Existing helpers used: `parseDurationHHMM` from [`src/lib/match-duration.ts`](../../../src/lib/match-duration.ts), `bucketStatus` (currently inline in MatchesTournamentGroup — extracted as part of Task 1).

**Spec:** [`docs/superpowers/specs/2026-05-14-oop-by-time-design.md`](../specs/2026-05-14-oop-by-time-design.md)

**Visual reference:** [`public/mockup-oop-by-time.html`](../../../public/mockup-oop-by-time.html)

---

## File map

| File | Change |
|---|---|
| `src/lib/match-day-bucket.ts` | **Create** — pure partition + sort utility, plus extracted `bucketStatus` |
| `src/lib/__tests__/match-day-bucket.test.ts` | **Create** — unit tests |
| `src/lib/fetch-matches-day.ts` | Modify — add `duration` to SELECT, drop `tournament_courts` hydration |
| `src/components/MatchesTournamentGroup.tsx` | Modify — replace courtBuckets render with bucketed lists + divider; drop `CourtSection`, `courtOrder`, court-related props |
| `src/components/MatchCard.tsx` | Modify — hide bookmark on finished/retired/walkover; add duration chip |
| `src/components/MatchesDayShell.tsx` | Modify — stop threading `courtOrder` |
| `src/components/MatchesFilterClient.tsx` | Modify — drop `data-court-section` cascade rule |
| `src/messages/{en,es,pt,it,fr}.json` | Modify — add `match.duration` ICU plural string |

---

## Task 1: Set up branch and commit the spec

**Files:** none (git only)

- [ ] **Step 1.1: Confirm clean checkout state for main**

Run:
```bash
git status
```

Expected: working tree shows `feat/equipment-image-fallback` branch with the unrelated uncommitted files listed in the session header. The spec at `docs/superpowers/specs/2026-05-14-oop-by-time-design.md` and the mockup at `public/mockup-oop-by-time.html` should be untracked.

- [ ] **Step 1.2: Create the feature branch from main**

Run:
```bash
git fetch origin main
git checkout -b feat/oop-by-time origin/main
```

Expected: switched to a new branch with `main`'s tip; no other working-tree files come along (they live on the previous branch's worktree).

If `git checkout` complains that the spec/mockup files would be overwritten or carried across, that's fine — they're *new* untracked files, so they survive the branch switch. Proceed.

- [ ] **Step 1.3: Stage and commit the spec + mockup**

Run:
```bash
git add docs/superpowers/specs/2026-05-14-oop-by-time-design.md \
        docs/superpowers/plans/2026-05-14-oop-by-time.md \
        public/mockup-oop-by-time.html
git commit -m "$(cat <<'EOF'
docs(oop): spec, plan, and high-fidelity mockup for chronological day view

Replaces court-grouped OOP on /matches/[date] with a single
chronological list per tournament, finished at the bottom.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: 3 files committed.

- [ ] **Step 1.4: Verify**

Run:
```bash
git log --oneline -1
git status
```

Expected: latest commit is the docs commit; working tree is clean.

---

## Task 2: Pure bucketing utility (TDD)

**Files:**
- Create: `src/lib/match-day-bucket.ts`
- Create: `src/lib/__tests__/match-day-bucket.test.ts`

The current `bucketStatus` function lives inline at [`MatchesTournamentGroup.tsx:115`](../../../src/components/MatchesTournamentGroup.tsx). We extract it so the bucketing utility can use it and so it's covered by the same test file.

- [ ] **Step 2.1: Write the test file with the API and behavior assertions**

Create `src/lib/__tests__/match-day-bucket.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bucketDayMatches, bucketStatus, type DayMatch } from '../match-day-bucket'

function m(overrides: Partial<DayMatch> = {}): DayMatch {
  return {
    id: 'm1',
    status: 'scheduled',
    scheduled_at: null,
    finished_at: null,
    court: null,
    court_order: null,
    ...overrides,
  }
}

describe('bucketStatus', () => {
  it('maps scheduled/warming_up to upcoming', () => {
    expect(bucketStatus('scheduled')).toBe('upcoming')
    expect(bucketStatus('warming_up')).toBe('upcoming')
  })

  it('maps live/on_court/ended to live', () => {
    expect(bucketStatus('live')).toBe('live')
    expect(bucketStatus('on_court')).toBe('live')
    expect(bucketStatus('ended')).toBe('live')
  })

  it('maps finished/retired/walkover to finished', () => {
    expect(bucketStatus('finished')).toBe('finished')
    expect(bucketStatus('retired')).toBe('finished')
    expect(bucketStatus('walkover')).toBe('finished')
  })

  it('returns null for unknown statuses', () => {
    expect(bucketStatus('postponed')).toBeNull()
    expect(bucketStatus('')).toBeNull()
  })
})

describe('bucketDayMatches', () => {
  it('returns empty arrays when input is empty', () => {
    const out = bucketDayMatches([])
    expect(out.active).toEqual([])
    expect(out.finished).toEqual([])
  })

  it('partitions live + upcoming into active, finished into finished', () => {
    const matches = [
      m({ id: 'a', status: 'finished',  finished_at: '2026-05-14T12:00:00Z' }),
      m({ id: 'b', status: 'live',      scheduled_at: '2026-05-14T15:00:00Z' }),
      m({ id: 'c', status: 'scheduled', scheduled_at: '2026-05-14T17:00:00Z' }),
      m({ id: 'd', status: 'walkover',  finished_at: '2026-05-14T11:00:00Z' }),
      m({ id: 'e', status: 'warming_up',scheduled_at: '2026-05-14T16:00:00Z' }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.active.map(x => x.id)).toEqual(['b', 'e', 'c'])  // 15 → 16 → 17
    expect(out.finished.map(x => x.id)).toEqual(['a', 'd'])     // 12 → 11 desc
  })

  it('sorts active by scheduled_at ascending; nulls last', () => {
    const matches = [
      m({ id: 'late',   scheduled_at: '2026-05-14T18:00:00Z' }),
      m({ id: 'null',   scheduled_at: null }),
      m({ id: 'early',  scheduled_at: '2026-05-14T11:00:00Z' }),
      m({ id: 'mid',    scheduled_at: '2026-05-14T15:00:00Z' }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.active.map(x => x.id)).toEqual(['early', 'mid', 'late', 'null'])
  })

  it('tiebreaks active by court_order then court name when scheduled_at ties', () => {
    const t = '2026-05-14T16:00:00Z'
    const matches = [
      m({ id: 'c2', scheduled_at: t, court: 'Court 2',  court_order: 2 }),
      m({ id: 'c1', scheduled_at: t, court: 'Center',   court_order: 1 }),
      m({ id: 'c3', scheduled_at: t, court: 'Annexe',   court_order: null }),
      m({ id: 'c4', scheduled_at: t, court: 'Beta',     court_order: null }),
    ]
    const out = bucketDayMatches(matches)
    // court_order present wins over null; within same group, alphabetical
    expect(out.active.map(x => x.id)).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('sorts finished by finished_at descending; nulls last; tiebreak by id', () => {
    const matches = [
      m({ id: 'old',  status: 'finished', finished_at: '2026-05-14T10:00:00Z' }),
      m({ id: 'new',  status: 'finished', finished_at: '2026-05-14T14:00:00Z' }),
      m({ id: 'null', status: 'finished', finished_at: null }),
      m({ id: 'mid',  status: 'finished', finished_at: '2026-05-14T12:00:00Z' }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.finished.map(x => x.id)).toEqual(['new', 'mid', 'old', 'null'])
  })

  it('drops matches with unknown statuses (does not crash)', () => {
    const matches = [
      m({ id: 'ok',  status: 'live',      scheduled_at: '2026-05-14T15:00:00Z' }),
      m({ id: 'bad', status: 'postponed', scheduled_at: '2026-05-14T16:00:00Z' }),
    ]
    const out = bucketDayMatches(matches)
    expect(out.active.map(x => x.id)).toEqual(['ok'])
    expect(out.finished).toEqual([])
  })
})
```

- [ ] **Step 2.2: Run the test — expect failure**

Run:
```bash
npx vitest run src/lib/__tests__/match-day-bucket.test.ts
```

Expected: fails with `Cannot find module '../match-day-bucket'` or similar.

- [ ] **Step 2.3: Implement the utility**

Create `src/lib/match-day-bucket.ts`:

```ts
// src/lib/match-day-bucket.ts
//
// Pure partition + sort for the day's matches inside a tournament group.
// Used by MatchesTournamentGroup on /matches/[date]. Splits into:
//   - active:   live + upcoming, sorted by scheduled_at asc (nulls last)
//   - finished: finished/retired/walkover, sorted by finished_at desc
//
// Active tiebreaks: court_order asc → court name (case-insensitive) asc.
// This preserves OOP simul-start order (e.g. four matches at 16:00 across
// four courts) without bringing the court-section header back.
//
// Finished tiebreaks: scheduled_at desc → id asc (deterministic for tests).

export interface DayMatch {
  id: string
  status: string
  scheduled_at: string | null
  finished_at: string | null
  court: string | null
  court_order: number | null
}

export type StatusBucket = 'live' | 'upcoming' | 'finished'

export function bucketStatus(s: string): StatusBucket | null {
  if (s === 'live' || s === 'on_court' || s === 'ended') return 'live'
  if (s === 'scheduled' || s === 'warming_up') return 'upcoming'
  if (s === 'finished' || s === 'retired' || s === 'walkover') return 'finished'
  return null
}

export interface BucketedDayMatches<T extends DayMatch> {
  active: T[]
  finished: T[]
}

export function bucketDayMatches<T extends DayMatch>(matches: T[]): BucketedDayMatches<T> {
  const active: T[] = []
  const finished: T[] = []
  for (const m of matches) {
    const b = bucketStatus(m.status)
    if (b === 'finished') finished.push(m)
    else if (b === 'live' || b === 'upcoming') active.push(m)
    // null bucket → drop (unknown status, defensive)
  }

  active.sort((a, b) => {
    // scheduled_at asc, nulls last
    const aT = a.scheduled_at ?? ''
    const bT = b.scheduled_at ?? ''
    if (aT && bT && aT !== bT) return aT < bT ? -1 : 1
    if (aT && !bT) return -1
    if (!aT && bT) return 1
    // tiebreak: court_order asc (nulls last)
    const aO = a.court_order ?? Number.POSITIVE_INFINITY
    const bO = b.court_order ?? Number.POSITIVE_INFINITY
    if (aO !== bO) return aO - bO
    // tiebreak: court name asc
    const aC = (a.court ?? '').toLowerCase()
    const bC = (b.court ?? '').toLowerCase()
    if (aC && bC && aC !== bC) return aC < bC ? -1 : 1
    return 0
  })

  finished.sort((a, b) => {
    const aT = a.finished_at ?? ''
    const bT = b.finished_at ?? ''
    if (aT && bT && aT !== bT) return aT < bT ? 1 : -1   // desc
    if (aT && !bT) return -1
    if (!aT && bT) return 1
    const aS = a.scheduled_at ?? ''
    const bS = b.scheduled_at ?? ''
    if (aS && bS && aS !== bS) return aS < bS ? 1 : -1   // desc
    return a.id.localeCompare(b.id)
  })

  return { active, finished }
}
```

- [ ] **Step 2.4: Run the tests — expect pass**

Run:
```bash
npx vitest run src/lib/__tests__/match-day-bucket.test.ts
```

Expected: 7 tests passing.

- [ ] **Step 2.5: Commit**

```bash
git add src/lib/match-day-bucket.ts src/lib/__tests__/match-day-bucket.test.ts
git commit -m "$(cat <<'EOF'
feat(matches): pure bucket+sort utility for chronological day view

Splits the day's matches into active (live + upcoming, sorted by
scheduled_at asc) and finished (sorted by finished_at desc).
Extracts bucketStatus from MatchesTournamentGroup so it's reusable
and covered by tests.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: i18n — add `match.duration`

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

The `tournament.finishedSection` key is already present in all 5 locales — no work needed there. We only add `match.duration` for the chip.

Format choice: ICU plural on `hours` so 47-min matches render as `47m` (no `0h`), longer ones as `1h 47m`. Same numeric format in all 5 locales — it's the universal sports-broadcast shorthand.

- [ ] **Step 3.1: Find the existing `match` namespace in `en.json`**

Run:
```bash
grep -n '"match":' src/messages/en.json
```

Note the line number — you'll insert the `duration` key inside the `match` object. The key needs to be on a comma-friendly line; pick a position that doesn't break the existing JSON.

- [ ] **Step 3.2: Add the key to each locale**

Add this entry inside the `"match"` object (alongside other `match.*` keys) in all five files. Use the locale-specific value:

`src/messages/en.json` (English):
```json
    "duration": "{hours, plural, =0 {{minutes}m} other {{hours}h {minutes}m}}",
```

`src/messages/es.json` (Spanish — same numeric format, same hour/min letters as the universal sports notation):
```json
    "duration": "{hours, plural, =0 {{minutes}m} other {{hours}h {minutes}m}}",
```

`src/messages/pt.json` (Portuguese):
```json
    "duration": "{hours, plural, =0 {{minutes}m} other {{hours}h {minutes}m}}",
```

`src/messages/it.json` (Italian):
```json
    "duration": "{hours, plural, =0 {{minutes}m} other {{hours}h {minutes}m}}",
```

`src/messages/fr.json` (French):
```json
    "duration": "{hours, plural, =0 {{minutes}m} other {{hours}h {minutes}m}}",
```

> Why same value across locales: `1h 47m` is the standard sport-broadcast notation in all five markets. If a translator later wants to differentiate (e.g. French often uses `1 h 47`), the key is in place to override per-locale.

- [ ] **Step 3.3: Validate JSON parses**

Run:
```bash
node -e "for (const l of ['en','es','pt','it','fr']) JSON.parse(require('fs').readFileSync('src/messages/'+l+'.json','utf8'))"
```

Expected: no output (silent success). Any parse error means a missing comma or stray bracket — fix before continuing.

- [ ] **Step 3.4: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "$(cat <<'EOF'
feat(i18n): add match.duration key (5 locales) for finished card chip

Renders as "1h 47m" or "47m" via ICU plural on hours.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Thread `matches.duration` through the day-page fetch

**Files:**
- Modify: `src/lib/fetch-matches-day.ts`
- Modify: `src/components/MatchesTournamentGroup.tsx` (interface only)

The `matches.duration` column already exists in the schema and is sanitized to ≤240 min upstream (see [`src/lib/match-duration.ts`](../../../src/lib/match-duration.ts)). The page query just doesn't SELECT it today. Add it.

- [ ] **Step 4.1: Find the SELECT in `fetch-matches-day.ts`**

Run:
```bash
grep -n "from('matches')" src/lib/fetch-matches-day.ts
```

Then read 30-40 lines around the call to find the `.select(...)` chain that lists match columns.

- [ ] **Step 4.2: Add `duration` to the column list**

Inside the `.select(...)` string for the `matches` query, add `duration` to the comma-separated column list. Pattern: it'll sit alongside `status, scheduled_at, finished_at, ...`.

For example, if the existing list reads:
```
'id, padelapi_id, status, scheduled_at, finished_at, ...'
```

Change to:
```
'id, padelapi_id, status, scheduled_at, finished_at, duration, ...'
```

- [ ] **Step 4.3: Add `duration` to the `GroupMatch` interface**

Open `src/components/MatchesTournamentGroup.tsx`. Find the `GroupMatch` interface (around line 55) and add a new field next to `finished_at`:

```ts
export interface GroupMatch {
  id: string
  status: string
  category: string | null
  scheduled_at: string | null
  finished_at: string | null
  duration: string | null   // ← add: HH:MM string from matches.duration
  round: string | null
  court: string | null
  court_order: number | null
  schedule_label: string | null
  // …rest unchanged
}
```

- [ ] **Step 4.4: Run typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: clean. If `fetch-matches-day.ts` returns a strongly typed shape that conflicts, you may need to add `duration: string | null` to the projection type there too.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/fetch-matches-day.ts src/components/MatchesTournamentGroup.tsx
git commit -m "$(cat <<'EOF'
feat(matches): select matches.duration for the day-page query

Threads the existing HH:MM duration column through to GroupMatch so
finished cards can render a duration chip without a second fetch.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: MatchCard — hide bookmark on finished + render duration chip

**Files:**
- Modify: `src/components/MatchCard.tsx`

Two narrow changes gated on `isFinished` (which `getMatchDisplay` already returns; covers `finished` / `retired` / `walkover` because they all carry a winner).

- [ ] **Step 5.1: Add the duration parse + format helpers near the top of MatchCard**

Open `src/components/MatchCard.tsx`. Just under the existing imports, add:

```ts
import { parseDurationHHMM } from '@/lib/match-duration'
```

Verify the existing `useTranslations('match')` call assigns to `tMatch` (already in the file at ~line 217). We'll reuse `tMatch` for the duration label.

- [ ] **Step 5.2: Compute the duration label inside the component body**

Inside the `MatchCard` component, after the existing `const display = getMatchDisplay(match)` line (~line 230), add:

```ts
// Duration chip (finished cards only). matches.duration is sanitized to
// ≤240min upstream; parseDurationHHMM returns null for missing/malformed.
const durationMinutes = parseDurationHHMM((match as { duration?: string | null }).duration)
const durationLabel = isFinished && durationMinutes != null
  ? tMatch('duration', { hours: Math.floor(durationMinutes / 60), minutes: durationMinutes % 60 })
  : null
```

> The `as { duration?: string | null }` cast is needed because the `Match` type at `src/types/match.ts` may not yet include the field. Adding it to the Match type is out of scope for this PR — the cast is a one-liner and the field is documented in `GroupMatch`.

- [ ] **Step 5.3: Wrap the FollowButton (bookmark star) so it hides on finished cards**

Find the existing FollowButton render (~line 399):

```tsx
<FollowButton
  type="match"
  targetId={match.id}
  variant="star"
  size={20}
  style={{ position: 'absolute', top: 10, right: 12, zIndex: 3 }}
/>
```

Wrap it in a conditional:

```tsx
{!isFinished && (
  <FollowButton
    type="match"
    targetId={match.id}
    variant="star"
    size={20}
    style={{ position: 'absolute', top: 10, right: 12, zIndex: 3 }}
  />
)}
```

- [ ] **Step 5.4: Add the duration chip after the status chip in the chip row**

Find the chip row's status chip render (~line 466):

```tsx
{status && (
  <Chip bg={status.bg} color={status.color} bold>
    {status.label}
  </Chip>
)}
```

Add the duration chip directly after it:

```tsx
{status && (
  <Chip bg={status.bg} color={status.color} bold>
    {status.label}
  </Chip>
)}
{durationLabel && (
  <span
    aria-label={durationLabel}
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.4,
      color: '#9CA3AF',
      background: 'rgba(255,255,255,0.04)',
      padding: '2px 6px',
      clipPath: CHUNKY.badge,
      lineHeight: 1.2,
      whiteSpace: 'nowrap',
      fontFamily: 'monospace',
    }}
  >
    <svg
      width={9}
      height={9}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ opacity: 0.7 }}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
    {durationLabel}
  </span>
)}
```

- [ ] **Step 5.5: Typecheck and lint**

Run:
```bash
npx tsc --noEmit
npm run lint
```

Expected: both clean.

- [ ] **Step 5.6: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "$(cat <<'EOF'
feat(match-card): duration chip on finished cards; hide bookmark

Reads matches.duration (HH:MM, sanitized ≤240min upstream) and renders
a chip with a clock glyph. Bookmark star is hidden once a winner is
set since "follow this match" no longer applies.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Replace court grouping with bucketed lists in MatchesTournamentGroup

**Files:**
- Modify: `src/components/MatchesTournamentGroup.tsx`

This is the core swap. Read [`MatchesTournamentGroup.tsx:115`](../../../src/components/MatchesTournamentGroup.tsx) (the inline `bucketStatus`) and the body render (~lines 200–478) before editing.

- [ ] **Step 6.1: Replace the inline `bucketStatus` with the import**

At the top of the file, add the import:

```ts
import { bucketDayMatches, bucketStatus } from '@/lib/match-day-bucket'
```

Then **delete** the existing `function bucketStatus(...)` block (~line 115).

The existing aggregate-counts loop (~line 207) calls `bucketStatus(m.status)` and continues to work because the imported version has the same signature.

- [ ] **Step 6.2: Replace the courtBuckets section with bucketed lists**

Find the block that builds `courtBuckets` and `sortedCourtKeys` (~lines 216–251). **Delete it entirely** and replace with:

```ts
// Chronological buckets: live + upcoming first (sorted by scheduled_at),
// then finished at the bottom (sorted by finished_at desc). See
// `src/lib/match-day-bucket.ts` for the sort rules + tests.
const { active, finished } = bucketDayMatches(group.matches)
```

- [ ] **Step 6.3: Update the maxHeight estimate for the collapse animation**

Find the body container with the `maxHeight` style (~line 442):

```tsx
maxHeight: expanded ? total * 130 + courtCount * 36 + 100 : 0,
```

Replace with (we no longer have `courtCount`; add a flat allowance for the divider when finished is non-empty):

```tsx
maxHeight: expanded ? total * 130 + (finished.length > 0 ? 50 : 0) + 100 : 0,
```

- [ ] **Step 6.4: Replace the body render**

Find the body render block (~lines 447–477) that maps `sortedCourtKeys` and renders `<CourtSection>` with nested `<MatchEntry>`. **Delete it entirely** and replace with:

```tsx
{/* Active: live + upcoming, sorted chronologically */}
{active.map(m => {
  const s = bucketStatus(m.status)
  const status: 'live' | 'upcoming' | 'finished' = s ?? 'upcoming'
  return (
    <MatchEntry
      key={m.id}
      match={m}
      status={status}
      locale={group.locale}
      userTz={group.userTz}
      tournamentLevel={group.tournamentLevel}
      dayBucketIso={group.dayBucketIso}
    />
  )
})}

{/* Finished section divider — only when there are finished matches */}
{finished.length > 0 && (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '16px 6px 8px',
    }}
  >
    <span
      style={{
        fontFamily: 'inherit',
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 2,
        color: GREEN,
        textTransform: 'uppercase',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {tTournament('finishedSection')}
      <span
        style={{
          color: GREEN,
          fontFamily: 'monospace',
          fontSize: 10,
          fontWeight: 700,
          background: 'rgba(126, 211, 33, 0.12)',
          padding: '1px 6px',
          borderRadius: 3,
          lineHeight: 1.4,
        }}
      >
        {finished.length}
      </span>
    </span>
    <div
      style={{
        flex: 1,
        height: 1,
        background: 'linear-gradient(90deg, rgba(126,211,33,0.28), transparent)',
      }}
    />
  </div>
)}

{/* Finished: most-recent finish first */}
{finished.map(m => (
  <MatchEntry
    key={m.id}
    match={m}
    status="finished"
    locale={group.locale}
    userTz={group.userTz}
    tournamentLevel={group.tournamentLevel}
    dayBucketIso={group.dayBucketIso}
  />
))}
```

- [ ] **Step 6.5: Add the `tTournament` translation hook if not already present**

Inside the component body (top, near where translations are declared), confirm there's a `useTranslations('tournament')` call. If only `useTranslations('matches')` or similar is used, add:

```ts
const tTournament = useTranslations('tournament')
```

(The existing file may already have this — search before adding.)

- [ ] **Step 6.6: Delete the now-unused `CourtSection` component**

Find the `function CourtSection(...)` definition (~line 483) and delete it entirely (it's no longer referenced).

- [ ] **Step 6.7: Drop dead fields from `TournamentGroupData`**

Find the `TournamentGroupData` interface (~line 75). Remove these fields (now unused):

```ts
courtOrder: Record<string, number>
courtLabel: string
unknownCourtLabel: string
liveCountLabel: string
```

The `MatchesDayShell.tsx` consumer still passes these — Task 7 stops doing that. The TypeScript error is intentional: it forces you to confirm Task 7 lands in the same PR.

- [ ] **Step 6.8: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: a TS error in `MatchesDayShell.tsx` about extra props (`courtOrder` etc.) being passed to a type that no longer has them. That's the signal to do Task 7. Don't try to fix MatchesDayShell yet — proceed to Task 7.

- [ ] **Step 6.9: Commit (with the failing typecheck)**

This is intentionally a partial commit — the type error is the to-do flag for Task 7.

```bash
git add src/components/MatchesTournamentGroup.tsx
git commit -m "$(cat <<'EOF'
feat(matches): chronological day view with finished section

Replaces the per-court sub-sections with one chronological list
(live + upcoming sorted by scheduled_at) and a finished section
at the bottom (sorted by finished_at desc) under a green divider.

NOTE: MatchesDayShell still passes the now-removed court props;
Task 7 of the implementation plan removes them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Drop court-order threading from MatchesDayShell + fetch-matches-day

**Files:**
- Modify: `src/components/MatchesDayShell.tsx`
- Modify: `src/lib/fetch-matches-day.ts`

- [ ] **Step 7.1: Remove the `courtOrder` pass-through in MatchesDayShell**

Open `src/components/MatchesDayShell.tsx`. Find the line ~520 that reads:

```ts
courtOrder: g.courtOrder ?? {},
```

Delete that line. Also remove any sibling lines that pass `courtLabel`, `unknownCourtLabel`, `liveCountLabel` — search the surrounding object literal and drop those too.

- [ ] **Step 7.2: Remove the `tournament_courts` hydration block in fetch-matches-day**

Open `src/lib/fetch-matches-day.ts`. The block to remove is around lines 254–280 (introduced by the comment "Hydrate per-court display order from `tournament_courts`"). Delete:

- The `.from('tournament_courts')` query and its surrounding `try/await`
- The loop that writes `g.courtOrder[key] = next`
- The `courtOrder: {}` initializer in the per-tournament accumulator (~line 249)

Also remove `courtOrder: Record<string, number>` from the local return type (~line 103).

- [ ] **Step 7.3: Verify there are no other consumers of `tournament_courts.display_order`**

Run:
```bash
grep -rn "tournament_courts" src/ padelgod/ 2>/dev/null
```

Expected: hits in `src/app/ops/ArchitectureTab.tsx` (a name in a diagram, fine) and possibly padelgod (a different runtime, untouched). No other reads from the table in `src/`.

If any other consumer pops up, leave the `tournament_courts` query intact and only remove the `courtOrder` plumbing — the column survives, we just don't use it for ordering.

- [ ] **Step 7.4: Typecheck**

Run:
```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 7.5: Commit**

```bash
git add src/components/MatchesDayShell.tsx src/lib/fetch-matches-day.ts
git commit -m "$(cat <<'EOF'
refactor(matches): drop tournament_courts ordering from day fetch

The chronological day view no longer groups by court, so the per-tournament
court display_order map is dead weight. Saves one Supabase round-trip per
day-page load.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Drop the `data-court-section` cascade rule from the filter

**Files:**
- Modify: `src/components/MatchesFilterClient.tsx`

The cascade hides court sub-section headers that have all their matches filtered out. With sub-sections gone, the rule is dead.

- [ ] **Step 8.1: Find the rule**

Run:
```bash
grep -n "data-court-section\|courtNodes" src/components/MatchesFilterClient.tsx
```

Expected: a block around line 100–125 that queries `[data-court-section]` and toggles visibility.

- [ ] **Step 8.2: Remove the block**

Read 30 lines around the `courtNodes` declaration. Delete:
- The `courtNodes` querySelector line
- The loop that walks `courtNodes` and counts visible matches
- Any helper variables used only by that loop

The rest of the cascade (whole-tournament hide via `[data-tour-group]`, per-match hide via `[data-match]`) is untouched and still functional.

- [ ] **Step 8.3: Typecheck and lint**

Run:
```bash
npx tsc --noEmit
npm run lint
```

Expected: both clean.

- [ ] **Step 8.4: Commit**

```bash
git add src/components/MatchesFilterClient.tsx
git commit -m "$(cat <<'EOF'
chore(matches): drop dead data-court-section cascade rule

The chronological day view doesn't render court sub-sections, so the
filter cascade no longer needs to hide their headers. Whole-tournament
and per-match cascades still work.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Visual verification

**Files:** none (browser only)

Run the dev server and confirm the new layout matches the mockup behavior on a real day with mixed statuses. The user's preferred verification environment is a live padel day; if no live day is in progress, pick a recently completed day with finished matches.

- [ ] **Step 9.1: Start the dev server (if not already running)**

The user already has a Next.js preview server running on port 3000. If not:

```bash
npm run dev
```

Then visit `http://localhost:3000`.

- [ ] **Step 9.2: Pick a date with mixed statuses**

Open `/matches` (today's date) in the browser. If no tournament has all three of {live, upcoming, finished} matches today, navigate to a recent date via the day picker — Premier weekends typically have 5+ finished matches per tournament with a few live in the evening.

- [ ] **Step 9.3: Confirm the layout**

For at least one tournament group, verify:

- [ ] No court sub-section headers (no "Center Court", "Court 2" rows above match groups).
- [ ] Live + upcoming matches appear first, in chronological order (top to bottom = earliest start to latest).
- [ ] A green `FINISHED · N` divider appears below the last upcoming match (only when there are finished matches).
- [ ] Finished matches appear below the divider, with most-recent finish first.
- [ ] Each finished card has **no bookmark star** in the top-right corner.
- [ ] Each finished card shows a duration chip (e.g. `1h 47m`) in the chip row, after the FINAL chip.
- [ ] Live matches still have the red `LIVE` chip and bookmark star.
- [ ] Each card still shows its court name via the existing court chip.

- [ ] **Step 9.4: Confirm the filter still works**

In the filter drawer, toggle a category (e.g., Women only). Confirm:

- [ ] Tournaments with no matches in the selected category collapse fully.
- [ ] The finished section divider hides if all finished matches were filtered out.

- [ ] **Step 9.5: Mobile-width sanity check**

Open Chrome DevTools, resize to 375 × 812 (iPhone). Confirm:

- [ ] No horizontal scrolling.
- [ ] Chip row wraps cleanly when the duration chip is added.
- [ ] Divider is left-aligned and the line fades to the right edge.

- [ ] **Step 9.6: If you spot regressions, fix them as targeted commits**

Don't rewrite tasks — file targeted fixes referencing the failing assertion in the commit message (e.g., `fix(matches): collapse divider when finished bucket is empty after filter`).

- [ ] **Step 9.7: Open the PR**

```bash
git push -u origin feat/oop-by-time
gh pr create --title "feat(matches): chronological day view (OOP by time)" --body "$(cat <<'EOF'
## Summary

- Replace the per-tournament court grouping on `/matches/[date]` with one chronological list per tournament: live + upcoming sorted by `scheduled_at` ascending, then a green `FINISHED · N` divider, then finished matches sorted by `finished_at` descending.
- Hide the bookmark star on finished/retired/walkover cards and add a duration chip (`1h 47m`) sourced from `matches.duration`.
- Drop the now-dead `tournament_courts.display_order` hydration in the day fetch — saves one Supabase round-trip per page load.

Spec: `docs/superpowers/specs/2026-05-14-oop-by-time-design.md`
Mockup: `public/mockup-oop-by-time.html`

## Test plan

- [ ] `npx vitest run src/lib/__tests__/match-day-bucket.test.ts` passes (7 tests)
- [ ] `npx tsc --noEmit` clean
- [ ] `npm run lint` clean
- [ ] Manual: visit `/matches` on a day with mixed live/upcoming/finished — confirm chronological order, green divider, hidden star + duration chip on finished
- [ ] Manual: toggle filter drawer (Women only) — confirm cascade still hides empty tournaments + divider

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

Spec coverage check (vs. [`docs/superpowers/specs/2026-05-14-oop-by-time-design.md`](../specs/2026-05-14-oop-by-time-design.md)):

| Spec section | Plan task |
|---|---|
| Replace court sub-sections with one chronological list | Task 6 |
| Live + Upcoming sorted by `scheduled_at` asc, tiebreak court_order then court name | Task 2 (utility), Task 6 (consume) |
| Finished sorted by `finished_at` desc, tiebreak `scheduled_at` desc then id | Task 2 |
| Green left-aligned `FINISHED · N` divider, fading line right | Task 6 (Step 6.4 inline JSX) |
| Hide bookmark star on finished cards | Task 5 (Step 5.3) |
| Duration chip with clock glyph | Task 5 (Step 5.4) |
| Duration source = `matches.duration` (existing column) | Task 4 (fetch + interface), Task 5 (parse + render) |
| Drop `data-court-section` cascade | Task 8 |
| Drop `tournament_courts.display_order` join | Task 7 |
| i18n: ICU plural for `match.duration` in 5 locales | Task 3 |
| i18n: `tournament.finishedSection` divider label (already exists) | Task 6 (Step 6.4 reuses) |
| Tournament header unchanged | Task 6 (only body changes) |
| MatchCard internal layout unchanged except for the two narrow tweaks | Task 5 |

Type consistency check: `bucketStatus` returns `'live' | 'upcoming' | 'finished' | null` in both Task 2 (utility) and the consumer in Task 6. `DayMatch` shape in Task 2 is a subset of `GroupMatch` in MatchesTournamentGroup — `bucketDayMatches` consumes any `T extends DayMatch`, so the consumer can pass `GroupMatch[]` directly. ✓

Placeholder scan: no TBDs, TODOs, or "implement appropriate X" anywhere. Every code-changing step has the actual code. ✓
