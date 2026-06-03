# Native AdMob Banner — Design

**Date:** 2026-06-03
**Status:** Approved (design)
**Builds on:** [2026-06-01 sponsor ad slots](2026-06-01-sponsor-ad-slots-design.md), [2026-06-03 ops-managed ad banners](2026-06-03-ops-ad-banners-design.md)

## Goal

Render **AdMob banner ads inside the native iOS/Android apps** as the programmatic fill for the sticky-bottom slot — shown only when no direct-sold banner matches the visitor's country. This is the "network rendering" deferred by the earlier specs (the `NetworkAdSlot` seam). Includes Google **UMP** consent + iOS **ATT**.

AdMob IDs (already created & verified; in project memory):
- Android App ID `ca-app-pub-8997476366246416~7727014604`, Banner unit `…/4978552012`
- iOS App ID `ca-app-pub-8997476366246416~3897100718`, Banner unit `…/7026130851`
- `app-ads.txt` live at padelnachos.com (publisher `pub-8997476366246416`).

## Decisions (from brainstorming)

- **Consent:** Google **UMP** (User Messaging Platform) — the free, Google-certified CMP the Mobile Ads SDK reads automatically (required for EEA/Spain). The existing web `ConsentBanner` (`pn_consent`) is **untouched** — it stays web-only; UMP covers the apps. No double-prompt (each shows only on its platform).
- **Placement:** AdMob fills the **existing sticky-bottom slot** on matches / match-detail / player pages, **as a fallback** — a direct-sold banner for the visitor's country always wins; AdMob shows only when `pickBanner` returns null.
- **Personalization:** **personalized ads + iOS ATT** prompt (sequenced after the UMP form); requires `SKAdNetworkItems` + `NSUserTrackingUsageDescription`.
- **Remote kill-switch:** reuse `ad_network_config.native_enabled` — native code ships once, only requests ads when the flag is on.

## Key architectural nuance: native overlay, not DOM

AdMob banners are **native views drawn over the WebView**, not DOM elements. So the AdMob banner does **not** render inside `NetworkAdSlot`/`SponsorCard` markup. Instead a controller calls the plugin to **show/hide** a native adaptive banner anchored `BOTTOM_CENTER`, with a **margin equal to the bottom-nav height** so it sits above the tabs (the same nav-height measurement the web `StickyAdBanner` already does — exposed for reuse).

Consequence: on native, the React tree renders **nothing** in the slot when AdMob is active; the banner is the plugin's overlay.

## Components & flow

### Plugin
`@capacitor-community/admob` (Capacitor 8-compatible). **Native-only, lazy-imported** inside `Capacitor.isNativePlatform()` guards (mirrors `native-init.ts`'s `@capacitor-firebase/messaging` lazy-import) so it never enters the web bundle.

### Initialization (in `src/lib/native-init.ts`, native-only)
On app start, after the existing native setup:
1. `AdMob.initialize()`.
2. **UMP:** `AdMob.requestConsentInfo()` → if a form is required/available, `AdMob.showConsentForm()`. (Consent message authored in the AdMob console → Privacy & messaging.)
3. **iOS ATT:** `AdMob.requestTrackingAuthorization()` (after the UMP form). The personalization of subsequent ad requests follows the combined consent/ATT result.
All wrapped so failures are non-fatal (never block app start).

### Eligibility (pure, testable) — `src/lib/admob-eligibility.ts`
`shouldShowAdMob({ isNative, route, hasDirectBanner, networkNativeEnabled }): boolean` —
true when `isNative && isAdRoute(route) && !hasDirectBanner && networkNativeEnabled`.
(Consent is handled by the SDK/UMP layer, not this gate — if the user refused consent, UMP/SDK simply serves nothing or NPA.)

### Controller — `src/components/ads/useAdMobBanner.ts` (native-only)
A hook driven by the same inputs the web `StickyAdBanner` already has (`useActiveBanner` → `pickBanner` by country, `usePathname`, the network config):
- When `shouldShowAdMob(...)` is true → `AdMob.showBanner({ adId: <platform banner unit>, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: <navHeight> })`.
- When false (route change, a direct banner became available, flag off) → `AdMob.hideBanner()` / `removeBanner()`.
- Picks the **platform-specific** banner unit (iOS vs Android) from the network config.
- Re-applies `margin` when the nav height changes.

### Wiring `StickyAdBanner`
On native: if a direct banner matches → render `SponsorCard` (DOM) as today and keep AdMob hidden. Else → render nothing in the DOM and let `useAdMobBanner` manage the native overlay. On web: unchanged. `NetworkAdSlot`'s web/AdSense branch stays a stub (out of scope).

## Config + schema

- Migration: add **`admob_ios_banner_unit_id TEXT`** to `ad_network_config` (Android keeps `admob_banner_unit_id`). The single-unit field was a known gap.
- Thread the new field through: `AdNetworkConfig` type (`src/lib/ad-banner-resolver.ts`), `GET /api/ads/active` select, ops `ad-network-config` route allowlist, and the **AdsTab** form (add an "iOS banner ad-unit ID" input next to the Android one).

## Native config files

- **Android** `android/app/src/main/AndroidManifest.xml`: `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="ca-app-pub-8997476366246416~7727014604"/>`. Add the AdMob block to `capacitor.config.ts`.
- **iOS** `ios/App/App/Info.plist`: `GADApplicationIdentifier` = `ca-app-pub-8997476366246416~3897100718`; `NSUserTrackingUsageDescription` (copy: explain ads personalization); `SKAdNetworkItems` (Google's + common networks' IDs).

## Rollout & testing

- **Dev:** use Google **test ad unit IDs** + register **test device IDs** so no live ads are clicked (policy). A `NEXT_PUBLIC_*` / build flag or `__DEV__`-style check selects test vs live unit.
- Ship with **`native_enabled = false`**; after the store release is live and verified, flip it on remotely (no new release needed to enable).
- **Requires a native rebuild + store submission** for both platforms (AdMob is native code) — unlike the direct banners.

## Error handling
- All AdMob/UMP/ATT calls are wrapped; failures log and no-op (never block app start or hide the direct-banner path).
- If `native_enabled` is false or the platform banner unit is missing → controller does nothing.
- Web is entirely unaffected (plugin never imported there).

## Testing
- **Unit:** `shouldShowAdMob` truth table (native+route+no-direct+flag → show; any false → hide); platform-unit selection (iOS vs Android).
- **Native (manual, on device/simulator):** UMP form appears for an EEA locale; iOS ATT prompt appears after it; test banner renders **above** the bottom nav on matches/match/player; a matching direct banner suppresses AdMob; toggling `native_enabled` off (via admin) stops AdMob serving; web shows no behavior change and no AdMob code in the web bundle.

## File map
| File | Action |
|---|---|
| `package.json` / lockfile | add `@capacitor-community/admob` |
| `capacitor.config.ts` | AdMob plugin config block |
| `android/app/src/main/AndroidManifest.xml` | AdMob `APPLICATION_ID` meta-data |
| `ios/App/App/Info.plist` | `GADApplicationIdentifier`, ATT string, `SKAdNetworkItems` |
| `supabase/migrations/2026XXXX_admob_ios_banner_unit.sql` | add `admob_ios_banner_unit_id` |
| `src/lib/ad-banner-resolver.ts` | add field to `AdNetworkConfig` |
| `src/app/api/ads/active/route.ts` | select new field |
| `apps/ops/src/app/api/internal/ad-network-config/route.ts` | allowlist new field |
| `apps/ops/src/app/(app)/ads/_components/AdsTab.tsx` | iOS banner-unit input |
| `src/lib/admob-eligibility.ts` (+ test) | pure eligibility helper |
| `src/lib/native-init.ts` | AdMob init + UMP + ATT (lazy) |
| `src/components/ads/useAdMobBanner.ts` | native banner controller |
| `src/components/ads/StickyAdBanner.tsx` | delegate to controller on native |

## Out of scope (later)
- Interstitial / rewarded / app-open formats.
- Web AdSense programmatic fill (separate `ads.txt` + web rendering).
- AdMob mediation networks.
