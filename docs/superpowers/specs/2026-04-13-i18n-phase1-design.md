# i18n Phase 1 — Design Spec

**Date:** 2026-04-13
**Status:** Approved for implementation

## Overview

Add internationalization to PadelNachos using `next-intl` with Next.js 16 App Router. Phase 1 covers English (default) + Spanish with ~200 UI strings, locale-aware URL routing, a language switcher in the header, and locale-aware date/number formatting.

**Core goal:** Spanish-speaking padel fans can use PadelNachos in their native language, with clean `/es/` URL prefixes and automatic browser language detection.

## Scope

### In scope
- `next-intl` library integration with Next.js 16
- Two locales: `en` (default), `es` (Spanish)
- `localePrefix: 'as-needed'` — no prefix for English, `/es/` for Spanish
- ~200 UI string translations (AI-generated Spanish, human-reviewed)
- Language switcher (EN/ES pill) in app header
- Proxy composition with existing auth/redirect/cookie logic
- Folder restructure: pages move into `[locale]` dynamic segment
- Date/number formatting: swap 37 hardcoded `en-US` calls to locale-aware
- SEO: `<html lang>` attribute, hreflang alternate links

### Out of scope
- PadelGenius questions (~2,500 strings — not live, Phase 2)
- Additional languages (Italian, French, Portuguese — Phase 3)
- Article/video title translation (external source content)
- API routes, ops dashboard, auth pages (stay English-only)
- Translation management system (POEditor/Tolgee — not needed for 2 locales)
- Right-to-left support

## Architecture

### File structure

```
src/
  i18n/
    routing.ts              # defineRouting config (locales, prefix strategy)
    request.ts              # getRequestConfig for server-side message loading
    navigation.ts           # Locale-aware Link, redirect, useRouter, usePathname
  messages/
    en.json                 # English strings (~200 keys)
    es.json                 # Spanish strings (AI-translated)
  app/
    [locale]/               # NEW dynamic segment wrapping all user-facing pages
      layout.tsx            # Root layout with NextIntlClientProvider + <html lang>
      (app)/                # Existing app group (moves from src/app/(app)/)
        home/page.tsx
        matches/page.tsx
        following/page.tsx
        feed/page.tsx
        rankings/page.tsx
        achievements/page.tsx
        profile/page.tsx
        padelgenius/page.tsx
        tournaments/[id]/page.tsx
        feed/article/[id]/page.tsx
        layout.tsx          # Existing (app) layout (BottomNav, BadgeToast)
      match/[id]/page.tsx
      player/[id]/page.tsx
      privacy/page.tsx
      terms/page.tsx
    api/                    # Stays outside [locale] — not localized
    ops/                    # Stays outside [locale] — admin, English-only
    auth/                   # Stays outside [locale]
  proxy.ts                  # Composed: custom logic + next-intl middleware
  components/
    LocaleSwitcher.tsx      # EN/ES pill for app header
```

### Routing config

```typescript
// src/i18n/routing.ts
import { defineRouting } from 'next-intl/routing'

export const routing = defineRouting({
  locales: ['en', 'es'],
  defaultLocale: 'en',
  localePrefix: 'as-needed',  // /home for English, /es/home for Spanish
})
```

### Navigation helpers

```typescript
// src/i18n/navigation.ts
import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

export const { Link, redirect, usePathname, useRouter } = createNavigation(routing)
```

All internal `<Link>` components and `useRouter().push()` calls must be updated to use these locale-aware versions instead of the Next.js defaults.

### Server-side message loading

```typescript
// src/i18n/request.ts
import { getRequestConfig } from 'next-intl/server'
import { routing } from './routing'
import { hasLocale } from 'next-intl'

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale
  if (!hasLocale(routing.locales, locale)) {
    locale = routing.defaultLocale
  }
  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
```

## Proxy Composition

The existing `proxy.ts` handles auth redirects, ops auth, legacy routes, geo cookies, and invite refs. The composed flow:

```
Request arrives
  → Pre-i18n (short-circuit before locale routing):
    1. Auth param rescue → redirect to /auth/callback
    2. Ops dashboard auth → cookie check, return 401 or next()
    3. Legacy /v3/* redirects → redirect to new paths
  → next-intl locale routing:
    4. Detect locale from URL prefix / cookie / Accept-Language header
    5. Rewrite request to /[locale]/... internally
  → Post-i18n (decorate response):
    6. Set geo-country cookie
    7. Set invite ref cookie
```

### Key decisions

- **Root `/` redirect removed** — `next-intl` handles `/` by detecting locale and routing to the home page. The `localePrefix: 'as-needed'` config means English users land on `/home`, Spanish users on `/es/home`.
- **Ops dashboard skips i18n** — `pathname.startsWith('/ops')` returns before `handleI18nRouting` runs.
- **API routes excluded** — `config.matcher` already excludes `/api/`.
- **Legacy redirects run before i18n** — `/v3/scores` → `/matches`, then `next-intl` handles locale on the redirected URL.

## URL Structure

| Locale | URL | Behavior |
|--------|-----|----------|
| English (default) | `/home`, `/matches`, `/match/abc` | No prefix |
| Spanish | `/es/home`, `/es/matches`, `/es/match/abc` | `/es/` prefix |
| Root `/` | Detect from browser `Accept-Language` | Redirect to `/home` or `/es/home` |
| English explicit | `/en/home` | Redirects to `/home` (superfluous prefix removed) |

## Translation Message Structure

```json
// src/messages/en.json
{
  "nav": {
    "home": "Home",
    "matches": "Matches",
    "following": "Following",
    "feed": "Feed"
  },
  "matches": {
    "live": "Live",
    "upcoming": "Upcoming",
    "results": "Results",
    "noLive": "No live matches right now",
    "noUpcoming": "No upcoming matches",
    "noResults": "No recent results",
    "filterHint": "Try switching the league filter to see {league} or All matches.",
    "loadMore": "Load more ({count} remaining)",
    "viewPreviousSeasons": "View previous seasons"
  },
  "matchDetail": {
    "matchDetail": "Match Detail",
    "round": "Round",
    "court": "Court",
    "timezone": "Timezone",
    "tournament": "Tournament",
    "startsIn": "Starts in",
    "estimatedStartIn": "Estimated start in",
    "startingSoon": "Starting soon",
    "startTimeTbd": "Start time TBD",
    "timeEstimated": "Time is estimated — actual start may vary",
    "aboutToStart": "Match is about to start",
    "scheduleAvailable": "Schedule will be updated when available"
  },
  "prediction": {
    "whoTakesIt": "Who takes it?",
    "tapThePair": "Tap the pair you fancy",
    "yourPick": "Your pick",
    "howDoesItEnd": "How does it end?",
    "straightSets": "Straight sets",
    "threeSetBattle": "Three-set battle",
    "yourPrediction": "Your prediction",
    "win": "{pair} win {margin}",
    "change": "Change",
    "whatOthersThink": "What others think",
    "fansHavePredicted": "{count} fans have predicted",
    "withMajority": "You're with the majority",
    "boldPick": "Bold pick!",
    "predict": "predict",
    "locked": "Predictions are locked once the match starts",
    "spotOn": "Spot on!",
    "calledIt": "{pair} won {margin} — just as you called it",
    "closeCall": "Close call",
    "rightPairWrongMargin": "Right pair, wrong margin",
    "wrongMarginThree": "You picked the right pair but it went to three sets instead of two",
    "wrongMarginTwo": "You picked the right pair but it was a straight-sets win instead",
    "notThisTime": "Not this time",
    "youBacked": "You backed {picked} but {winner} pulled through {margin}",
    "nailedIt": "Nailed it",
    "predicted": "Predicted"
  },
  "rankings": {
    "rankings": "Rankings",
    "official": "Official",
    "race": "Race",
    "loadingRankings": "Loading rankings...",
    "noRankings": "No rankings yet",
    "noRaceRankings": "No race rankings yet",
    "noResults": "No results for \"{query}\"",
    "rank": "Rank",
    "player": "Player",
    "points": "Points",
    "men": "Men",
    "women": "Women"
  },
  "feed": {
    "feed": "Feed",
    "videos": "Videos",
    "news": "News",
    "saved": "Saved",
    "justNow": "Just now",
    "hoursAgo": "{count}h ago",
    "daysAgo": "{count}d ago",
    "weeksAgo": "{count}w ago",
    "yesterday": "Yesterday"
  },
  "profile": {
    "profile": "Profile",
    "signOut": "Sign out",
    "signIn": "Sign in",
    "achievements": "Achievements",
    "bookmarks": "Bookmarks",
    "following": "Following",
    "loading": "Loading your profile..."
  },
  "badges": {
    "badgeUnlocked": "Badge Unlocked",
    "welcome": "Welcome",
    "welcomeDesc": "Create your PadelNachos account and join the community.",
    "foundingMember": "Founding Member",
    "foundingMemberDesc": "Joined PadelNachos within the first 30 days of launch. A rare badge for the originals.",
    "geniusInsider": "Genius Insider",
    "geniusInsiderDesc": "Signed up for PadelGenius early access.",
    "alwaysConnected": "Always Connected",
    "alwaysConnectedDesc": "Enabled push notifications to never miss a match.",
    "scout": "Scout",
    "scoutDesc": "Follow your favourite players to track their journey.",
    "globeTrotter": "Globe Trotter",
    "globeTrotterDesc": "Follow tournaments around the world.",
    "matchTracker": "Match Tracker",
    "matchTrackerDesc": "Bookmark matches to keep them on your radar.",
    "matchCritic": "Match Critic",
    "matchCriticDesc": "Rate matches to help the community find the best ones.",
    "newsJunkie": "News Junkie",
    "newsJunkieDesc": "Stay up to date with padel news and stories.",
    "highlightReel": "Highlight Reel",
    "highlightReelDesc": "Watch padel highlights and best moments.",
    "megaphone": "Megaphone",
    "megaphoneDesc": "Share PadelNachos with your padel friends.",
    "dailyDevotee": "Daily Devotee",
    "dailyDevoteeDesc": "Visit PadelNachos every day — build the habit!",
    "streakLegend": "Streak Legend",
    "streakLegendDesc": "Your all-time best daily visit streak.",
    "ambassador": "Ambassador",
    "ambassadorDesc": "Invite friends to PadelNachos and grow the community.",
    "tierRookie": "Rookie",
    "tierIntermediate": "Intermediate",
    "tierAdvanced": "Advanced",
    "tierPadelGenius": "Padel Genius"
  },
  "common": {
    "back": "Back",
    "share": "Share",
    "search": "Search players, events, matches...",
    "loading": "Loading...",
    "vs": "vs",
    "all": "All",
    "hrs": "HRS",
    "min": "MIN",
    "sec": "SEC"
  }
}
```

The Spanish file (`es.json`) will have the same keys with AI-generated translations using padel-specific Spanish terminology.

## Language Switcher

A small pill-shaped toggle in `AppHeader`, right-aligned next to the profile button.

- **Style:** Chunky badge clip-path, 24px height, matching existing UI
- **Content:** Two-letter locale code ("EN" / "ES") with the active one highlighted in green
- **Behavior:** Tap switches locale — navigates to the same page in the other language (e.g. `/matches` → `/es/matches`)
- **Implementation:** Uses `next-intl`'s `useRouter` and `usePathname` to construct the locale-switched URL

## Date/Number Formatting

Replace 37 hardcoded `toLocaleDateString('en-US', ...)` and `toLocaleTimeString('en-US', ...)` calls with `next-intl`'s `useFormatter()` hook:

```typescript
const format = useFormatter()
format.dateTime(date, { day: 'numeric', month: 'short' })  // "13 Apr" or "13 abr"
format.dateTime(date, { hour: '2-digit', minute: '2-digit', hour12: false })  // "16:00"
```

For server components and non-hook contexts, use `getFormatter()` from `next-intl/server`.

## Link Migration

All `<Link href="/path">` from `next/link` and `useRouter().push('/path')` from `next/navigation` must be replaced with the locale-aware versions from `src/i18n/navigation.ts`:

```typescript
// Before
import Link from 'next/link'
<Link href="/matches">

// After
import { Link } from '@/i18n/navigation'
<Link href="/matches">  // automatically becomes /es/matches for Spanish users
```

This applies to:
- `BottomNavV3` — bottom navigation links
- Match cards — links to `/match/[id]`
- Tournament cards — links to `/tournaments/[id]`
- Player cards — links to `/player/[id]`
- Feed article links
- All internal navigation throughout the app

## SEO

Handled automatically by `next-intl`:
- `<html lang="en">` or `<html lang="es">` on the root element
- `x-default` hreflang alternate links in HTTP headers
- Canonical URLs with correct locale prefix
- Sitemap entries for both locales (future enhancement)

## Migration Steps (high level)

1. Install `next-intl`, create `i18n/` config files
2. Create `messages/en.json` with all extracted strings
3. Create `messages/es.json` with Spanish translations
4. Restructure folders: move pages into `[locale]/` segment
5. Update root layout with `NextIntlClientProvider`
6. Compose proxy.ts with `next-intl` middleware
7. Replace `<Link>` imports across all pages (next/link → i18n/navigation)
8. Replace hardcoded strings with `useTranslations()` calls across all pages
9. Replace date/number formatting with `useFormatter()`
10. Add `LocaleSwitcher` component to `AppHeader`
11. Smoke test both locales

## Performance

- Translation JSON files are small (~5KB per locale for 200 strings)
- Messages loaded server-side via `getMessages()` — no client-side fetch
- `NextIntlClientProvider` passes only needed messages to client components
- No additional API calls — translations bundled at build time
- Locale detection via cookie (fast, no redirect loop)

## Risks

- **Link migration volume**: ~50+ `<Link>` and `useRouter` call sites across the codebase. High effort but mechanical — find-and-replace pattern.
- **Date formatting edge cases**: Some dates come from the database and are formatted in helper functions, not components. These need `getFormatter()` (server) instead of `useFormatter()` (hook).
- **Third-party components**: If any component hardcodes English text internally, it won't be translatable. Audit needed during implementation.
- **Next.js 16 + next-intl version**: Must verify the exact `next-intl` version that supports Next.js 16's proxy.ts. As of 2026-04, next-intl 4.x supports it.
