# Personalized `player_entered` Notification — Design

**Date:** 2026-06-22
**Status:** Approved (brainstorm) — pending implementation plan

## Problem

The `player_entered` push ("New tournament entry" / "A player you follow just
entered an event.") is generic. After tapping it, users land on the
**tournament page** and still don't know **which** followed player entered.
Operator feedback: *"after they click they still don't know what is the
player."*

We want the notification to show the **player's name + avatar** and tap
through to **that player's page**, mirroring the per-recipient personalization
the on-court / match-finished push already does in `/api/push/notify`.

## Key constraint: coalescing + uniform fan-out

Two facts from the current implementation shape the whole design:

1. **The populator coalesces per tournament.** When an entry list drops,
   `fip-entry-list-populator` calls `recordPlayerEntered` for *every* newly
   resolved player in that tournament (could be the full 32–48 player draw),
   bundles them all into `entityIds`, and fires **one** `notifyEvent` per
   tournament. `entityId` ("representative") is just `entityIds[0]` — an
   arbitrary player, **not** specific to any recipient.

2. **`notify-event` sends a uniform payload.** Unlike `/api/push/notify`, the
   generic `notify-event` endpoint sends an **identical** title/body/icon/url
   to every recipient. It resolves the *union* of followers across `entityIds`
   and fans out one push per user.

**Consequence:** naively attaching "the representative player's" name+avatar at
the source would show almost every recipient a player they **don't follow**
(the representative is random across the whole entry list) — worse than the
current generic copy. The name/avatar must be the player **that recipient
actually follows**. This requires per-recipient personalization.

## Decision

Personalize **inside the `notify-event` endpoint**, opt-in per call, reusing
the proven on-court pattern (`recipientReason` map → per-user name + avatar +
`resolveNotificationIcon`). Coalescing stays as-is; the representative becomes
**per-user** (their best-ranked followed entrant). The populator change is
minimal.

### Why the endpoint, not the populator

- The populator works off `entry_list_snapshots` and does **not** have the
  tournament name, nor follower data. The endpoint already resolves followers
  and can cheaply look up players + tournament.
- Reuses the endpoint's existing dedup / tier-gate / prefs / mute / web+FCM /
  analytics fan-out — no ~250-line duplication of a dedicated route.

## Architecture

### Payload (opt-in)

`fip-entry-list-populator.flushPlayerEntered` adds two things to the existing
`notifyEvent` call:

- `personalizePerFollower: true`
- `metadata.tournamentId = <tournamentId>`

Everything else stays (`category`, `entityType:'player'`, `entityId`,
`entityIds`, `dedupeKey`, and the existing `title`/`body`/`url` which become
the **fallback** content). `NotifyEventPayload` in `padelgod/src/lib/notify.ts`
gains the optional `personalizePerFollower?: boolean` field.

### Endpoint flow (`src/app/api/push/notify-event/route.ts`)

When `personalizePerFollower === true` **and** `entityType === 'player'`
**and** `entityIds` is non-empty **and** `metadata.tournamentId` is present:

1. **Player directory:** fetch `players` (`id, name, display_name, avatar_url,
   ranking`) for `entityIds`.
2. **Tournament:** fetch `tournaments` (`name, level`) by
   `metadata.tournamentId`.
3. **Per-user followed map:** instead of discarding `target_id`, build
   `Map<userId, playerId[]>` from
   `user_bookmarks.select('user_id, target_id').eq('bookmark_type','player').in('target_id', entityIds)`.
4. **Per-user content** (replaces the uniform title/body/icon/url in the
   existing loop):
   - **headliner** = the user's followed entrant with the best (lowest
     non-null) `ranking`; tie-break alphabetically by last name; null ranking
     sorts last.
   - `others = followedCount − 1`
   - **title:**
     - 1 player → `` `${lastName} entered ${tournamentName}` ``
     - N players → `` `${lastName} +${others} more entered ${tournamentName}` ``
   - **body:**
     - 1 player → `Just added to the entry list.`
     - N players → `Players you follow joined the draw.`
   - **icon:** `resolveNotificationIcon({ reason: 'follow', tournamentLevel,
     followedPlayerAvatarUrl: headlinerAvatar })` (headliner avatar; circuit
     logo fallback).
   - **url:** `` `/player/${headlinerId}` ``
5. Both the **in-app row** and the **push payload** use this per-user content,
   so the notification center shows the right player too.

When the personalization preconditions are **not** met, the endpoint uses the
uniform `title`/`body`/`url`/`icon` exactly as today. **Other categories are
completely unaffected.**

### Per-user content builder (pure, unit-tested)

Extract a pure helper, e.g.
`buildPlayerEnteredContent(followedPlayers, tournament)` →
`{ title, body, icon, url }`, in a lib file (e.g.
`src/lib/player-entered-content.ts`). Keeps the endpoint loop thin and the
copy logic testable in isolation.

### Shared `playerLastName`

`playerLastName` currently lives **inside** `src/app/api/push/notify/route.ts`
(line 83). Extract it to a shared lib (e.g. `src/lib/player-name.ts`) and have
both the match route and the new builder import it. No behavior change.

## Anonymous followers (scoped fallback)

Anon player-bookmark followers can't be cheaply mapped to *which* player they
follow without reworking the anon resolver (it returns subs, dropping
`target_id`). For this iteration, anon recipients get an **improved-but-generic**
payload:

- title `` `New entries — ${tournamentName}` ``
- body `Players you follow joined the draw.`
- icon circuit logo (`circuitIconUrl(level)`)
- url `/tournaments/${tournamentId}`

This is still better than today (tournament name + circuit logo). Personalizing
anon is a clearly-scoped future extension.

## Edge cases

| Case | Behavior |
|---|---|
| Headliner has no avatar | Circuit logo via resolver. |
| User follows a player missing from directory (no name) | Drop it; if no named followed player remains, use generic uniform fallback for that user. |
| `tournamentId` missing / flag off | Endpoint uses today's uniform content. No crash. |
| `ranking` null | Sorts last; alpha tie-break keeps it deterministic. |
| Dedup | `dedupeKey = player_entered:{tournamentId}` unchanged → one push per user per tournament. |
| Tier gate | `player_entered` is a **free** category — unchanged. |

## Testing

- **Pure builder unit tests:** 1 player, N players, no-avatar (→ circuit logo),
  no-name (→ fallback), ranking ordering / tie-break.
- **Endpoint test:** mocked `user_bookmarks` (per-user follow sets), player
  directory, tournament → assert per-user title / icon / url, and that
  non-personalize calls are byte-identical to today.
- **Populator test:** asserts `flushPlayerEntered` passes
  `personalizePerFollower: true` + `metadata.tournamentId`.

## Files touched

- `padelgod/src/workers/fip-entry-list-populator.ts` — pass flag +
  `metadata.tournamentId`.
- `padelgod/src/lib/notify.ts` — add `personalizePerFollower?: boolean` to
  `NotifyEventPayload`.
- `src/app/api/push/notify-event/route.ts` — opt-in per-recipient
  personalization branch.
- `src/lib/player-entered-content.ts` — new pure content builder.
- `src/lib/player-name.ts` — extracted `playerLastName` (shared).
- `src/app/api/push/notify/route.ts` — import shared `playerLastName`.
- Tests for the above.

## Logistics

The implementation branch's base is **564 commits behind `main`**, and the
entire `player_entered` system lives on `main`. Implementation must happen on a
**fresh worktree off `main`** (the current `infallible-buck-4d9937` worktree is
on the stale `hotfix/download-rail-portal` base and lacks the feature).

## Out of scope

- Personalizing anon followers (future extension).
- Changing coalescing granularity (we keep one-push-per-tournament).
- Any change to other notification categories.
