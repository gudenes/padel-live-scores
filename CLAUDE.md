@AGENTS.md

# PadelNacho — Padel Live Scores

Mobile-first PWA for real-time padel score tracking, rankings, news, and tournament info. Data sourced from padelapi.org (FIP/Premier Padel).

## Tech Stack

- **Frontend:** Next.js 16.2.0, React 19, Tailwind CSS 4, TypeScript 5
- **Database:** Supabase (PostgreSQL) with Realtime subscriptions
- **Real-time:** Pusher WebSocket (via padelapi.org) → Railway relay → Supabase
- **Deployment:** Vercel (app + cron jobs), Railway (relay service)
- **External APIs:** padelapi.org (matches/players/tournaments), YouTube Data API, FIP WordPress API, Google News RSS

## Project Structure

```
src/
  app/
    v2/                    # Active UI pages (home, matches, ranking, tournaments, feed)
    match/[id]/            # Match detail + momentum chart
    player/[id]/           # Player profile
    api/
      cron/                # Vercel cron jobs (scores, sync, articles, highlights, rankings)
      admin/               # Protected maintenance endpoints (resync, backfill, seed, migrate)
      ops/                 # Ops dashboard APIs (seed-entry-list, parse-draw, seed-draw)
      feed/                # Article click tracking, video reporting
      match-stats/         # Match stats computation
    components/            # Shared components (MatchCard, CompactMatchCard, BottomNav, Spinner)
  lib/
    supabase.ts            # Client factory (browser anon + server service key)
    score-inference.ts     # Final score inference from point data
    player-resolver.ts     # Player deduplication (with ranking/points disambiguation)
    draw-parser.ts         # FIP draw PDF text parser (pure function)
    feed-scoring.ts        # Feed ranking engine (personalization, dedup, quality signals)
  types/
    match.ts               # Core interfaces (Match, Set, Game, Player) + utility functions
  hooks/
    useBookmarks.ts        # localStorage bookmarks (future: Supabase auth)
    useHiddenFeedItems.ts  # localStorage hidden feed items (videos + news)
    useFeedPreferences.ts  # localStorage feed preferences (language, category, channel)
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

**Sync jobs should use `filterUpdateByPriority` when updating existing rows** so secondary sources can't clobber primary data. See `src/app/api/cron/fip-tournaments/route.ts` for the canonical example.

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
| `/api/cron/sync?scope=matches` | Every 6 hours | Sync match metadata for active tournaments |
| `/api/cron/sync` | Mon 4am UTC | Full sync: tournaments, players, seasons, FIP logos |
| `/api/cron/sync-fip-rankings` | Daily 5am UTC | FIP official + race rankings (top 1000, both genders) |
| `/api/cron/sync-articles` | Every 6 hours | News from RSS feeds + FIP WordPress API |
| `/api/cron/sync-highlights` | Every 6 hours | YouTube highlights from padel channels |

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

- Tournament status (live/finished/upcoming) is **derived** from match statuses — no DB column exists
- `category` field on matches distinguishes `'men'` vs `'women'`
- Middleware injects `geo-country` cookie from Vercel's `x-vercel-ip-country` header
- `next.config.ts` allows remote images from `storage.googleapis.com` and `jwqaesjjoghzobngxejn.supabase.co`
- Admin endpoints require `Authorization: Bearer {CRON_SECRET}` header
