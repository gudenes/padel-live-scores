# Match Rating Feature — Design Spec

**Date:** 2026-04-03
**Status:** Approved

## Overview

Allow users to rate finished matches (1-5 scale) with a celebration animation on submission. Ratings are tracked in the database for both logged-in and anonymous users, enabling community averages.

## UI

### Placement

The rating card moves from inside the Score Recap tab to **just below the scores section, above the tab bar**. It renders only for finished matches (`isFinished`). This gives it more visibility without requiring a tab selection.

### Unrated State

Same as current: "Rate this match" label centered above a row of 5 chunky badges (1-5) with "Boring" / "Epic" anchors on each side.

### On Tap — Celebration Burst

1. Selected badge **scales up** (e.g., 36px → 48px) with a spring-like transition.
2. **Particle burst**: 6-8 small dots in brand colors (`GREEN`, `ORANGE`) animate outward from the badge and fade out over ~600ms. Use CSS keyframes — no library needed.
3. Other badges **fade out** (opacity → 0, width → 0) over ~300ms.
4. **Reaction word** fades in below the badge:

   | Rating | Label         |
   |--------|---------------|
   | 1      | Boring        |
   | 2      | Meh           |
   | 3      | Decent        |
   | 4      | Great match!  |
   | 5      | Epic          |

5. After **~2 seconds**, the section **collapses** to a compact single row: the chosen badge (back to 36px) + reaction word + community average (only shown when `rating_count >= 10`).

### Return Visit (Already Rated)

Shows the compact collapsed state immediately — no animation replay. Reads rating from localStorage first (instant), then reconciles with DB if user is logged in.

### Animation Implementation

All CSS — no external animation libraries:
- Badge scale: `transform: scale(1.3)` with `transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)` (spring overshoot)
- Particles: `@keyframes burst` — translate outward + fade opacity to 0
- Collapse: `max-height` transition from current height to compact height over 0.4s

## Data Model

### New Table: `match_ratings`

```sql
CREATE TABLE public.match_ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  device_id text,
  rating smallint NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT one_per_user UNIQUE (match_id, user_id),
  CONSTRAINT one_per_device UNIQUE (match_id, device_id),
  CONSTRAINT must_have_identity CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)
);

CREATE INDEX idx_match_ratings_match ON public.match_ratings(match_id);
```

### Denormalized Columns on `matches`

```sql
ALTER TABLE public.matches
  ADD COLUMN avg_rating numeric(2,1),
  ADD COLUMN rating_count integer DEFAULT 0;
```

### Trigger: Update Aggregates

A Postgres trigger on `match_ratings` (INSERT, UPDATE, DELETE) recomputes `avg_rating` and `rating_count` on the parent `matches` row.

### RLS Policies

- **SELECT**: Allow all (ratings are public data).
- **INSERT**: Allow if `auth.uid() = user_id` OR `user_id IS NULL` (anonymous device ratings).
- **UPDATE**: Allow if `auth.uid() = user_id` OR (`user_id IS NULL` AND matching `device_id`).
- **DELETE**: Not allowed (ratings are permanent).

Note: Anonymous inserts/updates go through a server API route (service key) since RLS can't verify device_id claims. Logged-in user writes can go direct via Supabase client.

## API

### `POST /api/match-rating`

Handles rating upserts for both authenticated and anonymous users.

**Request body:**
```json
{
  "matchId": "uuid",
  "rating": 4,
  "deviceId": "uuid-from-localstorage"
}
```

**Logic:**
1. Check `Authorization` header for Supabase JWT → extract `user_id` if present.
2. If authenticated: upsert with `user_id`, ignore `deviceId`.
3. If anonymous: upsert with `device_id` from body.
4. Return `{ ok: true, avg_rating, rating_count }` (fresh aggregates from the trigger).

**Rate limiting:** One write per match per device/user (enforced by unique constraints). No additional rate limiting needed.

### `GET /api/match-rating?matchId=xxx`

Returns community stats for a match. Used to show avg when `rating_count >= 10`.

**Response:**
```json
{
  "avg_rating": 4.2,
  "rating_count": 47
}
```

This can also be served directly from the `matches` table join (already fetched on page load) if the denormalized columns are included in the match query. In that case, no separate GET endpoint is needed.

## Hook: `useMatchRating`

Updated from current localStorage-only to dual-write:

1. **Init:** Read from localStorage for instant display. If user is logged in, optionally reconcile with DB (low priority — localStorage is source of truth for immediate UX).
2. **On rate:** Write to localStorage immediately (optimistic). Fire `POST /api/match-rating` in the background. On API success, update local state with returned `avg_rating` / `rating_count`.
3. **Device ID:** Generated once as `crypto.randomUUID()`, stored in localStorage key `pn_device_id`. Reused across all anonymous interactions.

### Migration on Login

Same pattern as bookmark migration in `AuthProvider.tsx`:
- On `SIGNED_IN` event, read all ratings from localStorage (`pn_match_ratings`).
- For each, call `POST /api/match-rating` with the user's auth token (which upserts with `user_id` and clears the anonymous `device_id` row if it exists).
- On success, clear localStorage ratings.

## Scope

### In scope
- Move rating card above tabs
- Celebration burst animation (CSS only)
- `match_ratings` table + trigger + RLS
- API route for upsert
- Hook update (dual-write)
- Device ID generation
- Community average display (when count >= 10)
- Rating migration on login

### Out of scope
- Rating distribution chart (future enhancement)
- Rating in match cards on list pages
- Push notifications for highly-rated matches
- Admin moderation of ratings
