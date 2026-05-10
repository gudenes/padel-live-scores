# Tournament-Day Indicator on Finished Matches

**Status:** Design (approved)
**Author:** Claude (with @GuDenes brainstorming session 2026-05-10)
**Mockup:** [`public/mockup-finished-collapse.html`](../../../public/mockup-finished-collapse.html) (mode: **C · day indicator**)

## 1. Goal

When the matches-list day-tab shows finished matches whose tournament-local date differs from the user-selected date, render a small chip on the finished match card that surfaces the tournament-local short date — and on tap, a one-line tooltip explains *why* the user is seeing that match under "today."

This addresses the timezone-shift confusion the user observed on `/pt/matches/2026-05-10`: Asunción P2 finals (upcoming, tonight) were stacked next to Asunción semifinals that had wrapped up overnight in user-local time but were the *previous day's* session in Asunción's timezone. The day-tab is a user-local construct (`/matches/[date]` with `date` interpreted in `geo-timezone`), but tournament narrative ("Saturday's semifinals") is tournament-local. The chip closes that gap inline, without hiding data or breaking the existing layout.

## 2. Out of scope

- Changing the user-TZ-only display rule. Times always render in user TZ. The chip surfaces a *date*, not a time, in the tournament TZ.
- Day-tab bucketing changes. Matches still bucket into the user's calendar day, same as today.
- Live/scheduled/upcoming matches. The chip is finished-only. Live matches don't need it (they're happening *right now* in both timezones), and scheduled-future matches' time column already carries the date.
- Cross-tournament-day rendering on tournament detail pages, match detail page, or the home carousels — these don't have user-day-tabs to disagree with. Out of scope for v1.
- Approach B+A (collapse + dim). Discarded in favor of this lighter-weight approach.

## 3. UX

### 3.1 The chip

Placement: in the `match-meta` row inside `<MatchCard>` (the row that holds round name + court badge + status pill), *immediately to the left of the FINISHED pill*.

Visual: small uppercase pill matching the existing badge family. Colour is muted-orange to land "soft attention" — visible but not loud. Locked in mockup mode C after the dot was removed:

- background: `rgba(255,255,255,0.06)`
- border: `1px solid rgba(245,166,35,0.30)` (orange at 30%)
- text: `var(--orange)` = `#F5A623`
- text content: tournament-local short weekday + day + month, locale-formatted. e.g. `Sáb 9 mai.` (pt), `Sat 9 May` (en), `Sáb 9 mayo` (es).

Cursor: pointer. Hit target ≥ 32px tall via padding.

### 3.2 The tooltip

Trigger: tap the chip. Single-tap toggles open; tap outside or on another chip closes it. No hover behavior — the trigger is touch-first.

Position: anchored to the chip, opens *below* with a small caret pointing up-right. Width capped at 220px so it sits inside the card. On the mockup the tooltip lives inside the chip as a positioned `<span>`; production should use the same in-tree positioning to avoid portal/z-index gymnastics.

Copy (i18n, all 5 locales):

> Disputada no **{weekday}**, hora local do torneio ({tournament_city}). Aparece neste dia porque no seu fuso a partida terminou já no **{user_weekday}**.

- `{weekday}` — full tournament-local weekday name (e.g. *sábado*).
- `{tournament_city}` — `tournament.name` is unreliable as a city ("Asuncion P2" works; "FIP Silver Mendoza" works; "Hexagon Cup" doesn't). Use `tournament.country` short form as the safe fallback ("Paraguai", "Argentina"). v1: prefer parsing the leading city from `tournament.name` if it ends in a level token (`P1`/`P2`/etc.), else fall back to country. v1.1 can add a dedicated `tournament.city` if needed.
- `{user_weekday}` — full user-local weekday for `match.finished_at` (e.g. *domingo*).

Translation keys live under a new `match.dayIndicator` namespace in `src/messages/{en,es,pt,it,fr}.json`. The chip text itself is constructed via `format.dateTime(finishedAt, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tournament.timezone })` — no translation key needed, `Intl` handles it.

### 3.3 When the chip appears

Show iff **all** of the following:

1. `bucketStatus(match.status) === 'finished'`
2. `match.tournament.timezone` is non-null
3. `match.finished_at` (or `scheduled_at` as fallback) formatted with `tournament.timezone` produces a different `YYYY-MM-DD` than the user-selected day-tab date (`iso` from the `[date]` segment of the route).

If `tournament.timezone` is null, gracefully render no chip — do not guess from `country`. v1.1 can backfill timezones from `country` for tournaments that lack them; that's a data-quality task, not a UX feature.

## 4. Architecture

### 4.1 Where the comparison runs

`MatchesTournamentGroup.tsx` already receives `userTz` and the user-selected date (`iso` is passed via the page component). The tournament timezone is on `match.tournament.timezone`, already in the row shape (used by `MatchCard.tsx` line 142 for "Not before" label conversion).

The day-mismatch check is cheap (one `Intl.DateTimeFormat.format()` per finished match) and stable for the lifetime of the page render. We do it once, when each finished match is being rendered, inside `MatchCard.tsx`.

New props or context: none. We need the page's selected `iso` date inside the card. Two options:

- **A. Prop drill** — `MatchesTournamentGroup` already receives the day's matches; pass `selectedIso` down through the group → into `<MatchCard>` as a new optional prop. Local, explicit, no global state.
- **B. Read from URL** — `MatchCard` is reused across pages (match detail, tournament detail, etc.). It can't unconditionally read `[date]` from `usePathname` because most consumers aren't on that route.

Pick **A**. `MatchCard`'s new prop is `dayBucketIso?: string`. When undefined, no chip ever renders — preserves existing behaviour everywhere `MatchCard` is used outside the matches-list page.

### 4.2 Card render

```tsx
// inside MatchCard.tsx, near the existing finished-pill render
const showDayChip = (() => {
  if (!dayBucketIso) return false
  if (bucketStatus(match.status) !== 'finished') return false
  const tz = match.tournament?.timezone
  if (!tz) return false
  const ref = match.finished_at ?? match.scheduled_at
  if (!ref) return false
  const tournamentDay = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(ref))
  return tournamentDay !== dayBucketIso
})()

const dayChipLabel = showDayChip
  ? format.dateTime(new Date(match.finished_at ?? match.scheduled_at!), {
      weekday: 'short', day: 'numeric', month: 'short',
      timeZone: match.tournament!.timezone!,
    })
  : null
```

Tooltip state lives in `useState<boolean>` on the card. Outside-click handler attached at component scope via a `useEffect` listening on `document` for `pointerdown`. Tap the chip → toggle. Tap anywhere else → close.

### 4.3 i18n keys

`src/messages/{en,es,pt,it,fr}.json`:

```json
"match": {
  "dayIndicator": {
    "tooltip": "Disputada no {weekday}, hora local do torneio ({location}). Aparece neste dia porque no seu fuso a partida terminou já no {userWeekday}."
  }
}
```

ICU placeholders for the three slots. Each locale gets a properly-translated equivalent. The location slot is sourced as described in §3.2.

### 4.4 Why not a stored field

We considered storing `match.tournament_local_date` denormalized on the match row to avoid the per-render TZ conversion. Rejected: `Intl.DateTimeFormat` for one timestamp is sub-millisecond, the comparison is at most ~30 finished matches per group on a busy day-tab, and adding a derived column introduces a sync hazard with `tournament.timezone` updates. Compute on render.

## 5. Edge cases

- **Tournament timezone null** → no chip. Most likely on FIP-tier tournaments not yet enriched. Acceptable v1 gap.
- **`finished_at` null** (status flipped to `finished` without a timestamp — happens on stale-cleanup paths) → fall back to `scheduled_at`. If both null, no chip.
- **Same user-selected and tournament-local date** → no chip. The common case.
- **Tournament-local date is *after* user-selected** (rare — only when a user in Asia views a Pacific tournament) → chip still renders with the actual tournament-local date. Tooltip copy reads naturally either direction ("terminou já no domingo" vs. "terminou já no sábado"); the locale weekday strings handle past/future symmetrically.
- **Multiple chips open at once** → last-tap-wins; opening one closes the rest. Outside-tap closes all.
- **Card is wrapped in `<Link>` to match detail** — chip tap must `e.stopPropagation()` to prevent navigation. Same pattern as the YouTube stream button (existing precedent in `MatchCard`).

## 6. Testing

- Unit test in `src/app/components/__tests__/MatchCard.test.tsx`:
  - Renders no chip when `dayBucketIso` is undefined.
  - Renders no chip when status is `live` / `scheduled`.
  - Renders no chip when `tournament.timezone` is null.
  - Renders chip when tournament-local date < user-selected date.
  - Renders chip when tournament-local date > user-selected date.
  - Renders no chip when dates match.
  - Tap toggles tooltip; outside tap closes.
- Visual: existing matches-list snapshot tests update to include the chip on the Asunción reproducer fixture.

## 7. Rollout

Single PR; no flag. The chip is purely additive — every render path that doesn't pass `dayBucketIso` stays identical.

## 8. Future

- v1.1: backfill `tournament.timezone` from `country` for the long tail of FIP-tier tournaments missing it. Separate data-quality task.
- v1.2: extend the same chip to *upcoming* matches when their tournament-local date differs from the user-selected day. Lower priority — upcoming match rows already show a date next to their time, so the disagreement is less invisible than on finished matches.
