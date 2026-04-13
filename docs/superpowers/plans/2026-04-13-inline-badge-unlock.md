# Inline Badge Unlock Celebration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Evaluate badges immediately after triggering actions and show a celebration toast with confetti burst wherever the user is, instead of waiting for the Achievements page.

**Architecture:** Extract confetti and badge count evaluation to shared utilities. Create a fire-and-forget `checkBadgeInline()` function that evaluates a single badge and dispatches a DOM event. `BadgeToastProvider` listens for the event and shows the toast with confetti. Wire inline checks at 6 trigger points across the app.

**Tech Stack:** React 19, TypeScript, Supabase client, DOM CustomEvent, inline styles.

**Spec:** `docs/superpowers/specs/2026-04-13-inline-badge-unlock-design.md`

---

## File Structure

```
src/lib/confetti.ts                     # Extract confetti from match detail (new)
src/lib/badge-eval.ts                   # Shared getBadgeCount() evaluator (new)
src/lib/badge-check-inline.ts           # Inline badge check + DOM event (new)
src/components/BadgeToast.tsx            # Update: SVG icon, confetti, event listener
src/hooks/useBadges.ts                  # Refactor: use shared getBadgeCount
src/app/match/[id]/page.tsx             # Use shared confetti, add rating check
src/app/(app)/feed/page.tsx             # Add inline check after article_click
src/hooks/useInvite.ts                  # Add inline check after share
src/hooks/useFollowing.ts               # Add inline check after bookmark
src/components/AuthProvider.tsx          # Add inline check after streak update
```

---

### Task 1: Extract Confetti to Shared Utility

**Files:**
- Create: `src/lib/confetti.ts`
- Modify: `src/app/match/[id]/page.tsx`

- [ ] **Step 1: Create `src/lib/confetti.ts`**

```typescript
// src/lib/confetti.ts
//
// Shared confetti burst animation. Spawns chunky pieces from a
// DOM element's center. Used by match rating and badge toasts.

const DEFAULT_COLORS = ['#7ED321', '#F5A623', '#7ED321', '#fff', '#F5A623', '#7ED321', '#F5A623', '#fff']
const DEFAULT_COUNT = 38

export function spawnConfetti(originEl: HTMLElement, options?: {
  count?: number
  colors?: string[]
}): void {
  const count = options?.count ?? DEFAULT_COUNT
  const colors = options?.colors ?? DEFAULT_COLORS

  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'fixed', top: '0', left: '0', right: '0', bottom: '0',
    pointerEvents: 'none', zIndex: '9999', overflow: 'hidden',
  })
  document.body.appendChild(overlay)

  const rect = originEl.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2

  for (let i = 0; i < count; i++) {
    const piece = document.createElement('div')
    const w = 6 + Math.random() * 8
    const h = 4 + Math.random() * 6
    Object.assign(piece.style, {
      position: 'absolute', pointerEvents: 'none', willChange: 'transform, opacity',
      width: `${w}px`, height: `${h}px`,
      background: colors[i % colors.length],
      clipPath: 'polygon(4% 6%, 96% 0%, 100% 94%, 0% 100%)',
      left: `${cx}px`, top: `${cy}px`, opacity: '1',
    })
    overlay.appendChild(piece)

    const angle = Math.random() * Math.PI * 2
    const speed = 200 + Math.random() * 400
    const vx = Math.cos(angle) * speed
    const vy = Math.sin(angle) * speed - (200 + Math.random() * 300)
    const rotSpeed = -720 + Math.random() * 1440
    const wobbleAmp = 20 + Math.random() * 40
    const wobbleFreq = 2 + Math.random() * 3
    const gravity = 800
    const duration = 2.2
    let start: number | null = null

    function animate(ts: number) {
      if (!start) start = ts
      const elapsed = (ts - start) / 1000
      const progress = elapsed / duration
      if (progress >= 1) { piece.remove(); return }
      const x = vx * elapsed + Math.sin(elapsed * wobbleFreq) * wobbleAmp * elapsed * 0.3
      const y = vy * elapsed + 0.5 * gravity * elapsed * elapsed
      const rot = rotSpeed * elapsed
      const opacity = progress > 0.7 ? 1 - (progress - 0.7) / 0.3 : 1
      piece.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg)`
      piece.style.opacity = `${opacity}`
      requestAnimationFrame(animate)
    }
    setTimeout(() => requestAnimationFrame(animate), Math.random() * 80)
  }

  setTimeout(() => overlay.remove(), 2800)
}
```

- [ ] **Step 2: Update match detail to use shared confetti**

In `src/app/match/[id]/page.tsx`, add the import at the top (alongside the other imports):

```typescript
import { spawnConfetti } from '@/lib/confetti'
```

Then delete the local `spawnConfetti` function (lines 1441-1494) and the local constants `CONFETTI_COLORS` and `CONFETTI_COUNT` (lines 1438-1439). The existing call to `spawnConfetti(badgeRef.current)` in `MatchRatingCard` will now use the shared import.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "confetti|match/\[id\]"`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/lib/confetti.ts src/app/match/\[id\]/page.tsx
git commit -m "refactor: extract confetti to shared utility"
```

---

### Task 2: Extract Badge Count Evaluator + Create Inline Checker

**Files:**
- Create: `src/lib/badge-eval.ts`
- Create: `src/lib/badge-check-inline.ts`
- Modify: `src/hooks/useBadges.ts`

- [ ] **Step 1: Create `src/lib/badge-eval.ts`**

Extract the `getCount` logic from `useBadges.ts` into a standalone function. This is a pure async function that takes a userId and badge definition, no React hooks needed.

```typescript
// src/lib/badge-eval.ts
//
// Shared badge count evaluator. Used by both the useBadges hook
// and the inline badge checker.

import { supabase } from '@/lib/supabase'
import { OG_FAN_CUTOFF, type BadgeDefinition } from '@/lib/badges'

/**
 * Get the current count for a badge's eval type.
 * Pure async function — no React dependencies.
 */
export async function getBadgeCount(userId: string, badge: BadgeDefinition): Promise<number> {
  switch (badge.evalType) {
    case 'bookmark_count': {
      const { count } = await supabase
        .from('user_bookmarks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('bookmark_type', badge.evalParam ?? '')
      return count ?? 0
    }
    case 'rating_count': {
      const { count } = await supabase
        .from('match_ratings')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      return count ?? 0
    }
    case 'activity_count': {
      const { count } = await supabase
        .from('user_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('action', badge.evalParam ?? '')
      return count ?? 0
    }
    case 'login_streak': {
      const { data } = await supabase
        .from('profiles')
        .select('login_streak')
        .eq('id', userId)
        .single()
      return data?.login_streak ?? 0
    }
    case 'longest_streak': {
      const { data } = await supabase
        .from('profiles')
        .select('longest_streak')
        .eq('id', userId)
        .single()
      return data?.longest_streak ?? 0
    }
    case 'referral_count': {
      const { count } = await supabase
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('referred_by', userId)
      return count ?? 0
    }
    case 'profile_complete': {
      return 1
    }
    case 'early_adopter': {
      const { data } = await supabase
        .from('profiles')
        .select('created_at')
        .eq('id', userId)
        .single()
      if (!data?.created_at) return 0
      return new Date(data.created_at) < OG_FAN_CUTOFF ? 1 : 0
    }
    case 'feature_interest': {
      const { count } = await supabase
        .from('feature_interest')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('feature_key', badge.evalParam ?? '')
      return (count ?? 0) > 0 ? 1 : 0
    }
    case 'push_enabled': {
      const { count } = await supabase
        .from('push_subscriptions')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
      return (count ?? 0) > 0 ? 1 : 0
    }
    default:
      return 0
  }
}
```

- [ ] **Step 2: Refactor `useBadges.ts` to use shared evaluator**

In `src/hooks/useBadges.ts`:

1. Add import at top:
```typescript
import { getBadgeCount } from '@/lib/badge-eval'
```

2. Delete the entire `getCount` callback (lines 64-146) — the one wrapped in `useCallback` with the switch statement.

3. In `checkAndAward` (line 149), change the `getCount(badge)` call to `getBadgeCount(user.id, badge)`:

Replace:
```typescript
const count = await getCount(badge)
```
With:
```typescript
const count = await getBadgeCount(user.id, badge)
```

4. Remove `getCount` from the `checkAndAward` dependency array (line 188).

- [ ] **Step 3: Create `src/lib/badge-check-inline.ts`**

```typescript
// src/lib/badge-check-inline.ts
//
// Fire-and-forget inline badge checker. Evaluates a single badge
// and dispatches a DOM event if a new tier is earned. Call from
// anywhere — no React context needed.

import { supabase } from '@/lib/supabase'
import { BADGE_MAP } from '@/lib/badges'
import { getBadgeCount } from '@/lib/badge-eval'

/** DOM event name for badge unlocks. BadgeToastProvider listens for this. */
export const BADGE_UNLOCK_EVENT = 'pn-badge-unlock'

interface BadgeUnlockDetail {
  badge_id: string
  tier: number
}

function fireBadgeUnlock(badgeId: string, tier: number) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(
    new CustomEvent(BADGE_UNLOCK_EVENT, {
      detail: { badge_id: badgeId, tier } satisfies BadgeUnlockDetail,
    })
  )
}

/**
 * Check a single badge for a user, award new tiers, and fire unlock events.
 * Designed to be called fire-and-forget: `void checkBadgeInline(userId, badgeId)`
 */
export async function checkBadgeInline(userId: string, badgeId: string): Promise<void> {
  try {
    const badge = BADGE_MAP[badgeId]
    if (!badge) return

    const count = await getBadgeCount(userId, badge)

    // Fetch already-earned tiers
    const { data: earned } = await supabase
      .from('user_badges')
      .select('tier')
      .eq('user_id', userId)
      .eq('badge_id', badgeId)
    const earnedTiers = new Set((earned ?? []).map(e => e.tier))

    if (badge.isSingleTier) {
      if (count >= 1 && !earnedTiers.has(1)) {
        const { error } = await supabase
          .from('user_badges')
          .insert({ user_id: userId, badge_id: badgeId, tier: 1 })
        if (!error) fireBadgeUnlock(badgeId, 1)
      }
    } else {
      for (const t of badge.tiers) {
        if (count >= t.threshold && !earnedTiers.has(t.tier)) {
          const { error } = await supabase
            .from('user_badges')
            .insert({ user_id: userId, badge_id: badgeId, tier: t.tier })
          if (!error) fireBadgeUnlock(badgeId, t.tier)
        }
      }
    }
  } catch (e) {
    // Silent — never block UI for badge evaluation
    console.warn('[badge-check-inline] failed:', (e as Error)?.message)
  }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "badge-eval|badge-check|useBadges"`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/lib/badge-eval.ts src/lib/badge-check-inline.ts src/hooks/useBadges.ts
git commit -m "feat(badges): add shared evaluator + inline badge checker with DOM events"
```

---

### Task 3: Update BadgeToast — SVG Icon, Confetti, Event Listener

**Files:**
- Modify: `src/components/BadgeToast.tsx`

- [ ] **Step 1: Rewrite BadgeToast**

Replace the entire content of `src/components/BadgeToast.tsx` with:

```typescript
'use client'
// src/components/BadgeToast.tsx
//
// Celebration toast for badge unlocks. Slides in from the bottom with
// confetti burst, auto-dismisses after 4 seconds. Listens for
// pn-badge-unlock DOM events fired by checkBadgeInline.

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { BadgeIcon } from '@/components/BadgeIcon'
import { BADGE_MAP, TIER_META, type TierNumber } from '@/lib/badges'
import { spawnConfetti } from '@/lib/confetti'
import { BADGE_UNLOCK_EVENT } from '@/lib/badge-check-inline'

interface ToastData {
  badgeId: string
  tier: TierNumber
  id: number
}

interface BadgeToastContextType {
  show: (badgeId: string, tier: TierNumber) => void
}

const BadgeToastContext = createContext<BadgeToastContextType>({ show: () => {} })

export function useBadgeToast() {
  return useContext(BadgeToastContext)
}

let toastCounter = 0

export function BadgeToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastData[]>([])

  const show = useCallback((badgeId: string, tier: TierNumber) => {
    const id = ++toastCounter
    setToasts(prev => [...prev, { badgeId, tier, id }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 4000)
  }, [])

  // Listen for DOM events from checkBadgeInline
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { badge_id: string; tier: number }
      if (detail?.badge_id && detail?.tier) {
        show(detail.badge_id, detail.tier as TierNumber)
      }
    }
    window.addEventListener(BADGE_UNLOCK_EVENT, handler)
    return () => window.removeEventListener(BADGE_UNLOCK_EVENT, handler)
  }, [show])

  return (
    <BadgeToastContext.Provider value={{ show }}>
      {children}
      {/* Toast container */}
      <div style={{
        position: 'fixed',
        bottom: 80,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        maxWidth: 400,
        width: '90%',
        pointerEvents: 'none',
      }}>
        {toasts.map(toast => (
          <BadgeToastItem key={toast.id} toast={toast} />
        ))}
      </div>
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes badge-toast-slide {
          0% { transform: translateY(100%); opacity: 0; }
          100% { transform: translateY(0); opacity: 1; }
        }
        @keyframes badge-icon-pop {
          0% { transform: scale(0); }
          70% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
      `}} />
    </BadgeToastContext.Provider>
  )
}

function BadgeToastItem({ toast }: { toast: ToastData }) {
  const badge = BADGE_MAP[toast.badgeId]
  const tierMeta = TIER_META[toast.tier]
  const iconRef = useRef<HTMLDivElement>(null)

  // Fire confetti from badge icon after toast settles
  useEffect(() => {
    const timer = setTimeout(() => {
      if (iconRef.current) {
        const tierColors: Record<number, string[]> = {
          1: ['#7ED321', '#fff', '#7ED321', '#fff'],
          2: ['#F5A623', '#fff', '#F5A623', '#FFD166'],
          3: ['#FF6B2B', '#fff', '#FF6B2B', '#F5A623'],
          4: ['#FFD166', '#fff', '#FFD166', '#F5A623'],
        }
        spawnConfetti(iconRef.current, { colors: tierColors[toast.tier] ?? tierColors[1] })
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [toast.tier])

  if (!badge) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: '#1A1A1A',
      border: `1px solid ${tierMeta.color}40`,
      clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
      padding: '10px 14px',
      boxShadow: `0 4px 20px rgba(0,0,0,0.5), 0 0 10px ${tierMeta.color}20`,
      animation: 'badge-toast-slide 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
      pointerEvents: 'auto',
    }}>
      <div ref={iconRef} style={{ animation: 'badge-icon-pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)' }}>
        <BadgeIcon svgIcon={badge.svgIcon} tier={toast.tier} size={40} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, color: '#fff' }}>
          <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke={tierMeta.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>
          </svg>
          Badge Unlocked
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: tierMeta.color, marginTop: 2 }}>
          {badge.name} · {tierMeta.label}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep "BadgeToast"`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/components/BadgeToast.tsx
git commit -m "feat(badges): upgrade toast with SVG icon, confetti burst, DOM event listener

Replace emoji with trophy SVG. Fire confetti from badge icon on
unlock. Listen for pn-badge-unlock events from checkBadgeInline."
```

---

### Task 4: Wire Inline Badge Checks at Trigger Points

**Files:**
- Modify: `src/app/(app)/feed/page.tsx` (article click)
- Modify: `src/hooks/useMatchRating.ts` (rating submitted)
- Modify: `src/hooks/useInvite.ts` (share)
- Modify: `src/hooks/useFollowing.ts` (bookmark)
- Modify: `src/components/AuthProvider.tsx` (streak update)

The implementing agent should read each file first. All changes follow the same pattern: after the action that could trigger a badge, add `void checkBadgeInline(userId, badgeId)`.

- [ ] **Step 1: Feed page — article click**

In `src/app/(app)/feed/page.tsx`, add import at top:
```typescript
import { checkBadgeInline } from '@/lib/badge-check-inline'
```

In `handleArticleClick` (around line 636-642), after `logActivity`:

Change from:
```typescript
if (user) void logActivity(user.id, 'article_click', id)
```
To:
```typescript
if (user) {
  void logActivity(user.id, 'article_click', id)
  void checkBadgeInline(user.id, 'read_articles')
}
```

- [ ] **Step 2: Match rating — rating submitted**

In `src/hooks/useMatchRating.ts`, add import at top:
```typescript
import { checkBadgeInline } from '@/lib/badge-check-inline'
```

In the `setRating` callback (around line 59-89), after the successful API write, add the badge check. Change the `if (res.ok)` block:

From:
```typescript
if (res.ok) {
  const data = await res.json()
  setAvgRating(data.avg_rating ?? null)
  setRatingCount(data.rating_count ?? 0)
}
```
To:
```typescript
if (res.ok) {
  const data = await res.json()
  setAvgRating(data.avg_rating ?? null)
  setRatingCount(data.rating_count ?? 0)
  // Check rate_matches badge (needs user_id from session)
  if (session?.user?.id) {
    void checkBadgeInline(session.user.id, 'rate_matches')
  }
}
```

Note: `session` is already available in scope (line 70-73).

- [ ] **Step 3: Share — useInvite**

In `src/hooks/useInvite.ts`, add import at top:
```typescript
import { checkBadgeInline } from '@/lib/badge-check-inline'
```

After each `logActivity(user.id, 'share')` call (lines 81 and 92), add the badge check.

Change line 81 from:
```typescript
if (user) void logActivity(user.id, 'share')
```
To:
```typescript
if (user) { void logActivity(user.id, 'share'); void checkBadgeInline(user.id, 'share_app') }
```

Change line 92 from:
```typescript
if (user) void logActivity(user.id, 'share')
```
To:
```typescript
if (user) { void logActivity(user.id, 'share'); void checkBadgeInline(user.id, 'share_app') }
```

- [ ] **Step 4: Follow/bookmark — useFollowing**

In `src/hooks/useFollowing.ts`, add import at top:
```typescript
import { checkBadgeInline } from '@/lib/badge-check-inline'
```

In the `toggle` function (around line 139-178), after the successful bookmark insert (line 171-176), add the badge check. The badge ID depends on the bookmark type.

After the `supabase.from('user_bookmarks').insert(...)` call (line 171-176), inside the `else` branch (i.e., when adding, not removing), add:

```typescript
// Check follow badge after bookmark
const badgeForType: Record<string, string> = {
  match: 'follow_matches',
  player: 'follow_players',
  tournament: 'follow_tournaments',
}
const badgeId = badgeForType[type]
if (badgeId && user) void checkBadgeInline(user.id, badgeId)
```

Place this after the `await supabase.from('user_bookmarks').insert(...)` line but before the closing `}` of the else branch (i.e., after line 176).

- [ ] **Step 5: Login streak — AuthProvider**

In `src/components/AuthProvider.tsx`, add import at top:
```typescript
import { checkBadgeInline } from '@/lib/badge-check-inline'
```

In `updateLoginStreak` (line 200-239), after the successful streak update (after the `await supabase.from('profiles').update(...)` call at lines 228-235), add:

```typescript
// Check streak badges if streak actually increased
void checkBadgeInline(userId, 'login_streak')
void checkBadgeInline(userId, 'longest_streak')
```

Place this after line 235 (the `.eq('id', userId)` line), before the `} catch` block.

- [ ] **Step 6: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/app/\(app\)/feed/page.tsx src/hooks/useMatchRating.ts src/hooks/useInvite.ts src/hooks/useFollowing.ts src/components/AuthProvider.tsx
git commit -m "feat(badges): wire inline badge checks at 6 trigger points

article_click → read_articles, rating → rate_matches,
share → share_app, bookmark → follow_*, streak → login/longest_streak.
All fire-and-forget via checkBadgeInline."
```

---

### Task 5: Smoke Test + Polish

- [ ] **Step 1: Verify TypeScript compiles cleanly**

Run: `npx tsc --noEmit 2>&1 | grep "error TS"`
Expected: no output

- [ ] **Step 2: Run existing tests**

Run: `npx vitest run 2>&1 | tail -5`
Expected: same pass/fail count as before (no new failures)

- [ ] **Step 3: Test badge toast manually**

Start dev server and navigate to any page. Open browser console and dispatch a test event:

```javascript
window.dispatchEvent(new CustomEvent('pn-badge-unlock', { detail: { badge_id: 'read_articles', tier: 1 } }))
```

Verify:
1. Toast slides in from bottom with trophy SVG icon (not emoji)
2. Badge icon bounces in with scale animation
3. Confetti burst fires from badge icon after ~200ms
4. Toast shows "Badge Unlocked" with "News Junkie · Rookie"
5. Toast auto-dismisses after 4 seconds
6. Confetti uses green/white colors (Rookie tier)

Test tier 2:
```javascript
window.dispatchEvent(new CustomEvent('pn-badge-unlock', { detail: { badge_id: 'read_articles', tier: 2 } }))
```
Verify confetti uses orange/white colors.

- [ ] **Step 4: Verify match detail confetti still works**

Navigate to a finished match, rate it. Verify:
1. Rating confetti still fires from the rating card
2. If authenticated, `rate_matches` badge check runs (may not trigger toast if threshold not met, but no errors in console)

- [ ] **Step 5: Fix any issues found**

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "fix(badges): smoke test polish"
```
