# Coach Normalization + Admin Coaches — Design

**Date:** 2026-10-02
**Status:** Draft — awaiting Gustavo's review
**Scope:** Phase 1 of coach tracking: canonical coach records, a resolver that maps raw FIP coach strings onto them, and an admin UI to review/merge. **Public coach pages are Phase 2 (separate spec)** and are out of scope here, but the schema is shaped for them (slug, status, merged_into).

## Problem

`players.coaches` is a free-text `TEXT[]` scraped from the FIP player profile by padelgod's `player-profile` worker (overwritten every sync). There is no coach entity and no coach ID. Measured 2026-10-02 against prod:

- 922 distinct raw strings across 1,717 players (top 100 men 101/102, top 100 women 100/100 have ≥1 coach).
- Spelling variants of the same person: `Fábio Faísca / Fabio Faisca / Fábio Faisca`, `Martin Dantonio / Martín D’antonio`, `Agustín Gómez Silingo / Agustin Silingo`, `Juan Cabrera / Juan Cabrera Gomez`.
- Junk entries that are not a person: `Juan`, `Alfonso`, `Manual`.
- Look-alike names that are **different** people: `Juan Gutiérrez` ≠ `Juanjo / Juan José Gutiérrez (Vicario)` (decided 2026-09-18).

Any coach-level feature (rankings, pages) needs a stable coach identity first.

## Dry-run evidence (2026-10-02)

Running the PlayerResolver's similarity functions over the 922 strings:

| Step | Result | Verdict |
|---|---|---|
| `normalize()` exact | 922 → 862 | Safe to auto-merge |
| `subsetSimilarity` = 1.0 | 128 pairs; includes `Juan Gutierrez ⊂ Juan Jose Gutierrez` | Suggestion only |
| `typoTolerantSimilarity` ≥ 0.99 | 80 pairs; includes `Manuel Zamora Aguilar ↔ Manual` | Suggestion only, noisy |

Lesson carried over from `d59a7206c` (Momo González conflation): **fuzzy matches must never auto-write an alias.** Coaches have no disambiguators (no category/country/ranking), so this is stricter than for players.

## Decisions

1. **Raw source stays untouched.** `players.coaches` remains the FIP-owned raw field; the `player-profile` worker is not changed. Everything new is derived from it.
2. **Auto-merge only on exact normalized match.** Fuzzy candidates become reviewable suggestions.
3. **Rejections are durable.** A "not the same person" decision is stored and never re-suggested.
4. **Junk is a status, not a deletion.** A junk coach keeps its aliases (so the string keeps resolving to it) but is excluded from stats and future pages.
5. **Linking runs in padelgod** (where the raw data is written), as a new idempotent worker.

## Coach normalizer

`normalizeCoachName(s)` = the existing `normalizeName` from `padelgod/src/lib/db-resolver.ts`, **plus** apostrophes (`' ’ ‘ \``) removed *before* the non-alphanumeric → space step. Fixes `D’antonio` → `dantonio` (dry run left it as `d antonio`, a miss). Whitespace collapsed.

Lives in `padelgod/src/lib/coach-resolver.ts` with the pure suggestion logic; imports `subsetSimilarity` / `typoTolerantSimilarity` directly from `db-resolver.ts` (already exported — no copy-paste).

## Data model (migration `supabase/migrations/20261002_coaches.sql`)

```sql
create table public.coaches (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  normalized_name text not null,
  slug text not null unique,               -- for Phase 2 pages; derived from display_name, de-duplicated with -2, -3
  status text not null default 'unreviewed'
    check (status in ('unreviewed','verified','junk','merged')),
  merged_into uuid references public.coaches(id),  -- set when status='merged'; Phase 2 redirects
  country text,                             -- nullable, operator-set
  avatar_url text,                          -- nullable, operator-set
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index coaches_normalized_name_active
  on public.coaches(normalized_name) where status <> 'merged';

create table public.coach_aliases (
  normalized_alias text primary key,        -- normalizeCoachName(raw)
  coach_id uuid not null references public.coaches(id),
  example_raw text not null,                -- one raw spelling, for display
  source text not null default 'auto'       -- 'auto' (exact normalize) | 'merge' (operator)
    check (source in ('auto','merge')),
  created_at timestamptz not null default now()
);

create table public.player_coaches (
  player_id uuid not null references public.players(id) on delete cascade,
  coach_id uuid not null references public.coaches(id),
  raw_name text not null,                   -- the exact FIP string
  position smallint not null,               -- order on the FIP page
  primary key (player_id, coach_id)
);
create index on public.player_coaches(coach_id);

create table public.coach_merge_suggestions (
  id uuid primary key default gen_random_uuid(),
  coach_a uuid not null references public.coaches(id),
  coach_b uuid not null references public.coaches(id),
  score numeric not null,
  reason text not null check (reason in ('subset','typo')),
  status text not null default 'pending'
    check (status in ('pending','merged','rejected')),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (coach_a < coach_b),
  unique (coach_a, coach_b)
);
```

Plus a read view `coach_stats` (coach_id, player_count, pro_points_sum, men_points_sum, women_points_sum, top player ids) — sums `players.points` over **distinct** players, `coalesce(tier,'pro')='pro'`, excludes `junk`/`merged` coaches. Men/women split kept from day one because summing the two ranking scales is misleading.

RLS enabled on all four tables; no anon policy in Phase 1 (service key only). Phase 2 adds the public read policy.

Applied via pg + `DATABASE_URL` (per repo practice), not `supabase db push`.

## Worker: `coach-linker` (padelgod)

- Schedule: hourly **:50** (after `player-profile` at :30). Flag `enableCoachLinker`, default **off** until the first run is reviewed.
- Steps per run:
  1. Load all players with `cardinality(coaches) > 0` (paginated via `db-paginate`), all `coach_aliases`, all non-merged `coaches`.
  2. For each raw string: `normalizeCoachName` → alias hit? use it. Else exact `normalized_name` hit on a coach? add `auto` alias. Else create coach (`unreviewed`, display_name = raw) + `auto` alias.
  3. Rebuild `player_coaches` for each touched player (delete + insert in one transaction per batch) so coach changes on FIP propagate. A coach with zero players is kept (history), not deleted.
  4. Suggestion pass: for every pair of non-merged, non-junk coaches with ≥2 tokens each, compute subset/typo scores; upsert `pending` suggestions when the pair has no existing row. **Existing `rejected`/`merged` rows are never touched.**
  5. Flag likely junk: a coach whose normalized name is a single token gets a `notes` hint ("single-token name — check if junk"); status stays `unreviewed` (operator decides).
- Result shape: `{ playersScanned, rawStrings, aliasHits, autoAliases, coachesCreated, playerLinksWritten, suggestionsCreated }`.
- Idempotent: a second run with no FIP change writes nothing new.
- Pair count is ~860² / 2 ≈ 370k comparisons on token sets — fine in-process; only new coaches need comparing after the first run (compare new × all).

## Merge semantics (admin action, one Postgres function `merge_coaches(source, target)`)

Atomically: re-point `coach_aliases` (source → target, source='merge'), re-point `player_coaches` (dedupe on PK), set source `status='merged'`, `merged_into=target`, mark the suggestion `merged`, re-point other pending suggestions involving source to target (drop self-pairs and duplicates). Target keeps its display_name unless the operator chose the source's name in the dialog.

Reject = set suggestion `rejected` + `decided_at`. Unmerge is out of scope for Phase 1 (rare; can be done by SQL).

## Seed decisions

After the first linker run, a one-shot script `scripts/seed-coach-decisions.ts` records the decisions already made on 2026-09-18:
- Merge: `Agustin Silingo` → `Agustín Gómez Silingo`; `Sebastian Luis Nerone` → `Sebastián Nerone`; `Jorge Benito` → `Jorge De Benito`.
- Reject: `Juan Gutierrez` ↔ `Juan José Gutiérrez`, `Juan Gutierrez` ↔ `Juan José Gutiérrez Vicario`; `Juan Carlos Rodriguez` ↔ `Juan Manuel Rodriguez`.

Runs only on Gustavo's go-ahead (prod data write).

## Admin UI (`apps/ops`)

New rail entry **Coaches** next to Players. Uses the existing design-system primitives (`PageHeader`, `Panel`, `KpiStrip`, `DataTable`, `Pill`, `Button`) inside `ui-page`; token-driven, both themes.

1. **`/coaches` — list** (tabs: All · Review queue)
   - KPIs: total coaches, unreviewed, pending suggestions, junk.
   - Table: name, status pill, variants count, players, men pts, women pts. Search by name (normalized), filter chips by status. Default sort: pro points desc (this *is* the internal coach ranking).
2. **Review queue tab** — pending suggestions sorted by combined points of both coaches (high-impact first). Each row: both names with their raw variants + top players, score + reason, buttons **Merge → (pick surviving name)** and **Not the same person**.
3. **`/coaches/[id]` — detail**
   - Header: display name (editable), status selector (unreviewed / verified / junk), country, avatar URL, notes.
   - Panels: Aliases (raw spellings + source), Players (linked, with rank/points, link to player page), Pending suggestions for this coach, "Merge into…" picker (search other coaches).
4. **Player detail** — existing `CoachesSection` shows linked coaches as links to `/coaches/[id]`, falling back to the raw string when not yet linked. Manual coach editing in `ProfileSection` stays as is (it edits the raw field; the next linker run picks it up).
5. ⌘K palette: add coaches to `/api/internal/search` results.

API routes under `apps/ops/src/app/api/internal/coaches/*` (list, detail GET/PATCH, merge POST, suggestion reject POST), same auth as the existing internal routes.

## Error handling

- Linker: per-batch transactions; a failing batch is logged and skipped, other batches continue (lesson from the draw-populator whole-batch abort). Counted in result as `batchErrors`.
- Unique violation on `coaches_normalized_name_active` (race with a concurrent run) → re-read and use the existing coach.
- Merge function validates source ≠ target, neither already merged; returns a clear error to the UI.

## Testing

- **Unit (padelgod, vitest):** `normalizeCoachName` and the suggestion generator against a fixture of real strings: `D’antonio`/`Dantonio` exact-merge; `Fábio Faísca` variants exact-merge; `Juan Gutierrez`/`Juan Jose Gutierrez` → suggestion (never auto); single-token `Manual` never pairs with multi-token names; rejected pair not re-suggested.
- **Worker test:** fake Supabase, assert idempotence (2nd run writes nothing), player coach change rewrites `player_coaches`, junk coach still resolves.
- **SQL:** migration ends with `ASSERT` blocks (repo convention); `merge_coaches` tested on a scratch transaction (rollback).
- **Admin:** run locally, verify list, review queue merge/reject, detail edit, both themes.

## Rollout

1. Migration applied (pg + DATABASE_URL).
2. padelgod merge → auto-deploys with `enableCoachLinker=false`; run once manually, review counts against the dry run (~861 coaches, ~128+80 suggestions).
3. Gustavo approves → seed decisions script → enable flag.
4. Admin deploy is manual (`railway up` from `apps/ops`).

## Out of scope (Phase 2+)

Public coach pages + SEO, coach avatars/sourcing, coach history over time (who coached whom when — `player_coaches` is current-state only), pair-based ranking (de-duplicating a coached pair), unmerge UI.
