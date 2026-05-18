# Tournament Cover Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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

## Self-review notes

Items checked against the spec:
- ✅ Column added (Task 1)
- ✅ Bucket created — Task 4. **Deviation from spec**: spec mentioned a SQL migration for the bucket; the codebase convention in `equipment-image-rehost.ts` is programmatic `createBucket`, so we follow that instead. Functionally equivalent; spec text overruled by codebase convention.
- ✅ PATCH + DELETE endpoint with full validation (Tasks 3 + 5)
- ✅ Ops tab with search, filter chips, upload, remove (Task 9)
- ✅ Three render surfaces (Tasks 6, 7, 8)
- ✅ Fallback unchanged on all three surfaces (each task's verify-fallback step)
- ✅ Days counter top-right when cover present on `BigTournamentCard` (Task 7)
- ✅ `next/image` with `fill` + `object-cover`; Supabase Storage hostname already in `next.config.ts` per CLAUDE.md
- ✅ Type plumbing through all relevant queries and component prop types (Task 2)
- ✅ Tests for validator (Task 3); manual verification for routes and UI

Placeholder scan: no `TBD` / `TODO` / vague directives — every step has actual code or a concrete command.

Type consistency: `cover_image_url?: string | null` used identically across `Tournament` interfaces; `CoverValidationResult` returned and consumed in matching shapes; `TOURNAMENT_COVERS_BUCKET` constant used in both `tournament-cover-bucket.ts` and the route; `ensureTournamentCoversBucket` signature stable.
