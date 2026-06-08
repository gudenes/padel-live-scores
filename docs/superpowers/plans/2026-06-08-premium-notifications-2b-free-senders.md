# Premium Notifications — Plan 2B: Remaining Free Senders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the remaining 5 **free** event notifications through Plan 2A's `notify-event` pipeline — **match scheduled**, **title won**, **eliminated**, **draw released**, **player entered** — plus the two pipeline extensions they need (a `match` entity type and anon web-push delivery). All senders ship **dark** behind one `ENABLE_EVENT_NOTIFICATIONS` flag; the "Soon" pills stay until it's enabled.

**Architecture:** Each sender hooks into the padelgod worker that already owns the relevant data transition (`fip-oop-writer`, `fip-results-writer`, `fip-draw-populator`, `fip-entry-list-populator`), detects the edge, and fires `notifyEvent(...)` (Plan 2A) — gated by `deps.notify` being present **and** the `ENABLE_EVENT_NOTIFICATIONS` flag. Idempotency uses per-row marker columns where a single owning row exists (`matches.scheduled_notified_at`, `matches.result_notified_at`) and the `notification_events_sent` sent-log (via a new `claimNotificationEvent` helper) for many-to-one events (draw/entry). The shared `resolveEntityFollowers` + `/api/push/notify-event` gain a `match` entity type and anon web-push fan-out for player/match.

**Tech Stack:** Next.js 16 (route + lib), TypeScript, Supabase (pg), padelgod cron workers, Vitest. Migrations via `node scripts/apply-migration.mjs`. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Run `npm install` (root) + `cd padelgod && npm install` once in the fresh worktree.

**Spec:** `docs/superpowers/specs/2026-06-08-premium-notifications-design.md` · **2A (merged):** `docs/superpowers/plans/2026-06-08-premium-notifications-2a-event-pipeline.md`

## Inherited from Plan 2A (do not rebuild)
- `POST /api/push/notify-event` (entityType `player|tournament`, Bearer $CRON_SECRET).
- `src/lib/notify-recipients.ts` → `resolveEntityFollowers(supabase, entityType, entityId)` (authed followers only).
- padelgod `notifyEvent(payload, deps)` (`padelgod/src/lib/notify.ts`).
- `notification_events_sent (event_key PK, category, fired_at)` + `tournaments.starting_notified_at`.

## Ship-dark policy
`ENABLE_EVENT_NOTIFICATIONS` (padelgod env, `boolEnv(false)`, default off) gates every new `notifyEvent` call in the 4 workers. The 5 categories keep `comingSoon: true` (Soon pill). Go-live later = set the flag + a one-line commit dropping the Soon pills for the categories you turn on.

---

## File Structure

**Create:**
- `supabase/migrations/20260609100000_match_notify_markers.sql` — `matches.scheduled_notified_at` + `matches.result_notified_at`.
- `padelgod/src/lib/notification-events.ts` — `claimNotificationEvent(supabase, eventKey, category): Promise<boolean>`.
- `src/lib/__tests__/notify-recipients.test.ts` additions — `match` path tests.

**Modify:**
- `src/lib/notify-recipients.ts` — add `match` entity type (4-player + match-bookmark union) + return anon device subs for player/match.
- `src/app/api/push/notify-event/route.ts` — accept `entityType:'match'`; add anon web-push block (player/match).
- `padelgod/src/lib/env.ts` — `ENABLE_EVENT_NOTIFICATIONS: boolEnv(false)`.
- `padelgod/src/scheduler.ts` — thread `notify: deps.notify` into the `fip-oop-writer`, `fip-results-writer`, `fip-draw-populator`, `fip-entry-list-populator` runner cases; thread the flag (via deps or a small `eventsEnabled` boolean on the notify deps).
- `padelgod/src/index.ts` — populate the flag.
- The 4 workers — detection + `notifyEvent` calls + select-widening + marker claims.

> **Threading the flag:** simplest is to pass `eventsEnabled: env.ENABLE_EVENT_NOTIFICATIONS` alongside `notify` in the scheduler deps for these 4 workers, and have each sender check `if (!deps.eventsEnabled || !deps.notify) return`. Confirm the exact deps-plumbing against how `notify` is already threaded (scheduler.ts:143/326/381).

---

## Task 1: Marker-column migration

**Files:** Create `supabase/migrations/20260609100000_match_notify_markers.sql`

- [ ] **Step 1: Write**
```sql
-- supabase/migrations/20260609100000_match_notify_markers.sql
-- Per-match notification dedup markers (premium-notifications Plan 2B).
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS scheduled_notified_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS result_notified_at    timestamptz NULL;

COMMENT ON COLUMN public.matches.scheduled_notified_at IS 'Set when match_scheduled fired. NULL = not sent.';
COMMENT ON COLUMN public.matches.result_notified_at IS 'Set when title_won/eliminated fired for this finished match. NULL = not sent.';
```
- [ ] **Step 2: Apply** — `node scripts/apply-migration.mjs supabase/migrations/20260609100000_match_notify_markers.sql`
- [ ] **Step 3: Verify** both columns exist (ad-hoc pg snippet, as in 2A Task 1).
- [ ] **Step 4: Commit** — `feat(db): match notify markers (scheduled_notified_at, result_notified_at)`

---

## Task 2: `claimNotificationEvent` helper (padelgod)

**Files:** Create `padelgod/src/lib/notification-events.ts`

- [ ] **Step 1: Implement** (claim idiom mirrors `match-identifier.ts:481-510`):
```ts
// padelgod/src/lib/notification-events.ts
// Atomic "fire this event once" claim against public.notification_events_sent.
// Returns true iff THIS call inserted the key (i.e. we should fire); false if it
// already existed (someone fired it). Used for many-to-one events (draw/entry).
import type { SupabaseClient } from '@supabase/supabase-js'

export async function claimNotificationEvent(
  supabase: Pick<SupabaseClient, 'from'>,
  eventKey: string,
  category: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('notification_events_sent')
    .upsert({ event_key: eventKey, category }, { onConflict: 'event_key', ignoreDuplicates: true })
    .select('event_key')
  if (error) return false // fail closed: don't fire if we can't claim
  return Array.isArray(data) && data.length > 0
}
```
- [ ] **Step 2: typecheck** padelgod clean (`cd padelgod && npm run typecheck`).
- [ ] **Step 3: Commit** — `feat(padelgod): claimNotificationEvent idempotency helper`

> Optional but recommended: a tiny unit test with a fake supabase (like `notify-recipients.test.ts`) asserting `true` when `data=[row]` and `false` when `data=[]`/error. If padelgod has no vitest setup, skip and rely on the claim-idiom parity with `linkWidgetId`.

---

## Task 3: Pipeline extension — `match` entity type + anon delivery

**Files:** Modify `src/lib/notify-recipients.ts`, `src/app/api/push/notify-event/route.ts`; add tests to `src/lib/__tests__/notify-recipients.test.ts`

- [ ] **Step 1: Extend `resolveEntityFollowers`** — add `'match'` to `EntityType`; for `match`, read the 4 player FKs from `matches` then union match-bookmarkers + player-followers; also return anon device subs for player/match. New return shape:
```ts
export type EntityType = 'player' | 'tournament' | 'match'
export type AnonSub = { id: string; endpoint: string; p256dh_key: string; auth_key: string }
export type EntityFollowers = { userIds: string[]; anonSubs: AnonSub[] }
```
For `match`: select `pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id` from `matches` where `id=entityId`; `userIds` = union of `user_bookmarks(bookmark_type='match', target_id=entityId)` and `user_bookmarks(bookmark_type='player', target_id in playerIds)`. Anon: `anon_bookmarks(bookmark_type='match', target_id=entityId)` + `(bookmark_type='player', target_id in playerIds)` → device_ids → `anon_push_subscriptions(id, endpoint, p256dh_key, auth_key)`. For `player`: player-follow query + anon player query. For `tournament`: tournament-follow query, **no anon** (`anonSubs: []`). Mirror the exact queries at `notify/route.ts:267-310` (authed) and `:604-656` (anon). Update existing callers/tests for the new return shape (the endpoint now reads `.userIds`).

- [ ] **Step 2: Add resolver tests** — extend `notify-recipients.test.ts` with: `match` unions match-bookmarkers + player-followers (fake `matches` row with 4 player ids + two `user_bookmarks` result sets); `tournament` returns `anonSubs: []`; `player`/`match` populate `anonSubs`. Keep the existing player/tournament tests green (adapt to `.userIds`).

- [ ] **Step 3: Extend `/api/push/notify-event`** — add `'match'` to `ENTITY_TYPES`; after the existing authed fan-out, add an anon web-push block: for the resolved `anonSubs`, `sendPush({ endpoint, keys: { p256dh: p256dh_key, auth: auth_key } }, payload)`, collect stale (sendPush=false) ids → delete from `anon_push_subscriptions`, bump `last_seen_at` for live ones. Anon recipients get NO tier gate, NO in-app row, NO per-category pref (mirror `notify/route.ts:660-723`). Add `anonSent` to the response. Tournament events resolve `anonSubs: []` so the block is a no-op for them.

- [ ] **Step 4: Verify** — `npx vitest run src/lib/__tests__/notify-recipients.test.ts`; `npx tsc --noEmit`; `npm run build`; `npx eslint` the two files. All clean.
- [ ] **Step 5: Commit** — `feat(notify): match entity type + anon web-push delivery in notify-event`

---

## Task 4: `match_scheduled` sender (fip-oop-writer)

**Files:** Modify `padelgod/src/workers/fip-oop-writer.ts` (+ scheduler/index/env from Task 7's wiring if not already done — do the wiring here for this worker).

- [ ] **Step 1: Widen the match select** at `loadExistingMatchesByPrefix` (`fip-oop-writer.ts:~597`) to include `scheduled_notified_at` (and confirm `id` present). The 4 player IDs are NOT needed (notify-event resolves the match→players itself).
- [ ] **Step 2: Detect + fire** at the successful `scheduled_at` write (`~:391-412`). Fire ONLY on the first real-time fill — gate on `originalValue == null || isPlaceholderScheduledAt(originalValue)` AND `p.approximate === false` (don't fire for "Followed by" re-estimates). Claim the marker atomically:
```ts
// after the scheduled_at CAS write succeeds, before firing:
const { data: claimed } = await supabase.from('matches')
  .update({ scheduled_notified_at: new Date().toISOString() })
  .eq('id', matchId).is('scheduled_notified_at', null).select('id')
if (deps.eventsEnabled && deps.notify && claimed && claimed.length) {
  notifyEvent({
    category: 'match_scheduled', entityType: 'match', entityId: matchId,
    title: `${t.tournament_name}: match scheduled`,
    body: 'A match you follow now has a time and court.',
    url: `/match/${matchId}`, dedupeKey: `match_scheduled:${matchId}`,
  }, deps.notify)
}
```
- [ ] **Step 3: Wire** `notify: deps.notify` + `eventsEnabled` into this worker's `getWorkerRunner` case (`scheduler.ts:~279/564`).
- [ ] **Step 4:** typecheck padelgod clean.
- [ ] **Step 5: Commit** — `feat(padelgod): match_scheduled sender (dark behind ENABLE_EVENT_NOTIFICATIONS)`

---

## Task 5: `player_title_won` + `player_eliminated` senders (fip-results-writer)

**Files:** Modify `padelgod/src/workers/fip-results-writer.ts` + scheduler wiring.

- [ ] **Step 1: Widen the match select** at `loadExistingMatchesByPrefix` (`~:499-503`) + sidecar fallback to add `round, result_notified_at, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id`.
- [ ] **Step 2: Detect + fire** at the finish write fire-point (`~:245-256`, after a non-dry-run terminal write with `r.winner_team ∈ {1,2}`). Claim `matches.result_notified_at` atomically (one claim covers both categories), then fire per player:
```ts
const { data: claimed } = await supabase.from('matches')
  .update({ result_notified_at: new Date().toISOString() })
  .eq('id', existing.id).is('result_notified_at', null).select('id')
if (deps.eventsEnabled && deps.notify && claimed && claimed.length && (r.winner_team === 1 || r.winner_team === 2)) {
  const w = r.winner_team
  const winners = w === 1 ? [existing.pair1_player1_id, existing.pair1_player2_id] : [existing.pair2_player1_id, existing.pair2_player2_id]
  const losers  = w === 1 ? [existing.pair2_player1_id, existing.pair2_player2_id] : [existing.pair1_player1_id, existing.pair1_player2_id]
  const isFinal = roundCanonical(existing.round) === 'F'
  for (const pid of winners.filter(Boolean)) {
    if (isFinal) notifyEvent({ category: 'player_title_won', entityType: 'player', entityId: pid!, title: 'Champion! 🏆', body: 'Your player just won the title.', url: `/match/${existing.id}`, dedupeKey: `player_title_won:${existing.id}:${pid}` }, deps.notify)
  }
  for (const pid of losers.filter(Boolean)) {
    notifyEvent({ category: 'player_eliminated', entityType: 'player', entityId: pid!, title: 'Knocked out', body: 'Your player was eliminated.', url: `/match/${existing.id}`, dedupeKey: `player_eliminated:${existing.id}:${pid}` }, deps.notify)
  }
}
```
(Import `roundCanonical` from `../lib/round-canonical`.)
- [ ] **Step 3: Wire** notify + eventsEnabled into the runner case (`scheduler.ts:~293/599`).
- [ ] **Step 4:** typecheck clean.
- [ ] **Step 5: Commit** — `feat(padelgod): title_won + eliminated senders (dark)`

---

## Task 6: `draw_released` sender (fip-draw-populator)

**Files:** Modify `padelgod/src/workers/fip-draw-populator.ts` + scheduler wiring.

- [ ] **Step 1: Detect first appearance per (tournament_id, category)** — hoist a claim ABOVE the per-draw loop (group the draws by `(tournament_id, category)` for this run). For each group, `claimNotificationEvent(supabase, `draw_released:${tid}:${category}`, 'draw_released')`; fire only if it returns true:
```ts
if (deps.eventsEnabled && deps.notify) {
  const claimed = await claimNotificationEvent(supabase, `draw_released:${tid}:${category}`, 'draw_released')
  if (claimed) notifyEvent({ category: 'draw_released', entityType: 'tournament', entityId: tid, title: 'Draw is out', body: 'The bracket for an event you follow has been published.', url: `/tournaments/${tid}`, dedupeKey: `draw_released:${tid}:${category}` }, deps.notify)
}
```
(near the `upsertTournamentDraws` call `~:1103`). Import `claimNotificationEvent`.
- [ ] **Step 2: Wire** notify + eventsEnabled into the runner case (`scheduler.ts:~263/520`).
- [ ] **Step 3:** typecheck clean.
- [ ] **Step 4: Commit** — `feat(padelgod): draw_released sender (dark)`

---

## Task 7: `player_entered` sender (fip-entry-list-populator)

**Files:** Modify `padelgod/src/workers/fip-entry-list-populator.ts` + scheduler wiring.

- [ ] **Step 1: Capture the new player id** — add `.select('id')` to the player insert (`~:288-290`) so newly-inserted players yield an id (existing players already have `match.id`).
- [ ] **Step 2: Fire per resolved (tournament_id, player_id)** in the entry loop (`~:222-298`), both branches (existing + newly inserted), claiming the sent-log:
```ts
if (deps.eventsEnabled && deps.notify && playerId) {
  const claimed = await claimNotificationEvent(supabase, `player_entered:${snap.tournament_id}:${playerId}`, 'player_entered')
  if (claimed) notifyEvent({ category: 'player_entered', entityType: 'player', entityId: playerId, title: 'New tournament entry', body: 'A player you follow just entered an event.', url: `/tournaments/${snap.tournament_id}`, dedupeKey: `player_entered:${snap.tournament_id}:${playerId}` }, deps.notify)
}
```
- [ ] **Step 3: Wire** notify + eventsEnabled into the runner case (`scheduler.ts:~272/520`); add `ENABLE_EVENT_NOTIFICATIONS` to `padelgod/src/lib/env.ts` (`boolEnv(false)`) and populate `eventsEnabled` in `padelgod/src/index.ts` for all 4 workers' deps.
- [ ] **Step 4:** typecheck clean.
- [ ] **Step 5: Commit** — `feat(padelgod): player_entered sender (dark) + ENABLE_EVENT_NOTIFICATIONS flag`

---

## Task 8: Verification + PR

- [ ] **Step 1: Unit tests** — `npx vitest run src/lib/__tests__/notify-recipients.test.ts src/lib/__tests__/notification-categories.test.ts src/lib/__tests__/entitlements.test.ts` → pass.
- [ ] **Step 2: Builds** — `npm run build` (Next) + `cd padelgod && npm run typecheck` → clean.
- [ ] **Step 3: Lint** touched files → clean.
- [ ] **Step 4: e2e (controller)** — with `ENABLE_EVENT_NOTIFICATIONS` semantics simulated, POST `/api/push/notify-event` with `entityType:'match'` for a match whose player you follow → confirm a real inbox row + dedup; confirm `entityType:'player'` to a followed player works; confirm anon path doesn't error when no anon subs. Clean up test rows.
- [ ] **Step 5: Push + PR** (do not merge until reviewed). PR body: the 5 senders, all dark behind `ENABLE_EVENT_NOTIFICATIONS`, Soon pills retained; go-live = flip flag + drop Soon pills.

---

## Self-Review (coverage vs intent)
- **match entity type + anon delivery** → Task 3 (resolver + endpoint). ✓
- **5 senders** → Tasks 4 (scheduled), 5 (title/eliminated), 6 (draw), 7 (entered). ✓
- **Idempotency** → marker columns (Task 1) for scheduled/result; `claimNotificationEvent` (Task 2) for draw/entry. ✓
- **Ship dark** → single `ENABLE_EVENT_NOTIFICATIONS` flag gates all 5; comingSoon pills retained (NOT flipped in this plan). ✓
- **notify threading** → the 4 workers get `notify` + `eventsEnabled` in their runner cases (currently only tournament-start-notifier does). ✓
- **English-only copy** → matches `tournament_starting`; per-locale deferred. ✓
- **Out of scope:** dropping the Soon pills / enabling the flag (a coordinated go-live step), Pro senders (Plan 3), digests (Plan 4), per-recipient localization.

## Open questions for the implementer
- Confirm the exact deps shape for threading `notify` + `eventsEnabled` into the 4 worker runners (compare to how `tournament-start-notifier` gets `notify`). If `eventsEnabled` is awkward on the deps, gate inside each worker by reading `env.ENABLE_EVENT_NOTIFICATIONS` directly (but prefer the deps approach for testability).
- `fip-results-writer` select-widening: confirm both `loadExistingMatchesByPrefix` and the sidecar fallback (`resolveMatchViaSidecar`) carry the new columns, or the per-player fire will see `undefined` IDs on the sidecar path.
- match_scheduled: confirm `t.tournament_name` is in scope at the write point for the title; if not, use a generic title without the tournament name.
