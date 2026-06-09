# Notifications Console (Ops) — Design

**Date:** 2026-06-09
**Status:** Design approved (pending written-spec review)
**Worktree / branch:** `feat/notifications-console` → `.claude/worktrees/notifications-console`

## Summary

An operator-facing **Notifications console** at `admin.padelnachos.com/system/notifications` that makes the per-category notification system observable and operable: a **catalog** of every category with its tier/group and a **live/Soon/idle status derived from real send activity**, **operational health** per category (fired counts, last-fired, recipients, failures), and an **ad-hoc trigger** with a safe **Test-to-me** default plus a guarded **Send-to-followers** path.

It is a **sibling** to the existing `/system/broadcast` page (a category-unaware marketing composer) and **reuses broadcast's substrate** — the `notification_sends` / `notification_clicks` tables, the operator-auth → `CRON_SECRET` forward-proxy pattern, the ops UI primitives, and the compose/confirm UX. **No new analytics substrate.**

This replaces the manual `curl` + raw-SQL loop we used to test the dark senders, and de-risks the free-tier go-live by surfacing whether each sender is actually firing.

## Background / why now

- The per-category event system (Plans 1/2A/2B) ships its senders **dark** behind flags. Today there is **no way to see whether a category is firing** — `notify-event` writes no analytics row, so per-category sends are invisible.
- The broadcast feature (`/system/broadcast`, merged) built a reusable analytics substrate (`notification_sends` with an **extensible `kind`**, `notification_clicks`, the `sw.js`→`/api/push/click` pipeline) and an ops forward-proxy pattern — but it is **category-unaware** (sends to everyone, all channels).
- We need observability + a controlled trigger keyed to the **category catalog** (`CATEGORY_META`). That's a distinct, sibling surface.

## Non-goals

- **Not** a redesign or retrofit of `/system/broadcast` (it stays as the marketing composer).
- **Not** engagement analytics (open/click rates per category) — click tracking is web-only today; deferred to a later phase. This build is **operational health** only.
- **Not** reading padelgod Railway flag state — "is it live" is derived from real send activity (see Status), which is the truth that matters.
- **Not** a new analytics table — reuse `notification_sends` / `notification_clicks`.

## Architecture & data flow

`apps/ops` is a separate Next app with **no main-app code or push secrets** — confirmed by the broadcast feature, which forwards every action to the main app via `/api/internal/*` (operator NextAuth session → `Authorization: Bearer $CRON_SECRET`). This console follows the same split:

- **Main app** owns the data and actions: the catalog+health read, the trigger send, the telemetry write.
- **Ops app** is a thin UI: a server component fetches the catalog+health payload via an internal proxy and renders it; the trigger panel posts to internal proxies.
- `CATEGORY_META` (`src/lib/notification-categories.ts`) lives in the **main app** and is **not importable** from `apps/ops`; it reaches ops only through the internal catalog endpoint's JSON.

```
ops /system/notifications (server component)
  → ops GET /api/internal/notification-catalog        (operator-auth)
      → main GET /api/internal/notification-catalog    (Bearer CRON_SECRET)  → { categories: [{key,tier,group,comingSoon,status,health}] }
  → ops POST /api/internal/notify-test                 (operator-auth)
      → main POST /api/push/notify-event (test mode)   (Bearer CRON_SECRET)  → sends to operator only
  → ops POST /api/internal/notify-trigger              (operator-auth)
      → main POST /api/push/notify-event (real)        (Bearer CRON_SECRET)  → sends to entity's followers
```

## Component 1 — Telemetry keystone (`notify-event` → `notification_sends`)

The single change that makes everything else work.

- **Migration:** extend the `notification_sends.kind` CHECK to add `'category'` (currently `('broadcast','match')`).
- **`/api/push/notify-event`** (real-audience path only): after fan-out, insert one `notification_sends` row — `kind:'category'`, `title`, `body`, `url`, channel counters (`web_*`/`fcm_*`/`anon_*` fired/accepted/stale mirroring the match route at `notify/route.ts`), `recipients_total`, `accepted_total`, and `metadata: { category, entity_type, entity_id, dedupe_key }`.
- The **Test-to-me path does NOT log** a row (it's not a real send).
- Match notifications already log `kind:'match'`; broadcast logs `kind:'broadcast'`. After this, all three notification kinds share one table → the console reads `kind:'category'` rows.

## Component 2 — Catalog + health read

- **Main app internal endpoint** `GET /api/internal/notification-catalog` (auth: `Bearer $CRON_SECRET`). Returns, for every `CATEGORY_META` key:
  - `key`, `tier`, `group`, `comingSoon` (from `CATEGORY_META`),
  - `health`: from `notification_sends` where `metadata->>category = key` — `lastFiredAt`, `count7d`, `count30d`, `recipients7d`, `failures7d` (sum of `*_stale`/`fcm_failed` or a failure proxy).
  - `status` (derived):
    - **Live** — fired within the last 7 days.
    - **Idle** — has a sender (not `comingSoon`) but no recent fire.
    - **Soon** — `comingSoon: true` (sender not yet enabled).
  - Reads paginate via `paginatedSelect` if needed; the per-category aggregation is a grouped query over recent `notification_sends`.
- **Ops** `GET /api/internal/notification-catalog` proxy (operator-auth → forwards). The page renders a grouped table (by `group`): category · tier badge · status pill · last-fired · 7d fires · 7d recipients · 7d failures.

## Component 3 — Ad-hoc trigger (Test-to-me + Send-to-followers)

A compose panel: **Category** (select from the catalog) · **Title** · **Body** · optional **URL**. Two actions:

**Test to me (default, safe).**
- Posts to ops `/api/internal/notify-test` → main `/api/push/notify-event` with a **test recipient** parameter (`testRecipientUserId` = the operator's main-app user id, resolved server-side from the operator session/email).
- `notify-event` test mode: bypasses follower resolution, sends only to that user's own subscriptions, **no dedup**, **no `notification_sends` log**, tier gate bypassed (operator can preview any category).
- This is the curl-replacement for QA-ing dark senders.

**Send to followers (guarded, real).**
- Adds an **entity** picker: type `player` | `tournament` | `match` + an entity id (with a lookup/search helper).
- Flow mirrors broadcast: **Dry-run** → reach count (followers, by channel) → operator types **`SEND`** to arm → **Send to N**. Any content/entity edit invalidates the confirm.
- Posts to ops `/api/internal/notify-trigger` → main `/api/push/notify-event` (real audience). This **does** log a `notification_sends` row (Component 1) and is dedup-gated as normal.
- Tier gate applies (a Pro category won't reach free followers) — surfaced in the dry-run.

> Reach dry-run: `notify-event` gains a `dryRun` mode returning recipient counts (authed + anon) without sending, mirroring `broadcast-push`'s dry-run.

## Component 4 — Page, structure, flag

- New ops page **`apps/ops/src/app/(app)/system/notifications/page.tsx`** + `_components/` (reuse broadcast's `PageHeader`/`Panel`/`DataTable`/`Button`/confirm primitives; extract any shared compose/confirm bits rather than copy-paste where clean).
- **Rail item** "Notifications" next to "Broadcast" (`apps/ops/src/components/shell/Rail.tsx`).
- **Feature-flagged** (ops gating, default off) so it ships dark; flip on when ready.
- One page, two regions: **Catalog + Health** table (top) · **Trigger** panel (bottom).

## Reuse vs new

**Reuse as-is:** `notification_sends`/`notification_clicks` tables + `/api/push/click` + sw.js click beacon; the operator-auth → `CRON_SECRET` forward-proxy pattern (`apps/ops/src/app/api/internal/*`); ops UI primitives; broadcast's dry-run + type-`SEND` confirm UX; `listRecentSends`-style read patterns.

**New:** the `kind:'category'` telemetry write in `notify-event`; the catalog+health endpoint (main) + proxy (ops); the `testRecipientUserId` + `dryRun` modes on `notify-event`; the ops page + rail item + flag.

## Testing

- **Unit:** the status-derivation helper (Live/Idle/Soon from `comingSoon` + lastFiredAt) — pure function, table-tested. The catalog+health aggregation shaping (pure transform over fake `notification_sends` rows).
- **Build/typecheck:** main app + ops app.
- **e2e (controller):** Test-to-me delivers to the operator only (no `notification_sends` row, no dedup); Send-to-followers dry-run returns a reach count and a real send logs a `kind:'category'` row + appears in the catalog health; the catalog endpoint returns all categories with correct status. Clean up test rows.

## Error handling

- Internal endpoints: 401 on bad/absent `CRON_SECRET`; ops proxies: 401/403 on non-operator session. Catalog read failures degrade to showing the catalog with empty health (never blank the page). Trigger failures surface a clear error in the panel; the type-`SEND` confirm re-arms on any edit.

## Open questions (for the plan)

- Exact "failures" metric: per-channel `*_stale` are *cleanup* signals (expired subs), not true delivery failures; `fcm_failed` is closer. Decide whether "failures" surfaces `fcm_failed` only, or stale+failed with a tooltip. (Lean: show `fcm_failed` as "failed" and stale separately as "expired".)
- Entity picker for Send-to-followers: reuse the ops command-palette search (`/api/internal/search`) for player/tournament; match needs an id paste or a recent-matches helper.
- Whether to also show the most-recent `kind:'category'` sends as a feed (like broadcast's "recent sends") — nice-to-have; include only if cheap.
