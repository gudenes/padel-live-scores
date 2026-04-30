# FIP YouTube Streams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface FIP-tier match livestreams and replays via a tiered fallback chain on the match list (Variant C — circular YouTube button between names and scores) and on the match detail page (chunky card with lifecycle-driven CTA).

**Architecture:** A new discovery cron runs every 15 minutes, hitting the FIP YouTube channel's `uploads` playlist (cheap endpoint, ~200 quota units/day), parsing video titles to map streams to (tournament, court, day), and writing to either `fip_court_streams` (matched) or `fip_streams_unresolved` (queued for ops). A server-side `resolveStreamForMatch` function attaches a `streamTier` to match rows at query time; the UI renders nothing if no tier resolves, with graceful fallback through Tier 2 (court stream) → Tier 3 (tournament filter) → Tier 4 (generic FIP channel).

**Tech Stack:** Next.js 16 App Router, Supabase (Postgres) with manual migration application via dashboard, YouTube Data API v3, Vitest for unit tests, TypeScript, vanilla CSS-in-JS (matches existing MatchCard).

**Spec:** [docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md](../specs/2026-04-30-fip-youtube-streams-design.md)
**Mockup:** [public/mockup-fip-stream.html](../../../public/mockup-fip-stream.html)

---

## File structure

### Created
- `supabase/migrations/20260430000001_fip_youtube_streams.sql` — both tables in one migration
- `src/lib/fip-channel.ts` — channel constants
- `src/lib/fip-stream-title-parser.ts` — pure parser
- `src/lib/__tests__/fip-stream-title-parser.test.ts`
- `src/lib/youtube-channel-api.ts` — cheap-endpoint API client
- `src/lib/fip-stream-resolver.ts` — match → tier resolver
- `src/lib/__tests__/fip-stream-resolver.test.ts`
- `src/app/api/cron/fip-streams-discover/route.ts` — discovery cron
- `src/app/api/ops/fip-streams/unresolved/route.ts` — list unresolved queue
- `src/app/api/ops/fip-streams/resolve/route.ts` — resolve unresolved row
- `src/app/api/ops/fip-streams/active/route.ts` — list active streams
- `src/app/ops/FipStreamsTab.tsx` — ops UI tab (sibling of other `*Tab.tsx` files)
- `src/components/MatchStreamCard.tsx` — chunky detail-page card

### Modified
- `src/components/MatchCard.tsx` — restructure pair-row flex into 3-col grid + add circular button + reduce name font
- `src/app/[locale]/match/[id]/page.tsx` — call resolver, render `<MatchStreamCard>`
- `src/app/[locale]/(app)/matches/[date]/page.tsx` — call batch resolver, pass `streamTier` to each match
- `src/app/ops/OpsClient.tsx` — register new tab in union type + nav button + render block
- `src/types/match.ts` — extend `Match` with optional `streamTier` field
- `vercel.json` — add `*/15 * * * *` cron entry
- `src/messages/{en,es,pt,it,fr}.json` — add `match.stream.*` namespace

---

## Phase 1 — Foundation

### Task 1: Database migration

**Files:**
- Create: `supabase/migrations/20260430000001_fip_youtube_streams.sql`

- [ ] **Step 1: Write the migration SQL**

```sql
-- 20260430000001_fip_youtube_streams.sql
-- FIP YouTube stream discovery + ops unresolved queue.
-- Spec: docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md

CREATE TABLE IF NOT EXISTS fip_court_streams (
  youtube_video_id      TEXT PRIMARY KEY,
  tournament_id         UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  court                 TEXT NOT NULL,
  day_date              DATE NOT NULL,
  title                 TEXT,
  thumbnail_url         TEXT,
  state                 TEXT NOT NULL CHECK (state IN ('upcoming','live','archived')),
  scheduled_start_at    TIMESTAMPTZ,
  actual_start_at       TIMESTAMPTZ,
  actual_end_at         TIMESTAMPTZ,
  view_count            INTEGER,
  concurrent_viewers    INTEGER,
  manual_offset_seconds INTEGER,
  link_method           TEXT NOT NULL CHECK (link_method IN ('auto','manual')),
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fip_court_streams_lookup
  ON fip_court_streams (tournament_id, court, day_date, state);

CREATE TABLE IF NOT EXISTS fip_streams_unresolved (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  youtube_video_id         TEXT UNIQUE NOT NULL,
  channel_id               TEXT NOT NULL,
  title                    TEXT NOT NULL,
  thumbnail_url            TEXT,
  state                    TEXT,
  scheduled_start_at       TIMESTAMPTZ,
  reason                   TEXT NOT NULL CHECK (reason IN ('parser_failed','no_tournament_match','no_court')),
  parsed_tournament_name   TEXT,
  parsed_day               TEXT,
  parsed_court             TEXT,
  resolved_at              TIMESTAMPTZ,
  resolved_tournament_id   UUID REFERENCES tournaments(id),
  resolved_court           TEXT,
  resolved_day_date        DATE,
  first_seen_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fip_streams_unresolved_open
  ON fip_streams_unresolved (resolved_at) WHERE resolved_at IS NULL;
```

- [ ] **Step 2: Apply via Supabase dashboard**

CLAUDE.md notes that migrations are applied via the Supabase dashboard, not the CLI. Open the project, go to SQL Editor, paste the migration content, run it. Verify both tables exist via Table Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260430000001_fip_youtube_streams.sql
git commit -m "migration(fip-streams): create fip_court_streams + fip_streams_unresolved tables"
```

---

### Task 2: FIP channel constants

**Files:**
- Create: `src/lib/fip-channel.ts`

- [ ] **Step 1: Write the constants module**

```ts
// src/lib/fip-channel.ts
//
// Hardcoded constants for the FIP International Padel Federation
// YouTube channel. Used as the canonical source for FIP-tier match
// livestreams + replays (Bronze/Silver/Gold/Platinum/Promises).

export const FIP_CHANNEL_HANDLE = 'fipinternationalpadelfederation'

// YouTube channel ID, format: UC<22 chars>. Resolve once during
// implementation by hitting:
//   https://www.googleapis.com/youtube/v3/channels?forHandle=fipinternationalpadelfederation&part=id&key=...
// then paste the `id` value here.
export const FIP_CHANNEL_ID = 'UC4QobU6STFB0P71PMvOGN5A'

// uploads playlist ID is derived from channel ID: replace 'UC' prefix with 'UU'.
export const FIP_UPLOADS_PLAYLIST_ID = `UU${FIP_CHANNEL_ID.slice(2)}`

export const FIP_CHANNEL_URL = `https://www.youtube.com/c/${FIP_CHANNEL_HANDLE}`

export const FIP_TOURNAMENT_LEVELS = [
  'fip_bronze',
  'fip_silver',
  'fip_gold',
  'fip_platinum',
  'fip_promises',
  'fip_other',
] as const

export type FipTournamentLevel = (typeof FIP_TOURNAMENT_LEVELS)[number]

export function isFipTier(level: string | null | undefined): level is FipTournamentLevel {
  return !!level && (FIP_TOURNAMENT_LEVELS as readonly string[]).includes(level)
}
```

- [ ] **Step 2: Verify the channel ID is correct**

Run from your terminal:
```bash
curl -s "https://www.googleapis.com/youtube/v3/channels?forHandle=fipinternationalpadelfederation&part=id&key=$YOUTUBE_API_KEY" | python3 -m json.tool
```
Compare the returned `items[0].id` to `FIP_CHANNEL_ID` in the file. If different, update the constant.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fip-channel.ts
git commit -m "feat(fip-streams): FIP channel constants module"
```

---

### Task 3: Title parser (TDD)

**Files:**
- Create: `src/lib/fip-stream-title-parser.ts`
- Test: `src/lib/__tests__/fip-stream-title-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/__tests__/fip-stream-title-parser.test.ts
import { describe, it, expect } from 'vitest'
import { parseFipStreamTitle } from '../fip-stream-title-parser'

describe('parseFipStreamTitle', () => {
  it('parses standard "FIP Silver Mendoza | Day 3 | Center Court" format', () => {
    const r = parseFipStreamTitle('FIP Silver Mendoza | Day 3 | Center Court')
    expect(r.tier).toBe('silver')
    expect(r.day).toBe(3)
    expect(r.court).toBe('center court')
    expect(r.tournamentTokens).toEqual(['mendoza'])
  })

  it('parses dash-separated all-caps "FIP GOLD ALMATY - DAY 4 - CENTRAL COURT"', () => {
    const r = parseFipStreamTitle('FIP GOLD ALMATY - DAY 4 - CENTRAL COURT')
    expect(r.tier).toBe('gold')
    expect(r.day).toBe(4)
    expect(r.court).toBe('central court')
    expect(r.tournamentTokens).toEqual(['almaty'])
  })

  it('parses "FIP Bronze Genova Day 1 Court 2"', () => {
    const r = parseFipStreamTitle('FIP Bronze Genova Day 1 Court 2')
    expect(r.tier).toBe('bronze')
    expect(r.day).toBe(1)
    expect(r.court).toBe('court 2')
    expect(r.tournamentTokens).toEqual(['genova'])
  })

  it('parses Spanish "Día" day label', () => {
    const r = parseFipStreamTitle('FIP Silver Buenos Aires - Día 2 - Pista Central')
    expect(r.tier).toBe('silver')
    expect(r.day).toBe(2)
    expect(r.court).toBe('pista central')
    expect(r.tournamentTokens).toEqual(['buenos', 'aires'])
  })

  it('returns null tier for non-FIP titles', () => {
    const r = parseFipStreamTitle('Mendoza Padel Cup - Live')
    expect(r.tier).toBeNull()
    expect(r.tournamentTokens).toEqual(['mendoza', 'cup'])
  })

  it('returns null day when missing', () => {
    const r = parseFipStreamTitle('FIP Gold Almaty - Center Court')
    expect(r.day).toBeNull()
    expect(r.court).toBe('center court')
  })

  it('returns null court when missing', () => {
    const r = parseFipStreamTitle('FIP Silver Mendoza - Day 3')
    expect(r.court).toBeNull()
  })

  it('strips trailing year tokens from tournament', () => {
    const r = parseFipStreamTitle('FIP Gold Almaty 2026 - Day 1 - Centre Court')
    expect(r.tournamentTokens).toEqual(['almaty'])
  })

  it('lowercases and trims diacritics from tournament tokens', () => {
    const r = parseFipStreamTitle('FIP Silver São Paulo - Day 2 - Pista Central')
    expect(r.tournamentTokens).toContain('sao')
    expect(r.tournamentTokens).toContain('paulo')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/fip-stream-title-parser.test.ts`
Expected: FAIL with "module not found" or "parseFipStreamTitle is not a function".

- [ ] **Step 3: Write the parser**

```ts
// src/lib/fip-stream-title-parser.ts
//
// Pure title parser for FIP YouTube livestream titles.
// Maps a raw video title to (tier, day, court, tournamentTokens) so
// downstream code can match it against an active tournament. Returns
// nullable fields rather than throwing — the cron decides the
// `unresolved` reason based on which fields are null.
//
// Test fixtures live in src/lib/__tests__/fip-stream-title-parser.test.ts

export type FipTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'promises'

export interface ParsedFipTitle {
  tier: FipTier | null
  day: number | null
  court: string | null
  tournamentTokens: string[]
  rawTitle: string
}

const TIER_RE = /\b(bronze|silver|gold|platinum|promises)\b/i
const DAY_RE = /\b(?:DAY|D[ÍI]A|D)[\s_-]*(\d+)\b/i
// Court matcher: anchor on COURT|PISTA|CENTRE|CENTRAL|CENTER, then capture
// up to the next pipe / dash / end-of-string.
const COURT_RE = /\b((?:CENTRE|CENTRAL|CENTER|COURT|PISTA)[\w\s\d]{0,30}?)(?=[|\-–]|$)/i

const NOISE_TOKENS = new Set([
  'fip', 'premier', 'padel', 'tour', 'open', 'cup',
  'live', 'highlights', 'recap', 'stream', 'streaming',
  'official', 'tv', 'youtube',
])

const YEAR_RE = /^\d{4}$/

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function tokenize(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0)
    .filter(t => !NOISE_TOKENS.has(t))
    .filter(t => !YEAR_RE.test(t))
}

export function parseFipStreamTitle(title: string): ParsedFipTitle {
  const tierMatch = title.match(TIER_RE)
  const dayMatch = title.match(DAY_RE)
  const courtMatch = title.match(COURT_RE)

  const tier = (tierMatch?.[1]?.toLowerCase() ?? null) as FipTier | null
  const day = dayMatch ? parseInt(dayMatch[1], 10) : null
  const court = courtMatch ? courtMatch[1].trim().toLowerCase() : null

  // Strip the matched segments so they don't pollute tournament tokens.
  let remaining = title
  if (tierMatch) remaining = remaining.replace(tierMatch[0], ' ')
  if (dayMatch) remaining = remaining.replace(dayMatch[0], ' ')
  if (courtMatch) remaining = remaining.replace(courtMatch[0], ' ')

  const tournamentTokens = tokenize(remaining)

  return { tier, day, court, tournamentTokens, rawTitle: title }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/fip-stream-title-parser.test.ts`
Expected: All 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fip-stream-title-parser.ts src/lib/__tests__/fip-stream-title-parser.test.ts
git commit -m "feat(fip-streams): pure title parser for YouTube stream titles"
```

---

### Task 4: YouTube channel API client

**Files:**
- Create: `src/lib/youtube-channel-api.ts`

- [ ] **Step 1: Write the client module**

```ts
// src/lib/youtube-channel-api.ts
//
// Minimal YouTube Data API v3 client that ONLY uses the cheap endpoints
// (1 quota unit each). Avoid `search.list` (100 units). For the FIP
// stream discovery cron, this is the entire surface we need.

const Y_BASE = 'https://www.googleapis.com/youtube/v3'

export interface PlaylistItem {
  videoId: string
  publishedAt: string
}

export interface VideoDetails {
  videoId: string
  title: string
  thumbnailUrl: string | null
  channelId: string
  liveBroadcastContent: 'live' | 'upcoming' | 'none'
  scheduledStartTime: string | null
  actualStartTime: string | null
  actualEndTime: string | null
  concurrentViewers: number | null
  viewCount: number | null
}

interface PlaylistItemsResponse {
  items: Array<{
    contentDetails: { videoId: string; videoPublishedAt?: string }
  }>
}

interface VideosResponse {
  items: Array<{
    id: string
    snippet: {
      title: string
      channelId: string
      thumbnails?: { medium?: { url?: string }; default?: { url?: string } }
      liveBroadcastContent: 'live' | 'upcoming' | 'none'
    }
    liveStreamingDetails?: {
      scheduledStartTime?: string
      actualStartTime?: string
      actualEndTime?: string
      concurrentViewers?: string
    }
    statistics?: { viewCount?: string }
  }>
}

export async function listUploadsPlaylistItems(
  playlistId: string,
  apiKey: string,
  maxResults = 50,
): Promise<PlaylistItem[]> {
  const params = new URLSearchParams({
    playlistId,
    part: 'contentDetails',
    maxResults: String(maxResults),
    key: apiKey,
  })
  const res = await fetch(`${Y_BASE}/playlistItems?${params}`)
  if (!res.ok) {
    throw new Error(`YouTube playlistItems failed: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as PlaylistItemsResponse
  return (json.items ?? []).map(it => ({
    videoId: it.contentDetails.videoId,
    publishedAt: it.contentDetails.videoPublishedAt ?? '',
  }))
}

export async function fetchVideoDetailsBatch(
  videoIds: string[],
  apiKey: string,
): Promise<VideoDetails[]> {
  if (videoIds.length === 0) return []
  if (videoIds.length > 50) {
    throw new Error('fetchVideoDetailsBatch: max 50 IDs per call')
  }
  const params = new URLSearchParams({
    id: videoIds.join(','),
    part: 'snippet,liveStreamingDetails,statistics',
    key: apiKey,
  })
  const res = await fetch(`${Y_BASE}/videos?${params}`)
  if (!res.ok) {
    throw new Error(`YouTube videos failed: ${res.status} ${await res.text()}`)
  }
  const json = (await res.json()) as VideosResponse
  return (json.items ?? []).map(v => ({
    videoId: v.id,
    title: v.snippet.title,
    thumbnailUrl:
      v.snippet.thumbnails?.medium?.url ??
      v.snippet.thumbnails?.default?.url ??
      null,
    channelId: v.snippet.channelId,
    liveBroadcastContent: v.snippet.liveBroadcastContent,
    scheduledStartTime: v.liveStreamingDetails?.scheduledStartTime ?? null,
    actualStartTime: v.liveStreamingDetails?.actualStartTime ?? null,
    actualEndTime: v.liveStreamingDetails?.actualEndTime ?? null,
    concurrentViewers: v.liveStreamingDetails?.concurrentViewers
      ? parseInt(v.liveStreamingDetails.concurrentViewers, 10)
      : null,
    viewCount: v.statistics?.viewCount ? parseInt(v.statistics.viewCount, 10) : null,
  }))
}
```

- [ ] **Step 2: Smoke-test from REPL or a throwaway script**

Run from your terminal:
```bash
node --input-type=module -e "
import('./src/lib/youtube-channel-api.ts').then(async ({ listUploadsPlaylistItems }) => {
  const items = await listUploadsPlaylistItems('UU4QobU6STFB0P71PMvOGN5A', process.env.YOUTUBE_API_KEY)
  console.log(items.slice(0, 3))
})
"
```
Expected: array of `{ videoId, publishedAt }` objects from the FIP channel uploads.

(Skip this step if your local env doesn't have the API key — the cron will exercise it on first deploy.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/youtube-channel-api.ts
git commit -m "feat(fip-streams): YouTube Data API v3 cheap-endpoint client"
```

---

## Phase 2 — Discovery cron

### Task 5: Cron route — skeleton + auth + early returns

**Files:**
- Create: `src/app/api/cron/fip-streams-discover/route.ts`

- [ ] **Step 1: Write the route skeleton with auth and early returns**

```ts
// src/app/api/cron/fip-streams-discover/route.ts
//
// Discovers FIP YouTube livestreams + replays by scanning the FIP
// channel's uploads playlist every 15 min. Cheap: ~2 quota units/run.
//
// Spec: docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md
// Schedule: */15 * * * * (every 15 minutes), see vercel.json

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { FIP_UPLOADS_PLAYLIST_ID } from '@/lib/fip-channel'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  // Auth — same pattern as other crons.
  const authHeader = request.headers.get('authorization')
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return NextResponse.json({ ok: true, skipped: 'no_api_key' })
  }

  return await logOpsEvent('cron:fip-streams-discover', async () => {
    const supabase = createServerClient()

    // Tournament-aware short-circuit: only run if at least one FIP-tier
    // tournament is currently active or ended in the last 7 days.
    const { data: activeRow } = await supabase
      .from('tournaments')
      .select('id')
      .in('level', ['fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum', 'fip_promises', 'fip_other'])
      .lte('starts_at', new Date().toISOString())
      .gte('ends_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
      .maybeSingle()

    if (!activeRow) {
      return NextResponse.json({ ok: true, skipped: 'no_active_tournament' })
    }

    // Filled in by Task 6.
    return NextResponse.json({ ok: true, skipped: null, scanned: 0, newly_matched: 0, newly_unresolved: 0, open_unresolved_total: 0, state_transitions: {}, ms: 0 })
  })
}
```

- [ ] **Step 2: Hit the route locally to verify auth + early-return paths**

```bash
# Should 401 (auth header missing)
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/api/cron/fip-streams-discover

# Should return { ok: true, skipped: 'no_active_tournament' } when no FIP tournament is active
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/fip-streams-discover
```

Expected: 401 then a JSON body that either has `skipped` set (if no FIP tournaments active) or has the empty `scanned: 0` shape (if a tournament IS active but Task 6 hasn't run yet).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/fip-streams-discover/route.ts
git commit -m "feat(fip-streams): cron route skeleton with auth + tournament short-circuit"
```

---

### Task 6: Cron route — fetch, parse, match, write

**Files:**
- Modify: `src/app/api/cron/fip-streams-discover/route.ts` (replace the placeholder return)

- [ ] **Step 1: Add the fetch + parse + match + write logic**

Replace the line `// Filled in by Task 6.` and the placeholder return with:

```ts
    const { listUploadsPlaylistItems, fetchVideoDetailsBatch } = await import('@/lib/youtube-channel-api')
    const { parseFipStreamTitle } = await import('@/lib/fip-stream-title-parser')

    const t0 = Date.now()
    const stats = {
      scanned: 0,
      newly_matched: 0,
      newly_unresolved: 0,
      open_unresolved_total: 0,
      state_transitions: { upcoming_to_live: 0, live_to_archived: 0 },
    }

    // 1. Enumerate the FIP channel's last 50 uploads.
    const playlistItems = await listUploadsPlaylistItems(FIP_UPLOADS_PLAYLIST_ID, apiKey, 50)
    const allVideoIds = playlistItems.map(it => it.videoId)
    stats.scanned = allVideoIds.length

    if (allVideoIds.length === 0) {
      return NextResponse.json({ ok: true, ...stats, ms: Date.now() - t0 })
    }

    // 2. Find which video IDs we haven't seen yet.
    const { data: seenStreams } = await supabase
      .from('fip_court_streams')
      .select('youtube_video_id, state')
      .in('youtube_video_id', allVideoIds)
    const { data: seenUnresolved } = await supabase
      .from('fip_streams_unresolved')
      .select('youtube_video_id')
      .in('youtube_video_id', allVideoIds)

    const seenStreamIds = new Map(
      (seenStreams ?? []).map(r => [r.youtube_video_id, r.state as string]),
    )
    const seenUnresolvedIds = new Set((seenUnresolved ?? []).map(r => r.youtube_video_id))

    // We DO want to refetch details for streams whose state may have changed
    // (upcoming → live → archived). So we refetch for: new IDs + non-archived seen IDs.
    const toFetch = allVideoIds.filter(id => {
      const state = seenStreamIds.get(id)
      if (!state) return true                  // new
      return state !== 'archived'              // refresh upcoming + live
    })

    if (toFetch.length === 0) {
      const { count: openCount } = await supabase
        .from('fip_streams_unresolved')
        .select('*', { count: 'exact', head: true })
        .is('resolved_at', null)
      stats.open_unresolved_total = openCount ?? 0
      return NextResponse.json({ ok: true, ...stats, ms: Date.now() - t0 })
    }

    // 3. Batch-fetch details (max 50 IDs/call — we always have ≤50 here).
    const details = await fetchVideoDetailsBatch(toFetch, apiKey)

    // 4. Filter to actual livestreams (have liveStreamingDetails).
    const livestreamDetails = details.filter(
      d =>
        d.liveBroadcastContent === 'live' ||
        d.liveBroadcastContent === 'upcoming' ||
        d.actualStartTime !== null, // archived livestreams come back as 'none' but still have actualStartTime
    )

    // 5. Load active FIP-tier tournaments for matching.
    const { data: activeTournaments } = await supabase
      .from('tournaments')
      .select('id, name, level, starts_at, ends_at')
      .in('level', ['fip_bronze', 'fip_silver', 'fip_gold', 'fip_platinum', 'fip_promises', 'fip_other'])
      .lte('starts_at', new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString())
      .gte('ends_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

    type ActiveTournament = { id: string; name: string; level: string; starts_at: string; ends_at: string }
    const tournaments: ActiveTournament[] = (activeTournaments ?? []) as ActiveTournament[]

    // 6. For each livestream: parse title, match tournament, upsert into the right table.
    for (const d of livestreamDetails) {
      const parsed = parseFipStreamTitle(d.title)

      const newState =
        d.actualEndTime ? 'archived'
        : d.liveBroadcastContent === 'live' ? 'live'
        : d.liveBroadcastContent === 'upcoming' ? 'upcoming'
        : 'archived'

      // Track state transitions for telemetry.
      const prevState = seenStreamIds.get(d.videoId)
      if (prevState === 'upcoming' && newState === 'live') stats.state_transitions.upcoming_to_live++
      if (prevState === 'live' && newState === 'archived') stats.state_transitions.live_to_archived++

      // Determine reason for unresolved if we can't match.
      if (!parsed.tier || parsed.tournamentTokens.length === 0) {
        await upsertUnresolved(supabase, d, parsed, 'parser_failed')
        if (!seenUnresolvedIds.has(d.videoId) && !seenStreamIds.has(d.videoId)) stats.newly_unresolved++
        continue
      }

      // Tournament match via token-subset.
      const tourn = matchTournament(parsed, tournaments)
      if (!tourn) {
        await upsertUnresolved(supabase, d, parsed, 'no_tournament_match')
        if (!seenUnresolvedIds.has(d.videoId) && !seenStreamIds.has(d.videoId)) stats.newly_unresolved++
        continue
      }

      if (!parsed.court) {
        await upsertUnresolved(supabase, d, parsed, 'no_court')
        if (!seenUnresolvedIds.has(d.videoId) && !seenStreamIds.has(d.videoId)) stats.newly_unresolved++
        continue
      }

      // Determine day_date — prefer scheduledStartTime / actualStartTime, fall back to publishedAt.
      const dayIso = d.actualStartTime ?? d.scheduledStartTime ?? null
      if (!dayIso) {
        await upsertUnresolved(supabase, d, parsed, 'parser_failed')
        if (!seenUnresolvedIds.has(d.videoId) && !seenStreamIds.has(d.videoId)) stats.newly_unresolved++
        continue
      }
      const dayDate = dayIso.slice(0, 10) // YYYY-MM-DD in UTC; good enough for v1.

      const wasSeen = seenStreamIds.has(d.videoId)
      const { error: upsertErr } = await supabase
        .from('fip_court_streams')
        .upsert({
          youtube_video_id: d.videoId,
          tournament_id: tourn.id,
          court: parsed.court,
          day_date: dayDate,
          title: d.title,
          thumbnail_url: d.thumbnailUrl,
          state: newState,
          scheduled_start_at: d.scheduledStartTime,
          actual_start_at: d.actualStartTime,
          actual_end_at: d.actualEndTime,
          view_count: d.viewCount,
          concurrent_viewers: d.concurrentViewers,
          link_method: 'auto',
          last_synced_at: new Date().toISOString(),
        }, { onConflict: 'youtube_video_id' })

      if (!upsertErr && !wasSeen) stats.newly_matched++
    }

    // 7. Final counts.
    const { count: openCount } = await supabase
      .from('fip_streams_unresolved')
      .select('*', { count: 'exact', head: true })
      .is('resolved_at', null)
    stats.open_unresolved_total = openCount ?? 0

    return NextResponse.json({ ok: true, ...stats, ms: Date.now() - t0 })
  })
}

// ── Helpers ──────────────────────────────────────────────────────

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ParsedFipTitle } from '@/lib/fip-stream-title-parser'
import type { VideoDetails } from '@/lib/youtube-channel-api'

async function upsertUnresolved(
  supabase: SupabaseClient,
  d: VideoDetails,
  parsed: ParsedFipTitle,
  reason: 'parser_failed' | 'no_tournament_match' | 'no_court',
) {
  await supabase.from('fip_streams_unresolved').upsert(
    {
      youtube_video_id: d.videoId,
      channel_id: d.channelId,
      title: d.title,
      thumbnail_url: d.thumbnailUrl,
      state:
        d.liveBroadcastContent === 'live' ? 'live' :
        d.liveBroadcastContent === 'upcoming' ? 'upcoming' :
        d.actualEndTime ? 'archived' : null,
      scheduled_start_at: d.scheduledStartTime,
      reason,
      parsed_tournament_name: parsed.tournamentTokens.join(' '),
      parsed_day: parsed.day != null ? String(parsed.day) : null,
      parsed_court: parsed.court,
    },
    { onConflict: 'youtube_video_id' },
  )
}

function matchTournament(
  parsed: ParsedFipTitle,
  tournaments: Array<{ id: string; name: string; level: string }>,
): { id: string; name: string; level: string } | null {
  // Token-subset match against tournament names. Reuse the tokenizer on
  // tournament side. Tier in the parsed title must align with level.
  const tierLevelMap: Record<string, string> = {
    bronze: 'fip_bronze',
    silver: 'fip_silver',
    gold: 'fip_gold',
    platinum: 'fip_platinum',
    promises: 'fip_promises',
  }
  const expectedLevel = parsed.tier ? tierLevelMap[parsed.tier] : null

  const candidates = expectedLevel
    ? tournaments.filter(t => t.level === expectedLevel || t.level === 'fip_other')
    : tournaments

  const titleTokens = new Set(parsed.tournamentTokens)
  for (const t of candidates) {
    const tn = tournamentTokens(t.name)
    // Every parsed token must appear in tournament's token set.
    if ([...titleTokens].every(tok => tn.has(tok))) {
      return t
    }
  }
  return null
}

function tournamentTokens(name: string): Set<string> {
  return new Set(
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(t => t.length > 0)
      .filter(t => !['premier', 'padel', 'tour', 'open', 'cup', 'fip'].includes(t))
      .filter(t => !/^\d{4}$/.test(t)),
  )
}
```

- [ ] **Step 2: Trigger the cron locally with at least one active FIP tournament**

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/fip-streams-discover | python3 -m json.tool
```

Expected: response with `scanned`, `newly_matched`, `newly_unresolved`, `state_transitions`, `ms`. If `scanned > 0` and you have an active FIP tournament whose name matches a recent FIP YouTube title, you should see a row in `fip_court_streams` (check via Supabase Table Editor).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/fip-streams-discover/route.ts
git commit -m "feat(fip-streams): cron fetches uploads, parses titles, writes to streams or unresolved"
```

---

### Task 7: Add cron schedule to vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the cron entry**

Open `vercel.json` and add to the `crons` array:

```json
    {
      "path": "/api/cron/fip-streams-discover",
      "schedule": "*/15 * * * *"
    }
```

Place it adjacent to other YouTube-related crons (e.g., near `sync-highlights`) for readability.

- [ ] **Step 2: Verify JSON parses**

```bash
python3 -c "import json; json.load(open('vercel.json')); print('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(fip-streams): vercel cron schedule every 15 min"
```

---

## Phase 3 — Match → stream resolver

### Task 8: Stream resolver (TDD)

**Files:**
- Create: `src/lib/fip-stream-resolver.ts`
- Test: `src/lib/__tests__/fip-stream-resolver.test.ts`

- [ ] **Step 1: Write failing tests with a mock supabase client**

```ts
// src/lib/__tests__/fip-stream-resolver.test.ts
import { describe, it, expect, vi } from 'vitest'
import { resolveStreamForMatch } from '../fip-stream-resolver'

function mockClient(courtRows: unknown[], anyRows: unknown[]) {
  // Two-stage mock: first .maybeSingle() (court+day query) resolves to
  // courtRows[0]; second (any-stream-for-tournament query) resolves to
  // anyRows[0]. Mimics Supabase's maybeSingle() which returns a single
  // object (or null), not an array.
  let queryCount = 0
  const supabase = {
    from(_table: string) {
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.in = () => builder
      builder.order = () => builder
      builder.limit = () => builder
      builder.maybeSingle = () => {
        queryCount++
        const rows = queryCount === 1 ? courtRows : anyRows
        return Promise.resolve({ data: rows[0] ?? null, error: null })
      }
      return builder as never
    },
  }
  return { supabase }
}

describe('resolveStreamForMatch', () => {
  it('returns null for non-FIP-tier matches', async () => {
    const { supabase } = mockClient([], [])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'premier_p1',
      court: 'Centre Court',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    })
    expect(r).toBeNull()
  })

  it('returns Tier 2 when court stream exists', async () => {
    const { supabase } = mockClient([{
      youtube_video_id: 'abc123',
      title: 'FIP Silver Mendoza | Day 4 | Centre Court',
      thumbnail_url: 'https://i.ytimg.com/vi/abc123/mqdefault.jpg',
      state: 'live',
      manual_offset_seconds: null,
    }], [])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'fip_silver',
      court: 'Centre Court',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    })
    expect(r?.tier).toBe(2)
    expect(r?.state).toBe('live')
    expect(r?.url).toBe('https://www.youtube.com/watch?v=abc123')
  })

  it('returns Tier 1 when manual_offset_seconds is set', async () => {
    const { supabase } = mockClient([{
      youtube_video_id: 'abc123',
      title: 'Day stream',
      thumbnail_url: null,
      state: 'archived',
      manual_offset_seconds: 6210,
    }], [])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'fip_silver',
      court: 'Centre Court',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    })
    expect(r?.tier).toBe(1)
    expect(r?.url).toBe('https://www.youtube.com/watch?v=abc123&t=6210s')
  })

  it('returns Tier 3 when tournament has streams but none for this court', async () => {
    const { supabase } = mockClient([], [{ youtube_video_id: 'other' }])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'fip_silver',
      court: 'Pista 5',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    }, 'Mendoza Open')
    expect(r?.tier).toBe(3)
    expect(r?.state).toBe('channel')
    expect(r?.url).toContain('search?query=Mendoza')
  })

  it('returns Tier 4 when tournament has no streams known at all', async () => {
    const { supabase } = mockClient([], [])
    const r = await resolveStreamForMatch(supabase as never, {
      id: 'm1',
      tournament_id: 't1',
      tournament_level: 'fip_bronze',
      court: 'Court 2',
      scheduled_at: '2026-04-30T15:00:00Z',
      played_at: null,
    })
    expect(r?.tier).toBe(4)
    expect(r?.url).toBe('https://www.youtube.com/c/fipinternationalpadelfederation')
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

Run: `npx vitest run src/lib/__tests__/fip-stream-resolver.test.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 3: Write the resolver**

```ts
// src/lib/fip-stream-resolver.ts
//
// Resolves a match to its YouTube stream affordance via the tier
// fallback chain defined in the spec.
//
// Tier 1: court stream with manual_offset_seconds (deep-link to match start)
// Tier 2: court stream without offset
// Tier 3: tournament has any stream known → scoped channel search URL
// Tier 4: no stream data → generic FIP channel URL

import type { SupabaseClient } from '@supabase/supabase-js'
import { isFipTier, FIP_CHANNEL_URL, FIP_CHANNEL_HANDLE } from './fip-channel'

export interface MatchForStream {
  id: string
  tournament_id: string
  tournament_level: string | null
  court: string | null
  scheduled_at: string | null
  played_at: string | null
}

export interface StreamTier {
  tier: 1 | 2 | 3 | 4
  url: string
  state: 'live' | 'upcoming' | 'archived' | 'channel'
  videoId: string | null
  title: string | null
  thumbnailUrl: string | null
  manualOffsetSeconds: number | null
}

interface CourtStreamRow {
  youtube_video_id: string
  title: string | null
  thumbnail_url: string | null
  state: 'upcoming' | 'live' | 'archived'
  manual_offset_seconds: number | null
}

function dayDateFromMatch(m: MatchForStream): string | null {
  const iso = m.scheduled_at ?? m.played_at
  if (!iso) return null
  return iso.slice(0, 10)
}

function tournamentSearchUrl(tournamentName: string): string {
  const q = encodeURIComponent(tournamentName)
  return `https://www.youtube.com/@${FIP_CHANNEL_HANDLE}/search?query=${q}`
}

export async function resolveStreamForMatch(
  supabase: SupabaseClient,
  match: MatchForStream,
  tournamentName?: string,
): Promise<StreamTier | null> {
  if (!isFipTier(match.tournament_level)) return null

  const dayDate = dayDateFromMatch(match)

  // Tier 1/2: court stream lookup (only if we have a court + day).
  if (match.court && dayDate) {
    const { data: courtRow } = await supabase
      .from('fip_court_streams')
      .select('youtube_video_id, title, thumbnail_url, state, manual_offset_seconds')
      .eq('tournament_id', match.tournament_id)
      .eq('court', match.court.toLowerCase())
      .eq('day_date', dayDate)
      .order('actual_start_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle() as { data: CourtStreamRow | null }

    if (courtRow) {
      const baseUrl = `https://www.youtube.com/watch?v=${courtRow.youtube_video_id}`
      const url = courtRow.manual_offset_seconds != null
        ? `${baseUrl}&t=${courtRow.manual_offset_seconds}s`
        : baseUrl
      return {
        tier: courtRow.manual_offset_seconds != null ? 1 : 2,
        url,
        state: courtRow.state,
        videoId: courtRow.youtube_video_id,
        title: courtRow.title,
        thumbnailUrl: courtRow.thumbnail_url,
        manualOffsetSeconds: courtRow.manual_offset_seconds,
      }
    }
  }

  // Tier 3: tournament has any stream known.
  const { data: anyRow } = await supabase
    .from('fip_court_streams')
    .select('youtube_video_id')
    .eq('tournament_id', match.tournament_id)
    .limit(1)
    .maybeSingle()

  if (anyRow && tournamentName) {
    return {
      tier: 3,
      url: tournamentSearchUrl(tournamentName),
      state: 'channel',
      videoId: null,
      title: null,
      thumbnailUrl: null,
      manualOffsetSeconds: null,
    }
  }

  // Tier 4: generic FIP channel.
  return {
    tier: 4,
    url: FIP_CHANNEL_URL,
    state: 'channel',
    videoId: null,
    title: null,
    thumbnailUrl: null,
    manualOffsetSeconds: null,
  }
}

export async function resolveStreamsForMatches(
  supabase: SupabaseClient,
  matches: MatchForStream[],
  tournamentNames: Record<string, string>,
): Promise<Map<string, StreamTier | null>> {
  // Naive batch: per-match query. Acceptable for v1 (10–60 matches per
  // page typical). Optimize with a single IN-clause query in v2 if it
  // shows up in profiling.
  const results = new Map<string, StreamTier | null>()
  for (const m of matches) {
    const tier = await resolveStreamForMatch(supabase, m, tournamentNames[m.tournament_id])
    results.set(m.id, tier)
  }
  return results
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `npx vitest run src/lib/__tests__/fip-stream-resolver.test.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fip-stream-resolver.ts src/lib/__tests__/fip-stream-resolver.test.ts
git commit -m "feat(fip-streams): match-to-stream resolver with tier fallback chain"
```

---

### Task 9: Extend Match type with streamTier

**Files:**
- Modify: `src/types/match.ts`

- [ ] **Step 1: Locate the Match interface**

Run: `grep -n 'export interface Match\|export type Match' src/types/match.ts`
Note the line number — likely the main Match shape is here.

- [ ] **Step 2: Add the optional streamTier field**

After the existing fields in the `Match` interface, add:

```ts
  // Optional: populated server-side by resolveStreamForMatch for FIP-tier
  // matches that have a YouTube stream (any tier 1-4). Undefined / null on
  // non-FIP matches and on FIP matches we couldn't resolve.
  streamTier?: import('@/lib/fip-stream-resolver').StreamTier | null
```

- [ ] **Step 3: Verify typecheck**

```bash
npx tsc --noEmit
```
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/match.ts
git commit -m "feat(fip-streams): add optional streamTier to Match type"
```

---

## Phase 4 — Match list UI (Variant C)

### Task 10: Restructure MatchCard pair-row layout

**Files:**
- Modify: `src/components/MatchCard.tsx` (lines ~282–350, the `.pairs` block)

- [ ] **Step 1: Read the current pair-row structure**

```bash
sed -n '282,350p' src/components/MatchCard.tsx
```
Confirm the structure is: `<div pairs> <div pairs-col> {[1,2].map(pairNum => <div pair> ...)} </div> </div>`.

- [ ] **Step 2: Replace the `.pairs` block with the 3-column grid**

Find the line `{/* Pair rows + right-aligned date/time (matches tournament detail) */}` and replace the block from `<div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>` through its closing `</div>` (right before the date/time stack render) with:

```tsx
{/* Pair rows: [names col | optional stream button | scores col] */}
<div style={{ display: 'flex', alignItems: 'stretch', gap: 10 }}>
  {/* Names column — both pair-lefts stacked */}
  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
    {[1, 2].map(pairNum => {
      const p1 = pairNum === 1 ? match.pair1_player1 : match.pair2_player1
      const p2 = pairNum === 1 ? match.pair1_player2 : match.pair2_player2
      const pair = pairName(p1, p2)
      const isWinner = winner === pairNum
      const isLoser = winner !== 0 && winner !== pairNum
      return (
        <div key={pairNum} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0',
          opacity: isLoser ? 0.65 : 1,
        }}>
          <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
            <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
              <FlagImage country={p1?.country ?? null} size={16} />
            </div>
            <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
              <FlagImage country={p2?.country ?? null} size={16} />
            </div>
          </div>
          <span style={{
            fontSize: 12, fontWeight: isWinner ? 800 : 600,
            color: isLoser ? '#B0B5BE' : '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{pair}</span>
          {isWinner && isFinished && (
            <span style={{
              flexShrink: 0, fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
              color: '#0A0A0A', background: GREEN, padding: '2px 6px',
              clipPath: CHUNKY.badge, lineHeight: 1.1,
            }}>W</span>
          )}
        </div>
      )
    })}
  </div>

  {/* Stream button — Task 11 plugs this in (rendered conditionally) */}

  {/* Scores column — both score rows stacked */}
  <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
    {[1, 2].map(pairNum => {
      const isWinner = winner === pairNum
      const isLoser = winner !== 0 && winner !== pairNum
      return (
        <div key={pairNum} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
          gap: 8, padding: '5px 0', opacity: isLoser ? 0.65 : 1,
        }}>
          {sets.map(s => {
            const parsed = parseSetScore(s.set_score) ?? parseSetFromGames(s.pair1_games, s.pair2_games)
            const p1g = parsed?.p1 ?? s.pair1_games ?? 0
            const p2g = parsed?.p2 ?? s.pair2_games ?? 0
            const games = pairNum === 1 ? p1g : p2g
            const tb = parsed?.tb ?? null
            const wonThisSet = pairNum === 1 ? p1g > p2g : p2g > p1g
            const isCurrent = s.is_current && isLive
            return (
              <span key={s.id} style={{
                fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
                color: isCurrent ? GREEN : wonThisSet ? '#fff' : '#B0B5BE',
                minWidth: 16, textAlign: 'center', position: 'relative',
              }}>
                {games}
                {tb != null && !wonThisSet && (
                  <sup style={{
                    fontSize: 8, color: '#B0B5BE',
                    position: 'absolute', top: -3, right: -5,
                  }}>{tb}</sup>
                )}
              </span>
            )
          })}
          {/* (live game-points indicator preserved from original — copy
              the existing block here exactly as it was in the original
              pair row) */}
        </div>
      )
    })}
  </div>
</div>
```

**Important:** the original code (lines 397–~440 of `MatchCard.tsx`) had a live game-points indicator that rendered after the per-set scores: `{isLive && gamePoints && ( <span style={...}> {gamePoints[pairNum-1]} </span> )}`. Find that block in the original (search `gamePoints` in the file), copy it verbatim, and paste it as the LAST child of the new `.row-score` map so live game-points display continues working unchanged.

- [ ] **Step 3: Verify the dev server renders unchanged**

Run: `npm run dev` (if not already running). Open http://localhost:3000/matches/today. Confirm match cards render with names + flags on the left, scores on the right, no visual regression vs main.

- [ ] **Step 4: Verify with the preview tool**

```bash
# Use preview_screenshot via Claude Preview MCP if available, or open
# /matches/today in your browser and visually compare to a main-branch screenshot.
```

- [ ] **Step 5: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "refactor(MatchCard): split pair rows into [names | scores] columns"
```

---

### Task 11: Add the circular stream button between columns

**Files:**
- Modify: `src/components/MatchCard.tsx`

- [ ] **Step 1: Add the button between names-col and scores-col**

In the new 3-column layout from Task 10, insert this block at the comment `{/* Stream button — Task 11 plugs this in (rendered conditionally) */}`:

```tsx
{match.streamTier && (
  <a
    href={match.streamTier.url}
    target="_blank"
    rel="noopener noreferrer"
    onClick={e => e.stopPropagation()}
    aria-label={
      match.streamTier.state === 'live' ? 'Watch live on YouTube'
      : match.streamTier.state === 'upcoming' ? 'Tune in on YouTube'
      : 'Watch replay on YouTube'
    }
    style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexShrink: 0, width: 36, height: 36, alignSelf: 'center',
      borderRadius: '50%', textDecoration: 'none',
      background:
        match.streamTier.state === 'live' ? '#FF4655'
        : match.streamTier.state === 'archived' ? 'rgba(126,211,33,0.16)'
        : 'rgba(255,255,255,0.08)',
      border:
        match.streamTier.state === 'archived' ? '1px solid rgba(126,211,33,0.4)'
        : 'none',
      color:
        match.streamTier.state === 'live' ? '#fff'
        : match.streamTier.state === 'archived' ? '#7ED321'
        : '#B0B5BE',
      animation: match.streamTier.state === 'live' ? 'fipStreamPulse 1.6s ease-in-out infinite' : undefined,
    }}
  >
    {match.streamTier.state === 'archived' ? (
      <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
      </svg>
    ) : (
      <svg width={14} height={14} viewBox="0 0 24 24" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
    )}
  </a>
)}
```

The `e.stopPropagation()` is critical — without it, the parent `<Link>` would also fire and navigate to `/match/[id]` instead of opening YouTube.

- [ ] **Step 2: Add the keyframes for the live pulse**

At the very top of the file (after imports), add:

```tsx
const PULSE_KEYFRAMES = `
@keyframes fipStreamPulse {
  0%, 100% { filter: brightness(1); }
  50% { filter: brightness(1.18); }
}
`
```

Inside the component, find the existing `<Link href={...}>` wrapper. Insert a `<style>` element as the FIRST child inside the `<Link>`:

```tsx
<Link href={...} ...>
  <style>{PULSE_KEYFRAMES}</style>
  <div style={{ background: BG_CARD, ... }}>
    {/* existing card body */}
  </div>
</Link>
```

This injects the `@keyframes` rule on first render. React dedupes identical `<style>` children so multiple cards on a page don't multiply the rule.

- [ ] **Step 3: Pass `streamTier` from the match list page**

Modify `src/app/[locale]/(app)/matches/[date]/page.tsx`. Find where matches are fetched and the array is passed to `<MatchCard>`. Add this BEFORE the render:

```ts
import { resolveStreamsForMatches } from '@/lib/fip-stream-resolver'

// (… after matches are fetched and tournament name lookup is built …)

const tournamentNames: Record<string, string> = {}
for (const m of matches) {
  if (m.tournament?.name) tournamentNames[m.tournament_id] = m.tournament.name
}

const streamTiers = await resolveStreamsForMatches(
  supabase,
  matches.map(m => ({
    id: m.id,
    tournament_id: m.tournament_id,
    tournament_level: m.tournament?.level ?? null,
    court: m.court,
    scheduled_at: m.scheduled_at,
    played_at: m.played_at ?? null,
  })),
  tournamentNames,
)

// Decorate matches with streamTier before rendering.
const matchesWithStream = matches.map(m => ({ ...m, streamTier: streamTiers.get(m.id) ?? null }))
```

Then change the render to use `matchesWithStream` instead of `matches`.

- [ ] **Step 4: Visual verification**

Open http://localhost:3000/matches/today (or any FIP-tier tournament's day with seeded data). Confirm: matches with stream data show the circle button between names and scores. Tap → opens YouTube in new tab. Tap anywhere else → match detail. No button on non-FIP matches.

If you don't have seeded FIP stream data yet, manually insert a row:

```sql
INSERT INTO fip_court_streams (
  youtube_video_id, tournament_id, court, day_date,
  title, state, link_method
) VALUES (
  'dQw4w9WgXcQ', '<some-fip-tournament-uuid>', 'centre court', CURRENT_DATE,
  'Test stream', 'live', 'manual'
);
```

- [ ] **Step 5: Commit**

```bash
git add src/components/MatchCard.tsx src/app/[locale]/\(app\)/matches/[date]/page.tsx
git commit -m "feat(MatchCard): circular YouTube button between names and scores"
```

---

## Phase 5 — Match detail UI

### Task 12: i18n keys for stream UI

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

- [ ] **Step 1: Add the `match.stream.*` namespace to `en.json`**

Find the `match` namespace (or create it if absent) and add:

```json
"stream": {
  "live": {
    "eyebrow": "Watch live",
    "cta": "Watch live on YouTube",
    "footer": "Streaming free on the FIP YouTube channel"
  },
  "archived": {
    "eyebrow": "Watch replay",
    "cta": "Watch replay on YouTube",
    "footer": "Match was on {court} · scrub the stream to find the start"
  },
  "upcoming": {
    "eyebrow": "Tune in",
    "cta": "Open YouTube stream",
    "footer": "Court livestream goes live ~10 min before first match"
  },
  "channel": {
    "eyebrow": "Watch on FIP YouTube",
    "cta": "Open FIP channel",
    "footer": "We couldn't pin down this match's stream — the FIP channel has all matches",
    "title": "FIP International Padel Federation",
    "meta": "Browse live and recent streams"
  },
  "metaLive": "Live now · {viewers} watching",
  "metaScheduled": "Scheduled · starts at {time}"
}
```

- [ ] **Step 2: Translate to es / pt / it / fr**

Add the same keys (with translated copy) to each of the other 4 message files. Keep the placeholder names (`{court}`, `{viewers}`, `{time}`) identical across locales — `next-intl` matches by name.

Suggested translations (verify with native speakers if possible):

**es.json:**
```json
"stream": {
  "live": { "eyebrow": "Ver en vivo", "cta": "Ver en vivo en YouTube", "footer": "Transmisión gratuita en el canal de YouTube de FIP" },
  "archived": { "eyebrow": "Ver repetición", "cta": "Ver repetición en YouTube", "footer": "El partido fue en {court} · busca el inicio en la transmisión" },
  "upcoming": { "eyebrow": "Sintoniza", "cta": "Abrir transmisión de YouTube", "footer": "La transmisión empieza ~10 min antes del primer partido" },
  "channel": { "eyebrow": "Ver en FIP YouTube", "cta": "Abrir canal de FIP", "footer": "No pudimos identificar la transmisión específica — el canal de FIP tiene todos los partidos", "title": "FIP Federación Internacional de Pádel", "meta": "Explora transmisiones en vivo y recientes" },
  "metaLive": "En vivo · {viewers} viendo",
  "metaScheduled": "Programado · empieza a las {time}"
}
```

**pt.json:**
```json
"stream": {
  "live": { "eyebrow": "Assistir ao vivo", "cta": "Assistir ao vivo no YouTube", "footer": "Transmissão gratuita no canal do YouTube da FIP" },
  "archived": { "eyebrow": "Assistir replay", "cta": "Assistir replay no YouTube", "footer": "A partida foi em {court} · procure o início na transmissão" },
  "upcoming": { "eyebrow": "Acompanhe", "cta": "Abrir transmissão do YouTube", "footer": "A transmissão começa ~10 min antes da primeira partida" },
  "channel": { "eyebrow": "Assistir no FIP YouTube", "cta": "Abrir canal da FIP", "footer": "Não conseguimos identificar a transmissão específica — o canal da FIP tem todas as partidas", "title": "FIP Federação Internacional de Padel", "meta": "Explore transmissões ao vivo e recentes" },
  "metaLive": "Ao vivo · {viewers} assistindo",
  "metaScheduled": "Agendado · começa às {time}"
}
```

**it.json:**
```json
"stream": {
  "live": { "eyebrow": "Guarda dal vivo", "cta": "Guarda dal vivo su YouTube", "footer": "Trasmissione gratuita sul canale YouTube FIP" },
  "archived": { "eyebrow": "Guarda il replay", "cta": "Guarda il replay su YouTube", "footer": "La partita era su {court} · cerca l'inizio nello stream" },
  "upcoming": { "eyebrow": "Sintonizzati", "cta": "Apri stream YouTube", "footer": "La trasmissione inizia ~10 min prima della prima partita" },
  "channel": { "eyebrow": "Guarda su FIP YouTube", "cta": "Apri canale FIP", "footer": "Non siamo riusciti a identificare lo stream specifico — il canale FIP ha tutte le partite", "title": "FIP Federazione Internazionale Padel", "meta": "Sfoglia stream live e recenti" },
  "metaLive": "Live · {viewers} stanno guardando",
  "metaScheduled": "Programmata · inizia alle {time}"
}
```

**fr.json:**
```json
"stream": {
  "live": { "eyebrow": "Regarder en direct", "cta": "Regarder en direct sur YouTube", "footer": "Diffusion gratuite sur la chaîne YouTube FIP" },
  "archived": { "eyebrow": "Regarder le replay", "cta": "Regarder le replay sur YouTube", "footer": "Le match était sur {court} · cherchez le début dans la diffusion" },
  "upcoming": { "eyebrow": "Connectez-vous", "cta": "Ouvrir la diffusion YouTube", "footer": "La diffusion commence ~10 min avant le premier match" },
  "channel": { "eyebrow": "Regarder sur FIP YouTube", "cta": "Ouvrir la chaîne FIP", "footer": "Nous n'avons pas pu identifier la diffusion spécifique — la chaîne FIP a tous les matchs", "title": "FIP Fédération Internationale de Padel", "meta": "Parcourez les diffusions en direct et récentes" },
  "metaLive": "En direct · {viewers} regardent",
  "metaScheduled": "Prévu · commence à {time}"
}
```

- [ ] **Step 3: Verify all 5 files parse**

```bash
for f in src/messages/{en,es,pt,it,fr}.json; do python3 -c "import json; json.load(open('$f'))" && echo "OK: $f"; done
```
Expected: 5 lines of `OK: ...`

- [ ] **Step 4: Commit**

```bash
git add src/messages/
git commit -m "i18n(fip-streams): add match.stream.* namespace across 5 locales"
```

---

### Task 13: MatchStreamCard component

**Files:**
- Create: `src/components/MatchStreamCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'
// src/components/MatchStreamCard.tsx
//
// Chunky "Where to watch" card on the match detail page. Renders one
// of four lifecycle states (live / archived / upcoming / channel) based
// on the StreamTier resolved server-side. Mirrors the visual language
// of WhereToWatch.tsx (BG_CARD, CHUNKY clip-paths, ORANGE eyebrow).
//
// Mockup: public/mockup-fip-stream.html (section 2)

import { useTranslations, useFormatter } from 'next-intl'
import type { StreamTier } from '@/lib/fip-stream-resolver'

const ORANGE = '#F5A623'
const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const BG_ELEV = '#1A1A1A'
const MUTED = '#6B7280'
const TEXT_2 = '#B0B5BE'
const BORDER = 'rgba(255,255,255,0.06)'
const CHUNKY_CARD = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

interface Props {
  streamTier: StreamTier
  matchCourt: string | null
  matchScheduledAt: string | null
}

export function MatchStreamCard({ streamTier, matchCourt, matchScheduledAt }: Props) {
  const t = useTranslations('match.stream')
  const format = useFormatter()

  const variant: 'live' | 'archived' | 'upcoming' | 'channel' =
    streamTier.state === 'live' ? 'live'
    : streamTier.state === 'archived' ? 'archived'
    : streamTier.state === 'upcoming' ? 'upcoming'
    : 'channel'

  const eyebrow = t(`${variant}.eyebrow`)
  const cta = t(`${variant}.cta`)

  const footer =
    variant === 'archived' && matchCourt
      ? t('archived.footer', { court: matchCourt })
      : t(`${variant}.footer` as never)

  const ctaBg =
    variant === 'live' ? LIVE_RED
    : variant === 'archived' ? GREEN
    : variant === 'upcoming' ? 'transparent'
    : BG_ELEV
  const ctaColor = variant === 'live' ? '#fff' : variant === 'archived' ? '#0A0A0A' : variant === 'upcoming' ? ORANGE : TEXT_2
  const ctaBorder = variant === 'upcoming' ? `1.5px solid ${ORANGE}` : variant === 'channel' ? `1.5px solid ${BORDER}` : 'none'

  const titleText = streamTier.title ?? (variant === 'channel' ? t('channel.title') : '')
  const metaText =
    variant === 'live' ? t('metaLive', { viewers: streamTier.videoId ? '—' : '' })
    : variant === 'upcoming' && matchScheduledAt
    ? t('metaScheduled', { time: format.dateTime(new Date(matchScheduledAt), { hour: '2-digit', minute: '2-digit' }) })
    : variant === 'channel' ? t('channel.meta') : ''

  return (
    <div
      style={{
        background: BG_CARD,
        border: `1px solid ${variant === 'live' ? 'rgba(255,70,85,0.3)' : BORDER}`,
        clipPath: CHUNKY_CARD,
        padding: '18px 18px 16px',
        marginBottom: 14,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {variant === 'live' && (
        <div style={{
          position: 'absolute', top: -50, right: -50, width: 160, height: 160,
          background: 'radial-gradient(circle, rgba(255,70,85,0.14) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />
      )}

      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: ORANGE, textTransform: 'uppercase' }}>
          {eyebrow}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 88, height: 50, flexShrink: 0, borderRadius: 4,
          background: streamTier.thumbnailUrl
            ? `url(${streamTier.thumbnailUrl}) center/cover`
            : `linear-gradient(135deg, #1F1F1F 0%, #2A2A2A 100%)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          position: 'relative', overflow: 'hidden',
        }}>
          {!streamTier.thumbnailUrl && (
            <svg width={32} height={32} viewBox="0 0 24 24" fill="#FF0000">
              <path d="M23.498 6.186a2.99 2.99 0 0 0-2.103-2.115C19.505 3.546 12 3.546 12 3.546s-7.505 0-9.395.525A2.99 2.99 0 0 0 .502 6.186C0 8.087 0 12 0 12s0 3.913.502 5.814a2.99 2.99 0 0 0 2.103 2.115c1.89.525 9.395.525 9.395.525s7.505 0 9.395-.525a2.99 2.99 0 0 0 2.103-2.115C24 15.913 24 12 24 12s0-3.913-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
            </svg>
          )}
          {variant === 'live' && (
            <span style={{
              position: 'absolute', top: 4, left: 4,
              background: LIVE_RED, color: '#fff', fontSize: 8, fontWeight: 800,
              letterSpacing: 0.5, padding: '2px 5px', clipPath: CHUNKY_BADGE,
            }}>LIVE</span>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700, color: '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            marginBottom: 2,
          }}>{titleText}</div>
          <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.4 }}>{metaText}</div>
        </div>
      </div>

      <a
        href={streamTier.url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          width: '100%', padding: '13px', clipPath: CHUNKY_BADGE,
          background: ctaBg, color: ctaColor, border: ctaBorder,
          fontSize: 13, fontWeight: 800, letterSpacing: 0.6, textTransform: 'uppercase',
          textDecoration: 'none', cursor: 'pointer',
        }}
      >
        {cta}
      </a>

      <div style={{
        fontSize: 11, color: MUTED, marginTop: 10, textAlign: 'center', lineHeight: 1.4,
      }}>
        {footer}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/MatchStreamCard.tsx
git commit -m "feat(fip-streams): MatchStreamCard component with 4 lifecycle states"
```

---

### Task 14: Wire MatchStreamCard into match detail page

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

- [ ] **Step 1: Locate where the page renders score block + tabs**

```bash
grep -n 'MatchStatsView\|score-block\|<Tabs\|stats-tabs' src/app/[locale]/match/[id]/page.tsx
```
Identify the spot between the score block render and the stats tabs.

- [ ] **Step 2: Resolve the stream tier server-side**

Near the top of the component (after the match is fetched), add:

```ts
import { resolveStreamForMatch } from '@/lib/fip-stream-resolver'
import { MatchStreamCard } from '@/components/MatchStreamCard'

// (… existing match fetch …)

const streamTier = await resolveStreamForMatch(supabase, {
  id: match.id,
  tournament_id: match.tournament_id,
  tournament_level: match.tournament?.level ?? null,
  court: match.court,
  scheduled_at: match.scheduled_at,
  played_at: match.played_at ?? null,
}, match.tournament?.name)
```

- [ ] **Step 3: Render the card between the score block and the stats tabs**

Find the JSX boundary between score block (the `<MatchHeader>` / score grid) and the stats/momentum tabs. Insert:

```tsx
{streamTier && (
  <MatchStreamCard
    streamTier={streamTier}
    matchCourt={match.court}
    matchScheduledAt={match.scheduled_at}
  />
)}
```

- [ ] **Step 4: Visual verification**

Open http://localhost:3000/match/<some-fip-match-id>. Confirm: card renders below score block, copy/colors match the mockup for the right lifecycle state, tap on CTA opens YouTube in new tab.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/match/[id]/page.tsx
git commit -m "feat(fip-streams): render MatchStreamCard on match detail page"
```

---

## Phase 6 — Ops UX

### Task 15: Ops API routes (unresolved + resolve + active)

**Files:**
- Create: `src/app/api/ops/fip-streams/unresolved/route.ts`
- Create: `src/app/api/ops/fip-streams/resolve/route.ts`
- Create: `src/app/api/ops/fip-streams/active/route.ts`

- [ ] **Step 1: Write the unresolved listing endpoint**

```ts
// src/app/api/ops/fip-streams/unresolved/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'

export async function GET() {
  const cookie = (await cookies()).get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (cookie !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'token_mismatch' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('fip_streams_unresolved')
    .select('*')
    .is('resolved_at', null)
    .order('first_seen_at', { ascending: false })
    .limit(200)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
```

- [ ] **Step 2: Write the resolve endpoint**

```ts
// src/app/api/ops/fip-streams/resolve/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const cookie = (await cookies()).get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (cookie !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'token_mismatch' }, { status: 401 })
  }

  const body = await req.json() as {
    unresolvedId: string
    tournamentId: string
    court: string
    dayDate: string
  }

  const supabase = createServerClient()

  const { data: unresolved, error: fetchErr } = await supabase
    .from('fip_streams_unresolved')
    .select('*')
    .eq('id', body.unresolvedId)
    .maybeSingle()
  if (fetchErr || !unresolved) {
    return NextResponse.json({ error: fetchErr?.message ?? 'not_found' }, { status: 404 })
  }

  const { error: insertErr } = await supabase.from('fip_court_streams').upsert({
    youtube_video_id: unresolved.youtube_video_id,
    tournament_id: body.tournamentId,
    court: body.court.toLowerCase(),
    day_date: body.dayDate,
    title: unresolved.title,
    thumbnail_url: unresolved.thumbnail_url,
    state: unresolved.state ?? 'archived',
    scheduled_start_at: unresolved.scheduled_start_at,
    link_method: 'manual',
    last_synced_at: new Date().toISOString(),
  }, { onConflict: 'youtube_video_id' })
  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const { error: updateErr } = await supabase
    .from('fip_streams_unresolved')
    .update({
      resolved_at: new Date().toISOString(),
      resolved_tournament_id: body.tournamentId,
      resolved_court: body.court,
      resolved_day_date: body.dayDate,
    })
    .eq('id', body.unresolvedId)
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 3: Write the active streams endpoint**

```ts
// src/app/api/ops/fip-streams/active/route.ts
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createServerClient } from '@/lib/supabase'

export async function GET() {
  const cookie = (await cookies()).get('ops_token')?.value
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'server_misconfigured' }, { status: 401 })
  }
  if (cookie !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'unauth', reason: 'token_mismatch' }, { status: 401 })
  }

  const supabase = createServerClient()
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('fip_court_streams')
    .select('*, tournaments:tournament_id(name, level)')
    .gte('last_synced_at', cutoff)
    .order('last_synced_at', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ items: data ?? [] })
}
```

- [ ] **Step 4: Smoke-test all three**

```bash
# Set ops_token cookie via /ops?token=$CRON_SECRET in your browser first.
curl -sb "ops_token=$CRON_SECRET" http://localhost:3000/api/ops/fip-streams/unresolved | python3 -m json.tool
curl -sb "ops_token=$CRON_SECRET" http://localhost:3000/api/ops/fip-streams/active | python3 -m json.tool
```
Expected: both return `{ items: [...] }`. Resolve endpoint exercised in Task 16.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/ops/fip-streams/
git commit -m "feat(fip-streams): ops API routes (unresolved, resolve, active)"
```

---

### Task 16: FipStreamsTab component

**Files:**
- Create: `src/app/ops/FipStreamsTab.tsx`

- [ ] **Step 1: Write the tab component**

```tsx
'use client'
// src/app/ops/FipStreamsTab.tsx
//
// Two sections: unresolved queue with inline resolve form + active
// streams read-only table. Auth via existing ops_token cookie.

import { useEffect, useState } from 'react'

interface UnresolvedItem {
  id: string
  youtube_video_id: string
  title: string
  thumbnail_url: string | null
  reason: string
  parsed_tournament_name: string | null
  parsed_day: string | null
  parsed_court: string | null
  first_seen_at: string
}

interface ActiveItem {
  youtube_video_id: string
  title: string | null
  court: string
  day_date: string
  state: string
  link_method: string
  view_count: number | null
  tournaments: { name: string; level: string } | null
}

interface TournamentOption {
  id: string
  name: string
  level: string
}

export default function FipStreamsTab() {
  const [unresolved, setUnresolved] = useState<UnresolvedItem[]>([])
  const [active, setActive] = useState<ActiveItem[]>([])
  const [tournaments, setTournaments] = useState<TournamentOption[]>([])
  const [loading, setLoading] = useState(true)

  async function refresh() {
    setLoading(true)
    const [un, ac, tn] = await Promise.all([
      fetch('/api/ops/fip-streams/unresolved').then(r => r.json()),
      fetch('/api/ops/fip-streams/active').then(r => r.json()),
      fetch('/api/ops/search-players?q=&kind=tournaments').then(r => r.json()).catch(() => ({ items: [] })),
    ])
    setUnresolved(un.items ?? [])
    setActive(ac.items ?? [])
    setTournaments(tn.items ?? [])
    setLoading(false)
  }

  useEffect(() => { refresh() }, [])

  async function resolve(item: UnresolvedItem, tournamentId: string, court: string, dayDate: string) {
    const res = await fetch('/api/ops/fip-streams/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unresolvedId: item.id, tournamentId, court, dayDate }),
    })
    if (!res.ok) {
      alert(`Resolve failed: ${(await res.json()).error}`)
      return
    }
    await refresh()
  }

  if (loading) return <div style={{ padding: 16 }}>Loading…</div>

  return (
    <div style={{ padding: 16 }}>
      <h2 style={{ fontSize: 16, fontWeight: 800, marginBottom: 8 }}>
        Unresolved queue ({unresolved.length})
      </h2>
      {unresolved.length === 0 ? (
        <p style={{ color: '#6B7280', fontSize: 13 }}>Empty — all videos auto-matched.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {unresolved.map(item => (
            <UnresolvedRow key={item.id} item={item} tournaments={tournaments} onResolve={resolve} />
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 800, margin: '24px 0 8px' }}>
        Active streams (last 14 days, {active.length})
      </h2>
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#6B7280' }}>
            <th>Title</th><th>Tournament</th><th>Court</th><th>Day</th><th>State</th><th>Method</th><th>Views</th>
          </tr>
        </thead>
        <tbody>
          {active.map(s => (
            <tr key={s.youtube_video_id} style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <td style={{ padding: '6px 8px' }}>
                <a href={`https://www.youtube.com/watch?v=${s.youtube_video_id}`} target="_blank" rel="noopener noreferrer">
                  {s.title ?? s.youtube_video_id}
                </a>
              </td>
              <td>{s.tournaments?.name ?? '—'}</td>
              <td>{s.court}</td>
              <td>{s.day_date}</td>
              <td>{s.state}</td>
              <td>{s.link_method}</td>
              <td>{s.view_count ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function UnresolvedRow({
  item, tournaments, onResolve,
}: {
  item: UnresolvedItem
  tournaments: TournamentOption[]
  onResolve: (item: UnresolvedItem, tid: string, court: string, day: string) => void
}) {
  const [tid, setTid] = useState('')
  const [court, setCourt] = useState(item.parsed_court ?? '')
  const [day, setDay] = useState(item.first_seen_at.slice(0, 10))

  return (
    <div style={{ background: '#141414', padding: 12, borderRadius: 6, border: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
        {item.thumbnail_url && (
          <img src={item.thumbnail_url} alt="" style={{ width: 88, height: 50, borderRadius: 4 }} />
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{item.title}</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>
            Reason: <span style={{ color: '#F5A623' }}>{item.reason}</span>
            {' · '}Parsed: {item.parsed_tournament_name ?? '—'} / day {item.parsed_day ?? '—'} / {item.parsed_court ?? '—'}
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <select value={tid} onChange={e => setTid(e.target.value)} style={{ flex: 1, minWidth: 200 }}>
          <option value="">Pick a tournament…</option>
          {tournaments.map(t => (
            <option key={t.id} value={t.id}>{t.name} ({t.level})</option>
          ))}
        </select>
        <input value={court} onChange={e => setCourt(e.target.value)} placeholder="court (lowercase)" style={{ width: 140 }} />
        <input value={day} onChange={e => setDay(e.target.value)} type="date" />
        <button
          disabled={!tid || !court || !day}
          onClick={() => onResolve(item, tid, court, day)}
          style={{ padding: '6px 12px', background: '#7ED321', color: '#000', fontWeight: 700, border: 0, borderRadius: 4 }}
        >
          Resolve
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/ops/FipStreamsTab.tsx
git commit -m "feat(fip-streams): ops dashboard tab with unresolved queue + active streams"
```

---

### Task 17: Register FipStreamsTab in OpsClient

**Files:**
- Modify: `src/app/ops/OpsClient.tsx`

- [ ] **Step 1: Import the new tab**

Add to the existing imports:
```tsx
import FipStreamsTab from './FipStreamsTab'
```

- [ ] **Step 2: Extend the tab union type**

Find the `useState<...>` line (around line 322 per the codebase exploration) and add `'fip-streams'` to the union:

```tsx
const [tab, setTab] = useState<
  'ongoing' | 'health' | 'data' | 'simulator' | 'players' | 'brands'
  | 'architecture' | 'padelgod-shadow' | 'padelgod-entries'
  | 'tournament-explorer' | 'tournament-dedup' | 'padelgod-health'
  | 'fip-streams'
>('ongoing')
```

- [ ] **Step 3: Add the nav button**

Locate the nav array / loop where existing tab buttons are rendered (search for `{ key: 'players'` or similar). Add:

```tsx
{ key: 'fip-streams' as const, label: 'FIP Streams' },
```

- [ ] **Step 4: Add the render block**

Locate the section where each tab's content is conditionally rendered (search for `{tab === 'players' && <PlayersTab` or similar). Add:

```tsx
{tab === 'fip-streams' && <FipStreamsTab />}
```

- [ ] **Step 5: Smoke-test in browser**

Open http://localhost:3000/ops?token=$CRON_SECRET. Click "FIP Streams" in the tab nav. Verify the unresolved queue + active streams sections render (likely empty until cron has run).

- [ ] **Step 6: Commit**

```bash
git add src/app/ops/OpsClient.tsx
git commit -m "feat(ops): register FipStreamsTab in dashboard nav"
```

---

## Phase 7 — Rollout

### Task 18: Feature flag + dry-run mode

**Files:**
- Modify: `src/app/api/cron/fip-streams-discover/route.ts`
- Modify: `src/app/[locale]/match/[id]/page.tsx`
- Modify: `src/app/[locale]/(app)/matches/[date]/page.tsx`
- Modify: `src/components/MatchCard.tsx`

- [ ] **Step 1: Add `FIP_STREAMS_DRY_RUN` to the cron**

In `src/app/api/cron/fip-streams-discover/route.ts`, wrap each `supabase.from('fip_court_streams').upsert(...)` and `upsertUnresolved(...)` call with a guard:

```ts
const dryRun = process.env.FIP_STREAMS_DRY_RUN === 'true'
// ... in the loop, before the upsert:
if (dryRun) {
  console.log('[fip-streams DRY_RUN] would upsert:', { videoId: d.videoId, tournamentId: tourn.id, court: parsed.court, state: newState })
} else {
  await supabase.from('fip_court_streams').upsert({...})
}
```

Do the same wrap around `upsertUnresolved`.

- [ ] **Step 2: Add `NEXT_PUBLIC_FIP_STREAMS_ENABLED` to the UI**

In `src/components/MatchCard.tsx`, gate the new button:
```tsx
{process.env.NEXT_PUBLIC_FIP_STREAMS_ENABLED === 'true' && match.streamTier && (
  // ... button JSX
)}
```

In `src/app/[locale]/match/[id]/page.tsx`:
```tsx
{process.env.NEXT_PUBLIC_FIP_STREAMS_ENABLED === 'true' && streamTier && (
  <MatchStreamCard ... />
)}
```

In `src/app/[locale]/(app)/matches/[date]/page.tsx`, skip the `resolveStreamsForMatches` call entirely when the flag is off (saves DB load):
```ts
const streamTiers = process.env.NEXT_PUBLIC_FIP_STREAMS_ENABLED === 'true'
  ? await resolveStreamsForMatches(supabase, ..., tournamentNames)
  : new Map<string, null>()
```

- [ ] **Step 3: Document env vars in `.env.example`**

If `.env.example` exists, append:
```
# Feature flags
NEXT_PUBLIC_FIP_STREAMS_ENABLED=false       # Show FIP YouTube stream affordances on match list + detail
FIP_STREAMS_DRY_RUN=false                   # Cron logs upserts without writing to DB
```

If `.env.example` doesn't exist, skip this step.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/fip-streams-discover/route.ts \
        src/app/[locale]/match/[id]/page.tsx \
        src/app/[locale]/\(app\)/matches/[date]/page.tsx \
        src/components/MatchCard.tsx \
        .env.example
git commit -m "feat(fip-streams): feature flag + dry-run env gates"
```

---

### Task 19: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a section documenting the feature**

Find the "Scheduled Jobs (vercel.json)" table and add a row:
```
| `/api/cron/fip-streams-discover` | Every 15 min | Discover FIP YouTube livestreams, write to `fip_court_streams` or queue in `fip_streams_unresolved` |
```

Find a logical spot in the bottom-half "Important Notes" / "Ops toggles" section and add:

```md
## FIP YouTube streams (2026-04-30)

`fip_court_streams` + `fip_streams_unresolved` power the "Where to watch" affordance on FIP-tier match rows (circular YouTube button between names and scores) and on the match detail page (chunky card). Discovery cron `/api/cron/fip-streams-discover` runs every 15 min via the FIP channel's `uploads` playlist (cheap endpoint, ~200 quota units/day). Title parser maps streams to (tournament, court, day); unmatched videos go to the ops queue. Tier fallback: court stream → tournament-scoped channel search → generic FIP channel URL (always works).

Feature flagged behind `NEXT_PUBLIC_FIP_STREAMS_ENABLED`. Cron supports `FIP_STREAMS_DRY_RUN=true` for scan-only mode during initial rollout. Premier Padel matches are unaffected — they still use the existing `WhereToWatch` component.

Spec: `docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md`. Plan: `docs/superpowers/plans/2026-04-30-fip-youtube-streams.md`. Mockup: `public/mockup-fip-stream.html`.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document FIP YouTube streams feature"
```

---

### Task 20: Open the PR

- [ ] **Step 1: Push branch and open PR**

```bash
git push -u origin docs/fip-youtube-streams-design
gh pr create --title "feat(fip-streams): YouTube where-to-watch for FIP-tier matches" --body "$(cat <<'EOF'
## Summary
- New "Where to watch" affordance on FIP-tier matches: circular YouTube button between names and scores on match rows + chunky card on match detail page
- Tier fallback chain: Tier 2 court stream → Tier 3 tournament filter → Tier 4 generic FIP channel (so we always show *something*)
- Discovery cron every 15 min using cheap `playlistItems` endpoint (~200 quota units/day)
- Auto-matcher with ops queue (`fip_streams_unresolved`) for ambiguous titles
- Player-name font reduced to 12px globally on `MatchCard` to relieve horizontal pressure

Premier Padel coverage is unchanged — `WhereToWatch` component handles those.

Spec: `docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md`
Mockup: `public/mockup-fip-stream.html`

## Test plan
- [ ] Migration applied via Supabase dashboard, both tables visible
- [ ] `npx vitest run src/lib/__tests__/fip-stream-title-parser.test.ts` — 9 passing
- [ ] `npx vitest run src/lib/__tests__/fip-stream-resolver.test.ts` — 5 passing
- [ ] Trigger cron locally with `Authorization: Bearer $CRON_SECRET` — response shape correct
- [ ] Visual: insert a manual `fip_court_streams` row, refresh match list → circle button renders, taps to YouTube
- [ ] Visual: same match detail page → chunky card renders correct lifecycle state
- [ ] Ops: `/ops?token=$CRON_SECRET` → "FIP Streams" tab loads, unresolved + active sections render
- [ ] Feature flag off (`NEXT_PUBLIC_FIP_STREAMS_ENABLED=false`) → no UI affordance, no DB load on matches list
- [ ] Dry-run mode (`FIP_STREAMS_DRY_RUN=true`) → cron logs intended upserts, writes nothing

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: PR review + merge**

Wait for review feedback, address comments, merge when approved.

---

## Self-review checklist

After implementing, verify:

- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npx vitest run src/lib/__tests__/fip-stream-*.test.ts` — all green
- [ ] `npm run build` succeeds
- [ ] Cron route returns 401 without auth header, executes with auth
- [ ] Insert one manual row in `fip_court_streams` and verify both UI surfaces (list pill + detail card) render
- [ ] Toggle `NEXT_PUBLIC_FIP_STREAMS_ENABLED=false` and verify all UI affordances disappear
- [ ] Toggle `FIP_STREAMS_DRY_RUN=true` and verify cron logs without writing
- [ ] Open `/ops` "FIP Streams" tab and walk through resolve flow on a fake unresolved row
