# Padelgod — Session State (handoff)

**Last updated:** 2026-04-20 (end of Plan 4 static-pipeline session)

This document captures everything a fresh session needs to pick up Padelgod work cleanly. **Read this first** before continuing Plan 4 work.

---

## TL;DR

**What Padelgod is:** a separate Railway-deployed Node service that scrapes FIP/Crionet for tournaments, players, draws, OOP, results, and (eventually) live scoring. Eventually replaces `padelapi.org` as the live data source for the Next.js app.

**Where we are:** Plans 1–3 are shipped to production. Plan 4 is **~65% complete on branch `feat/padelgod-live`** (pushed to origin). All static-data plumbing and the match-stats pipeline land with tests. The live-polling libs (Tasks 11–15) were deliberately deferred — they build on Task 11's PointState comparator, which is the highest-risk component in the plan and needs fresh attention.

**Next step:** Resume Plan 4 from Task 11 on branch `feat/padelgod-live`. Spec at `docs/superpowers/plans/2026-04-20-padelgod-04-live-pipeline.md`.

---

## Plan 4 progress (2026-04-20)

| Task | Status | Commit | Notes |
|---|---|---|---|
| 0 — Relay live_source gate | ✅ shipped | `12b3cb8` + `86095e5` | Gates relay subscriptions on `tournaments.live_source='padelapi'`; 60s reconciliation timer with in-flight guard; SIGTERM cleanup. Must deploy to Railway before Task 16. |
| 1 — Migrations 016 + 017 | ✅ shipped | `3286477` | `padelgod_tournaments_for_live_polling()` RPC + partial index on entity_external_ids for crionet_widget matches. |
| 2 — Parser version constants | ✅ shipped | `90949ab` | Added CRIONET_TOURNAMENTLIVE_VERSION + CRIONET_MATCH_STATS_VERSION. |
| 3 — Tournamentlive parser | ✅ shipped | `ae0b42c` | 5 tests including one against a real Brussels P2 production fixture (`crionet-tournamentlive-brussels.html`). |
| 4 — Match identifier lib | ✅ shipped | `31ccda7` | 7 tests. Includes the pair-based fallback that prevents duplicate matches between draw and OOP/results reconciliation. |
| 5 — Static reconciler: entry list → players | ✅ shipped | `95e8e82` | 4 tests. Diff-checked updates (not blind upserts) + null-safe field handling. |
| 6 — Static reconciler: draws | ✅ shipped | `bece87e` | 3 tests. Synthesizes `draw:{category}:{draw_type}:{round}:{position}` widget id so OOP/results can link via pair-fallback. One tournament_draws row per team (team1→2N-1, team2→2N). |
| 7 — Static reconciler: OOP + results | ✅ shipped | `61c4255` | 3 tests. Writes real widget id via `padelgod.widget_id_cache`. Skips tournaments without a cached widget code. `score_source='api'` on sets. `scheduled_at` parsing deliberately deferred to main app's OOP review workflow. |
| 8 — Wire static-reconciler in scheduler | ✅ shipped | `7cab6f2` | Cron `5,35 * * * *`. Added `ENABLE_STATIC_RECONCILER` flag. |
| 9 — Match stats parser | ✅ shipped | `23c8225` | 3 tests. Real Brussels P2 fixture (`crionet-match-stats-brussels.html`). Parses 14 stat dimensions × 3 tabs (aggregate + per-set). |
| 10 — Match stats fetcher worker | ✅ shipped | `b4fdd94` | 7 tests. Finds finished Crionet-widget matches without stats, POSTs /screen/getmatchstats, upserts match_stats with `source='crionet_widget'`. Skips synthetic draw widget ids. Cron `25 * * * *`. |
| **11 — Live state diff lib + PointState** | 📝 **doc written, NOT executed** | — | **HIGHEST RISK.** Deferred deliberately. See "Why Task 11 is deferred" below. |
| 12 — Point reconstruction lib | 📝 depends on Task 11 | — | |
| 13 — Live poller loop | 📝 depends on Task 11 + 12 | — | |
| 14 — Live poller manager worker | 📝 depends on Task 13 | — | |
| 15 — Wire live-poller-manager in scheduler | 📝 depends on Task 14 | — | |
| 16 — Smoke test on Brussels P2 (manual) | 📝 needs Tasks 11–15 + Task 0 deploy | — | |
| 17 — Push branch + open PR + merge | 📝 blocked on Tasks 11–15 | — | Branch already pushed to `origin/feat/padelgod-live`. |

**Tests: 72 baseline → 105 after Task 10** (+33 Plan-4 tests). Target is ~125 when Tasks 11–15 land (the comparator alone has 16 tests in the spec).

**TypeScript: clean throughout all 11 commits.**

### Commit order on `feat/padelgod-live`
```
b4fdd94 feat(padelgod): add match-stats-fetcher worker
23c8225 feat(padelgod): add Crionet match stats parser
7cab6f2 feat(padelgod): wire static-reconciler into scheduler
61c4255 feat(padelgod): static-reconciler — OOP + results → matches + sets
bece87e feat(padelgod): static-reconciler — draw → tournament_draws + matches
95e8e82 feat(padelgod): add static-reconciler (entry list → players, V1)
31ccda7 feat(padelgod): add match-identifier lib (find or create canonical match)
ae0b42c feat(padelgod): add Crionet tournamentlive parser
90949ab feat(padelgod): add Plan 4 parser version constants
3286477 feat(db): add Plan 4 live pipeline helpers (RPC + index)
86095e5 fix(relay): skip periodic sync tick if previous still in-flight
12b3cb8 feat(relay): gate subscriptions by tournaments.live_source (Padelgod cutover prep)
```
All pushed to `origin/feat/padelgod-live`.

---

## Why Task 11 is deferred

Task 11 is the `PointState` discriminated union + exhaustive comparator. The plan pressure-test amendment (commit `025812c` on main) explicitly called out this as the highest-risk component because a naive string diff gets deuce/AD/golden-point transitions wrong in ways that silently miscredit points for weeks before anyone notices.

The plan spec contains:
- An explicit comparator truth table covering 13 transition classes
- 16 required tests covering every row of the truth table

This deserves full context attention. The right move is a fresh session where the comparator is the primary focus, not rushed at the tail end of a long implementation run.

Pre-req note from Task 3 that Task 11 MUST honor: the real Crionet widget emits `"Ad"` (mixed case), not `"AD"`. `parsePointState` must be case-insensitive on these labels.

---

## Production state (unchanged from previous session)

### Service deployment
- **Railway service:** `padel-live-scores-production-4189.up.railway.app`
- **Container port:** 8080 (Railway auto-injects `PORT`; app reads `env.PORT`)
- **Health endpoint:** `GET /health` returns 200 with `{ status, uptime_seconds, version }`
- **Admin endpoint:** `POST /admin/run-worker` — Bearer auth via `PADELGOD_ADMIN_TOKEN`. Body: `{ "worker": "<name>" }`. Triggers any worker ad-hoc.

### Active scheduler (will be 10 workers after Plan 4 merge)

Currently 8 in production; branch `feat/padelgod-live` adds 2 more (`static-reconciler`, `match-stats-fetcher`). Plan 4 Tasks 14–15 will add one more (`live-poller-manager`), bringing the total to 11.

| Worker | Cron | Status |
|---|---|---|
| `tournament-discovery` | `0 * * * *` | prod |
| `widget-code-lookup` | `15 * * * *` | prod |
| `entry-list-fetcher` | `45 * * * *` | prod |
| `oop-fetcher` | `50 * * * *` | prod |
| `results-fetcher` | `55 * * * *` | prod |
| `draw-fetcher` | `20 */2 * * *` | prod |
| `player-rankings` | `0 5 * * *` | prod |
| `player-profile` | `30 * * * *` | prod (stub) |
| **`static-reconciler`** | `5,35 * * * *` | on branch (Task 8) |
| **`match-stats-fetcher`** | `25 * * * *` | on branch (Task 10) |
| `live-poller-manager` | `*/1 * * * *` | pending (Task 15) |

### Current DB state (from 2026-04-20 smoke checks)
- 106 widget codes cached (`padelgod.widget_id_cache`)
- Brussels P2 padelapi row `b91c4c7d-dfdf-47bd-af99-e6d97515634e` is the Task 16 smoke-test target. Widget code `FIP-2026-1701` (confirmed via Crionet search, not yet in cache — insert manually during Task 16).
- 0 FIP tournaments currently live have cached widget codes (widget-code-lookup gap — Playwright fallback is Plan 4.5 / 5).
- Cross-source tournament dup: TWO Brussels P2 2026 rows. Use the padelapi-sourced one with proper dates, NOT the FIP-discovered stub (`8ef5752c`, dates=NULL).

---

## What to do in next session

1. **Read this document first.**
2. **Re-read Task 11 in `docs/superpowers/plans/2026-04-20-padelgod-04-live-pipeline.md`** — the full PointState + comparator spec with the 13-row truth table and 16 tests.
3. **Checkout the branch:** `git worktree add .worktrees/padelgod-live-resume feat/padelgod-live` (or reuse `.worktrees/padelgod-live/` if still present locally; it's gitignored — check first).
4. **Run baseline:** `cd padelgod && npm test` — should be 105/105 before starting Task 11.
5. **Task 11 is the anchor.** Tasks 12, 13, 14, 15 all build on its types. Implement 11 carefully with a subagent, full spec-review + code-quality review pass. After 11, Tasks 12–15 can be dispatched more mechanically.
6. **Task 16 prereqs:**
   - Deploy `relay/index.js` Task 0 changes to Railway (the gate). Verify unsubscribe log line fires on test tournament flip.
   - Manually insert `padelgod.widget_id_cache` row for Brussels P2 with `widget_id='FIP-2026-1701'`, `is_active=true`.
   - Verify SQL: `SELECT count(*) FROM matches WHERE status IN ('live','ended') AND pusher_channel IS NOT NULL AND tournament_id IS NULL;` must be 0 (the relay gate's `!inner` join would silently drop orphan-tournament matches otherwise).
   - Apply migrations 016 + 017.
   - Then flip `tournaments.live_source='padelgod'` for Brussels P2 row `b91c4c7d` and watch for match_points writes.

---

## Critical knowledge / gotchas (carry-forward + new)

### Carry-forward from previous session
1. **Custom schemas need explicit grants** — already captured in migration 015.
2. **PostgREST onConflict needs full UNIQUE constraint, not partial index.**
3. **Migrations must live at repo-root `supabase/migrations/`.** Subagents occasionally drop them under `padelgod/supabase/migrations/` by accident — always double-check on commit.
4. **Specify absolute paths in subagent dispatches** — especially the worktree root.
5. **Validate parsers against REAL HTML.** Plan 3's speculative HTML fixtures produced silent parser bugs. Both parsers in this session (tournamentlive + match stats) use real fetched fixtures committed alongside the tests.
6. **Tournamentlive emits `"Ad"` mixed case**, not `"AD"`. Task 11's parser contract must be case-insensitive.
7. **`external_id` legacy column is nullable** (migration 015).
8. **Active-tournament RPCs** require `source='fip'` AND widget_id_cache AND date window — respect the filter when testing.

### New this session
9. **tournament_draws has no `round` column.** First Task 6 dispatch tried to upsert one; removed before commit. CLAUDE.md schema doesn't list `round` — trust the migration file.
10. **TypeScript cast for Supabase client:** `(rows ?? []) as unknown as T[]` — direct cast gets a "no overlap" error because Supabase's typed client returns narrow error types.
11. **`match_stats` stores raw counts, not percentages.** The Crionet parser gives percentages so we write structured columns only for the count-native fields (service_games, return_games, longest_streak) and put full percentages in `raw_payload` JSONB. Tagged `source='crionet_widget'` to distinguish from premierpadel-sourced rows.
12. **Composite widget id format is load-bearing.** `${tournamentWidgetId}:${matchWidgetId}` e.g. `"FIP-2026-1701:MQ012"`. Task 6 uses a synthetic `"draw:..."` prefix; Task 7 uses the real tournament widget code from `padelgod.widget_id_cache`; Task 10's fetcher skips synthetic ids when POSTing to Crionet. When OOP/results (Task 7) sees a real widget for a match that Task 6 already created under a synthetic id, `findOrCreateMatch`'s pair-based fallback links them — no duplicate row.
13. **Subagent commits to worktree:** verify `git branch --show-current` returns `feat/padelgod-live` at the start of every subagent dispatch prompt. A previous Plan 3 cleanup commit landed on `main` accidentally.
14. **Rate limit resets in subagent dispatches** — the Task 6 dispatch hit a model rate limit mid-implementation. Uncommitted state was salvaged via diff inspection + manual fix (column bug) + tests-authoring. Worth knowing if it happens again: the subagent's partial work is still in the working tree.

---

## Open issues / known TODOs

### Must address before Task 16 cutover
- **Relay Task 0 deployed to Railway** — must land in prod before flipping any tournament.
- **Migrations 016 + 017 applied to Supabase.**
- **Brussels P2 widget_id manually seeded** into `padelgod.widget_id_cache`.
- **Orphan-tournament matches query** returning 0 (see precondition in Task 16 step 1).

### Worth addressing in Plan 5+
- **Playwright fallback for widget-code-lookup** — 169/200 tournaments still unresolved by search alone.
- **Player-profile batch driver** — worker exists but no one tells it which players to refresh.
- **Percentage → count back-derivation for match_stats** — V1 leaves first/second serve counts NULL. UI reads percentages from `raw_payload` for Crionet source. If we ever need structured counts, this requires an upstream data model change.
- **Cross-source tournament dedup** — Brussels P2 has two rows (source=fip stub, source=padelapi canonical). Affects anyone searching by name. Deferred to a manual script + UI.

---

## Production smoke commands

```bash
# Health
curl -s https://padel-live-scores-production-4189.up.railway.app/health | python3 -m json.tool

# Trigger a worker ad-hoc (after next deploy — will include new workers)
curl -s -X POST https://padel-live-scores-production-4189.up.railway.app/admin/run-worker \
  -H "Authorization: Bearer <PADELGOD_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"worker":"static-reconciler"}' | python3 -m json.tool

curl -s -X POST https://padel-live-scores-production-4189.up.railway.app/admin/run-worker \
  -H "Authorization: Bearer <PADELGOD_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"worker":"match-stats-fetcher"}' | python3 -m json.tool

# Recent scrape jobs
psql/Supabase: SELECT job_type, status, duration_ms, started_at FROM padelgod.scrape_jobs
              ORDER BY started_at DESC LIMIT 20;
```

---

## Branch naming convention used

- Feature branches: `feat/padelgod-<area>` (e.g. `feat/padelgod-live` — current)
- Cleanup branches: `fix/padelgod-<topic>`
- All worktrees go in `.worktrees/<branch-name-suffix>/`

---

## When in doubt

- **Code reference for Crionet HTML parsing:** `src/lib/fip-scraper.ts` (main app) — battle-tested patterns. Also the 3 new parsers in `padelgod/src/parsers/` now: `crionet-tournamentlive.ts`, `crionet-match-stats.ts`, plus Plan 3's `crionet-draw.ts` / `crionet-oop.ts` / `crionet-results.ts`.
- **Code reference for player resolution:** `padelgod/src/lib/tournament-dictionary.ts` (Plan 3).
- **Code reference for match identity:** `padelgod/src/lib/match-identifier.ts` — the pair-based fallback is load-bearing for Task 6 ↔ Task 7 deduplication.
- **Schema reference:** `CLAUDE.md` — table definitions. Verify against actual migration SQL when in doubt.
- **Live data validation:** `docs/superpowers/specs/2026-04-20-padelgod-live-data-validation.md` — every endpoint shape ground-truthed. Task 11's PointState work leans heavily on §4.

Good luck. The static pipeline + match stats fetcher are solid. Plan 4 Task 11's comparator is the remaining hard piece.
