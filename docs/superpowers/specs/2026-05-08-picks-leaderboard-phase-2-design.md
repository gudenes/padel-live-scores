# Picks Phase 2 + Leaderboards — Design

**Date:** 2026-05-08
**Status:** Approved (brainstorm), ready for implementation plan

## Goals

1. **Persist picks server-side** so a user's prediction history survives device changes, browser clears, and incognito sessions. Replace the localStorage-only "Phase 1" path with a `predictions` table.
2. **Ship two leaderboards** — per-tournament and per-season — that rank users by total guacas earned. The per-tournament leaderboard makes big events (Brussels P2, Milan P1, etc.) social and competitive; the season leaderboard is the all-year ranking.
3. **Bundle both into a single hub at `/picks`** with three tabs: My picks · Season · Tournaments.

Day-1 leaderboards start empty — by design (we are not migrating existing localStorage picks into the DB). They fill as users predict on matches that finish post-launch.

## Non-goals (explicitly out of scope for this milestone)

- Friends-only / private leaderboards
- Country leaderboards
- Push notifications when a user's rank changes
- Custom display-name override (we use whatever's on the auth profile)
- A "hide me from leaderboard" opt-out toggle (everyone with picks shows up; opt-out can be added later if a user complains)
- Changing the existing scoring math (`probability`, `multiplier`, `MARGIN_BONUS`, etc.) — those stay exactly as they are in `src/lib/predictions/`

## Architecture overview

```
┌────────────────┐         ┌─────────────────────┐
│  Match card    │  POST   │ /api/predictions    │
│  prediction UI ├────────▶│ (lock-window check, │
└────────────────┘         │  server-computes    │
                           │  prob + multiplier) │
                           └──────────┬──────────┘
                                      │ INSERT
                                      ▼
                           ┌─────────────────────┐
                           │   predictions       │
                           │   (one row per      │
                           │    user × match)    │
                           └──────────┬──────────┘
                                      │
                                      │ matches.status →
                                      │ finished/retired/walkover
                                      ▼
                           ┌─────────────────────┐
                           │ Vercel cron:        │
                           │ /api/cron/          │
                           │  resolve-predictions│
                           │ (writes result +    │
                           │  reward in batch)   │
                           └──────────┬──────────┘
                                      │ leaderboard reads
                                      ▼
                ┌────────────────┬───────────────────┐
                │                │                   │
        ┌───────▼───────┐ ┌──────▼──────┐  ┌────────▼─────────┐
        │ /picks Season │ │ /picks      │  │ /picks My picks  │
        │   tab         │ │ Tournaments │  │  tab (existing,  │
        │               │ │   tab       │  │  now reads DB)   │
        └───────────────┘ └─────────────┘  └──────────────────┘
```

## Data model

### New table: `predictions`

```sql
CREATE TABLE predictions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_id     UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,

  -- Frozen at pick-time (server-computed, not client-supplied)
  pair         SMALLINT NOT NULL CHECK (pair IN (1, 2)),
  margin       TEXT     NOT NULL CHECK (margin IN ('2-0', '2-1')),
  probability  REAL     NOT NULL,        -- prob the user's pair would win, at pick-time
  multiplier   REAL     NOT NULL,        -- frozen base multiplier (no margin bonus)
  is_fallback  BOOLEAN  NOT NULL DEFAULT false,

  -- Frozen at match-finish (resolver writes these)
  result       TEXT     NULL CHECK (result IN ('perfect','right','wrong','upset','invalidated')),
  reward       INTEGER  NULL,            -- guacas earned (0 for 'wrong')
  resolved_at  TIMESTAMPTZ NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (user_id, match_id)             -- one pick per user per match
);

CREATE INDEX predictions_user_idx       ON predictions (user_id);
CREATE INDEX predictions_match_idx      ON predictions (match_id);
CREATE INDEX predictions_unresolved_idx ON predictions (match_id) WHERE resolved_at IS NULL;
```

**Why both `probability` and `multiplier` are frozen at pick-time** — they're already part of the `Prediction` type; freezing means a user who picks early at 5x multiplier doesn't lose points if the model later learns the underdog was actually 3x. Matches the existing client behavior.

**Why `result` and `reward` live on the row** — pre-computing at match-finish makes leaderboard reads `SELECT user_id, SUM(reward) GROUP BY user_id` instead of a JOIN-and-classify on every page load. Approach B from brainstorm.

**The `predictions_unresolved_idx` partial index** is what the resolver scans (`WHERE resolved_at IS NULL`). Stays small after each resolver pass.

### No new aggregation tables

Leaderboard rows are computed at query time from `predictions` joined with `matches` (and `tournaments` for the season filter). At our scale this is fast enough; if it ever isn't, materialized views are a clean follow-up that doesn't change the API shape.

## API surface

All endpoints are auth-gated unless noted.

### `POST /api/predictions`

Body: `{ matchId: UUID, pair: 1 | 2, margin: '2-0' | '2-1' }`.

Server:
1. Loads the match. If `status !== 'scheduled'` OR `scheduled_at <= now()`, returns **409 Conflict** with `{ error: 'pick_window_closed' }`.
2. Computes `probability` + `multiplier` + `isFallback` server-side using the existing pure functions in `src/lib/predictions/probability.ts`.
3. UPSERTs the row keyed on `(user_id, match_id)`. Updates allow the user to change their mind before lock-in.

Returns: the persisted prediction row.

### `GET /api/predictions`

Returns the current user's picks. Used by `/picks → My picks` and by `useMatchPrediction` when authed.

Optional `?status=pending|resolved|all` (default `all`).

### `DELETE /api/predictions/:matchId`

Clear a pick. Only allowed pre-lock-in (same window check as POST). Returns **204** on success, **409** if window closed.

### `GET /api/leaderboard?scope=season&seasonId=...&cursor=...&limit=50`
### `GET /api/leaderboard?scope=tournament&tournamentId=...&cursor=...&limit=50`

Returns:

```ts
{
  rows: Array<{
    rank: number
    userId: string
    name: string | null
    avatar: string | null
    picksCount: number
    accuracyPct: number      // 0..100
    guacas: number
  }>
  nextCursor: string | null
  currentUser: {
    rank: number | null      // null if user has no picks in this scope
    row: LeaderboardRow | null
  }
}
```

The `currentUser` envelope lets the UI render a sticky bottom row showing "you, rank 1,247" without a second roundtrip when the user is outside the visible page.

**Cursor** is opaque (encoded `(guacas, accuracyPct, picksCount, earliestPickAt, userId)` to be tie-break stable).

**Tie-breakers (ORDER BY)**: `guacas DESC, accuracyPct DESC, picksCount DESC, earliestPickAt ASC, userId ASC`.

**Default scope behaviour:**
- `scope=season` with no `seasonId` → use the most recent season whose tournaments have at least one finished match in the last 90 days
- `scope=tournament` requires `tournamentId`

## Resolver — Vercel cron route

A new Vercel cron `/api/cron/resolve-predictions` runs **every 5 minutes**. Lives in the Next.js app, not in padelgod, because:
- The scoring lib (`src/lib/predictions/scoring.ts`) and probability lib already live in this app. Running the resolver here means a direct import — no shared package, no copy-paste, no drift risk.
- Padelgod's existing workers operate on FIP/Crionet HTML scrapes; predictions are an internal app concern. Keeping them in the Next.js app respects the existing boundary.
- Vercel cron is simpler to wire than adding a new entry to `padelgod/src/scheduler.ts`.

Per run:
1. `SELECT m.id` from `matches m JOIN predictions p ON p.match_id = m.id` where `m.status IN ('finished','retired','walkover')` and `p.resolved_at IS NULL`. Distinct match IDs only.
2. For each match, load the full match + sets, then for each pick on it call `classifyResult` + `computeReward` from `src/lib/predictions/scoring.ts`.
3. Batch-UPDATE the predictions rows in one statement per match, setting `result`, `reward`, `resolved_at = now()`.
4. Idempotent — already-resolved rows are filtered by the partial index condition.

The route honors the `PADELAPI_PAUSED` kill-switch convention only because it's polite to be consistent — strictly, this resolver doesn't touch padelapi at all and could keep running during a pause. The plan will decide whether to gate it.

**Score corrections after first resolve:** if a finished match has its `winner_pair` or set scores corrected post-resolution (rare, happens on data fixes), an admin endpoint `POST /api/admin/predictions/re-resolve?matchId=...` clears `resolved_at` for that match's predictions and the cron re-resolves them next tick. Not automated — manual trigger only.

## UI changes

### `/picks` becomes three tabs

```
 My picks  ·  Season  ·  Tournaments
─────────
[ existing ClientPicks content, but
  reads /api/predictions for authed users,
  falls back to localStorage when logged out ]
```

- **My picks (existing)** — wired through to `/api/predictions` for authed users; localStorage path stays for logged-out (with the sign-in nudge described below).
- **Season** — single leaderboard scoped to the most recent active season. Header shows season name (e.g. "2026 Season"). Sticky bottom row shows current user's rank if outside the visible page.
- **Tournaments** — tournament selector at the top (the same chip-style pattern used elsewhere in the app), then a leaderboard for the picked tournament. Default selection: the tournament where the current user has the most picks; falls back to the most-recently-finished tournament.

### Match prediction UI — logged-out nudge

On the prediction surface inside a match card / detail page, when `!session?.user`:
- The pick UI still works (writes to localStorage as today)
- A small inline strip above the pick CTAs:
  > "🌮 **Sign in** to save your picks and join the leaderboard."
- Clicking opens the existing `LoginSheet`.

Logged-in users see no nudge.

### `useMatchPrediction` becomes auth-aware

Today the hook is purely localStorage. Phase 2 makes it dual-mode:
- Authed: reads `GET /api/predictions` once on mount; mutations call `POST/DELETE /api/predictions` and optimistically update local state.
- Unauthed: existing localStorage path, unchanged.

Read-on-mount uses `swr`-style caching (the app already has its patterns; the plan will pick the simplest one — likely a single shared client-side cache module so MatchCard and other surfaces don't all refetch).

### Leaderboard row shape (mobile-first)

```
[#]  [avatar]  Display Name              picks · accuracy
                                                  guacas
```

- Rank cell: 28×28, chunky polygon clip, gold for top 3, neutral otherwise
- Avatar: 32×32 circle, falls back to initials on a pastel hash
- Picks/accuracy line: small muted, `12 picks · 67%`
- Guacas: green right-aligned, `+450 G`

## Privacy & identity

- **Display name** = `users.name` from the auth profile. Falls back to "Player " + first 4 of `user_id` for users with null names.
- **Avatar** = `users.image` from OAuth. Initials-on-pastel fallback.
- No profanity filter on names in v1 (auth.js providers already validate at sign-up).
- No "hide me" opt-out (deferred). Document this as known scope so we have a clean answer when someone asks.

## Edge cases & non-obvious behavior

- **Match deletion** — predictions cascade (FK).
- **User account deletion** — predictions cascade. Leaderboard simply shrinks. No tombstone preserved.
- **Walkover / retired before any sets** — `classifyResult` already returns `'invalidated'`; reward = 0. These count toward `picksCount` but not `accuracyPct` (already excluded in `ClientPicks` logic — keep that).
- **Score corrections post-resolve** — manual admin endpoint, see Resolver section.
- **Concurrent picks on the same match** — UNIQUE on `(user_id, match_id)` + UPSERT. Last write wins, but only inside the lock window.
- **A user picks at 11:59 and the match starts at 12:00** — server-side `scheduled_at <= now()` check is the source of truth. If the network round-trip lands after the deadline, server rejects with 409. Client should surface this gracefully ("Pick window closed").
- **Logged-in user has stale localStorage from Phase 1** — On first authed pageload, `useMatchPrediction` reads from API and ignores localStorage entirely. We do **not** delete the localStorage entries — they're inert but harmless. (If we delete them, we lose the ability for the user to log out and see their old local history. Cheap to leave.)
- **Time zone for "season"** — season boundaries are date-only in `seasons.starts_at` / `ends_at`; queries compare against `matches.scheduled_at` cast to UTC. Good enough.

## Testing strategy

### Unit
- `src/lib/predictions/scoring.ts` — already has tests; no change needed.
- `src/lib/predictions/probability.ts` — already has tests; no change needed.
- New: leaderboard query helper (the SQL-builder for the GET endpoint) — test tie-break ordering, cursor encoding/decoding.
- New: resolver classification logic — feed in fixture matches + picks, assert resolved rows match expected `result` + `reward`.

### Integration
- `POST /api/predictions` — lock-window enforcement, server-computed prob/mult (client-supplied values ignored), upsert behavior.
- `DELETE /api/predictions/:matchId` — pre-lock allowed, post-lock rejected.
- `GET /api/leaderboard` for both scopes, including:
  - Empty state (no picks anywhere)
  - Single-user (rank 1, currentUser.rank=1)
  - Tie-break ordering
  - currentUser-not-on-page (paginate past them, assert their row still comes back in `currentUser`)

### E2E (manual, pre-launch)
- Pick on a finished match → check leaderboard updates within 5 min
- Sign out → confirm `/picks → My picks` falls back to localStorage path
- Open `/picks → Season` while logged out → confirm CTA "Sign in to compete"

## Rollout

Single deploy. No feature flag. Reasoning: leaderboards start empty by design (Day-1 wipe per Q3), so there's nothing dangerous to gate. The migration adds the table; the resolver worker is benign on day 0 (nothing to resolve until people pick).

Order matters during rollout:
1. Migration (creates `predictions` table)
2. Resolver cron `/api/cron/resolve-predictions` added to `vercel.json` — idle until the API exists
3. API routes (`POST/GET/DELETE /api/predictions`, `GET /api/leaderboard`)
4. Client: auth-aware `useMatchPrediction`, `/picks` tabs, logged-out nudge
5. Vercel deploy

## Future work (deferred)

- Friends leaderboard (requires social graph)
- Country leaderboard (we already have `geo-country` cookie)
- Push notifications on rank changes (we have `web-push` infra)
- Custom display name (`users.handle` column + uniqueness check)
- Materialized rollup table if leaderboard query latency becomes a problem
- Public profile pages (`/u/:handle`) showing picks history + badges
- A "hide me from leaderboard" toggle, when someone asks for it
