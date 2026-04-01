# User Authentication & Profile — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Approach:** Supabase Auth (Google OAuth + Magic Link email)

## Overview

Add user authentication to PadelNacho to enable personalized features: cross-device bookmark sync and web push notifications for bookmarked matches going live. The profile is intentionally minimal — just enough to deliver these two features.

## Auth Strategy

**Supabase Auth** — native to the existing Supabase stack. No additional auth services or dependencies beyond `web-push` for notifications.

Two sign-in methods:
- **Google OAuth** (primary) — `supabase.auth.signInWithOAuth({ provider: 'google' })`
- **Magic Link email** (fallback) — `supabase.auth.signInWithOtp({ email })`. No passwords, no sign-up/sign-in distinction. User enters email, receives a one-click sign-in link.

Google OAuth credentials are configured in the Supabase dashboard. No app-level env vars needed for OAuth.

## UI Flows

### Entry Point

The existing profile icon (top-right header, present on all pages) becomes the auth trigger:
- **Logged out:** Generic person icon. Tap → login bottom sheet slides up.
- **Logged in:** Google avatar (or initial letter) with gold accent border. Tap → navigates to profile page.

### Login Bottom Sheet

Slides up from bottom, overlays current page with dimmed background:
1. "Sign in to PadelNacho" heading
2. "Sync bookmarks & get match notifications" subtitle
3. **"Continue with Google"** button (white, Google branding)
4. "or" divider
5. Email input + **"Send link"** button (amber accent)
6. "We'll email you a sign-in link — no password needed" helper text

### Profile Page

Route: `/v2/profile` (or rendered as a sheet/overlay — implementation detail)

Contents:
- **User info:** Avatar (from Google or initial letter), display name, email
- **Notification toggle:** "Match Notifications" with description "Get notified when bookmarked matches go live". Toggle ON/OFF. When toggled ON for the first time, triggers browser push permission prompt.
- **Bookmarked Matches:** List of bookmarked matches showing team names, tournament, round, and live status
- **Bookmarked Players:** Grid of bookmarked players showing avatar and name
- **Sign Out** button (red text, bottom)

## Database Schema

### `profiles` table

Auto-created via a Postgres trigger on `auth.users` insert.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK, FK → auth.users) | Supabase user ID |
| `display_name` | text | From Google profile or email prefix |
| `avatar_url` | text | From Google profile, nullable |
| `created_at` | timestamptz | Default `now()` |

### `user_bookmarks` table

Replaces localStorage bookmarks for authenticated users.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | Default `gen_random_uuid()` |
| `user_id` | uuid (FK → profiles.id) | NOT NULL |
| `bookmark_type` | text | `'match'` or `'player'` |
| `target_id` | uuid | Match ID or player ID |
| `created_at` | timestamptz | Default `now()` |

Unique constraint: `(user_id, bookmark_type, target_id)`

### `push_subscriptions` table

Stores Web Push API subscriptions per user/device.

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid (PK) | Default `gen_random_uuid()` |
| `user_id` | uuid (FK → profiles.id) | NOT NULL |
| `endpoint` | text | Push API endpoint URL |
| `keys` | jsonb | `{ p256dh, auth }` |
| `created_at` | timestamptz | Default `now()` |

Unique constraint: `(user_id, endpoint)`

### RLS Policies

All three tables enforce row-level security:
- `profiles`: Users can SELECT and UPDATE their own row only (`auth.uid() = id`)
- `user_bookmarks`: Users can SELECT, INSERT, UPDATE, DELETE their own rows (`auth.uid() = user_id`)
- `push_subscriptions`: Users can SELECT, INSERT, DELETE their own rows (`auth.uid() = user_id`)

### Trigger: Auto-create profile

```sql
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

## Architecture

### New Files

| File | Purpose |
|------|---------|
| `src/components/AuthProvider.tsx` | React context wrapping the app. Provides `{ user, session, loading, signOut }` via `supabase.auth.onAuthStateChange`. |
| `src/app/auth/callback/route.ts` | Handles OAuth redirect. Exchanges code for session via `supabase.auth.exchangeCodeForSession()`. |
| `src/app/v2/profile/page.tsx` | Profile page: user info, notification toggle, bookmarks list, sign out. |
| `src/components/LoginSheet.tsx` | Bottom sheet with Google + Magic Link sign-in UI. |
| `src/app/api/push/subscribe/route.ts` | POST: Save push subscription to DB. DELETE: Remove subscription. |
| `src/app/api/push/notify/route.ts` | Internal endpoint (protected by `CRON_SECRET`) called by score cron to send push notifications. |
| `public/sw.js` | Service worker handling push events, displaying notifications with match details. |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/supabase.ts` | Ensure browser client supports auth session persistence. |
| `src/hooks/useBookmarks.ts` | If authenticated, read/write `user_bookmarks` table. If not, fall back to localStorage (current behavior). |
| `src/app/layout.tsx` | Wrap app with `AuthProvider`. |
| `src/app/api/cron/scores/route.ts` | After detecting match → `live`, query `user_bookmarks` + `push_subscriptions` and call `/api/push/notify`. |
| Header components (across pages) | Replace static profile icon with auth-aware avatar/icon that opens LoginSheet or navigates to profile. |

## Bookmark Migration

On first sign-in, when `AuthProvider` detects a new session:
1. Read existing localStorage bookmarks (`padel-bookmarks` key)
2. Upsert each into `user_bookmarks` table
3. Clear localStorage bookmarks
4. All subsequent reads/writes go through Supabase

When logged out, `useBookmarks` falls back to localStorage identically to today. Zero regression for anonymous users.

## Push Notification Flow

### Setup
1. User toggles "Match Notifications" ON in profile page
2. Browser shows native push permission prompt
3. On grant: subscribe via `navigator.serviceWorker.ready` → `pushManager.subscribe()` with VAPID public key
4. Save subscription (`endpoint` + `keys`) to `push_subscriptions` via `/api/push/subscribe`

### Sending
1. Score cron (`/api/cron/scores`) detects match status change to `live`
2. Queries `user_bookmarks` WHERE `bookmark_type = 'match'` AND `target_id = <match_id>`
3. Joins with `push_subscriptions` to get endpoints for those users
4. Sends web push via `web-push` npm package with match details (teams, tournament, round)

### Notification Content
- Title: "Match is Live!"
- Body: "Galan/Chingotto vs Tapia/Coello — Miami P1 SF"
- Click action: Opens match detail page (`/match/{id}`)

### Cleanup
- User toggles notifications OFF → unsubscribe from Push API → DELETE from `push_subscriptions`
- Push service returns 410 (gone) → delete stale subscription from DB silently

## Environment Variables

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY   # Web Push VAPID public key (browser-safe)
VAPID_PRIVATE_KEY              # Web Push VAPID private key (server-only)
```

Generate once via `web-push generate-vapid-keys` CLI command.

## Error Handling

| Scenario | Behavior |
|----------|----------|
| OAuth redirect fails | Toast: "Sign in failed, please try again" |
| Magic link sent | Toast: "Check your email for the sign-in link" |
| Magic link expired | Supabase returns error on callback → toast: "Link expired, please request a new one" |
| Push permission denied | Disable toggle, helper text: "Notifications blocked in browser settings" |
| Push subscription expired (410) | Delete from DB silently on next send attempt |
| Network error on bookmark sync | Retry once, fall back to localStorage temporarily |

## Dependencies

- `web-push` — npm package for sending Web Push notifications from Node.js (server-side only)

No other new dependencies. `@supabase/supabase-js` already includes full auth support.

## Out of Scope (v1)

- Additional OAuth providers (Apple, Facebook, etc.)
- Email/password sign-up (traditional)
- User preferences (language, default category, default tab)
- Email digest notifications
- Player bookmark notifications (only match bookmarks trigger push)
- Social features (following other users, sharing bookmarks)
