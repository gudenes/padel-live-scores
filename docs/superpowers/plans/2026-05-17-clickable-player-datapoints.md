# Clickable Player Datapoints — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make five datapoints on the player profile clickable — Hero `Títulos` and Overview earnings cards open relevant tabs; `Pts FIP` chip + `#14 World` rank pill deep-link to the rankings page with the player scrolled into the middle of the viewport.

**Architecture:** Three independent pieces sharing helpers. (1) A new `Ganhos` tab fed by `player_tournament_earnings`. (2) An enhanced `Temporada` tab with a titles call-out + per-tournament list derived from already-loaded matches. (3) The rankings page gains URL-driven `?gender=`, `?type=`, and `?highlight=` params, plus a scroll-and-pulse behavior for the highlighted player.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase (PostgREST), `next-intl` (5 locales), Vitest for pure-function tests.

**Spec:** [docs/superpowers/specs/2026-05-17-clickable-player-datapoints-design.md](../specs/2026-05-17-clickable-player-datapoints-design.md)

---

## File Structure

| Path | Type | Responsibility |
|---|---|---|
| `src/lib/match-roles.ts` | new | Pure helper `resolveMatchRoles(match, playerId)` extracted from player page |
| `src/lib/derive-titles.ts` | new | Pure function returning the player's tournament wins from a matches array |
| `src/lib/derive-season-tournaments.ts` | new | Pure function aggregating matches → per-tournament summaries for a given year |
| `src/lib/__tests__/derive-titles.test.ts` | new | Vitest unit tests |
| `src/lib/__tests__/derive-season-tournaments.test.ts` | new | Vitest unit tests |
| `src/components/icons/TrophyIcon.tsx` | new | Inline SVG trophy at 14×14 default size |
| `src/app/[locale]/player/[id]/SeasonTab.tsx` | new | Extracted from `page.tsx`, then enhanced |
| `src/app/[locale]/player/[id]/EarningsTab.tsx` | new | New tab body — summary widgets, year chips, tournament list |
| `src/app/[locale]/player/[id]/TournamentRow.tsx` | new | Reusable row used by both new tab views |
| `src/app/[locale]/player/[id]/TitlesCallout.tsx` | new | Gold-tinted call-out used in SeasonTab |
| `src/app/[locale]/player/[id]/page.tsx` | edit | Add `'earnings'` to PageTab, URL state sync, click handlers, render new tab, swap in extracted SeasonTab |
| `src/app/[locale]/(app)/rankings/page.tsx` | edit | URL-sync gender + type; read `?highlight=`; render-enough; scroll-into-view; pulse |
| `src/messages/{en,es,pt,it,fr}.json` | edit | New i18n keys |

---

## Before You Start

Confirm you are on a fresh feature branch:

```bash
git checkout main
git pull
git checkout -b feat/clickable-player-datapoints
```

Verify dev server works:

```bash
npm run dev
# expect: ready on http://localhost:3002
```

Open the player profile in the browser (any player with earnings, e.g. Lucas Bergamini): `http://localhost:3002/player/<some-id>`. This is your manual QA target throughout.

---

### Task 1: Add i18n keys to all five locale files

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the keys to `en.json`**

Locate the `"player"` object in `src/messages/en.json` and add the following keys to it (in addition to whatever already exists — do not remove existing keys):

```json
{
  "earningsTab": "Earnings",
  "earningsTabNewPill": "NEW",
  "earningsTabNewPill_context": "Discovery badge on the new Earnings tab",
  "ytdEarningsCard": "YTD {year}",
  "careerEarningsCard": "Career",
  "earningsEventsCount": "{count, plural, one {# event} other {# events}}",
  "earningsTournamentsCount": "{count, plural, one {# tournament} other {# tournaments}}",
  "noEarningsForYear": "No earnings in {year}",
  "earningsAllYears": "All",
  "titlesCalloutLabel": "Titles {year} · {count}",
  "wonWithPartner": "w/ {partnerName}",
  "seasonTournamentsCount": "{count, plural, one {# tournament} other {# tournaments}}",
  "playerNotInTop1000": "{name} is not in top 1000",
  "viewInRankings": "View {name} in the rankings",
  "roundLabel": {
    "W": "Winner",
    "F": "Final",
    "SF": "SF",
    "QF": "QF",
    "R16": "R16",
    "R32": "R32",
    "R64": "R64",
    "Q1": "Q1",
    "Q2": "Q2",
    "Q3": "Q3"
  }
}
```

- [ ] **Step 2: Add the same keys to `pt.json` with Portuguese translations**

```json
{
  "earningsTab": "Ganhos",
  "earningsTabNewPill": "NEW",
  "earningsTabNewPill_context": "Distintivo de descoberta no novo separador Ganhos",
  "ytdEarningsCard": "YTD {year}",
  "careerEarningsCard": "Carreira",
  "earningsEventsCount": "{count, plural, one {# evento} other {# eventos}}",
  "earningsTournamentsCount": "{count, plural, one {# torneio} other {# torneios}}",
  "noEarningsForYear": "Sem ganhos em {year}",
  "earningsAllYears": "Tudo",
  "titlesCalloutLabel": "Títulos {year} · {count}",
  "wonWithPartner": "c/ {partnerName}",
  "seasonTournamentsCount": "{count, plural, one {# torneio} other {# torneios}}",
  "playerNotInTop1000": "{name} não está no top 1000",
  "viewInRankings": "Ver {name} no ranking",
  "roundLabel": {
    "W": "Vencedor",
    "F": "Final",
    "SF": "SF",
    "QF": "QF",
    "R16": "R16",
    "R32": "R32",
    "R64": "R64",
    "Q1": "Q1",
    "Q2": "Q2",
    "Q3": "Q3"
  }
}
```

- [ ] **Step 3: Add Spanish translations to `es.json`**

```json
{
  "earningsTab": "Ganancias",
  "earningsTabNewPill": "NEW",
  "ytdEarningsCard": "YTD {year}",
  "careerEarningsCard": "Carrera",
  "earningsEventsCount": "{count, plural, one {# evento} other {# eventos}}",
  "earningsTournamentsCount": "{count, plural, one {# torneo} other {# torneos}}",
  "noEarningsForYear": "Sin ganancias en {year}",
  "earningsAllYears": "Todo",
  "titlesCalloutLabel": "Títulos {year} · {count}",
  "wonWithPartner": "c/ {partnerName}",
  "seasonTournamentsCount": "{count, plural, one {# torneo} other {# torneos}}",
  "playerNotInTop1000": "{name} no está en el top 1000",
  "viewInRankings": "Ver {name} en el ranking",
  "roundLabel": { "W": "Ganador", "F": "Final", "SF": "SF", "QF": "QF", "R16": "R16", "R32": "R32", "R64": "R64", "Q1": "Q1", "Q2": "Q2", "Q3": "Q3" }
}
```

- [ ] **Step 4: Add Italian translations to `it.json`**

```json
{
  "earningsTab": "Guadagni",
  "earningsTabNewPill": "NEW",
  "ytdEarningsCard": "YTD {year}",
  "careerEarningsCard": "Carriera",
  "earningsEventsCount": "{count, plural, one {# evento} other {# eventi}}",
  "earningsTournamentsCount": "{count, plural, one {# torneo} other {# tornei}}",
  "noEarningsForYear": "Nessun guadagno nel {year}",
  "earningsAllYears": "Tutto",
  "titlesCalloutLabel": "Titoli {year} · {count}",
  "wonWithPartner": "c/ {partnerName}",
  "seasonTournamentsCount": "{count, plural, one {# torneo} other {# tornei}}",
  "playerNotInTop1000": "{name} non è nella top 1000",
  "viewInRankings": "Vedi {name} nelle classifiche",
  "roundLabel": { "W": "Vincitore", "F": "Finale", "SF": "SF", "QF": "QF", "R16": "R16", "R32": "R32", "R64": "R64", "Q1": "Q1", "Q2": "Q2", "Q3": "Q3" }
}
```

- [ ] **Step 5: Add French translations to `fr.json`**

```json
{
  "earningsTab": "Gains",
  "earningsTabNewPill": "NEW",
  "ytdEarningsCard": "YTD {year}",
  "careerEarningsCard": "Carrière",
  "earningsEventsCount": "{count, plural, one {# événement} other {# événements}}",
  "earningsTournamentsCount": "{count, plural, one {# tournoi} other {# tournois}}",
  "noEarningsForYear": "Aucun gain en {year}",
  "earningsAllYears": "Tout",
  "titlesCalloutLabel": "Titres {year} · {count}",
  "wonWithPartner": "avec {partnerName}",
  "seasonTournamentsCount": "{count, plural, one {# tournoi} other {# tournois}}",
  "playerNotInTop1000": "{name} n'est pas dans le top 1000",
  "viewInRankings": "Voir {name} au classement",
  "roundLabel": { "W": "Vainqueur", "F": "Finale", "SF": "SF", "QF": "QF", "R16": "R16", "R32": "R32", "R64": "R64", "Q1": "Q1", "Q2": "Q2", "Q3": "Q3" }
}
```

- [ ] **Step 6: Verify `npm run build` doesn't break on missing keys**

Run: `npm run lint`
Expected: passes. JSON parse failures will show up here.

- [ ] **Step 7: Commit**

```bash
git add src/messages/
git commit -m "i18n: add earnings tab + titles call-out + rankings deep-link keys"
```

---

### Task 2: Extract `resolveMatchRoles` to `src/lib/match-roles.ts`

The function is currently a private helper in `page.tsx:360-372`. The new derive-* functions need it too. Pure refactor — no behavior change.

**Files:**
- Create: `src/lib/match-roles.ts`
- Modify: `src/app/[locale]/player/[id]/page.tsx:360-372` (delete) and import block (add import)

- [ ] **Step 1: Create the new module**

Write `src/lib/match-roles.ts`:

```ts
/**
 * resolveMatchRoles — given a match row and a player id, return that player's
 * role in the match: which pair they were on, partner, opponents, win/loss.
 *
 * Pure function. Safe for both UI and pure-function tests.
 */
export interface MatchPlayer {
  id: string
  name?: string | null
  display_name?: string | null
  country?: string | null
}

export interface MatchRowForRoles {
  pair1_player1?: MatchPlayer | null
  pair1_player2?: MatchPlayer | null
  pair2_player1?: MatchPlayer | null
  pair2_player2?: MatchPlayer | null
  status?: string | null
  winner_pair?: number | null
}

export interface ResolvedMatchRoles {
  isP1: boolean
  partner: MatchPlayer | null
  opp1: MatchPlayer | null
  opp2: MatchPlayer | null
  myPair: 1 | 2
  won: boolean
  lost: boolean
}

export function resolveMatchRoles(
  match: MatchRowForRoles,
  playerId: string,
): ResolvedMatchRoles {
  const isP1 =
    match.pair1_player1?.id === playerId || match.pair1_player2?.id === playerId
  const partner = isP1
    ? (match.pair1_player1?.id === playerId ? match.pair1_player2 : match.pair1_player1) ?? null
    : (match.pair2_player1?.id === playerId ? match.pair2_player2 : match.pair2_player1) ?? null
  const opp1 = (isP1 ? match.pair2_player1 : match.pair1_player1) ?? null
  const opp2 = (isP1 ? match.pair2_player2 : match.pair1_player2) ?? null
  const myPair: 1 | 2 = isP1 ? 1 : 2
  const isTerminal =
    match.status === 'finished' ||
    match.status === 'retired' ||
    match.status === 'walkover'
  const won = isTerminal && match.winner_pair === myPair
  const lost = isTerminal && match.winner_pair != null && match.winner_pair !== myPair
  return { isP1, partner, opp1, opp2, myPair, won, lost }
}
```

- [ ] **Step 2: Remove the local function from `page.tsx`**

In `src/app/[locale]/player/[id]/page.tsx`, delete lines 360-372 (the local `function resolveMatchRoles` block).

- [ ] **Step 3: Add the import at the top of `page.tsx`**

Add to the import block near the top of the file (after the other `@/lib/...` imports):

```ts
import { resolveMatchRoles } from '@/lib/match-roles'
```

- [ ] **Step 4: Verify dev server still works**

Run: `npm run dev` (if not already running) and reload a player profile.
Expected: page renders identically — same widgets, same Last-10, same Season tab numbers.

- [ ] **Step 5: Commit**

```bash
git add src/lib/match-roles.ts src/app/[locale]/player/[id]/page.tsx
git commit -m "refactor(player): extract resolveMatchRoles to src/lib/match-roles"
```

---

### Task 3: Write `deriveTitles` (TDD)

**Files:**
- Create: `src/lib/derive-titles.ts`
- Create: `src/lib/__tests__/derive-titles.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `src/lib/__tests__/derive-titles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveTitles } from '../derive-titles'
import type { MatchRowForTitles } from '../derive-titles'

const player = { id: 'p1', name: 'Lucas', display_name: 'Lucas Bergamini' }
const partner = { id: 'p2', name: 'Javi', display_name: 'Javi Garrido' }
const opp1 = { id: 'p3', name: 'Galan', display_name: 'Galan' }
const opp2 = { id: 'p4', name: 'Tapia', display_name: 'Tapia' }

const finalMatch = (overrides: Partial<MatchRowForTitles> = {}): MatchRowForTitles => ({
  id: 'm1',
  round: 'F',
  status: 'finished',
  winner_pair: 1,
  played_at: '2026-04-15',
  finished_at: '2026-04-15T18:00:00Z',
  scheduled_at: null,
  pair1_player1: player,
  pair1_player2: partner,
  pair2_player1: opp1,
  pair2_player2: opp2,
  tournament: { id: 't1', name: 'FIP Gold Lisbon', level: 'fip_gold' },
  ...overrides,
})

describe('deriveTitles', () => {
  it('returns empty array when player has no finals', () => {
    expect(deriveTitles([], 'p1')).toEqual([])
  })

  it('returns one title for a single final won', () => {
    const result = deriveTitles([finalMatch()], 'p1')
    expect(result).toHaveLength(1)
    expect(result[0].tournamentId).toBe('t1')
    expect(result[0].tournamentName).toBe('FIP Gold Lisbon')
    expect(result[0].partner?.id).toBe('p2')
  })

  it('ignores finals where the player lost', () => {
    const lost = finalMatch({ winner_pair: 2 })
    expect(deriveTitles([lost], 'p1')).toEqual([])
  })

  it('ignores non-final rounds', () => {
    const sf = finalMatch({ round: 'SF' })
    expect(deriveTitles([sf], 'p1')).toEqual([])
  })

  it('ignores in-progress matches', () => {
    const live = finalMatch({ status: 'live', winner_pair: null })
    expect(deriveTitles([live], 'p1')).toEqual([])
  })

  it('counts a retired final as a title for the winner', () => {
    const retired = finalMatch({ status: 'retired' })
    expect(deriveTitles([retired], 'p1')).toHaveLength(1)
  })

  it('counts a walkover final as a title for the winner', () => {
    const wo = finalMatch({ status: 'walkover' })
    expect(deriveTitles([wo], 'p1')).toHaveLength(1)
  })

  it('handles player on pair2 (not pair1)', () => {
    const onPair2 = finalMatch({
      pair1_player1: opp1,
      pair1_player2: opp2,
      pair2_player1: player,
      pair2_player2: partner,
      winner_pair: 2,
    })
    const result = deriveTitles([onPair2], 'p1')
    expect(result).toHaveLength(1)
    expect(result[0].partner?.id).toBe('p2')
  })

  it('returns multiple titles sorted by date desc', () => {
    const may = finalMatch({ id: 'm-may', tournament: { id: 'tm', name: 'May Cup', level: 'fip_silver' }, finished_at: '2026-05-10T18:00:00Z' })
    const apr = finalMatch({ id: 'm-apr', tournament: { id: 'ta', name: 'Apr Cup', level: 'fip_gold' }, finished_at: '2026-04-10T18:00:00Z' })
    const result = deriveTitles([apr, may], 'p1')
    expect(result.map(t => t.tournamentId)).toEqual(['tm', 'ta'])
  })

  it('dedupes if the same tournament_id appears twice', () => {
    // Defensive — should not happen in production but we guard.
    const dup = finalMatch({ id: 'm-dup' })
    expect(deriveTitles([finalMatch(), dup], 'p1')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/derive-titles.test.ts`
Expected: FAIL — `Cannot find module '../derive-titles'`

- [ ] **Step 3: Write `src/lib/derive-titles.ts`**

```ts
import { resolveMatchRoles, type MatchPlayer } from './match-roles'

export interface MatchRowForTitles {
  id: string
  round: string | null
  status: string | null
  winner_pair: number | null
  played_at: string | null
  finished_at: string | null
  scheduled_at: string | null
  pair1_player1?: MatchPlayer | null
  pair1_player2?: MatchPlayer | null
  pair2_player1?: MatchPlayer | null
  pair2_player2?: MatchPlayer | null
  tournament?: {
    id: string
    name: string
    level?: string | null
    country?: string | null
    starts_at?: string | null
    ends_at?: string | null
  } | null
}

export interface TitleEntry {
  tournamentId: string
  tournamentName: string
  tournamentLevel: string | null
  partner: MatchPlayer | null
  /** ISO date of the title-winning final */
  wonAt: string | null
}

/**
 * Returns the player's tournament wins, derived from final matches they won.
 * Sorted by `wonAt` descending. Duplicates by `tournament_id` are dropped.
 */
export function deriveTitles(
  matches: MatchRowForTitles[],
  playerId: string,
): TitleEntry[] {
  const entries: TitleEntry[] = []
  const seen = new Set<string>()
  for (const m of matches) {
    if (m.round !== 'F') continue
    if (!m.tournament?.id) continue
    if (seen.has(m.tournament.id)) continue
    const roles = resolveMatchRoles(m, playerId)
    if (!roles.won) continue
    entries.push({
      tournamentId: m.tournament.id,
      tournamentName: m.tournament.name,
      tournamentLevel: m.tournament.level ?? null,
      partner: roles.partner,
      wonAt: m.finished_at ?? m.played_at ?? m.scheduled_at,
    })
    seen.add(m.tournament.id)
  }
  return entries.sort((a, b) => (b.wonAt ?? '').localeCompare(a.wonAt ?? ''))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/derive-titles.test.ts`
Expected: PASS, all 10 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/derive-titles.ts src/lib/__tests__/derive-titles.test.ts
git commit -m "feat(player): derive titles from matches won in finals"
```

---

### Task 4: Write `deriveSeasonTournaments` (TDD)

**Files:**
- Create: `src/lib/derive-season-tournaments.ts`
- Create: `src/lib/__tests__/derive-season-tournaments.test.ts`

- [ ] **Step 1: Write the failing tests**

Write `src/lib/__tests__/derive-season-tournaments.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveSeasonTournaments } from '../derive-season-tournaments'
import type { MatchRowForTitles } from '../derive-titles'

const player = { id: 'p1' }
const partner = { id: 'p2' }
const opp1 = { id: 'p3' }
const opp2 = { id: 'p4' }

const match = (overrides: Partial<MatchRowForTitles>): MatchRowForTitles => ({
  id: 'm',
  round: 'R16',
  status: 'finished',
  winner_pair: 1,
  played_at: null,
  finished_at: '2026-04-01T18:00:00Z',
  scheduled_at: null,
  pair1_player1: player,
  pair1_player2: partner,
  pair2_player1: opp1,
  pair2_player2: opp2,
  tournament: { id: 't1', name: 'Tour 1', level: 'premier_p2' },
  ...overrides,
})

describe('deriveSeasonTournaments', () => {
  it('returns empty for empty input', () => {
    expect(deriveSeasonTournaments([], 'p1', 2026)).toEqual([])
  })

  it('filters matches to the requested year', () => {
    const m2025 = match({ id: 'a', finished_at: '2025-04-01T00:00:00Z' })
    const m2026 = match({ id: 'b', finished_at: '2026-04-01T00:00:00Z' })
    const result = deriveSeasonTournaments([m2025, m2026], 'p1', 2026)
    expect(result).toHaveLength(1)
  })

  it('aggregates multiple matches in same tournament', () => {
    const r16 = match({ id: 'a', round: 'R16', winner_pair: 1 })
    const qf  = match({ id: 'b', round: 'QF',  winner_pair: 1 })
    const sf  = match({ id: 'c', round: 'SF',  winner_pair: 2 }) // lost in SF
    const result = deriveSeasonTournaments([r16, qf, sf], 'p1', 2026)
    expect(result).toHaveLength(1)
    expect(result[0].bestRound).toBe('SF')
    expect(result[0].matchCount).toBe(3)
    expect(result[0].wins).toBe(2)
    expect(result[0].losses).toBe(1)
    expect(result[0].isTitle).toBe(false)
  })

  it('marks isTitle=true and bestRound="W" when player won the final', () => {
    const sf = match({ id: 'a', round: 'SF', winner_pair: 1 })
    const f  = match({ id: 'b', round: 'F',  winner_pair: 1 })
    const result = deriveSeasonTournaments([sf, f], 'p1', 2026)
    expect(result[0].bestRound).toBe('W')
    expect(result[0].isTitle).toBe(true)
  })

  it('bestRound stays "F" when player lost the final', () => {
    const sf = match({ id: 'a', round: 'SF', winner_pair: 1 })
    const f  = match({ id: 'b', round: 'F',  winner_pair: 2 }) // lost final
    const result = deriveSeasonTournaments([sf, f], 'p1', 2026)
    expect(result[0].bestRound).toBe('F')
    expect(result[0].isTitle).toBe(false)
  })

  it('sorts tournaments by latest match date desc', () => {
    const apr = match({ id: 'a', tournament: { id: 'apr', name: 'Apr', level: null }, finished_at: '2026-04-15T00:00:00Z' })
    const may = match({ id: 'b', tournament: { id: 'may', name: 'May', level: null }, finished_at: '2026-05-15T00:00:00Z' })
    const feb = match({ id: 'c', tournament: { id: 'feb', name: 'Feb', level: null }, finished_at: '2026-02-15T00:00:00Z' })
    const result = deriveSeasonTournaments([apr, may, feb], 'p1', 2026)
    expect(result.map(r => r.tournament.id)).toEqual(['may', 'apr', 'feb'])
  })

  it('skips matches with no tournament reference', () => {
    const orphan = match({ tournament: null })
    expect(deriveSeasonTournaments([orphan], 'p1', 2026)).toEqual([])
  })

  it('uses played_at or scheduled_at when finished_at is null', () => {
    const m = match({ finished_at: null, played_at: '2026-03-01' })
    const result = deriveSeasonTournaments([m], 'p1', 2026)
    expect(result).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/derive-season-tournaments.test.ts`
Expected: FAIL — `Cannot find module '../derive-season-tournaments'`

- [ ] **Step 3: Write `src/lib/derive-season-tournaments.ts`**

```ts
import { resolveMatchRoles } from './match-roles'
import type { MatchRowForTitles } from './derive-titles'

export type BestRound = 'W' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'Q3' | 'Q2' | 'Q1'

/** Higher number = deeper run. */
const ROUND_DEPTH: Record<string, number> = {
  W: 10, F: 9, SF: 8, QF: 7, R16: 6, R32: 5, R64: 4, Q3: 3, Q2: 2, Q1: 1,
}

export interface TournamentSummary {
  tournament: {
    id: string
    name: string
    level: string | null
    country: string | null
    starts_at: string | null
    ends_at: string | null
  }
  bestRound: BestRound
  matchCount: number
  wins: number
  losses: number
  /** True when player won the final (bestRound === 'W'). */
  isTitle: boolean
  /** ISO of the player's latest match in this tournament. */
  latestMatchAt: string | null
}

function matchYear(m: MatchRowForTitles): number | null {
  const iso = m.finished_at ?? m.played_at ?? m.scheduled_at
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.getUTCFullYear()
}

export function deriveSeasonTournaments(
  matches: MatchRowForTitles[],
  playerId: string,
  year: number,
): TournamentSummary[] {
  type Acc = TournamentSummary & { _depth: number }
  const byT = new Map<string, Acc>()

  for (const m of matches) {
    if (!m.tournament?.id) continue
    if (matchYear(m) !== year) continue
    const tid = m.tournament.id
    const roles = resolveMatchRoles(m, playerId)
    const isFinalWon = m.round === 'F' && roles.won
    const round = (isFinalWon ? 'W' : (m.round ?? 'R64')) as BestRound
    const depth = ROUND_DEPTH[round] ?? 0
    const iso = m.finished_at ?? m.played_at ?? m.scheduled_at

    const existing = byT.get(tid)
    if (!existing) {
      byT.set(tid, {
        tournament: {
          id: tid,
          name: m.tournament.name,
          level: m.tournament.level ?? null,
          country: m.tournament.country ?? null,
          starts_at: m.tournament.starts_at ?? null,
          ends_at: m.tournament.ends_at ?? null,
        },
        bestRound: round,
        matchCount: 1,
        wins: roles.won ? 1 : 0,
        losses: roles.lost ? 1 : 0,
        isTitle: round === 'W',
        latestMatchAt: iso,
        _depth: depth,
      })
    } else {
      existing.matchCount += 1
      if (roles.won) existing.wins += 1
      if (roles.lost) existing.losses += 1
      if (depth > existing._depth) {
        existing.bestRound = round
        existing._depth = depth
        existing.isTitle = round === 'W'
      }
      if (iso && (!existing.latestMatchAt || iso > existing.latestMatchAt)) {
        existing.latestMatchAt = iso
      }
    }
  }

  return Array.from(byT.values())
    .map(({ _depth, ...rest }) => rest)
    .sort((a, b) => (b.latestMatchAt ?? '').localeCompare(a.latestMatchAt ?? ''))
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/derive-season-tournaments.test.ts`
Expected: PASS, all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/derive-season-tournaments.ts src/lib/__tests__/derive-season-tournaments.test.ts
git commit -m "feat(player): derive per-tournament season summaries from match list"
```

---

### Task 5: Add Trophy SVG icon

**Files:**
- Create: `src/components/icons/TrophyIcon.tsx`

- [ ] **Step 1: Create the icon**

Check first whether `src/components/icons/` already exists. If it doesn't, create the directory. Then write `src/components/icons/TrophyIcon.tsx`:

```tsx
import * as React from 'react'

export function TrophyIcon({
  size = 14,
  color = '#D4A017',
  className,
  style,
}: {
  size?: number
  color?: string
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/icons/TrophyIcon.tsx
git commit -m "feat: add gold trophy SVG icon for title indicators"
```

---

### Task 6: Build `TournamentRow` shared component

**Files:**
- Create: `src/app/[locale]/player/[id]/TournamentRow.tsx`

- [ ] **Step 1: Write the component**

```tsx
import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TrophyIcon } from '@/components/icons/TrophyIcon'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_CARD2 = '#0F0F0F'
const MUTED = '#6B7280'

const LEVEL_FLAG: Record<string, string> = {
  premier_p1: LIVE_RED,
  premier_p2: LIVE_RED,
  premier_major: LIVE_RED,
  premier_mens: LIVE_RED,
  premier_womens: LIVE_RED,
  fip_gold: '#D4A017',
  fip_silver: '#94A3B8',
  fip_bronze: '#B45309',
}

function titleCase(s: string): string {
  return s.replace(/\b\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

export type TournamentRoundCode =
  | 'W' | 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'Q1' | 'Q2' | 'Q3'

interface Props {
  tournamentId: string
  tournamentName: string
  tournamentLevel: string | null
  /** Round pill code, e.g. 'W' for winner, 'SF' for semifinal. */
  round: TournamentRoundCode
  /** Right side display: either a € amount or a record string like "5 partidas · 4-1" */
  trailing: string
  /** Show a gold trophy icon at the far right edge (for title rows). */
  showTrophy?: boolean
  /** Date subtitle text, already formatted. */
  dateText?: string
}

export function TournamentRow({
  tournamentId,
  tournamentName,
  tournamentLevel,
  round,
  trailing,
  showTrophy = false,
  dateText,
}: Props) {
  const t = useTranslations('player.roundLabel')
  const flag = (tournamentLevel && LEVEL_FLAG[tournamentLevel]) || MUTED
  const isWinner = round === 'W'
  const pillStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '1.5px 6px',
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: 0.5,
    clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
    textTransform: 'uppercase',
    ...(isWinner
      ? { background: '#D4A017', color: '#000' }
      : round === 'F'
        ? { background: 'rgba(212,160,23,0.15)', color: '#D4A017', border: '1px solid rgba(212,160,23,0.35)' }
        : { background: 'rgba(255,255,255,0.06)', color: '#B8B8B8' }),
  }

  return (
    <Link
      href={`/tournaments/${tournamentId}`}
      style={{
        background: BG_CARD2,
        padding: '10px 12px',
        clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <div style={{ width: 3, alignSelf: 'stretch', background: flag, borderRadius: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: '#fff',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {titleCase(tournamentName)}
        </div>
        <div style={{ fontSize: 9, color: MUTED, marginTop: 3, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={pillStyle}>{t(round)}</span>
          {dateText && <span>· {dateText}</span>}
        </div>
      </div>
      <div
        style={{
          color: GREEN,
          fontWeight: 800,
          fontSize: 12,
          fontVariantNumeric: 'tabular-nums',
          flexShrink: 0,
        }}
      >
        {trailing}
      </div>
      {showTrophy && (
        <div
          style={{
            width: 22,
            height: 22,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(212,160,23,0.15)',
            clipPath: 'polygon(8% 12%, 92% 0%, 100% 88%, 0% 100%)',
            flexShrink: 0,
          }}
        >
          <TrophyIcon size={14} />
        </div>
      )}
    </Link>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/player/[id]/TournamentRow.tsx
git commit -m "feat(player): add shared TournamentRow component"
```

---

### Task 7: Build `TitlesCallout` component

**Files:**
- Create: `src/app/[locale]/player/[id]/TitlesCallout.tsx`

- [ ] **Step 1: Write the component**

```tsx
import * as React from 'react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { TrophyIcon } from '@/components/icons/TrophyIcon'
import type { TitleEntry } from '@/lib/derive-titles'

const MUTED = '#6B7280'
const GOLD = '#D4A017'

function titleCase(s: string): string {
  return s.replace(/\b\w+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase())
}

interface Props {
  year: number
  titles: TitleEntry[]
}

/**
 * Gold-tinted card listing titles for the given year.
 * Renders nothing when `titles` is empty (per spec: no "0 titles" placeholder).
 */
export function TitlesCallout({ year, titles }: Props) {
  const t = useTranslations('player')
  if (titles.length === 0) return null

  return (
    <div
      style={{
        padding: 12,
        background: 'linear-gradient(135deg, rgba(212,160,23,0.15), rgba(245,166,35,0.05))',
        borderLeft: `3px solid ${GOLD}`,
        clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: GOLD,
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontWeight: 700,
          marginBottom: 6,
        }}
      >
        {t('titlesCalloutLabel', { year, count: titles.length })}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {titles.map(title => (
          <Link
            key={title.tournamentId}
            href={`/tournaments/${title.tournamentId}`}
            style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit' }}
          >
            <TrophyIcon size={16} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>
                {titleCase(title.tournamentName)}
              </div>
              {title.partner && (
                <div style={{ fontSize: 10, color: MUTED, marginTop: 2 }}>
                  {t('wonWithPartner', {
                    partnerName: titleCase(
                      title.partner.display_name?.trim() || title.partner.name || '',
                    ),
                  })}
                </div>
              )}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/[locale]/player/[id]/TitlesCallout.tsx
git commit -m "feat(player): add TitlesCallout component for season tab"
```

---

### Task 8: Extract `SeasonTab` from `page.tsx` (refactor only)

This is a pure code-move — same behavior, just lifted out of the 2000-line page file. Do this BEFORE adding new behavior so the diff for the next task is clean.

**Files:**
- Create: `src/app/[locale]/player/[id]/SeasonTab.tsx`
- Modify: `src/app/[locale]/player/[id]/page.tsx`

- [ ] **Step 1: Locate the existing `SeasonTab` block**

In `page.tsx`, the `function SeasonTab({ ... })` definition begins around line 1255 and ends around line 1378 (per the section header `// SEASON TAB`). The `function SeasonStat(...)` and `function MonthlyBar(...)` helpers used by SeasonTab live just below. All three move together.

- [ ] **Step 2: Create the new file with the moved code**

Write `src/app/[locale]/player/[id]/SeasonTab.tsx` and paste the `SeasonTab`, `SeasonStat`, and `MonthlyBar` function bodies verbatim. Add the needed imports at the top:

```tsx
'use client'

import { useMemo } from 'react'
import { useTranslations } from 'next-intl'
import { resolveMatchRoles } from '@/lib/match-roles'
// Bring in the shared constants used in the moved code. If they're not
// exported from somewhere, copy them locally (these are the same literals
// already used in page.tsx).

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const BG_CARD2 = '#0F0F0F'
const MUTED = '#6B7280'

// ... DerivedData type definition copied from page.tsx if not exported ...
// ... MatchRow type definition copied from page.tsx if not exported ...

// Helper types — keep identical to page.tsx
interface MatchRow {
  // copy the existing shape from page.tsx so this file is self-contained
}

// matchDate helper — copy from page.tsx
function matchDate(m: MatchRow): string | null {
  // identical body to page.tsx
}

export function SeasonTab({ /* same prop shape */ }) {
  // identical body
}

// SeasonStat and MonthlyBar follow, also exported as needed (or kept module-private)
```

**Important:** the moved code must reference identical types. If `MatchRow`, `DerivedData`, `PartnerInfo`, etc. are defined inline in `page.tsx`, do one of:
- **Option A** (preferred): extract those shared types to a new file `src/app/[locale]/player/[id]/types.ts` and import them from both `page.tsx` and `SeasonTab.tsx`.
- **Option B**: duplicate the type definitions in `SeasonTab.tsx`. Faster, but creates drift.

Go with Option A. Create `src/app/[locale]/player/[id]/types.ts` and move the `MatchRow`, `DerivedData`, `PartnerInfo`, `PageTab` types into it. Both files import from there.

- [ ] **Step 3: Remove the moved code from `page.tsx`**

Delete the `SeasonTab`, `SeasonStat`, `MonthlyBar`, and `matchDate` definitions from `page.tsx`. Replace with an import:

```ts
import { SeasonTab } from './SeasonTab'
```

The existing `{activeTab === 'season' && <SeasonTab ... />}` call in the JSX stays the same.

- [ ] **Step 4: Verify the page renders identically**

Run: `npm run dev` (if not already) and reload `/player/<id>` — open the Season tab.
Expected: identical visuals — year chips, season summary widget, monthly bars. Nothing missing, no console errors.

- [ ] **Step 5: Run lint**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/player/[id]/SeasonTab.tsx src/app/[locale]/player/[id]/types.ts src/app/[locale]/player/[id]/page.tsx
git commit -m "refactor(player): extract SeasonTab and shared types"
```

---

### Task 9: Enhance `SeasonTab` — add titles call-out + tournaments list

**Files:**
- Modify: `src/app/[locale]/player/[id]/SeasonTab.tsx`

- [ ] **Step 1: Add the new imports**

At the top of `SeasonTab.tsx`:

```ts
import { deriveTitles } from '@/lib/derive-titles'
import { deriveSeasonTournaments, type BestRound } from '@/lib/derive-season-tournaments'
import { TitlesCallout } from './TitlesCallout'
import { TournamentRow } from './TournamentRow'
import { useFormatter } from 'next-intl'
```

- [ ] **Step 2: Inside the `SeasonTab` component, derive titles and tournaments**

Just below the existing `useMemo` that computes `seasonWins/seasonLosses/monthly`, add:

```ts
const format = useFormatter()
const t = useTranslations('player')

const yearTitles = useMemo(
  () => deriveTitles(derived.finished, playerId).filter(title => {
    const iso = title.wonAt
    return iso != null && new Date(iso).getUTCFullYear() === selectedYear
  }),
  [derived.finished, playerId, selectedYear],
)

const seasonTournaments = useMemo(
  () => deriveSeasonTournaments(derived.finished, playerId, selectedYear),
  [derived.finished, playerId, selectedYear],
)

// Dev-only warning when stored titles count diverges from derived.
// Hard-gated to NODE_ENV !== 'production' per spec.
if (process.env.NODE_ENV !== 'production') {
  // No-op in render — log once on selection change.
  // Use a ref to avoid spamming, but keep this simple — React strict-mode will double-fire.
}
```

(Skip the dev-warning ref scaffolding — the spec says "log to console" and React's StrictMode double-fire isn't a real problem for an occasional warning. Add a plain `console.warn` inside a `useEffect`):

```ts
import { useEffect } from 'react'

useEffect(() => {
  if (process.env.NODE_ENV === 'production') return
  // We don't have the stored player.titles here — that comes from the parent.
  // The page.tsx wiring (Task 11) will pass `storedTitlesCount` as a prop;
  // for now this hook does nothing. The warning is added in Task 11.
}, [yearTitles.length])
```

- [ ] **Step 3: Insert the TitlesCallout and tournaments list in JSX**

The existing render returns (simplified):

```tsx
return (
  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
    {yearSelector}
    <Widget wide label={t('seasonLabel', { year: selectedYear })}> ... summary ... </Widget>
    <Widget wide label={t('monthlyPerformance')}> ... bars ... </Widget>
  </div>
)
```

Modify it to:

```tsx
return (
  <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
    {yearSelector}
    <TitlesCallout year={selectedYear} titles={yearTitles} />
    <Widget wide label={t('seasonLabel', { year: selectedYear })}>
      {/* ... existing summary content unchanged ... */}
    </Widget>
    <Widget wide label={t('monthlyPerformance')}>
      {/* ... existing bars unchanged ... */}
    </Widget>

    {seasonTournaments.length > 0 && (
      <>
        <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, padding: '4px 0 0' }}>
          {t('seasonTournamentsCount', { count: seasonTournaments.length })}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {seasonTournaments.map(ts => (
            <TournamentRow
              key={ts.tournament.id}
              tournamentId={ts.tournament.id}
              tournamentName={ts.tournament.name}
              tournamentLevel={ts.tournament.level}
              round={ts.bestRound}
              trailing={`${ts.matchCount}p · ${ts.wins}-${ts.losses}`}
              showTrophy={ts.isTitle}
              dateText={ts.latestMatchAt ? format.dateTime(new Date(ts.latestMatchAt), { month: 'short', year: 'numeric' }) : undefined}
            />
          ))}
        </div>
      </>
    )}
  </div>
)
```

Note `trailing` uses `Np` as a compact "N partidas". If the user prefers full localized "N partidas · W-L", change to `t('seasonTournamentsCount', ...) + ' · ' + wins-losses`. The compact form keeps the row tight on mobile.

- [ ] **Step 4: Manually verify in browser**

Reload `/player/<id>` and open Season tab on a player who has a title this year (e.g. one who won a 2026 event).
Expected:
- Gold call-out appears above the summary, naming the title and partner
- Tournaments list appears below the monthly bars, sorted date-desc
- Title-winning row shows trophy on the right
- Year chip click swaps both the call-out and the list

If player has no title in selected year: call-out is hidden, list still shows.
If player has 0 tournaments in selected year: the list section is hidden (already true via `seasonTournaments.length > 0` guard).

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/player/[id]/SeasonTab.tsx
git commit -m "feat(player): season tab — add titles call-out and tournament list"
```

---

### Task 10: Build `EarningsTab` component

**Files:**
- Create: `src/app/[locale]/player/[id]/EarningsTab.tsx`

- [ ] **Step 1: Write the component**

```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useFormatter, useTranslations } from 'next-intl'
import { createBrowserSupabaseClient } from '@/lib/supabase'
import { TournamentRow } from './TournamentRow'
import type { TournamentRoundCode } from './TournamentRow'

const GREEN = '#7ED321'
const ORANGE = '#F5A623'
const BG_CARD = '#141414'
const BG_CARD2 = '#0F0F0F'
const MUTED = '#6B7280'

interface EarningRow {
  id: string
  per_player_eur: number
  round_eliminated: TournamentRoundCode | 'R64'
  earned_at: string
  category: string
  tournaments: {
    id: string
    name: string
    level: string | null
    country: string | null
    starts_at: string | null
    ends_at: string | null
  } | null
}

interface Props {
  playerId: string
  /** Initial year to filter by; 'all' shows everything. */
  initialYear: number | 'all'
  /** Called when the year chip changes, so the parent can sync to URL. */
  onYearChange: (year: number | 'all') => void
}

export function EarningsTab({ playerId, initialYear, onYearChange }: Props) {
  const t = useTranslations('player')
  const format = useFormatter()
  const [rows, setRows] = useState<EarningRow[] | null>(null)
  const [year, setYear] = useState<number | 'all'>(initialYear)

  useEffect(() => { setYear(initialYear) }, [initialYear])

  useEffect(() => {
    const supabase = createBrowserSupabaseClient()
    let cancelled = false
    void (async () => {
      const { data, error } = await supabase
        .from('player_tournament_earnings')
        .select(`
          id, per_player_eur, round_eliminated, earned_at, category,
          tournaments (id, name, level, country, starts_at, ends_at)
        `)
        .eq('player_id', playerId)
        .order('earned_at', { ascending: false })
      if (cancelled) return
      if (error) {
        console.error('[EarningsTab] load error:', error)
        setRows([])
        return
      }
      setRows((data ?? []) as unknown as EarningRow[])
    })()
    return () => { cancelled = true }
  }, [playerId])

  const availableYears = useMemo(() => {
    if (!rows) return []
    const ys = new Set<number>()
    for (const r of rows) {
      const y = new Date(r.earned_at).getUTCFullYear()
      if (Number.isFinite(y)) ys.add(y)
    }
    return Array.from(ys).sort((a, b) => b - a)
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    if (year === 'all') return rows
    return rows.filter(r => new Date(r.earned_at).getUTCFullYear() === year)
  }, [rows, year])

  const ytdEur = useMemo(() => {
    if (!rows) return 0
    const thisYear = new Date().getUTCFullYear()
    return rows
      .filter(r => new Date(r.earned_at).getUTCFullYear() === thisYear)
      .reduce((sum, r) => sum + r.per_player_eur, 0)
  }, [rows])

  const careerEur = useMemo(() => {
    if (!rows) return 0
    return rows.reduce((sum, r) => sum + r.per_player_eur, 0)
  }, [rows])

  const ytdCount = useMemo(() => {
    if (!rows) return 0
    const thisYear = new Date().getUTCFullYear()
    return rows.filter(r => new Date(r.earned_at).getUTCFullYear() === thisYear).length
  }, [rows])

  const handleYear = (next: number | 'all') => {
    setYear(next)
    onYearChange(next)
  }

  if (rows === null) {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ height: 80, background: BG_CARD, marginBottom: 10 }} />
        {[0, 1, 2, 3].map(i => (
          <div key={i} style={{ height: 44, background: BG_CARD2, marginBottom: 6 }} />
        ))}
      </div>
    )
  }

  const cardStyle: React.CSSProperties = {
    background: BG_CARD,
    padding: 12,
    clipPath: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
    flex: 1,
  }
  const lblStyle: React.CSSProperties = {
    fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700,
  }

  const ybtnStyle = (active: boolean): React.CSSProperties => ({
    padding: '6px 12px',
    fontSize: 11,
    fontWeight: 700,
    background: active ? GREEN : BG_CARD,
    color: active ? '#000' : '#fff',
    border: 'none',
    cursor: 'pointer',
    clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  })

  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={cardStyle}>
          <div style={lblStyle}>{t('ytdEarningsCard', { year: new Date().getUTCFullYear() })}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#fff', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {format.number(ytdEur, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 4 }}>
            {t('earningsEventsCount', { count: ytdCount })}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={lblStyle}>{t('careerEarningsCard')}</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
            {format.number(careerEur, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
          </div>
          <div style={{ fontSize: 9, color: MUTED, marginTop: 4 }}>
            {t('earningsSinceLabel', { year: 2024 })}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        <button style={ybtnStyle(year === 'all')} onClick={() => handleYear('all')}>
          {t('earningsAllYears')}
        </button>
        {availableYears.map(y => (
          <button key={y} style={ybtnStyle(year === y)} onClick={() => handleYear(y)}>
            {y}
          </button>
        ))}
      </div>

      <div style={{ fontSize: 9, color: ORANGE, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, padding: '4px 0 0' }}>
        {t('earningsTournamentsCount', { count: filtered.length })}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '32px 12px', textAlign: 'center', color: MUTED, fontSize: 12 }}>
          {year === 'all' ? '—' : t('noEarningsForYear', { year })}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(r => {
            const round: TournamentRoundCode = r.round_eliminated === 'F'
              ? 'W' // earnings table semantic: F = won the tournament
              : (r.round_eliminated === 'R64' ? 'R32' : r.round_eliminated)
            const dateText = format.dateTime(new Date(r.earned_at), { month: 'short', year: 'numeric' })
            const amount = format.number(r.per_player_eur, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
            return (
              <TournamentRow
                key={r.id}
                tournamentId={r.tournaments?.id ?? ''}
                tournamentName={r.tournaments?.name ?? '—'}
                tournamentLevel={r.tournaments?.level ?? null}
                round={round}
                trailing={amount}
                dateText={dateText}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
```

**Note on `round_eliminated = 'F'` semantic flip:** The earnings table's `'F'` means "won the tournament" (per the schema comment in `20260504000001_player_tournament_earnings.sql`), whereas the matches table's `round = 'F'` means "the final match itself". We map `'F' → 'W'` in this component so the round pill displays as VENCEDOR / WINNER, not FINAL.

R64 is mapped to R32 for the pill since `TournamentRow`'s round-pill labels include R64 — actually, double-check: `TournamentRow` already accepts R64 in its type (we added it). Use R64 directly. Remove the `r.round_eliminated === 'R64' ? 'R32' : ...` line and pass R64 through.

Update the relevant line in the component:
```ts
const round: TournamentRoundCode = r.round_eliminated === 'F' ? 'W' : r.round_eliminated
```

- [ ] **Step 2: Verify the supabase import path matches your codebase**

Check that `@/lib/supabase` exports `createBrowserSupabaseClient`. If the name differs (e.g. `createClient`, `getSupabaseBrowserClient`), adjust the import. Grep:

```bash
grep -nE "^export (const|function) (create|get).*Supabase" src/lib/supabase.ts
```

Use whatever the export name is.

- [ ] **Step 3: Commit (component only — page wiring next task)**

```bash
git add src/app/[locale]/player/[id]/EarningsTab.tsx
git commit -m "feat(player): add EarningsTab component with year filter"
```

---

### Task 11: Wire `Ganhos` tab into the player page

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`
- Modify: `src/app/[locale]/player/[id]/types.ts` (extend `PageTab`)

- [ ] **Step 1: Extend `PageTab` type**

In `types.ts`:

```ts
export type PageTab = 'overview' | 'season' | 'partners' | 'matches' | 'stats' | 'earnings'
```

- [ ] **Step 2: Add the conditional tab button to the tab nav**

In `page.tsx`, locate the `tabs` array used by the tab nav (around the existing `setActiveTab` calls). Add a sixth entry conditionally:

```ts
const tHasEarnings = earnings != null && earnings.allTimeEur > 0
const tabs: Array<{ id: PageTab; label: string; isNew?: boolean }> = [
  { id: 'overview',  label: tPlayer('overviewTab')  },
  { id: 'season',    label: tPlayer('seasonTab')    },
  { id: 'partners',  label: tPlayer('partnersTab')  },
  { id: 'matches',   label: tPlayer('matchesTab')   },
  { id: 'stats',     label: tPlayer('statsTab')     },
  ...(tHasEarnings ? [{ id: 'earnings' as const, label: tPlayer('earningsTab'), isNew: shouldShowNewPill() }] : []),
]
```

The existing `.map(t => ...)` over `tabs` becomes:

```tsx
{tabs.map(tab => (
  <button
    key={tab.id}
    onClick={() => setActiveTab(tab.id)}
    style={{ /* existing button style */ }}
  >
    {tab.label}
    {tab.isNew && (
      <span
        style={{
          background: ORANGE,
          color: '#000',
          fontSize: 7,
          fontWeight: 800,
          padding: '1px 4px',
          borderRadius: 2,
          marginLeft: 4,
          verticalAlign: 'top',
        }}
      >
        {tPlayer('earningsTabNewPill')}
      </span>
    )}
  </button>
))}
```

- [ ] **Step 3: Add the `shouldShowNewPill` helper near the top of `page.tsx`**

```ts
const NEW_PILL_STORAGE_KEY = 'ganhos_tab_new_until'
const NEW_PILL_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

function shouldShowNewPill(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const raw = window.localStorage.getItem(NEW_PILL_STORAGE_KEY)
    if (!raw) {
      const until = Date.now() + NEW_PILL_TTL_MS
      window.localStorage.setItem(NEW_PILL_STORAGE_KEY, String(until))
      return true
    }
    const until = Number(raw)
    return Number.isFinite(until) && Date.now() < until
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Render the EarningsTab body**

Below the existing `{activeTab === 'stats' && ...}` block:

```tsx
{activeTab === 'earnings' && tHasEarnings && (
  <EarningsTab
    playerId={id}
    initialYear={selectedYear ?? 'all'}
    onYearChange={(y) => setSelectedYear(y === 'all' ? null : y)}
  />
)}
```

Add the import at the top of `page.tsx`:

```ts
import { EarningsTab } from './EarningsTab'
```

- [ ] **Step 5: Fall-through guard**

If `activeTab === 'earnings'` but `!tHasEarnings` (e.g. user landed via URL on a player with zero earnings), reset to overview:

Inside the existing `useState`/init logic for `activeTab`:

```ts
useEffect(() => {
  if (activeTab === 'earnings' && !tHasEarnings) {
    setActiveTab('overview')
  }
}, [activeTab, tHasEarnings])
```

- [ ] **Step 6: Manually verify**

Reload `/player/<id-with-earnings>`.
Expected:
- Tab nav shows 6 tabs: Overview · Season · Partners · Matches · Stats · Ganhos (with orange NEW pill first time)
- Click Ganhos → list renders, YTD + Career cards on top, year chips below
- Refresh → NEW pill still there (within 30 days)
- Open browser devtools, set `localStorage.setItem('ganhos_tab_new_until', '0')`, refresh → NEW pill gone

For a player with zero earnings:
- Tab nav shows only 5 tabs (no Ganhos)
- Visit `?tab=earnings` in URL → falls through to Overview (we wire URL state in Task 13; for now, manually setting `activeTab` to `'earnings'` via React DevTools should fall through)

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/player/[id]/page.tsx src/app/[locale]/player/[id]/types.ts
git commit -m "feat(player): add Ganhos tab to nav with conditional visibility and NEW pill"
```

---

### Task 12: Add titles-count reconciliation warning (dev-only)

**Files:**
- Modify: `src/app/[locale]/player/[id]/SeasonTab.tsx`

The spec calls for a dev-only console warning when `players.titles` (stored integer) doesn't match the derived titles count. We deferred this in Task 9 because the page didn't yet pass `storedTitlesCount`. Wire it now.

- [ ] **Step 1: Extend `SeasonTab` props**

```ts
interface SeasonTabProps {
  derived: DerivedData
  playerId: string
  selectedYear: number
  onYearChange: (year: number) => void
  /** From players.titles — used only for dev-mode mismatch warning. */
  storedTitlesTotal?: number | null
}
```

- [ ] **Step 2: Add the warning effect**

```ts
useEffect(() => {
  if (process.env.NODE_ENV === 'production') return
  if (storedTitlesTotal == null) return
  // Compare all-time derived count (not just selected year) against stored.
  const derivedAllTime = deriveTitles(derived.finished, playerId).length
  if (derivedAllTime !== storedTitlesTotal) {
    // eslint-disable-next-line no-console
    console.warn(
      `[player-titles] Mismatch for player ${playerId}: stored=${storedTitlesTotal}, derived=${derivedAllTime}`,
    )
  }
}, [derived.finished, playerId, storedTitlesTotal])
```

- [ ] **Step 3: Pass `storedTitlesTotal` from `page.tsx`**

In the JSX:

```tsx
{activeTab === 'season' && (
  <SeasonTab
    derived={derived}
    playerId={id}
    selectedYear={selectedYear ?? derived.availableYears[0] ?? new Date().getFullYear()}
    onYearChange={setSelectedYear}
    storedTitlesTotal={player.titles ?? null}
  />
)}
```

- [ ] **Step 4: Verify**

Reload `/player/<id>` in dev mode and open the Season tab. Open the browser console. If derived count differs from stored, you'll see the warning. If they match, no log. Either is correct — we're just adding the diagnostic.

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/player/[id]/SeasonTab.tsx src/app/[locale]/player/[id]/page.tsx
git commit -m "chore(player): dev-only console warning for stored vs derived titles count"
```

---

### Task 13: URL state sync for `?tab=` and `?year=` + Hero/Overview click wiring

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`

This task does three things together because they share the same `useSearchParams` / `router.replace` plumbing:
- URL-sync `activeTab` to `?tab=`
- URL-sync `selectedYear` to `?year=` (used by both Season and Earnings tabs)
- Wire the four click targets: Hero `Títulos` chip, Overview `Ganhos YTD` card, Overview `Ganhos Totais` card. (Pts FIP chip + rank pill are wired in Task 15 — they navigate away.)

- [ ] **Step 1: Read tab + year from URL at mount**

Near the top of the component (in `page.tsx`):

```ts
import { useSearchParams } from 'next/navigation'

// ... inside the component ...
const searchParams = useSearchParams()
const initialTab = (searchParams.get('tab') as PageTab | null) ?? 'overview'
const initialYearParam = searchParams.get('year')
const initialYear =
  initialYearParam === 'all' ? null
  : initialYearParam && /^\d{4}$/.test(initialYearParam) ? Number(initialYearParam)
  : null

const [activeTab, setActiveTab] = useState<PageTab>(initialTab)
const [selectedYear, setSelectedYear] = useState<number | null>(initialYear)
```

- [ ] **Step 2: Sync state changes back to URL**

```ts
const router = useRouter()
// (router is already in scope from existing code)

useEffect(() => {
  const sp = new URLSearchParams(window.location.search)
  if (activeTab === 'overview') {
    sp.delete('tab')
  } else {
    sp.set('tab', activeTab)
  }
  if (selectedYear == null) {
    sp.delete('year')
  } else {
    sp.set('year', String(selectedYear))
  }
  const qs = sp.toString()
  const next = qs ? `?${qs}` : window.location.pathname
  router.replace(next, { scroll: false })
}, [activeTab, selectedYear, router])
```

- [ ] **Step 3: Make hero `Títulos` chip clickable**

Find the Hero stat-chips loop (around `page.tsx:751`). Each chip is rendered like:

```tsx
heroStats.slice(0, 4).map(s => (
  <div key={s.label} style={{ ... }}>...</div>
))
```

Change it so chips opt into click behavior. First, extend `heroStats` entries to optionally carry a click handler:

```ts
type HeroStat = {
  label: string
  value: string
  accent?: 'orange' | 'green' | 'white'
  onClick?: () => void
  ariaLabel?: string
}

const heroStats: HeroStat[] = [
  // existing entries unchanged
  // for the titles entry, add:
  ...(player.titles > 0 ? [{
    label: tPlayer('titlesShort'), // existing label key
    value: String(player.titles),
    accent: 'orange' as const,
    onClick: () => setActiveTab('season'),
    ariaLabel: tPlayer('viewTitlesInSeason'),
  }] : []),
  // ...
]
```

(Use the existing label keys, just add `onClick`. If the current `heroStats` array is built inline, refactor it to a `const` first.)

Render with cursor + chevron when `onClick` present:

```tsx
{heroStats.slice(0, 4).map(s => {
  const clickable = s.onClick != null
  const Tag = clickable ? 'button' : 'div'
  return (
    <Tag
      key={s.label}
      onClick={s.onClick}
      aria-label={s.ariaLabel}
      style={{
        flex: 1, background: BG_CARD, padding: '9px 6px', textAlign: 'center',
        clipPath: 'polygon(0% 3%, 99% 0%, 100% 97%, 1% 100%)',
        border: 'none', cursor: clickable ? 'pointer' : 'default',
        position: 'relative',
        boxShadow: clickable ? 'inset 0 0 0 1.5px rgba(245,166,35,0.4)' : undefined,
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        fontSize: 16, fontWeight: 800, lineHeight: 1,
        color: s.accent === 'orange' ? ORANGE : s.accent === 'green' ? GREEN : '#fff',
        fontVariantNumeric: 'tabular-nums',
      }}>{s.value}</div>
      <div style={{ fontSize: 8, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4 }}>
        {s.label}
      </div>
      {clickable && (
        <span style={{
          position: 'absolute', top: 3, right: 5,
          width: 5, height: 5,
          borderTop: '1.5px solid ' + ORANGE,
          borderRight: '1.5px solid ' + ORANGE,
          transform: 'rotate(45deg)',
          opacity: 0.7,
        }} />
      )}
    </Tag>
  )
})}
```

- [ ] **Step 4: Make Overview earnings cards clickable**

In `OverviewTab`, find the two `<Widget label={t('ytdEarnings')}>` and `<Widget label={t('allTimeEarnings')}>` blocks. Wrap each `<Widget>` in a clickable element:

```tsx
<div
  role="button"
  tabIndex={0}
  onClick={() => setActiveTab('earnings')}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setActiveTab('earnings') }}
  style={{ cursor: 'pointer' }}
>
  <Widget label={t('ytdEarnings')}>
    {/* existing children */}
  </Widget>
</div>
```

`OverviewTab` already receives `setActiveTab` as a prop ([page.tsx:806](src/app/[locale]/player/[id]/page.tsx#L806)), so no plumbing needed.

For the Total card, additionally set the year to 'all' on click:

```tsx
onClick={() => {
  setSelectedYear(null) // 'all'
  setActiveTab('earnings')
}}
```

For the YTD card, set the year to current year:

```tsx
onClick={() => {
  setSelectedYear(new Date().getUTCFullYear())
  setActiveTab('earnings')
}}
```

(`setSelectedYear` must be passed through to `OverviewTab` if it isn't already — check the existing prop list and add it.)

- [ ] **Step 5: Add subtle visual cue to the Overview earnings widgets**

To match the hero-chip clickable affordance — orange inset stroke + a small chevron in the top-right corner of the widget. Inside the `OverviewTab` rendering of each earnings widget, add the inset shadow via inline style override on the wrapping div, and a `position: relative` + corner chevron similar to step 3.

- [ ] **Step 6: Manually verify**

Reload `/player/<id-with-earnings-and-title>`:
- URL: `http://localhost:3002/player/<id>` (no params)
- Click `Títulos` hero chip → URL becomes `?tab=season`, Season tab opens, titles call-out visible
- Click `Ganhos YTD` Overview card → URL becomes `?tab=earnings&year=2026`, Earnings tab opens with current year selected
- Click `Ganhos Totais` Overview card → URL becomes `?tab=earnings`, Earnings tab opens with "Tudo" selected
- Click browser back → returns to Overview
- Refresh on `?tab=earnings&year=2025` → lands directly on Earnings tab with 2025 chip active
- Visit `?tab=earnings` on a player with zero earnings → silently falls through to Overview

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/player/[id]/page.tsx
git commit -m "feat(player): URL-sync tab + year, wire hero Títulos and Overview earnings clicks"
```

---

### Task 14: Rankings page — promote gender + type to URL state

Pure refactor — no new feature yet, just URL-backed state so the deep-link in Task 15 has somewhere to land. This is a separate commit because if anything breaks, we can revert without losing the deep-link work.

**Files:**
- Modify: `src/app/[locale]/(app)/rankings/page.tsx`

- [ ] **Step 1: Read initial state from URL**

At the top of the component:

```ts
import { useSearchParams, useRouter } from 'next/navigation'

// ... inside ...
const searchParams = useSearchParams()
const router = useRouter()

const initialGender: Gender =
  searchParams.get('gender') === 'women' ? 'women' : 'men'
const initialType: RankType =
  searchParams.get('type') === 'race' ? 'race' : 'official'

const [gender, setGender] = useState<Gender>(initialGender)
const [rankType, setRankType] = useState<RankType>(initialType)
```

- [ ] **Step 2: Sync state changes to URL**

```ts
useEffect(() => {
  const sp = new URLSearchParams(window.location.search)
  if (gender === 'men') sp.delete('gender'); else sp.set('gender', gender)
  if (rankType === 'official') sp.delete('type'); else sp.set('type', rankType)
  const qs = sp.toString()
  router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false })
}, [gender, rankType, router])
```

- [ ] **Step 3: Verify**

Reload `/rankings`.
Expected: URL is clean (no params on default men/official).
Click women toggle: URL becomes `/rankings?gender=women`.
Click race toggle: URL becomes `/rankings?gender=women&type=race`.
Click back button: returns through each state. Refresh on any URL → restores that state.

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/\(app\)/rankings/page.tsx
git commit -m "refactor(rankings): URL-sync gender and rank type"
```

---

### Task 15: Rankings page — implement `?highlight=` deep-link

**Files:**
- Modify: `src/app/[locale]/(app)/rankings/page.tsx`

- [ ] **Step 1: Read the highlight param**

```ts
const highlight = searchParams.get('highlight')
```

- [ ] **Step 2: Find the target row's index after load resolves**

The component's existing data flow loads `players` via `load(rankType, gender)`. After `players` updates, we need to find the target. Add:

```ts
const [visibleCount, setVisibleCount] = useState(50)
// (this likely already exists — confirm name; if it's named differently, use the existing name)

const [pulseId, setPulseId] = useState<string | null>(null)
const [highlightHandled, setHighlightHandled] = useState(false)

useEffect(() => {
  if (!highlight || highlightHandled || players.length === 0) return
  const idx = players.findIndex(p => p.id === highlight)
  if (idx === -1) {
    // Player not in current gender's list. Try fetching them to check their actual category.
    void (async () => {
      const { data } = await supabase
        .from('players')
        .select('id, name, category, ranking, race_ranking')
        .eq('id', highlight)
        .single()
      if (data) {
        const correctGender: Gender = data.category === 'women' ? 'women' : 'men'
        const correctRank = rankType === 'official' ? data.ranking : data.race_ranking
        if (correctGender !== gender) {
          setGender(correctGender) // triggers reload via URL effect
          return // come back on next mount
        }
        if (correctRank == null || correctRank > 1000) {
          // Show a non-blocking toast via console (replace with real toast UI if available)
          console.warn(`[rankings] ${data.name} not in top 1000`)
          setHighlightHandled(true)
        }
      } else {
        setHighlightHandled(true)
      }
    })()
    return
  }
  // Player is in the loaded list — render enough rows then scroll.
  setVisibleCount(v => Math.max(v, idx + 25))
  setHighlightHandled(true)
  // Scroll happens in the next effect, after DOM updates.
  setTimeout(() => {
    const row = document.querySelector<HTMLElement>(`[data-player-id="${highlight}"]`)
    if (row) {
      row.scrollIntoView({ block: 'center', behavior: 'smooth' })
      setPulseId(highlight)
      // Clear highlight from URL so refresh/back doesn't re-trigger.
      const sp = new URLSearchParams(window.location.search)
      sp.delete('highlight')
      const qs = sp.toString()
      router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false })
      // End the pulse after 2 seconds.
      setTimeout(() => setPulseId(null), 2000)
    }
  }, 50)
}, [highlight, highlightHandled, players, gender, rankType, router])
```

- [ ] **Step 3: Apply the `data-player-id` attribute on each row**

Find the existing row render (around line 536). Where the row's root element is, add:

```tsx
<div
  data-player-id={player.id}
  style={{
    ...existingStyle,
    ...(pulseId === player.id ? {
      outline: '2px solid #F5A623',
      boxShadow: '0 0 16px rgba(245,166,35,0.4)',
      transition: 'outline 1.5s ease-out, box-shadow 1.5s ease-out',
    } : {}),
  }}
>
```

When `pulseId` is cleared (after 2s), the outline and shadow CSS transition away over 1.5s — feel free to tune the timing.

- [ ] **Step 4: Honor `prefers-reduced-motion`**

Skip the smooth-scroll behavior when set:

```ts
const reduceMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
row.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
```

For the pulse, when `reduceMotion` is true, just apply the outline statically with no transition.

- [ ] **Step 5: Manually verify**

In a separate browser tab:
- Visit `/rankings?highlight=<some-player-uuid>` for a player in top 50 → page loads, scrolls to them, brief orange pulse, URL cleans up (no `highlight=` param)
- Visit `/rankings?highlight=<player-at-rank-327>` → loads enough rows, scrolls them to middle of viewport, pulses
- Visit `/rankings?gender=men&highlight=<a-women-player>` → URL gender flips to women, page reloads and highlights
- Visit `/rankings?highlight=<player-not-in-top-1000>` → console warns, no scroll
- Refresh on `/rankings?highlight=<id>` (after the cleanup) → URL already lacks highlight, no scroll triggered

- [ ] **Step 6: Commit**

```bash
git add src/app/[locale]/\(app\)/rankings/page.tsx
git commit -m "feat(rankings): deep-link ?highlight= with scroll-to and pulse"
```

---

### Task 16: Wire `Pts FIP` chip and `#14 World` pill → rankings deep-link

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`

- [ ] **Step 1: Add a click handler to the rank pill**

Find the rank pill at around `page.tsx:720-729`:

```tsx
{player.ranking != null && (
  <span style={{ ... }}>
    #{player.ranking} {player.category === 'women' ? 'Women' : player.category === 'men' ? 'World' : 'Ranked'}
  </span>
)}
```

Change to a clickable button:

```tsx
{player.ranking != null && (
  <button
    onClick={() => {
      const g = player.category === 'women' ? 'women' : 'men'
      router.push(`/rankings?gender=${g}&type=official&highlight=${player.id}`)
    }}
    aria-label={tPlayer('viewInRankings', { name: player.display_name?.trim() || player.name })}
    style={{
      display: 'inline-block',
      background: GREEN, color: '#000',
      fontSize: 9, fontWeight: 800, padding: '3px 9px',
      clipPath: 'polygon(4% 10%, 96% 0%, 100% 90%, 0% 100%)',
      marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5,
      border: 'none', cursor: 'pointer',
      fontFamily: 'inherit',
    }}
  >
    #{player.ranking} {player.category === 'women' ? 'Women' : player.category === 'men' ? 'World' : 'Ranked'}
  </button>
)}
```

- [ ] **Step 2: Wire the `Pts FIP` hero chip**

In the `heroStats` array assembly (modified in Task 13), find the FIP-points entry and add `onClick`:

```ts
...(player.points != null ? [{
  label: tPlayer('fipPointsShort'),
  value: format.number(player.points),
  accent: 'orange' as const,
  onClick: () => {
    const g = player.category === 'women' ? 'women' : 'men'
    router.push(`/rankings?gender=${g}&type=official&highlight=${player.id}`)
  },
  ariaLabel: tPlayer('viewInRankings', { name: player.display_name?.trim() || player.name }),
}] : []),
```

Since `heroStats` rendering already supports `onClick` (added in Task 13), no further changes needed.

- [ ] **Step 3: Manually verify**

Reload `/player/<id-of-a-ranked-player>`:
- Click `#14 World` pill → navigates to `/rankings?gender=men&type=official&highlight=<id>` → scrolls to player → pulses
- Click `Pts FIP` chip → same navigation
- Back button → returns to player page (URL preserved)

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/player/[id]/page.tsx
git commit -m "feat(player): wire rank pill and Pts FIP chip to rankings deep-link"
```

---

### Task 17: Manual QA pass and push

- [ ] **Step 1: Run the build**

Run: `npm run build`
Expected: builds successfully, no type errors.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: passes.

- [ ] **Step 3: Re-run all unit tests touched in this work**

Run: `npx vitest run src/lib/__tests__/derive-titles.test.ts src/lib/__tests__/derive-season-tournaments.test.ts`
Expected: all green.

- [ ] **Step 4: Smoke test the full feature in the browser**

Walk through every QA case from the spec's "Testing approach" section. In particular:

| Case | Expected |
|---|---|
| Player with 0 earnings | Tab nav shows 5 tabs, no Ganhos. Visiting `?tab=earnings` falls through. |
| Player with earnings only in 2024 | Year chips: `Tudo · 2024` only |
| Player who won a title not in `players.titles` | Dev-console warning printed; UI shows both numbers without complaint |
| Player ranked #327 | Pts FIP click loads list, scrolls them to middle, pulses |
| Player not in top 1000 | Pts FIP click shows console warning, no scroll |
| `?tab=earnings&year=2025` deep-link | Lands on Earnings tab, 2025 chip active |
| `?tab=earnings` on a player with zero earnings | Falls through to Overview |
| Rankings back button | Returns to player page on the originating tab |
| Mobile viewport (devtools 390×844) | 6 tabs scroll horizontally, NEW pill visible on initial state |
| Portuguese locale | All labels read correctly (`/pt/player/...`), round labels in Portuguese |

- [ ] **Step 5: Push the branch**

```bash
git push -u origin feat/clickable-player-datapoints
```

- [ ] **Step 6: Open a PR**

Use `gh pr create` per the PR-workflow preference. Body should reference the spec.

---

## Self-Review Notes

**Spec coverage check:**
- Hero `Títulos` chip click → Task 13 ✓
- Hero `Pts FIP` chip click → Task 16 ✓
- Hero `#14 World` rank pill click → Task 16 ✓
- Overview `Ganhos YTD` / `Ganhos Totais` card clicks → Task 13 ✓
- New `Ganhos` tab placement after Partidas → Task 11 ✓
- `Ganhos` tab visibility rule (hide when zero) → Task 11 ✓
- `NEW` pill with 30-day localStorage TTL → Task 11 ✓
- Two summary widgets (YTD + Career) → Task 10 ✓
- Year chips with `Tudo` → Task 10 ✓
- Section head `Torneios · N` → Task 10 ✓
- Tournament rows sorted date-desc, linking to `/tournaments/[id]` → Task 6 + 10 ✓
- Round pills (W/F/SF/QF/R16/R32/R64/Q1-3) → Task 1 i18n + Task 6 ✓
- Empty state for year chip with zero results → Task 10 ✓
- Earnings query with FK-disambiguated tournaments embed → Task 10 ✓ (plain embed works, only one FK)
- `round_eliminated = 'F'` semantic flip to 'W' → Task 10 ✓
- Temporada titles call-out → Task 7 + Task 9 ✓
- Temporada tournaments list with trophy → Task 9 ✓
- `deriveTitles` + `deriveSeasonTournaments` pure functions + tests → Tasks 3 + 4 ✓
- Titles count reconciliation (dev warning) → Task 12 ✓
- Rankings `?gender=` + `?type=` URL state → Task 14 ✓
- Rankings `?highlight=` + render-enough + scroll-into-view + pulse → Task 15 ✓
- `prefers-reduced-motion` honored → Task 15 ✓
- One-shot highlight (URL clean after scroll) → Task 15 ✓
- i18n keys in all 5 locales → Task 1 ✓
- File extraction (SeasonTab from page.tsx) → Task 8 ✓
- `resolveMatchRoles` extraction → Task 2 ✓
- Trophy SVG (no emoji) → Task 5 ✓

**Placeholder scan:** none found.

**Type consistency:**
- `MatchPlayer`, `MatchRowForRoles` defined in `match-roles.ts` (Task 2)
- `MatchRowForTitles` defined in `derive-titles.ts` (Task 3) — extends MatchRow shape; tests use it via direct import
- `TitleEntry` exported from `derive-titles.ts` (Task 3), consumed by `TitlesCallout` (Task 7)
- `TournamentSummary` and `BestRound` exported from `derive-season-tournaments.ts` (Task 4), consumed by SeasonTab (Task 9)
- `TournamentRoundCode` exported from `TournamentRow.tsx` (Task 6), consumed by `EarningsTab.tsx` (Task 10)
- `PageTab` extended in `types.ts` to include `'earnings'` (Task 11), used everywhere it was already used

All names consistent across tasks.
