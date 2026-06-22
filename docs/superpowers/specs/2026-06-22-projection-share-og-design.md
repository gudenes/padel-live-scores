# Shareable Projection Path — Share button + dynamic OG image

**Date:** 2026-06-22
**Status:** Design approved (image visual signed off against live Valladolid P2 data)
**Branch / worktree:** `feat/projection-share` · `.worktrees/projection-share` (off `origin/main`)

## Goal

Let a fan share a pair's **road-to-title** projection so the link unfurls on
WhatsApp / X / iMessage / Telegram with a rich, branded preview image showing
the projected path and odds.

Two pieces:

1. **Share button** in the in-app Projection tab (road view) → triggers the
   native share sheet with the canonical dedicated URL.
2. **Dynamic Open Graph image** on the dedicated per-pair route, rendered from
   live projection data, so the shared link previews richly.

## Scope

- **Per-pair only.** The tournament-level projection list (`/projection`) is out
  of scope — no share button, no OG image there.
- Share button lives **only in the in-app Projection tab** (`ProjectionTab.tsx`,
  road view). The standalone `/projection/[pair]` page stays a plain landing page
  for incoming shared links (it just gains the OG image).
- The shared URL is always the **canonical dedicated route**:
  `https://padelnachos.com/<locale?>/tournaments/<id>/projection/<pair-slug>`
  (English has no locale prefix — `localePrefix: 'as-needed'`).

## Non-goals (YAGNI)

- No OG image for the tournament-level projection list.
- No new analytics events in v1 (can layer on later; the route already has
  distinct-URL analytics from PR #548).
- No share button on the dedicated route page itself.

---

## Part 1 — Share button (in-app Projection tab)

**Where:** `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`, road view
only (rendered when `view === 'road'` and a `selectedPair` is set). Placed in the
selected-team hero banner area (top-right of the road view), so it's only visible
once a specific pair's path is on screen.

**URL construction.** `ProjectionTab` already computes `slugIndex` and emits the
canonical slug via `onPairSlugChange`. The button builds:

```
const slug = slugIndex.pairKeyToSlug.get(selectedPair)
const path = `/tournaments/${tournamentId}/projection/${slug}`   // locale-aware
const shareUrl = absoluteUrl(path, locale)   // origin + as-needed locale prefix
```

Use the i18n-aware pathname (so the locale prefix matches `as-needed`) and
prefix with `window.location.origin`. Guard: if `slug` is missing (slug index not
yet built), the button is disabled / hidden.

**Share mechanism** — mirror the existing, proven match-page pattern
([`src/app/[locale]/match/[id]/page.tsx`](../../../src/app/[locale]/match/[id]/page.tsx)):

1. Capacitor native (`@capacitor/share` `Share.share(...)`) when
   `Capacitor.isNativePlatform()`.
2. Web Share API (`navigator.share`) on mobile browsers that support it.
3. Clipboard fallback (`navigator.clipboard.writeText`) + a brief "Link copied"
   toast (reuse the match page's `shareToast` pattern).

**Share payload (localized).** Title + text drawn from the model:

- Title: `{pair} — road to the title` (e.g. "Coello / Tapia — road to the title")
- Text (contender): `{pct}% to win {tournament} 🏆` (e.g. "47% to win Valladolid P2 🏆")
- Text (eliminated/champion): adapt — "Champions! 🏆" / "Out in the {round}".
- URL: `shareUrl`.

New i18n keys under `projectionTab` (5 locales: en/es/pt/it/fr): `shareLabel`,
`shareTitle`, `shareTextContender`, `shareTextChampion`, `shareTextEliminated`,
`shareCopied`.

**Visual.** A small chunky share affordance consistent with the tab's existing
`PressButton` / clip-path styling (lime accent). Icon + optional "Share" label.

---

## Part 2 — Dynamic OG image

**Route (file convention):**
`src/app/[locale]/(app)/tournaments/[id]/projection/[pair]/opengraph-image.tsx`

Next.js auto-discovers `opengraph-image` for that route segment and injects the
image into the route's metadata — no change needed to the existing
`generateMetadata` beyond keeping `twitter.card: 'summary_large_image'` (already
set). Exports: `size = { width: 1200, height: 630 }`, `contentType = 'image/png'`,
`runtime` per match-OG, and `revalidate = 600` (projections refresh a few times a
day; live play can nudge them — 10 min keeps shared previews fresh without
hammering).

### Data access (bundle-safe)

Mirror [`match/[id]/opengraph-image.tsx`](../../../src/app/[locale]/match/[id]/opengraph-image.tsx):
**direct `fetch()` against Supabase REST** — `@supabase/supabase-js` blows past
`next/og`'s 500 KB bundle budget, and so does `projection-server.ts` (it imports
the JS SDK). So the OG route gets its own thin REST fetchers:

- `tournaments` row: `name, level, country` (for the top strip).
- `tournament_projections` rows for the tournament (both categories), columns per
  `PROJECTION_COLUMNS`, ordered by `champion_prob desc`.
- `players` rows for every id in the resolved pair + its road opponents:
  `id, name, country, avatar_url, photo_url`.

**Pure helpers are safe to import** (no SDK): `projection-slug.ts`
(`buildSlugIndex`, `resolvePairSlug`), `projection-view.ts` (`buildRoadVM`,
`projectedFinishRound`, `isContender`, `winColor` — extract `winColor` to an
export if not already), `projection-types.ts`. This keeps the OG image's pair
resolution and road-building **identical** to the page — single source of truth.

**Pair resolution** replicates the page's `resolvePairAcrossCategories`: loop
categories, build slug index from player names, `resolvePairSlug(slug)`, find the
row. On no match / projection flag off / missing tournament → render a **branded
fallback image** (generic "Road to the title · PadelNachos" card) rather than 500.

### Image rendering (the signed-off design)

Landscape 1200×630, dark gradient `linear-gradient(135deg,#161616,#1A1A1A,#121212)`.
Tokens lifted verbatim from `ProjectionTab.tsx`:
`TEXT #EEE4CE`, `SECONDARY #9AAEC4`, `MUTED #6B7280`, `LIME #7ED321`,
`GOLD #F5A623`, `LIVE #FF4655`, `MONO` numerals, chunky card clip-path
`polygon(0% 4%,99.5% 0%,100% 96%,0.5% 100%)`, hero clip-path
`polygon(0 7%,99% 0,100% 93%,1% 100%)`.

Layout:

- **Top strip:** tournament label left (`{NAME} · {LEVEL} · {CATEGORY}`),
  **PadelNachos stacked logo top-right** (`public/padelnachos-logo-v2.png`).
- **Left column:** broadcast lower-third hero — both players' `photo_url`
  full-body shots (overlapped), seed `#N` in MONO, flag + full names — then the
  "ROAD TO TROPHY" card: "{N} wins to lift 🏆" (trophy is the filled SVG, not
  emoji) + big lime MONO champion `%` + champion bar.
- **Right column:** the **projected-path vertical timeline** — gold spine on a
  dark channel, circular round nodes, chunky opponent cards (round code, opponent
  surnames via the app's last-token rule, headshot pair-avatars from `avatar_url`,
  win `%` **color-coded** lime ≥65 / gold 45–64 / red <45). Final round gets the
  gold-ringed trophy node + gold-tinted card. Renders the **full road** (up to 5
  rounds incl. a bye); skips zero-reach rounds for eliminated pairs (matches the
  app's `rd.reachProb === 0 && !rd.expected` skip).
- **Footer:** `padelnachos.com · projection` left, `model estimate` right.

**Adaptive headline (match the app):**
- Contender (`champion_prob ≥ 0.10`, `isContender`) → lead with champion %.
- Non-contender, active → lead with "Our prediction: reach the {round}" (slate
  card), per `showPredictionHero`.
- Eliminated → red "Out in {round}", no champion bar.
- Champion → gold "Champions 🏆".

**Asset embedding (Satori constraint).** Satori can't reliably fetch remote
`<img>` at render time, and one bad upstream asset 500s the route. So, exactly
like the match OG: **pre-fetch player photos/headshots and the logo, embed as
base64 data URLs** with per-asset timeouts and graceful fallbacks
(photo → headshot → initials circle). Flag emoji via next/og's Twemoji provider
(reuse the match OG's `FLAG_EMOJI` map / approach).

**i18n.** The route has `locale`. Localize every label via existing namespaces
(`projectionTab`, `seo.projection`) + `getTranslations({ locale })`: round labels
(`ROUND_LABEL_KEY`), "ROAD TO TROPHY", "PROJECTED PATH", "CHAMPION", "prob. to
win", "{N} wins to lift", "Bye — advances", "model estimate". Reuse keys where
they already exist; add OG-specific ones only where missing.

---

## Testing

- **Unit:** pair resolution + road-building already covered by
  `projection-slug.test.ts` / `projection-view.test.ts` (shared helpers). Add a
  test for the OG route's REST-shaped pair resolver if logic diverges, and for
  the share-URL builder (slug + as-needed locale prefix).
- **Visual / manual:** hit
  `/tournaments/d6b3d8b9-1395-488c-83f6-8dfe2a9c34a8/projection/coello-tapia/opengraph-image`
  locally and eyeball against the signed-off mock; verify against an
  eliminated pair and a non-contender pair; check a `women` pair. Validate the
  unfurl with the X Card validator / a WhatsApp paste.
- **Share button:** verify native (Capacitor) + Web Share + clipboard-fallback
  paths emit the correct as-needed-locale URL; verify the copied toast.

## Open follow-ups (not this PR)

- Share button could later move onto the dedicated route page too.
- Tournament-level (list) OG image.
- Share-click analytics event.
