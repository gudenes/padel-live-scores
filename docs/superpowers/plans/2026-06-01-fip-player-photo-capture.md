# FIP High-Res Player Photo Capture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture FIP's high-res player photo (currently discarded by the profile worker), rehost it to Supabase Storage in a new `players.photo_url` column, backfill existing players, and display it as a side photo card on the admin full-profile page.

**Architecture:** The padelgod profile worker already downloads each player's full FIP page HTML. We parse the Yoast JSON-LD `#primaryimage` (full-res headshot, with `og:image` fallback), write it to a new `photo_url` column, and rehost it via a generalized version of the existing (byte-mirrored) avatar-rehost helper. A one-off padelgod script backfills already-profiled players. The admin app (`apps/ops`, admin.padelnachos.com) adds `photo_url` to the profile aggregator query and renders it as a portrait card on the right of the profile header (Option B), shown only when present.

**Tech Stack:** TypeScript, Supabase (Postgres + Storage), cheerio (HTML parsing), Vitest, Next.js 16 (apps/ops admin), padelgod Railway workers, axios.

**Spec:** `docs/superpowers/specs/2026-06-01-fip-player-photo-capture-design.md`

**Key real-world facts (verified against live padelfip.com on 2026-06-01):**
- Photo filenames are inconsistent across players (`Coello-c.png`, `Coello-p.png`, `TAPIA.png`) — the `-p` portrait variant is NOT universal.
- The ONE reliable source on every player page is the Yoast JSON-LD `ImageObject` whose `@id` ends with `#primaryimage` (e.g. Coello → `Coello-c.png`, 500×500; Tapia → `TAPIA.png`). `og:image` carries the same URL as a fallback.
- The `avatars` Supabase Storage bucket already exists (2 MB limit; webp/jpeg/png/gif). We store the photo there under key `{playerId}-full.{ext}`, keeping the existing thumbnail at `{playerId}.{ext}`.

---

## File Structure

| File | Responsibility | Create/Modify |
|---|---|---|
| `supabase/migrations/20260601000000_players_photo_url.sql` | Add `players.photo_url` column | Create |
| `padelgod/src/parsers/fip-player-profile.ts` | Extract `photoUrl` from JSON-LD / og:image | Modify |
| `padelgod/src/__tests__/parsers/fip-player-profile.test.ts` | Parser tests for `photoUrl` | Modify |
| `padelgod/src/lib/avatar-rehost.ts` | Generalize rehost to support `photo_url` column + key suffix (mirror A) | Modify |
| `src/lib/avatar-rehost.ts` | Byte-identical mirror B | Modify |
| `padelgod/src/lib/__tests__/avatar-rehost.test.ts` | Unit test for storage-key builder | Create |
| `padelgod/src/workers/player-profile.ts` | Write `photo_url` + rehost photo, best-effort | Modify |
| `padelgod/src/workers/__tests__/player-profile.test.ts` | `buildPlayerProfileUpdate` photo_url tests | Modify |
| `padelgod/scripts/backfill-player-photos.ts` | One-off backfill for already-profiled players | Create |
| `apps/ops/src/app/api/internal/player/[id]/route.ts` | Add `photo_url` to `PLAYER_COLUMNS` | Modify |
| `apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx` | Option B side photo card + interface field | Modify |

**Note on the byte-mirror:** `padelgod/src/lib/avatar-rehost.ts` and `src/lib/avatar-rehost.ts` must stay byte-identical except for their header comment. Task 3 edits both with the same diff.

---

## Task 1: Add `photo_url` column migration

**Files:**
- Create: `supabase/migrations/20260601000000_players_photo_url.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Add players.photo_url: high-res FIP player photo (Yoast primary image),
-- rehosted to the Supabase Storage `avatars` bucket under key
-- `{playerId}-full.{ext}`. avatar_url stays the 150x150 thumbnail.
ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_url text;

COMMENT ON COLUMN players.photo_url IS
  'High-res FIP player photo (Yoast #primaryimage / og:image), rehosted to Supabase Storage avatars bucket as {id}-full.{ext}. avatar_url remains the 150x150 thumbnail.';
```

- [ ] **Step 2: Apply the migration to the dev database**

Run (repo root): `npx supabase db push`
Expected: the migration applies cleanly; `players.photo_url` now exists.
(If your environment applies migrations via the Supabase dashboard instead, paste the SQL above into the SQL editor and run it. The column MUST exist in the live DB before Tasks 4–7 can write/read it.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260601000000_players_photo_url.sql
git commit -m "feat(db): add players.photo_url for high-res FIP photo"
```

---

## Task 2: Parse the high-res photo URL

**Files:**
- Modify: `padelgod/src/parsers/fip-player-profile.ts`
- Test: `padelgod/src/__tests__/parsers/fip-player-profile.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the existing `describe('parseFipPlayerProfile', ...)` block in `padelgod/src/__tests__/parsers/fip-player-profile.test.ts` (before its closing `});`):

```ts
  it('extracts photoUrl from the Yoast #primaryimage ImageObject', () => {
    const html = `<script type="application/ld+json">{
      "@context":"https://schema.org",
      "@graph":[
        {"@type":["WebPage","ProfilePage"],"mainEntity":{"@type":"Person","name":"Arturo Coello"}},
        {"@type":"ImageObject","@id":"https://www.padelfip.com/player/arturo-coello/#primaryimage","url":"https://www.padelfip.com/wp-content/uploads/2023/02/Coello-c.png","contentUrl":"https://www.padelfip.com/wp-content/uploads/2023/02/Coello-c.png","width":500,"height":500}
      ]
    }</script>`;
    expect(parseFipPlayerProfile(html).photoUrl).toBe(
      'https://www.padelfip.com/wp-content/uploads/2023/02/Coello-c.png',
    );
  });

  it('falls back to og:image when no JSON-LD primary image is present', () => {
    const html = `<html><head><meta property="og:image" content="https://www.padelfip.com/wp-content/uploads/2023/02/TAPIA.png" /></head><body></body></html>`;
    expect(parseFipPlayerProfile(html).photoUrl).toBe(
      'https://www.padelfip.com/wp-content/uploads/2023/02/TAPIA.png',
    );
  });

  it('returns null photoUrl when no image source is present', () => {
    expect(parseFipPlayerProfile('<html><body></body></html>').photoUrl).toBeNull();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-player-profile.test.ts`
Expected: FAIL — `result.photoUrl` is `undefined` / property does not exist.

- [ ] **Step 3: Add `photoUrl` to the interface**

In `padelgod/src/parsers/fip-player-profile.ts`, add the field to `ParsedPlayerProfile` (after `side`):

```ts
  side: string | null;
  /**
   * High-res player photo URL from the FIP page. Source priority:
   *   1. Yoast JSON-LD ImageObject whose @id ends with '#primaryimage'
   *      (full-res headshot — present on every player page).
   *   2. <meta property="og:image"> as a fallback.
   * null when neither is present. Note: FIP's per-player filenames are
   * inconsistent (Coello-c.png, TAPIA.png, …) so we do NOT pattern-match
   * filenames — the JSON-LD/og source is the stable signal.
   */
  photoUrl: string | null;
```

- [ ] **Step 4: Add the extractor helper**

In the same file, add this function above `export function parseFipPlayerProfile`:

```ts
/**
 * Resolve the high-res player photo. Yoast emits an ImageObject in its @graph
 * whose @id ends with '#primaryimage'; prefer its contentUrl (falling back to
 * url). When the JSON-LD path misses, fall back to the og:image meta tag.
 */
function findPrimaryImageUrl(ld: unknown, html: string): string | null {
  if (ld && typeof ld === 'object') {
    const graph = (ld as Record<string, any>)['@graph'];
    if (Array.isArray(graph)) {
      for (const node of graph) {
        if (
          node &&
          typeof node === 'object' &&
          node['@type'] === 'ImageObject' &&
          typeof node['@id'] === 'string' &&
          node['@id'].endsWith('#primaryimage')
        ) {
          const url = node.contentUrl ?? node.url;
          if (typeof url === 'string' && url.trim()) return url.trim();
        }
      }
    }
  }
  const og = html.match(
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  );
  if (og && og[1] && og[1].trim()) return og[1].trim();
  return null;
}
```

- [ ] **Step 5: Wire it into the parser return**

In `parseFipPlayerProfile`, after the coaches block and before the `return`, compute the photo URL using the already-parsed `ld`:

```ts
  const photoUrl = findPrimaryImageUrl(ld, html);

  return { fipId, birthDate, birthPlace, heightCm, affiliation, racketBrand, racketModel, coaches, side, photoUrl };
```

(Replace the existing `return { … side };` line with the version above. The `ld` variable already exists earlier in the function from `const ld = extractJsonLd(html);`.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-player-profile.test.ts`
Expected: PASS — all parser tests green (existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/parsers/fip-player-profile.ts padelgod/src/__tests__/parsers/fip-player-profile.test.ts
git commit -m "feat(padelgod): parse high-res FIP photo URL from profile page"
```

---

## Task 3: Generalize the rehost helper (both mirrors)

**Files:**
- Modify: `padelgod/src/lib/avatar-rehost.ts`
- Modify: `src/lib/avatar-rehost.ts` (byte-identical except header comment)
- Test: `padelgod/src/lib/__tests__/avatar-rehost.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `padelgod/src/lib/__tests__/avatar-rehost.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { storageKeyFor } from '../avatar-rehost.js';

describe('storageKeyFor', () => {
  it('builds the avatar key with no suffix', () => {
    expect(storageKeyFor('abc-123', '', 'png')).toBe('abc-123.png');
  });
  it('builds the high-res photo key with the -full suffix', () => {
    expect(storageKeyFor('abc-123', '-full', 'jpg')).toBe('abc-123-full.jpg');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd padelgod && npx vitest run src/lib/__tests__/avatar-rehost.test.ts`
Expected: FAIL — `storageKeyFor` is not exported.

- [ ] **Step 3: Generalize `padelgod/src/lib/avatar-rehost.ts`**

Make these exact edits:

(a) Add the exported key builder near the top, after `isSupabaseHosted`:

```ts
export function storageKeyFor(playerId: string, keySuffix: string, ext: string): string {
  return `${playerId}${keySuffix}.${ext}`
}

export interface RehostOptions {
  /** Which players column to read/write. Default 'avatar_url'. */
  column?: 'avatar_url' | 'photo_url'
  /** Suffix appended to the storage key, e.g. '-full'. Default ''. */
  keySuffix?: string
}
```

(b) Change the function signature and body of `rehostAvatarToSupabase` to honor the options (default behavior is unchanged):

```ts
export async function rehostAvatarToSupabase(
  supabase: SupabaseClient,
  playerId: string,
  sourceUrl: string | null | undefined,
  opts: RehostOptions = {},
): Promise<RehostResult> {
  const column = opts.column ?? 'avatar_url'
  const keySuffix = opts.keySuffix ?? ''

  if (!sourceUrl) {
    return { playerId, status: 'skipped-no-source' }
  }
  if (isSupabaseHosted(sourceUrl)) {
    return { playerId, status: 'skipped-already-hosted', newUrl: sourceUrl }
  }

  const { data: current, error: readError } = await supabase
    .from('players')
    .select(column)
    .eq('id', playerId)
    .maybeSingle()
  if (readError) {
    return { playerId, status: 'error', detail: `read failed: ${readError.message}` }
  }
  const currentUrl = (current as Record<string, string | null> | null)?.[column] ?? null
  if (isSupabaseHosted(currentUrl)) {
    return { playerId, status: 'skipped-already-hosted', newUrl: currentUrl! }
  }

  try {
    const res = await fetch(sourceUrl)
    if (!res.ok) {
      return { playerId, status: 'download-failed', detail: `${res.status} ${res.statusText}` }
    }
    const contentType = res.headers.get('Content-Type') ?? 'image/jpeg'
    const ext = pickExtension(contentType)
    const buffer = await res.arrayBuffer()
    const filePath = storageKeyFor(playerId, keySuffix, ext)

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(filePath, buffer, { contentType, upsert: true })
    if (uploadError) {
      return { playerId, status: 'upload-failed', detail: uploadError.message }
    }

    const newUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${filePath}`

    const { error: updateError } = await supabase
      .from('players')
      .update({ [column]: newUrl })
      .eq('id', playerId)
    if (updateError) {
      return { playerId, status: 'db-update-failed', detail: updateError.message }
    }

    return { playerId, status: 'ok', newUrl }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { playerId, status: 'error', detail }
  }
}
```

This is backward-compatible: the rankings worker call `rehostAvatarToSupabase(deps.supabase, pid, thumb)` still resolves to `column='avatar_url'`, `keySuffix=''`.

- [ ] **Step 4: Mirror the exact same changes into `src/lib/avatar-rehost.ts`**

Apply the identical `storageKeyFor` + `RehostOptions` additions and the same `rehostAvatarToSupabase` body to `src/lib/avatar-rehost.ts`. Do NOT change its header comment block (lines 1–14). After editing, verify the two files are byte-identical except the header:

Run: `diff <(tail -n +9 padelgod/src/lib/avatar-rehost.ts) <(tail -n +15 src/lib/avatar-rehost.ts)`
Expected: no output (identical bodies). If the line offsets differ, adjust the `tail -n` values so the comparison starts at the first line after each file's header comment — the goal is an empty diff for the code body.

- [ ] **Step 5: Run the test + existing rehost-dependent tests**

Run: `cd padelgod && npx vitest run src/lib/__tests__/avatar-rehost.test.ts src/__tests__/workers/player-rankings.test.ts`
Expected: PASS — new key-builder tests green, rankings worker tests still green.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/lib/avatar-rehost.ts src/lib/avatar-rehost.ts padelgod/src/lib/__tests__/avatar-rehost.test.ts
git commit -m "feat: generalize avatar rehost to support photo_url column + key suffix"
```

---

## Task 4: Profile worker writes + rehosts the photo

**Files:**
- Modify: `padelgod/src/workers/player-profile.ts`
- Test: `padelgod/src/workers/__tests__/player-profile.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('buildPlayerProfileUpdate', ...)` block in `padelgod/src/workers/__tests__/player-profile.test.ts` (before its closing `});`):

```ts
  it('writes photo_url when the parsed profile has a photoUrl', () => {
    const parsed = {
      fipId: 'P1', birthDate: null, birthPlace: null, heightCm: null,
      affiliation: null, racketBrand: null, racketModel: null, coaches: [],
      side: null,
      photoUrl: 'https://www.padelfip.com/wp-content/uploads/2023/02/Coello-c.png',
    };
    const u = buildPlayerProfileUpdate(parsed, 'ok');
    expect(u.photo_url).toBe('https://www.padelfip.com/wp-content/uploads/2023/02/Coello-c.png');
  });

  it('omits photo_url when photoUrl is null', () => {
    const parsed = {
      fipId: 'P1', birthDate: null, birthPlace: null, heightCm: null,
      affiliation: null, racketBrand: null, racketModel: null, coaches: [],
      side: null, photoUrl: null,
    };
    expect(buildPlayerProfileUpdate(parsed, 'ok').photo_url).toBeUndefined();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd padelgod && npx vitest run src/workers/__tests__/player-profile.test.ts`
Expected: FAIL — `u.photo_url` is `undefined` in the first new test.

- [ ] **Step 3: Write `photo_url` in `buildPlayerProfileUpdate`**

In `padelgod/src/workers/player-profile.ts`, inside `buildPlayerProfileUpdate`, within the `if (parsed && status === 'ok') {` block, add after the equipment block:

```ts
    if (parsed.photoUrl) updates.photo_url = parsed.photoUrl;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd padelgod && npx vitest run src/workers/__tests__/player-profile.test.ts`
Expected: PASS.

- [ ] **Step 5: Rehost the photo in `runPlayerProfile`**

In `padelgod/src/workers/player-profile.ts`, add the import near the top (with the other imports):

```ts
import { rehostAvatarToSupabase } from '../lib/avatar-rehost.js';
```

Then in `runPlayerProfile`, locate the existing tail:

```ts
  const parsedResult = parsed as ParsedPlayerProfile | null;
  return { updated: status === 'ok', fipId: parsedResult?.fipId ?? null, status };
```

Replace it with:

```ts
  const parsedResult = parsed as ParsedPlayerProfile | null;

  // Rehost the high-res photo to Supabase Storage (best-effort — a failed
  // image must never fail the profile run). We just wrote the raw FIP URL to
  // players.photo_url above; the rehost downloads it, stores it under
  // `{id}-full.{ext}`, and rewrites photo_url to the Supabase public URL.
  // Idempotent: already-Supabase-hosted photo_url short-circuits.
  if (parsedResult?.photoUrl) {
    await rehostAvatarToSupabase(deps.supabase, task.playerId, parsedResult.photoUrl, {
      column: 'photo_url',
      keySuffix: '-full',
    });
  }

  return { updated: status === 'ok', fipId: parsedResult?.fipId ?? null, status };
```

- [ ] **Step 6: Typecheck + run the worker test suite**

Run: `cd padelgod && npx tsc --noEmit && npx vitest run src/workers/__tests__/player-profile.test.ts`
Expected: typecheck clean; tests PASS.

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/workers/player-profile.ts padelgod/src/workers/__tests__/player-profile.test.ts
git commit -m "feat(padelgod): profile worker writes + rehosts high-res photo"
```

---

## Task 5: Backfill script for already-profiled players

**Files:**
- Create: `padelgod/scripts/backfill-player-photos.ts`

- [ ] **Step 1: Write the script**

Create `padelgod/scripts/backfill-player-photos.ts`:

```ts
// One-shot backfill: capture the high-res FIP photo for already-profiled
// players that don't have one yet (profile_url present, photo_url null).
// Reuses runPlayerProfile, which now parses + rehosts the photo.
//
// Bounded per run (default 200) to stay well under the PostgREST 10k cap;
// re-run until it reports "Found 0 players".
//
// Usage:
//   cd padelgod && SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
//     npx tsx scripts/backfill-player-photos.ts [--limit=200] [--dry-run]

import { createClient } from '@supabase/supabase-js';
import { createHttpClient, PADELGOD_USER_AGENT } from '../src/lib/http-client.js';
import { runPlayerProfile } from '../src/workers/player-profile.js';
import { ensureAvatarsBucket } from '../src/lib/avatar-rehost.js';

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number.parseInt(limitArg.split('=')[1] ?? '200', 10) : 200;
const dryRun = process.argv.includes('--dry-run');

const supabase = createClient(url, key, { auth: { persistSession: false } });
const httpClient = createHttpClient({ userAgent: PADELGOD_USER_AGENT });

await ensureAvatarsBucket(supabase);

const { data: rows, error } = await supabase
  .from('players')
  .select('id, profile_url')
  .not('profile_url', 'is', null)
  .is('photo_url', null)
  .limit(limit);
if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

console.log(`Found ${rows?.length ?? 0} players to backfill (limit ${limit}).`);
let ok = 0;
let fail = 0;
for (const row of rows ?? []) {
  if (dryRun) {
    console.log(`[dry-run] would backfill ${row.id} (${row.profile_url})`);
    continue;
  }
  try {
    const r = await runPlayerProfile(
      { supabase, httpClient },
      { playerId: row.id, profileUrl: row.profile_url as string },
    );
    if (r.status === 'ok') ok++;
    else fail++;
    console.log(`${row.id}: ${r.status}`);
  } catch (e) {
    fail++;
    console.error(`${row.id}: error`, e instanceof Error ? e.message : e);
  }
}
console.log(`Done. ok=${ok} fail=${fail}`);
process.exit(0);
```

- [ ] **Step 2: Typecheck the script**

Run: `cd padelgod && npx tsc --noEmit`
Expected: clean (no type errors). If `createHttpClient` / `PADELGOD_USER_AGENT` import paths differ, confirm them against `padelgod/src/index.ts` (which imports them from `./lib/http-client.js`).

- [ ] **Step 3: Dry-run against the live DB**

Run: `cd padelgod && SUPABASE_URL=$SUPABASE_URL SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY npx tsx scripts/backfill-player-photos.ts --limit=5 --dry-run`
Expected: prints "Found N players…" and 5 `[dry-run] would backfill …` lines (or "Found 0" if every profiled player already has a photo). No writes.

- [ ] **Step 4: Real run on a small batch**

Run: `cd padelgod && SUPABASE_URL=$SUPABASE_URL SUPABASE_SERVICE_KEY=$SUPABASE_SERVICE_KEY npx tsx scripts/backfill-player-photos.ts --limit=5`
Expected: 5 lines like `<uuid>: ok`. Then verify in SQL (Supabase editor):
`select id, avatar_url, photo_url from players where photo_url is not null limit 5;`
— `photo_url` should be a `…supabase.co/storage/v1/object/public/avatars/<id>-full.<ext>` URL.

- [ ] **Step 5: Commit**

```bash
git add padelgod/scripts/backfill-player-photos.ts
git commit -m "feat(padelgod): add backfill-player-photos one-off script"
```

---

## Task 6: Add `photo_url` to the admin profile aggregator

**Files:**
- Modify: `apps/ops/src/app/api/internal/player/[id]/route.ts`

- [ ] **Step 1: Add `photo_url` to `PLAYER_COLUMNS`**

In `apps/ops/src/app/api/internal/player/[id]/route.ts`, the `PLAYER_COLUMNS` constant currently includes `… external_id, fip_id, avatar_url, ` on its second concatenated line. Change that line to add `photo_url`:

```ts
  'race_ranking, race_points, race_move, external_id, fip_id, avatar_url, photo_url, ' +
```

(Leave the `PATCHABLE_FIELDS` set unchanged — `photo_url` is owned by the worker/backfill, not operator-edited.)

- [ ] **Step 2: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/internal/player/\[id\]/route.ts
git commit -m "feat(ops): include photo_url in player profile aggregator"
```

---

## Task 7: Render the side photo card (Option B)

**Files:**
- Modify: `apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx`

- [ ] **Step 1: Add `photo_url` to the `ProfileHeaderPlayer` interface**

In `ProfileHeader.tsx`, add the field to the interface (after `avatar_url`):

```ts
  avatar_url: string | null
  photo_url: string | null
```

(This flows through automatically: `apps/ops/src/app/(app)/players/[id]/_components/PlayerProfile.tsx` defines `AggregatorPlayer extends ProfileHeaderPlayer` and passes `state.data.player` straight into `<ProfileHeader player={…} />`. No change needed in PlayerProfile.tsx.)

- [ ] **Step 2: Render the photo card on the right of the header row**

In `ProfileHeader.tsx`, the header is `<div className="flex gap-6 items-start">` containing the avatar block and then `<div className="flex-1 min-w-0"> … </div>`. Immediately AFTER that closing `</div>` of the identity column, and BEFORE the closing `</div>` of the `flex gap-6` row, insert:

```tsx
        {player.photo_url && (
          <div className="flex-none">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={player.photo_url}
              alt={`${player.name} photo`}
              style={{
                width: 150,
                height: 188,
                borderRadius: 12,
                objectFit: 'cover',
                border: '1px solid var(--border-card)',
                background: 'var(--bg-hover)',
              }}
            />
          </div>
        )}
```

When `photo_url` is null the card is omitted and the header is visually identical to today. The 96px circular avatar + identity column are untouched.

- [ ] **Step 3: Typecheck**

Run: `cd apps/ops && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add apps/ops/src/app/\(app\)/players/\[id\]/_components/ProfileHeader.tsx
git commit -m "feat(ops): show high-res photo as side card on player profile (Option B)"
```

---

## Task 8: Manual verification in the running admin app

**Files:** none (verification only).

Per repo memory (`feedback_test-locally.md`): verify previewable changes in the running app before calling the work done.

- [ ] **Step 1: Ensure at least one player has a photo**

If Task 5 Step 4 didn't already populate one, run the backfill on a few players (Task 5 Step 4). Note one player UUID that now has a non-null `photo_url`, and one that has `photo_url IS NULL`.

- [ ] **Step 2: Start the admin app**

Run: `cd apps/ops && npm run dev`
Expected: dev server boots (note the port it prints).

- [ ] **Step 3: Verify the WITH-photo case**

Open `http://localhost:<port>/players/<uuid-with-photo>`.
Expected: the profile header shows the 96px circular avatar + identity on the left AND a ~150×188 rounded portrait photo card on the right, themed to the dark UI. Confirm the photo loads (Supabase Storage URL, not a broken image).

- [ ] **Step 4: Verify the WITHOUT-photo case**

Open `http://localhost:<port>/players/<uuid-without-photo>`.
Expected: header looks exactly as before — avatar + identity, NO photo card, no empty gap.

- [ ] **Step 5: Screenshot for the record (optional)**

Capture the with-photo header and confirm it matches the approved Option B mockup (`docs/superpowers/specs/2026-06-01-fip-player-photo-capture-design.md` references it).

- [ ] **Step 6: Final full-suite sanity check**

Run: `cd padelgod && npx vitest run && npx tsc --noEmit`
Run: `cd apps/ops && npx tsc --noEmit`
Expected: all green.

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** schema (T1), parser (T2), generalized rehost incl. byte-mirror (T3), worker write+rehost (T4), backfill (T5), admin aggregator (T6), Option B card (T7), manual verify (T8) — every spec section maps to a task.
- **Photo source decision:** the spec said "extract the full-size `<img>`"; implementation pins this to the Yoast JSON-LD `#primaryimage` (+ og:image fallback) instead, because live verification showed FIP per-player filenames are inconsistent and the `-p` portrait isn't universal. The JSON-LD source is present on every page and parsed with the existing pattern. This is a faithful, more-robust realization of the spec's intent (capture the high-res photo).
- **Idempotency:** rehost short-circuits on already-Supabase-hosted `photo_url`; backfill targets only `photo_url IS NULL`; the migration uses `IF NOT EXISTS`.
- **No UI regression:** table-row and drawer avatars are untouched (their queries — `search-players`, `/api/internal/players` — are not modified).
