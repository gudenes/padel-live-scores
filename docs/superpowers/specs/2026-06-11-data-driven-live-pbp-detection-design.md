# Data-driven live point-by-point detection

**Date:** 2026-06-11
**Status:** Design — approved for planning

## Problem

A FIP Gold tournament (Shangay) is receiving real point-by-point (PBP) coverage
from Crionet, but the app renders it incoherently: the serve indicator and live
score update (data-driven), yet the status pill shows the calm amber **ON COURT**
badge and the "presence-only" hint claims the match *won't* update in real time.

The root cause is a conflation of two distinct concepts under "Premier-tier":

| Concept | What actually gates it | Where it's decided |
|---|---|---|
| **Live PBP capture** | `tournaments.live_source='padelgod'` + an active Crionet widget — **no tier check** | [`padelgod_tournaments_for_live_polling()`](../../../supabase/migrations/20260420000016_padelgod_live_state_helpers.sql) |
| **UI "is this live with PBP?"** | hardcoded `isPremierLevel(tournament.level)` — a now-stale proxy | [`isPresenceOnlyLive`](../../../src/lib/tournament-tier.ts) |

Because the poller is gated on `live_source` (not tier), FIP Gold Shangay is
already being polled and its point data is landing in `match_points` / `games`.
The data-driven parts of the UI (momentum chart, serve indicator) already reflect
this. The tier-driven parts (LIVE pill, presence-only hint, Live Feed tab) lag
behind — producing the mixed signals.

## Goal

Make the UI's "this match is live with point-by-point" decision **data-driven**:
when real PBP data is present for a live match, give it the full live treatment
(red **LIVE** pill, real-time score/serve/momentum, Live Feed tab, no
presence-only hint) regardless of tournament tier. Matches that are live but have
no point data yet remain in the calm presence-only state.

## Non-goals

- **Score Recap / Stats tab stays Premier-gated.** Crionet's `match_stats`
  endpoint genuinely does not cover FIP-tier events (see "Match-stats coverage
  scope" in CLAUDE.md). That tier gate is correct and unchanged.
- **No change to the capture/polling path.** Polling already works via
  `live_source`. This is purely a UI-detection change.
- **No DB migration.** All consuming surfaces already load the `games` data
  needed to derive the signal.

## Approach (chosen: data-driven detection)

Alternatives considered:

- **B — Persisted `matches.live_pbp` flag** written by the poller, cleared on
  finish/stale. Rejected: all four UI surfaces already load `games`, so a
  migration + write-path + clearing logic buys nothing.
- **C — Widen the tier list** (add `fip_gold` to `PREMIER_LEVELS`). Rejected:
  static and wrong — it would promote FIP Gold events that *aren't* being polled.
  Shangay is special only because `live_source='padelgod'` was set for it.

### Detection signal

A loaded game whose `server_player_id` is non-null, or whose `points` array is
non-empty, is proof that padelgod's live-poller is feeding this match — those
fields are only ever populated by the Crionet live-poller path. That is the
signal.

### Changes

1. **New helper** in [`src/lib/tournament-tier.ts`](../../../src/lib/tournament-tier.ts):

   ```ts
   // True when any loaded game carries point-by-point evidence — a server
   // assignment or a non-empty points array. Both are only ever written by
   // padelgod's Crionet live-poller, so their presence means PBP is flowing.
   export function hasLivePointByPoint(
     sets: ReadonlyArray<{ games?: ReadonlyArray<{
       server_player_id?: string | null
       points?: unknown[] | null
     }> | null }> | null | undefined,
   ): boolean
   ```

   Returns true if any game in any set has `server_player_id != null` or
   `points && points.length > 0`.

2. **Change `isPresenceOnlyLive`** to accept the match's `sets` and become:

   ```
   isLiveStatus(status)
     && !isPremierLevel(level)
     && !hasLivePointByPoint(sets)
   ```

   - Premier path unchanged (Premier is never presence-only).
   - A FIP match with PBP data → `false` → full live treatment.
   - A FIP match flagged live but with no points yet → stays presence-only
     (correct — we genuinely don't know yet; it flips automatically once the
     first point lands).

3. **Update the 4 call sites** to pass `sets`:
   - [`MatchCard.tsx`](../../../src/components/MatchCard.tsx) — `statusChip` (amber
     ON COURT → red LIVE) and the `presenceOnlyLive` flag.
   - [`home/LiveMatchCard.tsx`](../../../src/components/home/LiveMatchCard.tsx)
   - [`MatchesTournamentGroup.tsx`](../../../src/components/MatchesTournamentGroup.tsx)
     (forwards to MatchCard).
   - [`match/[id]/page.tsx`](../../../src/app/[locale]/match/[id]/page.tsx) — the
     hero `presenceOnly` (line ~485) and the deep-link guard (line ~257).

   The PresenceOnlyHint visibility and the status pill follow automatically from
   the updated `isPresenceOnlyLive`.

4. **Match-detail tabs** — surface Live Feed when PBP is present, not on raw tier:
   - Live Feed tab: `showLive = !presenceOnly && (isPremier || hasLivePointByPoint(sets))`
     (currently `isPremier && !presenceOnly`, [page.tsx:1138](../../../src/app/[locale]/match/[id]/page.tsx)).
   - Default sub-tab logic ([page.tsx:249](../../../src/app/[locale]/match/[id]/page.tsx)):
     a live non-Premier match with PBP should be allowed to default to/land on the
     live view rather than being forced to `players`.
   - **Score Recap unchanged** — stays `isPremier || breaks.hasData`.

5. **Type cleanup** — declare the minimal `games` shape (`server_player_id`,
   `points`, plus the existing `is_current`/`game_score`/`game_number`) on
   [`MatchesDaySet`](../../../src/lib/fetch-matches-day.ts) and the `GroupMatch`
   `sets` type in `MatchesTournamentGroup.tsx`, so the helper is typed rather than
   casted. The query already selects these fields at runtime.

## Data flow

```
padelgod live-poller-loop (gated on live_source='padelgod', any tier)
  └─> writes games.server_player_id + games.points  ──┐
                                                       │
UI surfaces load sets(... games(points, is_current,   │
   server_player_id))  ───────────────────────────────┤
                                                       ▼
                                  hasLivePointByPoint(sets)
                                                       │
                              ┌────────────────────────┴───────────────┐
                              ▼                                         ▼
                  isPresenceOnlyLive = false                 isPresenceOnlyLive = true
                  → red LIVE pill, no hint,                  → amber ON COURT,
                    Live Feed tab, momentum                    presence-only hint
```

## Testing

Unit tests (vitest), extending the existing presence-only suite:

- `hasLivePointByPoint`: empty/null sets → false; game with `server_player_id` →
  true; game with non-empty `points` → true; all-empty games → false.
- `isPresenceOnlyLive`:
  - Premier live, no data → still full live (`false`).
  - FIP live, no PBP data → presence-only (`true`).
  - FIP live, PBP data present → full live (`false`).
  - Non-live status → `false` (unchanged early return).

## Risks / edge cases

- **Coverage drops mid-match.** If the poller stops after points were captured,
  the loaded games still carry `server_player_id`, so the match keeps full-live
  treatment with a frozen score — identical to any live match where updates
  pause. Acceptable per the chosen "full live treatment" behavior.
- **Warm-up flicker.** A FIP match goes live before the first point is captured →
  briefly presence-only, then flips to full-live. This is the correct, honest
  state progression.
