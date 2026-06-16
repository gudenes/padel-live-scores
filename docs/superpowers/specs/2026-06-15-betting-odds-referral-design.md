# Betting Odds / Bookmaker Referral — Design Spec

**Date:** 2026-06-15
**Branch:** `feat/betting-odds-referral`
**Status:** Approved design — ready for implementation plan

## Summary

Add a geo- and age-gated **betting odds unit** to the match detail page that
embeds a third-party odds/affiliate **provider widget** (real bookmaker odds +
affiliate tracking links). The feature lights up only for self-declared adults
in explicitly enabled markets, and renders nothing everywhere else.

This is a **UI + compliance** feature, not a data pipeline: the provider owns
the odds data, the match-to-feed matching, the per-bookmaker licensing, and the
affiliate links. We build a fail-closed gated wrapper around their widget.

## Goals

- Show real bookmaker odds on match detail, modeled on BeSoccer's odds-comparison unit.
- Earn affiliate revenue via the provider's tracking links.
- Be compliant: licensed operators only, mandated responsible-gambling copy,
  18+ age gate, strict geo-restriction.
- Keep the architecture as small as possible — reuse existing primitives.

## Non-goals

- No in-house odds ingestion or odds API (provider supplies everything).
- No live odds that move with the score (the provider's widget owns refresh).
- No login requirement — the age gate is device-level so anonymous users can see odds.
- No betting unit on match cards / lists in v1 (match detail only).
- No iOS-specific work in v1 (Android + web first; iOS flagged as a follow-up).

## Context / reality checks

- **Padel odds coverage is thin.** Most bookmakers only price top Premier Padel
  events (P1/P2/Major), and not always. The unit will be empty on the majority
  of matches — especially FIP-tier. This is expected: the unit hides itself when
  the provider returns no odds.
- **"LATAM" is ~15 distinct regulatory regimes**, not one. Colombia (Coljuegos),
  Mexico (SEGOB), Peru, Chile, Brazil (federal, 2024–25) are workable
  per-country; Argentina is *provincial* (fragmented); others are grey. Each has
  its own mandated wording and min-age. The allow-list design makes adding a
  market a one-line config change, but a market is flipped on **only after**
  legal + provider-coverage confirmation.
- **Store-rating mismatch is a real risk.** BeSoccer ships betting content under
  PEGI 3 — an internal contradiction (it shows "+18" inside the app). We will
  declare honestly in Play Console (see Compliance Actions).

## Existing primitives reused

| Primitive | File | Use |
|---|---|---|
| Geo cookie (server + client) | `src/proxy.ts`, `src/hooks/useGeoCountry.ts` | Market gating |
| Consent system | `src/lib/consent.ts`, `src/hooks/useConsent.ts` (`pn_consent`) | GDPR gate (widget is a 3rd-party tracker) |
| Feature flags | `src/lib/feature-flags.ts` + `feature_flags` table; or `NEXT_PUBLIC_*` env | Rollout kill-switch |
| Contextual banner precedent | `WhereToWatchBanner` on `src/app/[locale]/match/[id]/page.tsx` | Placement pattern |
| i18n messages | `src/messages/{en,es,pt,it,fr}.json` | Disclaimer copy |
| Ad slot placement | `src/components/ads/*` | AdMob isolation rule |

## Architecture

Single gated wrapper component on the match detail page. Top-to-bottom gate
chain, **fail-closed** at every step (missing/errored check → render nothing):

```
MatchDetail page
  └─ <BettingOddsUnit matchId tournamentLevel>
       1. Feature flag on?          → no → render nothing
       2. geo-country in enabled allow-list?  → no → render nothing
       3. GDPR/consent decided?     → no → render nothing (or defer to consent prompt)
       4. Age gate passed?          → not passed → render <AgeGatePrompt>
       5. All pass → provider widget + per-country disclaimer
```

### New files (deliberately small)

- **`src/lib/betting-markets.ts`** — config map, the single source of truth for
  "where is this allowed":
  ```ts
  export const BETTING_MARKETS: Record<string, {
    enabled: boolean
    minAge: number
    disclaimerKey: string
  }> = {
    ES: { enabled: true,  minAge: 18, disclaimerKey: 'es' },
    CO: { enabled: true,  minAge: 18, disclaimerKey: 'co' }, // Colombia
    MX: { enabled: false, minAge: 18, disclaimerKey: 'mx' }, // staged; flip when confirmed
    // add LATAM markets here as licensing + provider coverage are confirmed
  }
  export function isBettingMarket(country: string | null | undefined): boolean
  ```
  - `enabled: false` lets a market be staged (copy ready, not live) — launch is
    flipping one boolean.
  - `disclaimerKey` points at country-specific legal text under
    `betting.disclaimers.*` (these are **not** translations of each other — each
    is prescribed legal wording per regime).

- **`src/hooks/useAgeGate.ts`** — mirrors `useConsent`'s `useSyncExternalStore`
  pattern. localStorage key `pn_age_verified` = `{ verified: boolean, birthdate: string, decided_at: number }`.
  Device-level, no login. Returns `{ verified, decided, confirm(birthdate), deny() }`.

- **`src/components/betting/BettingOddsUnit.tsx`** — the gated wrapper (runs the
  chain above; renders provider widget on pass).

- **`src/components/betting/AgeGatePrompt.tsx`** — the two-step gate UI.

- **`src/components/betting/BettingFooterDisclaimer.tsx`** (or fold into existing
  footer) — geo-gated footer line, reads the same `BETTING_MARKETS` config.

### Message keys

New `betting.*` namespace in each `src/messages/*.json`:
- `betting.ageGate.question`, `betting.ageGate.yes/no`, `betting.ageGate.birthdate`, `betting.ageGate.underage`
- `betting.disclaimers.es`, `betting.disclaimers.co`, … (country-specific, lawyer-approved)
- `betting.adLabel` ("Advertisement" / "Publicidad")

## Age-gate UX

Rendered *in place of* the odds unit until passed:

1. **Prompt:** "This content contains betting information. Are you 18 or older?"
   with **Yes / No**.
   - **No** → unit collapses for the session; store `{ verified: false }`; show
     nothing (or a one-line "Betting content hidden").
2. **Birthdate:** on **Yes**, show a date picker. Compute age vs the country's
   `minAge` (18 for all launch markets).
   - age ≥ minAge → store `{ verified: true, birthdate, decided_at }`, reveal widget.
   - under-age → store `{ verified: false }`, block, never re-prompt.
3. **Persistence:** localStorage device-level. Once verified, widget renders
   directly on future visits; re-prompt only if storage is cleared.

DOB (not a bare "I'm 18" checkbox) is stored because it is stronger compliance
evidence and matches BeSoccer.

## Disclaimer model

Two render points, **same gate**, both reading `BETTING_MARKETS`:

1. **In-unit disclaimer** (legally critical) — directly under the odds, in the
   user's locale, country-specific wording (e.g. ES: "La ludopatía es un riesgo
   del juego. +18."). Non-negotiable; mandated adjacent to betting content.
2. **Footer disclaimer** (additional signal) — geo-gated to enabled markets
   only. Must **not** appear in countries where odds never render.

## Error handling / safety

- Every gate is fail-closed. Unknown geo, missing flag, storage error, provider
  load failure → render nothing.
- No odds leak to: wrong geo, un-aged users, or non-consented EU users.
- Provider widget loaded only after all gates pass (no 3rd-party script/iframe
  mounted pre-consent).

## Testing

- Unit: `isBettingMarket()` (enabled/disabled/unknown country), age computation
  (boundary at minAge, under-age, future dates), `useAgeGate` persistence + reset.
- Component: `BettingOddsUnit` renders nothing when flag off / geo out / consent
  undecided; renders `AgeGatePrompt` when un-aged; renders widget when all pass.
- Manual: verify in running app with `geo-country` forced to ES (enabled) and a
  disabled country; verify footer disclaimer only shows in enabled geos.

## Rollout

1. Ship behind feature flag, **off**.
2. Seed `BETTING_MARKETS` with ES enabled + chosen LATAM markets staged (`enabled:false`).
3. Complete compliance actions (below) for ES.
4. Enable flag in production; verify ES only.
5. Flip additional markets on one at a time as each clears legal + provider coverage.

## Compliance actions (NON-CODE — owner: product/legal)

These do **not** block implementation, but **items 1, 2, 4, 5 gate the production launch**:

1. **Play Console gambling declaration** + honest IARC content-rating
   re-questionnaire (will push to an adult/18+ rating). Shipping betting content
   under PEGI 3 is a violation.
2. **Store-rating decision** (strategic, product's call): bump to 18+ (safe,
   less reach) vs stay low (more reach, takedown risk). Recommended middle path:
   device-side age gate + honest Play Console declaration.
3. **Apple / iOS** — stricter; expect accurate age rating + possible developer
   authorization when iOS ships. Out of scope for v1 code.
4. **Provider due diligence** — written confirmation the widget provider (a)
   serves only licensed operators per country, (b) geo-restricts automatically,
   (c) supplies or permits the mandated responsible-gambling wording.
5. **Lawyer sign-off** on `betting.disclaimers.*` wording per launch country
   (ES first). Wording is legally prescribed in most regimes — do not freelance.
6. **AdMob isolation** — do not co-serve AdMob on the same screen surface as the
   betting unit (publisher-policy risk to the ad account). Placement rule, not code.
7. **MUST-FIX before flag-on — `?geo=` override bypass.** `useGeoCountry` honors a
   `?geo=XX` query-param override (a shared test affordance, also used by ads). With
   the betting flag live this is a geo-restriction *bypass*: a user in a non-enabled
   market could append `?geo=ES` to self-activate the unit. Before enabling the flag
   in prod, gate the override to non-production (e.g. `NODE_ENV !== 'production'`),
   coordinating the change with the other `useGeoCountry` consumer (`StickyAdBanner`).

## Known v1 limitations

- **Age-gate denial has no expiry.** A user who answers "No" or enters an under-age
  birthdate is locked out on that device until localStorage is cleared (a 17-yo who
  turns 18 stays blocked). Acceptable for a device-level v1; revisit if it bites.
- **Betting unit shows on pre-match + live only**, not finished matches (you can't
  bet a finished match; the provider returns no odds for them anyway).
- **v1 is serve-/provider-driven**: odds coverage is whatever the provider prices —
  realistically Premier-tier only. The tier gate enforces this client-side.

## Open questions for implementation plan

- Which exact LATAM countries to seed as staged (`enabled:false`) at build time.
- Which provider's embed API (iframe vs JS SDK) — shapes `BettingOddsUnit`'s mount logic.
- Feature flag mechanism: `NEXT_PUBLIC_BETTING_ENABLED` env vs `feature_flags` DB row
  (DB row allows toggling without deploy — likely preferred).
