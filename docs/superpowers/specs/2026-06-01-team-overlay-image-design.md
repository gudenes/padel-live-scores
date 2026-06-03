# Team overlay image: composite two players' portraits into a transparent PNG

**Date:** 2026-06-01
**Status:** Design approved, pending spec review

## Problem

The operator sometimes wants a piece of art that combines the two players of a
doubles team into a single image — their portraits overlapped. Today there is
no way to produce this; you'd have to cut out and stack the images by hand in an
external editor.

We now store a high-res **portrait** per player in `players.photo_url` (from the
FIP photo-capture feature). Critically, these portraits are **transparent
cut-outs** — the player figure is isolated on a fully transparent background
(verified: 622×800 RGBA, corner pixels `alpha=0`). That makes a clean
overlapping composite trivial with `sharp` — no background removal, no AI.

## Goal

A simple admin tool: **pick two players → one click → download a transparent PNG
of the two figures overlapped.** No background, no names, no extra information.

## Non-goals

- Names, text, backgrounds, or branding on the image (deliberately omitted —
  the deliverable is a clean transparent cut-out asset to drop into anything).
- Saving a gallery / persisting generated images in Supabase (download only).
- AI image generation (OpenAI etc.). This is deterministic `sharp` compositing.
- Any controls (overlap slider, swap order, scale). One-click, fixed defaults.
- A persistent "team"/"pairing" entity. The tool just takes two player IDs.

## Dependency

Requires `players.photo_url` (delivered by the FIP photo-capture feature; the
column is already in the production DB). A player without a `photo_url` can't be
used — the tool surfaces a clear message. Photo coverage grows as the
photo-capture backfill runs; that is independent of this feature.

## Design

### Architecture

Server-side composition in an `apps/ops` (admin.padelnachos.com) API route using
`sharp` (already a dependency: `^0.34.5`). The UI picks two players, calls the
route, previews the returned PNG, and downloads it. Nothing is stored.

```
[Team Image page]  pick A + pick B (reuse search-players)
      │ POST { playerAId, playerBId }
      ▼
[/api/internal/team-image]  (operator-gated)
      │ look up photo_url for A and B (service client)
      │ 400 if either missing
      │ download both PNGs
      ▼
[composeTeamOverlay(bufA, bufB)]  → transparent PNG buffer
      ▼
   image/png response  →  preview + Download
```

### 1. Composition library — `apps/ops/src/lib/team-overlay.ts`

Pure function, the heart of the feature, independently testable:

```
composeTeamOverlay(bufA: Buffer, bufB: Buffer, opts?): Promise<Buffer>
```

Steps:
1. `trim()` both inputs to remove transparent margins → tight figure bounds.
2. Normalize both to **equal height** = the *smaller* of the two trimmed heights
   (downscale-only; never upscale, so no quality loss).
3. Overlap by `OVERLAP_FRACTION` (default **0.28**) of the front figure's width.
4. Composite onto a **transparent** canvas (`channels: 4`, `alpha: 0`) sized
   exactly to `widthA + widthB − overlap` × `maxHeight`, figures bottom-aligned.
   The **second** player (B) is composited last → in front.
5. Return a PNG `Buffer` (alpha preserved).

`opts` exists only to make the function testable/configurable internally
(overlap fraction, which-in-front); the route always calls it with defaults.

Testable assertions: output width = `wA + wB − overlap`, height = `max(hA,hB)`,
`metadata().hasAlpha === true`, and a fully-transparent corner pixel.

### 2. API route — `apps/ops/src/app/api/internal/team-image/route.ts`

`POST`, operator-gated (mirror the existing `/api/internal/*` auth check:
`session.user.isOperator`, else 401).

- Body: `{ playerAId: string, playerBId: string }`. 400 if missing/equal.
- Look up both players' `photo_url` via the service client (single
  `in('id', [a, b])` query). If either `photo_url` is null → **400** with
  `{ error: 'missing_photo', players: [...] }` naming who lacks a photo.
- `fetch()` both image URLs → buffers. On a failed download → 502 with detail.
- `composeTeamOverlay(bufA, bufB)` → PNG buffer.
- Respond `200` with `Content-Type: image/png` (body = the buffer). The browser
  fetches it as a blob for preview + download.

### 3. UI — `apps/ops` page `/team-image`

A new page under `(app)`, added to the rail (`Rail.tsx`). Token-themed per the
existing design system (`var(--…)`, no hardcoded hex).

- Two **player pickers** reusing the `search-players` API (search by name).
  Each picker, once a player is chosen, shows that player's portrait thumbnail
  and flags if they have no `photo_url` (Generate disabled until both valid).
- **Generate** button → `POST /api/internal/team-image` → receives the PNG blob.
- **Preview**: the result rendered over a CSS checkerboard backdrop so the
  transparency is visible (the file itself is transparent).
- **Download PNG** button → saves the blob as `team-<slugA>-<slugB>.png`.
- Errors (missing photo, download failure) shown inline.

## Error handling

| Case | Behavior |
|---|---|
| A player has no `photo_url` | Generate disabled; inline "No photo for X". Route also guards (400). |
| Same player picked twice | Generate disabled; inline hint. |
| Upstream image download fails | Route returns 502; UI shows "Couldn't load a photo, try again". |
| Not an operator | Route 401 (consistent with other internal routes). |

## Testing

- **Unit (composition lib):** feed two small synthetic transparent PNGs (or the
  committed sample cut-outs); assert output dimensions, `hasAlpha`, transparent
  corner, and that swapping inputs swaps front/back. This is the core logic and
  must be unit-tested.
- **Manual:** in the running `apps/ops` dev app, pick two players with photos
  (e.g. Coello + Tapia), Generate, confirm the overlap preview, download, and
  open the PNG to confirm true transparency. Pick a player without a photo and
  confirm the disabled/guarded state. (Per repo memory: verify in the running
  app before calling it done.)

## Risks

- **Photo coverage.** Only players with a `photo_url` work; coverage depends on
  the photo-capture backfill. Acceptable — the tool degrades gracefully.
- **Figure alignment.** Cut-outs are bottom-aligned and height-normalized;
  framing varies slightly between players. Fixed defaults are "good enough" for
  v1; controls are an explicit non-goal.
- **Memory/CPU.** `sharp` on two ~600×800 PNGs is trivial; the route is
  on-demand and operator-only, so no scaling concern.

## Affected files

| File | Change |
|---|---|
| `apps/ops/src/lib/team-overlay.ts` | New — `composeTeamOverlay` pure compositor |
| `apps/ops/src/lib/__tests__/team-overlay.test.ts` | New — unit tests |
| `apps/ops/src/app/api/internal/team-image/route.ts` | New — operator-gated POST route |
| `apps/ops/src/app/(app)/team-image/page.tsx` (+ small `_components`) | New — picker + preview + download UI |
| `apps/ops/src/components/shell/Rail.tsx` | Add a rail nav item for the tool |
