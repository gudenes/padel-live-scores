# Padel Nachos — Play Console Data Safety Form

Map this directly onto the Play Console "App content → Data safety" form.
Sections below mirror the form's structure. Answers reflect what we
actually collect (cross-checked against `src/app/[locale]/privacy/page.tsx`
and the running app stack).

---

## Section 1 — Data collection and security

**Does your app collect or share any of the required user data types?**
**→ Yes**

**Is all of the user data collected by your app encrypted in transit?**
**→ Yes** (all traffic over HTTPS; Supabase + Vercel + Railway all enforce
TLS; FCM/APNs payloads encrypted by the platforms.)

**Do you provide a way for users to request that their data be deleted?**
**→ Yes** (email-based path documented in the privacy policy §6;
in-app "Delete account" button is on the post-launch roadmap and was
declared in the policy.)

---

## Section 2 — Data types collected

For each type below, answer the four sub-questions:

1. Is this data collected, shared, or both? — **Collected only** (we don't
   share with anyone outside our processors)
2. Is this data processed ephemerally? — **No** (we persist it)
3. Is collecting this data required, or can users choose? — see per-row
4. Why is this user data collected? — see per-row

### Personal info

| Data type | Collected? | Required/Optional | Purposes |
|---|---|---|---|
| **Name** | Yes | **Optional** (only when signing in with Google; magic-link sign-in does not capture name) | App functionality, Account management |
| **Email address** | Yes | **Required** (used as the account identifier; no anonymous accounts) | App functionality, Account management, Developer communications (welcome email, magic-link sign-in code) |
| **User IDs** | Yes | **Required** (internal Auth.js UUID; FCM/APNs/Web Push tokens count as device IDs — answered separately below) | App functionality, Account management |
| Address | No | — | — |
| Phone number | No | — | — |
| Race / ethnicity | No | — | — |
| Political or religious beliefs | No | — | — |
| Sexual orientation | No | — | — |
| Other personal info | No | — | — |

### Financial info

**None.** We do not collect any payment, purchase, credit, or other
financial information. The app is free and ad-free.

### Health and fitness

**None.**

### Messages

**None.** We do not access user emails, SMS, or in-app messages from
other apps. The transactional emails we send (welcome, magic-link) do not
qualify as "collecting messages" — declare under contact info / email
already covered.

### Photos and videos

**None.** We display match highlights from YouTube but do not access user
photos or videos.

### Audio files

**None.**

### Files and docs

**None.**

### Calendar

**None.**

### Contacts

**None.**

### App activity

| Data type | Collected? | Required/Optional | Purposes |
|---|---|---|---|
| **App interactions** | Yes | **Optional** (collected via PostHog; users can decline analytics consent) | Analytics |
| **In-app search history** | Yes | **Optional** (queries logged to PostHog as events) | Analytics |
| **Installed apps** | No | — | — |
| **Other user-generated content** | Yes | **Required** for the relevant features (bookmarks, followed players, followed tournaments, match predictions) | App functionality, Personalization |
| **Other actions** | No | — | — |

### Web browsing

**None.** We do not track web browsing history outside our own app.

### App info and performance

| Data type | Collected? | Required/Optional | Purposes |
|---|---|---|---|
| **Crash logs** | Yes | **Required** (Sentry captures crashes for stability) | App functionality (Analytics also acceptable) |
| **Diagnostics** | Yes | **Required** (Sentry breadcrumbs / error context; Vercel logs) | App functionality |
| **Other app performance data** | Yes | **Optional** (Vercel Analytics page-view performance) | Analytics |

### Device or other IDs

| Data type | Collected? | Required/Optional | Purposes |
|---|---|---|---|
| **Device or other IDs** | Yes | **Optional** (Firebase Cloud Messaging tokens, APNs tokens, Web Push subscriptions — only stored when the user opts into notifications) | App functionality (delivering the match notifications the user subscribed to) |

---

## Section 3 — Data sharing

**We do not share user data with third parties** in the Play Store sense
of "share" (i.e., transfer to another company for that company's own
use). Our processors (Supabase, Vercel, Google FCM, Apple APNs, Resend,
PostHog, Sentry) act on our behalf under their own data processing
agreements — Play classifies this as **collection, not sharing**.

→ Mark every "Shared?" toggle as **No**.

---

## Section 4 — Children

**Is your app primarily aimed at children?**
**→ No.** The app is general audience, padel fans of any age. Privacy
policy §8 declares it's not directed at children under 13 and we don't
knowingly collect data from under-13s.

(This means the app does NOT need to comply with Play's Designed for
Families program or COPPA, but we still treat under-13 contact as a
deletion case.)

---

## Section 5 — Sensitive permissions declarations

The manifest only requests:

- `android.permission.INTERNET` (no permission popup)

No location, no contacts, no SMS, no microphone, no camera, no
high-risk permissions — so no permissions declarations needed.

---

## Quick crosswalk to actual data flows

| What | Where it's stored | Why |
|---|---|---|
| Auth.js session, user record (name, email, image) | Supabase `public.users` + Auth.js cookie | Sign-in |
| Bookmarks, follows, predictions | Supabase `bookmarks`, `player_follows`, `predictions` | Personalization |
| Push tokens | Supabase `native_push_subscriptions`, `web_push_subscriptions` | Match notifications |
| In-app notification history | Supabase `user_notifications` | Dedup + UI |
| Locale preference | Supabase `profiles.locale` + cookie | i18n + welcome email |
| Page views, feature interactions | PostHog (anonymized at device level until sign-in, then keyed to user UUID) | Product analytics |
| Crash + error reports | Sentry (user UUID attached when signed in) | Stability |
| HTTP request logs | Vercel platform logs | Operations / abuse prevention |
| Welcome + magic-link email send records | Resend | Email delivery |

All of the above are declared in the privacy policy §3 (Data Sharing).
