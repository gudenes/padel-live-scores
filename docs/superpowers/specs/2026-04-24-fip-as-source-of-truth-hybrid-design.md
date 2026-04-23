# FIP as Source of Truth — Hybrid Architecture Design

**Date:** 2026-04-24
**Status:** Scoping
**Context:** Session 2026-04-23 ended with agreement to pivot away from
padelapi-centric ingestion toward FIP-native match creation, with
padelapi retained as a backup/fallback source. PR 2 (`feat/fip-draw-linker`)
was paused because its linker-onto-padelapi-rows approach is the wrong
architecture under this new direction.

---

## 1. The problem we're solving

The current architecture uses padelapi as the authoritative source for
match structure (round, pair identity, seeds, schedule). Symptoms of this
being the wrong choice:

1. **Brussels P2 QF gap** — padelapi creates QF match rows with NULL
   player FKs when the feeding R16s haven't finished. FIP already
   published the QF pairings days earlier (Brea/Triay vs Salazar/Alonso,
   etc.) but we can't use that data because our pipeline trusts padelapi.

2. **Widget-ID linking via name overlap** — PR 2's approach. Works only
   when public.matches has populated player FKs. Fails on the exact
   cases (QFs, TBD slots) where linking would be most valuable.

3. **Rate limits** — padelapi caps us at 10 req/min, 2000 req/day. Live
   tournaments require ~50-100 match detail fetches per cron run. We
   burn most of the daily budget on structural data that FIP publishes
   for free, with no rate limit, more completely, and earlier.

4. **Latency** — FIP publishes draws ~72h before day 1. Padelapi often
   takes 24-48h to catch up. We're always operating on stale data.

## 2. What FIP gives us vs. what padelapi gives us

| Field | FIP native | padelapi native |
|---|---|---|
| Tournament list | ✅ `/wp-json/wp/v2/events` | ✅ `/api/tournaments` |
| Full bracket (pre-tournament) | ✅ event-page AJAX | ❌ only filled as matches play |
| Widget IDs (MD001…) | ✅ `data-match-id` | ❌ |
| Pair identity (P######) | ✅ `data-single-team` | ❌ (only individual player IDs) |
| Seeds + markers (Q/WC/LL) | ✅ | 🟡 partial |
| Entry list | 🟡 via Crionet entry-list | ✅ always |
| Live scores | ❌ (use Crionet tournamentlive) | ✅ (Pusher) |
| Point-by-point history | ❌ | ✅ (Pusher) — UX downgrade if lost |
| Final scores + winner | ✅ (FIP draw shows) | ✅ |
| `played_at` (schedule date) | 🟡 via OOP | ✅ |
| `schedule_label` (time) | 🟡 via OOP | ✅ |
| Court + court_order | ❌ (use Crionet OOP) | 🟡 |
| Stats (service %, winners) | ❌ | ✅ via Premier beforeauth API (already independent) |
| Tournament metadata (dates, country, logo) | ✅ | ✅ |

**Conclusion:** FIP wins on bracket structure; padelapi wins on live
point-by-point and real-time schedule. Hybrid carves cleanly along this
line.

## 3. Target source-of-truth matrix

| Field | Primary | Fallback | Notes |
|---|---|---|---|
| Tournament entity | FIP | padelapi | Already done via `fip-wp-events` discovery |
| Match entity (structure) | **FIP draw** | padelapi | Match row CREATED from FIP draw, not padelapi |
| `widget_id` (new column) | FIP draw | — | Natural primary lookup key going forward |
| `draw_position` (new column) | FIP draw | — | Enables deterministic winner propagation |
| `round`, `category` | FIP draw | padelapi | |
| Player FKs (pair1_player1_id etc.) | **FIP draw → winner propagation** | padelapi | FIP fills initial + propagator fills next rounds |
| Player entity | FIP entry list | padelapi | Resolve by fip_id, then name |
| Seeds | FIP draw | padelapi | New column `team1_seed`, `team2_seed` |
| `scheduled_at`, `schedule_label` | padelapi (OR OOP review) | FIP date-only | padelapi has real times; FIP only has day |
| `court`, `court_order` | Crionet OOP | padelapi | OOP parser already handles this |
| Live scores (sets/games/points) | Crionet tournamentlive (padelgod live-poller) | padelapi Pusher | Keep both during transition |
| Point-by-point history | padelapi Pusher | Crionet polled | UX-critical; keep Pusher until we're confident |
| Final scores + winner | Crionet results widget | padelapi | Crionet surfaces faster |
| Match stats | Premier Padel API | — | Already independent |

## 4. Answer to "does this solve the QF problem"

**Yes** — PR B below creates FIP-native match rows with populated player
FKs directly from draw data. The Brussels QFs get their 4 player FKs
written as soon as FIP publishes the draw, not when padelapi catches up
after the R16s finish.

## 5. Phased PR plan

### PR A — Schema prep
**Goal:** make the DB able to hold FIP-native match identity.

Changes:
- Migration: add columns to `public.matches`:
  - `widget_id TEXT` with partial `UNIQUE` index `WHERE widget_id IS NOT NULL`
  - `draw_position INT` (nullable; set for FIP-sourced rows, null for legacy)
  - `team1_seed INT`, `team2_seed INT` (nullable)
  - `source TEXT DEFAULT 'padelapi'` — values `'padelapi' | 'fip_draw' | 'manual'`
- One-time backfill script: populate `widget_id` on existing rows from
  `entity_external_ids` where `source='crionet_widget'`.
- Update `src/lib/source-priority.ts` with rules for the new fields:
  - `match.widget_id`: fip_draw > padelapi
  - `match.draw_position`: fip_draw only
  - `match.pair_player_ids`: fip_draw > padelapi (but NULL-only protection)
  - `match.seeds`: fip_draw > padelapi
- Tests for the priority helpers.

**Risk:** low. Additive-only schema, no data migration.
**Estimate:** 2-3h.

### PR B — FIP match creator (replaces current PR 2)
**Goal:** CREATE public.matches rows from FIP draw data (not just link
to existing ones). Solves the QF problem.

Changes:
- New padelgod worker `fip-match-creator.ts`:
  1. For each active tournament with fip slug + widget_id_cache row
  2. Load latest `draw_snapshots` per widget_id (from PR 1)
  3. For each draw row with both teams as real pairs (P-prefix):
     a. Resolve 4 player names → UUIDs via `players` table (match by
        normalized_name + category)
     b. If player doesn't exist: create with `fip_id` from entry list if
        known, else name-only
     c. Query `public.matches` by `widget_id` column:
        - Not exist → INSERT with full structural data
        - Exists → UPDATE NULL-only pair_player_ids (same safety rails
          as current PR 2 but additionally populates structure)
     d. Write `entity_external_ids` composite linkage
  4. Dry-run mode (default true), same pattern as PR 2
- Scheduler: hourly at `:40` (after fip-draw-fetcher at `:35`)
- Tests: player resolution, insert-new path, update-null path, dry-run,
  bye/placeholder skip logic

**Risk:** medium. Writes canonical data (pair_player_ids, possibly
`matches` inserts). Mitigated by dry-run default + NULL-only update rule.

**Estimate:** 5-7h.

### PR C — Winner propagation worker
**Goal:** when a match finishes, automatically populate the next-round
match's pair from the winner.

Changes:
- New padelgod worker `fip-winner-propagator.ts`:
  1. Find matches where `status='finished'`, `winner_pair IS NOT NULL`,
     `draw_position IS NOT NULL`, AND `next_round_pair_filled = false`
     (track via a marker column or check downstream match's FKs)
  2. Compute next-round match via bracket math:
     - R32 position 1 → R16 position 1 team_a
     - R32 position 2 → R16 position 1 team_b
     - R32 position 3 → R16 position 2 team_a
     - ... (standard bracket advancement)
  3. NULL-only UPDATE on the next match's pair_player_ids
- No external calls — all reads from our own DB
- Runs frequently (every 5 min) since matches finish in real time
- Tests: bracket math correctness for 32/16/8/4/2 draw sizes, doesn't
  overwrite non-NULL FKs, handles walkover/retired statuses correctly

**Risk:** low-medium. Writes pair_player_ids, but only to NULL slots
and only from proven-finished feeding matches. Bracket math is trivial
to test.

**Estimate:** 3-4h.

### PR D — Narrow padelapi sync writes
**Goal:** stop padelapi sync from overwriting FIP-sourced structural
data.

Changes:
- `src/app/api/cron/sync/route.ts`:
  - Before updating a match row, check `source`:
    - If `source='fip_draw'`: only write fields where padelapi is
      primary (schedule_label, scheduled_at with time, started_at,
      duration, live live/finished transitions)
    - If `source='padelapi'`: behave as today
  - Use `filterUpdateByPriority()` from `source-priority.ts` (already
    exists) with mode='update'
- Log every skipped-write so we can see divergence events
- Tests

**Risk:** low. Already have the priority framework in place.
**Estimate:** 2-3h.

### PR E — Ops visibility
**Goal:** operators can see which matches came from which source and
debug divergence.

Changes:
- `/ops` Tournament Explorer: add "Source" column showing source per
  match + icon (FIP / padelapi / manual)
- New ops tab or page: "Divergence log" — matches where padelapi tried
  to write something different from what FIP already had. Pulled from
  the logs we added in PR D.
- Filter by source + sorting

**Risk:** very low. Read-only UI.
**Estimate:** 3-4h.

### PR F (later) — Live scoring departure
**Goal:** make Crionet the sole live score source for tournaments with
widget_id coverage. Retire padelapi Pusher path for those.

Gate on evidence:
- 7 days of shadow-diff data with <1% per-point divergence
- All currently-active Premier events confirmed to have Crionet widgets
- User confirmation that ~5s polling resolution is acceptable for the
  momentum chart

Changes:
- Promote `padelgod.live-poller-manager` shadow mode to canonical for
  tournaments where `widget_id_cache.is_active=true`
- `src/app/api/cron/scores/route.ts`: skip tournaments with widget_id
- Relay service: keep running but scope it to tournaments WITHOUT
  widget_id (Pusher-only fallback path)
- Audit logs + dashboard for first week post-cut

**Risk:** high. User-facing live-score behaviour changes. Requires
confidence from shadow-diff data before we pull the trigger.
**Estimate:** 6-10h + 1-2 weeks of supervised operation.

## 6. Ordering and dependencies

```
PR A (schema)  →  PR B (match creator)  →  PR C (propagator)
                            ↓                       ↓
                       PR D (sync narrowing) ← ─ ─ ─ ┘
                            ↓
                       PR E (ops visibility)
                            ↓
                       PR F (live scoring departure, gated on data)
```

- PR A is prerequisite for B and D (need `source` column + source-priority rules)
- PR B is prerequisite for C (propagator needs `draw_position` column populated)
- PR D is best after B+C stabilize so we don't narrow padelapi prematurely
- PR E can be done anytime after A (doesn't change behaviour)
- PR F is gated on operational confidence, not code readiness

## 7. Rollout strategy

**Week 1:** PR A + PR B. Default dry-run. Observe Brussels QFs getting
proposed with full player FKs. Flip to writes once a 24h dry-run looks
clean. Brussels QF problem solved end of week 1.

**Week 2:** PR C + PR D. Winner propagation live. padelapi sync narrows
itself naturally. Watch divergence log.

**Week 3:** PR E. Ops has full visibility into the two-source world.

**Week 4+:** decide whether PR F (live departure) is worth it based on
shadow-diff data.

## 8. What gets deleted / deprecated eventually

Once this lands end-to-end:
- Current PR 2 (`feat/fip-draw-linker`) — superseded by PR B. Close PR
  without merging.
- The `oop-linker.ts` + `autolinkOopMatches` path stays — still useful
  for non-FIP tournaments (none today, but headroom for the future).
- `findPadelapiTwin` court-swap logic stays — still valid for
  padelapi-primary tournaments.
- Long-term (PR F): `scores` cron, Pusher relay, Pusher channel
  discovery. Historical `matches.padelapi_id` column stays forever
  (immutable references in old data).

## 9. Open questions to resolve before PR B

1. **Entry list fallback for Premier events.** Crionet entry-list
   returns "coming soon" for Premier tournaments — the fip-draw gives
   us player names but not per-player fip_ids. Options:
   - (a) Resolve by name+category only; accept occasional miss
   - (b) Scrape FIP player-profile pages on-demand when name isn't found
   - (c) Ignore for Premier (fall back to padelapi for those)
   Decision: probably (a) with (b) as backup on miss.

2. **draw_position encoding.** FIP widget IDs like MD001 — is the number
   always the bracket position, or is it capture order? Need to verify
   on real data before relying on it for propagation (PR C).

3. **Qualifier advancement.** Q2 winners go to main draw R32 (or R16?).
   Propagation rule needs to cross the Q→MD boundary. This is a
   tournament-specific detail. Defer to PR C scoping.

4. **Entry list data source long-term.** Currently Crionet widget.
   Eventually should come from FIP entry list page (scrape) if
   available, for parity with FIP-draw primary.

## 10. Immediate next action (tomorrow)

- Check whether `tournaments.timezone` is populated for Brussels
  (suspected root cause of missing `scheduled_at` time on padelapi
  payload — separate issue from the FIP migration, but worth a 5-min
  check)
- Close PR 2 on GitHub without merging (leave the branch for reference;
  commits describe the failed approach)
- Start PR A — schema migration + source-priority rules update
