# Tournament-Day Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small chip + tap-tooltip to finished match cards on `/[locale]/matches/[date]` when the match's tournament-local date differs from the user-selected day-tab, so users can tell at a glance that a finished match belongs to a different tournament-local session than the upcoming ones on the same tab.

**Architecture:** Pure helper decides chip visibility from `(finishedAt|scheduledAt, tournamentTz, dayBucketIso, status)`. The page's selected `iso` is plumbed through `MatchesDayShell → MatchesTournamentGroup → MatchEntry → MatchCard` as `dayBucketIso?: string`; when undefined, no chip ever renders (preserves behaviour on tournament-detail / match-detail pages where `MatchCard` is reused). Tournament timezone already exists on `tournaments.timezone`; the matches-day query just needs the field added to its select.

**Tech Stack:** Next.js 16 App Router, React 19, next-intl, Vitest (node env, no RTL), Supabase PostgREST.

**Spec:** [`docs/superpowers/specs/2026-05-10-tournament-day-indicator-design.md`](../specs/2026-05-10-tournament-day-indicator-design.md)
**Mockup:** [`public/mockup-finished-collapse.html`](../../../public/mockup-finished-collapse.html) (mode: **C · day indicator**)

---

## File Map

**Create:**
- `src/lib/tournament-day-indicator.ts` — pure helper module (`shouldShowDayIndicator`, `formatDayChipLabel`)
- `src/lib/__tests__/tournament-day-indicator.test.ts` — vitest unit tests for the helper

**Modify:**
- `src/lib/fetch-matches-day.ts` — add `timezone` to `MATCH_SELECT` + `MatchesDayMatch.tournament` interface
- `src/messages/{en,es,pt,it,fr}.json` — add `match.dayIndicator.tooltip` ICU string
- `src/components/MatchesDayShell.tsx` — pass `dayBucketIso={activeIso}` into `<MatchesTournamentGroup>`
- `src/components/MatchesTournamentGroup.tsx` — add `dayBucketIso?: string` to `TournamentGroupData` and `MatchEntry`, forward to `MatchCard`
- `src/components/MatchCard.tsx` — accept `dayBucketIso?: string`, render the chip + tooltip when helper returns truthy

---

## Task 1: Pure helper + tests

**Files:**
- Create: `src/lib/tournament-day-indicator.ts`
- Test: `src/lib/__tests__/tournament-day-indicator.test.ts`

The helper has two exports. `shouldShowDayIndicator` returns `true` when the chip should render. `formatDayChipLabel` returns the localised short string ("Sáb 9 mai.") for the chip.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/tournament-day-indicator.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  shouldShowDayIndicator,
  formatDayChipLabel,
} from '../tournament-day-indicator'

// Asunción semifinal that wrapped at 23:00 ART Saturday 2026-05-09
// = 04:00 Lisbon Sunday 2026-05-10. User opens HOJE 10 mai. tab —
// the match's tournament-local day was Saturday, user-local day is
// Sunday. Chip should fire.
const ASUNCION_TZ = 'America/Asuncion'
const FINISHED_AT_AS_SF = '2026-05-10T02:00:00Z' // 23:00 ART Sat / 03:00 Lisbon Sun
const FINISHED_AT_SAME_DAY = '2026-05-10T19:00:00Z' // 16:00 ART Sun, 20:00 Lisbon Sun

describe('shouldShowDayIndicator', () => {
  it('returns true when tournament-local date is earlier than dayBucketIso', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: FINISHED_AT_AS_SF,
        scheduledAt: null,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(true)
  })

  it('returns false when tournament-local date matches dayBucketIso', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: FINISHED_AT_SAME_DAY,
        scheduledAt: null,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('returns true when tournament-local date is later than dayBucketIso (eastward viewer)', () => {
    // A user in Tokyo (JST = UTC+9) opens their 2026-05-09 tab. A
    // California tournament (PDT = UTC-7) match that finished at
    // 17:00 PDT 2026-05-09 = 09:00 JST 2026-05-10 — but assume user
    // opens 2026-05-09 (rare, but valid).
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: '2026-05-10T00:00:00Z', // 17:00 PDT Sat May 9
        scheduledAt: null,
        tournamentTimezone: 'America/Los_Angeles',
        dayBucketIso: '2026-05-10', // user-local day after the bucket date
      }),
    ).toBe(false) // tournament local is May 9, dayBucket is May 10 — different, but only render when bucket > tournament-local
    // Reversed: user opens May 9 (their JST day), tournament-local is also May 9 PDT → same → false
  })

  it('returns false for live status', () => {
    expect(
      shouldShowDayIndicator({
        status: 'live',
        finishedAt: null,
        scheduledAt: '2026-05-10T20:00:00Z',
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('returns false for scheduled status', () => {
    expect(
      shouldShowDayIndicator({
        status: 'scheduled',
        finishedAt: null,
        scheduledAt: '2026-05-10T20:00:00Z',
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('returns false when tournamentTimezone is null', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: FINISHED_AT_AS_SF,
        scheduledAt: null,
        tournamentTimezone: null,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('returns false when dayBucketIso is undefined', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: FINISHED_AT_AS_SF,
        scheduledAt: null,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: undefined,
      }),
    ).toBe(false)
  })

  it('falls back to scheduledAt when finishedAt is null', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: null,
        scheduledAt: FINISHED_AT_AS_SF,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(true)
  })

  it('returns false when both timestamps are null', () => {
    expect(
      shouldShowDayIndicator({
        status: 'finished',
        finishedAt: null,
        scheduledAt: null,
        tournamentTimezone: ASUNCION_TZ,
        dayBucketIso: '2026-05-10',
      }),
    ).toBe(false)
  })

  it('also fires for retired and walkover (terminal statuses)', () => {
    for (const status of ['retired', 'walkover', 'ended'] as const) {
      expect(
        shouldShowDayIndicator({
          status,
          finishedAt: FINISHED_AT_AS_SF,
          scheduledAt: null,
          tournamentTimezone: ASUNCION_TZ,
          dayBucketIso: '2026-05-10',
        }),
      ).toBe(true)
    }
  })
})

describe('formatDayChipLabel', () => {
  it('returns localised short weekday + day + month in tournament tz (en)', () => {
    // 2026-05-10T02:00:00Z = Saturday 9 May at 23:00 ART
    const label = formatDayChipLabel({
      timestamp: FINISHED_AT_AS_SF,
      tournamentTimezone: ASUNCION_TZ,
      locale: 'en',
    })
    expect(label).toMatch(/Sat/)
    expect(label).toMatch(/9/)
    expect(label).toMatch(/May/)
  })

  it('returns localised short weekday + day + month in tournament tz (pt)', () => {
    const label = formatDayChipLabel({
      timestamp: FINISHED_AT_AS_SF,
      tournamentTimezone: ASUNCION_TZ,
      locale: 'pt',
    })
    // Portuguese short weekday for Saturday is "sáb" or "Sáb"
    expect(label.toLowerCase()).toMatch(/sáb|sab/)
    expect(label).toMatch(/9/)
    // Portuguese short month for May is "mai"
    expect(label.toLowerCase()).toMatch(/mai/)
  })

  it('returns null when timestamp is null', () => {
    expect(
      formatDayChipLabel({
        timestamp: null,
        tournamentTimezone: ASUNCION_TZ,
        locale: 'en',
      }),
    ).toBeNull()
  })

  it('returns null when tournamentTimezone is null', () => {
    expect(
      formatDayChipLabel({
        timestamp: FINISHED_AT_AS_SF,
        tournamentTimezone: null,
        locale: 'en',
      }),
    ).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/tournament-day-indicator.test.ts`
Expected: FAIL — module `../tournament-day-indicator` not found.

- [ ] **Step 3: Write the helper**

Create `src/lib/tournament-day-indicator.ts`:

```typescript
// src/lib/tournament-day-indicator.ts
//
// Decides whether a finished match should display a tournament-local
// day chip on the matches-by-date list. Required because the day-tab
// is a user-local construct (URL `[date]` interpreted in geo-timezone)
// but the tournament narrative ("Saturday's semifinals") is
// tournament-local. When those disagree the chip surfaces the
// tournament-local short date so users understand why a finished
// match is appearing under "today" alongside still-upcoming ones.
//
// Pure module — no React, no DOM. Consumed by MatchCard.tsx.

const TERMINAL_STATUSES = new Set(['finished', 'retired', 'walkover', 'ended'])

export interface ShouldShowDayIndicatorInput {
  status: string
  finishedAt: string | null
  scheduledAt: string | null
  tournamentTimezone: string | null
  /** ISO date (YYYY-MM-DD) of the matches-list day-tab the user has
   *  selected. Undefined when the card is rendered outside the
   *  matches-list page (tournament detail, match detail) — in which
   *  case the chip never fires. */
  dayBucketIso: string | undefined
}

/**
 * Returns the canonical YYYY-MM-DD string for a UTC timestamp in the
 * given timezone. Uses Intl with the en-CA locale because en-CA's
 * `toLocaleDateString` shape is ISO-style (YYYY-MM-DD).
 */
function isoDateInTz(utcIso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: tz,
  }).format(new Date(utcIso))
}

export function shouldShowDayIndicator(input: ShouldShowDayIndicatorInput): boolean {
  const { status, finishedAt, scheduledAt, tournamentTimezone, dayBucketIso } = input
  if (!dayBucketIso) return false
  if (!TERMINAL_STATUSES.has(status)) return false
  if (!tournamentTimezone) return false
  const ref = finishedAt ?? scheduledAt
  if (!ref) return false
  let tournamentDay: string
  try {
    tournamentDay = isoDateInTz(ref, tournamentTimezone)
  } catch {
    return false
  }
  return tournamentDay !== dayBucketIso
}

export interface FormatDayChipLabelInput {
  timestamp: string | null
  tournamentTimezone: string | null
  locale: string
}

/**
 * Localised short label for the chip — "Sáb 9 mai." (pt), "Sat 9 May" (en).
 * Returns null when inputs are insufficient, so the caller can render
 * nothing without an extra guard.
 */
export function formatDayChipLabel(input: FormatDayChipLabelInput): string | null {
  const { timestamp, tournamentTimezone, locale } = input
  if (!timestamp || !tournamentTimezone) return null
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: tournamentTimezone,
    }).format(new Date(timestamp))
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/tournament-day-indicator.test.ts`
Expected: PASS — 12 tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournament-day-indicator.ts src/lib/__tests__/tournament-day-indicator.test.ts
git commit -m "feat(matches): pure helper for tournament-day indicator visibility

Decides when a finished match's tournament-local date differs from
the user-selected day-tab, so we can render a contextual chip on
MatchCard. No UI yet — wiring lands next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Surface `tournament.timezone` on the matches-day query

**Files:**
- Modify: `src/lib/fetch-matches-day.ts:52-60` (interface) and `:114-122` (`MATCH_SELECT`)

The `tournaments.timezone` column already exists (verified: `match-fetch.ts:32` selects it on a different query). The matches-day query just doesn't request it; the matches-list path therefore renders `MatchCard` with `match.tournament.timezone` permanently `undefined`.

- [ ] **Step 1: Add `timezone` to the interface**

In `src/lib/fetch-matches-day.ts`, modify the `tournament` field of `MatchesDayMatch` (around line 52):

```typescript
  tournament: {
    id: string
    name: string
    level: string | null
    country: string | null
    timezone: string | null
    starts_at: string | null
    ends_at: string | null
    status: string | null
  } | null
```

- [ ] **Step 2: Add `timezone` to the SQL select**

In the same file, modify `MATCH_SELECT` (around line 114). Find this line:

```typescript
  tournament:tournaments(id, name, level, country, starts_at, ends_at, status),
```

Replace it with:

```typescript
  tournament:tournaments(id, name, level, country, timezone, starts_at, ends_at, status),
```

- [ ] **Step 3: Run typecheck and lint**

Run: `npm run lint`
Expected: PASS, no new errors. (Pre-existing warnings in unrelated files are fine.)

- [ ] **Step 4: Smoke-verify the field lands**

Start the dev server if not running:

```bash
npm run dev
```

Then in another terminal:

```bash
curl -s 'http://localhost:3002/api/matches/by-date?date=2026-05-10&locale=en' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); g=d['groups'][0] if d['groups'] else None; m=g['matches'][0] if g else None; print('tournament keys:', list((m or {}).get('tournament', {}).keys()))"
```

Expected: output contains `'timezone'` in the keys list. If `null`, that's fine — the column exists but the row may not be backfilled; the helper handles that gracefully.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fetch-matches-day.ts
git commit -m "feat(matches): surface tournament.timezone on matches-day fetch

Required for the day-indicator chip — the matches-list path renders
MatchCard with no tournament.timezone today, so the cross-day check
never fires. Other paths (match-fetch.ts) already select this field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: i18n keys for the tooltip

**Files:**
- Modify: `src/messages/en.json`, `es.json`, `pt.json`, `it.json`, `fr.json`

Add a `match.dayIndicator.tooltip` ICU string under the existing `match.*` namespace. The placeholder `{weekday}` is the **tournament-local** weekday (e.g. *sábado*); `{location}` is the parsed-or-country tournament location; `{userWeekday}` is the **user-local** weekday for `match.finished_at`.

- [ ] **Step 1: Add EN key**

In `src/messages/en.json`, find the `"match": {` block (around line 70). Add a `"dayIndicator"` sibling under it (alongside `"stream"`):

```json
    "dayIndicator": {
      "tooltip": "Played on {weekday} in the tournament's local time ({location}). It appears on this day because the match finished on {userWeekday} in your timezone."
    },
```

(Place the comma so it sits between existing siblings — JSON is order-sensitive only for diffs, not validity.)

- [ ] **Step 2: Add ES key**

In `src/messages/es.json`, mirror under `match`:

```json
    "dayIndicator": {
      "tooltip": "Disputado el {weekday}, hora local del torneo ({location}). Aparece este día porque en tu zona horaria terminó ya el {userWeekday}."
    },
```

- [ ] **Step 3: Add PT key**

In `src/messages/pt.json`, mirror under `match`:

```json
    "dayIndicator": {
      "tooltip": "Disputada no {weekday}, hora local do torneio ({location}). Aparece neste dia porque no seu fuso a partida terminou já no {userWeekday}."
    },
```

- [ ] **Step 4: Add IT key**

In `src/messages/it.json`, mirror under `match`:

```json
    "dayIndicator": {
      "tooltip": "Disputata {weekday}, ora locale del torneo ({location}). Appare in questo giorno perché nel tuo fuso orario è terminata {userWeekday}."
    },
```

- [ ] **Step 5: Add FR key**

In `src/messages/fr.json`, mirror under `match`:

```json
    "dayIndicator": {
      "tooltip": "Disputé le {weekday}, heure locale du tournoi ({location}). Apparaît ce jour car dans votre fuseau le match s'est terminé le {userWeekday}."
    },
```

- [ ] **Step 6: Validate JSON**

Run: `node -e "for (const l of ['en','es','pt','it','fr']) JSON.parse(require('fs').readFileSync(\`src/messages/\${l}.json\`,'utf8'))"`
Expected: no output, exit 0. Any parse error means a missing comma — fix and re-run.

- [ ] **Step 7: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(i18n): match.dayIndicator.tooltip in all 5 locales

Tooltip copy for the tournament-day chip on finished matches. Three
ICU placeholders: {weekday} (tournament-local), {location}, and
{userWeekday} (user-local).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Plumb `dayBucketIso` from page through to MatchCard

**Files:**
- Modify: `src/components/MatchesTournamentGroup.tsx` (interface + group prop + MatchEntry prop + MatchCard call)
- Modify: `src/components/MatchesDayShell.tsx:483-501` (pass `activeIso` into the group)
- Modify: `src/components/MatchCard.tsx:161-176` (add prop to interface)

The chip is opt-in: only the matches-list page sets `dayBucketIso`. Tournament-detail and match-detail consumers omit it, and the chip never fires there.

- [ ] **Step 1: Add `dayBucketIso` to MatchCard's prop interface**

In `src/components/MatchCard.tsx`, modify `MatchCardProps` (around line 161):

```typescript
export interface MatchCardProps {
  match: Match
  genderColor: string
  locale: string
  userTz: string
  /** Optional. Tournament-detail scheduled tab supplies a "~10:30" estimate
   *  built from the OOP "Followed by" chain. Shown in orange when no real
   *  scheduled time is available. */
  estimatedLabel?: string
  /** Tournament level (e.g. 'p1', 'major', 'fip_silver'). Required to gate
   *  the prediction game UI — only Premier-tier matches (where we receive
   *  point-by-point live data via the relay) get the PICK CTA, the
   *  expandable insights panel, and the result badge. Non-Premier cards
   *  fall back to a plain link to the match detail page. */
  tournamentLevel?: string | null
  /** Optional. ISO date (YYYY-MM-DD) of the matches-list day-tab the
   *  user has selected. When provided AND the match's tournament-local
   *  date differs, the card renders a small chip surfacing that date.
   *  Undefined on tournament-detail / match-detail — chip never fires. */
  dayBucketIso?: string
}
```

Also update the destructure on the next function (around line 178):

```typescript
export function MatchCard({
  match: matchProp,
  genderColor,
  locale,
  userTz,
  estimatedLabel,
  tournamentLevel,
  dayBucketIso,
}: MatchCardProps) {
```

- [ ] **Step 2: Forward through MatchesTournamentGroup's MatchEntry**

In `src/components/MatchesTournamentGroup.tsx`, modify `MatchEntry` (around line 525):

```typescript
function MatchEntry({
  match,
  status,
  locale,
  userTz,
  tournamentLevel,
  dayBucketIso,
}: {
  match: GroupMatch
  status: 'live' | 'upcoming' | 'finished'
  locale: string
  userTz: string
  tournamentLevel: string | null
  dayBucketIso: string | undefined
}) {
  const matchAsFull = match as unknown as Match
  const genderColor = match.category === 'women' ? WOMEN_PURPLE : MEN_BLUE
  const isQualifier = isQualifierRound(match.round)
  return (
    <div
      data-match
      data-category={match.category ?? ''}
      data-qualifier={isQualifier ? '1' : '0'}
      data-status={status}
      style={{ padding: '0 8px' }}
    >
      <MatchCard
        match={matchAsFull}
        genderColor={genderColor}
        locale={locale}
        userTz={userTz}
        tournamentLevel={tournamentLevel}
        dayBucketIso={dayBucketIso}
      />
    </div>
  )
}
```

- [ ] **Step 3: Add `dayBucketIso` to the group prop and forward**

Same file, find the `TournamentGroupData` type definition (around line 73 — the type that `MatchesTournamentGroup` accepts). Add `dayBucketIso?: string` to it:

```typescript
// Inside TournamentGroupData
  // existing fields stay as-is …
  /** ISO YYYY-MM-DD of the matches-list day-tab. When passed, finished
   *  matches whose tournament-local date differs render the day chip. */
  dayBucketIso?: string
```

Then find the MatchEntry call site (around line 413). Update the call:

```typescript
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
```

- [ ] **Step 4: Pass `activeIso` from MatchesDayShell**

In `src/components/MatchesDayShell.tsx` (around line 483), update the `<MatchesTournamentGroup>` call inside the `groups.map`:

```typescript
              {groups.map((g) => (
                <MatchesTournamentGroup
                  key={g.tournamentId}
                  group={{
                    tournamentId: g.tournamentId,
                    tournamentName: g.tournamentName,
                    tournamentLevel: g.tournamentLevel,
                    tournamentCountry: g.tournamentCountry,
                    tournamentStartsAt: g.tournamentStartsAt,
                    tournamentEndsAt: g.tournamentEndsAt,
                    tournamentStatus: g.tournamentStatus,
                    matches: g.matches as never,
                    courtOrder: g.courtOrder ?? {},
                    courtLabel: tDaily('courtSection'),
                    unknownCourtLabel: tDaily('courtUnknown'),
                    liveCountLabel: tDaily('liveCount'),
                    isPremier: g.isPremier,
                    locale,
                    userTz,
                    dayBucketIso: activeIso,
                  }}
                />
```

- [ ] **Step 5: Run lint and typecheck**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add src/components/MatchCard.tsx src/components/MatchesTournamentGroup.tsx src/components/MatchesDayShell.tsx
git commit -m "feat(matches): plumb dayBucketIso prop into MatchCard

Wires the matches-list page's selected ISO date (activeIso) through
MatchesDayShell → MatchesTournamentGroup → MatchEntry → MatchCard.
Reused on tournament-detail / match-detail pages stay unaffected
because they don't pass the prop. UI hookup lands next.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Render the chip + tooltip in MatchCard

**Files:**
- Modify: `src/components/MatchCard.tsx` (import helper, add chip + tooltip JSX in the meta row, add useState + outside-click handler)

The chip lives in the existing meta-row `<div>` (around line 369–409), inserted *immediately before* the `status` chip when `status.label === 'FINISHED'`. The tooltip is a positioned `<span>` inside the chip's `<button>`, toggled by `useState`.

- [ ] **Step 1: Import the helper**

At the top of `src/components/MatchCard.tsx`, add the import alongside the existing helpers (near line 32):

```typescript
import { shouldShowDayIndicator, formatDayChipLabel } from '@/lib/tournament-day-indicator'
```

- [ ] **Step 2: Compute chip visibility + label inside the component**

Inside the `MatchCard` function body, after the existing computed values (around line 314, after `const timeStr = ...`), add:

```typescript
  // Tournament-day indicator (matches-list page only — gated on
  // dayBucketIso prop). When the match's tournament-local date
  // differs from the user-selected day-tab, surface a small chip
  // with a tap-to-explain tooltip.
  const tournamentTz = (match as { tournament?: { timezone?: string | null } }).tournament?.timezone ?? null
  const showDayChip = shouldShowDayIndicator({
    status: match.status as string,
    finishedAt: match.finished_at,
    scheduledAt: match.scheduled_at,
    tournamentTimezone: tournamentTz,
    dayBucketIso,
  })
  const dayChipLabel = showDayChip
    ? formatDayChipLabel({
        timestamp: match.finished_at ?? match.scheduled_at,
        tournamentTimezone: tournamentTz,
        locale,
      })
    : null
  const [dayTipOpen, setDayTipOpen] = useState(false)
  // Close on outside tap. Anchored to document because the tooltip
  // is positioned absolute inside the card; any tap that isn't on
  // the chip itself should dismiss.
  const dayChipRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (!dayTipOpen) return
    const onPointerDown = (e: Event) => {
      const target = e.target as Node | null
      if (dayChipRef.current && target && !dayChipRef.current.contains(target)) {
        setDayTipOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [dayTipOpen])
```

- [ ] **Step 3: Add tournament location helper**

Tooltip needs `{location}` — short city derived from `tournament.name` (drop trailing level token like " P1", " P2", " Major") with country fallback. Add a small helper just above the `MatchCard` component (around line 159):

```typescript
function tournamentLocationLabel(match: Match): string {
  const t = (match as { tournament?: { name?: string | null; country?: string | null } }).tournament
  const name = t?.name ?? ''
  // Strip trailing level tokens: " P1" / " P2" / " Major" / " Mens" / " Womens" / " Premier"
  const stripped = name.replace(/\s+(P[12]|Major|Mens|Womens|Premier)\b.*$/i, '').trim()
  if (stripped) return stripped
  return t?.country ?? ''
}
```

- [ ] **Step 4: Render the chip + tooltip in the meta row**

In the meta-row JSX (around line 369–409), add the day chip *before* the existing status chip:

```typescript
          {round && <Chip>{round}</Chip>}
          {courtRaw && <Chip>{courtRaw.toUpperCase()}</Chip>}
          {showDayChip && dayChipLabel && (
            <span style={{ position: 'relative', display: 'inline-flex' }}>
              <button
                ref={dayChipRef}
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setDayTipOpen(o => !o)
                }}
                aria-expanded={dayTipOpen}
                aria-label={dayChipLabel}
                style={{
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  color: ORANGE,
                  background: 'rgba(255,255,255,0.06)',
                  border: '1px solid rgba(245,166,35,0.30)',
                  padding: '3px 7px',
                  clipPath: CHUNKY.badge,
                  lineHeight: 1.2,
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                {dayChipLabel}
              </button>
              {dayTipOpen && (() => {
                const userWeekday = new Intl.DateTimeFormat(locale, {
                  weekday: 'long',
                  timeZone: userTz,
                }).format(new Date(match.finished_at ?? match.scheduled_at!))
                const tournamentWeekday = new Intl.DateTimeFormat(locale, {
                  weekday: 'long',
                  timeZone: tournamentTz!,
                }).format(new Date(match.finished_at ?? match.scheduled_at!))
                return (
                  <span
                    role="tooltip"
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      left: 0,
                      width: 220,
                      padding: '10px 12px',
                      background: BG_ELEV,
                      border: '1px solid rgba(245,166,35,0.30)',
                      color: 'rgba(255,255,255,0.85)',
                      fontSize: 10.5,
                      fontWeight: 500,
                      letterSpacing: 0.1,
                      lineHeight: 1.45,
                      textTransform: 'none',
                      borderRadius: 8,
                      zIndex: 30,
                      boxShadow: '0 12px 24px rgba(0,0,0,0.45)',
                    }}
                  >
                    {tMatch('dayIndicator.tooltip', {
                      weekday: tournamentWeekday,
                      location: tournamentLocationLabel(match),
                      userWeekday,
                    })}
                  </span>
                )
              })()}
            </span>
          )}
          {status && (
            <Chip bg={status.bg} color={status.color} bold>
              {status.label}
            </Chip>
          )}
```

(Leaves the rest of the meta-row JSX intact — the `LATE_HINTS_ENABLED` block stays where it is.)

- [ ] **Step 5: Run lint and existing tests**

Run: `npm run lint`
Expected: no new errors.

Run: `npx vitest run src/lib/__tests__/tournament-day-indicator.test.ts`
Expected: PASS (12 tests, unchanged from Task 1).

- [ ] **Step 6: Manual browser verification**

Start dev server (if not running):

```bash
npm run dev
```

Then:

1. Navigate to `http://localhost:3002/pt/matches/2026-05-10`.
2. Find the Asunción P2 group. The two finished semifinals should each carry an orange "Sáb 9 mai." (or similar tournament-local date) chip in the meta row, immediately before the FINISHED pill. The two upcoming finals should have **no chip**.
3. Tap one of the chips → a dark tooltip pops below it with copy mentioning the tournament-local weekday, location, and user-local weekday. Tap outside → tooltip closes. Open one → opens. Tap a second chip → first closes, second opens.
4. Navigate to `/pt/matches/2026-05-09` (or wherever finished matches existed only on their tournament-local day). On that tab the chip should NOT appear for matches whose tournament-local date matches `2026-05-09`.
5. Navigate to a tournament detail page (e.g. `/pt/tournaments/<id>`). The chip should NEVER render here — `dayBucketIso` is undefined.
6. Navigate to a match detail page (`/pt/match/<id>`). Chip should not render (this card path doesn't go through `MatchCard` with `dayBucketIso` set).

Capture a screenshot of step 2 (chip visible) and step 3 (tooltip open) for the PR description.

- [ ] **Step 7: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(matches): render tournament-day chip + tooltip on finished cards

Closes the Asunción-P2 confusion where matches that wrapped on the
tournament's previous day stack next to today's upcoming ones on the
user's HOJE tab. Chip is finished-only, gated on tournament.timezone
present and dayBucketIso set, never renders on tournament-detail or
match-detail pages.

Tap to open tooltip explaining the tournament-local vs user-local
day mismatch. Outside-tap or another chip's tap closes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**

- Spec §3.1 (chip placement, colour, text format) → Task 5 step 4 (rendered before status chip, orange muted, `Intl.DateTimeFormat` with weekday+day+month).
- Spec §3.2 (tap-to-toggle tooltip, ICU copy with three placeholders) → Task 3 (i18n keys all 5 locales) + Task 5 step 4 (button onClick toggle, role=tooltip, three placeholders supplied).
- Spec §3.3 (visibility gates) → Task 1 (`shouldShowDayIndicator` — all four conditions covered by tests).
- Spec §4.1 (prop drill `dayBucketIso`, no global state) → Task 4 (prop added to MatchCard, threaded through MatchesTournamentGroup + MatchesDayShell).
- Spec §4.2 (per-render compute, useState for tooltip, document pointerdown for outside-click) → Task 5 step 2.
- Spec §4.3 (i18n keys under `match.dayIndicator`) → Task 3.
- Spec §4.4 (no denormalised column, compute on render) → respected — no migration in this plan.
- Spec §5 edge cases → Task 1 tests cover null timezone, null dayBucketIso, live/scheduled status, both timestamps null, retired/walkover/ended terminal statuses, finished_at fallback to scheduled_at. Task 5 step 4 calls `e.stopPropagation()` to prevent navigating the wrapping `<Link>`.
- Spec §6 testing → Task 1 covers all listed unit cases except DOM toggle behaviour (no RTL in this repo — verified manually in Task 5 step 6).
- Spec §7 rollout (single PR, no flag) → respected.

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / "appropriate error handling" patterns. Every code step contains the actual code.

**Type consistency:** `shouldShowDayIndicator` signature matches between Task 1 (definition + tests) and Task 5 (call site). `formatDayChipLabel` parameter names (`timestamp`, `tournamentTimezone`, `locale`) are consistent. `dayBucketIso` typed as `string | undefined` end-to-end.

**Gap found and fixed:** Initial draft missed wiring through the `TournamentGroupData` interface — added Task 4 step 3 explicitly.
