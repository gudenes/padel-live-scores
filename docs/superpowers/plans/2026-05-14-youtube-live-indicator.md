# YouTube Live Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a page-level YouTube live indicator on `/matches/[date]` (LEFT of the EN VIVO pill) that surfaces currently-live broadcasts on Premier Padel + FIP Tour channels, with an ops UI to add/edit additional channels without a deploy.

**Architecture:** Two new tables — `youtube_channels` (config, ops-editable) + `youtube_channel_live` (state, written by a 5-min cron that polls each active channel's uploads playlist). The cron and indicator both iterate the config table, so adding a sponsor/circuit channel from ops needs zero code changes. Server-rendered into the matches page; YouTube opens externally on tap.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Supabase (Postgres + RLS), next-intl, Vitest, YouTube Data API v3.

**Spec:** [`docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md`](../specs/2026-05-14-youtube-live-indicator-design.md)

**Visual reference:** [`public/mockup-live-stream-indicator.html`](../../../public/mockup-live-stream-indicator.html)

---

## File map

| File | Change |
|---|---|
| `supabase/migrations/20260514_youtube_channels.sql` | **Create** — both tables, indexes, seed Premier + FIP rows |
| `src/lib/youtube-channel-api.ts` | Modify — add `listVideoDetails(ids, apiKey)` helper |
| `src/lib/youtube-channel-input.ts` | **Create** — `parseYoutubeChannelInput` + unit tests |
| `src/lib/__tests__/youtube-channel-input.test.ts` | **Create** |
| `src/app/api/cron/youtube-channels-discover/route.ts` | **Create** — cron handler |
| `vercel.json` | Modify — add new schedule, remove `fip-streams-discover` schedule |
| `src/components/YoutubeLiveIndicator.tsx` | **Create** — pill + panel client component |
| `src/components/MatchesFilterBar.tsx` | Modify — accept `liveChannels` prop, render indicator before EN VIVO |
| `src/components/MatchesDayShell.tsx` | Modify — thread `liveChannels` from page → MatchesFilterBar |
| `src/app/[locale]/(app)/matches/[date]/page.tsx` | Modify — fetch `youtube_channel_live` + pass through |
| `src/messages/{en,es,pt,it,fr}.json` | Modify — add `daily.youtubeLive.*` keys |
| `src/app/api/ops/youtube-channels/route.ts` | **Create** — `GET` list, `POST` create |
| `src/app/api/ops/youtube-channels/[id]/route.ts` | **Create** — `PATCH`, `DELETE` |
| `src/app/api/ops/youtube-channels/[id]/test/route.ts` | **Create** — `POST` one-shot discovery |
| `src/app/ops/yt-channels/YtChannelsTab.tsx` | **Create** — ops tab top-level |
| `src/app/ops/yt-channels/YtChannelsTable.tsx` | **Create** — list view |
| `src/app/ops/yt-channels/YtChannelAddModal.tsx` | **Create** — add form |
| `src/app/ops/yt-channels/YtChannelEditDrawer.tsx` | **Create** — edit drawer |
| `src/app/ops/yt-channels/types.ts` | **Create** — local types |
| `src/app/ops/OpsClient.tsx` | Modify — add `'yt-channels'` tab; remove `'fip-streams'` from nav + render switch |

---

## Task 1: Set up worktree, branch, and commit docs

**Files:** none (git only).

The current worktree at `.worktrees/oop-by-time/` is on the merged `feat/oop-by-time` branch. We set up a fresh worktree off `main` for this feature so the existing dev server keeps running undisturbed. The spec, plan, and mockup currently live in the old worktree as untracked files; we copy them into the new worktree and commit them as the first commit on the new branch.

- [ ] **Step 1.1: Confirm `main` is current**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git fetch origin main
git log origin/main --oneline -3
```

Expected: top commit is the squash-merge of the OOP-by-time PR (`feat(matches): chronological day view (OOP by time) (#324)`).

- [ ] **Step 1.2: Create the new worktree off main**

```bash
git worktree add .worktrees/youtube-live-indicator -b feat/youtube-live-indicator origin/main
```

Expected: new worktree at `.worktrees/youtube-live-indicator/`, branch `feat/youtube-live-indicator` tracking `origin/main`.

- [ ] **Step 1.3: Copy the spec, plan, and mockup over**

```bash
cp .worktrees/oop-by-time/docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md \
   .worktrees/youtube-live-indicator/docs/superpowers/specs/

cp .worktrees/oop-by-time/docs/superpowers/plans/2026-05-14-youtube-live-indicator.md \
   .worktrees/youtube-live-indicator/docs/superpowers/plans/

cp .worktrees/oop-by-time/public/mockup-live-stream-indicator.html \
   .worktrees/youtube-live-indicator/public/
```

- [ ] **Step 1.4: Install deps + copy `.env.local`**

```bash
cp .env.local .worktrees/youtube-live-indicator/.env.local
cd .worktrees/youtube-live-indicator
npm install
```

Expected: install completes cleanly; `node_modules/.bin/vitest` exists.

- [ ] **Step 1.5: Stage and commit the docs**

```bash
git add docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md \
        docs/superpowers/plans/2026-05-14-youtube-live-indicator.md \
        public/mockup-live-stream-indicator.html
git commit -m "$(cat <<'EOF'
docs(yt-live): spec, plan, and mockup for YouTube live indicator

Page-level pill on /matches/[date] (left of EN VIVO) that surfaces
currently-live Premier + FIP YouTube broadcasts. Includes an ops UI
for adding additional channels without a deploy.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 1.6: Verify**

```bash
git log --oneline -1
git status
```

Expected: docs commit at HEAD, working tree clean.

---

## Task 2: Migration — `youtube_channels` + `youtube_channel_live` tables

**Files:**
- Create: `supabase/migrations/20260514_youtube_channels.sql`

The migration creates both tables and seeds Premier + FIP rows. Premier's channel ID needs to be resolved once via the YouTube API; FIP's is already in `src/lib/fip-channel.ts` (`UCo2fCPOJnS95_PNOta5Jafg`). The uploads playlist ID is mechanically derived: `'UU' + channel_id.slice(2)`.

- [ ] **Step 2.1: Resolve Premier Padel's channel ID**

Run from the worktree:
```bash
source .env.local
curl -s "https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=PremierPadelOfficial&key=$YOUTUBE_API_KEY" | head -20
```

Expected: a JSON response with `items: [{ id: "UC..." }]`. Note the `id` value — paste it into the migration in the next step.

If the handle returns no items, retry with the legacy username search:
```bash
curl -s "https://www.googleapis.com/youtube/v3/search?part=snippet&q=premier%20padel&type=channel&maxResults=5&key=$YOUTUBE_API_KEY"
```
Look for the official channel and use its `snippet.channelId`.

Record the resolved Premier channel ID (e.g., `UC_xxxxxxxxxxxxxxxx`) and use it in Step 2.2.

- [ ] **Step 2.2: Write the migration**

Create `supabase/migrations/20260514_youtube_channels.sql`:

```sql
-- src/supabase/migrations/20260514_youtube_channels.sql
-- YouTube live indicator: per-channel config + per-video live state.
-- Spec: docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md

-- ── Config: which YouTube channels we poll ──────────────────────────
CREATE TABLE youtube_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id TEXT NOT NULL UNIQUE,         -- YouTube channel ID (UCxxxxxxx)
  uploads_playlist_id TEXT NOT NULL,       -- Derived from channel_id (UU + slice(2))
  name TEXT NOT NULL,                      -- Display name (e.g., 'Premier Padel')
  abbreviation TEXT NOT NULL,              -- 2-3 chars for the avatar circle
  color_hex TEXT NOT NULL,                 -- Avatar background, e.g. '#FF0000'
  display_order INT NOT NULL DEFAULT 100,  -- Lower = first in the panel
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_youtube_channels_active
  ON youtube_channels (is_active, display_order)
  WHERE is_active = true;

-- ── State: currently-live videos per channel ────────────────────────
CREATE TABLE youtube_channel_live (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  video_id TEXT NOT NULL,                  -- YouTube video ID (11 chars)
  title TEXT NOT NULL,                     -- snippet.title at discovery time
  started_at TIMESTAMPTZ,                  -- liveStreamingDetails.actualStartTime
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel_id, video_id)
);

CREATE INDEX idx_youtube_channel_live_seen
  ON youtube_channel_live (last_seen_at DESC);

-- ── Seed: Premier Padel + FIP Tour ──────────────────────────────────
-- Channel IDs hardcoded after one-time resolution via YouTube API.
-- Premier Padel:  @PremierPadelOfficial
-- FIP Tour:       @padelfip  (also in src/lib/fip-channel.ts)
INSERT INTO youtube_channels (channel_id, uploads_playlist_id, name, abbreviation, color_hex, display_order)
VALUES
  -- REPLACE 'UC_PASTE_PREMIER_HERE' with the value resolved in Step 2.1.
  ('UC_PASTE_PREMIER_HERE', 'UU' || substring('UC_PASTE_PREMIER_HERE' from 3), 'Premier Padel', 'PP', '#FF0000', 10),
  ('UCo2fCPOJnS95_PNOta5Jafg', 'UUo2fCPOJnS95_PNOta5Jafg', 'FIP Tour', 'FIP', '#1657A0', 20);
```

> Replace `UC_PASTE_PREMIER_HERE` (both occurrences) with the channel ID from Step 2.1 before running the migration.

- [ ] **Step 2.3: Apply the migration locally**

The project uses Supabase. Apply via the project's standard migration flow:

```bash
npx supabase db push --include-all 2>&1 | tail -20
```

If the project does NOT use `supabase db push`, apply via `psql` (`DATABASE_URL` from `.env.local`):

```bash
psql "$DATABASE_URL" -f supabase/migrations/20260514_youtube_channels.sql
```

Expected: clean apply.

- [ ] **Step 2.4: Verify the seed**

```bash
psql "$DATABASE_URL" -c "SELECT name, abbreviation, color_hex, channel_id, uploads_playlist_id FROM youtube_channels ORDER BY display_order;"
```

Expected: 2 rows — Premier Padel + FIP Tour.

- [ ] **Step 2.5: Commit**

```bash
git add supabase/migrations/20260514_youtube_channels.sql
git commit -m "$(cat <<'EOF'
feat(yt-live): migration for youtube_channels + youtube_channel_live tables

Config table is ops-editable; state table is written by the discovery
cron. Seeds Premier Padel + FIP Tour channels.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Lib — channel-input parser (TDD) + `listVideoDetails` helper

**Files:**
- Create: `src/lib/youtube-channel-input.ts`
- Create: `src/lib/__tests__/youtube-channel-input.test.ts`
- Modify: `src/lib/youtube-channel-api.ts` (add `listVideoDetails`)

The parser is a pure function — TDD it. The `listVideoDetails` helper is HTTP-bound; we extract it from the existing `fip-streams-discover` cron without TDD (existing patterns cover the API call shape).

- [ ] **Step 3.1: Write the failing test for the parser**

Create `src/lib/__tests__/youtube-channel-input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseYoutubeChannelInput } from '../youtube-channel-input'

describe('parseYoutubeChannelInput', () => {
  it('returns kind=id for raw channel IDs', () => {
    expect(parseYoutubeChannelInput('UCo2fCPOJnS95_PNOta5Jafg')).toEqual({
      kind: 'id', value: 'UCo2fCPOJnS95_PNOta5Jafg',
    })
  })

  it('returns kind=handle for @handle input (with or without @)', () => {
    expect(parseYoutubeChannelInput('@padelfip')).toEqual({ kind: 'handle', value: 'padelfip' })
    expect(parseYoutubeChannelInput('padelfip')).toEqual({ kind: 'handle', value: 'padelfip' })
  })

  it('extracts handle from youtube.com/@handle URL', () => {
    expect(parseYoutubeChannelInput('https://youtube.com/@padelfip')).toEqual({ kind: 'handle', value: 'padelfip' })
    expect(parseYoutubeChannelInput('https://www.youtube.com/@PremierPadelOfficial')).toEqual({
      kind: 'handle', value: 'PremierPadelOfficial',
    })
  })

  it('extracts channel ID from /channel/ URL', () => {
    expect(parseYoutubeChannelInput('https://www.youtube.com/channel/UCo2fCPOJnS95_PNOta5Jafg')).toEqual({
      kind: 'id', value: 'UCo2fCPOJnS95_PNOta5Jafg',
    })
  })

  it('treats /c/slug URLs as a handle (legacy vanity)', () => {
    expect(parseYoutubeChannelInput('https://www.youtube.com/c/PremierPadel')).toEqual({
      kind: 'handle', value: 'PremierPadel',
    })
  })

  it('trims surrounding whitespace', () => {
    expect(parseYoutubeChannelInput('  @padelfip  ')).toEqual({ kind: 'handle', value: 'padelfip' })
  })

  it('returns null for empty / unparseable input', () => {
    expect(parseYoutubeChannelInput('')).toBeNull()
    expect(parseYoutubeChannelInput('   ')).toBeNull()
    expect(parseYoutubeChannelInput('https://example.com/foo')).toBeNull()
  })
})
```

- [ ] **Step 3.2: Run the test — expect failure**

```bash
npx vitest run src/lib/__tests__/youtube-channel-input.test.ts
```

Expected: fails with `Cannot find module '../youtube-channel-input'`.

- [ ] **Step 3.3: Implement the parser**

Create `src/lib/youtube-channel-input.ts`:

```ts
// src/lib/youtube-channel-input.ts
//
// Parses operator-pasted YouTube channel input into either a channel ID
// or a handle. The ops add-channel route then calls
// `channels.list?id=...` or `channels.list?forHandle=...` to validate
// and get any missing data.
//
// Channel IDs always start with 'UC' and are 24 chars total.
// Handles can be @-prefixed or bare; URLs come in /@handle, /channel/UC,
// and the legacy /c/slug forms.

export type ParsedYoutubeInput =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }

const CHANNEL_ID_RE = /^UC[A-Za-z0-9_-]{22}$/

export function parseYoutubeChannelInput(input: string): ParsedYoutubeInput | null {
  const s = input.trim()
  if (!s) return null

  // Raw channel ID
  if (CHANNEL_ID_RE.test(s)) return { kind: 'id', value: s }

  // /channel/UCxxxx URL
  const channelUrlMatch = s.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]{22})\b/)
  if (channelUrlMatch) return { kind: 'id', value: channelUrlMatch[1]! }

  // /@handle URL
  const handleUrlMatch = s.match(/youtube\.com\/@([A-Za-z0-9_.-]+)/)
  if (handleUrlMatch) return { kind: 'handle', value: handleUrlMatch[1]! }

  // /c/slug URL — legacy vanity, treat slug as handle
  const cSlugMatch = s.match(/youtube\.com\/c\/([A-Za-z0-9_.-]+)/)
  if (cSlugMatch) return { kind: 'handle', value: cSlugMatch[1]! }

  // Bare @handle
  if (s.startsWith('@')) {
    const value = s.slice(1)
    if (/^[A-Za-z0-9_.-]+$/.test(value)) return { kind: 'handle', value }
    return null
  }

  // Bare slug (no @, no URL) — accept as handle
  if (/^[A-Za-z0-9_.-]+$/.test(s)) return { kind: 'handle', value: s }

  return null
}
```

- [ ] **Step 3.4: Run the test — expect pass**

```bash
npx vitest run src/lib/__tests__/youtube-channel-input.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 3.5: Add `listVideoDetails` to the YouTube API client**

Open `src/lib/youtube-channel-api.ts`. The file already has `listUploadsPlaylistItems` and a `VideoDetails` interface. Add a new exported function near the bottom (before the file's end):

```ts
/**
 * Fetch details for up to 50 video IDs in a single call (1 quota unit
 * regardless of count). Used by the discovery cron to find currently-live
 * broadcasts and by ops "test" actions.
 */
export async function listVideoDetails(
  videoIds: string[],
  apiKey: string,
): Promise<VideoDetails[]> {
  if (videoIds.length === 0) return []
  if (videoIds.length > 50) {
    throw new Error(`listVideoDetails: max 50 IDs per call, got ${videoIds.length}`)
  }
  const params = new URLSearchParams({
    id: videoIds.join(','),
    part: 'snippet,liveStreamingDetails,statistics',
    key: apiKey,
  })
  const res = await fetch(`${Y_BASE}/videos?${params}`)
  if (!res.ok) await throwForBadResponse(res, 'listVideoDetails')
  const json = (await res.json()) as VideosResponse
  return json.items.map(it => ({
    videoId: it.id,
    title: it.snippet.title,
    thumbnailUrl: it.snippet.thumbnails?.medium?.url ?? it.snippet.thumbnails?.default?.url ?? null,
    channelId: it.snippet.channelId,
    liveBroadcastContent: it.snippet.liveBroadcastContent,
    scheduledStartTime: it.liveStreamingDetails?.scheduledStartTime ?? null,
    actualStartTime: it.liveStreamingDetails?.actualStartTime ?? null,
    actualEndTime: it.liveStreamingDetails?.actualEndTime ?? null,
    concurrentViewers: it.liveStreamingDetails?.concurrentViewers
      ? parseInt(it.liveStreamingDetails.concurrentViewers, 10)
      : null,
    viewCount: it.statistics?.viewCount ? parseInt(it.statistics.viewCount, 10) : null,
  }))
}
```

- [ ] **Step 3.6: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "youtube-channel-input|youtube-channel-api" | head
```

Expected: empty output (no errors in our files).

- [ ] **Step 3.7: Commit**

```bash
git add src/lib/youtube-channel-input.ts src/lib/__tests__/youtube-channel-input.test.ts src/lib/youtube-channel-api.ts
git commit -m "$(cat <<'EOF'
feat(yt-live): channel-input parser + listVideoDetails helper

parseYoutubeChannelInput accepts channel IDs, @handles, and the four
common URL shapes (/@, /channel/, /c/, bare). 7 unit tests cover the
happy paths and edge cases.

listVideoDetails extracts the videos.list call shape from
fip-streams-discover so the new cron and ops "test" route can reuse
it without duplication.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Cron — `/api/cron/youtube-channels-discover`

**Files:**
- Create: `src/app/api/cron/youtube-channels-discover/route.ts`
- Modify: `vercel.json` (add new schedule, remove `fip-streams-discover`)

- [ ] **Step 4.1: Write the cron route**

Create `src/app/api/cron/youtube-channels-discover/route.ts`:

```ts
// src/app/api/cron/youtube-channels-discover/route.ts
//
// Polls the YouTube uploads playlist of every active row in
// `youtube_channels` every 5 min. UPSERTs currently-live videos into
// `youtube_channel_live`; prunes stale rows (last seen >30 min ago).
//
// Spec: docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md
// Schedule: */5 * * * * (every 5 minutes), see vercel.json
//
// Cost: 2 quota units per channel per run. At 2 channels = ~1.2k/day.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import {
  listUploadsPlaylistItems,
  listVideoDetails,
  YouTubeQuotaError,
} from '@/lib/youtube-channel-api'

export const maxDuration = 60

const STALE_MS = 30 * 60 * 1000

interface ChannelRow {
  id: string
  channel_id: string
  uploads_playlist_id: string
  name: string
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: true, skipped: 'no_api_key' })
  }

  try {
    const meta = await logOpsEvent('cron:youtube-channels-discover', async () => {
      const supabase = createServerClient()

      const { data: channels, error: chErr } = await supabase
        .from('youtube_channels')
        .select('id, channel_id, uploads_playlist_id, name')
        .eq('is_active', true)
        .order('display_order', { ascending: true })
      if (chErr) throw chErr

      const result = {
        channels_polled: 0,
        live_videos_seen: 0,
        upserts: 0,
        deletes: 0,
        per_channel: [] as Array<{ name: string; live: number }>,
      }

      for (const ch of (channels ?? []) as ChannelRow[]) {
        result.channels_polled++
        const items = await listUploadsPlaylistItems(ch.uploads_playlist_id, apiKey, 5)
        if (items.length === 0) {
          result.per_channel.push({ name: ch.name, live: 0 })
          continue
        }
        const ids = items.map(i => i.videoId)
        const videos = await listVideoDetails(ids, apiKey)
        const live = videos.filter(v => v.liveBroadcastContent === 'live')
        result.per_channel.push({ name: ch.name, live: live.length })
        result.live_videos_seen += live.length

        for (const v of live) {
          const { error: upErr } = await supabase
            .from('youtube_channel_live')
            .upsert(
              {
                channel_id: ch.id,
                video_id: v.videoId,
                title: v.title,
                started_at: v.actualStartTime,
                last_seen_at: new Date().toISOString(),
              },
              { onConflict: 'channel_id,video_id' },
            )
          if (upErr) throw upErr
          result.upserts++
        }
      }

      // Prune stale rows.
      const cutoff = new Date(Date.now() - STALE_MS).toISOString()
      const { count, error: delErr } = await supabase
        .from('youtube_channel_live')
        .delete({ count: 'exact' })
        .lt('last_seen_at', cutoff)
      if (delErr) throw delErr
      result.deletes = count ?? 0

      return result
    })

    return NextResponse.json({ ok: true, ...meta })
  } catch (err) {
    if (err instanceof YouTubeQuotaError) {
      return NextResponse.json({ ok: true, skipped: 'quota_exhausted' })
    }
    console.error('[cron:youtube-channels-discover] failed:', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
```

- [ ] **Step 4.2: Smoke-test the cron locally**

```bash
PORT=3003 npm run dev > /tmp/yt-dev.log 2>&1 &
sleep 6
curl -sH "Authorization: Bearer $CRON_SECRET" http://localhost:3003/api/cron/youtube-channels-discover | head
pkill -f "next dev"
```

Expected: a JSON response with `ok: true` and `per_channel: [{name: "Premier Padel", live: N}, {name: "FIP Tour", live: N}]`. The `live` counts depend on what's actually broadcasting — `0` is a valid result.

If you get a 500 with a Supabase error about a missing relation, the migration didn't apply locally — re-run Task 2 Step 2.3.

- [ ] **Step 4.3: Update `vercel.json`**

Find the `fip-streams-discover` schedule block in `vercel.json` and **replace** it with the new cron:

```json
    {
      "path": "/api/cron/youtube-channels-discover",
      "schedule": "*/5 * * * *"
    }
```

(One block in, one block out — net zero count of crons, just swapping which one is scheduled.)

- [ ] **Step 4.4: Validate JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"
```

Expected: silent success.

- [ ] **Step 4.5: Verify the swap**

```bash
grep -E "fip-streams-discover|youtube-channels-discover" vercel.json
```

Expected: only `youtube-channels-discover` appears. `fip-streams-discover` should be absent.

- [ ] **Step 4.6: Commit**

```bash
git add src/app/api/cron/youtube-channels-discover/route.ts vercel.json
git commit -m "$(cat <<'EOF'
feat(yt-live): discovery cron + vercel schedule swap

New cron polls every active youtube_channels row every 5 min, upserts
currently-live videos into youtube_channel_live, prunes stale rows
(>30 min old). Replaces the per-court fip-streams-discover schedule.

The fip-streams-discover route stays in the codebase for now; a
follow-up cleanup PR removes it along with fip_court_streams /
MatchStreamCard / fip-stream-resolver.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Server-side fetch + thread `liveChannels` to MatchesFilterBar

**Files:**
- Modify: `src/app/[locale]/(app)/matches/[date]/page.tsx`
- Modify: `src/components/MatchesDayShell.tsx`
- Modify: `src/components/MatchesFilterBar.tsx`

This task wires the data path end-to-end **without** introducing the indicator UI yet (Task 6). After this task, `MatchesFilterBar` accepts a `liveChannels` prop but doesn't render anything new — the prop is dormant. This keeps each commit verifiable in isolation.

- [ ] **Step 5.1: Define the `LiveChannel` type**

Add a small shared type at the top of `src/components/YoutubeLiveIndicator.tsx`. Since the file doesn't exist yet, create a stub now that just exports the type:

```ts
// src/components/YoutubeLiveIndicator.tsx
//
// Page-level YouTube live indicator. Pill on the left of EN VIVO that
// expands an inline panel listing the channels currently broadcasting.
// Implementation lives in Task 6 of the plan.

export interface LiveChannel {
  videoId: string
  title: string
  channel: {
    id: string
    name: string
    abbreviation: string
    colorHex: string
    displayOrder: number
  }
}
```

(Component body comes in Task 6; for now this file is type-only.)

- [ ] **Step 5.2: Add the fetch in `page.tsx`**

Open `src/app/[locale]/(app)/matches/[date]/page.tsx`. Find the existing matches/tournaments fetch block. Add a parallel fetch for live channels, then thread the result through to `MatchesDayShell`.

Find the section that calls `fetchMatchesDay` (or similar) and creates the props for `MatchesDayShell`. Add this block alongside it:

```ts
// YouTube live indicator data — single query, server-rendered, fresh per
// navigation. No client-side polling for v1.
const STALE_MS = 30 * 60 * 1000
const liveChannelsRes = await supabase
  .from('youtube_channel_live')
  .select(`
    video_id,
    title,
    channel:youtube_channels!inner (
      id,
      name,
      abbreviation,
      color_hex,
      display_order
    )
  `)
  .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
  .eq('channel.is_active', true)

const liveChannels: LiveChannel[] = (liveChannelsRes.data ?? [])
  .map((r) => {
    const ch = Array.isArray(r.channel) ? r.channel[0] : r.channel
    if (!ch) return null
    return {
      videoId: r.video_id as string,
      title: r.title as string,
      channel: {
        id: ch.id as string,
        name: ch.name as string,
        abbreviation: ch.abbreviation as string,
        colorHex: ch.color_hex as string,
        displayOrder: ch.display_order as number,
      },
    }
  })
  .filter((x): x is LiveChannel => x !== null)
  .sort((a, b) => a.channel.displayOrder - b.channel.displayOrder)
```

Add this import near the other component imports:

```ts
import type { LiveChannel } from '@/components/YoutubeLiveIndicator'
```

Then thread the prop into the `<MatchesDayShell ...>` JSX call:

```tsx
<MatchesDayShell
  /* …existing props… */
  liveChannels={liveChannels}
/>
```

- [ ] **Step 5.3: Accept the prop in `MatchesDayShell`**

Open `src/components/MatchesDayShell.tsx`. Find the props interface and add:

```ts
import type { LiveChannel } from './YoutubeLiveIndicator'

// …inside the props interface…
  liveChannels: LiveChannel[]
```

Destructure it in the function signature and pass it down to `MatchesFilterBar`:

```tsx
<MatchesFilterBar
  /* …existing props… */
  liveChannels={liveChannels}
/>
```

- [ ] **Step 5.4: Accept the prop in `MatchesFilterBar`**

Open `src/components/MatchesFilterBar.tsx`. Add the import and prop:

```ts
import type { LiveChannel } from './YoutubeLiveIndicator'

export interface MatchesFilterBarProps {
  // …existing props…
  /** YouTube live broadcasts to surface in the page-level indicator.
   *  Empty array → indicator hidden. Server-rendered; refreshes per nav. */
  liveChannels: LiveChannel[]
}
```

Destructure but don't render yet — the indicator JSX lives in Task 6.

- [ ] **Step 5.5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "page\.tsx|MatchesDayShell|MatchesFilterBar|YoutubeLiveIndicator" | head
```

Expected: empty (no errors in the modified files).

- [ ] **Step 5.6: Commit**

```bash
git add src/components/YoutubeLiveIndicator.tsx src/app/\[locale\]/\(app\)/matches/\[date\]/page.tsx src/components/MatchesDayShell.tsx src/components/MatchesFilterBar.tsx
git commit -m "$(cat <<'EOF'
feat(yt-live): server-fetch liveChannels + thread to MatchesFilterBar

Joins youtube_channel_live ↔ youtube_channels with a 30-min staleness
floor and is_active=true. Threads the typed result through page →
MatchesDayShell → MatchesFilterBar. The indicator JSX lands in the
next task; prop is dormant until then.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `YoutubeLiveIndicator` component + render in MatchesFilterBar

**Files:**
- Modify: `src/components/YoutubeLiveIndicator.tsx` (replace stub with the real thing)
- Modify: `src/components/MatchesFilterBar.tsx` (render the indicator before EN VIVO)

This task delivers the visible feature.

- [ ] **Step 6.1: Build the indicator component**

Replace the contents of `src/components/YoutubeLiveIndicator.tsx`:

```tsx
'use client'
// src/components/YoutubeLiveIndicator.tsx
//
// Page-level YouTube live indicator on /matches/[date]. Sits LEFT of
// the EN VIVO pill in MatchesFilterBar. Hidden when no channels are
// live. Tap → inline panel below the filter bar with one row per live
// channel: avatar + name + LIVE chip + stream title + VER button (opens
// YouTube externally).
//
// Visual reference: public/mockup-live-stream-indicator.html
// Spec: docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'

const YT_RED = '#FF0000'
const RED = '#FF4655'
const RED_SOFT = 'rgba(255,70,85,0.16)'
const MUTED_2 = '#9CA3AF'
const BORDER = 'rgba(255,255,255,0.06)'
const BG_ELEV = '#1e1e1e'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export interface LiveChannel {
  videoId: string
  title: string
  channel: {
    id: string
    name: string
    abbreviation: string
    colorHex: string
    displayOrder: number
  }
}

export interface YoutubeLiveIndicatorProps {
  liveChannels: LiveChannel[]
}

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`
}

export default function YoutubeLiveIndicator({ liveChannels }: YoutubeLiveIndicatorProps) {
  const t = useTranslations('daily.youtubeLive')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // Click-outside + Escape to close.
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  // Hidden when nothing is live.
  if (liveChannels.length === 0) return null

  // Group rows by channel so a channel running multiple simultaneous
  // streams renders all its rows together.
  const count = liveChannels.length

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        aria-label={t('ariaLabel', { count })}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          textTransform: 'uppercase',
          cursor: 'pointer',
          padding: '6px 10px',
          background: open ? 'rgba(255,0,0,0.18)' : 'rgba(255,0,0,0.10)',
          border: `1px solid ${open ? 'rgba(255,0,0,0.50)' : 'rgba(255,0,0,0.32)'}`,
          color: '#fff',
          clipPath: CHUNKY_BADGE,
          fontFamily: 'inherit',
        }}
      >
        <span style={{
          width: 18, height: 13, borderRadius: 3, background: YT_RED,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <svg viewBox="0 0 24 24" width="8" height="8" fill="#fff" aria-hidden>
            <path d="M8 5v14l11-7z"/>
          </svg>
        </span>
        <span style={{ fontWeight: 800 }}>YT</span>
        <span style={{
          color: '#0A0A0A', background: '#fff',
          fontFamily: 'monospace', fontSize: 9, fontWeight: 800,
          padding: '1px 5px', borderRadius: 8, lineHeight: 1.2,
        }}>{count}</span>
        <span style={{
          color: 'rgba(255,255,255,0.7)', fontSize: 9, marginLeft: 1,
          transform: open ? 'rotate(180deg)' : 'rotate(0)',
          transition: 'transform 0.2s',
        }}>▼</span>
      </button>

      {open && (
        <div
          role="region"
          aria-label={t('panelEyebrow')}
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            left: 0,
            right: 'auto',
            minWidth: 320,
            maxWidth: 420,
            background: BG_ELEV,
            border: `1px solid ${BORDER}`,
            borderTop: `2px solid ${YT_RED}`,
            padding: '14px 14px 16px',
            zIndex: 50,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            fontFamily: 'inherit', fontSize: 12, fontWeight: 800,
            letterSpacing: 2, color: YT_RED, textTransform: 'uppercase',
            marginBottom: 10,
          }}>
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: YT_RED, boxShadow: '0 0 8px rgba(255,0,0,0.7)',
            }}/>
            {t('panelEyebrow')}
          </div>

          {liveChannels.map((row, i) => (
            <div
              key={row.videoId}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 0',
                borderTop: i === 0 ? 'none' : `1px solid ${BORDER}`,
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: row.channel.colorHex,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0, color: '#fff',
                fontFamily: 'inherit', fontSize: 13, fontWeight: 800, letterSpacing: 0.3,
              }}>
                {row.channel.abbreviation}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 12, fontWeight: 800, letterSpacing: 0.3,
                  color: '#fff', lineHeight: 1.2, textTransform: 'uppercase',
                  display: 'flex', alignItems: 'center', gap: 6,
                }}>
                  {row.channel.name}
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: 0.5,
                    color: RED, background: RED_SOFT,
                    padding: '1px 5px', clipPath: CHUNKY_BADGE,
                    lineHeight: 1.4,
                  }}>{t('channelLive')}</span>
                </div>
                <div style={{
                  fontSize: 11, color: MUTED_2, marginTop: 3, lineHeight: 1.4,
                  overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                }}>{row.title}</div>
              </div>

              <a
                href={youtubeWatchUrl(row.videoId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  color: '#fff', background: YT_RED,
                  padding: '7px 12px',
                  clipPath: CHUNKY_BADGE,
                  textDecoration: 'none',
                }}
              >
                <svg viewBox="0 0 24 24" width="10" height="10" fill="#fff" aria-hidden>
                  <path d="M8 5v14l11-7z"/>
                </svg>
                {t('watchCta')}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 6.2: Render the indicator in `MatchesFilterBar`**

Open `src/components/MatchesFilterBar.tsx`. Add the import:

```ts
import YoutubeLiveIndicator from './YoutubeLiveIndicator'
```

Find the JSX block where the LIVE pill renders. Insert the indicator **before** the LIVE pill (so it appears to the LEFT). Pattern:

```tsx
<YoutubeLiveIndicator liveChannels={liveChannels} />
{/* existing LIVE pill button */}
```

The indicator renders nothing when `liveChannels.length === 0`, so when nothing is live the bar looks identical to today.

- [ ] **Step 6.3: Verify locally**

If the dev server in this worktree isn't running, start it:

```bash
PORT=3003 npm run dev > /tmp/yt-dev.log 2>&1 &
sleep 6
```

Open `http://localhost:3003/matches` in your browser. If nothing is currently live, the YT pill should NOT appear (existing bar unchanged).

To force a live row for verification, insert a fake row directly:

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO youtube_channel_live (channel_id, video_id, title, started_at, last_seen_at)
SELECT id, 'TEST00000001', 'Buenos Aires P1 — Court Central · Galán/Lebrón vs Coello/Tapia', now() - interval '20 min', now()
FROM youtube_channels WHERE name = 'Premier Padel'
ON CONFLICT (channel_id, video_id) DO UPDATE SET last_seen_at = now();
SQL
```

Reload the page. Confirm:

- [ ] YT pill renders to the LEFT of EN VIVO
- [ ] Tap opens panel below the filter bar
- [ ] Row shows the Premier Padel avatar (red, "PP"), name, LIVE chip, stream title, VER button
- [ ] Clicking VER opens `https://www.youtube.com/watch?v=TEST00000001` in a new tab
- [ ] Tap outside the panel closes it
- [ ] Press `Escape` closes it

After verification, remove the fake row:

```bash
psql "$DATABASE_URL" -c "DELETE FROM youtube_channel_live WHERE video_id = 'TEST00000001';"
```

- [ ] **Step 6.4: Commit**

```bash
git add src/components/YoutubeLiveIndicator.tsx src/components/MatchesFilterBar.tsx
git commit -m "$(cat <<'EOF'
feat(yt-live): YoutubeLiveIndicator component + render in MatchesFilterBar

Pill sits LEFT of EN VIVO when at least one channel is currently live.
Tap → inline panel listing each live broadcast (avatar + name + LIVE
chip + 2-line title + VER opening YouTube externally). Click-outside
and Escape close the panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: i18n keys (5 locales)

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

The component already references `t('ariaLabel', { count })`, `t('panelEyebrow')`, `t('watchCta')`, `t('channelLive')` under namespace `daily.youtubeLive`. Add the keys.

- [ ] **Step 7.1: Add the keys via a small script**

Run from the worktree:

```bash
node <<'EOF'
const fs = require('fs')
const tx = {
  en: { ariaLabel: 'Live now on YouTube ({count})', panelEyebrow: 'Live now on YouTube',  watchCta: 'Watch',   channelLive: 'LIVE' },
  es: { ariaLabel: 'En vivo en YouTube ({count})',  panelEyebrow: 'En vivo en YouTube',   watchCta: 'Ver',     channelLive: 'EN VIVO' },
  pt: { ariaLabel: 'Ao vivo no YouTube ({count})',  panelEyebrow: 'Ao vivo no YouTube',   watchCta: 'Assistir',channelLive: 'AO VIVO' },
  it: { ariaLabel: 'In diretta su YouTube ({count})', panelEyebrow: 'In diretta su YouTube', watchCta: 'Guarda', channelLive: 'LIVE' },
  fr: { ariaLabel: 'En direct sur YouTube ({count})', panelEyebrow: 'En direct sur YouTube', watchCta: 'Regarder', channelLive: 'EN DIRECT' },
}
for (const l of Object.keys(tx)) {
  const path = `src/messages/${l}.json`
  const data = JSON.parse(fs.readFileSync(path, 'utf8'))
  data.daily = data.daily || {}
  data.daily.youtubeLive = tx[l]
  fs.writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8')
  console.log(`${l}: wrote daily.youtubeLive`)
}
EOF
```

- [ ] **Step 7.2: Validate JSON parses**

```bash
node -e "for (const l of ['en','es','pt','it','fr']) JSON.parse(require('fs').readFileSync('src/messages/'+l+'.json','utf8'))" && echo "all valid JSON"
```

Expected: `all valid JSON`.

- [ ] **Step 7.3: Sanity-check the diff is minimal**

```bash
git diff --stat src/messages/
```

Expected: 5 files changed, ~5–8 lines each (the new key block).

- [ ] **Step 7.4: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "$(cat <<'EOF'
feat(i18n): add daily.youtubeLive.* keys (5 locales)

Strings consumed by YoutubeLiveIndicator: ariaLabel (with count
plural), panelEyebrow, watchCta, channelLive. Channel names ('Premier
Padel', 'FIP Tour') stay as data, not translations.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Ops API routes — list, create, update, delete, test

**Files:**
- Create: `src/app/api/ops/youtube-channels/route.ts`
- Create: `src/app/api/ops/youtube-channels/[id]/route.ts`
- Create: `src/app/api/ops/youtube-channels/[id]/test/route.ts`

All routes use the existing ops-auth helper at `@/lib/ops-auth` (the project's checkOpsAuth pattern, per CLAUDE.md).

- [ ] **Step 8.1: Build `GET` (list) and `POST` (create) at `/api/ops/youtube-channels`**

Create `src/app/api/ops/youtube-channels/route.ts`:

```ts
// src/app/api/ops/youtube-channels/route.ts
//
// GET    list all youtube_channels (active + inactive)
// POST   create a new channel from a handle/URL/ID; resolves channel_id
//        + uploads_playlist_id via the YouTube API.
//
// Auth: ops_token cookie via checkOpsAuth (same as other /api/ops/*).

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkOpsAuth } from '@/lib/ops-auth'
import { parseYoutubeChannelInput } from '@/lib/youtube-channel-input'

interface CreateBody {
  input: string            // handle / URL / channel ID
  name: string
  abbreviation: string
  colorHex: string
  displayOrder?: number
}

export async function GET() {
  const auth = await checkOpsAuth()
  if (auth) return auth

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('youtube_channels')
    .select(`
      id, channel_id, uploads_playlist_id, name, abbreviation,
      color_hex, display_order, is_active, created_at, updated_at
    `)
    .order('display_order', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Decorate each channel with whether it's currently live.
  const STALE_MS = 30 * 60 * 1000
  const { data: liveRows } = await supabase
    .from('youtube_channel_live')
    .select('channel_id, video_id, title')
    .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
  const liveByChannel = new Map<string, Array<{ videoId: string; title: string }>>()
  for (const r of liveRows ?? []) {
    const list = liveByChannel.get(r.channel_id as string) ?? []
    list.push({ videoId: r.video_id as string, title: r.title as string })
    liveByChannel.set(r.channel_id as string, list)
  }

  const channels = (data ?? []).map(c => ({
    ...c,
    live: liveByChannel.get(c.id as string) ?? [],
  }))

  return NextResponse.json({ channels })
}

export async function POST(request: NextRequest) {
  const auth = await checkOpsAuth()
  if (auth) return auth

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 })

  let body: CreateBody
  try { body = (await request.json()) as CreateBody }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }) }

  const { input, name, abbreviation, colorHex, displayOrder } = body
  if (!input || !name || !abbreviation || !colorHex) {
    return NextResponse.json({ error: 'input, name, abbreviation, colorHex required' }, { status: 400 })
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(colorHex)) {
    return NextResponse.json({ error: 'colorHex must be a 6-digit hex like #FF0000' }, { status: 400 })
  }

  const parsed = parseYoutubeChannelInput(input)
  if (!parsed) return NextResponse.json({ error: 'could not parse channel input' }, { status: 400 })

  // Resolve channel ID via YouTube API if we have a handle.
  let channelId: string
  if (parsed.kind === 'id') {
    channelId = parsed.value
  } else {
    const params = new URLSearchParams({
      part: 'id',
      forHandle: parsed.value,
      key: apiKey,
    })
    const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`)
    if (!res.ok) {
      const text = await res.text()
      return NextResponse.json({ error: `YouTube API: ${res.status} ${text}` }, { status: 502 })
    }
    const json = (await res.json()) as { items?: Array<{ id: string }> }
    if (!json.items || json.items.length === 0) {
      return NextResponse.json({ error: `handle '@${parsed.value}' not found on YouTube` }, { status: 404 })
    }
    channelId = json.items[0]!.id
  }

  // Mechanical derivation: uploads playlist ID = 'UU' + channelId.slice(2).
  const uploadsPlaylistId = `UU${channelId.slice(2)}`

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('youtube_channels')
    .insert({
      channel_id: channelId,
      uploads_playlist_id: uploadsPlaylistId,
      name,
      abbreviation,
      color_hex: colorHex,
      display_order: displayOrder ?? 100,
    })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'channel already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ channel: data })
}
```

- [ ] **Step 8.2: Build `PATCH` and `DELETE` at `/api/ops/youtube-channels/[id]`**

Create `src/app/api/ops/youtube-channels/[id]/route.ts`:

```ts
// src/app/api/ops/youtube-channels/[id]/route.ts
//
// PATCH  update editable fields (name, abbreviation, colorHex,
//        displayOrder, isActive). channel_id and uploads_playlist_id
//        are immutable — re-add to "change" a channel.
// DELETE cascade-delete the channel + its youtube_channel_live rows.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkOpsAuth } from '@/lib/ops-auth'

interface PatchBody {
  name?: string
  abbreviation?: string
  colorHex?: string
  displayOrder?: number
  isActive?: boolean
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await checkOpsAuth()
  if (auth) return auth

  const { id } = await params
  let body: PatchBody
  try { body = (await request.json()) as PatchBody }
  catch { return NextResponse.json({ error: 'invalid json body' }, { status: 400 }) }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) update.name = body.name
  if (body.abbreviation !== undefined) update.abbreviation = body.abbreviation
  if (body.colorHex !== undefined) {
    if (!/^#[0-9a-fA-F]{6}$/.test(body.colorHex)) {
      return NextResponse.json({ error: 'colorHex must be a 6-digit hex' }, { status: 400 })
    }
    update.color_hex = body.colorHex
  }
  if (body.displayOrder !== undefined) update.display_order = body.displayOrder
  if (body.isActive !== undefined) update.is_active = body.isActive

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('youtube_channels')
    .update(update)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ channel: data })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await checkOpsAuth()
  if (auth) return auth

  const { id } = await params
  const supabase = createServerClient()
  const { error } = await supabase.from('youtube_channels').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 8.3: Build the `POST /api/ops/youtube-channels/[id]/test` route**

Create `src/app/api/ops/youtube-channels/[id]/test/route.ts`:

```ts
// src/app/api/ops/youtube-channels/[id]/test/route.ts
//
// One-shot discovery for a single channel — useful when adding a new
// channel during a live event to confirm wiring is correct without
// waiting up to 5 min for the cron.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { checkOpsAuth } from '@/lib/ops-auth'
import { listUploadsPlaylistItems, listVideoDetails, YouTubeQuotaError } from '@/lib/youtube-channel-api'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await checkOpsAuth()
  if (auth) return auth

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'YOUTUBE_API_KEY not set' }, { status: 500 })

  const { id } = await params
  const supabase = createServerClient()
  const { data: ch, error: chErr } = await supabase
    .from('youtube_channels')
    .select('id, channel_id, uploads_playlist_id, name')
    .eq('id', id)
    .single()
  if (chErr || !ch) return NextResponse.json({ error: 'channel not found' }, { status: 404 })

  try {
    const items = await listUploadsPlaylistItems(ch.uploads_playlist_id as string, apiKey, 5)
    if (items.length === 0) return NextResponse.json({ liveCount: 0, videos: [] })
    const videos = await listVideoDetails(items.map(i => i.videoId), apiKey)
    const live = videos.filter(v => v.liveBroadcastContent === 'live')
    return NextResponse.json({
      liveCount: live.length,
      videos: live.map(v => ({ videoId: v.videoId, title: v.title })),
    })
  } catch (err) {
    if (err instanceof YouTubeQuotaError) return NextResponse.json({ error: 'quota_exhausted' }, { status: 429 })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
```

- [ ] **Step 8.4: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "ops/youtube-channels" | head
```

Expected: empty.

- [ ] **Step 8.5: Smoke-test the endpoints**

```bash
PORT=3003 npm run dev > /tmp/yt-dev.log 2>&1 &
sleep 6

# Get the ops_token cookie value from the running dev session, or set it
# directly using the project's $CRON_SECRET (per CLAUDE.md the token mirrors
# CRON_SECRET):
TOKEN="$CRON_SECRET"

# List
curl -s -H "Cookie: ops_token=$TOKEN" http://localhost:3003/api/ops/youtube-channels | head

pkill -f "next dev"
```

Expected: a JSON `{ channels: [{ name: "Premier Padel", ... }, { name: "FIP Tour", ... }] }`.

- [ ] **Step 8.6: Commit**

```bash
git add src/app/api/ops/youtube-channels
git commit -m "$(cat <<'EOF'
feat(yt-live): ops API for managing YouTube channels

GET    /api/ops/youtube-channels         list (with live decoration)
POST   /api/ops/youtube-channels         create (resolves handle → ID)
PATCH  /api/ops/youtube-channels/[id]    update editable fields
DELETE /api/ops/youtube-channels/[id]    cascade
POST   /api/ops/youtube-channels/[id]/test  one-shot discovery

All routes use the existing checkOpsAuth helper.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Ops UI — `YtChannelsTab` + table + add modal + edit drawer

**Files:**
- Create: `src/app/ops/yt-channels/types.ts`
- Create: `src/app/ops/yt-channels/YtChannelsTab.tsx`
- Create: `src/app/ops/yt-channels/YtChannelsTable.tsx`
- Create: `src/app/ops/yt-channels/YtChannelAddModal.tsx`
- Create: `src/app/ops/yt-channels/YtChannelEditDrawer.tsx`

All four UI files are client components. Match the existing ops style (no Tailwind elsewhere in ops; inline styles + the chunky brand language).

- [ ] **Step 9.1: Local types**

Create `src/app/ops/yt-channels/types.ts`:

```ts
// Local types for the YT Channels ops tab. The shape mirrors the
// /api/ops/youtube-channels response: snake_case from Supabase, with
// a `live` array decoration added by GET.

export interface OpsChannel {
  id: string
  channel_id: string
  uploads_playlist_id: string
  name: string
  abbreviation: string
  color_hex: string
  display_order: number
  is_active: boolean
  created_at: string
  updated_at: string
  live: Array<{ videoId: string; title: string }>
}

export interface OpsChannelEditFields {
  name: string
  abbreviation: string
  colorHex: string
  displayOrder: number
  isActive: boolean
}
```

- [ ] **Step 9.2: Tab top-level**

Create `src/app/ops/yt-channels/YtChannelsTab.tsx`:

```tsx
'use client'
// src/app/ops/yt-channels/YtChannelsTab.tsx
//
// "YT Channels" tab in the ops dashboard. Owns the list-fetch state
// and the open/close state for the add modal + edit drawer.

import { useCallback, useEffect, useState } from 'react'
import type { OpsChannel } from './types'
import YtChannelsTable from './YtChannelsTable'
import YtChannelAddModal from './YtChannelAddModal'
import YtChannelEditDrawer from './YtChannelEditDrawer'

export default function YtChannelsTab() {
  const [channels, setChannels] = useState<OpsChannel[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<OpsChannel | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/ops/youtube-channels')
      if (!res.ok) throw new Error(`list failed: ${res.status}`)
      const json = (await res.json()) as { channels: OpsChannel[] }
      setChannels(json.channels)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div style={{ padding: '16px 4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>YouTube Channels</h2>
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          style={{
            padding: '8px 14px', background: '#7ED321', color: '#0A0A0A',
            border: 0, fontWeight: 800, cursor: 'pointer',
          }}
        >+ ADD CHANNEL</button>
      </div>

      {loading && <div style={{ color: '#9CA3AF', fontSize: 13 }}>Loading…</div>}
      {error && <div style={{ color: '#FF4655', fontSize: 13 }}>Error: {error}</div>}
      {!loading && !error && (
        <YtChannelsTable channels={channels} onEdit={setEditing} onRefresh={refresh} />
      )}

      {addOpen && (
        <YtChannelAddModal onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); refresh() }} />
      )}
      {editing && (
        <YtChannelEditDrawer
          channel={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh() }}
          onDeleted={() => { setEditing(null); refresh() }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 9.3: Table view**

Create `src/app/ops/yt-channels/YtChannelsTable.tsx`:

```tsx
'use client'
// src/app/ops/yt-channels/YtChannelsTable.tsx
//
// Table view: avatar + name + channel ID (truncated) + active toggle
// + live? badge + actions (Edit / Delete / Test).

import { useState } from 'react'
import type { OpsChannel } from './types'

export default function YtChannelsTable({
  channels,
  onEdit,
  onRefresh,
}: {
  channels: OpsChannel[]
  onEdit: (c: OpsChannel) => void
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  async function onDelete(c: OpsChannel) {
    if (!confirm(`Delete channel "${c.name}"? Cascade-deletes its live rows.`)) return
    setBusy(c.id)
    try {
      const res = await fetch(`/api/ops/youtube-channels/${c.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`delete failed: ${res.status}`)
      onRefresh()
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e))
    } finally { setBusy(null) }
  }

  async function onTest(c: OpsChannel) {
    setBusy(c.id)
    setTestResult(prev => ({ ...prev, [c.id]: 'testing…' }))
    try {
      const res = await fetch(`/api/ops/youtube-channels/${c.id}/test`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `test failed: ${res.status}`)
      setTestResult(prev => ({ ...prev, [c.id]: `${json.liveCount} live` }))
    } catch (e) {
      setTestResult(prev => ({ ...prev, [c.id]: `error: ${e instanceof Error ? e.message : String(e)}` }))
    } finally { setBusy(null) }
  }

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', textAlign: 'left' }}>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}></th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Name</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Channel ID</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Order</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Active</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Live now</th>
          <th style={{ padding: '8px 6px', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', color: '#9CA3AF' }}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {channels.map(c => (
          <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
            <td style={{ padding: '10px 6px' }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: c.color_hex, display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                color: '#fff', fontSize: 11, fontWeight: 800,
              }}>{c.abbreviation}</div>
            </td>
            <td style={{ padding: '10px 6px' }}>{c.name}</td>
            <td style={{ padding: '10px 6px', fontFamily: 'monospace', fontSize: 11, color: '#9CA3AF' }}>
              {c.channel_id.slice(0, 6)}…{c.channel_id.slice(-4)}
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(c.channel_id)}
                style={{ marginLeft: 6, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', color: '#9CA3AF', fontSize: 9, padding: '1px 4px', cursor: 'pointer' }}
              >COPY</button>
            </td>
            <td style={{ padding: '10px 6px', fontFamily: 'monospace' }}>{c.display_order}</td>
            <td style={{ padding: '10px 6px' }}>
              {c.is_active
                ? <span style={{ color: '#7ED321', fontWeight: 700 }}>YES</span>
                : <span style={{ color: '#6B7280' }}>NO</span>}
            </td>
            <td style={{ padding: '10px 6px' }}>
              {c.live.length > 0
                ? <span style={{ color: '#FF4655', fontWeight: 800 }}>● {c.live.length}</span>
                : <span style={{ color: '#6B7280' }}>—</span>}
              {testResult[c.id] && (
                <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>{testResult[c.id]}</div>
              )}
            </td>
            <td style={{ padding: '10px 6px' }}>
              <button onClick={() => onEdit(c)} disabled={busy === c.id}
                style={{ marginRight: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>EDIT</button>
              <button onClick={() => onTest(c)} disabled={busy === c.id}
                style={{ marginRight: 6, padding: '4px 8px', fontSize: 11, cursor: 'pointer' }}>TEST</button>
              <button onClick={() => onDelete(c)} disabled={busy === c.id}
                style={{ padding: '4px 8px', fontSize: 11, color: '#FF4655', cursor: 'pointer' }}>DELETE</button>
            </td>
          </tr>
        ))}
        {channels.length === 0 && (
          <tr><td colSpan={7} style={{ padding: 16, color: '#6B7280', textAlign: 'center' }}>
            No channels yet. Add one above.
          </td></tr>
        )}
      </tbody>
    </table>
  )
}
```

- [ ] **Step 9.4: Add modal**

Create `src/app/ops/yt-channels/YtChannelAddModal.tsx`:

```tsx
'use client'
// src/app/ops/yt-channels/YtChannelAddModal.tsx
//
// Form: paste handle / URL / channel ID + name + abbreviation + color +
// display order. POSTs to /api/ops/youtube-channels which resolves the
// channel ID and inserts the row.

import { useState } from 'react'

export default function YtChannelAddModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [input, setInput] = useState('')
  const [name, setName] = useState('')
  const [abbreviation, setAbbreviation] = useState('')
  const [colorHex, setColorHex] = useState('#FF0000')
  const [displayOrder, setDisplayOrder] = useState(100)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const res = await fetch('/api/ops/youtube-channels', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input, name, abbreviation, colorHex, displayOrder }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `create failed: ${res.status}`)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={onSubmit}
        style={{
          background: '#1A1A1A', padding: 20,
          width: 'min(440px, 92vw)',
          border: '1px solid rgba(255,255,255,0.08)',
          color: '#fff', fontSize: 13,
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Add YouTube Channel</h3>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>
            Handle, URL, or channel ID
          </span>
          <input
            type="text" value={input} onChange={e => setInput(e.target.value)}
            placeholder="@PremierPadelOfficial"
            required
            style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Display name</span>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="Premier Padel"
            required
            style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Abbreviation (2–3 chars)</span>
            <input
              type="text" value={abbreviation} onChange={e => setAbbreviation(e.target.value.toUpperCase().slice(0, 3))}
              placeholder="PP" required maxLength={3}
              style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Color</span>
            <input
              type="color" value={colorHex} onChange={e => setColorHex(e.target.value.toUpperCase())}
              style={{ width: 40, height: 36, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
            />
          </label>
          <label style={{ width: 80 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Order</span>
            <input
              type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value, 10) || 100)}
              style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
            />
          </label>
        </div>

        {error && <div style={{ color: '#FF4655', fontSize: 12, marginTop: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={submitting}
            style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}
          >Cancel</button>
          <button type="submit" disabled={submitting}
            style={{ padding: '8px 14px', background: '#7ED321', color: '#0A0A0A', border: 0, fontWeight: 800, cursor: 'pointer' }}
          >{submitting ? 'Adding…' : 'Add'}</button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 9.5: Edit drawer**

Create `src/app/ops/yt-channels/YtChannelEditDrawer.tsx`:

```tsx
'use client'
// src/app/ops/yt-channels/YtChannelEditDrawer.tsx
//
// Right-side drawer for editing an existing channel. Allows changing
// name, abbreviation, color, display order, and active state. Channel
// ID and uploads playlist ID are read-only (immutable post-creation).

import { useState } from 'react'
import type { OpsChannel } from './types'

export default function YtChannelEditDrawer({
  channel,
  onClose,
  onSaved,
  onDeleted,
}: {
  channel: OpsChannel
  onClose: () => void
  onSaved: () => void
  onDeleted: () => void
}) {
  const [name, setName] = useState(channel.name)
  const [abbreviation, setAbbreviation] = useState(channel.abbreviation)
  const [colorHex, setColorHex] = useState(channel.color_hex)
  const [displayOrder, setDisplayOrder] = useState(channel.display_order)
  const [isActive, setIsActive] = useState(channel.is_active)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true); setError(null)
    try {
      const res = await fetch(`/api/ops/youtube-channels/${channel.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, abbreviation, colorHex, displayOrder, isActive }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `save failed: ${res.status}`)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete() {
    if (!confirm(`Delete channel "${channel.name}"? Cascade-deletes its live rows.`)) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/ops/youtube-channels/${channel.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`delete failed: ${res.status}`)
      onDeleted()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000 }}
    >
      <form
        onClick={e => e.stopPropagation()}
        onSubmit={onSave}
        style={{
          position: 'absolute', top: 0, right: 0, height: '100%',
          width: 'min(420px, 92vw)',
          background: '#1A1A1A', padding: 20,
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          color: '#fff', fontSize: 13,
          overflowY: 'auto',
        }}
      >
        <h3 style={{ margin: '0 0 12px', fontSize: 16 }}>Edit Channel</h3>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Channel ID (immutable)</span>
          <input type="text" value={channel.channel_id} readOnly
            style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.05)', color: '#6B7280', fontSize: 12, fontFamily: 'monospace' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: 10 }}>
          <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Display name</span>
          <input type="text" value={name} onChange={e => setName(e.target.value)} required
            style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
          <label style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Abbreviation</span>
            <input type="text" value={abbreviation} onChange={e => setAbbreviation(e.target.value.toUpperCase().slice(0, 3))} required maxLength={3}
              style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
            />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Color</span>
            <input type="color" value={colorHex} onChange={e => setColorHex(e.target.value.toUpperCase())}
              style={{ width: 40, height: 36, background: 'transparent', border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer' }}
            />
          </label>
          <label style={{ width: 80 }}>
            <span style={{ display: 'block', fontSize: 11, color: '#9CA3AF', marginBottom: 4 }}>Order</span>
            <input type="number" value={displayOrder} onChange={e => setDisplayOrder(parseInt(e.target.value, 10) || 100)}
              style={{ width: '100%', padding: '8px 10px', background: '#0A0A0A', border: '1px solid rgba(255,255,255,0.1)', color: '#fff', fontSize: 13 }}
            />
          </label>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} />
          <span>Active (cron polls this channel)</span>
        </label>

        {error && <div style={{ color: '#FF4655', fontSize: 12, marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" onClick={onDelete} disabled={submitting}
            style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,70,85,0.5)', color: '#FF4655', cursor: 'pointer' }}
          >Delete</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onClose} disabled={submitting}
              style={{ padding: '8px 14px', background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}
            >Cancel</button>
            <button type="submit" disabled={submitting}
              style={{ padding: '8px 14px', background: '#7ED321', color: '#0A0A0A', border: 0, fontWeight: 800, cursor: 'pointer' }}
            >{submitting ? 'Saving…' : 'Save'}</button>
          </div>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 9.6: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep -E "yt-channels" | head
```

Expected: empty.

- [ ] **Step 9.7: Commit**

```bash
git add src/app/ops/yt-channels
git commit -m "$(cat <<'EOF'
feat(ops): YT Channels tab — table + add modal + edit drawer

Five-file decomposition mirroring src/app/ops/players/. Table shows
avatar, name, channel ID (with copy), order, active, live-now badge,
and per-row Edit/Test/Delete actions. Add modal accepts handle/URL/ID
with auto-resolution server-side. Edit drawer matches PlayerDrawer
right-side pattern; channel ID is read-only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Wire `YtChannelsTab` into ops nav (and remove FIP Streams tab from nav)

**Files:**
- Modify: `src/app/ops/OpsClient.tsx`

The existing `FipStreamsTab.tsx` file stays; we just yank its tab key from the nav so operators don't see stale UI for the orphaned per-court FIP system.

- [ ] **Step 10.1: Add the new import + remove the old one**

Open `src/app/ops/OpsClient.tsx`. Find the import block at the top:

```ts
import FipStreamsTab from './FipStreamsTab'
```

**Replace** with:

```ts
import YtChannelsTab from './yt-channels/YtChannelsTab'
```

- [ ] **Step 10.2: Update the tab state union**

Find the `useState` declaration around line 325:

```ts
const [tab, setTab] = useState<'ongoing' | 'health' | 'data' | 'simulator' | 'players' | 'brands' | 'architecture' | 'padelgod-shadow' | 'padelgod-entries' | 'tournament-explorer' | 'tournament-dedup' | 'padelgod-health' | 'fip-streams' | 'news' | 'highlight-picker'>('ongoing')
```

Replace `'fip-streams'` with `'yt-channels'`:

```ts
const [tab, setTab] = useState<'ongoing' | 'health' | 'data' | 'simulator' | 'players' | 'brands' | 'architecture' | 'padelgod-shadow' | 'padelgod-entries' | 'tournament-explorer' | 'tournament-dedup' | 'padelgod-health' | 'yt-channels' | 'news' | 'highlight-picker'>('ongoing')
```

- [ ] **Step 10.3: Update the nav item**

Find the line around 451:

```ts
        { key: 'fip-streams' as const, label: 'FIP Streams', badge: null },
```

Replace with:

```ts
        { key: 'yt-channels' as const, label: 'YT Channels', badge: null },
```

- [ ] **Step 10.4: Update the render switch**

Find the block around line 982:

```tsx
      {tab === 'fip-streams' && <>
        ...
        <FipStreamsTab />
      </>}
```

Replace the `tab === 'fip-streams'` literal with `tab === 'yt-channels'` and the inner `<FipStreamsTab />` with `<YtChannelsTab />`. Preserve any wrapper JSX that surrounds the tab content (header, padding, etc.).

- [ ] **Step 10.5: Verify**

```bash
grep -n "fip-streams\|FipStreamsTab\|yt-channels\|YtChannelsTab" src/app/ops/OpsClient.tsx
```

Expected: only `yt-channels` and `YtChannelsTab` appear. `fip-streams` and `FipStreamsTab` are gone.

```bash
npx tsc --noEmit 2>&1 | grep -E "OpsClient|yt-channels" | head
```

Expected: empty.

- [ ] **Step 10.6: Commit**

```bash
git add src/app/ops/OpsClient.tsx
git commit -m "$(cat <<'EOF'
feat(ops): swap FIP Streams nav for YT Channels in OpsClient

Replaces the now-orphaned per-court FIP streams tab with the new
generalized YouTube channels manager. FipStreamsTab.tsx stays in the
repo for the follow-up cleanup PR.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Visual verification + open PR

**Files:** none (browser + git only).

- [ ] **Step 11.1: Restart dev server in worktree**

```bash
pkill -f "next dev"
sleep 1
PORT=3003 nohup npm run dev > /tmp/yt-dev.log 2>&1 &
disown
sleep 6
grep -E "Ready|EADDR|Error" /tmp/yt-dev.log | head
```

Expected: a `Ready in …` line.

- [ ] **Step 11.2: Verify the indicator on `/matches`**

Open `http://localhost:3003/matches` (or `/es/matches`). Insert a fake live row first:

```bash
psql "$DATABASE_URL" <<'SQL'
INSERT INTO youtube_channel_live (channel_id, video_id, title, started_at, last_seen_at)
SELECT id, 'TEST00000001', 'Buenos Aires P1 — Court Central · Galán/Lebrón vs Coello/Tapia', now() - interval '20 min', now()
FROM youtube_channels WHERE name = 'Premier Padel'
ON CONFLICT (channel_id, video_id) DO UPDATE SET last_seen_at = now();

INSERT INTO youtube_channel_live (channel_id, video_id, title, started_at, last_seen_at)
SELECT id, 'TEST00000002', 'FIP Silver Brescia — Centre Court — Live now', now() - interval '15 min', now()
FROM youtube_channels WHERE name = 'FIP Tour'
ON CONFLICT (channel_id, video_id) DO UPDATE SET last_seen_at = now();
SQL
```

Confirm in the browser:

- [ ] YT pill appears LEFT of EN VIVO with count `2`
- [ ] Tap → panel opens with two rows (Premier red avatar + FIP blue avatar)
- [ ] Stream titles render (truncated to 2 lines max)
- [ ] VER opens YouTube in a new tab
- [ ] Tap outside → panel closes
- [ ] Press `Escape` → panel closes
- [ ] Reload page with the rows still fresh → indicator persists
- [ ] `DELETE FROM youtube_channel_live;` then reload → indicator hidden

- [ ] **Step 11.3: Verify the ops tab**

Open `http://localhost:3003/ops` (you may need to set the `ops_token` cookie first, e.g. by visiting `/ops?token=$CRON_SECRET` once).

Click "YT Channels". Confirm:

- [ ] Premier Padel + FIP Tour rows render
- [ ] Edit drawer opens, Save persists changes
- [ ] Test button returns "0 live" or a non-zero count
- [ ] Add Channel modal accepts `@padelfip` and returns "channel already exists"
- [ ] Delete asks for confirm and removes the row (then re-add via Add Channel for cleanup)

- [ ] **Step 11.4: Clean up test rows**

```bash
psql "$DATABASE_URL" -c "DELETE FROM youtube_channel_live WHERE video_id IN ('TEST00000001','TEST00000002');"
```

- [ ] **Step 11.5: Push and open the PR**

```bash
git push -u origin feat/youtube-live-indicator
gh pr create --title "feat(matches): YouTube live indicator + ops channels manager" --body "$(cat <<'EOF'
## Summary

- Page-level YT pill on `/matches/[date]` (left of EN VIVO) surfaces currently-live Premier Padel + FIP Tour broadcasts. Hidden when no channels are live.
- Tap → inline panel listing each live broadcast (avatar + name + LIVE chip + 2-line title + VER opening YouTube externally).
- New ops "YT Channels" tab (replaces "FIP Streams" in the nav) lets operators add new channels without a deploy. Add accepts handle / URL / channel ID; server resolves via YouTube API.
- New cron `/api/cron/youtube-channels-discover` polls every active channel every 5 min (~2 quota units per channel per run, well within the 10k daily quota). Replaces the `fip-streams-discover` schedule in `vercel.json`.
- Two new tables — `youtube_channels` (config) + `youtube_channel_live` (state) — with a 30-min stale-row floor so the pill collapses naturally when a stream ends.

The orphaned per-court FIP system (`fip_court_streams`, `MatchStreamCard`, `fip-stream-resolver`, `fip-streams-discover` route + ops endpoints, `NEXT_PUBLIC_FIP_STREAMS_ENABLED` flag, `FipStreamsTab.tsx`) stays in the repo for a follow-up cleanup PR.

Spec: `docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md`
Mockup (approved): `public/mockup-live-stream-indicator.html`

## Test plan

- [ ] `npx vitest run src/lib/__tests__/youtube-channel-input.test.ts` — 7 tests pass
- [ ] `npx tsc --noEmit` clean for changed files
- [ ] Manual: `/matches/[date]` with a fresh `youtube_channel_live` row → YT pill shows, panel opens, VER opens YouTube
- [ ] Manual: ops "YT Channels" tab — list, edit, test, delete, add (try `@padelfip` → conflict)
- [ ] Manual: invoke cron with `Authorization: Bearer $CRON_SECRET` — returns `{ ok: true, per_channel: [...] }`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review

Spec coverage check (vs. [`docs/superpowers/specs/2026-05-14-youtube-live-indicator-design.md`](../specs/2026-05-14-youtube-live-indicator-design.md)):

| Spec section | Plan task |
|---|---|
| `youtube_channels` config table | Task 2 |
| `youtube_channel_live` state table | Task 2 |
| Seed Premier + FIP rows | Task 2 (Step 2.1 resolves Premier ID, Step 2.2 writes seed) |
| New cron `/api/cron/youtube-channels-discover` | Task 4 |
| Stop scheduling `fip-streams-discover` | Task 4 (Step 4.3) |
| YT pill LEFT of EN VIVO, hidden when nothing live | Task 6 (Step 6.1) |
| Inline panel below filter bar; click-outside + Escape close | Task 6 |
| `VER` opens YouTube externally (new tab / mobile app) | Task 6 (Step 6.1 inline JSX) |
| Server-rendered live data; no client polling | Task 5 |
| `parseYoutubeChannelInput` helper | Task 3 (TDD) |
| `listVideoDetails` helper extracted | Task 3 |
| Ops `GET / POST` `/api/ops/youtube-channels` | Task 8 (Step 8.1) |
| Ops `PATCH / DELETE /[id]` | Task 8 (Step 8.2) |
| Ops `POST /[id]/test` | Task 8 (Step 8.3) |
| Ops "YT Channels" tab in OpsClient | Task 10 |
| Remove `'fip-streams'` from nav | Task 10 |
| i18n: `daily.youtubeLive.*` × 5 locales | Task 7 |

Type consistency check: `LiveChannel` interface defined in Task 5 (Step 5.1) and reused in Tasks 5/6 with the same shape. `OpsChannel` interface defined in Task 9 and reused in Tasks 9 sub-tasks. Cron's `ChannelRow` interface in Task 4 matches the `youtube_channels` columns selected. ✓

Placeholder scan: no TBDs, TODOs, or "implement appropriate X" anywhere. The one explicit `UC_PASTE_PREMIER_HERE` placeholder in Task 2 is intentional and gated by Step 2.1 which produces the actual value. ✓
