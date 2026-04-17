# Notification Center + Granular Preferences — Design Spec

**Date:** 2026-04-17
**Status:** Approved
**Phase:** 3 (follows Phase 1 profile/settings page + Phase 2 push plumbing)

## Problem statement

Today the app fires push notifications only when a match goes `scheduled → live`. The flow is:

1. `/api/cron/scores/route.ts` detects the transition and fires a fire-and-forget POST to `/api/push/notify`
2. `/api/push/notify` fans out to bookmarkers of the match + followers of the 4 players, dedupes into a single recipient set, fetches their `push_subscriptions`, sends.

Gaps:

- **No history.** A user who misses a push (phone off, permission denied, DND, closed the OS banner too fast) has no way to see what happened. There is no in-app notification log anywhere in the app.
- **All-or-nothing opt-in.** The only switch is "Match Notifications" on the profile page, which toggles the master push subscription. A user can't say "push me for players I follow but don't wake me up for every match I bookmarked" or "I want in-app history but no OS pushes."
- **Push is the only channel.** If a user disables push (or has never granted permission), they receive literally nothing — even though the app could show them what happened next time they open it.
- **No extensibility.** Future triggers (match finished, upcoming, badge earned, streak milestone) have nowhere to write. Each would have to re-implement the fan-out + permission + delivery dance from scratch.

We want a durable notification log, per-category preferences with two channels (push + in-app), and a notification center UI. Infrastructure only this phase — no new triggers.

## Goals

- Durable log of every notification a user received or would have received, visible in an in-app notification center
- Per-category, per-channel preferences (push on/off + in-app on/off, independently) with a master push kill-switch
- Unread bell badge in the app header driving users into the center
- Backward-compatible rewire of `/api/push/notify`: current `match_live` behavior unchanged for users who stay on defaults; honors prefs for everyone else; always writes in-app rows (unless user opted out)
- Zero-migration extensibility: future triggers `match_finished`, `match_upcoming`, `badge_earned`, `streak_milestone`, `marketing` just insert rows with a new `category` value — table, prefs, center, and bell already handle them
- Honor reduced-motion and existing design tokens (V3 chunky clip paths, BadgeIcon outline SVGs, no emojis)

## Non-goals (this phase)

- **New trigger writers.** Only `match_live_follow` and `match_live_bookmark` categories have a live writer (the rewired `/api/push/notify`). The other five categories exist in the schema, defaults, and preferences UI, but nothing writes rows for them yet.
- **Real-time updates in the center.** We poll the unread count every 30s and refetch the list on page focus / pull-to-refresh. No Supabase realtime subscription on `user_notifications`.
- **Grouping / stacking.** One notification per event, even if 3 matches go live in the same cron tick. Grouping can come later.
- **Email channel.** Push + in-app only.
- **Retention cleanup cron.** Documented as future work; rows accumulate until we ship it (acceptable for months at current volumes).
- **Per-device preferences.** Prefs are per-user, applied to every device the user has subscribed.

## Design

### 1. `user_notifications` table

The durable log. One row per (user, event) — already de-duplicated at the notify-endpoint level the same way the current OS `tag` dedupe works (one row per match per user, even if they're both a follower and a bookmarker — the "more specific" follow reason wins, same rule as today).

```sql
CREATE TABLE user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  url         TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_notifications_user_created_idx
  ON user_notifications(user_id, created_at DESC);

CREATE INDEX user_notifications_user_unread_idx
  ON user_notifications(user_id)
  WHERE read_at IS NULL;
```

Column notes:

- `user_id` references the Auth.js `users` table (same FK target as `profiles.id`, `user_bookmarks.user_id`, etc. post the 2026-04-15 Auth.js migration). `ON DELETE CASCADE` so Phase 1's account-delete endpoint wipes notifications automatically without bespoke cleanup.
- `category` is a free-text column, not an enum. Enum would require a migration every time we add a category; the benefit doesn't justify the cost at our volume. The valid values are documented in section 8 and enforced application-side by the write paths.
- `title` and `body` are pre-rendered (not templated) so they stay stable if the underlying entities change (e.g., a player renamed, a tournament deleted). `title` is required; `body` can be null for single-line notifications.
- `url` is an optional deep link (e.g., `/match/{id}`, `/achievements`). The row component uses this for the tap target; a row without a `url` is informational-only.
- `metadata` holds category-specific extras the UI or future pref-filtering may want: for `match_live_*` it will contain `{ match_id, reason: 'follow'|'bookmark', followed_player_name? }`; for `badge_earned` (future) `{ badge_id }`; etc. Typed server-side per category — the table doesn't care.
- `read_at` is null until the user marks the row read. Both "mark one" and "mark all" set `read_at = now()`.
- `created_at` is the index key — we always paginate newest-first.

**Indexes:**

- `(user_id, created_at DESC)` covers the main list query (all categories or a specific category, sorted by time).
- Partial `(user_id) WHERE read_at IS NULL` covers the unread-count endpoint with a tiny index (most rows get read quickly, so the index stays small).

**Retention policy.** Target: 60 days. The record is mainly valuable while it's still timely; beyond 60 days even unread rows are essentially irrelevant. Out of scope to build the cron this phase — document the intended schedule (weekly, Mon 3:30 UTC, `DELETE FROM user_notifications WHERE created_at < now() - interval '60 days'`) so a future PR can drop it in. Until then rows accumulate; at current user + trigger volumes this is fine for many months.

### 2. `profiles.notification_prefs` column

```sql
ALTER TABLE profiles
  ADD COLUMN notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
```

JSONB shape (documented, not constrained):

```json
{
  "match_live_follow":    { "push": true,  "inApp": true  },
  "match_live_bookmark":  { "push": true,  "inApp": true  },
  "match_finished":       { "push": false, "inApp": true  },
  "match_upcoming":       { "push": false, "inApp": true  },
  "badge_earned":         { "push": true,  "inApp": true  },
  "streak_milestone":     { "push": true,  "inApp": true  },
  "marketing":            { "push": false, "inApp": false }
}
```

**Defaults resolution.** The column is `DEFAULT '{}'::jsonb` — every existing and new user starts with an empty object. A helper function `resolvePrefs(stored, category)` merges against the defaults table in section 8, so a missing key returns the category default. Consequence: **adding a new category requires zero migration** — the moment a writer inserts with a new category value, the center renders it under that category's label, the prefs page shows it with the default toggles, and the resolver gives it the right defaults.

**Write path.** `PATCH /api/user/notification-prefs` sets specific category/channel values (see section 3). The endpoint reads the current JSONB, merges the delta, writes back. No partial-column trickery; the payloads are ~600 bytes max.

**Read path (prefs page).** The prefs sub-page fetches the user's profile once on mount, merges against the defaults table, renders toggles.

**Read path (notify rewire).** The notify endpoint fetches `notification_prefs` alongside `push_subscriptions` (single query join), resolves per-recipient, routes.

### 3. Endpoints

All four routes live under `src/app/api/` and use the existing `getUserOrFail()` helper from `src/app/api/user/_auth.ts`. Rate-limiting inherits from Auth.js session middleware (no new custom limiter). All write paths use the service-key client returned by the helper — no RLS lean-ins.

**GET `/api/notifications`** — list current user's notifications.

- Query params:
  - `limit` (default 30, max 100, clamped server-side)
  - `before` — ISO timestamp cursor; returns rows with `created_at < before`
  - `filter` — one of `all` (default), `matches`, `badges`
    - `matches` maps to `category IN ('match_live_follow','match_live_bookmark','match_finished','match_upcoming')`
    - `badges` maps to `category IN ('badge_earned','streak_milestone')`
    - `all` applies no filter
- Response: `{ items: Array<NotificationRow>, nextCursor: string | null }` where `NotificationRow = { id, category, title, body, url, metadata, read_at, created_at }`.
- Sort: `created_at DESC`. Paginated cursor so new arrivals between requests don't shift pages.

**POST `/api/notifications/mark-read`** — mark one, many, or all read.

- Body: one of `{ ids: string[] }` or `{ all: true }`.
- Behavior: `UPDATE user_notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL AND (id = ANY($2) OR $3)` — only updates unread rows, so idempotent.
- Response: `{ updated: number }`.
- `{ all: true }` doesn't honor the current filter — it marks literally all of the user's unread rows read. The UI button says "Mark all read" and that's what it does; a "mark all in this filter read" feature can come later.

**GET `/api/notifications/unread-count`** — bell badge source.

- Response: `{ count: number }` — raw count, uncapped. The UI clamps display to `99+` (see section 6). The partial `user_unread_idx` makes even large counts cheap.
- Called on mount of any page that renders the bell, plus polled every 30s while the tab is foreground. No polling when tab is hidden (use `document.visibilityState`).
- Also refetched immediately after any `mark-read` call and after navigation into/out of `/notifications`.

**PATCH `/api/user/notification-prefs`** — update one category/channel.

- Body: `{ category: string, push?: boolean, inApp?: boolean }`.
- Validates `category` against the known-categories list (rejects unknowns with 400 — keeps the JSON clean; a future category ships via a code update bumping the list).
- Merges into the existing JSONB (read-modify-write inside a single request; the chance of two concurrent writes from the same user is negligible, and last-write-wins is fine here).
- Response: `{ ok: true, prefs: <full resolved prefs object> }` so the client can reconcile optimistic state.

### 4. Rewire `/api/push/notify`

Keep the existing recipient-derivation logic verbatim — it already does bookmark union player-follow, dedupes by user, and picks the more-specific reason per user. Wrap new behavior around that.

**New flow (pseudocode):**

```
1. Build recipientReason map (EXISTING logic, no changes)
2. Batch-fetch for all userIds:
   - prefs:        SELECT id, notification_prefs FROM profiles WHERE id IN (...)
   - subs:         SELECT user_id, endpoint, keys FROM push_subscriptions WHERE user_id IN (...)
3. For each recipient:
   a. category = reason.kind === 'follow' ? 'match_live_follow' : 'match_live_bookmark'
   b. resolved  = resolvePrefs(userPrefs, category)  // merges with defaults
   c. IF resolved.inApp:
      INSERT into user_notifications (user_id, category, title, body, url, metadata)
      (one row per recipient — batch insert all rows at end)
   d. IF resolved.push AND user has subscriptions:
      sendPush(...) for each sub (EXISTING code path)
4. Log: recipients, inapp_written, push_sent, push_stale_cleaned
5. Return: { recipients, inapp_written, push_sent, by_reason, stale_cleaned }
```

**Shared payload:**

- `title`: same as today's push `title` field
- `body`: same as today's push `body` field (`{team1} vs {team2} — {tournament} {round}`)
- `url`: `/match/{matchId}`
- `metadata`: `{ match_id: matchId, reason: 'follow'|'bookmark', followed_player_name?: string }`

**Independence of failures.** In-app insert and push send run in separate `Promise.allSettled` blocks. A push-send failure never blocks the in-app write; an in-app insert failure never blocks the push. Both counts logged separately. Stale-subscription cleanup stays unchanged.

**Backward compat.** Any user who has never touched preferences has `notification_prefs = '{}'`; both `match_live_*` categories default to `push: true, inApp: true`; they get the push they got yesterday PLUS a new in-app row. Users who explicitly toggle off either channel for those categories stop getting that channel.

**New parameters on `/api/push/notify`.** None — same request shape (`{ matchId }`), same auth (`Bearer CRON_SECRET`). Only the response adds `inapp_written` alongside the existing `sent` / `by_reason` / `stale_cleaned` fields.

### 5. `/notifications` page

**Route:** `src/app/[locale]/(app)/notifications/page.tsx`. Lives inside the `(app)` segment so it inherits the shared layout (AppHeader + BottomNav). Client component — fetches on mount, no SSR payload needed.

**Layout:**

- Sub-header row below AppHeader:
  - Left: back button (← chevron, routes to `document.referrer` or `/home` fallback) + page title "Notifications"
  - Right: "Mark all read" text button (hidden when unread count is 0)
- Filter tabs row: pill group "All · Matches · Badges" — active tab has V3 green fill, others rgba(255,255,255,0.06) with border
- List area:
  - Day separator headers: "Today", "Yesterday", "This week", then `MMM D` for older — grouped by the user's local timezone (from `geo-timezone` cookie, same mechanism the rest of the app already uses, see `src/i18n/request.ts`)
  - Notification rows (see below)
  - Infinite scroll via IntersectionObserver on a sentinel at the list end (the project already has this pattern in `useInViewOnce.ts`; reuse it — no new library)
  - Loading skeleton during initial fetch
  - Empty state: "No notifications yet" with a subtitle "We'll let you know when your matches go live"

**NotificationRow component:**

- Left tile (48×48, `polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)` clip, BadgeIcon-style): category-colored background + outline SVG icon from the existing BadgeIcon icon set. Color + icon mapping:

  | Category | Color | Icon |
  |---|---|---|
  | `match_live_follow` | `#FF4655` (red) | `bell` |
  | `match_live_bookmark` | `#FF4655` (red) | `bell` |
  | `match_finished` | `#7ED321` (green) | `checkmark` |
  | `match_upcoming` | `#F5A623` (orange) | `bell` |
  | `badge_earned` | `#F5A623` (orange) | `star` |
  | `streak_milestone` | `#FF6B35` (red-orange) | `lightbulb` |
  | `marketing` | `#D4AF37` (gold) | `globe` |

- Middle column: title (14px, 600 weight, white) on top; body (12px, 500 weight, `V3.MUTED`) below, truncated to two lines with `-webkit-line-clamp: 2`
- Right column: relative timestamp (12px, `V3.MUTED`) — "2m", "1h", "Yesterday", `MMM D`
- Unread styling: 2px `#7ED321` left border, plus a 6×6 `#7ED321` square dot (the app's chunky clip style) aligned right of the title row
- Tap behavior:
  - Optimistic: mark `read_at` locally and immediately fire `POST /api/notifications/mark-read` with `{ ids: [id] }`
  - If `url` is present: navigate (using the locale-aware `useRouter` from `@/i18n/navigation`)
  - If `url` is absent: stay on page (row just dims from unread to read)
- Unread-count side effect: after mark-read, invalidate the bell count (the bell owns its own fetch via broadcast-channel or a window event — see section 6)

**"Mark all read" button:**

- Fires `POST /api/notifications/mark-read` with `{ all: true }`
- Optimistically marks every visible row read + zeroes the bell count
- On server failure, reverts (show a toast)

**Tab switching.** Changing filter resets the list, cursor, and triggers a fresh GET. No client-side filtering of a cached list — always refetch, so the page never lies about what matches the filter (e.g., a `marketing` row inserted while the user is on `Badges` won't silently appear there).

**Accessibility.** Each row is a `<button>` (not a `<div>` with `onClick`) so screen readers announce it correctly. Unread state announced via `aria-label` suffix ("… unread").

### 6. Bell icon in app header

**Location.** Insert into `src/components/AppHeader.tsx` between the Share button and `<ProfileButton />`. The visual order becomes: Logo · Search · Share · **Bell** · Profile. (Spec said "before ProfileButton" = left of it = after Share.)

**Visuals.**

- 34×34 square with `polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)` clip (the `CHUNKY.button` token already defined at the top of `AppHeader.tsx`)
- `background: 'rgba(255,255,255,0.06)'`, `border: '1px solid rgba(255,255,255,0.10)'` — matches the Share button exactly
- Inner SVG: `bell` path from `BadgeIcon.tsx` (stroke `#7ED321`, stroke-width 2.5, rounded caps), size 15×15
- Unread counter: red circle (12×12, `background: '#FF4655'`, white text, `font-size: 9px`, `font-weight: 700`, border `2px solid #0A0A0A` for halo); positioned top:-4, right:-4; text is `count` when `count < 99` and `'99+'` when `count >= 99`; hidden entirely when `count === 0`
- `aria-label`: "Notifications, {count} unread" (or "Notifications" when 0)

**Behavior.**

- New component `src/components/NotificationBell.tsx` (client component)
- On mount (only when authenticated — hidden for logged-out users): `GET /api/notifications/unread-count`
- Poll every 30s when `document.visibilityState === 'visible'`; pause when hidden
- On click: route to `/notifications` (locale-aware `useRouter`)
- Listens for a `window` custom event `'pn:notifications-updated'` — the `/notifications` page dispatches this after mark-read so the bell refetches immediately without waiting for the next poll tick
- Cleans up interval + listener on unmount

**Hidden when logged out.** No user → no bell (returns `null`). Keeps layout calm for anonymous users.

### 7. `/profile/settings/notifications` granular prefs

**Route:** `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`. Lives under the not-yet-built Phase 1 `/profile/settings` parent — linked from the main settings page.

**Layout (top-down):**

1. Page header row: back button + title "Notifications"
2. Permission-denied banner (conditional): shown when `Notification.permission === 'denied'`. Yellow-accent card: "Notifications blocked in your browser settings. Push notifications won't arrive until you re-enable them." No retry button — browsers don't let us re-prompt after denial; user must go into OS/browser settings themselves.
3. Master row: "Push notifications" big label + toggle. Wired to the existing `usePushNotifications` hook's `toggle()` — reuses subscribe/unsubscribe logic, including the VAPID permission prompt. This phase does NOT re-implement any of it.
4. Column header row: `PUSH    IN-APP` (right-aligned, 11px uppercase, `V3.MUTED`)
5. Category group: "Matches"
   - `match_live_follow` — label "Followed player goes live", sub "When a player you follow is about to play"
   - `match_live_bookmark` — label "Bookmarked match goes live", sub "When a match you saved starts"
   - `match_finished` — label "Match finished", sub "Results for matches you follow"
   - `match_upcoming` — label "Match starting soon", sub "30 min before a followed match"
6. Category group: "Achievements"
   - `badge_earned` — label "Badge earned", sub "When you unlock a new badge"
   - `streak_milestone` — label "Streak milestone", sub "3, 7, 30, 100-day streaks"
7. Category group: "Other"
   - `marketing` — label "Product updates", sub "New features, events, occasional news"

Each category row has two toggles (push, inApp). When the master push kill-switch is OFF, the entire PUSH column dims (`opacity: 0.3`, `pointer-events: none`) and toggles show as OFF visually regardless of per-category `push` value — the stored value is preserved so re-enabling master restores previous preferences.

**Toggle interaction.**

- Optimistic UI: flip the toggle immediately, fire `PATCH /api/user/notification-prefs` with `{ category, push?/inApp? }`
- On 5xx response: revert toggle + toast "Couldn't save — please try again"

**Initial load.**

- `GET /api/user/notification-prefs` (reuse/add a GET variant of the PATCH endpoint — or fold into an existing profile-read endpoint; spec says: **add GET to `/api/user/notification-prefs` returning the resolved full prefs object**)
- Merge response with defaults table before rendering

### 8. Categories — reference table

Source of truth for defaults + writers. Ship as `src/lib/notification-categories.ts` so the resolver, the prefs page, and the notify endpoint all import from one place.

| Category | Writer (today) | Future writer | Push default | In-app default | Active today? |
|---|---|---|---|---|---|
| `match_live_follow` | `/api/push/notify` | — | ✓ | ✓ | yes |
| `match_live_bookmark` | `/api/push/notify` | — | ✓ | ✓ | yes |
| `match_finished` | — | scores cron | ✗ | ✓ | no |
| `match_upcoming` | — | daily cron | ✗ | ✓ | no |
| `badge_earned` | — | badge evaluator | ✓ | ✓ | no |
| `streak_milestone` | — | streak updater | ✓ | ✓ | no |
| `marketing` | — | manual/campaign | ✗ | ✗ | no |

### 9. Phase 1 interaction: settings-page link change

Phase 1 (profile/settings design) currently specifies a single "Push notifications" toggle row on the main settings page, wired to `usePushNotifications().toggle`. This phase modifies that one row:

- Replace the toggle with a navigation row
- Row label stays "Notifications" (dropping "Push" since it now covers both channels)
- Row sub-text: "Choose what you're notified about" (or similar — final copy in i18n section)
- Tapping the row routes to `/profile/settings/notifications`
- Right-side chevron (>) replaces the toggle control

The master push toggle (section 7 item 3) on the sub-page is where the actual subscribe/unsubscribe happens; the parent settings page no longer manages that.

### 10. i18n

All new UI strings under a new `notifications` namespace in `src/messages/en.json`. Proposed keys (English shown):

```json
{
  "notifications": {
    "title": "Notifications",
    "markAllRead": "Mark all read",
    "filterAll": "All",
    "filterMatches": "Matches",
    "filterBadges": "Badges",
    "empty": "No notifications yet",
    "emptySubtitle": "We'll let you know when your matches go live",
    "daySeparator": {
      "today": "Today",
      "yesterday": "Yesterday",
      "thisWeek": "This week"
    },
    "settings": {
      "title": "Notifications",
      "permissionDeniedTitle": "Notifications blocked",
      "permissionDeniedBody": "Push notifications won't arrive until you re-enable them in your browser settings.",
      "masterLabel": "Push notifications",
      "columnPush": "PUSH",
      "columnInApp": "IN-APP",
      "groupMatches": "Matches",
      "groupAchievements": "Achievements",
      "groupOther": "Other",
      "category": {
        "match_live_follow":    { "label": "Followed player goes live",  "sub": "When a player you follow is about to play" },
        "match_live_bookmark":  { "label": "Bookmarked match goes live", "sub": "When a match you saved starts" },
        "match_finished":       { "label": "Match finished",             "sub": "Results for matches you follow" },
        "match_upcoming":       { "label": "Match starting soon",        "sub": "30 min before a followed match" },
        "badge_earned":         { "label": "Badge earned",               "sub": "When you unlock a new badge" },
        "streak_milestone":     { "label": "Streak milestone",           "sub": "3, 7, 30, 100-day streaks" },
        "marketing":            { "label": "Product updates",            "sub": "New features, events, occasional news" }
      },
      "saveError": "Couldn't save — please try again"
    },
    "settingsLinkRow": {
      "label": "Notifications",
      "sub": "Choose what you're notified about"
    }
  }
}
```

Other locales (`es`, `pt`, `it`, `fr`) get one combined translation task in the implementation plan — not drafted in this spec.

## Migrations

Two new files under `supabase/migrations/`.

### `20260418_user_notifications.sql`

```sql
-- User notifications: durable in-app log of events shown to a user.
-- Written by the notify endpoint + future event triggers (match_finished,
-- badge_earned, etc.). Read by the /notifications page and the header bell.
-- Rows cascade-deleted when the Auth.js user is deleted.

CREATE TABLE IF NOT EXISTS user_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category    TEXT NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT,
  url         TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_notifications_user_created_idx
  ON user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS user_notifications_user_unread_idx
  ON user_notifications(user_id)
  WHERE read_at IS NULL;

COMMENT ON TABLE user_notifications IS
  'Durable in-app notification log. One row per user per event. Retention target: 60 days (cleanup cron TBD).';
COMMENT ON COLUMN user_notifications.category IS
  'Free-text category key; see src/lib/notification-categories.ts for valid values.';
COMMENT ON COLUMN user_notifications.metadata IS
  'Category-specific extras (match_id, badge_id, reason, etc.). Shape depends on category.';
```

### `20260418_profiles_notification_prefs.sql`

```sql
-- Per-user notification preferences: one JSONB keyed by category,
-- each value is { push: bool, inApp: bool }. Missing keys fall back
-- to defaults in src/lib/notification-categories.ts, so adding new
-- categories requires no migration.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS notification_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN profiles.notification_prefs IS
  'Per-category, per-channel notification prefs. Shape: { [category]: { push: bool, inApp: bool } }. Missing keys fall back to defaults defined in code.';
```

## Dependencies on Phase 1

This spec assumes Phase 1 (profile settings page) ships first or in parallel. Concretely:

- Route `src/app/[locale]/(app)/profile/settings/page.tsx` exists and includes a "Notifications" row. Phase 1's original row was a toggle; this spec amends it to a navigation row (section 9).
- Phase 1's account-delete endpoint deletes the Auth.js user, which now cascades to `user_notifications` via the FK. No additional delete logic needed here.

If Phase 1 slips, this phase can still ship the sub-page at the planned route — users just won't have a way to navigate to it from the profile (until the main settings page lands).

## Testing strategy

### Unit

- `resolvePrefs(stored, category)` — correct merge against defaults, missing categories, empty stored, partial stored ({push set, inApp unset})
- `categoryFilter('matches')` / `categoryFilter('badges')` / `categoryFilter('all')` resolver — correct IN-lists, empty for unknown filter

### API-route integration

- `GET /api/notifications` — auth required; filter + limit + cursor pagination; sort order
- `POST /api/notifications/mark-read` — `{ ids }` path; `{ all }` path; idempotent when re-run; cross-user isolation (user A can't mark user B's rows)
- `GET /api/notifications/unread-count` — counts only unread; bounded; cross-user isolation
- `PATCH /api/user/notification-prefs` — merges correctly; rejects unknown categories; validates body shape
- `/api/push/notify` rewire —
  - Baseline: user with empty prefs gets both push + in-app row (regression guard for default-on behavior)
  - `push: false, inApp: true`: no push, one in-app row
  - `push: true, inApp: false`: push sent, no in-app row
  - `push: false, inApp: false`: nothing written, nothing sent — user still counts as a "recipient" in the recipient map but 0 channel delivery
  - Push-send failure does not prevent in-app write
  - Partial failure logged but endpoint returns 200

### UI component

- `NotificationRow` renders correct tile color + icon for each category
- Unread state renders green border + dot; read state doesn't
- Tap dispatches mark-read + navigation when `url` present
- `NotificationBell` shows count 1..98; shows `99+` at 99 and above; hidden at 0; hidden when logged out
- Prefs page: master-off dims push column + preserves stored values; permission-denied banner renders only when `Notification.permission === 'denied'`

### Manual QA script

1. Bookmark a match that's about to go live; wait for transition; verify: push arrives AND a new row exists in the center (log in, pull up `/notifications`).
2. Open the prefs page, disable `match_live_bookmark.push`, bookmark another match going live; verify: no push, in-app row still created.
3. Disable both channels on `match_live_bookmark`, trigger again; verify: nothing arrives in either place.
4. Tap a notification row; verify: navigates to `/match/{id}` AND the row becomes read AND the bell count drops by 1.
5. Tap "Mark all read"; verify: all rows dim AND the bell count becomes 0.
6. Flip the master push switch off; verify: PUSH column dims, per-category push toggles all visually off.
7. Flip master back on; verify: per-category push values restore to what they were.
8. Open the app in a 2nd tab; verify: bell count stays in sync within 30s (via poll).
9. Revoke notification permission at the browser level; verify: the denied banner appears; toggling master off/on no-ops without errors.
10. As a logged-out user, verify: no bell in the header, `/notifications` redirects to login.

## Rollout plan

1. **Migrations.** Apply both SQL files via the Supabase dashboard. Zero-downtime — new table, new nullable-with-default column. No backfill required.
2. **Ship infra code first, behind no flag.** The four new API routes + the `notification-categories.ts` module can ship safely on their own — with no UI referencing them, they're dead code.
3. **Rewire `/api/push/notify`.** This is the first user-visible change. Every existing user has `notification_prefs = '{}'`, which resolves to `push: true, inApp: true` for both match categories → same push behavior as before, plus a new in-app row they don't see yet. Monitor the response-field `inapp_written` count for 24h; should equal or exceed `sent`.
4. **Ship the bell + `/notifications` page.** Users now see their in-app log. Existing users start seeing "unread" rows for any match-live events that fired since step 3.
5. **Ship the prefs sub-page + update the settings-page row.** Users can now opt out per-category.
6. **Translate.** Non-English locales get the `notifications` namespace — one combined task, referenced in the plan.

Rollback story: if step 3 breaks push delivery, revert the route change only — the new tables/columns stay but sit empty/default. No other rollback needed since steps 4+ are purely additive UI.

## Open questions

1. **Counter cap at the API or UI?** Spec chose UI-side (`99+` rendering), server returns raw count. If the count is pathologically large (user returning after months), the raw query still returns fast thanks to the partial index, so no DB concern. Leaving as UI-clamps.
2. **Do we cascade `user_notifications` deletion through `profiles` too?** FK is to `users` (Auth.js) not `profiles`. Since `profiles.id` already cascades from `users.id`, deleting the Auth.js user drops both atomically. Leaving FK target as `users(id)` for parity with bookmarks/badges/etc.
3. **Retention cron now or later?** Later. Volume projection at current trigger-rate × current user-count suggests <100k rows after a year — DB won't notice. Revisit when the user base or trigger variety grows.
4. **`marketing` defaults to off for both channels — should `inApp` default to on?** Decision: off for both. Unlike match/badge events (which the user implicitly opted into by bookmarking/following), marketing is opt-in. User flips it on if they want product updates.
5. **Should the notify rewire batch-insert in-app rows in one statement?** Yes — section 4 already specifies a batched insert after the recipient loop to keep it O(1) DB round-trips. Existing push sends are parallelized via `Promise.allSettled` per-subscription and stay that way.
