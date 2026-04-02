# Draw PDF Pipeline + PlayerResolver Improvements

## Goal

Eliminate TBD player names on FIP tournament matches by: (1) improving PlayerResolver accuracy with ranking/points signals and bug fixes, and (2) adding a draw PDF upload pipeline that pre-links players to bracket positions before matches go live.

## Context

FIP tournament data flows through three sources at different times:

| Source | Timing | Data |
|--------|--------|------|
| Entry List PDF | Days before tournament | All players, rankings, points, draw type |
| Draw PDF | 1-2 days before | Bracket positions, seeds, Q/WC/LL markers |
| FIP scraper (matchscorerlive.com) | Tournament start onward | Match creation, scores, results |

The FIP scraper (`/api/cron/fip-scores`) creates matches and resolves players via `PlayerResolver`. But the resolver frequently fails to match players that were already seeded from entry lists, creating duplicates. Root causes:

1. **Country code mismatch** — `toIso2()` returns `null` for already-2-letter codes from FIP flag images, blocking the fuzzy match country cross-check.
2. **No ranking/points signal** — When multiple players share similar names, the resolver has no way to disambiguate. Entry list data includes ranking+points but the resolver ignores them.
3. **Fuzzy threshold too strict** — 0.9 token overlap rejects valid matches with hyphenated or compound names.
4. **No draw context** — The FIP scraper resolves players in isolation. If draw data were available, it could skip the resolver entirely for known players.

## Architecture

Two independent subsystems that reinforce each other:

```
Subsystem 1: PlayerResolver Improvements
  - Fix toIso2 for 2-letter codes
  - Add ranking+points disambiguation step
  - Lower fuzzy threshold to 0.7

Subsystem 2: Draw PDF Pipeline
  - Draw parser (pure function)
  - tournament_draws table
  - API routes (parse + seed)
  - FIP scraper integration (check draws before resolver)
  - Ops UI (upload + readiness indicators)
```

The FIP scraper (`fip-scores` cron) remains the source of truth for match creation and live scores. The draw pipeline and resolver improvements only affect player assignment quality.

---

## Subsystem 1: PlayerResolver Improvements

### 1.1 Fix `toIso2` for 2-letter codes

**File:** `src/lib/fip-scraper.ts`

The `toIso2()` function only handles 3-letter to 2-letter conversion. If the input is already a valid 2-letter ISO code (e.g., `"ES"` from a flag image filename), it returns `null`. This causes country mismatches between entry-list-seeded players (correctly converted) and FIP-scraper-resolved players (null country).

**Fix:** If the input is 2 characters and exists as a value in the ISO3_TO_ISO2 map, return it as-is.

### 1.2 Add ranking+points disambiguation step

**File:** `src/lib/player-resolver.ts`

Current resolution order:
1. fip_id (exact)
2. external_id (exact)
3. normalized name + category match
4. fuzzy name match (token overlap >= 0.9)

When step 3 finds multiple candidates with the same normalized name and category, it picks the first one arbitrarily. This causes wrong matches for common names.

**New step 3b:** When step 3 returns multiple candidates AND the input includes ranking or points, score candidates by proximity. Since rankings are ~1-1000 and points are ~0-10000, normalize both to 0-1 range before comparing:

```
rankingDistance = |input.ranking - candidate.ranking| / max(input.ranking, candidate.ranking, 1)
pointsDistance  = |input.points - candidate.points| / max(input.points, candidate.points, 1)
distance = (rankingDistance + pointsDistance) / 2
```

Pick the candidate with the lowest distance. If distance > 0.5 for all candidates (none are close), fall through to step 4 (fuzzy) instead of picking a bad match. This requires `PlayerResolver.load()` to also fetch `ranking` and `points` columns into the cache.

If the input has no ranking/points, or all candidates have null ranking/points, fall back to the existing behavior (first match, prefer same category).

### 1.3 Lower fuzzy threshold

**File:** `src/lib/player-resolver.ts`

Lower the token similarity threshold in step 4 from 0.9 to 0.7. Names like `"Teresa Navarro Lopez-Barajas"` vs `"Teresa Navarro lopez-Barajas"` can tokenize differently due to hyphenation and accents. With the country cross-check and the new ranking/points signal, 0.7 is safe enough to avoid false positives.

### 1.4 Pass ranking/points from entry list seed

**File:** `src/app/api/ops/seed-entry-list/route.ts`

The seed endpoint currently passes only `name`, `country`, `category` to the resolver. Update to also pass `ranking` and `points` from the parsed entry list data. This feeds into the new disambiguation step (1.2) and also stores ranking/points on the created player record.

---

## Subsystem 2: Draw PDF Pipeline

### 2.1 Draw Parser

**New file:** `src/lib/draw-parser.ts`

Pure function that parses FIP draw PDF text into structured bracket data. No I/O, no DB access.

**Input:** Raw text from pdf-parse extraction.

**Output types:**

```typescript
interface ParsedDrawEntry {
  drawPosition: number           // 1-32 (slot in bracket)
  player1Name: string            // "Aranzazu Osoro Ulrich" (normalized from "OSORO ULRICH, Aranzazu")
  player1Country: string | null  // "ARG"
  player2Name: string            // "Victoria Iglesias Segador"
  player2Country: string | null  // "ESP"
  seed: number | null            // 1-8 for seeded teams, null otherwise
  marker: 'Q' | 'WC' | 'LL' | null
}

interface ParsedSeededTeam {
  seed: number
  player1: string
  player2: string
  points: number
}

interface DrawMetadata {
  category: 'men' | 'women'
  releaseDate: string | null     // "30 Mar 2026"
  drawSize: number               // 32
}

interface DrawParseResult {
  entries: ParsedDrawEntry[]
  seededTeams: ParsedSeededTeam[]
  metadata: DrawMetadata
}
```

**PDF text structure (from actual FIP draw PDFs):**

Lines are pairs of players per bracket slot:
```
1 OSORO ULRICH, Aranzazu     ARG      ← slot 1, player 1 (seed prefix "1")
IGLESIAS SEGADOR, Victoria   ESP      ← slot 1, player 2
NEIZVESTNAYA, Angelina                ← slot 2, player 1 (no prefix = unseeded)
TERRANOVA, Elsa              ITA      ← slot 2, player 2
Q   IVANOVA, Anastasia       KAZ      ← slot 5, player 1 (marker "Q")
KOZLOVA, Evgeniia                     ← slot 5, player 2
WC  SINITSYNA, Mariya        KAZ      ← slot ?, player 1 (marker "WC")
SYSOEVA, Maria                        ← slot ?, player 2
```

**Name conversion:** Draw PDFs use `"LASTNAME, Firstname"` format. The parser splits on comma, trims, and recombines as `"Firstname Lastname"` for resolver compatibility. Full compound surnames are preserved (e.g., `"BARRERA DE LA FUENTE, Marta"` → `"Marta Barrera De La Fuente"`).

**After bracket entries**, the PDF contains:
- Round prize/points info (lines starting with "Round of", "Quarterfinals", etc.) — skip
- "Seeded teams" section with seed number, team names, and points — parse for ranking data
- Withdrawals, lucky losers, retirements — skip
- Tournament metadata (name, location, dates) — parse release date and category

**Scope:** Main draw only. Qualifying draw PDFs are a future addition.

### 2.2 Database Table

**New table:** `tournament_draws`

```sql
CREATE TABLE tournament_draws (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id),
  category TEXT NOT NULL CHECK (category IN ('men', 'women')),
  draw_position INTEGER NOT NULL,
  seed INTEGER,
  marker TEXT CHECK (marker IN ('Q', 'WC', 'LL')),
  player1_name TEXT NOT NULL,
  player1_country TEXT,
  player1_id UUID REFERENCES players(id),
  player2_name TEXT NOT NULL,
  player2_country TEXT,
  player2_id UUID REFERENCES players(id),
  team_points INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tournament_id, category, draw_position)
);
```

- `player1_id` / `player2_id` start as null, get filled when players are resolved during seed or when FIP scraper runs.
- `UNIQUE(tournament_id, category, draw_position)` allows re-uploading newer draw versions via upsert.
- `team_points` from the seeded teams summary feeds into PlayerResolver ranking/points disambiguation.

### 2.3 API Routes

**`POST /api/ops/parse-draw`** — Parse draw PDF

Same pattern as `parse-entry-list`. Accepts PDF via multipart/form-data. Extracts text via pdf-parse, runs draw parser, returns structured `DrawParseResult`. Auth via ops_token cookie.

**`POST /api/ops/seed-draw`** — Store draw + resolve players

Receives confirmed draw entries + tournament ID + category. For each entry:
1. Resolve player1 and player2 via PlayerResolver (passing name, country, category, and team_points for ranking signal)
2. Upsert into `tournament_draws` with resolved player IDs
3. Log to `ops_events` for audit trail

Returns summary: slots filled, players resolved, players created, errors.

### 2.4 FIP Scraper Integration

**File:** `src/app/api/cron/fip-scores/route.ts`

Before calling `PlayerResolver.resolve()` for a match player, check if draw data exists for this tournament+category.

**At the start of each `fip-scores` run:**
```typescript
// Bulk-load draw entries for active tournaments
const { data: drawEntries } = await supabase
  .from('tournament_draws')
  .select('*')
  .in('tournament_id', activeTournamentIds)
```

**In the `resolvePlayer` function:**
```typescript
// 1. Check draw table for this player name
const drawMatch = drawEntries.find(d =>
  d.tournament_id === tournamentId &&
  d.category === category &&
  (tokenSimilarity(fullName, d.player1_name) >= 0.7 ||
   tokenSimilarity(fullName, d.player2_name) >= 0.7)
)

// 2. If draw has a resolved player ID, use it directly
if (drawMatch) {
  const isPlayer1 = tokenSimilarity(fullName, drawMatch.player1_name) >= 0.7
  const playerId = isPlayer1 ? drawMatch.player1_id : drawMatch.player2_id
  if (playerId) return playerId
}

// 3. Fall back to improved PlayerResolver
```

This avoids creating duplicates: the draw entry already has the correct player ID from when the draw was uploaded and resolved against entry-list-seeded players.

### 2.5 Ops UI Changes

**File:** `src/app/ops/EntryListTab.tsx`

**Draw upload section** — Added below the entry list upload within the same tab. Same UX pattern: select tournament + category, upload PDF, preview, confirm.

Preview table columns: `#`, `Seed`, `Player 1`, `Player 2`, `Marker`, `Points`

**Tournament readiness indicators** — Each tournament in the selector shows two status badges:

```
FIP Gold Almaty (KAZ) — 3d away  [EL checkmark] [DR X]
FIP Silver Madrid (ESP) — 6d away  [EL X] [DR X]
```

- **EL** = Entry List seeded (green check or red X)
- **DR** = Draw uploaded (green check or red X)

**Data source for badges:** The `GET /api/ops/seed-entry-list?action=list-tournaments` endpoint adds two boolean fields per tournament:
- `hasEntryList` — exists in `ops_events` with `source='entry-list-seed'` for this tournament
- `hasDraw` — exists in `tournament_draws` for this tournament

**Sorting boost:** At the same urgency level, tournaments missing uploads sort higher than fully-prepped ones.

---

## Data Flow (End to End)

```
Days before tournament:
  1. Upload Entry List PDF → parse → seed players via PlayerResolver
     → players table gets records with name, country, ranking, points
     → ops_events logged

1-2 days before:
  2. Upload Draw PDF → parse → resolve against seeded players → store in tournament_draws
     → tournament_draws gets bracket slots with player IDs linked
     → ops_events logged

Tournament starts:
  3. fip-scores cron runs → creates matches from matchscorerlive.com
     → for each player: check tournament_draws first → use linked player ID
     → fall back to improved PlayerResolver (ranking/points disambiguation, fixed country codes)
     → matches get correct player IDs → no more TBDs or duplicates

During tournament:
  4. fip-scores cron continues → updates scores, results, winners
     → existing pipeline unchanged
```

---

## Files Changed / Created

| File | Action | Purpose |
|------|--------|---------|
| `src/lib/player-resolver.ts` | Modify | Add ranking/points disambiguation, lower fuzzy threshold, cache ranking/points |
| `src/lib/fip-scraper.ts` | Modify | Fix `toIso2()` for 2-letter codes |
| `src/lib/draw-parser.ts` | Create | Pure draw PDF text parser |
| `src/lib/__tests__/draw-parser.test.ts` | Create | Tests for draw parser |
| `src/lib/__tests__/player-resolver.test.ts` | Create | Tests for resolver improvements |
| `src/app/api/ops/parse-draw/route.ts` | Create | PDF upload + parse API |
| `src/app/api/ops/seed-draw/route.ts` | Create | Store draw + resolve players API |
| `src/app/api/ops/seed-entry-list/route.ts` | Modify | Pass ranking/points to resolver |
| `src/app/api/cron/fip-scores/route.ts` | Modify | Check draw table before resolver |
| `src/app/ops/EntryListTab.tsx` | Modify | Draw upload section + readiness badges |
| `supabase/migrations/` | Create | `tournament_draws` table migration |

## What Stays the Same

- FIP scraper (`fip-scores` cron) remains the source of truth for match creation and live scores
- Relay service (Railway) for real-time Pusher WebSocket updates — untouched
- padelapi.org pipeline for Premier Padel tournaments — untouched
- Entry list parsing and seeding — works as-is, benefits from resolver improvements
- All existing UI pages (matches, rankings, player profiles) — untouched
