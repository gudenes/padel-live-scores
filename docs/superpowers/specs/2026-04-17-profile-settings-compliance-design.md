# Profile Settings + Compliance Foundations (Phase 1)

**Date:** 2026-04-17
**Status:** Approved
**Branch:** TBD (plan task)
**Owner:** PadelNachos product + engineering

## Problem

An audit of the user profile surface (`/profile`) identified seven compliance
and UX gaps that need to ship before we can confidently market the app in the
EU or list it in stricter app stores:

1. **No delete-account UI.** The `profiles` and Auth.js rows can only be
   removed by a developer running SQL. GDPR Art. 17 ("right to erasure")
   requires a user-initiated path.
2. **No data export.** GDPR Art. 20 ("right to data portability") requires a
   one-click JSON/CSV export of everything we hold about a user.
3. **No analytics opt-out.** `<Analytics />` from `@vercel/analytics/react` is
   rendered unconditionally in `src/app/layout.tsx` for every visitor. Users
   currently have no way to say "don't track me."
4. **No privacy policy or terms links on profile.** Pages exist at
   `/privacy` and `/terms` but the user has no obvious path to them from the
   account surface.
5. **No session management affordance.** Users can sign out of the current
   device but cannot see or revoke other active sessions.
6. **No edit-profile UI.** Display name is set from Google / email at sign-up
   and cannot be changed.
7. **No marketing-email opt-in flag.** We have no captured consent, so we
   cannot legally send broadcast emails to existing users even if we wanted
   to tomorrow.

Phase 1 closes all seven gaps with a single new page plus two API endpoints
and one migration. It does not redesign `/profile` — that is Phase 2.

## Goals

- Ship a `/profile/settings` page that is the canonical home for every
  account, preference, and privacy control.
- Put the app on the right side of GDPR Arts. 17 (delete), 20 (export), and
  7 (consent) for marketing email.
- Preserve current UX: users land on `/profile` (unchanged); settings is
  reached via a gear icon in the profile header.
- Do not introduce new runtime dependencies.
- Keep the implementation surface small — one page, two endpoints, one
  migration, one client component for analytics gating.

## Non-goals

- Redesigning `/profile` — that is Phase 2.
- Active sessions list (placeholder row only; see Design).
- Soft-delete / grace period for account deletion. Hard delete is fine for v1.
- Avatar upload. The existing `/profile` page does not implement upload either
  (only reads `profile.avatar_url` from Google). Avatar upload is Phase 2+.
- Email change flow. Email is read-only in the settings page.
- Two-factor auth.
- Actually *sending* marketing emails. We only capture the opt-in flag so a
  future campaign can respect it.
- Server-side analytics opt-out state. Analytics gating is localStorage-only,
  same device only, which is the pragmatic read given Vercel Analytics runs
  entirely in the browser.

## Design

### 1. Entry point — gear icon on `/profile`

The existing profile page (`src/app/[locale]/(app)/profile/page.tsx`) gets
exactly one visual change in Phase 1: a gear icon added to the right of the
header (replacing the current empty 36×36 spacer at line 230), linking to
`/profile/settings`.

- Icon: 18×18 outline gear SVG (match existing header back-arrow treatment),
  color `V3.MUTED`.
- Button: 36×36 transparent, same anatomy as the back button on the left.
- Uses `<Link href="/profile/settings">` from `@/i18n/navigation`.
- No other changes to `/profile`. Phase 2 handles the full redesign.

### 2. New page — `src/app/[locale]/(app)/profile/settings/page.tsx`

Client component, V3 styling, same 500px max-width mobile-first frame as
`/profile`. Five sections in vertical order, each prefixed with a small
uppercase orange section header (same treatment as "Bookmarked Matches" on
the current profile page).

#### 2.1 Section order and rationale

The five-section grouping is chosen to move down a decreasing-personal-stakes
gradient. Users who open settings usually want one specific thing, so the
highest-frequency / lowest-risk controls come first and the destructive
actions are visibly fenced off at the bottom:

1. **Account** — identity (name, email). High-frequency, low-risk.
2. **Preferences** — how the app behaves day-to-day (language, region,
   notifications). Second-highest touch, still low-risk.
3. **Privacy & Data** — legal + data rights. Mid-stakes. Grouping policy,
   terms, consent toggles, export, and delete together means the user
   finds them all in one glance when they are looking specifically for
   "how do I leave / what do you have on me."
4. **Support** — escape hatch if something is broken or confusing.
5. **Sign out** — last, destructive-styled, visually separated by a
   border-top and red accent.

Each section has a consistent row anatomy:

```
[icon tile 32px] [Label / subtitle]                                  [control]
```

- Icon tile: 32×32 with `clipPath: 'polygon(12% 4%, 88% 0%, 100% 88%, 4% 100%)'`
  matching `<BadgeIcon>`. Icon stroke color from `V3.GREEN` (positive),
  `V3.ORANGE` (neutral / informational), or `V3.LIVE_RED` (destructive).
- Row padding: `14px 16px`, bottom border `rgba(255,255,255,0.04)`.
- Right-side control: chevron (link-style), toggle (boolean), or inline value
  (read-only).

#### 2.2 Section detail

| Section | Row | Control | Destination / behavior |
|---|---|---|---|
| Account | Display name | Chevron | Opens inline edit sheet (see 2.3) |
| Account | Email | Read-only value | Shows `session.user.email` plus provider tag (e.g. `gudenes@gmail.com · Google`). Not editable in Phase 1. |
| Account | Active sessions | Disabled row | "Coming soon" pill on the right, `opacity: 0.5`, no chevron. No navigation. Reserves the slot for Phase 2. |
| Preferences | Language | Inline control | Reuse existing `<LocaleSwitcher />`. Row is taller to accommodate. |
| Preferences | Region | Inline control | Reuse existing `<CountryPicker />` wired to `profiles.preferred_country` exactly like today. The current `/profile` page's region block is moved here verbatim. |
| Preferences | Push notifications | Toggle | Reuse `usePushNotifications()` hook. Toggle styling matches `/profile`. |
| Privacy & Data | Privacy policy | Chevron | `<Link href="/privacy">` |
| Privacy & Data | Terms of service | Chevron | `<Link href="/terms">` |
| Privacy & Data | Analytics | Toggle | Writes `pn_analytics_opt_out` to `localStorage`. See 2.4. |
| Privacy & Data | Marketing emails | Toggle | PATCH `/api/user/marketing-prefs`. Optimistic UI. See 2.6. |
| Privacy & Data | Download my data | Chevron | Triggers download from `GET /api/user/export`. See 4. |
| Privacy & Data | Delete my account | Chevron (red) | Opens confirmation modal. See 2.5. |
| Support | Contact support | Chevron | `mailto:hello@padelnachos.com` |
| Support | About PadelNachos | Chevron | `<Link href="/about">`. Page already exists. |
| — | Sign out | Full-width red button | Same treatment as current `/profile` sign-out button. Calls `signOut()` from next-auth/react and redirects to `/home`. |

#### 2.3 Display name edit sheet

- Bottom sheet (same pattern family as `<LoginSheet>`).
- Single `<input>` pre-filled with `profile.display_name`.
- Max length: 40 chars client-side (soft), 120 chars server-side (hard,
  matches existing `text` column with no length constraint — we add the
  client validation only).
- Save button: disabled until dirty and non-empty after trim. On save,
  PATCH `/api/user/profile` with `{ display_name }` (endpoint already exists
  per `src/app/api/user/profile/` directory listing — verify during
  implementation; if it does not, implementation plan adds it).
- Cancel button closes without writing.
- On success: close sheet, update local state, show toast `Name updated`.

#### 2.4 Analytics opt-out wiring

The current `src/app/layout.tsx` renders `<Analytics />` unconditionally. We
gate it behind a small client component:

```tsx
// src/components/GatedAnalytics.tsx (NEW)
'use client'
import { useEffect, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'

export function GatedAnalytics() {
  const [optOut, setOptOut] = useState(true) // default to NOT rendering until localStorage is read
  useEffect(() => {
    setOptOut(localStorage.getItem('pn_analytics_opt_out') === '1')
  }, [])
  if (optOut) return null
  return <Analytics />
}
```

- `src/app/layout.tsx` replaces `<Analytics />` with `<GatedAnalytics />`.
- Settings toggle reads + writes `pn_analytics_opt_out`. Writing `'1'` opts
  OUT (no tracker). Removing the key opts IN.
- Default state for a never-visited user is **opted in** (i.e. the key is not
  set, `<GatedAnalytics>` reads `null`, renders Analytics). The initial
  `useState(true)` prevents a one-render flash before the effect runs — on
  the first client render, Analytics is off; after hydration, it switches on
  if the user hasn't opted out. Server-rendered HTML contains no tracker
  markup either way.
- Privacy copy in the settings row: "Help improve PadelNachos by sharing
  anonymous usage data."
- We deliberately do NOT mirror this flag to the DB. Rationale: the tracker
  runs entirely in the browser, so gating at the browser is sufficient. A
  DB flag would require loading a session client-side *before* the tracker
  renders, which reintroduces the auth-on-every-page overhead we just
  eliminated in the Auth.js migration.

#### 2.5 Delete-account confirmation

Two-step destructive flow:

- Step 1 (modal, danger style): "Delete your PadelNachos account? This
  permanently removes your profile, bookmarks, badges, ratings, and sign-in
  methods. You cannot undo this."
- Step 2 (reveal after clicking the first Delete): small text input — user
  must type `DELETE` (localized for each language; see i18n) to enable the
  final button. Second button is red and labelled "Delete forever."
- On click: DELETE `/api/user/account`. On 204, call `signOut({ redirect: false })`
  and navigate to `/home?deleted=1`. The `?deleted=1` query param can be
  read by `/home` to show a toast ("Your account has been deleted") — not
  in this spec's scope; we just set it.
- On non-204 response: show error toast with message from the response body.

### 3. DELETE `/api/user/account`

Route: `src/app/api/user/account/route.ts`
Method: DELETE
Auth: `getUserOrFail()` from `src/app/api/user/_auth.ts`.

Because the Auth.js `users` row and the `profiles` row live in the same
Postgres database (service key), we can execute one transaction via the
`pg` pool (same pool exported by `src/auth.ts`). To avoid a circular import
we do not re-export the pool; we construct a fresh `Pool` in the route using
the same `parseDbUrl` helper (or extract it to `src/lib/pg.ts` — plan
decides).

#### 3.1 Delete order (single transaction)

Inside `BEGIN ... COMMIT`:

1. `UPDATE profiles SET referred_by = NULL WHERE referred_by = $userId;`
   (blank the inviter link on anyone this user referred; do not delete them).
2. `DELETE FROM user_badges WHERE user_id = $userId;`
3. `DELETE FROM user_bookmarks WHERE user_id = $userId;`
4. `DELETE FROM push_subscriptions WHERE user_id = $userId;`
5. `DELETE FROM match_ratings WHERE user_id = $userId;`
6. `DELETE FROM feature_interest WHERE user_id = $userId;`
7. `DELETE FROM user_activity_log WHERE user_id = $userId;`
8. `DELETE FROM profiles WHERE id = $userId;`
9. `DELETE FROM sessions WHERE "userId" = $userId;`
10. `DELETE FROM accounts WHERE "userId" = $userId;`
11. `DELETE FROM users WHERE id = $userId;`

Notes:

- Steps 2–6 are defensive. Several of these tables already have
  `ON DELETE CASCADE` from `profiles(id)`, but explicit deletes (a) make the
  order unambiguous if anyone later changes the cascade, and (b) let us
  surface a clear error if one table blocks.
- The implementation must **not** assume a cascade exists — it must issue
  each delete. Before writing the route, the plan includes a step to run
  `\d+ table_name` on each of these tables against the current DB and note
  which have a cascade; any that do not must be deleted explicitly as
  listed. The spec's list is the superset that is correct regardless.
- `user_activity_log` is included (step 7) because the Auth.js migration
  (`20260415_authjs_tables.sql`) references it, even though the original
  scope prompt did not mention it. If the table does not exist in the
  target environment, the delete is a no-op; if it does exist, leaving
  rows behind would orphan user-attributable activity after the profiles
  row is gone.
- The `auth.users`-trigger migration from 2026-04-01 is no longer active
  (profiles FK dropped in the Auth.js migration). We delete from the `users`
  table (Auth.js-owned, in `public` schema), not `auth.users`.

#### 3.2 Response contract

- Success: `204 No Content`, empty body.
- Auth failure: `401` (reuses `getUserOrFail`).
- DB failure: `500 { error: string }`. Transaction is rolled back.

#### 3.3 Avatar in Supabase Storage

User avatars today come from Google's OAuth response and are stored only as
URLs on `profiles.avatar_url` — nothing is uploaded to Supabase Storage for
regular users. (The Storage `avatars` bucket documented in CLAUDE.md is for
*player* avatars, not user avatars.) So the delete endpoint has nothing to
clean up in Storage. If Phase 2 adds user avatar upload, the delete route
must be extended at that time; a comment in the route body should flag this.

### 4. GET `/api/user/export`

Route: `src/app/api/user/export/route.ts`
Method: GET
Auth: `getUserOrFail()`.

Returns a single `application/json` response with
`Content-Disposition: attachment; filename="padelnachos-export-YYYY-MM-DD.json"`.
Date is UTC, formatted `YYYY-MM-DD`.

#### 4.1 Bundle shape

```json
{
  "exported_at": "2026-04-17T14:23:00.000Z",
  "profile": {
    "id": "...",
    "display_name": "...",
    "avatar_url": "...",
    "preferred_country": "...",
    "referral_code": "...",
    "referred_by": "...",
    "marketing_opt_in": false,
    "created_at": "..."
  },
  "auth": {
    "email": "...",
    "provider": "google",
    "email_verified": "...",
    "name": "...",
    "image": "..."
  },
  "bookmarks": [
    { "bookmark_type": "match", "target_id": "...", "created_at": "..." }
  ],
  "push_subscriptions": [
    { "endpoint": "...", "created_at": "..." }
  ],
  "badges": [
    { "badge_id": "...", "tier": 1, "earned_at": "..." }
  ],
  "ratings": [
    { "match_id": "...", "rating": 4, "created_at": "..." }
  ],
  "referrals": {
    "invited_by": "user_id|null",
    "invited": ["user_id", "..."]
  },
  "feature_interest": [
    { "feature": "...", "created_at": "..." }
  ]
}
```

#### 4.2 Field derivations

- `auth.provider` comes from `SELECT provider FROM accounts WHERE "userId" = $1
  LIMIT 1`. If the user signed in via email magic-link only, `accounts` has
  no row — set `provider = "email"` in that case.
- `auth.email_verified` = `users."emailVerified"`.
- `push_subscriptions[].keys` (p256dh, auth) are **redacted** from the
  export. We export only `{ endpoint, created_at }`. Rationale: the
  keys are secrets that let a sender push notifications — there is no
  legitimate reason for the user to have them, and exporting them expands
  the blast radius of a leaked download.
- `referrals.invited` = `SELECT id FROM profiles WHERE referred_by = $1`.
- `referrals.invited_by` = `profile.referred_by` (the user's inviter).
- Every array can be empty; none of the joins are required for a valid
  export.

#### 4.3 Response contract

- Success: `200 application/json` with the filename header above, body is
  the JSON bundle.
- Auth failure: `401` (reuses `getUserOrFail`).
- DB failure: `500 { error: string }`. No partial downloads — we assemble
  the bundle in-memory and only then write the response.

#### 4.4 Size considerations

A user with 500 bookmarks + 50 badges + 200 ratings + 20 push subscriptions
is still well under 100 KB of JSON. We do not stream or paginate.

### 5. PATCH `/api/user/marketing-prefs`

Route: `src/app/api/user/marketing-prefs/route.ts`
Method: PATCH
Auth: `getUserOrFail()`.

Body:

```ts
{ optIn: boolean }
```

Behavior: `UPDATE profiles SET marketing_opt_in = $1 WHERE id = $userId`.

Response:

- Success: `200 { ok: true, marketing_opt_in: boolean }`.
- Validation failure (`optIn` missing or non-boolean): `400
  { error: 'Invalid optIn' }`.
- Auth failure: `401`.
- DB failure: `500 { error: string }`.

### 6. Read path for marketing opt-in state

The settings page needs to read the current value to render the toggle. We
add it to the existing `/api/user/profile` GET response (if there is no GET
yet, the plan adds one). The payload is small enough that we do not need a
dedicated endpoint.

## Types

```ts
// src/app/api/user/account/types.ts
// On success: HTTP 204 with no body (no success shape needed).
// On failure: the route returns one of these JSON payloads.
export type AccountDeleteErrorResponse = { error: string }

// src/app/api/user/export/types.ts
export interface UserExportBundle {
  exported_at: string
  profile: ProfileRow
  auth: { email: string | null; provider: string; email_verified: string | null; name: string | null; image: string | null }
  bookmarks: Array<{ bookmark_type: 'match' | 'player'; target_id: string; created_at: string }>
  push_subscriptions: Array<{ endpoint: string; created_at: string }>
  badges: Array<{ badge_id: string; tier: number; earned_at: string }>
  ratings: Array<{ match_id: string; rating: number; created_at: string }>
  referrals: { invited_by: string | null; invited: string[] }
  feature_interest: Array<{ feature: string; created_at: string }>
}

// src/app/api/user/marketing-prefs/types.ts
export type MarketingPrefsRequest = { optIn: boolean }
export type MarketingPrefsResponse =
  | { ok: true; marketing_opt_in: boolean }
  | { error: string }
```

## Migrations needed

### `supabase/migrations/20260417_profile_compliance.sql`

```sql
-- Marketing email opt-in flag. Default false — consent must be explicit.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketing_opt_in BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.marketing_opt_in IS
  'User consent for broadcast marketing emails. Set via /api/user/marketing-prefs. Default false (opt-in model).';
```

No other schema changes. Existing tables already have the correct cascade
rules for account deletion: `ON DELETE CASCADE` from `profiles.id` on
child tables, and `referred_by ON DELETE SET NULL` on the self-referential
FK. In theory we could rely on both cascades and just delete the
`profiles` row, but the route still issues the explicit `UPDATE
... SET referred_by = NULL` (step 1) and the explicit child deletes
(steps 2–6). This is defensive — if a future migration accidentally drops
or weakens a cascade, the route still leaves a clean state, and the
explicit ordering makes the delete trail legible to an auditor reading
the route.

## i18n

All new user-facing strings go under a new `settings` namespace in each of
`src/messages/{en,es,pt,it,fr}.json`. English strings below; other locales
are a single translation pass as a separate task in the Phase 1 plan (not
blocking for the initial merge — rows without translations render the
English fallback).

```json
{
  "settings": {
    "title": "Settings",
    "sections": {
      "account": "Account",
      "preferences": "Preferences",
      "privacy": "Privacy & data",
      "support": "Support"
    },
    "account": {
      "displayName": "Display name",
      "email": "Email",
      "activeSessions": "Active sessions",
      "comingSoon": "Coming soon",
      "editName": {
        "title": "Edit display name",
        "placeholder": "Your name",
        "save": "Save",
        "cancel": "Cancel",
        "savedToast": "Name updated"
      }
    },
    "preferences": {
      "language": "Language",
      "region": "Region",
      "regionHint": "Used to show local broadcasters and content.",
      "push": "Push notifications",
      "pushHint": "Get notified when bookmarked matches go live"
    },
    "privacy": {
      "policy": "Privacy policy",
      "terms": "Terms of service",
      "analytics": "Share anonymous usage data",
      "analyticsHint": "Help improve PadelNachos. Toggle off to opt out.",
      "marketing": "Marketing emails",
      "marketingHint": "Occasional updates about new features and tournaments.",
      "exportData": "Download my data",
      "exportDataHint": "Get a JSON file of everything we have about you.",
      "deleteAccount": "Delete my account",
      "deleteAccountHint": "Permanently remove your account and data."
    },
    "support": {
      "contact": "Contact support",
      "about": "About PadelNachos"
    },
    "signOut": "Sign out",
    "deleteModal": {
      "title": "Delete your account?",
      "body": "This permanently removes your profile, bookmarks, badges, ratings, and sign-in methods. This cannot be undone.",
      "continue": "Continue",
      "cancel": "Cancel",
      "confirmPrompt": "Type DELETE to confirm",
      "confirmWord": "DELETE",
      "confirmButton": "Delete forever",
      "errorGeneric": "Could not delete account. Please try again or contact support."
    }
  }
}
```

## Data orientation / ordering rationale

See section 2.1 for the in-page section order. Short version: start
high-frequency / low-risk (Account, Preferences), escalate to Privacy & Data
once the user is past the cheap surface, then park Support and Sign out at
the bottom so the destructive and the "I need help" options are both visibly
fenced off from the everyday controls. This matches the pattern iOS and
Android settings both use.

Within Privacy & Data, the row order itself is also intentional:

1. Policy (read-only link)
2. Terms (read-only link)
3. Analytics toggle (mutates local state only)
4. Marketing toggle (mutates profiles row)
5. Export (read-only data pull)
6. Delete (destructive)

The two read-only links come first because they are what regulators expect
the user to be able to find in two taps. Toggles (reversible) are in the
middle. Delete is last, because once tapped and confirmed it cannot be
undone — it should live next to the bottom-of-page sign-out, which has a
similar "this ends your session" character.

## Testing strategy

### Automated (added in the plan)

- **Vitest unit tests:**
  - `src/lib/export-bundle.ts` (pure bundle assembler, extracted from the
    route handler): verifies redaction of push subscription keys, verifies
    empty-user bundle shape, verifies filename date formatting.
  - `src/lib/delete-plan.ts` (pure function that returns the ordered list
    of SQL statements given a user ID): verifies the step order and that
    `referred_by` nulling precedes `profiles` delete.
- **API integration tests (vitest + pg test schema):** skip for v1. These
  would require a test DB harness we do not have. Flag in the plan as
  follow-up.

### Manual QA checklist

- [ ] Gear icon on `/profile` navigates to `/profile/settings`.
- [ ] Every settings row renders at 500px-wide mobile viewport.
- [ ] Display name edit sheet saves, toast shows, `/profile` header
  reflects new name immediately.
- [ ] Language switcher changes the app locale from the settings page.
- [ ] Region picker updates `profiles.preferred_country` and is consistent
  with the current `/profile` region block.
- [ ] Push notifications toggle subscribes / unsubscribes (verify via
  `push_subscriptions` table in Supabase).
- [ ] Privacy and Terms links open in-app (not external) and route to
  correct pages in all 5 locales.
- [ ] Analytics opt-out: toggle on, reload, confirm no `va.js` request in
  Network tab. Toggle off, reload, confirm `va.js` loads again.
- [ ] Marketing toggle flips `profiles.marketing_opt_in` in DB.
- [ ] `GET /api/user/export` downloads a valid JSON file. Open it — confirm
  bookmarks, badges, and ratings match Supabase reality; confirm push
  `keys` are absent.
- [ ] `DELETE /api/user/account` on a test user wipes every row listed in
  3.1. Verify with SQL `SELECT count(*) FROM <each table> WHERE <user
  key> = $uid` — all zero. Also verify the test user can no longer sign
  in (Google redirect makes a new account instead of restoring).
- [ ] Delete modal requires typing `DELETE` — final button disabled until
  typed.
- [ ] Delete flow signs the user out and redirects to `/home?deleted=1`.
- [ ] Contact support `mailto:` opens the default mail app.
- [ ] About link routes to `/about`.
- [ ] Sign out at the bottom of settings works and redirects to `/home`.

### Security review checkpoints (in plan)

- Confirm `getUserOrFail` is the first thing both new endpoints do before
  any DB access. No path reaches a SQL query without a user id.
- Confirm the delete transaction is actually a transaction (single
  `pool.connect()` / `BEGIN` / `COMMIT` / rollback on error). A series of
  `supabase.from(...).delete()` calls is **not** transactional and must not
  be used for this endpoint.
- Confirm export does not leak other users' data — every query must be
  scoped by `user_id = $userId` or `id = $userId`, including the
  `referrals.invited` query.

## Rollout plan

1. Merge migration `20260417_profile_compliance.sql` first (additive —
   safe to deploy before any code reads it, because `marketing_opt_in`
   has a default).
2. Merge the new endpoints (`/api/user/account`, `/api/user/export`,
   `/api/user/marketing-prefs`) and the `GatedAnalytics` component
   together. Analytics gating is the highest-risk swap — verify in
   production that `va.js` still loads for a fresh opt-in user.
3. Merge the settings page and the gear icon on `/profile`.
4. Announce in the #launches Slack channel (not customer-facing yet; we do
   not ship a blog post for Phase 1, because Phase 2 will redesign the
   whole profile and that is the right moment to tell users).
5. Run a manual QA pass on a staging environment using a throwaway Google
   account — full end-to-end including creating, bookmarking,
   exporting, and deleting. Capture the export JSON and attach to the
   Notion QA ticket.

## Open questions

None. Clarifications resolved inline during spec drafting:

- **"which is the correct Auth.js table name — `auth.users` or `users`?"**
  → `users` (public schema), per migration `20260415_authjs_tables.sql`.
- **"is the push subscriptions table `push_subscriptions` or
  `user_push_subscriptions`?"** → `push_subscriptions`, per migration
  `20260401_user_auth.sql`.
- **"does the current profile handle avatar upload?"** → No. The prompt's
  "the existing /profile already handles this" was incorrect. Avatar
  upload is deferred to Phase 2 and noted in Non-goals.
- **"do we need a DB column for analytics opt-out?"** → No. Browser-only
  localStorage is sufficient and avoids an auth dependency on the
  tracker.
