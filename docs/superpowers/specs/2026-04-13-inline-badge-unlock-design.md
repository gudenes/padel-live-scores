# Inline Badge Unlock Celebration — Design Spec

**Date:** 2026-04-13
**Status:** Approved for implementation

## Overview

Evaluate badges immediately after the action that could trigger them, instead of waiting for the user to visit the Achievements page. Show a celebration toast with confetti burst wherever the user currently is.

**Core goal:** Users discover their badges the moment they earn them — instant gratification, not delayed discovery.

## Current Problems

1. Badge evaluation only runs on the Achievements page (`evaluateAll()` in useEffect)
2. Users who never visit Achievements never see their badges unlock
3. The notification dot on the profile button is subtle and easily missed
4. Toast uses `🎉` emoji instead of branded SVG icons

## Architecture

### Action → Badge mapping

Each user action is mapped to the specific badge(s) it can unlock. Only those badges are checked — not the full catalog.

| Trigger location | Action | Badge(s) to check |
|-----------------|--------|-------------------|
| Feed page | `article_click` | `read_articles` |
| Match detail | `match_view` | (no badge — match_view isn't tied to a badge) |
| Match detail | rating submitted | `rate_matches` |
| Share (useInvite) | `share` | `share_app` |
| FollowButton | bookmark player | `follow_players` |
| FollowButton | bookmark tournament | `follow_tournaments` |
| FollowButton | bookmark match | `follow_matches` |
| AuthProvider | streak update | `login_streak`, `longest_streak` |

Note: `match_view` action exists in the activity log but no badge evaluates it directly — the `rate_matches` badge uses `rating_count` eval type, not activity count. The match rating card already exists; we need to check `rate_matches` after a rating is submitted.

### New helper: `checkBadgeInline()`

A lightweight standalone function (not a hook) that can be called from anywhere without requiring the `useBadges` hook to be mounted. This avoids threading badge context through every component.

Location: `src/lib/badge-check-inline.ts`

```typescript
/**
 * Check a single badge for a user and return any newly earned tiers.
 * Designed to be called inline after an action — fire-and-forget.
 * Does NOT update React state (caller handles toast).
 */
export async function checkBadgeInline(
  userId: string,
  badgeId: string
): Promise<{ badge_id: string; tier: number }[]>
```

Logic:
1. Look up badge definition from `BADGE_MAP`
2. Get current count via same `getCount` logic from `useBadges` (extracted to shared function)
3. Fetch already-earned tiers from `user_badges` 
4. Insert any newly earned tiers
5. Return array of new tiers (empty if nothing new)

### Shared count evaluator

Extract the `getCount(badge, userId)` logic from `useBadges.ts` into a shared pure function in `src/lib/badge-eval.ts` so both the hook and the inline checker can use it without duplication.

```typescript
export async function getBadgeCount(
  userId: string,
  badge: BadgeDefinition
): Promise<number>
```

### Confetti utility

Extract `spawnConfetti` from `src/app/match/[id]/page.tsx` into `src/lib/confetti.ts` so both the match rating and badge toast can use it.

```typescript
export function spawnConfetti(originEl: HTMLElement, options?: {
  count?: number      // default 38
  colors?: string[]   // default green/orange/white
}): void
```

### Updated BadgeToast

Changes to `src/components/BadgeToast.tsx`:
1. Replace `🎉` emoji with inline trophy SVG icon (from BadgeIcon paths)
2. Fire `spawnConfetti()` from the badge icon element when toast appears
3. Keep existing slide-in animation and 4-second auto-dismiss

**Copy change:**
- Before: `🎉 Badge Unlocked!`
- After: `[trophy SVG] Badge Unlocked` (no emoji, no exclamation mark — understated European tone)

## Integration Points

### Feed page (`src/app/(app)/feed/page.tsx`)

After `logActivity(user.id, 'article_click', id)` (~line 638):
```typescript
void checkBadgeInline(user.id, 'read_articles').then(newTiers => {
  for (const t of newTiers) showBadgeToast(t.badge_id, t.tier)
})
```

### Match detail — rating (`src/app/match/[id]/page.tsx`)

After a rating is submitted in `MatchRatingCard`, check `rate_matches`:
```typescript
void checkBadgeInline(user.id, 'rate_matches').then(newTiers => {
  for (const t of newTiers) showBadgeToast(t.badge_id, t.tier)
})
```

### Share (useInvite hook)

After `logActivity(user.id, 'share')` (~lines 81, 92 in `src/hooks/useInvite.ts`):
```typescript
void checkBadgeInline(user.id, 'share_app').then(...)
```

Note: `useInvite` doesn't have access to `useBadgeToast` context directly. Two options:
- Pass `showBadgeToast` into the hook (cleanest)
- Use a global event emitter (simpler but less React-idiomatic)

Recommendation: Add an optional `onBadgeUnlock` callback to `useInvite` that the parent component provides from `useBadgeToast().show`.

### FollowButton (`src/components/FollowButton.tsx`)

After a successful bookmark insert in `useFollowing.toggle()`:
- Map `type` to badge: `match → follow_matches`, `player → follow_players`, `tournament → follow_tournaments`
- Call `checkBadgeInline(userId, badgeId)`

Since `FollowButton` doesn't have toast context, use the same `onBadgeUnlock` callback pattern: `useFollowing` accepts an optional callback.

### AuthProvider streak update

After `updateLoginStreak()` completes (~line 239 in `src/components/AuthProvider.tsx`):
```typescript
// Only check if streak actually changed
if (newStreak > (profile.login_streak ?? 0)) {
  void checkBadgeInline(userId, 'login_streak').then(...)
  void checkBadgeInline(userId, 'longest_streak').then(...)
}
```

AuthProvider wraps BadgeToastProvider, so the toast context is available. Fire toast via a shared callback or by dispatching a custom DOM event that BadgeToastProvider listens for.

Recommendation: Use a simple custom event pattern for AuthProvider since it's outside React component tree:
```typescript
window.dispatchEvent(new CustomEvent('pn-badge-unlock', { detail: { badge_id, tier } }))
```
`BadgeToastProvider` listens for this event and calls `show()`.

## Badge Unlock Event System

To avoid threading `showBadgeToast` through every hook and component, use a lightweight custom DOM event:

```typescript
// Fire from anywhere:
function fireBadgeUnlock(badgeId: string, tier: number) {
  window.dispatchEvent(new CustomEvent('pn-badge-unlock', {
    detail: { badge_id: badgeId, tier }
  }))
}

// Listen in BadgeToastProvider:
useEffect(() => {
  const handler = (e: CustomEvent) => show(e.detail.badge_id, e.detail.tier)
  window.addEventListener('pn-badge-unlock', handler as EventListener)
  return () => window.removeEventListener('pn-badge-unlock', handler as EventListener)
}, [show])
```

This way `checkBadgeInline` can fire the event directly — no React context needed at the call site.

## Updated `checkBadgeInline` with event firing

```typescript
export async function checkBadgeInline(userId: string, badgeId: string): Promise<void> {
  const newTiers = await evaluateAndAward(userId, badgeId)
  for (const t of newTiers) {
    fireBadgeUnlock(t.badge_id, t.tier)
  }
}
```

Callers just do `void checkBadgeInline(user.id, 'read_articles')` — fully fire-and-forget.

## Confetti on Toast

When `BadgeToastProvider` renders a new toast:
1. Toast slides in from bottom (existing animation)
2. After 200ms delay (toast settled): fire `spawnConfetti()` from the badge icon element
3. Confetti uses tier-appropriate colors (green for Rookie, orange for Intermediate, etc.)

Implementation: each toast renders a ref on the `BadgeIcon` element, and a `useEffect` fires confetti on mount.

## Animations Summary

| Moment | Animation | Duration |
|--------|-----------|----------|
| Toast slide in | translateY(100%) → 0 | 400ms cubic-bezier(0.34, 1.56, 0.64, 1) |
| Confetti burst | 38 pieces from badge icon | 2.2s (200ms delay after toast) |
| Toast auto-dismiss | Fade out | 300ms (at 4s mark) |
| Badge icon in toast | Scale 0 → 1.2 → 1 bounce | 400ms |

## Brand Alignment

- Trophy SVG icon replaces `🎉` emoji — no system icons anywhere
- Confetti pieces use chunky clip-path: `polygon(4% 6%, 96% 0%, 100% 94%, 0% 100%)`
- Confetti colors match tier: Rookie uses green/white, higher tiers use gold/orange
- European copy: "Badge Unlocked" (not "Badge Unlocked!" or "You earned a badge!")

## File Structure

```
src/lib/confetti.ts                    # Extract from match detail
src/lib/badge-eval.ts                  # Shared getCount() evaluator
src/lib/badge-check-inline.ts          # Inline badge check + event firing
src/components/BadgeToast.tsx           # Update: SVG icon, confetti, event listener
src/app/(app)/feed/page.tsx             # Add inline check after article_click
src/app/match/[id]/page.tsx             # Extract confetti, add check after rating
src/hooks/useFollowing.ts               # Add inline check after bookmark
src/hooks/useInvite.ts                  # Add inline check after share
src/components/AuthProvider.tsx          # Add inline check after streak update
```

## Scope

### In scope
- Extract confetti to shared utility
- Extract badge count evaluator to shared function
- Create inline badge check function with DOM event firing
- Update BadgeToast: SVG icon, confetti burst, event listener
- Wire inline checks at 6 trigger points (article, rating, share, 3x follow, streak)

### Out of scope
- Video play tracking (no `video_play` activity logging exists yet)
- Changing badge thresholds or adding new badges
- Server-side badge evaluation
- Push notifications for badges
