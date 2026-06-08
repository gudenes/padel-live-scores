# Premium Notifications — Catalog, Pro Tiering & Activation Surfaces

**Date:** 2026-06-08
**Status:** Design approved (pending written-spec review)
**Branch / worktree:** `feat/premium-notifications` → `.claude/worktrees/premium-notifications`

## Summary

PadelNachos today fires three notification types (match live, match finished, plus a defined-but-unwired `ranking_updated`). This project expands the catalog to **18 user-facing notifications** and introduces the app's **first paid tier ("Pro")** as a gating dimension over notifications.

Scope of *this* spec:
1. The full **notification catalog** (free vs Pro), with data-readiness notes.
2. The **tiering / gating model** — how "Pro" is enforced in code.
3. The **UI activation surfaces** — where users turn notifications on, and where the Pro upsell lives.

**Explicitly out of scope (separate later spec):** Stripe / payments / real subscription lifecycle. For now `profiles.plan` is flipped **manually** so the Pro notifications can be built and tested end-to-end. The public-facing Pro surface is a benefits page + waitlist, not a checkout.

## Design philosophy

- **Backbone axis = breadth.** Pro unlocks *new trigger types*; it never degrades or removes a free notification. Easy to communicate ("Pro unlocks more alert types"), and maps cleanly onto the existing per-category system.
- **Free = "follow the result."** The reactive match/tournament lifecycle — reminders and outcomes. Table-stakes, drives retention, generous on purpose for growth.
- **Pro = "follow the story + get the briefing."** Anything *analytical, anticipatory, or batched/personalized*: live drama, draw/projection intel, predictions, milestones, daily/wrap-up digests.
- **No free-tier cannibalization.** Every Pro item is genuinely new; nothing free becomes Pro.

## The catalog

Legend: ✅ exists today · 🆕 new · ⚡ Premier-tier only (relies on live point-by-point or projections, which don't run for FIP-tier) · 💤 batch/scheduled job.

### Free tier (9)

| Key (proposed) | Notification | Trigger | Data readiness |
|---|---|---|---|
| `match_live_*` ✅ | Match is live | `scheduled → live` edge | Exists |
| `match_finished` ✅ | Match finished | match → finished/retired/walkover | Exists |
| `match_scheduled` 🆕 | Match scheduled / time announced | `scheduled_at` first populated (or OOP assigns) | Ready — **date reliable; exact time often approximate**, frame accordingly (`*` suffix convention) |
| `player_title_won` 🆕 | Title won | `round='Final'` + `winner_pair` on the followed player's side | Ready |
| `player_eliminated` 🆕 | Eliminated | followed player on losing side of a finished match (non-final) | Ready |
| `tournament_starting` 🆕 | Followed tournament starting | `tournaments.starts_at` reached | Ready (tournament-follow exists in `user_bookmarks`; needs a notify category) |
| `draw_released` 🆕 | Draw released | `tournament_draws` rows first appear for a followed tournament / followed player's event | Ready |
| `player_entered` 🆕 | Player entered a tournament | entry-list populator resolves a followed player into an event | Ready |
| `weekly_digest` 🆕💤 | Weekly digest | scheduled batch: your players' week + weekend champions + week ahead | Ready (build-heavy: new batch job) |

> **Merge note:** the original ideas "Weekly digest" (#33) and "Your week in padel" (#36) are the same artifact — one batch job, one notification.

### Pro tier (9)

| Key (proposed) | Notification | Trigger | Tier reach |
|---|---|---|---|
| `match_deciding_set` 🆕⚡ | Going the distance | followed match enters a deciding 3rd set | Premier-only |
| `match_upset_live` 🆕⚡ | Upset in progress | lower seed/rank leading a top seed live (threshold on seed/rank gap) | Premier-only |
| `player_path` 🆕 | Player's path | draw position + next opponent for a followed player | Any tier (draw-based) |
| `daily_oop` 🆕💤 | Daily order-of-play | morning batch: followed players' matches today | Any tier (time-precision caveat as `match_scheduled`) |
| `tournament_wrapup` 🆕💤 | Tournament wrap-up | a followed tournament ends: champions + notable results | Any tier |
| `ranking_threshold` 🆕 | Ranking threshold crossed | followed player crosses #1 / top 10 / top 20 (prev vs current weekly snapshot) | Any tier |
| `prematch_prediction` 🆕 | Pre-match prediction | Elo `model_predictions` snapshot before a followed match (the calibrated pre-match number) | Any tier (needs a snapshot) |
| `next_match_drawn` 🆕 | Next match drawn | after a win, next-round slot filled (`fip-winner-propagator`) | Any tier |
| `projection_outperform` 🆕⚡ | Outperforming projection | followed pair advances **past** its frozen `predicted_finish_round` (`tournament_projections`) | Premier-only |

6 of 9 Pro notifications fire on **any tier**, so fans who follow FIP-tier players still get a meaningful Pro bundle; the ⚡ items are the "depth where the data is richest" upsell on top.

### Parked for phase 2 (not in this build)

- **Career-high ranking** — `player_ranking_snapshots` is forward-capture only; needs the planned `player_ranking_stats` / `peak_rank` backfill before "career-high" can be claimed without mislabeling.
- **Win-streak milestone** — needs a per-player consecutive-win computation.
- **News about your player** — `articles` has no article→player entity linking yet.
- **Projection: tournament favorite (P1) / projected finalist (P2)** — `champion_prob` / `finalist_prob` threshold crossings. Deferred; only `projection_outperform` (P3) ships now.

## Tiering / gating model

### 1. Entitlement: `profiles.plan`

- Add `profiles.plan text NOT NULL DEFAULT 'free'` with a check constraint `IN ('free','pro')`.
- Add `profiles.plan_expires_at timestamptz NULL` (forward-compat for time-boxed subscriptions; ignored while billing is deferred, but `isPro()` honors it if set).
- Helper `isPro(profile)`: `plan === 'pro' && (plan_expires_at == null || plan_expires_at > now)`.
- Billing, when it lands later, only flips this column. Nothing downstream changes.

### 2. Category catalog gains a `tier`

In `src/lib/notification-categories.ts`:
- Extend `NotificationCategory` union with the new keys above.
- Add `tier: 'free' | 'pro'` to each category's metadata (move from the current `CATEGORY_DEFAULTS` shape to a richer per-category record holding `{ defaults: ChannelPrefs, tier, group }`).
- Add `group` for settings-page placement (see Activation Surfaces): `'matches' | 'results' | 'tournaments' | 'predictions'`.
- Keep `resolvePrefs` / `resolveAllPrefs` working; add `isProCategory(category)` and `categoriesForTier(plan)` helpers.

### 3. Gate at fan-out (single chokepoint)

In `/api/push/notify`, before computing the recipient delivery for a given category:
- If `isProCategory(category)` and the recipient is **not** Pro → **drop the recipient entirely**: no Web Push, no FCM, **and no `user_notifications` in-app row**. (Withholding the in-app row too is deliberate — otherwise the Pro content leaks into the free inbox.)
- Free categories behave exactly as today.
- Anonymous recipients (`anon_*`) are **free-tier by definition** — Pro categories never fan out to them.

This is the only enforcement point. Senders (crons/workers) don't need tier awareness; they emit the event and the fan-out gates it.

### 4. Settings + prefs API

- `/api/user/notification-prefs` GET returns each category annotated with `tier` and a per-user `locked` boolean (`tier==='pro' && !isPro`).
- PATCH rejects enabling a `tier:'pro'` category for a non-Pro user (defense-in-depth; the UI already locks it).

## UI activation surfaces

### 1. Notification settings page — primary control center

`/profile/settings/notifications` (exists). Reorganize from 2 groups into **4**, so the new categories have a home:

- **Matches** — match live, match finished, match scheduled, going-the-distance 💎⚡, upset in progress 💎⚡, next match drawn 💎
- **Results & milestones** — title won, eliminated, ranking threshold 💎, outperforming projection 💎⚡
- **Tournaments & draws** — tournament starting, draw released, player entered, player's path 💎
- **Predictions & digests** — pre-match prediction 💎, daily order-of-play 💎, weekly digest, tournament wrap-up 💎

Rendering rules:
- Free rows: existing `IconSlider` toggle + per-row `SaveStateSlot` (unchanged).
- Pro rows for **free users**: toggle replaced by a **"Pro" badge**; tapping the row routes to `/pro` (the upsell). The row still shows its label/description so the value is visible.
- Pro rows for **Pro users**: normal toggle.
- Existing master push toggle + mute + permission-blocked banner are unchanged and continue to gate everything.

### 2. First-follow nudge — permission gate

Keep `useNotificationNudge` as-is. It already prompts for OS push permission on first follow; that's the "do you even have push enabled" gate and is orthogonal to tiering.

### 3. Pro upsell surface — `/pro` (billing deferred)

- New page `/pro` (under `[locale]/(app)`, localized in all 5 locales) describing the Pro notification bundle.
- CTA is a **waitlist capture** ("Notify me when Pro launches"), not checkout — billing is a later spec. Store interest (e.g. a `pro_waitlist` row or reuse an existing capture mechanism — to be decided in the plan).
- The page is the destination for every locked Pro row and any future Pro entry points.
- Localized copy lives in `src/messages/*.json` under a `pro.*` namespace.

### 4. Functional gating via manual flag (test path)

- `profiles.plan` is set manually (ops/SQL) for the team + testers. With `plan='pro'`, the settings toggles work and the full Pro notification path can be exercised end-to-end before any billing exists.
- Public users see locked rows + the `/pro` waitlist.

### 5. Contextual hooks (lightweight, optional)

The recipient list is driven by **follows/bookmarks**, which already exist. No new plumbing is required to "activate" a notification beyond (a) OS push permission, (b) following the relevant entity, (c) the category enabled, (d) Pro for Pro categories. Ensuring follow/bookmark affordances are discoverable on player/tournament/projection pages is sufficient; no per-notification inline toggles.

## Senders — where each new event is emitted

Most events already have a producing worker/cron; the new work is detecting the *edge* and POSTing to (or extending) the notify path. The notify endpoint currently auto-detects category from `match.status`; it must be **generalized to accept an explicit `category` (+ context)** so non-match events (rankings, draws, digests, projections) can fan out through the same gate.

| Notification | Emitting source (existing) | New detection work |
|---|---|---|
| match_scheduled | scores/sync cron, OOP writer | fire on first `scheduled_at` set |
| player_title_won / player_eliminated | results-writer / scores | classify final vs non-final loss |
| tournament_starting | scheduler | `starts_at` edge |
| draw_released | draw-fetcher / fip-draw-populator | first draw rows for tournament |
| player_entered | entry-list-populator | followed player resolved |
| weekly_digest 💤 | **new scheduled job** | aggregate + batch fan-out |
| match_deciding_set / match_upset_live ⚡ | live-poller-loop | set/score-state edge detection |
| player_path | draw-fetcher | compute position + next opponent |
| daily_oop 💤 | **new scheduled job** | morning aggregation |
| tournament_wrapup 💤 | scheduler / results | tournament-end edge |
| ranking_threshold | player-rankings worker | prev vs current snapshot crossing |
| prematch_prediction | model-prediction-snapshot | pre-match snapshot for followed match |
| next_match_drawn | fip-winner-propagator | next-round slot filled |
| projection_outperform ⚡ | tournament-projection-snapshot | advanced past frozen `predicted_finish_round` |

> The generalized notify contract and the new batch jobs are the two largest build items; the per-edge detections are individually small.

## Phasing (suggested, to be detailed in the implementation plan)

1. **Foundation** — `profiles.plan` + `isPro`; category catalog `tier`/`group` refactor; fan-out gate; prefs API tier annotations; settings page 4-group + locked rows; `/pro` waitlist page. *(Unlocks the whole model; ships with zero new senders or just the cheapest event.)*
2. **Free event notifications** — match_scheduled, title won, eliminated, tournament starting, draw released, player entered.
3. **Pro event notifications (non-batch)** — player_path, ranking_threshold, prematch_prediction, next_match_drawn, deciding_set ⚡, upset_live ⚡, projection_outperform ⚡.
4. **Digests (batch jobs)** — weekly_digest, daily_oop, tournament_wrapup.

## Open questions for the plan

- Notify-endpoint generalization: extend the existing `/api/push/notify` contract vs add a sibling generic emitter? (Lean: extend, keep one gate.)
- Waitlist storage for `/pro` — new table vs reuse marketing/announcement capture.
- Anti-spam/cadence caps for high-frequency Pro edges (deciding_set, upset_live, prematch_prediction) — per-user/day caps or dedup windows.
- Exact thresholds: upset seed/rank gap; ranking thresholds (#1/10/20 — final list).
