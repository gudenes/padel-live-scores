# Where to Watch — Geo-aware Channel Availability

**Date:** 2026-06-09
**Status:** Design approved, pending spec review
**Author:** brainstormed with operator

## Problem

The "Where to watch" affordance treats a channel's **live YouTube stream as globally available**. In reality, broadcast-rights deals geo-block it:

- **Latin America** — the FIP / Premier Padel YouTube streams are blocked because Disney holds the regional rights. Today we show a YouTube link that won't play, and we *don't* surface the Disney+/ESPN broadcaster the viewer should use.
- **Russia** — viewers are served by separate Russian channels (e.g. Wink, Okko), not the global YouTube stream.

The system already has a strong geo-aware foundation — a country-keyed `broadcasters` table, a `youtube_channels` table (FIP Tour, Premier Padel), `youtube_channel_live` for live streams, and `buildGroups()` which flows the viewer's country through every render path. What's missing is a way to say **"this channel's live stream is blocked in country X"** and have the runtime hide the dead YouTube link so the local broadcaster surfaces instead.

## Goals

1. Per-channel, per-country **block rules** for the live YouTube stream, **operator-curated and authoritative**.
2. When a viewer's country is blocked for a channel, **hide that channel's live YouTube stream**; the existing country broadcasters (Disney+, ESPN, …) surface naturally.
3. A **head start** for the operator: surface suggested blocks so they curate *down* from signals rather than typing from scratch.
4. An admin UI that's clear (no jargon) and matches the existing design system (light/dark tokens).

## Non-goals (v1)

- **Live detection for regional channels.** Russia's separate channels are modeled as ordinary `broadcasters` rows keyed to `ru` — a "Watch on Wink" link, no live pill or per-match deep-link. Standing up live discovery per regional channel is deferred.
- **Allow-lists.** v1 is block-only. The `effect` column reserves `'allow'` for a future regional-channel-as-live-source feature.
- **Per-user JSON-LD.** Structured data (`BroadcastEvent`) is not personalized; v1 leaves it unchanged (see Open Considerations).

## Decisions (locked during brainstorming)

| Decision | Choice |
|---|---|
| Source of truth for blocks | Manual operator rules (authoritative) |
| Head-start signals (suggestions only) | (a) YouTube API `regionRestriction` aggregated over a channel's recent VODs, (b) countries that already have an exclusive broadcaster, (c) a shipped seed of known deals |
| Russia / regional channels | Modeled as `broadcasters` rows (no live discovery in v1) |
| Admin placement | New **"Availability by Country"** tab *inside* the existing YouTube Channels page (`apps/ops`). No new page, no new nav entry. |
| UX | Plain language, design-system tokens, light/dark |

## Architecture

Two cleanly separated paths:

- **Authoritative path** — `channel_region_rules` rows the operator confirms. Read at runtime by `buildGroups()`.
- **Suggestion path** — YouTube API observations + broadcaster inference. Never auto-blocks; only feeds the admin's suggestion panel.

### 1. Data model

**New table `channel_region_rules`** (migration; apply via pg driver + `DATABASE_URL`, not `supabase db push` — repo has migration drift):

```sql
CREATE TABLE channel_region_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id    UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  country_iso2  TEXT NOT NULL,                 -- lowercase 2-letter
  effect        TEXT NOT NULL DEFAULT 'block'  -- 'block' (v1); 'allow' reserved
                CHECK (effect IN ('block','allow')),
  source        TEXT NOT NULL                  -- provenance
                CHECK (source IN ('seed','yt_api','broadcaster','manual')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, country_iso2)
);
CREATE INDEX channel_region_rules_channel_idx ON channel_region_rules(channel_id);
```

RLS: **anon `SELECT`** (the runtime reads it on public match/tournament pages via the anon key, like `broadcasters`). Writes via service role / ops routes only.

**New columns on `youtube_channels`** (the observed suggestion signal — not authoritative):

```sql
ALTER TABLE youtube_channels
  ADD COLUMN IF NOT EXISTS observed_region_blocks JSONB,   -- {sampleSize, blocked:{cc:count}}
  ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ;
```

`observed_region_blocks` example:
```json
{ "sampleSize": 50, "blocked": { "cl": 47, "pe": 47, "ar": 50, "br": 49 } }
```
The cron writes raw counts; the admin derives "is suggested" via a threshold so the UI can also show the "47 of the last 50 recorded matches" copy.

**Seed migration** — insert known blocks for both channels (FIP Tour, Premier Padel), `source='seed'`, across Latin America:
`ar, bo, br, cl, co, cr, cu, do, ec, gt, hn, mx, ni, pa, pe, pr, py, sv, uy, ve`.
Operator can unblock any of these after review.

### 2. Region map — `src/lib/where-to-watch/regions.ts` (new)

Static ISO-3166 region groupings, used by both the admin picker (whole-region add) and the rules-table region filter:

```ts
export const REGIONS = {
  'Latin America':            ['ar','bo','br','cl','co', ...],
  'Europe':                   ['es','it','fr','de', ...],
  'Middle East & North Africa': ['ae','sa','eg','qa', ...],
  'Asia & Pacific':           ['jp','au','cn','in', ...],
  'North America':            ['us','ca','mx'],   // note: mx also LatAm; see below
  'Africa':                   ['za','ng', ...],
} as const
export function regionForCountry(iso2: string): string | null { /* reverse lookup */ }
```
`mx` appears in Latin America for grouping; if a country sits in two display regions we pick one canonical region for the reverse map (Latin America wins for `mx`). The picker can still surface it under either chip.

### 3. YouTube API capture (suggestion signal B)

`src/lib/youtube-channel-api.ts` is the shared fetcher used by both `fip-streams-discover` and `youtube-channels-discover`.

- Add **`contentDetails`** to the `videos.list` `part` (videos.list is 1 quota unit regardless of parts — negligible cost).
- Extend `VideoDetails` with `regionRestriction?: { allowed?: string[]; blocked?: string[] }`.
- In each discovery cron, **aggregate across the channel's recent videos** that carry `regionRestriction`:
  - `sampleSize` = number of recent videos with a `regionRestriction` block list.
  - For each country, count how many of those videos block it.
  - Write `youtube_channels.observed_region_blocks` + `observed_at`.
- **Why aggregate, not per-live-video:** live broadcasts frequently omit `regionRestriction` until processed; finished VODs carry it reliably. Aggregating over recent VODs reveals the rights-deal footprint even while a current match's video is bare.

### 4. Runtime — `buildGroups()` (`src/lib/where-to-watch/group-builder.ts`)

Add one input and one guard:

```ts
export interface BuildGroupsInput {
  // ...existing...
  /** Block rules: channels whose live YouTube stream is geo-blocked, per country. */
  channelRegionBlocks?: Array<{ channelId: string; countryIso2: string }>
}
```

In the "attach live streams" loop, skip streams for a channel that is blocked in the effective `country`:

```ts
const blocked = new Set(
  (channelRegionBlocks ?? [])
    .filter(r => r.countryIso2 === country)
    .map(r => r.channelId)
)
for (const lc of liveChannels) {
  if (blocked.has(lc.channel.id)) continue   // hide blocked live stream
  const g = channelMetaById.get(lc.channel.id)!
  g.hasLive = true
  g.liveStreams.push({ videoId: lc.videoId, title: lc.title })
}
```

Behavior falls out of the **existing** empty-group drop:
- Blocked country **with** a broadcaster (Argentina → Disney+) → live hidden, broadcaster group still renders.
- Blocked country **without** a broadcaster → group has no content → dropped (viewer sees nothing for that channel, which is correct — better than a dead link).
- Non-blocked country → unchanged.
- No rules / unknown country code → unchanged (default available).

### 5. Fetch + wiring

**New helper** `src/lib/where-to-watch/fetch-channel-region-rules.ts`:
```ts
export async function fetchChannelRegionBlocks(supabase):
  Promise<Array<{ channelId: string; countryIso2: string }>>
// SELECT channel_id, country_iso2 FROM channel_region_rules WHERE effect='block'
```
Small bounded table; ship whole to the client alongside `broadcasters` so region swaps in the picker need no round-trip.

Add the fetch to the parallel loads and pass `channelRegionBlocks` into `buildGroups` everywhere it's called:
- Match detail — `src/app/[locale]/match/[id]/page.tsx` → `WhereToWatchBanner`
- Tournament detail — `WhereToWatchInline`
- Matches list — `src/app/[locale]/(app)/matches/[date]/page.tsx` → `WhereToWatchPill`

The three components thread the new prop through to `buildGroups` (mirrors how `broadcasters`/`channelsMeta` already flow).

### 6. Admin UI (`apps/ops`)

**Placement:** `apps/ops/src/app/(app)/yt-channels/page.tsx` gains in-page tabs — **Channels** (existing `YtChannelsTab`) and **Availability by Country** (new). Tab state is local; no new route or nav entry.

**New component** `apps/ops/src/app/(app)/yt-channels/_components/AvailabilityTab.tsx`:

- **Channel selector** — `.ui-chip` toggles sourced from `youtube_channels`.
- **Suggestions panel** (warn/orange tokens) — computed server-side: for the selected channel, `(observed_region_blocks above threshold) ∪ (countries with an active exclusive broadcaster)` minus already-blocked. Each row states the reason in plain words ("YouTube blocked this channel in 47 of the last 50 recorded matches" / "has a local broadcaster but the stream isn't blocked yet"). One-click **Block [country]** or **Block all N**.
- **Rules table** (`.ui-table`) — columns: Country, **How it was added** (`.ui-pill`: Preset / Detected on YouTube / Added manually), **Viewers here watch on** (read-only, joined live from `broadcasters` for that country), Note, **Unblock**. Free-text search + region filter (`.ui-select`) + source filter.
- **"Block more countries" dialog** — search by country name or region; **whole-region quick-add** chips (Latin America — 20, Europe — 38, Middle East & North Africa — 16, Asia & Pacific — 24, North America — 3, Africa — 20); country checkboxes with signal hints; already-blocked countries skipped automatically; footer "Block N countries".
- **Preview** — "what someone in Argentina sees": the YouTube row struck through ("hidden — blocked"), broadcaster buttons shown. Confirms the substitution before the operator commits.

All elements use design-system primitives (`.ui-btn` primary/default/ghost, `.ui-pill`, `.ui-table`, `.ui-input`, `.ui-chip`) — token-driven, so light/dark both work with no hardcoded hex.

**New API routes** `apps/ops/src/app/api/internal/channel-region-rules/route.ts` (next-auth session + `isOperator`, matching the existing `/api/internal/*` pattern):

| Method | Action |
|---|---|
| `GET ?channelId=` | Rules for the channel + suggestions payload (observed stats, broadcaster-derived countries, region map) + "viewers watch on" broadcaster join |
| `POST` | Add block(s) — accepts `{ channelId, countries: string[], source:'manual', note? }`; idempotent upsert on `(channel_id, country_iso2)`; skips dupes |
| `DELETE ?id=` (or `?channelId=&country=`) | Unblock |
| `PATCH` | Edit `note` (optional) |

Suggestion threshold (in the GET route): a country is suggested via `yt_api` when blocked in **≥ 60%** of the sampled videos and `sampleSize ≥ 5` (guards against noise).

## Edge cases / robustness

- Channel deleted → `ON DELETE CASCADE` removes its rules.
- Double-block prevented by `UNIQUE (channel_id, country_iso2)`; POST upserts.
- Unknown/missing country cookie → no rule matches → stream shows (safe default).
- Empty `channelRegionBlocks` → identical to current behavior (no regressions).
- Seeding ships immediately-correct blocks; no feature flag needed (the block logic is conservative — it only ever *hides* a stream that genuinely won't play and lets an existing broadcaster surface).
- `observed_region_blocks` is advisory only — a stale/empty observation never changes what viewers see.

## Open considerations (documented, not blocking v1)

- **JSON-LD `BroadcastEvent`** (`build-broadcast-jsonld.ts`) stays global in v1. schema.org `areaServed` is inclusive (hard to express "blocked here"), and structured data isn't per-user. Future: emit the YouTube `BroadcastEvent` with `areaServed` limited to non-blocked regions, and broadcaster events with their country. Low priority.
- **Blocked-with-no-broadcaster** currently shows nothing for that channel. A future "not available in your region" note could be friendlier, but silence beats a dead link for v1.
- **Regional channel as a live source** (the deferred Russia-live option) maps onto the reserved `effect='allow'` + a scoped `youtube_channels` row when/if it's worth the per-channel discovery cost.

## Files touched

**New**
- `supabase/migrations/<ts>_channel_region_rules.sql` (table + `youtube_channels` columns + LatAm seed)
- `src/lib/where-to-watch/regions.ts`
- `src/lib/where-to-watch/fetch-channel-region-rules.ts`
- `apps/ops/src/app/(app)/yt-channels/_components/AvailabilityTab.tsx`
- `apps/ops/src/app/api/internal/channel-region-rules/route.ts`

**Modified**
- `src/lib/youtube-channel-api.ts` — `contentDetails` part + `regionRestriction` on `VideoDetails`
- `src/app/api/cron/fip-streams-discover/route.ts` + `src/app/api/cron/youtube-channels-discover/route.ts` — aggregate `regionRestriction`, write `observed_region_blocks`
- `src/lib/where-to-watch/group-builder.ts` — `channelRegionBlocks` input + live-stream block guard
- `src/app/[locale]/match/[id]/page.tsx`, `src/app/[locale]/(app)/matches/[date]/page.tsx`, tournament page — fetch + pass rules
- `WhereToWatchBanner.tsx`, `WhereToWatchPill.tsx`, `WhereToWatchInline.tsx` — thread `channelRegionBlocks` prop
- `apps/ops/src/app/(app)/yt-channels/page.tsx` — tab switcher

## Testing

- **Unit — `buildGroups`:** blocked country with broadcaster → live dropped, broadcaster remains; blocked + no broadcaster → group dropped; non-blocked country → unchanged; empty rules → unchanged.
- **Unit — `regions.ts`:** region→countries, `regionForCountry` reverse map, dual-region `mx` resolves canonically.
- **Unit — suggestion computation:** threshold (≥60%, sample ≥5), dedup vs already-blocked, union of yt_api + broadcaster reasons.
- **Unit — cron aggregation:** `regionRestriction` parsing, per-country counts, sampleSize.
- **Manual:** ops tab flows (block one / block region / unblock / suggestions / preview), light + dark; verify Argentina match page hides YouTube and shows Disney+.
```
