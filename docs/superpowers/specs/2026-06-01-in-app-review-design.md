# In-App Review (Rate the App) — Design

**Date:** 2026-06-01
**Status:** Approved design, pending implementation plan

## Goal

Prompt PadelNachos users to rate the app in the App Store / Play Store, converting launch-surge engagement into 4.5★ social proof that lifts future downloads. Use the native OS in-app review overlay (frictionless, stays in-app) with a manual store-link fallback.

## Key constraint: we request, the OS decides

The native prompt is rate-limited by the OS (Apple ~3 prompts/user/year; Google has its own quota) and **silently no-ops** when over quota or in dev/TestFlight/sideloaded builds. It only renders in store-installed (or internal-test-track) builds. We therefore:

- Spend the limited quota wisely (gate ourselves, never spam).
- Provide a manual "Rate us" button that always works via a store-URL fallback.
- Unit-test our gate logic (the only deterministic part); manually smoke-test the store-URL fallback.

## Plugin

`@capacitor-community/in-app-review` **v8.0.0** (peer dep `@capacitor/core >=8.0.0` — Capacitor-8 ready). Single API: `InAppReview.requestReview()` → StoreKit `requestReview` on iOS, Google Play In-App Review on Android. Requires `npx cap sync` to wire native pods/gradle after install.

## Store identifiers

| Platform | ID | Native review | Web/fallback listing |
|---|---|---|---|
| iOS | App Store ID `6770290540` | `InAppReview.requestReview()` | `https://apps.apple.com/app/id6770290540` |
| Android | package `com.padelnachos.app` | `InAppReview.requestReview()` | `https://play.google.com/store/apps/details?id=com.padelnachos.app` |

## Architecture

### Core module — `src/lib/app-review.ts`

Plain functions (no React hook — nothing renders off gate state):

- `recordAppOpen()` — increments the app-open counter; called once per native boot.
- `requestReviewForReason(reason: 'app_opens' | 'favorite')` — **gated automatic path**. Reads gate state, calls `shouldAutoAsk(...)`; if allowed, fires the native prompt and stamps the gate (`askCount++`, `lastAskedAt = now`). Swallows all errors.
- `openRateFlow()` — **manual path** (Settings button). Bypasses the gate. On native, attempts `InAppReview.requestReview()`; always also/falls back to opening the platform store listing URL. On web, opens the platform store web URL in a new tab.
- `shouldAutoAsk(state, now, reason): boolean` — **pure, unit-testable** decision function. No side effects, no platform calls.

### Gate state — localStorage key `pn_review_gate`

```ts
type ReviewGateState = {
  appOpens: number       // total native app boots observed
  askCount: number       // number of AUTO asks fired (manual button excluded)
  lastAskedAt: string | null  // ISO timestamp of last auto ask
}
```

Read/write helpers live in the module; default `{ appOpens: 0, askCount: 0, lastAskedAt: null }`.

### Gate policy (defaults — tunable constants)

`shouldAutoAsk` returns `true` only when ALL hold:

- Running on a native platform (`Capacitor.isNativePlatform()`).
- `appOpens >= MIN_OPENS` (**3**) — floor that protects first-session users (favoriting on day one won't prompt).
- For `reason === 'app_opens'`: `appOpens === APP_OPENS_THRESHOLD` (**5**) — fires exactly once at the threshold open.
- For `reason === 'favorite'`: no extra threshold beyond the floor (the cooldown + cap below prevent spam).
- Cooldown: `lastAskedAt` is null OR older than `COOLDOWN_DAYS` (**60**).
- Hard cap: `askCount < MAX_ASKS` (**3**) — matches Apple's annual ceiling; never waste it.

Manual `openRateFlow()` is never gated and never mutates `askCount`/`lastAskedAt`.

Constants exported from the module so they're easy to tune:
`MIN_OPENS = 3`, `APP_OPENS_THRESHOLD = 5`, `COOLDOWN_DAYS = 60`, `MAX_ASKS = 3`.

## Trigger wiring

1. **App opens** — `src/lib/native-init.ts` boot path: call `recordAppOpen()`, then `requestReviewForReason('app_opens')`.
2. **Favoriting** — `src/hooks/useFollowing.ts` `toggle()`: when toggling a `player` or `tournament` **on** (ignore `match` and `news_source`, ignore un-favoriting), call `requestReviewForReason('favorite')`. Fire-and-forget; the shared gate prevents double-prompting if a user also crosses the app-opens threshold.
3. **Settings button** — a "Rate PadelNachos" row in `src/app/[locale]/(app)/profile/settings/page.tsx`, **Support** section, calling `openRateFlow()`.

## Web behaviour

On non-native (`!Capacitor.isNativePlatform()`):
- Auto-triggers (1 & 2) no-op (guarded inside `requestReviewForReason` via `shouldAutoAsk`).
- Settings button (3) opens the platform-appropriate store *web* listing in a new tab. Since both store pages are live, the button is always shown.

## Testing

- **Unit:** `src/lib/__tests__/app-review.test.ts` exercises `shouldAutoAsk` across: web (false), below floor, exact app-opens threshold (true) vs off-by-one (false), favorite within/after cooldown, cap reached, lastAskedAt boundaries. Pure function, no mocks of native APIs.
- **Manual:** store-URL fallback verified by tapping the Settings button on web + a native build. Native prompt itself can only be observed in a store/internal-track build — documented as a known limitation, not a CI gate.

## Out of scope (YAGNI)

- No "did the user actually rate?" tracking — the OS never tells us; we only track that we *asked*.
- No match-finished trigger (considered, not selected).
- No remote-config / server-driven thresholds — constants in code are enough for launch.
- No custom pre-prompt ("Enjoying the app? Yes/No") dialog — relying on the native overlay directly for v1.
