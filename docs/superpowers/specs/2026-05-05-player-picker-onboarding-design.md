# Player picker onboarding — design

**Date:** 2026-05-05
**Status:** Approved (brainstorming)

## Background

User feedback: "some of my followed players are not showing up." The current onboarding is a 3-step spotlight coachmark ([`SpotlightCoachmarks.tsx`](../../../src/components/SpotlightCoachmarks.tsx)) that points at the search bar, Following tab, and profile button on home. It is passive — users finish the tour with zero followed players, no value created. NN/g and modern app conventions both push toward action-oriented, "pick your favorites" patterns (Spotify, LiveScore, Twitter) over tour-style coachmarks.

We also have a probable contributing bug to the "not showing up" feedback: [`useFollowing.ts`](../../../src/hooks/useFollowing.ts) loads from DB and replaces the in-memory store on sign-in without merging localStorage follows. An anonymous user who follows players, then signs in, can lose the in-UI list.

## Goals

1. New users land on a personalized home (live matches, news) on their first session — not an empty shell.
2. Returning users with follows do not see onboarding.
3. Following page becomes the **evergreen discovery surface** — empty-state-friendly, search-free for top players, and works across devices/sessions for users who clear cache or switch.
4. Anonymous follows survive sign-in (the migration bug).
5. Existing user-facing copy is i18n-ready across 5 locales.

## Non-goals

- Trending / most-followed players (needs follower-aggregation infra).
- Tournament/team picker.
- Personalized suggestions from view behavior.
- Replacing the existing `useFollowing` storage model.

## User flow

```
First-launch (new device, no follows, no picker flag)
  → /welcome (player picker)
  → Continue
  → Notification permission sheet (one prompt)
  → Home (personalized: Live now, Today's matches, News about your players)

Skip from picker
  → pn_picker_done set
  → Home (un-personalized; "Pick favorites" entry remains in profile menu)

Returning user (pn_picker_done OR pn_onboarding_done already set)
  → Home as today (no picker, no coachmark)
```

The 3-step coachmark is removed. Step 3 (badges) becomes a just-in-time hint surfaced the first time a badge is earned (out of scope for this work — track separately).

## Surfaces

### 1. Picker — `/welcome` (localized route)

Full-screen, single focused job. Next.js route under `src/app/[locale]/(app)/welcome/page.tsx`.

- **Header:** brand logo, title "Who do you follow?", subtitle "Pick at least one player to personalize your scores, news, and notifications."
- **Search affordance:** opens existing [`SearchOverlay`](../../../src/components/nav/SearchOverlay.tsx) for users wanting a specific player not in the suggested set.
- **Content:** single grid of top 30 players, **mixed (men + women)**, sorted by `players.ranking` ASC. Country-boost: players matching the user's `geo-country` cookie are sorted to the top of the list before global ranking takes over. Sectioned visually as "Top in {Country}" + "Top Worldwide" if a country boost is active; single "Top players" header if not.
- **Cards:** avatar, name, country pill (text, not flag emoji), ranking. Tap toggles selection (green border + checkmark badge + slight scale-down).
- **Sticky bottom CTA:** Skip (always available) + Continue (disabled at 0 picks; enabled with count badge at 1+). Soft hint copy at 1–2 picks: "Pick a couple more for better recommendations."
- **Submit:** writes each pick via `useFollowing.toggle('player', id)` with a new `silent: true` option (see Technical) so we don't fire 5 stacked bookmark toasts. Sets `pn_picker_done='1'`.

### 2. Notification permission sheet

Bottom sheet, fires once after Continue, before navigating to home. Only shown if:
- Browser `Notification.permission === 'default'`
- `pn_push_prompted` not set

Copy:
> **Never miss a match**
> Get notified when {first 2–3 picks by name} go live or play in a final.
> [ Enable notifications ] [ Maybe later ]

Either button sets `pn_push_prompted='1'`. Enable triggers `Notification.requestPermission()` then proceeds. Maybe later proceeds without prompting. After this sheet, navigate to home.

If picker is skipped (no picks), this sheet does NOT fire — no value framing exists yet.

### 3. Welcome strip on home

After the picker completes, the home page shows a one-line strip at the top:

> Welcome to PadelNachos · Following N players · Sign in anytime to keep them across devices

Auto-fades after 24h (`pn_welcome_strip_dismissed` timestamp + comparison) or on close-button tap. Anonymous users only — hidden once authenticated.

### 4. Following page redesign

Same as v3/v4 mockups, no further changes:
- "Suggested for You" / "Top players" marquee row(s) — continuous auto-scroll, ~32s loop, pause on hover/touch, edge mask gradient, `prefers-reduced-motion` fallback.
- Inline +Follow buttons on each card. One tap toggles via existing `useFollowing.toggle`.
- Country-boosted ranking same as picker.
- Always present — works as evergreen discovery, including for users who skipped the picker.

### 5. Login CTA sheet

Already partially exists as the bookmark toast push CTA. Add a new sheet variant that fires for anonymous users when **either** condition first becomes true:
- 3+ follows total (`counts.match + counts.player + counts.tournament >= 3`)
- 24h since first session AND 1+ follows

Copy:
> **Save your favorites**
> You're following N players. Sign in to keep them across devices and never lose them.
> [ Maybe later ] [ Sign in ]

Sets `pn_login_cta_shown` (or per-trigger flag) so we don't re-fire. Authenticated users never see it.

## Bug fix folded into this work

In [`useFollowing.ts`](../../../src/hooks/useFollowing.ts) `load()`, when `userId` flips from null → set (sign-in), merge localStorage follows into the DB before reading back:

```
On first sign-in (or first load with userId after anonymous activity):
  1. Read localStorage follows
  2. For each (type, id) not already present in DB → POST /api/user/bookmarks
  3. Then read merged result from DB and populate the store
  4. Clear localStorage follows once migration is confirmed (set a `pn_migrated_to_user_<userId>` flag to avoid re-running)
```

Edge cases:
- DB write fails → keep localStorage as fallback, retry on next session.
- User signs out → DO NOT delete DB rows; leave localStorage seeded from the last DB read so they have continuity.
- Multiple devices: each device's first sign-in does its own merge; UNIQUE constraint on `user_bookmarks (user_id, bookmark_type, target_id)` makes this safe.

## Technical

### Routing & gating

- **`src/app/[locale]/(app)/welcome/page.tsx`** — picker page. Localized via existing next-intl conventions.
- **Redirect handled client-side**, NOT in `src/proxy.ts`. localStorage isn't readable from the proxy and a cookie sync adds moving parts for no benefit. The home page reads `pn_picker_done` from localStorage in a top-level `useEffect` and calls `router.replace('/welcome')` if absent (and user is anonymous, and `?ref=` is not present — referral banner takes precedence; the picker shows after the banner is dismissed, mirroring the existing coachmark gating logic in [`SpotlightCoachmarks.tsx`](../../../src/components/SpotlightCoachmarks.tsx) lines 105–129).
- **Existing-user gate:** if `pn_onboarding_done='1'` exists in localStorage (from old coachmark), set `pn_picker_done='1'` synthetically so they're never shown the picker. One-time migration on first load.

### Picker writes

Add a `silent` option to `useFollowing.toggle`:
```ts
toggle(type, targetId, { silent?: boolean }) // default false
```
When `silent: true`:
- Skip the BOOKMARK_EVENT toast dispatch.
- Skip the per-follow push CTA (the consolidated sheet handles it).
- Still updates store + persists to localStorage / DB.

The picker's Continue handler iterates picks calling `toggle('player', id, { silent: true })` for each.

### Country boost

Country comes from the existing `geo-country` cookie (set in [`src/proxy.ts`](../../../src/proxy.ts)). When fetching the top 30:
- `SELECT ... FROM players WHERE ranking IS NOT NULL ORDER BY ranking ASC LIMIT 60`
- Client-side: stable-sort the result, moving country matches to the top while preserving relative ranking among themselves and among the rest.
- Trim to 30 after the boost.

If `geo-country` is missing, no boost — single "Top players" header.

### Coachmark removal

Delete [`SpotlightCoachmarks.tsx`](../../../src/components/SpotlightCoachmarks.tsx) and remove its mount point from layout. Remove `data-coachmark` attributes scattered in the home page. Translation keys under `onboarding.*` in `src/messages/{en,es,pt,it,fr}.json` get removed alongside (or kept as no-ops if other code references them — verify).

### Notification prompt

Reuse browser-native `Notification.requestPermission()`. The sheet component lives at `src/components/onboarding/NotificationPromptSheet.tsx`. State managed locally in the picker page — sheet is shown after Continue, dismisses after a tap on either button, then triggers `router.push('/')`.

### i18n

All new copy in `src/messages/{en,es,pt,it,fr}.json` under `picker.*` and `home.welcomeStrip.*`. Keys to follow existing conventions (descriptive paths, ICU plurals where appropriate for "{N} players").

## Data sources

| Data | Source |
|---|---|
| Top players list | `supabase.from('players').select(...).not('ranking', 'is', null).order('ranking', { ascending: true }).limit(60)` |
| Country boost | `geo-country` cookie set in `src/proxy.ts` |
| User's follows | `useFollowing` hook (existing dual-mode) |
| Auth state | `useAuth` hook (existing) |

## Out of scope

- **Trending players** — needs follower-count aggregation, query, and cache. Defer.
- **Tournament/team picker** — players only for v1. The Following page already supports tournament follows; revisit if the player picker validates the pattern.
- **JIT badge hint** (replacement for old coachmark step 3) — track as separate work.
- **Picker re-prompt for skippers** — not in v1. They can opt in via profile menu entry.

## Acceptance criteria

- [ ] New user landing on `/` for the first time is redirected to `/welcome`.
- [ ] Picker shows top 30 mixed-ranking players, country-boosted if `geo-country` is set.
- [ ] Selecting players + tapping Continue persists them via `useFollowing` without firing per-follow toasts.
- [ ] Notification prompt sheet appears once after Continue (only when `Notification.permission === 'default'`), then user lands on home.
- [ ] Skip from picker sets `pn_picker_done`, does NOT fire notification sheet, lands on home.
- [ ] Home page shows personalized sections (Live now, Today's matches, News) populated by the picks.
- [ ] Welcome strip on home auto-fades after 24h.
- [ ] Login CTA bottom sheet fires for anonymous users at 3+ follows OR 24h+1 follow, never re-fires.
- [ ] Following page shows continuous auto-scroll Suggested marquee row, pauses on hover/touch, has edge fade, respects `prefers-reduced-motion`.
- [ ] Anonymous user who picks 3 players, then signs up: all 3 picks present in DB after sign-in. localStorage cleared/marked migrated.
- [ ] Existing users (`pn_onboarding_done='1'`) never see the picker.
- [ ] All new copy localized in 5 locales.
- [ ] `SpotlightCoachmarks` component, its mount, and unused i18n keys are removed.
