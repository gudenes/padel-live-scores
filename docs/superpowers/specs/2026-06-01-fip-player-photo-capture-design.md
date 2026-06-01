# FIP high-res player photo: capture, rehost, and surface on admin profile

**Date:** 2026-06-01
**Status:** Design approved, pending spec review

## Problem

Today we store a single player image: `players.avatar_url`, a 150×150 thumbnail.
It comes from FIP's rankings/search API (`thumbnail` field), is rehosted to
Supabase Storage, and powers small UI affordances (push largeIcons, table rows,
drawer headers). We never capture the larger photo that FIP exposes on each
player's profile page.

The padelgod profile worker (`padelgod/src/workers/player-profile.ts`) already
downloads the **full FIP player-page HTML** every run to parse birthdate,
height, side, coaches, and equipment — but discards the page's hero image. The
larger photo is therefore available "for free" (no extra HTTP request); we just
don't parse or store it.

### Observed FIP image variants

On a player page (e.g. Arturo Coello), two variants exist:

- Thumbnail (what we store today): `…/Coello-c-150x150.png`
- Full-size: `…/Coello-p.png`

The exact `<img>` selector for the full-size variant is **not yet pinned** — it
will be confirmed against a captured real-HTML fixture during implementation
(see Risks).

## Goals

1. Capture FIP's high-res player photo and store it in a **new** column,
   `players.photo_url`, leaving `avatar_url` (the small thumbnail) untouched.
2. Rehost the photo to Supabase Storage (consistent with the avatar strategy) so
   we don't depend on padelfip.com's hotlink availability.
3. Backfill already-profiled players on demand rather than waiting ~30 days for
   the profile worker to re-pick each one.
4. Surface the high-res photo on the **admin full player-profile page**
   (`admin.padelnachos.com` → `apps/ops` → `/players/[id]`).

## Non-goals

- Rendering `photo_url` on the public app (padelnachos.com).
- Changing the table-row (28×28) or drawer (64×64) avatars — they stay on
  `avatar_url`.
- Auto-replacing a photo that changes upstream (mirrors the existing avatar
  rehost idempotency tradeoff — see Rehost helper).

## Design

### 1. Schema

One migration adding a nullable column:

```sql
ALTER TABLE players ADD COLUMN photo_url text;
```

Semantics:
- `avatar_url` — small 150×150 thumbnail (unchanged).
- `photo_url` — large FIP variant, rehosted to Supabase Storage.

### 2. Parser — `padelgod/src/parsers/fip-player-profile.ts`

Add `photoUrl: string | null` to `ParsedPlayerProfile`. Extract the full-size
`<img>` from the player-header block of the profile HTML the worker already
fetches.

- Selector confirmed against a captured real-HTML fixture (committed as a test
  fixture). A selector miss → `null` (graceful; no write).
- Fully unit-tested alongside the existing parser tests.

### 3. Rehost helper — `padelgod/src/lib/avatar-rehost.ts` + `src/lib/avatar-rehost.ts`

These two files are **byte-identical mirrors** (enforced by convention; the
header comment is the only allowed difference). Both must change in lockstep.

Generalize `rehostAvatarToSupabase` to accept an options object so a second
image type can reuse the same code path:

```ts
rehostImageToSupabase(supabase, playerId, sourceUrl, {
  column: 'photo_url',     // default 'avatar_url'
  keySuffix: '-full',      // default '' → key `{playerId}.{ext}`
})
```

- Defaults preserve today's avatar behavior exactly (column `avatar_url`, key
  `{playerId}.{ext}`).
- Photo call writes `photo_url`, storage key `{playerId}-full.{ext}`, same
  `avatars` bucket, same 2 MB / mime limits.
- Idempotency check reads the **target column** — a daily run skips rows already
  Supabase-hosted. Tradeoff (inherited from avatars): a photo that changes
  upstream is not auto-replaced. Acceptable for v1.
- Errors continue to be returned via the result object, never thrown.

Keep the existing `rehostAvatarToSupabase` name as a thin wrapper (or an alias)
so current call sites in the rankings worker are untouched.

### 4. Profile worker — `padelgod/src/workers/player-profile.ts`

After a successful parse (`status === 'ok'`):

1. Write the raw FIP `photoUrl` to `players.photo_url` (via the existing update
   payload path in `buildPlayerProfileUpdate`, when present).
2. Rehost it, swapping `photo_url` to the Supabase URL.

Best-effort: a failed photo download/upload never fails the profile run (matches
the rankings worker's avatar handling). The batch is already sequential, so the
rehost runs inline per player.

### 5. Backfill

Populate already-profiled players (`profile_url IS NOT NULL AND photo_url IS
NULL`) on demand, in batches, reusing the existing `runPlayerProfile` flow
(which now captures + rehosts the photo as part of a normal profile run).

Conceptually mirrors `/api/admin/migrate-avatars` (batched, `Bearer
$CRON_SECRET`, `?limit=N`). Because the profile-page fetch + parse lives in
padelgod (not the Next.js app), the **exact trigger surface** — a thin Next.js
admin route that calls into padelgod, a padelgod one-shot script, or a padelgod
scheduler entry — is finalized during planning against padelgod's existing
on-demand-job pattern. The batch selection query must paginate via
`db-paginate.ts` if it can exceed 10k rows.

### 6. Admin UI — `apps/ops` (admin.padelnachos.com), full profile page only

The admin app recently migrated onto a shared ui-primitive + CSS-token design
system (PR series ending 2026-05-31, `docs/superpowers/specs/2026-05-31-admin-design-system-rollout-design.md`).
New rendering must follow that convention — **CSS theme tokens**
(`var(--bg-hover)`, `var(--border-card)`, `var(--text-1)`, …), not new Tailwind
color classes.

Two files change:

1. **Aggregator** — `apps/ops/src/app/api/internal/player/[id]/route.ts`
   Add `photo_url` to the `PLAYER_COLUMNS` constant (line ~22). This is the
   query that feeds the full profile page. (The table/drawer queries —
   `search-players` and `/api/internal/players` — are intentionally **not**
   touched.)

2. **Profile header** — `apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx`
   - Add `photo_url: string | null` to the `ProfileHeaderPlayer` interface
     (props flow through `PlayerProfile.tsx`, where
     `PlayerProfileData extends ProfileHeaderPlayer`).
   - **Layout: Option B (side photo card).** Keep the existing 96×96 circular
     avatar (with its `avatar_url → initials` fallback) exactly where it is on
     the left of the header. When `photo_url` is present, add a separate
     portrait card (~150×188, rounded, 1px `var(--border-card)`,
     `var(--bg-hover)` placeholder) on the **right** of the header row, after
     the identity column.
   - The header row becomes: `[avatar 96] [identity column, flex-1] [photo card]`.
   - When `photo_url` is null, the photo card is **omitted entirely** (no
     duplicate of the avatar) — the header renders exactly as it does today.
   - Themed with CSS tokens; no new Tailwind color classes.

## Data flow

```
FIP profile page (HTML, already fetched by profile worker)
  → parseFipPlayerProfile() extracts photoUrl
  → write players.photo_url (raw FIP URL)
  → rehostImageToSupabase(column='photo_url', keySuffix='-full')
       downloads → uploads to avatars/{playerId}-full.{ext}
       → updates players.photo_url to Supabase public URL
  → admin aggregator SELECT includes photo_url
  → ProfileHeader: 96px avatar (avatar_url → initials) unchanged on the left;
    a separate portrait card renders photo_url on the right when present
    (omitted when null)

Backfill: same flow, driven over players WHERE profile_url IS NOT NULL
          AND photo_url IS NULL.
```

## Error handling

- Parser selector miss → `photoUrl = null`, no write.
- Rehost download/upload failure → returned in result object, logged, profile
  run still succeeds.
- Idempotent: already-Supabase-hosted `photo_url` short-circuits before any
  network call.
- UI: missing `photo_url` falls back to `avatar_url`, then initials.

## Testing

- Parser unit tests with a committed real-HTML fixture (full-size image present,
  and a fixture where it's absent → `null`).
- Rehost helper: existing avatar tests stay green (defaults unchanged); add
  tests for the `photo_url` / `-full` key path. Verify both mirrored copies stay
  byte-identical.
- Manual: run the backfill against a small `?limit=N`, confirm
  `avatars/{playerId}-full.png` lands and `players.photo_url` points at Supabase;
  load the admin `/players/[id]` page and confirm the photo renders with correct
  fallback behavior. (Per repo memory: verify previewable changes in the running
  admin app before calling it done.)

## Risks

- **Selector accuracy.** The full-size `<img>` selector was inferred from a
  summarizer, not raw HTML. Pin it against a captured fixture during
  implementation; treat a miss as `null` so a wrong selector degrades to "no
  photo" rather than a bad URL.
- **Byte-mirror drift.** The rehost helper exists in two files that must stay
  identical. Generalizing it touches both — review them together.
- **Storage growth.** ~2–4× the thumbnail bytes per player; bounded by the
  bucket's 2 MB/file limit. A few thousand players → a few hundred MB. Low.

## Affected files

| File | Change |
|---|---|
| `supabase/migrations/<new>.sql` | Add `players.photo_url` |
| `padelgod/src/parsers/fip-player-profile.ts` | Extract `photoUrl` |
| `padelgod/src/lib/avatar-rehost.ts` | Generalize rehost (mirror A) |
| `src/lib/avatar-rehost.ts` | Generalize rehost (mirror B, byte-identical) |
| `padelgod/src/workers/player-profile.ts` | Write + rehost photo |
| Backfill trigger (padelgod or thin admin route) | Batched backfill |
| `apps/ops/src/app/api/internal/player/[id]/route.ts` | Add `photo_url` to `PLAYER_COLUMNS` |
| `apps/ops/src/app/(app)/players/[id]/_components/ProfileHeader.tsx` | Option B side photo card (token-themed) + interface field |
