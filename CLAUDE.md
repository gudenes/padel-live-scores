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
      feed/                # Article click tracking, video reporting
      match-stats/         # Match stats computation
    components/            # Shared components (MatchCard, CompactMatchCard, BottomNav, Spinner)
  lib/
    supabase.ts            # Client factory (browser anon + server service key)
    score-inference.ts     # Final score inference from point data
    player-resolver.ts     # Player deduplication
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
| `matches` | Match data | `external_id`, `status`, `coverage`, `winner_pair`, `pusher_channel`, `round`, `court` |
| `sets` | Set scores | `match_id`, `set_number`, `set_score`, `pair1_games`, `pair2_games`, `is_current`, `score_source` |
| `games` | Game-level data | `set_id`, `match_id`, `game_number`, `game_score`, `points[]`, `is_current` |
| `players` | Player profiles | `external_id`, `name`, `country`, `avatar_url` (Supabase Storage), `ranking`, `category` |
| `tournaments` | Tournament info | `external_id`, `name`, `level`, `country`, `logo_url`, `starts_at`, `ends_at` |
| `seasons` | Season grouping | `external_id`, `name`, `year` |
| `articles` | News feed | `source_url`, `source_name`, `published_at`, `click_count`, `source_weight`, `favicon_url` |
| `highlights` | YouTube videos | `youtube_id`, `channel_name`, `view_count`, `like_count`, `comment_count`, `description`, `channel_quality_score` |

### Relationships
- `matches` → `tournaments` (via `tournament_id`)
- `sets` → `matches` (via `match_id`)
- `games` → `sets` (via `set_id`) + `matches` (via `match_id`)
- `matches` has 4 player FKs: `pair1_player1_id`, `pair1_player2_id`, `pair2_player1_id`, `pair2_player2_id`

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

## Important Notes

- Tournament status (live/finished/upcoming) is **derived** from match statuses — no DB column exists
- `category` field on matches distinguishes `'men'` vs `'women'`
- Middleware injects `geo-country` cookie from Vercel's `x-vercel-ip-country` header
- `next.config.ts` allows remote images from `storage.googleapis.com` and `jwqaesjjoghzobngxejn.supabase.co`
- Admin endpoints require `Authorization: Bearer {CRON_SECRET}` header
