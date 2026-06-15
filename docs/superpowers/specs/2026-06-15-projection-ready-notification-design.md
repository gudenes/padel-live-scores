# Projection-Ready Notification — Design

**Date:** 2026-06-15
**Status:** Approved (brainstorm), pending implementation plan
**Branch / worktree:** `feat/projection-ready-notification` → `.claude/worktrees/projection-ready-notify`

## Summary

When a tournament's road-to-trophy **predictions first become available**, notify every user who follows a player in that tournament — framed at the tournament level: **"Predictions for [Tournament] are ready"** — carrying the followed player's **avatar** (same design as the "X is on court" alert) and deep-linking to that player's pair road (`/tournaments/<id>/projection/<pair-slug>`, the URL shipped in PR #548).

This is a new **free** sender on top of the already-merged premium-notifications framework (PRs #533/#534/#535): the category catalog (`tier`/`group`/`comingSoon`), the generic `/api/push/notify-event` fan-out (prefs + tier gate + per-user dedup), and the entity-follower resolver all exist. The only new pieces are a category entry, a padelgod notifier worker, a claim table, and i18n copy.

## Product decisions (from brainstorm)

- **Trigger:** the first time `tournament_projections` has rows for a `(tournament, category)` — i.e. the hourly `tournament-projection-snapshot` computed the road-to-trophy % for the first time. (Not the earlier "draw released" moment.)
- **Tier:** **free** — maximize reach and drive traffic to the new projection pages.
- **Per-user granularity:** at most **one** notification per `(user, tournament)`, deep-linking to the user's **highest champion-% followed pair**.
- **Framing:** tournament-named title; player-named body. **Icon = followed player's avatar** (fallback circuit logo), identical to the on-court alert.

## Existing infrastructure this builds on

- **`/api/push/notify-event`** (`src/app/api/push/notify-event/route.ts`) — generic, entity-scoped fan-out. Body: `{ category, entityType: 'player'|'tournament'|'match', entityId, title, body, url?, icon?, metadata?, dedupeKey?, dryRun? }`. It resolves the entity's followers (`resolveEntityFollowers`), batch-fetches prefs/mute/plan, **dedups per `(category, dedupeKey)` per user** (skips users who already have that inbox row), applies the tier gate (free categories pass), inserts the inbox row, and sends web-push + FCM. `icon` is used directly as the push largeIcon.
- **`resolveEntityFollowers`** (`src/lib/notify-recipients.ts`) — `entityType:'player'` → `user_bookmarks.bookmark_type='player'` (authed + anon).
- **Category catalog** (`src/lib/notification-categories.ts`) — `CATEGORY_META: Record<NotificationCategory, { defaults, tier, group, comingSoon }>`, groups `matches|results|tournaments|predictions`, `shouldDeliverToRecipient()` gate. `comingSoon:true` hides a category from the settings UI until its sender ships.
- **`notifyEvent(payload, deps)`** (`padelgod/src/lib/notify.ts`) — fire-and-forget POST to `/api/push/notify-event`; no-ops when `NOTIFY_BASE_URL`/`CRON_SECRET` are unset.
- **`tournament-start-notifier`** (`padelgod/src/workers/tournament-start-notifier.ts`) — the template: claim-then-notify, atomic single-fire, behind an `ENABLE_*` flag.
- **`tournament-projection-snapshot`** (`padelgod/src/workers/tournament-projection-snapshot.ts`) — the producer (hourly; upserts `tournament_projections`).
- **`pairSlugFromNames`** (`src/lib/projection-slug.ts`) — canonical surname slug (id-sorted), already powering the projection URLs.

## Architecture

### 1. Category — `projection_ready` (free)
Add to `notification-categories.ts`:
- Key: `projection_ready`, `tier: 'free'`, `group: 'predictions'`, `defaults: { push: true }`, `comingSoon: false` (sender ships in this project).
- Add the i18n label/description to the settings UI strings (5 locales) and the notification copy strings.

Because `NotificationCategory` is a closed union consumed by exhaustive `Record<NotificationCategory, …>` maps, adding the key is **type-enforced** to ripple into every consumer — see §6 (admin) for the `CATEGORY_RULES` entry that TypeScript will require.

### 2. Claim table — fire exactly once per `(tournament, category)`
New migration `projection_ready_notifications`:
```sql
create table public.projection_ready_notifications (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category text not null check (category in ('men','women')),
  notified_at timestamptz not null default now(),
  primary key (tournament_id, category)
);
```
The `(tournament_id, category)` PK + `INSERT … ON CONFLICT DO NOTHING RETURNING` is the atomic claim. A returned row = we won the claim → notify. RLS: service-role only (no public read needed).

### 3. Worker — `projection-ready-notifier` (padelgod, Railway)
Mirrors `tournament-start-notifier`. Ships dark behind `ENABLE_PROJECTION_READY_NOTIFIER` (default off); scheduled a few minutes after `tournament-projection-snapshot` in `scheduler.ts`.

Per run:
1. **Find candidates.** Distinct `(tournament_id, category)` present in `tournament_projections`, whose tournament is **not finished** (`tournaments.status NOT IN ('finished','completed')`), that have **no claim row** yet. (The not-finished guard is what prevents backfiring history on first deploy — analogous to the start-notifier's 24h window.)
2. **Claim.** For each candidate, `INSERT INTO projection_ready_notifications (tournament_id, category) … ON CONFLICT DO NOTHING RETURNING`. Skip if no row returned (already claimed by an overlapping tick).
3. **Resolve content.** Load that `(tournament, category)`'s projection rows (`pair_key`, `pair_player_ids`, `champion_prob`) + tournament `name`/`level` + each player's `name`/`avatar_url`. Build each pair's canonical slug with the mirrored `pairSlugFromNames`.
4. **Fan out (champion-% desc).** For each player in the draw, **sorted by their pair's `champion_prob` descending**, POST to `/api/push/notify-event` and **await each response before the next** (a synchronous variant — `notifyEventAwait` — not the fire-and-forget `notifyEvent`; see the dedup-ordering note below). The worker builds a single pre-localized (English) `title`/`body` string, matching the existing senders' single-string precedent (§5):
   ```
   { category: 'projection_ready',
     entityType: 'player', entityId: <playerId>,
     title:  "Predictions for Valencia P1 are ready",
     body:   "See Coello / Tapia's road to the title →",
     url:    `/tournaments/${tid}/projection/${pairSlug}`,
     icon:   player.avatar_url ?? circuitIconUrl(level),  // followed player's avatar, fallback circuit logo
     metadata: { tournament_id: tid, category, pair_key, player_id },
     dedupeKey: `projection_ready:tournament:${tid}` }    // tournament-scoped → one per user
   ```
   `dedupeKey` is tournament-scoped and `notify-event` dedups per `(category, dedupeKey)` per user, so a user gets **one** notification — for whichever followed pair's POST reaches them first. Because we POST **highest-% pairs first, awaited sequentially**, that first hit is their **highest-% followed pair**. Users following nobody in the draw resolve to zero followers and cost nothing.

   **Dedup-ordering requirement (must verify in the plan):** correctness depends on (a) the worker awaiting each POST in order, and (b) `notify-event` committing the `user_notifications` inbox row **before it responds**, so the next call's dedup query sees it. Fire-and-forget POSTs would race and could double-notify a multi-follow user. The plan's first task verifies the endpoint commits inbox rows before responding; **fallback if not:** add a single batched mode (the worker POSTs the ordered candidate list once; the endpoint resolves player-followers across all candidates and picks each user's first/highest-% match), which is race-free by construction.

   *Why per-player POST (not one tournament POST):* `notify-event` resolves followers of a single entity. Per-player POSTs let each notification carry that player's avatar + pair URL, while the shared tournament-scoped `dedupeKey` collapses them to one-per-user. `entityType:'tournament'` would instead target tournament-bookmarkers, which is not the audience.

### 4. Slug helper mirror
Mirror the pure `pairSlugFromNames` (+ its `normalizeToken`/`surnameOf` internals) into `padelgod/src/lib/projection-slug.ts`, kept byte-compatible with `src/lib/projection-slug.ts` (same convention as `db-paginate.ts` / `avatar-rehost.ts`). A unit test asserts parity on a shared fixture so the worker's URLs always match the Next route's canonical slugs (otherwise a deep link could 404 or 308).

### 5. Copy — two distinct surfaces

**(a) User-app settings toggle (i18n × 5 locales) — `padelnachos.com/profile/settings/notifications`.**
The settings page is data-driven: it groups `CATEGORY_META` and renders each row from `notifications.settings.category.<key>` (label + description). Add `notifications.settings.category.projection_ready` (label + description) to all 5 `src/messages/*.json`, e.g. EN label "Predictions ready", description "When a player you follow has their tournament's road-to-trophy projections computed." Adding the category to `CATEGORY_META` (group `predictions`, `comingSoon:false`) makes the toggle render under **Predictions & digests** with this copy — users opt in/out there.

**(b) The push/inbox copy itself (English constants, NOT i18n).**
The worker is server-side (no `next-intl` request context). **Decision:** it sends a single English `title`/`body` string — consistent with every existing sender (`/api/push/notify` + the merged premium senders all pass one pre-built string). `title`: "Predictions for {tournament} are ready"; `body`: "See {pair}'s road to the title →". Per-recipient localization of push copy is **out of scope** — it would be a cross-cutting change to all senders, tracked separately. The in-app inbox row stores and displays exactly this title/body/url/icon.

### 6. Admin — ops Notifications Console (`/system/notifications`)
The console is **data-driven**, so the new category surfaces with minimal work:
- **Catalog rule (required).** `src/lib/notification-catalog.ts` exposes `CATEGORY_RULES: Record<NotificationCategory, CategoryRule>` (`{ rule, sampleTitle, sampleBody }`) and `buildCatalog()` maps over `KNOWN_CATEGORIES`. Adding `projection_ready` to the union makes the `CATEGORY_RULES` map a TypeScript error until an entry is added — so we add:
  - `rule`: "Once per tournament + category, when its Road to Trophy projections first land. → followers of any player in the draw (one per user, highest-% pair). Gated by ENABLE_PROJECTION_READY_NOTIFIER (padelgod projection-ready-notifier)."
  - `sampleTitle`: "Predictions for Madrid P1 are ready"
  - `sampleBody`: "See Tapia / Coello's road to the title →"
- **Auto-surfaced.** The ops console (`apps/ops/.../system/notifications`) server-fetches `/api/internal/notification-catalog` (a CRON_SECRET proxy to the main app's catalog endpoint, which calls `buildCatalog()`), and renders rows by `group` with live stats (`lastFiredAt`, `count7d`, `recipients7d`, `failed7d`) + the `tier`/`comingSoon` badges. No ops-side component or type change is needed — `apps/ops/src/lib/notification-catalog-types.ts` is a structural mirror of `CatalogRow`. The new `projection_ready` row appears under the **Predictions** group, free tier, with status `live` once it has fired (derived from `comingSoon:false` + `lastFiredAt`).
- **"Test to me" / "Send to followers" / dry-run.** These already POST a generic body through `notify-trigger` → `/api/push/notify-event`; the console builds the test payload from the catalog row's `sample`, so the operator can fire a sample `projection_ready` push (and see dry-run reach) the moment the category exists — no per-category wiring.

The user-facing settings page (`/profile/settings/notifications`) likewise renders from `CATEGORY_META` + i18n labels, so the toggle appears automatically once the label strings are added (§5).

## Data flow

```
tournament-projection-snapshot (hourly) ──writes──> tournament_projections
                                                            │
projection-ready-notifier (after snapshot, flagged) ───────┤
   find (tournament,category) with rows, not finished, unclaimed
   → atomic claim (projection_ready_notifications)
   → per player (champion% desc): notifyEvent(player, tournament-scoped dedupeKey)
                                                            │
/api/push/notify-event ── resolveEntityFollowers(player) ──┤
   prefs + free-tier gate + per-(category,dedupeKey) dedup
   → user_notifications insert + web-push/FCM (icon = avatar)
                                                            │
                                          user taps ──> /tournaments/<id>/projection/<pair-slug>
```

## Error handling
- **Claim is source of truth.** Notify is fire-and-forget (`notifyEvent` never throws, no-ops without env). If the endpoint is down after we claim, the tournament won't retry — matching the "fire once, best-effort delivery" contract of the other notifiers.
- **No projections / finished tournament:** filtered out at candidate selection.
- **Player without avatar:** falls back to `circuitIconUrl(level)` (Premier star / FIP logo).
- **Missing player name (slug):** the mirrored slug helper falls back to the id (same as the Next side); the URL still resolves via the route's order-insensitive/`pair_key` resolution.

## Testing
- **Unit (worker):** claim idempotency (second run returns zero claimed → zero fires); candidate filter (excludes finished + already-claimed); champion-%-desc ordering of POSTs; payload shape (icon fallback, dedupeKey, url).
- **Unit (slug parity):** `padelgod` `pairSlugFromNames` vs `src/lib/projection-slug.ts` agree on a shared fixture.
- **Endpoint:** `notify-event` `dryRun:true` returns the resolved reach for a `projection_ready` player POST (no writes).
- **Manual E2E:** flip `ENABLE_PROJECTION_READY_NOTIFIER` on against a real upcoming tournament with projections; confirm one push per follower, avatar icon, tournament-framed title, tap → correct pair road. Re-run the worker → zero new fires (claim holds).

## Out of scope
- Per-recipient localized push copy (cross-cutting; all senders share the single-string precedent).
- Pro-tier projection alerts (`projection_outperform` etc. — separate catalog items, deferred in the premium spec).
- The `draw_released` notification (earlier edge; remains `comingSoon` in the catalog).

## Files (anticipated)
**New:**
- `supabase/migrations/<ts>_projection_ready_notifications.sql`
- `padelgod/src/workers/projection-ready-notifier.ts` (+ test)
- `padelgod/src/lib/projection-slug.ts` (mirror, + parity test)

**Modified:**
- `src/lib/notification-categories.ts` — add `projection_ready` to the union + `CATEGORY_META`.
- `src/lib/notification-catalog.ts` — add the `CATEGORY_RULES['projection_ready']` entry (rule + sample) so the ops console row renders (TypeScript-required). *(No `apps/ops` change needed — the console is data-driven.)*
- 5 × `src/messages/*.json` — settings label/description for the toggle.
- `padelgod/src/scheduler.ts` + `padelgod/src/env.ts` — register the worker + `ENABLE_PROJECTION_READY_NOTIFIER` flag.
- (worker copy) English `title`/`body` constants in the worker (single-string precedent, §5).

## Risks
- **Slug drift** between the mirrored padelgod helper and the Next app → broken deep links. Mitigated by the parity test.
- **First-deploy backfire** if the not-finished filter is too loose → mitigated by gating on tournament status (and, if needed, a `computed_at`/`starts_at` recency window like the start-notifier's 24h).
- **Per-user dedup ordering** (§3.4): "one per user, top pair" relies on awaited-sequential %-desc POSTs and on `notify-event` committing the inbox row before responding. The plan verifies the commit-before-respond behavior; the documented fallback is a single batched endpoint mode that is race-free by construction. This is the single most important thing for the plan to get right.
