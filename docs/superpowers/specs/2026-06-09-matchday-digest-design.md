# Morning Matchday Digest — Design

**Date:** 2026-06-09
**Status:** Design approved (pending written-spec review)
**Worktree / branch:** `feat/matchday-digest` → `.claude/worktrees/matchday-digest`

## Summary

Replace the mistimed per-match `match_scheduled` notification with a **free, once-per-morning "your players today" digest**, fired in each **tournament's local morning** (~08:00). Realizes the existing `daily_oop` category as the free morning digest with a real sender; retires the on-write `match_scheduled` sender. Ships dark behind a flag, consistent with the rest of the notification rollout.

## Why

`match_scheduled` fires the moment a firm time is written — usually the **evening before** (when tomorrow's OOP drops), at scrape o'clock, once per match. That's badly timed and noisy. The right shape is a **morning heads-up**: *"Madrid P1 — your players today: Tapia ~18:00, Galán 19:30, Sánchez 16:00,"* sent once in the morning, consolidating a recipient's matches.

We do **not** persist a per-user timezone (geo-timezone is a request-only cookie), but **tournament timezone is resolvable** (`tournaments.timezone`/`country` → `getTournamentTimezone`). So "morning" = the **tournament's** local morning. (Per-user-local morning is a deferred follow-up that needs `profiles.timezone` capture.)

## Category changes

- **`daily_oop`** → flip tier **`pro → free`**; it becomes the morning matchday digest with a real sender. Keep `comingSoon: true` (Soon pill) until the digest flag is enabled in prod; drop it on go-live (same pattern as the other senders). Update its `CATEGORY_RULES` rule to describe the morning digest.
- **`match_scheduled`** → **retired**: remove its on-write `notifyEvent` call from `fip-oop-writer`, and remove the `match_scheduled` category from `CATEGORY_META`/`CATEGORY_RULES`/the `NotificationCategory` union + its i18n entries + the catalog test's "live categories" expectation. (The `matches.scheduled_notified_at` column is left in place — harmless; dropping it is unnecessary churn.)

## Trigger & timing

- New **Vercel cron** `/api/cron/matchday-digest`, schedule **`0 * * * *`** (hourly), `Authorization: Bearer $CRON_SECRET` (same pattern as `recompute-earnings`). Gated by **`ENABLE_MATCHDAY_DIGEST`** env (default off → returns `{ disabled: true }`), so it ships dark.
- Each run:
  1. Find tournaments that have **matches scheduled today** and resolve each tournament's timezone (`getTournamentTimezone`). Tournaments with an **unresolved tz are skipped + logged** (no wrong-time sends).
  2. For each, compute its **local now**; proceed only if local time is **≥ 08:00** AND the digest for that **(tournament, local date)** hasn't already been sent (idempotency, below).
  3. "Today" = matches whose `scheduled_at` falls within the tournament-local calendar day (computed as a UTC range from the tz).

## Recipients & content

For each qualifying tournament + its today-matches:
- **Recipients:** users who **follow a player** in any of those matches (`user_bookmarks` `bookmark_type='player'` on the matches' 4 player FKs) OR **bookmarked** one of the matches (`bookmark_type='match'`); plus **anon devices** (`anon_bookmarks` player/match → `anon_push_subscriptions`).
- **One digest per (recipient, tournament).** Body lists the recipient's relevant matches in that tournament today, ordered by time: *"Madrid P1 — your players today"* / body: `Tapia ~18:00 · Galán 19:30 · Sánchez/Josemaría 16:00` (+ `*`/`~` marker on approximate times). **Cap** at the first 4, append "…and N more" beyond that.
- Times rendered in the **tournament's** local tz. **Approximate** times (label contains "Not before"/"Followed by") get the `~`/`*` marker (reuse the existing inference; `matches` has no boolean flag — infer from `schedule_label`).

## Idempotency

`notification_events_sent` key per recipient + tournament + local date:
`matchday_digest:<tournament_id>:<YYYY-MM-DD>:<userId>` (authed) / `…:anon:<deviceId>` (anon). Claimed (insert-once via `claimNotificationEvent`) before sending, so the hourly cron sends each recipient **once per tournament per day**.

## Sender architecture

This is a **new user-centric batch sender** — the existing `/api/push/notify` and `/api/push/notify-event` are entity→followers fan-outs; a digest is the inverse (one push per *recipient* summarizing N matches). The cron route:

1. **Scan** today's matches across qualifying tournaments — `paginatedSelect` (10k-cap rule) on `matches` joined to tournaments.
2. **Build recipient → matches map**: query `user_bookmarks` (player + match) and `anon_bookmarks` for the day's matches/players; group by recipient.
3. **Gate** per authed recipient: `resolvePrefs(prefs, 'daily_oop').push` AND not muted AND free-category passes `shouldDeliverToRecipient` (it's free → always). Anon recipients always pass (no prefs).
4. **Compose** one digest per (recipient, tournament) and **send** via the existing transports — `sendPush` (web `push_subscriptions`), `sendPushToFcmTokens` (FCM `native_push_subscriptions`), `sendPush` (anon `anon_push_subscriptions`). Stale-subscription cleanup as elsewhere.
5. **Claim** the idempotency key per recipient before sending; **log** one `notification_sends` row (`kind:'category'`, `metadata.category='daily_oop'`) per run/tournament for console telemetry.

Pure, unit-testable helpers (extracted): tournament-local "is it ≥08:00 + today's UTC window" calc; recipient→matches grouping; digest copy formatting (list + cap + approximate marker).

## Ship-dark / go-live

- `ENABLE_MATCHDAY_DIGEST` env (Vercel), default off. `daily_oop` keeps `comingSoon: true` until enabled.
- Go-live: set the env true + drop `daily_oop`'s Soon pill (one-line). No backfire risk (digest is forward-looking — it sends for *today's* matches when a tournament hits its morning; the idempotency key is per-day so it won't re-blast).

## Testing

- **Unit:** the tournament-local-morning gate (given tz + now → eligible? + today's UTC bounds); recipient grouping; digest copy (ordering, cap "+N more", approximate marker). Pure functions, table-tested.
- **Build/typecheck:** main app.
- **e2e (controller):** with the flag on + a followed player in a tournament that has matches today, the cron sends one digest to the operator (or a test recipient) and logs a `notification_sends` row; re-running the same hour does not re-send (idempotency). Clean up.

## Out of scope (follow-ups)
- **Per-user-local morning** (option B) — needs `profiles.timezone` capture.
- **Pro-enriched** digest (pre-match odds / where-to-watch).
- **Same-day schedule-change** instant alerts.
- Firing from the **ops Schedule Review** apply-path.
- Removing the now-unused `matches.scheduled_notified_at` column.
