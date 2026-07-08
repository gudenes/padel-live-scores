# Tournament Entry List Tab — Design

**Date:** 2026-07-08
**Status:** Approved design, pre-implementation
**Author:** brainstormed with gudenes

## Summary

Add a dedicated **Entries** tab to the tournament detail page that surfaces the
tournament's entry list **as soon as it is published** — well before the draw
exists. Today the tournament page shows nothing about who is playing until the
draw lands (which powers the Draw and Projection tabs). Entry lists publish days
to weeks earlier, so this fills a real dead-air window with high-value content,
including for FIP-tier events that never get a Projection tab at all.

The user-facing view already exists as an orphaned presentational component
([`src/components/EntryList.tsx`](../../../src/components/EntryList.tsx)); the
data already exists in `padelgod.entry_list_snapshots`. The work is bridging the
two with a public table + a read path, and mounting the component as a new tab.

## Motivation

Direct user feedback: the entry list is worth showing in the tournament page. We
have the capability but only expose it (implicitly, via the draw) once the draw
is available. Entries are known long before that.

## Current state

- **View:** [`EntryList.tsx`](../../../src/components/EntryList.tsx) is a complete
  presentational component — "Top Seeds" hero rows (seed number in gold mono,
  overlapping 42px avatars with flag corner-chips, green `#rank` badges,
  monospace `PTS`), a "Draw" compact list (position + seed/marker badges), a
  `Player List (N pairs)` header, and `All / Fresh partners / New this season`
  filter chips. It takes `entries: DrawEntry[]`, `playerMap`, `debutStatusMap`,
  and `genderFilter` as props. **It is currently mounted nowhere** — no `<EntryList`
  usage exists in the app.
- **Data:** `padelgod.entry_list_snapshots` holds the raw entry list, captured
  hourly and **well before the draw**. One row per player:
  `tournament_id, category, fip_id, name, country, seed, partner_fip_id,
  partner_name, draw_type, captured_at, scrape_job_id`. `draw_type` distinguishes
  `main` vs `qualifying`. The `fip-entry-list-populator` worker already resolves
  these `fip_id`s into `public.players`.
- **Gating field:** `tournaments.entry_list_status ∈ {pending, not_applicable, ready}`.
  `ready` spans `p2`, `fip_bronze`, `fip_silver`, `fip_gold` — broader than the
  Projection tab's `DRAW_TIERS` gate.
- **Tab bar:** [`SlidingInkTabs`](../../../src/components/SlidingInkTabs.tsx) — a
  horizontally-scrollable, content-width strip (`flex:none`, `12px 16px` padding,
  uppercase 12px/800), green ink-bar sized to the active label's text. Current
  order on `main`: `Overview · Projection · Story · Matches · Draw`. Projection
  carries a small green `NEW` pill until first opened (`projection_tab_seen`
  localStorage key).
- **Gender:** a compact M/W slider lives in the navbar (`#4A9EFF` men /
  `#D966FF` women) and drives `genderFilter` for all tabs, including Projection.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Placement | **Dedicated Entries tab**, position **2nd** — `Overview · Entries · Projection · Story · Matches · Draw` |
| Lifecycle | **Persists throughout** the event whenever `entry_list_status = 'ready'` |
| Grouping | **Reuse existing Top Seeds + Draw structure** — no Main/Qualifying split. Qualifying pairs appear in the Draw list with their `Q` marker |
| View component | **Reuse `EntryList.tsx` as-is** |
| Data path | **Extend `fip-entry-list-populator`** to upsert team rows into a new public `tournament_entries` table; browser reads it directly (idiomatic, cacheable, RLS-clean) |
| Rollout | Behind a feature flag (`ENTRY_LIST_ENABLED`, mirroring `PROJECTION_ENABLED`) + a `NEW` pill |
| Debut pills | **Defer to a fast-follow.** v1 ships with an empty `debutStatusMap` and **hides** the `Fresh partners` / `New this season` chips |

## Data model — `public.tournament_entries`

A new public, browser-readable table holding **resolved team rows** (one per pair):

```sql
create table public.tournament_entries (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  category      text not null,              -- 'men' | 'women'
  draw_type     text not null,              -- 'main' | 'qualifying'
  seed          integer,                    -- formal seed if any
  marker        text,                        -- 'Q' for qualifying, else null (WC unavailable pre-draw)
  player1_id    uuid references players(id),
  player2_id    uuid references players(id),
  player1_name  text,                        -- snapshot fallback when unresolved
  player2_name  text,
  player1_country text,
  player2_country text,
  team_points   integer,                     -- sum of both players' ranking points, null if unknown
  captured_at   timestamptz not null,        -- from the snapshot batch
  updated_at    timestamptz not null default now(),
  unique (tournament_id, category, player1_id, player2_id)
);
```

- **RLS:** public `select` for `anon`; writes only via service key (the worker).
- Indexed on `(tournament_id, category)` for the tab read.
- `player*_name/country` carry the snapshot values as a fallback so an unresolved
  player still renders (the component already tolerates null IDs → plain span).

The component's `DrawEntry` shape maps directly: `draw_position` is synthesized
from strength-sort order (see below), `seed`/`marker`/`category`/`team_points`
map 1:1, players map to the two `player*` columns.

## Data pipeline — extend `fip-entry-list-populator`

The worker already reads the latest `entry_list_snapshots` batch and resolves
players by `fip_id`. Add a final step:

1. **Select the latest batch** per tournament (most recent `scrape_job_id` /
   `captured_at`) so stale hourly batches don't accumulate.
2. **Pair rows into teams.** Each player row carries `partner_fip_id`; a team of
   A+B appears as two rows (A→B, B→A). Collapse to one team per unordered
   `{fip_id, partner_fip_id}` pair.
3. **Resolve both players** to `public.players.id`. Note: snapshot `fip_id` is the
   prefixed form (`fip-P204582`); `players.fip_id` is raw (`P204582`) — strip
   `^fip-` before matching. Carry snapshot name/country as fallback.
4. **Compute `team_points`** = sum of both players' current ranking points
   (null if either is unknown).
5. **Derive `marker`** from `draw_type` (`qualifying → 'Q'`, else null) and carry
   `seed` from the snapshot.
6. **Upsert** into `tournament_entries` keyed by
   `(tournament_id, category, player1_id, player2_id)`, ordering the pair's two
   player ids deterministically so A+B and B+A collapse to one row. Delete rows
   for the tournament/category that are absent from the latest batch (handles
   withdrawals).

Mirror any shared helper to `padelgod/src/lib` per the repo's byte-identical
mirror convention (as done for `avatar-rehost.ts` / `db-paginate.ts`).

## Frontend

On the tournament page ([`tournaments/[id]/page.tsx`](../../../src/app/[locale]/(app)/tournaments/[id]/page.tsx)):

- **Tab entry.** Insert `'entries'` at index 1 in the `SlidingInkTabs` array,
  gated by `showEntriesTab = entryListFlag && activeTournamentObj?.entry_list_status === 'ready'`.
  Add the `NEW` pill using the same pattern as Projection, with an
  `entry_list_tab_seen` localStorage key and a `markEntriesSeen()` handler.
- **i18n.** Add `tournament.entries` label to all 5 message files.
- **Data hook.** New `useEntryList(tournamentId)` — reads `tournament_entries`
  for the tournament, plus a `playerMap` (avatar_url, ranking) hydrated from
  `players` for the referenced ids. Returns `DrawEntry[]` + `playerMap`.
- **Render.** Mount `<EntryList entries playerMap debutStatusMap genderFilter />`
  inside the tab, inheriting the existing navbar `genderFilter`. Wrap in the same
  content padding as the other tabs.
- **Empty state.** When `entry_list_status='ready'` but no rows yet (resolution
  lag), show a short "entry list coming soon" state rather than an empty card.

## Gating & tiers

- Tab shows when `ENTRY_LIST_ENABLED` **and** `entry_list_status='ready'`.
- No tier restriction beyond that — deliberately broader than Projection so
  FIP Bronze/Silver/Gold events get a real "who's playing" view.

## Debut status (fresh / new this season) — deferred to fast-follow

The component renders `Fresh partners` and `New this season` chips + pills driven
by `debutStatusMap`, but **no code computes it today**. **v1 defers this:** pass
an empty `debutStatusMap` and **hide the two chips** (add a `showDebutChips` prop
to `EntryList`, defaulting off from the Entries tab). The `All` chip / header
still renders.

The fast-follow computes it in the worker: `fresh` = this exact pairing has no
prior shared tournament entry/match; `newThisSeason` = a player's first
appearance this calendar year. Both need historical partnership/appearance
queries, written into `tournament_entries` (add `debut_status` columns) or a
companion map.

## Out of scope (fast-follows)

- **Server-rendered `/entries` + `/entries/[category]` SEO URLs** (mirroring the
  Projection URL work in PR #548). Entry lists are excellent evergreen pre-event
  SEO content — strong fast-follow, but v1 is an in-page client tab.
- **Debut-status computation** (`Fresh partners` / `New this season`) — deferred,
  see above.

## Risks & edge cases

- **Resolution lag:** `entry_list_status='ready'` can precede team resolution by
  a worker tick → the empty state must be graceful.
- **Unresolved players:** carry snapshot name/country so rows still render.
- **Withdrawals:** the upsert step must delete teams absent from the latest batch.
- **`draw_position` synthesis:** the compact list shows a position number; pre-draw
  there is no real draw position, so we synthesize an ordinal from the strength
  sort. Must never be confused with a real bracket position (the component already
  warns against showing draw_position as a seed).
- **Gender with no entries:** if a tournament has only one category entered, the
  navbar M/W toggle should behave like it does for matches (auto-select the
  populated side).

## Implementation notes

- **Branch off `main`.** This worktree is on `fix/momo-gonzalez-player-conflation`
  (332 commits behind `main`); the Projection tab and current `EntryList.tsx`
  only exist on `main`. Create a fresh worktree/branch from `main` for the work.
- **Migration:** apply via the pg driver + `DATABASE_URL` per repo convention,
  not `supabase db push`.
- **Backfill:** after the worker change, run it once across current `ready`
  tournaments to populate `tournament_entries`.
- **Feature flag:** add `ENTRY_LIST_ENABLED` to `FLAG_KEYS`.

## Open questions

1. Should the `NEW` pill logic match Projection exactly (persist until first open)?
   *(assumed yes)*
