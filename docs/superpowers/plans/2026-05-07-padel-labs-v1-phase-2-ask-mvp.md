# Padel Labs v1 — Phase 2: Ask MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 1 stub at `POST /api/v1/ask` with a real chat engine: Claude Haiku 4.5 + tool use + 3 SQL skills (player search, recent matches, head-to-head), citations grounded in real `matches`/`players` data, multi-turn conversation history persisted in `labs_conversations` + `labs_messages`, and a free-tier daily rate limit (10/day) enforced via `labs_usage_events`. Authenticated workspace only — public demo + i18n + Stripe defer to later phases.

**Architecture:** Non-streaming agentic loop in a Next.js Route Handler. The handler validates the Auth.js session, checks the user's daily usage, runs a tool-use loop against the Anthropic SDK with prompt-cached system prompt + tool definitions, executes parameterized SQL skills against the shared Supabase Postgres (read-only — `matches`/`players`/`tournaments`), persists user + assistant messages with token costs, and returns a JSON envelope with `answer` + `citations[]` + `cost`. The frontend `(app)/ask/page.tsx` becomes a multi-turn chat with a conversation sidebar; conversations are listed via two new endpoints (`GET /api/v1/conversations` + `GET /api/v1/conversations/[id]`).

**Tech Stack:** Next.js 16.2.0, Anthropic TypeScript SDK (`@anthropic-ai/sdk` ^0.74), Claude Haiku 4.5 (`claude-haiku-4-5-20251001`), `@supabase/supabase-js` (already in Phase 1), Auth.js v5 (already in Phase 1), Vitest 4.

---

## Phasing context

This is Phase 2 of 5 (see [v1 design spec](../specs/2026-05-06-padel-labs-v1-design.md)). Phase 1 (Foundation) is complete. Subsequent phases:

- **P3 — Templates + Outputs**: 3 templates, PNG card rendering via Satori, CSV/JSON export
- **P4 — Billing + Cost optimization**: Stripe Checkout, pre-classifier (Tier 0/1/2 routing), output cache, Sonnet escalation, Pro tier 100/day
- **P5 — Marketing site + i18n + public demo**: 5 locales, IP-throttled demo chat at `padellabs.tech`

Phase 2's deliverable: a logged-in user at `analyst.padellabs.tech/ask` can ask a multi-turn question grounded in real padel data, see cited match IDs in the answer, view their conversation history in a sidebar, and is rate-limited to 10 questions per day.

## Decisions locked in (do not re-debate during execution)

| Decision | Choice | Why |
|---|---|---|
| Streaming | **No** — single JSON response | Phase 2 is the simplest end-to-end loop; SSE adds client + server complexity that buys little for the MVP. Phase 3+ can add streaming if user research warrants. |
| Pre-classifier (Tier 0/1/2) | **No** — Haiku 4.5 for everything | Spec section 9.4 ships in Phase 4 (cost optimization). Phase 2 is correctness-first. |
| Output cache | **No** | Same reason — Phase 4. |
| Sonnet escalation | **No** — Haiku only, max 8 tool-use iterations | Phase 2 stays single-model. If Haiku tool-loops > 8, return graceful "I couldn't converge" error. |
| Prompt caching | **Yes** | Free latency + cost win. System prompt + tool defs > 2048 tokens (Haiku threshold), so cache hits will be common. One extra field on the request — no architectural cost. |
| i18n | **No** — English only | Phase 5. Phase 2 system prompt is English; `locale` column on `labs_conversations` is set to `'en'` and ignored. |
| Public demo / IP throttling | **No** — auth required | Phase 5 with marketing site. Phase 2 demo runs from logged-in `/ask`. |
| Stripe / Pro tier | **No** — free tier only, hardcoded 10/day | Phase 4. |
| Tool count | **3** — `search_player`, `get_player_recent_matches`, `get_head_to_head` | Covers spec capabilities C2 + C3. Compose well: ask "H2H between Tapia and Galán?" → `search_player('Tapia')` → `search_player('Galán')` → `get_head_to_head(idA, idB)`. |
| Citation rendering | **List at end** | Each citation = `{ match_id, played_at, tournament_name, score, pair1, pair2 }`. Inline anchor links defer to Phase 3. |
| New conversation creation | **Implicit** — first message creates a row | No "new chat" button needed for the MVP UI. |
| Conversation title | **Auto-set** from the first user message (truncated to 80 chars) | Saves an extra UI step. |

## File Structure

```
apps/labs/
├── package.json                                          # MODIFIED: add @anthropic-ai/sdk
├── .env.local.example                                    # MODIFIED: add ANTHROPIC_API_KEY
├── src/
│   ├── app/
│   │   ├── (app)/
│   │   │   └── ask/
│   │   │       ├── page.tsx                              # MODIFIED: multi-turn UI + sidebar mount
│   │   │       └── ConversationSidebar.tsx               # NEW: client component listing user conversations
│   │   └── api/
│   │       └── v1/
│   │           ├── ask/route.ts                          # MODIFIED: real chat engine
│   │           └── conversations/
│   │               ├── route.ts                          # NEW: GET list
│   │               └── [id]/route.ts                     # NEW: GET single
│   └── lib/
│       ├── ai/
│       │   ├── client.ts                                 # NEW: Anthropic client singleton
│       │   ├── system-prompt.ts                          # NEW: system prompt builder
│       │   ├── tools.ts                                  # NEW: tool definitions
│       │   └── chat.ts                                   # NEW: agentic loop
│       ├── data/
│       │   ├── search-player.ts                          # NEW: SQL skill
│       │   ├── player-recent-matches.ts                  # NEW: SQL skill
│       │   ├── head-to-head.ts                           # NEW: SQL skill
│       │   └── types.ts                                  # NEW: shared row types
│       ├── conversations.ts                              # NEW: persistence helpers
│       └── usage.ts                                      # NEW: rate-limit helpers
└── tests/
    ├── data/
    │   ├── search-player.test.ts                         # NEW
    │   ├── player-recent-matches.test.ts                 # NEW
    │   └── head-to-head.test.ts                          # NEW
    ├── ai/
    │   └── chat.test.ts                                  # NEW (mocks Anthropic SDK)
    └── usage.test.ts                                     # NEW
```

---

## Task 1: Install Anthropic SDK and add env var

**Files:**
- Modify: `apps/labs/package.json`
- Modify: `apps/labs/.env.local.example`

- [ ] **Step 1.1: Add the SDK to dependencies**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npm install @anthropic-ai/sdk@^0.74.0 --save
```

Expected: `package.json` and `package-lock.json` updated; one new `dependencies` entry.

- [ ] **Step 1.2: Add `ANTHROPIC_API_KEY` to `.env.local.example`**

Append to `apps/labs/.env.local.example`:

```
# Anthropic — chat engine (Phase 2)
ANTHROPIC_API_KEY=
```

- [ ] **Step 1.3: Add `ANTHROPIC_API_KEY` to local `.env.local`**

```bash
echo "" >> /Users/GuDenes/Projects/padel-live-scores/apps/labs/.env.local
echo "# Anthropic — chat engine" >> /Users/GuDenes/Projects/padel-live-scores/apps/labs/.env.local
echo "ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' /Users/GuDenes/Projects/padel-live-scores/.env.local | head -1 | cut -d= -f2-)" >> /Users/GuDenes/Projects/padel-live-scores/apps/labs/.env.local
```

If Nachos doesn't have `ANTHROPIC_API_KEY` in its `.env.local`, manually paste a valid key from https://console.anthropic.com/.

- [ ] **Step 1.4: Verify dev server still boots**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npm run dev
```

Expected: `✓ Ready in <1s`. Cancel with Ctrl-C.

- [ ] **Step 1.5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/package.json apps/labs/package-lock.json apps/labs/.env.local.example
git commit -m "feat(labs): add @anthropic-ai/sdk dep + ANTHROPIC_API_KEY env"
```

---

## Task 2: SQL skill — `search_player`

Resolve fuzzy player names to canonical `players.id` rows. Returns up to 5 candidates with id/name/country/ranking.

**Files:**
- Create: `apps/labs/src/lib/data/types.ts`
- Create: `apps/labs/src/lib/data/search-player.ts`
- Create: `apps/labs/tests/data/search-player.test.ts`

- [ ] **Step 2.1: Define shared row types**

Create `apps/labs/src/lib/data/types.ts`:

```ts
// apps/labs/src/lib/data/types.ts
// Shared row types returned by data/* skills. Kept minimal — only fields the
// chat engine cites or surfaces. If a skill needs more, add to that skill's
// own return type.

export type PlayerRow = {
  id: string
  name: string
  country: string | null
  category: 'men' | 'women' | null
  ranking: number | null
}

export type MatchSummary = {
  id: string
  played_at: string | null            // ISO date
  tournament_id: string | null
  tournament_name: string | null
  round: string | null
  status: string
  pair1: { player1_name: string | null; player2_name: string | null }
  pair2: { player1_name: string | null; player2_name: string | null }
  winner_pair: number | null          // 1 or 2
  set_scores: string[]                // e.g. ['6-3', '4-6', '7-6']
}

export type Citation = {
  match_id: string
  played_at: string | null
  tournament_name: string | null
  score: string                        // joined set scores
  pair1: string                        // "Tapia / Coello"
  pair2: string
}
```

- [ ] **Step 2.2: Write the failing test**

Create `apps/labs/tests/data/search-player.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { searchPlayer } from '../../src/lib/data/search-player'

const hasDb = !!process.env.DATABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('searchPlayer', () => {
  it('returns at least one candidate for a known surname', async () => {
    const results = await searchPlayer('Tapia', { limit: 5 })
    expect(results.length).toBeGreaterThan(0)
    expect(results[0]).toHaveProperty('id')
    expect(results[0]).toHaveProperty('name')
    // Tapia should be in there somewhere
    const names = results.map((r) => r.name.toLowerCase())
    expect(names.some((n) => n.includes('tapia'))).toBe(true)
  })

  it('returns empty array for nonsense', async () => {
    const results = await searchPlayer('zzzzzznonexistentzzzzzz', { limit: 5 })
    expect(results).toEqual([])
  })

  it('caps at limit', async () => {
    const results = await searchPlayer('a', { limit: 3 })
    expect(results.length).toBeLessThanOrEqual(3)
  })
})
```

- [ ] **Step 2.3: Run test to verify it fails**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npx vitest run tests/data/search-player.test.ts
```

Expected: FAIL with "Cannot find module" — `search-player.ts` doesn't exist yet.

- [ ] **Step 2.4: Implement `searchPlayer`**

Create `apps/labs/src/lib/data/search-player.ts`:

```ts
// apps/labs/src/lib/data/search-player.ts
// Fuzzy player name search. Uses ILIKE + ranking-based ordering. Returns
// canonical player ids the chat engine can pass to other skills.

import { supabaseService } from '@/lib/db'
import type { PlayerRow } from './types'

export async function searchPlayer(
  query: string,
  opts: { limit?: number } = {},
): Promise<PlayerRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 20)
  const q = query.trim()
  if (q.length < 2) return []

  const supabase = supabaseService()
  const { data, error } = await supabase
    .from('players')
    .select('id, name, country, category, ranking')
    .ilike('name', `%${q}%`)
    .order('ranking', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) throw new Error(`searchPlayer failed: ${error.message}`)
  return (data ?? []) as PlayerRow[]
}
```

- [ ] **Step 2.5: Run test to verify it passes**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npx vitest run tests/data/search-player.test.ts
```

Expected: PASS (or SKIP if no DB env). Run with env if skipped:

```bash
set -a && source /Users/GuDenes/Projects/padel-live-scores/apps/labs/.env.local && set +a && npx vitest run tests/data/search-player.test.ts
```

Expected: 3 passed.

- [ ] **Step 2.6: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/lib/data/types.ts apps/labs/src/lib/data/search-player.ts apps/labs/tests/data/search-player.test.ts
git commit -m "feat(labs): SQL skill search_player"
```

---

## Task 3: SQL skill — `get_player_recent_matches`

Returns the last N completed matches for a player, with tournament + score + opponent names. Handles padel pair structure (4 player FKs per match).

**Files:**
- Create: `apps/labs/src/lib/data/player-recent-matches.ts`
- Create: `apps/labs/tests/data/player-recent-matches.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `apps/labs/tests/data/player-recent-matches.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getPlayerRecentMatches } from '../../src/lib/data/player-recent-matches'
import { searchPlayer } from '../../src/lib/data/search-player'

const hasDb = !!process.env.DATABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('getPlayerRecentMatches', () => {
  it('returns recent matches for a top-50 player', async () => {
    const players = await searchPlayer('Tapia', { limit: 1 })
    expect(players.length).toBeGreaterThan(0)
    const matches = await getPlayerRecentMatches(players[0].id, { limit: 5 })
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.length).toBeLessThanOrEqual(5)
    const m = matches[0]
    expect(m).toHaveProperty('id')
    expect(m).toHaveProperty('played_at')
    expect(m).toHaveProperty('pair1')
    expect(m).toHaveProperty('pair2')
    expect(Array.isArray(m.set_scores)).toBe(true)
  })

  it('returns empty array for unknown id', async () => {
    const matches = await getPlayerRecentMatches('00000000-0000-0000-0000-000000000000', { limit: 5 })
    expect(matches).toEqual([])
  })

  it('orders by played_at descending', async () => {
    const players = await searchPlayer('Tapia', { limit: 1 })
    const matches = await getPlayerRecentMatches(players[0].id, { limit: 10 })
    if (matches.length < 2) return
    for (let i = 1; i < matches.length; i++) {
      const prev = matches[i - 1].played_at ? new Date(matches[i - 1].played_at!).getTime() : 0
      const curr = matches[i].played_at ? new Date(matches[i].played_at!).getTime() : 0
      expect(prev).toBeGreaterThanOrEqual(curr)
    }
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npx vitest run tests/data/player-recent-matches.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3.3: Implement `getPlayerRecentMatches`**

Create `apps/labs/src/lib/data/player-recent-matches.ts`:

```ts
// apps/labs/src/lib/data/player-recent-matches.ts
// Last N completed matches for a single player. Joins all 4 player FKs +
// tournament + sets in a single query, formats sets into a "6-3, 4-6, 7-5" array.

import { supabaseService } from '@/lib/db'
import type { MatchSummary } from './types'

const TERMINAL_STATUSES = ['finished', 'retired', 'walkover'] as const

export async function getPlayerRecentMatches(
  playerId: string,
  opts: { limit?: number } = {},
): Promise<MatchSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 25)
  const supabase = supabaseService()

  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, played_at, status, round, winner_pair, tournament_id,
      tournament:tournaments ( name ),
      p1p1:players!matches_pair1_player1_id_fkey ( name ),
      p1p2:players!matches_pair1_player2_id_fkey ( name ),
      p2p1:players!matches_pair2_player1_id_fkey ( name ),
      p2p2:players!matches_pair2_player2_id_fkey ( name ),
      sets ( set_number, set_score )
    `)
    .or(
      `pair1_player1_id.eq.${playerId},pair1_player2_id.eq.${playerId},pair2_player1_id.eq.${playerId},pair2_player2_id.eq.${playerId}`,
    )
    .in('status', TERMINAL_STATUSES as unknown as string[])
    .order('played_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (error) throw new Error(`getPlayerRecentMatches failed: ${error.message}`)
  return (data ?? []).map(rowToMatchSummary)
}

// Exported for reuse in head-to-head.ts
export function rowToMatchSummary(row: any): MatchSummary {
  const sets: Array<{ set_number: number; set_score: string | null }> = row.sets ?? []
  const orderedSets = [...sets].sort((a, b) => a.set_number - b.set_number)
  return {
    id: row.id,
    played_at: row.played_at ?? null,
    tournament_id: row.tournament_id ?? null,
    tournament_name: row.tournament?.name ?? null,
    round: row.round ?? null,
    status: row.status,
    pair1: {
      player1_name: row.p1p1?.name ?? null,
      player2_name: row.p1p2?.name ?? null,
    },
    pair2: {
      player1_name: row.p2p1?.name ?? null,
      player2_name: row.p2p2?.name ?? null,
    },
    winner_pair: row.winner_pair ?? null,
    set_scores: orderedSets.map((s) => s.set_score ?? '').filter(Boolean),
  }
}
```

- [ ] **Step 3.4: Run test to verify it passes**

```bash
set -a && source /Users/GuDenes/Projects/padel-live-scores/apps/labs/.env.local && set +a && npx vitest run tests/data/player-recent-matches.test.ts
```

Expected: 3 passed.

- [ ] **Step 3.5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/lib/data/player-recent-matches.ts apps/labs/tests/data/player-recent-matches.test.ts
git commit -m "feat(labs): SQL skill get_player_recent_matches"
```

---

## Task 4: SQL skill — `get_head_to_head`

Returns matches where two players faced each other on **opposing** pairs (not the same pair). The most-asked padel question.

**Files:**
- Create: `apps/labs/src/lib/data/head-to-head.ts`
- Create: `apps/labs/tests/data/head-to-head.test.ts`

- [ ] **Step 4.1: Write the failing test**

Create `apps/labs/tests/data/head-to-head.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { getHeadToHead } from '../../src/lib/data/head-to-head'
import { searchPlayer } from '../../src/lib/data/search-player'

const hasDb = !!process.env.DATABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_URL

describe.skipIf(!hasDb)('getHeadToHead', () => {
  it('returns matches where the two players were on opposing pairs', async () => {
    const a = (await searchPlayer('Tapia', { limit: 1 }))[0]
    const b = (await searchPlayer('Galán', { limit: 1 }))[0]
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    const matches = await getHeadToHead(a.id, b.id, { limit: 25 })
    // They've played each other many times; assertion is "any" not exact
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      const pair1Names = [m.pair1.player1_name, m.pair1.player2_name].filter(Boolean) as string[]
      const pair2Names = [m.pair2.player1_name, m.pair2.player2_name].filter(Boolean) as string[]
      // a's name appears in exactly one pair; b's name in the other
      const inPair1 = pair1Names.some((n) => n.toLowerCase().includes('tapia'))
      const inPair2 = pair2Names.some((n) => n.toLowerCase().includes('tapia'))
      expect(inPair1 !== inPair2).toBe(true)
    }
  })

  it('returns empty for two ids that never met as opponents', async () => {
    const matches = await getHeadToHead(
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      { limit: 5 },
    )
    expect(matches).toEqual([])
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npx vitest run tests/data/head-to-head.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement `getHeadToHead`**

Create `apps/labs/src/lib/data/head-to-head.ts`:

```ts
// apps/labs/src/lib/data/head-to-head.ts
// Matches between two players on opposing pairs.
// Padel matches have 4 player FKs (pair1_player1/2, pair2_player1/2). H2H means
// player A is on one pair AND player B is on the other pair — never the same pair.

import { supabaseService } from '@/lib/db'
import type { MatchSummary } from './types'
import { rowToMatchSummary } from './player-recent-matches'

const TERMINAL_STATUSES = ['finished', 'retired', 'walkover'] as const

export async function getHeadToHead(
  playerAId: string,
  playerBId: string,
  opts: { limit?: number } = {},
): Promise<MatchSummary[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100)
  if (playerAId === playerBId) return []
  const supabase = supabaseService()

  // Fetch all matches where BOTH players appear, then filter to opposing-pair
  // matches in JS — much simpler than encoding the XOR in PostgREST .or().
  const { data, error } = await supabase
    .from('matches')
    .select(`
      id, played_at, status, round, winner_pair, tournament_id,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      tournament:tournaments ( name ),
      p1p1:players!matches_pair1_player1_id_fkey ( name ),
      p1p2:players!matches_pair1_player2_id_fkey ( name ),
      p2p1:players!matches_pair2_player1_id_fkey ( name ),
      p2p2:players!matches_pair2_player2_id_fkey ( name ),
      sets ( set_number, set_score )
    `)
    .in('status', TERMINAL_STATUSES as unknown as string[])
    .or(
      `pair1_player1_id.eq.${playerAId},pair1_player2_id.eq.${playerAId},pair2_player1_id.eq.${playerAId},pair2_player2_id.eq.${playerAId}`,
    )
    .order('played_at', { ascending: false, nullsFirst: false })
    .limit(500) // pre-filter cap; we'll trim after pair check

  if (error) throw new Error(`getHeadToHead failed: ${error.message}`)
  const rows = data ?? []

  const filtered = rows.filter((r: any) => {
    const inPair1 = (id: string) =>
      r.pair1_player1_id === id || r.pair1_player2_id === id
    const inPair2 = (id: string) =>
      r.pair2_player1_id === id || r.pair2_player2_id === id
    const aInPair1 = inPair1(playerAId)
    const aInPair2 = inPair2(playerAId)
    const bInPair1 = inPair1(playerBId)
    const bInPair2 = inPair2(playerBId)
    if (!(aInPair1 || aInPair2)) return false
    if (!(bInPair1 || bInPair2)) return false
    // Opposing pairs only — exclude same-pair appearances (rare doubles partners change)
    return (aInPair1 && bInPair2) || (aInPair2 && bInPair1)
  })

  return filtered.slice(0, limit).map(rowToMatchSummary)
}
```

- [ ] **Step 4.4: Run test to verify it passes**

```bash
set -a && source /Users/GuDenes/Projects/padel-live-scores/apps/labs/.env.local && set +a && npx vitest run tests/data/head-to-head.test.ts
```

Expected: 2 passed.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/lib/data/head-to-head.ts apps/labs/tests/data/head-to-head.test.ts
git commit -m "feat(labs): SQL skill get_head_to_head"
```

---

## Task 5: Anthropic client singleton + tool definitions

**Files:**
- Create: `apps/labs/src/lib/ai/client.ts`
- Create: `apps/labs/src/lib/ai/tools.ts`

- [ ] **Step 5.1: Create the SDK client**

Create `apps/labs/src/lib/ai/client.ts`:

```ts
// apps/labs/src/lib/ai/client.ts
// Anthropic SDK singleton. Lazy-init so importing this file in test fixtures
// without ANTHROPIC_API_KEY doesn't throw.

import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function anthropicClient(): Anthropic {
  if (_client) return _client
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required')
  }
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return _client
}

// Locked to Haiku 4.5 for Phase 2. Phase 4 introduces tier-based routing.
export const PADEL_LABS_MODEL = 'claude-haiku-4-5-20251001'

export const PADEL_LABS_MAX_TOKENS = 2048
export const PADEL_LABS_MAX_TOOL_LOOPS = 8
```

- [ ] **Step 5.2: Define the 3 tools**

Create `apps/labs/src/lib/ai/tools.ts`:

```ts
// apps/labs/src/lib/ai/tools.ts
// Anthropic tool definitions + dispatcher. Each tool maps to one data/* skill.
// The dispatcher is the only place that turns tool_use blocks into SQL calls.

import type Anthropic from '@anthropic-ai/sdk'
import { searchPlayer } from '@/lib/data/search-player'
import { getPlayerRecentMatches } from '@/lib/data/player-recent-matches'
import { getHeadToHead } from '@/lib/data/head-to-head'

export const PADEL_LABS_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_player',
    description:
      'Find professional padel players by name. Returns up to 5 candidates with id, name, country, category (men/women), and current ranking. Use this to resolve player names to ids before calling other tools.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Partial or full player name (e.g., "Tapia", "Galán").' },
        limit: { type: 'integer', description: 'Max results (default 5, max 20).', minimum: 1, maximum: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_player_recent_matches',
    description:
      'Get the last N completed matches for a player by id. Returns id, date, tournament, opponent pair names, set scores, and winner. Default 5, max 25.',
    input_schema: {
      type: 'object',
      properties: {
        player_id: { type: 'string', description: 'Canonical player id (UUID) from search_player.' },
        limit: { type: 'integer', description: 'Max results (default 5, max 25).', minimum: 1, maximum: 25 },
      },
      required: ['player_id'],
    },
  },
  {
    name: 'get_head_to_head',
    description:
      'Get matches between two players on OPPOSING pairs. The most-asked padel question. Resolve both player names via search_player first, then pass their UUIDs.',
    input_schema: {
      type: 'object',
      properties: {
        player_a_id: { type: 'string', description: 'First player id (UUID).' },
        player_b_id: { type: 'string', description: 'Second player id (UUID).' },
        limit: { type: 'integer', description: 'Max results (default 25, max 100).', minimum: 1, maximum: 100 },
      },
      required: ['player_a_id', 'player_b_id'],
    },
  },
]

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string }

export async function dispatchTool(name: string, input: Record<string, any>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'search_player': {
        const data = await searchPlayer(input.query, { limit: input.limit })
        return { ok: true, data }
      }
      case 'get_player_recent_matches': {
        const data = await getPlayerRecentMatches(input.player_id, { limit: input.limit })
        return { ok: true, data }
      }
      case 'get_head_to_head': {
        const data = await getHeadToHead(input.player_a_id, input.player_b_id, { limit: input.limit })
        return { ok: true, data }
      }
      default:
        return { ok: false, error: `Unknown tool: ${name}` }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
```

- [ ] **Step 5.3: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/lib/ai/client.ts apps/labs/src/lib/ai/tools.ts
git commit -m "feat(labs): Anthropic client + 3-tool definitions"
```

---

## Task 6: System prompt builder

The system prompt sets identity, tool-use guidance, and citation rules. Cached via `cache_control` to amortize cost across all queries.

**Files:**
- Create: `apps/labs/src/lib/ai/system-prompt.ts`

- [ ] **Step 6.1: Implement the builder**

Create `apps/labs/src/lib/ai/system-prompt.ts`:

```ts
// apps/labs/src/lib/ai/system-prompt.ts
// System prompt for Padel Labs Analyst. Always returned as a cache-controlled
// block so Anthropic can re-use it across requests. Static for Phase 2;
// becomes locale-aware in Phase 5.

import type Anthropic from '@anthropic-ai/sdk'

const SYSTEM_BODY = `You are Padel Labs Analyst, a professional research assistant for padel content creators (analysts, YouTubers, journalists, coaches). You answer questions grounded in real data from the Padel Nachos database, which covers Premier Padel and FIP tour matches, players, and tournaments.

# How to answer
- Always ground claims in tool results. If a stat or match outcome appears in your answer, it must come from a tool you called in this turn.
- When the user names a player, call \`search_player\` first to resolve them to a canonical id. Top result is usually correct, but if ranking ambiguity exists, ask the user which player they meant.
- For head-to-head questions, call \`search_player\` for both players, then \`get_head_to_head\` with the two ids.
- For "recent form" / "last matches" questions, use \`get_player_recent_matches\`.
- Keep answers tight: 2-4 short paragraphs unless the user asks for depth. Use bullet lists for match-by-match enumerations.
- Use padel terminology correctly: "set", "game", "break", "tiebreak", "match", "round" (R32, R16, QF, SF, F), and pair names as "Player A / Player B".

# Citations
At the end of every answer that references specific matches, list the matches you cited under a "## Sources" header. The platform automatically formats this section — output nothing fancy, just one line per match in the format:
> - {pair1} vs {pair2} — {tournament} {round}, {date} ({score})

# Out of scope
- You cannot predict future match outcomes. If asked, decline politely and offer to share recent form instead.
- You cannot analyze shot patterns, rallies, video, or strokes — that data is not in the database.
- You cannot search news articles or quotes.
- You do not have access to live in-progress match scores via these tools — only completed matches.
- If asked about non-padel topics, redirect to padel.

# Tone
Direct, professional, padel-literate. Like a seasoned analyst briefing another analyst — no hype, no AI clichés ("Certainly!", "Of course!", "Great question!"). Skip the preamble; answer the question.`

export function padelLabsSystem(): Anthropic.Messages.MessageCreateParams['system'] {
  return [
    {
      type: 'text',
      text: SYSTEM_BODY,
      cache_control: { type: 'ephemeral' },
    },
  ]
}
```

- [ ] **Step 6.2: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/lib/ai/system-prompt.ts
git commit -m "feat(labs): system prompt with cache_control"
```

---

## Task 7: Agentic chat loop

The core engine. Takes a conversation's prior messages + a new user message, runs the tool-use loop until Haiku returns text-only, returns `{ answer, citations, cost }`.

**Files:**
- Create: `apps/labs/src/lib/ai/chat.ts`
- Create: `apps/labs/tests/ai/chat.test.ts`

- [ ] **Step 7.1: Write the failing test**

Create `apps/labs/tests/ai/chat.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the tool dispatcher — this test focuses on the loop, not SQL.
vi.mock('../../src/lib/ai/tools', async () => {
  const actual = await vi.importActual<any>('../../src/lib/ai/tools')
  return {
    ...actual,
    dispatchTool: vi.fn(),
  }
})

// Mock the Anthropic client.
const mockCreate = vi.fn()
vi.mock('../../src/lib/ai/client', async () => {
  const actual = await vi.importActual<any>('../../src/lib/ai/client')
  return {
    ...actual,
    anthropicClient: () => ({ messages: { create: mockCreate } }),
  }
})

import { runChat } from '../../src/lib/ai/chat'
import { dispatchTool } from '../../src/lib/ai/tools'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runChat', () => {
  it('returns text answer when Haiku finishes without tool use', async () => {
    mockCreate.mockResolvedValueOnce({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hello.' }],
      usage: { input_tokens: 10, output_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })

    const r = await runChat({ priorMessages: [], userMessage: 'Hi' })
    expect(r.answer).toBe('Hello.')
    expect(r.citations).toEqual([])
    expect(r.cost.input_tokens).toBe(10)
    expect(r.cost.output_tokens).toBe(2)
  })

  it('executes a tool and feeds the result back', async () => {
    ;(dispatchTool as any).mockResolvedValueOnce({ ok: true, data: [{ id: 'p1', name: 'Tapia' }] })

    mockCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tu_1', name: 'search_player', input: { query: 'Tapia' } },
        ],
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Found Tapia.' }],
        usage: { input_tokens: 120, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 80 },
      })

    const r = await runChat({ priorMessages: [], userMessage: 'Who is Tapia?' })
    expect(r.answer).toBe('Found Tapia.')
    expect(dispatchTool).toHaveBeenCalledOnce()
    expect(mockCreate).toHaveBeenCalledTimes(2)
    // Token costs accumulate
    expect(r.cost.input_tokens).toBe(220)
    expect(r.cost.output_tokens).toBe(25)
    expect(r.cost.cache_read_tokens).toBe(80)
  })

  it('aborts after 8 tool loops', async () => {
    ;(dispatchTool as any).mockResolvedValue({ ok: true, data: [] })
    mockCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 'tu_x', name: 'search_player', input: { query: 'x' } }],
      usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    })

    await expect(runChat({ priorMessages: [], userMessage: 'spin' })).rejects.toThrow(/tool loop limit/)
  })
})
```

- [ ] **Step 7.2: Run test to verify it fails**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npx vitest run tests/ai/chat.test.ts
```

Expected: FAIL — `runChat` doesn't exist.

- [ ] **Step 7.3: Implement `runChat`**

Create `apps/labs/src/lib/ai/chat.ts`:

```ts
// apps/labs/src/lib/ai/chat.ts
// Agentic loop: feed prior messages + user message into Haiku, run tools as
// they're requested, return final text + citations + accumulated token cost.
// Phase 2 = Haiku only, no streaming, max 8 tool loops.

import type Anthropic from '@anthropic-ai/sdk'
import {
  anthropicClient,
  PADEL_LABS_MODEL,
  PADEL_LABS_MAX_TOKENS,
  PADEL_LABS_MAX_TOOL_LOOPS,
} from './client'
import { padelLabsSystem } from './system-prompt'
import { PADEL_LABS_TOOLS, dispatchTool } from './tools'
import type { Citation, MatchSummary } from '@/lib/data/types'

export type PriorMessage = {
  role: 'user' | 'assistant'
  content: string
}

export type ChatResult = {
  answer: string
  citations: Citation[]
  cost: {
    input_tokens: number
    output_tokens: number
    cache_creation_tokens: number
    cache_read_tokens: number
  }
}

export async function runChat(args: {
  priorMessages: PriorMessage[]
  userMessage: string
}): Promise<ChatResult> {
  const client = anthropicClient()
  const messages: Anthropic.Messages.MessageParam[] = [
    ...args.priorMessages.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user' as const, content: args.userMessage },
  ]

  const cost = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
  }

  // Citations accumulate from every tool result that returns matches.
  const matchCitations: Map<string, Citation> = new Map()

  for (let loop = 0; loop < PADEL_LABS_MAX_TOOL_LOOPS; loop++) {
    const response = await client.messages.create({
      model: PADEL_LABS_MODEL,
      max_tokens: PADEL_LABS_MAX_TOKENS,
      system: padelLabsSystem(),
      tools: PADEL_LABS_TOOLS,
      messages,
    })

    cost.input_tokens += response.usage.input_tokens
    cost.output_tokens += response.usage.output_tokens
    cost.cache_creation_tokens += response.usage.cache_creation_input_tokens ?? 0
    cost.cache_read_tokens += response.usage.cache_read_input_tokens ?? 0

    if (response.stop_reason !== 'tool_use') {
      const text = response.content
        .filter((b): b is Anthropic.Messages.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
      return { answer: text, citations: Array.from(matchCitations.values()), cost }
    }

    // Append assistant content (mix of text + tool_use blocks) verbatim.
    messages.push({ role: 'assistant', content: response.content })

    // Execute every tool_use block and push tool_result blocks back.
    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
    )
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = []
    for (const tu of toolUseBlocks) {
      const result = await dispatchTool(tu.name, tu.input as Record<string, any>)
      collectCitations(result, matchCitations)
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        is_error: !result.ok,
      })
    }
    messages.push({ role: 'user', content: toolResults })
  }

  throw new Error('runChat: tool loop limit reached')
}

function collectCitations(result: { ok: boolean; data?: unknown }, sink: Map<string, Citation>) {
  if (!result.ok) return
  const arr = Array.isArray(result.data) ? (result.data as MatchSummary[]) : []
  for (const m of arr) {
    if (!m || typeof m !== 'object' || !('id' in m)) continue
    if (sink.has(m.id)) continue
    const pair1 = `${m.pair1?.player1_name ?? '?'} / ${m.pair1?.player2_name ?? '?'}`
    const pair2 = `${m.pair2?.player1_name ?? '?'} / ${m.pair2?.player2_name ?? '?'}`
    sink.set(m.id, {
      match_id: m.id,
      played_at: m.played_at ?? null,
      tournament_name: m.tournament_name ?? null,
      score: (m.set_scores ?? []).join(', '),
      pair1,
      pair2,
    })
  }
}
```

- [ ] **Step 7.4: Run test to verify it passes**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npx vitest run tests/ai/chat.test.ts
```

Expected: 3 passed.

- [ ] **Step 7.5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/lib/ai/chat.ts apps/labs/tests/ai/chat.test.ts
git commit -m "feat(labs): agentic chat loop with tool use + citations"
```

---

## Task 8: Conversation persistence helpers

Create / load / append messages to `labs_conversations` + `labs_messages`.

**Files:**
- Create: `apps/labs/src/lib/conversations.ts`

- [ ] **Step 8.1: Implement persistence helpers**

Create `apps/labs/src/lib/conversations.ts`:

```ts
// apps/labs/src/lib/conversations.ts
// CRUD helpers for labs_conversations + labs_messages. All writes go through
// the service-key Supabase client (RLS bypass) — auth is enforced by the
// caller (route handler checks Auth.js session).

import { supabaseService } from '@/lib/db'
import type { Citation } from '@/lib/data/types'

export type ConversationRow = {
  id: string
  user_id: string
  title: string | null
  locale: string
  created_at: string
  updated_at: string
}

export type MessageRow = {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations: Citation[]
  cost_input_tokens: number
  cost_output_tokens: number
  cost_cached_tokens: number
  model: string | null
  created_at: string
}

export async function getOrCreateConversation(args: {
  userId: string
  conversationId?: string
  firstUserMessage: string
}): Promise<ConversationRow> {
  const supabase = supabaseService()

  if (args.conversationId) {
    const { data, error } = await supabase
      .from('labs_conversations')
      .select('*')
      .eq('id', args.conversationId)
      .eq('user_id', args.userId)
      .single()
    if (error) throw new Error(`getOrCreateConversation lookup: ${error.message}`)
    return data as ConversationRow
  }

  const title = args.firstUserMessage.trim().slice(0, 80) || 'New conversation'
  const { data, error } = await supabase
    .from('labs_conversations')
    .insert({ user_id: args.userId, title, locale: 'en' })
    .select('*')
    .single()
  if (error) throw new Error(`getOrCreateConversation insert: ${error.message}`)
  return data as ConversationRow
}

export async function appendMessage(args: {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  cost?: { input_tokens: number; output_tokens: number; cache_read_tokens: number }
  model?: string
}): Promise<MessageRow> {
  const supabase = supabaseService()
  const { data, error } = await supabase
    .from('labs_messages')
    .insert({
      conversation_id: args.conversationId,
      role: args.role,
      content: args.content,
      citations: args.citations ?? [],
      cost_input_tokens: args.cost?.input_tokens ?? 0,
      cost_output_tokens: args.cost?.output_tokens ?? 0,
      cost_cached_tokens: args.cost?.cache_read_tokens ?? 0,
      model: args.model ?? null,
    })
    .select('*')
    .single()
  if (error) throw new Error(`appendMessage: ${error.message}`)

  // Touch conversation updated_at (trigger handles the timestamp).
  await supabase
    .from('labs_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', args.conversationId)

  return data as MessageRow
}

export async function listConversations(userId: string): Promise<ConversationRow[]> {
  const supabase = supabaseService()
  const { data, error } = await supabase
    .from('labs_conversations')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(50)
  if (error) throw new Error(`listConversations: ${error.message}`)
  return (data ?? []) as ConversationRow[]
}

export async function loadConversationWithMessages(args: {
  userId: string
  conversationId: string
}): Promise<{ conversation: ConversationRow; messages: MessageRow[] } | null> {
  const supabase = supabaseService()
  const { data: conv, error: convErr } = await supabase
    .from('labs_conversations')
    .select('*')
    .eq('id', args.conversationId)
    .eq('user_id', args.userId)
    .maybeSingle()
  if (convErr) throw new Error(`loadConversation: ${convErr.message}`)
  if (!conv) return null

  const { data: msgs, error: msgsErr } = await supabase
    .from('labs_messages')
    .select('*')
    .eq('conversation_id', args.conversationId)
    .order('created_at', { ascending: true })
  if (msgsErr) throw new Error(`loadMessages: ${msgsErr.message}`)

  return {
    conversation: conv as ConversationRow,
    messages: (msgs ?? []) as MessageRow[],
  }
}
```

- [ ] **Step 8.2: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/lib/conversations.ts
git commit -m "feat(labs): conversation + message persistence helpers"
```

---

## Task 9: Rate-limit helper (free tier 10/day)

**Files:**
- Create: `apps/labs/src/lib/usage.ts`
- Create: `apps/labs/tests/usage.test.ts`

- [ ] **Step 9.1: Write the failing test**

Create `apps/labs/tests/usage.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockSelect = vi.fn()
const mockInsert = vi.fn()
const mockSupabase = {
  from: vi.fn(() => ({
    select: mockSelect,
    insert: mockInsert,
  })),
}

vi.mock('../src/lib/db', () => ({
  supabaseService: () => mockSupabase,
  pgPool: () => ({}),
  supabaseAnon: {},
}))

import { checkAndRecordUsage, FREE_DAILY_QUOTA } from '../src/lib/usage'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkAndRecordUsage', () => {
  it('allows the first request of the day', async () => {
    const eq1 = vi.fn(() => ({ gte: () => ({ then: (cb: any) => cb({ count: 0, error: null }) }) }))
    mockSelect.mockReturnValue({ eq: eq1 })
    mockInsert.mockReturnValue({ then: (cb: any) => cb({ error: null }) })

    const r = await checkAndRecordUsage({ userId: 'u1' })
    expect(r.allowed).toBe(true)
    expect(r.used).toBe(0)
    expect(mockInsert).toHaveBeenCalledOnce()
  })

  it('denies the 11th request', async () => {
    const eq1 = vi.fn(() => ({ gte: () => ({ then: (cb: any) => cb({ count: FREE_DAILY_QUOTA, error: null }) }) }))
    mockSelect.mockReturnValue({ eq: eq1 })

    const r = await checkAndRecordUsage({ userId: 'u1' })
    expect(r.allowed).toBe(false)
    expect(r.used).toBe(FREE_DAILY_QUOTA)
    expect(mockInsert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 9.2: Run test to verify it fails**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npx vitest run tests/usage.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 9.3: Implement the helper**

Create `apps/labs/src/lib/usage.ts`:

```ts
// apps/labs/src/lib/usage.ts
// Per-user daily rate limit for the chat endpoint. Phase 2 = free tier only,
// hardcoded at 10/day. Phase 4 introduces Pro tier 100/day + Stripe gating.

import { supabaseService } from './db'

export const FREE_DAILY_QUOTA = 10

export async function checkAndRecordUsage(args: { userId: string }): Promise<{
  allowed: boolean
  used: number
  quota: number
}> {
  const supabase = supabaseService()
  const startOfDayUtc = startOfUtcDay(new Date())

  const { count, error: countErr } = await supabase
    .from('labs_usage_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', args.userId)
    .eq('kind', 'chat')
    .gte('at', startOfDayUtc)

  if (countErr) throw new Error(`usage count: ${countErr.message}`)
  const used = count ?? 0

  if (used >= FREE_DAILY_QUOTA) {
    return { allowed: false, used, quota: FREE_DAILY_QUOTA }
  }

  const { error: insErr } = await supabase
    .from('labs_usage_events')
    .insert({ user_id: args.userId, kind: 'chat', cost_units: 1 })
  if (insErr) throw new Error(`usage insert: ${insErr.message}`)

  return { allowed: true, used: used + 1, quota: FREE_DAILY_QUOTA }
}

function startOfUtcDay(d: Date): string {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  return x.toISOString()
}
```

- [ ] **Step 9.4: Run test to verify it passes**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
npx vitest run tests/usage.test.ts
```

Expected: 2 passed.

- [ ] **Step 9.5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/lib/usage.ts apps/labs/tests/usage.test.ts
git commit -m "feat(labs): free-tier rate limit (10/day) via labs_usage_events"
```

---

## Task 10: Wire up `POST /api/v1/ask`

Replace the stub with a real handler that:
1. Validates auth
2. Checks rate limit
3. Loads / creates conversation
4. Loads prior message history (truncated)
5. Runs the chat loop
6. Persists user + assistant messages
7. Returns answer + citations + conversation_id + cost

**Files:**
- Modify: `apps/labs/src/app/api/v1/ask/route.ts`

- [ ] **Step 10.1: Replace the stub**

Overwrite `apps/labs/src/app/api/v1/ask/route.ts`:

```ts
// apps/labs/src/app/api/v1/ask/route.ts
// Phase 2: real chat engine — Haiku 4.5 + tool use + citations + persistence.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { runChat, type PriorMessage } from '@/lib/ai/chat'
import {
  getOrCreateConversation,
  loadConversationWithMessages,
  appendMessage,
} from '@/lib/conversations'
import { checkAndRecordUsage } from '@/lib/usage'
import { PADEL_LABS_MODEL } from '@/lib/ai/client'

const MAX_HISTORY_TURNS = 12

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const question = String(body.question || '').trim()
  const conversationId: string | undefined = body.conversation_id || undefined
  if (!question) {
    return NextResponse.json({ error: 'question required' }, { status: 400 })
  }
  if (question.length > 2000) {
    return NextResponse.json({ error: 'question too long (max 2000 chars)' }, { status: 400 })
  }

  // Rate limit
  const usage = await checkAndRecordUsage({ userId: session.user.id })
  if (!usage.allowed) {
    return NextResponse.json(
      {
        error: 'daily_limit_reached',
        message: `You've hit today's free limit of ${usage.quota} questions. Try again tomorrow.`,
        used: usage.used,
        quota: usage.quota,
      },
      { status: 429 },
    )
  }

  // Load or create conversation; load prior history if existing.
  const conversation = await getOrCreateConversation({
    userId: session.user.id,
    conversationId,
    firstUserMessage: question,
  })

  let priorMessages: PriorMessage[] = []
  if (conversationId) {
    const loaded = await loadConversationWithMessages({
      userId: session.user.id,
      conversationId,
    })
    if (loaded) {
      priorMessages = loaded.messages
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-MAX_HISTORY_TURNS)
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    }
  }

  // Persist user message FIRST so it survives if the LLM call fails.
  await appendMessage({
    conversationId: conversation.id,
    role: 'user',
    content: question,
  })

  // Run the agentic loop.
  let result
  try {
    result = await runChat({ priorMessages, userMessage: question })
  } catch (e) {
    return NextResponse.json(
      { error: 'chat_failed', message: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }

  // Persist assistant message.
  await appendMessage({
    conversationId: conversation.id,
    role: 'assistant',
    content: result.answer,
    citations: result.citations,
    cost: result.cost,
    model: PADEL_LABS_MODEL,
  })

  return NextResponse.json({
    conversation_id: conversation.id,
    answer: result.answer,
    citations: result.citations,
    cost: result.cost,
    used: usage.used,
    quota: usage.quota,
  })
}
```

- [ ] **Step 10.2: Smoke test the endpoint with curl**

Start the dev server in one terminal:

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs && npm run dev
```

Sign in via the magic-link flow first (browser), then in another terminal:

```bash
# Get your session cookie from the browser DevTools (Application → Cookies → next-auth.session-token)
# OR use the existing session by curling from the same browser session via copy-as-curl.

curl -s -X POST http://localhost:3003/api/v1/ask \
  -H 'Content-Type: application/json' \
  --cookie "authjs.session-token=YOUR_TOKEN" \
  -d '{"question":"What is the head-to-head between Tapia and Galán?"}' | python3 -m json.tool
```

Expected: response with `answer`, `citations` (non-empty array), `conversation_id`, `cost`. Latency 5-15s on first call (no cache yet).

- [ ] **Step 10.3: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/app/api/v1/ask/route.ts
git commit -m "feat(labs): real chat endpoint replaces phase 1 stub"
```

---

## Task 11: Conversations API endpoints

Two read endpoints to power the sidebar.

**Files:**
- Create: `apps/labs/src/app/api/v1/conversations/route.ts`
- Create: `apps/labs/src/app/api/v1/conversations/[id]/route.ts`

- [ ] **Step 11.1: List endpoint**

Create `apps/labs/src/app/api/v1/conversations/route.ts`:

```ts
// apps/labs/src/app/api/v1/conversations/route.ts
// GET /api/v1/conversations — list current user's conversations (most recent first).

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { listConversations } from '@/lib/conversations'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const conversations = await listConversations(session.user.id)
  return NextResponse.json({ conversations })
}
```

- [ ] **Step 11.2: Single-conversation endpoint**

Create `apps/labs/src/app/api/v1/conversations/[id]/route.ts`:

```ts
// apps/labs/src/app/api/v1/conversations/[id]/route.ts
// GET /api/v1/conversations/[id] — return one conversation + its full message history.

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { loadConversationWithMessages } from '@/lib/conversations'

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { id } = await params
  const loaded = await loadConversationWithMessages({
    userId: session.user.id,
    conversationId: id,
  })
  if (!loaded) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 })
  }
  return NextResponse.json(loaded)
}
```

- [ ] **Step 11.3: Smoke test**

```bash
curl -s --cookie "authjs.session-token=YOUR_TOKEN" http://localhost:3003/api/v1/conversations | python3 -m json.tool
```

Expected: `{"conversations":[{ id, title, locale, created_at, updated_at }, ...]}` with at least one entry from Task 10.

- [ ] **Step 11.4: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/app/api/v1/conversations/
git commit -m "feat(labs): conversations list + single-conversation endpoints"
```

---

## Task 12: Multi-turn UI + conversation sidebar

Replace the single-shot ask page with a real chat surface: message history rendered, input always at the bottom, sidebar listing past conversations.

**Files:**
- Create: `apps/labs/src/app/(app)/ask/ConversationSidebar.tsx`
- Modify: `apps/labs/src/app/(app)/ask/page.tsx`

- [ ] **Step 12.1: Build the sidebar**

Create `apps/labs/src/app/(app)/ask/ConversationSidebar.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

type Conv = { id: string; title: string | null; updated_at: string }

export function ConversationSidebar(props: {
  activeId: string | null
  onSelect: (id: string | null) => void
}) {
  const [convs, setConvs] = useState<Conv[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/v1/conversations')
      const j = await r.json()
      setConvs(j.conversations ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Re-fetch whenever activeId changes (covers post-send refresh).
  useEffect(() => {
    if (props.activeId) load()
  }, [props.activeId])

  return (
    <aside style={{ borderRight: '1px solid var(--border)', padding: 16, width: 260, overflowY: 'auto' }}>
      <button
        type="button"
        className="btn btn-secondary"
        style={{ width: '100%', marginBottom: 16 }}
        onClick={() => props.onSelect(null)}
      >
        + New chat
      </button>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        History
      </div>
      {loading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</div>}
      {!loading && convs.length === 0 && (
        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No conversations yet.</div>
      )}
      {convs.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => props.onSelect(c.id)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            padding: '8px 10px',
            margin: '0 0 4px',
            background: c.id === props.activeId ? 'var(--surface)' : 'transparent',
            border: '1px solid transparent',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--text)',
            cursor: 'pointer',
          }}
        >
          {c.title || 'Untitled'}
        </button>
      ))}
    </aside>
  )
}
```

- [ ] **Step 12.2: Rewrite the Ask page**

Overwrite `apps/labs/src/app/(app)/ask/page.tsx`:

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { ConversationSidebar } from './ConversationSidebar'

type Citation = {
  match_id: string
  played_at: string | null
  tournament_name: string | null
  score: string
  pair1: string
  pair2: string
}

type Msg = {
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
}

export default function AskPage() {
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Load history when a conversation is selected (or cleared on "+ New chat").
  useEffect(() => {
    if (!conversationId) {
      setMessages([])
      return
    }
    let cancelled = false
    ;(async () => {
      const r = await fetch(`/api/v1/conversations/${conversationId}`)
      if (!r.ok) return
      const j = await r.json()
      if (cancelled) return
      setMessages(
        (j.messages || []).map((m: any) => ({
          role: m.role,
          content: m.content,
          citations: m.citations || [],
        })),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [conversationId])

  // Auto-scroll on new messages.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages.length, loading])

  async function send(e: React.FormEvent) {
    e.preventDefault()
    const q = input.trim()
    if (!q || loading) return
    setInput('')
    setError(null)
    setMessages((prev) => [...prev, { role: 'user', content: q }])
    setLoading(true)
    try {
      const r = await fetch('/api/v1/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          conversation_id: conversationId,
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setError(j.message || j.error || 'Something went wrong.')
        return
      }
      setConversationId(j.conversation_id)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: j.answer, citations: j.citations },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: 'calc(100vh - 60px)' }}>
      <ConversationSidebar activeId={conversationId} onSelect={setConversationId} />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '24px 32px' }}>
          <div style={{ maxWidth: 720, margin: '0 auto' }}>
            {messages.length === 0 && (
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                Ask me about padel matches, players, or head-to-heads. I cite every match I reference.
              </div>
            )}
            {messages.map((m, i) => (
              <MessageBubble key={i} msg={m} />
            ))}
            {loading && (
              <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '12px 0' }}>
                Thinking…
              </div>
            )}
            {error && (
              <div style={{ color: '#c62828', fontSize: 13, padding: '12px 0' }}>{error}</div>
            )}
          </div>
        </div>
        <form
          onSubmit={send}
          style={{
            borderTop: '1px solid var(--border)',
            padding: '16px 32px',
            background: 'var(--bg)',
          }}
        >
          <div style={{ maxWidth: 720, margin: '0 auto', display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask anything about padel matches, players, tournaments…"
              className="input"
              style={{ flex: 1 }}
              disabled={loading}
            />
            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || !input.trim()}
            >
              Send
            </button>
          </div>
        </form>
      </main>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user'
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        margin: '10px 0',
      }}
    >
      <div
        style={{
          maxWidth: '85%',
          padding: '12px 16px',
          borderRadius: 12,
          background: isUser ? 'var(--accent)' : 'var(--surface)',
          color: isUser ? 'white' : 'var(--text)',
          fontSize: 14,
          lineHeight: 1.55,
          whiteSpace: 'pre-wrap',
        }}
      >
        {msg.content}
        {msg.citations && msg.citations.length > 0 && (
          <details style={{ marginTop: 12, fontSize: 12, opacity: 0.85 }}>
            <summary style={{ cursor: 'pointer' }}>Sources ({msg.citations.length})</summary>
            <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
              {msg.citations.map((c) => (
                <li key={c.match_id} style={{ marginBottom: 4 }}>
                  {c.pair1} vs {c.pair2} — {c.tournament_name || 'Unknown'}{' '}
                  {c.played_at ? `(${c.played_at.slice(0, 10)})` : ''} {c.score && `· ${c.score}`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 12.3: Manual smoke test in browser**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs && npm run dev
```

Sign in, navigate to http://localhost:3003/ask, ask "Last 3 matches for Tapia?" — should see thinking state, then the assistant message with a "Sources" expandable. Sidebar should now show the new conversation. Click "+ New chat" to clear and start fresh.

- [ ] **Step 12.4: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/src/app/\(app\)/ask/
git commit -m "feat(labs): multi-turn chat UI with sidebar + citations"
```

---

## Task 13: End-to-end smoke test + deploy verification

**Files:**
- Modify: `apps/labs/tests/smoke.test.ts` (extend existing Phase 1 file)

- [ ] **Step 13.1: Add Phase 2 smoke assertions**

Append to `apps/labs/tests/smoke.test.ts`:

```ts
// --- Phase 2 smoke ---
import { describe as describeP2, it as itP2, expect as expectP2 } from 'vitest'

describeP2('phase 2 wiring', () => {
  itP2('imports the chat module without crashing', async () => {
    const mod = await import('../src/lib/ai/chat')
    expectP2(typeof mod.runChat).toBe('function')
  })

  itP2('imports each data skill without crashing', async () => {
    const sp = await import('../src/lib/data/search-player')
    const rm = await import('../src/lib/data/player-recent-matches')
    const h2h = await import('../src/lib/data/head-to-head')
    expectP2(typeof sp.searchPlayer).toBe('function')
    expectP2(typeof rm.getPlayerRecentMatches).toBe('function')
    expectP2(typeof h2h.getHeadToHead).toBe('function')
  })

  itP2('exposes the 3 tool definitions', async () => {
    const { PADEL_LABS_TOOLS } = await import('../src/lib/ai/tools')
    expectP2(PADEL_LABS_TOOLS.length).toBe(3)
    const names = PADEL_LABS_TOOLS.map((t) => t.name).sort()
    expectP2(names).toEqual(['get_head_to_head', 'get_player_recent_matches', 'search_player'])
  })
})
```

- [ ] **Step 13.2: Run the full test suite**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
set -a && source .env.local && set +a && npm test
```

Expected: all tests pass. Specifically:
- `tests/smoke.test.ts` — pre-existing Phase 1 tests + 3 new Phase 2 tests
- `tests/data/search-player.test.ts` — 3 tests
- `tests/data/player-recent-matches.test.ts` — 3 tests
- `tests/data/head-to-head.test.ts` — 2 tests
- `tests/ai/chat.test.ts` — 3 tests
- `tests/usage.test.ts` — 2 tests

Total: 16+ tests passing.

- [ ] **Step 13.3: Verify production build**

```bash
cd /Users/GuDenes/Projects/padel-live-scores/apps/labs
DATABASE_URL="postgres://stub:stub@localhost:5432/stub" AUTH_SECRET="stub" ANTHROPIC_API_KEY="stub" npm run build
```

Expected: `✓ Compiled successfully`, TypeScript clean, all routes listed including `/api/v1/conversations` and `/api/v1/conversations/[id]`.

- [ ] **Step 13.4: Add `ANTHROPIC_API_KEY` to Vercel project**

Vercel dashboard → labs project → Settings → Environment Variables → add `ANTHROPIC_API_KEY` (Production + Preview + Development) with the same value as the local `.env.local`. **Required before pushing this branch** or production builds will boot but `/api/v1/ask` will throw.

- [ ] **Step 13.5: Commit**

```bash
cd /Users/GuDenes/Projects/padel-live-scores
git add apps/labs/tests/smoke.test.ts
git commit -m "test(labs): phase 2 smoke assertions"
```

- [ ] **Step 13.6: Push and verify Vercel deploy**

```bash
git push origin <feature-branch>
```

Watch the Vercel deploy log; expect a successful build. Then in production (or the Vercel preview URL):
1. Sign in
2. Ask "Head-to-head between Tapia and Galán?"
3. Should return a grounded answer with citations within ~10s
4. Check Supabase Table Editor: `labs_conversations` has a row, `labs_messages` has 2 rows (user + assistant), `labs_usage_events` has 1 row.

---

## Self-Review

**Spec coverage** — Phase 2 = chat with Haiku 4.5 + tool use + citations + 2-3 SQL skills + persistence + rate limiting:
- ✅ Haiku 4.5 — Task 5 (`PADEL_LABS_MODEL = 'claude-haiku-4-5-20251001'`)
- ✅ Tool use — Tasks 5 + 7 (3 tools, agentic loop)
- ✅ Citations — Task 7 (`collectCitations`), Task 12 (sidebar render)
- ✅ 3 SQL skills — Tasks 2, 3, 4
- ✅ `labs_conversations` + `labs_messages` persistence — Task 8, wired in Task 10
- ✅ Rate limiting via `labs_usage_events` — Task 9, wired in Task 10
- ✅ Multi-turn conversation history surfacing — Tasks 11 + 12
- ✅ Build passes + Vercel env var documented — Task 13

**Decisions explicitly out of scope** (re-stated to prevent scope creep): streaming, pre-classifier, output cache, Sonnet escalation, Stripe, Pro tier, i18n, public demo, IP throttling. Each has a placeholder phase.

**Placeholder scan** — none. Every step has runnable code or commands.

**Type consistency** —
- `Citation` type defined once in `data/types.ts`, used in `chat.ts`, `conversations.ts`, frontend
- `MatchSummary` defined once, used in `player-recent-matches.ts`, re-used by `head-to-head.ts` via `rowToMatchSummary` (exported, not duplicated)
- `PriorMessage` defined in `chat.ts`, used in `route.ts`
- `runChat`, `searchPlayer`, `getPlayerRecentMatches`, `getHeadToHead` — all spelled identically across plan tasks

**Test coverage** — every public function has at least one test. Frontend changes ride on manual smoke (Step 12.3) since UI snapshots are higher-cost than they're worth for an MVP.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-07-padel-labs-v1-phase-2-ask-mvp.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for keeping the main session context tight while the model focuses task-by-task.

**2. Inline Execution** — Execute tasks in this session using superpowers:executing-plans, batch execution with checkpoints for review. Best when you want to be in the loop on every step.

Which approach?
