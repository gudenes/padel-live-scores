# PPL Phase 2a — Static backfill

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get the 2026 Pro Padel League season's *static* layer into the database — franchises, divisions, rosters, events, ties, and match skeletons — via a one-shot idempotent script with a human-reviewed dry run.

**Architecture:** A CLI script, not a worker. Modelled directly on `scripts/import-amateur-season.ts`: dry-run by default, `--apply` to write, re-runnable without duplicating. Scripts under `scripts/` can import from `src/`, which is what makes this possible — `PlayerResolver` and `registerSourceId` are Next.js-side modules that padelgod cannot reach. Player *creation* therefore happens here, once; the recurring worker in Phase 2c will only ever *look up* by the PPL slug registered in `entity_external_ids`, never mint.

**Tech Stack:** TypeScript, `tsx`, Vitest, Supabase JS client.

**Spec:** `docs/superpowers/specs/2026-09-22-pro-padel-league-design.md`
**Depends on:** Phase 1 (`docs/superpowers/plans/2026-09-22-ppl-phase-1-foundations.md`) — **its migration must be APPLIED before `--apply` can run.** The code and all tests can be written and verified without it.

---

## Why a script and not the worker pair the spec describes

The spec (*Ingestion*) specifies `ppl-fetcher` / `ppl-writer` padelgod workers with a snapshot table. That remains the Phase 2c design for ongoing events. It is the wrong shape for the backfill:

- The whole 2026 back-catalogue is **4 payloads and 132 players** — a fixed, finite set. A snapshot/reconcile pipeline buys replayability we do not need for a one-time load.
- **Player creation cannot happen in padelgod.** `PlayerResolver` lives in `src/`; padelgod is a separate package. Its own `db-resolver.ts` deliberately refuses to create (*"workers should never silently mint player rows"*). Putting creation in a `scripts/` one-shot preserves that rule instead of breaking it.
- **The ambiguous cases need a human.** A measured probe against production on 2026-09-23 found 6 PPL names matching more than one existing player, two of them (`Claudia Jensen`, `Javier Martinez`) with *identical* normalized names. An automated worker cannot safely choose. A dry run can print them and stop.

Phase 2c adds the worker once the shape is proven, and it will find every player already registered by slug.

## Measured starting state (2026-09-23, read-only probe against production)

| | |
|---|---|
| Unique players across all 4 payloads | **132** (107 `ppl`, 25 `ppl-ii`) |
| Already in `players` | **118 (89%)** |
| Unresolved | **14** (6 `ppl`, 8 `ppl-ii`) |
| Ambiguous — >1 candidate | **6** |

At least three "unresolved" are short-form/nickname mismatches for players we hold: `Fede Chingotto` → `Federico Chingotto` (rank 3), `Delfi Brea` → `Delfina Brea Senesi` (rank 1), `Jose Maria Aliaga Cruz` → probably `Pepe Aliaga` (rank 141, "Pepe" being the Spanish nickname for José). Genuinely-new players are ~8–11, nearly all PPL II.

These numbers are a **baseline, not a contract** — the script recomputes them. If the counts have drifted far from this when you run it, stop and find out why before applying.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/lib/ppl-source.ts` | **Create.** Fetch + parse propadelleague.com. No DB, no side effects; `fetch` injected so it is fixture-testable |
| `scripts/lib/ppl-classify.ts` | **Create.** Pure bucketing of roster entries into linked / to-link / to-create / ambiguous. No IO |
| `scripts/__tests__/ppl-source.test.ts` | **Create.** Parses a captured fixture |
| `scripts/__tests__/ppl-classify.test.ts` | **Create.** Bucketing rules, especially the ambiguity refusal |
| `scripts/__tests__/fixtures/ppl-los-angeles-2026.json` | **Create.** Real captured payload |
| `scripts/import-ppl-season.ts` | **Create.** The CLI. Orchestration + DB writes only — all logic lives in the two libs above |

Keeping decisions in pure modules and IO in the script is the house style (`fip-oop-writer` exports `buildOopPatch` purely so it can be unit-tested). Follow it.

---

## Task 1: PPL source client

**Files:**
- Create: `scripts/lib/ppl-source.ts`
- Create: `scripts/__tests__/fixtures/ppl-los-angeles-2026.json`
- Test: `scripts/__tests__/ppl-source.test.ts`

- [ ] **Step 1: Capture the fixture**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league
BUILD=$(curl -sS -A 'padelgod/1.0 (+https://padelnachos.com)' https://propadelleague.com/tournaments/ | grep -oE '"buildId":"[^"]+"' | head -1 | cut -d'"' -f4)
echo "buildId=$BUILD"
curl -sS -A 'padelgod/1.0 (+https://padelnachos.com)' \
  "https://propadelleague.com/_next/data/$BUILD/tournament/los-angeles-2026.json?slug=los-angeles-2026" \
  -o scripts/__tests__/fixtures/ppl-los-angeles-2026.json
node -e "const j=require('./scripts/__tests__/fixtures/ppl-los-angeles-2026.json');const c=j.pageProps.broadcastContext;console.log('matches',c.matchRows.length,'teams',Object.keys(c.teamsById).length,'players',Object.keys(c.playerRowsById).length)"
```

Expected: `matches 24 teams 10 players 131`. If the counts differ, the upstream shape changed — stop and report before continuing.

- [ ] **Step 2: Write the failing test**

Create `scripts/__tests__/ppl-source.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseTournamentPayload, extractBuildId } from '../lib/ppl-source'

const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/ppl-los-angeles-2026.json'), 'utf8'),
)

describe('extractBuildId', () => {
  it('pulls the buildId out of the __NEXT_DATA__ blob', () => {
    expect(extractBuildId('<script>{"buildId":"abc123","x":1}</script>')).toBe('abc123')
  })

  it('throws rather than returning a stale or empty id', () => {
    expect(() => extractBuildId('<html>no next data</html>')).toThrow(/buildId/)
  })
})

describe('parseTournamentPayload', () => {
  const t = parseTournamentPayload(FIXTURE, 'los-angeles-2026')

  it('reads the event header', () => {
    expect(t.slug).toBe('los-angeles-2026')
    expect(t.name).toBe('Los Angeles')
    expect(t.startDate).toBe('2026-08-13')
    expect(t.endDate).toBe('2026-08-16')
  })

  it('reads all ten franchises with branding', () => {
    expect(t.teams).toHaveLength(10)
    const miami = t.teams.find((x) => x.slug === 'miami-padel-club')!
    expect(miami.name).toBe('Miami Padel Club')
    expect(miami.location).toBe('Miami')
    expect(miami.brandColor).toBe('#0187d1')
    expect(miami.mensPlayerIds).toContain('alvaro-melendez-amaya')
    expect(miami.womensPlayerIds).toContain('anna-ortiz-gasco')
  })

  it('reads players with a usable display name and sex', () => {
    const tapia = t.players.find((p) => p.slug === 'agustin-tapia')!
    expect(tapia.name).toBe('Agustin Tapia')
    expect(tapia.sex).toBe('male')
    expect(tapia.league).toBe('ppl')
  })

  it('reads all 24 matches with both franchises and a category', () => {
    expect(t.matches).toHaveLength(24)
    const m = t.matches.find((x) => x.id === 'los-angeles-2026-d1-m1-mens')!
    expect(m.homeTeamSlug).toBe('toronto-polar-bears')
    expect(m.awayTeamSlug).toBe('las-vegas-smash')
    expect(m.category).toBe('men')
    expect(m.stage).toBe('Group Stage')
    expect(m.sessionNumber).toBe(1)
    expect(m.league).toBe('ppl')
  })

  it('maps game_type female to our women category', () => {
    const w = t.matches.find((x) => x.id === 'los-angeles-2026-d1-m1-womens')!
    expect(w.category).toBe('women')
  })

  it('leaves sessionNumber null on podium ties', () => {
    const podium = t.matches.find((x) => x.id === 'los-angeles-2026-podium-mens-first')!
    expect(podium.sessionNumber).toBeNull()
    expect(podium.stage).toBe('Championship')
  })

  it('carries no score data — that is Phase 2b', () => {
    for (const m of t.matches) expect(m).not.toHaveProperty('sets')
  })
})
```

- [ ] **Step 3: Run it, expect FAIL**

`cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league && npx vitest run scripts/__tests__/ppl-source.test.ts`
Expected: FAIL — cannot resolve `../lib/ppl-source`

- [ ] **Step 4: Implement**

Create `scripts/lib/ppl-source.ts`:

```ts
// Source client for propadelleague.com.
//
// The site is a Next.js Pages Router app. Everything static — franchises,
// rosters, fixtures — is served as JSON at
//   /_next/data/<buildId>/tournament/<slug>.json
// Scores and per-match statistics are NOT here: those come from Firestore at
// runtime and exist only in the rendered DOM. That is Phase 2b.
//
// `buildId` changes on every deploy of their site, so it must be read at
// runtime from the served HTML. Never hardcode it.
//
// Pure except for the injected `fetchFn`, so the parser is fixture-testable.

export type Fetcher = (url: string) => Promise<{ status: number; text: () => Promise<string> }>

export const PPL_ORIGIN = 'https://propadelleague.com'
export const PPL_USER_AGENT = 'padelgod/1.0 (+https://padelnachos.com)'

export interface PplTeam {
  slug: string
  name: string
  location: string | null
  brandColor: string | null
  colorLogo: string | null
  instagramUrl: string | null
  mensPlayerIds: string[]
  womensPlayerIds: string[]
}

export interface PplPlayer {
  slug: string
  name: string
  /** upstream `sex`: 'male' | 'female' */
  sex: string | null
  /** upstream `leagueId`: 'ppl' | 'ppl-ii' */
  league: string | null
  status: string | null
}

export interface PplMatch {
  id: string
  homeTeamSlug: string
  awayTeamSlug: string
  /** our vocabulary, mapped from upstream `game_type` */
  category: 'men' | 'women'
  stage: string
  sessionNumber: number | null
  scheduledAt: string | null
  league: string | null
}

export interface PplTournament {
  slug: string
  name: string
  startDate: string | null
  endDate: string | null
  location: string | null
  league: string
  teams: PplTeam[]
  players: PplPlayer[]
  matches: PplMatch[]
}

export function extractBuildId(html: string): string {
  const m = html.match(/"buildId":"([^"]+)"/)
  if (!m) throw new Error('extractBuildId: no buildId in the served HTML — upstream shape changed')
  return m[1]
}

export async function fetchBuildId(fetchFn: Fetcher): Promise<string> {
  const r = await fetchFn(`${PPL_ORIGIN}/tournaments/`)
  if (r.status !== 200) throw new Error(`fetchBuildId: HTTP ${r.status}`)
  return extractBuildId(await r.text())
}

/** Upstream `game_type` → our `matches.category`. */
function toCategory(gameType: unknown): 'men' | 'women' {
  if (gameType === 'female') return 'women'
  if (gameType === 'male') return 'men'
  throw new Error(`unknown game_type: ${JSON.stringify(gameType)}`)
}

/**
 * Upstream emits two date shapes in the same payload: ISO
 * ("2026-08-13T16:00:00") for group-stage rows and US locale
 * ("8/16/2026 1:00:00 PM") for podium rows. Both are wall-clock in the
 * event's local time with no zone. We keep the raw string here and let the
 * caller decide the timezone — guessing one in the parser would bake in a
 * silent error.
 */
function rawDate(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null
}

export function parseTournamentPayload(payload: any, slug: string): PplTournament {
  const props = payload?.pageProps
  const ctx = props?.broadcastContext
  if (!ctx) throw new Error(`parseTournamentPayload(${slug}): no broadcastContext`)

  const hero = props.hero ?? {}

  const teams: PplTeam[] = Object.entries(ctx.teamsById ?? {}).map(([id, row]: [string, any]) => ({
    slug: id,
    name: row.values?.name ?? id,
    location: row.values?.location ?? row.values?.team_location ?? null,
    brandColor: row.values?.color ?? row.values?.teamColor ?? null,
    colorLogo: row.values?.colorLogo ?? null,
    instagramUrl: row.values?.instagramUrl ?? null,
    mensPlayerIds: row.values?.mensPlayerIds ?? [],
    womensPlayerIds: row.values?.womensPlayerIds ?? [],
  }))

  const players: PplPlayer[] = Object.entries(ctx.playerRowsById ?? {}).map(([id, row]: [string, any]) => {
    const v = row.values ?? {}
    const composed = `${v.firstName ?? ''} ${v.lastName ?? ''}`.trim()
    return {
      slug: id,
      // Prefer the composed first+last over displayName: displayName is where
      // upstream puts nicknames in quotes (ALEJANDRO "ALEX" RUIZ), which would
      // poison name-based resolution.
      name: composed.length > 0 ? composed : (v.displayName ?? id),
      sex: v.sex ?? null,
      league: v.leagueId ?? null,
      status: v.status ?? null,
    }
  })

  const matches: PplMatch[] = (ctx.matchRows ?? []).map((row: any) => {
    const v = row.values ?? {}
    return {
      id: row.id,
      homeTeamSlug: v.hometeam?.docId ?? '',
      awayTeamSlug: v.awayteam?.docId ?? '',
      category: toCategory(v.game_type),
      stage: v.stage ?? 'Group Stage',
      sessionNumber: typeof v.sessionNumber === 'number' ? v.sessionNumber : null,
      scheduledAt: rawDate(v.date),
      league: v.league?.docId ?? null,
    }
  })

  const league = matches.find((m) => m.league)?.league ?? 'ppl'

  return {
    slug,
    name: hero.title ?? slug,
    startDate: hero.startDate ?? null,
    endDate: hero.endDate ?? null,
    location: hero.location ?? null,
    league,
    teams,
    players,
    matches,
  }
}

export async function fetchTournament(
  fetchFn: Fetcher,
  buildId: string,
  slug: string,
): Promise<PplTournament | null> {
  const url = `${PPL_ORIGIN}/_next/data/${buildId}/tournament/${slug}.json?slug=${slug}`
  const r = await fetchFn(url)
  if (r.status === 404) return null
  if (r.status !== 200) throw new Error(`fetchTournament(${slug}): HTTP ${r.status}`)
  return parseTournamentPayload(JSON.parse(await r.text()), slug)
}
```

**Note on `hero.title`:** the fixture's PPL II payload has `"New York -- PPL II"`. The test above only asserts the PPL form. Do not strip the suffix in the parser — the script maps slug → our tournament name, and mangling it here would hide the division.

- [ ] **Step 5: Run it, expect PASS (8 tests)**

`npx vitest run scripts/__tests__/ppl-source.test.ts`

If `t.name` does not equal `'Los Angeles'`, print the actual `hero` object and adjust the **test** to the real value — this one assertion documents upstream, it does not constrain us.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league
git add scripts/lib/ppl-source.ts scripts/__tests__/ppl-source.test.ts scripts/__tests__/fixtures/ppl-los-angeles-2026.json
git commit -m "feat(ppl): source client for propadelleague.com static payloads"
```

---

## Task 2: Player classification

This is the conflation guard. It must be a pure function so the refusal behaviour is unit-tested rather than discovered in production.

**Files:**
- Create: `scripts/lib/ppl-classify.ts`
- Test: `scripts/__tests__/ppl-classify.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/ppl-classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { classifyRoster, normalizeForMatch, type ExistingPlayer } from '../lib/ppl-classify'
import type { PplPlayer } from '../lib/ppl-source'

const p = (slug: string, name: string, sex = 'male'): PplPlayer =>
  ({ slug, name, sex, league: 'ppl', status: 'active' })

const e = (id: string, name: string, category = 'men'): ExistingPlayer =>
  ({ id, name, normalized_name: normalizeForMatch(name), category, tier: 'pro' })

describe('normalizeForMatch', () => {
  it('strips accents, case and punctuation', () => {
    expect(normalizeForMatch('Delfina Breá Senesi')).toBe('delfina brea senesi')
    expect(normalizeForMatch('ALEJANDRO "ALEX" RUIZ')).toBe('alejandro alex ruiz')
  })
})

describe('classifyRoster', () => {
  it('puts an already-registered slug in linked, regardless of name', () => {
    const r = classifyRoster(
      [p('federico-chingotto', 'Fede Chingotto')],
      [e('uuid-1', 'Federico Chingotto')],
      new Map([['federico-chingotto', 'uuid-1']]),
      new Map(),
    )
    expect(r.linked).toHaveLength(1)
    expect(r.linked[0].playerId).toBe('uuid-1')
    expect(r.toCreate).toHaveLength(0)
    expect(r.ambiguous).toHaveLength(0)
  })

  it('links on a single exact normalized-name match', () => {
    const r = classifyRoster([p('david-gala', 'David Gala')], [e('uuid-2', 'David Gala')], new Map(), new Map())
    expect(r.toLink).toHaveLength(1)
    expect(r.toLink[0].playerId).toBe('uuid-2')
  })

  it('flags AMBIGUOUS when two existing players share a normalized name', () => {
    const r = classifyRoster(
      [p('claudia-jensen', 'Claudia Jensen', 'female')],
      [e('uuid-a', 'Claudia Jensen', 'women'), e('uuid-b', 'Claudia Jensen', 'women')],
      new Map(), new Map(),
    )
    expect(r.ambiguous).toHaveLength(1)
    expect(r.ambiguous[0].candidates.map((c) => c.id).sort()).toEqual(['uuid-a', 'uuid-b'])
    expect(r.toLink).toHaveLength(0)
    expect(r.toCreate).toHaveLength(0)
  })

  it('an explicit override resolves an ambiguous name', () => {
    const r = classifyRoster(
      [p('claudia-jensen', 'Claudia Jensen', 'female')],
      [e('uuid-a', 'Claudia Jensen', 'women'), e('uuid-b', 'Claudia Jensen', 'women')],
      new Map(),
      new Map([['claudia-jensen', 'uuid-b']]),
    )
    expect(r.ambiguous).toHaveLength(0)
    expect(r.toLink).toHaveLength(1)
    expect(r.toLink[0].playerId).toBe('uuid-b')
  })

  it('puts a genuinely unknown name in toCreate', () => {
    const r = classifyRoster([p('shannon-hudson', 'Shannon Hudson', 'female')], [], new Map(), new Map())
    expect(r.toCreate).toHaveLength(1)
    expect(r.toCreate[0].category).toBe('women')
  })

  it('never matches an amateur-tier player', () => {
    const amateur: ExistingPlayer = { ...e('uuid-am', 'Luis Estrada'), tier: 'amateur' }
    const r = classifyRoster([p('luis-estrada', 'Luis Estrada')], [amateur], new Map(), new Map())
    expect(r.toCreate).toHaveLength(1)
    expect(r.toLink).toHaveLength(0)
  })

  it('does not cross gender when matching', () => {
    const r = classifyRoster(
      [p('alex-ruiz', 'Alex Ruiz', 'female')],
      [e('uuid-m', 'Alex Ruiz', 'men')],
      new Map(), new Map(),
    )
    expect(r.toCreate).toHaveLength(1)
    expect(r.toLink).toHaveLength(0)
  })

  it('maps sex to category', () => {
    const r = classifyRoster([p('x', 'New Person', 'female')], [], new Map(), new Map())
    expect(r.toCreate[0].category).toBe('women')
  })
})
```

- [ ] **Step 2: Run it, expect FAIL**

`npx vitest run scripts/__tests__/ppl-classify.test.ts`

- [ ] **Step 3: Implement**

Create `scripts/lib/ppl-classify.ts`:

```ts
// Pure classification of a PPL roster against our `players` table.
//
// Four buckets, and the important one is `ambiguous`. A measured probe on
// 2026-09-23 found six PPL names matching more than one existing player, two
// with IDENTICAL normalized names (Claudia Jensen, Javier Martinez). Picking
// one automatically would hang league matches on the wrong person's career
// history — the exact class of bug the repo was already fixing elsewhere.
//
// So: ambiguity is never guessed. It goes in its own bucket, the dry run
// prints it, and `--apply` refuses until a human maps it.
//
// Matching is exact-normalized-name only. No fuzzy, no token subset. The
// backfill runs once with a human reading the output; the cost of a missed
// link is one extra row in `toCreate` that an operator merges later, while
// the cost of a wrong link is silent and permanent.

import type { PplPlayer } from './ppl-source'

export interface ExistingPlayer {
  id: string
  name: string | null
  normalized_name: string | null
  category: string | null
  tier: string | null
}

export interface LinkedEntry { player: PplPlayer; playerId: string }
export interface CreateEntry { player: PplPlayer; category: 'men' | 'women' }
export interface AmbiguousEntry { player: PplPlayer; candidates: ExistingPlayer[] }

export interface Classification {
  /** Already carries an `entity_external_ids` row for source='ppl'. Nothing to do. */
  linked: LinkedEntry[]
  /** Unambiguous name match — needs only the sidecar registration. */
  toLink: LinkedEntry[]
  /** No match at all — needs a new `players` row. */
  toCreate: CreateEntry[]
  /** More than one candidate. Blocks `--apply`. */
  ambiguous: AmbiguousEntry[]
}

/**
 * Mirrors the `set_player_normalized_name` trigger closely enough for
 * matching: lowercase, strip diacritics, non-alphanumerics to spaces,
 * collapse. The DB value is authoritative when present; this is the fallback
 * and the way incoming PPL names are normalized.
 */
export function normalizeForMatch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function categoryOf(sex: string | null): 'men' | 'women' {
  return sex === 'female' ? 'women' : 'men'
}

export function classifyRoster(
  roster: PplPlayer[],
  existing: ExistingPlayer[],
  /** pplSlug → players.id, from entity_external_ids source='ppl' */
  alreadyRegistered: Map<string, string>,
  /** pplSlug → players.id, operator-supplied overrides */
  overrides: Map<string, string>,
): Classification {
  const byName = new Map<string, ExistingPlayer[]>()
  for (const p of existing) {
    // Amateur rows are a separate population and must never be matched —
    // see src/lib/player-tier.ts.
    if (p.tier === 'amateur') continue
    const key = p.normalized_name || normalizeForMatch(p.name ?? '')
    if (!key) continue
    if (!byName.has(key)) byName.set(key, [])
    byName.get(key)!.push(p)
  }

  const out: Classification = { linked: [], toLink: [], toCreate: [], ambiguous: [] }

  for (const player of roster) {
    const registered = alreadyRegistered.get(player.slug)
    if (registered) { out.linked.push({ player, playerId: registered }); continue }

    const override = overrides.get(player.slug)
    if (override) { out.toLink.push({ player, playerId: override }); continue }

    const category = categoryOf(player.sex)
    const candidates = (byName.get(normalizeForMatch(player.name)) ?? [])
      .filter((c) => c.category === category)

    if (candidates.length === 1) out.toLink.push({ player, playerId: candidates[0].id })
    else if (candidates.length === 0) out.toCreate.push({ player, category })
    else out.ambiguous.push({ player, candidates })
  }

  return out
}
```

- [ ] **Step 4: Run it, expect PASS (9 tests)**

- [ ] **Step 5: Commit**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league
git add scripts/lib/ppl-classify.ts scripts/__tests__/ppl-classify.test.ts
git commit -m "feat(ppl): roster classification with an explicit ambiguity bucket"
```

---

## Task 3: The import script — dry run only

Write the whole script but make `--apply` throw `not implemented` for now. Task 4 fills in the writes. This split exists so the dry run can be pointed at production and reviewed by a human **before** any write path exists to be fired by accident.

**Files:**
- Create: `scripts/import-ppl-season.ts`

- [ ] **Step 1: Write the script**

Create `scripts/import-ppl-season.ts`:

```ts
// Imports one Pro Padel League season's STATIC layer: franchises, divisions,
// rosters, events, ties and match skeletons. Scores and per-match statistics
// are Phase 2b and are NOT touched here.
//
// Defaults to a DRY RUN. Pass --apply to write.
// Idempotent: re-running with the same inputs updates in place, never
// duplicates. Modelled on scripts/import-amateur-season.ts.
//
// Usage:
//   npx tsx scripts/import-ppl-season.ts                      # dry run, all 2026 events
//   npx tsx scripts/import-ppl-season.ts --map map.json       # dry run with overrides
//   npx tsx scripts/import-ppl-season.ts --apply --map map.json
//
// --map takes a JSON object of { "<ppl-player-slug>": "<players.id uuid>" }
// used to resolve names that match more than one existing player. --apply
// REFUSES to run while any ambiguity is unmapped.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { fetchBuildId, fetchTournament, PPL_USER_AGENT, type Fetcher, type PplTournament } from './lib/ppl-source'
import { classifyRoster, type ExistingPlayer } from './lib/ppl-classify'

const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const APPLY = process.argv.includes('--apply')

function argValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

const MAP_FILE = argValue('map')

const SEASON_SLUGS = [
  'new-york-2026',
  'new-york-ppl-ii-2026',
  'los-angeles-2026',
  'los-angeles-ppl-ii-2026',
  'playa-del-carmen-2026',
  'playa-del-carmen-ppl-ii-2026',
  'guadalajara-2026',
  'guadalajara-ppl-ii-2026',
  'miami-2026',
  'miami-ppl-ii-2026',
]

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

const nodeFetch: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': PPL_USER_AGENT } })
  return { status: r.status, text: () => r.text() }
}

async function loadExistingPlayers(): Promise<ExistingPlayer[]> {
  const rows: ExistingPlayer[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('players')
      .select('id,name,normalized_name,category,tier')
      .range(start, start + 999)
    if (error) throw new Error(`players read failed: ${error.message}`)
    rows.push(...(data as ExistingPlayer[]))
    if (data.length < 1000) break
  }
  return rows
}

async function loadRegisteredSlugs(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('entity_external_ids')
      .select('entity_id,external_id')
      .eq('entity_type', 'player')
      .eq('source', 'ppl')
      .range(start, start + 999)
    if (error) throw new Error(`entity_external_ids read failed: ${error.message}`)
    for (const r of data as Array<{ entity_id: string; external_id: string }>) {
      out.set(r.external_id, r.entity_id)
    }
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — this will write ***' : '--- DRY RUN (pass --apply to write) ---')

  const buildId = await fetchBuildId(nodeFetch)
  console.log(`buildId: ${buildId}`)

  const tournaments: PplTournament[] = []
  for (const slug of SEASON_SLUGS) {
    const t = await fetchTournament(nodeFetch, buildId, slug)
    if (!t) { console.log(`  ${slug}: not published yet (404)`); continue }
    console.log(`  ${slug}: ${t.matches.length} matches, ${t.teams.length} teams, league=${t.league}`)
    tournaments.push(t)
  }
  if (tournaments.length === 0) throw new Error('no tournaments fetched — aborting')

  // Roster is the union across events; a player can appear in several.
  const roster = new Map<string, (typeof tournaments)[number]['players'][number]>()
  for (const t of tournaments) for (const p of t.players) if (!roster.has(p.slug)) roster.set(p.slug, p)
  console.log(`\nunique players across payloads: ${roster.size}`)

  const overrides = new Map<string, string>()
  if (MAP_FILE) {
    const raw = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) as Record<string, string>
    for (const [k, v] of Object.entries(raw)) overrides.set(k, v)
    console.log(`overrides loaded: ${overrides.size} from ${MAP_FILE}`)
  }

  const [existing, registered] = await Promise.all([loadExistingPlayers(), loadRegisteredSlugs()])
  console.log(`our players: ${existing.length} | already registered by ppl slug: ${registered.size}`)

  const c = classifyRoster([...roster.values()], existing, registered, overrides)

  console.log(`\n=== PLAYERS ===`)
  console.log(`  already linked : ${c.linked.length}`)
  console.log(`  to link        : ${c.toLink.length}`)
  console.log(`  to create      : ${c.toCreate.length}`)
  console.log(`  AMBIGUOUS      : ${c.ambiguous.length}`)

  if (c.toCreate.length > 0) {
    console.log(`\n--- would CREATE ---`)
    for (const x of c.toCreate) console.log(`  ${x.player.name}  (${x.category}, ${x.player.league}, slug=${x.player.slug})`)
  }

  if (c.ambiguous.length > 0) {
    console.log(`\n--- AMBIGUOUS — map these before --apply ---`)
    const suggestion: Record<string, string> = {}
    for (const a of c.ambiguous) {
      console.log(`  "${a.player.name}" (slug=${a.player.slug}) matches ${a.candidates.length}:`)
      for (const cand of a.candidates) console.log(`      ${cand.id}  ${cand.name}  [${cand.category}]`)
      suggestion[a.player.slug] = 'PUT-THE-CORRECT-UUID-HERE'
    }
    console.log(`\n  starter map file:\n${JSON.stringify(suggestion, null, 2)}`)
  }

  const ties = tournaments.reduce((n, t) => n + new Set(t.matches.map((m) => `${m.stage}|${m.sessionNumber}`)).size, 0)
  const totalMatches = tournaments.reduce((n, t) => n + t.matches.length, 0)
  console.log(`\n=== EVENTS ===`)
  console.log(`  tournaments : ${tournaments.length}`)
  console.log(`  ties        : ${ties}`)
  console.log(`  matches     : ${totalMatches}`)

  if (!APPLY) { console.log(`\nDry run complete. Nothing written.`); return }

  if (c.ambiguous.length > 0) {
    throw new Error(`refusing to apply: ${c.ambiguous.length} ambiguous player(s) unmapped. Use --map.`)
  }

  throw new Error('--apply is not implemented yet (Task 4)')
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Typecheck**

`cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league && npx tsc --noEmit 2>&1 | grep "scripts/" || echo "no scripts errors"`

- [ ] **Step 3: Run the dry run against production**

```bash
cd /Volumes/Crucial/dev/padel-live-scores/.worktrees/ppl-league
npx tsx scripts/import-ppl-season.ts
```

This performs **only SELECTs**. Expected shape (numbers will drift):

```
unique players across payloads: ~132
  already linked : 0
  to link        : ~118
  to create      : ~11
  AMBIGUOUS      : ~6
```

**STOP HERE and hand the output to the user.** Do not proceed to Task 4 until they have reviewed the create list and supplied a map file for the ambiguous entries.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-ppl-season.ts
git commit -m "feat(ppl): season import script, dry-run only

--apply deliberately unimplemented so the classification output can be
reviewed before any write path exists."
```

---

## Task 4: The write path

**Blocked on:** Phase 1's migration being applied, and a human-approved map file for the ambiguous players.

**Files:**
- Modify: `scripts/import-ppl-season.ts`

Replace the `throw new Error('--apply is not implemented yet (Task 4)')` with the five write phases below. Each is idempotent.

- [ ] **Step 1: Players**

```ts
  const { PlayerResolver } = await import('../src/lib/player-resolver')
  const { registerSourceId } = await import('../src/lib/external-id-registry')
  const resolver = new PlayerResolver(supabase)

  const playerIdBySlug = new Map<string, string>(c.linked.map((x) => [x.player.slug, x.playerId]))

  for (const x of c.toLink) playerIdBySlug.set(x.player.slug, x.playerId)

  for (const x of c.toCreate) {
    // No externalId / fipId on purpose: PlayerResolver's own docblock warns
    // that synthesising an external_id from a name minted 838 fake padelapi
    // IDs in 2026-03. A plain insert leaves tier defaulting to 'pro' and
    // ranking NULL, which is exactly what the spec calls for.
    const res = await resolver.resolve({ name: x.player.name, category: x.category })
    playerIdBySlug.set(x.player.slug, res.playerId)
    console.log(`  ${res.action}: ${x.player.name} -> ${res.playerId}`)
  }

  // Register EVERY slug, including ones that were already linked by name —
  // that is what makes the Phase 2c worker a pure lookup with no fuzzy.
  for (const [slug, playerId] of playerIdBySlug) {
    await registerSourceId(supabase, {
      entityType: 'player', entityId: playerId, source: 'ppl', externalId: slug,
    })
  }
```

- [ ] **Step 2: Teams**

```ts
  const teamIdBySlug = new Map<string, string>()
  const allTeams = new Map<string, (typeof tournaments)[number]['teams'][number]>()
  for (const t of tournaments) for (const tm of t.teams) if (!allTeams.has(tm.slug)) allTeams.set(tm.slug, tm)

  for (const tm of allTeams.values()) {
    const row = {
      slug: `ppl-${tm.slug}`,
      name: tm.name,
      city: tm.location,
      crest_url: tm.colorLogo,
      brand_color: tm.brandColor,
      badge_label: 'Pro Padel League',
      short_name: 'PPL',
      source: 'ppl',
      external_id: tm.slug,
    }
    const { data, error } = await supabase
      .from('teams')
      .upsert(row, { onConflict: 'source,external_id' })
      .select('id')
      .single()
    if (error) throw new Error(`teams upsert failed (${tm.slug}): ${error.message}`)
    teamIdBySlug.set(tm.slug, data.id)
  }
```

`teams.slug` is globally unique, hence the `ppl-` prefix — an unprefixed `miami-padel-club` could collide with a future amateur club. `(source, external_id)` is already `UNIQUE` on the table.

- [ ] **Step 3: Team seasons and rosters**

```ts
  // One season row per franchise per division.
  const seasonIdByKey = new Map<string, string>()   // `${teamSlug}|${league}`
  const leagues = [...new Set(tournaments.map((t) => t.league))]

  for (const league of leagues) {
    const label = league === 'ppl-ii' ? '2026 PPL II' : '2026 PPL'
    for (const [teamSlug, teamId] of teamIdBySlug) {
      const { data, error } = await supabase
        .from('team_seasons')
        .upsert({ team_id: teamId, label, league, season_year: 2026 }, { onConflict: 'team_id,label' })
        .select('id')
        .single()
      if (error) throw new Error(`team_seasons upsert failed (${teamSlug}/${league}): ${error.message}`)
      seasonIdByKey.set(`${teamSlug}|${league}`, data.id)
    }
  }

  // Roster membership, from the franchise's mens/womensPlayerIds.
  for (const t of tournaments) {
    for (const tm of t.teams) {
      const seasonId = seasonIdByKey.get(`${tm.slug}|${t.league}`)
      if (!seasonId) continue
      for (const slug of [...tm.mensPlayerIds, ...tm.womensPlayerIds]) {
        const playerId = playerIdBySlug.get(slug)
        if (!playerId) { console.warn(`  roster: unresolved slug ${slug} on ${tm.slug}`); continue }
        const { error } = await supabase
          .from('team_memberships')
          .upsert({ team_season_id: seasonId, player_id: playerId }, { onConflict: 'team_season_id,player_id' })
        if (error) throw new Error(`team_memberships upsert failed (${slug}): ${error.message}`)
      }
    }
  }
```

**Note:** a franchise's `mensPlayerIds` / `womensPlayerIds` are reported per event payload and may differ between events as rosters change. Upserting per event means the membership set is the *union* across the season, which is the intent — `team_memberships` is "who played for this franchise this season", not "who is on the sheet today".

- [ ] **Step 4: Tournaments**

```ts
  const tournamentIdBySlug = new Map<string, string>()
  for (const t of tournaments) {
    const level = t.league === 'ppl-ii' ? 'ppl_ii' : 'ppl'
    const { data, error } = await supabase
      .from('tournaments')
      .upsert(
        {
          name: t.name,
          level,
          source: 'ppl',
          external_id: t.slug,
          starts_at: t.startDate,
          ends_at: t.endDate,
          location: t.location,
          last_updated_by: 'manual',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'external_id' },
      )
      .select('id')
      .single()
    if (error) throw new Error(`tournaments upsert failed (${t.slug}): ${error.message}`)
    tournamentIdBySlug.set(t.slug, data.id)
  }
```

### Constraints and triggers — verified against production 2026-09-23

Every `onConflict` in this plan was checked against the live database:

| Table | Unique index | Used by |
|---|---|---|
| `tournaments` | `(external_id)` — full, not partial | Task 4 Step 4 |
| `teams` | `(source, external_id)` and `(slug)` | Task 4 Step 2 |
| `team_seasons` | `(team_id, label)` | Task 4 Step 3 |
| `team_memberships` | `(team_season_id, player_id)` | Task 4 Step 3 |

Nullability: `tournaments.public_id` and `matches.public_id` are `NOT NULL` but carry `default public_id(...)`; `matches.status` defaults to `'scheduled'`; `teams.slug` and `teams.name` are `NOT NULL` and this plan sets both. `tournaments.slug` is **nullable** — see below.

**⚠️ Two id-sync triggers will bite if you deviate from this plan.**

`sync_matches_id_columns` (BEFORE INSERT on `matches`) is **unconditional — no `source` gate at all**:

```sql
IF NEW.padelapi_id IS NULL THEN NEW.padelapi_id := NEW.external_id; END IF;
```

So **never set `matches.external_id` for a PPL match.** Doing so writes the PPL match id (`los-angeles-2026-d1-m1-mens`) straight into `padelapi_id`, a UNIQUE column reserved for padelapi's numeric ids. That is why Task 4 Step 5 registers the PPL id in `entity_external_ids` instead. This is a deliberate constraint, not an oversight.

`sync_tournaments_id_columns` (BEFORE INSERT on `tournaments`) gates the padelapi pair on source — `IF NEW.source = 'padelapi' OR NEW.source IS NULL` — so `source: 'ppl'` keeps our `external_id` out of `padelapi_id`. But the FIP pair is **not** gated:

```sql
IF NEW.fip_id IS NULL THEN NEW.fip_id := NEW.slug; END IF;
```

So **do not set `tournaments.slug` for PPL events** — it would mint a fake `fip_id` in a UNIQUE column. Leaving both NULL is correct and is what Task 4 Step 4 does. A NULL slug is a normal supported state: 43 of 750 production tournaments have one today, including 15 live events from the last year.

- [ ] **Step 5: Ties and match skeletons**

```ts
  for (const t of tournaments) {
    const tournamentId = tournamentIdBySlug.get(t.slug)!
    // A tie is (stage, sessionNumber) — it yields one men's and one women's match.
    const tieKeys = new Map<string, typeof t.matches>()
    for (const m of t.matches) {
      const key = `${m.stage}|${m.sessionNumber ?? 'null'}|${m.homeTeamSlug}|${m.awayTeamSlug}`
      if (!tieKeys.has(key)) tieKeys.set(key, [])
      tieKeys.get(key)!.push(m)
    }

    for (const [, group] of tieKeys) {
      const first = group[0]
      const homeSeason = seasonIdByKey.get(`${first.homeTeamSlug}|${t.league}`)
      const awaySeason = seasonIdByKey.get(`${first.awayTeamSlug}|${t.league}`)
      if (!homeSeason || !awaySeason) { console.warn(`  tie: missing season for ${first.id}`); continue }

      const { data: tie, error: tieErr } = await supabase
        .from('league_ties')
        .upsert(
          {
            tournament_id: tournamentId,
            session_number: first.sessionNumber,
            stage: first.stage,
            home_team_season_id: homeSeason,
            away_team_season_id: awaySeason,
          },
          { onConflict: first.sessionNumber == null ? 'tournament_id,stage' : 'tournament_id,session_number,stage' },
        )
        .select('id')
        .single()
      if (tieErr) throw new Error(`league_ties upsert failed (${first.id}): ${tieErr.message}`)

      for (const m of group) {
        const { data: found } = await supabase
          .from('entity_external_ids')
          .select('entity_id')
          .eq('entity_type', 'match').eq('source', 'ppl').eq('external_id', m.id)
          .maybeSingle()

        if (found?.entity_id) {
          // Idempotent re-run: only ever gap-fill the tie link.
          await supabase.from('matches').update({ tie_id: tie.id }).eq('id', found.entity_id).is('tie_id', null)
          continue
        }

        // Deliberately NOT setting status / winner_pair / sets — those belong
        // to Phase 2b. scheduled_at is left NULL too: upstream emits
        // zone-less wall-clock in two different formats, and guessing the
        // timezone here would bake in a silent error.
        const { data: inserted, error: insErr } = await supabase
          .from('matches')
          .insert({
            tournament_id: tournamentId,
            tie_id: tie.id,
            category: m.category,
            round: m.stage,
            last_updated_by: 'manual',
          })
          .select('id')
          .single()
        if (insErr) throw new Error(`matches insert failed (${m.id}): ${insErr.message}`)

        await supabase.from('entity_external_ids').upsert(
          {
            entity_type: 'match', entity_id: inserted.id, source: 'ppl', external_id: m.id,
            first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(),
          },
          { onConflict: 'source,entity_type,external_id', ignoreDuplicates: true },
        )
      }
    }
  }

  console.log('\nApply complete.')
```

- [ ] **Step 6: Re-run the dry run, confirm it is now a no-op**

```bash
npx tsx scripts/import-ppl-season.ts
```
Expected: `already linked` equals the full roster size, `to link` and `to create` both 0.

Then run `--apply` a second time and confirm it writes nothing new — count `matches` where `tie_id is not null` before and after; they must be equal.

- [ ] **Step 7: Commit**

```bash
git add scripts/import-ppl-season.ts
git commit -m "feat(ppl): write path for the static season import"
```

---

## Task 5: Verification

- [ ] **Step 1: Unit tests**

`npx vitest run scripts/__tests__/ppl-source.test.ts scripts/__tests__/ppl-classify.test.ts`
Expected: PASS, 17 tests

- [ ] **Step 2: No regressions**

`npx vitest run --dir src`
Expected: same 14 pre-existing failures documented in the Phase 1 plan and nothing more. `apps/*` have no installed `node_modules` in this worktree — do not run the bare root suite and read its failures as real.

- [ ] **Step 3: Typecheck**

`npx tsc --noEmit 2>&1 | grep -v push-copy`
Expected: empty (the two `push-copy.test.ts` errors are pre-existing)

- [ ] **Step 4: Spot-check the data**

Confirm by query: 10 `teams` with `source='ppl'`; 20 `team_seasons` split across `league`; every `matches` row with a `tie_id` has a non-null `tournament_id` and a `category`; no `matches` row with `tie_id` has a `winner_pair` (scores are Phase 2b).

---

## Explicitly not in this phase

- **Scores, sets, and `match_stats`** — Phase 2b, needs Playwright and the DOM.
- **`matches.scheduled_at`** — left NULL. Upstream emits zone-less wall-clock in two formats within the same payload. Setting it requires a per-event timezone decision, and the repo already has a scar from exactly this (the Paris Major 24h-clock incident left 110 matches with NULL `scheduled_at`). Phase 2b does it deliberately with the venue timezone.
- **`matches.status`** — left at the DB default. Phase 2b sets it from the scraped result.
- **Standings** — `team_seasons` has the columns (`ranking`, `ties_played`, `ties_won`, `points_for`, `points_against`) but they need the scores. Phase 2b.
- **The recurring `ppl-fetcher` / `ppl-writer` workers, the snapshot table, and retention** — Phase 2c. The spec's retention requirement stands and must ship in the migration that creates the snapshot table; there is no existing snapshot-cleanup precedent in the repo to copy, only `raw-payloads-prune.ts`.
- **The `apps/ops` `player-resolver.ts` drift** (742 vs 827 lines, missing the `tier` guard) — a real pre-existing bug found while planning this, unrelated to PPL. Worth its own fix.
