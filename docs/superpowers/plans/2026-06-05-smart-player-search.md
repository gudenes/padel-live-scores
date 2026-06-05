# Smart Player Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make player search find people by accent-folded name, display name, curated nickname, abbreviation, and typo — in one ranked query across all three user-facing search surfaces.

**Architecture:** A trigger-maintained `players.search_text` haystack (name + display_name + nicknames, normalized like `normalized_name`) with a `pg_trgm` GIN index. A `search_players(q)` RPC ranks results in tiers (prefix → substring → fuzzy ≥0.4). A single `searchPlayers()` client helper calls the RPC and falls back to today's ilike query on error; the three surfaces use it.

**Tech Stack:** Postgres (`pg_trgm`, `unaccent`), Supabase RPC, Next.js 16 / React 19 / TypeScript, Vitest.

**Migration apply method (repo convention):** apply SQL via the `pg` driver + `DATABASE_URL` from `.env.local`, NOT `supabase db push`.

---

## File Structure

- **Create** `supabase/migrations/20260605_player_search_text_fuzzy.sql` — extension, `nicknames`/`search_text` columns, compute fn, trigger, backfill, GIN index, `search_players` RPC, grants, nickname seed.
- **Create** `src/lib/player-search.ts` — `searchPlayers(supabase, q, maxResults)` helper (RPC + ilike fallback) and `PlayerSearchRow` type.
- **Create** `src/lib/__tests__/player-search.test.ts` — unit tests for the helper (fake supabase).
- **Modify** `src/components/nav/SearchOverlay.tsx` — player query → `searchPlayers()`.
- **Modify** `src/app/[locale]/(app)/search/page.tsx` — player query → `searchPlayers()`.
- **Modify** `src/app/[locale]/(app)/welcome/page.tsx` — player query → `searchPlayers()`.
- **Unchanged:** `src/lib/search-normalize.ts` (still used by the fallback path and the tournament JS-filter).

---

## Task 1: DB migration — `search_text`, trigram index, `search_players` RPC, nickname seed

**Files:**
- Create: `supabase/migrations/20260605_player_search_text_fuzzy.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260605_player_search_text_fuzzy.sql`:

```sql
-- Smart player search: accent/nickname/abbreviation/typo tolerant.
-- See docs/superpowers/specs/2026-06-05-smart-player-search-design.md

-- 1. Trigram fuzzy matching (unaccent already installed).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. Curated, search-only nicknames (raw form; normalized into search_text).
ALTER TABLE players ADD COLUMN IF NOT EXISTS nicknames text[] NOT NULL DEFAULT '{}';

-- 3. Denormalized search haystack: name + display_name + nicknames, normalized
--    with the SAME formula as normalized_name (unaccent, fold punctuation to
--    spaces, collapse whitespace, lowercase, trim).
ALTER TABLE players ADD COLUMN IF NOT EXISTS search_text text;

CREATE OR REPLACE FUNCTION compute_player_search_text(p_name text, p_display text, p_nicks text[])
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT trim(both ' ' FROM lower(
    regexp_replace(
      regexp_replace(
        unaccent(
          coalesce(p_name, '') || ' ' ||
          coalesce(p_display, '') || ' ' ||
          array_to_string(coalesce(p_nicks, '{}'::text[]), ' ')
        ),
        '[^a-zA-Z0-9 ]', ' ', 'g'
      ),
      '\s+', ' ', 'g'
    )
  ));
$$;

-- 4. Trigger keeps search_text in sync. normalized_name is left untouched.
CREATE OR REPLACE FUNCTION set_player_search_text()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := compute_player_search_text(NEW.name, NEW.display_name, NEW.nicknames);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_player_search_text ON players;
CREATE TRIGGER trg_player_search_text
  BEFORE INSERT OR UPDATE OF name, display_name, nicknames ON players
  FOR EACH ROW EXECUTE FUNCTION set_player_search_text();

-- 5. Backfill existing rows.
UPDATE players SET search_text = compute_player_search_text(name, display_name, nicknames);

-- 6. GIN trigram index — accelerates both LIKE '%q%' and similarity().
CREATE INDEX IF NOT EXISTS idx_players_search_text_trgm
  ON players USING gin (search_text gin_trgm_ops);

-- 7. Ranked search RPC. Conservative fuzzy: threshold 0.4, exact/substring
--    always outrank fuzzy. Casts pin RETURNS TABLE types regardless of the
--    underlying column types.
CREATE OR REPLACE FUNCTION search_players(q text, max_results int DEFAULT 12)
RETURNS TABLE (
  id uuid, name text, display_name text, country text,
  ranking int, category text, avatar_url text
)
LANGUAGE sql STABLE AS $$
  WITH params AS (
    SELECT trim(both ' ' FROM lower(
      regexp_replace(
        regexp_replace(unaccent(coalesce(q, '')), '[^a-zA-Z0-9 ]', ' ', 'g'),
        '\s+', ' ', 'g'
      )
    )) AS nq
  )
  SELECT p.id, p.name::text, p.display_name::text, p.country::text,
         p.ranking::int, p.category::text, p.avatar_url::text
  FROM players p, params
  WHERE params.nq <> ''
    AND (
      p.search_text LIKE '%' || params.nq || '%'
      OR (length(params.nq) >= 3 AND similarity(p.search_text, params.nq) >= 0.4)
    )
  ORDER BY
    (CASE
       WHEN p.search_text LIKE params.nq || '%' THEN 3
       WHEN p.search_text LIKE '%' || params.nq || '%' THEN 2
       ELSE 1
     END) DESC,
    p.ranking ASC NULLS LAST,
    similarity(p.search_text, params.nq) DESC
  LIMIT max_results;
$$;

GRANT EXECUTE ON FUNCTION search_players(text, int) TO anon, authenticated;

-- 8. Curated nickname seed (search-only aliases NOT already captured by name
--    or display_name). Targeted by exact name. Updating nicknames re-fires the
--    trigger, refreshing search_text. Safe no-op if a name isn't present.
UPDATE players SET nicknames = ARRAY['paco']            WHERE name = 'Francisco Navarro';
UPDATE players SET nicknames = ARRAY['bela']            WHERE name = 'Fernando Belasteguin';
UPDATE players SET nicknames = ARRAY['agus','mozart']   WHERE name = 'Agustin Tapia';
UPDATE players SET nicknames = ARRAY['tincho']          WHERE name = 'Martin Di Nenno';
UPDATE players SET nicknames = ARRAY['stupa']           WHERE name = 'Franco Stupaczuk';
UPDATE players SET nicknames = ARRAY['chingo']          WHERE name = 'Federico Chingotto';
UPDATE players SET nicknames = ARRAY['mike']            WHERE name = 'Miguel Yanguas';
UPDATE players SET nicknames = ARRAY['delfi']           WHERE name = 'Delfina Brea Senesi';
UPDATE players SET nicknames = ARRAY['vicky']           WHERE name = 'Victoria Iglesias Segador';
UPDATE players SET nicknames = ARRAY['juani']           WHERE name = 'Juan Lebron';
```

- [ ] **Step 2: Add verified nicknames up to ~40, then apply the migration**

Before applying, expand the seed in Step 1 with additional **verified** entries (the curation the user approved). For each candidate, confirm the exact `name` exists and the nickname adds value beyond `name`/`display_name`:

```bash
node -e '
require("dotenv").config({path:".env.local"});
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const names=["Francisco Navarro","Fernando Belasteguin","Agustin Tapia","Martin Di Nenno","Franco Stupaczuk","Federico Chingotto","Miguel Yanguas","Delfina Brea Senesi","Victoria Iglesias Segador","Juan Lebron","Alejandro Galan","Arturo Coello","Gemma Triay Pons","Paula Josemaria Martin"];
for (const n of names){const r=await c.query("select name,display_name from players where name=$1",[n]);console.log(n,"=>",JSON.stringify(r.rows));}
await c.end();})().catch(e=>{console.error(e.message);process.exit(1)});'
```

Drop any line whose target prints `[]` (name not found), and add more verified `UPDATE ... SET nicknames = ARRAY[...] WHERE name = '...';` lines for well-known players until ~40 total. Then apply:

```bash
node -e '
require("dotenv").config({path:".env.local"});
const fs=require("fs");const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
await c.query(fs.readFileSync("supabase/migrations/20260605_player_search_text_fuzzy.sql","utf8"));
console.log("migration applied");
await c.end();})().catch(e=>{console.error(e.message);process.exit(1)});'
```

Expected: `migration applied` (no error).

- [ ] **Step 3: Verify search_text + RPC behaviour (this is the test)**

```bash
node -e '
require("dotenv").config({path:".env.local"});
const {Client}=require("pg");
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();
const run=async(q)=>{const r=await c.query("select name,display_name from search_players($1,5)",[q]);console.log(q,"=>",r.rows.map(x=>x.display_name||x.name).join(" | "));};
await run("paco");        // expect: Paquito Navarro
await run("goni");        // expect: Aimar Goni (accent)
await run("momo");        // expect: Momo Gonzalez (display)
await run("maxi arce");   // expect: Maxi Arce (display)
await run("cohello");     // expect: Arturo Coello (typo, fuzzy)
await run("galam");       // expect: Alejandro Galan (typo, fuzzy)
await run("zzzzzz");      // expect: (empty)
const st=await c.query("select count(*)::int n from players where search_text is null");
console.log("null search_text rows:", st.rows[0].n);  // expect 0
await c.end();})().catch(e=>{console.error(e.message);process.exit(1)});'
```

Expected: `paco`→Paquito Navarro, `goni`→a Goñi, `momo`→Momo Gonzalez, `maxi arce`→Maxi Arce, `cohello`→Arturo Coello, `galam`→Alejandro Galan, `zzzzzz`→empty, `null search_text rows: 0`. If a typo case misses, the threshold may be slightly high for that pair — note it; do NOT lower below 0.4 in this task (quality gate).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260605_player_search_text_fuzzy.sql docs/superpowers/specs/2026-06-05-smart-player-search-design.md docs/superpowers/plans/2026-06-05-smart-player-search.md
git commit -m "feat(search): pg_trgm search_text + search_players RPC + nickname seed

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `searchPlayers` client helper + unit tests

**Files:**
- Create: `src/lib/player-search.ts`
- Test: `src/lib/__tests__/player-search.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/player-search.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { searchPlayers } from '../player-search'

// Minimal chainable fake of the Supabase client used by searchPlayers.
function makeFake(opts: {
  rpc?: (name: string, args: any) => { data: any; error: any }
  fallbackData?: any[]
}) {
  const calls = { rpc: 0, from: 0 }
  const fake: any = {
    calls,
    rpc: vi.fn(async (name: string, args: any) => {
      calls.rpc++
      return opts.rpc ? opts.rpc(name, args) : { data: null, error: null }
    }),
    from() {
      calls.from++
      const builder: any = {
        select: () => builder,
        or: () => builder,
        order: () => builder,
        limit: async () => ({ data: opts.fallbackData ?? [], error: null }),
      }
      return builder
    },
  }
  return fake
}

const ROW = { id: '1', name: 'Arturo Coello', display_name: null, country: 'ES', ranking: 1, category: 'men', avatar_url: null }

describe('searchPlayers', () => {
  it('returns [] for an empty/whitespace query without hitting the DB', async () => {
    const fake = makeFake({})
    expect(await searchPlayers(fake, '   ', 5)).toEqual([])
    expect(fake.calls.rpc).toBe(0)
    expect(fake.calls.from).toBe(0)
  })

  it('returns RPC rows on success', async () => {
    const fake = makeFake({ rpc: () => ({ data: [ROW], error: null }) })
    const rows = await searchPlayers(fake, 'cohello', 5)
    expect(rows).toEqual([ROW])
    expect(fake.calls.from).toBe(0) // no fallback
  })

  it('falls back to the ilike query when the RPC errors', async () => {
    const fake = makeFake({ rpc: () => ({ data: null, error: { message: 'boom' } }), fallbackData: [ROW] })
    const rows = await searchPlayers(fake, 'coello', 5)
    expect(rows).toEqual([ROW])
    expect(fake.calls.rpc).toBe(1)
    expect(fake.calls.from).toBe(1) // fallback used
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/player-search.test.ts`
Expected: FAIL — `Cannot find module '../player-search'`.

- [ ] **Step 3: Write the helper**

Create `src/lib/player-search.ts`:

```ts
// src/lib/player-search.ts
//
// Unified player search used by every user-facing search surface. Calls the
// `search_players` RPC (accent/nickname/abbreviation/typo tolerant, ranked) and
// degrades gracefully to the legacy normalized_name + display_name ilike query
// if the RPC is unavailable or errors — so search never hard-fails.

import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeSearchQuery, playerSearchOr } from '@/lib/search-normalize'

export interface PlayerSearchRow {
  id: string
  name: string
  display_name: string | null
  country: string | null
  ranking: number | null
  category: 'men' | 'women' | null
  avatar_url: string | null
}

const SELECT = 'id, name, display_name, country, ranking, category, avatar_url'

export async function searchPlayers(
  supabase: SupabaseClient,
  rawQuery: string,
  maxResults: number,
): Promise<PlayerSearchRow[]> {
  const q = rawQuery.trim()
  if (!q) return []

  const { data, error } = await supabase.rpc('search_players', { q, max_results: maxResults })
  if (!error && Array.isArray(data)) return data as PlayerSearchRow[]

  // Fallback: legacy client-side ilike on normalized_name + display_name.
  const norm = normalizeSearchQuery(q)
  if (!norm) return []
  const { data: fb } = await supabase
    .from('players')
    .select(SELECT)
    .or(playerSearchOr(norm))
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(maxResults)
  return (fb ?? []) as PlayerSearchRow[]
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/player-search.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/player-search.ts src/lib/__tests__/player-search.test.ts
git commit -m "feat(search): searchPlayers helper (RPC + ilike fallback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Wire SearchOverlay (global search bar) to `searchPlayers`

**Files:**
- Modify: `src/components/nav/SearchOverlay.tsx`

- [ ] **Step 1: Add the import**

Add to the imports near the top (after the existing `search-normalize` import):

```ts
import { searchPlayers } from '@/lib/player-search'
```

- [ ] **Step 2: Replace the player query inside the debounced search**

In the debounced search effect, the current block normalizes and runs the player `.or()` query in `Promise.all`. Replace the players half so the `Promise.all` becomes:

```ts
      const [playersData, tournamentIndex] = await Promise.all([
        searchPlayers(supabase, query, 5),
        loadTournamentIndex(),
      ])
```

Then change the player results loop to iterate `playersData` instead of `playersRes.data`:

```ts
      for (const p of playersData) {
```

Keep the existing `norm`/empty-guard for tournaments: tournaments still use `tournamentNameMatches(t.name, norm)`, so retain `const norm = normalizeSearchQuery(query.trim())` and the `if (!norm) { setResults([]); setSearching(false); return }` guard above the `Promise.all`. (Players are now searched via `query` through `searchPlayers`; tournaments still via `norm`.)

The `playerIds` used for the matches lookup derive from `playersData`:

```ts
      const playerIds = playersData.map(p => p.id)
```

Player title rendering stays `p.display_name || p.name`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep SearchOverlay || echo clean`
Expected: `clean`.

- [ ] **Step 4: Verify live (dev server on :3002)**

Start the dev server if needed (`node node_modules/.bin/next dev -p 3002`), open the global search overlay, and confirm via browser automation or manual check that typing `paco` returns Paquito Navarro, `cohello` returns Arturo Coello, and `goni`/`momo` still work. (The verification harness used throughout this session: Playwright MCP against `http://localhost:3002`.)

- [ ] **Step 5: Commit**

```bash
git add src/components/nav/SearchOverlay.tsx
git commit -m "feat(search): global overlay uses search_players RPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Wire the `/search` page to `searchPlayers`

**Files:**
- Modify: `src/app/[locale]/(app)/search/page.tsx`

- [ ] **Step 1: Add the import**

```ts
import { searchPlayers } from '@/lib/player-search'
```

- [ ] **Step 2: Replace the player query in `runSearch`**

`runSearch(q)` currently computes `norm`, runs the player `.or()` query and the tournament fetch in `Promise.all`, then JS-filters tournaments. Replace the player half:

```ts
async function runSearch(q: string): Promise<{ players: PlayerRow[]; tournaments: TournamentRow[] }> {
  const norm = normalizeSearchQuery(q)
  if (!norm) return { players: [], tournaments: [] }
  const [players, tournamentsRes] = await Promise.all([
    searchPlayers(supabase, q, 20),
    supabase
      .from('tournaments')
      .select('id, name, country, level, starts_at, ends_at')
      .order('starts_at', { ascending: false, nullsFirst: false })
      .limit(2000),
  ])
  const tournaments = ((tournamentsRes.data ?? []) as TournamentRow[])
    .filter(t => tournamentNameMatches(t.name, norm))
    .slice(0, 10)
  return { players: players as PlayerRow[], tournaments }
}
```

`PlayerRow` already includes `display_name` (added earlier this session); `searchPlayers` returns the same shape. The render still uses `p.display_name || p.name`.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "(app)/search/page" || echo clean`
Expected: `clean`.

- [ ] **Step 4: Verify live**

Run:
```bash
curl -s "http://localhost:3002/search?q=paco"    | grep -oiE '>[^<>]*navarro[^<>]*<' | head -1
curl -s "http://localhost:3002/search?q=cohello" | grep -oiE '>[^<>]*coello[^<>]*<'  | head -1
```
Expected: `>Paquito Navarro<` and `>Arturo Coello<`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/search/page.tsx"
git commit -m "feat(search): /search page uses search_players RPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Wire the welcome picker to `searchPlayers`

**Files:**
- Modify: `src/app/[locale]/(app)/welcome/page.tsx`

- [ ] **Step 1: Add the import**

```ts
import { searchPlayers } from '@/lib/player-search'
```

(The existing `normalizeSearchQuery, playerSearchOr` import can stay or be removed if no longer referenced — verify with the typecheck in Step 3.)

- [ ] **Step 2: Replace the debounced player query**

In the debounced search effect, replace the normalize + `.or()` query body with:

```ts
    debounceRef.current = setTimeout(async () => {
      try {
        const rows = await searchPlayers(supabase, trimmed, SEARCH_LIMIT)
        setSearchResults(rows as PickerPlayer[])
      } catch {
        setSearchResults([])
      }
      setSearching(false)
    }, SEARCH_DEBOUNCE_MS)
```

`PickerPlayer` has the same fields `searchPlayers` returns (`id, name, display_name, country, ranking, category, avatar_url`); the picker already renders `display_name || name`.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep "welcome/page" || echo clean`
Expected: `clean`.
Run: `npx eslint "src/app/[locale]/(app)/welcome/page.tsx"` and fix any unused-import error (remove `playerSearchOr`/`normalizeSearchQuery` if now unused).

- [ ] **Step 4: Verify live**

Open `http://localhost:3002/welcome`, type `paco` → expect Paquito Navarro; `cohello` → Arturo Coello; `goni` → Aimar Goñi. (Playwright MCP, same as this session.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/welcome/page.tsx"
git commit -m "feat(search): welcome picker uses search_players RPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full regression + quality verification

**Files:** none (verification only).

- [ ] **Step 1: Run the unit suites**

Run: `npx vitest run src/lib/__tests__/player-search.test.ts src/lib/__tests__/search-normalize.test.ts`
Expected: all PASS.

- [ ] **Step 2: Cross-surface live matrix**

With the dev server running, verify each query on the global overlay AND `/search` AND the welcome picker:

| Query | Expected top result | Why |
|---|---|---|
| `paco` | Paquito Navarro | nickname |
| `goni` | Aimar Goñi | accent |
| `momo` | Momo Gonzalez | display name |
| `edu alonso` | Edu Alonso | display name |
| `maxi arce` | Maxi Arce | display name |
| `cohello` | Arturo Coello | typo (fuzzy) |
| `galam` | Alejandro Galán | typo (fuzzy) |
| `tapia` | Agustín Tapia | exact, top-ranked first |
| `zzzzzz` | (no results) | fuzzy guardrail |

- [ ] **Step 3: Quality guardrail check**

Confirm a common real surname returns the correct player in the top tier (not buried under a fuzzy guess), and that a 1–2 char query (e.g. `ta`) does NOT trigger fuzzy noise (substring/prefix only). If any typo case misses or any false positive appears, adjust ONLY the `0.4` threshold in the RPC within `[0.4, 0.45]` and re-verify; never go below 0.4.

- [ ] **Step 4: Final typecheck + lint sweep**

Run: `npx tsc --noEmit 2>&1 | tail -3` (expect no errors in changed files)
Run: `npm run lint 2>&1 | tail -5` (expect no NEW errors vs. baseline in the four changed files)

- [ ] **Step 5: Commit any verification fixups** (only if Step 3 required a threshold tweak)

```bash
git add supabase/migrations/20260605_player_search_text_fuzzy.sql
git commit -m "fix(search): tune fuzzy threshold after verification

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes

- **Spec coverage:** `pg_trgm` + `search_text` + GIN index (Task 1), `search_players` RPC with conservative tiers (Task 1), `nicknames` column + curated seed (Task 1), three surfaces via one helper with fallback (Tasks 2–5), regression + quality gates (Task 6). Tournaments intentionally unchanged (non-goal).
- **Threshold:** fixed at `0.4`, only tunable upward — matches the "conservative" decision.
- **Type consistency:** `PlayerSearchRow` (helper) ⊇ `PlayerRow` (/search) and `PickerPlayer` (welcome) field sets; RPC `RETURNS TABLE` casts pin those types.
- **Migration safety:** `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS` make re-runs idempotent; nickname `UPDATE`s are no-ops when a name is absent.
