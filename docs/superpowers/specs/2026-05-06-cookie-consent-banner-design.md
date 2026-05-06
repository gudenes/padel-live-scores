# Cookie consent banner — design

**Date:** 2026-05-06
**Status:** Approved (brainstorming)

## Background

PadelNachos runs PostHog (product analytics, reverse-proxied via `/ingest/*`), Vercel Analytics (feature usage), and Sentry (error tracking) on every visitor today. The app already has a private opt-out flag (`pn_analytics_opt_out` localStorage, read by `GatedAnalytics`) but no banner asks the user — so the opt-out is invisible to the 99% of visitors who don't dig into settings.

This is a foundational gap: ePrivacy/GDPR requires affirmative consent for non-essential cookies and persistent identifiers in the EU/UK; CCPA + LGPD have analogous "do not sell / do not track" obligations elsewhere. Beyond compliance, it's a prerequisite for the upcoming anonymous-push feature, which depends on a persistent device identifier the user must opt into.

## Goals

1. First-time visitors see a clear consent banner with **Reject all / Customize / Accept all**.
2. Users can change their mind via a dedicated re-prompt path (clearing localStorage in v1; a settings page later).
3. Existing analytics, error tracking, and (next spec) push subscriptions are gated through a single `useConsent()` hook — no scattered consent checks.
4. Existing users who already opted out via the legacy `pn_analytics_opt_out` flag are NOT re-prompted; their preference is migrated cleanly.
5. Banner is visible everywhere — including the `/welcome` picker — until the user decides.
6. Re-consent prompt 12 months after the last decision (industry-standard cadence; matches what Spotify / Strava / FotMob do).

## Non-goals

- Per-cookie disclosure ("PostHog stores `distinct_id`, `ph_session_id`, `ph_*`...") — out of scope for v1; the privacy page can list cookies textually if needed.
- Geo-aware visibility (EU-only). Banner shows globally — single code path, defensible across jurisdictions.
- Dedicated `/consent` settings page. Useful follow-up but v1 only requires clearing localStorage to retrigger.
- Pre-ticked consent toggles. Auditors flag this as non-compliant.

## User flow

```
First visit (no pn_consent in localStorage)
  → Banner appears at bottom of viewport, non-blocking
  → User can interact with the app freely while it's there
  → User taps Accept all  → all categories on, banner hides
  → User taps Reject all  → only Essential, banner hides
  → User taps Customize   → bottom sheet with 3 toggles → Save → banner hides
  → User ignores / closes → banner reappears next visit

After decision (pn_consent.decided_at set)
  → Banner stays hidden for 12 months
  → 12 months elapsed → banner re-shows with previous choices pre-selected
  → User adjusts → save refreshes decided_at

Existing user with pn_analytics_opt_out='1' (legacy)
  → On first useConsent() read, seed pn_consent = { analytics: false, push: false, decided_at: <now> }
  → Banner does NOT show (consent is implicitly recorded)
  → pn_analytics_opt_out kept untouched as fallback (don't break GatedAnalytics during the migration window)
```

## Architecture

### Single source of truth: `pn_consent` localStorage entry

```ts
interface ConsentState {
  analytics: boolean   // PostHog, Vercel Analytics, Sentry
  push: boolean        // Anon device ID + push subscriptions (covered by Spec 2)
  decided_at: string   // ISO timestamp; re-prompt threshold = 12 months
}
```

Essential is always implicit (auth session, `NEXT_LOCALE`, `geo-country`, `geo-timezone`, picker / follow flags). Never written, never togglable.

### Files

**New:**
- `src/hooks/useConsent.ts` — read/write hook + helper booleans
- `src/components/consent/ConsentBanner.tsx` — bottom banner with three buttons
- `src/components/consent/ConsentCustomizeSheet.tsx` — bottom sheet with toggle rows
- `src/messages/{en,es,pt,it,fr}.json` — new `consent.*` namespace

**Modified:**
- `src/app/[locale]/layout.tsx` — mount `<ConsentBanner />` globally (visible on `/welcome` and everywhere else)
- `src/components/GatedAnalytics.tsx` — replace private `pn_analytics_opt_out` check with `useConsent().isAnalyticsAllowed()`. Add legacy migration on first read.
- `src/components/PostHogIdentify.tsx` — gate PostHog init on `useConsent().isAnalyticsAllowed()`. If consent flips, call `posthog.opt_out_capturing()` / `posthog.opt_in_capturing()`.
- `src/app/layout.tsx` — Sentry init wrapped to be a no-op when analytics is rejected. Implementation detail: lazy-init Sentry inside a useEffect gated on consent.

### `useConsent` hook surface

```ts
export function useConsent(): {
  consent: ConsentState | null    // null = no decision yet
  hasDecided: boolean              // true if decided_at < 12 months old
  setConsent: (next: Partial<ConsentState>) => void
  isAnalyticsAllowed: () => boolean // false if consent === null OR analytics === false
  isPushAllowed: () => boolean      // same shape
}
```

`hasDecided` and the gates default to **false** during SSR and on the first client render (before localStorage is read). This matches the existing `GatedAnalytics` pattern: no tracker on first paint, then flip after the effect reads localStorage. No hydration mismatch because server-rendered HTML never contains tracker markup.

## Components

### `ConsentBanner.tsx`

- Position: `position: sticky` (`.app-screen` `contain: paint` workaround applies — same trick the welcome CTA uses) at `bottom: 0`, full width up to the 500px max.
- Mounts globally; only renders when `!hasDecided` (and after client-side hydration so we don't flash for users who already decided).
- Brand-matched chunky card style: dark gradient background, green accent buttons, clipPath polygon edges.
- Three buttons: **Reject all** (ghost / muted) · **Customize** (text-link) · **Accept all** (green primary).
- Privacy Policy link (existing `/privacy` page) embedded in the body copy.

### `ConsentCustomizeSheet.tsx`

- Modal bottom sheet (matches `NotificationPromptSheet` pattern).
- Three toggle rows:
  1. **Essential** — locked on, info text "Sign-in, language, your saved follows"
  2. **Analytics** — toggleable, "Helps us improve the app. PostHog + Vercel Analytics + Sentry error reports."
  3. **Push notifications** — toggleable, "Receive live-match alerts on this device, even without signing in."
- Save button at the bottom; Cancel button as ghost.
- Saving writes to `pn_consent` and dismisses.

## Subsystem gating

| Subsystem | Gate | Behaviour when off |
|---|---|---|
| Auth session, locale, geo cookies, picker / follow flags | Essential — always on | n/a |
| PostHog (`posthog-js`) | Analytics | `posthog.opt_out_capturing()`; PostHogIdentify is a no-op |
| Vercel Analytics (`@vercel/analytics`) | Analytics | `<Analytics />` not rendered (existing pattern) |
| Sentry (`@sentry/nextjs` client) | Analytics | Lazy-init skipped; existing initial config remains for SSR error reporting on the server (NEVER ships browser fingerprint to Sentry) |
| Anon push device ID + subscription (Spec 2) | Push | Spec 2 will detail. Short version: anon-push registration only fires if `isPushAllowed()` |
| Authenticated push subscriptions (existing) | Push | Already user-gated; consent gate becomes the user-facing override |

## Copy

Single source of truth in `src/messages/{locale}.json` under `consent.*`. English source:

```json
"consent": {
  "title": "We use cookies",
  "body": "We use cookies to improve scores and rankings, understand how people use the app, and (soon) send you live-match alerts on devices you choose.",
  "privacyLink": "Read our Privacy Policy",
  "rejectAll": "Reject all",
  "customize": "Customize",
  "acceptAll": "Accept all",
  "customizeTitle": "Manage cookies",
  "customizeSave": "Save preferences",
  "customizeCancel": "Cancel",
  "categories": {
    "essential": {
      "label": "Essential",
      "lockedNote": "Always on",
      "description": "Sign-in, language, and your saved follows."
    },
    "analytics": {
      "label": "Analytics",
      "description": "PostHog, Vercel Analytics, and Sentry error reports. Helps us improve the app."
    },
    "push": {
      "label": "Push notifications",
      "description": "Receive live-match alerts on this device, even without signing in."
    }
  }
}
```

All keys translated to es / pt / it / fr.

## Storage shape & migration

### `pn_consent` (new)

```json
{
  "analytics": false,
  "push": true,
  "decided_at": "2026-05-06T18:00:00Z"
}
```

Written via `JSON.stringify`, parsed via `JSON.parse` in a try/catch (corrupt entries are treated as "no decision yet").

### Legacy migration

On first read of `useConsent`:

1. If `pn_consent` exists and parses → use it.
2. Else if `pn_analytics_opt_out === '1'` → seed `pn_consent = { analytics: false, push: false, decided_at: <now> }`. Write it. Banner does not appear for these users.
3. Else → return null. Banner appears.

`pn_analytics_opt_out` is left untouched (don't risk breaking `GatedAnalytics` during the rollout window). A follow-up cleanup PR can remove it once `useConsent` is deployed and verified.

## Re-consent at 12 months

`hasDecided` returns true when:
- `pn_consent.decided_at` is present AND
- `Date.now() - new Date(decided_at).getTime() < 365 * 24 * 60 * 60 * 1000`

When the threshold lapses, `hasDecided` becomes false → banner re-shows. The banner pre-fills its toggles with the previous `pn_consent` values; on save, `decided_at` refreshes to today.

## i18n

All banner / sheet copy in 5 locales. Following the project's next-intl convention: descriptive paths, ICU plurals only if needed (none expected here).

## Acceptance criteria

- [ ] First-time visitor sees the consent banner at the bottom of every page including `/welcome`.
- [ ] Tapping **Accept all** writes `{ analytics: true, push: true, decided_at: now }` and hides the banner.
- [ ] Tapping **Reject all** writes `{ analytics: false, push: false, decided_at: now }` and hides the banner.
- [ ] Tapping **Customize** opens the sheet with 3 rows; Essential is locked on. Saving writes the chosen values and hides both UIs.
- [ ] After any decision, banner stays hidden for 12 months from `decided_at`.
- [ ] Banner reappears 12 months later with previous values pre-selected.
- [ ] User with legacy `pn_analytics_opt_out='1'` does NOT see the banner; their settings are migrated as analytics+push false.
- [ ] PostHog and Vercel Analytics are not initialised when `analytics === false`.
- [ ] Sentry browser-side errors are not reported when `analytics === false` (server-side error reporting is unaffected).
- [ ] All banner / sheet copy localised in 5 locales.
- [ ] Banner is positioned with `position: sticky` so it works inside the `.app-screen` `contain: paint` wrapper.
- [ ] Privacy Policy link in the banner navigates to `/privacy`.
