# YouTube live indicator + ops channels manager — design

**Date:** 2026-05-14
**Status:** approved, ready for plan
**Visual reference:** [`public/mockup-live-stream-indicator.html`](../../../public/mockup-live-stream-indicator.html)

## Problem

When Premier Padel or FIP Tour are streaming live on YouTube, users on `/matches/[date]` have no in-page signal. To find out, they have to open YouTube separately and search.

Existing infra is partial:
- `/api/cron/fip-streams-discover` polls FIP's YouTube channel every 15 min and writes per-court rows to `fip_court_streams`. Gated behind `NEXT_PUBLIC_FIP_STREAMS_ENABLED`; surfaced only on individual match-detail pages via [`MatchStreamCard`](../../../src/components/MatchStreamCard.tsx). The matches list is silent.
- No equivalent exists for Premier Padel. The hardcoded `@PremierPadelOfficial` handle only appears in `sync-highlights` (for recorded highlights, unrelated).

Beyond "Premier + FIP", we also want to add new channels (event-specific circuits, sponsors) without a deploy. So the channel list itself becomes data.

## Scope

**In:**

1. **`youtube_channels` config table** — one row per channel we poll. Editable from ops.
2. **`youtube_channel_live` state table** — currently-live videos per channel. Written by the cron.
3. **New cron** `/api/cron/youtube-channels-discover` polls every active channel in `youtube_channels` every 5 min. Writes/refreshes rows in `youtube_channel_live`. Prunes stale rows.
4. **Indicator UI** — YT pill in [`MatchesFilterBar`](../../../src/components/MatchesFilterBar.tsx) positioned LEFT of EN VIVO. Hidden when no rows are live. Tap → inline panel below the filter bar listing currently-live channels with stream titles and external `VER` (Watch) CTAs.
5. **Ops affordance** — new "YT Channels" tab in the ops dashboard: list channels, add a channel (paste handle or URL, server resolves), edit (name / abbreviation / color / display order / active), delete, "Test" button that fires one-shot discovery for that channel.
6. **Server-rendered data** — indicator data is fetched in `src/app/[locale]/(app)/matches/[date]/page.tsx` and threaded down. Fresh on page load; no client-side polling for v1.
7. **Stop scheduling `/api/cron/fip-streams-discover`** in `vercel.json`. The existing cron, `fip_court_streams` table, `MatchStreamCard`, `fip-stream-resolver`, and the `NEXT_PUBLIC_FIP_STREAMS_ENABLED` gate stay in the codebase as orphaned code that a follow-up cleanup PR removes.

**Out:**

- In-app embedded player. We open YouTube externally (`<a target="_blank" rel="noopener">`) — picks up the YouTube app on mobile, opens a new tab on web. Embedded iframe / floating PiP is a future v2.
- Viewer count, "next stream starts at…" metadata, archived-stream affordances. The pill speaks one truth: which channels are live right now.
- Realtime updates while the user is on the page. Data is fresh per page navigation; a stream that goes live while the user sits on `/matches` will appear on their next interaction.
- Removing the orphaned `fip_court_streams` / `MatchStreamCard` / `fip-stream-resolver` code. Stays in the repo; follow-up PR cleans it.
- Per-tournament channel affinity (matching a tournament to its specific stream row) — the indicator lists channels as a flat set, not per-tournament. We can layer affinity in a v2 once we know it's wanted.

## Behavior

### Pill states

- **Hidden** — no rows in `youtube_channel_live` with `last_seen_at > now() - 30min`.
- **Collapsed** — `[▶ YT] [N] [▼]`. The `N` badge counts currently-live channels (typically 1–3). YouTube-red background, white glyph.
- **Expanded** — chevron rotates 180°, panel slides down (instant in v1, no animation requirement).

### Expanded panel

Lives directly below the filter bar, full-width within the page container. Pushes the day's tournaments down (no overlay; reuses normal document flow).

Header row: small pulsing red dot + "EN VIVO EN YOUTUBE" eyebrow (translated).

One row per live channel:
- Avatar circle (`color_hex` background + `abbreviation` letters)
- Channel name (e.g., "Premier Padel") + small `LIVE` chip
- Stream title (the YouTube video `snippet.title`, truncated to 2 lines via `-webkit-line-clamp: 2`)
- `VER` button on the right — `<a href="{youtube-watch-url}" target="_blank" rel="noopener noreferrer">` opening `https://www.youtube.com/watch?v={video_id}`

If a channel has multiple live broadcasts simultaneously (rare but possible), each broadcast renders as its own row. The count badge increments accordingly.

### Collapse triggers

- Tap the YT pill again
- Tap anywhere outside the panel (pointerdown backdrop listener)
- Press `Escape`

### Data freshness

- Cron runs every 5 min. Worst-case "stream goes live → indicator shows" lag: ~5 min.
- Worst-case "stream ends → indicator hides" lag: ~30 min (the stale threshold). Acceptable — premature hide would confuse more than a brief lag.
- The matches page is already `dynamic = 'force-dynamic'` per CLAUDE.md, so each navigation gets fresh data.

### Ops UX

Lives under a new "YT Channels" tab in the ops dashboard. Auth uses the existing `ops_token` cookie pattern per CLAUDE.md.

Table columns:
- Avatar (color + abbreviation preview)
- Name
- Channel ID (truncated, with copy-to-clipboard)
- Active (toggle)
- Live now? (badge — green "LIVE" if `youtube_channel_live` has a non-stale row for this channel; muted "—" otherwise)
- Actions: Edit / Delete / Test

**Add flow:**
1. Operator clicks "Add Channel"
2. Form: handle or URL (textarea), name, abbreviation (2–3 chars), color hex (with a color picker), display order
3. On submit, server route `POST /api/ops/youtube-channels`:
   - Parses the handle/URL to extract a handle (`@xxx`) or channel ID (`UCxxx`)
   - If handle: calls `channels.list?forHandle=...&part=contentDetails` (1 quota unit) to resolve to `channel_id` + `uploads_playlist_id`
   - If channel ID: calls `channels.list?id=...&part=contentDetails` (1 quota unit) for the uploads playlist
   - Inserts into `youtube_channels` with the resolved IDs
   - Returns the new row
4. UI refreshes the list

**Test flow:** `POST /api/ops/youtube-channels/{id}/test` runs the discovery logic for one channel and returns `{ liveCount, videos: [...] }`. Useful when adding a channel during a live event to confirm wiring is right.

**Edit flow:** `PATCH /api/ops/youtube-channels/{id}` allows changing `name`, `abbreviation`, `color_hex`, `display_order`, `is_active`. Does NOT allow changing `channel_id` / `uploads_playlist_id` — those are immutable once set; to "change" a channel, delete and re-add.

**Delete flow:** `DELETE /api/ops/youtube-channels/{id}` removes the row. Cascade deletes its `youtube_channel_live` rows.

## Architecture

### Tables

```sql
-- Config: channels we poll
CREATE TABLE youtube_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL UNIQUE,         -- YouTube channel ID (e.g., 'UCxxxxxxxx')
  uploads_playlist_id TEXT NOT NULL,       -- Derived from channel_id at insert; cached
  name TEXT NOT NULL,                      -- Display name (e.g., 'Premier Padel')
  abbreviation TEXT NOT NULL,              -- 2-3 chars for the avatar circle (e.g., 'PP')
  color_hex TEXT NOT NULL,                 -- Avatar background (e.g., '#FF0000')
  display_order INT NOT NULL DEFAULT 100,  -- Lower = first in the panel
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_youtube_channels_active ON youtube_channels (is_active, display_order)
  WHERE is_active = true;

-- State: currently-live videos per channel
CREATE TABLE youtube_channel_live (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,                  -- YouTube video ID (11 chars)
  title TEXT NOT NULL,                     -- snippet.title at discovery time
  started_at TIMESTAMPTZ,                  -- liveStreamingDetails.actualStartTime
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, video_id)
);

CREATE INDEX idx_youtube_channel_live_seen ON youtube_channel_live (last_seen_at DESC);
```

**Seed:** the migration also inserts the two known channels (Premier Padel + FIP Tour) so the indicator works on first deploy without manual ops. Exact `channel_id` / `uploads_playlist_id` values resolved during plan implementation via a one-shot YouTube API call.

Why two tables instead of one: configuration vs. state. The config table changes via human action (rare); the state table churns every 5 min. Splitting lets the cron `DELETE` from state without risking config loss, lets ops actions touch config without write contention on state, and keeps the schema reasoning clean.

### New cron — `/api/cron/youtube-channels-discover`

Runs every 5 min via `vercel.json`. Auth: `Authorization: Bearer ${CRON_SECRET}`.

```ts
// 1. Load active channels
const { data: channels } = await supabase
  .from('youtube_channels')
  .select('id, channel_id, uploads_playlist_id, name')
  .eq('is_active', true)
  .order('display_order')

// 2. For each channel, find currently-live videos
for (const ch of channels) {
  const items = await listUploadsPlaylistItems(ch.uploads_playlist_id, apiKey, 5)  // 1 unit
  const ids = items.map(i => i.videoId)
  if (ids.length === 0) continue
  const videos = await listVideoDetails(ids, apiKey)                                // 1 unit
  const live = videos.filter(v => v.liveBroadcastContent === 'live')
  for (const v of live) {
    await supabase.from('youtube_channel_live').upsert({
      channel_id: ch.id,
      video_id: v.videoId,
      title: v.title,
      started_at: v.actualStartTime,
      last_seen_at: new Date().toISOString(),
    }, { onConflict: 'channel_id, video_id' })
  }
}

// 3. Prune stale rows
await supabase
  .from('youtube_channel_live')
  .delete()
  .lt('last_seen_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
```

Cost: 2 quota units × N channels × 288 runs/day. At 2 channels = ~1,150 units/day; at 5 channels = ~2,880 units/day. Comfortably inside the 10k daily quota for the foreseeable future.

`listVideoDetails` is a small helper to add to [`src/lib/youtube-channel-api.ts`](../../../src/lib/youtube-channel-api.ts) (the existing `videos.list` call shape already lives in `fip-streams-discover` — extract & reuse).

### Stop scheduling the old cron

Remove `/api/cron/fip-streams-discover` from `vercel.json`. The route stays in the codebase for easy revert if needed.

### Server-side query for the indicator

In `src/app/[locale]/(app)/matches/[date]/page.tsx`, add a fetch alongside the existing matches/tournaments queries:

```ts
const STALE_MS = 30 * 60 * 1000
const { data: liveRows } = await supabase
  .from('youtube_channel_live')
  .select('video_id, title, youtube_channels!inner(id, name, abbreviation, color_hex, display_order)')
  .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
  .order('youtube_channels(display_order)', { ascending: true })
```

Pass to `MatchesFilterBar` as a `liveChannels: LiveChannel[]` prop.

### UI components

**New** — [`src/components/YoutubeLiveIndicator.tsx`](../../../src/components/YoutubeLiveIndicator.tsx). Client component. Owns the YT pill, the expanded panel, the open/closed state, click-outside / Escape handlers. Accepts `liveChannels` prop. Renders nothing when the prop is empty.

**Modify** — `MatchesFilterBar.tsx` accepts a new `liveChannels` prop and renders `<YoutubeLiveIndicator />` to the LEFT of the existing EN VIVO pill when the array is non-empty.

**No changes** — `MatchCard`, `MatchesTournamentGroup`, `MatchesFilterClient`, `MatchesFilterDrawer`. The YT pill is independent of the existing filter cascade. It doesn't affect what matches are shown.

### Ops UI components

The ops dashboard is a single-file tab switch in [`src/app/ops/OpsClient.tsx`](../../../src/app/ops/OpsClient.tsx) (state union + render switch, no router routes). An existing `FipStreamsTab.tsx` already serves the orphaned per-court FIP stream system — we replace its nav slot with the new tab.

**New** — `src/app/ops/yt-channels/` folder (matches the `ops/players/` decomposition pattern noted in CLAUDE.md):
- `YtChannelsTab.tsx` — top-level tab component, owns the table + add/edit modals state
- `YtChannelsTable.tsx` — table view, edit/delete/test row actions
- `YtChannelAddModal.tsx` — add-channel form with handle/URL resolution
- `YtChannelEditDrawer.tsx` — edit-existing form (right-side drawer, matches `PlayerDrawer` pattern)
- `types.ts` — local interfaces

**Modify** — `src/app/ops/OpsClient.tsx`:
- Add `'yt-channels'` to the tab state union
- Add the import + nav item + render-switch case for the new tab
- **Remove** the `'fip-streams'` entry from the state union, the nav, and the render switch. `FipStreamsTab.tsx` stays in the repo as orphaned code for the follow-up cleanup PR — only its OpsClient wiring is yanked.

**API routes** under `src/app/api/ops/youtube-channels/`:
- `route.ts` — `GET` (list) and `POST` (create, resolves handle → IDs)
- `[id]/route.ts` — `PATCH` (update editable fields), `DELETE` (cascade)
- `[id]/test/route.ts` — `POST` — runs discovery for one channel, returns `{ liveCount, videos }`

All routes read the `ops_token` cookie per CLAUDE.md.

### Translations

New keys under `daily.youtubeLive` (matches the existing `daily.*` namespace used for `liveSection`, `upcomingSection`, `finishedSection`, `liveCount`):

```jsonc
{
  "daily": {
    "youtubeLive": {
      "ariaLabel": "Live now on YouTube ({count})",
      "panelEyebrow": "Live now on YouTube",
      "watchCta": "Watch",
      "channelLive": "LIVE"
    }
  }
}
```

5 locales (en/es/pt/it/fr) per project convention. Ops UI strings stay in English (matches the existing ops dashboard convention).

### Channel handle / URL parsing

Tiny helper, lives near the create-route handler:

```ts
// Accepts:
//   - 'UCxxxxxxxxxxxxxxx'                (raw channel ID)
//   - '@PremierPadelOfficial'            (handle)
//   - 'https://youtube.com/@xxx'         (handle URL)
//   - 'https://youtube.com/channel/UCxx' (channel URL)
//   - 'https://www.youtube.com/c/xxx'    (legacy /c/ URL — treat slug as handle and let YouTube resolve)
export function parseYoutubeChannelInput(input: string): { kind: 'id', value: string } | { kind: 'handle', value: string } | null
```

The server route uses this, then calls `channels.list?forHandle=...` or `channels.list?id=...` (1 quota unit) to fetch `contentDetails.relatedPlaylists.uploads` for the uploads playlist ID.

## Files affected

| File | Change |
|---|---|
| `supabase/migrations/<timestamp>_youtube_channels.sql` | **Create** — both tables, indexes, seed Premier+FIP rows |
| `src/lib/youtube-channel-api.ts` | Modify — extract a `listVideoDetails(ids, apiKey)` helper (lives inline in `fip-streams-discover` today) |
| `src/lib/youtube-channel-input.ts` | **Create** — `parseYoutubeChannelInput` helper + unit tests |
| `src/app/api/cron/youtube-channels-discover/route.ts` | **Create** — cron handler |
| `src/app/api/ops/youtube-channels/route.ts` | **Create** — `GET` list, `POST` create |
| `src/app/api/ops/youtube-channels/[id]/route.ts` | **Create** — `PATCH`, `DELETE` |
| `src/app/api/ops/youtube-channels/[id]/test/route.ts` | **Create** — `POST` one-shot discovery |
| `vercel.json` | Modify — add `youtube-channels-discover` schedule, remove `fip-streams-discover` schedule |
| `src/components/YoutubeLiveIndicator.tsx` | **Create** — pill + panel |
| `src/components/MatchesFilterBar.tsx` | Modify — accept + render the indicator |
| `src/app/[locale]/(app)/matches/[date]/page.tsx` | Modify — fetch live-channels query, pass through |
| `src/app/ops/yt-channels/YtChannelsTab.tsx` | **Create** — top-level tab component |
| `src/app/ops/yt-channels/YtChannelsTable.tsx` | **Create** — list view + row actions |
| `src/app/ops/yt-channels/YtChannelAddModal.tsx` | **Create** — add-channel form |
| `src/app/ops/yt-channels/YtChannelEditDrawer.tsx` | **Create** — edit-existing form |
| `src/app/ops/yt-channels/types.ts` | **Create** — local interfaces |
| `src/app/ops/OpsClient.tsx` | Modify — add `'yt-channels'` tab; remove `'fip-streams'` nav + render wiring |
| `src/messages/{en,es,pt,it,fr}.json` | Modify — add `daily.youtubeLive.*` keys |

No changes to `MatchCard`, `MatchesTournamentGroup`, `MatchesFilterClient`, `fip_court_streams`, `fip-stream-resolver`, `MatchStreamCard`, or the `NEXT_PUBLIC_FIP_STREAMS_ENABLED` gate.

## Out-of-scope follow-ups

- Delete the orphaned FIP per-court stream infra: `fip-streams-discover`, `fip_court_streams`, `MatchStreamCard`, `fip-stream-resolver`, `fip-stream-title-parser`, the ops `/api/ops/fip-streams/*` routes, the `NEXT_PUBLIC_FIP_STREAMS_ENABLED` flag.
- Per-tournament channel affinity (matching a specific tournament to its stream row in the indicator).
- Realtime updates via Supabase channel subscription (push live state to clients without page reload).
- In-app embedded player (modal iframe or floating PiP).
- Viewer count badge on each row.
- "Next stream starts at HH:MM" affordance for upcoming broadcasts.
- Channel-avatar URL ingestion (instead of an abbreviation badge). Would need rehosting to Supabase Storage per the project avatar-rehost pattern.
