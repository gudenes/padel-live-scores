# Tournament Carousel — add upcoming events (next 7 days)

**Date:** 2026-05-26
**Status:** Design approved, awaiting plan

## Goal

Extend the home page's `LiveTournamentsCarousel` (currently scoped to tournaments running **today**) to also surface tournaments **starting within the next 7 days**. Mixed today + upcoming cards share the same comparator: tier-first (`levelTierWeight`), tiebroken by `starts_at` ASC. Cap visible cards at 10 so a busy FIP-Bronze week doesn't drown out the marquee events.

## Why

The carousel exists to advertise what's worth opening the app for *right now*. "Right now" turns out to be too narrow:

- Tournaments often start mid-day in a different timezone — a Premier P1 beginning tomorrow morning Madrid time should be visible today.
- Quiet days (one or two events running) leave the carousel feeling sparse despite a packed week ahead.
- Users navigating to `/tournaments` immediately afterwards prove the discovery intent is "what's coming," not just "what's live."

Widening to a 7-day window addresses all three without breaking the existing live-today behavior.

## Rule

Single combined query window. A tournament appears in the carousel iff:

```
starts_at  ≤  now + 7 days
ends_at    ≥  start-of-today (user local, expressed in UTC)
```

That covers both buckets:

| State | `starts_at` | `ends_at` |
|---|---|---|
| Running today | in past, ≤ now+7d ✓ | future, ≥ today-midnight ✓ |
| Starts in next 7 days | future, ≤ now+7d ✓ | always future ✓ |
| Already ended | irrelevant | < today-midnight ✗ — excluded |
| Starts in 10 days | > now+7d ✗ — excluded | irrelevant |

The premier-first behavior the user asked for already falls out of the **existing** `levelTierWeight()` ranking (Finals 0 / Major 1 / P1 2 / P2 3 / FIP Platinum 4 / FIP Gold 5 / Hexagon 6 / FIP Finals 8 / Silver 10 / Bronze 12 / Star 14 / Rise 15 / Promotion 16 / Promises 20 / Beyond 22 / other 25). No comparator change needed — a Premier P1 starting in 5 days outranks a FIP Platinum running today, exactly as requested.

After sort, the list is sliced to the **top 10** in `home/page.tsx`. Overflow is absorbed by the existing "Todos los eventos" link, which points at the full Tournaments page.

## Card states

`TournamentCarouselCard` ([src/components/home/LiveTournamentsCarousel.tsx:26](../../../src/components/home/LiveTournamentsCarousel.tsx)) gains one new branch — *not yet started*. Three states total:

| Tournament state | LIVE chip | Status line key | Example |
|---|---|---|---|
| Started, matches today | shown | `matchesTodayCount` (existing) | "24 partidos hoy" |
| Started, no matches today | hidden | `restDay` (existing) | "Día de descanso" |
| Not yet started, ≥ 2 days out | hidden | `startsInDays` (new, ICU plural) | "Empieza en 3 días" |
| Not yet started, 1 day out | hidden | `startsTomorrow` (new) | "Empieza mañana" |
| Not yet started, starts today | hidden | `startsToday` (new) | "Empieza hoy" |

"Has the tournament started?" check runs client-side from the same `starts_at` field already on the row: `new Date(starts_at) <= new Date()`.

Day-countdown derivation: floor the diff of (start-of-tournament-start-day) − (start-of-today) in user-local-time to whole days. The carousel utils get a small helper for this so test coverage is meaningful around local-midnight transitions.

Card layout is **otherwise byte-identical** — no dimming, no new chip in the LIVE slot, no different gradient. The status-line text alone communicates the difference, leaning on existing affordances.

## Code changes

### `src/lib/live-tournaments-carousel.ts`

New pure helper:

```ts
export function daysUntilStart(startsAt: string, now: Date = new Date()): number {
  // Returns whole-day diff in user-local time.
  //   0  → starts today (incl. earlier today, even if already started)
  //   1  → starts tomorrow
  //   N  → starts in N days
  //  -1+ → started in the past (caller branches on this; the card uses
  //        `daysUntilStart <= 0 && hasStarted` to mean "running today")
  // ...
}
```

Plus a `hasStarted(startsAt, now)` predicate or inlined equivalent — whichever reads cleaner in the card.

`compareTournamentsForCarousel` is **unchanged**. The existing tier-weight + `starts_at` tiebreak already produces the desired order.

### `src/components/home/LiveTournamentsCarousel.tsx`

The card's status-line resolution becomes:

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

The LIVE chip conditional also gates on `started`:

```tsx
{started && tournament.matchesToday > 0 && (<LIVE chip />)}
```

(Today the conditional is just `tournament.matchesToday > 0`. For not-yet-started tournaments `matchesToday` will be `0` anyway because the match-count query is windowed to today — but the explicit `started` gate keeps intent obvious to future readers.)

### `src/app/[locale]/(app)/home/page.tsx`

Two changes in the carousel-live-today fetch block (lines ~311–319):

```ts
// Before
.lte('starts_at', new Date().toISOString())
.gte('ends_at',   <today-midnight>.toISOString())
.limit(20)

// After
.lte('starts_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
.gte('ends_at',   <today-midnight>.toISOString())
.limit(40)
```

And after sort, slice to 10 before `setCarouselLiveToday`:

```ts
setCarouselLiveToday(decorate(carouselLiveRows).slice(0, 10))
```

The match-counts query at lines 320–330 is **unchanged**. It only counts matches scheduled in today's local-day window; upcoming-card rows just get `matchesToday: 0`, which the card now handles via the `started` branch above.

### i18n — 5 locales

Under `home.liveTournaments` in [src/messages/{en,es,pt,it,fr}.json](../../../src/messages/):

```jsonc
"startsToday":    "Starts today",                                                                           // en
"startsTomorrow": "Starts tomorrow",
"startsInDays":   "{count, plural, one {Starts in # day} other {Starts in # days}}"
```

Spanish (ES): `Empieza hoy` / `Empieza mañana` / `{count, plural, one {Empieza en # día} other {Empieza en # días}}`
Portuguese (PT): `Começa hoje` / `Começa amanhã` / `{count, plural, one {Começa em # dia} other {Começa em # dias}}`
Italian (IT): `Inizia oggi` / `Inizia domani` / `{count, plural, one {Inizia tra # giorno} other {Inizia tra # giorni}}`
French (FR): `Commence aujourd'hui` / `Commence demain` / `{count, plural, one {Commence dans # jour} other {Commence dans # jours}}`

All three keys ship in the same PR per the [translation-context feedback rule](../../../.claude/projects/-Users-GuDenes-Projects-padel-live-scores/memory/feedback_translation_context.md).

### Tests — `src/lib/__tests__/live-tournaments-carousel.test.ts`

Add coverage for:

1. **Mixed-tier sorting across the widened window**
   - Premier P1 starting in 5 days outranks FIP Platinum running today
   - Premier P2 starting today outranks FIP Gold starting in 1 day
   - Two FIP Bronze events, one today, one in 3 days → today first (tiebreak via `starts_at` ASC)

2. **`daysUntilStart` boundary cases**
   - `starts_at` = today 18:00 local, now = today 09:00 local → returns 0
   - `starts_at` = tomorrow 06:00 local, now = today 23:30 local → returns 1
   - `starts_at` = today 06:00 local, now = today 23:30 local → returns 0 (started earlier today)
   - `starts_at` = 7 days from now → returns 7
   - DST transition (spring forward) doesn't drift the count off by 1

3. **`hasStarted` predicate**
   - `starts_at` = now − 1ms → true
   - `starts_at` = now + 1ms → false

The existing `compareTournamentsForCarousel`, `buildMatchInfoMap`, and `getLocalDayBoundaryUTC` tests stay intact. Final count: 11 existing + ~8 new = ~19 tests.

## Trade-offs accepted

- **No cap awareness for the user.** If the 11th-best tournament gets cut, the only path to it is the "Todos los eventos" link. The header already advertises that link, so this is acceptable. A "+N more" indicator would be over-engineering for the carousel format.
- **Day-countdown granularity is whole-day, not hour-aware.** A tournament starting in 12 hours and a tournament starting in 30 hours both read "Starts tomorrow." Hour precision would add noise without paying off — the user opens the app daily anyway.
- **`matchesToday` is still queried for upcoming-card rows** and ignored. Cheap (single aggregate query against `matches.scheduled_at` within today's local window) so not worth optimising.
- **A tournament that ends *today* but had its last match yesterday** stays in the list (current behavior — `ends_at ≥ today-midnight` keeps it). Status line will read "Rest day" since `matchesToday === 0`. Acceptable.

## What this is NOT

- Not a change to `compareTournamentsForCarousel` or `levelTierWeight`
- Not a change to the carousel's section title, "Todos los eventos" link, or feature flag
- Not a change to the TournamentsView page, spotlight tournament picker, or any other home-page surface
- Not a change to the card's visual treatment (no dimming, no new chip, no separate gradient for upcoming)
- Not a new chip or pill — the LIVE chip is the only chip; its absence is the only signal of "not happening yet"
- Not a DB migration, env var, or new dependency

## Open questions

None.

## Implementation surface

Touched files:
- `src/lib/live-tournaments-carousel.ts` — add `daysUntilStart` (and optional `hasStarted`) helpers
- `src/lib/__tests__/live-tournaments-carousel.test.ts` — extend with mixed-window sort + day-countdown tests
- `src/components/home/LiveTournamentsCarousel.tsx` — card status-line branch + LIVE-chip gate
- `src/app/[locale]/(app)/home/page.tsx` — widen `starts_at` filter, bump raw limit, post-sort `.slice(0, 10)`
- `src/messages/{en,es,pt,it,fr}.json` — three new keys under `home.liveTournaments`

No DB migration, no env vars, no new dependencies, no padelgod work, no API changes.
