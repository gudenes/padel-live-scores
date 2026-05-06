# Anonymous push notifications — design

**Date:** 2026-05-06
**Status:** Approved (brainstorming)

## Background

Today's push subscriptions are scoped to authenticated `user_id`. An anonymous visitor who follows a player or bookmarks a match has no way to receive a "now live" push, even though the picker explicitly promises that ("get notified when {names} go live"). This is a broken-promise gap that surfaced during the picker rollout.

Anonymous push is a feature that competitors (LiveScore, FotMob) ship and that fits the picker's value proposition. It also gives users a meaningful reason to return to the device — even before sign-in.

This spec depends on **[Cookie consent banner](2026-05-06-cookie-consent-banner-design.md) (Spec 1)** being shipped first, since the persistent device identifier we introduce here requires explicit user consent under ePrivacy/GDPR.

## Goals

1. Anonymous users on Android Chrome / desktop Chromium / Firefox who follow a player or match can receive Web Push notifications on the device they used.
2. Subscriptions live device-side; no PII collected. The user's identity (across devices, before sign-in) is not knowable.
3. On sign-in, the device's anon subscription migrates cleanly to the authenticated `push_subscriptions` table — no re-prompting for native browser permission; no stale rows.
4. Existing authenticated push delivery is unchanged; the cron(s) just gain an additional source of subscriptions to notify.
5. Whole feature gated on `pn_consent.push === true` from Spec 1. Without consent, the registration code path is a no-op.

## Non-goals

- iOS Safari support. Web Push on iOS requires PWA installation and an APNs broker — significantly different code path; deferred.
- Tournament follows. Schema is extensible (CHECK constraint allows adding `'tournament'` later) but v1 covers `'player'` and `'match'` only.
- Native FCM/APNs anon registrations. The existing `native_push_subscriptions` table is user-scoped; a mobile-app anon flow is a separate feature.
- Per-category notification preferences ("only finals, not all matches"). Whole-or-nothing for v1.
- Soft re-prompt for users who reject push initially. v1 requires clearing localStorage to re-trigger; a "you may be missing notifications" reminder is a follow-up.

## User flow

```
═══════════════════════════════════════════════════════════════════
First-time anonymous user grants push consent + follows a player
═══════════════════════════════════════════════════════════════════
1. useFollowing.toggle('player', id) — writes to localStorage as today
2. anon-push helper checks the gate:
     - pn_consent.push === true       (Spec 1's banner already accepted push)
     - Notification.permission === 'default'
     - pn_push_prompted is NOT set
   If all true → fire native browser permission prompt.
3. On grant:
     - Generate pn_device_id = crypto.randomUUID() if absent (localStorage)
     - navigator.serviceWorker.ready → registration.pushManager.subscribe({
         userVisibleOnly: true,
         applicationServerKey: VAPID_PUBLIC_KEY,
       })
     - POST /api/anon/push-subscriptions {
         device_id, endpoint, keys: { p256dh, auth }, user_agent,
         bookmarks: [{ type: 'player', target_id }, ...current localStorage follows]
       }
     - Server upserts anon_push_subscriptions on (endpoint), inserts all bookmarks.
     - Set pn_push_prompted='1'.
4. On reject (or browser permission was already 'denied'):
     - Set pn_push_prompted='1' so we never re-ask.
     - The toggle still works as today — only the push registration is skipped.

═══════════════════════════════════════════════════════════════════
Subsequent follow / unfollow on the same anonymous device
═══════════════════════════════════════════════════════════════════
1. useFollowing.toggle('player', id) writes localStorage.
2. If a subscription exists for this device (pn_device_id present + push permission granted):
     - POST /api/anon/push-subscriptions/bookmarks   { type, target_id }   for adds
     - DELETE /api/anon/push-subscriptions/bookmarks { type, target_id }   for removes
3. Failures are tolerated (offline, etc.) — localStorage stays the source of truth.

═══════════════════════════════════════════════════════════════════
Push delivery from existing crons (e.g., live-match-alerts)
═══════════════════════════════════════════════════════════════════
- Existing cron query (authed):
    SELECT s.endpoint, s.keys, ub.target_id
      FROM push_subscriptions s
      JOIN user_bookmarks ub ON ub.user_id = s.user_id
     WHERE ub.bookmark_type='player' AND ub.target_id IN (...);
- New parallel query (anon):
    SELECT a.endpoint, a.keys, ab.target_id
      FROM anon_push_subscriptions a
      JOIN anon_bookmarks ab ON ab.device_id = a.device_id
     WHERE ab.bookmark_type='player' AND ab.target_id IN (...);
- UNION the results, send web-push to each endpoint, increment last_seen_at on success.
- On 404 / 410 from the push service → delete the subscription row (cascade deletes bookmarks).

═══════════════════════════════════════════════════════════════════
User signs in (existing follow migration extended)
═══════════════════════════════════════════════════════════════════
1. Existing useFollowing migration (commit 49cb351) runs: localStorage follows → user_bookmarks.
2. NEW migration step:
     - SELECT * FROM anon_push_subscriptions WHERE device_id = :pn_device_id
     - For each: INSERT INTO push_subscriptions (user_id, endpoint, keys) ON CONFLICT (user_id, endpoint) DO NOTHING
     - DELETE FROM anon_push_subscriptions WHERE device_id = :pn_device_id
       (anon_bookmarks rows cascade-delete via FK; they're already in user_bookmarks anyway)
3. User keeps receiving push under their user_id; the anon row is gone.
4. localStorage pn_device_id can be cleared at this point — but cheaper to leave it; it's just a UUID.
```

## Architecture

### New tables

```sql
-- supabase/migrations/2026MMDD_anon_push_subscriptions.sql

CREATE TABLE anon_push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id       UUID NOT NULL,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh_key      TEXT NOT NULL,
  auth_key        TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX anon_push_subscriptions_device_id_idx ON anon_push_subscriptions (device_id);
CREATE INDEX anon_push_subscriptions_last_seen_at_idx ON anon_push_subscriptions (last_seen_at);

CREATE TABLE anon_bookmarks (
  device_id       UUID NOT NULL,
  bookmark_type   TEXT NOT NULL CHECK (bookmark_type IN ('player','match')),
  target_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (device_id, bookmark_type, target_id)
);

CREATE INDEX anon_bookmarks_target_idx ON anon_bookmarks (bookmark_type, target_id);

-- RLS: server-only access via service role.
ALTER TABLE anon_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE anon_bookmarks         ENABLE ROW LEVEL SECURITY;
-- (No policies — anon role gets no access; only service-role bypass reads/writes.)

-- Cascading delete: when a subscription is removed, drop its bookmarks too.
-- (Implemented as a trigger because the relation is by device_id, not the
-- subscription PK, so a regular FK doesn't cleanly express it.)
CREATE OR REPLACE FUNCTION delete_anon_bookmarks_for_device()
RETURNS trigger AS $$
BEGIN
  DELETE FROM anon_bookmarks WHERE device_id = OLD.device_id
    AND NOT EXISTS (
      SELECT 1 FROM anon_push_subscriptions
       WHERE device_id = OLD.device_id AND id <> OLD.id
    );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER anon_subs_cleanup_bookmarks
AFTER DELETE ON anon_push_subscriptions
FOR EACH ROW
EXECUTE FUNCTION delete_anon_bookmarks_for_device();
```

### New API routes

#### `POST /api/anon/push-subscriptions`

Register a subscription + initial bookmarks.

```ts
// Request body:
{
  device_id: string,        // UUID from localStorage
  endpoint: string,         // push service URL
  keys: { p256dh: string, auth: string },
  user_agent: string,
  bookmarks: Array<{ type: 'player' | 'match', target_id: string }>
}

// Behaviour:
// 1. Upsert anon_push_subscriptions on `endpoint` (idempotent — same device
//    re-registering replaces the row).
// 2. Bulk INSERT bookmarks ON CONFLICT DO NOTHING (also idempotent).
// 3. 200 OK on success; 4xx on validation; 5xx on DB error.
```

#### `POST /api/anon/push-subscriptions/bookmarks`

Add a single bookmark for an existing subscription.

```ts
// Request body:
{
  device_id: string,
  type: 'player' | 'match',
  target_id: string
}

// Behaviour: INSERT ... ON CONFLICT (device_id, bookmark_type, target_id) DO NOTHING.
// 200 OK regardless of insert/no-op.
```

#### `DELETE /api/anon/push-subscriptions/bookmarks`

Remove a single bookmark.

```ts
// Request body: same shape as POST.
// Behaviour: DELETE WHERE device_id=:dev AND bookmark_type=:t AND target_id=:id.
// 200 OK.
```

#### `DELETE /api/anon/push-subscriptions`

Unsubscribe (remove subscription + cascade bookmarks).

```ts
// Request body:
{ endpoint: string }   // server resolves device_id by endpoint match

// Behaviour: DELETE FROM anon_push_subscriptions WHERE endpoint=:e.
// Trigger cleans up anon_bookmarks.
```

### Client-side helpers

`src/lib/anon-push.ts`:
```ts
export async function ensureSubscription(initialFollows: Bookmark[]): Promise<boolean>
export async function addBookmark(b: Bookmark): Promise<void>
export async function removeBookmark(b: Bookmark): Promise<void>
export async function unsubscribe(): Promise<void>
export async function migrateToUser(userId: string): Promise<void>
```

All functions are no-ops if `pn_consent.push !== true` or if `Notification.permission !== 'granted'`.

`src/hooks/useAnonPush.ts` wraps these, exposing memoised callbacks and reading `useConsent()`.

### Modifications to existing code

| File | Change |
|---|---|
| `src/hooks/useFollowing.ts` | After every successful `toggle()` for an anonymous user, call `useAnonPush.addBookmark/removeBookmark` (best-effort, swallows network errors). On the first follow, also trigger `ensureSubscription()` if push is permitted. |
| `src/hooks/useFollowing.ts` (existing migration) | Extend the sign-in migration to also call `migrateToUser()` after the localStorage→DB bookmarks are POSTed. |
| `src/app/[locale]/(app)/welcome/NotificationPromptSheet.tsx` | `handleEnable` now calls `ensureSubscription(currentFollows)` instead of just `Notification.requestPermission()`. |
| `src/components/BookmarkToast.tsx` | The "enable-push" CTA for anon users no longer punts to "sign in first" — it calls `ensureSubscription()` directly. Sign-in flow remains for users who want to save across devices, but is no longer required to receive push. |
| Push-sender cron(s) | Add the anon-table query alongside the existing user-table query; UNION the results before sending. On 404/410 from push service → DELETE the relevant `anon_push_subscriptions` row. |
| `src/app/api/cron/_anon-push-cleanup` (new) | Weekly cron deleting `anon_push_subscriptions` where `last_seen_at < now() - interval '90 days'`. Trigger handles bookmarks. |

## Privacy & RLS

- `anon_push_subscriptions` and `anon_bookmarks` are accessible only via the service role. RLS is enabled with no policies for anon/auth roles.
- `device_id` is a random UUID with no derivable link to user identity, IP, or any third-party identifier.
- `user_agent` is stored only for debugging support tickets ("my notifications stopped working on Android"). Not joined to anything.
- Cleanup cron deletes inactive rows after 90 days — keeps the table bounded and respects "right to be forgotten" implicitly (if you stop using the app, your row goes away).

## i18n

No new keys. The notification permission sheet copy from the picker spec covers the user-facing strings:

- `notificationPrompt.title`, `notificationPrompt.bodyWithNames`, `notificationPrompt.bodyGeneric`, `notificationPrompt.enable`, `notificationPrompt.later`

These already exist in all 5 locales.

## Testing

- Unit tests for `src/lib/anon-push.ts` helpers (mock fetch + Notification API).
- Integration test for the migration flow: anon device follows 2 players → signs in → both rows in `push_subscriptions`, none left in `anon_push_subscriptions`.
- Manual verification on Android Chrome (real push delivery) — incognito session, follow a player who has a live match, observe push.

## Acceptance criteria

- [ ] Anonymous user on Android Chrome who has accepted push consent (Spec 1) and grants the native permission prompt receives a push notification when their followed player goes live.
- [ ] First-follow elsewhere (e.g., from the Following marquee) triggers the same registration flow as the picker.
- [ ] Subsequent toggles update `anon_bookmarks` server-side without re-prompting.
- [ ] Sign-in migrates `anon_push_subscriptions` → `push_subscriptions` once; no double-rows.
- [ ] After sign-in, the user receives push under their `user_id`; no orphan anon rows for the device.
- [ ] On `404`/`410` from push service, the delivery cron deletes the subscription + cascades bookmarks.
- [ ] Weekly cleanup cron deletes subscriptions inactive for 90+ days.
- [ ] Bookmark type CHECK constraint allows `'player'` and `'match'` only; future addition (e.g., `'tournament'`) requires a single migration line.
- [ ] All anon-push code is a no-op when `pn_consent.push !== true`.
- [ ] iOS Safari users gracefully fall through (no errors) — feature simply doesn't activate.
