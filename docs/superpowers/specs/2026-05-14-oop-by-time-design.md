# OOP by time — chronological day view — design

**Date:** 2026-05-14
**Status:** approved, ready for plan
**Visual reference:** [`public/mockup-oop-by-time.html`](../../../public/mockup-oop-by-time.html)

## Problem

The `/matches/[date]` page groups each tournament's day into court sub-sections (Center → Court 2 → Court 3), with matches inside each court sorted by `court_order`. The layout was chosen because it mirrors the official OOP page on-site.

Feedback from real users: the court grouping is **complex to scan**. To answer the simple question "what's next today?" the reader has to merge three columns in their head. They'd rather see one chronological list, with finished matches at the bottom.

The current layout lives in [`src/components/MatchesTournamentGroup.tsx`](../../../src/components/MatchesTournamentGroup.tsx) (`courtBuckets` + `CourtSection` rendering, lines 216–477). The MatchCard itself is unchanged in this redesign.

## Scope

**In:**

1. Replace the per-tournament court sub-sections with **one chronological list** of the day's matches.
2. **Live + Upcoming** in the top section, sorted by `scheduled_at` ascending. Live matches stay in their natural time slot — the existing red `LIVE` chip on the card handles emphasis.
3. **Finished** matches in a bottom section under a `FINISHED · N` divider (left-aligned, green, fading line to the right). Finished matches are rendered at ~78 % opacity but always visible (no collapse).
4. On finished match cards: **hide the bookmark/follow star** (irrelevant for completed matches) and **add a duration chip** (`⏱ 1H 47M`) in the metadata chip row.
5. Court name continues to show via the existing court chip on each MatchCard — no info is lost.

**Out:**

- The tournament-detail page (`/tournaments/[id]`) — uses a different round-grouped layout, untouched.
- The home page spotlight + `MatchesTournamentGroup`'s tournament header (flag, name, status pill, count, chevron) — unchanged.
- The MatchCard's internal layout (gender bar, chip row, scores, time stack) — unchanged.
- Per-court live counts in the (now removed) court header — no longer relevant since there are no court sub-sections.
- Sort order of tournaments themselves on the day page — unaffected.

## Behavior

### Sort rules

**Live + Upcoming bucket** (status ∈ {`scheduled`, `warming_up`, `live`, `on_court`, `ended`}):

1. Primary: `scheduled_at` ascending. Null sorts last.
2. Tiebreak (same `scheduled_at`, e.g. two courts at 16:00): `court_order` ascending, then court name (case-insensitive) — gives stable order for OOP simul-starts.

**Finished bucket** (status ∈ {`finished`, `retired`, `walkover`}):

1. Primary: `finished_at` descending — most-recent finish first. This answers "who just finished?" at a glance.
2. Tiebreak: `scheduled_at` descending, then `id` for total order.

### Status flips during the day

When a card's status flips (`scheduled → live → finished`), the parent component re-buckets and re-renders. With `react`'s key-based reconciliation, the card moves position in the DOM — no special transition needed for v1. (The card's own MatchCard subscription is preserved across the move because `MatchCard` is keyed on `match.id`.)

### Finished section divider

```
FINISHED · 3 ─────────────────────────
```

- Label: `Finished` (translated), green (`var(--green)` = `#7ED321`), Bebas Neue display font, `letter-spacing: 2.5px`, uppercase.
- Count badge: green-soft background, monospace, e.g. `3`.
- Line: `linear-gradient(90deg, var(--green-mid), transparent)` — green tint on the left, fades right.
- Hidden when the finished bucket is empty.

### MatchCard changes

Two narrowly-scoped tweaks gated on `status === 'finished' || 'retired' || 'walkover'`:

1. **Hide the `<FollowButton variant="star">`** in the top-right corner. The follow concept doesn't apply once a match is over.
2. **Add a duration chip** in the metadata chip row, positioned after the `FINAL` chip:
   - Format: `Hh Mm` localised (e.g. EN: `1h 47m`, ES: `1h 47m` — same; uppercase rendering is cosmetic via CSS).
   - Inline clock icon (small, muted).
   - Source: `Math.round((finished_at - scheduled_at) / 60_000)` minutes. **Open question** below — see Data section.

### Filter cascade

Today the filter cascade selects `[data-court-section]` to hide an emptied court header. With sub-sections gone, that selector is dead. The cascade still works on `[data-tour-group]` (whole-tournament hide) and `[data-match]` (per-match hide). Drop the `data-court-section` rule from `MatchesFilterClient.tsx`.

## Data

### Duration: where does it come from?

`matches.finished_at` and `matches.scheduled_at` are both `timestamptz` columns on the `matches` table.

- `scheduled_at` is the **planned** start. It can drift from real start (delayed prior match, court swap). Computing duration as `finished_at - scheduled_at` will overstate the match length when the start was late.
- A truer "play duration" needs a `started_at` capture, which we don't have today.

**Plan-time decision:** v1 uses `finished_at - scheduled_at` and labels it `Duration` in the UI. Acceptable because:
- The error is bounded by the inter-match gap (~30 min typical).
- Most matches start on time; the bias is a small overstate, not an order-of-magnitude error.
- Stats integrations (Crionet `match_stats.raw_payload`) sometimes include a `match_duration_minutes` — the implementation plan should check whether to read from there when present, with timestamp delta as the fallback.

If the computed duration is < 20 min or > 4 h, hide the chip (defends against bad data).

### i18n

- `match.duration` namespace key. Format `{hours}h {minutes}m` — same in all 5 locales (it's the universal sports-broadcast format).
- `tournament.finishedDivider` (or similar) for the divider label. Existing `tournament.finished` may suffice — the implementation plan should reuse if it exists.

### Realtime

No new subscription. The day page already subscribes to `matches` row updates and re-fetches the page slice. The bucketing is pure transform on the client — no backend change.

## Files affected

- [`src/components/MatchesTournamentGroup.tsx`](../../../src/components/MatchesTournamentGroup.tsx) — replace `courtBuckets` + `CourtSection` rendering with two sorted lists + a divider component. Drop `courtOrder`, `courtLabel`, `unknownCourtLabel`, `liveCountLabel` from `TournamentGroupData` if no longer used.
- [`src/components/MatchesDayShell.tsx`](../../../src/components/MatchesDayShell.tsx) — stops threading `courtOrder` into the group props (line 520-ish).
- [`src/components/MatchCard.tsx`](../../../src/components/MatchCard.tsx) — conditional star hide; new duration chip render.
- [`src/components/MatchesFilterClient.tsx`](../../../src/components/MatchesFilterClient.tsx) — drop the `data-court-section` cascade rule.
- `src/messages/{en,es,pt,it,fr}.json` — `match.duration` and the divider label keys.
- The fetch query in `fetch-matches-day.ts` (or wherever `tournament_courts.display_order` is joined for `courtOrder`) — drop the join if the only consumer was this view.

## Out-of-scope follow-ups

- "Started at" capture for true play duration. Worth considering as a padelgod enrichment (Crionet often emits a "match_started" event we currently ignore).
- Separate "Now playing" pinned section above the chronological list. Could be added later if user testing shows the natural-position-with-LIVE-chip is missed.
- Time-bucketed sub-sections (`16:00 — 3 matches`) — explicitly rejected during brainstorming as over-structure.
