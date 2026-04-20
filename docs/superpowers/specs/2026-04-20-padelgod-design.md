# Padelgod — Unified Padel Scraping Service (Design)

**Date:** 2026-04-20
**Status:** Approved (design phase complete)
**Owner:** Gustavo Denes
**Supersedes:** parts of `2026-04-01-fip-standalone-pipeline-design.md` (extends FIP scraping into a full platform)

---

## 1. Goal

Build **Padelgod**, a separate long-running service that owns *all* web scraping for the PadelNachos platform — tournaments, players, draws, Order of Play, live scores with point-by-point and server indicator, news, and YouTube highlights. Padelgod will eventually replace `padelapi.org` as the live data source for Premier Padel events while continuing to drive the FIP Gold/Silver/Bronze pipeline.

### Why now

- `padelapi.org` introduces sync delays on live point-by-point updates
- `padelapi.org` does not expose the **service indicator** (which player is serving) or **court** in its Pusher payload — both fields are present in the raw Crionet/Matchscorer widget that powers `padelfip.com`
- Existing FIP scraping logic (`src/lib/fip-scraper.ts`, `cron/fip-scores`, `cron/oop-monitor`) already proves the widget approach works for draws + OOP — Padelgod consolidates and extends that pattern
- A unified scraping service is a clean platform boundary: one place to evolve parsers, one place to monitor scrape health, and a future opportunity to expose data as a public API

### Non-goals (V1)

- Public API authentication, rate limiting, billing — design accommodates this growth path but does not implement it
- Replacing the Premier Padel `beforeauth` API integration (per-set match stats) — that remains its own cron, separate sidecar
- Replacing the main app's app-internal crons (`social-drafts`, `editorial-gen`, `quality-scores`, `nacho-health`) — those stay on Vercel
- Big-bang migration off `padelapi.org` — migration is deferred until Padelgod is proven in shadow mode

---

## 2. Scope (V1)

Padelgod V1 covers the **complete FIP-sourced pipeline**, with FIP treated as canonical source of truth:

| Worker | Source | Cadence | Output |
|---|---|---|---|
| **Tournament discovery** | `padelfip.com/calendar` + `/live` + WP API | Daily 04:00 UTC | tournaments + dates + level + slug |
| **Widget ID extractor** | event page (Playwright) | On new tournament | `FIP-2026-XXXX` per event, persisted in `padelgod.widget_id_cache` |
| **Player rankings + profiles** | FIP rankings page + player profile pages | Daily 05:00 UTC (rankings); on-demand (profiles) | players (fip_id, name, country, photo, birthdate, ranking, points) |
| **Draws** | `widget.matchscorerlive.com/screen/results.../{id}` | On entry-list publish + hourly during tournament | bracket + seeds + Q/WC/LL markers |
| **OOP / schedule** | `widget.matchscorerlive.com/screen/oopbyday/{id}/{day}` | Hourly + 2h pre-tournament | court + scheduled time + match assignments |
| **Live matches** | widget polling per active match | Every 6–8s while live | scores + point-by-point + server + court + status |
| **Articles** | RSS feeds + FIP WordPress API | Hourly :40 | news articles |
| **YouTube highlights** | YouTube Data API | Hourly :20 | highlight videos |

**FIP-as-canonical implications:**
- Padelgod assumes every player in a FIP-sanctioned event has a `fip_id` — no thin amateur records expected in V1
- Source priority list flips: FIP wins for `name`, `ranking`, `avatar_url`, `birthdate`, `tournament.name`, `tournament.logo_url`, draws — basically everything except Premier-only fields (prize money, broadcasters)
- `padelapi.org` integration stays as runtime fallback during the entire migration period, then is decommissioned

---

## 3. Architecture

### 3.1 Integration pattern

**Pattern C: Padelgod writes directly to the shared Supabase + exposes a small admin API.**

Why not a fully separate REST API (Pattern B): re-introduces the exact "polling middleman" latency we're escaping from `padelapi.org`. The whole value of writing directly to Supabase is that Supabase Realtime then pushes updates to the main app's frontend with zero added hops.

The admin API surface is the seed for a future public API. Same routes, hardened with auth + rate-limiting when externally exposed (versioned at `/v1/...`, internal/admin at `/admin/...`).

### 3.2 Database boundary

**Same Supabase project, new `padelgod` Postgres schema.**

```
public schema    → shared entities (matches, players, tournaments, sets, games)
                   ← both Padelgod writes & main app reads
                   ← Realtime subscriptions still work cross-schema
padelgod schema  → scraper-internal state only
                   (scrape_jobs, raw_payloads, widget_id_cache, unresolved_players)
```

Separate Supabase **projects** were considered and rejected: cross-project setups would break Supabase Realtime delivery to the main app's frontend, forcing either polling or a sync layer — both of which reintroduce the latency problem we're solving. Schema separation gives ~90% of the isolation benefit at ~10% of the cost. If Padelgod ever needs to be a fully separate product, `pg_dump --schema=padelgod` extracts cleanly.

### 3.3 Repo + deploy

- **Monorepo:** new `/padelgod` directory, sibling to existing `/relay`. Shared TypeScript types with main app. Own `Dockerfile`, own `package.json`, own entry point.
- **Deploy target:** Railway, separate service from `/relay`.
- **Process model:** single long-running Node.js process for V1. Internal scheduler (node-cron) handles cron-style jobs; in-process polling pool handles continuous live polling.
- **Scale path:** when one process can't handle peak (~10–15 concurrent live tournaments), shard by `tournamentId.hashCode() % N` across N Railway replicas. Not needed at V1 launch.

### 3.4 Repo layout

```
padelgod/
├── workers/
│   ├── tournament-discovery.ts     # cron: daily 04:00 UTC
│   ├── widget-id-extractor.ts      # event-driven: on new tournament
│   ├── player-rankings.ts          # cron: daily 05:00 UTC
│   ├── draw-fetcher.ts             # cron: hourly + on entry-list publish
│   ├── oop-fetcher.ts              # cron: hourly + 2h pre-tournament
│   ├── live-poller.ts              # continuous: 6-8s per active tournament
│   ├── article-scraper.ts          # cron: hourly :40
│   └── youtube-scraper.ts          # cron: hourly :20
├── lib/
│   ├── widget-fetcher.ts           # cheerio HTML parser (extends fip-scraper.ts)
│   ├── player-dictionary.ts        # per-tournament dict builder + cache
│   ├── playwright-pool.ts          # singleton browser instance
│   └── supabase.ts                 # service-role client
├── api/
│   └── admin.ts                    # Fastify routes
├── scheduler.ts                    # node-cron orchestrator
└── index.ts                        # entry point: starts scheduler + admin API
```

### 3.5 What Padelgod absorbs from the existing app

| Currently lives at | Future home |
|---|---|
| `relay/index.js` (Pusher relay for padelapi) | ❌ Replaced by widget polling, decommissioned in Phase 3 |
| `cron/fip-tournaments`, `cron/fip-scores`, `cron/oop-monitor` | ✅ Become Padelgod workers |
| `cron/scores`, `cron/sync` (padelapi calls) | ✅ Replaced by widget pipeline |
| `cron/sync-fip-rankings` | ✅ Becomes Padelgod worker |
| `cron/sync-articles`, `cron/sync-highlights` | ✅ Padelgod-owned |
| `cron/premier-discovery`, `cron/premier-stats` | ⚠️ Keep on Vercel — they hit Premier's beforeauth API which is a different beast |
| `cron/social-drafts`, `cron/editorial-gen`, `cron/quality-scores`, `cron/nacho-health` | ❌ Stay on Vercel — app-internal, not scraping |

### 3.6 Concurrency model

- One Node process runs the scheduler (cron jobs) AND the live-poller's promise pool
- Live-poller maintains `Map<tournamentId, IntervalHandle>` — adds when tournament moves to `live`, removes when `finished`
- Each live tournament = one polling loop (6–8s), parallel via `Promise.all`
- Throttle: max 50 concurrent HTTP requests to `widget.matchscorerlive.com`
- Polite User-Agent: `Padelgod-Scraper/1.0 (contact: <ops-email>)`

### 3.7 Why one process, not BullMQ + Redis (V1)

We don't have the volume yet. Adding Redis is real ops overhead (managed Redis instance, retry policies, dashboards). Single-process keeps the surface tiny. We move to BullMQ when we actually feel the pain.

---

## 4. Schema changes

### 4.1 Additions to `public` schema

```sql
-- Per-point structured data (the table we never had)
CREATE TABLE public.match_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  set_id   UUID NOT NULL REFERENCES sets(id)    ON DELETE CASCADE,
  game_id  UUID NOT NULL REFERENCES games(id)   ON DELETE CASCADE,
  point_number INT NOT NULL,                          -- 1-indexed within game
  server_player_id UUID REFERENCES players(id),       -- nullable; only set for live-captured points
  winner_pair INT NOT NULL CHECK (winner_pair IN (1, 2)),
  score_after TEXT NOT NULL,                          -- '30-15', 'deuce', 'AD-Lebrón'
  is_break_point BOOLEAN DEFAULT false,
  is_set_point   BOOLEAN DEFAULT false,
  is_match_point BOOLEAN DEFAULT false,
  source TEXT DEFAULT 'padelgod',                     -- 'padelgod' | 'padelapi' | 'inferred'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (game_id, point_number)
);
CREATE INDEX idx_match_points_match  ON public.match_points(match_id);
CREATE INDEX idx_match_points_server ON public.match_points(server_player_id);

-- Per-game server (server rotates each game in padel)
ALTER TABLE public.games ADD COLUMN server_player_id UUID REFERENCES players(id);

-- Source tracking on matches for divergence audit during migration
ALTER TABLE public.matches ADD COLUMN last_updated_by TEXT;  -- 'padelapi' | 'padelgod' | 'manual'

-- Migration feature flag — per-tournament source switching
ALTER TABLE public.tournaments ADD COLUMN live_source TEXT DEFAULT 'padelapi';  -- 'padelapi' | 'padelgod'
```

**Three levels of "service indicator," all required:**

| Level | Where | Use case |
|---|---|---|
| Live current server | `matches.serving_player_id` (already exists, currently unpopulated) | Match card shows ball next to server name |
| Per-game server | `games.server_player_id` (new) | "Lebrón holds serve 4 of 5 games" stats |
| Per-point server | `match_points.server_player_id` (new) | Service hold %, break-point conversion |

**Backward compatibility for `games.points: text[]`:** keep populating from `match_points` via a Postgres trigger or in the same write transaction. Plan to drop the column in a later cleanup PR once UI is migrated to `match_points`.

**Per-point server limitation (accepted):** the widget exposes current server reliably but not always per-point history for completed games. For live polling Padelgod captures `server_player_id` per point. For matches scraped retroactively, `match_points.server_player_id` will be NULL. We do not derive historical server from alternation rules — accuracy not worth it.

### 4.2 New `padelgod` schema

```sql
CREATE SCHEMA padelgod;

-- 1. Operational log: every scrape attempt
CREATE TABLE padelgod.scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_type TEXT NOT NULL,
    -- 'discover'|'widget_id'|'draw'|'oop'|'live'|'rankings'|'profile'|'article'|'youtube'
  tournament_id UUID REFERENCES public.tournaments(id),
  target_url TEXT,
  status TEXT NOT NULL,                                -- 'queued'|'running'|'success'|'failed'
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INT,
  error_message TEXT,
  parser_version TEXT
);
CREATE INDEX idx_scrape_jobs_recent     ON padelgod.scrape_jobs(started_at DESC);
CREATE INDEX idx_scrape_jobs_tournament ON padelgod.scrape_jobs(tournament_id, job_type);

-- 2. Widget ID cache (durable so we don't re-Playwright on restart)
CREATE TABLE padelgod.widget_id_cache (
  tournament_id UUID PRIMARY KEY REFERENCES public.tournaments(id) ON DELETE CASCADE,
  widget_id TEXT NOT NULL UNIQUE,                      -- 'FIP-2026-1234'
  extracted_at TIMESTAMPTZ DEFAULT NOW(),
  extraction_method TEXT NOT NULL                      -- 'iframe'|'page_regex'|'manual'
);

-- 3. Raw HTML payloads (replay + debugging)
CREATE TABLE padelgod.raw_payloads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scrape_job_id UUID REFERENCES padelgod.scrape_jobs(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,                          -- sha256, dedup identical responses
  body TEXT NOT NULL,
  captured_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_raw_payloads_recent ON padelgod.raw_payloads(captured_at DESC);
-- Daily cron purges rows where captured_at < NOW() - INTERVAL '48 hours'

-- 4. Human review queue: widget names we couldn't resolve
CREATE TABLE padelgod.unresolved_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),
  widget_short_name TEXT NOT NULL,                     -- 'J. Lebrón'
  partner_short_name TEXT,                             -- context for ops dashboard
  match_id UUID REFERENCES public.matches(id),
  candidate_player_ids UUID[],                         -- top-N fuzzy candidates
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pending',                       -- 'pending'|'resolved'|'created_new'|'ignored'
  resolved_player_id UUID REFERENCES public.players(id),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,                                    -- email or 'auto'
  UNIQUE (tournament_id, widget_short_name, partner_short_name)
);

-- 5. Phase-1 shadow tables (mirror schema of public counterparts; see §6.2)
--    Created during Phase 1 of migration, dropped after Phase 3.
--    Identical column shape to public.matches/sets/games — extends with shadow-only columns
--    (compared_at, divergence_reason). Concrete schema deferred to migration PR.
```

**Tournament dictionaries (per-tournament player lookup) stay in-memory only** — cheap to rebuild from entry list on worker restart, no need to persist.

---

## 5. Player enrichment design

### 5.1 The problem

The Crionet widget shows abbreviated names ("J. Lebrón", "Lebrón / Chingotto") that don't match the full canonical names in the FIP entry list ("Juan Lebrón Perea"). Resolving the widget's short name to the correct `players.id` reliably is the single hardest correctness problem in the pipeline.

The existing `src/lib/player-resolver.ts` already provides 5-tier resolution: `fip_id → external_id → normalized_name → alias → fuzzy`, with auto-stored aliases in `entity_external_ids`. Padelgod extends this with two new mechanisms.

### 5.2 Per-tournament Player Dictionary (in-memory)

Built when a tournament transitions to `live` (or when entry list is first scraped):

```typescript
TournamentDictionary {
  tournamentId: UUID
  fipWidgetId: string           // 'FIP-2026-1234'
  players: Map<fip_id, {
    canonicalName: string       // 'Juan Lebrón Perea'
    abbreviatedForms: string[]  // ['J. Lebrón', 'J Lebron', 'Lebrón', 'Lebron', ...]
    country: string             // 'ES'
    seedPosition?: number
    knownPartner?: fip_id       // from entry-list pairing
  }>
  byShortName: Map<normalized_short_name, fip_id[]>  // pre-indexed
}
```

Abbreviated forms are generated permutations of the canonical name: `"F. LastName"`, `"FirstInitial LastName"`, `"LastName"`, `"FullName"`, accent-stripped variants, etc.

Lookup space is constrained from ~50,000 global players to ~64 per tournament — false-positive risk drops dramatically. Within the bounded tournament dictionary, a fuzzy threshold of **0.5** is safe for auto-resolve. The existing global `PlayerResolver` (used outside Padelgod, against the full player table) keeps its stricter **0.8** threshold to avoid cross-tournament collisions on common surnames.

### 5.3 Pair disambiguation

When the widget emits a match like `"Lebrón / Chingotto"`:

1. Tournament dict lookup — `"Lebrón"` → `[fip-001 Juan Lebrón, fip-877 Mario Lebrón]`, `"Chingotto"` → `[fip-002 Federico Chingotto]`
2. Pair disambiguation — entry list says `(fip-001, fip-002)` plays together → resolve to `fip-001`
3. Resolved pair cached as confirmed for the match → never re-resolved
4. If still ambiguous → pair-pattern across other recent matches in same tournament
5. New short form not in dictionary → store global alias in `entity_external_ids`
6. Completely unresolvable → write to `padelgod.unresolved_players` queue + ops alert

### 5.4 Ops dashboard integration

A new "Padelgod" tab in the existing `/ops` dashboard surfaces:
- Unresolved players queue (status: pending) with widget context (match, partner, tournament)
- Action buttons: "Link to existing player" (search), "Create new", "Ignore"
- Once resolved, alias is written to `entity_external_ids` and next widget poll resolves automatically

---

## 6. Migration path (deferred — proven pipeline first)

### 6.1 Phasing

**Phase 0 — During Padelgod build**
Schema additions (`match_points`, `games.server_player_id`, `padelgod` schema, `tournaments.live_source`, `matches.last_updated_by`) ship first as **read-additive** changes. Nothing reads from them yet, nothing in main app changes. Reversible.

**Phase 1 — Shadow mode (2–4 weeks)**
- Padelgod fully live, all workers running
- For tournaments where `live_source='padelapi'` (initially: all), Padelgod writes to `padelgod.shadow_*` tables — does NOT touch canonical `public.matches/sets/games`
- For tournaments where `live_source='padelgod'` (initially: zero), Padelgod writes to canonical tables
- New ops dashboard tab: **"Padelgod Divergence"** — side-by-side padelapi vs padelgod for currently-live tournaments, time-to-update delta, mismatch %

**Phase 2 — Per-tournament cutover**
- Pick the next upcoming Premier event → flip `live_source` to `padelgod`
- Relay stays subscribed for that tournament as cold backup (writes only to shadow)
- Monitor full tournament week through divergence dashboard
- Expand: 2 → 5 → all of next month → all
- 1-click rollback per tournament if anything goes wrong

**Phase 3 — Decommission (after 2 weeks of 100% padelgod with zero incidents)**
- Stop subscribing relay to new Pusher channels (relay process stays alive but idle)
- After 2 more weeks: delete `relay/` from repo, kill the Railway service
- Eventually: drop `padelapi_id` legacy columns + the deprecated `external_id` columns

### 6.2 Shadow tables (Phase 1)

`padelgod.shadow_matches`, `padelgod.shadow_sets`, `padelgod.shadow_games` mirror the schema of their `public` counterparts plus shadow-only columns: `compared_at TIMESTAMPTZ`, `divergence_reason TEXT NULL`. Concrete schema is deferred to the migration PR for Phase 1 — included here for completeness of the design intent.

### 6.3 Ship/no-ship signals before Phase 2 cutover

| Metric | Target before cutover |
|---|---|
| Time-to-update lag (padelapi vs padelgod for same point) | padelgod ≤ padelapi median |
| Final-score correctness across N tournaments | 100% match for finished matches |
| Player resolution rate (short name → fip_id) | ≥ 99% auto-resolved, < 1% in unresolved queue |
| Widget parse success rate | ≥ 99.5% over 7-day window |
| Worker uptime | ≥ 99.5% |
| `match_points` capture rate for live matches | ≥ 95% of points captured |

Any miss = no cutover.

---

## 7. Risk mitigation

| Risk | Mitigation in V1 |
|---|---|
| Widget HTML changes → parser breaks silently | `parser_version` tracking on every job; 48h `raw_payloads` for replay; alert when parse failure rate > 5% over 1h |
| Cloudflare / anti-bot blocks Padelgod IP | Polite User-Agent, ≥ 6s poll cadence per match, residential proxy ready as backup (Bright Data / Oxylabs) |
| FIP widget itself goes down | Relay + padelapi remains as runtime fallback during all of Phase 1–3 |
| Player resolution false positive (wrong player attributed) | Tournament-scoped dictionary uses 0.5 threshold (bounded ~64 players); global resolver stays at 0.8; anything ambiguous → unresolved queue + ops alert |
| Live tournament has issues mid-event | `tournaments.live_source` per-tournament feature flag = instant rollback |
| Padelgod worker crash during live polling | Railway process restart on exit; persisted `widget_id_cache` so dictionaries rebuild from entry list cheaply (one widget call) |
| Schema coupling between Padelgod and main app | Padelgod and main app deployed separately but coordinate via shared types in monorepo; migrations reviewed by both teams |

---

## 8. Admin API surface

Fastify app inside Padelgod, port 3002. All routes behind `Authorization: Bearer ${PADELGOD_ADMIN_TOKEN}`.

### Read endpoints

```
GET    /health                              liveness
GET    /jobs?type=&tournament_id=&status=   recent scrapes (paginated)
GET    /jobs/:id                            job detail + raw payload link
GET    /tournaments                         all known + polling status
GET    /tournaments/:id                     widget_id, last scrapes, dict size, poller state
GET    /unresolved-players?status=pending   human review queue
GET    /raw-payloads/:id                    fetch raw HTML for replay
```

### Write endpoints (operator actions)

```
POST   /tournaments/:id/refresh-widget-id   trigger Playwright re-extraction
POST   /tournaments/:id/refresh             force re-scrape draws + OOP + entry list
POST   /tournaments/:id/widget-id           manual override { widget_id }
POST   /tournaments/:id/start-polling       manually start live poller
POST   /tournaments/:id/stop-polling        manually stop
POST   /unresolved-players/:id/resolve      { player_id } → link to existing
POST   /unresolved-players/:id/create       { name, country, ... } → create new player
POST   /unresolved-players/:id/ignore       skip (false positive)
```

### Public API growth path (out of V1, designed-in)

When Padelgod opens external access, the same routes get hardened and split:
- `/v1/...` versioned public namespace — reads only, stable contract
- `/admin/...` operator routes — internal only
- API keys + per-key rate limit (Upstash Redis counters)
- OpenAPI spec + Scalar/Mintlify docs
- Optional WebSockets/SSE on top of Supabase Realtime for push to external consumers
- Cloudflare/Vercel edge cache or Redis read-through if external traffic grows

The internal app keeps reading Supabase directly, never touched by external traffic.

---

## 9. Environment variables

### Padelgod (Railway)
```
SUPABASE_URL
SUPABASE_SERVICE_KEY            # writes to public + padelgod schemas
PADELGOD_ADMIN_TOKEN            # admin API auth
YOUTUBE_API_KEY                 # YouTube scraper
PLAYWRIGHT_BROWSERS_PATH        # Playwright cache
NODE_ENV=production
```

### Main app (Vercel) — additions only
```
PADELGOD_BASE_URL=https://padelgod.up.railway.app
PADELGOD_ADMIN_TOKEN=<secret>   # ops dashboard server-side calls only
```

---

## 10. Open questions / future work

- **Legal review** before opening Padelgod data via public API — FIP/Premier data redistribution rights need clarification before paid tiers
- **Premier `beforeauth` API** stays separate for V1 — reconsider folding into Padelgod once the rest of the platform is stable
- **Lower-tier player records without FIP IDs** — assumed to be a non-issue per scope clarification, but if encountered in the wild we add a thin-record creation path in V1.5
- **BullMQ + Redis** — adopt when single-process can no longer handle concurrent live tournaments at peak (current estimate: ~10–15 concurrent tournaments)
- **Multi-region deployment** — single Railway region for V1; add regional polling workers if widget latency from a single region becomes a bottleneck

---

## 11. Summary

Padelgod is a separate Railway service that owns all web scraping for PadelNachos. It writes structured padel data (tournaments, players, draws, OOP, live scores with point-by-point and 3-level service indicator) directly to the shared Supabase database, with scraper-internal state isolated in a new `padelgod` Postgres schema. Player enrichment uses an in-memory per-tournament dictionary plus pair disambiguation to resolve abbreviated widget names with high confidence. Migration off `padelapi.org` is deferred until the new pipeline is proven in shadow mode, then proceeds tournament-by-tournament behind a feature flag with 1-click rollback.
