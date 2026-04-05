# Favorites & Following System — Design Spec

**Date:** 2026-04-05
**Status:** Draft
**Concept:** C — Smart Sections (FotMob-inspired dashboard)

---

## Overview

Add a Favorites/Following system to PadelNachos that lets users bookmark individual matches and follow players, tournaments, and news sources. A new "Following" tab in the bottom nav provides a dashboard of everything the user cares about.

Two distinct action types:
- **Bookmark** (star): one-off tracking of a specific match
- **Follow** (heart/+ Follow): ongoing subscription to a player, tournament, or news source

## Storage Strategy

**Dual-mode** (same pattern as existing `useBookmarks`):
- **Anonymous:** localStorage, zero friction
- **Authenticated:** Supabase `user_bookmarks` table with RLS
- **On sign-in:** migrate localStorage follows to Supabase (merge, don't overwrite)

## Data Model

### Extend `user_bookmarks` table

Current schema supports `bookmark_type IN ('match', 'player')`. Extend the CHECK constraint to support all entity types:

```sql
ALTER TABLE public.user_bookmarks
  DROP CONSTRAINT user_bookmarks_bookmark_type_check,
  ADD CONSTRAINT user_bookmarks_bookmark_type_check
    CHECK (bookmark_type IN ('match', 'player', 'tournament', 'news_source'));
```

No new tables needed. The existing `target_id` (UUID) works for matches, players, and tournaments. For `news_source`, `target_id` stores the source name as a string (cast from text to UUID is not needed — we change `target_id` to `text` type, or use a separate `target_key text` column). Simpler approach: since `target_id` is already `uuid NOT NULL`, news sources will use the localStorage-only path with source names as string keys in the `news_sources` array. Supabase storage for news sources can be added later when we have a `news_sources` reference table.

### localStorage schema

```typescript
// Single key for all follows
const STORAGE_KEY = 'pn_following'

interface FollowingStore {
  matches: string[]      // match UUIDs (bookmarked)
  players: string[]      // player UUIDs (followed)
  tournaments: string[]  // tournament UUIDs (followed)
  news_sources: string[] // source name strings (followed)
}
```

## Hook: `useFollowing`

Replaces the current `useBookmarks` hook. Provides a unified API for all follow types.

```typescript
interface UseFollowing {
  // Check if an entity is followed/bookmarked
  isFollowing: (type: FollowType, targetId: string) => boolean

  // Toggle follow/bookmark state
  toggle: (type: FollowType, targetId: string) => Promise<void>

  // Get all followed IDs for a type
  getFollowed: (type: FollowType) => string[]

  // Counts per type (for badges, empty states)
  counts: Record<FollowType, number>

  // Loading state
  loaded: boolean
}

type FollowType = 'match' | 'player' | 'tournament' | 'news_source'
```

**Migration path:** The existing `useBookmarks` hook and its `pn_bookmarked_matches` localStorage key will be migrated into the new `useFollowing` hook on first load. Old key is read, merged into the new format, and the old key is deleted.

## Bottom Nav Changes

Expand from 3 tabs to 4:

| Position | Tab | Icon | Route |
|----------|-----|------|-------|
| 1 | Matches | Padel ball | `/v3/scores` |
| 2 | Home | House | `/v3` |
| 3 | Following | Star (outlined/filled) | `/v3/following` |
| 4 | Feed | Broadcast | `/v3/feed` |

The star icon is the sports app standard for favorites (Flashscore, FotMob). Active state uses the existing green accent (`#7ED321`).

## Following Page Layout (`/v3/following`)

Smart Sections layout — a single scrollable page with horizontal card sections:

### Section 1: Live & Upcoming (hero section)
- Auto-populated from followed players + followed tournaments + bookmarked matches
- Shows matches where any followed player is playing, any followed tournament's matches, or individually bookmarked matches
- Horizontal scroll of compact match cards (reuse `UpcomingMatchCard` style)
- Live matches show live score + red "LIVE" badge
- If empty: "No upcoming matches from your follows"

### Section 2: Players
- Horizontal scroll of mini avatar cards (initials, name, ranking, country)
- Last card is "+ Add Player" with dashed border — opens search overlay
- Tap a player card → navigate to their profile
- "See All" link → full list view

### Section 3: Tournaments
- Horizontal scroll of tournament cards (icon, name, status/dates)
- Live tournaments show red status badge
- "+ Add" card opens tournament list
- "See All" link → full list view

### Section 4: News Sources
- Horizontal scroll of source brand cards (logo/initials, name)
- "Manage" link → toggleable list of all available sources

### Empty State (no follows at all)
Centered illustration with:
- Star icon (large, muted)
- "Follow players and tournaments"
- "Bookmark matches to track them here"
- CTA button: "Browse Players" → rankings page

## Follow Action Entry Points

### 1. Bookmark Match (Star icon)

| Location | Placement | Style |
|----------|-----------|-------|
| Upcoming match cards (home) | Top-right corner | 16px outlined star, muted → gold on tap |
| Match detail page | Header area, next to match info | 20px star + "Bookmark" text |
| Scores page match rows | Right edge | 16px outlined star |
| Following page Live section | Already shown, filled star | 16px filled gold star |

Star icon: outlined = not bookmarked, filled gold (`#F5A623`) = bookmarked.

### 2. Follow Player (Heart / + Follow)

| Location | Placement | Style |
|----------|-----------|-------|
| Player profile page (`/player/[id]`) | Header, below name | Button: "Follow" / "Following" with heart icon |
| Match detail page | Next to each player name | Small 14px heart icon |
| Rankings page | Right edge of each row | Small 14px heart icon |
| Following page Players section | "+ Add Player" card | Opens search overlay |

Heart icon: outlined = not following, filled green (`#7ED321`) = following.

### 3. Follow Tournament (+ Follow)

| Location | Placement | Style |
|----------|-----------|-------|
| Tournament detail page (`/v3/tournaments/[id]`) | Header area | Button: "Follow" / "Following" with star |
| Tournament Spotlight (home) | Top-right of card | Small follow icon |
| Tournaments list page | Right edge per row | Small follow icon |
| Following page Tournaments section | "+ Add" card | Opens tournament list |

### 4. Follow News Source (Toggle)

| Location | Placement | Style |
|----------|-----------|-------|
| Feed page article cards | Next to source name | Small "Follow" text link |
| Article detail page | Header, next to source | "Follow Source" button |
| Following page News section | "Manage" link | Full list with toggles |

## Animation & Feedback

- **Star bookmark:** Quick scale animation (0 → 1.2 → 1.0) on tap, same as existing nav badge animation
- **Follow button:** Toggles text "Follow" → "Following" with a checkmark, green background
- **Heart icon:** Fill animation, brief haptic feedback (if supported)
- **Optimistic updates:** UI changes immediately, Supabase write happens in background

## Migration Plan

1. Existing `useBookmarks` hook → deprecated, replaced by `useFollowing`
2. Existing `pn_bookmarked_matches` localStorage → auto-migrated to `pn_following.matches` on first load
3. Existing `user_bookmarks` rows with `bookmark_type = 'match'` → no change needed, already compatible
4. DB migration: extend CHECK constraint to add `'tournament'` and `'news_source'` types

## Out of Scope

- Push notifications for followed players/tournaments (future enhancement)
- Personalized feed scoring based on follows (future: boost articles about followed players)
- Social features (share follows, see what friends follow)
- Follow limits or rate limiting
