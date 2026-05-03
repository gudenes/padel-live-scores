# Padel Nachos — IARC Content Rating Questionnaire

The Play Console runs the IARC questionnaire to issue regional ratings
(ESRB / PEGI / USK / etc.) automatically. Answers below reflect what the
app actually does — keep them honest; mismatches with reality are a Play
policy violation.

---

## Category

**→ Reference, News, or Educational**

(Sports apps without gameplay land here. We're a live-scores + news +
rankings app — no game mechanics, no betting, no fantasy. "Sports" as a
play-store category is not the same as a Sports IARC category, which is
reserved for sports games. Choose Reference/News/Educational and the
follow-up questionnaire will be short.)

---

## Standard questionnaire answers

For every question below the answer is **No** unless flagged otherwise.

### Violence

| Question | Answer |
|---|---|
| Does the app contain violence? | No |
| Does it depict realistic violence? | No |
| Sexual violence? | No |
| Violence against vulnerable groups? | No |

### Sexuality

| Question | Answer |
|---|---|
| Does the app contain nudity? | No |
| Sexual content / innuendo? | No |
| Sexual content involving minors? | No |

### Language

| Question | Answer |
|---|---|
| Does the app contain profanity, crude humor, or insults? | No (player-name-only content; news headlines are sourced from professional publications) |

### Controlled substances

| Question | Answer |
|---|---|
| References to drugs, alcohol, or tobacco? | No (some FIP/Premier sponsors may include alcohol brands such as Cupra/Estrella in news content; if Play asks specifically about sponsor/brand mentions in news content, answer **No** because we don't promote consumption — we only republish public news headlines) |

### Gambling

| Question | Answer |
|---|---|
| Does the app contain real-money gambling? | **No** |
| Simulated gambling? | **No** — match predictions are NOT gambling: no points, no leaderboard with stakes, no real or virtual currency, no rewards. They are a "tap your guess" UX feature for personal tracking. |
| Does it provide info or instructions on gambling? | No |
| Does it link to gambling sites? | No |

> ⚠️ **Important nuance to flag if asked:** the app DOES show match
> outcomes and statistics, which third-party betting apps could use as
> reference data. We are NOT a betting product; we don't link to
> bookmakers; we don't take bets; we don't display odds. If Play asks a
> follow-up about "is this commonly used for sports betting", answer
> **No** — our value prop is fan engagement, not betting reference.

### Fear / horror

| Question | Answer |
|---|---|
| Does the app contain content that may frighten younger users? | No |

### User interaction features (these always trigger follow-up questions)

| Question | Answer |
|---|---|
| Do users interact (chat, messaging, social features)? | **No** (no in-app chat, no comments, no DMs, no public profiles. Bookmarks/follows/predictions are private to the user.) |
| Does the app share user-generated content publicly? | **No** |
| Does it share location with other users? | **No** |
| Allows users to purchase digital goods? | **No** |

### Miscellaneous

| Question | Answer |
|---|---|
| Does the app share the user's location with third parties? | **No** (we never transmit user location; PostHog records general country only via IP geolocation, which Play doesn't classify as location sharing) |
| Does it allow unrestricted internet browsing? | **No** (in-app news links open the system browser via App Links / external browser, but the app itself doesn't have an in-app web view for arbitrary URLs) |

---

## Expected outcome

With those answers the IARC engine will issue:

- **ESRB:** Everyone (E)
- **PEGI:** 3
- **USK:** 0
- **Google Play:** Everyone

If any region demands a follow-up about news content or third-party
links, the honest answer is "we aggregate professional padel news and
official YouTube highlights — no user-generated content".

---

## Re-rating triggers

Re-run the questionnaire if any of these change:

- We add in-app chat / comments / public profiles
- We add a leaderboard for predictions with rewards
- We add betting integration or affiliate odds
- We add user-uploaded photos / videos
