-- Accent-insensitive global search for the ops ⌘K command palette.
--
-- Plain `ilike` on `name` misses accented matches — typing "Ijui" won't
-- find the tournament stored as "Ijuí", because the stored value keeps its
-- diacritics while the operator's keystrokes don't. We unaccent BOTH sides
-- so a query matches regardless of accents.
--
-- Players already have a normalized_name column (see
-- 20260412_player_normalized_name.sql), but tournaments don't, and rather
-- than mirror that column+trigger+backfill onto tournaments we expose one
-- small STABLE function that the search route calls via .rpc(). Returns a
-- unified shape across both entity types; `starts_at` lets the palette show
-- a tournament's date in the preview so near-duplicate names are
-- distinguishable.
--
-- Bounded to 5 hits per entity type — same budget as the previous two
-- ilike queries. unaccent() is STABLE (not indexable), which is fine here:
-- the result set is tiny and this is an operator-only, low-QPS path.

create extension if not exists unaccent;

create or replace function ops_global_search(q text)
returns table (kind text, id uuid, name text, sub text, starts_at timestamptz)
language sql
stable
as $$
  (
    select 'player'::text as kind, p.id, p.name, p.country as sub, null::timestamptz as starts_at
    from players p
    where unaccent(p.name) ilike '%' || unaccent(q) || '%'
    order by p.ranking asc nulls last
    limit 5
  )
  union all
  (
    select 'tournament'::text as kind, t.id, t.name, t.level as sub, t.starts_at
    from tournaments t
    where unaccent(t.name) ilike '%' || unaccent(q) || '%'
    order by t.starts_at desc nulls last
    limit 5
  )
$$;
