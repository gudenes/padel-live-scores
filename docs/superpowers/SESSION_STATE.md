# Padelgod — Session State (handoff)

**Last updated:** 2026-04-20 (end of brainstorming-through-Plan-3 session)

This document captures everything a fresh session needs to pick up Padelgod work cleanly. **Read this first** before starting Plan 4 execution.

---

## TL;DR

**What Padelgod is:** a separate Railway-deployed Node service that scrapes FIP/Crionet for tournaments, players, draws, OOP, results, and (eventually) live scoring. Eventually replaces `padelapi.org` as the live data source for the Next.js app.

**Where we are:** Plans 1–3 shipped to production. 8 workers running on cron schedule in Railway. ~31 widget codes cached, 31 draw matches captured for FIP BRONZE MARRAKECH, all infrastructure proven E2E. Plan 4 doc written but **not yet executed**.

**Next step:** Execute Plan 4 (live pipeline + reconciler) via subagent-driven development. Spec lives at `docs/superpowers/plans/2026-04-20-padelgod-04-live-pipeline.md`.

---

## Production state

### Service deployment
- **Railway service:** `padel-live-scores-production-4189.up.railway.app`
- **Container port:** 8080 (Railway auto-injects `PORT`; app reads `env.PORT`)
- **Health endpoint:** `GET /health` returns 200 with `{ status, uptime_seconds, version }`
- **Admin endpoint:** `POST /admin/run-worker` — Bearer auth via `PADELGOD_ADMIN_TOKEN`. Body: `{ "worker": "<name>" }`. Triggers any of 8 workers ad-hoc.

### Active scheduler (8 workers)
| Worker | Cron | What it does |
|---|---|---|
| `tournament-discovery` | `0 * * * *` | WP API → upsert tournaments (incremental via modified_after) |
| `widget-code-lookup` | `15 * * * *` | POST `/ft` search → cache widget codes |
| `entry-list-fetcher` | `45 * * * *` | Snapshot entry lists per tournament+category |
| `oop-fetcher` | `50 * * * *` | Snapshot OOP per day |
| `results-fetcher` | `55 * * * *` | Snapshot completed match results |
| `draw-fetcher` | `20 */2 * * *` | Snapshot draws per category × type × round |
| `player-rankings` | `0 5 * * *` | FIP rankings page → upsert players |
| `player-profile` | `30 * * * *` | Stub (no batch driver yet — V1.5) |

### Schema in production
All Plan 1 + Plan 3 schema additions are live AND in version control (after the cleanup PR merged):
- `public.match_points` table
- `public.games.is_tiebreak`, `games.server_player_id`
- `public.tournaments.live_source` (default `'padelapi'`), `uses_golden_point`
- `public.match_points.is_golden_point`
- `public.{tournaments,players,matches}.public_id`, `created_at`, `updated_at`, `last_updated_by`
- `public.players.slug`, `tournaments.slug` (was `fip_slug`)
- `padelgod` schema with: `scrape_jobs`, `widget_id_cache`, `raw_payloads`, `unresolved_players`, `unresolved_matches`, `entry_list_snapshots`, `draw_snapshots`, `oop_snapshots`, `results_snapshots`
- Migration 015 captured 5 hot fixes: GRANTs to service_role, last_updated_by columns, slug UNIQUE constraint, external_id nullable, NOTIFY pgrst

### Supabase configuration (one-time setup, already done)
- **Exposed schemas** in Data API settings: `public, graphql_public, padelgod`
- **Extra search path**: `public, extensions, padelgod`
- All migrations through `20260420000017` either applied or pending Plan 4

### Production data scraped so far
- 16+ FIP tournaments discovered (source='fip')
- 31 widget codes cached (15.5% match rate; 169 needed Playwright fallback that doesn't exist yet)
- 31 draw matches from FIP BRONZE MARRAKECH (full names + winner detection working ✅)
- 0 entry list rows (active tournaments don't have published entry lists yet)
- 0 OOP rows (same)
- 0 results rows (same — need to test on a tournament with finished matches in the active window)

---

## Architecture mental model

### Three-tier data flow
```
Crionet widget HTML / WP API
        ↓ (Plan 2 + 3 workers)
padelgod.{scrape_jobs, raw_payloads, *_snapshots, widget_id_cache}
        ↓ (Plan 4 reconciler — NOT YET BUILT)
public.{tournaments, players, matches, sets, games, match_points, tournament_draws}
        ↓ (Supabase Realtime)
Next.js app (existing main app)
```

**Why snapshots are append-only:** scraping correctness is independent of canonical correctness. Parser bugs corrupt snapshots, not canonical. Reconciler is replayable when resolution logic improves.

**Why the live poller writes DIRECTLY to canonical (no snapshot layer):** live data is time-sensitive. Latency of snapshot → reconciler defeats the purpose. The poller has its own diff/reconstruction logic in `point-reconstruction.ts`.

### Cutover semantics
- `tournaments.live_source TEXT NOT NULL DEFAULT 'padelapi'` — controls who owns live data per tournament
- During Plan 4 rollout: flip individual tournaments to `'padelgod'` to test
- Old `relay/index.js` (Pusher-based) still runs in parallel for tournaments where `live_source='padelapi'`
- Plan 7 retires the relay once Padelgod proves stable

### Repo structure
```
padelgod/                              # Long-running Railway service
├── src/
│   ├── api/                           # Fastify routes (health, admin)
│   ├── lib/                           # http-client, scrape-job, supabase, env, logger,
│   │                                  # tournament-dictionary, parser-versions
│   ├── parsers/                       # Pure functions: HTML → typed object
│   ├── workers/                       # Compose http-client + parser + scrape-job + DB
│   ├── scheduler.ts                   # node-cron wiring
│   └── index.ts                       # Entry point: Fastify + scheduler
├── package.json                       # ESM, NodeNext module resolution
├── Dockerfile                         # Multi-stage with chromium for Playwright fallback
└── railway.toml

src/                                   # Existing Next.js main app (not modified by Padelgod work)
relay/                                 # Existing Pusher relay (still running, gets retired in Plan 7)
supabase/migrations/                   # All migrations — repo-root path is what Supabase CLI scans
docs/superpowers/                      # Specs + plans
├── specs/                             # 3 Padelgod design docs
└── plans/                             # 4 Padelgod plans (1–4); 5–7 are placeholders
```

---

## Plans status

| Plan | Status | Notes |
|---|---|---|
| **Plan 1: Foundation** | ✅ shipped | Service skeleton, all migrations, Railway deploy |
| **Plan 2: Discovery layer** | ✅ shipped | tournament-discovery, widget-code-lookup, player-rankings, player-profile |
| **Plan 3: Static match data** | ✅ shipped | entry-list, draw, oop, results fetchers + tournament-dictionary lib |
| **Cleanup (migration 015)** | ✅ shipped | Bundled 5 SQL hot fixes into version control |
| **Admin trigger endpoint** | ✅ shipped | `POST /admin/run-worker` |
| **Parser fixes** | ✅ shipped | Full names + winner detection + tiebreak via `<sup>` (commits 43144ad, f5f9f3c) |
| **Plan 4: Live pipeline + reconciler** | 📝 **doc written, NOT executed** | 17 tasks, see plan doc |
| **Plan 5: Admin API + ops dashboard** | 📋 placeholder | Expand admin endpoint into full API + ops tab |
| **Plan 6: Articles + YouTube migration** | 📋 placeholder | Move existing main-app crons into Padelgod |
| **Plan 7: padelapi.org → padelgod migration** | 📋 placeholder | Cutover all tournaments + retire relay |

---

## Critical knowledge / gotchas (do not repeat these mistakes)

### 1. Custom schemas need explicit grants
Supabase doesn't auto-grant on custom schemas. After creating the `padelgod` schema, must run:
```sql
GRANT USAGE ON SCHEMA padelgod TO service_role;
GRANT ALL ON ALL TABLES IN SCHEMA padelgod TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA padelgod GRANT ALL ON TABLES TO service_role;
```
Plus expose the schema in Data API → Settings → Exposed schemas. Already done; captured in migration 015.

### 2. PostgREST onConflict needs full UNIQUE constraint, not partial index
Partial unique indexes (`WHERE col IS NOT NULL`) don't work with PostgREST's `onConflict`. Use full UNIQUE constraints — Postgres treats NULLs as distinct by default so it's safe.

### 3. Migrations must live at repo-root `supabase/migrations/`
Supabase CLI only scans this path. Migration files placed under `padelgod/supabase/migrations/` are silently ignored. Plan 3 hit this; fixed in cleanup PR.

### 4. Path bug in subagent dispatches
Subagents sometimes `cd padelgod && create-file supabase/migrations/...` which lands files at `padelgod/supabase/migrations/`. Always specify the **absolute** path or explicitly say "at the REPO ROOT path" in agent instructions.

### 5. Subagents commit to wrong branch
When the agent runs git from a parent checkout instead of the worktree, commits land on the wrong branch. Cleanup migration commit ended up on `main` instead of `fix/padelgod-plan1-followup` and we had to cherry-pick. Specify worktree path explicitly in agent prompts.

### 6. Speculative HTML fixtures lead to silent parser bugs
The Plan 3 parsers (draw, results, oop) were written with simplified HTML guesses. Production parsing extracted only player initials and missed winner detection. Lesson: always validate parser fixtures against real HTML BEFORE shipping. The reference implementation is `src/lib/fip-scraper.ts` in the main app — it's been battle-tested.

### 7. Tiebreak only on resultsbyday endpoint, not draw
The `/screen/draw/...` endpoint shows set scores without tiebreak digits. Only `/screen/resultsbyday/...` includes `<sup>N</sup>` for tiebreak losers. Reconciler should prefer results_snapshots when both have data for the same match.

### 8. `external_id` is legacy, was NOT NULL
Plan 1 didn't account for this. Made it nullable in migration 015. Padelgod uses `padelapi_id` / `fip_id` / `slug` instead.

### 9. `last_updated_by` was on matches but not tournaments/players
Plan 1 added it only to `matches`. Workers also write it on `tournaments` and `players` upserts. Added to those tables in migration 015.

### 10. Active tournaments RPC requires `source='fip'` AND date window
The `padelgod_active_tournaments_for_static_workers()` RPC excludes any tournament that's:
- `source != 'fip'` (e.g. padelapi-discovered tournaments)
- Outside ±7 days of NOW
- Without an active widget_id_cache row

For Plan 4 we add a similar RPC `padelgod_tournaments_for_live_polling()` that's gated on `live_source='padelgod'`. **Brussels P2** during the brainstorming phase was likely `source='padelapi'` so it didn't appear in the static workers' active list. Need to manually flip a known-live tournament for Plan 4 smoke testing.

### 11. Railway has soft request timeout but workers can run >150s
The widget-code-lookup worker ran 150s and survived (`"durationMs": 150654`). No need to worry about per-request timeouts breaking long-running admin triggers. But Vercel main app has stricter timeouts.

### 12. EventEmitter MaxListeners warning is cosmetic
Node 22 + axios concurrent requests can trigger this. Add `process.setMaxListeners(20)` in `index.ts` if it gets noisy. Not blocking.

---

## Open issues / known TODOs

### Must address before / during Plan 4
- **None blocking** — Plan 4 can start fresh. The reconciler builds on existing snapshots; live poller is mostly new code.

### Worth addressing in Plan 5+
- **Player-rankings worker untested** in production. Selectors were speculative. When you actually need rankings, run it via `/admin/run-worker` and inspect the captured raw payload.
- **Playwright fallback for widget-code-lookup** — 169/200 tournaments couldn't be resolved by search alone. Plan 4.5 or 5.
- **Player-profile batch driver** — worker exists but no one tells it which players to refresh. Plan 5.
- **Aggregate validation auto-write to `unresolved_matches`** — Plan 4 plans the validator function but doesn't wire to write the queue. Maybe Plan 5.

### Documentation drift
- **CLAUDE.md** still describes `tournaments.fip_slug` as a live legacy column — actually renamed to `slug` in Plan 1. Should be updated to reflect post-Padelgod schema.
- **Source priority list** in `src/lib/source-priority.ts` doesn't yet include `padelgod` as a source. Will need adding once Plan 4 reconciler ships.

---

## What to do in next session

1. **Read this document first.**
2. **Read `docs/superpowers/plans/2026-04-20-padelgod-04-live-pipeline.md`** — the full Plan 4 spec.
3. **Skim the 3 Padelgod design specs** for context:
   - `docs/superpowers/specs/2026-04-20-padelgod-design.md`
   - `docs/superpowers/specs/2026-04-20-padelgod-api-schema.md`
   - `docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md`
4. **Skim the 3 prior plan docs** if execution patterns are unclear:
   - `docs/superpowers/plans/2026-04-20-padelgod-01-foundation.md`
   - `docs/superpowers/plans/2026-04-20-padelgod-02-discovery-layer.md`
   - `docs/superpowers/plans/2026-04-20-padelgod-03-static-match-data.md`
5. **Set up worktree** for Plan 4: `git worktree add .worktrees/padelgod-live -b feat/padelgod-live`
6. **Use subagent-driven development** to execute Plan 4 task-by-task, dispatching haiku for mechanical work and sonnet for parsers + reconciler logic.
7. **Test against a known-live tournament** (Task 16) — pick one currently happening, flip its `live_source='padelgod'`, watch the poller produce match_points.
8. **Open PR + merge** when all 17 tasks done.
9. **Update CLAUDE.md** to reflect the post-Padelgod schema (slug rename, padelgod schema, etc.) and add Padelgod to the Tech Stack section.

## Production smoke commands

```bash
# Health
curl -s https://padel-live-scores-production-4189.up.railway.app/health | python3 -m json.tool

# Trigger any worker ad-hoc
curl -s -X POST https://padel-live-scores-production-4189.up.railway.app/admin/run-worker \
  -H "Authorization: Bearer <PADELGOD_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"worker":"tournament-discovery"}' | python3 -m json.tool

# Recent scrape jobs
psql/Supabase: SELECT job_type, status, duration_ms, started_at FROM padelgod.scrape_jobs
              ORDER BY started_at DESC LIMIT 20;

# Recently touched tournaments
psql/Supabase: SELECT name, slug, source, last_updated_by, updated_at FROM tournaments
              WHERE last_updated_by = 'padelgod' ORDER BY updated_at DESC LIMIT 10;
```

## Important env vars (already set in Railway)
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (reused from main app)
- `PADELGOD_ADMIN_TOKEN` (rotate after exposing in chat — see security note in conversation history)
- `NODE_ENV=production`
- All 8 worker enable flags (`ENABLE_TOURNAMENT_DISCOVERY=true` etc.)
- For Plan 4: will need `ENABLE_STATIC_RECONCILER=true`, `ENABLE_LIVE_POLLER_MANAGER=true`, `ENABLE_MATCH_STATS_FETCHER=true`

---

## Branch naming convention used

- Feature branches: `feat/padelgod-<area>` (e.g. `feat/padelgod-discovery`, `feat/padelgod-static`)
- Cleanup branches: `fix/padelgod-<topic>` (e.g. `fix/padelgod-plan1-followup`)
- All worktrees go in `.worktrees/<branch-name-suffix>/`
- After merge: `git worktree remove .worktrees/<...>` + `git branch -d <feat-branch>`

---

## When in doubt

- **Code reference for Crionet HTML parsing:** `src/lib/fip-scraper.ts` (main app). Battle-tested patterns for the same widget.
- **Code reference for player resolution:** `src/lib/player-resolver.ts` (main app). 5-tier resolution chain Padelgod's tournament-dictionary builds on.
- **Schema reference:** `CLAUDE.md` — table definitions (note: outdated re: `fip_slug` rename — verify with actual DB).
- **Live data validation:** `docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md` — every endpoint shape we've ground-truthed.

Good luck. The boring infrastructure (8 workers, snapshots, scheduler, admin endpoint) is shipped and proven. Plan 4 is where Padelgod becomes the live source of truth.
