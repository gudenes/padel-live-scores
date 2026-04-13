# Timezone Display Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Display all match/tournament times in the user's local timezone instead of UTC.

**Architecture:** Vercel's `x-vercel-ip-timezone` header → cookie set in proxy → read in next-intl `getRequestConfig` → all `format.dateTime()` calls auto-use user timezone. Shared format pattern constants centralize the date/time option objects. Raw `Intl.DateTimeFormat` calls migrated to `format.dateTime()`.

**Tech Stack:** next-intl, Next.js 16 proxy, Vercel geo headers

**Spec:** `docs/superpowers/specs/2026-04-13-timezone-display-design.md`

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/proxy.ts` | Modify (lines 96-107) | Add `geo-timezone` cookie from Vercel header |
| `src/i18n/request.ts` | Modify | Read cookie, pass `timeZone` to next-intl |
| `src/lib/format-patterns.ts` | Create | Shared date/time format constants |
| `src/app/components/MatchCard.tsx` | Modify (lines 1-164) | Replace manual tz detection with `format.dateTime()` |
| `src/app/[locale]/match/[id]/page.tsx` | Modify (lines 437-442, 1770) | Replace `Intl.DateTimeFormat` with `format.dateTime()` |
| `src/app/[locale]/player/[id]/page.tsx` | Modify (line 388) | Replace `Intl.DateTimeFormat` with `format.dateTime()` |
| `src/components/nav/SearchOverlay.tsx` | Modify (line 262) | Replace `Intl.DateTimeFormat` with `format.dateTime()` |
| `src/app/[locale]/(app)/matches/page.tsx` | Modify (lines 175-177) | Use shared format constants |
| `src/app/[locale]/(app)/tournaments/[id]/page.tsx` | Modify | Use shared format constants |
| `src/app/[locale]/(app)/home/page.tsx` | Modify | Use shared format constants |
| `src/app/[locale]/(app)/following/page.tsx` | Modify (lines 194, 203) | Use shared format constants |
| `src/components/TournamentSpotlightHero.tsx` | Modify | Use shared format constants |
| `src/components/ResultCard.tsx` | Modify | Use shared format constants |
| `src/app/[locale]/(app)/rankings/page.tsx` | Modify | Use shared format constants |

---

### Task 1: Create shared format patterns

**Files:**
- Create: `src/lib/format-patterns.ts`

- [ ] **Step 1: Create the format patterns file**

```ts
// src/lib/format-patterns.ts
// Centralized date/time format options for use with next-intl's format.dateTime().
// All calls inherit the user's timezone from the global next-intl config.

export const TIME_24H = { hour: '2-digit', minute: '2-digit', hour12: false } as const
export const DATE_SHORT = { day: 'numeric', month: 'short' } as const
export const DATE_WITH_WEEKDAY = { weekday: 'short', day: 'numeric', month: 'short' } as const
export const DATE_WITH_YEAR = { day: 'numeric', month: 'short', year: 'numeric' } as const
export const MONTH_YEAR = { month: 'short', year: 'numeric' } as const
export const WEEKDAY_SHORT = { weekday: 'short' } as const
export const DATE_RANGE = { day: 'numeric', month: 'short' } as const
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/format-patterns.ts
git commit -m "feat: add shared date/time format patterns for consistent formatting"
```

---

### Task 2: Set geo-timezone cookie in proxy

**Files:**
- Modify: `src/proxy.ts` (lines 96-107)

- [ ] **Step 1: Add geo-timezone cookie after the geo-country cookie block**

In `src/proxy.ts`, after the `geo-country` cookie block (line 107), add:

```ts
  // Geo-timezone cookie (IANA timezone from Vercel IP geolocation)
  const timezone = request.headers.get('x-vercel-ip-timezone') ?? ''
  if (timezone) {
    response.cookies.set('geo-timezone', timezone, {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      maxAge: 86400,
    })
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/proxy.ts
git commit -m "feat: set geo-timezone cookie from Vercel IP timezone header"
```

---

### Task 3: Configure next-intl to use the timezone cookie

**Files:**
- Modify: `src/i18n/request.ts`

- [ ] **Step 1: Read cookie and pass timeZone to next-intl config**

Replace the entire file content with:

```ts
// src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server'
import { hasLocale } from 'next-intl'
import { cookies } from 'next/headers'
import { routing } from './routing'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale
  if (!hasLocale(routing.locales, locale)) {
    locale = routing.defaultLocale
  }

  // Read user timezone from geo cookie set by proxy.ts (Vercel x-vercel-ip-timezone header)
  let timeZone = 'UTC'
  try {
    const cookieStore = await cookies()
    timeZone = cookieStore.get('geo-timezone')?.value || 'UTC'
  } catch {
    // cookies() may throw in some edge contexts — fall back to UTC
  }

  return {
    locale,
    timeZone,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
```

- [ ] **Step 2: Verify dev server starts without errors**

Run: `npm run dev`
Expected: Server starts on port 3002 without errors. The cookie won't be set in dev (no Vercel header), so times will use UTC — same as current behavior.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/request.ts
git commit -m "feat: configure next-intl with user timezone from geo-timezone cookie"
```

---

### Task 4: Migrate MatchCard from manual Intl.DateTimeFormat to format.dateTime()

**Files:**
- Modify: `src/app/components/MatchCard.tsx` (lines 1-164)

The MatchCard currently does its own timezone detection via `Intl.DateTimeFormat().resolvedOptions().timeZone` and manual tournament-tz-to-user-tz conversion. With the global next-intl timezone config, this can be simplified.

- [ ] **Step 1: Add next-intl import and format-patterns import**

At the top of `src/app/components/MatchCard.tsx`, add these imports (after the existing `'use client'` directive and other imports):

```ts
import { useFormatter } from 'next-intl'
import { TIME_24H } from '@/lib/format-patterns'
```

- [ ] **Step 2: Add useFormatter() hook inside the component**

Inside the `MatchCard` function component, near the top (with the other hooks), add:

```ts
const format = useFormatter()
```

- [ ] **Step 3: Replace the scheduledTime logic**

Replace the entire `scheduledTime` computed value (lines 132-164) with:

```ts
  const scheduledTime = (() => {
    if (effectiveLabel) {
      const timeMatch = effectiveLabel.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i)
      if (timeMatch) {
        try {
          const tournamentTz = (match as any).tournament?.timezone
          if (!tournamentTz) return effectiveLabel
          let hours = parseInt(timeMatch[1])
          const minutes = parseInt(timeMatch[2])
          const ampm = timeMatch[3].toUpperCase()
          if (ampm === 'PM' && hours < 12) hours += 12
          if (ampm === 'AM' && hours === 12) hours = 0
          const today = new Date().toLocaleDateString('en-CA', { timeZone: tournamentTz })
          const naiveUTC = new Date(`${today}T${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00Z`)
          const tournamentOffset = getTimezoneOffset(tournamentTz, naiveUTC)
          const realUTC = new Date(naiveUTC.getTime() - tournamentOffset * 60000)
          return format.dateTime(realUTC, TIME_24H)
        } catch {
          return effectiveLabel
        }
      }
      return effectiveLabel
    }
    const src = match.scheduled_at ?? match.started_at
    if (!src) return null
    try {
      const d = new Date(src)
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0) return null
      return format.dateTime(d, TIME_24H)
    } catch { return null }
  })()
```

Key changes: `new Intl.DateTimeFormat(undefined, {..., timeZone: userTz}).format(d)` replaced with `format.dateTime(d, TIME_24H)` in both the label-conversion path (line 149) and the direct-time path (line 162). The `getTimezoneOffset` helper is still needed for the schedule_label AM/PM parsing path (converting tournament-local label text to a real UTC Date), but the final formatting step now uses next-intl.

- [ ] **Step 4: Verify build compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: No TypeScript errors related to MatchCard.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/MatchCard.tsx
git commit -m "refactor: migrate MatchCard time formatting to next-intl format.dateTime()"
```

---

### Task 5: Migrate match detail page from Intl.DateTimeFormat to format.dateTime()

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx` (lines 437-442, 1770)

- [ ] **Step 1: Add format-patterns import**

Add at the top of the file with other imports:

```ts
import { TIME_24H, DATE_WITH_WEEKDAY, DATE_SHORT, MONTH_YEAR } from '@/lib/format-patterns'
```

- [ ] **Step 2: Check if useFormatter is already imported and available**

The match detail page is a `'use client'` component. Check if `useFormatter` is already imported from `next-intl`. If not, add it. Then ensure `const format = useFormatter()` is called inside the component.

- [ ] **Step 3: Replace Intl.DateTimeFormat calls at lines 437-442**

Replace:

```ts
  const matchDate = match.started_at ? new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(match.started_at)) : null

  const tz = ((match as any).tournament)?.timezone ?? 'UTC'
  const scheduledAt = (match as any).starts_at as string | null
  const scheduledTimeStr = scheduledAt ? new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).format(new Date(scheduledAt)) : null
  const scheduledDateStr = scheduledAt ? new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(new Date(scheduledAt)) : matchDate
```

With:

```ts
  const matchDate = match.started_at ? format.dateTime(new Date(match.started_at), DATE_WITH_WEEKDAY) : null

  const scheduledAt = (match as any).starts_at as string | null
  const scheduledTimeStr = scheduledAt ? format.dateTime(new Date(scheduledAt), TIME_24H) : null
  const scheduledDateStr = scheduledAt ? format.dateTime(new Date(scheduledAt), DATE_WITH_WEEKDAY) : matchDate
```

Note: the `tz` variable for tournament timezone can be removed from these lines (it was only used by the old Intl.DateTimeFormat calls). Keep it if other code below still references it (check the ScheduledSection component props).

- [ ] **Step 4: Replace Intl.DateTimeFormat at line 1770**

Find:

```ts
      return new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' }).format(d)
```

Replace with:

```ts
      return format.dateTime(d, MONTH_YEAR)
```

Note: This is inside a nested component/function. Ensure `format` from `useFormatter()` is accessible in this scope. If it's a separate component, it will need its own `useFormatter()` call and import.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/match/[id]/page.tsx
git commit -m "refactor: migrate match detail page time formatting to next-intl"
```

---

### Task 6: Migrate player profile page

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` (line 388)

- [ ] **Step 1: Add imports**

Add at the top:

```ts
import { DATE_WITH_YEAR } from '@/lib/format-patterns'
```

Ensure `useFormatter` is imported from `next-intl` and `const format = useFormatter()` is called in the component.

- [ ] **Step 2: Replace Intl.DateTimeFormat at line 388**

Find:

```ts
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso))
```

Replace with:

```ts
  return format.dateTime(new Date(iso), DATE_WITH_YEAR)
```

Note: If this is a standalone helper function outside a component, it can't use hooks. In that case, accept `format` as a parameter: `function formatDate(format: ReturnType<typeof useFormatter>, iso: string)` — or inline the call at the call site instead.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/player/[id]/page.tsx
git commit -m "refactor: migrate player profile date formatting to next-intl"
```

---

### Task 7: Migrate SearchOverlay

**Files:**
- Modify: `src/components/nav/SearchOverlay.tsx` (line 262)

- [ ] **Step 1: Add imports**

Add:

```ts
import { useFormatter } from 'next-intl'
import { DATE_SHORT } from '@/lib/format-patterns'
```

Add `const format = useFormatter()` inside the component.

- [ ] **Step 2: Replace Intl.DateTimeFormat at line 262**

Find:

```ts
        const date = matchDate ? new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short' }).format(new Date(matchDate)) : ''
```

Replace with:

```ts
        const date = matchDate ? format.dateTime(new Date(matchDate), DATE_SHORT) : ''
```

- [ ] **Step 3: Commit**

```bash
git add src/components/nav/SearchOverlay.tsx
git commit -m "refactor: migrate SearchOverlay date formatting to next-intl"
```

---

### Task 8: Update existing format.dateTime() calls to use shared patterns

**Files:**
- Modify: `src/app/[locale]/(app)/matches/page.tsx`
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`
- Modify: `src/app/[locale]/(app)/home/page.tsx`
- Modify: `src/app/[locale]/(app)/following/page.tsx`
- Modify: `src/components/TournamentSpotlightHero.tsx`
- Modify: `src/components/ResultCard.tsx`
- Modify: `src/app/[locale]/(app)/rankings/page.tsx`

This is a mechanical find-and-replace across files that already use `format.dateTime()` but with inline option objects.

- [ ] **Step 1: Add format-patterns imports to each file**

Add the appropriate imports to each file. Example for matches page:

```ts
import { TIME_24H, DATE_SHORT } from '@/lib/format-patterns'
```

Each file needs only the patterns it uses.

- [ ] **Step 2: Replace inline format options with constants**

Apply these replacements across all files:

| Inline pattern | Constant |
|---|---|
| `{ hour: '2-digit', minute: '2-digit', hour12: false }` | `TIME_24H` |
| `{ day: 'numeric', month: 'short' }` | `DATE_SHORT` |
| `{ weekday: 'short', day: 'numeric', month: 'short' }` | `DATE_WITH_WEEKDAY` |
| `{ month: 'short', year: 'numeric' }` | `MONTH_YEAR` |
| `{ weekday: 'short' }` | `WEEKDAY_SHORT` |
| `{ hour: '2-digit', minute: '2-digit' }` (without hour12) | `TIME_24H` |

Example — `src/app/[locale]/(app)/matches/page.tsx` line 175:

Before: `format.dateTime(d, { hour: '2-digit', minute: '2-digit', hour12: false })`
After: `format.dateTime(d, TIME_24H)`

- [ ] **Step 3: Verify build compiles**

Run: `npm run build 2>&1 | tail -20`
Expected: No TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/(app)/matches/page.tsx src/app/[locale]/(app)/tournaments/[id]/page.tsx src/app/[locale]/(app)/home/page.tsx src/app/[locale]/(app)/following/page.tsx src/components/TournamentSpotlightHero.tsx src/components/ResultCard.tsx src/app/[locale]/(app)/rankings/page.tsx
git commit -m "refactor: use shared format patterns across all date/time displays"
```

---

### Task 9: Final build verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: No new lint errors.

- [ ] **Step 3: Visual verification**

Open `http://localhost:3002/es/matches` and verify times display correctly. On local dev, times will show in the dev machine's timezone (no Vercel header = UTC fallback unless cookie is manually set).

To test with a specific timezone, set the cookie manually in browser devtools:
```
document.cookie = 'geo-timezone=Europe/Madrid; path=/'
```
Then reload — times should shift to Madrid timezone.

- [ ] **Step 4: Commit any remaining fixes**

If any issues found, fix and commit.
