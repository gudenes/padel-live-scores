# Equipment image rehost — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `padel_brands.logo_url` + `padel_rackets.image_url` onto Supabase Storage so external CDN rot (Tactical, Shopify, Nox, Tennisnuts) stops breaking the player profile "Plays with" card.

**Architecture:** Mirror the proven `src/lib/avatar-rehost.ts` pattern. New `equipment` Supabase Storage bucket. New `equipment-image-rehost.ts` helper. Ops `POST`/`PATCH` routes rehost any external URL server-side on write. One-off `/api/admin/migrate-equipment-images` backfills the 32 still-working rows. Ops `BrandsTab` gains a "Upload file" affordance for brands with no working public source (e.g. Tactical, currently password-locked). `<img onError>` fallbacks at the two render sites in `player/[id]/page.tsx` make any future breakage degrade gracefully.

**Tech Stack:** Next.js 16 App Router, Supabase JS client (storage + DB), Vitest, React 19, TypeScript 5.

**Spec:** [docs/superpowers/specs/2026-05-13-equipment-image-rehost-design.md](../specs/2026-05-13-equipment-image-rehost-design.md)

**Branch:** `feat/equipment-image-rehost` (already cut from `origin/main`, spec already committed).

---

## File map

**Create:**
- `src/lib/equipment-image-rehost.ts` — rehost helper + `ensureEquipmentBucket`
- `src/lib/__tests__/equipment-image-rehost.test.ts` — unit tests for pure helpers (`pickExtension`, `isSupabaseHosted`)
- `src/app/api/admin/migrate-equipment-images/route.ts` — one-off batch backfill endpoint
- `src/app/api/ops/upload-equipment-image/route.ts` — multipart file upload endpoint

**Modify:**
- `src/app/api/ops/brands/route.ts` — wire rehost into POST + PATCH
- `src/app/api/ops/rackets/route.ts` — wire rehost into POST + PATCH
- `src/app/[locale]/player/[id]/page.tsx` — add `<img onError>` fallback at the brand-logo and racket-image render sites
- `src/app/ops/BrandsTab.tsx` — add "Upload file" buttons next to the logo URL + image URL inputs (edit-mode only)

**Operational (not commits):**
- Run `/api/admin/migrate-equipment-images` against prod
- Use the new upload affordance to fix the 5 dead URLs

---

## PR split

- **PR #1 (Tasks 1–7):** Helper + ops API rehost + batch migration + onError fallback. Land-and-run the migration. Most rows fixed.
- **PR #2 (Tasks 8–9):** File upload endpoint + BrandsTab UI. Needed for the 5 dead-URL rows.
- **Task 10:** Operational cleanup (no commit).

---

## Task 1: Rehost helper + bucket creator

**Why:** Single function that takes `(kind, entityId, sourceUrl)`, downloads the bytes, uploads to Supabase Storage `equipment` bucket, and UPDATEs the DB row. Used both by the ops `POST`/`PATCH` flow and by the one-off batch migrator. Same shape as `avatar-rehost.ts`. The pure helpers (`pickExtension`, `isSupabaseHosted`) are exported so they can be unit-tested without spinning up Supabase.

**Files:**
- Create: `src/lib/equipment-image-rehost.ts`
- Create: `src/lib/__tests__/equipment-image-rehost.test.ts`

### - [ ] Step 1: Write failing tests for the pure helpers

Create `src/lib/__tests__/equipment-image-rehost.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickExtension, isSupabaseHosted } from '../equipment-image-rehost'

describe('pickExtension', () => {
  it('returns svg for image/svg+xml', () => {
    expect(pickExtension('image/svg+xml')).toBe('svg')
  })
  it('returns png for image/png', () => {
    expect(pickExtension('image/png')).toBe('png')
  })
  it('returns webp for image/webp', () => {
    expect(pickExtension('image/webp')).toBe('webp')
  })
  it('returns gif for image/gif', () => {
    expect(pickExtension('image/gif')).toBe('gif')
  })
  it('returns jpg for image/jpeg', () => {
    expect(pickExtension('image/jpeg')).toBe('jpg')
  })
  it('returns jpg for image/jpg (non-canonical)', () => {
    expect(pickExtension('image/jpg')).toBe('jpg')
  })
  it('falls back to jpg for unknown content types', () => {
    expect(pickExtension('application/octet-stream')).toBe('jpg')
  })
})

describe('isSupabaseHosted', () => {
  it('returns true for a Supabase Storage URL', () => {
    expect(isSupabaseHosted('https://jwqaesjjoghzobngxejn.supabase.co/storage/v1/object/public/equipment/brand-x.png')).toBe(true)
  })
  it('returns false for an external CDN URL', () => {
    expect(isSupabaseHosted('https://cdn.shopify.com/foo.png')).toBe(false)
  })
  it('returns false for null', () => {
    expect(isSupabaseHosted(null)).toBe(false)
  })
  it('returns false for undefined', () => {
    expect(isSupabaseHosted(undefined)).toBe(false)
  })
  it('returns false for empty string', () => {
    expect(isSupabaseHosted('')).toBe(false)
  })
})
```

### - [ ] Step 2: Run tests — verify they fail

```bash
npx vitest run src/lib/__tests__/equipment-image-rehost.test.ts
```

Expected: FAIL with `Cannot find module '../equipment-image-rehost'` (module doesn't exist yet).

### - [ ] Step 3: Create the rehost helper module

Create `src/lib/equipment-image-rehost.ts`:

```ts
// src/lib/equipment-image-rehost.ts
// Downloads an external brand-logo or racket-image URL and rehosts it on
// Supabase Storage, then UPDATEs padel_brands.logo_url / padel_rackets.image_url
// to the new public URL. Used by:
//   - /api/admin/migrate-equipment-images (one-off batch)
//   - /api/ops/brands and /api/ops/rackets (server-side rehost on every write)
//
// Mirrors src/lib/avatar-rehost.ts. SVG is allowed (some brand logos are SVG).

import type { SupabaseClient } from '@supabase/supabase-js'

const BUCKET = 'equipment'
const SUPABASE_STORAGE_MARKER = '.supabase.co/storage/'

export type EquipmentKind = 'brand' | 'racket'

export type RehostStatus =
  | 'ok'
  | 'skipped-already-hosted'
  | 'skipped-no-source'
  | 'download-failed'
  | 'upload-failed'
  | 'db-update-failed'
  | 'error'

export interface RehostResult {
  kind: EquipmentKind
  entityId: string
  status: RehostStatus
  newUrl?: string
  detail?: string
}

export function pickExtension(contentType: string): string {
  if (contentType.includes('svg')) return 'svg'
  if (contentType.includes('png')) return 'png'
  if (contentType.includes('webp')) return 'webp'
  if (contentType.includes('gif')) return 'gif'
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg'
  return 'jpg'
}

export function isSupabaseHosted(url: string | null | undefined): boolean {
  return !!url && url.includes(SUPABASE_STORAGE_MARKER)
}

function tableFor(kind: EquipmentKind): { table: string; column: 'logo_url' | 'image_url' } {
  return kind === 'brand'
    ? { table: 'padel_brands', column: 'logo_url' }
    : { table: 'padel_rackets', column: 'image_url' }
}

/**
 * Rehost a single brand logo or racket image. Idempotent + safe to call on
 * every ops write — when the current URL is already on Supabase Storage we
 * short-circuit before any network call. Errors are returned via the result
 * object rather than thrown so a failed upstream image never breaks the
 * calling write path.
 */
export async function rehostEquipmentImageToSupabase(
  supabase: SupabaseClient,
  kind: EquipmentKind,
  entityId: string,
  sourceUrl: string | null | undefined,
): Promise<RehostResult> {
  if (!sourceUrl) {
    return { kind, entityId, status: 'skipped-no-source' }
  }
  if (isSupabaseHosted(sourceUrl)) {
    return { kind, entityId, status: 'skipped-already-hosted', newUrl: sourceUrl }
  }

  const { table, column } = tableFor(kind)

  // Re-read the current row — if it's already Supabase-hosted, skip.
  const { data: current, error: readError } = await supabase
    .from(table)
    .select(column)
    .eq('id', entityId)
    .maybeSingle()
  if (readError) {
    return { kind, entityId, status: 'error', detail: `read failed: ${readError.message}` }
  }
  const currentUrl = (current as Record<string, string | null> | null)?.[column] ?? null
  if (isSupabaseHosted(currentUrl)) {
    return { kind, entityId, status: 'skipped-already-hosted', newUrl: currentUrl! }
  }

  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      return { kind, entityId, status: 'download-failed', detail: `${res.status} ${res.statusText}` }
    }
    const contentType = res.headers.get('Content-Type') ?? 'image/jpeg'
    const ext = pickExtension(contentType)
    const buffer = await res.arrayBuffer()
    const filePath = `${kind}-${entityId}.${ext}`

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, { contentType, upsert: true })
    if (uploadError) {
      return { kind, entityId, status: 'upload-failed', detail: uploadError.message }
    }

    const newUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`

    const { error: updateError } = await supabase
      .from(table)
      .update({ [column]: newUrl })
      .eq('id', entityId)
    if (updateError) {
      return { kind, entityId, status: 'db-update-failed', detail: updateError.message }
    }

    return { kind, entityId, status: 'ok', newUrl }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { kind, entityId, status: 'error', detail }
  }
}

/**
 * Ensure the equipment bucket exists. Safe to call repeatedly — the
 * "already exists" error is treated as success.
 */
export async function ensureEquipmentBucket(
  supabase: SupabaseClient,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: 2 * 1024 * 1024,
    allowedMimeTypes: ['image/webp', 'image/jpeg', 'image/png', 'image/gif', 'image/svg+xml'],
  })
  if (error && !error.message.includes('already exists')) {
    return { ok: false, error: error.message }
  }
  return { ok: true }
}
```

### - [ ] Step 4: Run tests — verify they pass

```bash
npx vitest run src/lib/__tests__/equipment-image-rehost.test.ts
```

Expected: all 12 tests pass.

### - [ ] Step 5: Lint

```bash
npm run lint -- src/lib/equipment-image-rehost.ts src/lib/__tests__/equipment-image-rehost.test.ts
```

Expected: no errors.

### - [ ] Step 6: Commit

```bash
git add src/lib/equipment-image-rehost.ts src/lib/__tests__/equipment-image-rehost.test.ts
git commit -m "$(cat <<'EOF'
feat(equipment): add image-rehost helper for brands + rackets

Mirrors src/lib/avatar-rehost.ts. New `equipment` Supabase Storage
bucket. Helper is idempotent (skips already-hosted URLs), errors are
returned via the result object instead of thrown, SVG is allowed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Batch migration endpoint

**Why:** One-off admin endpoint that walks every brand + racket with a non-Supabase URL and calls the rehost helper. Same shape as `/api/admin/migrate-avatars`. Idempotent — re-running skips already-hosted rows.

**Files:**
- Create: `src/app/api/admin/migrate-equipment-images/route.ts`

### - [ ] Step 1: Create the route

```ts
// src/app/api/admin/migrate-equipment-images/route.ts
// One-time migration: downloads brand logos and racket images from external
// CDNs and rehosts them on Supabase Storage. Idempotent — already-hosted rows
// are skipped.
//
// Usage:
//   POST /api/admin/migrate-equipment-images                  → migrate brands + rackets
//   POST /api/admin/migrate-equipment-images?kind=brand       → brands only
//   POST /api/admin/migrate-equipment-images?kind=racket      → rackets only
//   POST /api/admin/migrate-equipment-images?limit=1          → test on a single row first
//
// Auth: Authorization: Bearer $CRON_SECRET

import { createServerClient } from '@/lib/supabase'
import {
  ensureEquipmentBucket,
  rehostEquipmentImageToSupabase,
  type EquipmentKind,
} from '@/lib/equipment-image-rehost'

const BATCH_SIZE = 20

function unauthorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const header = request.headers.get('authorization')
  return header !== `Bearer ${expected}`
}

interface Row { id: string; url: string }

async function fetchRows(
  sb: ReturnType<typeof createServerClient>,
  kind: EquipmentKind,
  limit: number | null,
): Promise<Row[]> {
  const table = kind === 'brand' ? 'padel_brands' : 'padel_rackets'
  const column = kind === 'brand' ? 'logo_url' : 'image_url'

  let q = sb
    .from(table)
    .select(`id, ${column}`)
    .not(column, 'is', null)
    .not(column, 'ilike', '%.supabase.co/storage/%')
    .order('id')

  if (limit) q = q.limit(limit)

  const { data, error } = await q
  if (error) throw new Error(`fetch ${table}: ${error.message}`)

  return (data ?? []).map((r) => ({
    id: (r as Record<string, string>).id,
    url: (r as Record<string, string | null>)[column] ?? '',
  }))
}

export async function POST(request: Request) {
  if (unauthorized(request)) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const kindParam = url.searchParams.get('kind')
  const limitParam = url.searchParams.get('limit')
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10) || 0) : null

  const kinds: EquipmentKind[] =
    kindParam === 'brand' ? ['brand']
    : kindParam === 'racket' ? ['racket']
    : ['brand', 'racket']

  const sb = createServerClient()

  const bucket = await ensureEquipmentBucket(sb)
  if (!bucket.ok) {
    return Response.json({ error: 'Failed to create bucket', detail: bucket.error }, { status: 500 })
  }

  const allResults: Array<Awaited<ReturnType<typeof rehostEquipmentImageToSupabase>>> = []

  for (const kind of kinds) {
    let rows: Row[]
    try {
      rows = await fetchRows(sb, kind, limit)
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE)
      const batchResults = await Promise.all(
        batch.map((row) => rehostEquipmentImageToSupabase(sb, kind, row.id, row.url)),
      )
      allResults.push(...batchResults)
    }
  }

  const migrated = allResults.filter((r) => r.status === 'ok').length
  const skipped = allResults.filter((r) => r.status.startsWith('skipped')).length
  const failed = allResults.filter((r) => !r.status.startsWith('skipped') && r.status !== 'ok')

  return Response.json({
    kinds,
    total: allResults.length,
    migrated,
    skipped,
    failed,
  })
}
```

### - [ ] Step 2: Lint

```bash
npm run lint -- src/app/api/admin/migrate-equipment-images/route.ts
```

Expected: no errors.

### - [ ] Step 3: Smoke-test against dev with `?limit=1&kind=brand`

Start the dev server in another terminal: `npm run dev`. Then:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3002/api/admin/migrate-equipment-images?limit=1&kind=brand"
```

Expected JSON shape:

```json
{
  "kinds": ["brand"],
  "total": 1,
  "migrated": 1,
  "skipped": 0,
  "failed": []
}
```

If a brand with a non-Supabase URL exists, exactly one should migrate. Verify the brand's row in `padel_brands` now has a URL containing `.supabase.co/storage/v1/object/public/equipment/brand-`. If `total: 0`, all brand URLs are already Supabase-hosted (unexpected at this stage).

### - [ ] Step 4: Commit

```bash
git add src/app/api/admin/migrate-equipment-images/route.ts
git commit -m "$(cat <<'EOF'
feat(equipment): add batch migration endpoint

POST /api/admin/migrate-equipment-images backfills existing rows by
calling rehostEquipmentImageToSupabase per row in batches of 20.
Supports ?kind=brand|racket and ?limit=N for partial runs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Wire rehost into ops `brands` API

**Why:** Every time ops creates or edits a brand with a non-Supabase URL, the server downloads + rehosts. Ops UX is unchanged — they paste the same external URL they pasted before, and the row ends up Supabase-hosted automatically.

**Files:**
- Modify: `src/app/api/ops/brands/route.ts`

### - [ ] Step 1: Modify `POST` and `PATCH` to call the rehost helper

Find the existing `POST` handler in `src/app/api/ops/brands/route.ts`. After the `insert(...).select().single()` succeeds, add a rehost call before returning. Find the existing `PATCH` handler. After the `update(...).select().single()` succeeds, add the same rehost call.

Add an import at the top of the file:

```ts
import { rehostEquipmentImageToSupabase, isSupabaseHosted } from '@/lib/equipment-image-rehost'
```

In the `POST` handler, after the row is created and before `return Response.json({ brand }, { status: 201 })`:

```ts
  // Rehost externally-hosted logo onto Supabase Storage. Failure here does
  // NOT fail the create — the row keeps the original URL and ops can retry.
  if (brand.logo_url && !isSupabaseHosted(brand.logo_url)) {
    const rehost = await rehostEquipmentImageToSupabase(supabase, 'brand', brand.id, brand.logo_url)
    if (rehost.status === 'ok' && rehost.newUrl) {
      brand.logo_url = rehost.newUrl
    }
  }
```

In the `PATCH` handler, after the row is updated and before `return Response.json({ brand })`:

```ts
  // Same rehost-on-write behavior as POST.
  if (brand.logo_url && !isSupabaseHosted(brand.logo_url)) {
    const rehost = await rehostEquipmentImageToSupabase(supabase, 'brand', brand.id, brand.logo_url)
    if (rehost.status === 'ok' && rehost.newUrl) {
      brand.logo_url = rehost.newUrl
    }
  }
```

### - [ ] Step 2: Lint

```bash
npm run lint -- src/app/api/ops/brands/route.ts
```

Expected: no errors.

### - [ ] Step 3: Smoke-test rehost-on-write

With `npm run dev` running, find an existing test brand or create one with a known working external URL. Authenticate to ops first by visiting `http://localhost:3002/ops?token=$CRON_SECRET` in a browser to set the `ops_token` cookie, then:

```bash
# Get the ops_token cookie value from the browser, or:
COOKIE="ops_token=<value-from-browser>"

# PATCH an existing brand to a known-working URL.
curl -X PATCH "http://localhost:3002/api/ops/brands" \
  -H "Cookie: $COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"id":"<some-brand-uuid>","updates":{"logo_url":"https://upload.wikimedia.org/wikipedia/commons/thumb/5/5c/Wilson_Sporting_Goods_logo.svg/200px-Wilson_Sporting_Goods_logo.svg.png"}}'
```

Expected: response body contains `"logo_url"` pointing at `*.supabase.co/storage/v1/object/public/equipment/brand-<uuid>.png`. Confirm by re-fetching from the DB.

### - [ ] Step 4: Commit

```bash
git add src/app/api/ops/brands/route.ts
git commit -m "$(cat <<'EOF'
feat(ops/brands): rehost externally-hosted logos on write

POST + PATCH now run the brand logo through rehostEquipmentImageToSupabase
when the incoming URL is not already Supabase-hosted. Failure of the
rehost does not fail the write — the row keeps the original URL.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Wire rehost into ops `rackets` API

**Why:** Same pattern as Task 3, applied to racket images.

**Files:**
- Modify: `src/app/api/ops/rackets/route.ts`

### - [ ] Step 1: Modify `POST` and `PATCH` to call the rehost helper

Add an import at the top of the file:

```ts
import { rehostEquipmentImageToSupabase, isSupabaseHosted } from '@/lib/equipment-image-rehost'
```

In the `POST` handler, after `racket` is returned from the insert and before `return Response.json({ racket }, { status: 201 })`:

```ts
  // Rehost externally-hosted image onto Supabase Storage. Failure here does
  // NOT fail the create — the row keeps the original URL and ops can retry.
  if (racket.image_url && !isSupabaseHosted(racket.image_url)) {
    const rehost = await rehostEquipmentImageToSupabase(supabase, 'racket', racket.id, racket.image_url)
    if (rehost.status === 'ok' && rehost.newUrl) {
      racket.image_url = rehost.newUrl
    }
  }
```

In the `PATCH` handler, after `racket` is returned from the update and before `return Response.json({ racket })`:

```ts
  // Same rehost-on-write behavior as POST.
  if (racket.image_url && !isSupabaseHosted(racket.image_url)) {
    const rehost = await rehostEquipmentImageToSupabase(supabase, 'racket', racket.id, racket.image_url)
    if (rehost.status === 'ok' && rehost.newUrl) {
      racket.image_url = rehost.newUrl
    }
  }
```

### - [ ] Step 2: Lint

```bash
npm run lint -- src/app/api/ops/rackets/route.ts
```

Expected: no errors.

### - [ ] Step 3: Smoke-test rehost-on-write

Same setup as Task 3 Step 3. PATCH an existing racket to a known-working URL:

```bash
curl -X PATCH "http://localhost:3002/api/ops/rackets" \
  -H "Cookie: $COOKIE" \
  -H "Content-Type: application/json" \
  -d '{"id":"<some-racket-uuid>","updates":{"image_url":"https://www.padelusa.com/cdn/shop/files/Pearl_1024x.png"}}'
```

Expected: response body contains `image_url` pointing at `*.supabase.co/storage/v1/object/public/equipment/racket-<uuid>.png`.

### - [ ] Step 4: Commit

```bash
git add src/app/api/ops/rackets/route.ts
git commit -m "$(cat <<'EOF'
feat(ops/rackets): rehost externally-hosted images on write

Mirror of the brand-logo change in the previous commit, applied to
padel_rackets.image_url.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Run batch migration in dev to verify the full pipeline

**Why:** Operational smoke test against the dev DB before opening the PR. Confirms the helper handles the real mix of image types (SVG, PNG, JPEG, WEBP) and that the 32 currently-working URLs all migrate cleanly.

**Files:** none (operational only).

### - [ ] Step 1: Run the migration without limit

With `npm run dev` running:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3002/api/admin/migrate-equipment-images"
```

Expected: a JSON response with `migrated` ≈ 32, `skipped` low, `failed` listing roughly 5 entries — the dead Tactical, Shopify, Nox, Tennisnuts rows. The `failed[]` items should have `status: 'download-failed'` with the upstream HTTP code in `detail`.

### - [ ] Step 2: Verify ops UI looks correct

Open `http://localhost:3002/ops` → Brands & Equipment tab. Logos and racket images for the migrated rows should still render (now served from Supabase). The 5 dead rows still show broken images — that's expected; they get fixed in Task 10.

### - [ ] Step 3: Confirm idempotency

Re-run the migration:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3002/api/admin/migrate-equipment-images"
```

Expected: `migrated: 0`, `skipped: 0`, and `total` only counts the still-failing rows (the helper short-circuits before the filter for already-hosted rows on a re-run — the SQL filter `not ilike '%.supabase.co/storage/%'` already excludes them at fetch time, so `total` should be ≈ 5, all with `status: 'download-failed'`).

No commit — this task is operational verification only.

---

## Task 6: Graceful `<img onError>` fallback in the player page

**Why:** Defense-in-depth. Even after the migration, a future Supabase outage, deleted file, or other URL breakage should degrade to a clean placeholder instead of the browser's broken-image icon. The fallback branches already exist (brand-name text for the logo case, placeholder SVG for the racket case) — we just gate them on a failure state in addition to URL nullness.

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`

### - [ ] Step 1: Add failure-state hooks near the existing equipment widget code

`src/app/[locale]/player/[id]/page.tsx` is a client component. Inside the component body, before the equipment widget IIFE at line 1014 (`{/* Equipment — "Plays with" ... */}`), add two `useState` calls:

```tsx
const [brandLogoFailed, setBrandLogoFailed] = useState(false)
const [racketImageFailed, setRacketImageFailed] = useState(false)
```

Reset them whenever the racket changes — add a `useEffect` next to them:

```tsx
useEffect(() => {
  setBrandLogoFailed(false)
  setRacketImageFailed(false)
}, [currentEquipment?.racket?.id])
```

(If `useState` / `useEffect` aren't already imported from `'react'` at the top of the file, add them to the import.)

### - [ ] Step 2: Gate the brand-logo render on the failure state

The existing brand-logo block in the equipment widget (around lines 1066–1075) looks like:

```tsx
{brandLogo ? (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={brandLogo}
    alt={brandName}
    style={{ height: 20, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.7 }}
  />
) : (
  <span style={{ fontSize: 9, fontWeight: 800, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.5 }}>{brandName}</span>
)}
```

Replace with:

```tsx
{brandLogo && !brandLogoFailed ? (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={brandLogo}
    alt={brandName}
    onError={() => setBrandLogoFailed(true)}
    style={{ height: 20, objectFit: 'contain', filter: 'brightness(0) invert(1)', opacity: 0.7 }}
  />
) : (
  <span style={{ fontSize: 9, fontWeight: 800, color: ORANGE, textTransform: 'uppercase', letterSpacing: 0.5 }}>{brandName}</span>
)}
```

### - [ ] Step 3: Gate the racket-image render on the failure state

The existing racket-image block (around lines 1122–1138) looks like:

```tsx
{racketImage ? (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={racketImage}
    alt={racketModel ?? ''}
    style={{
      height: 96, objectFit: 'contain',
      filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.5))',
    }}
  />
) : (
  <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6"/><line x1="12" y1="14" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/>
    </svg>
  </div>
)}
```

Replace with:

```tsx
{racketImage && !racketImageFailed ? (
  // eslint-disable-next-line @next/next/no-img-element
  <img
    src={racketImage}
    alt={racketModel ?? ''}
    onError={() => setRacketImageFailed(true)}
    style={{
      height: 96, objectFit: 'contain',
      filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.5))',
    }}
  />
) : (
  <div style={{ height: 96, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
    <svg width={32} height={32} viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="6"/><line x1="12" y1="14" x2="12" y2="22"/><line x1="9" y1="19" x2="15" y2="19"/>
    </svg>
  </div>
)}
```

### - [ ] Step 4: Manual UI verification

With `npm run dev` running, open Lucas Bergamini's profile in a browser:

`http://localhost:3002/pt/player/43ac372d-0293-4791-9292-201e985e2ce6`

To exercise the fallback path BEFORE running the migration, temporarily revert the Tactical brand's logo_url back to the dead URL. Or pick any brand whose URL the migration was able to fix and edit `padel_rackets.image_url` to a known-404 URL in the DB to confirm the fallback.

Expected: in the "Plays with" card, broken images render as:
- brand-logo failure → orange uppercase brand name text
- racket-image failure → faint outline silhouette icon (the existing placeholder SVG)

Neither should show the broken-image icon. Restore any test edits before continuing.

### - [ ] Step 5: Build verification

```bash
npm run build
```

Expected: build succeeds with no type errors in `src/app/[locale]/player/[id]/page.tsx`.

### - [ ] Step 6: Commit

```bash
git add src/app/[locale]/player/[id]/page.tsx
git commit -m "$(cat <<'EOF'
fix(player): graceful fallback when equipment images fail to load

Brand logo / racket image render now hooks <img onError> to swap to the
existing text/placeholder fallback. Broken external CDN URLs no longer
render the browser broken-image icon on the "Plays with" card.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Open PR #1

**Why:** Tasks 1–6 together form a self-contained slice: rehost infra + ops API wiring + batch migration + graceful UI fallback. PR #2 (file upload) can land independently.

### - [ ] Step 1: Push branch and open PR

```bash
git push -u origin feat/equipment-image-rehost
```

Then:

```bash
gh pr create --title "feat(equipment): rehost brand logos + racket images to Supabase Storage" --body "$(cat <<'EOF'
## Summary
- New `equipment` Supabase Storage bucket + `src/lib/equipment-image-rehost.ts` helper, mirroring the avatar-rehost pattern.
- Ops `POST`/`PATCH` for brands + rackets rehost any externally-hosted URL server-side on write — ops UX unchanged.
- One-off `/api/admin/migrate-equipment-images` backfills existing rows. Idempotent.
- `<img onError>` fallback on the player profile "Plays with" card so broken external URLs degrade to the existing text/SVG placeholder instead of the broken-image icon.

Spec: [docs/superpowers/specs/2026-05-13-equipment-image-rehost-design.md](docs/superpowers/specs/2026-05-13-equipment-image-rehost-design.md).

Follow-up (PR #2): file-upload affordance in `BrandsTab` to repair brands with no working public URL (e.g. Tactical, currently password-locked).

## Test plan
- [ ] `npx vitest run src/lib/__tests__/equipment-image-rehost.test.ts` passes
- [ ] `POST /api/admin/migrate-equipment-images?limit=1&kind=brand` migrates exactly 1 brand and returns the Supabase URL
- [ ] Re-running the same migration is a no-op (`migrated: 0`)
- [ ] `PATCH /api/ops/brands` with an external URL writes a Supabase URL into the row
- [ ] `PATCH /api/ops/rackets` with an external URL writes a Supabase URL into the row
- [ ] On a player page where the racket image fails to load, the placeholder SVG renders (no broken-image icon)
- [ ] On a player page where the brand logo fails to load, the brand-name text renders
- [ ] `npm run build` succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

### - [ ] Step 2: Verify PR

Capture the PR URL printed by `gh pr create` and post it back. Wait for review before continuing to Task 8.

After PR #1 is merged and the migration has been run once in prod, the 32 currently-working URLs will be on Supabase Storage. The 5 dead URLs still need the file-upload path from PR #2 to be repaired (Task 10).

---

## Task 8: File-upload endpoint

**Why:** Tactical's brand logo + El Jefe racket image cannot be rehosted from any public URL (the brand's CDN is gone and `tacticalpadel.com` is password-locked). Ops needs a way to upload a local image file directly into the `equipment` bucket. The endpoint just handles upload + returns the public URL — the existing PATCH flow does the DB write.

**Files:**
- Create: `src/app/api/ops/upload-equipment-image/route.ts`

### - [ ] Step 1: Create the route

```ts
// src/app/api/ops/upload-equipment-image/route.ts
// Multipart upload of an equipment image (brand logo or racket image).
// Stores in the `equipment` Supabase Storage bucket as
//   {kind}-{entityId}.{ext}
// and returns the public URL. Does NOT update the DB row — that happens
// via the existing PATCH from BrandsTab.
//
// Auth: ops_token cookie (httpOnly), same as other /api/ops routes.

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'
import {
  ensureEquipmentBucket,
  pickExtension,
  type EquipmentKind,
} from '@/lib/equipment-image-rehost'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const ALLOWED_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
])
const MAX_BYTES = 2 * 1024 * 1024

function isEquipmentKind(value: string): value is EquipmentKind {
  return value === 'brand' || value === 'racket'
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const kind = String(form.get('kind') ?? '')
  const entityId = String(form.get('entityId') ?? '')
  const file = form.get('file')

  if (!isEquipmentKind(kind)) {
    return Response.json({ error: 'kind must be "brand" or "racket"' }, { status: 400 })
  }
  if (!isUuid(entityId)) {
    return Response.json({ error: 'entityId must be a uuid' }, { status: 400 })
  }
  if (!(file instanceof File)) {
    return Response.json({ error: 'file is required' }, { status: 400 })
  }
  if (!ALLOWED_MIME.has(file.type)) {
    return Response.json(
      { error: `Unsupported file type: ${file.type}`, allowed: Array.from(ALLOWED_MIME) },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: `File too large (max ${MAX_BYTES} bytes)` }, { status: 400 })
  }

  const bucket = await ensureEquipmentBucket(supabase)
  if (!bucket.ok) {
    return Response.json({ error: 'Failed to create bucket', detail: bucket.error }, { status: 500 })
  }

  const ext = pickExtension(file.type)
  const filePath = `${kind}-${entityId}.${ext}`
  const buffer = await file.arrayBuffer()

  const { error: uploadError } = await supabase.storage
    .from('equipment')
    .upload(filePath, buffer, { contentType: file.type, upsert: true })

  if (uploadError) {
    return Response.json({ error: 'upload failed', detail: uploadError.message }, { status: 500 })
  }

  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/equipment/${filePath}`
  return Response.json({ url })
}
```

### - [ ] Step 2: Lint

```bash
npm run lint -- src/app/api/ops/upload-equipment-image/route.ts
```

Expected: no errors.

### - [ ] Step 3: Smoke-test the upload

With `npm run dev` running and ops_token cookie set in the browser:

```bash
COOKIE="ops_token=<value-from-browser>"
BRAND_ID="<some-existing-brand-uuid>"

# Use any small test image
curl -X POST "http://localhost:3002/api/ops/upload-equipment-image" \
  -H "Cookie: $COOKIE" \
  -F "kind=brand" \
  -F "entityId=$BRAND_ID" \
  -F "file=@/path/to/test-logo.png"
```

Expected: `{"url":"https://<project>.supabase.co/storage/v1/object/public/equipment/brand-<uuid>.png"}`. Open the URL in a browser — the image should render. Confirm the DB row is unchanged (the endpoint does not write the DB).

### - [ ] Step 4: Commit

```bash
git add src/app/api/ops/upload-equipment-image/route.ts
git commit -m "$(cat <<'EOF'
feat(ops): add equipment-image file upload endpoint

Multipart POST for direct upload of brand logos / racket images into
the `equipment` Supabase Storage bucket. Validates kind, uuid, MIME,
and 2 MB size cap. Returns the public URL without writing the DB —
the BrandsTab form's existing PATCH handles persistence.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: File-upload UI in `BrandsTab`

**Why:** Wire the new upload endpoint into the brand + racket edit forms. Edit-mode only — on create, there's no `id` to put in the storage path. Helper text directs ops to save first, then upload.

**Files:**
- Modify: `src/app/ops/BrandsTab.tsx`

### - [ ] Step 1: Add an upload helper near the top of the component

Inside the `BrandsTab` component body, after the existing `useState` declarations, add:

```tsx
const [uploadingBrand, setUploadingBrand] = useState(false)
const [uploadingRacket, setUploadingRacket] = useState(false)
const brandFileInputRef = useRef<HTMLInputElement>(null)
const racketFileInputRef = useRef<HTMLInputElement>(null)

const uploadImage = async (
  kind: 'brand' | 'racket',
  entityId: string,
  file: File,
): Promise<string> => {
  const body = new FormData()
  body.set('kind', kind)
  body.set('entityId', entityId)
  body.set('file', file)
  const res = await fetch('/api/ops/upload-equipment-image', { method: 'POST', body })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  const { url } = (await res.json()) as { url: string }
  return url
}
```

Add `useRef` to the React import at the top of the file if not already there.

### - [ ] Step 2: Add the "Upload file" button next to the brand logo URL input

Find the brand-form block (around line 372 — `<label style={labelStyle}>Logo URL</label>`). Replace the inner `<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>` block with:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
  <input
    style={{ ...inputStyle, flex: 1 }}
    value={brandForm.logo_url}
    onChange={e => setBrandForm(f => ({ ...f, logo_url: e.target.value }))}
    placeholder="https://..."
  />
  {brandForm.logo_url && (
    <img
      src={brandForm.logo_url}
      alt="preview"
      style={{ height: 20, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }}
      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )}
  <input
    ref={brandFileInputRef}
    type="file"
    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
    style={{ display: 'none' }}
    onChange={async (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !editingBrandId) return
      setUploadingBrand(true)
      setBrandMessage(null)
      try {
        const url = await uploadImage('brand', editingBrandId, file)
        setBrandForm(f => ({ ...f, logo_url: url }))
        setBrandMessage('Logo uploaded — click Save to persist')
      } catch (err) {
        setBrandMessage(`Error: ${err instanceof Error ? err.message : 'Upload failed'}`)
      } finally {
        setUploadingBrand(false)
      }
    }}
  />
  <button
    type="button"
    style={{ ...btnSecondary, opacity: editingBrandId ? 1 : 0.4, cursor: editingBrandId ? 'pointer' : 'not-allowed' }}
    disabled={!editingBrandId || uploadingBrand}
    onClick={() => brandFileInputRef.current?.click()}
    title={editingBrandId ? 'Upload a logo file (max 2 MB)' : 'Save the brand first, then upload'}
  >
    {uploadingBrand ? 'Uploading...' : 'Upload file'}
  </button>
</div>
```

### - [ ] Step 3: Add the "Upload file" button next to the racket image URL input

Find the racket-form block (around line 619 — `value={racketForm.image_url}`). Replace the surrounding container with the same shape used for the brand:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
  <input
    style={{ ...inputStyle, flex: 1 }}
    value={racketForm.image_url}
    onChange={e => setRacketForm(f => ({ ...f, image_url: e.target.value }))}
    placeholder="https://..."
  />
  {racketForm.image_url && (
    <img
      src={racketForm.image_url}
      alt="preview"
      style={{ height: 28, objectFit: 'contain', borderRadius: 2, flexShrink: 0 }}
      onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
    />
  )}
  <input
    ref={racketFileInputRef}
    type="file"
    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
    style={{ display: 'none' }}
    onChange={async (e) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file || !editingRacketId) return
      setUploadingRacket(true)
      setRacketMessage(null)
      try {
        const url = await uploadImage('racket', editingRacketId, file)
        setRacketForm(f => ({ ...f, image_url: url }))
        setRacketMessage('Image uploaded — click Save to persist')
      } catch (err) {
        setRacketMessage(`Error: ${err instanceof Error ? err.message : 'Upload failed'}`)
      } finally {
        setUploadingRacket(false)
      }
    }}
  />
  <button
    type="button"
    style={{ ...btnSecondary, opacity: editingRacketId ? 1 : 0.4, cursor: editingRacketId ? 'pointer' : 'not-allowed' }}
    disabled={!editingRacketId || uploadingRacket}
    onClick={() => racketFileInputRef.current?.click()}
    title={editingRacketId ? 'Upload an image file (max 2 MB)' : 'Save the racket first, then upload'}
  >
    {uploadingRacket ? 'Uploading...' : 'Upload file'}
  </button>
</div>
```

If the existing markup is slightly different from what's shown (different indent / wrapping element), preserve it — only swap the inner contents to add the file `<input>` + Upload button. Don't restructure surrounding layout.

### - [ ] Step 4: Build verification

```bash
npm run build
```

Expected: build succeeds. No type errors.

### - [ ] Step 5: Manual UI verification

With `npm run dev` running, visit `http://localhost:3002/ops?token=$CRON_SECRET`. Open the Brands & Equipment tab.

1. Click "Edit" on the Tactical brand. Click "Upload file". Pick any test PNG/SVG from local disk. The URL field should populate with a `*.supabase.co/storage/v1/object/public/equipment/brand-<uuid>.<ext>` URL. The preview thumbnail next to the URL field should render the uploaded image. Click "Save" — the row's `logo_url` is now the Supabase URL.
2. Click "New brand" (without saving first). The "Upload file" button should be disabled with the tooltip "Save the brand first, then upload".
3. Same checks on the racket edit / new flow.
4. Visit `/pt/player/<some-tactical-player>` — broken Tactical logo should be replaced once you upload a real Tactical logo + save.

### - [ ] Step 6: Commit

```bash
git add src/app/ops/BrandsTab.tsx
git commit -m "$(cat <<'EOF'
feat(ops/brands): file-upload affordance for brand logos + racket images

"Upload file" button next to the URL inputs in both edit forms.
Edit-mode only — on create, there's no entity id for the storage
path, so ops has to save first then upload. Hits the new
/api/ops/upload-equipment-image endpoint and writes the returned
Supabase URL into the form's URL field.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

### - [ ] Step 7: Open PR #2

```bash
git push
gh pr create --title "feat(ops): file-upload for brand logos + racket images" --body "$(cat <<'EOF'
## Summary
- New `/api/ops/upload-equipment-image` multipart endpoint stores files in the `equipment` Supabase Storage bucket (created in PR #1) and returns the public URL.
- `BrandsTab` gains an "Upload file" button next to the brand logo URL + racket image URL inputs (edit-mode only).
- Unblocks repair of brands with no working public CDN — Tactical (`tacticalpadel.com` currently password-locked), and the 4 other dead-URL rows.

Spec: [docs/superpowers/specs/2026-05-13-equipment-image-rehost-design.md](docs/superpowers/specs/2026-05-13-equipment-image-rehost-design.md). Depends on PR #1.

## Test plan
- [ ] `npm run build` succeeds
- [ ] Upload a test PNG to an existing brand via the ops UI — URL field auto-fills with a Supabase URL, preview renders, Save persists.
- [ ] Same for a racket.
- [ ] "Upload file" is disabled in the create form (tooltip explains why).
- [ ] Upload of a >2 MB file is rejected with a clear error.
- [ ] Upload of an `image/bmp` file is rejected.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Capture the PR URL.

---

## Task 10: Operational cleanup of the 5 dead-URL rows

**Why:** After both PRs merge, the 5 currently-failing rows still have dead URLs (rehost can't fix them — there's no working source). Ops uploads replacement files via the new affordance.

**Files:** none (operational only).

### - [ ] Step 1: Identify the 5 dead rows

```bash
node -e '
import("@supabase/supabase-js").then(async ({ createClient }) => {
  const dotenv = await import("dotenv")
  dotenv.config({ path: ".env.local" })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  const { data: brands } = await sb.from("padel_brands").select("id, name, logo_url").not("logo_url", "is", null).not("logo_url", "ilike", "%.supabase.co/storage/%")
  const { data: rackets } = await sb.from("padel_rackets").select("id, model, image_url, brand:padel_brands(name)").not("image_url", "is", null).not("image_url", "ilike", "%.supabase.co/storage/%")
  console.log("BRANDS still external:"); for (const b of brands) console.log(" ", b.name, b.id, b.logo_url)
  console.log("RACKETS still external:"); for (const r of rackets) console.log(" ", r.brand?.name, r.model, r.id, r.image_url)
})
'
```

Expected output: ~5 rows total. The current dead set is:

- Brand: Tactical (`86e7d4a1-7de9-4dfa-8f21-17c25cbe9a11`) — dead Shopify subdomain
- Racket: Tactical El Jefe - Master Edition (`85e97523-8245-4d7b-b0a0-748c97de3d30`) — same domain
- Racket: Metalbone HRD+ 3.5 — `cdn.shopify.com` 404
- Racket: AT Luxury (Nox) — `noxsport.com` 404
- Racket: ML10 Pro Cup — `tennisnuts.com` 404

(Any row that has migrated to Supabase Storage since this plan was written will not appear in the output — that's fine.)

### - [ ] Step 2: Source replacement images

For each row, find a usable image file:
- Tactical logo + El Jefe image: pull from Lucas Bergamini's signature racket marketing (Tactical Padel Instagram, retail product photos from `padelnuestro.com` / `padelmania.com`).
- Other rackets: the brand's current product page or a major padel retailer.

Save each file locally with an obvious filename. Aim for transparent-background PNG (or SVG for logos).

### - [ ] Step 3: Upload via the ops UI

For each row:
1. Open `https://padelnachos.com/ops?token=$CRON_SECRET` → Brands & Equipment tab.
2. Click Edit on the row.
3. Click "Upload file", select the saved file.
4. Verify the preview renders.
5. Click Save.
6. Open a player page known to use that brand/racket (e.g. Bergamini for Tactical El Jefe) and confirm the image renders in the "Plays with" card.

### - [ ] Step 4: Re-run the identify script

Re-run the script from Step 1. Expected output: no brands or rackets with non-Supabase `logo_url`/`image_url`. The fix is complete.

---

## Self-review against the spec

**Spec coverage:**
- "Server-side URL rehost on write" → Tasks 3 + 4
- "One-off batch migration of the 32 still-working external URLs" → Tasks 2 + 5
- "File-upload affordance in the ops `BrandsTab`" → Tasks 8 + 9
- "`onError` fallback at the two `<img>` render sites" → Task 6
- "One-time manual fixup of the 5 dead rows" → Task 10
- "New `equipment` Supabase Storage bucket" → Task 1 (`ensureEquipmentBucket`)
- "Key paths `brand-{brandId}.{ext}` / `racket-{racketId}.{ext}`" → Task 1 (helper) + Task 8 (upload endpoint), same scheme
- "Failures in rehost don't fail the write" → Tasks 3 + 4 (helper returns result; ops route ignores non-`ok`)
- "SVG is allowed" → Task 1 (`pickExtension`, allowed MIME list)
- "Two PRs" → Tasks 7 + 9

**Placeholder scan:** no TBDs, no "TODO", no "implement later", no "similar to". All code is shown in full at each step.

**Type consistency:** `EquipmentKind = 'brand' | 'racket'` is defined once in `equipment-image-rehost.ts` and reused by the upload endpoint via import. `RehostResult` uses `kind` + `entityId`, consistent across helper + batch endpoint. Storage path scheme `{kind}-{entityId}.{ext}` is identical in Task 1, Task 8, and Task 10.
