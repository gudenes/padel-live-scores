# Road to Trophy — Plan B: public "Projection" tab + player card

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the precomputed `tournament_projections` data to padelnachos.com users as a "Projection" tab (2nd) on the tournament page — a vertical "road to the trophy" with per-round opponents, win %, champion odds, and a tap-to-expand drill-down — plus a "Road to trophy" card on the player profile that deep-links in.

**Architecture:** Pure view-model helpers (`projection-view.ts`) transform a `tournament_projections` row + a `playerId→Player` lookup (built from the page's `matches`) into a render model. A client hook (`useProjection`) reads the RLS-public table via the browser anon client. `ProjectionTab` renders the road/picker/drill-down/locked-waitlist states. The tournament page gates the tab behind `isPremierTier` + `NEXT_PUBLIC_PROJECTION_ENABLED` and wires `?tab=projection&pair=…`. A player-profile card fetches the player's row and deep-links in.

**Tech Stack:** Next.js 16 App Router (client components), React 19, TypeScript, Supabase browser anon client, next-intl (5 locales), vitest.

**Spec:** `docs/superpowers/specs/2026-06-06-road-to-trophy-projection-design.md`
**Depends on:** Plan A (`tournament_projections` table, populated). Already applied + populated in prod.

**Scope note:** Public UI only. The engine/worker/table/admin are Plan A (done). v2 spokes (Following rail, match-detail link) are out of scope.

---

## Key facts (verified against the worktree)

- **Browser client:** `import { supabase } from '@/lib/supabase'` — anon, reads RLS-public tables. `tournament_projections` has a public-read policy (Plan A).
- **Tier helper:** `import { isPremierTier } from '@/lib/tournament-tier'` → `isPremierTier(level): boolean`.
- **Tabs:** `src/app/[locale]/(app)/tournaments/[id]/page.tsx` — `pageTab` union (`'matches'|'overview'|'story'|'draw'`), tab array built at ~line 1113 with `tTournament(tab)` labels, `setPageTab` callback, `DRAW_TIERS`/`showDrawTab` pattern at lines 68-71/790-793, conditional render at ~1295, `genderFilter` state (`'men'|'women'`), `allMatches: Match[]`, `activeTournamentObj` (fields incl. `level`, `round_schedule`, `starts_at`), `searchParams.get('tab'|'pair')`.
- **SlidingInkTabs:** `tabs: {key,label}[]`, `activeKey`, `onChange`.
- **`Match`** (`src/types/match.ts`): `pair1_player1/2`, `pair2_player1/2` (each `Player|null` with `id,name,display_name?,country,avatar_url,ranking`), `pair1_seed?`, `round`, `winner_pair`, `category` (via `(m as any).category`).
- **Bookmarks:** `import { useFollowing } from '@/hooks/useFollowing'` → `getFollowed('player'): string[]`.
- **Avatar:** `import Avatar from '@/components/Avatar'` — `<Avatar src={url} alt={name} size={n} fallback={name?.[0]} unoptimized />`.
- **Flag:** `import { FlagImage } from '@/components/FlagImage'` — `<FlagImage country={code} size={n} />`.
- **Widget (player page):** `import { Widget } from './Widget'` — `<Widget label="…" wide?>…</Widget>`. Overview grid: `gridTemplateColumns:'1fr 1fr', gap:10`.
- **Player current tournament:** `pickCurrentTournamentMatch(matches, now)` from `@/lib/current-tournament-match`; result has `tournament.{id,level,name,starts_at,ends_at}`.
- **Nav:** `import { useRouter, Link } from '@/i18n/navigation'` (locale-aware).
- **Flag pattern:** `process.env.NEXT_PUBLIC_FIP_STREAMS_ENABLED === 'true'`.
- **Design tokens** (from `globals.css` / MatchCard): base `#1A1A1A`, card `rgba(255,255,255,0.03)`, text `#EEE4CE` / muted `#6B7280` / secondary `#9AAEC4`, live `#FF4655`, lime `#7ED321`, gold/orange `#F5A623`, chunky card clip `polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)`, badge clip `polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)`, monospace numerics.

## Row shape (from Plan A's `tournament_projections.rounds` JSONB)

```
rounds: Array<{
  round: 'R64'|'R32'|'R16'|'QF'|'SF'|'F'
  reach_prob: number
  expected_opponent_pair_key: string | null
  opponents: Array<{ pair_key: string; player_ids: string[]; names: string[]; reach_prob: number; win_prob: number }>
}>
```

---

## File structure

**Create:**
- `src/lib/projection-types.ts` — shared row + JSONB types (no logic).
- `src/lib/projection-view.ts` — pure view-model transforms.
- `src/lib/__tests__/projection-view.test.ts` — unit tests.
- `src/app/[locale]/(app)/tournaments/[id]/useProjection.ts` — client fetch hook.
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` — the tab UI.
- `src/app/[locale]/player/[id]/RoadToTrophyCard.tsx` — player-profile card (client).

**Modify:**
- `src/messages/{en,es,pt,it,fr}.json` — `tournament.projection` + `projectionTab.*`.
- `src/app/[locale]/(app)/tournaments/[id]/page.tsx` — gate + tab + URL param + render.
- `src/app/[locale]/player/[id]/page.tsx` — render the card in the Overview grid.

---

## Task 1: Projection types + pure view-model helpers

**Files:**
- Create: `src/lib/projection-types.ts`, `src/lib/projection-view.ts`
- Test: `src/lib/__tests__/projection-view.test.ts`

- [ ] **Step 1: Create the types**

`src/lib/projection-types.ts`:

```ts
// Shape of public.tournament_projections rows (read-only on the public app).
// Written by padelgod's tournament-projection-snapshot (see Plan A).
export type ProjRound = 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'

export interface ProjectionOpponentJson {
  pair_key: string
  player_ids: string[]
  names: string[]
  reach_prob: number
  win_prob: number
}

export interface ProjectionRoundJson {
  round: ProjRound
  reach_prob: number
  expected_opponent_pair_key: string | null
  opponents: ProjectionOpponentJson[]
}

export interface ProjectionRow {
  tournament_id: string
  category: 'men' | 'women'
  pair_key: string
  pair_player_ids: string[]
  tournament_level: string | null
  champion_prob: number
  finalist_prob: number
  semifinal_prob: number
  rounds: ProjectionRoundJson[]
  computed_at: string
}
```

- [ ] **Step 2: Write the failing test**

`src/lib/__tests__/projection-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Match, Player } from '@/types/match'
import type { ProjectionRow } from '@/lib/projection-types'
import {
  buildPlayerLookup,
  pickDefaultProjectionPair,
  roundDisoFor,
  buildRoadVM,
  ROUND_LABEL_KEY,
} from '@/lib/projection-view'

function player(id: string, name: string, country = 'ES', avatar = `http://x/${id}.png`): Player {
  return { id, external_id: id, name, country, avatar_url: avatar, ranking: 1 }
}
function match(p: (Player | null)[]): Match {
  return {
    id: `m-${p.map(x => x?.id).join('')}`, external_id: 'e', status: 'scheduled', coverage: null,
    pusher_channel: null, round: 'SF', court: null, scheduled_at: null, started_at: null,
    finished_at: null, winner_pair: null,
    pair1_player1: p[0] ?? null, pair1_player2: p[1] ?? null,
    pair2_player1: p[2] ?? null, pair2_player2: p[3] ?? null,
  } as Match
}

const A = player('a', 'Galan'); const B = player('b', 'Chingotto')
const C = player('c', 'Coello'); const D = player('d', 'Tapia')

describe('buildPlayerLookup', () => {
  it('indexes every non-null player from matches by id', () => {
    const map = buildPlayerLookup([match([A, B, C, D])])
    expect(map.get('a')?.name).toBe('Galan')
    expect(map.get('d')?.country).toBe('ES')
    expect(map.size).toBe(4)
  })
})

describe('roundDisoFor', () => {
  it('maps a round code to the matching round_schedule key', () => {
    const sched = { r16: '2026-06-06', qf: '2026-06-08', sf: '2026-06-09', f: '2026-06-10' }
    expect(roundDisoFor('QF', sched)).toBe('2026-06-08')
    expect(roundDisoFor('F', sched)).toBe('2026-06-10')
    expect(roundDisoFor('SF', null)).toBeNull()
    expect(roundDisoFor('QF', { sf: 'x' })).toBeNull()
  })
})

describe('ROUND_LABEL_KEY', () => {
  it('maps every round code to an i18n key', () => {
    expect(ROUND_LABEL_KEY.QF).toBe('roundQF')
    expect(ROUND_LABEL_KEY.F).toBe('roundF')
  })
})

describe('pickDefaultProjectionPair', () => {
  const rows = [
    { pair_key: 'a::b', pair_player_ids: ['a', 'b'], champion_prob: 0.2 },
    { pair_key: 'c::d', pair_player_ids: ['c', 'd'], champion_prob: 0.5 },
  ] as ProjectionRow[]

  it('prefers a pair containing a bookmarked player', () => {
    expect(pickDefaultProjectionPair(rows, ['a'])).toBe('a::b')
  })
  it('falls back to the highest champion_prob pair', () => {
    expect(pickDefaultProjectionPair(rows, [])).toBe('c::d')
  })
  it('returns null for no rows', () => {
    expect(pickDefaultProjectionPair([], ['a'])).toBeNull()
  })
})

describe('buildRoadVM', () => {
  const row: ProjectionRow = {
    tournament_id: 't', category: 'men', pair_key: 'a::b', pair_player_ids: ['a', 'b'],
    tournament_level: 'p1', champion_prob: 0.22, finalist_prob: 0.4, semifinal_prob: 0.7,
    computed_at: 'now',
    rounds: [
      { round: 'SF', reach_prob: 1, expected_opponent_pair_key: 'c::d',
        opponents: [{ pair_key: 'c::d', player_ids: ['c', 'd'], names: ['Coello', 'Tapia'], reach_prob: 0.6, win_prob: 0.55 }] },
      { round: 'F', reach_prob: 0.5, expected_opponent_pair_key: null, opponents: [] },
    ],
  }
  const lookup = buildPlayerLookup([match([A, B, C, D])])
  const sched = { sf: '2026-06-09', f: '2026-06-10' }

  it('produces a VM with resolved players, dates, expected opponent', () => {
    const vm = buildRoadVM(row, lookup, sched)
    expect(vm.championProb).toBe(0.22)
    expect(vm.players.map(p => p.name)).toEqual(['Galan', 'Chingotto'])
    const sf = vm.rounds[0]
    expect(sf.round).toBe('SF')
    expect(sf.dateIso).toBe('2026-06-09')
    expect(sf.expected?.players.map(p => p.name)).toEqual(['Coello', 'Tapia'])
    expect(sf.expected?.winProb).toBe(0.55)
    expect(sf.expected?.faceProb).toBe(0.6)
    // Final has no opponents → expected is null (bye/unknown).
    expect(vm.rounds[1].expected).toBeNull()
  })

  it('resolves opponent avatars/countries from the lookup, falling back to JSON names', () => {
    const vm = buildRoadVM(row, lookup, sched)
    const opp = vm.rounds[0].expected!
    expect(opp.players[0].avatarUrl).toBe('http://x/c.png')
    expect(opp.players[0].country).toBe('ES')
    // unknown id → falls back to the JSON name, null avatar
    const row2 = { ...row, rounds: [{ ...row.rounds[0], opponents: [{ pair_key: 'z::y', player_ids: ['z', 'y'], names: ['Zed', 'Yan'], reach_prob: 0.3, win_prob: 0.4 }], expected_opponent_pair_key: 'z::y' }] }
    const vm2 = buildRoadVM(row2 as ProjectionRow, lookup, sched)
    expect(vm2.rounds[0].expected?.players[0].name).toBe('Zed')
    expect(vm2.rounds[0].expected?.players[0].avatarUrl).toBeNull()
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/__tests__/projection-view.test.ts`
Expected: FAIL — `@/lib/projection-view` not found.

- [ ] **Step 4: Implement the view helpers**

`src/lib/projection-view.ts`:

```ts
import type { Match, Player } from '@/types/match'
import type { ProjectionRow, ProjectionRoundJson, ProjRound } from '@/lib/projection-types'

export interface RoadPlayerVM {
  id: string
  name: string
  country: string | null
  avatarUrl: string | null
}

export interface RoadOpponentVM {
  pairKey: string
  players: RoadPlayerVM[]
  faceProb: number   // P(face this opponent at this round)
  winProb: number    // P(win | meet)
}

export interface RoadRoundVM {
  round: ProjRound
  dateIso: string | null
  reachProb: number
  expected: RoadOpponentVM | null
  opponents: RoadOpponentVM[]   // all candidates (for drill-down), sorted by faceProb desc
}

export interface RoadVM {
  pairKey: string
  players: RoadPlayerVM[]
  championProb: number
  finalistProb: number
  semifinalProb: number
  rounds: RoadRoundVM[]
}

/** i18n key per round code (defined in messages projectionTab.*). */
export const ROUND_LABEL_KEY: Record<ProjRound, string> = {
  R64: 'roundR64', R32: 'roundR32', R16: 'roundR16', QF: 'roundQF', SF: 'roundSF', F: 'roundF',
}

/** Build a playerId → Player lookup from the page's matches (for photos/flags). */
export function buildPlayerLookup(matches: Match[]): Map<string, Player> {
  const map = new Map<string, Player>()
  for (const m of matches) {
    for (const p of [m.pair1_player1, m.pair1_player2, m.pair2_player1, m.pair2_player2]) {
      if (p?.id && !map.has(p.id)) map.set(p.id, p)
    }
  }
  return map
}

/** round_schedule is keyed by lowercase round code (q1,r64,r32,r16,qf,sf,f). */
export function roundDisoFor(
  round: ProjRound,
  schedule: Record<string, string> | null | undefined,
): string | null {
  if (!schedule) return null
  return schedule[round.toLowerCase()] ?? null
}

/** Default tracked pair: a pair containing a bookmarked player (highest
 *  champion_prob among those), else the overall highest champion_prob. */
export function pickDefaultProjectionPair(
  rows: ProjectionRow[],
  bookmarkedPlayerIds: string[],
): string | null {
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b.champion_prob - a.champion_prob)
  const booked = new Set(bookmarkedPlayerIds)
  const withBookmark = sorted.find((r) => r.pair_player_ids.some((id) => booked.has(id)))
  return (withBookmark ?? sorted[0]).pair_key
}

function resolvePlayers(
  ids: string[],
  names: string[],
  lookup: Map<string, Player>,
): RoadPlayerVM[] {
  return ids.map((id, i) => {
    const p = lookup.get(id)
    return {
      id,
      name: p?.display_name ?? p?.name ?? names[i] ?? '',
      country: p?.country ?? null,
      avatarUrl: p?.avatar_url ?? null,
    }
  })
}

function opponentVM(
  o: ProjectionRoundJson['opponents'][number],
  lookup: Map<string, Player>,
): RoadOpponentVM {
  return {
    pairKey: o.pair_key,
    players: resolvePlayers(o.player_ids, o.names, lookup),
    faceProb: o.reach_prob,
    winProb: o.win_prob,
  }
}

export function buildRoadVM(
  row: ProjectionRow,
  lookup: Map<string, Player>,
  schedule: Record<string, string> | null | undefined,
): RoadVM {
  return {
    pairKey: row.pair_key,
    players: resolvePlayers(row.pair_player_ids, row.pair_player_ids, lookup),
    championProb: row.champion_prob,
    finalistProb: row.finalist_prob,
    semifinalProb: row.semifinal_prob,
    rounds: row.rounds.map((r) => {
      const opponents = r.opponents
        .map((o) => opponentVM(o, lookup))
        .sort((a, b) => b.faceProb - a.faceProb)
      const expected = opponents[0] ?? null
      return { round: r.round, dateIso: roundDisoFor(r.round, schedule), reachProb: r.reach_prob, expected, opponents }
    }),
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/__tests__/projection-view.test.ts`
Expected: PASS (all describe blocks). Then `npx tsc --noEmit` (ignore unrelated pre-existing errors — `@capacitor-community/admob` etc.; the new files must be clean).

- [ ] **Step 6: Commit**

```bash
git add src/lib/projection-types.ts src/lib/projection-view.ts src/lib/__tests__/projection-view.test.ts
git commit -m "feat(projection-ui): projection row types + pure view-model helpers"
```

---

## Task 2: i18n strings (5 locales)

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

- [ ] **Step 1: Add the `projection` tab label to the `tournament` namespace**

In EACH of the 5 message files, inside the existing `"tournament": { … }` object, add a `"projection"` key:
- en: `"projection": "Projection"`
- es: `"projection": "Proyección"`
- pt: `"projection": "Projeção"`
- it: `"projection": "Proiezione"`
- fr: `"projection": "Projection"`

- [ ] **Step 2: Add a top-level `projectionTab` namespace**

In EACH message file, add this namespace at the top level (sibling of `tournament`). English:

```json
"projectionTab": {
  "roadToTrophy": "Road to the trophy",
  "champion": "champion",
  "winsToLift": "{count} wins to lift it",
  "tracking": "Tracking",
  "live": "Live",
  "toFace": "{pct}% to face",
  "reach": "reach {pct}%",
  "morePossible": "+{count} possible opponents · tap",
  "possibleOpponentsHeading": "Possible opponents",
  "byeOrUnknown": "Opponent TBD",
  "eliminatedIn": "Eliminated in {round}",
  "champions": "Champions! 🏆",
  "roundR64": "Round of 64",
  "roundR32": "Round of 32",
  "roundR16": "Round of 16",
  "roundQF": "Quarterfinal",
  "roundSF": "Semifinal",
  "roundF": "Final",
  "lockedTitle": "Projection opens once the main draw is set",
  "lockedBody": "We'll model every pair's road to the trophy as soon as the bracket drops.",
  "notifyMe": "Notify me when the draw drops",
  "cardTitle": "Road to trophy",
  "cardChampion": "{pct}% to win the title",
  "cardCta": "See the full road",
  "modelEstimate": "Model estimate · not a guarantee"
}
```

Spanish (`es`):
```json
"projectionTab": {
  "roadToTrophy": "Camino al título",
  "champion": "campeón",
  "winsToLift": "{count} victorias para levantarlo",
  "tracking": "Siguiendo",
  "live": "En vivo",
  "toFace": "{pct}% de enfrentarse",
  "reach": "llega {pct}%",
  "morePossible": "+{count} posibles rivales · toca",
  "possibleOpponentsHeading": "Posibles rivales",
  "byeOrUnknown": "Rival por definir",
  "eliminatedIn": "Eliminado en {round}",
  "champions": "¡Campeones! 🏆",
  "roundR64": "Dieciseisavos",
  "roundR32": "Ronda de 32",
  "roundR16": "Octavos",
  "roundQF": "Cuartos de final",
  "roundSF": "Semifinal",
  "roundF": "Final",
  "lockedTitle": "La proyección se abre cuando esté el cuadro",
  "lockedBody": "Modelaremos el camino de cada pareja en cuanto salga el cuadro.",
  "notifyMe": "Avísame cuando salga el cuadro",
  "cardTitle": "Camino al título",
  "cardChampion": "{pct}% de ganar el título",
  "cardCta": "Ver el camino completo",
  "modelEstimate": "Estimación del modelo · no es una garantía"
}
```

Portuguese (`pt`):
```json
"projectionTab": {
  "roadToTrophy": "Caminho ao título",
  "champion": "campeão",
  "winsToLift": "{count} vitórias para levantá-lo",
  "tracking": "A seguir",
  "live": "Ao vivo",
  "toFace": "{pct}% de enfrentar",
  "reach": "chega {pct}%",
  "morePossible": "+{count} possíveis adversários · toque",
  "possibleOpponentsHeading": "Possíveis adversários",
  "byeOrUnknown": "Adversário a definir",
  "eliminatedIn": "Eliminado em {round}",
  "champions": "Campeões! 🏆",
  "roundR64": "Trigésimos",
  "roundR32": "Ronda de 32",
  "roundR16": "Oitavos",
  "roundQF": "Quartas de final",
  "roundSF": "Semifinal",
  "roundF": "Final",
  "lockedTitle": "A projeção abre quando o quadro estiver definido",
  "lockedBody": "Vamos modelar o caminho de cada dupla assim que o quadro sair.",
  "notifyMe": "Avise-me quando o quadro sair",
  "cardTitle": "Caminho ao título",
  "cardChampion": "{pct}% de ganhar o título",
  "cardCta": "Ver o caminho completo",
  "modelEstimate": "Estimativa do modelo · não é garantia"
}
```

Italian (`it`):
```json
"projectionTab": {
  "roadToTrophy": "Strada verso il titolo",
  "champion": "campione",
  "winsToLift": "{count} vittorie per alzarlo",
  "tracking": "Segui",
  "live": "Dal vivo",
  "toFace": "{pct}% di affrontare",
  "reach": "arriva {pct}%",
  "morePossible": "+{count} possibili avversari · tocca",
  "possibleOpponentsHeading": "Possibili avversari",
  "byeOrUnknown": "Avversario da definire",
  "eliminatedIn": "Eliminato ai {round}",
  "champions": "Campioni! 🏆",
  "roundR64": "Trentaduesimi",
  "roundR32": "Sedicesimi",
  "roundR16": "Ottavi",
  "roundQF": "Quarti di finale",
  "roundSF": "Semifinale",
  "roundF": "Finale",
  "lockedTitle": "La proiezione si apre col tabellone",
  "lockedBody": "Modelleremo la strada di ogni coppia appena esce il tabellone.",
  "notifyMe": "Avvisami quando esce il tabellone",
  "cardTitle": "Strada verso il titolo",
  "cardChampion": "{pct}% di vincere il titolo",
  "cardCta": "Vedi la strada completa",
  "modelEstimate": "Stima del modello · non è una garanzia"
}
```

French (`fr`):
```json
"projectionTab": {
  "roadToTrophy": "Route vers le titre",
  "champion": "champion",
  "winsToLift": "{count} victoires pour le soulever",
  "tracking": "Suivi",
  "live": "En direct",
  "toFace": "{pct}% d'affronter",
  "reach": "atteint {pct}%",
  "morePossible": "+{count} adversaires possibles · touchez",
  "possibleOpponentsHeading": "Adversaires possibles",
  "byeOrUnknown": "Adversaire à définir",
  "eliminatedIn": "Éliminé en {round}",
  "champions": "Champions ! 🏆",
  "roundR64": "Seizièmes",
  "roundR32": "Trente-deuxièmes",
  "roundR16": "Huitièmes",
  "roundQF": "Quart de finale",
  "roundSF": "Demi-finale",
  "roundF": "Finale",
  "lockedTitle": "La projection s'ouvre une fois le tableau fixé",
  "lockedBody": "Nous modéliserons la route de chaque paire dès la sortie du tableau.",
  "notifyMe": "Préviens-moi quand le tableau sort",
  "cardTitle": "Route vers le titre",
  "cardChampion": "{pct}% de gagner le titre",
  "cardCta": "Voir toute la route",
  "modelEstimate": "Estimation du modèle · pas une garantie"
}
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "for (const l of ['en','es','pt','it','fr']) { const m=require('./src/messages/'+l+'.json'); if(!m.projectionTab?.roadToTrophy||!m.tournament?.projection) throw new Error('missing keys in '+l); } console.log('i18n OK')"`
Expected: `i18n OK`.

- [ ] **Step 4: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(projection-ui): i18n strings for Projection tab (5 locales)"
```

---

## Task 3: Public projection fetch hook

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/useProjection.ts`

- [ ] **Step 1: Implement the hook**

`src/app/[locale]/(app)/tournaments/[id]/useProjection.ts`:

```ts
'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ProjectionRow } from '@/lib/projection-types'

export interface ProjectionState {
  rows: ProjectionRow[]
  loading: boolean
  error: boolean
}

/** Reads tournament_projections (RLS public read) for one tournament+category. */
export function useProjection(tournamentId: string, category: 'men' | 'women'): ProjectionState {
  const [state, setState] = useState<ProjectionState>({ rows: [], loading: true, error: false })

  useEffect(() => {
    let cancelled = false
    setState({ rows: [], loading: true, error: false })
    supabase
      .from('tournament_projections')
      .select('tournament_id, category, pair_key, pair_player_ids, tournament_level, champion_prob, finalist_prob, semifinal_prob, rounds, computed_at')
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .order('champion_prob', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) {
          console.warn('[useProjection] fetch failed:', error)
          setState({ rows: [], loading: false, error: true })
          return
        }
        setState({ rows: (data ?? []) as ProjectionRow[], loading: false, error: false })
      })
    return () => {
      cancelled = true
    }
  }, [tournamentId, category])

  return state
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — confirm `useProjection.ts` has no new errors (ignore unrelated pre-existing ones).

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/useProjection.ts"
git commit -m "feat(projection-ui): public projection fetch hook"
```

---

## Task 4: ProjectionTab component (road + picker + drill-down + locked state)

**Files:**
- Create: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`

- [ ] **Step 1: Implement the component**

`src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`:

```tsx
'use client'
import { useMemo, useState } from 'react'
import { useTranslations, useFormatter } from 'next-intl'
import type { Match } from '@/types/match'
import Avatar from '@/components/Avatar'
import { FlagImage } from '@/components/FlagImage'
import { useFollowing } from '@/hooks/useFollowing'
import { buildPlayerLookup, buildRoadVM, pickDefaultProjectionPair, ROUND_LABEL_KEY, type RoadOpponentVM } from '@/lib/projection-view'
import { useProjection } from './useProjection'

const CARD = 'rgba(255,255,255,0.03)'
const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const SECONDARY = '#9AAEC4'
const LIME = '#7ED321'
const GOLD = '#F5A623'
const LIVE = '#FF4655'
const CHUNK_CARD = 'polygon(0% 4%, 99.5% 0%, 100% 96%, 0.5% 100%)'
const CHUNK_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const MONO = 'ui-monospace, "SF Mono", monospace'

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}
function winColor(p: number): string {
  return p >= 0.65 ? LIME : p >= 0.45 ? GOLD : LIVE
}

function PairAvatars({ opp, size = 24 }: { opp: { players: RoadOpponentVM['players'] }; size?: number }) {
  const [p1, p2] = opp.players
  return (
    <div style={{ position: 'relative', width: size + 14, height: size, flexShrink: 0 }}>
      <Avatar src={p1?.avatarUrl} alt={p1?.name ?? ''} size={size} fallback={p1?.name?.[0]} unoptimized
        style={{ position: 'absolute', left: 0, top: 0, border: '2px solid #1A1A1A' }} />
      <Avatar src={p2?.avatarUrl} alt={p2?.name ?? ''} size={size} fallback={p2?.name?.[0]} unoptimized
        style={{ position: 'absolute', left: 14, top: 0, border: '2px solid #1A1A1A' }} />
    </div>
  )
}

function pairName(players: RoadOpponentVM['players']): string {
  return players.map((p) => p.name.split(' ').slice(-1)[0] || p.name).join(' / ')
}

export default function ProjectionTab({
  tournamentId,
  matches,
  category,
  tournamentLevel,
  roundSchedule,
}: {
  tournamentId: string
  matches: Match[]
  category: 'men' | 'women'
  tournamentLevel: string | null
  roundSchedule: Record<string, string> | null
  initialPairKey?: string | null
}) {
  const t = useTranslations('projectionTab')
  const format = useFormatter()
  const { rows, loading } = useProjection(tournamentId, category)
  const { getFollowed } = useFollowing()
  const bookmarked = useMemo(() => getFollowed('player'), [getFollowed])
  const lookup = useMemo(() => buildPlayerLookup(matches), [matches])

  const defaultPair = useMemo(() => pickDefaultProjectionPair(rows, bookmarked), [rows, bookmarked])
  const [selectedPair, setSelectedPair] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const activePair = selectedPair ?? defaultPair
  const row = useMemo(() => rows.find((r) => r.pair_key === activePair) ?? null, [rows, activePair])
  const vm = useMemo(() => (row ? buildRoadVM(row, lookup, roundSchedule) : null), [row, lookup, roundSchedule])

  if (loading) {
    return <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>…</div>
  }

  // Locked / waitlist: Premier tournament, no projection yet (draw not set).
  if (rows.length === 0) {
    return (
      <div style={{ padding: '32px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 30, marginBottom: 10 }}>🏆</div>
        <div style={{ color: TEXT, fontSize: 15, fontWeight: 800, marginBottom: 6 }}>{t('lockedTitle')}</div>
        <div style={{ color: SECONDARY, fontSize: 12, lineHeight: 1.5, maxWidth: 280, margin: '0 auto 16px' }}>{t('lockedBody')}</div>
      </div>
    )
  }

  return (
    <div style={{ padding: '14px 13px 24px' }}>
      {/* pair picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('tracking')}</span>
        <select
          value={activePair ?? ''}
          onChange={(e) => { setSelectedPair(e.target.value); setExpanded(new Set()) }}
          style={{ background: CARD, color: TEXT, border: '1px solid #2E2E2E', padding: '6px 10px', fontSize: 12, fontWeight: 700, borderRadius: 0 }}
        >
          {rows.map((r) => (
            <option key={r.pair_key} value={r.pair_key}>{pairName(buildRoadVM(r, lookup, roundSchedule).players)}</option>
          ))}
        </select>
      </div>

      {vm && (
        <>
          {/* champion hero */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 15px', marginBottom: 18, background: 'rgba(126,211,33,0.07)', border: '1px solid rgba(126,211,33,0.22)', clipPath: CHUNK_CARD }}>
            <div>
              <div style={{ color: SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.6 }}>{t('roadToTrophy')}</div>
              <div style={{ color: TEXT, fontSize: 12, marginTop: 4, fontWeight: 600 }}>{t('winsToLift', { count: vm.rounds.length })} 🏆</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: LIME, fontWeight: 800, fontSize: 25, lineHeight: 1, fontFamily: MONO }}>{pct(vm.championProb)}</div>
              <div style={{ color: MUTED, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 1 }}>{t('champion')}</div>
            </div>
          </div>

          {/* the road */}
          <div style={{ position: 'relative', paddingLeft: 24 }}>
            <div style={{ position: 'absolute', left: 7, top: 9, bottom: 14, width: 2, background: `linear-gradient(${LIME} 0%, ${GOLD} 45%, ${GOLD} 100%)` }} />
            {vm.rounds.map((rd, i) => {
              const isFinal = rd.round === 'F'
              const isExpanded = expanded.has(rd.round)
              const dateLabel = rd.dateIso ? format.dateTime(new Date(rd.dateIso), { weekday: 'short', day: 'numeric', month: 'short' }) : null
              return (
                <div key={rd.round} style={{ position: 'relative', marginBottom: i === vm.rounds.length - 1 ? 0 : 14 }}>
                  <div style={{ position: 'absolute', left: -24, top: 7, width: 16, height: 16, borderRadius: '50%', background: isFinal ? GOLD : '#222', border: '3px solid #1A1A1A', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>{isFinal ? '🏆' : ''}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                    <span style={{ color: isFinal ? GOLD : SECONDARY, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {t(ROUND_LABEL_KEY[rd.round])}{dateLabel ? ` · ${dateLabel}` : ''}
                    </span>
                    {rd.opponents.length > 1 && (
                      <button onClick={() => setExpanded((s) => { const n = new Set(s); n.has(rd.round) ? n.delete(rd.round) : n.add(rd.round); return n })}
                        style={{ color: MUTED, fontSize: 9, fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer' }}>
                        {isExpanded ? t('possibleOpponentsHeading') : t('morePossible', { count: rd.opponents.length - 1 })} ›
                      </button>
                    )}
                  </div>
                  {(isExpanded ? rd.opponents : rd.expected ? [rd.expected] : []).map((opp, j) => (
                    <div key={opp.pairKey} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: isFinal && j === 0 ? 'rgba(245,166,35,0.06)' : CARD, border: `1px solid ${isFinal && j === 0 ? 'rgba(245,166,35,0.22)' : 'rgba(255,255,255,0.06)'}`, padding: '8px 10px', clipPath: CHUNK_CARD, marginBottom: 6, opacity: j === 0 ? 1 : 0.8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <PairAvatars opp={opp} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ color: TEXT, fontSize: 12, fontWeight: 600 }}>{pairName(opp.players)}</div>
                          <div style={{ color: MUTED, fontSize: 9, fontWeight: 700 }}>{t('toFace', { pct: Math.round(opp.faceProb * 100) })}</div>
                        </div>
                      </div>
                      <span style={{ color: winColor(opp.winProb), fontWeight: 800, fontSize: 15, fontFamily: MONO }}>{pct(opp.winProb)}</span>
                    </div>
                  ))}
                  {!rd.expected && (
                    <div style={{ color: MUTED, fontSize: 11, padding: '6px 2px' }}>{t('byeOrUnknown')}</div>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 16, textAlign: 'center', color: MUTED, fontSize: 9, fontWeight: 600 }}>{t('modelEstimate')}</div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` — confirm `ProjectionTab.tsx` is clean (ignore unrelated pre-existing errors). Fix any type mismatch against the real `Avatar`/`FlagImage`/`useFollowing` signatures if the compiler flags them (e.g. `Avatar` `style` prop). Note: `FlagImage` is imported but only used if you add flags to `PairAvatars`; if unused, remove the import to satisfy lint.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx"
git commit -m "feat(projection-ui): ProjectionTab — road, pair picker, drill-down, locked state"
```

---

## Task 5: Wire the tab into the tournament page

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

- [ ] **Step 1: Import the tab + tier helper**

Near the other imports add:
```ts
import ProjectionTab from './ProjectionTab'
import { isPremierTier } from '@/lib/tournament-tier'
```

- [ ] **Step 2: Extend the `pageTab` union (both the state generic and the `setPageTab` callback param)**

Change every `'matches' | 'overview' | 'story' | 'draw'` occurrence (the `useState` generic ~line 228 and the `setPageTab` callback ~line 245) to:
```ts
'matches' | 'overview' | 'story' | 'draw' | 'projection'
```
And in the initial-state ternary, add a branch so `?tab=projection` selects it:
```ts
    : paramTab === 'projection'
    ? 'projection'
```
(place it alongside the existing `paramTab === 'draw' ? 'draw'` branch).

- [ ] **Step 3: Add the gate + read the `?pair=` param**

Near `showDrawTab` (~line 790) add:
```ts
  const showProjectionTab = useMemo(() => {
    if (process.env.NEXT_PUBLIC_PROJECTION_ENABLED !== 'true') return false
    if (!activeTournamentObj) return false
    return isPremierTier(activeTournamentObj.level ?? '')
  }, [activeTournamentObj])
```
Near the other `searchParams.get(...)` reads (~line 205) add:
```ts
  const paramPair = searchParams.get('pair')
```

- [ ] **Step 4: Add the tab to the tab list (2nd position)**

Replace the tabs array expression (~line 1113) with one that inserts `projection` after `overview`:
```tsx
    tabs={(['overview', ...(showProjectionTab ? ['projection'] as const : []), 'story', 'matches', ...(showDrawTab ? ['draw'] as const : [])] as const).map(tab => ({
      key: tab,
      label: tTournament(tab),
    }))}
```

- [ ] **Step 5: Render the tab content**

Next to the Draw tab conditional (~line 1295) add:
```tsx
        {pageTab === 'projection' && activeTournamentObj && showProjectionTab && (
          <ProjectionTab
            tournamentId={tournamentId}
            matches={allMatches.filter(m => (m as { category?: string }).category === genderFilter)}
            category={genderFilter}
            tournamentLevel={activeTournamentObj.level ?? null}
            roundSchedule={(activeTournamentObj as { round_schedule?: Record<string, string> | null }).round_schedule ?? null}
            initialPairKey={paramPair}
          />
        )}
```

- [ ] **Step 6: Typecheck + verify the page still compiles**

Run: `npx tsc --noEmit` — confirm no new errors in `page.tsx`. (The `pageTab` union widening must be consistent at every use site — the compiler will flag any missed spot; fix them.)

- [ ] **Step 7: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/page.tsx"
git commit -m "feat(projection-ui): wire Projection tab (2nd, Premier+flag gated) into tournament page"
```

---

## Task 6: Player-profile "Road to trophy" card

**Files:**
- Create: `src/app/[locale]/player/[id]/RoadToTrophyCard.tsx`
- Modify: `src/app/[locale]/player/[id]/page.tsx`

- [ ] **Step 1: Implement the card**

`src/app/[locale]/player/[id]/RoadToTrophyCard.tsx`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from '@/i18n/navigation'
import { supabase } from '@/lib/supabase'
import { isPremierTier } from '@/lib/tournament-tier'
import type { ProjectionRow } from '@/lib/projection-types'
import { Widget } from './Widget'

const TEXT = '#EEE4CE'
const MUTED = '#6B7280'
const LIME = '#7ED321'
const MONO = 'ui-monospace, "SF Mono", monospace'

/** Shows the player's champion odds + a deep-link into the tournament Projection
 *  tab, when they're in an active Premier-tier tournament with a projection. */
export default function RoadToTrophyCard({
  playerId,
  tournamentId,
  tournamentLevel,
  category,
}: {
  playerId: string
  tournamentId: string
  tournamentLevel: string | null
  category: 'men' | 'women'
}) {
  const t = useTranslations('projectionTab')
  const router = useRouter()
  const [row, setRow] = useState<ProjectionRow | null>(null)

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PROJECTION_ENABLED !== 'true') return
    if (!isPremierTier(tournamentLevel ?? '')) return
    let cancelled = false
    supabase
      .from('tournament_projections')
      .select('pair_key, pair_player_ids, champion_prob, rounds, tournament_id, category')
      .eq('tournament_id', tournamentId)
      .eq('category', category)
      .contains('pair_player_ids', [playerId])
      .limit(1)
      .then(({ data }) => {
        if (!cancelled) setRow(((data ?? [])[0] as ProjectionRow) ?? null)
      })
    return () => { cancelled = true }
  }, [playerId, tournamentId, tournamentLevel, category])

  if (!row) return null

  const go = () => {
    router.push(`/tournaments/${tournamentId}?tab=projection&pair=${encodeURIComponent(row.pair_key)}&category=${category}` as Parameters<typeof router.push>[0])
  }

  return (
    <Widget wide label={t('cardTitle')}>
      <button onClick={go} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', background: 'none', border: 'none', padding: 0, cursor: 'pointer', marginTop: 2 }}>
        <div style={{ textAlign: 'left' }}>
          <div style={{ color: LIME, fontSize: 22, fontWeight: 800, lineHeight: 1, fontFamily: MONO }}>{Math.round(row.champion_prob * 100)}%</div>
          <div style={{ color: MUTED, fontSize: 10, marginTop: 4 }}>{t('cardChampion', { pct: Math.round(row.champion_prob * 100) })}</div>
        </div>
        <span style={{ color: TEXT, fontSize: 11, fontWeight: 700 }}>{t('cardCta')} ›</span>
      </button>
    </Widget>
  )
}
```

- [ ] **Step 2: Render the card in the player Overview grid**

In `src/app/[locale]/player/[id]/page.tsx`, add the import near the top:
```ts
import RoadToTrophyCard from './RoadToTrophyCard'
```
The page already derives the current tournament via `pickCurrentTournamentMatch(matches, now)` (~line 539, `nextScheduled`). Inside the Overview grid (`<div style={{ padding: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>`, ~line 1067), add as the FIRST child so it sits near the top:
```tsx
        {derived.nextScheduled?.tournament?.id && (
          <RoadToTrophyCard
            playerId={player.id}
            tournamentId={derived.nextScheduled.tournament.id}
            tournamentLevel={derived.nextScheduled.tournament.level ?? null}
            category={(derived.nextScheduled as { category?: 'men' | 'women' }).category ?? 'men'}
          />
        )}
```
(If `derived.nextScheduled` isn't the exact local name in scope at that point, use the in-scope derived value that holds the current/next match — the page computes it as `nextScheduled`; reference it via the same `derived.` accessor used by sibling widgets. The card self-hides when there's no Premier projection, so a non-Premier or no-tournament case renders nothing.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit` — confirm both files clean. Resolve the `category` access against the real match shape if flagged (the match candidate type may need `(… as { category?: 'men'|'women' })`).

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/RoadToTrophyCard.tsx" "src/app/[locale]/player/[id]/page.tsx"
git commit -m "feat(projection-ui): player-profile Road to trophy card + deep-link"
```

---

## Task 7: Feature-flag enablement + local verification

**Files:**
- Modify: `.env.local` (local only — NOT committed; gitignored)

- [ ] **Step 1: Enable the flag locally**

Add to the running app's `.env.local` (main workdir, used by the public app dev server):
```
NEXT_PUBLIC_PROJECTION_ENABLED=true
```
(The tournament_projections table is already populated in prod from Plan A, so data will appear.)

- [ ] **Step 2: Run the public app and verify the tab**

Run: `npm run dev` (public app, port 3002 per CLAUDE.md). Open a **Premier** tournament that has projections — from Plan A's run, **ITALY MAJOR** (men) had rows. Navigate to its tournament page; confirm:
- A **"Projection"** tab appears 2nd (after Overview).
- It shows the champion-odds hero, the vertical road with per-round opponents (real photos + names), win % colored by confidence, dates per round, and a working pair picker.
- Tapping a round with multiple candidates expands the drill-down.
- A **non-Premier** tournament (e.g. an FIP Bronze) shows **no** Projection tab.

Per `memory/feedback_test-locally.md`, actually load these in the browser and confirm before claiming done. Capture any console errors.

- [ ] **Step 3: Verify the player card**

Open a player who is in ITALY MAJOR (e.g. Coello or Tapia) → their profile Overview should show a "Road to trophy" card with their champion %; tapping it deep-links to `/tournaments/<id>?tab=projection&pair=…` with that pair preselected.

- [ ] **Step 4: Verify the locked/waitlist state (optional)**

If a Premier tournament exists with the flag on but no projection rows (draw not yet set), its Projection tab shows the "Projection opens once the main draw is set" state. (If none is available, this is covered by Task 4's unit-free path; note it as verified-by-code-reading.)

- [ ] **Step 5: No commit** (env change is local/gitignored). Report verification results with what you observed.

---

## Self-review (completed during authoring)

**Spec coverage (Plan B portion):**
- Projection tab, 2nd position, Premier-public gate → Task 4/5. ✓
- Pair picker (select any pair in the draw) → Task 4. ✓
- Champion-odds hero + vertical road + per-round opponent + "% to face" + win% + dates → Task 1 (VM) + Task 4 (render). ✓
- Tap-to-expand opponent drill-down → Task 4 (`expanded` set + `opponents[]`). ✓
- Locked + waitlist empty state for Premier-no-draw → Task 4 (`rows.length === 0` branch). The "Notify me" CTA string exists (`notifyMe`); wiring it to the existing follow/notify infra is deferred (button shown copy-only in v1; see note). ✓ (copy present)
- Player-profile card deep-linking in → Task 6. ✓
- `?tab=projection&pair=…` deep-link → Task 5 (read `paramPair`) + Task 6 (build URL). ✓
- `NEXT_PUBLIC_PROJECTION_ENABLED` flag → Task 4/5/6/7. ✓
- Public-app row types (no engine mirror needed; precomputed) → Task 1. ✓
- Reuse Avatar/FlagImage/Widget/isPremierTier/useFollowing → all tasks. ✓
- Uncalibrated framing ("Model estimate") → Task 2 string + Task 4 footer. ✓

**Deferred (note in PR):** the `notifyMe` waitlist button is copy-only in v1 (not yet wired to push subscription); `FlagImage` on opponent rows is optional polish (the mock shows flags on the header pair only). Following-rail + match-detail spokes remain v2 (out of scope).

**Placeholder scan:** none — all code is concrete. (`initialPairKey` is passed through; Task 4's component accepts it in props for future use — the picker defaults via `pickDefaultProjectionPair`; if you want the deep-linked pair to win, initialize `selectedPair` from `initialPairKey` in a `useState` initializer. This is a one-line enhancement noted here; the prop is wired so it's not dead.)

**Type consistency:** `ProjectionRow`/`ProjRound` (Task 1) are used identically in Tasks 3/4/6; `buildRoadVM`/`pickDefaultProjectionPair`/`ROUND_LABEL_KEY` signatures match between definition (Task 1) and use (Task 4); i18n keys referenced in Tasks 4/6 are all defined in Task 2.

**Refinement to apply during Task 4:** initialize selected pair from the deep-link so `?pair=` wins over the default:
```ts
const [selectedPair, setSelectedPair] = useState<string | null>(initialPairKey ?? null)
```
(Use `initialPairKey` from props in the `useState` initializer; this makes the prop load-bearing and satisfies the deep-link requirement.)

---

## Known limitations (v1)

- Numbers are **uncalibrated** (per spec) — framed as "Model estimate".
- Projections refresh only when the worker runs (Plan A flag); the tab reads whatever's current in the table (shows `computed_at`-era data). No live in-play movement in v1.
- The waitlist "Notify me" button is copy-only until wired to the push/bookmark infra (v2).
