# Tournament Cover Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Revision note (2026-05-19)

Tasks 1–10 shipped on the branch as originally written. After reviewing the result locally, the user asked for a **modern collapsing-header pattern** on the detail page instead of the static 16:9 banner produced by Task 8. **Task 11 (added below)** does that surgery — it deletes Task 8's standalone banner, restructures the existing sticky header into a collapsing navbar + expanded hero, and installs the V1 "Broadcast" identity layout.

Tasks 1–7 + Task 9 + Task 10 remain authoritative — the home Featured card and events-list card surfaces are unchanged.

Tasks **8 and 11** together cover the detail page: Task 8 documents what shipped first (already committed at `08dae528`), Task 11 is the revision (pending). When re-running this plan from scratch, **skip Task 8 and execute Task 11 directly** — Task 11 produces the final desired state.

**Goal:** Let ops upload a single promotional image per tournament and render it as a hero/background on the home Featured card, Events list cards, and Tournament detail page; tournaments without a cover keep today's design unchanged.

**Architecture:** Add `cover_image_url TEXT` column on `tournaments`, store images in a new `tournament-covers` Supabase Storage bucket (created programmatically on first write, matching the existing equipment-image pattern), expose `PATCH/DELETE /api/ops/tournaments/[id]/cover`, build a new ops tab to drive it, and render the image with `next/image fill object-cover` + a CSS gradient overlay on each of the three surfaces.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Supabase (Postgres + Storage), Tailwind, Vitest.

**Spec:** [docs/superpowers/specs/2026-05-18-tournament-cover-images-design.md](../specs/2026-05-18-tournament-cover-images-design.md)

---

## File Structure

**New files:**
- `supabase/migrations/20260518_add_cover_image_url_to_tournaments.sql` — column
- `src/lib/tournament-cover-validation.ts` — pure validator for MIME + size
- `src/lib/tournament-cover-validation.test.ts` — Vitest tests for the validator
- `src/lib/tournament-cover-bucket.ts` — `ensureTournamentCoversBucket()` helper, mirrors `ensureEquipmentBucket`
- `src/app/api/ops/tournaments/[id]/cover/route.ts` — PATCH + DELETE handlers
- `src/app/ops/TournamentCoversTab.tsx` — ops UI

**Modified files:**
- `src/components/home/shared.tsx` — add `cover_image_url` to `Tournament` interface
- `src/components/TournamentSpotlightHero.tsx` — extend local prop type, render image+gradient
- `src/components/home/TournamentsView.tsx` — extend tournament select (and any inner type), render image+gradient on `BigTournamentCard`, move days badge top-right when cover set
- `src/app/[locale]/(app)/home/page.tsx` — add `cover_image_url` to `.select()` on tournaments query (~line 279-287)
- `src/app/[locale]/(app)/tournaments/[id]/page.tsx` — add `cover_image_url` to tournament select, render hero banner above existing header/tabs
- `src/app/ops/OpsClient.tsx` — register `TournamentCoversTab` in `navGroups`

The validator and bucket helper sit in `src/lib/` (small, pure, single-purpose) rather than inside the route file, so they can be tested in isolation and reused if a backfill script is ever needed.

---

## Task 1: Add `cover_image_url` column to `tournaments`

**Files:**
- Create: `supabase/migrations/20260518_add_cover_image_url_to_tournaments.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260518_add_cover_image_url_to_tournaments.sql`:

```sql
-- Add cover_image_url column for promotional tournament images.
-- Nullable; when set, surfaces (home featured, events list, detail page)
-- render the image as a hero. When null, surfaces fall back to today's design.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
```

- [ ] **Step 2: Apply the migration locally**

Check `package.json` scripts for the migration command this repo uses. If it's the Supabase CLI directly:

```bash
npx supabase db push
```

Expected: migration applies cleanly, no errors.

- [ ] **Step 3: Verify the column**

Either via psql, the Supabase Studio Table editor, or:

```bash
npx supabase db dump --schema public 2>/dev/null | grep cover_image_url
```

Expected to see `cover_image_url text` in the `tournaments` table definition.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260518_add_cover_image_url_to_tournaments.sql
git commit -m "feat(db): add cover_image_url to tournaments"
```

---

## Task 2: Extend `Tournament` type and existing queries

**Files:**
- Modify: `src/components/home/shared.tsx`
- Modify: `src/app/[locale]/(app)/home/page.tsx` (around line 279-287)
- Modify: `src/components/home/TournamentsView.tsx` (its tournament source)
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx` (the tournament select)

- [ ] **Step 1: Add `cover_image_url` to the shared `Tournament` interface**

Edit `src/components/home/shared.tsx`. Find the `Tournament` interface (around line 33-43) and add the field:

```typescript
export interface Tournament {
  id: string
  name: string
  starts_at: string
  ends_at: string
  country: string | null
  level: string | null
  location: string | null
  prize_money: string | null
  logo_url?: string | null
  cover_image_url?: string | null   // <-- add this
}
```

- [ ] **Step 2: Add `cover_image_url` to the home page query**

Edit `src/app/[locale]/(app)/home/page.tsx`. Find the tournaments `.select(...)` (around line 280) and add `cover_image_url`:

```typescript
supabase
  .from('tournaments')
  .select('id, name, starts_at, ends_at, country, level, location, prize_money, logo_url, cover_image_url')
```

- [ ] **Step 3: Add `cover_image_url` to the TournamentsView source query**

Edit `src/components/home/TournamentsView.tsx`. Search for `from('tournaments')` in this file. If found, add `cover_image_url` to that select. If not found, the data is passed in as props — search upward (parent pages that render `<TournamentsView />`) for the `from('tournaments').select(...)` and add the field there too.

- [ ] **Step 4: Add `cover_image_url` to the detail page query**

Edit `src/app/[locale]/(app)/tournaments/[id]/page.tsx`. Search for `from('tournaments')` and add `cover_image_url` to the column list of the tournament select.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors related to `cover_image_url`. If a local component-level Tournament type elsewhere is missing the field, add it inline (we will touch `TournamentSpotlightHero`'s local type in Task 6 explicitly; if `tsc` complains earlier, add it preemptively).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(types): plumb cover_image_url through tournament queries"
```

---

## Task 3: Build and test the validation helper

**Files:**
- Create: `src/lib/tournament-cover-validation.ts`
- Create: `src/lib/tournament-cover-validation.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/tournament-cover-validation.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import {
  validateCoverFile,
  COVER_MAX_BYTES,
  COVER_ALLOWED_MIMES,
} from './tournament-cover-validation'

function fakeFile(type: string, size: number, name = 'cover.jpg'): File {
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type })
}

describe('validateCoverFile', () => {
  it('accepts a 2 MB JPEG', () => {
    const result = validateCoverFile(fakeFile('image/jpeg', 2 * 1024 * 1024))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.ext).toBe('jpg')
  })

  it('accepts a PNG', () => {
    const result = validateCoverFile(fakeFile('image/png', 1024))
    expect(result.ok).toBe(true)
  })

  it('accepts a WebP', () => {
    const result = validateCoverFile(fakeFile('image/webp', 1024))
    expect(result.ok).toBe(true)
  })

  it('rejects a PDF', () => {
    const result = validateCoverFile(fakeFile('application/pdf', 1024))
    expect(result).toEqual({ ok: false, status: 400, error: 'unsupported_mime' })
  })

  it('rejects a GIF', () => {
    const result = validateCoverFile(fakeFile('image/gif', 1024))
    expect(result.ok).toBe(false)
  })

  it('rejects a 6 MB JPEG', () => {
    const result = validateCoverFile(fakeFile('image/jpeg', 6 * 1024 * 1024))
    expect(result).toEqual({ ok: false, status: 413, error: 'too_large' })
  })

  it('rejects a missing file', () => {
    const result = validateCoverFile(null)
    expect(result).toEqual({ ok: false, status: 400, error: 'missing_file' })
  })

  it('exports the limits as constants', () => {
    expect(COVER_MAX_BYTES).toBe(5 * 1024 * 1024)
    expect(COVER_ALLOWED_MIMES).toContain('image/jpeg')
    expect(COVER_ALLOWED_MIMES).toContain('image/png')
    expect(COVER_ALLOWED_MIMES).toContain('image/webp')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/tournament-cover-validation.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the validator**

Create `src/lib/tournament-cover-validation.ts`:

```typescript
export const COVER_MAX_BYTES = 5 * 1024 * 1024
export const COVER_ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type CoverValidationResult =
  | { ok: true; ext: 'jpg' | 'png' | 'webp' }
  | { ok: false; status: 400 | 413; error: 'missing_file' | 'unsupported_mime' | 'too_large' }

const MIME_TO_EXT: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function validateCoverFile(file: File | null): CoverValidationResult {
  if (!file) return { ok: false, status: 400, error: 'missing_file' }
  if (!(COVER_ALLOWED_MIMES as readonly string[]).includes(file.type)) {
    return { ok: false, status: 400, error: 'unsupported_mime' }
  }
  if (file.size > COVER_MAX_BYTES) {
    return { ok: false, status: 413, error: 'too_large' }
  }
  return { ok: true, ext: MIME_TO_EXT[file.type] }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tournament-cover-validation.test.ts`

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournament-cover-validation.ts src/lib/tournament-cover-validation.test.ts
git commit -m "feat(lib): add tournament cover file validator"
```

---

## Task 4: Build the bucket-ensure helper

**Files:**
- Create: `src/lib/tournament-cover-bucket.ts`

The codebase pattern (per `src/lib/equipment-image-rehost.ts:ensureEquipmentBucket`) creates buckets programmatically on first write rather than via SQL migration. We follow that.

- [ ] **Step 1: Read `ensureEquipmentBucket` for reference**

Read: `src/lib/equipment-image-rehost.ts` — find `ensureEquipmentBucket()` and note the structure.

- [ ] **Step 2: Implement the helper**

Create `src/lib/tournament-cover-bucket.ts`:

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'

export const TOURNAMENT_COVERS_BUCKET = 'tournament-covers'

let bucketEnsured = false

/**
 * Creates the `tournament-covers` storage bucket if it doesn't exist.
 * Public read; service-key write. Idempotent — safe to call on every request.
 */
export async function ensureTournamentCoversBucket(supabase: SupabaseClient): Promise<void> {
  if (bucketEnsured) return
  const { data: buckets, error: listError } = await supabase.storage.listBuckets()
  if (listError) throw new Error(`listBuckets failed: ${listError.message}`)
  const exists = buckets?.some((b) => b.name === TOURNAMENT_COVERS_BUCKET)
  if (!exists) {
    const { error: createError } = await supabase.storage.createBucket(TOURNAMENT_COVERS_BUCKET, {
      public: true,
    })
    if (createError && !createError.message.includes('already exists')) {
      throw new Error(`createBucket failed: ${createError.message}`)
    }
  }
  bucketEnsured = true
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/tournament-cover-bucket.ts
git commit -m "feat(lib): ensure tournament-covers storage bucket exists"
```

---

## Task 5: Implement the ops API route (PATCH + DELETE)

**Files:**
- Create: `src/app/api/ops/tournaments/[id]/cover/route.ts`

- [ ] **Step 1: Read `checkOpsAuth` and the brands route**

Read: `src/app/api/ops/brands/route.ts` to see the `checkOpsAuth()` import path + service-key client construction pattern. Match it.

- [ ] **Step 2: Write the route**

Create `src/app/api/ops/tournaments/[id]/cover/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import { validateCoverFile } from '@/lib/tournament-cover-validation'
import {
  ensureTournamentCoversBucket,
  TOURNAMENT_COVERS_BUCKET,
} from '@/lib/tournament-cover-bucket'

export const runtime = 'nodejs'

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
  )
}

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = checkOpsAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id: tournamentId } = await ctx.params
  if (!tournamentId) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'invalid_form' }, { status: 400 })
  }
  const file = formData.get('file')
  const validation = validateCoverFile(file instanceof File ? file : null)
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: validation.status })
  }
  const validFile = file as File

  const supabase = getSupabaseAdmin()

  const { data: tournament, error: lookupError } = await supabase
    .from('tournaments')
    .select('id')
    .eq('id', tournamentId)
    .maybeSingle()
  if (lookupError) {
    return NextResponse.json(
      { error: 'db_lookup_failed', detail: lookupError.message },
      { status: 500 },
    )
  }
  if (!tournament) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }

  await ensureTournamentCoversBucket(supabase)

  const objectKey = `${tournamentId}.${validation.ext}`
  const arrayBuffer = await validFile.arrayBuffer()
  const { error: uploadError } = await supabase.storage
    .from(TOURNAMENT_COVERS_BUCKET)
    .upload(objectKey, arrayBuffer, {
      contentType: validFile.type,
      upsert: true,
    })
  if (uploadError) {
    return NextResponse.json(
      { error: 'upload_failed', detail: uploadError.message },
      { status: 500 },
    )
  }

  const { data: publicData } = supabase.storage
    .from(TOURNAMENT_COVERS_BUCKET)
    .getPublicUrl(objectKey)
  // Cache-bust on replace by appending a timestamp query.
  const coverUrl = `${publicData.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase
    .from('tournaments')
    .update({ cover_image_url: coverUrl })
    .eq('id', tournamentId)
  if (updateError) {
    return NextResponse.json(
      { error: 'db_update_failed', detail: updateError.message },
      { status: 500 },
    )
  }

  return NextResponse.json({ ok: true, cover_image_url: coverUrl })
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const auth = checkOpsAuth(req)
  if (!auth.ok) return NextResponse.json({ error: auth.reason }, { status: 401 })

  const { id: tournamentId } = await ctx.params
  if (!tournamentId) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const supabase = getSupabaseAdmin()
  const { error } = await supabase
    .from('tournaments')
    .update({ cover_image_url: null })
    .eq('id', tournamentId)
  if (error) {
    return NextResponse.json(
      { error: 'db_update_failed', detail: error.message },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors. If `@/lib/ops-auth` doesn't resolve, search the repo (`grep -r "export.*checkOpsAuth" src`) for the actual path and adjust the import.

- [ ] **Step 4: Manual smoke test — happy path**

Start dev server: `npm run dev`

Visit the ops dashboard in your browser to set the `ops_token` cookie: `http://localhost:3002/ops?token=$CRON_SECRET`

Pick a tournament UUID from the database and:

```bash
curl -X PATCH "http://localhost:3002/api/ops/tournaments/<TOURNAMENT_ID>/cover" \
  --cookie "ops_token=$CRON_SECRET" \
  -F "file=@/path/to/test-image.jpg"
```

Expected: `200`, JSON `{"ok":true,"cover_image_url":"https://...supabase.co/storage/v1/object/public/tournament-covers/<id>.jpg?v=..."}`. Opening that URL shows the image.

- [ ] **Step 5: Manual smoke test — rejection paths**

```bash
# Wrong MIME
curl -X PATCH "http://localhost:3002/api/ops/tournaments/<TOURNAMENT_ID>/cover" \
  --cookie "ops_token=$CRON_SECRET" \
  -F "file=@/path/to/some.pdf" -i

# Bad auth
curl -X PATCH "http://localhost:3002/api/ops/tournaments/<TOURNAMENT_ID>/cover" \
  -F "file=@/path/to/image.jpg" -i
```

Expected: 400 (`unsupported_mime`), 401 (no cookie).

- [ ] **Step 6: Manual smoke test — DELETE**

```bash
curl -X DELETE "http://localhost:3002/api/ops/tournaments/<TOURNAMENT_ID>/cover" \
  --cookie "ops_token=$CRON_SECRET" -i
```

Expected: 200, `{"ok":true}`. Querying the row shows `cover_image_url IS NULL`.

- [ ] **Step 7: Commit**

```bash
git add src/app/api/ops/tournaments
git commit -m "feat(api): ops endpoint to upload/remove tournament cover image"
```

---

## Task 6: Render the cover on `TournamentSpotlightHero` (home featured)

**Files:**
- Modify: `src/components/TournamentSpotlightHero.tsx`

- [ ] **Step 1: Extend the local Tournament prop type**

Find the local `Tournament` type in `src/components/TournamentSpotlightHero.tsx` (around lines 178-188). Add the field:

```typescript
type Tournament = {
  // ...existing fields preserved
  logo_url?: string | null
  cover_image_url?: string | null   // <-- add this
}
```

- [ ] **Step 2: Add `import Image from 'next/image'`**

If `next/image` is not already imported at the top of the file, add it.

- [ ] **Step 3: Ensure the clipped card wrapper supports a fill image**

Find the outer wrapper `<div>` that uses `clipPath: CHUNKY.card` (around line 287-302). Its style must include `position: 'relative'` and `overflow: 'hidden'` for `next/image fill` to work correctly. If either is missing, add it.

- [ ] **Step 4: Inject image + gradient as first children**

Immediately after the outer wrapper's opening tag (before the green accent bar around line 313-318), insert:

```tsx
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
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.85) 100%)',
        zIndex: 1,
      }}
    />
  </>
) : null}
```

- [ ] **Step 5: Lift existing content above the gradient**

The pills row, title row, location/dates, champion rows, countdown, and CTA all need to sit above the gradient when a cover is present. Find the first inner content container (the one that wraps everything after the green accent bar) and add `position: 'relative', zIndex: 2` to its style. If the children are siblings (not wrapped), wrap them in a single `<div style={{ position: 'relative', zIndex: 2 }}>...</div>`.

- [ ] **Step 6: Verify in browser — with cover set**

Make sure `npm run dev` is running. Set a `cover_image_url` on the tournament currently displayed in the home Featured card (use the PATCH endpoint from Task 5 or set directly in Supabase Studio).

Open: http://localhost:3002

Expected: Featured card renders with the image as background, gradient overlay, all existing content (countdown, champions, CTA) readable on top.

- [ ] **Step 7: Verify in browser — fallback**

Clear that tournament's `cover_image_url` (DELETE endpoint or set NULL). Reload home.

Expected: card looks exactly as it did before this task.

- [ ] **Step 8: Commit**

```bash
git add src/components/TournamentSpotlightHero.tsx
git commit -m "feat(home): render cover image on featured tournament card"
```

---

## Task 7: Render the cover on `BigTournamentCard` (events list)

**Files:**
- Modify: `src/components/home/TournamentsView.tsx`

- [ ] **Step 1: Verify the Tournament type covers `cover_image_url`**

`BigTournamentCard` should consume the shared `Tournament` interface from `./shared` (already updated in Task 2). If the file declares its own local type, add `cover_image_url?: string | null`.

- [ ] **Step 2: Add `import Image from 'next/image'`**

Add to the top of the file if not already imported.

- [ ] **Step 3: Ensure the card wrapper supports a fill image**

Find `BigTournamentCard`'s outer `<div>` (with `clipPath: CHUNKY.card`, `padding: 20`, `background: linear-gradient(...)`, etc.). Add `position: 'relative'` and `overflow: 'hidden'` to its style if not present.

- [ ] **Step 4: Inject image + gradient as first children inside the wrapper**

Immediately after the outer wrapper's opening tag, insert:

```tsx
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

- [ ] **Step 5: Lift existing content above the gradient**

Wrap the existing inner content (radial-glow div, state/flag/name flex row, countdown box, level pill / CTA) in a single `<div style={{ position: 'relative', zIndex: 2 }}>...</div>`. Don't change the inner structure — just wrap it.

- [ ] **Step 6: Reposition the days counter to top-right when cover is set**

Find where the countdown box is rendered today. Replace its rendering with a conditional:

```tsx
{tournament.cover_image_url ? (
  <div
    style={{
      position: 'absolute',
      top: 12,
      right: 12,
      zIndex: 3,
      background: '#BCE83B',
      color: '#0a0a0a',
      padding: '5px 10px',
      borderRadius: 8,
      textAlign: 'center',
      fontWeight: 800,
    }}
  >
    <div style={{ fontSize: 18, lineHeight: 1 }}>{daysUntil}</div>
    <div style={{ fontSize: 8, letterSpacing: '0.08em' }}>DÍAS</div>
  </div>
) : (
  /* preserve existing countdown markup unchanged here */
)}
```

Use the exact `daysUntil` variable name and DÍAS label format already present in the file — copy-paste the values from the existing markup, don't introduce new ones.

- [ ] **Step 7: Verify in browser — with cover set**

Set `cover_image_url` on an upcoming tournament shown on `/tournaments`. Open: http://localhost:3002/tournaments

Expected: card renders with cover, gradient, days badge top-right; title + dates bottom-left over the gradient.

- [ ] **Step 8: Verify in browser — fallback**

Clear the cover URL. Reload `/tournaments`.

Expected: card looks identical to before this task (days badge back in its old slot).

- [ ] **Step 9: Commit**

```bash
git add src/components/home/TournamentsView.tsx
git commit -m "feat(tournaments): render cover image on events list cards"
```

---

## Task 8: Render the cover banner on the tournament detail page

> ⚠️ **Superseded by Task 11 (2026-05-19 revision).** This task shipped as a static 16:9 banner (commit `08dae528`) and is now being replaced. Task 11 deletes this banner and replaces it with a collapsing header + V1 Broadcast identity. Both tasks are kept in this plan so the history is intact; if you're re-running the plan from scratch, **skip this task and execute Task 11 instead**.

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

- [ ] **Step 1: Add `import Image from 'next/image'`**

Add to the imports if not present.

- [ ] **Step 2: Add the hero banner above the existing header**

Find the existing header block on the detail page (the section that renders the tournament name + flag + level pill, with tabs below — around lines 320-365 per earlier exploration). Immediately above that block (below `AppHeader` if present), insert:

```tsx
{tournament?.cover_image_url ? (
  <div
    style={{
      position: 'relative',
      width: '100%',
      aspectRatio: '16 / 9',
      overflow: 'hidden',
      borderRadius: '12px 12px 0 0',
    }}
  >
    <Image
      src={tournament.cover_image_url}
      alt={tournament.name}
      fill
      sizes="(max-width: 768px) 100vw, 768px"
      style={{ objectFit: 'cover', zIndex: 0 }}
      priority
    />
    <div
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        background:
          'linear-gradient(180deg, rgba(0,0,0,0.4) 0%, rgba(0,0,0,0.2) 40%, rgba(0,0,0,0.85) 100%)',
        zIndex: 1,
      }}
    />
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: 16,
        color: 'white',
        zIndex: 2,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 800 }}>{tournament.name}</div>
      <div style={{ fontSize: 12, opacity: 0.85, marginTop: 2 }}>
        {tournament.location ?? tournament.country ?? ''}
      </div>
    </div>
  </div>
) : null}
```

Note: the dates line is intentionally not duplicated here — the existing header below still renders dates and tabs. The banner is purely visual presence; the existing header keeps doing its job.

- [ ] **Step 3: Verify in browser — with cover set**

Set a cover on a tournament, then visit `/tournaments/<id>`.

Expected: 16:9 hero at the very top with the image, gradient, name + location at bottom-left. Existing header and tabs render below unchanged.

- [ ] **Step 4: Verify in browser — fallback**

Clear the cover. Reload.

Expected: banner gone; page looks exactly as before.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/page.tsx"
git commit -m "feat(tournament): render cover image hero on detail page"
```

---

## Task 9: Build the ops UI (`TournamentCoversTab`)

**Files:**
- Create: `src/app/ops/TournamentCoversTab.tsx`
- Modify: `src/app/ops/OpsClient.tsx`

- [ ] **Step 1: Read an existing ops tab for reference**

Read: `src/app/ops/BrandsTab.tsx` — note the data-fetching pattern, table structure, and how it handles uploads/edits.

- [ ] **Step 2: Implement `TournamentCoversTab`**

Create `src/app/ops/TournamentCoversTab.tsx`:

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Tournament = {
  id: string
  name: string
  starts_at: string | null
  ends_at: string | null
  country: string | null
  level: string | null
  cover_image_url: string | null
}

type FilterScope = 'upcoming' | 'ongoing' | 'all'

export default function TournamentCoversTab() {
  const [scope, setScope] = useState<FilterScope>('upcoming')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Tournament[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const today = new Date().toISOString().slice(0, 10)
    let q = supabase
      .from('tournaments')
      .select('id, name, starts_at, ends_at, country, level, cover_image_url')
      .order('starts_at', { ascending: true })
      .limit(200)
    if (scope === 'upcoming') q = q.gte('starts_at', today)
    if (scope === 'ongoing') q = q.lte('starts_at', today).gte('ends_at', today)
    q.then(({ data, error }) => {
      if (cancelled) return
      if (error) setError(error.message)
      else setRows((data ?? []) as Tournament[])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [scope])

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase()
    if (!s) return rows
    return rows.filter((r) => r.name.toLowerCase().includes(s))
  }, [rows, search])

  async function uploadCover(t: Tournament, file: File) {
    setBusyId(t.id)
    setError(null)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(`/api/ops/tournaments/${t.id}/cover`, {
        method: 'PATCH',
        body: fd,
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'upload_failed')
      setRows((prev) =>
        prev.map((r) => (r.id === t.id ? { ...r, cover_image_url: json.cover_image_url } : r)),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function removeCover(t: Tournament) {
    if (!confirm(`Remove the cover image for ${t.name}?`)) return
    setBusyId(t.id)
    setError(null)
    try {
      const res = await fetch(`/api/ops/tournaments/${t.id}/cover`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        throw new Error(json.error ?? 'remove_failed')
      }
      setRows((prev) => prev.map((r) => (r.id === t.id ? { ...r, cover_image_url: null } : r)))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Tournament covers</h2>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        {(['upcoming', 'ongoing', 'all'] as FilterScope[]).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.1)',
              background: scope === s ? '#BCE83B' : '#181818',
              color: scope === s ? '#0a0a0a' : '#ddd',
              fontSize: 12,
              fontWeight: 600,
              textTransform: 'capitalize',
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <input
        type="search"
        placeholder="Search by tournament name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: '100%',
          padding: '8px 12px',
          marginBottom: 16,
          background: '#181818',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 8,
          color: '#fff',
          fontSize: 13,
        }}
      />

      {error ? (
        <div
          style={{
            padding: 12,
            marginBottom: 12,
            background: '#3a0a0a',
            color: '#ffb4b4',
            borderRadius: 6,
          }}
        >
          {error}
        </div>
      ) : null}

      <p style={{ fontSize: 11, opacity: 0.6, marginBottom: 12 }}>
        Recommended: 1600 × 900 (16:9), at least 1200 wide. JPG or WebP. Image is cropped from
        center — keep the focal point centered.
      </p>

      {loading ? (
        <div>Loading...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 11, opacity: 0.6 }}>
              <th style={{ padding: 8 }}>Cover</th>
              <th style={{ padding: 8 }}>Tournament</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((t) => (
              <CoverRow
                key={t.id}
                tournament={t}
                busy={busyId === t.id}
                onUpload={(file) => uploadCover(t, file)}
                onRemove={() => removeCover(t)}
              />
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: 24, textAlign: 'center', opacity: 0.5 }}>
                  No tournaments match
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CoverRow({
  tournament: t,
  busy,
  onUpload,
  onRemove,
}: {
  tournament: Tournament
  busy: boolean
  onUpload: (file: File) => void
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <tr style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
      <td style={{ padding: 8 }}>
        <div
          style={{
            width: 80,
            height: 45,
            background: t.cover_image_url
              ? `url(${t.cover_image_url}) center/cover`
              : '#181818',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.06)',
            color: '#666',
            fontSize: 9,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {t.cover_image_url ? null : 'no cover'}
        </div>
      </td>
      <td style={{ padding: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</div>
        <div style={{ fontSize: 11, opacity: 0.6 }}>
          {t.starts_at?.slice(0, 10)} – {t.ends_at?.slice(0, 10)} · {t.level ?? '—'}
        </div>
      </td>
      <td style={{ padding: 8, textAlign: 'right' }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onUpload(file)
            e.target.value = ''
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          style={{
            padding: '6px 10px',
            background: '#BCE83B',
            color: '#0a0a0a',
            border: 'none',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy ? 0.6 : 1,
            marginRight: 6,
          }}
        >
          {busy ? '...' : t.cover_image_url ? 'Replace' : 'Upload'}
        </button>
        <button
          onClick={onRemove}
          disabled={busy || !t.cover_image_url}
          style={{
            padding: '6px 10px',
            background: 'transparent',
            color: '#ff8a8a',
            border: '1px solid rgba(255,138,138,0.4)',
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 600,
            cursor: t.cover_image_url ? (busy ? 'wait' : 'pointer') : 'not-allowed',
            opacity: t.cover_image_url ? 1 : 0.4,
          }}
        >
          Remove
        </button>
      </td>
    </tr>
  )
}
```

- [ ] **Step 3: Register the tab in `OpsClient`**

Open `src/app/ops/OpsClient.tsx`.

(a) Add the import at the top (alongside `BrandsTab` etc.):

```tsx
import TournamentCoversTab from './TournamentCoversTab'
```

(b) Find the `navGroups` array (around lines 416-459). Add a new item to the appropriate group (Data Management, alongside Brands). Example:

```tsx
{ key: 'tournament-covers', label: 'Tournament covers' },
```

(c) Find the switch / conditional that maps `activeTab` → component (search for `BrandsTab` in the file). Add a sibling case rendering `<TournamentCoversTab />` for key `'tournament-covers'`, matching the exact pattern used by sibling tabs (object map vs. switch — whatever the file already uses).

- [ ] **Step 4: Verify in browser**

Open: `http://localhost:3002/ops?token=$CRON_SECRET`

Click the new "Tournament covers" tab.

Expected: list of upcoming tournaments with empty thumbnails, search and filter chips functional, Upload button opens file picker.

- [ ] **Step 5: End-to-end test in browser**

1. Click Upload on a tournament row → choose a 1600×900 JPG → confirm
2. Thumbnail updates in the table
3. Visit `/tournaments` and `/` (home) — image renders wherever this tournament appears
4. Visit `/tournaments/<id>` — hero banner renders
5. Back in ops, click Remove on the same row → confirm
6. Thumbnail returns to placeholder
7. Reload `/tournaments` and `/tournaments/<id>` — fallback design restored

- [ ] **Step 6: Commit**

```bash
git add src/app/ops/TournamentCoversTab.tsx src/app/ops/OpsClient.tsx
git commit -m "feat(ops): tab to upload/remove tournament cover images"
```

---

## Task 10: Final type-check, lint, build, and PR

- [ ] **Step 1: Type-check**

Run: `npx tsc --noEmit`

Expected: zero errors.

- [ ] **Step 2: Lint**

Run: `npm run lint`

Expected: zero errors. Fix any new warnings the changes introduced.

- [ ] **Step 3: Run all unit tests**

Run: `npx vitest run`

Expected: full suite green (including the new `tournament-cover-validation.test.ts`).

- [ ] **Step 4: Verify dev build**

Run: `npm run build`

Expected: build succeeds. (Vercel-prod-only `force-dynamic` mismatches surface here — if the detail page misbehaves, check that it has `export const dynamic = 'force-dynamic'` since it uses `AppHeader`.)

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin claude/mystifying-maxwell-5e0566
gh pr create --title "feat: tournament cover images (ops upload + 3 surfaces)" --body "$(cat <<'EOF'
## Summary
- Ops can upload a single promotional image per tournament; renders as a hero on the home Featured card, Events list cards, and Tournament detail page.
- Falls back to today's design when no cover is set — zero regression for tournaments without an image.

## Plan & spec
- Spec: docs/superpowers/specs/2026-05-18-tournament-cover-images-design.md
- Plan: docs/superpowers/plans/2026-05-18-tournament-cover-images.md

## Test plan
- [ ] Upload a 1600×900 JPG via ops, verify it appears on /, /tournaments, /tournaments/[id]
- [ ] Remove cover, verify all three surfaces revert to fallback
- [ ] Try a PDF upload → expect 400
- [ ] Try a 6 MB JPG → expect 413
- [ ] Try PATCH without ops cookie → expect 401
- [ ] vitest, tsc, lint, build all green
EOF
)"
```

---

## Task 11: Detail page — collapsing header + V1 Broadcast identity (revision)

**Status:** Pending (added 2026-05-19). Supersedes Task 8.

**Why this task exists:** Task 8 shipped a static 16:9 banner above the existing sticky header. After local review (2026-05-19) the user asked for a modern iOS-style collapsing-header pattern where the cover lives *inside* the header and a single sticky bar shrinks from 280 px to 62 px as the user scrolls. The identity block (title / level pill / flag / metadata / FOLLOW) inside the expanded hero uses the **V1 "Broadcast"** layout: kicker pill above big title, single-line metadata, FOLLOW outer-right.

**Reference:**
- Spec: see "Tournament detail page — collapsing header (revised)" in [`docs/superpowers/specs/2026-05-18-tournament-cover-images-design.md`](../specs/2026-05-18-tournament-cover-images-design.md)
- Visual reference: [`mockups/tournament-cover-collapsing-header.html`](../../../mockups/tournament-cover-collapsing-header.html) — run `Mockups (static)` preview server, open at `http://localhost:4100/tournament-cover-collapsing-header.html`

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx` (extensive — touches the sticky-header section and the tabs row)

**Constants to add** near the top of the file alongside the existing `BG_BASE`/`GREEN`/`MUTED` constants:

```ts
const HERO_EXPANDED = 280
const HERO_COLLAPSED = 62
const COLLAPSE_SCROLL = HERO_EXPANDED - HERO_COLLAPSED  // 218

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v))
```

- [ ] **Step 1: Delete Task 8's standalone hero block**

Locate the conditional block inserted by Task 8 (around line 623, immediately before the `{/* ── Sticky header ── */}` comment). It looks like:

```tsx
{activeTournamentObj?.cover_image_url ? (
  <div style={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', ... }}>
    <Image src={activeTournamentObj.cover_image_url} ... />
    ...
  </div>
) : null}
```

Delete the entire block (≈49 lines). Verify with `grep -c "aspectRatio: '16 / 9'" "src/app/[locale]/(app)/tournaments/[id]/page.tsx"` returning 0.

- [ ] **Step 2: Add scroll state and constants**

Near the existing `useState`/`useRef` declarations in the page component, add:

```tsx
const [heroProgress, setHeroProgress] = useState(0)

// prefers-reduced-motion snaps between expanded and collapsed
const reducedMotion = useMemo(() => {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}, [])

const p = reducedMotion ? (heroProgress > 0.5 ? 1 : 0) : heroProgress
const navbarLayerOpacity = p
const compactOpacity     = clamp01((p - 0.55) / 0.4)
const inlineOpacity      = clamp01((0.7 - p) / 0.4)
```

- [ ] **Step 3: Install the scroll listener**

Add a `useEffect` near the other effects:

```tsx
useEffect(() => {
  let rafToken: number | null = null
  function onScroll() {
    if (rafToken != null) return
    rafToken = requestAnimationFrame(() => {
      rafToken = null
      const y = window.scrollY
      setHeroProgress(Math.min(1, Math.max(0, y / COLLAPSE_SCROLL)))
    })
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
  return () => {
    window.removeEventListener('scroll', onScroll)
    if (rafToken != null) cancelAnimationFrame(rafToken)
  }
}, [])
```

- [ ] **Step 4: Replace the existing sticky header (Row 1 + Row 2) with the new Navbar**

Find the existing sticky header div (around line 670, the one with `position: 'sticky', top: 0, zIndex: 10`). It currently wraps **Row 1** (back + title + M/W), **Row 2** (flag + name + venue + dates + level pill + FOLLOW), and **Row 3** (tabs).

Remove the Row 1 and Row 2 JSX inside this sticky div (keep Row 3 for the next step). Replace the sticky-div opening with the new Navbar:

```tsx
{/* Navbar — sticky 62px bar with chrome + opacity-driven cover bg */}
<div style={{
  position: 'sticky', top: 0, zIndex: 25,
  height: HERO_COLLAPSED,
  overflow: 'hidden',
  background: '#0A0A0A',
}}>
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
      <div aria-hidden style={{
        position: 'absolute', inset: 0, zIndex: 1,
        background: 'rgba(10,10,10,0.55)',
        opacity: navbarLayerOpacity,
        pointerEvents: 'none',
      }} />
    </>
  ) : null}

  {/* Chrome row — back, compact title (fades in), M/W toggle, compact FOLLOW (fades in) */}
  <div style={{
    position: 'relative', zIndex: 2,
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '12px 16px', height: HERO_COLLAPSED,
  }}>
    <button
      onClick={() => { if (window.history.length > 1) router.back(); else router.push('/home') }}
      style={{
        width: 36, height: 36, border: 'none', cursor: 'pointer', background: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', flexShrink: 0,
      }}
      aria-label={tCommon('back')}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
    </button>

    {/* Compact title — fades in over progress 0.55 → 0.95 */}
    <span style={{
      flex: 1, minWidth: 0,
      fontSize: 18, fontWeight: 800, letterSpacing: -0.3,
      color: '#fff',
      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      opacity: compactOpacity,
    }}>
      {activeTournamentObj ? titleCase(activeTournamentObj.name) : 'Tournament Detail'}
    </span>

    {/* M/W toggle — preserve exact existing markup including the knob animation */}
    <div
      onClick={() => setGenderFilter(g => g === 'men' ? 'women' : 'men')}
      style={{
        display: 'inline-flex', alignItems: 'center', cursor: 'pointer',
        background: 'rgba(255,255,255,0.04)',
        clipPath: CHUNKY.badge,
        padding: '4px 6px', position: 'relative', width: 56, height: 28,
        flexShrink: 0,
      }}
    >
      <div style={{
        position: 'absolute', top: 3,
        left: genderFilter === 'men' ? 4 : 28,
        width: 24, height: 22,
        background: genderFilter === 'women' ? WOMEN_PURPLE : MEN_BLUE,
        clipPath: CHUNKY.badge,
        transition: 'left 0.2s ease, background 0.2s ease',
      }} />
      <span style={{
        flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 800,
        position: 'relative', zIndex: 1,
        color: genderFilter === 'men' ? '#000' : MUTED,
        transition: 'color 0.2s',
      }}>M</span>
      <span style={{
        flex: 1, textAlign: 'center', fontSize: 11, fontWeight: 800,
        position: 'relative', zIndex: 1,
        color: genderFilter === 'women' ? '#000' : MUTED,
        transition: 'color 0.2s',
      }}>W</span>
    </div>

    {/* Compact FOLLOW — fades in over progress 0.55 → 0.95 */}
    {activeTournamentObj ? (
      <div style={{
        opacity: compactOpacity,
        pointerEvents: compactOpacity > 0.5 ? 'auto' : 'none',
        flexShrink: 0,
      }}>
        <FollowButton type="tournament" targetId={activeTournamentObj.id} variant="follow" />
      </div>
    ) : null}
  </div>
</div>
```

Adjust the import line to confirm `Image`, `FollowButton`, `FlagImage`, `titleCase`, `CHUNKY`, `MEN_BLUE`, `WOMEN_PURPLE`, `MUTED` are all already imported (they are, post-Tasks 1–10).

- [ ] **Step 5: Add the HeroExpanded section immediately after the Navbar**

```tsx
{/* Expanded hero — pulled up to overlap the navbar at scroll=0,
    scrolls away naturally as the user scrolls. */}
<div style={{
  position: 'relative', zIndex: 5,
  height: HERO_EXPANDED,
  marginTop: -HERO_COLLAPSED,
  overflow: 'hidden',
  background: '#0A0A0A',
}}>
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

  {/* V1 Broadcast identity block at bottom-left */}
  {activeTournamentObj ? (
    <div style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3,
      padding: '14px 16px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeTournamentObj.level ? (
            <span style={{
              display: 'inline-block',
              fontSize: 10, fontWeight: 800,
              color: '#0A0A0A',
              background: '#BCE83B',
              clipPath: CHUNKY.badge,
              padding: '4px 12px',
              letterSpacing: 0.7,
              textTransform: 'uppercase',
            }}>
              {levelLabel(activeTournamentObj.level)}
            </span>
          ) : null}
          <div style={{
            fontSize: 26, fontWeight: 900,
            lineHeight: 1.05, letterSpacing: -0.5,
            color: '#fff',
            textShadow: '0 2px 8px rgba(0,0,0,0.45)',
            marginTop: 6,
          }}>
            {titleCase(activeTournamentObj.name)}
          </div>

          {/* Metadata row: flag + venue · dates · prize */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            {activeTournamentObj.country ? (
              <FlagImage country={activeTournamentObj.country} size={16} />
            ) : null}
            <span style={{
              fontSize: 12, fontWeight: 600,
              color: 'rgba(255,255,255,0.88)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              textShadow: '0 1px 4px rgba(0,0,0,0.4)',
            }}>
              {(() => {
                const parts: string[] = []
                if (activeTournamentObj.venue) parts.push(activeTournamentObj.venue as string)
                if (activeTournamentObj.starts_at && activeTournamentObj.ends_at) {
                  parts.push(
                    `${format.dateTime(new Date(activeTournamentObj.starts_at), DATE_SHORT)} – ${format.dateTime(new Date(activeTournamentObj.ends_at), DATE_SHORT)}`
                  )
                }
                if (activeTournamentObj.prize_money_fip && activeTournamentObj.prize_money_fip > 0) {
                  parts.push(`€${activeTournamentObj.prize_money_fip.toLocaleString()}`)
                } else {
                  const raw = activeTournamentObj.prize_money?.trim()
                  if (raw && !/^[^\d]*0$/.test(raw)) parts.push(raw)
                }
                return parts.join(' · ')
              })()}
            </span>
          </div>
        </div>

        {/* Inline FOLLOW — fades out over progress 0.30 → 0.70 */}
        <div style={{
          alignSelf: 'flex-start', marginTop: 6,
          opacity: inlineOpacity,
          pointerEvents: inlineOpacity > 0.5 ? 'auto' : 'none',
          flexShrink: 0,
        }}>
          <FollowButton type="tournament" targetId={activeTournamentObj.id} variant="follow" />
        </div>
      </div>
    </div>
  ) : null}
</div>
```

- [ ] **Step 6: Move Row 3 (tabs) out of the old sticky parent**

Locate the existing tabs block (around line 837, after the gender chip / coverage disclaimer). The block looks like:

```tsx
<div style={{ display: 'flex', borderBottom: `1px solid ${BORDER}` }}>
  {(['overview', 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const).map(tab => {
    ...
  })}
</div>
```

Wrap (or replace) the outer div with a sticky element positioned to sit just under the navbar:

```tsx
<div style={{
  position: 'sticky', top: HERO_COLLAPSED, zIndex: 19,
  background: '#0A0A0A',
  borderBottom: `1px solid ${BORDER}`,
  display: 'flex',
}}>
  {(['overview', 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const).map(tab => {
    /* existing tab button markup unchanged */
  })}
</div>
```

The original `borderBottom: 1px solid BORDER` moves onto the sticky wrapper. The tab buttons themselves keep their existing styling.

- [ ] **Step 7: Confirm the closing tag of the old sticky div is removed**

The old sticky div (which previously wrapped Row 1, Row 2, Row 3, the coverage disclaimer, and the stage selector strip) is gone. Its only remaining children — the coverage disclaimer and the stage selector strip — should now sit as direct children of `<main>` after the tabs.

Read 30 lines around the tabs to verify the closing tag balance:

```bash
grep -n "{/* ── Sticky header" "src/app/[locale]/(app)/tournaments/[id]/page.tsx"
```

Expected: no match (the comment was removed when the div was deleted in Step 4).

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```

Expected: zero errors. If something complains about `activeTournamentObj.venue` or `prize_money_fip` types, add the field to the local typing — the data is in the row but the local state was previously typed as `any[]`.

- [ ] **Step 9: Local smoke test**

Start the dev server. Visit `/tournaments/<italy-major-id>` (Italy Major has a cover set on prod). Scroll the page slowly.

Expected at scroll=0:
- Expanded hero shows the full cover (280 px)
- Kicker pill `MAJOR` at bottom-left
- Big title `Italy Major` (26 px) below the pill
- 16×11 flag + venue · dates · prize on a single metadata line
- Inline FOLLOW outer-right of the identity stack
- Top chrome: back button + M/W toggle visible over the cover; no compact title; no compact FOLLOW

Expected at scroll ≈ 100 (mid-collapse):
- Navbar bg + overlay at ~50% opacity (dim cover visible at top)
- Compact title and compact FOLLOW still invisible (delayed range 0.55–0.95)
- Inline FOLLOW fading out (~50%)
- Hero scrolling up — identity block visible just below mid-viewport

Expected at scroll ≥ 218 (full collapse):
- Navbar fully opaque: dim cover + dark overlay
- All compact chrome visible: back · `Italy Major` (18 px) · M/W · FOLLOW
- Hero scrolled away
- Tabs latched directly below the navbar at `top: 62 px`
- Body content visible below tabs

Test the fallback path: pick a tournament without a cover (e.g. Bordeaux P2). Reload `/tournaments/<id>`. The expanded hero shows the same identity block over a flat `#0A0A0A` background — no image, no gradient. The collapse animation still happens. Top chrome stays legible against the dark navbar.

- [ ] **Step 10: Verify keyboard / a11y**

- Tab through the navbar chrome with the keyboard: back arrow, gender toggle, FOLLOW should be reachable.
- With FOLLOW at `opacity: 0` (scroll = 0), `pointerEvents` is `'none'` — confirm clicking on the compact-FOLLOW invisible area does NOT trigger a follow. The inline FOLLOW (visible) should handle the click.
- After full collapse, the inline FOLLOW should be `pointer-events: none` (opacity 0), and the compact FOLLOW should be reachable.

- [ ] **Step 11: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/page.tsx"
git commit -m "$(cat <<'EOF'
feat(tournament): collapsing header with V1 Broadcast identity

Supersedes the static 16:9 banner shipped in Task 8 (commit 08dae528).
The cover image now lives inside the existing sticky header, which
shrinks from 280px to 62px as the user scrolls (iOS large-title pattern).

Identity block uses V1 Broadcast layout: kicker pill above the title,
single-line metadata with a small flag, inline FOLLOW outer-right.
Compact navbar gets back / Italy Major / M/W / FOLLOW once collapsed.

Cover persists as a dim background (brightness 0.35 + 55% black overlay)
on the collapsed bar. Tabs latch under the bar at top:62px. No-cover
fallback renders the same chrome over a flat #0A0A0A background.

Scroll listener is a single window.addEventListener wrapped in
requestAnimationFrame. prefers-reduced-motion snaps between expanded
and collapsed without interpolation. Inline and compact FOLLOW cross-
fade with pointer-events guards so only one is interactive at a time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

Items checked against the spec:
- ✅ Column added (Task 1)
- ✅ Bucket created — Task 4. **Deviation from spec**: spec mentioned a SQL migration for the bucket; the codebase convention in `equipment-image-rehost.ts` is programmatic `createBucket`, so we follow that instead. Functionally equivalent; spec text overruled by codebase convention.
- ✅ PATCH + DELETE endpoint with full validation (Tasks 3 + 5)
- ✅ Ops tab with search, filter chips, upload, remove (Task 9)
- ✅ Home Featured render surface (Task 6)
- ✅ Events list render surface (Task 7)
- ⚠️ Detail page render surface — **Task 8 shipped as a static 16:9 banner (now superseded). Task 11 is the new authoritative work**: collapsing header with V1 Broadcast identity.
- ✅ Fallback unchanged on shipped surfaces (each task's verify-fallback step); Task 11 fallback verified in Step 9
- ✅ Days counter top-right when cover present on `BigTournamentCard` (Task 7)
- ✅ `next/image` with `fill` + `object-cover`; Supabase Storage hostname already in `next.config.ts` per CLAUDE.md
- ✅ Type plumbing through all relevant queries and component prop types (Task 2)
- ✅ Tests for validator (Task 3); manual verification for routes and UI

Placeholder scan: no `TBD` / `TODO` / vague directives — every step has actual code or a concrete command.

Type consistency: `cover_image_url?: string | null` used identically across `Tournament` interfaces; `CoverValidationResult` returned and consumed in matching shapes; `TOURNAMENT_COVERS_BUCKET` constant used in both `tournament-cover-bucket.ts` and the route; `ensureTournamentCoversBucket` signature stable. Task 11 constants (`HERO_EXPANDED`, `HERO_COLLAPSED`, `COLLAPSE_SCROLL`) and the `heroProgress` / `compactOpacity` / `inlineOpacity` derived values live local to the detail page — no cross-file coupling.
