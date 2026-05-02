@AGENTS.md

# PadelNacho — Padel Live Scores

Mobile-first PWA for real-time padel score tracking, rankings, news, and tournament info. Data sourced from padelapi.org (FIP/Premier Padel).

## Tech Stack

- **Frontend:** Next.js 16.2.0, React 19, Tailwind CSS 4, TypeScript 5
- **Database:** Supabase (PostgreSQL) with Realtime subscriptions
- **Real-time:** Pusher WebSocket (via padelapi.org) → Railway relay → Supabase
- **Deployment:** Vercel (app + cron jobs), Railway (relay service)
- **External APIs:** padelapi.org (matches/players/tournaments), Premier Padel beforeauth API (stats/broadcasters), YouTube Data API, FIP WordPress API, matchscorerlive.com (OOP/draws), Google News RSS, Anthropic Claude API (social drafts + AI dedup)

## Project Structure

```
src/
  app/
    v2/                    # Active UI pages (home, matches, ranking, tournaments, feed)
    match/[id]/            # Match detail + momentum chart
    player/[id]/           # Player profile
    api/
      cron/                # Vercel cron jobs (scores, sync, articles, highlights, rankings, premier-discovery, premier-stats, social-drafts, oop-monitor)
      admin/               # Protected maintenance endpoints (resync, backfill, seed, migrate)
      ops/                 # Ops dashboard APIs (seed-entry-list, parse-draw, seed-draw, schedule-review, duplicate-scan, search-players, players)
      feed/                # Article click tracking, video reporting
      match-stats/         # GET endpoint for the Stats tab (reads from match_stats table)
    components/            # Shared components (MatchCard, CompactMatchCard, BottomNav, Spinner, MatchStatsView, MatchStatsBar, MatchStatsSetTabs)
  lib/
    supabase.ts            # Client factory (browser anon + server service key)
    score-inference.ts     # Final score inference from point data
    player-resolver.ts     # Player deduplication (5-tier: fip_id → external_id → alias → name → fuzzy, auto-stores aliases)
    genius-engine.ts       # PadelGenius game engine: question selection, scoring, difficulty adjustment
    draw-parser.ts         # FIP draw PDF text parser (pure function)
    feed-scoring.ts        # Feed ranking engine (personalization, dedup, quality signals)
    premier-api.ts         # REST client for premierpadel.com beforeauth API (fetch + retry + throttle)
    premier-stats-parser.ts  # Pure parser: PremierMatchDetail → MatchStatsRow[] (tested)
    source-matcher.ts      # Token-subset tournament matcher + round normalizer (tested)
    fip-scraper.ts         # FIP tournament/match scraping + OOP (Order of Play) parser
    external-id-registry.ts  # Unified lookup API for source IDs (hot columns + sidecar)
  data/
    genius-questions.json   # PadelGenius 50-question bank
    genius-avatars.ts       # Avatar definitions (icons, colors, names)
    genius-levels.ts        # Level thresholds and titles
    genius-themes.ts        # Daily theme schedule
  types/
    match.ts               # Core interfaces (Match, Set, Game, Player) + utility functions
  hooks/
    useBookmarks.ts        # localStorage bookmarks (future: Supabase auth)
    useHiddenFeedItems.ts  # localStorage hidden feed items (videos + news)
    useFeedPreferences.ts  # localStorage feed preferences (language, category, channel)
    useInViewOnce.ts       # IntersectionObserver hook for scroll-triggered animations (honors prefers-reduced-motion)
    useGeniusProgress.ts   # PadelGenius localStorage progress (streak, XP, level, avatar)
    useMatchPrediction.ts  # Match prediction localStorage (pair + margin)
relay/
  index.js                 # Railway Node.js service — persistent Pusher WebSocket relay
supabase/
  migrations/              # SQL migrations (applied via Supabase dashboard)
```

## Database Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `matches` | Match data | `padelapi_id` (+`external_id` legacy), `status`, `coverage`, `winner_pair`, `pusher_channel`, `round`, `court` |
| `sets` | Set scores | `match_id`, `set_number`, `set_score`, `pair1_games`, `pair2_games`, `is_current`, `score_source` |
| `games` | Game-level data | `set_id`, `match_id`, `game_number`, `game_score`, `points[]`, `is_current` |
| `players` | Player profiles | `padelapi_id` (+`external_id` legacy), `fip_id`, `name`, `country`, `avatar_url` (Supabase Storage), `ranking`, `category` |
| `tournaments` | Tournament info | `padelapi_id` (+`external_id` legacy), `fip_id` (+`fip_slug` legacy), `name`, `level`, `country`, `logo_url`, `starts_at`, `ends_at`, `source` |
| `seasons` | Season grouping | `external_id`, `name`, `year` |
| `articles` | News feed | `source_url`, `source_name`, `published_at`, `click_count`, `source_weight`, `favicon_url` |
| `highlights` | YouTube videos | `youtube_id`, `channel_name`, `view_count`, `like_count`, `comment_count`, `description`, `channel_quality_score` |
| `tournament_draws` | Parsed draw brackets | `tournament_id`, `category`, `draw_position`, `seed`, `marker`, `player1/2_name`, `player1/2_id` |
| `entity_external_ids` | Sidecar for non-primary source IDs | `entity_type`, `entity_id`, `source`, `external_id`, `metadata` |
| `match_stats` | Per-match + per-set stats (padelapi.org source, cached on first access) | `match_id` + `set_number` (composite PK, `set_number=0` is match aggregate), 34 stat columns (service/return/total), `source`, `source_match_id`, `raw_payload`, `computed_at` |
| `match_stats_unresolved` | Queue for tournaments/matches the auto-matcher couldn't link | `source`, `source_kind`, `source_id`, `source_payload`, `reason`, `resolved_at`, `resolved_match_id`, `resolved_tournament_id` |
| `social_posts` | Auto-generated social media post drafts | `title`, `caption`, `hashtags`, `platform`, `pillar`, `status` (draft/approved/posted), `source_data` |

### Relationships
- `matches` → `tournaments` (via `tournament_id`)
- `sets` → `matches` (via `match_id`)
- `games` → `sets` (via `set_id`) + `matches` (via `match_id`)
- `matches` has 4 player FKs: `pair1_player1_id`, `pair1_player2_id`, `pair2_player1_id`, `pair2_player2_id`

## Data Model: Canonical IDs & Source Identity

PadelNachos aggregates data from multiple upstream sources (padelapi.org, FIP site, YouTube, etc). The schema uses a **"hot columns + sidecar"** pattern to handle identity across sources without sacrificing lookup speed.

### The canonical ID
Every entity (player, tournament, match) has a `id UUID` primary key — that's the **canonical PadelNachos ID**. All foreign keys point at it. External source IDs are secondary identifiers that can be looked up to resolve a canonical `id`.

### Hot columns (top 2 sources)
The top 2 sources have dedicated indexed columns for zero-cost lookups on hot paths:

| Table | Column | Source | Format example |
|---|---|---|---|
| `players` | `padelapi_id` | padelapi.org | `"432"` |
| `players` | `fip_id` | FIP official | `"fip-P200038"` |
| `tournaments` | `padelapi_id` | padelapi.org | `"778"` |
| `tournaments` | `fip_id` | FIP scraper | `"fip-gold-ponta-delgada-2026"` |
| `matches` | `padelapi_id` | padelapi.org | (numeric) |

All hot columns have `UNIQUE` constraints (partial, `WHERE NOT NULL`) and dedicated indexes.

### Legacy columns (deprecated, kept for back-compat)
`players.external_id`, `tournaments.external_id`, `tournaments.fip_slug`, `matches.external_id` still exist and are **kept in sync with the new columns via Postgres triggers**. All existing code paths (40+ call sites) keep working unchanged. New code should write to the new columns; old code can stay as-is until it's touched naturally.

Migration path (for future cleanup, not urgent):
1. Migrate remaining reads to new columns one file at a time
2. Migrate UPSERT `onConflict` targets from `external_id` → `padelapi_id`
3. Ship a "drop legacy columns" migration once all code is clean

### Sidecar: `entity_external_ids`
For **any source beyond the top 2** (ATP, Whoscored, future feeds, etc.), external IDs go into the `entity_external_ids` polymorphic table instead of adding yet another column. Schema:

```sql
entity_external_ids (
  entity_type  TEXT,           -- 'player' | 'tournament' | 'match' | 'season'
  entity_id    UUID,
  source       TEXT,
  external_id  TEXT,
  metadata     JSONB,
  first_seen_at TIMESTAMPTZ,
  last_seen_at  TIMESTAMPTZ,
  UNIQUE (source, entity_type, external_id),
  UNIQUE (entity_type, entity_id, source)
)
```

Adding a new source = zero schema changes.

### Premier Padel source (stats only)

`premierpadel` is a tertiary source added in 2026-04 that provides per-set
service/return/points match statistics. It's scoped to `match.stats` only —
Premier doesn't own any canonical fields like names or rankings.

- **Storage:** `entity_external_ids` sidecar (no hot column)
- **Table:** `match_stats` (composite PK `(match_id, set_number)`)
- **Queue:** `match_stats_unresolved` for manual linking
- **Crons:** `/api/cron/premier-discovery` (weekly) + `/api/cron/premier-stats` (hourly)
- **UI:** `<MatchStatsView>` on the match detail Stats tab
- **Launch:** 2026-04-13 (NewGiza P2)

See `docs/superpowers/specs/2026-04-08-premier-stats-2026-backfill-design.md` and `docs/superpowers/plans/2026-04-08-premier-stats-2026-backfill.md` for design + implementation.

### Unified lookup API — `src/lib/external-id-registry.ts`
Hides the hot-column vs sidecar split so callers don't need to know where each source lives:

```ts
import { findEntityBySourceId, registerSourceId, listSourceIds } from '@/lib/external-id-registry'

// Lookup — works for any source, hot path + sidecar fallback
const playerId = await findEntityBySourceId(supabase, 'player', 'padelapi', '432')      // hot column
const playerId = await findEntityBySourceId(supabase, 'player', 'atp',      'abc-123')  // sidecar

// Register — routes to the right storage automatically
await registerSourceId(supabase, {
  entityType: 'tournament',
  entityId: someUuid,
  source: 'whoscored',
  externalId: 'ws-42',
})

// List all known IDs for an entity (combines hot + sidecar)
const ids = await listSourceIds(supabase, 'player', playerId)
// → [{ source: 'padelapi', externalId: '432', isHot: true }, ...]
```

### Source priority — `src/lib/source-priority.ts`
When multiple sources carry the same field, priority rules decide who wins. These are **code-based config** (not a DB table) because they're data-correctness rules that should go through PR review.

Per-field priority lists (top = most authoritative):

| Field | Primary | Fallbacks |
|---|---|---|
| `player.name` | padelapi | fip, manual |
| `player.ranking` | fip_official | fip, padelapi |
| `player.avatar_url` | padelapi | fip, manual |
| `player.birthdate` | fip | padelapi, manual |
| `tournament.name` | padelapi | fip, manual |
| `tournament.logo_url` | fip | padelapi, manual |
| `tournament.draw_size_md` | fip | padelapi |
| `tournament.prize_money` | padelapi | manual |
| `match.sets` | padelapi | simulated (fip NOT listed — no live scoring) |
| `match.status` | padelapi | simulated |

Full list in `src/lib/source-priority.ts`. Helpers:
- `shouldOverwrite(field, currentSource, attemptingSource)` — runtime gate (needs per-field source tracking columns, not used yet)
- `isPrimaryOwner(field, source)` — is this source the top of the list?
- `filterUpdateByPriority(payload, entityType, source, mode)` — strip fields a source can't own from an update payload

**Sync jobs should use `filterUpdateByPriority` when updating existing rows** so secondary sources can't clobber primary data. The padelgod `fip-event-page-enricher` worker is the canonical example (retired Vercel route: `src/app/api/cron/fip-tournaments/route.ts` → 410 Gone since 2026-04-28).

### Tournament entity resolution (cross-source dedup)
Same real-world tournament can exist under multiple sources with different IDs + names. Matching rule used by the defending-champion lookup, Phase 2 dedup script, and any future merging tool:

1. **Normalize name**: strip diacritics, strip 4-digit years, lowercase, split on non-alphanumerics
2. **Filter noise tokens**: drop `premier`, `padel`, `tour`, `open`, `season`, `championship`, etc.
3. **Token subset match**: candidate matches when every current token is present in the candidate's token set (handles sponsor prefixes like "Motorola Razr Miami Premier Padel P1" matching "Miami P1 2026")
4. **Same year**: year from `starts_at` must match
5. **Same level**: `level` column must match (prevents cross-tier matches)

Script: `scripts/merge-tournament-duplicates.ts` — supports `--dry-run` and does a pre-flight FK check before deleting anything.

## Scheduled Jobs (vercel.json)

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/scores` | Every 2 min | Poll live matches, upsert scores, reconcile finished matches, detect stale |
| `/api/cron/sync?scope=matches` | Hourly at :00 | Sync match metadata for active tournaments |
| `/api/cron/sync` | Mon 4am UTC | Full sync: tournaments, players, seasons, FIP logos |
| `/api/cron/sync-fip-rankings` | Daily 5am UTC | FIP official + race rankings (top 1000, both genders) |
| `/api/cron/sync-articles` | Hourly at :40 | News from RSS feeds + FIP WordPress API |
| `/api/cron/sync-highlights` | Hourly at :20 | YouTube highlights from padel channels |
| `/api/cron/fip-streams-discover` | Every 15 min | Discover FIP YouTube livestreams, write to `fip_court_streams` or queue in `fip_streams_unresolved` |
| `/api/cron/premier-discovery` | Mon 4am UTC | Link Premier tournaments + matches to our DB |
| `/api/cron/premier-stats` | Hourly at :13 | Sync per-set stats from Premier Padel API |
| `/api/cron/social-drafts` | Mon 8am UTC | Generate social media post drafts via Claude API → `social_posts` table |
| `/api/cron/oop-monitor` | Every 2h at :30 | Monitor Order of Play changes on matchscorerlive.com for active tournaments |

## Padelgod Workers (Railway)

Padelgod runs on Railway alongside the relay service. The schedule lives
in [`padelgod/src/scheduler.ts`](padelgod/src/scheduler.ts) — each worker
gets its own `:MM` slot to avoid contention on the FIP / matchscorerlive
endpoints. Read that file for the canonical schedule when this table
goes stale (which it will).

Ordered by `:MM` so the hourly chain is easier to follow:

| Worker | Schedule | Purpose | Writes to |
|---|---|---|---|
| tournament-discovery | hourly :00 | Discover FIP tournaments via WP API + resolve country term IDs | `tournaments` |
| fip-winner-propagator | hourly :02 | Propagate finished-match winners to next-round bracket slots | `matches` |
| fip-event-page-enricher | hourly :12 | Gap-fill venue / dates / overview / draw size / matchscorer code | `tournaments`, `padelgod.widget_id_cache` |
| widget-code-lookup | hourly :15 | Resolve Crionet widget IDs by tournament name search | `padelgod.widget_id_cache` |
| draw-fetcher | every 2h :20 | Crionet bracket scrape | `padelgod.draw_snapshots` |
| match-stats-fetcher | hourly :25 | Per-match stats from Crionet widget | `match_stats` |
| player-profile | hourly :30 | Refresh per-player profile metadata | `players` |
| static-reconciler | :05, :35 | Consume snapshots → `public.matches` / `sets` (twice hourly) | `matches`, `sets` |
| fip-draw-fetcher | hourly :35 | FIP event-page bracket scrape (Bronze/Silver/Gold/Premier) | `padelgod.draw_snapshots` |
| shadow-diff-finalizer | :10, :40 | Finalize live-vs-padelapi divergence rows for telemetry | (telemetry tables) |
| fip-draw-linker | hourly :42 | Link FIP draws to widget IDs (DB-only, no HTTP) | `entity_external_ids` |
| entry-list-fetcher | hourly :45 | Fetch tournament entry-list PDFs / pages | `padelgod.entry_list_snapshots` |
| fip-entry-list-populator | hourly :46 | Resolve entry-list rows into `players` (after fetcher) | `players` |
| fip-draw-populator | hourly :47 | INSERT `public.matches` from draw + OOP qualifying rounds | `matches` |
| oop-fetcher | every 15m :00/:15/:30/:45 | Capture Order of Play snapshots from matchscorerlive | `padelgod.oop_snapshots` |
| fip-oop-writer | every 15m :02/:17/:32/:47 | UPDATE `public.matches` court/round from OOP snapshots | `matches` (UPDATE) |
| results-fetcher | every 5m :00/:05/... | Capture match-results snapshots from Crionet widget | `padelgod.results_snapshots` |
| fip-results-writer | every 5m :02/:07/... | Write final scores from results snapshots | `matches`, `sets` |
| player-rankings | daily 05:00 UTC | Sync FIP race + official rankings (top 1000, both genders) | `players` |
| live-poller-manager | every 1m | Spawn / supervise per-match live-poll loops | (orchestration only) |
| shadow-diff-live | every 1m | Snapshot live-match latency vs padelapi for telemetry | (telemetry) |
| close-stale-live-sweeper | every 5m | Close matches stuck at `live`/`ended` when poller can't | `matches` |

### Disambiguating "OOP" — three different things

The OOP (Order of Play) responsibility is split across three crons in
two different runtimes. The names are similar enough that they get
confused at a glance — the table below is the canonical mapping:

| Name | Runtime | Schedule | What it does |
|---|---|---|---|
| `oop-monitor` | Vercel cron | every 2h :30 | Watches matchscorerlive for OOP page changes, emits notifications |
| `oop-fetcher` | Padelgod (Railway) | every 15m | Fetches OOP HTML, parses it, writes `padelgod.oop_snapshots` |
| `fip-oop-writer` | Padelgod (Railway) | every 15m (offset +2) | Reads snapshots, UPDATEs court / round / court_order on `public.matches` |

The "OOP Schedule Review" tab in the ops dashboard is yet another piece
of the same puzzle — a human-in-the-loop UI that parses the
`scheduled_label` strings from `oop_snapshots` ("Starting at 2:30 PM")
into UTC timestamps on `public.matches.scheduled_at`. Not an automated
worker; an operator clicks "Apply N Changes" per tournament.

## Relay Service (Railway)

`relay/index.js` — always-on Node.js/Express service (port 3001):
- Persistent Pusher WebSocket → subscribes to `matches.{id}` channels
- Writes point-by-point updates to Supabase on every Pusher event
- On match finish: fetches final state from API, infers missing scores, computes coverage, infers winner
- Endpoints: `GET /health`, `POST /sync`, `POST /subscribe`

## Key Patterns

### Score Provenance
Sets track `score_source`: `'api'` (authoritative) > `'inferred'` (from points) > `'live'` (real-time relay). Higher priority overwrites lower.

### Points Merge Guard
Before writing a points array, check if existing DB array is longer — keep the longer one. Never overwrite with less data.

### Match Status Lifecycle
`scheduled` → `live` → `ended` (transitional, score may be null) → `finished`

### Coverage Computation
Computed from actual stored data after match finishes: count games with non-empty points vs expected games from set scores. Result: `full`, `partial`, or `null`.

### Winner Inference
When API doesn't provide `winner_pair`, infer from completed set scores (best-of-3, first to 2 sets). See `src/lib/score-inference.ts`.

### Stale Match Detection
Cron detects matches stuck as `live` in DB >15min and absent from API live feed — transitions them to finished.

### Feed Scoring & Personalization
Feed ranking in `src/lib/feed-scoring.ts` combines multiple signals:
- **Base score**: `freshness (exp decay over 48h) * popularity (log10 clicks) * source_weight`
- **Stale year penalty**: titles mentioning old years get 0.3x–0.7x
- **Language affinity**: boosts articles in user's preferred language (up to 1.3x, needs 3+ clicks)
- **Category preference**: boosts men's/women's content based on click history (1.3x/0.7x, needs 5+ clicks with >65% dominance)
- **Channel engagement**: boosts channels user watches (1.15x–1.3x after 3+ plays)
- **Bookmark relevance**: boosts content mentioning players from bookmarked matches (1.4x–1.8x)
- **Channel quality**: server-computed from YouTube engagement rate + priority channel status
- **Title-based dedup**: clusters items with >50% token overlap, shows best one with "+N similar" collapsed

User preferences tracked in localStorage via `useFeedPreferences` hook. Hidden items via `useHiddenFeedItems` hook — shared across feed page and home carousel.

### Avatar Hosting
Player avatars hosted on Supabase Storage (bucket: `avatars`), not proxied from external sources. Migration done via `/api/admin/migrate-avatars`.

### Player Name Aliases
When `PlayerResolver` matches a player via fuzzy match (token similarity ≥ 0.7), it auto-stores the raw name variant as an alias in `entity_external_ids` (source='alias'). Future lookups for the same variant hit the alias cache instantly instead of scanning all players. The `players` table also has a `normalized_name` column (indexed, auto-populated by trigger using `unaccent` extension).

### Scheduled Time Pipeline
Match schedule times come from multiple sources with different quality:
1. **PadelAPI** provides `played_at` (date-only, e.g. "2026-04-14") and optional `schedule_label` (e.g. "Starting at 4:00 PM")
2. **OOP Schedule Review** (ops dashboard) parses times from matchscorerlive.com Order of Play widget and writes proper UTC timestamps
3. **Sync cron protection**: when PadelAPI only has a date-only value, the sync cron will NOT overwrite `scheduled_at` if it already has a real time (set via OOP). This prevents hourly syncs from erasing operator-reviewed times.
4. **"Followed by" estimation**: OOP matches with "Followed by" get estimated as previous match + 90 minutes.
5. **Display**: approximate times (from "Not before" or "Followed by") show `*` suffix in the UI.

### Next.js 16 Proxy (formerly Middleware)
Next.js 16 deprecated `middleware.ts` → renamed to `proxy.ts` with `export function proxy()`. The file at `src/proxy.ts` handles redirects, auth, geo-country cookies, and invite ref capture. Old `src/middleware.ts.deprecated` kept for reference.

### Ops Dashboard Tabs
The ops dashboard (`/ops`) has these tabs: Ongoing Events, Integration Health, Data Quality, Readiness, Entry Lists, Draw Editor, Simulator, Players, Schedule, Architecture. Key additions:
- **Players**: Search + edit + merge + duplicate scan (rules-based + AI-powered via Claude)
- **Schedule**: OOP-based schedule review with human-in-the-loop approval
- **Architecture**: Live SVG system diagram showing all 15 data integrations

### Scroll-Triggered Animations
Stat bars across the app (match stats, player profile win-rate bars, Last 10 sparkline, Season monthly chart) use a shared animation pattern driven by `src/hooks/useInViewOnce.ts`:

- **Trigger:** `IntersectionObserver` on a row ref, fires once when the row enters the viewport (never replays)
- **Duration:** 700ms
- **Easing:** `cubic-bezier(0.25, 0.1, 0.25, 1)` (ease-out cubic)
- **Row stagger:** `${rowIndex * 80}ms` delay — cascading wave
- **Transform:** `scaleX` (horizontal bars, grows from center or left edge) or `scaleY` (vertical bars, grows from bottom)
- **Transform origin:** `right center` / `left center` / `bottom center` depending on bar direction
- **Fallback:** `prefers-reduced-motion: reduce` skips animation (instant final state)
- **Fallback:** missing `IntersectionObserver` (old browsers) also skips animation

When adding new stat visualizations, reuse this pattern — don't introduce a new animation library. Example usage:

```tsx
import { useRef } from 'react'
import { useInViewOnce } from '@/hooks/useInViewOnce'

function MyBar({ value, rowIndex }: { value: number; rowIndex: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInViewOnce(ref)
  return (
    <div ref={ref} style={{ width: 100, background: 'rgba(255,255,255,0.05)' }}>
      <div style={{
        width: `${value}%`,
        background: '#7ed321',
        transformOrigin: 'left center',
        transform: inView ? 'scaleX(1)' : 'scaleX(0)',
        transition: `transform 700ms cubic-bezier(0.25, 0.1, 0.25, 1) ${rowIndex * 80}ms`,
      }} />
    </div>
  )
}
```

## Environment Variables

```
# Public (browser-safe)
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY

# Server-only
SUPABASE_SERVICE_KEY          # Full DB access (bypasses RLS)
PADELAPI_TOKEN                # padelapi.org API key
CRON_SECRET                   # Protects admin/cron endpoints
RELAY_SECRET                  # Relay authentication
RELAY_URL                     # Railway relay URL
YOUTUBE_API_KEY               # YouTube Data API (highlights sync)
```

## Commands

```bash
npm run dev          # Dev server (localhost:3002)
npm run build        # Production build
npm run lint         # ESLint
npx vitest run src/lib/__tests__/score-inference.test.ts  # Unit tests
```

### Historical Backfill (4-day plan)

Backfills all tournament + match data from padelapi.org. Budget: 2,000 requests/day, ~8,000 total over 4 days. Auto-stops at budget and resumes where it left off the next day.

```bash
# Dry run — see what needs syncing (no API calls)
curl -s "http://localhost:3002/api/admin/backfill-matches" | python3 -m json.tool

# Run backfill (stops at 2,000 requests, resume next day)
curl -s "http://localhost:3002/api/admin/backfill-matches?run=true"

# Filter by season or tournament
curl -s "http://localhost:3002/api/admin/backfill-matches?run=true&season=4"
curl -s "http://localhost:3002/api/admin/backfill-matches?run=true&tournament=727"

# Skip point-by-point data (faster, less detail)
curl -s "http://localhost:3002/api/admin/backfill-matches?run=true&skip_pbp=true"
```

### Other Admin Commands

```bash
# Seed a single tournament
curl -s "http://localhost:3002/api/admin/seed-tournament?tournament=727" | python3 -m json.tool

# Resync recent matches
curl -s "http://localhost:3002/api/admin/resync" | python3 -m json.tool

# Trigger cron manually (production)
curl -H "Authorization: Bearer $CRON_SECRET" https://padel-nacho.vercel.app/api/cron/scores
```

## Rate Limits

padelapi.org: 10 req/min, 2,000 req/day, 50,000 req/month. Score Agent tracks request count per run (max 60).

## FIP Draw Pipeline (branch: claude/elated-almeida)

Eliminates TBD player names on FIP tournament matches. Two subsystems:

### PlayerResolver improvements (`src/lib/player-resolver.ts`)
- Resolution chain: fip_id → external_id → normalized name + category (with ranking/points disambiguation) → fuzzy match (0.7 threshold)
- CachedPlayer includes `ranking` and `points` for disambiguation
- `tokenSimilarity` exported for FIP scraper draw lookup
- Fallback queries fetch `ranking, points` columns; cache updated after enrichment

### Draw PDF pipeline
- **Parser** (`src/lib/draw-parser.ts`): Pure function parsing FIP draw PDF text into structured bracket data with seeds, Q/WC/LL markers, name conversion (LASTNAME, Firstname → Firstname Lastname)
- **Parse API** (`src/app/api/ops/parse-draw/route.ts`): PDF upload → pdf-parse text extraction → parseDrawText
- **Seed API** (`src/app/api/ops/seed-draw/route.ts`): Stores parsed bracket in `tournament_draws`, resolves players via PlayerResolver
- **FIP scraper integration** (`src/app/api/cron/fip-scores/route.ts`): Loads `tournament_draws` at cron start, checks draws first (tokenSimilarity >= 0.7) before falling back to PlayerResolver
- **Ops UI** (`src/app/ops/EntryListTab.tsx`): Draw upload section with file picker, preview table, seed confirmation. EL/DR badges on tournament selector.

### New DB table: `tournament_draws`
- Migration: `supabase/migrations/20260402_tournament_draws.sql`
- Columns: tournament_id, category, draw_position, seed, marker (Q/WC/LL), player1/2_name, player1/2_country, player1/2_id, team_points
- Unique constraint: (tournament_id, category, draw_position)

### Auth pattern for ops API routes
- Middleware (`src/middleware.ts`) sets httpOnly `ops_token` cookie on `/ops?token=<CRON_SECRET>` login
- All `/api/ops/*` routes read the cookie via `cookies()` and compare to `CRON_SECRET` env var
- 401 responses include `reason` field: `server_misconfigured` (CRON_SECRET not set) or `token_mismatch` (cookie invalid)

### Current status (as of 2026-04-02)
- All 11 implementation tasks complete, code merged and deployed to Vercel
- **Draw parser fix deployed**: Removed overly broad `\d+\s*$` from BRACKET_END_RE that stopped parsing on standalone seed numbers from PDF extraction
- **Tests**: draw-parser (14), player-resolver (10), entry-list-parser (10) — all passing
- **Known issue — 401 on ops dashboard**: After deploy, `/api/ops/seed-entry-list?action=list-tournaments` returns 401. Diagnostic logging added. To debug: check if error says `server_misconfigured` (CRON_SECRET not in Vercel env vars) or `token_mismatch` (re-login via `/ops?token=<secret>`). Check Vercel function logs.
- **Pending**: After 401 is fixed, re-upload both draw PDFs (men MD-v4, women WD-v3) for FIP Gold Almaty. Then trigger fip-scores cron to backfill player IDs on 68 existing matches (all currently have null player IDs because old cron ran before deploy).
- **Test tournament**: FIP Gold Almaty (ID: `d3d73d56-eea4-4ebb-8715-58fa87751a52`). Entry lists seeded (men 78 players, women 56). 68 matches (36 men, 32 women).
- **Pre-existing test failures**: 5 parseWpEvent tests expect 'Gold'/'Silver'/'Bronze' but implementation returns 'fip_gold'/'fip_other' — NOT related to this work.

### Config notes
- `next.config.ts`: `serverExternalPackages: ['pdf-parse']` required for pdf-parse in API routes
- `package.json`: pdf-parse ^2.4.5 (dependency), vitest ^4.1.2 (devDependency)

## Important Notes

- Tournament `status` column DOES exist (populated by Vercel sync from padelapi: `'pending'`, `'live'`, `'finished'`). It's a coarse calendar-window signal, NOT a "matches are being played right now" signal — see "Tournament-pill / live-state policy (2026-04-30)" below for the trust hierarchy.
- `category` field on matches distinguishes `'men'` vs `'women'`
- Middleware injects `geo-country` cookie from Vercel's `x-vercel-ip-country` header
- `next.config.ts` allows remote images from `storage.googleapis.com` and `jwqaesjjoghzobngxejn.supabase.co`
- Admin endpoints require `Authorization: Bearer {CRON_SECRET}` header

## i18n (Internationalization)

- **Library:** `next-intl` with Next.js 16 App Router
- **Locales:** `en` (default), `es`, `pt`, `it`, `fr`
- **Config:** `src/i18n/routing.ts` (defineRouting), `src/i18n/request.ts` (server messages), `src/i18n/navigation.ts` (locale-aware Link/useRouter/usePathname)
- **Messages:** `src/messages/{en,es,pt,it,fr}.json` (~200 keys each)
- **Folder structure:** All user-facing pages under `src/app/[locale]/`. API, ops, auth routes stay outside.
- **Proxy:** `src/proxy.ts` composes next-intl middleware with auth/redirect/cookie logic. `/auth`, `/ops`, `/admin`, `/api` skip i18n routing.
- **Prefix:** `localePrefix: 'as-needed'` — no prefix for English, `/es/` etc. for others
- **Switcher:** `src/components/LocaleSwitcher.tsx` — circular flag button with dropdown picker. In profile page (direction=up) and login sheet (direction=down).
- **Imports:** All user-facing files use `import { Link, useRouter, usePathname } from '@/i18n/navigation'` instead of `next/link` and `next/navigation`.

## Equipment Database (2026-04-13)

Four tables for structured padel equipment tracking:
- `padel_brands` — brand entity (name, logo_url, website_url)
- `padel_rackets` — racket entity (brand FK, model, year, shape, weight, balance, surface, image_url, product_url, click_count)
- `player_equipment` — junction table with history (player FK, racket FK, started_at, ended_at)
- `racket_clicks` — affiliate click tracking (racket FK, player FK, user FK, created_at)

APIs: `/api/ops/brands`, `/api/ops/rackets`, `/api/ops/player-equipment`, `/api/racket-click`
Ops tab: "Brands & Equipment" in ops dashboard for brand/racket CRUD
Player profile: "Plays with" widget reads from joined tables with JSONB fallback

## Score Pipeline Guards (2026-04-13)

Critical fixes to prevent data loss in the scores cron:
1. **Guard:** `upsertMatch` skips matches already `finished`/`retired`/`walkover` in DB (stale live feed protection)
2. **Guard:** Don't regress `ended` back to `live`
3. **Live fallback:** `writeFinalState` falls back to `/api/matches/{id}/live` when detail endpoint returns `score: null`
4. **No orphan deletion:** Only delete null-score sets when replacement data exists
5. **Write all sets:** Removed filter that skipped sets without `set_score`
6. **Retirement inference:** `inferWinnerPair` handles 1-set retirements and mid-Set-3 retirements
7. **Auto-transition:** `inferWinnerPair` atomically sets `status: 'finished'` when winner is inferred

### Backlog: PBP Backfill
`backfillPointData` function exists in scores cron but the sweep query has a PostgREST syntax bug. Spec at `docs/superpowers/specs/2026-04-13-pbp-backfill-design.md`.

## Score Pipeline Fixes (2026-04-14)

1. **Relay: derive set_score** — When API returns `set_score: null` on finish but has `pair1_games`/`pair2_games`, relay now computes the score string (e.g. "6-3") instead of skipping the set
2. **Relay: is_current on finish** — All sets get `is_current: false` when match status is finished/ended
3. **Preserve retired/walkover status** — `writeFinalState` and `inferWinnerPair` no longer hardcode `status: 'finished'`. They preserve `retired`/`walkover` from the API, so the UI "RET" badge renders correctly

## Timezone Display (2026-04-14)

All match/tournament times display in the **user's local timezone** (not UTC, not tournament tz).
- `src/proxy.ts` sets `geo-timezone` cookie from Vercel's `x-vercel-ip-timezone` header
- `src/i18n/request.ts` reads cookie, passes `timeZone` to next-intl config
- `src/lib/format-patterns.ts` — shared format constants (TIME_24H, DATE_SHORT, etc.)
- All `format.dateTime()` calls auto-use the user's timezone globally

## SEO (2026-04-14)

- **Dynamic sitemap** (`src/app/sitemap.ts`) — tournaments, matches (90 days), players
- **JSON-LD** — `SportsEvent` on match/tournament pages, `Person` on player pages
- **generateMetadata** — dynamic titles/descriptions for tournament, player, home pages
- **Canonical + hreflang** — all layouts include canonical URLs and alternates for 5 locales
- **About page** — `/about` with i18n, chunky design, brand story

## Match Stats from PadelAPI (2026-04-14)

- `/api/match-stats` fetches from `padelapi.org/api/matches/{id}/stats` (no Premier Padel pipeline needed)
- On-demand fetch + DB cache in `match_stats` table
- Maps percentage strings to value/100 format for existing MatchStatsBar UI
- Available for any match with a `padelapi_id` (~6,500 matches)

## Supabase Soft Recovery (2026-04-14)

When the Supabase auth client gets wedged after tab idle:
1. `supabase-health.ts` tries **soft recovery** before hard reload: restarts auth ticker → re-sets session from localStorage → re-probes
2. `useWakeRefresh.ts` proactively calls `startAutoRefresh()` on tab wake
3. **Click-triggered recovery** — on first click after tab wake, a quick probe runs. If it fails, soft recovery triggers immediately

## Ops Players Tab Redesign (2026-04-14)

Decomposed 1,350-line monolith into 5 components under `src/app/ops/players/`:
- `PlayersTable.tsx` — checkboxes, completeness dots, avatar+flag, pagination
- `FilterChips.tsx` — All, Missing Equipment/Avatar/Ranking + Men/Women with counts
- `BulkActionsBar.tsx` — multi-select + bulk equipment assignment modal
- `PlayerDrawer.tsx` — right overlay drawer with tabbed edit form
- `types.ts` — shared types and `computeCompleteness()`

Search API (`/api/ops/search-players`) updated with pagination + filter params.

## Racket Enrichment Scripts (2026-04-14)

- `scripts/enrich-brand-logos.ts` — populates brand logos from Brandfetch CDN
- `scripts/enrich-racket-specs.ts` — uses Claude Sonnet + web search to extract specs
- Ops "Import from URL" — paste product page URL, Claude Haiku extracts specs into form

## OOP Parser Fix (2026-04-14)

Player regex in `parseOopHtml()` required flag image as anchor. Players without country flag (e.g. Sharifova) were skipped → match dropped. Fixed by making flag optional.

## Ops toggles

### `PADELAPI_PAUSED` — kill-switch for external-source crons (2026-04-22)

When set to `'true'` in Vercel env vars, the following cron routes return early with `{ paused: true }` and do **zero work** — no padelapi calls, no DB writes:

- `/api/cron/scores` — every 2 min
- `/api/cron/sync` — hourly at :00 + weekly
- `/api/cron/premier-stats` — hourly at :13
- `/api/cron/premier-discovery` — weekly

Use when padelapi's writes are fighting manual SQL patches or padelgod's `closeMatch` logic during an incident (e.g., the 2026-04-22 Brussels P2 debugging session where padelapi's `'live' → 'ended'` transient was stomping our recovery). Toggle via Vercel env vars — no deploy needed (Vercel restarts the function when env vars change).

Not guarded (these don't consume padelapi/Premier): `sync-fip-rankings` (FIP-sourced), `sync-articles`, `sync-highlights`, `social-drafts`, `oop-monitor`, `fip-scores`, `nacho-health`, `editorial-gen`, `sync-broadcasters`, `quality-scores`. (`fip-tournaments` retired 2026-04-28 — moved to padelgod workers.)

Padelgod workers on Railway are unaffected — they don't read this env var.

Implementation: `src/lib/padelapi-pause.ts` exports `padelapiPausedResponse(cronName)`, called right after the `CRON_SECRET` auth check in each guarded route.

## Welcome email (2026-04-23)

Auth signup sends a localized welcome email. All 5 locales covered (en/es/pt/it/fr).

- **Capture:** `src/auth.ts` `events.createUser` reads `NEXT_LOCALE` cookie (set by next-intl's proxy) and persists to `profiles.locale`. Migration: `supabase/migrations/20260423000004_profiles_locale.sql` — `locale text NOT NULL DEFAULT 'en'` + CHECK constraint for the 5 supported locales.
- **Sender:** `src/lib/email/welcome.ts` — framework-agnostic, uses next-intl's `createTranslator` with all 5 locale JSONs imported inline. Fire-and-forget from `createUser` (never blocks signup). Resend `idempotencyKey = welcome-<email>-<locale>` guards against retries.
- **Templates:** translations live in `src/messages/{en,es,pt,it,fr}.json` under `email.welcome.*` namespace. Styling matches the magic-link email (#7ED321 CTA, logo header, pill layout).
- **Preview:** `GET /api/admin/preview-welcome-email` renders the exact HTML Resend would deliver, no real send. Index page lists all 5 locales; `?locale=es&name=Lia` renders one. Auth: `ops_token` cookie (ops login) or `Authorization: Bearer $CRON_SECRET` header. Exported `buildWelcomeEmail()` from `src/lib/email/welcome.ts` so preview + sender share identical render logic.
- **Typing gotcha for future email templates:** when importing JSON messages for `createTranslator`, use `satisfies Record<Locale, unknown>` on the map — NOT `Record<string, Record<string, unknown>>`. The latter widens the literal types and next-intl's `NamespaceKeys` inference collapses to `never`.

## Match-identifier pair sanity check (2026-04-23)

`padelgod/src/lib/match-identifier.ts::findPadelapiTwin` now filters court-matched candidates through `pairsMatchUnordered` when the widget input carries all four player UUIDs. Guards against last-minute court swaps — if padelapi holds a stale court for the actual live match, the court-only lookup would hijack whatever unrelated match happens to be stored on the live court. With the pair check, mismatched twins are rejected and `findByPairs` (court-agnostic) runs next.

- **Incident:** Brussels P2 women R16 2026-04-23. Caldera/Goenaga moved from Nextensa → CBC last-minute. Widget WD011 landed on Triay/Brea (the next CBC slot, 2h later) instead of Caldera. UI showed Triay/Brea as live with Caldera's score data.
- **Premier unaffected:** Premier live-poller path doesn't populate pair UUIDs → pair check is skipped → behaves exactly as before.
- **Monitoring:** `"match-identifier: all padelapi twins on this court rejected by pair mismatch — falling through to pair-based lookup (likely court swap)"` warn log is the signal the fix fired.
- **Manual hotfix pattern** when a widget mapping is wrong: (1) reset the wrongly-flipped match's `status` back to `scheduled` + delete phantom sets/games, (2) delete the bad `entity_external_ids` mapping, (3) update the right match's `court` to match reality. Padelgod re-links within ~80s via the next live-poll.

## PostgREST 1k cap (2026-04-29)

PostgREST silently caps single-request responses at the project's `db_max_rows` setting. **Our project bumped to 10,000 on 2026-04-29** (Project Settings → API → "Max Rows") after the Leiria FIP Silver incident: 5,369 entry_list_snapshots, women's roster fell past the 1000-row default cap, every women's match silently failed to resolve in the populator. No error was raised — Supabase returns the truncated dataset as if it were complete.

### Project policy

1. **Default cap is 10,000 rows** project-wide (defense-in-depth). Single tournament per-day reads, per-match reads, paged listings — all comfortably under this.
2. **Reads that can plausibly grow past 10k MUST paginate** via `src/lib/db-paginate.ts` (mirrored to `padelgod/src/lib/db-paginate.ts`). Examples: cross-tournament historical aggregations, multi-tournament snapshot scans, archive backfills.
3. **Per-tournament reads can stay unpaginated** — they're bounded by tournament size and absorbed by the 10k cap.

### When in doubt, paginate

```ts
import { paginatedSelect } from '@/lib/db-paginate'

const rows = await paginatedSelect<EntryListRow>(
  (start, end) =>
    supabase
      .schema('padelgod')
      .from('entry_list_snapshots')
      .select('name, fip_id, category, captured_at')
      .eq('tournament_id', tournamentId)
      .range(start, end),
  { what: `entry_list_snapshots (tournament=${tournamentId})` },
)
```

The helper loops `.range(start, end)` until a partial page comes back. Stops at `maxRows` (default 100k) as a runaway safety. Each call gets a `what` label for debuggable error messages.

### Audit script

`scripts/audit-unranged-selects.ts` flags `.from('TABLE')` chains against watched tables (entry_list_snapshots, draw_snapshots, oop_snapshots, results_snapshots, scrape_jobs, matches, players, tournaments, entity_external_ids, articles) that don't show a bound hint nearby (`.limit`, `.range`, `paginatedSelect`, `.single`, `.maybeSingle`, `.eq('id', …)`, `.eq('*_id', …)`).

Heuristic only — many false positives (e.g. `.in('id', [list])`, `.eq('category', 'men')` for a per-tournament read are bounded in context). Run after touching big-table reads:

```bash
npx tsx scripts/audit-unranged-selects.ts                        # all tables
npx tsx scripts/audit-unranged-selects.ts entry_list_snapshots   # one table
```

Not a CI gate — review tool only.

## Unified `MatchCard` (2026-04-30)

[`src/components/MatchCard.tsx`](src/components/MatchCard.tsx) is the single shared match-row component used by every list surface (matches-by-date page, tournament detail's Matches tab, upset highlights). It switches between three states based on `match.status`:

- **scheduled** → chip row + pair rows + right-aligned date/time stack with `*` suffix on approximate (`"Followed by"` / `"Not before"`), orange `estimatedLabel` fallback, then `TBD`
- **live** → chip row + pair rows + per-set scores + live point indicator
- **finished** / `retired` / `walkover` / `ended` → chip row + per-set scores + green "W" badge on winning pair

Replaces `DailyMatchCard`, `V3MatchCard`, and the inline `V3ScheduledCard` that was defined inside the tournament-detail page. If you need the per-state styling history, check the git log on those names.

The `<PredictionSection>` pill (green eye icon + "PREDICTED") surfaces here too, hydration-safe via `useEffect` reading `localStorage['pn_match_predictions']`.

## Tournament-pill / live-state policy (2026-04-30)

`tournaments.status` from padelapi reports `'live'` for any event in its calendar window — it's NOT a "matches are being played right this second" signal. Trusting it as one made the matches-list LIVE pill flash red all night for any in-progress tournament.

**Trust hierarchy (matches-list group header — [MatchesTournamentGroup.tsx:122](src/components/MatchesTournamentGroup.tsx:122)):**

1. `matches.status='live'` on at least one of today's matches → red **LIVE**
2. `tournaments.status` finished/completed/ended → muted **FINAL**
3. mixed bucket today (some finished + some upcoming, no live) → orange **ONGOING** *(stronger ongoing signal than `tournaments.status` because the day's matches prove play has happened)*
4. `tournaments.status='live'/'ongoing'` → orange **ONGOING** *(fallback for in-window tournaments with no matches today, e.g. rest day)*
5. only upcoming today → green **UPCOMING**
6. only finished today → muted **FINAL**
7. otherwise → no pill

Other surfaces follow the same red-pill-only-when-live discipline:

- **Home page** ([TournamentsView.tsx:237](src/components/home/TournamentsView.tsx:237)) — fetches actual matches per candidate tournament, distinguishes `'live'` (red) / `'ongoing'` (orange, "between sessions") / `'completed'`.
- **Tournament detail** ([tournaments/[id]/page.tsx:1251](src/app/[locale]/(app)/tournaments/[id]/page.tsx:1251)) — `isLive = isInDateRange && liveCount > 0 && !finalPlayed` where `liveCount` excludes warming-up matches.
- **TournamentSpotlightHero** — gated on `hasLiveMatches` boolean derived from match statuses.

The `tournament.status='live'` fallback only fires inside #4 and only renders ONGOING (orange), never LIVE (red).

## Crionet results parser — walkover capture (2026-04-30)

`padelgod/src/parsers/crionet-results.ts` previously dropped any row whose set cells were all `-` (`if (sets.length === 0) return`) and hardcoded `status: 'finished'`. Walkovers stayed invisible, so matches stuck on `scheduled` after the actual fixture was decided.

Three terminal-status patterns the parser now handles:

| Pattern | Loser side | Winner side | Set cells |
|---|---|---|---|
| **Normal finished** | Player names + scores | Player names + `fa-check` | `6-2 6-3` |
| **WO badge** | Player names | Player names + `fa-check` + `<small class="badge">WO</small>` | all `-` |
| **Missing team** | `<span class="missingteam">Alternate</span>` placeholder | Player names + `fa-check`, no badge | all `-` |

Detection: `WO` / `RET` / `W/O` text in `small.badge`, OR `.missingteam` class on a team row. Either signal preserves the row + emits `status: 'walkover'` (or `'retired'`). The `Alternate` placeholder is excluded from name extraction so it never leaks in as a player name.

Backfill: [`scripts/reconcile-results-walkovers.mjs`](scripts/reconcile-results-walkovers.mjs) replays the corrected parser against currently-active tournament widgets. Sources the tournament list from `widget_id_cache` (small table) intersected with active tournaments by date — NOT from `oop_snapshots` directly, which can hit the PostgREST 10k row cap and silently truncate at 399+ widgets. Chunked `.in()` queries (100 IDs per chunk) avoid the URL-length limit.

## OOP "Followed by" cross-day chain isolation (2026-04-30)

Bug in `padelgod/src/lib/oop-schedule-parser.ts` — sort key was `(court, courtPosition)` and `lastTimePerCourt` was keyed by court alone. Crionet OOP snapshots cover multiple days at once with `court_position` resetting per day, so Apr 30's "Followed by" rows would chain off Apr 29's last absolute time and produce timestamps a full day off.

**Reproducer:** FIP Silver Mendoza Q2 MQ008. Pista Central, court_position 3, day_date 2026-04-30, label "Followed by". Stored as 22:15 ARG Apr 29 (= 03:15 Madrid Apr 30) instead of 16:30 ARG Apr 30 (= 21:30 Madrid).

**Fix:**
- Sort by `(court, dayDate, courtPosition)`.
- Key the chain map by `${court}::${dayDate}` so each day's chain is independent.

Backfill: [`scripts/reconcile-oop-scheduled-at.mjs`](scripts/reconcile-oop-scheduled-at.mjs).

## Cross-source tournament prevention (2026-04-30)

Padelapi-imported tournament rows have `slug = null`. Padelgod's `tournament-discovery` upserts FIP events with `onConflict: 'slug'`. The two pipelines never collide → every tournament that has both a padelapi entry AND a FIP page got TWO rows. Downstream writers split work between them: `fip-event-page-enricher` enriched one, `fip-draw-populator` created matches on whichever, OOP writer wrote to a third. Public app showed duplicate tournaments + orphan UPCOMING matches stuck on the row that lacked `widget_id_composite`.

**Prevention:** [`padelgod/src/workers/tournament-discovery.ts`](padelgod/src/workers/tournament-discovery.ts) now does a name-token + year lookup against existing rows where `padelapi_id IS NOT NULL AND fip_id IS NULL` before each upsert.

- **Match found** → upsert with `onConflict: 'id'` to UPDATE the existing row in place. Slug, country, level land on the canonical padelapi row.
- **No match** → existing `onConflict: 'slug'` path (insert).
- Slug year extracted from FIP slug pattern (`fip-silver-club-la-calzada-2026` → `2026`) with `publishedGmt` fallback.
- New return field `twinMerges` counts absorbed duplicates per run — should be 0 in steady state.

**Cleanup script gotcha:** [`scripts/merge-tournament-duplicates.ts`](scripts/merge-tournament-duplicates.ts) was filtering on `source === 'padelapi'` to identify the survivor row, but every row in production has `source = 'fip'` post-discovery-flow change. Switched the discriminator to `padelapi_id != null` vs `fip_id`-only. The script silently said "0 duplicates" for months because of this — that's why the Marmotor / Cyprus / Dubai dupes accumulated.

**Match dedup:** for orphans that survive across pipelines, [`scripts/dedup-pattern-b-multi-pipeline.mjs`](scripts/dedup-pattern-b-multi-pipeline.mjs) clusters by name-token signature OR ≥3 player UUID overlap. Clusters where the widget-linked twin has no player FKs (different ingest path) won't unite — those need a manual delete (cluster-by-court+round+time would catch them but adds risk of false matches).

## FIP YouTube streams (2026-04-30)

`fip_court_streams` + `fip_streams_unresolved` power the "Where to watch" affordance on FIP-tier match rows (circular YouTube button between names and scores) and on the match detail page (chunky card). Discovery cron `/api/cron/fip-streams-discover` runs every 15 min via the FIP channel's `uploads` playlist (cheap endpoint, ~200 quota units/day). Title parser maps streams to (tournament, court, day); unmatched videos go to the ops queue. Tier fallback: court stream → tournament-scoped channel search → generic FIP channel URL (always works).

Feature flagged behind `NEXT_PUBLIC_FIP_STREAMS_ENABLED`. Cron supports `FIP_STREAMS_DRY_RUN=true` for scan-only mode during initial rollout. Premier Padel matches are unaffected — they still use the existing `WhereToWatch` component.

Spec: [docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md](docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md). Plan: [docs/superpowers/plans/2026-04-30-fip-youtube-streams.md](docs/superpowers/plans/2026-04-30-fip-youtube-streams.md). Mockup: [public/mockup-fip-stream.html](public/mockup-fip-stream.html).
