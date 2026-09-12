# Stuck-Scheduled Match Sweeper — Design

**Date:** 2026-07-08
**Status:** Proposed (spec only, not built)
**Related:** PR #582 (home "Coming Up" ends_at guard — the band-aid this makes unnecessary)

## Problem

Matches get frozen on `status='scheduled'` after their tournament ends. The
Crionet results feed sometimes omits matches (especially qualifying rounds), and
nothing ever closes them — the existing `close-stale-live-sweeper` only sweeps
`live`/`ended`, never `scheduled`. These phantoms have `scheduled_at = null` and
no captured scores.

They surface in two places:
- **Home "Coming Up"** — fixed by PR #582's `tournament.ends_at >= today` guard,
  but that only hides the symptom on one surface.
- **The tournament's own detail / draw view** — a finished event still shows
  phantom "scheduled" matches, which #582 does not address.

This has needed manual cleanup repeatedly. On 2026-07-08 a sweep found **52**
stuck matches across **5 ended tournaments** (Bordeaux P2, Acapulco Major, Italy
Major, Asunción P2, Valladolid P2) — some over 7 months old — all with **zero**
set/game data. See also [[crionet-results-feed-can-skip-matches]].

## Goal

A scheduled worker that safely removes **phantom** stuck-scheduled matches, so
manual cleanup and per-surface guards are no longer needed.

## "Phantom stuck-scheduled" — precise definition

A match qualifies for sweeping only if ALL hold:
1. `status = 'scheduled'`
2. `tournament.ends_at < now - GRACE` (event definitively over; `GRACE` = 24–48h)
3. **0 rows in `sets` AND 0 rows in `games`** for the match (no captured scores —
   nothing to preserve)

The 0-sets/0-games gate is the safety keystone: the sweeper can never touch a
match that has any real score data.

## Action — delete (not re-status)

- **Delete** the match + its polymorphic `entity_external_ids` sidecar rows
  (no FK cascade there; the `sets`/`games`/etc. children cascade via FK, but by
  definition there are none). This matches the manual remediation used to date.
- Re-statusing was considered and rejected: `finished` requires a `winner_pair`,
  and `walkover`/`retired` would fabricate an outcome that didn't happen. There
  is no "never played" terminal status, so delete is the honest choice for a
  match with no data in a finished event.

## Where it lives

Extend `close-stale-live-sweeper` (padelgod) with a second pass for scheduled
matches, keeping all stale-match remediation in one worker (rename to
`close-stale-matches-sweeper` if desired). Alternative — a new dedicated worker —
is more moving parts for the same logic.

## Safety & observability

- **GRACE window** (24–48h) so a match for an event that *just* ended, which
  might still receive a late results write, is never swept.
- **0-sets/0-games gate** — never deletes a match with captured scores.
- **Premier-tier scope** to start (`finals/major/p1/p2`), matching where the
  Crionet-skip occurs; widen to FIP later if needed.
- **Log every deletion** (tournament, round, match id) and return a count in the
  worker result for ops visibility.
- **Dry-run mode** (default on, like other padelgod workers) so operators can
  review before it writes.

## Cadence

Daily is sufficient — these are not time-sensitive. Could piggyback on the
existing `close-stale-live-sweeper` schedule.

## Non-goals

- Does **not** fix the upstream Crionet results-feed reliability (why matches get
  skipped) — that's a separate integration concern. This is cleanup/hygiene.
- Does **not** attempt to *recover* the missing result; it only removes the
  data-less phantom.

## Open questions

1. `GRACE` = 24h or 48h? (48h is more conservative given late results writes.)
2. Delete vs. soft-flag for audit? (Recommend delete; the rows carry no data.)
3. Include FIP-tier from day one, or Premier-only first? (Recommend Premier-only
   first — that's where the observed leakage is.)
