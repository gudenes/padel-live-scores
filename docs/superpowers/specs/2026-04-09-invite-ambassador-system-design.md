# Invite / Ambassador System

**Date:** 2026-04-09
**Status:** Approved for implementation
**Scope:** New share-with-friends flow with tracked referrals and padel/nacho-themed ambassador tiers

## Problem

PadelNachos has no built-in way for existing users to invite friends. Growth relies entirely on organic discovery. We want a light-touch referral system that:

1. Lets any logged-in user grab a personal invite link in two taps
2. Tracks who invited whom, so we can measure virality later
3. Rewards inviters with a cosmetic "Ambassador" badge that escalates through three padel/nacho-themed tiers as they bring more friends on board
4. Shows incoming referred users a warm welcome banner with the inviter's name/avatar

The app already has Supabase auth + a `profiles` table + the `useAuth()` hook + an OAuth/magic-link `LoginSheet`, so this is mostly an additive build on top of existing primitives.

## Goals

- **Share button in two places** — a row on the profile page and a share icon in the shared `AppHeader` next to the search bar
- **Unique, stable referral code per user** — opaque 6-character base36 string (e.g. `AB3K9M`), generated on first demand and stored on the profile
- **Invite URL format** — `/home?ref=<code>` (the home page is always addressable and the target of the existing "View previous seasons" link already takes query params)
- **Web Share API trigger** — `navigator.share()` with a pre-filled message and the invite URL on mobile; clipboard copy + toast fallback on desktop
- **Incoming welcome banner** — when a visitor lands on `/home?ref=<code>`, fetch the inviter's display_name + avatar and render a dismissible banner at the top of the home feed
- **Referral tracking** — when the referred visitor signs up, set `profiles.referred_by` to the inviter's `id`
- **Ambassador tier progression** based on count of users where `referred_by = currentUser.id`:
  - **🥨 Bandeja** *(1–4 invites)* — green accent
  - **🌶️ Víbora Picante** *(5–14 invites)* — brand orange `#FF6B2B`
  - **🧀 Smash Supremo** *(15+ invites)* — brand yellow `#FFD166`, with a soft outer glow
- **Badge visibility** — shown on the profile page's "Invite friends" row (shows current tier + count), and as a small chip next to the user's display name on their own profile when tier is Bandeja or higher
- **Self-referral guard** — a user cannot refer themselves; pending ref codes matching the signing-up user's code are ignored

## Non-Goals

- **Leaderboard of top ambassadors** — possible future feature, not in v1
- **Monetary rewards or unlock gates** — badges are cosmetic only
- **Visibility of ambassador badges on other users' profiles** — v1 only shows your own badge. A future iteration can add the badge to public surfaces (match detail ratings, player profiles) once we decide how it should render there.
- **Deep-link destinations other than `/home?ref=`** — we always share the app itself, not a specific match/tournament. The existing match share already has its own OG image flow.
- **Anti-abuse rate limiting** — someone could theoretically generate fake accounts to farm tier. Not in v1 scope.
- **Email-based invites** — no server-sent emails. The user's OS share sheet handles all channels.

## Design

### A. Database schema

**Migration:** `supabase/migrations/20260409_referral_codes.sql`

Add two columns to `profiles`:

```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text UNIQUE,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS profiles_referral_code_idx ON public.profiles(referral_code);
CREATE INDEX IF NOT EXISTS profiles_referred_by_idx ON public.profiles(referred_by);
```

**RLS changes:** The existing `profiles` policies allow users to read/update only their own row. For the welcome banner and ambassador lookup to work, we need to let ANY authenticated or anonymous user READ a profile's `display_name`, `avatar_url`, and `referral_code` fields by referral_code OR id.

The simplest approach is to add a permissive SELECT policy scoped to these specific columns via a view, but Supabase RLS doesn't support column-level policies cleanly. Instead, add a public SELECT policy on the full `profiles` table — `display_name` and `avatar_url` are already intended to be public (they show on match detail pages through bookmarks/matches, and the existing auth flow already exposes them via auth.users metadata).

```sql
-- Allow anyone (authenticated or anonymous) to read basic profile info.
-- This is required for the referral welcome banner and ambassador lookups.
-- Only display_name, avatar_url, referral_code, and referred_by are
-- intended to be public; other columns (preferred_country, etc.) become
-- readable too but are not sensitive.
CREATE POLICY IF NOT EXISTS "Public profile read"
  ON public.profiles FOR SELECT
  USING (true);
```

**Note:** This policy is additive. The existing "Users can read own profile" policy remains, but the more permissive one takes effect first. We're intentionally making all profile columns publicly readable — these are display fields. If we ever add private fields (email, phone), they'd need to go into a separate table.

**Rollback:** the migration is fully reversible by dropping the two columns and reverting the RLS change. No data loss concerns.

### B. Referral code generation

Codes are generated lazily — the first time a user clicks "Invite friends" (or on first profile load once the feature ships, for existing users), we generate one if missing.

Code format:
- **6 characters**, base36 alphabet (uppercase), e.g. `AB3K9M`
- Generated client-side with `crypto.getRandomValues` (cryptographically random)
- Retry on collision (vanishingly rare; 36^6 ≈ 2.1 billion codes)
- Stored on the user's own `profiles.referral_code` via a simple UPDATE

Helper: `src/lib/referral.ts`

```ts
export function generateReferralCode(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const arr = new Uint8Array(6)
  crypto.getRandomValues(arr)
  return Array.from(arr, b => alphabet[b % alphabet.length]).join('')
}

export async function ensureReferralCode(userId: string): Promise<string> {
  // Returns existing code or generates + stores a new one.
  // Handles unique-constraint conflicts by retrying up to 3 times.
}
```

### C. Invite claim flow

When a visitor lands on any page with `?ref=<code>`:

1. **Middleware (`src/middleware.ts`)** reads the `ref` query param and sets a non-httpOnly cookie `pn_invite_ref` with the code (Max-Age: 30 days, Path: /). Simple, runs edge-side, no roundtrip.
2. **Client welcome banner** on `/home` — when `useSearchParams().get('ref')` is present, fetch the inviter's profile (`display_name`, `avatar_url`) by `referral_code` and render the banner.
3. **On sign-up** — the existing `AuthProvider` has an `onAuthStateChange` handler that runs `migrateLocalBookmarks(user.id)` on first sign-in. Extend it to also call `claimReferral(user.id)`:
   ```ts
   async function claimReferral(userId: string) {
     const ref = getCookie('pn_invite_ref')
     if (!ref) return
     // Look up inviter by code
     const { data: inviter } = await supabase
       .from('profiles')
       .select('id')
       .eq('referral_code', ref)
       .maybeSingle()
     if (!inviter || inviter.id === userId) { clearCookie('pn_invite_ref'); return }
     // Set referred_by only if not already set (idempotent)
     const { error } = await supabase
       .from('profiles')
       .update({ referred_by: inviter.id })
       .eq('id', userId)
       .is('referred_by', null)
     if (!error) clearCookie('pn_invite_ref')
   }
   ```
4. **Self-referral guard** — the `inviter.id === userId` check above prevents a user from claiming their own code.

### D. Share trigger — `useInvite()` hook

New file: `src/hooks/useInvite.ts`

```ts
export interface InviteState {
  inviteUrl: string | null
  shareNow: () => Promise<void>
  ensureCode: () => Promise<string | null>
  inviteCount: number
  tier: AmbassadorTier | null
  loading: boolean
}

export type AmbassadorTier = 'bandeja' | 'vibora' | 'smash'

export function tierForCount(count: number): AmbassadorTier | null {
  if (count >= 15) return 'smash'
  if (count >= 5) return 'vibora'
  if (count >= 1) return 'bandeja'
  return null
}
```

The hook:
1. Uses `useAuth()` to get the current user
2. On mount, reads `profiles.referral_code` for the current user; if null, calls `ensureReferralCode` to generate one
3. Computes `inviteUrl = '${origin}/home?ref=${code}'`
4. Computes `inviteCount` from `SELECT COUNT(*) FROM profiles WHERE referred_by = currentUser.id`
5. Derives `tier` from count via `tierForCount`
6. Exposes `shareNow()` that:
   - If `navigator.share` exists → calls it with `{ title: 'PadelNachos', text: ..., url: inviteUrl }`
   - Else → copies `inviteUrl` to clipboard and dispatches a toast

Share message text:
> *"Follow live padel scores on PadelNachos 🎾"*

(simple, not overclaiming, no emoji spam)

### E. Ambassador tier metadata

New file: `src/lib/ambassador.ts`

Defines the tier spec used by both the profile row and any future surfaces:

```ts
export interface AmbassadorTierSpec {
  id: 'bandeja' | 'vibora' | 'smash'
  name: string          // e.g. 'Bandeja'
  subtitle: string      // e.g. 'The tray'
  icon: string          // emoji for v1
  color: string         // hex
  bg: string            // rgba gradient-ready
  border: string        // rgba
  minInvites: number
  description: string   // "You're part of the crew"
}

export const AMBASSADOR_TIERS: Record<AmbassadorTierSpec['id'], AmbassadorTierSpec> = {
  bandeja: {
    id: 'bandeja',
    name: 'Bandeja',
    subtitle: 'The tray',
    icon: '🥨',
    color: '#7ED321',
    bg: 'linear-gradient(135deg, rgba(126,211,33,0.25) 0%, rgba(126,211,33,0.08) 100%)',
    border: '#7ED321',
    minInvites: 1,
    description: 'Bandeja means "tray" in Spanish — the padel shot AND what nachos are served on. You\'ve served up your first invites.',
  },
  vibora: {
    id: 'vibora',
    name: 'Víbora Picante',
    subtitle: 'Spicy snake',
    icon: '🌶️',
    color: '#FF6B2B',
    bg: 'linear-gradient(135deg, rgba(255,107,43,0.3) 0%, rgba(255,107,43,0.1) 100%)',
    border: '#FF6B2B',
    minInvites: 5,
    description: 'The padel shot with bite + a jalapeño kick. You\'re turning up the heat and bringing the crew.',
  },
  smash: {
    id: 'smash',
    name: 'Smash Supremo',
    subtitle: 'The supreme',
    icon: '🧀',
    color: '#FFD166',
    bg: 'linear-gradient(135deg, rgba(255,209,102,0.35) 0%, rgba(255,209,102,0.12) 100%)',
    border: '#FFD166',
    minInvites: 15,
    description: 'Match-winning smash + fully-loaded nacho supreme. Top of the community. Legendary status.',
  },
}
```

### F. Shared AmbassadorBadge component

New file: `src/components/AmbassadorBadge.tsx`

Renders a chunky clip-pathed badge for a given tier. Two sizes:
- `size="lg"` — 68×68, used on the dedicated invite detail surface (when we build it)
- `size="md"` — 44×44, used as the profile row icon
- `size="sm"` — 22×22, used as a chip next to the display name

Uses the existing CHUNKY badge clip-path and the colors from `AMBASSADOR_TIERS`. The `smash` tier gets a soft outer glow `box-shadow`.

### G. UI surfaces

#### G1. Profile page row

New row at the top of the profile page (above the bookmarks section), rendered only when the user is logged in:

```
┌──────────────────────────────────────────┐
│ 🥨 | Invite friends               ›     │
│    | Bandeja · 3 friends on PadelNachos │
└──────────────────────────────────────────┘
```

- When `tier === null` (0 invites), the icon is a muted generic paddle/tray and the sub-line reads "Share the app with your friends"
- When `tier` is set, icon + sub-line show the current tier and invite count
- Clicking the row calls `shareNow()` from `useInvite()`
- Hovering/tapping shows a subtle elevation (consistent with other profile rows)

Exact markup reuses the `.profile-row` chunky-card style already in the profile page.

#### G2. Header share icon

Add a share icon to `src/components/AppHeader.tsx`, positioned between the search bar and the profile button. Uses a standard iOS-style share glyph SVG (box with up arrow). Clicks call `shareNow()`.

Only shown when the user is logged in (skip when anonymous — nothing to share yet). Uses `useAuth()` to conditionally render.

```
┌─────────────────────────────────────────────────┐
│ [LOGO]  [ search bar ]    [↗] [profile]        │
└─────────────────────────────────────────────────┘
```

When anonymous, we just render the profile button as today (no share icon). This is intentional — we don't want to push share to users who haven't signed up.

#### G3. Welcome banner on `/home?ref=<code>`

Shown at the top of the `/home` page (ABOVE the hero section) when:
1. `searchParams.get('ref')` is non-null
2. The user has not dismissed this particular ref code in this session (tracked via sessionStorage key `pn_welcome_dismissed_<code>`)
3. The fetched inviter profile resolved successfully

Layout matches the mockup:

```
┌──────────────────────────────────────────────────┐
│ (avatar)  🎾 YOU'VE BEEN INVITED             × │
│           Gu brought you to PadelNachos          │
│           Follow your favorite players, get      │
│           live scores, and never miss a match.   │
└──────────────────────────────────────────────────┘
```

- Left accent bar: green `#7ED321`
- Background: subtle green tint gradient
- Inviter avatar: 48×48 circle (fallback to gradient placeholder when null)
- Dismiss × button clears the banner and sets the sessionStorage flag
- Banner auto-hides after sign-in (claim flow runs and we clear the cookie)

New file: `src/components/InviteWelcomeBanner.tsx`

### H. Files touched summary

**New files:**
- `supabase/migrations/20260409_referral_codes.sql` — schema change
- `src/lib/referral.ts` — code generation + ensureReferralCode
- `src/lib/ambassador.ts` — tier spec constants
- `src/hooks/useInvite.ts` — share hook
- `src/components/AmbassadorBadge.tsx` — shared badge component
- `src/components/InviteWelcomeBanner.tsx` — welcome banner

**Modified files:**
- `src/middleware.ts` — capture `?ref=` into cookie
- `src/components/AuthProvider.tsx` — claimReferral() call after migrateLocalBookmarks
- `src/components/AppHeader.tsx` — add share icon button next to search
- `src/app/(app)/profile/page.tsx` — add "Invite friends" row at top
- `src/app/(app)/home/page.tsx` — render `<InviteWelcomeBanner>` at the top of the content

### I. Edge cases

- **Anonymous user clicks share** — share icon is hidden for anonymous users (only on header). If they somehow reach the profile row (anonymous profile page shows a login CTA today, not the row), the row renders with `tier === null` and the sub-line "Sign in to invite friends". Clicking opens the LoginSheet.
- **Inviter's referral code lookup fails** (typo in URL, deleted account) — welcome banner silently does not render. The cookie still captures the code in case the inviter exists but network failed; the claim still attempts on signup and silently fails if it resolves to no user.
- **User is already signed in when they click a ref link** — welcome banner renders. The claim cookie is set but will NOT be applied because `profiles.referred_by IS NULL` check fails on the UPDATE (users who already have a referrer don't get overwritten). The claim is idempotent.
- **Self-referral** — guarded by the `inviter.id === userId` check in `claimReferral`.
- **Duplicate signup attempts** — `referred_by` UPDATE only fires when the column is currently NULL, so repeated signins don't rewrite the inviter.
- **User without display_name** — welcome banner falls back to "Someone brought you to PadelNachos".
- **prefers-reduced-motion** — no animations on the badge or banner, fine by default.

## Testing

Manual verification:

1. Sign in as user A. Navigate to profile. Verify "Invite friends" row shows tier=null + "Share the app with your friends".
2. Click the row. Verify native share sheet opens (on mobile) or clipboard toast fires (desktop). Copied URL should be `/home?ref=XXXXXX`.
3. Check `profiles` table: user A now has `referral_code` set.
4. Open the shared URL in an incognito window (so you're anonymous). Verify the welcome banner renders with user A's display_name and avatar.
5. Sign up in incognito as user B. Verify the banner dismisses (cookie claim runs) and `profiles.referred_by` for user B now points to user A.
6. Sign in as user A again, refresh profile. The "Invite friends" row should now show **🥨 Bandeja** and "1 friend on PadelNachos".
7. Repeat 4× more with different emails. At 5 successful referrals, the row should switch to **🌶️ Víbora Picante**.
8. Self-referral test: sign in as user A, navigate to `/home?ref=<A's own code>`. Verify banner does NOT render (we check identity before rendering) and `referred_by` remains null.
9. Dismiss the welcome banner with the × — verify it stays dismissed on reload (sessionStorage).
10. Open another ref link after dismissing — verify the new code shows the banner again (dismiss is per-code).

## Rollout

Single PR, no feature flag. DB migration applies before the frontend lands. Existing users without a `referral_code` get one generated the first time they click "Invite friends" (lazy generation).

## Future extensions (not in this PR)

- Leaderboard of top ambassadors
- Ambassador badge visible on other users' public profiles
- Email/SMS templates for non-mobile share
- Referral reward unlocks (early feature access, profile themes)
- Rate limiting / anti-abuse
