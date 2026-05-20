# Tournament Cover Image — Unified Crop Strategy

**Date:** 2026-05-20
**Status:** Design approved, awaiting plan

## Goal

Render tournament cover images consistently across all four surfaces that display them today, with a single crop strategy (`cover` + `center top`) and a shared two-variant component. Lock the tournaments-list `BigTournamentCard` to the same 360×260 hero aspect ratio as the tournament detail hero so the list → detail transition reads as a continuous shape.

## Why

FIP posters are uniformly **portrait** (~7:10, e.g. `724×1024`). Today the four surfaces render them at four different aspect ratios with `objectFit: cover` + default centered crop:

| Surface | Container | Aspect | Current crop loses |
|---|---|---|---|
| Home carousel card | 178×240 | ~3:4 portrait | Bottom 5–15% of poster (sponsor strip) |
| `BigTournamentCard` on `/tournaments` | content-sized, ~340×280 | ~6:5 | Variable; depends on content |
| `TournamentSpotlightHero` on home | full-width hero | ~5:4 | Top/bottom edges of poster |
| Tournament detail hero `[id]/page.tsx` | full-width hero | varies | Top/bottom edges of poster |

Two problems:
1. **Inconsistent crops** — the same tournament's poster looks different on every surface, with no rule for which part of the poster the user sees
2. **The `BigTournamentCard` and the detail hero look like different shapes** — tapping a list card lands on a hero with a noticeably different framing, breaking the continuity

## Design

### Shared component

New file: **`src/components/TournamentCoverImage.tsx`**

```ts
interface Props {
  src: string | null | undefined
  alt: string
  variant: 'tile-portrait' | 'hero'
  sizes: string
  priority?: boolean
}
```

The component handles the image-render concerns only: the consumer keeps its overlay gradients, level pills, typography. When `src` is null/undefined the component returns `null` (consumer falls through to its existing gradient fallback).

**Internal implementation — single rule, both variants:**

```tsx
<Image
  src={src}
  alt={alt}
  fill
  sizes={sizes}
  priority={priority ?? false}
  style={{ objectFit: 'cover', objectPosition: 'center top' }}
/>
```

Both variants render the same way; `variant` exists for the type system and so consumers communicate intent. If we ever need divergent treatment per surface in the future, the variant prop already gates it.

### Variant assignment

| Variant | Used by | sizes |
|---|---|---|
| `tile-portrait` | `LiveTournamentsCarousel` (178×240 card) | `"178px"` |
| `hero` | `BigTournamentCard` in `TournamentsView.tsx`; `TournamentSpotlightHero`; tournament detail `[id]/page.tsx` (two render blocks) | `"(max-width:480px) 100vw, 480px"` |

### BigTournamentCard — aspect lock

Currently `BigTournamentCard` ([src/components/home/TournamentsView.tsx:1134](src/components/home/TournamentsView.tsx#L1134)) is content-sized via padding + inner content (≈340×280 in practice).

Lock it to **`aspectRatio: '360 / 260'`** so it matches the detail hero. The content layout stays as-is — the status pill, name, dates, prize, and Ver button continue to render inside the card on top of the cover.

### Why `center top` (not `top` flush, not `center`)

Inspecting the 194 backfilled FIP posters, key visuals (players' faces, tier badge, tournament name) sit reliably in the **upper half**. `center top` (mid-top of the image, not flush at y=0) gives a small safety margin so atypical posters with key content slightly off-center don't get beheaded. Bottom 30–50% — typically dates + sponsor logos — is acceptable to crop because the surface's own typography overlay re-renders the tournament name and dates explicitly.

### Out of scope

- Server-side smart crop (Supabase image transforms, imgproxy)
- Per-tournament focal-point overrides (ops UI)
- Aspect-detection that auto-switches strategy based on the source image's shape
- Refactoring the overlay gradients or the metadata layout inside the cards
- Touching the tier-gradient fallback (when `cover_image_url` is null) — the new component returns `null` and existing fallback logic on each surface remains intact

### Risks accepted

- **Top-biased crop fails on atypical posters.** Mitigation: `center top` rather than flush `top`. If a tournament ships with a poster that has its key content in the lower half, ops can replace the cover via `/api/ops/tournaments/[id]/cover` (existing path).
- **Two visual jumps in one PR** (the unified crop AND the BigTournamentCard aspect lock). Mitigation: both changes are small and tightly related; landing them together avoids a broken interim state where one surface has the new shape and another doesn't.

## Affected files

**Create:**
- `src/components/TournamentCoverImage.tsx` (~50 lines)

**Modify:**
- `src/components/home/LiveTournamentsCarousel.tsx` — replace the inline `<Image>` block (around line 132–141) with `<TournamentCoverImage variant="tile-portrait" sizes="178px" />`
- `src/components/home/TournamentsView.tsx` — in `BigTournamentCard`:
  - Replace the inline `<Image>` block (lines 1142–1161, keeping the overlay div) with `<TournamentCoverImage variant="hero" sizes="(max-width:480px) 100vw, 480px" />`
  - Add `aspectRatio: '360 / 260'` to the outer card style (line 1136–1141)
- `src/components/TournamentSpotlightHero.tsx` — replace the inline `<Image>` (around line 305–312) with `<TournamentCoverImage variant="hero" priority sizes="(max-width:500px) 100vw, 500px" />`
- `src/app/[locale]/(app)/tournaments/[id]/page.tsx` — both render blocks (lines 685–694 and 802–810) become `<TournamentCoverImage variant="hero" priority sizes="(max-width:500px) 100vw, 500px" />`

**No changes:**
- The cover backfill pipeline, the `feature_flags` system, the i18n keys, the database schema

## Test plan

- Open the home page on `localhost:3000` with the carousel feature flag ON: cards now consistently show the top of the poster
- Open `/tournaments`: BigTournamentCard is 360×260 with poster filling the card, players visible
- Tap a tournament from `/tournaments`: detail page hero shows the same crop as the list card — visual continuity
- Tournament spotlight on home shows the same crop treatment
- Tournaments without a cover (`cover_image_url IS NULL`) fall back to the existing tier gradient on every surface
- Lint clean, no new TypeScript errors

## Open questions

None — the BigTournamentCard content density question raised during brainstorming is **deferred**: this PR keeps existing content (status pill + dates + prize + Ver button). Simplifying to match the detail hero's leaner layout is a separate redesign and out of scope here.

## Open follow-ups (not blocking)

- If, after shipping, a small fraction of tournaments looks off because of poster composition, add a `cover_image_focal_y` column and let ops set the focal point per tournament. Not needed unless observed in practice.
