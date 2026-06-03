# Broadcast Push + Notification Analytics — Design

**Date:** 2026-06-03
**Status:** Approved (design)

## Goal

Two related capabilities:

1. **Broadcast push** — send a single notification to *everyone who can receive one*: the union of all three subscription audiences (logged-in web, Android app installs, anonymous web).
2. **Notification analytics** — persist a durable record of every send (broadcast *and* the existing per-match notifications) so we can answer "how many were fired, accepted, clicked?" after the fact. Today these numbers are only logged to the console and returned in the response — nothing is stored.

Primary motivating use case: a one-off "help us / collaborate" campaign to the installed base.

## Tracking fidelity (decided)

Best-practice 80/20 for an app this size:

- **Send-side persistence — always.** Persist what we already compute: fired (attempted), accepted-by-push-service, failed, stale-cleaned, per channel. Free; no client changes. The "accepted by the push service" count is a good-enough proxy for reach.
- **Web click tracking — yes.** The metric that actually matters for a campaign. Cheap on web because the service worker already has a `notificationclick` handler.
- **Displayed/received — deferred.** Highest effort (service worker *and* native app must phone home on every render) and least reliable (battery savers, killed SWs, old app builds under-report). The analytics table is shaped so this can be added later without migration churn.
- **Android click tracking — deferred.** Needs native work; web covers the majority of a small audience.

## Audience (decided)

**Everyone, all channels.** The union of:

| Table | Audience | Transport |
|---|---|---|
| `push_subscriptions` | Logged-in web/PWA | Web Push (VAPID) |
| `native_push_subscriptions` | Android app installs | FCM |
| `anon_push_subscriptions` | Anonymous web visitors | Web Push (VAPID) |

No locale/platform filtering in v1.

## Topology

The operator UI must live on **admin.padelnachos.com** (the `apps/ops` app, package `padel-ops`). But `apps/ops` has **no push-send capability** — no `web-push`, no `firebase-admin`, no VAPID/FCM secrets. Only the **main app** (padelnachos.com) has the send helpers (`src/lib/push.ts`, `src/lib/push-fcm.ts`) and the keys.

There is an established precedent for this exact situation: `apps/ops/src/app/api/internal/trigger-translation-backfill/route.ts` forwards a `fetch` to `https://padelnachos.com/api/admin/...` with the shared secret. We follow it.

```
admin.padelnachos.com  (apps/ops — control plane / operator UI)
  ├─ (app)/system/broadcast        → "Broadcast" tab: compose, dry-run, send-with-confirm, history
  ├─ api/internal/broadcast        → forwards to main app's send endpoint (operator-auth → CRON_SECRET)
  └─ lib/broadcast-queries.ts      → reads notification_sends + clicks from shared Supabase for the history view

padelnachos.com  (main app — owns secrets + sending)
  ├─ api/admin/broadcast-push      → NEW: paginates 3 sub tables, sends via existing sendPush/sendPushToFcmTokens,
  │                                   writes a notification_sends row. Supports { dryRun }.
  ├─ api/push/notify               → EXISTING: add one notification_sends write (bakes analytics into match notifs)
  ├─ api/push/click                → NEW: click beacon target, writes notification_clicks
  └─ public/sw.js                  → notificationclick handler beacons send_id back to /api/push/click

shared Supabase
  └─ notification_sends + notification_clicks   ← written by main app, read by admin UI
```

Rationale: sending stays where the VAPID/FCM secrets already are (no secret duplication, no new attack surface on the admin app); the admin UI lives on admin.padelnachos.com as required; it follows the existing forwarding pattern; the analytics table is shared so both broadcast and match notifications feed one history.

## Data model

Two new tables in shared Supabase (`supabase/migrations/`).

### `notification_sends` — one row per send *event*

- `id UUID PK`, `created_at TIMESTAMPTZ`
- `kind TEXT` — `'broadcast'` | `'match'` (extensible)
- `title TEXT`, `body TEXT`, `url TEXT`
- `label TEXT NULL` — optional campaign label (broadcasts)
- `metadata JSONB DEFAULT '{}'` — e.g. `match_id`, reason breakdown
- `dry_run BOOLEAN DEFAULT false`
- Per-channel counts:
  - `web_fired`, `web_accepted`, `web_failed`, `web_stale`
  - `fcm_fired`, `fcm_accepted`, `fcm_failed`, `fcm_stale`
  - `anon_fired`, `anon_accepted`, `anon_stale`
- Denormalized rollups for fast reads: `recipients_total`, `accepted_total`, `clicks INT DEFAULT 0`

### `notification_clicks` — one row per tap (web, v1)

- `id UUID PK`, `send_id UUID REFERENCES notification_sends(id) ON DELETE CASCADE`
- `clicked_at TIMESTAMPTZ`, `platform TEXT NULL`
- `user_id UUID NULL`, `device_id TEXT NULL` (best-effort, no hard requirement)

A click insert also increments `notification_sends.clicks` so the history view reads in one query.

## Send flow

`POST /api/admin/broadcast-push` (main app, `CRON_SECRET`):

1. Validate `{ title, body, url?, dryRun?, label? }`. `title`/`body` required; `url` defaults to `/`.
2. **Paginate** all 3 subscription tables via `paginatedSelect` (`src/lib/db-paginate.ts`) — they can exceed the 10k PostgREST cap.
3. If `dryRun: true` → return per-channel reach counts, send nothing, write a `notification_sends` row with `dry_run=true` (test runs are auditable).
4. If real → insert the `notification_sends` row first to obtain `send_id`, embed it in each push payload's `data.send_id` (needed for click attribution), then fan out in **batches**: web via `sendPush`, Android via `sendPushToFcmTokens`. Clean stale endpoints/tokens exactly like the existing notify route.
5. Update the row with final counts; return them.

Safety:
- Dry-run is the recommended first step; the admin UI requires a dry-run before the Send button arms, plus a typed confirm.
- "Send test to myself" reuses the existing `/api/admin/test-push`.
- Every send is `allSettled`-style: one bad endpoint never aborts the batch (mirrors the existing notify route).

## Baking analytics into existing match notifications

`POST /api/push/notify` (main app) gains a single `notification_sends` insert with `kind='match'`, populated from the counts it already computes at the end of the run (`recipients`, `inapp_written`, `sent`, `fcm_sent`, `by_reason`, `stale_cleaned`, etc.). `metadata` carries `match_id` and the reason breakdown. No behavior change to delivery — purely additive logging.

## Click tracking (web)

- Push payload carries `data.send_id`.
- `public/sw.js` `notificationclick` handler (already exists for deep-linking) gains a `fetch('/api/push/click', { method:'POST', body: JSON.stringify({ send_id }), keepalive:true })` beacon before opening the window.
- `POST /api/push/click` inserts a `notification_clicks` row and increments `notification_sends.clicks`. Public endpoint (it's a beacon), accepts only a known `send_id`, stores no PII beyond optional platform.

## Admin UI (apps/ops)

New tab under `(app)/system/broadcast` using the existing ops design system primitives (`PageHeader`, `Panel`, `Button`, `DataTable`, `Field`):

- **Compose:** title, body, optional deep-link URL, optional campaign label.
- **Dry run:** button → calls forward endpoint with `dryRun:true` → shows per-channel reach counts. Required before Send arms.
- **Send:** typed confirm → calls forward endpoint for real → shows result counts.
- **History:** `DataTable` of past `notification_sends` (broadcast + match) with fired / accepted / clicks columns, read via `lib/broadcast-queries.ts`.

`api/internal/broadcast` (operator-auth) forwards to `https://padelnachos.com/api/admin/broadcast-push` with `CRON_SECRET`, mirroring `trigger-translation-backfill`.

## Error handling & auth

- Admin UI route → operator session (`session.user.isOperator`).
- Forward route → `CRON_SECRET` to the main app.
- Main send endpoint → `CRON_SECRET`.
- Click endpoint → no auth (beacon), validates `send_id` exists.

## Testing

- Unit: count aggregation + dry-run path (no real network); click endpoint increment.
- Manual end-to-end: dry-run → send-to-self (`/api/admin/test-push`) → small real send, before any full blast.

## Out of scope (v1, YAGNI)

- Audience filtering (locale / platform / logged-in vs anon).
- Scheduling / throttled delivery windows.
- Displayed/received tracking.
- Android click tracking.
- Retention/cleanup cron for the analytics tables.
