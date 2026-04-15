# Badge & Rewards System — Schema Design

**Date:** 2026-04-09
**Status:** Draft for review
**Goal:** Define the data model, badge catalog, and evaluation logic for launch day

---

## 1. Database Schema

### New table: `user_badges`

Stores which badges each user has unlocked and when.

```sql
CREATE TABLE IF NOT EXISTS public.user_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  badge_id text NOT NULL,           -- matches a key in the badge catalog (e.g. 'follow_first_player')
  tier smallint NOT NULL DEFAULT 1, -- 1=bronze, 2=silver, 3=gold, 4=platinum (for tiered badges)
  unlocked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_id, tier)
);

CREATE INDEX IF NOT EXISTS user_badges_user_idx ON public.user_badges(user_id);
CREATE INDEX IF NOT EXISTS user_badges_badge_idx ON public.user_badges(badge_id);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

-- Users can read their own badges
CREATE POLICY "Users can read own badges"
  ON public.user_badges FOR SELECT
  USING (auth.uid() = user_id);

-- Public read for trophy case visibility (other users can see your badges)
CREATE POLICY "Public badge read"
  ON public.user_badges FOR SELECT
  USING (true);

-- Only the system inserts badges (via service key or server-side evaluation)
-- No user INSERT/UPDATE/DELETE policies — badges are earned, not self-assigned
```

### Extended column on `profiles`

Track daily login streak:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_at timestamptz,
  ADD COLUMN IF NOT EXISTS login_streak integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS longest_streak integer NOT NULL DEFAULT 0;
```

### New table: `user_activity_log` (lightweight, append-only)

Generic event log for actions that don't have their own table. Keeps badge evaluation simple — just COUNT events.

```sql
CREATE TABLE IF NOT EXISTS public.user_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action text NOT NULL,             -- 'article_click', 'match_view', 'video_play', 'prediction_made', 'share'
  target_id text,                   -- article/match/video UUID (nullable for generic actions)
  metadata jsonb,                   -- optional extra data (e.g. prediction details)
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS activity_log_user_action_idx
  ON public.user_activity_log(user_id, action);
CREATE INDEX IF NOT EXISTS activity_log_created_idx
  ON public.user_activity_log(created_at);

ALTER TABLE public.user_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own activity"
  ON public.user_activity_log FOR SELECT
  USING (auth.uid() = user_id);

-- Insert via service key from API routes (not directly from client)
```

---

## 2. Badge Catalog — 18 badges for launch

Organized into 5 categories. Each badge has a unique `badge_id`, a display name, icon, and the SQL/logic to evaluate whether it's been earned.

### Category 1: 🏠 Getting Started (profile + onboarding)

| badge_id | Name | Icon | Tier | Threshold | How to evaluate |
|---|---|---|---|---|---|
| `profile_complete` | **Complete Profile** | ✅ | — (single) | display_name + avatar_url + preferred_country all set | `SELECT * FROM profiles WHERE id=$1 AND display_name IS NOT NULL AND avatar_url IS NOT NULL AND preferred_country IS NOT NULL` |
| `early_adopter` | **OG Fan** | 🏅 | — (single) | Account created within 30 days of launch | `SELECT * FROM profiles WHERE id=$1 AND created_at < (LAUNCH_DATE + INTERVAL '30 days')` |
| `genius_insider` | **Genius Insider** | 🧠 | — (single) | Signed up for PadelGenius early access | `SELECT * FROM feature_interest WHERE user_id=$1 AND feature_key='padel_genius'` |
| `push_enabled` | **Always Connected** | 🔔 | — (single) | Has at least one active push subscription | `SELECT * FROM push_subscriptions WHERE user_id=$1 LIMIT 1` |

### Category 2: ⭐ Following (bookmarks + engagement)

| badge_id | Name | Icon | Tiers | Thresholds | How to evaluate |
|---|---|---|---|---|---|
| `follow_players` | **Scout** | 🔍 | Rookie/Intermediate/Advanced | 1 / 5 / 15 players followed | `SELECT COUNT(*) FROM user_bookmarks WHERE user_id=$1 AND bookmark_type='player'` |
| `follow_tournaments` | **Globe Trotter** | 🌍 | Rookie/Intermediate/Advanced | 1 / 3 / 10 tournaments followed | `SELECT COUNT(*) FROM user_bookmarks WHERE user_id=$1 AND bookmark_type='tournament'` |
| `follow_matches` | **Match Tracker** | 📌 | Rookie/Intermediate/Advanced | 1 / 10 / 50 matches bookmarked | `SELECT COUNT(*) FROM user_bookmarks WHERE user_id=$1 AND bookmark_type='match'` |

### Category 3: ⚡ Engagement (ratings + content + sharing)

| badge_id | Name | Icon | Tiers | Thresholds | How to evaluate |
|---|---|---|---|---|---|
| `rate_matches` | **Match Critic** | ⭐ | Rookie/Intermediate/Advanced | 1 / 10 / 50 matches rated | `SELECT COUNT(*) FROM match_ratings WHERE user_id=$1` |
| `read_articles` | **News Junkie** | 📰 | Rookie/Intermediate/Advanced | 5 / 25 / 100 articles clicked | `SELECT COUNT(*) FROM user_activity_log WHERE user_id=$1 AND action='article_click'` |
| `watch_videos` | **Highlight Reel** | 🎬 | Rookie/Intermediate/Advanced | 5 / 25 / 100 videos played | `SELECT COUNT(*) FROM user_activity_log WHERE user_id=$1 AND action='video_play'` |
| `share_app` | **Megaphone** | 📢 | Rookie/Intermediate/Advanced | 1 / 5 / 15 shares triggered | `SELECT COUNT(*) FROM user_activity_log WHERE user_id=$1 AND action='share'` |

### Category 4: 🔥 Consistency (streaks + daily activity)

| badge_id | Name | Icon | Tiers | Thresholds | How to evaluate |
|---|---|---|---|---|---|
| `login_streak` | **Daily Devotee** | 🔥 | Rookie/Intermediate/Advanced/Padel Genius | 3 / 7 / 30 / 100 day streak | `SELECT login_streak FROM profiles WHERE id=$1` (current streak) |
| `longest_streak` | **Streak Legend** | 💎 | Rookie/Intermediate/Advanced | 7 / 30 / 100 days (all-time best) | `SELECT longest_streak FROM profiles WHERE id=$1` |

### Category 5: 🏆 Ambassador (referrals — already built)

| badge_id | Name | Icon | Tiers | Thresholds | How to evaluate |
|---|---|---|---|---|---|
| `ambassador` | **Ambassador** | 🥨 | Rookie/Intermediate/Advanced/Padel Genius | 1 / 5 / 15 / 50 referrals | `SELECT COUNT(*) FROM profiles WHERE referred_by=$1` |

### Category 6: 🎯 Predictions (future — when synced to DB)

| badge_id | Name | Icon | Tiers | Thresholds | How to evaluate |
|---|---|---|---|---|---|
| `predictions_made` | **Crystal Ball** | 🔮 | Rookie/Intermediate/Advanced | 1 / 10 / 50 predictions | `SELECT COUNT(*) FROM user_activity_log WHERE user_id=$1 AND action='prediction_made'` |

**Total: 18 badges (14 immediately evaluable + 4 needing activity log tracking)**

---

## 3. Badge Evaluation Architecture

### When do badges get evaluated?

Two modes:

**A. Eager (on action)** — evaluate immediately after the triggering action. Fast feedback, user sees the badge pop up right away.

Best for:
- `profile_complete` → after profile save
- `push_enabled` → after push subscription
- `follow_*` → after bookmark add
- `rate_matches` → after rating submit
- `login_streak` → on each session start
- `ambassador` → on each profile load (already implemented via `useInvite`)

**B. Lazy (periodic)** — evaluate in a batch. Good for counts that accumulate gradually.

Best for:
- `read_articles`, `watch_videos`, `share_app` → evaluate on profile page load or via a lightweight cron
- `early_adopter`, `genius_insider` → evaluate once on first profile load

### Evaluation flow

```
User takes action (e.g. follows a player)
  → Client calls API (e.g. bookmark insert)
  → API route (or client after success) calls evaluateBadges(userId, 'follow_players')
  → evaluateBadges reads the current count, compares against thresholds
  → For each newly earned tier, INSERT into user_badges (ON CONFLICT DO NOTHING)
  → Return list of newly unlocked badges (for celebration UI)
```

### Where does evaluation run?

**Option A: Client-side (simpler, faster for v1)**
- After each action, the client calls a `checkBadges()` function that queries the relevant counts and inserts badges via Supabase client
- Pro: no new API routes needed
- Con: user could theoretically manipulate badge unlocks (but badges are cosmetic, low risk)

**Option B: Server-side (more secure)**
- API route `/api/badges/evaluate` that takes `userId` + `trigger` and runs the evaluation
- Pro: tamper-proof
- Con: more infrastructure

**Recommendation for v1: Client-side evaluation with server-side INSERT.**
The client computes "did I cross a threshold?" and calls a lightweight API endpoint to record the badge. The API validates before inserting (double-check the count server-side if we care about integrity, or just trust the client for cosmetic badges).

Actually, simplest: **let the client INSERT directly into `user_badges` via Supabase**, gated by an RLS policy that only allows inserting for your own user_id. Add a Postgres trigger or function that validates the badge was actually earned (optional for v1, add later if abuse becomes a concern).

```sql
-- Allow authenticated users to insert their own badges
CREATE POLICY "Users can earn badges"
  ON public.user_badges FOR INSERT
  WITH CHECK (auth.uid() = user_id);
```

---

## 4. Login Streak Logic

### How it works

On every authenticated page load (AuthProvider mount or TOKEN_REFRESHED):

```ts
async function updateLoginStreak(userId: string) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('last_active_at, login_streak, longest_streak')
    .eq('id', userId)
    .single()

  if (!profile) return

  const now = new Date()
  const today = now.toISOString().slice(0, 10)  // YYYY-MM-DD
  const lastActive = profile.last_active_at
    ? new Date(profile.last_active_at).toISOString().slice(0, 10)
    : null

  if (lastActive === today) return  // Already logged today, no update

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().slice(0, 10)

  let newStreak: number
  if (lastActive === yesterdayStr) {
    // Consecutive day — extend streak
    newStreak = (profile.login_streak ?? 0) + 1
  } else {
    // Streak broken — reset to 1
    newStreak = 1
  }

  const newLongest = Math.max(newStreak, profile.longest_streak ?? 0)

  await supabase
    .from('profiles')
    .update({
      last_active_at: now.toISOString(),
      login_streak: newStreak,
      longest_streak: newLongest,
    })
    .eq('id', userId)
}
```

Call from AuthProvider after INITIAL_SESSION or TOKEN_REFRESHED (alongside existing profile fetch).

---

## 5. Activity Log Tracking

### What to log

For badges that need `user_activity_log`, add lightweight logging to existing actions:

| Action | Where to add the log call | Details |
|---|---|---|
| `article_click` | `/api/feed/click` route — add `user_id` from auth header if present | `target_id` = article UUID |
| `video_play` | Feed page — when user clicks a video card (client-side, before redirect) | `target_id` = highlight UUID |
| `share` | `useInvite.shareNow()` — after successful share/clipboard | `target_id` = null |
| `prediction_made` | `useMatchPrediction` — after prediction is stored | `target_id` = match UUID, `metadata` = { pair, margin } |
| `match_view` | Match detail page — on mount | `target_id` = match UUID |

### Insert helper

```ts
// src/lib/activity-log.ts
export async function logActivity(
  userId: string,
  action: string,
  targetId?: string,
  metadata?: Record<string, unknown>
) {
  await supabase.from('user_activity_log').insert({
    user_id: userId,
    action,
    target_id: targetId ?? null,
    metadata: metadata ?? null,
  })
}
```

Call fire-and-forget (`void logActivity(...)`) so it never blocks the UI.

---

## 6. Badge Definition File (TypeScript)

```ts
// src/lib/badges.ts

export type BadgeCategory =
  | 'getting_started'
  | 'following'
  | 'engagement'
  | 'consistency'
  | 'ambassador'
  | 'predictions'

// Universal padel-themed tier system — used by ALL tiered badges
export const TIER_LABELS = {
  1: { label: 'Rookie',       color: '#7ED321', icon: '🟢' },
  2: { label: 'Intermediate', color: '#F5A623', icon: '🟠' },
  3: { label: 'Advanced',     color: '#FF6B2B', icon: '🔴' },
  4: { label: 'Padel Genius', color: '#FFD166', icon: '👑' },
} as const

export interface BadgeTier {
  tier: number      // 1=Rookie, 2=Intermediate, 3=Advanced, 4=Padel Genius
  label: string     // from TIER_LABELS
  threshold: number // count needed to unlock this tier
  color: string     // from TIER_LABELS
}

export interface BadgeDefinition {
  id: string
  name: string
  description: string
  icon: string          // emoji for v1
  category: BadgeCategory
  categoryLabel: string
  tiers: BadgeTier[]    // empty for single-tier badges
  isSingleTier: boolean // true for badges with no progression (just unlocked or not)
}

export const BADGE_CATALOG: BadgeDefinition[] = [
  // ── Getting Started ─────────────────────────────────
  {
    id: 'profile_complete',
    name: 'Complete Profile',
    description: 'Fill in your display name, avatar, and country preference.',
    icon: '✅',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: true,
    tiers: [],
  },
  {
    id: 'early_adopter',
    name: 'OG Fan',
    description: 'Joined PadelNachos within the first 30 days of launch.',
    icon: '🏅',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: true,
    tiers: [],
  },
  {
    id: 'genius_insider',
    name: 'Genius Insider',
    description: 'Signed up for PadelGenius early access.',
    icon: '🧠',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: true,
    tiers: [],
  },
  {
    id: 'push_enabled',
    name: 'Always Connected',
    description: 'Enabled push notifications to never miss a match.',
    icon: '🔔',
    category: 'getting_started',
    categoryLabel: 'Getting Started',
    isSingleTier: true,
    tiers: [],
  },

  // ── Following ───────────────────────────────────────
  {
    id: 'follow_players',
    name: 'Scout',
    description: 'Follow your favorite players to track their journey.',
    icon: '🔍',
    category: 'following',
    categoryLabel: 'Following',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 1, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 5, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 15, color: '#FF6B2B' },
    ],
  },
  {
    id: 'follow_tournaments',
    name: 'Globe Trotter',
    description: 'Follow tournaments around the world.',
    icon: '🌍',
    category: 'following',
    categoryLabel: 'Following',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 1, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 3, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 10, color: '#FF6B2B' },
    ],
  },
  {
    id: 'follow_matches',
    name: 'Match Tracker',
    description: 'Bookmark matches to keep them on your radar.',
    icon: '📌',
    category: 'following',
    categoryLabel: 'Following',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 1, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 10, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 50, color: '#FF6B2B' },
    ],
  },

  // ── Engagement ──────────────────────────────────────
  {
    id: 'rate_matches',
    name: 'Match Critic',
    description: 'Rate matches to help the community find the best ones.',
    icon: '⭐',
    category: 'engagement',
    categoryLabel: 'Engagement',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 1, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 10, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 50, color: '#FF6B2B' },
    ],
  },
  {
    id: 'read_articles',
    name: 'News Junkie',
    description: 'Stay up to date with padel news and stories.',
    icon: '📰',
    category: 'engagement',
    categoryLabel: 'Engagement',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 5, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 25, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 100, color: '#FF6B2B' },
    ],
  },
  {
    id: 'watch_videos',
    name: 'Highlight Reel',
    description: 'Watch padel highlights and best moments.',
    icon: '🎬',
    category: 'engagement',
    categoryLabel: 'Engagement',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 5, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 25, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 100, color: '#FF6B2B' },
    ],
  },
  {
    id: 'share_app',
    name: 'Megaphone',
    description: 'Share PadelNachos with your padel friends.',
    icon: '📢',
    category: 'engagement',
    categoryLabel: 'Engagement',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 1, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 5, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 15, color: '#FF6B2B' },
    ],
  },

  // ── Consistency ─────────────────────────────────────
  {
    id: 'login_streak',
    name: 'Daily Devotee',
    description: 'Visit PadelNachos every day — build the habit!',
    icon: '🔥',
    category: 'consistency',
    categoryLabel: 'Consistency',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 3, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 7, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 30, color: '#FF6B2B' },
      { tier: 4, label: 'Padel Genius', threshold: 100, color: '#FFD166' },
    ],
  },
  {
    id: 'longest_streak',
    name: 'Streak Legend',
    description: 'Your all-time best daily visit streak.',
    icon: '💎',
    category: 'consistency',
    categoryLabel: 'Consistency',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 7, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 30, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 100, color: '#FF6B2B' },
    ],
  },

  // ── Ambassador ──────────────────────────────────────
  {
    id: 'ambassador',
    name: 'Ambassador',
    description: 'Invite friends to PadelNachos and grow the community.',
    icon: '🥨',
    category: 'ambassador',
    categoryLabel: 'Ambassador',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 1, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 5, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 15, color: '#FF6B2B' },
      { tier: 4, label: 'Padel Genius', threshold: 50, color: '#FFD166' },
    ],
  },

  // ── Predictions (future) ───────────────────────────
  {
    id: 'predictions_made',
    name: 'Crystal Ball',
    description: 'Predict match outcomes before they happen.',
    icon: '🔮',
    category: 'predictions',
    categoryLabel: 'Predictions',
    isSingleTier: false,
    tiers: [
      { tier: 1, label: 'Rookie', threshold: 1, color: '#7ED321' },
      { tier: 2, label: 'Intermediate', threshold: 10, color: '#F5A623' },
      { tier: 3, label: 'Advanced', threshold: 50, color: '#FF6B2B' },
    ],
  },
]
```

---

## 7. Hook: `useBadges()`

```ts
// src/hooks/useBadges.ts

export interface EarnedBadge {
  badge_id: string
  tier: number
  unlocked_at: string
}

export interface UseBadgesResult {
  badges: EarnedBadge[]
  totalEarned: number
  totalPossible: number
  loading: boolean
  checkAndAward: (badgeId: string, currentCount: number) => Promise<EarnedBadge[]>
}
```

The hook:
1. On mount, fetches all `user_badges` for the current user
2. Exposes `checkAndAward(badgeId, currentCount)` — looks up the badge definition, compares count against tier thresholds, inserts any newly earned tiers, returns the list of new unlocks (for celebration UI)
3. Caches the badge list and refreshes on new awards

---

## 8. Celebration UX (trophy unlock)

When `checkAndAward` returns new badges:

1. **Toast notification** — slide-in from the bottom with the badge icon + name + tier label. Auto-dismisses after 4 seconds.
2. **Confetti burst** (optional for v1) — CSS-only confetti animation on the toast.
3. **Profile trophy case update** — next visit to profile shows the new badge in the grid.
4. **Share prompt** — "Share this achievement?" button on the toast that calls `navigator.share()`.

---

## 9. Trophy Case UI (profile page)

Grid of all badges from the catalog. Each cell shows:
- **Unlocked**: full-color icon + name + tier label (Rookie/Intermediate/Advanced)
- **Locked**: grayscale icon + "?" + progress hint ("3 more players to unlock")
- **Next tier**: if user has Rookie but not Intermediate, show a progress bar toward the next threshold

Grouped by category tabs: Getting Started | Following | Engagement | Consistency | Ambassador

---

## 10. Summary — what needs building

| Piece | Type | Effort |
|---|---|---|
| Migration: `user_badges` + `user_activity_log` + profiles streak cols | SQL | Small |
| `src/lib/badges.ts` — badge catalog | TypeScript constant | Small |
| `src/lib/activity-log.ts` — lightweight event logger | TypeScript | Small |
| `src/hooks/useBadges.ts` — badge state + checkAndAward | React hook | Medium |
| Login streak logic in AuthProvider | TypeScript | Small |
| Activity log calls in existing surfaces (feed click, video play, share) | 5-6 one-line additions | Small |
| Trophy case UI on profile page | React component | Medium |
| Badge unlock toast/celebration | React component | Medium |
| Wire checkAndAward after key actions (follow, rate, etc.) | 8-10 call sites | Small |

**Total estimate: 1 focused implementation day.**
