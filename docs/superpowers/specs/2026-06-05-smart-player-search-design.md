# Smart player search — nicknames + fuzzy matching

**Date:** 2026-06-05
**Status:** Design (awaiting implementation plan)
**Origin:** User feedback (Lucas Bergamini) — repeated "search misses the player" reports.

## Problem

The user-facing player search has progressively missed players for several reasons. Fixed earlier this session:

- **Accents** — "goni" didn't find "Goñi" → fixed via `normalized_name`.
- **Display names / common short forms** — "momo" → Momo Gonzalez, "edu alonso" → Eduardo Alonso, "maxi arce" → Maximiliano Arce → fixed by searching `display_name`.

Still open, and the subject of this spec:

- **True nicknames not stored as the display name** — "paco" → Francisco Navarro (his `display_name` is "Paquito Navarro"; "paco" is a separate nickname).
- **Typos / approximate spelling** — "cohello" → Coello, "galam" → Galán. No support today; the current query is exact-substring only.

## Goals

A single, robust **player** search that handles, in one ranked query: accents, display names, curated nicknames, abbreviations, and typos — across all three user-facing surfaces (global overlay, `/search`, welcome picker), with quality preserved (real matches never buried under a typo guess).

## Non-goals

- Tournament fuzzy search (today's tournament behaviour is unchanged; trigram for tournaments is an easy follow-up).
- An ops UI for editing nicknames (follow-up; nicknames are seeded via migration for now).
- Changing the overlay's tournament-index or match-lookup logic.

## Decisions (from brainstorming)

- **Depth:** full nicknames **+** fuzzy (trigram). Fuzzy can't be done client-side, so a DB function is required.
- **Nickname seed:** curated starter set for the top ~40 men's + women's pros where the nickname isn't already the display name. Extensible later.
- **Fuzzy strictness:** conservative — similarity threshold `0.4`, and exact/substring matches always rank above fuzzy ones.

## Architecture

### DB layer

One denormalized, indexed "haystack" column does all the work, so the function never juggles three separate columns.

1. **Enable `pg_trgm`** (`unaccent` is already installed).
2. **`players.nicknames text[]`** — curated alternate short names (raw form; the trigger normalizes them into `search_text`). Default `'{}'`.
3. **`players.search_text text`** — maintained denormalized haystack:

   ```
   normalize( name || ' ' || coalesce(display_name,'') || ' ' || array_to_string(coalesce(nicknames,'{}'),' ') )
   ```

   where `normalize(x)` is the **same formula** as `normalized_name`:
   `lower(regexp_replace(regexp_replace(unaccent(x), '[^a-zA-Z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'))`, trimmed.

4. **Trigger** `set_player_search_text` — `BEFORE INSERT OR UPDATE OF name, display_name, nicknames` — recomputes `search_text`. (Parallel to the existing `normalized_name` trigger; `normalized_name` is left untouched — it still backs `entity-resolver` / `oop-player-lookup`.)
5. **Backfill** `search_text` for all existing rows.
6. **GIN trigram index:** `CREATE INDEX idx_players_search_text_trgm ON players USING gin (search_text gin_trgm_ops);` — accelerates both `LIKE '%q%'` and trigram similarity.

### RPC: `search_players(q text, max_results int default 12)`

`STABLE`, `SECURITY INVOKER` (players is anon-readable under RLS), granted to `anon` + `authenticated`. Normalization happens **inside** the function (single source of truth):

- `nq := normalize(q)`; if empty → return no rows.
- Relevance tiers:
  - **3** — prefix: `search_text LIKE nq || '%'`
  - **2** — substring: `search_text LIKE '%' || nq || '%'` (covers tokens, nicknames, abbreviations)
  - **1** — fuzzy: `length(nq) >= 3 AND similarity(search_text, nq) >= 0.4`
- `WHERE` substring-match **OR** fuzzy-match; `ORDER BY tier DESC, ranking ASC NULLS LAST, similarity DESC`; `LIMIT max_results`.
- Returns the exact fields the UI already consumes: `id, name, display_name, country, ranking, category, avatar_url`.

At ~4,600 player rows this is trivially fast; the GIN index keeps it cheap as the table grows. The explicit `similarity() >= 0.4` filter (rather than the `%` operator) pins the conservative threshold without depending on the session `pg_trgm.similarity_threshold` GUC.

### Client layer

In each of the three surfaces, the **player** query changes from:

```js
supabase.from('players').select(fields).or(playerSearchOr(norm)).order('ranking',…).limit(N)
```

to:

```js
supabase.rpc('search_players', { q: query.trim(), max_results: N })
```

- Returned rows have the same shape → minimal downstream change; titles still render `display_name || name`.
- **Graceful fallback:** on RPC error, fall back to the existing `.or(playerSearchOr(norm))` query so search never hard-fails. `playerSearchOr` / `normalizeSearchQuery` stay in `search-normalize.ts` for this and for the (unchanged) tournament JS-filter.
- The overlay's tournament-index filter and match-by-player-id lookup are unchanged.

### Nickname seed

In the migration, set `nicknames` for ~40 well-known pros where the nickname isn't already the display name — e.g. `paco` (Francisco Navarro), `bela` (Belasteguín), plus other men's/women's shorthands. Targeted by stable `id`/exact name. The existing `entity_external_ids` `source='alias'` rows are **not** reused (they're raw OOP/draw strings, not clean nicknames).

## Testing

- **Regression (must still pass):** goñi, momo, edu alonso, maxi arce, naim/juan martin díaz.
- **New:** paco → Francisco Navarro; typo cases cohello → Coello, galam → Galán.
- **Quality guardrails:** a common real surname returns the correct player in tier-3/2 (not buried); a gibberish query returns nothing; short (<3 char) queries never trigger fuzzy.
- Existing `search-normalize.test.ts` unit tests remain green.
- Verified live in the running app across all three surfaces + direct RPC checks against the real DB.

## Rollout / risk

- Migration (extension + column + trigger + backfill + index + RPC + grants + nickname seed) applied via the **pg-driver / `DATABASE_URL`** method (not `supabase db push`), per repo convention.
- RPC replaces only the player query; ilike fallback bounds the blast radius.

## Files

- `supabase/migrations/2026XXXX_player_search_text_fuzzy.sql`
- `src/components/nav/SearchOverlay.tsx`
- `src/app/[locale]/(app)/search/page.tsx`
- `src/app/[locale]/(app)/welcome/page.tsx`
- `src/lib/search-normalize.ts` (retain helpers as the fallback path)
