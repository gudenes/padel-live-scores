# Timezone Display Fix — Design Spec

**Date:** 2026-04-13
**Status:** Approved

## Problem

Match times display as UTC on production (Vercel SSR) instead of the user's local timezone. A match at 07:00 UTC shows "07:00" instead of "09:00" for a user in Spain (UTC+2).

**Root cause:** `format.dateTime()` from next-intl has no `timeZone` configured. On Vercel servers (UTC), all times render in UTC. On local dev, they render in the developer's system timezone — masking the bug.

**Secondary issue:** Time formatting is inconsistent — some files use `format.dateTime()` (next-intl), others use raw `Intl.DateTimeFormat` with manual timezone detection. Timezone logic is scattered across components.

## Decision

- Times always display in the **user's local timezone** (not UTC, not tournament timezone)
- User timezone detected via Vercel's `x-vercel-ip-timezone` header
- Fallback to UTC if header is absent (local dev, non-Vercel)

## Design

### 1. Proxy layer — `src/proxy.ts`

Read `x-vercel-ip-timezone` header from Vercel. Set a `geo-timezone` cookie with the IANA timezone string (e.g. `Europe/Madrid`). Same pattern as the existing `geo-country` cookie:

- `httpOnly: false`
- `sameSite: 'lax'`
- `path: '/'`

If the header is missing, don't set the cookie.

### 2. next-intl config — `src/i18n/request.ts`

Read the `geo-timezone` cookie in `getRequestConfig`. Pass it as the `timeZone` property:

```ts
return {
  locale,
  timeZone: geoTimezone || 'UTC',
  messages: (await import(`../messages/${locale}.json`)).default,
}
```

This makes every `format.dateTime()` call across the app automatically use the user's timezone.

### 3. Shared format patterns — `src/lib/format-patterns.ts` (new file)

Centralize common date/time format options so every call site uses consistent presets:

```ts
export const TIME_24H = { hour: '2-digit', minute: '2-digit', hour12: false } as const
export const DATE_SHORT = { day: 'numeric', month: 'short' } as const
export const DATE_WITH_WEEKDAY = { weekday: 'short', day: 'numeric', month: 'short' } as const
export const DATE_RANGE_SHORT = { day: 'numeric', month: 'short' } as const
export const WEEKDAY_SHORT = { weekday: 'short' } as const
```

Usage: `format.dateTime(d, TIME_24H)` — DRY, consistent, one place to change formatting app-wide.

### 4. Migrate all time formatting to `format.dateTime()` + shared patterns

Replace all raw `Intl.DateTimeFormat` calls that format user-visible match/tournament times with `format.dateTime()` using the shared patterns. This ensures one timezone source (next-intl config) and one formatting approach.

**Files to migrate** (raw `Intl.DateTimeFormat` → `format.dateTime()`):

| File | What changes |
|------|-------------|
| `src/components/MatchCard.tsx` | Remove manual `Intl.DateTimeFormat` + `userTz` detection. Use `format.dateTime(d, TIME_24H)` |
| `src/app/[locale]/match/[id]/page.tsx` | Replace `Intl.DateTimeFormat` calls for `scheduledTimeStr`/`scheduledDateStr`/`matchDate` with `format.dateTime()` |
| `src/app/[locale]/player/[id]/page.tsx` | Replace `Intl.DateTimeFormat` for match dates |

**Files already using `format.dateTime()` (just update to shared patterns):**

| File | Calls |
|------|-------|
| `src/app/[locale]/(app)/matches/page.tsx` | Lines 175, 177, 473-474 |
| `src/app/[locale]/(app)/tournaments/[id]/page.tsx` | Lines 419-420, 710, 712, 1006, 1008, 1489 |
| `src/app/[locale]/(app)/home/page.tsx` | Lines 142, 494-497, 892-897, 1554 |
| `src/app/[locale]/(app)/following/page.tsx` | Lines 194, 203 |
| `src/components/TournamentSpotlightHero.tsx` | Line 192 |
| `src/components/ResultCard.tsx` | Line 110 |
| `src/components/nav/SearchOverlay.tsx` | Lines 32-33, 262 |
| `src/app/[locale]/(app)/rankings/page.tsx` | Line 322 |
| `src/app/[locale]/(app)/padelgenius/components/HubView.tsx` | Line 179 |
| `src/app/[locale]/(app)/padelgenius/components/SummaryView.tsx` | Line 49 |

### 5. What we DON'T change

- **API routes** — server-side formatting already uses explicit timezones where needed
- **Countdown logic** — timezone-agnostic (just a delta from `now`)
- **`hasTime` guards** — the midnight-UTC check (`d.getUTCHours() === 0 && d.getUTCMinutes() === 0`) stays as-is since it's checking the DB value, not displaying

## Testing

- Verify on production (Vercel) that times show in local timezone, not UTC
- Verify on local dev that times still render correctly (will use UTC fallback unless cookie is manually set)
- Check matches page, tournament detail, home page, following page, match detail, player profile
- Verify date-only matches still show no time (hasTime guard)
