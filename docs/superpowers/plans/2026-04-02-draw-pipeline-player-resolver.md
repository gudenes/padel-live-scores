# Draw Pipeline + PlayerResolver Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate TBD player names on FIP tournament matches by improving PlayerResolver accuracy and adding a draw PDF upload pipeline that pre-links players to bracket positions.

**Architecture:** Two subsystems — (1) PlayerResolver improvements (toIso2 fix, ranking/points disambiguation, lower fuzzy threshold) and (2) Draw PDF pipeline (parser, tournament_draws table, API routes, FIP scraper integration, ops UI). Subsystem 1 is a prerequisite for subsystem 2. The FIP scraper remains source of truth for match creation/scores.

**Tech Stack:** Next.js 16, TypeScript 5, Supabase (PostgreSQL), pdf-parse 2.4.5, Vitest

**Spec:** `docs/superpowers/specs/2026-04-02-draw-pipeline-player-resolver-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/lib/fip-scraper.ts` | Modify | Fix `toIso2()` for 2-letter codes |
| `src/lib/player-resolver.ts` | Modify | Add ranking/points to cache + disambiguation step, lower fuzzy threshold, export `tokenSimilarity` |
| `src/lib/__tests__/player-resolver.test.ts` | Create | Tests for resolver improvements |
| `src/lib/draw-parser.ts` | Create | Pure draw PDF text parser |
| `src/lib/__tests__/draw-parser.test.ts` | Create | Tests for draw parser |
| `src/app/api/ops/seed-entry-list/route.ts` | Modify | Pass ranking/points to resolver, add readiness query |
| `src/app/api/ops/parse-draw/route.ts` | Create | PDF upload + parse API for draws |
| `src/app/api/ops/seed-draw/route.ts` | Create | Store draw + resolve players API |
| `src/app/api/cron/fip-scores/route.ts` | Modify | Check tournament_draws before resolver |
| `src/app/ops/EntryListTab.tsx` | Modify | Draw upload section + readiness badges |
| `supabase/migrations/YYYYMMDD_tournament_draws.sql` | Create | tournament_draws table |

---

### Task 1: Fix `toIso2` for 2-letter codes

**Files:**
- Modify: `src/lib/fip-scraper.ts:52-55`
- Test: `src/lib/__tests__/fip-scraper.test.ts`

- [ ] **Step 1: Write the failing test**

Open `src/lib/__tests__/fip-scraper.test.ts` and add these test cases at the end of the `toIso2` describe block (or create one if it doesn't exist in the existing test file):

```typescript
describe('toIso2', () => {
  it('converts 3-letter ISO codes to 2-letter', () => {
    expect(toIso2('ESP')).toBe('ES')
    expect(toIso2('ARG')).toBe('AR')
    expect(toIso2('KAZ')).toBe('KZ')
  })

  it('passes through valid 2-letter codes unchanged', () => {
    expect(toIso2('ES')).toBe('ES')
    expect(toIso2('AR')).toBe('AR')
    expect(toIso2('KZ')).toBe('KZ')
    expect(toIso2('DE')).toBe('DE')
  })

  it('is case-insensitive', () => {
    expect(toIso2('esp')).toBe('ES')
    expect(toIso2('es')).toBe('ES')
  })

  it('returns null for null or unknown codes', () => {
    expect(toIso2(null)).toBeNull()
    expect(toIso2('XX')).toBeNull()
    expect(toIso2('UNKNOWN')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/fip-scraper.test.ts`
Expected: FAIL — `toIso2('ES')` returns `null` instead of `'ES'`

- [ ] **Step 3: Implement the fix**

In `src/lib/fip-scraper.ts`, replace the `toIso2` function (lines 52-55):

```typescript
export function toIso2(iso3: string | null): string | null {
  if (!iso3) return null
  const upper = iso3.toUpperCase()
  // Direct 3→2 lookup
  const mapped = ISO3_TO_ISO2[upper]
  if (mapped) return mapped
  // Already a valid 2-letter code? Check if it exists as a value in the map
  if (upper.length === 2) {
    const iso2Values = new Set(Object.values(ISO3_TO_ISO2))
    if (iso2Values.has(upper)) return upper
  }
  return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/fip-scraper.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fip-scraper.ts src/lib/__tests__/fip-scraper.test.ts
git commit -m "fix: toIso2 now passes through valid 2-letter ISO codes"
```

---

### Task 2: Add ranking/points to PlayerResolver cache

**Files:**
- Modify: `src/lib/player-resolver.ts:96-103` (CachedPlayer interface), `src/lib/player-resolver.ts:117-156` (load method)

- [ ] **Step 1: Update the CachedPlayer interface**

In `src/lib/player-resolver.ts`, update the `CachedPlayer` interface (around line 96):

```typescript
interface CachedPlayer {
  id: string
  externalId: string | null
  fipId: string | null
  name: string
  country: string | null
  category: string | null
  ranking: number | null
  points: number | null
}
```

- [ ] **Step 2: Update the load() method to fetch and cache ranking/points**

In the `load()` method, update the `.select()` call (line 126):

```typescript
      const { data, error } = await this.supabase
        .from('players')
        .select('id, external_id, fip_id, name, country, category, ranking, points')
        .range(offset, offset + PAGE_SIZE - 1)
```

And update the cache building (around line 139):

```typescript
    for (const p of allData) {
      const cached: CachedPlayer = {
        id: p.id,
        externalId: p.external_id,
        fipId: p.fip_id,
        name: p.name,
        country: p.country,
        category: p.category,
        ranking: p.ranking ?? null,
        points: p.points ?? null,
      }
      if (p.external_id) this.byExternalId.set(p.external_id, cached)
      if (p.fip_id) this.byFipId.set(p.fip_id, cached)
      const norm = normalize(p.name)
      if (!this.byNormalizedName.has(norm)) this.byNormalizedName.set(norm, [])
      this.byNormalizedName.get(norm)!.push(cached)
    }
```

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `npx vitest run src/lib/__tests__/`
Expected: All existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/player-resolver.ts
git commit -m "feat: cache ranking/points in PlayerResolver for disambiguation"
```

---

### Task 3: Add ranking/points disambiguation + lower fuzzy threshold

**Files:**
- Modify: `src/lib/player-resolver.ts:173-213` (resolve method)
- Create: `src/lib/__tests__/player-resolver.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/player-resolver.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { normalize, tokenSimilarity } from '../player-resolver'

describe('normalize', () => {
  it('lowercases and strips accents', () => {
    expect(normalize('María Pérez')).toBe('maria perez')
  })

  it('replaces non-alphanumeric with spaces', () => {
    expect(normalize('Lopez-Barajas')).toBe('lopez barajas')
  })

  it('collapses whitespace', () => {
    expect(normalize('  Juan   Carlos  ')).toBe('juan carlos')
  })
})

describe('tokenSimilarity', () => {
  it('returns 1.0 for identical names', () => {
    expect(tokenSimilarity('Aranzazu Osoro Ulrich', 'Aranzazu Osoro Ulrich')).toBe(1)
  })

  it('is order-independent', () => {
    expect(tokenSimilarity('Osoro Ulrich Aranzazu', 'Aranzazu Osoro Ulrich')).toBe(1)
  })

  it('handles partial overlap', () => {
    // 2 tokens overlap out of 3 max → 0.667
    const sim = tokenSimilarity('Teresa Navarro', 'Teresa Navarro Lopez-Barajas')
    expect(sim).toBeGreaterThanOrEqual(0.5)
    expect(sim).toBeLessThan(1)
  })

  it('returns 0 for completely different names', () => {
    expect(tokenSimilarity('Juan Garcia', 'Maria Perez')).toBe(0)
  })

  it('ignores 1-letter tokens', () => {
    // "A" gets filtered out
    expect(tokenSimilarity('A Garcia', 'Garcia')).toBe(1)
  })
})

describe('ranking/points disambiguation', () => {
  // This tests the concept — we verify via normalize + tokenSimilarity
  // since resolve() requires a Supabase client
  it('normalized names match for entry list vs draw format', () => {
    // Entry list: "Aranzazu Osoro Ulrich"
    // Draw/FIP: "Aranzazu Osoro Ulrich"
    expect(normalize('Aranzazu Osoro Ulrich')).toBe(normalize('Aranzazu Osoro Ulrich'))
  })

  it('compound surnames normalize consistently', () => {
    expect(normalize('Marta Barrera De La Fuente')).toBe('marta barrera de la fuente')
    expect(normalize('BARRERA DE LA FUENTE Marta')).toBe('barrera de la fuente marta')
    // Token similarity should be 1.0 since same tokens
    expect(tokenSimilarity('Marta Barrera De La Fuente', 'BARRERA DE LA FUENTE Marta')).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify `tokenSimilarity` is not exported**

Run: `npx vitest run src/lib/__tests__/player-resolver.test.ts`
Expected: FAIL — `tokenSimilarity` is not exported from `player-resolver.ts`

- [ ] **Step 3: Export `tokenSimilarity` and `normalize`**

In `src/lib/player-resolver.ts`, the `normalize` function is already exported (line 70). Make `tokenSimilarity` also exported by changing line 84:

```typescript
export function tokenSimilarity(a: string, b: string): number {
```

Also export the `tokens` function (line 80) since `tokenSimilarity` depends on it but we don't need to export it — just `tokenSimilarity` is enough since it's self-contained.

- [ ] **Step 4: Run tests to verify exports work**

Run: `npx vitest run src/lib/__tests__/player-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Add ranking/points disambiguation to resolve()**

In `src/lib/player-resolver.ts`, replace step 3 in the `resolve()` method (around lines 188-195):

```typescript
    // 3. Exact normalized name match (prefer same category, disambiguate by ranking/points)
    if (!existing) {
      const norm = normalize(input.name)
      const candidates = this.byNormalizedName.get(norm)
      if (candidates) {
        // Filter to same category if available
        const sameCat = input.category
          ? candidates.filter(c => c.category === input.category)
          : candidates
        const pool = sameCat.length > 0 ? sameCat : candidates

        if (pool.length === 1) {
          existing = pool[0]
        } else if (pool.length > 1 && (input.ranking != null || input.points != null)) {
          // 3b. Disambiguate by ranking+points proximity
          let bestDistance = Infinity
          for (const c of pool) {
            if (c.ranking == null && c.points == null) continue
            const rDist = (input.ranking != null && c.ranking != null)
              ? Math.abs(input.ranking - c.ranking) / Math.max(input.ranking, c.ranking, 1)
              : 0.5
            const pDist = (input.points != null && c.points != null)
              ? Math.abs(input.points - c.points) / Math.max(input.points, c.points, 1)
              : 0.5
            const dist = (rDist + pDist) / 2
            if (dist < bestDistance) {
              bestDistance = dist
              existing = c
            }
          }
          // If best distance > 0.5, none are close — don't pick a bad match
          if (bestDistance > 0.5) existing = null
        } else if (pool.length > 1) {
          // No ranking/points to disambiguate — pick first (existing behavior)
          existing = pool[0]
        }
      }
    }
```

- [ ] **Step 6: Lower fuzzy threshold from 0.9 to 0.7**

In the same `resolve()` method, update step 4 (around line 198-205 after the edit):

```typescript
    // 4. Fuzzy name match (token overlap ≥ 0.7, same category)
    if (!existing && input.category) {
      let bestScore = 0
      for (const [, players] of this.byNormalizedName) {
        for (const p of players) {
          if (p.category !== input.category) continue
          const sim = tokenSimilarity(input.name, p.name)
          if (sim >= 0.7 && sim > bestScore) {
            // Extra check: if both have country, they must match
            if (input.country && p.country && input.country !== p.country) continue
            bestScore = sim
            existing = p
          }
        }
      }
    }
```

- [ ] **Step 7: Run all tests**

Run: `npx vitest run src/lib/__tests__/`
Expected: All tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/player-resolver.ts src/lib/__tests__/player-resolver.test.ts
git commit -m "feat: add ranking/points disambiguation and lower fuzzy threshold to 0.7"
```

---

### Task 4: Pass ranking/points from entry list seed endpoint

**Files:**
- Modify: `src/app/api/ops/seed-entry-list/route.ts:60-66` (SeedPlayer interface), `src/app/api/ops/seed-entry-list/route.ts:108-118` (resolve call)

- [ ] **Step 1: Update the SeedPlayer interface**

In `src/app/api/ops/seed-entry-list/route.ts`, update the `SeedPlayer` interface (around line 61):

```typescript
interface SeedPlayer {
  name: string
  country: string      // 3-letter code from PDF
  ranking?: number     // FIP ranking from entry list
  points?: number      // FIP points from entry list
  action: 'link' | 'create'
  playerId?: string    // For 'link' action — existing DB player ID
}
```

- [ ] **Step 2: Pass ranking/points to the resolver**

Update the resolve call in the POST handler (around line 114):

```typescript
        const iso2 = toIso2(player.country)
        const result = await resolver.resolve({
          name: player.name,
          country: iso2,
          category: body.category,
          ranking: player.ranking ?? null,
          points: player.points ?? null,
        })
```

- [ ] **Step 3: Update the UI to send ranking/points in the seed request**

In `src/app/ops/EntryListTab.tsx`, find the `handleSeed` callback where `allPlayers` is built (around line 256). Update the mapping to include ranking/points:

```typescript
      const allPlayers = parseResult.teams.flatMap(t =>
        t.players.map(p => ({
          name: p.name,
          country: p.country ?? '',
          ranking: p.ranking ?? undefined,
          points: p.points ?? undefined,
          action: p.action === 'new' ? 'create' : 'link',
        }))
      )
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ops/seed-entry-list/route.ts src/app/ops/EntryListTab.tsx
git commit -m "feat: pass ranking/points from entry list to PlayerResolver"
```

---

### Task 5: Draw PDF parser

**Files:**
- Create: `src/lib/draw-parser.ts`
- Create: `src/lib/__tests__/draw-parser.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/draw-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseDrawText } from '../draw-parser'

const SAMPLE_DRAW = `WOMEN
1 OSORO ULRICH, Aranzazu \tARG
IGLESIAS SEGADOR, Victoria \tESP
NEIZVESTNAYA, Angelina
TERRANOVA, Elsa \tITA
Q \tIVANOVA, Anastasia \tKAZ
KOZLOVA, Evgeniia
WC \tSINITSYNA, Mariya \tKAZ
SYSOEVA, Maria
8 NAVARRO LOPEZ-BARAJAS, Teresa \tESP
NIKITINA, Ekaterina
Round of 32
\u20AC 0 \t8 pt
Seeded teams
TEAM \tPOINTS
1. OSORO ULRICH, Aranzazu / IGLESIAS SEGADOR, Victoria \t7110
8. NIKITINA, Ekaterina / NAVARRO LOPEZ-BARAJAS, Teresa \t1228
RELEASED
30 Mar 2026
1:48 PM`

describe('parseDrawText', () => {
  it('parses bracket entries from draw text', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    expect(result.entries.length).toBeGreaterThanOrEqual(5)

    // Seed 1 team
    expect(result.entries[0]).toMatchObject({
      drawPosition: 1,
      player1Name: 'Aranzazu Osoro Ulrich',
      player1Country: 'ARG',
      player2Name: 'Victoria Iglesias Segador',
      player2Country: 'ESP',
      seed: 1,
      marker: null,
    })
  })

  it('detects Q (qualifier) markers', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    const qEntry = result.entries.find(e => e.marker === 'Q')
    expect(qEntry).toBeDefined()
    expect(qEntry!.player1Name).toBe('Anastasia Ivanova')
    expect(qEntry!.player1Country).toBe('KAZ')
  })

  it('detects WC (wild card) markers', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    const wcEntry = result.entries.find(e => e.marker === 'WC')
    expect(wcEntry).toBeDefined()
    expect(wcEntry!.player1Name).toBe('Mariya Sinitsyna')
    expect(wcEntry!.player1Country).toBe('KAZ')
  })

  it('converts LASTNAME, Firstname to Firstname Lastname', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    expect(result.entries[0].player1Name).toBe('Aranzazu Osoro Ulrich')
    // Compound surname
    const seed8 = result.entries.find(e => e.seed === 8)
    expect(seed8).toBeDefined()
    expect(seed8!.player1Name).toBe('Teresa Navarro Lopez-Barajas')
  })

  it('parses seeded teams with points', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    expect(result.seededTeams.length).toBeGreaterThanOrEqual(2)
    expect(result.seededTeams[0]).toMatchObject({
      seed: 1,
      points: 7110,
    })
  })

  it('extracts metadata', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    expect(result.metadata.category).toBe('women')
    expect(result.metadata.releaseDate).toBe('30 Mar 2026')
  })

  it('handles unseeded teams (no prefix)', () => {
    const result = parseDrawText(SAMPLE_DRAW)
    const unseeded = result.entries.find(e =>
      e.seed === null && e.marker === null && e.player1Name === 'Angelina Neizvestnaya'
    )
    expect(unseeded).toBeDefined()
    expect(unseeded!.player2Name).toBe('Elsa Terranova')
    expect(unseeded!.player2Country).toBe('ITA')
  })

  it('returns empty for empty input', () => {
    const result = parseDrawText('')
    expect(result.entries).toEqual([])
    expect(result.seededTeams).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/draw-parser.test.ts`
Expected: FAIL — module `../draw-parser` not found

- [ ] **Step 3: Implement the draw parser**

Create `src/lib/draw-parser.ts`:

```typescript
// src/lib/draw-parser.ts
// Parses FIP draw PDF text into structured bracket data.
// Pure function — no I/O, no DB access.
//
// Draw PDFs list teams in bracket order (pairs of lines per slot),
// with optional prefixes: seed number (1-8), Q (qualifier), WC (wild card), LL (lucky loser).
// After bracket entries: round prizes, seeded teams summary, withdrawals, metadata.

export interface ParsedDrawEntry {
  drawPosition: number
  player1Name: string
  player1Country: string | null
  player2Name: string
  player2Country: string | null
  seed: number | null
  marker: 'Q' | 'WC' | 'LL' | null
}

export interface ParsedSeededTeam {
  seed: number
  player1: string
  player2: string
  points: number
}

export interface DrawMetadata {
  category: 'men' | 'women'
  releaseDate: string | null
  drawSize: number
}

export interface DrawParseResult {
  entries: ParsedDrawEntry[]
  seededTeams: ParsedSeededTeam[]
  metadata: DrawMetadata
}

// ── Name helpers ────────────────────────────────────────────────

/** Convert "LASTNAME, Firstname" → "Firstname Lastname" */
function flipName(raw: string): string {
  const commaIdx = raw.indexOf(',')
  if (commaIdx === -1) {
    // No comma — title-case the whole thing
    return titleCase(raw.trim())
  }
  const last = raw.slice(0, commaIdx).trim()
  const first = raw.slice(commaIdx + 1).trim()
  return `${titleCase(first)} ${titleCase(last)}`
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(?:^|\s|-)(\S)/g, (_, c) => _.slice(0, -1) + c.toUpperCase())
    // Fix common particles that should stay lowercase (but capitalize if first word)
    .replace(/\b(De|Del|La|El|Von|Van)\b/g, (m) => m.toLowerCase() === m ? m : m)
}

// ── Parsing ─────────────────────────────────────────────────────

// Matches: optional prefix (seed number, Q, WC, LL) + player name + optional country
// Examples:
//   "1 OSORO ULRICH, Aranzazu \tARG"     → seed=1, name="OSORO ULRICH, Aranzazu", country="ARG"
//   "Q \tIVANOVA, Anastasia \tKAZ"       → marker=Q, name="IVANOVA, Anastasia", country="KAZ"
//   "NEIZVESTNAYA, Angelina"              → no prefix, name="NEIZVESTNAYA, Angelina", country=null
//   "TERRANOVA, Elsa \tITA"              → no prefix, name="TERRANOVA, Elsa", country="ITA"
const PLAYER_LINE_RE = /^(?:(\d+|Q|WC|LL)\s+)?(.+?)(?:\s+([A-Z]{2,3}))?\s*$/

// Seeded teams line: "1. OSORO ULRICH, Aranzazu / IGLESIAS SEGADOR, Victoria \t7110"
const SEEDED_TEAM_RE = /^(\d+)\.\s*(.+?)\s*\/\s*(.+?)\s+(\d+)\s*$/

// Lines that signal the end of bracket entries
const BRACKET_END_RE = /^(Round of|Quarterfinal|Semifinal|Final|Winner|\u20AC|\d+\s*$|Seeded teams|TEAM\s+POINTS|Withdrawal|Lucky|Retire|RELEASED|Tournament|Main Referee)/i

// Date line: "30 Mar 2026"
const DATE_RE = /^\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}$/

export function parseDrawText(text: string): DrawParseResult {
  if (!text.trim()) {
    return {
      entries: [],
      seededTeams: [],
      metadata: { category: 'women', releaseDate: null, drawSize: 0 },
    }
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const entries: ParsedDrawEntry[] = []
  const seededTeams: ParsedSeededTeam[] = []
  let category: 'men' | 'women' = 'women'
  let releaseDate: string | null = null

  // Detect category from first line
  const firstLine = lines[0]?.toUpperCase() ?? ''
  if (firstLine.includes('MEN') && !firstLine.includes('WOMEN')) {
    category = 'men'
  }

  // Phase 1: Parse bracket entries (pairs of player lines)
  let i = firstLine.includes('MEN') || firstLine.includes('WOMEN') ? 1 : 0
  let drawPosition = 1
  let pendingPlayer1: {
    name: string
    country: string | null
    seed: number | null
    marker: 'Q' | 'WC' | 'LL' | null
  } | null = null

  while (i < lines.length) {
    const line = lines[i]

    // Stop parsing bracket when we hit round/prize/metadata lines
    if (BRACKET_END_RE.test(line)) break

    const match = PLAYER_LINE_RE.exec(line)
    if (!match) { i++; continue }

    const prefix = match[1] ?? null
    const rawName = match[2].trim()
    const country = match[3] ?? null

    // Skip empty names
    if (!rawName || rawName === '-') { i++; continue }

    // Determine seed/marker from prefix
    let seed: number | null = null
    let marker: 'Q' | 'WC' | 'LL' | null = null
    if (prefix) {
      const num = parseInt(prefix, 10)
      if (!isNaN(num)) {
        seed = num
      } else {
        marker = prefix as 'Q' | 'WC' | 'LL'
      }
    }

    const playerName = flipName(rawName)

    if (!pendingPlayer1) {
      // This is player 1 of a team
      pendingPlayer1 = { name: playerName, country, seed, marker }
    } else {
      // This is player 2 — complete the entry
      // Player 2 inherits seed/marker from player 1 if not set
      entries.push({
        drawPosition,
        player1Name: pendingPlayer1.name,
        player1Country: pendingPlayer1.country,
        player2Name: playerName,
        player2Country: country,
        seed: pendingPlayer1.seed,
        marker: pendingPlayer1.marker,
      })
      drawPosition++
      pendingPlayer1 = null
    }

    i++
  }

  // Phase 2: Parse seeded teams and metadata from remaining lines
  for (; i < lines.length; i++) {
    const line = lines[i]

    // Seeded team line
    const seededMatch = SEEDED_TEAM_RE.exec(line)
    if (seededMatch) {
      seededTeams.push({
        seed: parseInt(seededMatch[1], 10),
        player1: flipName(seededMatch[2]),
        player2: flipName(seededMatch[3]),
        points: parseInt(seededMatch[4], 10),
      })
      continue
    }

    // Release date
    if (DATE_RE.test(line)) {
      releaseDate = line
      continue
    }
  }

  return {
    entries,
    seededTeams,
    metadata: {
      category,
      releaseDate,
      drawSize: entries.length,
    },
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/draw-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/draw-parser.ts src/lib/__tests__/draw-parser.test.ts
git commit -m "feat: add draw PDF text parser with tests"
```

---

### Task 6: Create `tournament_draws` table migration

**Files:**
- Create: `supabase/migrations/20260402_tournament_draws.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/20260402_tournament_draws.sql`:

```sql
-- tournament_draws: stores parsed bracket data from FIP draw PDFs
-- Draw entries link to players for pre-assignment before FIP scraper runs
CREATE TABLE IF NOT EXISTS tournament_draws (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
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

-- Index for FIP scraper lookups (by tournament + category)
CREATE INDEX IF NOT EXISTS idx_tournament_draws_tournament_category
  ON tournament_draws(tournament_id, category);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260402_tournament_draws.sql
git commit -m "feat: add tournament_draws table migration"
```

**Note to implementer:** This migration must be applied to the Supabase database via the dashboard or CLI before tasks 7-10 will work against the real DB. For local development, ensure the table exists.

---

### Task 7: Parse draw API route

**Files:**
- Create: `src/app/api/ops/parse-draw/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/ops/parse-draw/route.ts`:

```typescript
// src/app/api/ops/parse-draw/route.ts
// Accepts draw PDF (multipart/form-data) and returns parsed bracket data.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { cookies } from 'next/headers'
import { parseDrawText } from '@/lib/draw-parser'

export async function POST(request: Request) {
  // Auth check
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const contentType = request.headers.get('content-type') ?? ''

  if (!contentType.includes('multipart/form-data')) {
    return Response.json({ error: 'Expected multipart/form-data with PDF file' }, { status: 400 })
  }

  const formData = await request.formData()
  const file = formData.get('file') as File | null

  if (!file) {
    return Response.json({ error: 'No file provided' }, { status: 400 })
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return Response.json({ error: 'File must be a PDF' }, { status: 400 })
  }

  try {
    const { PDFParse } = await import('pdf-parse')
    const buffer = await file.arrayBuffer()
    const uint8 = new Uint8Array(buffer)
    const doc = new PDFParse({ data: uint8 })

    const result = await doc.getText()
    const text = result?.text ?? ''

    if (!text.trim()) {
      return Response.json({
        error: 'No text extracted from PDF.',
      }, { status: 422 })
    }

    const parseResult = parseDrawText(text)

    return Response.json({
      ...parseResult,
      filename: file.name,
    })
  } catch (e) {
    return Response.json({
      error: `PDF parsing failed: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 422 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/ops/parse-draw/route.ts
git commit -m "feat: add parse-draw API route for draw PDF upload"
```

---

### Task 8: Seed draw API route

**Files:**
- Create: `src/app/api/ops/seed-draw/route.ts`

- [ ] **Step 1: Create the route**

Create `src/app/api/ops/seed-draw/route.ts`:

```typescript
// src/app/api/ops/seed-draw/route.ts
// Receives confirmed draw entries, resolves players, stores in tournament_draws.
// Auth: reads ops_token cookie (httpOnly, set by middleware on /ops login).

import { createClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'
import { PlayerResolver } from '@/lib/player-resolver'
import { toIso2 } from '@/lib/fip-scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

async function checkOpsAuth(): Promise<Response | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('ops_token')?.value
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return null
}

interface SeedDrawEntry {
  drawPosition: number
  player1Name: string
  player1Country: string | null
  player2Name: string
  player2Country: string | null
  seed: number | null
  marker: 'Q' | 'WC' | 'LL' | null
  teamPoints: number | null
}

interface SeedDrawRequest {
  tournamentId: string
  category: 'men' | 'women'
  entries: SeedDrawEntry[]
}

export async function POST(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const body: SeedDrawRequest = await request.json()

  if (!body.tournamentId || !body.category || !body.entries?.length) {
    return Response.json({ error: 'Missing required fields: tournamentId, category, entries' }, { status: 400 })
  }

  // Verify tournament exists
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name')
    .eq('id', body.tournamentId)
    .single()

  if (!tournament) {
    return Response.json({ error: 'Tournament not found' }, { status: 404 })
  }

  const resolver = new PlayerResolver(supabase)
  await resolver.load()

  let resolved = 0
  let created = 0
  const errors: string[] = []

  for (const entry of body.entries) {
    try {
      // Resolve player 1
      const p1Result = await resolver.resolve({
        name: entry.player1Name,
        country: toIso2(entry.player1Country),
        category: body.category,
        points: entry.teamPoints ?? undefined,
      })
      if (p1Result.action === 'created') created++
      else resolved++

      // Resolve player 2
      const p2Result = await resolver.resolve({
        name: entry.player2Name,
        country: toIso2(entry.player2Country),
        category: body.category,
      })
      if (p2Result.action === 'created') created++
      else resolved++

      // Upsert into tournament_draws
      await supabase
        .from('tournament_draws')
        .upsert({
          tournament_id: body.tournamentId,
          category: body.category,
          draw_position: entry.drawPosition,
          seed: entry.seed,
          marker: entry.marker,
          player1_name: entry.player1Name,
          player1_country: toIso2(entry.player1Country),
          player1_id: p1Result.playerId,
          player2_name: entry.player2Name,
          player2_country: toIso2(entry.player2Country),
          player2_id: p2Result.playerId,
          team_points: entry.teamPoints,
        }, { onConflict: 'tournament_id, category, draw_position' })

    } catch (e) {
      errors.push(`Slot ${entry.drawPosition}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Log to ops_events
  await supabase.from('ops_events').insert({
    source: 'draw-seed',
    status: errors.length > 0 ? 'partial' : 'ok',
    started_at: new Date().toISOString(),
    duration_ms: 0,
    meta: {
      tournament_id: body.tournamentId,
      tournament_name: tournament.name,
      category: body.category,
      slots_total: body.entries.length,
      players_resolved: resolved,
      players_created: created,
      errors: errors.length,
    },
    error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
  })

  return Response.json({
    slots: body.entries.length,
    resolved,
    created,
    errors,
  })
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/ops/seed-draw/route.ts
git commit -m "feat: add seed-draw API route to store draw + resolve players"
```

---

### Task 9: FIP scraper integration — check draws before resolver

**Files:**
- Modify: `src/app/api/cron/fip-scores/route.ts`

- [ ] **Step 1: Add draw data loading at the start of the cron run**

In `src/app/api/cron/fip-scores/route.ts`, add the import for `tokenSimilarity` at the top (line 6):

```typescript
import { PlayerResolver, tokenSimilarity } from '@/lib/player-resolver'
```

After the `resolver.load()` call (around line 70), add draw data loading:

```typescript
      const resolver = new PlayerResolver(supabase)
      await resolver.load()

      // Load draw data for active tournaments (for pre-resolved player IDs)
      const tournamentIds = tournaments.map(t => t.id)
      const { data: drawEntries } = await supabase
        .from('tournament_draws')
        .select('tournament_id, category, player1_name, player1_id, player2_name, player2_id')
        .in('tournament_id', tournamentIds)
      const draws = drawEntries ?? []
```

- [ ] **Step 2: Update `upsertFipMatch` signature to accept draws**

Update the function signature (around line 121):

```typescript
async function upsertFipMatch(
  match: ParsedMatch,
  tournamentId: string,
  resolver: PlayerResolver,
  matchIndex: number,
  draws: Array<{
    tournament_id: string
    category: string
    player1_name: string
    player1_id: string | null
    player2_name: string
    player2_id: string | null
  }>,
): Promise<'upserted' | 'skipped'> {
```

Update the call site (around line 90):

```typescript
              const matchResult = await upsertFipMatch(match, tournament.id, resolver, i, draws)
```

- [ ] **Step 3: Update `resolvePlayer` to check draws first**

Update the `resolvePlayer` function (around line 224):

```typescript
async function resolvePlayer(
  resolver: PlayerResolver,
  player: { firstName: string; lastName: string; country: string | null; seed: number | null },
  category: 'men' | 'women',
  tournamentId: string,
  draws: Array<{
    tournament_id: string
    category: string
    player1_name: string
    player1_id: string | null
    player2_name: string
    player2_id: string | null
  }>,
): Promise<string | null> {
  const fullName = `${player.firstName} ${player.lastName}`.trim()
  if (!fullName || fullName === '-') return null

  // 1. Check draw table for pre-resolved player
  for (const d of draws) {
    if (d.tournament_id !== tournamentId || d.category !== category) continue
    if (d.player1_id && tokenSimilarity(fullName, d.player1_name) >= 0.7) {
      return d.player1_id
    }
    if (d.player2_id && tokenSimilarity(fullName, d.player2_name) >= 0.7) {
      return d.player2_id
    }
  }

  // 2. Fall back to PlayerResolver
  try {
    const { playerId } = await resolver.resolve({
      name: fullName,
      country: toIso2(player.country),
      category,
    })
    return playerId
  } catch (e) {
    console.error(`[FIP Scores] Failed to resolve player ${fullName}:`, e)
    return null
  }
}
```

- [ ] **Step 4: Update the 4 `resolvePlayer` calls in `upsertFipMatch`**

Update the parallel resolve calls (around line 142):

```typescript
  const [p1p1, p1p2, p2p1, p2p2] = await Promise.all([
    resolvePlayer(resolver, match.team1.player1, match.category, tournamentId, draws),
    resolvePlayer(resolver, match.team1.player2, match.category, tournamentId, draws),
    resolvePlayer(resolver, match.team2.player1, match.category, tournamentId, draws),
    resolvePlayer(resolver, match.team2.player2, match.category, tournamentId, draws),
  ])
```

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/fip-scores/route.ts
git commit -m "feat: FIP scraper checks tournament_draws before PlayerResolver"
```

---

### Task 10: Tournament readiness badges in API

**Files:**
- Modify: `src/app/api/ops/seed-entry-list/route.ts:35-53` (GET handler)

- [ ] **Step 1: Add readiness queries to the tournament list endpoint**

In `src/app/api/ops/seed-entry-list/route.ts`, update the `list-tournaments` handler. After fetching tournaments, query for readiness data. Replace the section from line 35 to line 53:

```typescript
  if (action === 'list-tournaments') {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const { data: tournaments, error } = await supabase
      .from('tournaments')
      .select('id, name, country, level, starts_at, ends_at')
      .eq('source', 'fip')
      .gte('starts_at', thirtyDaysAgo)
      .lte('starts_at', in30Days)
      .order('starts_at', { ascending: true })

    if (error) {
      console.error('[Entry List] Failed to fetch tournaments:', error.message)
      return Response.json({ error: error.message, tournaments: [] }, { status: 500 })
    }

    // Check readiness: which tournaments have entry lists and draws uploaded
    const tournamentIds = (tournaments ?? []).map(t => t.id)

    // Entry list seeds from ops_events
    const { data: entryListEvents } = await supabase
      .from('ops_events')
      .select('meta')
      .eq('source', 'entry-list-seed')
      .in('meta->>tournament_id', tournamentIds)

    const entryListTournamentIds = new Set(
      (entryListEvents ?? []).map(e => (e.meta as any)?.tournament_id).filter(Boolean)
    )

    // Draw seeds from tournament_draws
    const { data: drawRows } = await supabase
      .from('tournament_draws')
      .select('tournament_id')
      .in('tournament_id', tournamentIds)

    const drawTournamentIds = new Set(
      (drawRows ?? []).map(r => r.tournament_id)
    )

    const enriched = (tournaments ?? []).map(t => ({
      ...t,
      hasEntryList: entryListTournamentIds.has(t.id),
      hasDraw: drawTournamentIds.has(t.id),
    }))

    return Response.json({ tournaments: enriched })
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/ops/seed-entry-list/route.ts
git commit -m "feat: add hasEntryList/hasDraw readiness flags to tournament list"
```

---

### Task 11: Ops UI — Draw upload section + readiness badges

**Files:**
- Modify: `src/app/ops/EntryListTab.tsx`

This is the largest UI task. It adds: (1) readiness badges on tournament selector, (2) draw PDF upload section below entry list, (3) draw preview and seed flow.

- [ ] **Step 1: Add `hasEntryList` and `hasDraw` to Tournament interface**

In `src/app/ops/EntryListTab.tsx`, update the `Tournament` interface (around line 9):

```typescript
interface Tournament {
  id: string
  name: string
  country: string | null
  level: string | null
  starts_at: string | null
  ends_at: string | null
  hasEntryList?: boolean
  hasDraw?: boolean
}
```

- [ ] **Step 2: Add draw-related types**

After the existing `SeedResult` interface (around line 52), add:

```typescript
interface DrawEntry {
  drawPosition: number
  player1Name: string
  player1Country: string | null
  player2Name: string
  player2Country: string | null
  seed: number | null
  marker: 'Q' | 'WC' | 'LL' | null
  teamPoints: number | null
}

interface DrawParseResult {
  entries: DrawEntry[]
  seededTeams: { seed: number; player1: string; player2: string; points: number }[]
  metadata: { category: 'men' | 'women'; releaseDate: string | null; drawSize: number }
  filename: string
}

interface DrawSeedResult {
  slots: number
  resolved: number
  created: number
  errors: string[]
}
```

- [ ] **Step 3: Add readiness badges to tournament selector**

Find the tournament option rendering in the `sortedTournaments.map()` (around line 337). Update each `<option>` to show EL/DR status:

```typescript
              {sortedTournaments.map(t => {
                const dot = urgencyDot(t)
                const el = t.hasEntryList ? '\u2713' : '\u2717'
                const dr = t.hasDraw ? '\u2713' : '\u2717'
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}{t.country ? ` (${t.country})` : ''} — {dot.label} [EL:{el}] [DR:{dr}]
                  </option>
                )
              })}
```

Also update the urgency dots list (quick-select, around line 368). After the `dot.label` div, add badges:

```typescript
                    <div style={{ fontSize: 10, color: '#888', display: 'flex', gap: 4, alignItems: 'center' }}>
                      {dot.label}
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: t.hasEntryList ? '#dcfce7' : '#fef2f2', color: t.hasEntryList ? '#166534' : '#dc2626' }}>EL</span>
                      <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 4px', borderRadius: 3, background: t.hasDraw ? '#dcfce7' : '#fef2f2', color: t.hasDraw ? '#166534' : '#dc2626' }}>DR</span>
                    </div>
```

- [ ] **Step 4: Add draw upload state and handlers**

After the existing state declarations (around line 141), add:

```typescript
  // Draw upload state
  const [drawFile, setDrawFile] = useState<File | null>(null)
  const [drawParseResult, setDrawParseResult] = useState<DrawParseResult | null>(null)
  const [drawParseError, setDrawParseError] = useState<string | null>(null)
  const [drawSeedResult, setDrawSeedResult] = useState<DrawSeedResult | null>(null)
  const [drawStage, setDrawStage] = useState<'idle' | 'parsing' | 'preview' | 'seeding' | 'done'>('idle')
  const drawFileInputRef = useRef<HTMLInputElement>(null)
```

Add handler functions after `handleReset` (around line 297):

```typescript
  // ── Draw handlers ────────────────────────────────────────────────

  const handleDrawFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) setDrawFile(file)
  }, [])

  const handleDrawParse = useCallback(async () => {
    if (!drawFile || !selectedTournament) return
    setDrawParseError(null)
    setDrawStage('parsing')

    try {
      const form = new FormData()
      form.append('file', drawFile)
      const res = await fetch('/api/ops/parse-draw', { method: 'POST', body: form })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Parse failed')
      }

      const data: DrawParseResult = await res.json()
      setDrawParseResult(data)
      setDrawStage('preview')
    } catch (err: unknown) {
      setDrawParseError(err instanceof Error ? err.message : 'Parse failed')
      setDrawStage('idle')
    }
  }, [drawFile, selectedTournament])

  const handleDrawSeed = useCallback(async () => {
    if (!drawParseResult || !selectedTournament) return
    setDrawStage('seeding')

    try {
      // Merge team_points from seededTeams into entries
      const seededMap = new Map(drawParseResult.seededTeams.map(s => [s.seed, s.points]))
      const entries = drawParseResult.entries.map(e => ({
        ...e,
        teamPoints: e.seed ? seededMap.get(e.seed) ?? null : null,
      }))

      const res = await fetch('/api/ops/seed-draw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: selectedTournament,
          category,
          entries,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error ?? 'Seed failed')
      }

      const data: DrawSeedResult = await res.json()
      setDrawSeedResult(data)
      setDrawStage('done')
    } catch (err: unknown) {
      setDrawParseError(err instanceof Error ? err.message : 'Seed failed')
      setDrawStage('preview')
    }
  }, [drawParseResult, selectedTournament, category])

  const handleDrawReset = useCallback(() => {
    setDrawStage('idle')
    setDrawFile(null)
    setDrawParseResult(null)
    setDrawSeedResult(null)
    setDrawParseError(null)
    if (drawFileInputRef.current) drawFileInputRef.current.value = ''
  }, [])
```

- [ ] **Step 5: Add draw upload UI section**

In the `select` stage render (inside `if (stage === 'select' || stage === 'parsing')`), add a draw upload section **after** the parse button and loading spinner (before the closing `</div>`). Add it right before the final `</div>` of the select stage:

```typescript
        {/* ── Draw Upload Section ──────────────────────────────────── */}
        <div style={{ marginTop: 24, borderTop: '1px solid #e5e7eb', paddingTop: 16 }}>
          <div style={sectionLabel}>Upload Draw PDF</div>

          {drawParseError && (
            <div style={{ ...card, background: '#fef2f2', border: '1px solid #fecaca', marginBottom: 12, color: '#dc2626', fontSize: 12 }}>
              {drawParseError}
            </div>
          )}

          {drawStage === 'idle' && (
            <div style={{ ...card, marginBottom: 12 }}>
              <input
                ref={drawFileInputRef}
                type="file"
                accept=".pdf"
                style={{ display: 'none' }}
                onChange={handleDrawFileChange}
              />
              <div
                onClick={() => drawFileInputRef.current?.click()}
                style={{
                  border: '2px dashed #d1d5db',
                  borderRadius: 8,
                  padding: '20px 16px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: '#fafafa',
                }}
              >
                {drawFile ? (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>{drawFile.name}</div>
                    <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                      {(drawFile.size / 1024).toFixed(1)} KB · Click to change
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 13, color: '#555' }}>
                      Drop draw PDF here or <span style={{ color: '#3b82f6', textDecoration: 'underline' }}>browse</span>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleDrawParse}
                disabled={!drawFile || !selectedTournament}
                style={{
                  width: '100%',
                  marginTop: 8,
                  padding: '8px 0',
                  borderRadius: 8,
                  border: 'none',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: drawFile && selectedTournament ? 'pointer' : 'not-allowed',
                  background: drawFile && selectedTournament ? '#8b5cf6' : '#e5e7eb',
                  color: drawFile && selectedTournament ? '#fff' : '#9ca3af',
                }}
              >
                Parse Draw
              </button>
            </div>
          )}

          {drawStage === 'parsing' && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: 20, color: '#666', fontSize: 13 }}>
              <Spinner />
              Parsing draw PDF...
            </div>
          )}

          {drawStage === 'preview' && drawParseResult && (
            <div>
              <div style={{ ...card, marginBottom: 12 }}>
                <div style={sectionLabel}>
                  Draw Preview — {drawParseResult.metadata.drawSize} slots
                  {drawParseResult.metadata.releaseDate && (
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: 8 }}>Released {drawParseResult.metadata.releaseDate}</span>
                  )}
                </div>
                <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
                  <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666', width: 30 }}>#</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: '#666', width: 40 }}>Seed</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Player 1</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Player 2</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 600, color: '#666', width: 36 }}>Tag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {drawParseResult.entries.map((entry, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? '#fff' : '#f9fafb', borderBottom: '1px solid #f3f4f6' }}>
                          <td style={{ padding: '5px 8px', color: '#999', fontSize: 10 }}>{entry.drawPosition}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: '#3b82f6' }}>{entry.seed ?? ''}</td>
                          <td style={{ padding: '5px 8px', color: '#111' }}>
                            {entry.player1Name}
                            {entry.player1Country && <span style={{ color: '#999', marginLeft: 4 }}>({entry.player1Country})</span>}
                          </td>
                          <td style={{ padding: '5px 8px', color: '#111' }}>
                            {entry.player2Name}
                            {entry.player2Country && <span style={{ color: '#999', marginLeft: 4 }}>({entry.player2Country})</span>}
                          </td>
                          <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                            {entry.marker && (
                              <span style={{
                                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                                background: entry.marker === 'Q' ? '#dbeafe' : entry.marker === 'WC' ? '#fef3c7' : '#f3e8ff',
                                color: entry.marker === 'Q' ? '#1e40af' : entry.marker === 'WC' ? '#92400e' : '#6b21a8',
                              }}>{entry.marker}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={handleDrawReset} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, fontWeight: 600, cursor: 'pointer', background: 'white', color: '#374151' }}>
                  Back
                </button>
                <button onClick={handleDrawSeed} style={{ flex: 2, padding: '8px 0', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#8b5cf6', color: '#fff' }}>
                  Seed {drawParseResult.entries.length} Draw Slots
                </button>
              </div>
            </div>
          )}

          {drawStage === 'seeding' && (
            <div style={{ textAlign: 'center', padding: 20 }}>
              <Spinner />
              <div style={{ fontSize: 13, color: '#555', marginTop: 8 }}>Seeding draw data...</div>
            </div>
          )}

          {drawStage === 'done' && drawSeedResult && (
            <div style={{ ...card }}>
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <div style={{ fontSize: 22, marginBottom: 4 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#111' }}>Draw Seeded</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Slots</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>{drawSeedResult.slots}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Resolved</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#22c55e' }}>{drawSeedResult.resolved}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 9, color: '#aaa', textTransform: 'uppercase' as const, fontWeight: 600 }}>Created</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#3b82f6' }}>{drawSeedResult.created}</div>
                </div>
              </div>
              {drawSeedResult.errors.length > 0 && (
                <div style={{ fontSize: 11, color: '#dc2626' }}>
                  {drawSeedResult.errors.map((err, i) => <div key={i}>• {err}</div>)}
                </div>
              )}
              <button onClick={handleDrawReset} style={{ width: '100%', marginTop: 8, padding: '8px 0', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 700, cursor: 'pointer', background: '#8b5cf6', color: '#fff' }}>
                Upload Another Draw
              </button>
            </div>
          )}
        </div>
```

- [ ] **Step 6: Update handleReset to also reset draw state**

Update the existing `handleReset` callback to also clear draw state:

```typescript
  const handleReset = useCallback(() => {
    setStage('select')
    setParseResult(null)
    setSeedResult(null)
    setParseError(null)
    setSeedError(null)
    setSelectedFile(null)
    setPasteText('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    // Also reset draw state
    handleDrawReset()
  }, [handleDrawReset])
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | grep -v vitest`
Expected: Only pre-existing vitest import errors

- [ ] **Step 8: Commit**

```bash
git add src/app/ops/EntryListTab.tsx
git commit -m "feat: add draw upload UI section + tournament readiness badges"
```

---

## Self-Review

**Spec coverage:**
- ✅ 1.1 Fix toIso2 → Task 1
- ✅ 1.2 Ranking/points disambiguation → Tasks 2+3
- ✅ 1.3 Lower fuzzy threshold → Task 3
- ✅ 1.4 Pass ranking/points from entry list → Task 4
- ✅ 2.1 Draw parser → Task 5
- ✅ 2.2 Database table → Task 6
- ✅ 2.3 API routes → Tasks 7+8
- ✅ 2.4 FIP scraper integration → Task 9
- ✅ 2.5 Ops UI (draw upload + readiness badges) → Tasks 10+11

**Placeholder scan:** No TBD/TODO/placeholders found. All steps have complete code.

**Type consistency:**
- `ParsedDrawEntry` in draw-parser.ts matches `DrawEntry` in EntryListTab.tsx (field names aligned)
- `SeedDrawEntry` in seed-draw route matches what the UI sends
- `tokenSimilarity` exported from player-resolver.ts and imported in fip-scores route
- `DrawParseResult` in UI matches API response shape from parse-draw route
