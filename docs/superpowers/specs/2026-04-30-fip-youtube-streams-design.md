# FIP YouTube Streams — "Where to Watch" for FIP-tier Matches

**Status:** Design (proposed)
**Author:** Claude (with @GuDenes brainstorming session 2026-04-30)
**Mockup:** [`public/mockup-fip-stream.html`](../../../public/mockup-fip-stream.html)

## 1. Goal

Surface a one-tap path from any FIP-tier match (`fip_bronze | fip_silver | fip_gold | fip_platinum | fip_promises`) to its YouTube livestream or replay, with a graceful fallback chain that always lands the user *somewhere* useful — even when our auto-discovery couldn't pin down the exact court stream.

Premier Padel matches already have this via the existing `WhereToWatch` component (Premier broadcasters API). This feature is **FIP-tier only** and **YouTube-only**.

## 2. Out of scope (v1)

- **Inline YouTube player embed.** Aggregators don't embed third-party players (only rights-holders do). We always deep-link out.
- **Automatic match-start timestamps inside a court livestream.** Computing `match.started_at − stream.actualStartTime` is wrong by 10–30 minutes in practice (pre-roll variance, court-turnover gaps). Manual ops timestamps unlock this later as Tier 1.
- **Chapter-list scraping from VODs.** FIP chapters their archives inconsistently and never with player names. Dead end.
- **Premier Padel.** Covered by existing pipeline.
- **Non-FIP tier YouTube content.** Federation news, training videos, interviews — explicitly filtered out by `liveStreamingDetails` presence.

## 3. UX surfaces

### 3.1 Match-row compact button — Variant C (locked in)

A circular YouTube-action button placed **between the player names and the score column** inside `<MatchCard>`, vertically centered between the two pair rows. 36×36, fully rounded.

- **Live**: red (`--live-red`) with white play triangle, subtle brightness pulse animation
- **Replay**: muted green tint (`rgba(126,211,33,0.16)`) with a replay-circle icon, 1px green border
- **Upcoming / generic fallback**: muted grey, "▶" glyph
- **No stream data**: button is not rendered (existing card layout intact)

**Layout change in `MatchCard.tsx`:** today each pair row is a flex with `[pair-left (flags + name + W badge) | scores]`. We restructure the `.pairs` container into a 3-column flex `[names column | optional circle button | scores column]`, where the names column stacks both pair-lefts and the scores column stacks both score rows. The button is a flex sibling with `align-self: center` and `width/height: 36px`. Same data, internal DOM shape change. No consumers of `<MatchCard>` affected.

**Player-name font reduced to 12px** (was 13px) globally on `MatchCard` to relieve horizontal pressure.

**Tap behavior:** the button is a separate tap target (`<a>` or `<button>` inside the `<Link>` parent). Taps on the button open the YouTube URL in a new tab; taps anywhere else navigate to the match detail page as today.

### 3.2 Match-detail chunky card

A new card on the match detail page, sitting between the score block and the stats tabs. One per match, never multiple. Same component renders four lifecycle states:

| State | Eyebrow | CTA | Footer |
|---|---|---|---|
| **Live** | `▶ WATCH LIVE` | `Watch live on YouTube` (red) | "Streaming free on the FIP YouTube channel" |
| **Finished** | `↻ WATCH REPLAY` | `Watch replay on YouTube` (green) | "Match was on Pista 2 · scrub the stream to find the start" |
| **Upcoming** | `⏱ TUNE IN` | `Open YouTube stream` (orange outline) | "Court livestream goes live ~10 min before first match" |
| **Generic fallback** | `▶ WATCH ON FIP YOUTUBE` | `Open FIP channel` (muted) | "We couldn't pin down this match's stream — the FIP channel has all matches" |

The card includes the YouTube thumbnail, the parsed stream title (e.g., "FIP Silver Mendoza · Day 4 · Centre Court"), and a meta line ("Live now · 4.2K watching" / "8h 14m · 47K views" / "Scheduled · starts at 16:30").

### 3.3 Surfaces NOT modified in v1

- **Tournament page** — Premier-only `WhereToWatch` stays as-is.
- **Daily matches page** — `DailyWhereToWatch` stays as-is.
- **Home page** — no FIP stream surface here in v1.

## 4. Fallback tier chain

The same UI component renders all tiers; copy and target URL degrade with whatever data we have. The user always lands somewhere useful.

| Tier | Source | Target URL example | When |
|---|---|---|---|
| **1** *(future, v1.5)* | Manual ops timestamp inside court VOD | `youtube.com/watch?v=ABC&t=6210s` | When operator has stamped this match's start |
| **2** | Court-level stream from `fip_court_streams` | `youtube.com/watch?v=ABC` | Auto-matched stream for the right court+day |
| **3** | Tournament-level scoped search | `youtube.com/@fip/search?query=Mendoza` | Tournament has streams known on the channel but no court linked for this match |
| **4** | Generic FIP channel | `youtube.com/c/fipinternationalpadelfederation` | No FIP stream data at all — last resort |

Tier resolution happens server-side at query time via a LEFT JOIN to `fip_court_streams`. See §7.

## 5. Data model

Two new tables. Both live in the `public` schema (alongside `tournaments`, `matches`).

### 5.1 `fip_court_streams`

One row per (tournament, court, day, video). Multiple rows allowed for the same court+day (e.g., FIP starts a fresh stream after a tech issue) — app picks the most recent.

```sql
CREATE TABLE fip_court_streams (
  youtube_video_id    TEXT PRIMARY KEY,
  tournament_id       UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  court               TEXT NOT NULL,
  day_date            DATE NOT NULL,
  title               TEXT,
  thumbnail_url       TEXT,
  state               TEXT NOT NULL CHECK (state IN ('upcoming','live','archived')),
  scheduled_start_at  TIMESTAMPTZ,
  actual_start_at     TIMESTAMPTZ,
  actual_end_at       TIMESTAMPTZ,
  view_count          INTEGER,
  concurrent_viewers  INTEGER,
  manual_offset_seconds INTEGER,   -- v1.5: ops-stamped match start within this VOD
  link_method         TEXT NOT NULL CHECK (link_method IN ('auto','manual')),
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fip_court_streams_lookup ON fip_court_streams (tournament_id, court, day_date, state);
```

`manual_offset_seconds` is reserved for the v1.5 manual-timestamp feature; nullable, ignored in v1.

### 5.2 `fip_streams_unresolved`

Sidecar queue mirroring the `match_stats_unresolved` pattern — videos the auto-matcher couldn't link, parked for ops review.

```sql
CREATE TABLE fip_streams_unresolved (
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
CREATE INDEX idx_fip_streams_unresolved_open ON fip_streams_unresolved (resolved_at) WHERE resolved_at IS NULL;
```

### 5.3 No change to `entity_external_ids` sidecar

YouTube `videoId`s are scoped to streams (themselves polymorphic court/day rows), not to a top-level entity like player or tournament. Adding them to the sidecar would bloat lookups for no benefit. Keep them in the dedicated table.

## 6. Discovery cron — `/api/cron/fip-streams-discover`

### 6.1 Schedule

`*/15 * * * *` in `vercel.json` — every 15 minutes. Latency on stream state transitions (upcoming → live, live → archived) is ≤15 min, well under typical match length.

**Tournament-aware short-circuit**: returns early with `{ skipped: 'no_active_tournament' }` if no FIP-tier tournament has `now() BETWEEN starts_at AND ends_at + interval '7 days'`. Saves nothing on quota (already trivial) but keeps the table clean of off-season noise (federation news, training clips).

`PADELAPI_PAUSED=true` does **NOT** gate this cron. YouTube quota is independent of padelapi. The relevant kill-switch (if needed) would be `YOUTUBE_API_KEY` unset, which the cron handles by returning `{ skipped: 'no_api_key' }`.

### 6.2 YouTube API calls

Avoid the expensive `search.list` endpoint (100 quota units/call). Use the channel's `uploads` playlist:

1. `playlistItems.list?playlistId=UU...` — enumerates last 50 uploads on the FIP channel. **Cost: 1 unit.**
2. For unrecognized video IDs: `videos.list?id=...&part=snippet,liveStreamingDetails` — batch up to 50 per call. **Cost: 1 unit per batch.**

Per-run cost: ~2 units in steady state (1 to enumerate the uploads playlist + 1 to fetch details when at least one new video is found; 0 batches when the playlist hasn't changed). Per-day: ~2 units × 96 runs ≈ **200 units/day**. Default YouTube quota is 10,000/day — **50× headroom**.

### 6.3 Filtering

A video qualifies for the streams pipeline if and only if `videos.list` returns a non-null `liveStreamingDetails` object. This excludes:
- Highlights, recaps, interviews, training clips (no `liveStreamingDetails`)
- Premiered uploads that were never live

This is more reliable than title-based filtering.

### 6.4 Title parsing

Stream → (tournament, court, day) mapping comes from the YouTube title. Parser steps in `src/lib/fip-stream-title-parser.ts` (new):

1. **Tier prefix**: regex `/(FIP\s+)?(BRONZE|SILVER|GOLD|PLATINUM|PROMISES)/i` → tier
2. **Day**: regex `/\b(?:DAY|DÍA|D)[\s_-]*(\d+)\b/i` → day number
3. **Court**: tokens after `COURT|PISTA|CENTRE|CENTRAL|CENTER` → court label, normalized via existing court normalization
4. **Tournament tokens**: title minus tier/day/court, fed to the same token-subset matcher used by `merge-tournament-duplicates.ts` against active tournaments
5. **Day date**: stream's `scheduledStartTime` or `actualStartTime` → DATE in tournament's local timezone

If any of (1) (2) (4) fails, the row goes to `fip_streams_unresolved` with `reason='parser_failed'`. If tournament match fails, `reason='no_tournament_match'`. If court extraction fails but tournament is identified, `reason='no_court'` (still useful for ops review).

The parser is a **pure function** (no DB), unit-tested with a fixture set of real FIP titles.

### 6.5 State machine

YouTube `liveStreamingDetails.liveBroadcastContent`:
- `'upcoming'` + `scheduledStartTime` → `state='upcoming'`
- `'live'` + `actualStartTime` → `state='live'`, populate `actual_start_at`
- `'none'` after previously being live (`actualEndTime` present) → `state='archived'`, populate `actual_end_at`

Each cron run upserts every visible stream and updates `last_synced_at`. Streams that disappear from the channel's recent uploads are NOT deleted — they just stop syncing. (Edge case: FIP unlists a video. The card silently breaks. Acceptable for v1.)

### 6.6 Cron response shape

```json
{
  "ok": true,
  "skipped": null,
  "scanned": 50,
  "newly_matched": 4,
  "newly_unresolved": 1,
  "open_unresolved_total": 12,
  "state_transitions": { "upcoming_to_live": 1, "live_to_archived": 2 },
  "ms": 480
}
```

Logged via `logOpsEvent('cron:fip-streams-discover', ...)` — same pattern as other crons.

## 7. Match → stream resolution at render time

Server-side, attached to existing match queries:

```ts
// src/lib/fip-stream-resolver.ts (new)
export type StreamTier = {
  tier: 1 | 2 | 3 | 4
  url: string
  state: 'live' | 'upcoming' | 'archived' | 'channel'
  videoId: string | null
  title: string | null
  thumbnailUrl: string | null
  manualOffsetSeconds: number | null  // v1.5 only
}

export async function resolveStreamForMatch(
  supabase: SupabaseClient,
  match: { id: string; tournament_id: string; tournament_level: string; court: string | null; scheduled_at: string | null; played_at: string | null },
): Promise<StreamTier | null>
```

Logic:
1. If `match.tournament_level` is not in `('fip_bronze',…,'fip_promises','fip_other')` → return `null` (don't render anything).
2. Compute `dayDate` from `scheduled_at` or `played_at` in tournament's local timezone.
3. Query `fip_court_streams` for `(tournament_id, court, day_date)`, ordered by `actual_start_at DESC NULLS LAST`. If a row exists → Tier 2 (or Tier 1 if `manual_offset_seconds IS NOT NULL`).
4. If no court row, query `fip_court_streams` for any `tournament_id`. If any row exists → Tier 3 (scoped search URL).
5. Otherwise → Tier 4 (generic FIP channel URL constant).

Constants (in `src/lib/fip-channel.ts`):
- `FIP_CHANNEL_ID = 'UC...'` (resolve once during implementation)
- `FIP_CHANNEL_URL = 'https://www.youtube.com/c/fipinternationalpadelfederation'`

For the **matches-list page** (a date page), batch-resolve for all FIP-tier matches in one query (single `.in('tournament_id', […])` lookup against `fip_court_streams`).

## 8. Ops UX

### 8.1 New "FIP Streams" tab in `/ops` dashboard

Two sections:

**Unresolved queue** (`fip_streams_unresolved` where `resolved_at IS NULL`)
- One row per video with thumbnail, title, parsed fields, reason
- Inline form: select tournament (dropdown), select court (dropdown of known courts on that tournament), select day_date
- Submit → INSERTs into `fip_court_streams` with `link_method='manual'`, sets `resolved_at`/`resolved_*` fields on the unresolved row

**Active streams** (`fip_court_streams` for tournaments active in last 14 days)
- Read-only table: thumbnail, title, tournament, court, day, state, view_count
- Useful for spot-checking the auto-matcher

Auth follows the existing `ops_token` cookie pattern. New API endpoints:
- `GET  /api/ops/fip-streams/unresolved` — list open queue items
- `POST /api/ops/fip-streams/resolve` — body: `{ unresolvedId, tournamentId, court, dayDate }`
- `GET  /api/ops/fip-streams/active` — list recent active streams

### 8.2 No new ops UX for v1.5 manual timestamps

When that ships, it's an additional inline editor on the active-streams table — operator scrubs the YouTube embed, types in a per-match offset, saves. Out of scope here.

## 9. Telemetry

In `logOpsEvent('cron:fip-streams-discover', ...)` we log:
- `scanned` (videos seen)
- `matched` (auto-linked to tournament+court)
- `unresolved` (queue size after run)
- `state_transitions` (for monitoring stream lifecycle)
- `quota_units_estimated`

For Datadog / dashboard if we add one later, the headline signals are:
- **Unresolved queue depth** — alert if > 20 (operator backlog)
- **Match coverage** — % of FIP-tier matches in the last 24h that resolved to Tier 1/2 vs Tier 3/4 (target: >70% Tier 2 during active tournament weeks)
- **Cron error rate** — same logic as other crons

## 10. Failure modes & graceful degradation

| Failure | Effect | Severity |
|---|---|---|
| `YOUTUBE_API_KEY` unset | Cron skips; existing rows still serve UI | Low (UI degrades to whatever's already in DB) |
| YouTube API quota exhausted | Cron returns 403; no new state updates | Low (existing rows still valid for ~hours) |
| FIP changes channel ID | Zero new streams discovered | Medium (visible drop in unresolved + matched after a few hours; alert worth wiring) |
| Title format changes wildly | Parser flags everything as `parser_failed` | Low (operator queue grows; not user-facing) |
| Stream unlisted mid-day | Card silently 404s when tapped | **Acceptable for v1** — rare, recoverable via re-sync |
| Tournament `level` is `fip_other` | Resolver still attempts (tier whitelist includes it) | Low |

## 11. Future enhancements

- **v1.5 — Manual ops timestamps**. Adds Tier 1 to the chain. Schema is already in place (`manual_offset_seconds`); needs ops UI + a render-time deep-link composer (`?t=NNs`).
- **v2 — Auto chapter detection**. If FIP starts chaptering VODs with player names consistently, scrape `videos.list?part=snippet` description chapters, fuzzy-match each chapter to a match in our DB, populate `manual_offset_seconds` automatically. Replaces the operator queue for stamped matches.
- **v3 — Apply same pattern to other federations**. WPT archives, regional federations. The data model generalizes if we add a `source` column and a per-source channel constant.

## 12. Migration / rollout

1. Migration creates the two tables — zero impact on existing reads.
2. Cron deployed paused (`vercel.json` schedule omitted) until backfill is dry-run reviewed.
3. First production run: scan-only mode (env var `FIP_STREAMS_DRY_RUN=true`) — logs what it WOULD insert, writes nothing. Verify against a live tournament.
4. Flip to write mode. Operator manually clears initial unresolved queue.
5. UI components ship behind a `NEXT_PUBLIC_FIP_STREAMS_ENABLED` feature flag, flipped on after one full tournament week of stable cron operation.
