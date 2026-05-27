# Notifications UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the notification settings page around the production PressButton design system (chunky-tilt icon-slider toggles, auto-save with per-row feedback), drop dead categories, add a "Rankings updated" category, ship a bookmark-time nudge sheet, and wire a deep-link into device notification settings.

**Architecture:** Four foundation pieces, then composition. (1) `notification-categories.ts` schema shrinks — drop 3 dead categories, add `ranking_updated`, simplify `ChannelPrefs` to `{ push }` only. (2) New `<IconSlider>` component implements the chunky-tilt toggle. (3) New `<NotificationNudgeProvider>` + `useNotificationNudge` hook drives the bookmark-time nudge via React context. (4) New `native-settings.ts` wraps Capacitor's `@capacitor-community/native-settings` with a web fallback. Then the Settings page is rewritten using all four. Phase 2 = install the native plugin + AAB rebuild — turns on the deep-link buttons that Phase 1 already wired.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Vitest, next-intl (5 locales: en/es/pt/it/fr), Supabase JS, Capacitor 8 (Android). No DB migration. No new env vars.

**Spec:** [docs/superpowers/specs/2026-05-27-notifications-redesign-design.md](../specs/2026-05-27-notifications-redesign-design.md)

---

## File Structure

**New files (10):**
- `src/components/IconSlider.tsx` — toggle component (chunky-tilt + check/X in thumb)
- `src/components/IconSlider.module.css` — scoped styles for the toggle
- `src/components/NotificationNudgeProvider.tsx` — context owner + mounted sheet
- `src/components/NotificationNudgeSheet.tsx` — sheet UI (two states)
- `src/components/MuteDurationSheet.tsx` — duration picker
- `src/components/SaveStateSlot.tsx` — per-row saving/saved indicator
- `src/hooks/useNotificationNudge.ts` — trigger logic + dismissal-tracking
- `src/lib/native-settings.ts` — Capacitor `NativeSettings` wrapper + web fallback
- `src/lib/__tests__/notification-categories.test.ts` — unit tests for resolver + filter
- `src/hooks/__tests__/useNotificationNudge.test.ts` — dismissal-tracking math

**Modified files (10):**
- `src/lib/notification-categories.ts` — drop 3 stub categories, add `ranking_updated`, simplify type
- `src/app/api/push/notify/route.ts` — drop `resolved.inApp` gate (always insert in-app row), honor new `mute_until` field
- `src/app/api/user/notification-prefs/route.ts` — validate against the new known-categories list
- `src/app/[locale]/(app)/profile/settings/notifications/page.tsx` — full layout rewrite
- `src/app/[locale]/(app)/notifications/page.tsx` — add gear icon in sub-header; drop "Badges" filter pill
- `src/app/[locale]/(app)/layout.tsx` — mount `<NotificationNudgeProvider>` once
- `src/components/MatchCard.tsx` — call `triggerNudge({category: 'match_live_bookmark'})` after bookmark success
- `src/components/FollowButton.tsx` — call `triggerNudge({category: 'match_live_follow'})` after follow success
- `src/messages/{en,es,pt,it,fr}.json` — add new keys, delete dead ones (×5 files)
- `package.json` + `package-lock.json` — add `@capacitor-community/native-settings`
- `android/app/build.gradle` — bump `versionCode 4 → 5`, `versionName "1.0.3" → "1.0.4"`

**No DB migration. No env vars. No padelgod changes (Phase 3 will add a worker — separate plan).**

---

## Phase-by-Phase Execution Map

The 27 tasks below are grouped into phases. Each phase produces a coherent, committable chunk:

- **Phase A · Foundation** (tasks 1-3) — schema + categories changes
- **Phase B · IconSlider** (tasks 4-5) — new toggle component
- **Phase C · Settings page rewrite** (tasks 6-12) — layout, save feedback, mute
- **Phase D · Bookmark nudge** (tasks 13-17) — provider, sheet, hook, wire-up
- **Phase E · `/notifications` polish** (tasks 18-19) — gear icon, filter cleanup
- **Phase F · i18n** (task 20) — keys for 5 locales
- **Phase G · Native AAB** (tasks 21-22) — plugin install + version bump
- **Phase H · Verify + ship** (tasks 23-27) — lint, type-check, manual smoke, PR

---

## Task 1: Update `ChannelPrefs` shape and remove dead categories

**Files:**
- Modify: `src/lib/notification-categories.ts`
- Create: `src/lib/__tests__/notification-categories.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/notification-categories.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  KNOWN_CATEGORIES,
  CATEGORY_DEFAULTS,
  isKnownCategory,
  resolvePrefs,
  resolveAllPrefs,
  categoryFilter,
} from '../notification-categories'

describe('notification-categories', () => {
  describe('KNOWN_CATEGORIES', () => {
    it('contains exactly the 5 supported categories', () => {
      expect(new Set(KNOWN_CATEGORIES)).toEqual(
        new Set(['match_live_follow', 'match_live_bookmark', 'match_finished', 'ranking_updated', 'marketing']),
      )
    })

    it('does NOT contain the deprecated categories', () => {
      expect(KNOWN_CATEGORIES).not.toContain('match_upcoming')
      expect(KNOWN_CATEGORIES).not.toContain('badge_earned')
      expect(KNOWN_CATEGORIES).not.toContain('streak_milestone')
    })
  })

  describe('CATEGORY_DEFAULTS', () => {
    it('every active category defaults to push: true', () => {
      expect(CATEGORY_DEFAULTS.match_live_follow.push).toBe(true)
      expect(CATEGORY_DEFAULTS.match_live_bookmark.push).toBe(true)
      expect(CATEGORY_DEFAULTS.match_finished.push).toBe(true)
      expect(CATEGORY_DEFAULTS.ranking_updated.push).toBe(true)
    })

    it('marketing defaults to push: true (opt-out per 2026-05-27 decision)', () => {
      expect(CATEGORY_DEFAULTS.marketing.push).toBe(true)
    })

    it('ChannelPrefs has only a push field — no inApp', () => {
      // Type-level: ChannelPrefs is { push: boolean }. Verify at runtime that
      // CATEGORY_DEFAULTS entries don't carry stale inApp keys.
      for (const key of KNOWN_CATEGORIES) {
        expect(Object.keys(CATEGORY_DEFAULTS[key])).toEqual(['push'])
      }
    })
  })

  describe('isKnownCategory', () => {
    it('returns true for current categories', () => {
      expect(isKnownCategory('match_live_follow')).toBe(true)
      expect(isKnownCategory('ranking_updated')).toBe(true)
    })

    it('returns false for deprecated categories', () => {
      expect(isKnownCategory('badge_earned')).toBe(false)
      expect(isKnownCategory('streak_milestone')).toBe(false)
      expect(isKnownCategory('match_upcoming')).toBe(false)
    })

    it('returns false for non-strings', () => {
      expect(isKnownCategory(null)).toBe(false)
      expect(isKnownCategory(42)).toBe(false)
    })
  })

  describe('resolvePrefs', () => {
    it('falls back to defaults when stored is null', () => {
      expect(resolvePrefs(null, 'match_live_follow')).toEqual({ push: true })
    })

    it('returns stored override when present', () => {
      const stored = { match_live_follow: { push: false } }
      expect(resolvePrefs(stored, 'match_live_follow')).toEqual({ push: false })
    })

    it('ignores orphan inApp keys from old stored prefs', () => {
      // Existing users have { push: true, inApp: true } in JSONB from before
      // the deprecation. Resolver should silently drop the inApp.
      const stored = { match_finished: { push: false, inApp: true } as unknown as { push: boolean } }
      expect(resolvePrefs(stored, 'match_finished')).toEqual({ push: false })
    })

    it('falls back when stored has a category with no push key', () => {
      const stored = { match_finished: {} as { push: boolean } }
      expect(resolvePrefs(stored, 'match_finished')).toEqual({ push: true })
    })
  })

  describe('resolveAllPrefs', () => {
    it('returns one entry per KNOWN_CATEGORIES, no more', () => {
      const out = resolveAllPrefs(null)
      expect(Object.keys(out).sort()).toEqual([...KNOWN_CATEGORIES].sort())
    })
  })

  describe('categoryFilter', () => {
    it('returns null for "all"', () => {
      expect(categoryFilter('all')).toBeNull()
    })

    it('returns the 3 match categories for "matches"', () => {
      expect(new Set(categoryFilter('matches'))).toEqual(
        new Set(['match_live_follow', 'match_live_bookmark', 'match_finished']),
      )
    })

    it('returns the 2 update categories for "updates"', () => {
      expect(new Set(categoryFilter('updates'))).toEqual(
        new Set(['ranking_updated', 'marketing']),
      )
    })

    it('returns empty array for unknown filter values (including the old "badges")', () => {
      expect(categoryFilter('badges')).toEqual([])
      expect(categoryFilter('foo')).toEqual([])
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/notification-categories.test.ts`
Expected: FAIL — current `KNOWN_CATEGORIES` includes deprecated entries, `ChannelPrefs` has `inApp`, `categoryFilter` still has `'badges'` branch.

- [ ] **Step 3: Replace the contents of `src/lib/notification-categories.ts`**

```typescript
// src/lib/notification-categories.ts
//
// Single source of truth for notification categories. Used by:
//   - /api/push/notify  (writer — resolves per-user prefs before fanout)
//   - /api/notifications  (read/filter)
//   - /api/user/notification-prefs  (validation + GET resolver)
//   - /profile/settings/notifications  (UI render)
//   - /notifications  (filter pill → category IN list)
//
// 2026-05-27 changes:
//   - Dropped match_upcoming, badge_earned, streak_milestone (never fired).
//   - Added ranking_updated (weekly FIP rankings refresh).
//   - ChannelPrefs simplified from { push, inApp } to { push } only. In-app
//     delivery is always-on now; the inbox is benign and configurable
//     channel-by-channel was needless cognitive load. Existing stored
//     `inApp` keys in profiles.notification_prefs JSONB become orphans
//     this resolver silently drops — no SQL migration needed.

export type ChannelPrefs = { push: boolean }

export type NotificationCategory =
  | 'match_live_follow'
  | 'match_live_bookmark'
  | 'match_finished'
  | 'ranking_updated'
  | 'marketing'

export const CATEGORY_DEFAULTS: Record<NotificationCategory, ChannelPrefs> = {
  match_live_follow:   { push: true },
  match_live_bookmark: { push: true },
  match_finished:      { push: true },
  ranking_updated:     { push: true },  // weekly cadence, low-frequency, fine to default on
  marketing:           { push: true },  // opt-out model (2026-05-27 decision)
}

export const KNOWN_CATEGORIES = Object.keys(CATEGORY_DEFAULTS) as NotificationCategory[]

export function isKnownCategory(value: unknown): value is NotificationCategory {
  return typeof value === 'string' && (KNOWN_CATEGORIES as string[]).includes(value)
}

/**
 * Merge a stored JSONB prefs object with code defaults for a given category.
 * Missing `push` or missing category entry falls back to defaults. Stored
 * orphan keys (e.g. `inApp` from before 2026-05-27) are silently dropped.
 */
export function resolvePrefs(
  stored: Record<string, Partial<ChannelPrefs>> | null | undefined,
  category: NotificationCategory,
): ChannelPrefs {
  const defaults = CATEGORY_DEFAULTS[category]
  const override = stored?.[category]
  if (!override) return { ...defaults }
  return {
    push: typeof override.push === 'boolean' ? override.push : defaults.push,
  }
}

/** Resolve the whole prefs object (every known category) at once. */
export function resolveAllPrefs(
  stored: Record<string, Partial<ChannelPrefs>> | null | undefined,
): Record<NotificationCategory, ChannelPrefs> {
  const out = {} as Record<NotificationCategory, ChannelPrefs>
  for (const key of KNOWN_CATEGORIES) {
    out[key] = resolvePrefs(stored, key)
  }
  return out
}

/** Filter pill → list of categories. 'all' returns null (= no filter). */
export function categoryFilter(
  filter: 'all' | 'matches' | 'updates' | string,
): NotificationCategory[] | null {
  switch (filter) {
    case 'all':
      return null
    case 'matches':
      return ['match_live_follow', 'match_live_bookmark', 'match_finished']
    case 'updates':
      return ['ranking_updated', 'marketing']
    default:
      return []
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/notification-categories.test.ts`
Expected: PASS — all 14 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notification-categories.ts src/lib/__tests__/notification-categories.test.ts
git commit -m "refactor(notifications): drop dead categories, add ranking_updated, simplify ChannelPrefs

- Removed match_upcoming, badge_earned, streak_milestone (never fired)
- Added ranking_updated category (weekly FIP rankings refresh)
- ChannelPrefs is now { push: boolean } only — inApp is always-on
- resolvePrefs silently drops orphan inApp keys from existing stored prefs
- categoryFilter 'badges' → 'updates' to match new groups
- Unit tests cover all 5 helpers including orphan-key handling"
```

---

## Task 2: Update `/api/push/notify` to drop the `resolved.inApp` gate

**Files:**
- Modify: `src/app/api/push/notify/route.ts`

- [ ] **Step 1: Read the current `inApp` gate**

Run: `grep -n "resolved.inApp" src/app/api/push/notify/route.ts`
Expected: shows one match around line 419: `if (resolved.inApp) {`

- [ ] **Step 2: Update the gate to always insert**

Find this block (around line 419-433):

```typescript
    if (resolved.inApp) {
      inAppRows.push({
        user_id: userId,
        category,
        title,
        body,
        url: `/match/${matchId}`,
        metadata: {
          match_id: matchId,
          reason: reason.kind,
          event: isFinishedEvent ? 'finished' : 'live',
          ...(reason.followedPlayerName ? { followed_player_name: reason.followedPlayerName } : {}),
        },
      })
    }
```

Replace with (drop the `if` wrapper, keep the push body):

```typescript
    // In-app delivery is always on as of 2026-05-27. The inbox is benign and
    // never benefited from per-category opt-out — see notification-categories.ts.
    // Push delivery below (the noisy channel) is still gated by resolved.push.
    inAppRows.push({
      user_id: userId,
      category,
      title,
      body,
      url: `/match/${matchId}`,
      metadata: {
        match_id: matchId,
        reason: reason.kind,
        event: isFinishedEvent ? 'finished' : 'live',
        ...(reason.followedPlayerName ? { followed_player_name: reason.followedPlayerName } : {}),
      },
    })
```

- [ ] **Step 3: Run type-check to verify nothing else broke**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/push/notify/route.ts
git commit -m "refactor(push/notify): in-app delivery is always-on, drop resolved.inApp gate

Per 2026-05-27 notification redesign, per-category in-app preference was
removed. The /notifications inbox feed populates for every category that
fires, regardless of per-user push pref. Push delivery (the noisy channel)
is still gated by resolved.push."
```

---

## Task 3: Update `/api/user/notification-prefs` to reject orphan categories

**Files:**
- Modify: `src/app/api/user/notification-prefs/route.ts`

- [ ] **Step 1: Read the current validator**

Run: `grep -n "isKnownCategory\|category" src/app/api/user/notification-prefs/route.ts | head -10`

- [ ] **Step 2: Verify validator uses `isKnownCategory`**

Open `src/app/api/user/notification-prefs/route.ts`. The PATCH handler should already validate the incoming `category` via `isKnownCategory()` (which now returns false for the 3 deprecated categories — automatic).

If the PATCH handler also validates the shape of the body (e.g. accepts only `{ push, inApp }`), update it to accept only `{ push }`:

Search for any `'inApp'` reference in the PATCH validator. If found, remove the validation branch — silently ignore `inApp` if a client still sends it (graceful for stale browser tabs during deploy).

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/user/notification-prefs/route.ts
git commit -m "refactor(prefs): drop inApp from PATCH body, gracefully ignore from stale clients"
```

---

## Task 4: Create `<IconSlider>` component

**Files:**
- Create: `src/components/IconSlider.tsx`
- Create: `src/components/IconSlider.module.css`

- [ ] **Step 1: Create the CSS module**

Create `src/components/IconSlider.module.css`:

```css
/*
 * IconSlider — chunky-tilted toggle with check/X icon in the thumb.
 *
 * Anatomy:
 *   .track  — 52×28px, clip-path tilt, transitions background + box-shadow
 *   .thumb  — 22×22px, slides 24px left↔right, holds two icons (crossfade)
 *
 * States:
 *   OFF — track has subtle inset green border, thumb on LEFT, X visible
 *   ON  — track filled green, thumb on RIGHT, check visible
 *
 * Disabled (master off, or row currently saving) — opacity 0.4, no events.
 *
 * Accessibility: parent <button> uses role="switch" + aria-checked.
 */
.track {
  width: 52px;
  height: 28px;
  position: relative;
  background: rgba(126, 211, 33, 0.06);
  box-shadow: inset 0 0 0 1.5px rgba(126, 211, 33, 0.35);
  clip-path: polygon(0% 8%, 100% 0%, 100% 92%, 0% 100%);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 220ms ease-out, box-shadow 220ms ease-out, opacity 150ms;
  border: 0;
  padding: 0;
}

.track.on {
  background: #7ED321;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), inset 0 -1px 0 rgba(0, 0, 0, 0.18);
}

.track:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 22px;
  height: 22px;
  background: #0a0a0a;
  clip-path: polygon(0% 8%, 100% 0%, 100% 92%, 0% 100%);
  transition: left 220ms cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
}

.track.on .thumb { left: 27px; }

.iconX, .iconCheck {
  position: absolute;
  width: 12px;
  height: 12px;
  transition: opacity 180ms ease-out;
}

.iconX { opacity: 1; color: rgba(255, 255, 255, 0.45); }
.iconCheck { opacity: 0; color: #7ED321; }

.track.on .iconX { opacity: 0; }
.track.on .iconCheck { opacity: 1; }
```

- [ ] **Step 2: Create the React component**

Create `src/components/IconSlider.tsx`:

```typescript
'use client'
// src/components/IconSlider.tsx
//
// Chunky-tilted toggle component for notification preferences (2026-05-27).
// Replaces the simple pill <Toggle> used in the old settings page.
//
// Usage:
//   <IconSlider checked={on} onChange={(next) => setOn(next)} ariaLabel="Push notifications" />
//
// Disabled state is for master-toggle-off OR row-currently-saving cases.

import styles from './IconSlider.module.css'

interface IconSliderProps {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  ariaLabel: string
}

export function IconSlider({ checked, onChange, disabled = false, ariaLabel }: IconSliderProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`${styles.track} ${checked ? styles.on : ''}`}
    >
      <span className={styles.thumb}>
        <svg className={styles.iconX} viewBox="0 0 24 24" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          <line x1="6" y1="18" x2="18" y2="6" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <svg className={styles.iconCheck} viewBox="0 0 24 24" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </button>
  )
}
```

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/IconSlider.tsx src/components/IconSlider.module.css
git commit -m "feat(notifications): IconSlider — chunky-tilt toggle with check/X in thumb

Sentry-inspired pattern adapted with PadelNachos chunky-tilted clip-path
and primary-green palette. 52x28 track, 22x22 thumb, 220ms slide with
cubic-bezier easing, 180ms icon crossfade. Accessible via role=switch +
aria-checked. Disabled state for master-off / saving-in-progress."
```

---

## Task 5: Create `<SaveStateSlot>` per-row save feedback indicator

**Files:**
- Create: `src/components/SaveStateSlot.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/SaveStateSlot.tsx`:

```typescript
'use client'
// src/components/SaveStateSlot.tsx
//
// Per-row save feedback indicator. Sits to the right of the IconSlider on
// the notifications Settings page. Three states:
//
//   idle    — empty (24x24 slot occupies space so layout doesn't shift)
//   saving  — green-ringed spinner (PATCH in flight)
//   saved   — check that holds 1.5s then fades out
//
// Caller drives state via the `state` prop. Failure case has no entry here;
// PR #459 error toast handles that path.

import { useEffect } from 'react'

export type SaveState = 'idle' | 'saving' | 'saved'

interface SaveStateSlotProps {
  state: SaveState
  /** Called when the saved-flash finishes its hold and should return to idle. */
  onSavedFlashEnd?: () => void
}

export function SaveStateSlot({ state, onSavedFlashEnd }: SaveStateSlotProps) {
  // After the saved check is visible for 1.5s, ask the parent to flip back to idle.
  useEffect(() => {
    if (state !== 'saved' || !onSavedFlashEnd) return
    const t = setTimeout(onSavedFlashEnd, 1500)
    return () => clearTimeout(t)
  }, [state, onSavedFlashEnd])

  return (
    <span
      aria-live="polite"
      style={{
        width: 24,
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      {state === 'saving' && (
        <span
          style={{
            width: 14,
            height: 14,
            border: '2px solid rgba(126,211,33,0.25)',
            borderTopColor: '#7ED321',
            borderRadius: '50%',
            animation: 'pn-spin 800ms linear infinite',
          }}
        />
      )}
      {state === 'saved' && (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          aria-label="Saved"
          style={{ color: '#7ED321', animation: 'pn-flashout 1500ms ease-out forwards' }}
        >
          <polyline
            points="20 6 9 17 4 12"
            stroke="currentColor"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      )}

      {/* keyframes injected once globally — see Step 2 */}
    </span>
  )
}
```

- [ ] **Step 2: Add keyframes to global stylesheet**

Open `src/app/globals.css` (or the next.js global stylesheet location — check `src/app/layout.tsx` for the import). Append:

```css
/* SaveStateSlot animations — see src/components/SaveStateSlot.tsx */
@keyframes pn-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
@keyframes pn-flashout {
  0%, 60% { opacity: 1; }
  100% { opacity: 0; }
}
```

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/SaveStateSlot.tsx src/app/globals.css
git commit -m "feat(notifications): SaveStateSlot — transient saving→saved per-row indicator

24x24 slot to the right of each toggle. Spinner during PATCH, check flash
for 1.5s on success, then fades to idle. Error path stays on PR #459's
toast (no entry here)."
```

---

## Task 6: Wire IconSlider + SaveStateSlot into the Settings page (skeleton + master toggle)

**Files:**
- Modify: `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`

> This task lands the new page chrome (banner placeholder, master toggle, group structure) using IconSlider + SaveStateSlot. Categories come in Task 7 to keep the diff readable.

- [ ] **Step 1: Read the current page to understand its imports + structure**

Run: `head -80 src/app/[locale]/(app)/profile/settings/notifications/page.tsx`

- [ ] **Step 2: Replace the body of the file**

Open `src/app/[locale]/(app)/profile/settings/notifications/page.tsx` and replace its **entire contents** with:

```typescript
'use client'
// src/app/[locale]/(app)/profile/settings/notifications/page.tsx
//
// Notifications preferences (redesigned 2026-05-27 — see
// docs/superpowers/specs/2026-05-27-notifications-redesign-design.md).
//
// Layout top-to-bottom:
//   1. Permission-blocked banner (when OS perm denied)
//   2. Mute notifications row (action — opens MuteDurationSheet)
//   3. Notification sounds row (deep-link to OS channel settings)
//   4. Master "Push notifications" toggle
//   5. "Matches" group — 3 categories
//   6. "Updates" group — 2 categories
//   7. Auto-save hint footer
//
// Every per-category toggle uses <IconSlider> + <SaveStateSlot>. PATCH on
// /api/user/notification-prefs is optimistic with rollback + error toast.

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { usePushNotifications, type SubscribeError } from '@/hooks/usePushNotifications'
import { KNOWN_CATEGORIES, type NotificationCategory, type ChannelPrefs } from '@/lib/notification-categories'
import { IconSlider } from '@/components/IconSlider'
import { SaveStateSlot, type SaveState } from '@/components/SaveStateSlot'
import { openSystemNotificationSettings } from '@/lib/native-settings'

type Group = { key: 'groupMatches' | 'groupUpdates'; categories: NotificationCategory[] }
const GROUPS: Group[] = [
  { key: 'groupMatches', categories: ['match_live_follow', 'match_live_bookmark', 'match_finished'] },
  { key: 'groupUpdates', categories: ['ranking_updated', 'marketing'] },
]

export default function NotificationPrefsPage() {
  const t = useTranslations('notifications.settings')
  const router = useRouter()
  const { enabled: pushEnabled, toggle: togglePush, permission, supported, lastError, clearError } = usePushNotifications()
  const [prefs, setPrefs] = useState<Record<NotificationCategory, ChannelPrefs> | null>(null)
  const [saveStates, setSaveStates] = useState<Partial<Record<NotificationCategory | '__master__', SaveState>>>({})
  const [masterSaveState, setMasterSaveState] = useState<SaveState>('idle')
  const [toast, setToast] = useState<string | null>(null)

  // ── Load prefs from server ─────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as { prefs: Record<NotificationCategory, ChannelPrefs> }
        if (!cancelled) setPrefs(body.prefs)
      } catch { /* silent — error toast covers user-initiated saves only */ }
    })()
    return () => { cancelled = true }
  }, [])

  // ── Map structured subscribe-error → localized toast (from PR #459) ─
  const formatSubscribeError = useCallback((err: SubscribeError): string => {
    switch (err.kind) {
      case 'not-signed-in':      return t('errors.notSignedIn')
      case 'os-denied':          return t('errors.osDenied')
      case 'token-unavailable':  return t('errors.tokenUnavailable', { message: err.message })
      case 'server-auth':        return t('errors.serverAuth')
      case 'server-error':       return t('errors.serverError', { status: err.status })
      case 'network':            return t('errors.network', { message: err.message })
      case 'not-supported':      return t('errors.notSupported')
    }
  }, [t])

  useEffect(() => {
    if (!lastError) return
    setToast(formatSubscribeError(lastError))
    const timer = setTimeout(() => { setToast(null); clearError() }, 6000)
    return () => clearTimeout(timer)
  }, [lastError, formatSubscribeError, clearError])

  // ── Per-category PATCH with optimistic rollback + per-row save state ──
  const patchCategory = useCallback(async (category: NotificationCategory, next: ChannelPrefs) => {
    if (!prefs) return
    const prev = prefs
    setPrefs({ ...prefs, [category]: next })
    setSaveStates(s => ({ ...s, [category]: 'saving' }))
    try {
      const res = await fetch('/api/user/notification-prefs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, push: next.push }),
      })
      if (!res.ok) throw new Error('save failed')
      setSaveStates(s => ({ ...s, [category]: 'saved' }))
    } catch {
      setPrefs(prev)
      setSaveStates(s => ({ ...s, [category]: 'idle' }))
      setToast(t('saveError'))
      setTimeout(() => setToast(null), 2500)
    }
  }, [prefs, t])

  const permissionDenied = supported && permission === 'denied'

  return (
    <main style={{ paddingBottom: 80, background: '#0A0A0A', minHeight: '100vh' }}>
      {/* Sub-header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: '#0A0A0A',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        padding: '12px 16px',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <button onClick={() => router.back()} aria-label="Back" style={{ background: 'transparent', border: 'none', color: '#7ED321', cursor: 'pointer', padding: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: 0 }}>{t('title')}</h1>
      </div>

      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Permission-blocked banner */}
        {permissionDenied && (
          <div style={{
            background: 'rgba(245,70,85,0.08)',
            border: '1px solid rgba(245,70,85,0.35)',
            padding: '11px 13px',
            clipPath: 'polygon(0% 2%, 99.5% 0%, 100% 98%, 0.5% 100%)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span style={{
              width: 30, height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'rgba(245,70,85,0.18)', color: '#ff7884',
              clipPath: 'polygon(0% 5%, 100% 0%, 100% 95%, 0% 100%)',
              flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ color: '#ff7884', fontSize: 12.5, fontWeight: 700 }}>{t('blocked.title')}</div>
              <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 11.5, marginTop: 2 }}>{t('blocked.body')}</div>
            </div>
            <button
              onClick={() => openSystemNotificationSettings()}
              style={{
                background: '#FF4655', color: '#fff', border: 0, padding: '6px 12px',
                fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
                clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {t('blocked.cta')}
            </button>
          </div>
        )}

        {/* Master push toggle */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
        }}>
          <span style={{ color: '#fff', fontSize: 14, fontWeight: 600 }}>{t('masterLabel')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <IconSlider
              checked={pushEnabled}
              onChange={() => void togglePush()}
              disabled={!supported || permissionDenied}
              ariaLabel={t('masterLabel')}
            />
            <SaveStateSlot state={masterSaveState} onSavedFlashEnd={() => setMasterSaveState('idle')} />
          </div>
        </div>

        {/* Category groups — populated in Task 7 */}
        {prefs && GROUPS.map(group => (
          <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, padding: '10px 4px 2px' }}>
              {t(group.key)}
            </div>
            {/* Rows added in Task 7 */}
          </section>
        ))}

        {/* Auto-save hint footer */}
        <div style={{
          textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.35)',
          padding: '14px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#7ED321' }} />
          {t('saveHint')}
        </div>
      </div>

      {/* Toast (error path only) */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 80, left: 16, right: 16,
          background: '#FF4655', color: '#fff', padding: '10px 14px',
          fontSize: 13, fontWeight: 600, textAlign: 'center', zIndex: 100,
          clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
        }}>
          {toast}
        </div>
      )}
    </main>
  )
}
```

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: FAIL on `openSystemNotificationSettings` import (created in Task 21) and i18n keys (`blocked.*`, `groupMatches`, `groupUpdates`, `saveHint` — added in Task 20). These are expected — they get resolved by later tasks.

To keep the file compile-clean for now, **add a tiny placeholder** at the top of the file under the imports:

```typescript
// Placeholder until Task 21 wires the real Capacitor plugin
function openSystemNotificationSettings() { console.warn('[settings] openSystemNotificationSettings called — placeholder') }
```

And remove the `import { openSystemNotificationSettings } from '@/lib/native-settings'` line for now. We'll restore it in Task 21.

- [ ] **Step 4: Re-run type-check**

Run: `npx tsc --noEmit`
Expected: PASS (i18n keys aren't type-checked).

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/(app)/profile/settings/notifications/page.tsx
git commit -m "feat(notifications): Settings page skeleton — banner, master toggle, group shell

Lands the new layout chrome: permission-blocked banner with deep-link CTA
placeholder, master push toggle with SaveStateSlot, group header
structure. Per-category rows added in next task. openSystemNotificationSettings
is a placeholder until Task 21 wires the Capacitor plugin."
```

---

## Task 7: Add per-category rows to the Settings page

**Files:**
- Modify: `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`

- [ ] **Step 1: Add the category-row render inside the group section**

Find this block in the page (added in Task 6):

```typescript
        {prefs && GROUPS.map(group => (
          <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, padding: '10px 4px 2px' }}>
              {t(group.key)}
            </div>
            {/* Rows added in Task 7 */}
          </section>
        ))}
```

Replace with:

```typescript
        {prefs && GROUPS.map(group => (
          <section key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.7, padding: '10px 4px 2px' }}>
              {t(group.key)}
            </div>
            {group.categories.map(cat => {
              const pref = prefs[cat]
              const state = saveStates[cat] ?? 'idle'
              const disabledByMaster = !pushEnabled || permissionDenied
              return (
                <div
                  key={cat}
                  style={{
                    padding: '14px',
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 12,
                    opacity: disabledByMaster ? 0.45 : 1,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.25 }}>
                      {t(`category.${cat}.label`)}
                    </span>
                    <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>
                      {t(`category.${cat}.sub`)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <IconSlider
                      checked={pref.push}
                      onChange={(next) => void patchCategory(cat, { push: next })}
                      disabled={disabledByMaster}
                      ariaLabel={t(`category.${cat}.label`)}
                    />
                    <SaveStateSlot
                      state={state}
                      onSavedFlashEnd={() => setSaveStates(s => ({ ...s, [cat]: 'idle' }))}
                    />
                  </div>
                </div>
              )
            })}
          </section>
        ))}
```

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(app)/profile/settings/notifications/page.tsx
git commit -m "feat(notifications): per-category rows on Settings page

Each category gets an IconSlider + SaveStateSlot. Rows dim when master
toggle is off or OS perm is denied. patchCategory drives optimistic UI
with per-row save state."
```

---

## Task 8: Create `MuteDurationSheet` (bottom sheet with 4 options)

**Files:**
- Create: `src/components/MuteDurationSheet.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/MuteDurationSheet.tsx`:

```typescript
'use client'
// src/components/MuteDurationSheet.tsx
//
// Bottom sheet for picking a mute duration. Returns an ISO timestamp (or
// the sentinel string 'forever') to the caller via onPick.
//
// Durations:
//   1h       — now + 1 hour
//   4h       — now + 4 hours
//   tomorrow — tomorrow 8 AM in the user's local timezone
//   forever  — sentinel; mute_until stored as 'forever'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'

type Duration = '1h' | '4h' | 'tomorrow' | 'forever'

interface MuteDurationSheetProps {
  open: boolean
  onClose: () => void
  onPick: (until: string) => void
}

function computeMuteUntil(duration: Duration): string {
  if (duration === 'forever') return 'forever'
  const now = new Date()
  if (duration === '1h') return new Date(now.getTime() + 3600_000).toISOString()
  if (duration === '4h') return new Date(now.getTime() + 4 * 3600_000).toISOString()
  // tomorrow 8am local
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(8, 0, 0, 0)
  return tomorrow.toISOString()
}

export function MuteDurationSheet({ open, onClose, onPick }: MuteDurationSheetProps) {
  const t = useTranslations('notifications.settings.mute')

  // Close on Escape key
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const pick = (d: Duration) => {
    onPick(computeMuteUntil(d))
    onClose()
  }

  const options: Array<{ key: Duration; labelKey: string }> = [
    { key: '1h', labelKey: 'durations.1h' },
    { key: '4h', labelKey: 'durations.4h' },
    { key: 'tomorrow', labelKey: 'durations.tomorrow' },
    { key: 'forever', labelKey: 'durations.forever' },
  ]

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }}
      />
      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('label')}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#1A1A1A', borderTop: '1px solid rgba(255,255,255,0.10)',
          padding: '16px 16px 28px', zIndex: 201,
        }}
      >
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.20)', borderRadius: 999, margin: '0 auto 14px' }} />
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 14px', textAlign: 'center', color: '#fff' }}>
          {t('label')}
        </h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {options.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => pick(opt.key)}
              style={{
                padding: '14px', background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                color: '#fff', fontSize: 14, fontWeight: 600, textAlign: 'left',
                cursor: 'pointer',
                clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
              }}
            >
              {t(opt.labelKey)}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/MuteDurationSheet.tsx
git commit -m "feat(notifications): MuteDurationSheet — 4 duration options (1h/4h/tomorrow/forever)

Returns ISO timestamp (or 'forever' sentinel) via onPick. Backdrop click
or Escape closes. Tomorrow option computes 8 AM in user's local timezone."
```

---

## Task 9: Wire Mute action row into Settings page

**Files:**
- Modify: `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`

- [ ] **Step 1: Add mute state + sheet integration**

In `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`:

Add this import near the top alongside the other component imports:

```typescript
import { MuteDurationSheet } from '@/components/MuteDurationSheet'
```

Add this state near the other `useState` calls:

```typescript
  const [muteUntil, setMuteUntil] = useState<string | null>(null)
  const [muteSheetOpen, setMuteSheetOpen] = useState(false)
```

Add a `useEffect` to load mute state from the same prefs endpoint (extend the existing prefs fetch — the API will return `mute_until` on the same response):

```typescript
  // Augment the existing prefs-load effect — mute_until lives at the same endpoint
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as {
          prefs: Record<NotificationCategory, ChannelPrefs>
          mute_until?: string | null
        }
        if (!cancelled) {
          setPrefs(body.prefs)
          setMuteUntil(body.mute_until ?? null)
        }
      } catch { /* silent */ }
    })()
    return () => { cancelled = true }
  }, [])
```

(This REPLACES the existing prefs-load effect — delete the old one.)

Add a mute-PATCH callback near `patchCategory`:

```typescript
  const patchMute = useCallback(async (until: string | null) => {
    const prev = muteUntil
    setMuteUntil(until)
    try {
      const res = await fetch('/api/user/notification-prefs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mute_until: until }),
      })
      if (!res.ok) throw new Error('save failed')
    } catch {
      setMuteUntil(prev)
      setToast(t('saveError'))
      setTimeout(() => setToast(null), 2500)
    }
  }, [muteUntil, t])
```

Add the mute action row in the JSX, between the permission-blocked banner and the master toggle:

```jsx
        {/* Mute action row */}
        <div style={{
          padding: '14px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <span style={{
              width: 32, height: 32, background: 'rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.75)',
              clipPath: 'polygon(0% 5%, 100% 0%, 100% 95%, 0% 100%)',
              flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13.73 21a2 2 0 0 1-3.46 0M18 8a6 6 0 0 0-9.33-5M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14M1 1l22 22" />
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.25 }}>{t('mute.label')}</span>
              <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>{t('mute.sub')}</span>
            </div>
          </div>
          {muteUntil ? (
            <button
              type="button"
              onClick={() => void patchMute(null)}
              style={{
                background: '#EAB308', color: '#1A1A1A', border: 0, padding: '7px 13px',
                fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
                clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {muteUntil === 'forever' ? t('mute.activeForever') : t('mute.activeUntil', { time: new Date(muteUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) })}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setMuteSheetOpen(true)}
              style={{
                background: 'transparent', color: 'rgba(255,255,255,0.65)',
                border: '1.5px solid rgba(255,255,255,0.20)', padding: '7px 13px',
                fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
                clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
                cursor: 'pointer', flexShrink: 0,
              }}
            >
              {t('mute.cta')}
            </button>
          )}
        </div>
```

Add the sheet at the bottom of `<main>` (just before the closing `</main>`):

```jsx
        <MuteDurationSheet
          open={muteSheetOpen}
          onClose={() => setMuteSheetOpen(false)}
          onPick={(until) => void patchMute(until)}
        />
```

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(app)/profile/settings/notifications/page.tsx
git commit -m "feat(notifications): mute action row + sheet integration

Settings page now has a Mute notifications row above the master toggle.
Off state shows a 'Mute…' ghost button that opens MuteDurationSheet.
Active state shows a gold button with the remaining duration that, on tap,
clears the mute. PATCHes mute_until field on the prefs endpoint."
```

---

## Task 10: Persist `mute_until` in the notification-prefs API

**Files:**
- Modify: `src/app/api/user/notification-prefs/route.ts`

- [ ] **Step 1: Read the current route**

Run: `cat src/app/api/user/notification-prefs/route.ts`

- [ ] **Step 2: Add `mute_until` to GET response**

Find the GET handler. After it resolves `prefs`, also return `mute_until`. Pattern (adapt to actual variable names):

```typescript
// In the GET handler — adjust to match the actual structure:
return Response.json({
  prefs: resolveAllPrefs(stored),
  mute_until: profile?.notification_mute_until ?? null,
})
```

If the profiles row doesn't yet have a `notification_mute_until` column, ADD it via a new migration (see step 3). If it already exists, skip the migration.

- [ ] **Step 3: Add migration if column doesn't exist**

Check: `grep -r "notification_mute_until" supabase/migrations/ 2>/dev/null`

If empty, create a new migration file `supabase/migrations/2026-05-27T120000_add_notification_mute_until.sql`:

```sql
-- Adds notification_mute_until to profiles for the mute-notifications feature
-- (see docs/superpowers/specs/2026-05-27-notifications-redesign-design.md).
--
-- Value is either:
--   - NULL: not muted
--   - 'forever': muted until user explicitly un-mutes
--   - ISO 8601 timestamp: muted until that point in time
--
-- /api/push/notify checks this before any push fan-out. In-app inserts
-- still run (mute is push-only).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_mute_until text DEFAULT NULL;

COMMENT ON COLUMN public.profiles.notification_mute_until IS
  'Mute state for push notifications. NULL = not muted, ''forever'' = indefinite, otherwise ISO 8601 timestamp.';
```

Apply the migration in your Supabase environment (`supabase db push` if using CLI, or via the Supabase dashboard SQL editor).

- [ ] **Step 4: Update PATCH handler to accept `mute_until`**

In the same route file, the PATCH handler currently accepts `category` + `push` (and possibly old `inApp`). Add a branch for the mute-only PATCH (no `category`, just `mute_until`):

```typescript
// Pseudocode — adapt to actual handler shape:
const body = await req.json() as { category?: string; push?: boolean; mute_until?: string | null }

if ('mute_until' in body) {
  // Mute-only patch
  const value = body.mute_until === null ? null : String(body.mute_until)
  // Validate: must be null, 'forever', or parseable date
  if (value !== null && value !== 'forever') {
    const parsed = Date.parse(value)
    if (Number.isNaN(parsed)) return Response.json({ error: 'invalid mute_until' }, { status: 400 })
  }
  await supabase.from('profiles').update({ notification_mute_until: value }).eq('id', user.id)
  return Response.json({ ok: true })
}

// Otherwise it's a category patch — keep existing logic
```

- [ ] **Step 5: Update `/api/push/notify` to honor mute**

In `src/app/api/push/notify/route.ts`, after resolving the per-user prefs, add a mute check. Find where push fan-out begins (around the per-user loop). Add this gate per-user (NOT for in-app — in-app still goes through):

```typescript
// Inside the per-recipient loop, after resolving prefs:
const muteUntil = profileRows.get(userId)?.notification_mute_until ?? null
const isMuted = muteUntil === 'forever' || (typeof muteUntil === 'string' && new Date(muteUntil) > new Date())

if (isMuted) {
  // Skip push for this user; in-app insert still runs (history is preserved).
  // Don't add anything to pushJobs[] for this user.
} else if (resolved.push) {
  // existing push push-jobs logic
}
```

Adjust to fit the existing structure. Make sure `notification_mute_until` is selected in the profiles query at the top of the route.

- [ ] **Step 6: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/user/notification-prefs/route.ts src/app/api/push/notify/route.ts supabase/migrations/
git commit -m "feat(notifications): persist mute_until + honor in /api/push/notify

- Adds profiles.notification_mute_until column (NULL, 'forever', or ISO ts)
- GET /api/user/notification-prefs returns mute_until alongside prefs
- PATCH accepts mute_until-only body for mute on/off
- /api/push/notify skips push fan-out for users with active mute;
  in-app inserts still run so history is preserved"
```

---

## Task 11: Add Notification sounds deep-link row

**Files:**
- Modify: `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`

- [ ] **Step 1: Add the row to the JSX**

In the Settings page, insert this row immediately AFTER the Mute action row (added in Task 9) and BEFORE the master toggle:

```jsx
        {/* Notification sounds deep-link */}
        <button
          type="button"
          onClick={() => openSystemNotificationSettings()}
          style={{
            padding: '14px',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            cursor: 'pointer', textAlign: 'left',
            color: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
            <span style={{
              width: 32, height: 32, background: 'rgba(255,255,255,0.06)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'rgba(255,255,255,0.75)',
              clipPath: 'polygon(0% 5%, 100% 0%, 100% 95%, 0% 100%)',
              flexShrink: 0,
            }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
              </svg>
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: '#fff', lineHeight: 1.25 }}>{t('sounds.label')}</span>
              <span style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.35 }}>{t('sounds.sub')}</span>
            </div>
          </div>
          <span style={{ color: 'rgba(255,255,255,0.4)' }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </span>
        </button>
```

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(app)/profile/settings/notifications/page.tsx
git commit -m "feat(notifications): notification sounds deep-link row

Tappable row above the master toggle. Calls openSystemNotificationSettings()
which (until Task 21) is a placeholder. After Task 21 it deep-links into
OS notification channel settings via Capacitor NativeSettings."
```

---

## Task 12: Verify Settings page renders end-to-end on dev server

**Files:** none (manual)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: `Ready in <Xs>` on port 3002 (or whatever the dev port is).

- [ ] **Step 2: Open browser, sign in, navigate to settings**

Browse to `http://localhost:3002/en/profile/settings/notifications`.

Expected (visually):
- Banner card visible only if browser notifications were previously denied for the dev host (Chrome → click padlock → Site settings)
- Mute notifications row with ghost "Mute…" button (or gold "Muted · …" if a prior mute persists)
- Notification sounds row with chevron
- "Push notifications" master toggle row with IconSlider
- "Matches" group (3 rows) and "Updates" group (2 rows) — each with IconSlider + empty SaveStateSlot
- "Changes save automatically" footer with green dot

- [ ] **Step 3: Toggle a category and watch the save state**

Tap any category toggle (e.g. "Match finished"). Expected sequence:
1. Toggle slides immediately
2. Green spinner appears in the SaveStateSlot
3. ~700ms later (depending on network), spinner crossfades to a check
4. After 1.5s, check fades out
5. Slot returns to empty

If you see the spinner but no check: the PATCH likely failed — check Network tab for the response.

- [ ] **Step 4: Open mute sheet**

Tap "Mute…" button. Expected:
- Bottom sheet slides up with 4 options
- Backdrop dims the page
- Tapping outside the sheet (the backdrop) closes it
- Tapping a duration replaces the "Mute…" button with a gold "Muted · 9am" (or similar)

- [ ] **Step 5: Stop dev server when done**

Press Ctrl+C in the dev terminal.

- [ ] **Step 6: Commit nothing — checkpoint only**

If anything is visually broken at this point, fix before continuing. The next phase wires the bookmark nudge, which depends on the Settings page being correct.

---

## Task 13: Create `useNotificationNudge` hook with tests

**Files:**
- Create: `src/hooks/useNotificationNudge.ts`
- Create: `src/hooks/__tests__/useNotificationNudge.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/hooks/__tests__/useNotificationNudge.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  shouldShowNudge,
  recordDismissal,
  type NudgeContext,
  type NudgeCategory,
} from '../useNotificationNudge'

// Storage mock — vitest's node env has no localStorage by default
class MemStorage {
  store = new Map<string, string>()
  getItem(k: string) { return this.store.get(k) ?? null }
  setItem(k: string, v: string) { this.store.set(k, v) }
  removeItem(k: string) { this.store.delete(k) }
}

describe('shouldShowNudge', () => {
  let storage: MemStorage

  beforeEach(() => {
    storage = new MemStorage()
  })

  it('returns null when everything is already configured (OS granted + pref on)', () => {
    const ctx: NudgeContext = {
      osPermission: 'granted',
      categoryPushPref: true,
      now: new Date('2026-05-27T12:00:00Z').getTime(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBeNull()
  })

  it('returns "os-blocked" when OS denied, regardless of pref', () => {
    const ctx: NudgeContext = {
      osPermission: 'denied',
      categoryPushPref: true,
      now: Date.now(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('os-blocked')
  })

  it('returns "pref-off" when OS granted but pref disabled', () => {
    const ctx: NudgeContext = {
      osPermission: 'granted',
      categoryPushPref: false,
      now: Date.now(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('pref-off')
  })

  it('prioritizes os-blocked over pref-off (both broken)', () => {
    const ctx: NudgeContext = {
      osPermission: 'denied',
      categoryPushPref: false,
      now: Date.now(),
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('os-blocked')
  })

  it('returns null when category was dismissed within last 7 days', () => {
    const now = new Date('2026-05-27T12:00:00Z').getTime()
    const fourDaysAgo = now - 4 * 86400_000
    storage.setItem('pn:nudge-dismissed:match_live_bookmark', String(fourDaysAgo))
    const ctx: NudgeContext = {
      osPermission: 'denied',
      categoryPushPref: false,
      now,
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBeNull()
  })

  it('returns the nudge again after 7 days have passed since dismissal', () => {
    const now = new Date('2026-05-27T12:00:00Z').getTime()
    const eightDaysAgo = now - 8 * 86400_000
    storage.setItem('pn:nudge-dismissed:match_live_bookmark', String(eightDaysAgo))
    const ctx: NudgeContext = {
      osPermission: 'denied',
      categoryPushPref: false,
      now,
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBe('os-blocked')
  })

  it('dismissal is per-category — dismissing bookmark does not silence follow', () => {
    const now = Date.now()
    storage.setItem('pn:nudge-dismissed:match_live_bookmark', String(now))
    const ctx: NudgeContext = {
      osPermission: 'denied',
      categoryPushPref: false,
      now,
      storage: storage as unknown as Storage,
    }
    expect(shouldShowNudge('match_live_bookmark', ctx)).toBeNull()
    expect(shouldShowNudge('match_live_follow', ctx)).toBe('os-blocked')
  })
})

describe('recordDismissal', () => {
  it('writes the current timestamp to the per-category key', () => {
    const storage = new MemStorage()
    const now = 1234567890
    recordDismissal('match_live_bookmark' as NudgeCategory, now, storage as unknown as Storage)
    expect(storage.getItem('pn:nudge-dismissed:match_live_bookmark')).toBe('1234567890')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/hooks/__tests__/useNotificationNudge.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Create the hook**

Create `src/hooks/useNotificationNudge.ts`:

```typescript
'use client'
// src/hooks/useNotificationNudge.ts
//
// Decides whether to show the bookmark/follow nudge after a user takes the
// triggering action. Pure logic (testable) lives at the top; the React hook
// wraps it with context access at the bottom.

import { useCallback, useContext } from 'react'
import { NotificationNudgeContext } from '@/components/NotificationNudgeProvider'

export type NudgeCategory = 'match_live_bookmark' | 'match_live_follow'
export type NudgeState = 'os-blocked' | 'pref-off'

export interface NudgeContext {
  osPermission: NotificationPermission // 'granted' | 'denied' | 'default'
  categoryPushPref: boolean             // user's current push pref for the category
  now: number                           // injectable for tests
  storage: Storage                      // injectable for tests
}

const DISMISSAL_WINDOW_MS = 7 * 24 * 3600 * 1000

function dismissalKey(category: NudgeCategory): string {
  return `pn:nudge-dismissed:${category}`
}

/**
 * Pure decision function. Returns the nudge state to show, or null to skip.
 *
 *   os-blocked  — OS perm denied (takes priority — pref doesn't matter)
 *   pref-off    — OS perm OK but in-app push pref disabled
 *   null        — fully configured OR dismissed in the last 7 days
 */
export function shouldShowNudge(category: NudgeCategory, ctx: NudgeContext): NudgeState | null {
  // Dismissal first — short-circuit before any other logic
  const dismissedAt = ctx.storage.getItem(dismissalKey(category))
  if (dismissedAt) {
    const elapsed = ctx.now - parseInt(dismissedAt, 10)
    if (elapsed < DISMISSAL_WINDOW_MS) return null
  }

  // OS blocked beats pref-off
  if (ctx.osPermission === 'denied') return 'os-blocked'

  // Pref disabled
  if (!ctx.categoryPushPref) return 'pref-off'

  return null
}

export function recordDismissal(category: NudgeCategory, now: number, storage: Storage): void {
  storage.setItem(dismissalKey(category), String(now))
}

// ── React hook ─────────────────────────────────────────────────────
//
// The provider is mounted in (app)/layout.tsx. Hook subscribers (e.g. the
// MatchCard bookmark click handler) call triggerNudge() to publish a
// candidate; the provider runs shouldShowNudge() with current OS perm +
// stored prefs and either shows the sheet or no-ops.

export interface UseNotificationNudgeResult {
  triggerNudge: (args: { category: NudgeCategory }) => void
}

export function useNotificationNudge(): UseNotificationNudgeResult {
  const ctx = useContext(NotificationNudgeContext)
  const triggerNudge = useCallback((args: { category: NudgeCategory }) => {
    ctx.publish(args.category)
  }, [ctx])
  return { triggerNudge }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/hooks/__tests__/useNotificationNudge.test.ts`
Expected: PASS — 8 cases.

> Note: the hook itself (the React-context part) doesn't have a unit test — it depends on a Provider that we build in the next task. Type-checking covers correctness there.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useNotificationNudge.ts src/hooks/__tests__/useNotificationNudge.test.ts
git commit -m "feat(notifications): useNotificationNudge — pure logic + React hook scaffold

shouldShowNudge() is the pure decision function: OS-blocked beats pref-off,
both gated by 7-day per-category dismissal window in localStorage.
recordDismissal() writes the timestamp. The hook itself reads from
NotificationNudgeContext (added in next task)."
```

---

## Task 14: Create `NotificationNudgeProvider` + context

**Files:**
- Create: `src/components/NotificationNudgeProvider.tsx`

- [ ] **Step 1: Create the provider**

Create `src/components/NotificationNudgeProvider.tsx`:

```typescript
'use client'
// src/components/NotificationNudgeProvider.tsx
//
// Mounted once in (app)/layout.tsx. Owns the active-nudge state and renders
// the <NotificationNudgeSheet> when needed. Hook subscribers (via
// useNotificationNudge) publish category candidates; this component runs
// shouldShowNudge() with the current OS perm + stored prefs and decides
// whether to actually show.

import { createContext, useCallback, useEffect, useState } from 'react'
import { NotificationNudgeSheet } from './NotificationNudgeSheet'
import { shouldShowNudge, recordDismissal, type NudgeCategory, type NudgeState } from '@/hooks/useNotificationNudge'
import { usePushNotifications } from '@/hooks/usePushNotifications'
import type { ChannelPrefs, NotificationCategory } from '@/lib/notification-categories'

interface NotificationNudgeContextValue {
  publish: (category: NudgeCategory) => void
}

export const NotificationNudgeContext = createContext<NotificationNudgeContextValue>({
  publish: () => { /* no-op default for SSR / unprovided contexts */ },
})

interface ActiveNudge {
  category: NudgeCategory
  state: NudgeState
}

export function NotificationNudgeProvider({ children }: { children: React.ReactNode }) {
  const { permission } = usePushNotifications()
  const [prefs, setPrefs] = useState<Record<NotificationCategory, ChannelPrefs> | null>(null)
  const [active, setActive] = useState<ActiveNudge | null>(null)

  // Load prefs once. Re-fetch when the active nudge is dismissed via "Turn on"
  // (which mutates the pref) by re-running this effect via the `active` dep.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
        if (!res.ok) return
        const body = await res.json() as { prefs: Record<NotificationCategory, ChannelPrefs> }
        if (!cancelled) setPrefs(body.prefs)
      } catch { /* silent — nudge will not fire until prefs load */ }
    })()
    return () => { cancelled = true }
  }, [])

  const publish = useCallback((category: NudgeCategory) => {
    if (!prefs) return // prefs haven't loaded yet — silently skip this nudge
    const categoryPushPref = prefs[category]?.push ?? true
    const verdict = shouldShowNudge(category, {
      osPermission: permission,
      categoryPushPref,
      now: Date.now(),
      storage: window.localStorage,
    })
    if (verdict) setActive({ category, state: verdict })
  }, [prefs, permission])

  const dismiss = useCallback(() => {
    if (active) recordDismissal(active.category, Date.now(), window.localStorage)
    setActive(null)
  }, [active])

  const turnOn = useCallback(async () => {
    if (!active || active.state !== 'pref-off') {
      setActive(null)
      return
    }
    // PATCH the in-app pref to push:true, then dismiss
    try {
      await fetch('/api/user/notification-prefs', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category: active.category, push: true }),
      })
      // Refetch prefs so other consumers see the update
      const res = await fetch('/api/user/notification-prefs', { cache: 'no-store' })
      if (res.ok) {
        const body = await res.json() as { prefs: Record<NotificationCategory, ChannelPrefs> }
        setPrefs(body.prefs)
      }
    } catch { /* silent — sheet still dismisses */ }
    recordDismissal(active.category, Date.now(), window.localStorage)
    setActive(null)
  }, [active])

  return (
    <NotificationNudgeContext.Provider value={{ publish }}>
      {children}
      {active && (
        <NotificationNudgeSheet
          state={active.state}
          category={active.category}
          onDismiss={dismiss}
          onTurnOn={turnOn}
        />
      )}
    </NotificationNudgeContext.Provider>
  )
}
```

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: FAIL — `NotificationNudgeSheet` doesn't exist yet. We'll create it next.

- [ ] **Step 3: Commit**

```bash
git add src/components/NotificationNudgeProvider.tsx
git commit -m "feat(notifications): NotificationNudgeProvider — context owner

Loads prefs once on mount, exposes publish() via context. Calls shouldShowNudge
with current OS perm + stored pref; renders NotificationNudgeSheet if verdict
is non-null. turnOn() patches the pref via /api/user/notification-prefs and
refetches before dismissing. recordDismissal() writes the 7-day key."
```

---

## Task 15: Create `NotificationNudgeSheet`

**Files:**
- Create: `src/components/NotificationNudgeSheet.tsx`

- [ ] **Step 1: Create the sheet**

Create `src/components/NotificationNudgeSheet.tsx`:

```typescript
'use client'
// src/components/NotificationNudgeSheet.tsx
//
// Bottom sheet shown by NotificationNudgeProvider when a bookmark/follow
// happens and notifications can't reach the user. Two states:
//
//   os-blocked — OS perm denied, can't fix from inside app. CTA deep-links
//                to system settings via openSystemNotificationSettings().
//                Icon: red shield-alert. CTA color: live red.
//
//   pref-off   — OS perm OK but the in-app push pref is off. CTA flips the
//                pref via the provider's turnOn handler. Icon: green bell.
//                CTA color: primary green.

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { openSystemNotificationSettings } from '@/lib/native-settings'
import type { NudgeCategory, NudgeState } from '@/hooks/useNotificationNudge'

interface NotificationNudgeSheetProps {
  state: NudgeState
  category: NudgeCategory
  onDismiss: () => void
  onTurnOn: () => void
}

export function NotificationNudgeSheet({ state, category, onDismiss, onTurnOn }: NotificationNudgeSheetProps) {
  const t = useTranslations('notifications.settings.nudge')

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDismiss])

  const isOsBlocked = state === 'os-blocked'
  const subjectKey = category === 'match_live_follow' ? 'player' : 'match'

  const title = isOsBlocked
    ? t('osBlocked.title')
    : t(`${subjectKey}.title`)
  const body = isOsBlocked
    ? t('osBlocked.body')
    : t(`${subjectKey}.body`)
  const ctaLabel = isOsBlocked
    ? t('osBlocked.cta')
    : t(`${subjectKey}.cta`)
  const ctaColor = isOsBlocked ? '#FF4655' : '#7ED321'
  const ctaTextColor = isOsBlocked ? '#fff' : '#0a0a0a'
  const iconBg = isOsBlocked ? 'rgba(245,70,85,0.10)' : 'rgba(126,211,33,0.10)'
  const iconBorder = isOsBlocked ? 'rgba(245,70,85,0.30)' : 'rgba(126,211,33,0.30)'
  const iconColor = isOsBlocked ? '#ff7884' : '#7ED321'

  const handleCta = () => {
    if (isOsBlocked) {
      openSystemNotificationSettings()
      onDismiss()
    } else {
      onTurnOn()
    }
  }

  return (
    <>
      <div
        onClick={onDismiss}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: '#1A1A1A', borderTop: '1px solid rgba(255,255,255,0.10)',
          padding: '16px 16px 24px', zIndex: 201,
        }}
      >
        <div style={{ width: 36, height: 4, background: 'rgba(255,255,255,0.20)', borderRadius: 999, margin: '0 auto 14px' }} />
        <div style={{
          width: 44, height: 44,
          background: iconBg, border: `1px solid ${iconBorder}`,
          color: iconColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          margin: '0 auto 12px',
          clipPath: 'polygon(0% 5%, 100% 0%, 100% 95%, 0% 100%)',
        }}>
          {isOsBlocked ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          )}
        </div>
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: '0 0 8px', textAlign: 'center', color: '#fff' }}>{title}</h2>
        <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, textAlign: 'center', marginBottom: 18, padding: '0 8px' }}>{body}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            type="button"
            onClick={onDismiss}
            style={{
              flex: 1, padding: '10px 14px',
              background: 'transparent', color: 'rgba(255,255,255,0.75)',
              border: '1.5px solid rgba(255,255,255,0.22)',
              fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
              clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
              cursor: 'pointer',
            }}
          >
            {t('dismiss')}
          </button>
          <button
            type="button"
            onClick={handleCta}
            style={{
              flex: 1, padding: '10px 14px',
              background: ctaColor, color: ctaTextColor, border: 0,
              fontSize: 11, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.4,
              clipPath: 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)',
              cursor: 'pointer',
            }}
          >
            {ctaLabel}
          </button>
        </div>
      </div>
    </>
  )
}
```

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: FAIL — `openSystemNotificationSettings` from `@/lib/native-settings` doesn't exist yet (Task 21).

For now, **inline a placeholder** at the top of this file under the imports:

```typescript
// Placeholder until Task 21 wires the real Capacitor plugin
function openSystemNotificationSettings() { console.warn('[nudge] openSystemNotificationSettings called — placeholder') }
```

And remove the `import { openSystemNotificationSettings } from '@/lib/native-settings'` line for now.

- [ ] **Step 3: Re-run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/NotificationNudgeSheet.tsx
git commit -m "feat(notifications): NotificationNudgeSheet — bottom sheet for two states

os-blocked: red shield icon, 'Open settings' live-red CTA that deep-links.
pref-off: green bell icon, 'Turn on' primary CTA that flips the in-app pref.
Backdrop click and Escape both dismiss. openSystemNotificationSettings is
a placeholder until Task 21."
```

---

## Task 16: Mount `<NotificationNudgeProvider>` in the (app) layout

**Files:**
- Modify: `src/app/[locale]/(app)/layout.tsx`

- [ ] **Step 1: Read the current layout**

Run: `cat src/app/[locale]/(app)/layout.tsx`

- [ ] **Step 2: Wrap children with the provider**

Find the JSX that wraps `{children}` (likely inside `<NextIntlClientProvider>` or similar). Add `NotificationNudgeProvider` as the innermost wrapper:

```typescript
// Add import at the top:
import { NotificationNudgeProvider } from '@/components/NotificationNudgeProvider'

// Inside the JSX, find {children} and wrap it:
<NotificationNudgeProvider>
  {children}
</NotificationNudgeProvider>
```

The provider needs to be inside whatever auth context provider exists (since it calls `/api/user/notification-prefs` which needs auth), but should be outside specific page components.

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/(app)/layout.tsx
git commit -m "feat(notifications): mount NotificationNudgeProvider in (app) layout

Single instance for all auth'd routes. Provider fetches prefs on mount;
publish() from useNotificationNudge() in any descendant calls into it."
```

---

## Task 17: Wire `triggerNudge` into MatchCard bookmark click and FollowButton

**Files:**
- Modify: `src/components/MatchCard.tsx`
- Modify: `src/components/FollowButton.tsx`

- [ ] **Step 1: Find the bookmark click handler in MatchCard**

Run: `grep -n "bookmark\|bookmarkType.*match" src/components/MatchCard.tsx | head -20`

- [ ] **Step 2: Add triggerNudge call after successful bookmark in MatchCard**

In `src/components/MatchCard.tsx`:

Add the import:
```typescript
import { useNotificationNudge } from '@/hooks/useNotificationNudge'
```

Inside the component function, near the top with other hook calls:
```typescript
const { triggerNudge } = useNotificationNudge()
```

Find the bookmark click handler. After the call that successfully creates the bookmark (the POST/INSERT into user_bookmarks), add:

```typescript
// Nudge the user to enable notifications if their state can't reach them.
// Fire-and-forget; provider decides whether to actually show.
triggerNudge({ category: 'match_live_bookmark' })
```

> Note: only call this when the bookmark is being CREATED (not removed). If the handler toggles bookmark on/off, gate the call on the new state being "bookmarked".

- [ ] **Step 3: Do the same for FollowButton**

In `src/components/FollowButton.tsx`:

Add the import and hook call (same pattern as MatchCard). After the successful follow creation, add:

```typescript
triggerNudge({ category: 'match_live_follow' })
```

- [ ] **Step 4: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/MatchCard.tsx src/components/FollowButton.tsx
git commit -m "feat(notifications): wire triggerNudge into MatchCard + FollowButton

After a bookmark or follow succeeds, call triggerNudge() with the relevant
category. Provider decides whether to actually show (skips if everything's
configured OR dismissed in last 7 days). Fire-and-forget — bookmark/follow
itself is never blocked."
```

---

## Task 18: Add gear icon to `/notifications` page sub-header

**Files:**
- Modify: `src/app/[locale]/(app)/notifications/page.tsx`

- [ ] **Step 1: Read the current sub-header**

Run: `grep -n "Mark.*read\|sub-header\|router\." src/app/[locale]/(app)/notifications/page.tsx | head -10`

- [ ] **Step 2: Add gear button**

Find the sub-header section in the page. It likely has back button + title + "Mark all read" button. Add a gear icon button between the title and Mark-all-read (or to the right of Mark-all-read — whichever fits layout).

```typescript
// Add the gear button — wire to navigate to settings
<button
  type="button"
  onClick={() => router.push('/profile/settings/notifications')}
  aria-label="Notification settings"
  style={{
    background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.65)',
    cursor: 'pointer', padding: 6,
  }}
>
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
</button>
```

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/(app)/notifications/page.tsx
git commit -m "feat(notifications): gear icon in /notifications sub-header

Navigates to /profile/settings/notifications. Right side of the sub-header
alongside the back button + title."
```

---

## Task 19: Drop "Badges" filter pill on `/notifications`

**Files:**
- Modify: `src/app/[locale]/(app)/notifications/page.tsx`

- [ ] **Step 1: Find the filter pills**

Run: `grep -n "badges\|filter.*pill\|'matches'\|'all'" src/app/[locale]/(app)/notifications/page.tsx | head -10`

- [ ] **Step 2: Remove the badges pill and add updates pill**

In the filter-pill render, the array of filters likely looks like `['all', 'matches', 'badges']`. Replace it with `['all', 'matches', 'updates']`. Update the i18n keys accordingly (the new "updates" pill text comes from Task 20).

If the type for the filter state is a union like `'all' | 'matches' | 'badges'`, update it to `'all' | 'matches' | 'updates'`.

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS — `categoryFilter()` (updated in Task 1) accepts the new value.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/(app)/notifications/page.tsx
git commit -m "feat(notifications): /notifications filter — Badges → Updates pill

With badge_earned + streak_milestone removed, the Badges pill returned
empty. Replaced with Updates pill matching the new Settings group
(ranking_updated + marketing)."
```

---

## Task 20: Add + remove i18n keys across all 5 locales

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Open en.json and update the `notifications.settings` block**

Open `src/messages/en.json`. Find the `notifications.settings` object (around line 898). REPLACE it (keep the existing `errors` sub-object from PR #459) with this block:

```json
"settings": {
  "title": "Notifications",
  "blocked": {
    "title": "Notifications blocked",
    "body": "Open device settings to allow",
    "cta": "Open"
  },
  "masterLabel": "Push notifications",
  "groupMatches": "Matches",
  "groupUpdates": "Updates",
  "saveHint": "Changes save automatically",
  "saveError": "Couldn't save — please try again",
  "mute": {
    "label": "Mute notifications",
    "sub": "Temporarily disable all push",
    "cta": "Mute…",
    "activeUntil": "Muted · {time}",
    "activeForever": "Muted",
    "durations": {
      "1h": "1 hour",
      "4h": "4 hours",
      "tomorrow": "Until tomorrow 8 AM",
      "forever": "Until I turn it back on"
    }
  },
  "sounds": {
    "label": "Notification sounds",
    "sub": "Manage in device settings"
  },
  "category": {
    "match_live_follow": {
      "label": "Followed player goes live",
      "sub": "A player you follow is about to play"
    },
    "match_live_bookmark": {
      "label": "Bookmarked match goes live",
      "sub": "A match you saved is starting"
    },
    "match_finished": {
      "label": "Match finished",
      "sub": "Results for matches you follow"
    },
    "ranking_updated": {
      "label": "Rankings updated",
      "sub": "Weekly FIP rankings refresh"
    },
    "marketing": {
      "label": "Product updates",
      "sub": "New features, events, occasional news"
    }
  },
  "nudge": {
    "match": {
      "title": "Get notified when this match starts",
      "body": "Push notifications for bookmarked matches are turned off. Enable to get a banner when this one goes live.",
      "cta": "Turn on"
    },
    "player": {
      "title": "Get notified when this player plays",
      "body": "Push notifications for followed players are turned off. Enable to get a banner when they're on court.",
      "cta": "Turn on"
    },
    "osBlocked": {
      "title": "Notifications are off on this device",
      "body": "Match alerts won't reach you until you enable notifications for PadelNachos in device settings.",
      "cta": "Open settings"
    },
    "dismiss": "Not now"
  },
  "errors": { … keep existing block from PR #459 unchanged … }
}
```

> Note: the `category.match_upcoming`, `category.badge_earned`, `category.streak_milestone`, `columnPush`, `columnInApp`, `permissionDeniedTitle`, `permissionDeniedBody`, and `groupOther` keys are now orphan — delete them. Keep the `errors` sub-block intact.

- [ ] **Step 2: Update the `/notifications` page filter labels**

Find the `notifications.filters` (or similar) block in en.json — there's a label for the "Badges" pill. Find it and replace with "Updates". If the key is `filters.badges`, change the value to "Updates" and rename to `filters.updates`. Update wherever the page reads this label too (Task 19 already handled the pill array; this is just the i18n value).

- [ ] **Step 3: Mirror the change in es.json**

Open `src/messages/es.json` and apply the same structure with Spanish strings:

```json
"settings": {
  "title": "Notificaciones",
  "blocked": {
    "title": "Notificaciones bloqueadas",
    "body": "Abre los ajustes del dispositivo para permitirlas",
    "cta": "Abrir"
  },
  "masterLabel": "Notificaciones push",
  "groupMatches": "Partidos",
  "groupUpdates": "Actualizaciones",
  "saveHint": "Los cambios se guardan automáticamente",
  "saveError": "No se pudo guardar — inténtalo de nuevo",
  "mute": {
    "label": "Silenciar notificaciones",
    "sub": "Desactivar temporalmente todas las push",
    "cta": "Silenciar…",
    "activeUntil": "Silenciado · {time}",
    "activeForever": "Silenciado",
    "durations": {
      "1h": "1 hora",
      "4h": "4 horas",
      "tomorrow": "Hasta mañana a las 8:00",
      "forever": "Hasta que lo reactive"
    }
  },
  "sounds": {
    "label": "Sonidos de notificación",
    "sub": "Administrar en los ajustes del dispositivo"
  },
  "category": {
    "match_live_follow": {
      "label": "Jugador seguido en directo",
      "sub": "Un jugador que sigues está a punto de jugar"
    },
    "match_live_bookmark": {
      "label": "Partido guardado en directo",
      "sub": "Un partido que guardaste está empezando"
    },
    "match_finished": {
      "label": "Partido terminado",
      "sub": "Resultados de partidos que sigues"
    },
    "ranking_updated": {
      "label": "Rankings actualizados",
      "sub": "Actualización semanal del ranking FIP"
    },
    "marketing": {
      "label": "Novedades del producto",
      "sub": "Nuevas funciones, eventos y noticias ocasionales"
    }
  },
  "nudge": {
    "match": {
      "title": "Recibe notificación cuando empiece este partido",
      "body": "Las notificaciones push para partidos guardados están desactivadas. Actívalas para recibir un aviso cuando empiece.",
      "cta": "Activar"
    },
    "player": {
      "title": "Recibe notificación cuando juegue este jugador",
      "body": "Las notificaciones push para jugadores seguidos están desactivadas. Actívalas para recibir un aviso cuando esté en la pista.",
      "cta": "Activar"
    },
    "osBlocked": {
      "title": "Las notificaciones están desactivadas en este dispositivo",
      "body": "No te llegarán avisos de partidos hasta que actives las notificaciones para PadelNachos en los ajustes del dispositivo.",
      "cta": "Abrir ajustes"
    },
    "dismiss": "Ahora no"
  },
  "errors": { … keep existing Spanish errors block from PR #459 unchanged … }
}
```

- [ ] **Step 4: Mirror in pt.json**

```json
"settings": {
  "title": "Notificações",
  "blocked": {
    "title": "Notificações bloqueadas",
    "body": "Abre as definições do dispositivo para permitir",
    "cta": "Abrir"
  },
  "masterLabel": "Notificações push",
  "groupMatches": "Jogos",
  "groupUpdates": "Atualizações",
  "saveHint": "As alterações são guardadas automaticamente",
  "saveError": "Não foi possível guardar — tenta novamente",
  "mute": {
    "label": "Silenciar notificações",
    "sub": "Desativar temporariamente todas as push",
    "cta": "Silenciar…",
    "activeUntil": "Silenciado · {time}",
    "activeForever": "Silenciado",
    "durations": {
      "1h": "1 hora",
      "4h": "4 horas",
      "tomorrow": "Até amanhã às 8:00",
      "forever": "Até reativar"
    }
  },
  "sounds": {
    "label": "Sons de notificação",
    "sub": "Gerir nas definições do dispositivo"
  },
  "category": {
    "match_live_follow": {
      "label": "Jogador seguido em direto",
      "sub": "Um jogador que segues está prestes a jogar"
    },
    "match_live_bookmark": {
      "label": "Jogo guardado em direto",
      "sub": "Um jogo que guardaste está a começar"
    },
    "match_finished": {
      "label": "Jogo terminado",
      "sub": "Resultados de jogos que segues"
    },
    "ranking_updated": {
      "label": "Rankings atualizados",
      "sub": "Atualização semanal do ranking FIP"
    },
    "marketing": {
      "label": "Novidades do produto",
      "sub": "Novas funções, eventos e notícias ocasionais"
    }
  },
  "nudge": {
    "match": {
      "title": "Recebe notificação quando começar este jogo",
      "body": "As notificações push para jogos guardados estão desativadas. Ativa para receberes um aviso quando começar.",
      "cta": "Ativar"
    },
    "player": {
      "title": "Recebe notificação quando jogar este jogador",
      "body": "As notificações push para jogadores seguidos estão desativadas. Ativa para receberes um aviso quando estiver em campo.",
      "cta": "Ativar"
    },
    "osBlocked": {
      "title": "As notificações estão desativadas neste dispositivo",
      "body": "Não vais receber avisos de jogos até ativares as notificações para PadelNachos nas definições do dispositivo.",
      "cta": "Abrir definições"
    },
    "dismiss": "Agora não"
  },
  "errors": { … keep existing Portuguese errors block unchanged … }
}
```

- [ ] **Step 5: Mirror in it.json**

```json
"settings": {
  "title": "Notifiche",
  "blocked": {
    "title": "Notifiche bloccate",
    "body": "Apri le impostazioni del dispositivo per consentirle",
    "cta": "Apri"
  },
  "masterLabel": "Notifiche push",
  "groupMatches": "Partite",
  "groupUpdates": "Aggiornamenti",
  "saveHint": "Le modifiche vengono salvate automaticamente",
  "saveError": "Impossibile salvare — riprova",
  "mute": {
    "label": "Silenzia notifiche",
    "sub": "Disabilita temporaneamente tutte le push",
    "cta": "Silenzia…",
    "activeUntil": "Silenziato · {time}",
    "activeForever": "Silenziato",
    "durations": {
      "1h": "1 ora",
      "4h": "4 ore",
      "tomorrow": "Fino a domani alle 8:00",
      "forever": "Finché non riattivo"
    }
  },
  "sounds": {
    "label": "Suoni notifica",
    "sub": "Gestisci nelle impostazioni del dispositivo"
  },
  "category": {
    "match_live_follow": {
      "label": "Giocatore seguito in diretta",
      "sub": "Un giocatore che segui sta per giocare"
    },
    "match_live_bookmark": {
      "label": "Partita salvata in diretta",
      "sub": "Una partita salvata sta iniziando"
    },
    "match_finished": {
      "label": "Partita terminata",
      "sub": "Risultati di partite che segui"
    },
    "ranking_updated": {
      "label": "Ranking aggiornato",
      "sub": "Aggiornamento settimanale del ranking FIP"
    },
    "marketing": {
      "label": "Novità del prodotto",
      "sub": "Nuove funzioni, eventi e notizie occasionali"
    }
  },
  "nudge": {
    "match": {
      "title": "Ricevi una notifica quando inizia questa partita",
      "body": "Le notifiche push per partite salvate sono disattivate. Attiva per ricevere un avviso quando inizia.",
      "cta": "Attiva"
    },
    "player": {
      "title": "Ricevi una notifica quando gioca questo giocatore",
      "body": "Le notifiche push per giocatori seguiti sono disattivate. Attiva per ricevere un avviso quando è in campo.",
      "cta": "Attiva"
    },
    "osBlocked": {
      "title": "Le notifiche sono disattivate su questo dispositivo",
      "body": "Gli avvisi delle partite non arriveranno finché non attiverai le notifiche per PadelNachos nelle impostazioni del dispositivo.",
      "cta": "Apri impostazioni"
    },
    "dismiss": "Non ora"
  },
  "errors": { … keep existing Italian errors block unchanged … }
}
```

- [ ] **Step 6: Mirror in fr.json**

```json
"settings": {
  "title": "Notifications",
  "blocked": {
    "title": "Notifications bloquées",
    "body": "Ouvrir les paramètres de l'appareil pour autoriser",
    "cta": "Ouvrir"
  },
  "masterLabel": "Notifications push",
  "groupMatches": "Matchs",
  "groupUpdates": "Actualités",
  "saveHint": "Les modifications sont enregistrées automatiquement",
  "saveError": "Enregistrement impossible — réessayez",
  "mute": {
    "label": "Couper les notifications",
    "sub": "Désactiver temporairement toutes les push",
    "cta": "Couper…",
    "activeUntil": "Coupé · {time}",
    "activeForever": "Coupé",
    "durations": {
      "1h": "1 heure",
      "4h": "4 heures",
      "tomorrow": "Jusqu'à demain 8h",
      "forever": "Jusqu'à ce que je réactive"
    }
  },
  "sounds": {
    "label": "Sons de notification",
    "sub": "Gérer dans les paramètres de l'appareil"
  },
  "category": {
    "match_live_follow": {
      "label": "Joueur suivi en direct",
      "sub": "Un joueur que vous suivez est sur le point de jouer"
    },
    "match_live_bookmark": {
      "label": "Match enregistré en direct",
      "sub": "Un match enregistré commence"
    },
    "match_finished": {
      "label": "Match terminé",
      "sub": "Résultats des matchs que vous suivez"
    },
    "ranking_updated": {
      "label": "Classements mis à jour",
      "sub": "Mise à jour hebdomadaire du classement FIP"
    },
    "marketing": {
      "label": "Nouveautés produit",
      "sub": "Nouvelles fonctionnalités, événements, actualités"
    }
  },
  "nudge": {
    "match": {
      "title": "Soyez notifié quand ce match commence",
      "body": "Les notifications push pour les matchs enregistrés sont désactivées. Activez-les pour recevoir une alerte au démarrage.",
      "cta": "Activer"
    },
    "player": {
      "title": "Soyez notifié quand ce joueur joue",
      "body": "Les notifications push pour les joueurs suivis sont désactivées. Activez-les pour recevoir une alerte quand il joue.",
      "cta": "Activer"
    },
    "osBlocked": {
      "title": "Les notifications sont désactivées sur cet appareil",
      "body": "Les alertes de matchs ne vous parviendront pas tant que vous n'aurez pas activé les notifications pour PadelNachos dans les paramètres de l'appareil.",
      "cta": "Ouvrir les paramètres"
    },
    "dismiss": "Plus tard"
  },
  "errors": { … keep existing French errors block unchanged … }
}
```

- [ ] **Step 7: Verify all 5 files parse**

Run: `for f in en es pt it fr; do node -e "JSON.parse(require('fs').readFileSync('src/messages/$f.json','utf8'))" && echo "$f OK" || echo "$f BROKEN"; done`
Expected: 5 "OK" lines.

- [ ] **Step 8: Verify the new keys are present**

Run:
```bash
for f in en es pt it fr; do
  node -e "
  const m = require('./src/messages/$f.json');
  const s = m?.notifications?.settings;
  const keys = ['blocked.title','mute.label','sounds.label','category.ranking_updated.label','nudge.match.title','nudge.osBlocked.cta','saveHint'];
  for (const k of keys) {
    const parts = k.split('.');
    let v = s;
    for (const p of parts) v = v?.[p];
    if (!v) { console.error('$f missing', k); process.exit(1); }
  }
  console.log('$f all keys present');
"
done
```
Expected: 5 "all keys present" lines.

- [ ] **Step 9: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n(notifications): redesign keys for all 5 locales

Adds: blocked.*, mute.*, sounds.*, nudge.*, ranking_updated.*, groupUpdates,
saveHint. Drops: match_upcoming.*, badge_earned.*, streak_milestone.*,
columnPush, columnInApp, permissionDeniedTitle/Body, groupOther."
```

---

## Task 21: Install `@capacitor-community/native-settings` and create `native-settings.ts` wrapper

**Files:**
- Modify: `package.json`
- Create: `src/lib/native-settings.ts`

- [ ] **Step 1: Install the plugin**

Run: `npm install @capacitor-community/native-settings`
Expected: package added to dependencies. Lockfile updated.

- [ ] **Step 2: Create the wrapper**

Create `src/lib/native-settings.ts`:

```typescript
// src/lib/native-settings.ts
//
// Opens the OS notification-settings page for PadelNachos. Used by:
//   - settings page's permission-blocked banner CTA
//   - settings page's "Notification sounds" deep-link row
//   - bookmark nudge's os-blocked state CTA
//
// Native (Android/iOS via Capacitor): jumps directly to the app's
// notification settings — one tap to the right screen.
//
// Web fallback: there's no cross-browser deep-link to OS-level
// notification settings. We show an instructional toast via window.alert
// (or whichever toast lib the caller uses — we keep this lib pure and
// return a Promise so callers can chain.

import { Capacitor } from '@capacitor/core'

export async function openSystemNotificationSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) {
    // Web fallback — caller should ideally show a toast, but at minimum we
    // print an instruction. Most browsers expose this via the URL bar
    // padlock icon — there's no programmatic deep-link.
    console.info('[native-settings] web platform — no deep-link available; user must use browser site settings')
    return
  }

  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('@capacitor-community/native-settings')
    await NativeSettings.open({
      optionAndroid: AndroidSettings.AppNotification,
      optionIOS: IOSSettings.App,
    })
  } catch (err) {
    console.warn('[native-settings] open failed', err)
  }
}
```

- [ ] **Step 3: Replace the placeholder in Settings page**

Open `src/app/[locale]/(app)/profile/settings/notifications/page.tsx`:

Remove the placeholder function (added in Task 6):
```typescript
// DELETE THIS:
function openSystemNotificationSettings() { console.warn('[settings] openSystemNotificationSettings called — placeholder') }
```

Add the import:
```typescript
import { openSystemNotificationSettings } from '@/lib/native-settings'
```

- [ ] **Step 4: Replace the placeholder in NudgeSheet**

Open `src/components/NotificationNudgeSheet.tsx`:

Remove the placeholder function (added in Task 15):
```typescript
// DELETE THIS:
function openSystemNotificationSettings() { console.warn('[nudge] openSystemNotificationSettings called — placeholder') }
```

Add the import:
```typescript
import { openSystemNotificationSettings } from '@/lib/native-settings'
```

- [ ] **Step 5: Run `cap sync android` to wire the native plugin**

Run: `npx cap sync android`
Expected: Output shows `@capacitor-community/native-settings` added to Android Gradle project. Files updated: `android/capacitor.settings.gradle`, `android/app/capacitor.build.gradle`.

- [ ] **Step 6: Verify the gradle file includes the plugin**

Run: `grep -A1 "capacitor-community-native-settings\|native-settings" android/capacitor.settings.gradle`
Expected: shows `include ':capacitor-community-native-settings'` and a `project(...)` line pointing into node_modules.

- [ ] **Step 7: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/native-settings.ts src/app/[locale]/\(app\)/profile/settings/notifications/page.tsx src/components/NotificationNudgeSheet.tsx android/capacitor.settings.gradle android/app/capacitor.build.gradle
git commit -m "feat(native): @capacitor-community/native-settings for OS deep-link

Adds native-settings.ts wrapper. Replaces the placeholder shims used
during web-only development. Settings page banner CTA, sounds row, and
nudge os-blocked CTA all now route through openSystemNotificationSettings.

Requires AAB rebuild for native side to take effect (Task 22)."
```

---

## Task 22: Bump Android versionCode and prepare AAB

**Files:**
- Modify: `android/app/build.gradle`

- [ ] **Step 1: Read current version**

Run: `grep -E "versionCode|versionName" android/app/build.gradle`
Expected output:
```
versionCode 4
versionName "1.0.3"
```

- [ ] **Step 2: Bump to next version**

Open `android/app/build.gradle`. Find:
```gradle
versionCode 4
versionName "1.0.3"
```

Replace with:
```gradle
versionCode 5
versionName "1.0.4"
```

- [ ] **Step 3: Commit the version bump (without building)**

```bash
git add android/app/build.gradle
git commit -m "build(android): bump to 1.0.4 (versionCode 5) for native-settings release

Required to ship the @capacitor-community/native-settings plugin to
Play Store users. Without this AAB rebuild, the openSystemNotificationSettings
call would throw 'plugin not implemented on android' on installed devices."
```

- [ ] **Step 4: Manual AAB build (after PR merge)**

> Note: this step happens AFTER the PR is merged and reviewed. The plan flags it here so the engineer doesn't forget.
>
> When ready to release:
>
> ```bash
> cd android
> ./gradlew bundleRelease
> # AAB lands at: android/app/build/outputs/bundle/release/app-release.aab
> # Upload to Play Console → Internal Testing track
> # After verification, promote to Production
> ```
>
> Without this step, web users (Vercel deploy) get the redesign UI but
> Android users on the old AAB still hit the "FirebaseMessaging plugin is
> not implemented on android" fallback path from PR #460. The redesign
> works for them; the native-settings deep-link button just falls back
> silently (logs warning, no UI feedback).

---

## Task 23: Run full test suite

**Files:** none

- [ ] **Step 1: Run all unit tests**

Run: `npx vitest run`
Expected: All tests pass, including the new `notification-categories.test.ts` and `useNotificationNudge.test.ts`.

If any failures unrelated to this plan show up, leave them — they're pre-existing.

- [ ] **Step 2: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS, no errors.

- [ ] **Step 3: Run lint**

Run: `npm run lint`
Expected: zero new errors in changed files. (Pre-existing project-wide errors are OK — there are ~1800 from before this plan.)

To filter for only this plan's files:
```bash
npm run lint 2>&1 | grep -E "(IconSlider|NotificationNudge|SaveStateSlot|notification-categories|native-settings|MuteDuration|useNotificationNudge|profile/settings/notifications)"
```
Expected: empty output (no errors in these files).

- [ ] **Step 4: Commit nothing — checkpoint**

If any failure surfaces, fix before continuing.

---

## Task 24: Manual smoke test in dev browser

**Files:** none

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Test the Settings page full flow**

In Chrome, navigate to `http://localhost:3002/en/profile/settings/notifications`. Verify:

- [ ] All 5 category rows render (3 in Matches, 2 in Updates)
- [ ] No "badge_earned", "streak_milestone", or "match_upcoming" rows present
- [ ] Each toggle has an IconSlider + an empty SaveStateSlot
- [ ] Tap any category toggle: optimistic flip → spinner → check → idle (within ~3 seconds total)
- [ ] Mute button opens the duration sheet; pick a duration → button goes gold with "Muted · <time>"
- [ ] Master toggle disabled when OS permission is denied (test by denying browser notifications first)
- [ ] All rows dim (opacity 0.45) when master toggle is off

- [ ] **Step 3: Test the `/notifications` feed page**

Navigate to `http://localhost:3002/en/notifications`. Verify:
- [ ] Gear icon in sub-header → tapping navigates to /profile/settings/notifications
- [ ] Filter pills are: All, Matches, Updates (no "Badges")
- [ ] Tap "Updates" pill: empty state shows (no rows match — only marketing pushes would land here, and marketing isn't fired yet)

- [ ] **Step 4: Test the bookmark nudge — pref-off state**

1. On the Settings page, turn OFF "Bookmarked match goes live" toggle
2. Navigate to any match: `http://localhost:3002/en/match/<some-match-id>`
3. Tap the bookmark button
4. Expected: bottom sheet slides up with green bell icon, title "Get notified when this match starts", green "Turn on" button
5. Tap "Turn on" → sheet dismisses, navigate to Settings → verify the toggle flipped back ON

- [ ] **Step 5: Test the bookmark nudge — dismissal tracking**

1. Set `match_live_bookmark.push = false` again
2. Bookmark a match → nudge appears
3. Tap "Not now"
4. Bookmark a DIFFERENT match → nudge should NOT appear (7-day suppression active)
5. In Chrome DevTools, set `localStorage.removeItem('pn:nudge-dismissed:match_live_bookmark')`
6. Bookmark another match → nudge appears again

- [ ] **Step 6: Test the OS-blocked nudge**

1. In Chrome → Site Settings → set Notifications to "Block" for localhost
2. Reload the app
3. Bookmark a match
4. Expected: bottom sheet slides up with RED shield icon, title "Notifications are off on this device", red "Open settings" button
5. Tap "Open settings" → on web, the placeholder logs a warning to console (real deep-link only works on native AAB after Task 22)

- [ ] **Step 7: Stop the dev server**

Press Ctrl+C.

- [ ] **Step 8: Commit nothing — checkpoint**

If any smoke check fails, fix before continuing.

---

## Task 25: Push branch and open PR

**Files:** none

- [ ] **Step 1: Verify branch name**

Run: `git branch --show-current`
Expected: `claude/notifications-redesign-spec` (the branch the spec was committed to) — extend with code.

If you started a new branch for the implementation, that's fine too.

- [ ] **Step 2: Push the branch**

Run: `git push -u origin $(git branch --show-current)`
Expected: branch pushed; remote-tracking set.

- [ ] **Step 3: Create the PR**

```bash
gh pr create --title "feat(notifications): UX redesign — icon-slider toggles, bookmark nudge, ranking_updated" --body "$(cat <<'EOF'
## Summary

Ships the notifications redesign per [2026-05-27 spec](docs/superpowers/specs/2026-05-27-notifications-redesign-design.md).

## What changes
- New `<IconSlider>` toggle (chunky-tilted, check/X icon in thumb)
- Settings page rewritten: new layout, save-feedback per row, mute action with duration sheet, notification sounds deep-link, system-blocked banner
- Categories pruned: drop `match_upcoming`, `badge_earned`, `streak_milestone`; add `ranking_updated`
- `ChannelPrefs` simplified to `{ push }` only — in-app delivery is always-on
- Marketing default flipped to `push: true` (opt-out, per 2026-05-27 decision)
- Bookmark nudge: bottom sheet after bookmark/follow when OS perm denied OR pref off, with 7-day per-category dismissal
- `/notifications` feed: gear icon to settings, "Badges" filter → "Updates"
- `@capacitor-community/native-settings` installed for OS deep-link (AAB bump from 1.0.3 → 1.0.4)

## Phase 3 NOT in this PR
Rankings notification fan-out (worker + endpoint) ships separately. The pref toggle ships here so users can opt out before any sends happen.

## Test plan
- [x] `npx vitest run` — new unit tests pass (notification-categories, useNotificationNudge)
- [x] `npx tsc --noEmit` — type-check clean
- [x] `npm run lint` — no new errors in changed files
- [x] Manual smoke (Settings page render, toggle save flow, mute sheet, bookmark nudge in both states, dismissal tracking, gear icon nav)
- [ ] Vercel preview deploy
- [ ] Android AAB build + Internal Testing rollout (post-merge)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Verify CI checks**

Wait for Vercel deploys to green (~2-4 min). If anything fails, fix on the same branch and push again.

---

## Task 26: Plan Android release (post-PR-merge)

**Files:** none — release runbook

- [ ] **Step 1: After PR merges, build the AAB**

```bash
cd android
./gradlew bundleRelease
```

AAB output: `android/app/build/outputs/bundle/release/app-release.aab`

- [ ] **Step 2: Upload to Play Console**

1. Open https://play.google.com/console/
2. PadelNachos app → Production / Internal Testing → Create new release
3. Upload `app-release.aab`
4. Release notes (suggested):
   ```
   - Redesigned notification settings with a new modern toggle
   - "Rankings updated" notification category (rolls out separately)
   - Smart notification reminders when you bookmark a match
   ```
5. Save → Review → Roll out to Internal Testing first

- [ ] **Step 3: Smoke-test the Internal Testing build**

1. Install on a test device
2. Open Settings → Notifications: confirm the redesigned page renders
3. Tap "Open" on the blocked banner → confirm it deep-links into Android Settings → PadelNachos → Notifications
4. Tap "Notification sounds" → same deep-link
5. Bookmark a match while OS notifications are denied: confirm the red shield-icon sheet shows + "Open settings" deep-links

- [ ] **Step 4: Promote to Production**

After internal testing passes, promote the release to Production track in Play Console.

---

## Task 27: Close out

**Files:** none

- [ ] **Step 1: Confirm Phase 3 follow-up is captured**

The rankings notification fan-out (Phase 3 in the spec) is OUT of scope for this PR. Make sure it's in a tracking issue or roadmap:

```bash
gh issue create --title "Phase 3: Rankings notification fan-out" --body "Per [notifications-redesign spec section 9 + 11](docs/superpowers/specs/2026-05-27-notifications-redesign-design.md), the ranking_updated category is now exposed in the Settings page but no sends are wired yet.

Scope:
- New padelgod worker post-snapshot in player-rankings (top 3 movers for followed players)
- New endpoint /api/push/notify-ranking
- Frequency cap: max 1 push per user per ISO week (check user_notifications for category=ranking_updated && created_at >= week_start)
- E2E test on a small cohort before opening to all users

The Settings toggle defaults to push:true so users who don't want it can opt out before any sends happen."
```

- [ ] **Step 2: Update the brainstorm session task list**

Mark this implementation plan as completed in the brainstorming session's tracking.

- [ ] **Step 3: Done**

You're done. Hand off to the next plan.
