# Invite / Ambassador System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ship the full invite + referral + ambassador system end-to-end: DB schema, code generation, share hook, badge component, welcome banner, and wire everything into the middleware, AuthProvider, AppHeader, profile page, and home page.

**Architecture:** Four tasks in strict order. Task 1 lays the database + pure-library foundation (nothing user-visible). Task 2 builds the reusable hook + components (still nothing visible). Task 3 wires them into the middleware + AuthProvider claim flow (capturing refs, no UI surface yet). Task 4 adds the visible surfaces (profile row, header icon, welcome banner) and does end-to-end visual verification.

**Spec:** `docs/superpowers/specs/2026-04-09-invite-ambassador-system-design.md`

**DB migration note:** Task 1 creates the migration SQL file, but per CLAUDE.md policy migrations are applied manually via the Supabase dashboard. The controller will alert the user to apply it before Task 3 can be verified end-to-end.

---

## File Structure

**New files:**
- `supabase/migrations/20260409_referral_codes.sql`
- `src/lib/referral.ts`
- `src/lib/ambassador.ts`
- `src/hooks/useInvite.ts`
- `src/components/AmbassadorBadge.tsx`
- `src/components/InviteWelcomeBanner.tsx`

**Modified files:**
- `src/middleware.ts`
- `src/components/AuthProvider.tsx`
- `src/components/AppHeader.tsx`
- `src/app/(app)/profile/page.tsx`
- `src/app/(app)/home/page.tsx`

---

## Task 1: Foundation — DB migration + referral lib + ambassador metadata

**Rationale:** Start with pure data + pure logic, no React. Migration is a file on disk (applied manually by user). Referral code generator + tier metadata are tested purely via typecheck.

**Files:**
- Create: `supabase/migrations/20260409_referral_codes.sql`
- Create: `src/lib/referral.ts`
- Create: `src/lib/ambassador.ts`

### Step 1.1 — Create the migration SQL file

Create `supabase/migrations/20260409_referral_codes.sql` with exactly:

```sql
-- supabase/migrations/20260409_referral_codes.sql
-- Add referral_code + referred_by columns to profiles and open up
-- read access to basic profile fields so the invite welcome banner
-- and ambassador tier lookups work without server-side fetches.

-- ── Schema changes ──────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_referral_code_idx ON public.profiles(referral_code);
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx ON public.profiles(referred_by);

-- ── Public read policy ──────────────────────────────────────────────────────
-- Required for:
--   1. Welcome banner to fetch inviter display_name/avatar by referral_code
--   2. Ambassador tier count query (SELECT ... WHERE referred_by = user_id)
--      when the referred users are not yet friends of the viewer
-- Only display_name, avatar_url, referral_code, and referred_by are
-- intended to be public. preferred_country becomes readable too but is
-- not sensitive. Any future private fields (email, phone, etc.) must
-- live in a separate table that is NOT covered by this policy.

DROP POLICY IF EXISTS "Public profile read" ON public.profiles;
CREATE POLICY "Public profile read"
  ON public.profiles FOR SELECT
  USING (true);
```

### Step 1.2 — Create `src/lib/referral.ts`

Create `src/lib/referral.ts` with exactly this content:

```ts
// src/lib/referral.ts
//
// Utilities for generating and resolving user referral codes.
// Codes are 6-character base36 strings (uppercase), e.g. "AB3K9M".
// Collision probability is ~1 in 2.1 billion — retries up to 3 times.

import { supabase } from '@/lib/supabase'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const CODE_LENGTH = 6
const MAX_RETRIES = 3

/**
 * Generate a random 6-character base36 referral code using
 * crypto.getRandomValues. Browser-safe and collision-resistant.
 */
export function generateReferralCode(): string {
  const arr = new Uint8Array(CODE_LENGTH)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => ALPHABET[b % ALPHABET.length]).join('')
}

/**
 * Ensure the given user has a referral code. If profiles.referral_code
 * is already set, return it. Otherwise generate one, UPDATE the row,
 * and return the new code. Retries on unique-constraint violation
 * (vanishingly rare).
 *
 * Returns null if the user does not exist or the update fails after
 * all retries.
 */
export async function ensureReferralCode(userId: string): Promise<string | null> {
  // Fast path: read current code
  const { data: existing } = await supabase
    .from('profiles')
    .select('referral_code')
    .eq('id', userId)
    .maybeSingle()

  if (existing?.referral_code) return existing.referral_code

  // Generate + upsert, retrying on collision
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const code = generateReferralCode()
    const { error } = await supabase
      .from('profiles')
      .update({ referral_code: code })
      .eq('id', userId)
      .is('referral_code', null)

    if (!error) return code
    // Collision on the unique constraint → retry with a fresh code
    if (error.code === '23505') continue
    // Any other error: bail
    console.warn('[referral] ensureReferralCode update failed:', error)
    return null
  }
  console.warn('[referral] ensureReferralCode exhausted retries')
  return null
}

/**
 * Resolve an inviter's public profile fields by referral code.
 * Returns null if no match. Safe to call anonymously (RLS permits).
 */
export async function resolveInviterByCode(code: string): Promise<{
  id: string
  display_name: string | null
  avatar_url: string | null
} | null> {
  if (!code) return null
  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url')
    .eq('referral_code', code.toUpperCase())
    .maybeSingle()
  return data ?? null
}

/**
 * Count how many users have been referred by the given user.
 * Used to compute the ambassador tier.
 */
export async function countReferralsByUser(userId: string): Promise<number> {
  const { count } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('referred_by', userId)
  return count ?? 0
}
```

### Step 1.3 — Create `src/lib/ambassador.ts`

Create `src/lib/ambassador.ts` with exactly this content:

```ts
// src/lib/ambassador.ts
//
// Ambassador tier spec. Tiers are earned by inviting friends who
// successfully sign up. Three tiers, all padel-shot + nacho themed.

export type AmbassadorTierId = 'bandeja' | 'vibora' | 'smash'

export interface AmbassadorTierSpec {
  id: AmbassadorTierId
  name: string
  subtitle: string
  icon: string
  color: string
  bgGradient: string
  minInvites: number
  description: string
}

export const AMBASSADOR_TIERS: Record<AmbassadorTierId, AmbassadorTierSpec> = {
  bandeja: {
    id: 'bandeja',
    name: 'Bandeja',
    subtitle: 'The tray',
    icon: '🥨',
    color: '#7ED321',
    bgGradient: 'linear-gradient(135deg, rgba(126,211,33,0.25) 0%, rgba(126,211,33,0.08) 100%)',
    minInvites: 1,
    description: 'Bandeja means "tray" in Spanish — the padel shot AND what nachos are served on. You\'ve served up your first invites.',
  },
  vibora: {
    id: 'vibora',
    name: 'Víbora Picante',
    subtitle: 'Spicy snake',
    icon: '🌶️',
    color: '#FF6B2B',
    bgGradient: 'linear-gradient(135deg, rgba(255,107,43,0.3) 0%, rgba(255,107,43,0.1) 100%)',
    minInvites: 5,
    description: 'The padel shot with bite + a jalapeño kick. You\'re turning up the heat and bringing the crew.',
  },
  smash: {
    id: 'smash',
    name: 'Smash Supremo',
    subtitle: 'The supreme',
    icon: '🧀',
    color: '#FFD166',
    bgGradient: 'linear-gradient(135deg, rgba(255,209,102,0.35) 0%, rgba(255,209,102,0.12) 100%)',
    minInvites: 15,
    description: 'Match-winning smash + fully-loaded nacho supreme. Top of the community. Legendary status.',
  },
}

/**
 * Derive an ambassador tier from a successful-invite count.
 * Returns null when count is 0 (no badge yet).
 */
export function tierForCount(count: number): AmbassadorTierSpec | null {
  if (count >= AMBASSADOR_TIERS.smash.minInvites) return AMBASSADOR_TIERS.smash
  if (count >= AMBASSADOR_TIERS.vibora.minInvites) return AMBASSADOR_TIERS.vibora
  if (count >= AMBASSADOR_TIERS.bandeja.minInvites) return AMBASSADOR_TIERS.bandeja
  return null
}

/**
 * Returns the next tier above the current count, and how many more
 * invites are needed to reach it. Used for progress hints on the
 * profile row.
 */
export function nextTierProgress(count: number): { next: AmbassadorTierSpec; remaining: number } | null {
  if (count < AMBASSADOR_TIERS.bandeja.minInvites) {
    return { next: AMBASSADOR_TIERS.bandeja, remaining: AMBASSADOR_TIERS.bandeja.minInvites - count }
  }
  if (count < AMBASSADOR_TIERS.vibora.minInvites) {
    return { next: AMBASSADOR_TIERS.vibora, remaining: AMBASSADOR_TIERS.vibora.minInvites - count }
  }
  if (count < AMBASSADOR_TIERS.smash.minInvites) {
    return { next: AMBASSADOR_TIERS.smash, remaining: AMBASSADOR_TIERS.smash.minInvites - count }
  }
  return null  // maxed out
}
```

### Step 1.4 — Typecheck

Run:
```
npx tsc --noEmit 2>&1 | grep -E "(referral|ambassador)" | head -20
```

Expected: no errors.

### Step 1.5 — Commit

```bash
git add supabase/migrations/20260409_referral_codes.sql src/lib/referral.ts src/lib/ambassador.ts
git commit -m "$(cat <<'EOF'
feat(invite): add referral code infra + ambassador tier spec

Foundation for the invite / ambassador system:

- DB migration adds profiles.referral_code (UNIQUE) and
  profiles.referred_by (self-FK), plus indexes on both. Also
  opens a public SELECT policy on profiles so anonymous visitors
  can resolve an inviter's display_name/avatar by code for the
  welcome banner. Apply via Supabase dashboard before rollout.

- src/lib/referral.ts exposes generateReferralCode (6-char base36
  via crypto.getRandomValues), ensureReferralCode (lazy assign
  + retry on collision), resolveInviterByCode, and
  countReferralsByUser.

- src/lib/ambassador.ts defines the three-tier spec (Bandeja /
  Víbora Picante / Smash Supremo) with icons, colors, gradients,
  thresholds (1/5/15), and helper functions tierForCount + 
  nextTierProgress.

No user-visible change yet.

Spec: docs/superpowers/specs/2026-04-09-invite-ambassador-system-design.md
EOF
)"
```

**After committing Task 1, the controller MUST alert the user: "The migration file is created but needs to be applied via the Supabase dashboard before Task 3 can be verified end-to-end. Please apply supabase/migrations/20260409_referral_codes.sql in the SQL editor and confirm when ready."**

---

## Task 2: Components — useInvite hook + AmbassadorBadge + InviteWelcomeBanner

**Rationale:** Build the reusable React pieces. Each is self-contained and testable via typecheck + storybook-style ad-hoc rendering. No wiring into pages yet — Task 3 will do that.

**Files:**
- Create: `src/hooks/useInvite.ts`
- Create: `src/components/AmbassadorBadge.tsx`
- Create: `src/components/InviteWelcomeBanner.tsx`

### Step 2.1 — Create `src/hooks/useInvite.ts`

```ts
// src/hooks/useInvite.ts
//
// Invite state + share trigger for the current user. Lazily ensures
// the user has a referral code on first use, computes the shareable
// URL, loads the current invite count + ambassador tier, and exposes
// shareNow() that calls the Web Share API (or falls back to clipboard).

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { ensureReferralCode, countReferralsByUser } from '@/lib/referral'
import { tierForCount, AmbassadorTierSpec } from '@/lib/ambassador'

const SHARE_TITLE = 'PadelNachos'
const SHARE_TEXT = 'Follow live padel scores on PadelNachos 🎾'

export interface UseInviteResult {
  inviteUrl: string | null
  inviteCount: number
  tier: AmbassadorTierSpec | null
  loading: boolean
  shareNow: () => Promise<{ ok: boolean; fallback: 'clipboard' | 'native' | null }>
}

export function useInvite(): UseInviteResult {
  const { user, loading: authLoading } = useAuth()
  const [code, setCode] = useState<string | null>(null)
  const [inviteCount, setInviteCount] = useState<number>(0)
  const [loading, setLoading] = useState<boolean>(true)

  // Load code + count whenever the user changes
  useEffect(() => {
    if (authLoading) return
    if (!user) { setCode(null); setInviteCount(0); setLoading(false); return }

    let cancelled = false
    setLoading(true)

    ;(async () => {
      const [c, n] = await Promise.all([
        ensureReferralCode(user.id),
        countReferralsByUser(user.id),
      ])
      if (cancelled) return
      setCode(c)
      setInviteCount(n)
      setLoading(false)
    })()

    return () => { cancelled = true }
  }, [user, authLoading])

  const inviteUrl = code && typeof window !== 'undefined'
    ? `${window.location.origin}/home?ref=${code}`
    : null

  const tier = tierForCount(inviteCount)

  const shareNow = useCallback(async (): Promise<{ ok: boolean; fallback: 'clipboard' | 'native' | null }> => {
    if (!inviteUrl) return { ok: false, fallback: null }

    // Prefer native share sheet
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: inviteUrl })
        return { ok: true, fallback: 'native' }
      } catch (err) {
        // User cancelled or share failed — fall through to clipboard
        if ((err as Error)?.name === 'AbortError') return { ok: false, fallback: null }
      }
    }

    // Clipboard fallback
    try {
      await navigator.clipboard.writeText(inviteUrl)
      return { ok: true, fallback: 'clipboard' }
    } catch {
      return { ok: false, fallback: null }
    }
  }, [inviteUrl])

  return { inviteUrl, inviteCount, tier, loading, shareNow }
}
```

### Step 2.2 — Create `src/components/AmbassadorBadge.tsx`

```tsx
// src/components/AmbassadorBadge.tsx
//
// Chunky clip-pathed tier badge for the ambassador system. Three
// sizes for different surfaces: lg (dedicated screen), md (profile
// row), sm (name chip). Smash tier gets a subtle outer glow.

'use client'

import type { AmbassadorTierSpec } from '@/lib/ambassador'

const CHUNKY_BADGE = 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'

interface AmbassadorBadgeProps {
  tier: AmbassadorTierSpec
  size?: 'sm' | 'md' | 'lg'
}

export function AmbassadorBadge({ tier, size = 'md' }: AmbassadorBadgeProps) {
  const px = size === 'lg' ? 68 : size === 'md' ? 44 : 22
  const iconSize = size === 'lg' ? 30 : size === 'md' ? 20 : 11

  const glow = tier.id === 'smash'
    ? { boxShadow: `0 0 ${size === 'lg' ? 22 : size === 'md' ? 14 : 8}px ${size === 'lg' ? 3 : 2}px ${tier.color}55` }
    : undefined

  return (
    <div
      aria-label={`${tier.name} ambassador badge`}
      style={{
        position: 'relative',
        width: px,
        height: px,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        clipPath: CHUNKY_BADGE,
        background: tier.bgGradient,
        border: `1.5px solid ${tier.color}`,
        ...glow,
      }}
    >
      <span style={{ fontSize: iconSize, lineHeight: 1 }}>{tier.icon}</span>
    </div>
  )
}
```

### Step 2.3 — Create `src/components/InviteWelcomeBanner.tsx`

```tsx
// src/components/InviteWelcomeBanner.tsx
//
// Welcome banner shown at the top of /home when a visitor arrives
// via an invite link (?ref=<code>). Fetches the inviter's public
// profile fields, renders a dismissible card. Dismissal is tracked
// per-code in sessionStorage so the same ref doesn't re-show, but
// a different ref shows the banner again.

'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { resolveInviterByCode } from '@/lib/referral'
import { useAuth } from '@/components/AuthProvider'

const GREEN = '#7ED321'
const BG_CARD = '#141414'
const MUTED = '#8a8f98'

const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

export function InviteWelcomeBanner() {
  const searchParams = useSearchParams()
  const { user } = useAuth()
  const refCode = searchParams.get('ref')

  const [inviter, setInviter] = useState<{ id: string; display_name: string | null; avatar_url: string | null } | null>(null)
  const [dismissed, setDismissed] = useState(false)

  // Read initial dismissal state from sessionStorage
  useEffect(() => {
    if (!refCode || typeof window === 'undefined') return
    const key = `pn_welcome_dismissed_${refCode}`
    if (sessionStorage.getItem(key) === '1') setDismissed(true)
  }, [refCode])

  // Fetch inviter profile
  useEffect(() => {
    if (!refCode) { setInviter(null); return }
    let cancelled = false
    void resolveInviterByCode(refCode).then(data => {
      if (!cancelled) setInviter(data)
    })
    return () => { cancelled = true }
  }, [refCode])

  const handleDismiss = () => {
    if (refCode && typeof window !== 'undefined') {
      sessionStorage.setItem(`pn_welcome_dismissed_${refCode}`, '1')
    }
    setDismissed(true)
  }

  // Don't render when:
  // - No ref code in URL
  // - Inviter lookup failed (bad code / network)
  // - User already dismissed this code
  // - The logged-in user IS the inviter (self-referral)
  if (!refCode || !inviter || dismissed) return null
  if (user && user.id === inviter.id) return null

  const name = inviter.display_name?.trim() || 'Someone'

  return (
    <div style={{
      margin: '12px 16px 8px',
      padding: 14,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      background: `linear-gradient(135deg, rgba(126,211,33,0.1) 0%, ${BG_CARD} 100%)`,
      clipPath: CHUNKY_CARD,
      borderLeft: `3px solid ${GREEN}`,
      position: 'relative',
    }}>
      {/* Inviter avatar */}
      <div style={{
        width: 48, height: 48, borderRadius: '50%',
        border: `2px solid #0A0A0A`,
        background: inviter.avatar_url
          ? `url(${inviter.avatar_url}) center/cover`
          : 'linear-gradient(135deg, #5a6a7a, #2a3a4a)',
        flexShrink: 0,
      }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 9, fontWeight: 800, color: GREEN,
          textTransform: 'uppercase', letterSpacing: 0.5,
          marginBottom: 3,
        }}>
          🎾 You've been invited
        </div>
        <div style={{
          fontSize: 14, fontWeight: 800, color: '#fff',
          lineHeight: 1.2,
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {name} brought you to PadelNachos
        </div>
        <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
          Follow your favorite players, get live scores, and never miss a match.
        </div>
      </div>

      <button
        onClick={handleDismiss}
        aria-label="Dismiss invite welcome"
        style={{
          position: 'absolute',
          top: 8, right: 10,
          background: 'none', border: 'none',
          color: MUTED, fontSize: 18, lineHeight: 1,
          cursor: 'pointer', padding: 0,
          fontFamily: 'inherit',
        }}
      >
        ×
      </button>
    </div>
  )
}
```

### Step 2.4 — Typecheck

```
npx tsc --noEmit 2>&1 | grep -E "(useInvite|AmbassadorBadge|InviteWelcomeBanner)"
```

Expected: no errors.

### Step 2.5 — Lint

```
npm run lint -- src/hooks/useInvite.ts src/components/AmbassadorBadge.tsx src/components/InviteWelcomeBanner.tsx 2>&1 | tail -20
```

Expected: no new errors.

### Step 2.6 — Commit

```bash
git add src/hooks/useInvite.ts src/components/AmbassadorBadge.tsx src/components/InviteWelcomeBanner.tsx
git commit -m "$(cat <<'EOF'
feat(invite): add useInvite hook, AmbassadorBadge, InviteWelcomeBanner

Three reusable pieces for the invite system — not wired into any
page yet (Task 3 does that):

- src/hooks/useInvite.ts — useInvite() returns inviteUrl,
  inviteCount, tier, loading, and a shareNow() action that calls
  navigator.share when available and falls back to clipboard copy.
  Lazily ensures the user has a referral code on first use.

- src/components/AmbassadorBadge.tsx — chunky clip-pathed badge
  with sm/md/lg sizes and a Smash tier glow effect. Renders the
  tier icon and color from AMBASSADOR_TIERS.

- src/components/InviteWelcomeBanner.tsx — green-accented banner
  that fetches the inviter's profile by ?ref= code, shows avatar
  + name + CTA copy, dismissible with × (per-code sessionStorage).
  Self-referral guard: doesn't render when the logged-in user IS
  the inviter.

Spec: docs/superpowers/specs/2026-04-09-invite-ambassador-system-design.md
EOF
)"
```

---

## Task 3: Middleware + AuthProvider claim flow

**Rationale:** Wire the ref capture and the on-signup claim. Still no visible UI surface — Task 4 adds those. This task makes the data flow work so Task 4's UI has real numbers to show.

**Files:**
- Modify: `src/middleware.ts`
- Modify: `src/components/AuthProvider.tsx`

### Step 3.1 — Read current middleware

```
Read src/middleware.ts
```

### Step 3.2 — Add ref cookie capture

In `src/middleware.ts`, inside the existing middleware function, add a block that reads `request.nextUrl.searchParams.get('ref')` and sets a cookie on the response if present. Place it near the top of the function so it runs for all pages, not just specific routes.

The exact edit depends on the current structure. Find the location just before `return NextResponse.next()` (or equivalent) and add:

```ts
  // Capture invite ref code into a cookie so we can claim it on signup.
  // 30-day expiry, Path=/, non-httpOnly so client code can clear it after claim.
  const ref = request.nextUrl.searchParams.get('ref')
  if (ref && /^[A-Z0-9]{6}$/.test(ref)) {
    response.cookies.set('pn_invite_ref', ref, {
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
      sameSite: 'lax',
    })
  }
```

Requires `response` to be the NextResponse that's returned. If the current middleware creates a fresh NextResponse for each branch, you may need to attach the cookie in each branch OR refactor to a single response that's decorated then returned. Read the current file first to decide.

### Step 3.3 — Extend AuthProvider with claimReferral

Open `src/components/AuthProvider.tsx`. Find `migrateLocalBookmarks` (existing function) and `handleNewSignIn` or equivalent (the place where migrate is called after auth state change).

Add a new function right below `migrateLocalBookmarks`:

```ts
async function claimReferral(userId: string) {
  if (typeof document === 'undefined') return

  // Read cookie
  const match = document.cookie.match(/(?:^|;\s*)pn_invite_ref=([A-Z0-9]{6})/)
  if (!match) return
  const code = match[1]

  try {
    // Resolve inviter
    const { data: inviter } = await supabase
      .from('profiles')
      .select('id')
      .eq('referral_code', code)
      .maybeSingle()

    if (!inviter) return
    if (inviter.id === userId) {
      // Self-referral — just clear the cookie
      document.cookie = 'pn_invite_ref=; Path=/; Max-Age=0; SameSite=lax'
      return
    }

    // Only set referred_by if currently null (idempotent)
    const { error } = await supabase
      .from('profiles')
      .update({ referred_by: inviter.id })
      .eq('id', userId)
      .is('referred_by', null)

    if (!error) {
      document.cookie = 'pn_invite_ref=; Path=/; Max-Age=0; SameSite=lax'
      console.log('[Auth] Claimed referral from', code)
    }
  } catch (e) {
    console.warn('[Auth] claimReferral failed:', e)
  }
}
```

Then in the code where `migrateLocalBookmarks(userId)` is called (find it with grep), add `void claimReferral(userId)` right after.

### Step 3.4 — Typecheck + lint

```
npx tsc --noEmit 2>&1 | grep -E "(middleware|AuthProvider)" | head -20
npm run lint -- src/middleware.ts src/components/AuthProvider.tsx 2>&1 | tail -20
```

Expected: no new errors.

### Step 3.5 — Commit

```bash
git add src/middleware.ts src/components/AuthProvider.tsx
git commit -m "$(cat <<'EOF'
feat(invite): capture ref code in middleware + claim on signup

- Middleware now captures ?ref=XXXXXX query params from any page
  into a non-httpOnly pn_invite_ref cookie (30-day expiry, Path=/).
  Only accepts codes matching the 6-char base36 format.

- AuthProvider runs claimReferral(userId) alongside the existing
  migrateLocalBookmarks call after sign-in. It reads the cookie,
  resolves the inviter, and updates profiles.referred_by (only
  when currently null, idempotent). Self-referral guarded by ID
  comparison. Cookie cleared after a successful or self-referral
  attempt. Graceful no-op when no cookie is present.
EOF
)"
```

---

## Task 4: Visible UI — profile row + header icon + welcome banner

**Rationale:** Final task. Adds the three user-visible surfaces, wires them to `useInvite` and `<InviteWelcomeBanner>`, and does end-to-end verification in the browser.

**Files:**
- Modify: `src/components/AppHeader.tsx`
- Modify: `src/app/(app)/profile/page.tsx`
- Modify: `src/app/(app)/home/page.tsx`

### Step 4.1 — Add share icon to AppHeader

```
Read src/components/AppHeader.tsx
```

Add the share icon button between the search bar and `<ProfileButton />`. The icon should only render when the user is logged in (use `useAuth()`).

At the top of the file, add:

```tsx
import { useInvite } from '@/hooks/useInvite'
import { useAuth } from '@/components/AuthProvider'
```

In the component, before the return statement, destructure:

```tsx
  const { user } = useAuth()
  const { shareNow } = useInvite()
```

In the JSX, between the closing `</div>` of the search bar and `<ProfileButton />`, add:

```tsx
      {/* Share icon — logged-in users only */}
      {user && (
        <button
          onClick={() => { void shareNow() }}
          aria-label="Share PadelNachos"
          style={{
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.10)',
            clipPath: CHUNKY.button,
            width: 34, height: 34,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
            marginRight: 8,
            padding: 0,
          }}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#7ED321" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      )}
```

### Step 4.2 — Add Invite friends row to profile page

```
Read src/app/(app)/profile/page.tsx
```

Find the section where other profile cards/rows are rendered (probably inside the main return JSX).

At the top of the file, add:

```tsx
import { useInvite } from '@/hooks/useInvite'
import { AmbassadorBadge } from '@/components/AmbassadorBadge'
import { AMBASSADOR_TIERS } from '@/lib/ambassador'
```

In the `ProfilePage` function body, destructure:

```tsx
  const { inviteCount, tier, loading: inviteLoading, shareNow } = useInvite()
```

In the JSX, AT THE TOP of the profile content (above the bookmarks/following section — find the first row-like thing and add above it), insert:

```tsx
  {/* Invite friends — share CTA with ambassador badge */}
  {user && (
    <button
      onClick={() => { void shareNow() }}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        background: 'rgba(255,255,255,0.03)',
        clipPath: V3.clip.card,
        padding: '12px 14px',
        border: 'none',
        marginBottom: 12,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
      }}
    >
      <div style={{ flexShrink: 0 }}>
        {tier ? (
          <AmbassadorBadge tier={tier} size="md" />
        ) : (
          <div style={{
            width: 44, height: 44,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            clipPath: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)',
            background: 'rgba(255,255,255,0.06)',
            border: `1.5px solid rgba(255,255,255,0.1)`,
            fontSize: 20,
          }}>🎾</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
          Invite friends
        </div>
        <div style={{ fontSize: 11, color: V3.MUTED, marginTop: 3 }}>
          {inviteLoading ? 'Loading…' : tier ? (
            <>
              <span style={{
                display: 'inline-block',
                fontSize: 9, fontWeight: 800,
                color: tier.color,
                background: tier.bgGradient,
                padding: '1px 5px',
                clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
                marginRight: 5,
                textTransform: 'uppercase',
                letterSpacing: 0.3,
              }}>
                {tier.name}
              </span>
              {inviteCount} {inviteCount === 1 ? 'friend' : 'friends'} on PadelNachos
            </>
          ) : (
            'Share the app with your friends'
          )}
        </div>
      </div>
      <span style={{ color: V3.MUTED, fontSize: 18, flexShrink: 0 }}>›</span>
    </button>
  )}
```

Placement: ABOVE the first existing content card on the profile page. Verify visually that it's near the top, below any page header.

### Step 4.3 — Add InviteWelcomeBanner to home page

```
Read src/app/(app)/home/page.tsx
```

At the top, add:

```tsx
import { InviteWelcomeBanner } from '@/components/InviteWelcomeBanner'
```

Find the main return JSX of the home page (it's a `<main>` wrapper with various sections). Immediately below the `<AppHeader>` and above the first content section, add:

```tsx
      <InviteWelcomeBanner />
```

Exact placement: after `<SearchOverlay>` (if present) and before the first `<SectionTitle>` or hero card.

### Step 4.4 — Typecheck + lint

```
npx tsc --noEmit 2>&1 | grep -E "(AppHeader|profile/page|home/page)" | head -20
npm run lint -- src/components/AppHeader.tsx "src/app/(app)/profile/page.tsx" "src/app/(app)/home/page.tsx" 2>&1 | tail -30
```

Expected: no new errors.

### Step 4.5 — Visual verification

**Prerequisite:** The Supabase migration from Task 1 has been applied. If the user hasn't confirmed, STOP and report `BLOCKED — awaiting migration apply`.

Use the preview tools. First `mcp__Claude_Preview__preview_list` to get the serverId.

**Verification 1 — Profile row (logged in):**

Navigate to `/profile`:
```
mcp__Claude_Preview__preview_eval with: window.location.href = '/profile'
```

Wait, scroll to top, screenshot. Verify:
- The "Invite friends" row is visible at the top of the profile content
- The icon shows 🎾 (generic paddle, tier=null) with "Share the app with your friends"
- Row is clickable (cursor:pointer)

**Verification 2 — Header share icon:**

Navigate to `/home`:
```
mcp__Claude_Preview__preview_eval with: window.location.href = '/home'
```

Screenshot the header. Verify the share icon is present between the search bar and the profile button. Click it:

```
mcp__Claude_Preview__preview_eval with:
  (async () => {
    const btn = [...document.querySelectorAll('button[aria-label="Share PadelNachos"]')][0];
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 500));
    return 'clicked';
  })()
```

On desktop this will trigger either the native share sheet or fall back to clipboard. Either way, no error should appear in console.

**Verification 3 — Welcome banner:**

Find a user in the profiles table who has a referral_code set (any user who's clicked share before). You can set one manually for testing:

```sql
-- Run this in Supabase SQL editor if no user has a code yet:
UPDATE profiles SET referral_code = 'TEST01' WHERE id = (SELECT id FROM profiles LIMIT 1);
```

Navigate to `/home?ref=TEST01`:
```
mcp__Claude_Preview__preview_eval with:
  window.location.href = '/home?ref=TEST01'
```

Wait ~2 seconds (banner fetches inviter async), screenshot. Verify:
- Welcome banner appears at the top of the home page
- Shows "🎾 YOU'VE BEEN INVITED"
- Shows "<Name> brought you to PadelNachos" with an avatar

Click the × to dismiss:
```
mcp__Claude_Preview__preview_eval with:
  (async () => {
    const x = document.querySelector('button[aria-label="Dismiss invite welcome"]');
    if (x) x.click();
    await new Promise(r => setTimeout(r, 300));
    const still = !!document.querySelector('button[aria-label="Dismiss invite welcome"]');
    return still ? 'still-visible' : 'dismissed';
  })()
```

Expected: `'dismissed'`.

Reload the page:
```
mcp__Claude_Preview__preview_eval with: window.location.reload()
```

After reload, verify the banner does NOT re-appear (sessionStorage persisted).

**Verification 4 — Console check:**

```
mcp__Claude_Preview__preview_console_logs with level: 'error', lines: 20
```

Expected: no new errors from any of the modified files.

### Step 4.6 — Commit

```bash
git add src/components/AppHeader.tsx "src/app/(app)/profile/page.tsx" "src/app/(app)/home/page.tsx"
git commit -m "$(cat <<'EOF'
feat(invite): wire share CTA + welcome banner into UI surfaces

Final visible piece of the invite / ambassador system:

- AppHeader now shows a share icon between the search bar and
  the profile button (logged-in users only). Click calls
  useInvite().shareNow() which triggers the native share sheet
  or falls back to clipboard.

- Profile page gets an "Invite friends" row at the top that
  shows the current ambassador badge + tier + invite count (or
  a generic 🎾 icon with "Share the app with your friends"
  copy when the user has not yet referred anyone). Click shares.

- Home page renders <InviteWelcomeBanner> at the top, which is
  visible only when ?ref=<code> is present in the URL AND the
  inviter code resolves to a real user AND the code hasn't been
  dismissed in this session. Dismissible with × and per-code
  sessionStorage. Self-referral guarded.

Spec: docs/superpowers/specs/2026-04-09-invite-ambassador-system-design.md
EOF
)"
```

---

## Final verification

After all four tasks land:

- [ ] `git log --oneline main..HEAD | head -10` — expected: 4 new commits on top of previous work
- [ ] `npx tsc --noEmit 2>&1 | wc -l` — expected: same or fewer errors than before
- [ ] Full manual walkthrough:
  1. Sign in as user A → profile shows "Invite friends" row with tier=null
  2. Click share from header → OS share sheet or clipboard toast
  3. Open the shared URL in an incognito window → banner shows user A's name
  4. Sign up as user B → banner dismisses, `profiles.referred_by` = A's id
  5. Sign in as user A again → profile row now shows Bandeja + "1 friend"
  6. Simulate 5 referrals (manually in DB) → row shows Víbora Picante
  7. Simulate 15 → row shows Smash Supremo with glow

## Summary

4 commits, 6 new files + 5 modified files. No tests (manual verification only — matches the rest of this codebase).
