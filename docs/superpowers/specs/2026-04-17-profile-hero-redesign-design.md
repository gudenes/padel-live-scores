# Profile Hero Redesign — Design Spec

**Date:** 2026-04-17
**Status:** Approved
**Scope:** `/profile` page (Phase 2 of the profile split). `/profile/settings` is Phase 1 and is assumed to exist by the time Phase 2 ships.

## Problem

The current [`/profile`](src/app/%5Blocale%5D/%28app%29/profile/page.tsx) page blends three unrelated jobs into a single scroll: identity (avatar, email), **gamification** (achievements summary, ambassador tier), and **settings/compliance** (push toggle, region, language, sign out). The bookmarked-matches and bookmarked-players sections duplicate functionality that already lives on the Following tab. The screen is long, unfocused, and none of the "fun" surface (streaks, badges, progress) is visually primary — it's a small row two scrolls down.

The product is pivoting toward gamification. Profile should become the app's **progress surface** — the place a user opens when they want to see what they've built up (streak, badges, XP, follows) and what they're chasing next. The Strava/Duolingo/FIFA Ultimate Team pattern.

All settings and compliance controls move behind a gear icon to `/profile/settings` (Phase 1). This spec covers Phase 2: the rewrite of `/profile` itself.

## Goals

- Profile opens on a **hero** that reads "this is your progress" at a glance — avatar, tier, streak, three big stat cards
- Latest achievements are the dominant content block, not a footnote
- A single **next-achievement progress card** gives the user something concrete to chase (gamification glue)
- Activity (bookmarks, follows, notifications) is reduced to **three compact rows with counters** that deep-link — full lists live on their own pages, not inline on profile
- Branded outline icons everywhere, zero emojis in new UI
- Existing settings/compliance controls are gone from `/profile` — they live in `/profile/settings` behind the gear

## Non-goals

- Changing how badges are evaluated or what they count (existing [`useBadges`](src/hooks/useBadges.ts) and [`/api/user/badges`](src/app/api/user/badges/route.ts) are fine)
- Adding new badge types, streak-break penalties, or streak-freeze mechanics
- Real-time XP/streak updates — poll-on-mount is fine
- Avatar upload/change flow — stays wherever it currently lives (settings)
- Social comparison, leaderboards, friend feeds
- Rewriting `/profile/settings` (that's Phase 1)
- Rewriting `/achievements` (the existing page is the CTA target, unchanged)

## Design

### 1. Component structure

Single `page.tsx` at `src/app/[locale]/(app)/profile/page.tsx`, rewritten. Components inlined in the same file following the precedent of [`src/app/[locale]/(app)/achievements/page.tsx`](src/app/%5Blocale%5D/%28app%29/achievements/page.tsx) — no new directory, no new component files, with two exceptions noted below.

```
ProfilePage (rewritten)
├── HeroHeader                   — back · "Profile" · gear (links to /profile/settings)
├── AvatarBlock                  — 64px avatar w/ 3px orange ring, tier chip, display name, streak chip
├── StatsStrip                   — three chunky cards: XP · Badges · Follows
├── LatestAchievementsStrip      — horizontal scrollable row of 5 tiles
├── ProgressCard                 — single next-achievement card w/ progress bar (conditional)
├── AchievementsCTA              — banner linking to /achievements
└── ActivitySection              — three rows: Matches bookmarked · Players followed · Notifications
```

Two files change outside `page.tsx`:

- `src/components/icons/index.tsx` — **new**. Shared outline-icon symbol set (see §7).
- `src/messages/{en,es,pt,it,fr}.json` — new `profile` keys (see §9).

### 2. Hero header

Sticky top bar, same dimensions as the existing profile header and the `/achievements` header (height 62, `background: #0A0A0A`, `box-shadow: 0 1px 8px rgba(0,0,0,0.5)`) so visual continuity across the gamification stack is preserved.

Layout (left → right):

- **Back button** — 36×36 ghost button, `color: #6B7280`, arrow-left SVG stroke-2.5 rounded caps. Behaves like the existing one: `router.back()` if `window.history.length > 1`, else `router.push('/home')`.
- **Title** — centered, `Profile` (from `t('profile.profile')`), `font-size: 14`, `font-weight: 600`, `color: #fff`.
- **Gear icon** — 36×36 ghost button on the right. Uses the new `<GearIcon/>` (stroke 2.5, 18×18 viewBox). On tap: `router.push('/profile/settings')`. `aria-label` from `t('profile.settings')`.

Dimensions and colors match the existing header so the transition feels like a tab switch rather than a page change.

### 3. Avatar block

Padded `24px 16px 16px`, centered. Vertical stack:

1. **Avatar wrapper** (relative, 96×96 so there's room for the tier chip). Inside: a 64×64 circular avatar with `border: 3px solid #F5A623` (orange ring), gradient fill fallback (`linear-gradient(135deg, #7ED321, #F5A623)` with the uppercase first char of `display_name`), same as today.
2. **Tier chip** — absolutely positioned bottom-right of the avatar wrapper, `transform: translate(25%, 25%)`. Small chunky pill (`clip-path: polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)`, padding `3px 7px`, font-size 9, font-weight 800, letter-spacing 0.3, uppercase). Label is the user's overall tier label from [`overallTierFromBadgeCount`](src/lib/badges.ts) + `TIER_META`: "ROOKIE" / "INTERMEDIATE" / "ADVANCED" / "PADEL GENIUS", plus a `TIER N` prefix (e.g. `TIER 2 · INTERMEDIATE`) so users who don't yet know the vocabulary still understand the numeric ordering. Color = `TIER_META[tier].color`, background `${color}20`. Hidden if `overallTierFromBadgeCount(earnedCount) === null` (zero badges).
3. **Display name** — `font-size: 18`, `font-weight: 700`, `color: #fff`, `margin-top: 10px`. Falls back to `'User'` if missing, exactly like today. No email — email moves to `/profile/settings` under Phase 1.
4. **Streak chip** — horizontal pill under the name, `margin-top: 8px`, visible only when `streak >= 1`.
   - Left: tinted tile — 28×28, `clip-path: polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)` (the same `CHUNKY_BADGE` shape as `BadgeIcon`), background `linear-gradient(135deg, #FF6B2B40, #FF6B2B10)`, 1.5px border `#FF6B2B`, containing the `<FlameIcon/>` at 14×14 stroked in `#FF6B2B`. No emoji.
   - Right: `${streak}-day streak` text, `font-size: 12`, `font-weight: 700`, `color: #fff`. Plural handling via i18n (`t('profile.streakDays', { count })`).
   - The streak chip has no background of its own — it's the tile + text on transparent, aligned inline-flex with gap 10.

When `streak === 0` the chip is omitted entirely (it looks sad otherwise).

### 4. Stats strip

Horizontal 3-column grid under the avatar block. Padding `0 16px`, `display: grid`, `grid-template-columns: repeat(3, 1fr)`, `gap: 10px`, `margin-bottom: 18px`.

Each card:

- `background: #141414`, `clip-path: polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)` (the canonical card shape), `padding: 14px 10px`, `text-align: center`.
- Top row: number, `font-size: 26`, `font-weight: 900`, `line-height: 1`. Color varies per card.
- Bottom row: label, `font-size: 9`, `font-weight: 800`, `letter-spacing: 0.5`, `text-transform: uppercase`, `color: #6B7280`, `margin-top: 6px`.

| Card | Number | Color | Label |
|---|---|---|---|
| XP | `formatXp(xp)` | `#7ED321` (green) | XP |
| Badges | `earnedCount` | `#F5A623` (orange) | BADGES |
| Follows | `followCount` | `#7ED321` (green) | FOLLOWS |

`formatXp` renders values ≥ 1000 as `1.2k`, ≥ 1_000_000 as `1.2m`. Below 1000 it's the raw integer.

Tapping Badges pushes `/achievements` (same destination as the CTA banner below). XP and Follows cards are non-interactive in Phase 2 — the dedicated "XP history" and "Follows" pages are out of scope.

### 5. XP formula

Keep it simple and derivable from existing signals — no new DB columns, no cron. Computed client-side from `earnedBadges` (from `useBadges`) and `profile.login_streak`:

```ts
// Tier weights: each badge tier contributes a chunk of XP.
const TIER_XP = { 1: 10, 2: 25, 3: 60, 4: 150 }

function computeXp(earnedBadges: EarnedBadge[], loginStreak: number): number {
  const badgeXp = earnedBadges.reduce((sum, b) => sum + (TIER_XP[b.tier as 1|2|3|4] ?? 0), 0)
  const streakXp = Math.max(0, loginStreak) * 5
  return badgeXp + streakXp
}
```

Rationale:

- Tier weights grow super-linearly to reward harder badges. A Padel Genius tier is worth ~15× a Rookie tier.
- Streak XP is `5 × current_streak`, not cumulative. This mirrors what the number "means" to the user: you're seeing your live streak's value. If the streak breaks, XP from streaks drops — that's the honest signal and it matches the Duolingo pattern where a broken streak visibly costs you.
- No "XP from activity log events" in Phase 2 — activity events already drive badges, which drive XP via tier weights. Double-counting would be confusing.

If we ever want XP persistence (for example, so XP doesn't regress when a streak breaks), we add a `profiles.xp_total` column later. For Phase 2 it's derived.

### 6. Latest achievements strip

Under the stats strip. Header: a small uppercase label "LATEST ACHIEVEMENTS" (color `#F5A623`, font-size 11, weight 700, letter-spacing 1, padding `0 16px`, margin-bottom 10). Then a horizontal scroller:

- `overflow-x: auto`, `scrollbar-width: none`, padding `0 16px 4px`, `display: flex`, `gap: 10`.
- Each tile: 72px wide × ~92px tall (40px icon tile + 2-line label + optional progress text), vertically stacked.

**Tile composition:**

1. Icon tile — `<BadgeIcon svgIcon={...} tier={...} size={48}/>` reused verbatim. For unearned badges the tile renders in its existing locked state (15% opacity, lock outline). Tier-colored border comes for free from BadgeIcon.
2. Label — under the tile, font-size 10, weight 700, color `#fff`, line-clamp 2, text-align center, margin-top 6.
3. Progress — for **locked** badges only, a tiny line of `font-size: 9`, weight 700, color `TIER_META[nextTier].color`: `"7 / 30"` (current / next-tier threshold). No bar, just the count — the bar is for the big Progress Card below.

**Selection (5 tiles, in order):**

1. Up to 3 most recently earned badge/tier combos (by `unlocked_at DESC`).
2. Up to 2 **locked** badges with highest fractional progress (same algorithm as §7). Duplicates with the Progress Card target are fine — the user sees the same thing from two angles.
3. If the user has fewer than 3 earned badges, backfill from the catalog in `BADGE_CATALOG` order so the strip always has 5 items.

For users with zero earned badges, the strip shows 5 locked badges — the first 5 from `BADGE_CATALOG` — so the UI never looks empty.

### 7. Progress card (next achievement)

A single wide card between the achievements strip and the CTA banner. Purpose: one clear thing to chase. Padding `12px 14px`, `margin: 14px 16px 14px`, `background: #141414`, `clip-path: polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)`, `border-left: 3px solid ${tierColor}` where `tierColor` is the color of the next tier being chased.

Layout:

- Left: 48px `<BadgeIcon>` with `tier={null}` (locked visual) unless the user is chasing tier 2+ of a badge they've already unlocked tier 1 for (in which case show the earned tier).
- Middle (flex 1):
  - Row 1 — "NEXT UP" label, font-size 9, weight 800, letter-spacing 1, uppercase, color `${tierColor}`.
  - Row 2 — badge name (e.g. "Scout") + "Rookie" / "Intermediate" etc. text, font-size 13, weight 700, color `#fff`.
  - Row 3 — progress bar, height 5px, full-width, background `rgba(255,255,255,0.08)`, same `clip-path` as the level banner bar in `achievements/page.tsx`. Fill colored `${tierColor}`, width `${pct}%`.
  - Row 4 — `"${current} / ${threshold}"` on the left, `"${pct}%"` on the right, font-size 10, weight 700, `color: #6B7280`.

**Algorithm (`selectNextAchievement`):**

```ts
function selectNextAchievement(earnedBadges: EarnedBadge[], counts: Counts): NextChase | null {
  const earnedMax = new Map<string, number>()  // badge_id → highest earned tier
  for (const b of earnedBadges) {
    earnedMax.set(b.badge_id, Math.max(earnedMax.get(b.badge_id) ?? 0, b.tier))
  }

  let best: NextChase | null = null
  for (const def of BADGE_CATALOG) {
    // Skip single-tier badges the user already has
    if (def.isSingleTier) {
      if (earnedMax.has(def.id)) continue
      // Single-tier: progress is binary (0% or 100%). These are earned on action, not counted toward progress.
      continue
    }

    const earnedTier = earnedMax.get(def.id) ?? 0
    const nextTier = def.tiers.find(t => t.tier === earnedTier + 1)
    if (!nextTier) continue  // all tiers earned

    const current = getCurrentCount(def, counts)      // §8 — pulls from profile or precomputed counts
    const pct = Math.min(1, current / nextTier.threshold)

    // Must have some progress and not already be at threshold
    if (current <= 0 || pct >= 1) continue

    if (!best || pct > best.pct) {
      best = { badge: def, tierNum: nextTier.tier, current, threshold: nextTier.threshold, pct }
    }
  }
  return best
}
```

Edge cases:

- **All badges earned** → `best === null` → card is not rendered at all. The achievements strip still shows the 5 most recent; the CTA banner still links to `/achievements`.
- **Zero progress on everything** → `best === null` (nothing to chase that's already started). Card is hidden. This is expected for brand-new users whose only earned badge is `profile_complete`; they see the strip + CTA but no progress card. Fine — the CTA banner gives them somewhere to go.
- **Ties on pct** → first wins (stable by `BADGE_CATALOG` order). Not worth breaking ties more cleverly.

Single-tier badges (`profile_complete`, `early_adopter`, `genius_insider`, `push_enabled`) are excluded from the chase because "progress" toward them is binary and mostly outside the user's control or a one-click action. The strip and CTA already surface them; the Progress Card is for tiered grind.

### 8. Data orientation — where counts come from

The progress card needs a **current count** for each tiered badge. To avoid N queries, fetch once on mount:

```ts
const [
  earnedBadges,        // useBadges() hook — already cached
  loginStreak,         // profile.login_streak from useAuth
  longestStreak,       // profile.longest_streak from useAuth
  playerFollowCount,   // COUNT user_bookmarks WHERE bookmark_type='player'
  tournamentFollowCount,
  matchBookmarkCount,
  ratingCount,         // COUNT match_ratings WHERE user_id
  articleClickCount,   // COUNT user_activity_log WHERE action='article_click'
  videoPlayCount,
  shareCount,
  referralCount,       // COUNT profiles WHERE referred_by=user.id
] = await Promise.all([...])
```

All reads are `HEAD` count queries via `supabase.from(...).select('id', { count: 'exact', head: true })` — cheap, single-row responses. Wrapped in `withTimeout(..., 10_000)` as in the current profile page so a wedged client doesn't hang the UI.

These counts double as the data source for `selectNextAchievement` via the `evalType` dispatch:

| `evalType` | Source |
|---|---|
| `bookmark_count` | `playerFollowCount` / `tournamentFollowCount` / `matchBookmarkCount` (routed on `evalParam`) |
| `rating_count` | `ratingCount` |
| `activity_count` | `articleClickCount` / `videoPlayCount` / `shareCount` (routed on `evalParam`) |
| `login_streak` | `loginStreak` |
| `longest_streak` | `longestStreak` |
| `referral_count` | `referralCount` |
| `profile_complete` / `early_adopter` / `feature_interest` / `push_enabled` | Not applicable (single-tier, skipped) |

Follow count displayed in the stats strip = `playerFollowCount` specifically (matches the spec brief — "Follows").

Match bookmark count surfaces in the activity section instead of the stats strip (see §10).

### 9. Achievements CTA banner

Directly below the Progress Card. A full-width chunky card linking to `/achievements`:

- `background: #141414`, `clip-path: polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)`, `border-left: 3px solid #7ED321`, padding `12px 14px`, margin `0 16px 18px`.
- Left: 32px trophy icon tile (`<BadgeIcon svgIcon="trophy" tier={overallTier} size={32}/>`).
- Middle (flex 1):
  - Title — "See all achievements", font-size 13, weight 700, color `#fff`.
  - Subline — `"${earnedCount} earned · ${tiersToGo} tiers to go"`, font-size 11, color `#6B7280`.
- Right: `›` chevron, color `#6B7280`, font-size 18.

`tiersToGo` = total tier slots in `BADGE_CATALOG` − count of `(badge_id, tier)` pairs in `earnedBadges`. Tier slots = `sum(def.tiers.length)` for tiered badges + 1 per single-tier badge.

If `tiersToGo === 0`, subline becomes "All tiers earned" and the border-left color flips to `#FFD166` (Padel Genius gold).

### 10. Activity section

Under the CTA banner. Small header "ACTIVITY" (same label style as the achievements strip label). Three rows, each full-width tappable, styled like `/profile/settings` rows for visual consistency.

Row structure:

```
[icon tile 32px]  Label                                    Count  ›
                  Muted subline (optional)
```

- Icon tile: 32×32, chunky `clip-path: polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)`, background `rgba(126,211,33,0.08)` or tinted per row, 1.5px border, containing an outline SVG.
- Label: font-size 13, weight 600, color `#fff`.
- Subline: font-size 11, color `#6B7280`.
- Count chip: right-aligned, font-size 11, weight 700, background `rgba(255,255,255,0.05)`, padding `2px 8px`, `clip-path: polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)`, color `#fff`. Unread variants (Notifications) use `color: #FF4655` and background `rgba(255,70,85,0.12)`.

Rows:

| Row | Icon | Href | Count | Subline |
|---|---|---|---|---|
| Bookmarked matches | bookmark outline | `/following?tab=matches` | `matchBookmarkCount` | `t('profile.activity.matchesSub')` — "Saved games and results" |
| Followed players | search outline | `/following?tab=players` | `playerFollowCount` | `t('profile.activity.playersSub')` — "Players you track" |
| Notifications | bell outline | `/notifications` | unread count (see §12) | `t('profile.activity.notificationsSub')` — "Your alerts" |

Tapping a row pushes the route. When the href's route doesn't exist yet (Phase 3 `/notifications`), Next.js returns a 404 — acceptable per §12.

**Why deep-link to Following instead of a new `/profile/bookmarks` page?** The Following tab already exists, already owns the canonical bookmark lists for matches/players/tournaments, and is reachable from the bottom nav. A parallel `/profile/bookmarks` page would duplicate UI for no benefit. Picking Following keeps the app's information architecture flat. The `?tab=matches|players` query param is a small addition to Following — if it's not already supported there, the tab defaults will handle it (matches tab is usually the landing tab).

The current profile page's bookmarked-matches and bookmarked-players sections (lines 461–550 of the existing file) are **deleted**. The counters in the activity section replace them. Users looking for the lists tap the row and land on the same place the bottom-nav Following icon takes them.

### 11. What moves where

| Current profile section | Phase 2 destination |
|---|---|
| Avatar + display name + email | Kept on `/profile`, email moves to `/profile/settings` |
| Invite friends card (`useInvite` + ambassador badge) | **Moved to `/profile/settings`** as a Support row: "Invite friends" → opens `shareNow()` directly. Ambassador tier is still reflected in the ambassador-tier badge on the main hero's tier chip when it outranks the badge-count tier (see §13 Open Question). |
| Achievements summary row | Replaced by §3–§9 (hero + strip + progress card + CTA) |
| Notification toggle | `/profile/settings` (Phase 1) |
| Region picker | `/profile/settings` (Phase 1) |
| Bookmarked matches list | Deleted. Counter in §10 links to `/following?tab=matches` |
| Bookmarked players list | Deleted. Counter in §10 links to `/following?tab=players` |
| Language switcher | `/profile/settings` (Phase 1) |
| Sign out | `/profile/settings` (Phase 1) |

Invite-friends placement is called out in the brief as a decision. **Moving it to settings** is the right call because:

1. The hero avatar+streak+stats strip is already dense — adding the invite card would crowd it.
2. The CTA's bottom-of-screen position today is the least-scrolled-to part of the current profile, suggesting low engagement where it sits now; settings is an intentional destination, no worse for discovery.
3. The ambassador badge/referral count is a first-class badge (`ambassador` in the catalog), so it already appears in the achievements strip and progress card when it's the user's top chase. Identity of "how many people I've brought" lives in the badge system; the share trigger is a one-tap action that belongs with account actions.

### 12. Branded icon system

Options evaluated:

**A.** Re-export `ICON_PATHS` from `BadgeIcon.tsx` and call it directly. Pro: zero new files. Con: couples every consumer of the icon shape set to a file named `BadgeIcon`, which signals "badge" — awkward for gear, bell, bookmark used outside badge context.

**B.** Create `src/components/icons/index.tsx` exporting a component per icon (`<FlameIcon/>`, `<TrophyIcon/>`, `<GearIcon/>`, `<BellIcon/>`, `<BookmarkIcon/>`, `<SearchIcon/>`, `<ChevronRightIcon/>`, etc.). Each wraps the same SVG path data as `ICON_PATHS` but takes `size` and `color` props. `BadgeIcon.tsx` continues to own its internal `ICON_PATHS` lookup for backwards compatibility — not refactored to use the new components in this phase.

**Picked: B.** Reasoning: the spec requires **outline icons in the hero header, streak chip, stats strip, progress card, activity rows, and CTA chevron** — places that aren't "badge tiles" and shouldn't import from a file named `BadgeIcon`. Creating a shared set cleans that up and gives us an obvious place to add future outline icons. We don't refactor `BadgeIcon` internals this phase — it owns `ICON_PATHS` privately as an implementation detail; the new file duplicates the path data it needs (roughly 8 icons). Yes, that's one controlled duplication — worth it to keep `BadgeIcon.tsx` as a leaf component with no internal dependencies. Phase 3+ can consolidate.

Contract for every icon in `icons/index.tsx`:

```tsx
interface IconProps { size?: number; color?: string; strokeWidth?: number }
export function FlameIcon({ size = 18, color = 'currentColor', strokeWidth = 2.5 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
         strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22c4-2.5 7-6.5 7-11a7 7 0 0 0-14 0c0 4.5 3 8.5 7 11z"/>
      <path d="M12 22c-1.5-1.5-3-4-3-7a3 3 0 0 1 6 0c0 3-1.5 5.5-3 7z"/>
    </svg>
  )
}
```

Icons required for Phase 2: `FlameIcon`, `TrophyIcon`, `GearIcon`, `BellIcon`, `BookmarkIcon`, `SearchIcon` (for Followed players row), `ChevronRightIcon`, `ArrowLeftIcon`. All stroke 2.5, rounded caps, 24×24 viewBox. Path data copied from `ICON_PATHS` where the icon already exists there; `GearIcon` is new (standard Lucide-style 2-path gear).

### 13. Notifications row — Phase 3 dependency

The `/notifications` route doesn't exist yet. Two options:

**A.** Link now, let the page 404 until Phase 3.
**B.** Gate the row behind a feature flag (env var or build-time constant).

**Picked: A.** Reasoning: the row is already spec'd, the count query hits `user_activity_log` or a future `notifications` table with safe defaults (unread = 0), and the 404 is only reachable by users who deliberately tap a row labeled "Notifications" — easy to explain. Gating adds config surface area for a one-day lag between Phase 2 and Phase 3.

Unread count source for Phase 2: hardcoded to `0` (from a `getUnreadNotificationCount()` helper that returns 0 synchronously). Phase 3 swaps the helper to query the real data source. The row layout already supports the red "3 new" treatment — just waiting on real data.

### 14. Dependencies on Phase 1 (settings page)

Phase 2 assumes `/profile/settings` exists. The gear icon links straight to it. If Phase 1 ships late, the gear will 404 — same acceptable tradeoff as §13. In practice Phase 1 must land before Phase 2 — otherwise users lose the ability to toggle push, change region, sign out, etc. **Phase 2 must not be merged before Phase 1 is deployed.** This is a release-ordering constraint, not a code-level dependency (no imports).

Phase 1 must also include an "Invite friends" row that calls `useInvite().shareNow()` so the existing invite CTA functionality survives the move. Phase 2 does not implement this — Phase 1 owns it.

### 15. Migrations

**None.** Every count the page needs is already in the DB:

- `user_badges` — exists (Phase 1 of the badge system)
- `user_bookmarks` — exists
- `match_ratings` — exists
- `user_activity_log` — exists
- `profiles.login_streak`, `profiles.longest_streak` — exist
- `profiles` (for `referred_by` count) — exists

XP is derived, not stored. If we later decide to persist XP, that's a separate spec.

### 16. Styling tokens — reference

Used verbatim from [`src/app/[locale]/(app)/profile/page.tsx:22-35`](src/app/%5Blocale%5D/%28app%29/profile/page.tsx#L22-L35) and [`src/lib/badges.ts:9-14`](src/lib/badges.ts#L9-L14):

- Green `#7ED321`, orange `#F5A623`, live red `#FF4655`, muted `#6B7280`, bg base `#1A1A1A`, bg card `#141414`, border `rgba(255,255,255,0.06)`.
- Tier colors: Rookie `#7ED321`, Intermediate `#F5A623`, Advanced `#FF6B2B`, Padel Genius `#FFD166`.
- Clip-paths: card `polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)`, small chip/badge `polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)`, chunky tile `polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)`.
- Page wrapper: `max-width: 500`, `margin: 0 auto`, `padding-bottom: 80` (to clear the bottom nav), `background: #1A1A1A`, `min-height: 100dvh`.

### 17. Loading + empty states

- Pre-auth resolution: `<BrandedLoader hints={[t('profile.loading'), 'Almost ready...']} />`, same as today.
- Counts still loading: stats strip shows `—` in place of the number. Progress card hides until `earnedBadges` has resolved and counts are in (all three must be ready — otherwise we can't pick a target). Latest achievements strip renders locked placeholders until badges resolve.
- Signed-out: same redirect behavior as today — `router.replace('/home')` if `!authLoading && !user`.

### 18. i18n — English strings added

All new strings into `src/messages/en.json` under `profile`. Other locales get one combined task in the plan.

```json
"profile": {
  "profile": "Profile",
  "settings": "Settings",
  "loading": "Loading your profile...",
  "streakDays": "{count}-day streak",
  "stats": {
    "xp": "XP",
    "badges": "Badges",
    "follows": "Follows"
  },
  "latestAchievements": "Latest achievements",
  "nextUp": "Next up",
  "progressOf": "{current} / {total}",
  "seeAllAchievements": "See all achievements",
  "achievementsSummary": "{earned} earned · {togo} tiers to go",
  "allTiersEarned": "All tiers earned",
  "activity": {
    "header": "Activity",
    "matches": "Bookmarked matches",
    "matchesSub": "Saved games and results",
    "players": "Followed players",
    "playersSub": "Players you track",
    "notifications": "Notifications",
    "notificationsSub": "Your alerts",
    "newCount": "{count} new"
  },
  "tierPrefix": "Tier {n}"
}
```

Existing `profile.signOut`, `profile.language`, `profile.bookmarks`, `profile.following` keys are no longer referenced from `/profile` but stay in the messages file — they're used by `/profile/settings` (Phase 1).

## Data orientation

See §8 for the canonical list. Summary:

| Source | Field / query | Used for |
|---|---|---|
| `useAuth().profile` | `display_name`, `avatar_url`, `login_streak`, `longest_streak` | Hero identity + streak chip |
| `useBadges()` | `earnedBadges[]` | Stats strip (Badges), latest achievements strip, progress card, XP formula |
| `supabase` HEAD counts | `user_bookmarks` (×3 types), `match_ratings`, `user_activity_log` (×3 actions), `profiles.referred_by` | Progress card algorithm, activity row counters |
| Derived | `formatXp(computeXp(...))` | Stats strip (XP) |
| `BADGE_CATALOG` | Static import | Progress card algorithm |
| `TIER_META` | Static import | All tier-colored UI |

All count queries run in parallel in a single `Promise.all`, each wrapped in `withTimeout(..., 10_000, label)` following the existing `fetchBookmarks` pattern. A wedged client fails fast with logged warnings instead of an infinite spinner.

## Testing strategy

- **Unit — XP formula**: `computeXp([...fixtures], streak)` covers zero-badges, one-of-each-tier, single-tier badges (not counted), zero streak, large streak. Table-driven test, matches the style of `src/lib/__tests__/score-inference.test.ts`.
- **Unit — `selectNextAchievement`**: fixtures for (a) empty earned list → returns null or first partially-progressed badge, (b) some tier 1 badges earned with non-zero progress toward tier 2 → picks highest pct, (c) all badges earned → null, (d) zero progress everywhere → null, (e) tie on pct → first in `BADGE_CATALOG` wins.
- **Snapshot / visual**: no formal snapshot test — the design is in flux via the mockups. Manual verification before merge: render with 0 badges, with 3 badges, with all badges, with streak 0/7/30/100.
- **Integration — none**. No new API routes, no migrations, no cron.
- **Lint + typecheck**: `npm run lint` + `tsc` clean before merge.

## Rollout plan

1. **Phase 1 (prereq):** `/profile/settings` ships with push toggle, region, language, invite friends, sign out, email display. Phase 1 is a separate spec.
2. **Phase 2 (this spec):**
   - Branch: `claude/profile-hero`
   - Implement `src/components/icons/index.tsx` first (shared across the rest).
   - Rewrite `src/app/[locale]/(app)/profile/page.tsx` end-to-end. Delete the bookmarked matches/players lists, invite card, notification toggle, region picker, language switcher, sign-out button. The file drops from ~575 LOC to ~350.
   - Add new `profile.*` keys to `en.json` (rest of locales follow in a combined translation task — see plan).
   - Ship unit tests for `computeXp` + `selectNextAchievement` in `src/lib/__tests__/profile-hero.test.ts`.
   - Deploy to Vercel behind the standard preview-URL review. No feature flag.
3. **Phase 3 (later):** `/notifications` route ships; `getUnreadNotificationCount()` stub swaps to real query. Activity row starts showing real counts automatically.

**Backout:** single page-file rewrite; reverting is a one-file revert. No DB changes to roll back.

## Open questions

1. **Tier chip — ambassador vs badge-count tier.** The user has two tier systems: their overall-badge-count tier (`overallTierFromBadgeCount`) and their ambassador-referral tier (`tierForCount` from `src/lib/ambassador.ts`). Both exist. The spec shows the badge-count tier on the hero. Should the ambassador tier ever promote — e.g. a user with 50 referrals but only 3 badges shows "Padel Genius Ambassador" on the hero instead of "Rookie"? Recommend: **no** for Phase 2. One number per place. The ambassador tier already surfaces through the `ambassador` badge in the catalog. Revisit if users complain.

2. **Should the Notifications row hide entirely until Phase 3 ships?** The spec says link now, let it 404. If the 404 is visible in production for more than a week, consider a feature flag. Judgment call at rollout time.

3. **Streak chip — show longest_streak anywhere on the hero?** Current streak is on the chip; longest streak is currently only visible as a badge (`longest_streak`, "Streak Legend"). The spec does not surface longest streak separately. If play-testing shows users want to see "best: 42 days" next to current, add a second chip. Not in scope for Phase 2.

4. **Follows count — players only, or players + tournaments?** The spec uses player-only. Tournaments are a distinct follow type. If "Follows" feels low to test users with no player follows but several tournament follows, widen the count to `playerFollowCount + tournamentFollowCount`. Decision deferred to first round of user feedback on the new hero.

---

## Self-review checklist

- **Placeholder scan**: No `TODO`, no `TKTK`, no `<fill in>`, no dangling bullet points. All section IDs used in references exist. ✓
- **Internal consistency**: XP formula is used in one place (stats strip), `selectNextAchievement` in one place (progress card), same counts power both the progress card and activity section. Tier coloring is consistent everywhere. Icon source is a single file. ✓
- **Scope check**: Spec covers the six items in the brief (rewrite page, gear entry point, notifications linking, streak+XP computation, progress-card logic, branded icons, i18n). Does not add badge types, streak-break penalties, real-time XP, avatar flow, or leaderboards — all explicitly out of scope. ✓
- **Ambiguity check**:
  - XP formula: exact constants given. ✓
  - Progress card algorithm: pseudocode + edge cases enumerated. ✓
  - Follows count definition: player-only, called out in Open Question #4. ✓
  - Tier chip when zero badges: hidden (§3 point 2). ✓
  - Progress card when no progress anywhere: hidden (§7 edge cases). ✓
  - Notifications route 404: acknowledged + accepted (§13). ✓
  - Gear route 404: acknowledged + release-ordered against Phase 1 (§14). ✓
- **No code written** — spec only. ✓
- **No plan written** — plan is a separate artifact. ✓
