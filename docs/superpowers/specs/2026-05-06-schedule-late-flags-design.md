# Schedule late-flags — design

**Date:** 2026-05-06
**Status:** Approved (brainstorming)

## Background

Today every match in a court's chain whose schedule label is "Followed by" is assigned `scheduled_at = previous_match_anchor + 90 minutes` ([`oop-schedule-parser.ts:29`](padelgod/src/lib/oop-schedule-parser.ts:29)). The 90-minute constant is a flat baseline. When a real match runs ~2 hours, every downstream time on the same court is wrong by ~30 minutes, and the error compounds: court 1's third match might display 18:30 while reality is closer to 20:00.

The user identified that the *baseline* is acceptable as a safe-side estimate, but we have no feedback loop to incorporate signals when reality diverges. For tournaments with live coverage (Premier with Crionet widgets) we can detect divergence almost in real time via padelgod's live-poller. For FIP-only tournaments without live polling, divergence becomes visible at the 5-minute results-fetcher cadence.

We need to communicate that uncertainty without pretending we know more than we do.

## Goals

1. When a match's predecessor on the same court is running over its expected duration, the user sees a small "may be late" hint next to the match's time.
2. When a match's predecessor has finished and this match is the next one up, the user sees a "starting soon" hint.
3. The hint cascades down the chain: if B is late, C inherits "may be late" automatically.
4. Hints are tappable. Tap reveals a short info sheet explaining what's happening; no specific minute predictions in the copy.
5. FIP-only tournaments (no live signal) carry a permanent "EST" chip in the chip row to set expectations.
6. Localised across all 5 locales (en/es/pt/it/fr).

## Non-goals

- **No time push.** We never overwrite `scheduled_at` to reflect estimated overrun. The original time stays in the green time slot. The previous design that shifted times to `previous.finished_at + gap` is rejected — even after a match finishes, the next match's actual start is unknown until it goes `on_court` or `live`, both of which we already track.
- **No specific-minute predictions** anywhere in the UI. "Up to 30 min later" is fragile and erodes trust when wrong. Copy is qualitative.
- **No category-aware expected-duration calibration in v1.** The expected duration is a single configurable constant (default 90 min). Calibration per gender/round/tier is deferred until we have more data.
- **No new schedule-recompute trigger on relay events.** The relay/Pusher path is no longer the source of live state — padelgod owns it. The only trigger needed is the periodic worker (every 1–2 min).
- **No changes to the OOP chain math.** [`parseOopScheduledAtBatch`](padelgod/src/lib/oop-schedule-parser.ts:128) keeps using its 90-min baseline. The hint system is layered on top, never overwriting `scheduled_at`.

## Scope

Applies to any match whose schedule comes via Crionet OOP — most FIP tournaments, most Premier P1/P2 events with widgets. Padelapi-direct schedule (matches with explicit `played_at` from padelapi.org and no widget) is unaffected.

## User flow

```
User opens the matches list at 4 PM
  → Court 1's match A is live, has been on court 105 minutes (over the 90-min baseline)
  → Match B (scheduled 17:00) renders with "may be late" hint under the 17:00 time
  → Match C (scheduled 18:30) renders with "may be late" hint (inherited from B's delayed state)

A finishes at 17:30
  → padelgod live-poller writes status='finished' on A
  → schedule-hints worker runs within 1–2 min, recomputes per-court hints
  → B's hint flips: "starting soon" (green) — A is done, B is next
  → C still shows "may be late" — B's scheduled_at (17:00) has passed but B hasn't started yet

B is called to court at 17:45
  → live-poller writes status='on_court' on B
  → MatchCard's existing chip-row logic shows "ON COURT" chip; the hint disappears
  → C now looks at B (its predecessor). B is on_court, not delayed — C still has "may be late"
    if B's scheduled_at hasn't been honoured yet, otherwise the hint clears

B goes live at 17:50
  → "LIVE" chip on B (existing); hint stays cleared
  → C's hint depends on B's elapsed live time vs expected

User taps "may be late" or "starting soon" hint
  → Small info sheet pops next to the time, ~3.5s auto-dismiss
  → Copy is qualitative: "The previous match on Pista Central is running long. We'll update as soon as it ends."
```

## Architecture

### Component overview

```
┌──────────────────────────┐         ┌──────────────────────────┐
│ padelgod live-poller     │         │ padelgod fip-results-    │
│ (every ~1 min)           │         │ writer (every 5 min)     │
│ writes match.status,     │         │ writes match.status,     │
│ started_at, finished_at  │         │ finished_at              │
└────────────┬─────────────┘         └────────────┬─────────────┘
             │                                    │
             └────────────────┬───────────────────┘
                              ▼
              ┌────────────────────────────────────┐
              │ public.matches                     │
              │ + status, started_at, finished_at  │
              │ + late_hint (NEW)                  │
              └────────────────┬───────────────────┘
                               ▲
              ┌────────────────┴───────────────────┐
              │ padelgod schedule-hints worker     │
              │ (NEW, every 2 min)                 │
              │ • walks each active court's chain  │
              │ • computes late_hint per match     │
              │ • UPDATEs late_hint column         │
              └────────────────────────────────────┘
                               │
                               ▼
              ┌────────────────────────────────────┐
              │ Vercel SSR / API                   │
              │ reads late_hint from public.matches│
              │ passes through to MatchCard        │
              └────────────────────────────────────┘
                               │
                               ▼
              ┌────────────────────────────────────┐
              │ MatchCard (React)                  │
              │ • renders hint under time          │
              │ • tap → info sheet                 │
              └────────────────────────────────────┘
```

### Data model

One new column on `public.matches`:

```sql
ALTER TABLE public.matches
  ADD COLUMN late_hint TEXT NULL
    CHECK (late_hint IN ('may_be_late', 'starting_soon'));

CREATE INDEX idx_matches_late_hint
  ON public.matches (late_hint)
  WHERE late_hint IS NOT NULL;
```

Values:
- `'may_be_late'` — predecessor is running over expected duration, OR this match is itself delayed (scheduled time has passed and it hasn't gone on_court/live).
- `'starting_soon'` — predecessor has finished and this match is the immediate next on the court, still in `scheduled` status.
- `NULL` — no hint to render (default).

The column is **only relevant for matches in `scheduled` status**. Once a match goes `on_court` / `live` / terminal, the existing chip-row logic in MatchCard takes over and the hint is hidden in the UI even if the column hasn't been cleared yet. The schedule-hints worker resets the column to NULL when a match leaves `scheduled` status.

Chosen over alternatives:
- **Two booleans** — adds redundancy; the states are mutually exclusive.
- **Computed at read time** — every API/SSR consumer would walk the court chain on each request. Caching helps but adds infra. The column is cheap and the worker cadence (every 2 min) is the same window the existing fip-oop-writer already accepts for OOP updates.

### Hint computation rules

The worker walks each court+day group in `court_order` ascending. As it walks, it maintains a single piece of state per group: the most recent **chain delay state**, which is one of `clear` | `running_over` | `delayed` | `just_finished`. Each match's hint is computed from (a) its own state and (b) the propagated chain state observed *right before* this match, then the chain state is updated for the next iteration.

For each match X (in walk order):

1. Find immediate predecessor P (the prior match in the walk, or `null` if X is first).
2. **Update chain state from P's current snapshot:**
   - If P is `live` AND `P.started_at IS NOT NULL` AND `now - P.started_at > expected_duration_minutes` → `running_over`.
   - Else if P is `scheduled` AND `P.scheduled_at < now()` → `delayed` (P is itself delayed).
   - Else if P is in a terminal status (`finished`/`retired`/`walkover`) AND `P.finished_at >= now() - 60 min` → `just_finished`.
   - Else if P had hint `may_be_late` propagated to it in this walk (i.e. previous chain state was `running_over` or `delayed`) → keep `delayed` (cascade).
   - Else → `clear`.
3. **Set X's `late_hint`:**
   - If X itself is past `scheduled_at` and still `scheduled` → `'may_be_late'` (X being late is a stronger signal than anything propagated from P).
   - Else if chain state is `running_over` or `delayed` → `'may_be_late'`.
   - Else if chain state is `just_finished` AND X is `scheduled` → `'starting_soon'`.
   - Else → `NULL`.
4. **Edge:** if X is not in `scheduled` status, force its `late_hint` to `NULL` regardless of the above (X has moved on; UI shows ON COURT / LIVE / FINISHED chip instead).

`expected_duration_minutes` is a single configurable env var on the worker, defaulting to 90. Per-tournament/category calibration is deferred.

A `live` predecessor with `started_at IS NULL` (unusual — we missed the live transition) is treated as `clear` for chain purposes. The next match has no hint unless its own `scheduled_at` is past.

### Schedule-hints worker

New padelgod worker at `padelgod/src/workers/schedule-hints-writer.ts`. Runs every 2 minutes via the existing scheduler in [`padelgod/src/scheduler.ts`](padelgod/src/scheduler.ts).

Pseudocode:

```
1. Load all matches with status='scheduled' OR ('live' AND started_at IS NOT NULL)
   for tournaments active in the next 48 hours.

2. Group by (tournament_id, court, day_date), sort each group by court_order.

3. For each group, walk in order, applying the rules above. Track propagated
   chain state across the walk.

4. Diff computed late_hint vs current column value. UPDATE rows where they
   differ (or where the row should be cleared because the match left
   'scheduled' status).
```

The worker is idempotent and bounded — no chaining triggers, no event handlers. The 2-minute cadence is the worst-case staleness for a hint to appear or clear after the underlying status changes.

### Why no event-driven trigger

The earlier design (Approach 2) called for the live-poller and fip-results-writer to fire chain recomputes on status transitions. That was justified when we needed to *push scheduled_at* — sub-minute latency mattered to keep displayed times honest. With the no-time-push model, the only stake is "when does the user see the hint flip from 'may be late' to 'starting soon'?" — a 2-minute window is not a meaningful UX regression.

The simpler periodic worker also avoids subtle bugs: relay/poller events can arrive out of order, get retried, or be missed; periodic recompute just looks at the current truth and writes it.

### Vercel side: read and pass through

`Match` type in [`src/types/match.ts`](src/types/match.ts) gets a new optional field:

```ts
late_hint?: 'may_be_late' | 'starting_soon' | null
```

All match-fetching queries that already select `*` pick this up automatically. Queries with explicit `select(...)` lists need `late_hint` added — primarily the matches list, tournament detail, and home page surfaces. The audit can be a grep for `from('matches')`.

No SSR computation. The hint is read straight from the column.

### MatchCard UI

[`src/components/MatchCard.tsx`](src/components/MatchCard.tsx) — `formatScheduledTime` and the right-aligned schedule stack already exist. Two additions:

1. **Hint row under the time.** Renders only when `match.status === 'scheduled'`, `match.late_hint != null`, and a real time exists (`timeStr` non-null). Inserted as a third element in the `mc-time-stack` flex column.

   ```tsx
   {timeStr && match.late_hint && (
     <button
       type="button"
       onClick={(e) => { e.preventDefault(); e.stopPropagation(); setHintSheetOpen(true) }}
       style={hintStyle(match.late_hint)}
       aria-label={t(match.late_hint === 'may_be_late' ? 'lateHint.mayBeLateAria' : 'lateHint.startingSoonAria')}
     >
       {t(match.late_hint === 'may_be_late' ? 'lateHint.mayBeLate' : 'lateHint.startingSoon')}
     </button>
   )}
   ```

   Styling:
   - Dotted underline (1px dotted, 0.4 alpha of accent color).
   - 9px font, 600 weight, lowercase, 0.2 letter-spacing.
   - `may_be_late` → orange (`#F5A623`), opacity 0.85.
   - `starting_soon` → green (`#7ED321`), opacity 0.95.
   - Margin-top 2px.

2. **Tap-revealed info sheet.** Mirrors the existing `LockedPill` tooltip pattern: small popover anchored to the hint, ~3.5s auto-dismiss, click-anywhere-to-dismiss, click on hint again to dismiss.

   Copy:
   - `may_be_late`: "The previous match on {courtName} is running long. We'll update as soon as it ends."
   - `starting_soon`: "The previous match has finished. This one should be called to court shortly."

   {courtName} is interpolated from `match.court`.

### FIP-only "EST" chip

For tournaments whose live-poller coverage is unavailable (FIP-only events), MatchCard renders a small `EST` chip in the existing chip row alongside ROUND and COURT.

Coverage detection: a tournament is **live-tracked** if it has any match with status changes ingested via the padelgod live-poller in the last 7 days (proxy: `padelgod.live_poll_jobs` table touched). If not, it's FIP-only.

For v1 we use a simpler heuristic: tournament `level` ∉ {Premier P1, P2, P10, Major} → render EST chip. This matches the existing `isPremierLevel` check in MatchCard. We can refine to runtime detection later if it matters.

EST chip styling:
- Same chunky polygon clipPath as other chips.
- Background `rgba(126,211,33,0.10)`, border `rgba(126,211,33,0.25)`, text `#7ED321`.
- 9px, weight 800, uppercase, "EST".

### Translation strings

Five new keys under `match.lateHint`:

```json
{
  "match": {
    "lateHint": {
      "mayBeLate": "may be late",
      "mayBeLateAria": "Match may be late — tap for details",
      "startingSoon": "starting soon",
      "startingSoonAria": "Match starting soon — tap for details",
      "mayBeLateSheet": "The previous match on {court} is running long. We'll update as soon as it ends.",
      "startingSoonSheet": "The previous match has finished. This one should be called to court shortly.",
      "estChip": "EST",
      "estChipAria": "Estimated time — no live tracking on this tournament"
    }
  }
}
```

All five locales (en/es/pt/it/fr) get translations.

## Edge cases

- **No predecessor on court (X is the first match of the day).** Predecessor is null → chain state is `clear` → no hint. Unless X itself is past its `scheduled_at` and still scheduled, in which case `may_be_late` fires (the day's start is delayed).
- **X has no `scheduled_at`.** No time renders, so no hint either. The existing `estimatedLabel` orange path stays untouched.
- **X has approximate time (`*` suffix from "Not before" / "Followed by").** Hint and `*` can both appear. They communicate different things: `*` = the time is approximate; hint = the predecessor's state is creating delay. They compose without conflict.
- **Match transitions out of `scheduled` while late_hint is set.** Worker clears the column on next pass. UI shows `ON COURT` / `LIVE` / `FINISHED` chip via existing logic — the hint never renders for non-scheduled matches even if the column is briefly stale.
- **Match has no court (`match.court IS NULL`).** Predecessor lookup fails → no hint. Acceptable — these are usually rare or pre-publication matches.
- **Cross-day chains.** Hint computation always groups by (tournament_id, court, day_date). Day boundaries break the chain, same as the existing OOP parser ([`oop-schedule-parser.ts:18`](padelgod/src/lib/oop-schedule-parser.ts:18)).
- **Predecessor is `walkover` / `retired`.** Treated like `finished` for chain purposes — the next match becomes "starting_soon" if it's still in scheduled status.

## Telemetry

Light, optional. Two events the UI emits via the existing `track()` helper:

- `schedule_late_hint_shown` — fired on first paint with the match id and hint type. Helps measure how often hints appear in the wild.
- `schedule_late_hint_tapped` — fired when the user taps the hint to open the sheet. Measures whether users actually engage with the explanation.

No telemetry on the worker itself; existing padelgod logging is sufficient.

## Rollout

1. **Migration applied** — `late_hint` column + check + index, deployed to Supabase.
2. **Schedule-hints worker shipped, dry-run mode** — logs proposed UPDATEs, makes no DB changes. Same pattern other padelgod workers use (e.g. `fipDrawPopulatorDryRun` flag in scheduler). Run for ~24h, review log output.
3. **Worker writes go live** — flip dry-run flag to false. Column starts populating.
4. **MatchCard UI ships** — reads the column and renders hints. Behind a `NEXT_PUBLIC_LATE_HINTS_ENABLED` env flag for the first 24h to allow quick disable.
5. **EST chip ships** — independent of the hint logic; can roll separately.

## Open questions

- Should the EST chip use a runtime "is this tournament live-tracked?" check (tracks live_poll_jobs activity) instead of the level heuristic? Defer to implementation; if the heuristic produces obvious wrong-tier hits, switch.
- Is 90 minutes the right `expected_duration_minutes` default? Probably good enough for both genders; calibrate later from actual measured durations on `public.matches.duration` once we have a few months of data.
- "Starting soon" — does this stay rendered if the match doesn't go on_court within e.g. 30 minutes? Rules above say yes: as long as P is finished and X is still scheduled. Worth revisiting if it becomes annoying in practice.

## Known follow-ups (raised during implementation)

- **Predecessors with `scheduled_at IS NULL` are silently dropped** — the worker filters by `scheduled_at` window, so a `live` match with a real `started_at` but `scheduled_at = NULL` (early-tournament before OOP review) won't be loaded. Its successor in `court_order` won't see it as a predecessor and won't get the `may_be_late` hint. Plausible in production for the first few minutes of a tournament. Consider loading by `tournament_id IN (active in window)` instead of per-match `scheduled_at`, or add a fallback `OR (status='live' AND scheduled_at IS NULL)` filter.
- **Per-row UPDATE is serial** — the worker awaits each `UPDATE … WHERE id = ?` one at a time. Steady-state diff count is small (handful of rows per tick), but during chain-ripple events (a popular court running 30 min long) or initial backfill (every match in the window) it can be 50–500 rows × ~50ms = noticeable wall time. Consider bucketing by target value (`UPDATE … WHERE id = ANY($1)` per distinct `late_hint` — at most 3 buckets) or a bounded `Promise.all(concurrency=10)`.
