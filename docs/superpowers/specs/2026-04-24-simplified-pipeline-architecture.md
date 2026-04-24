# Simplified Pipeline Architecture

**Date:** 2026-04-24
**Status:** Design — supersedes `2026-04-24-fip-as-source-of-truth-hybrid-design.md`
**Predecessors:** the hybrid-design doc proposed 6 PRs patching the existing
`static-reconciler`. After a day of discovering bugs at phase boundaries
(synthetic widget IDs, composite-first gates, OOP parser field swap,
silent reconciler failures), we concluded the reconciler itself is the
wrong abstraction — not a fix-more-bugs problem. This doc defines the
simpler replacement.

---

## 1. What's wrong with today

`padelgod/src/workers/static-reconciler.ts` is a 1200-line multi-phase
machine: entry-list → draws → OOP → results. Phases share state (the
tournament dictionary), build a composite identity across multiple steps
(`findOrCreateMatch` has 4 fallback branches), and gate everything on a
`resolveFourNames` function that's fragile to short-form vs long-form
name variations.

Observed failure modes (2026-04-24 Isla de la Palma session):

1. **Synthetic widget IDs** — reconcileDraws wrote
   `"draw:men:main_draw:R32:8"` as the composite key. Crionet's OOP
   widget emits `"MD017"`. Never matched. Fixed in `e633e9b` by
   preferring the real widget id, but the fix itself adds a parallel
   codepath that has to stay in sync with three other places.

2. **Name-resolution gate** — reconcileOOP required all 4 short-form
   names (`"N. Baptista"`) to resolve to fip_ids before doing any work.
   With duplicate player rows in `public.players`, the resolution could
   fail even when the match identity was already sealed by the
   composite. Fixed in `1c133f5` with a composite-first short-circuit.

3. **OOP parser field swap** — Brussels snapshots have `court:
   "Starting at 10:00 AM"` / `scheduled_label: null`. The parser
   wrote the schedule text into the wrong column. The reconciler
   faithfully copied it onto public.matches. (Unfixed — separate bug.)

4. **Silent reconciler failure** — after both fixes deployed, the
   reconciler stopped producing visible DB writes for Isla. Can't tell
   where it stopped without adding more logging. With a single 1200-line
   worker, "where did it silently fail" is a real investigation.

Each of these bugs lives at a **phase boundary**. The reconciler's
design forces every phase to depend on the previous one's outputs via
shared dictionaries and a universal `findOrCreateMatch` helper. Bugs at
boundaries are the hardest to catch and the easiest to introduce.

## 2. Core insight

**Every source already emits the same match identifier.**

| Source | Match-level identifier |
|---|---|
| FIP event-page draw | `data-match-id="MD017"` |
| Crionet OOP widget | `data-id="MD017"` on stats button |
| Crionet results widget | Same |
| Crionet live widget | Same |
| padelapi (when present) | `padelapi_id` in REST response |

Combined with the tournament's Crionet widget code (`FIP-2026-1706`),
the composite `"FIP-2026-1706:MD017"` is **globally unique and emitted
by every source**. If we make it the canonical key from the start,
every source's writer is a simple "find by composite → UPDATE or skip"
loop.

No reconciliation needed. No name resolution. No fallback chains.

## 3. The architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  IDENTITY                                                       │
│  public.matches.widget_id_composite UNIQUE NOT NULL             │
│      format: "{tournament_widget_id}:{match_widget_id}"         │
│      example: "FIP-2026-1706:MD017"                             │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  SEED (one-way, creates rows)                                   │
│                                                                 │
│  fip-draw-fetcher      → padelgod.draw_snapshots                │
│                          (exists — PR 1, kept as-is)            │
│  fip-draw-populator    → public.matches (INSERT or UPDATE null) │
│                          (new — replaces reconcileDraws)        │
│  entry-list-fetcher    → padelgod.entry_list_snapshots          │
│                          (exists, kept)                         │
│  entry-list-populator  → public.players (UPSERT by fip_id)      │
│                          (new — replaces reconcileEntryLists)   │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ENRICH (one-way, updates slices)                               │
│                                                                 │
│  oop-fetcher           → padelgod.oop_snapshots (exists)        │
│  oop-writer            → public.matches.court, court_order      │
│                          (new — replaces reconcileOOP)          │
│  results-fetcher       → padelgod.results_snapshots (exists)    │
│  results-writer        → public.matches.winner_pair, sets,      │
│                          games, status                          │
│                          (new — replaces reconcileResults)      │
│                                                                 │
│  live-poller-manager   → public.sets/games (exists, kept)       │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  PROPAGATE                                                      │
│                                                                 │
│  winner-propagator     → public.matches (next-round pair FKs)   │
│                          pure bracket math, no external I/O     │
│                          (new)                                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## 4. Writer contracts

Every writer follows the same shape:

```typescript
async function run<Writer>(deps): Promise<{ processed, skipped }> {
  // 1. Read the latest snapshot per (tournament, match_widget_id)
  // 2. For each row:
  //    a. Build composite: `${tournamentWidgetId}:${matchWidgetId}`
  //    b. Look up matches by composite via entity_external_ids
  //    c. If found → UPDATE the slice this writer owns (NULL-only or
  //       full overwrite per field policy — see section 5)
  //    d. If not found → skip (log at debug level, no error)
  // 3. Return counters
}
```

**Key constraints:**

- **No name resolution.** Ever. Composite is the only identifier.
- **No `findOrCreateMatch` fallback chains.** Writers don't create —
  `fip-draw-populator` is the ONLY writer that INSERTs into
  `public.matches`. All other writers UPDATE or skip.
- **No shared dictionary building.** Each writer builds what it needs
  from its own snapshot table.
- **Each writer independent.** Failure in `oop-writer` doesn't block
  `results-writer`.
- **Idempotent.** Running a writer twice in a row produces the same
  DB state.

### 4.1 `fip-draw-populator`

**Input:** latest rows per `(tournament_id, match_widget_id)` from
`padelgod.draw_snapshots` WHERE `source='fip_event_page'`.

**Player resolution:**
- Uses `team1_fip_id` / `team2_fip_id` (P###### pair identifiers from
  FIP draw) to look up the team in `entry_list_snapshots` → each team's
  2 `fip_id`s.
- `fip_id` → `public.players.id` via `players.fip_id` column.
- If any of the 4 `fip_id`s don't have a `public.players` row yet, skip
  the whole match. Next run picks it up.

**Writes to `public.matches`:**
- Composite lookup first (via entity_external_ids)
- Not found → `INSERT` with widget_id_composite, pair_player_ids,
  round, category, seeds, draw_position
- Found with null FKs → `UPDATE` null-only (never clobber)
- Found with full FKs → no-op

**Writes to `public.entity_external_ids`:**
- Link composite `{tournamentWidgetId}:{matchWidgetId}` → match.id
- UPSERT, ignoreDuplicates

**Never writes:** status, court, scheduled_at, winner_pair, sets —
those belong to other writers.

**Skip conditions:**
- Tournament has no `widget_id_cache` row (no Crionet code)
- Draw row has bye/placeholder team (non-P `fip_id`)
- Any of the 4 players not in `public.players` yet

### 4.2 `entry-list-populator`

**Input:** latest rows per `(tournament_id, category, fip_id)` from
`padelgod.entry_list_snapshots`.

**Writes to `public.players`:**
- `UPSERT` by `fip_id`
- Fields: name, country, category (whatever the snapshot has)
- Never deletes; never touches rankings, avatar_url, etc.

**Skip conditions:**
- Row has null `fip_id`

### 4.3 `oop-writer`

**Input:** latest row per `(tournament_id, match_widget_id)` from
`padelgod.oop_snapshots` WHERE `match_widget_id IS NOT NULL`.

**Writes to `public.matches`:**
- Composite lookup. Not found → skip.
- `UPDATE` fields: `court`, `court_order` (= `court_position + 1`),
  `round` if non-null.
- Does NOT write `scheduled_at` (stays under operator control via
  Schedule Review panel OR a separate padelapi-derived path — TBD).

**Skip conditions:**
- No composite match
- `match_widget_id` is null in snapshot

### 4.4 `results-writer`

**Input:** latest row per `(tournament_id, match_widget_id)` from
`padelgod.results_snapshots` WHERE `status IN ('finished', 'walkover',
'retired')`.

**Writes to `public.matches`:**
- Composite lookup. Not found → skip.
- `UPDATE` `winner_pair`, `status`, `duration` (if provided).
- Regression guard: don't overwrite existing `status='finished'` (same
  guard current code has).

**Writes to `public.sets`, `public.games`:**
- Parse `set_scores` string → per-set games + tiebreak
- UPSERT sets by `(match_id, set_number)`
- Games: if point-by-point data present in snapshot, upsert by
  `(set_id, game_number)`. Otherwise skip games writes — padelapi
  backfill is the other possible source.

**Skip conditions:**
- No composite match
- Row has `status='scheduled'` (nothing to write)

### 4.5 `winner-propagator`

**Input:** recently-finished matches in `public.matches` with
`draw_position` populated, where the next-round match has all-null
pair FKs.

**Logic:** pure bracket math.

```
R32 match at position N  →  R16 match at position ceil(N/2) team ((N-1)%2)+1
R16 match at position N  →  QF  match at position ceil(N/2) team ((N-1)%2)+1
... and so on
```

Each tournament's bracket size is knowable from `tournament_draws`
row count or `draw_snapshots` aggregation.

**Writes to `public.matches`:**
- `UPDATE` next-round match's pair_player_ids with winning team
- NULL-only (never overwrite)

**Skip conditions:**
- Match has no `draw_position`
- Next-round match already fully populated
- Next round doesn't exist (final)

## 5. Schema decisions

### 5.1 New column: `public.matches.widget_id_composite`

```sql
ALTER TABLE public.matches
  ADD COLUMN widget_id_composite TEXT;

CREATE UNIQUE INDEX matches_widget_id_composite_key
  ON public.matches (widget_id_composite)
  WHERE widget_id_composite IS NOT NULL;
```

Populated at INSERT time by `fip-draw-populator`. Nullable during
migration (existing matches without widget IDs stay null). Going
forward, every new FIP-sourced match has it set.

**Why a new column vs. using `entity_external_ids`:**
- Simpler queries — one JOIN-free lookup
- Enforces uniqueness at DB level (prevents duplicate-key races)
- `entity_external_ids` remains for secondary mappings (padelapi_id,
  future sources)

### 5.2 Deprecated: synthetic widget composites

Rows with `entity_external_ids.external_id LIKE 'draw:%'` get cleaned
up during migration. No code path writes them anymore.

### 5.3 Unchanged: `public.players`, `public.sets`, `public.games`,
`public.tournaments`, `public.entity_external_ids`, all `padelgod.*`
snapshot tables.

## 6. Padelapi's role in the new world

Padelapi becomes a narrow **augmentation layer** for fields FIP/Crionet
don't provide:

| Field | Source |
|---|---|
| `matches.pusher_channel` | padelapi (only — no Crionet equivalent) |
| `matches.started_time` | padelapi > OOP > null |
| `matches.duration` | padelapi > results-writer computed |
| `matches.stats` (service %, winners) | Premier Padel API (already independent) |
| Everything else structural | FIP pipeline above |

The padelapi sync cron (`/api/cron/sync?scope=matches`, already at
30min per the 2026-04-24 change) stays, but narrows its write scope to
just those augmentation fields. Uses `filterUpdateByPriority` from
`src/lib/source-priority.ts` — already built.

**When padelapi has a match FIP doesn't:** skip. These are exceedingly
rare for the event tier we cover (verified by earlier coverage audit:
FIP-slug is a strict superset of padelapi coverage for active-window
tournaments).

## 7. What gets deleted

Once all writers ship and run stable for a week:

- `padelgod/src/workers/static-reconciler.ts` (1200 lines)
- `padelgod/src/lib/tournament-dictionary.ts` (resolveShortName,
  buildTournamentDictionary)
- `padelgod/src/lib/match-identifier.ts::findOrCreateMatch` fallback
  chains (widget-id-lookup-only path stays as a helper)
- `padelgod.unresolved_players` table (can drop once queue is empty)
- `padelgod/src/workers/oop-fetcher.ts::autolinkOopMatches` (the
  bipartite-name linker we built 2026-04-23 — superseded)
- Probably `padelgod/src/lib/oop-linker.ts` (ditto)

Rough LOC delta: **-1500 to -2000 LOC** net.

## 8. What gets kept

- All fetchers (`fip-draw-fetcher`, `entry-list-fetcher`, `oop-fetcher`,
  `results-fetcher`, `widget-code-lookup`, `tournament-discovery`,
  `player-rankings`)
- All snapshot tables (`padelgod.*_snapshots`)
- `live-poller-manager` and friends (Premier live scoring)
- Shadow mode infra (`padelgod.shadow_diff`)
- padelapi sync (narrowed role)

## 9. Migration plan

**Guiding principle:** old reconciler keeps running while new writers
are built. No production risk. No big-bang cutover.

### Step 1 — Design doc (this) + review + schema migration

Ship a migration adding `public.matches.widget_id_composite` column
(nullable). Old reconciler stays oblivious.

### Step 2 — `fip-draw-populator` writer

New worker. Runs on a DIFFERENT cron slot (e.g. `:40`) from the
reconciler (`:05,:35`). Default OFF, dry-run mode on.

When enabled + non-dry-run: creates matches keyed by the new
composite column. Reconciler keeps creating matches keyed by its
synthetic composite. Duplicates allowed temporarily — we'll clean up
at Step 6.

### Step 3 — `oop-writer` + `results-writer`

Both run on separate crons. Default OFF. When enabled: they UPDATE
matches created by the new populator (widget_id_composite NOT NULL).
Reconciler's `reconcileOOP` + `reconcileResults` keep handling old
rows.

### Step 4 — `winner-propagator`

New worker, independent. Can ship before or after writers stabilize.

### Step 5 — Cutover period

For ~1 week, both systems run. Ops dashboards show "source: new | old"
per match. Operators can compare.

### Step 6 — Retire reconciler

One PR:
- Delete static-reconciler + imports
- Delete synthetic widget_id rows (`DELETE FROM entity_external_ids
  WHERE source='crionet_widget' AND external_id LIKE 'draw:%'`)
- Delete duplicate matches (matches with `widget_id_composite IS NULL`
  that correspond to a matches row with the composite set)
- Delete unused helpers

### Step 7 — Ops visibility

Tournament Explorer Matches tab: merge `padelgod.*_snapshots` into a
single view (done today for OOP via the Schedule Review panel merge
— extend the pattern to Results). No more "unlinked" count since every
writer is composite-keyed.

## 10. Separate from this migration

**OOP parser field-swap bug** (Brussels `court: "Starting at 10:00 AM"`
etc.) — unrelated to architecture. Ship as independent PR whenever
convenient. Lives in `padelgod/src/parsers/crionet-oop.ts`.

## 11. Open questions

### 11.1 `scheduled_at`

Writers intentionally don't touch `scheduled_at`. Current sources:

- padelapi's `played_at + schedule_label` (date + time string)
- OOP Schedule Review panel (operator-approved)
- No FIP-native equivalent (event page only has day-level granularity)

Proposal: **padelapi's narrowed sync path owns `scheduled_at`**. When
padelapi has schedule_label, the sync writes UTC time (same logic as
today's `sync/route.ts:589`). OOP Schedule Review remains the
operator override.

This is the only structural field padelapi keeps authority over.
Accepted trade-off.

### 11.2 Coverage gap for non-FIP tournaments

The new pipeline requires a tournament to have a FIP event page.
Verified earlier that this is a strict superset of padelapi coverage.
If a future tournament ends up in padelapi but not FIP: it stays in the
old sync path (matches without `widget_id_composite`). Ops dashboard
flags this so we notice.

### 11.3 Premier live tournaments

Live-poller-manager already works independently of the reconciler.
After migration it continues to key matches by widget composite. No
change to live pipeline.

### 11.4 Orphan-match cleanup during migration

During Step 5 (cutover period), we'll have duplicate matches for the
same real-world match — one from reconciler (synthetic key), one from
populator (real key). Cleanup happens at Step 6.

**Safety:** before deleting synthetic-keyed matches, verify each has a
composite-keyed twin with same 4 pair FKs. If not, keep the old row
(operator investigation). Done via a one-off SQL script, not a
worker.

## 12. PR sequence + estimates

| PR | Scope | LOC | Risk | Estimate |
|---|---|---|---|---|
| 1 | Schema migration + design doc (this) | ~50 | Low | 30 min |
| 2 | `fip-draw-populator` worker + tests | ~400 | Low (dry-run default) | 6-8h |
| 3 | `entry-list-populator` worker + tests | ~300 | Low | 3-4h |
| 4 | `oop-writer` worker + tests | ~250 | Low | 3-4h |
| 5 | `results-writer` worker + tests | ~350 | Low | 4-5h |
| 6 | `winner-propagator` worker + tests | ~250 | Low | 3-4h |
| 7 | Ops visibility + source badges | ~200 | Very low | 2-3h |
| 8 | Retire reconciler + cleanup script | -2000 | Medium (deletes prod code) | 3-4h + 1wk supervised |

**Total code time: ~25-30h across 8 PRs.** Plus review + deploy cycles.
Pace: one PR every few days at comfortable speed. Complete within
~3 weeks calendar time without rush.

## 13. Today's landed work — honest accounting

Two fixes shipped 2026-04-24 (`e633e9b`, `1c133f5`) are patches on the
old architecture. In the new architecture they're DELETED along with
the reconciler itself. They weren't wasted — they proved two things:

1. Real widget composites ARE the right identity key end-to-end.
2. The composite-first short-circuit pattern IS the right default
   (so much so that in the new design there IS no "second path" to
   short-circuit to — composite-only, no name resolution anywhere).

## 14. Success criteria

Architecture is "done" when:

- `fip-draw-populator` runs hourly without errors for 7 days
- All active tournaments have 100% of their matches keyed by
  `widget_id_composite`
- `oop-writer` + `results-writer` produce 0 silent-skip rows for
  tournaments with full FIP data
- Static reconciler deleted, no regressions observed for 7 days
- Code review: 8 small PRs, each independently revertable
- Net LOC: -1500 to -2000
- Debug cycle on a pipeline bug: minutes, not hours

## 15. What happens next

**Immediate (today):** commit this design doc to main. Nothing else.

**Next session:** start PR 1 — schema migration + `fip-draw-populator`
skeleton with dry-run mode on. First real code ~5h focused work.

**Meanwhile:** old reconciler keeps running. The Schedule Review
Apply panel (shipped earlier today) remains the operator-approved
path for OOP → public.matches merges.
