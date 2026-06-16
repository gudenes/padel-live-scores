# Betting Odds Provider — Integration Requirements (RFI)

**Purpose:** what we need from a candidate odds / affiliate provider to plug their
betting-odds widget into PadelNachos. Send this to candidate providers / affiliate
networks; their answers map directly onto our already-built integration seam.

**Our side is already built** (PR #556): a geo- and age-gated betting unit on the
match detail page, behind the `betting_enabled` admin feature flag, shipping OFF in
prod. The provider plugs in via a single configurable embed; flipping markets on is a
one-line config change per country. We just need the artifacts below.

---

## 0. The one decision that shapes everything

Are we integrating an **odds aggregator / affiliate network** (one widget showing
multiple sportsbooks — bet365 / Winamax / Sportium style, like BeSoccer) or a
**single sportsbook's own widget + affiliate program**? The aggregator path is what
our seam is built for and is preferred. Either works; the requirements below cover both.

---

## A. Embed (technical) — fills `NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE`

- [ ] **Embed method** — iframe URL, or a JS SDK snippet? (We are built for an iframe URL.)
- [ ] **URL format + parameters** — the exact pattern and accepted params: sport key
      (padel), event/market identifier, language/locale, geo/country, theme.
- [ ] **Match identification** — *critical*. Do you identify a padel match by **your own
      event ID**, or by **team/player names + date**?
      - Names/date → our current template works as-is.
      - Your event ID → we need a mapping step (your ID ↔ our match UUID).
- [ ] **Iframe host domain(s)** — needed for our Content-Security-Policy `frame-src`
      allowlist and the iframe `sandbox`.
- [ ] **Sizing** — fixed height, or auto-resize via `postMessage`?
- [ ] **Theming** — dark-mode / brand-color options so it matches our UI.
- [ ] **API key** — required? Public/browser-safe or server-only?

## B. Commercial / affiliate (the revenue plumbing)

- [ ] **Affiliate / publisher / partner ID** + the tracking parameter format (attributes
      clicks/signups to us → payout).
- [ ] **Deal terms** — rev-share vs CPA.
- [ ] **Reporting** — dashboard or postback access to see clicks/conversions.

## C. Compliance / legal (per launch country)

- [ ] **Licensed operators per country** you serve — tells us which markets to enable.
- [ ] **Exact mandated responsible-gambling wording** per country (e.g. Spain DGOJ:
      "La ludopatía es un riesgo del juego… +18. Jugarbien.es"), **lawyer-approved**.
- [ ] **Required logos / links** — 18+ badge, regulator logo, self-exclusion / helpline URL.
- [ ] **Written confirmation you geo-restrict** to licensed operators automatically.

## D. Coverage reality-check

- [ ] Confirm you **actually price padel**, and which **tiers/events** (most providers
      price only top Premier Padel events — this determines how often the unit appears).

---

## Where each artifact lands in our codebase

| Artifact | Plugs into |
|---|---|
| Embed URL + params | `NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE` (Vercel prod env) + `src/components/betting/BettingProviderWidget.tsx` if param mapping differs |
| Iframe host domain | CSP `frame-src` allowlist (`next.config`) + iframe `sandbox` |
| Affiliate / partner ID | baked into the widget URL template |
| Licensed-country list | `src/lib/betting-markets.ts` (`enabled: true` per market) |
| Per-country disclaimer text | `src/messages/*.json` → `betting.disclaimers.*` |
| Required logos / links | match-detail unit + footer disclaimer assets |

## Go-live sequence (once artifacts are in)

1. Set `NEXT_PUBLIC_BETTING_WIDGET_URL_TEMPLATE` in Vercel prod env.
2. Allowlist the provider iframe domain in the CSP.
3. Flip `enabled: true` for the licensed markets in `BETTING_MARKETS`.
4. Paste lawyer-approved disclaimers into `betting.disclaimers.*`.
5. Resolve the pre-launch compliance checklist (Play Console gambling declaration,
   store-rating decision, AdMob isolation, gate the `?geo=` override to non-prod) —
   see `docs/superpowers/specs/2026-06-15-betting-odds-referral-design.md`.
6. Flip **Production ON** for `betting_enabled` at `admin.padelnachos.com` → Feature Flags.
