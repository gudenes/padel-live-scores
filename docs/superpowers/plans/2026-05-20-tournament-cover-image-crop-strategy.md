# Tournament Cover Image Crop Strategy — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify tournament cover image rendering across 4 surfaces with a single `cover + top` strategy via a shared `<TournamentCoverImage>` component, and lock `BigTournamentCard` to the 360×260 hero aspect ratio so list/detail read as a matched pair.

**Architecture:** New thin client component in `src/components/TournamentCoverImage.tsx`. Two `variant` props (`tile-portrait`, `hero`) — both render the same internally (`<Image fill objectFit:cover objectPosition:'center top'>`) but kept distinct in the API so future divergence stays additive. Four existing consumers each swap their inline `<Image>` block for the shared component; one of them (`BigTournamentCard`) also picks up an `aspectRatio` style; one of them (detail page) has two `<Image>` blocks of which only the expanded hero uses the shared component.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, `next/image`.

**Spec reference:** [docs/superpowers/specs/2026-05-20-tournament-cover-image-crop-strategy.md](../specs/2026-05-20-tournament-cover-image-crop-strategy.md)

**Local testing:** The user will verify each task in the browser at `http://localhost:3000` (the dev server is already running with the carousel LOCAL flag ON). Don't claim a task done until the user confirms visually.

---

## File Structure

**Create:**
- `src/components/TournamentCoverImage.tsx` — ~50 lines, default-export component

**Modify:**
- `src/components/home/LiveTournamentsCarousel.tsx` — swap inline `<Image>` in `TournamentCarouselCard`
- `src/components/home/TournamentsView.tsx` — swap inline `<Image>` in `BigTournamentCard` + add `aspectRatio` to the outer card wrapper
- `src/components/TournamentSpotlightHero.tsx` — swap inline `<Image>` in the main hero block
- `src/app/[locale]/(app)/tournaments/[id]/page.tsx` — two changes:
  - Block at line 802 (expanded hero): swap inline `<Image>` for the shared component
  - Block at line 685 (collapsed sticky navbar hero): add `objectPosition: 'center top'` inline only — do NOT use the shared component (the brightness/saturate/scroll-opacity styling is too specific to route through a shared API)

---

## Task 1: Create the shared TournamentCoverImage component

**Files:**
- Create: `src/components/TournamentCoverImage.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/TournamentCoverImage.tsx` with this exact content:

```typescript
'use client'

// Shared cover-image renderer used by every surface that displays a
// tournament's cover_image_url. Single internal strategy: cover crop
// biased to the top of the source image (FIP posters reliably place
// players + tier badge in the upper half).
//
// The `variant` prop currently doesn't change behavior — both render
// the same. It exists so consumers communicate intent and so future
// divergence (e.g. per-surface aspect-aware fallbacks) stays additive
// without churning every call site.
//
// Returns null when `src` is missing — consumers continue to render
// their existing tier-gradient fallback underneath this component.

import Image from 'next/image'

interface Props {
  src: string | null | undefined
  alt: string
  /**
   * Where this image is rendered. Future-proofing knob; currently a
   * documentation aid since both variants share the same treatment.
   * - `tile-portrait` → 178×240 carousel card
   * - `hero` → 360×260-ish hero card / large surface
   */
  variant: 'tile-portrait' | 'hero'
  /** Forwarded to next/image. Should match the rendered container width. */
  sizes: string
  /** Forwarded to next/image. Default false — only above-the-fold heroes opt in. */
  priority?: boolean
}

export default function TournamentCoverImage({
  src,
  alt,
  variant: _variant,
  sizes,
  priority = false,
}: Props) {
  if (!src) return null
  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      style={{ objectFit: 'cover', objectPosition: 'center top' }}
    />
  )
}
```

- [ ] **Step 2: Type-check / lint**

```bash
npm run lint 2>&1 | grep -i "TournamentCoverImage" || echo "no new lint issues"
```

Expected: `no new lint issues`.

- [ ] **Step 3: Commit**

```bash
git add src/components/TournamentCoverImage.tsx
git commit -m "$(cat <<'EOF'
feat(ui): shared TournamentCoverImage component

Single cover-crop strategy (cover + center top) used by every surface
that renders tournament cover_image_url. Two variants in the API
(tile-portrait + hero) for documentation/intent; both currently
render identically, leaving room for future divergence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Swap LiveTournamentsCarousel

**Files:**
- Modify: `src/components/home/LiveTournamentsCarousel.tsx` (lines 135–145)

- [ ] **Step 1: Add the import**

In `src/components/home/LiveTournamentsCarousel.tsx`, find the top-of-file imports:

```typescript
import Image from 'next/image'
```

Add directly below it (or wherever fits the import ordering):

```typescript
import TournamentCoverImage from '@/components/TournamentCoverImage'
```

- [ ] **Step 2: Replace the inline Image block**

Find this block (around lines 135–145):

```typescript
        {/* Cover image — fills the card; falls back to the tier gradient when null */}
        {cover && (
          <Image
            src={cover}
            alt=""
            fill
            sizes="178px"
            priority={false}
            style={{ objectFit: 'cover' }}
          />
        )}
```

Replace with:

```typescript
        {/* Cover image — fills the card; falls back to the tier gradient when null */}
        <TournamentCoverImage
          src={cover}
          alt=""
          variant="tile-portrait"
          sizes="178px"
        />
```

- [ ] **Step 3: Remove the now-unused Image import** (only if it was the sole reference)

Verify `Image` is no longer used in the file:

```bash
grep -c "Image" src/components/home/LiveTournamentsCarousel.tsx
```

If the count is just the import + zero usages, remove the line `import Image from 'next/image'`. Otherwise leave it.

In this codebase it'll still be used by `<Image>` elsewhere in the file (the avatar in the meta block uses it? Verify by re-reading the file.) If unsure, leave the import — Next.js doesn't complain about unused imports.

Actually for this file the only `<Image>` usage was the one we just replaced — so the import becomes unused. Remove the line:

```typescript
import Image from 'next/image'
```

- [ ] **Step 4: Lint**

```bash
npm run lint 2>&1 | grep "LiveTournamentsCarousel" || echo "no new lint issues"
```

Expected: `no new lint issues`.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3000/home` (carousel LOCAL flag is ON). The carousel cards should still render exactly as before — cover image filling the card with overlay gradient and meta below. Visually verify before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/LiveTournamentsCarousel.tsx
git commit -m "$(cat <<'EOF'
refactor(home): use TournamentCoverImage in carousel cards

Same visual output (cover + top fits the 178×240 tile cleanly), now
routed through the shared component so future crop-strategy tweaks
land in one place.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Swap BigTournamentCard + lock 360×260 aspect

**Files:**
- Modify: `src/components/home/TournamentsView.tsx` (around lines 1136–1162)

- [ ] **Step 1: Add the import**

In `src/components/home/TournamentsView.tsx`, find the top-of-file imports and add:

```typescript
import TournamentCoverImage from '@/components/TournamentCoverImage'
```

- [ ] **Step 2: Lock aspect ratio on the outer card wrapper**

Find this block (around lines 1135–1141):

```typescript
    <Link href={`/tournaments/${tournament.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        margin: '0 16px 12px', padding: 20, position: 'relative', overflow: 'hidden',
        clipPath: CHUNKY.card,
        background: `linear-gradient(135deg, ${isLive ? 'rgba(255,69,85,0.10)' : isOngoing ? 'rgba(245,166,35,0.08)' : 'rgba(126,211,33,0.06)'} 0%, ${BG_CARD} 60%)`,
        border: `1.5px solid ${isLive ? 'rgba(255,69,85,0.25)' : isOngoing ? 'rgba(245,166,35,0.2)' : 'rgba(126,211,33,0.2)'}`,
      }}>
```

Replace the outer-div `style={{ ... }}` with one that adds `aspectRatio`:

```typescript
    <Link href={`/tournaments/${tournament.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        margin: '0 16px 12px', padding: 20, position: 'relative', overflow: 'hidden',
        aspectRatio: '360 / 260',
        clipPath: CHUNKY.card,
        background: `linear-gradient(135deg, ${isLive ? 'rgba(255,69,85,0.10)' : isOngoing ? 'rgba(245,166,35,0.08)' : 'rgba(126,211,33,0.06)'} 0%, ${BG_CARD} 60%)`,
        border: `1.5px solid ${isLive ? 'rgba(255,69,85,0.25)' : isOngoing ? 'rgba(245,166,35,0.2)' : 'rgba(126,211,33,0.2)'}`,
      }}>
```

(Just inserted `aspectRatio: '360 / 260'` immediately after the `overflow: 'hidden'` declaration.)

- [ ] **Step 3: Replace the inline Image block**

Find the inline `<Image>` (around lines 1142–1161):

```typescript
        {tournament.cover_image_url ? (
          <>
            <Image
              src={tournament.cover_image_url}
              alt={tournament.name}
              fill
              sizes="(max-width: 480px) 100vw, 480px"
              style={{ objectFit: 'cover', zIndex: 0 }}
            />
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(90deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.2) 100%)',
                zIndex: 1,
              }}
            />
          </>
        ) : null}
```

Replace with:

```typescript
        {tournament.cover_image_url ? (
          <>
            <TournamentCoverImage
              src={tournament.cover_image_url}
              alt={tournament.name}
              variant="hero"
              sizes="(max-width: 480px) 100vw, 480px"
            />
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(90deg, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.4) 50%, rgba(0,0,0,0.2) 100%)',
                zIndex: 1,
              }}
            />
          </>
        ) : null}
```

(The shared component handles the `<Image>` itself, including `zIndex: 0` is dropped because next/image's positioning naturally renders below the sibling overlay div with `zIndex: 1`. Verify in browser; if needed, the shared component can accept an additional `zIndex` style — but for now we accept this default and adjust if it visually breaks.)

- [ ] **Step 4: Lint**

```bash
npm run lint 2>&1 | grep "TournamentsView" || echo "no new lint issues"
```

Expected: `no new lint issues`.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3000/tournaments`. The `BigTournamentCard` (the large card at the top of each section — `live[0]`, `ongoing[0]`, or hero upcoming) should now:
- Render as a 360×260-ish aspect card (matches the detail hero shape)
- Show the top of the poster (players' faces visible)
- Keep the left-darkening overlay so the title/dates remain readable

Visually verify before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/TournamentsView.tsx
git commit -m "$(cat <<'EOF'
refactor(home): use TournamentCoverImage + lock 360x260 aspect for BigTournamentCard

Matches the tournament detail hero shape so list→detail navigation
reads as a continuous frame. Cover image now uses the shared
'cover + top' crop, preserving the upper half of the FIP poster
(players, tier badge) on every render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Swap TournamentSpotlightHero

**Files:**
- Modify: `src/components/TournamentSpotlightHero.tsx` (around lines 305–314)

- [ ] **Step 1: Add the import**

In `src/components/TournamentSpotlightHero.tsx`, find the top-of-file imports and add:

```typescript
import TournamentCoverImage from '@/components/TournamentCoverImage'
```

- [ ] **Step 2: Replace the inline Image block**

Find this block (around lines 305–314):

```typescript
        {tournament.cover_image_url ? (
          <>
            <Image
              src={tournament.cover_image_url}
              alt={tournament.name}
              fill
              sizes="(max-width: 480px) 100vw, 480px"
              style={{ objectFit: 'cover', zIndex: 0 }}
              priority={false}
            />
```

Replace **only the `<Image ... />`** portion with:

```typescript
            <TournamentCoverImage
              src={tournament.cover_image_url}
              alt={tournament.name}
              variant="hero"
              sizes="(max-width: 480px) 100vw, 480px"
            />
```

Keep the surrounding `{tournament.cover_image_url ? (<>...</>) : null}` wrapper and any sibling overlay divs that follow.

- [ ] **Step 3: Lint**

```bash
npm run lint 2>&1 | grep "TournamentSpotlightHero" || echo "no new lint issues"
```

Expected: `no new lint issues`.

- [ ] **Step 4: Verify in browser**

Open `http://localhost:3000/home`. The tournament spotlight (lower on the page, below the carousel + Road to Olympics card) should still render with its cover image. Players visible at the top, gradient overlay still readable.

- [ ] **Step 5: Commit**

```bash
git add src/components/TournamentSpotlightHero.tsx
git commit -m "$(cat <<'EOF'
refactor(home): use TournamentCoverImage in TournamentSpotlightHero

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Tournament detail page — two render blocks

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx` (lines 685–698 + 802–810)

**Block 1 (collapsed sticky navbar hero, line 685)** — keep as inline `<Image>` because it has scroll-coupled `filter` and `opacity` styles that don't belong in the shared component. Add `objectPosition: 'center top'` inline.

**Block 2 (expanded hero, line 802)** — swap to the shared component.

- [ ] **Step 1: Add the import**

In `src/app/[locale]/(app)/tournaments/[id]/page.tsx`, find the top-of-file imports and add:

```typescript
import TournamentCoverImage from '@/components/TournamentCoverImage'
```

- [ ] **Step 2: Patch Block 1 (collapsed sticky navbar hero)**

Find this block (around lines 685–698):

```typescript
          {activeTournamentObj?.cover_image_url ? (
            <>
              <Image
                src={activeTournamentObj.cover_image_url}
                alt=""
                aria-hidden
                fill
                sizes="(max-width: 480px) 100vw, 500px"
                style={{
                  objectFit: 'cover', zIndex: 0,
                  filter: 'brightness(0.35) saturate(0.7)',
                  opacity: navbarLayerOpacity,
                }}
              />
```

Add `objectPosition: 'center top'` to the inline style:

```typescript
          {activeTournamentObj?.cover_image_url ? (
            <>
              <Image
                src={activeTournamentObj.cover_image_url}
                alt=""
                aria-hidden
                fill
                sizes="(max-width: 480px) 100vw, 500px"
                style={{
                  objectFit: 'cover',
                  objectPosition: 'center top',
                  zIndex: 0,
                  filter: 'brightness(0.35) saturate(0.7)',
                  opacity: navbarLayerOpacity,
                }}
              />
```

- [ ] **Step 3: Patch Block 2 (expanded hero) — swap to shared component**

Find this block (around lines 802–811):

```typescript
          {activeTournamentObj?.cover_image_url ? (
            <>
              <Image
                src={activeTournamentObj.cover_image_url}
                alt={activeTournamentObj.name}
                fill
                sizes="(max-width: 480px) 100vw, 500px"
                priority
                style={{ objectFit: 'cover', zIndex: 0 }}
              />
              <div aria-hidden style={{
                position: 'absolute', inset: 0, zIndex: 1,
                background: 'linear-gradient(180deg, rgba(10,10,10,0.40) 0%, rgba(10,10,10,0.15) 30%, rgba(10,10,10,0.92) 100%)',
                pointerEvents: 'none',
              }} />
            </>
          ) : null}
```

Replace the inner `<Image ... />` with the shared component:

```typescript
          {activeTournamentObj?.cover_image_url ? (
            <>
              <TournamentCoverImage
                src={activeTournamentObj.cover_image_url}
                alt={activeTournamentObj.name}
                variant="hero"
                sizes="(max-width: 480px) 100vw, 500px"
                priority
              />
              <div aria-hidden style={{
                position: 'absolute', inset: 0, zIndex: 1,
                background: 'linear-gradient(180deg, rgba(10,10,10,0.40) 0%, rgba(10,10,10,0.15) 30%, rgba(10,10,10,0.92) 100%)',
                pointerEvents: 'none',
              }} />
            </>
          ) : null}
```

- [ ] **Step 4: Lint**

```bash
npm run lint 2>&1 | grep "tournaments/\[id\]" || echo "no new lint issues"
```

Expected: `no new lint issues`.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:3000/tournaments/<some-tournament-id>` (you can navigate from `/tournaments` by tapping a card). Walk through:
- Initial expanded hero shows the top of the FIP poster (players + tier badge)
- Scroll down — the hero collapses into the sticky navbar; the dimmed background also crops to the top of the poster, maintaining continuity
- Hero crops + transitions feel consistent with the BigTournamentCard you came from

Visually verify before continuing.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/\(app\)/tournaments/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
refactor(tournament-detail): cover image uses 'cover + top' on both heroes

Expanded hero routes through the shared TournamentCoverImage
component; the collapsed sticky-navbar hero stays inline (it has
scroll-coupled filter/opacity that doesn't belong in the shared API)
and gains an explicit objectPosition: center top.

Both heroes now crop the FIP poster the same way as the
BigTournamentCard on /tournaments — list→detail continuity holds.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Final sweep — lint, build, manual check, PR

- [ ] **Step 1: Run lint**

```bash
npm run lint 2>&1 | tail -20
```

Expected: no NEW errors from the files we touched. Pre-existing repository warnings (1300+ `any` casts in matches/auth code) are fine.

- [ ] **Step 2: Build (catches type errors lint may miss)**

```bash
npm run build 2>&1 | tail -30
```

Expected: build completes. If it fails on a file we touched, fix it. If it fails on a pre-existing issue in unrelated code, note it and move on.

- [ ] **Step 3: Final visual walkthrough on localhost**

`npm run dev` (or use the existing running server). On `http://localhost:3000`, walk through:
- `/home` — carousel cards, then scroll to the Tournament Spotlight Hero. Both crop the same way.
- `/tournaments` — BigTournamentCards now 360×260 aspect, players visible at the top of each card.
- Tap into a tournament — expanded hero shows the same crop. Scroll down — collapsed navbar shows the same crop dimmed.
- Compare a list card to its detail hero side-by-side: shape + crop should feel continuous.

Confirm with the user before opening the PR.

- [ ] **Step 4: Push branch and open PR**

```bash
git push -u origin claude/cover-crop-strategy
gh pr create --title "feat(ui): unified cover image crop strategy + 360x260 hero aspect" --body "$(cat <<'EOF'
## Summary
- New shared `<TournamentCoverImage>` component renders every tournament cover with `cover + center top` — preserves the players/tier badge at the top of FIP posters
- `BigTournamentCard` on `/tournaments` locked to 360×260 aspect, matching the tournament detail hero — list→detail feels like a continuous frame
- 4 consumers updated: LiveTournamentsCarousel, BigTournamentCard, TournamentSpotlightHero, tournament detail page
- Tournament detail's collapsed sticky-navbar hero stays inline (has scroll-coupled filter) but gains the same `objectPosition: center top` for consistency

Spec: docs/superpowers/specs/2026-05-20-tournament-cover-image-crop-strategy.md
Plan: docs/superpowers/plans/2026-05-20-tournament-cover-image-crop-strategy.md

## Test plan
- [ ] Home carousel cards show the top of the poster (players + tier visible)
- [ ] /tournaments BigTournamentCard is 360×260 aspect with same crop as detail hero
- [ ] TournamentSpotlightHero on home uses same crop
- [ ] Tournament detail page expanded hero crops to top of poster
- [ ] Tournament detail page collapsed sticky navbar also crops to top of poster
- [ ] Tournaments without a cover (cover_image_url IS NULL) still fall back to tier gradient
- [ ] Lint clean
- [ ] Build succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

**Spec coverage check:**
- Shared `<TournamentCoverImage>` component → Task 1 ✓
- `tile-portrait` variant on LiveTournamentsCarousel → Task 2 ✓
- `hero` variant on BigTournamentCard → Task 3 ✓
- `hero` variant on TournamentSpotlightHero → Task 4 ✓
- `hero` variant on detail expanded hero → Task 5 ✓
- BigTournamentCard 360×260 aspect lock → Task 3 ✓
- `cover + center top` crop strategy → Task 1 (encapsulated in shared component) ✓
- Tier-gradient fallback when src null → Task 1 (component returns null, consumers keep existing fallback) ✓
- Spec's "two render blocks" on detail page handled — Task 5 explicitly handles both, but only Block 2 uses the shared component (Block 1 has scroll-coupled filter that doesn't belong in the API); spec also mentioned them as a pair without specifying both use the shared component, so this is a reasonable refinement.

**Placeholder scan:** no TBDs/TODOs/vague-error-handling/uncoded steps.

**Type consistency:** `variant: 'tile-portrait' | 'hero'` and prop names (`src`, `alt`, `variant`, `sizes`, `priority`) match across Task 1 (definition) and Tasks 2–5 (consumers).
