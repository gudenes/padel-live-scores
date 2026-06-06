# Projection — Plan C-A: full-field simulation + eliminated-pair journeys

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the projection a complete record of the whole draw — every pair persists for the life of the tournament, eliminated pairs are flagged and show their actual journey (real opponents + results, champion 0%), and the champion shows their winning road.

**Architecture:** Refactor the Monte-Carlo engine to simulate the **full first-round field** with **decided matches forced** to their real winner (no rng). One pass yields every pair's champion odds + factual past + projected future. Add `status`/`eliminated_round` to `tournament_projections`; the worker writes the complete field each run. The public + admin UIs branch on `status`.

**Tech Stack:** TypeScript, padelgod worker (vitest), Supabase migration, public Next.js app, next-intl.

**Spec:** `docs/superpowers/specs/2026-06-06-projection-history-and-eliminated-pairs-design.md`
**Depends on:** Plans A + B (engine, table, worker, public tab — all on `feat/road-to-trophy`).

**Scope:** Plan C-A only (full field + eliminated). The champion-odds sparkline/history is Plan C-B.

---

## Key current state (verified)

- Engine `padelgod/src/lib/bracket-projection.ts`: `projectPairs({entrants, runs, rng})`. Loop pairs `entrants[2k]` vs `[2k+1]`, advances winner via `rng() < pairWinProbability(a.teamElo,b.teamElo)`, tallies reach + opponents + champ. Round labels = deepest `log2(len)` of `PROJ_ROUND_ORDER`.
- Worker `padelgod/src/workers/tournament-projection-snapshot.ts`: `buildFrontierEntrants` (collapses finished→[winner,null]), `pickFrontierRound` (earliest unfinished round), then `projectPairs({entrants,runs})` → upsert (delete+insert per tournament/category) with `rounds` JSONB incl. `expected_opponent_pair_key`. `pairKeyFor(a,b)` exists. `canonRound`, `roundHasAssigned`, `MC_RUNS=20_000`.
- Table `tournament_projections` (Plan A): `champion_prob/finalist_prob/semifinal_prob`, `rounds` jsonb, `tournament_level`, unique `(tournament_id, category, pair_key)`, public-read RLS.
- Public `src/lib/projection-types.ts` (`ProjectionRow`) + `projection-view.ts` (`buildRoadVM` → `RoadVM{players,championProb,finalistProb,semifinalProb,rounds}`). `ProjectionTab.tsx` renders the road.
- i18n `projectionTab` namespace already has unused `eliminatedIn` ("Eliminated in {round}") and `champions` ("Champions! 🏆") keys in all 5 locales.

---

## Task 1: Engine — forced-results support

**Files:**
- Modify: `padelgod/src/lib/bracket-projection.ts`
- Modify: `padelgod/src/lib/__tests__/bracket-projection.test.ts`

- [ ] **Step 1: Add failing tests**

Append to `padelgod/src/lib/__tests__/bracket-projection.test.ts`:

```ts
import { matchupKey } from '../bracket-projection.js'

describe('projectPairs — forced (decided) results', () => {
  it('forces the known winner and gives the loser champion 0', () => {
    // 4-pair SF/F bracket. Force A beats B in the SF, and force the F too.
    const entrants = [pair('A', 1800), pair('B', 1800), pair('C', 1800), pair('D', 1800)]
    const decided = new Map<string, string>([
      [matchupKey('A', 'B'), 'A'], // A wins SF
      [matchupKey('C', 'D'), 'C'], // C wins SF
      [matchupKey('A', 'C'), 'A'], // A wins F
    ])
    const res = projectPairs({ entrants, runs: 2000, rng: mulberry32(1), decided })
    expect(res.get('A')!.championProb).toBe(1)   // fully decided → champion A
    expect(res.get('B')!.championProb).toBe(0)   // lost SF
    expect(res.get('C')!.finalistProb).toBe(1)   // reached F
    expect(res.get('D')!.championProb).toBe(0)
    // B still records its real SF opponent (A) — the factual journey.
    const bSF = res.get('B')!.rounds.find(r => r.round === 'SF')!
    expect(bSF.reachProb).toBe(1)
    expect(bSF.opponents.map(o => o.pairKey)).toEqual(['A'])
    // B does not reach the final.
    expect(res.get('B')!.rounds.find(r => r.round === 'F')!.reachProb).toBe(0)
  })

  it('mixes forced past with sampled future (one SF decided, the other open)', () => {
    const entrants = [pair('A', 2000), pair('B', 1600), pair('C', 1800), pair('D', 1800)]
    const decided = new Map<string, string>([[matchupKey('A', 'B'), 'A']]) // A through to F
    const res = projectPairs({ entrants, runs: 8000, rng: mulberry32(3), decided })
    expect(res.get('A')!.rounds.find(r => r.round === 'F')!.reachProb).toBe(1) // A always in F
    expect(res.get('B')!.championProb).toBe(0)
    // The C/D SF is still simulated → both can reach the final.
    expect(res.get('C')!.finalistProb).toBeGreaterThan(0)
    expect(res.get('D')!.finalistProb).toBeGreaterThan(0)
  })

  it('matchupKey is order-independent', () => {
    expect(matchupKey('x', 'y')).toBe(matchupKey('y', 'x'))
  })
})
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd padelgod && npx vitest run src/lib/__tests__/bracket-projection.test.ts`
Expected: FAIL — `matchupKey` not exported / `decided` ignored.

- [ ] **Step 3: Implement forced-results in the engine**

In `padelgod/src/lib/bracket-projection.ts`:

Add the export near `pairWinProbability` import usage (top-level):
```ts
/** Order-independent key for a matchup between two pairKeys. */
export function matchupKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
```

Add `decided` to the input interface:
```ts
export interface ProjectionInput {
  entrants: (FrontierEntrant | null)[];
  runs: number;
  rng?: () => number;
  /** Matchup → winner pairKey. When a simulated match is in this map, the
   *  winner is forced (no rng draw). Key via matchupKey(aKey, bKey). Used to
   *  pin already-played results so the sim reflects reality + projects forward. */
  decided?: Map<string, string>;
}
```

In `projectPairs`, destructure and use it in the match step. Replace the `if (a && b) { … }` block body with:
```ts
        if (a && b) {
          noteOpp(tally.get(a.pairKey)!, r, b.pairKey);
          noteOpp(tally.get(b.pairKey)!, r, a.pairKey);
          const forced = decided?.get(matchupKey(a.pairKey, b.pairKey));
          if (forced) {
            next.push(forced === a.pairKey ? a : b);
          } else {
            const pA = pairWinProbability(a.teamElo, b.teamElo);
            next.push(rng() < pA ? a : b);
          }
        } else {
          next.push(a ?? b); // bye (or null vs null)
        }
```
(destructure: `const { entrants, runs, decided } = input;` and keep `const rng = input.rng ?? Math.random;`).

- [ ] **Step 4: Run, confirm pass**

Run: `cd padelgod && npx vitest run src/lib/__tests__/bracket-projection.test.ts`
Expected: PASS (existing + 3 new). `npx tsc --noEmit` clean for the file.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/lib/bracket-projection.ts padelgod/src/lib/__tests__/bracket-projection.test.ts
git commit -m "feat(projection): engine supports forced (decided) match results"
```

---

## Task 2: Worker — full-field entrants + decided map + status derivation

**Files:**
- Modify: `padelgod/src/workers/tournament-projection-snapshot.ts`
- Modify: `padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts`

- [ ] **Step 1: Add failing tests for the new helpers**

Append to the worker test file:

```ts
import { buildFullFieldEntrants, pickEntryRound, deriveStatuses } from '../tournament-projection-snapshot.js'

describe('buildFullFieldEntrants', () => {
  it('emits BOTH competitors of every match (losers retained), heap-ordered', () => {
    const rows: FrontierMatchRow[] = [
      { widget_id_composite: 'X:MD003', draw_position: null, id: 'm3', winner_pair: 1, status: 'finished',
        pair1_player1_id: 'p3', pair1_player2_id: 'p4', pair2_player1_id: 'w1', pair2_player2_id: 'w2', pair1_seed: null, pair2_seed: null },
      { widget_id_composite: 'X:MD002', draw_position: null, id: 'm2', winner_pair: null, status: 'scheduled',
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4', pair1_seed: 1, pair2_seed: null },
    ]
    const e = buildFullFieldEntrants(rows, new Map([['p1',1900],['p2',1900],['p3',1700],['p4',1700],['w1',1850],['w2',1850]]), new Map())
    // MD002 → slots 0,1 (both pairs); MD003 → slots 2,3 (both pairs, finished still keeps loser)
    expect(e.map(x => x?.pairKey)).toEqual(['p1::p2', 'p3::p4', 'p3::p4', 'w1::w2'])
  })
})

describe('pickEntryRound', () => {
  it('returns the shallowest round with an assigned match (even if finished)', () => {
    const byRound = new Map<ProjRound, FrontierMatchRow[]>([
      ['R16', [{ id: 'a', widget_id_composite: null, draw_position: 0, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'p3', pair2_player2_id: 'p4', pair1_seed: null, pair2_seed: null }]],
      ['QF', [{ id: 'b', widget_id_composite: null, draw_position: 0, status: 'scheduled', winner_pair: null,
        pair1_player1_id: 'p1', pair1_player2_id: 'p2', pair2_player1_id: 'w1', pair2_player2_id: 'w2', pair1_seed: null, pair2_seed: null }]],
    ])
    expect(pickEntryRound(byRound)).toBe('R16')
  })
})

describe('deriveStatuses', () => {
  it('flags losers as eliminated at their round and the final winner as champion', () => {
    const rows: Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }> = [
      { id: 'sf', round: 'SF', round_canonical: 'SF', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 1,
        pair1_player1_id: 'a1', pair1_player2_id: 'a2', pair2_player1_id: 'b1', pair2_player2_id: 'b2', pair1_seed: null, pair2_seed: null },
      { id: 'f', round: 'F', round_canonical: 'F', widget_id_composite: null, draw_position: null, status: 'finished', winner_pair: 2,
        pair1_player1_id: 'a1', pair1_player2_id: 'a2', pair2_player1_id: 'c1', pair2_player2_id: 'c2', pair1_seed: null, pair2_seed: null },
    ]
    const st = deriveStatuses(rows)
    expect(st.get('b1::b2')).toEqual({ status: 'eliminated', eliminatedRound: 'SF' })
    expect(st.get('a1::a2')).toEqual({ status: 'eliminated', eliminatedRound: 'F' }) // lost final
    expect(st.get('c1::c2')).toEqual({ status: 'champion', eliminatedRound: null })  // won final
  })
})
```

- [ ] **Step 2: Run, confirm fail**

Run: `cd padelgod && npx vitest run src/workers/__tests__/tournament-projection-snapshot.test.ts`
Expected: FAIL — new helpers not exported.

- [ ] **Step 3: Implement the new helpers**

In `padelgod/src/workers/tournament-projection-snapshot.ts` add (near `buildFrontierEntrants`):

```ts
/** Like buildFrontierEntrants but keeps BOTH competitors of every match (the
 *  losers stay in the field) so projectPairs can report every pair, including
 *  eliminated ones. Used with a `decided` map that forces played results. */
export function buildFullFieldEntrants(
  rows: FrontierMatchRow[],
  elo: Map<string, number>,
  players: Map<string, PlayerLite>,
): (FrontierEntrant | null)[] {
  const ordered = [...rows].sort((a, b) => {
    const ha = widgetHeapNumber(a.widget_id_composite)
    const hb = widgetHeapNumber(b.widget_id_composite)
    if (ha != null && hb != null && ha !== hb) return ha - hb
    if (ha != null && hb == null) return -1
    if (ha == null && hb != null) return 1
    const da = a.draw_position, db = b.draw_position
    if (typeof da === 'number' && typeof db === 'number' && da !== db) return da - db
    if (typeof da === 'number') return -1
    if (typeof db === 'number') return 1
    return a.id.localeCompare(b.id)
  })
  const slots: (FrontierEntrant | null)[] = []
  const mk = (p1: string, p2: string): FrontierEntrant => ({
    pairKey: pairKeyFor(p1, p2),
    playerIds: (p1 < p2 ? [p1, p2] : [p2, p1]) as [string, string],
    teamElo: teamElo(p1, p2, elo, players),
  })
  for (const m of ordered) {
    const hasP1 = m.pair1_player1_id && m.pair1_player2_id
    const hasP2 = m.pair2_player1_id && m.pair2_player2_id
    slots.push(
      hasP1 ? mk(m.pair1_player1_id!, m.pair1_player2_id!) : null,
      hasP2 ? mk(m.pair2_player1_id!, m.pair2_player2_id!) : null,
    )
  }
  let size = 1
  while (size < slots.length) size *= 2
  while (slots.length < size) slots.push(null)
  return slots
}

/** Shallowest (first) main-draw round present with an assigned match. */
export function pickEntryRound(byRound: Map<ProjRound, FrontierMatchRow[]>): ProjRound | null {
  for (const r of PROJ_ROUND_ORDER) {
    if ((byRound.get(r) ?? []).some(roundHasAssigned)) return r
  }
  return null
}

export interface PairStatus { status: 'active' | 'eliminated' | 'champion'; eliminatedRound: string | null }

/** From all decided matches: each loser → eliminated@round; final winner → champion. */
export function deriveStatuses(
  rows: Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>,
): Map<string, PairStatus> {
  const out = new Map<string, PairStatus>()
  for (const m of rows) {
    const decided = m.winner_pair === 1 || m.winner_pair === 2
    if (!decided) continue
    const round = canonRound(m.round_canonical ?? m.round)
    if (!round) continue
    const p1 = m.pair1_player1_id && m.pair1_player2_id ? pairKeyFor(m.pair1_player1_id, m.pair1_player2_id) : null
    const p2 = m.pair2_player1_id && m.pair2_player2_id ? pairKeyFor(m.pair2_player1_id, m.pair2_player2_id) : null
    const winner = m.winner_pair === 1 ? p1 : p2
    const loser = m.winner_pair === 1 ? p2 : p1
    if (loser) out.set(loser, { status: 'eliminated', eliminatedRound: round })
    if (round === 'F' && winner) out.set(winner, { status: 'champion', eliminatedRound: null })
  }
  return out
}

/** Decided-matchups map for the engine: matchupKey(a,b) → winner pairKey. */
export function buildDecidedMap(
  rows: Array<FrontierMatchRow & { round: string | null; round_canonical: string | null }>,
): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of rows) {
    if (!(m.winner_pair === 1 || m.winner_pair === 2)) continue
    const p1 = m.pair1_player1_id && m.pair1_player2_id ? pairKeyFor(m.pair1_player1_id, m.pair1_player2_id) : null
    const p2 = m.pair2_player1_id && m.pair2_player2_id ? pairKeyFor(m.pair2_player1_id, m.pair2_player2_id) : null
    if (!p1 || !p2) continue
    out.set(matchupKey(p1, p2), m.winner_pair === 1 ? p1 : p2)
  }
  return out
}
```
Add the import for `matchupKey`: change the bracket-projection import to include it, e.g.
```ts
import { projectPairs, PROJ_ROUND_ORDER, matchupKey } from '../lib/bracket-projection.js'
```

- [ ] **Step 4: Switch the worker loop to the full-field path**

Replace the per-category block (current lines ~244-279, from `const frontier = pickFrontierRound(...)` through the `upsertRows` build) with:

```ts
        const entryRound = pickEntryRound(byRound)
        if (!entryRound) continue
        const entrants = buildFullFieldEntrants(byRound.get(entryRound)!, train.elo, players)
        if (entrants.filter(Boolean).length < 2) continue

        const decided = buildDecidedMap(rows)
        const statuses = deriveStatuses(rows)
        const projections = projectPairs({ entrants, runs: MC_RUNS, decided })

        const nameOf = (id: string) => players.get(id)?.name ?? ''
        const upsertRows = [...projections.values()].map((p) => {
          const st = statuses.get(p.pairKey) ?? { status: 'active' as const, eliminatedRound: null }
          return {
            tournament_id: t.id,
            category,
            pair_key: p.pairKey,
            pair_player_ids: p.playerIds,
            tournament_level: t.level,
            status: st.status,
            eliminated_round: st.eliminatedRound,
            champion_prob: p.championProb.toFixed(4),
            finalist_prob: p.finalistProb.toFixed(4),
            semifinal_prob: p.semifinalProb.toFixed(4),
            rounds: p.rounds.map((r) => ({
              round: r.round,
              reach_prob: Number(r.reachProb.toFixed(4)),
              expected_opponent_pair_key: r.opponents[0]?.pairKey ?? null,
              opponents: r.opponents.map((o) => ({
                pair_key: o.pairKey,
                player_ids: o.playerIds,
                names: o.playerIds.map(nameOf),
                reach_prob: Number(o.reachProb.toFixed(4)),
                win_prob: Number(o.winProb.toFixed(4)),
              })),
            })),
            model_version: MODEL_VERSION,
            mc_runs: MC_RUNS,
            computed_at: nowIso,
          }
        })
```
Leave the existing delete+insert block below unchanged (it already error-checks the delete then inserts `upsertRows`).

- [ ] **Step 5: Remove the now-unused frontier helpers + their tests**

`buildFrontierEntrants` and `pickFrontierRound` are no longer used by the worker. Delete both functions from `tournament-projection-snapshot.ts` and delete their `describe('buildFrontierEntrants', …)` and `describe('pickFrontierRound', …)` blocks from the test file (keep the imports tidy — remove `buildFrontierEntrants`/`pickFrontierRound` from the test import line). If `widgetHeapNumber`/`teamElo`/`roundHasAssigned`/`canonRound` are now only used by the new helpers, keep them (still used).

- [ ] **Step 6: Run all worker tests + typecheck**

Run: `cd padelgod && npx vitest run src/workers/__tests__/tournament-projection-snapshot.test.ts && npx tsc --noEmit 2>&1 | grep tournament-projection-snapshot || echo CLEAN`
Expected: new helper tests PASS; no stale refs to removed functions; tsc clean.

- [ ] **Step 7: Commit**

```bash
git add padelgod/src/workers/tournament-projection-snapshot.ts padelgod/src/workers/__tests__/tournament-projection-snapshot.test.ts
git commit -m "feat(projection): worker writes full field with status + eliminated_round (forced results)"
```

---

## Task 3: Migration — status + eliminated_round columns

**Files:**
- Create: `supabase/migrations/20260606130000_projection_status_columns.sql`

- [ ] **Step 1: Write the migration (idempotent)**

```sql
-- supabase/migrations/20260606130000_projection_status_columns.sql
-- Full-field projection: keep every pair, flag eliminated/champion.
alter table public.tournament_projections
  add column if not exists status text not null default 'active',
  add column if not exists eliminated_round text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tournament_projections_status_chk'
  ) then
    alter table public.tournament_projections
      add constraint tournament_projections_status_chk
      check (status in ('active','eliminated','champion'));
  end if;
end $$;
```

- [ ] **Step 2: Apply via pg driver (per repo method) + verify**

Use the `DATABASE_URL` pg-driver one-shot (see `memory/repo-migration-apply-method.md`). Then:
```bash
psql "$DATABASE_URL" -c "select column_name from information_schema.columns where table_name='tournament_projections' and column_name in ('status','eliminated_round');"
```
Expected: both columns listed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260606130000_projection_status_columns.sql
git commit -m "feat(projection): status + eliminated_round columns"
```

---

## Task 4: Public types + view-model — status/eliminated in the road

**Files:**
- Modify: `src/lib/projection-types.ts`, `src/lib/projection-view.ts`
- Modify: `src/lib/__tests__/projection-view.test.ts`

- [ ] **Step 1: Add failing test**

Append to `src/lib/__tests__/projection-view.test.ts`:

```ts
describe('buildRoadVM — status', () => {
  it('carries status + eliminatedRound onto the VM', () => {
    const row = {
      tournament_id: 't', category: 'men', pair_key: 'a::b', pair_player_ids: ['a', 'b'],
      tournament_level: 'p1', status: 'eliminated', eliminated_round: 'QF',
      champion_prob: 0, finalist_prob: 0, semifinal_prob: 1, computed_at: 'now',
      rounds: [{ round: 'SF', reach_prob: 0, expected_opponent_pair_key: null, opponents: [] }],
    } as unknown as import('@/lib/projection-types').ProjectionRow
    const vm = buildRoadVM(row, new Map(), null)
    expect(vm.status).toBe('eliminated')
    expect(vm.eliminatedRound).toBe('QF')
  })
})
```

- [ ] **Step 2: Run, confirm fail**

Run: `npx vitest run src/lib/__tests__/projection-view.test.ts`
Expected: FAIL — `status`/`eliminatedRound` not on `RoadVM`.

- [ ] **Step 3: Implement**

In `src/lib/projection-types.ts`, add to `ProjectionRow`:
```ts
  status: 'active' | 'eliminated' | 'champion'
  eliminated_round: string | null
```
In `src/lib/projection-view.ts`, add to `RoadVM`:
```ts
  status: 'active' | 'eliminated' | 'champion'
  eliminatedRound: string | null
```
and in `buildRoadVM`'s returned object add:
```ts
    status: row.status ?? 'active',
    eliminatedRound: row.eliminated_round ?? null,
```

- [ ] **Step 4: Run + typecheck**

Run: `npx vitest run src/lib/__tests__/projection-view.test.ts` (PASS) and `npx tsc --noEmit 2>&1 | grep -E "projection" || echo CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/projection-types.ts src/lib/projection-view.ts src/lib/__tests__/projection-view.test.ts
git commit -m "feat(projection-ui): status/eliminatedRound in row + view-model"
```

---

## Task 5: Public UI — eliminated/champion road + picker labels

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx`
- Modify: `src/app/[locale]/(app)/tournaments/[id]/useProjection.ts` (select the new columns)

- [ ] **Step 1: Select the new columns in the hook**

In `useProjection.ts`, extend the `.select(...)` list to include `status, eliminated_round`:
```ts
.select('tournament_id, category, pair_key, pair_player_ids, tournament_level, status, eliminated_round, champion_prob, finalist_prob, semifinal_prob, rounds, computed_at')
```

- [ ] **Step 2: Update the picker + hero + footer in `ProjectionTab.tsx`**

(a) **Picker label** — show status for eliminated/champion. Replace the `<option>` map with:
```tsx
          {rows.map((r) => {
            const v = buildRoadVM(r, lookup, roundSchedule)
            const suffix = v.status === 'eliminated' ? ` · ${t('out')}` : v.status === 'champion' ? ' · 🏆' : ''
            return <option key={r.pair_key} value={r.pair_key}>{pairName(v.players)}{suffix}</option>
          })}
```

(b) **Hero badge** — under the champion %, when eliminated/champion show a badge. Inside the hero's right-hand `<div>` (after the `champion` label div), add:
```tsx
              {vm.status === 'eliminated' && vm.eliminatedRound && (
                <div style={{ color: LIVE, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 3 }}>
                  {t('eliminatedIn', { round: t(`round${vm.eliminatedRound}`) })}
                </div>
              )}
              {vm.status === 'champion' && (
                <div style={{ color: GOLD, fontSize: 10, fontWeight: 800, marginTop: 3 }}>{t('champions')}</div>
              )}
```
(`round${vm.eliminatedRound}` → keys `roundQF` etc. already exist.)

(c) **Road rendering for eliminated/champion** — the VM rounds already hold ONLY the factually-played rounds with reach=1 and the real opponent (and reach=0/empty after), so the existing road map renders the actual journey correctly. For an eliminated/champion pair, **suppress the drill-down button** (no projection to expand) and **hide future rounds with reach 0 and no opponent**. In the rounds `.map`, add at the top:
```tsx
              // For finished journeys (eliminated/champion) only render rounds
              // they actually played (reach > 0 with a real opponent or a bye).
              if (vm.status !== 'active' && rd.reachProb === 0 && !rd.expected) return null
              const isFinished = vm.status !== 'active'
```
and gate the drill-down toggle with `{!isFinished && rd.opponents.length > 1 && (…)}`.

- [ ] **Step 3: Add the `out` i18n key**

Add `"out": "Out"` (and translations: es `"Fuera"`, pt `"Fora"`, it `"Fuori"`, fr `"Sorti"`) to the `projectionTab` namespace in all 5 message files.

- [ ] **Step 4: Typecheck + lint**

Run: `npx tsc --noEmit 2>&1 | grep ProjectionTab || echo CLEAN` and `npx eslint "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx" "src/app/[locale]/(app)/tournaments/[id]/useProjection.ts"`.

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx" "src/app/[locale]/(app)/tournaments/[id]/useProjection.ts" src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(projection-ui): eliminated/champion road + picker labels"
```

---

## Task 6: Admin status + run worker + verify

**Files:**
- Modify: `apps/ops/src/lib/projection-data.ts`, `apps/ops/src/app/(app)/odds/projections/page.tsx`

- [ ] **Step 1: Surface status in admin**

In `projection-data.ts`, add `status` + `eliminated_round` to `ProjectionRow` and the `.select('*')` already covers them. In the admin page table, add a column rendering `r.status === 'eliminated' ? \`out · ${r.eliminated_round}\` : r.status`.

- [ ] **Step 2: Re-run the worker against prod (full field now)**

Use the same one-off runner approach as Plan A (a temp `padelgod/scripts/run-projection-once.ts`, NOT committed: `createServiceClient`-style anon→service client, call `runTournamentProjectionSnapshot({supabase, dryRun:false})`). Run with `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_KEY` exported from the main `.env.local`. Then verify the full field landed:
```bash
psql "$DATABASE_URL" -c "select status, count(*) from public.tournament_projections group by 1;"
```
Expected: rows with `active`, `eliminated` (and `champion` if any final is done) — eliminated pairs now PRESENT (Plan A's run only had active pairs). Delete the temp runner after.

- [ ] **Step 3: Verify in the running public app**

Boot the public app (`npm run dev`, flag on). On ITALY MAJOR's Projection tab, pick an eliminated pair from the dropdown (labelled "· Out") → confirm it renders their actual journey (the rounds they played, real opponents, W/L feel) with an "Eliminated in <round>" badge and 0% champion. An active pair still projects forward. Per `memory/feedback_test-locally.md`, confirm in the browser.

- [ ] **Step 4: Commit (admin only; temp runner not committed)**

```bash
git add apps/ops/src/lib/projection-data.ts "apps/ops/src/app/(app)/odds/projections/page.tsx"
git commit -m "feat(projection): admin shows pair status; full-field worker run verified"
```

---

## Self-review (done during authoring)

**Spec coverage (C-A):** forced-results full-draw sim → Task 1; full-field entrants + status derivation + worker → Task 2; status columns → Task 3; VM status → Task 4; eliminated/champion UI + picker labels → Task 5; admin + verification → Task 6. Edge cases: no-results reproduces current odds (decided map empty → identical loop → covered by existing engine tests still passing); retired/walkover decided via `winner_pair` (buildDecidedMap/deriveStatuses use `winner_pair`); byes (full-field keeps [pair,null]); champion status (deriveStatuses final winner). ✓

**Placeholder scan:** none — all steps have concrete code.

**Type consistency:** `matchupKey`, `buildFullFieldEntrants`, `pickEntryRound`, `deriveStatuses`, `buildDecidedMap`, `PairStatus`, `decided` input, `status`/`eliminated_round` (row) / `status`/`eliminatedRound` (VM) used consistently across tasks. `ProjectionRow.status` is `'active'|'eliminated'|'champion'` everywhere.

## Deferred to C-B
Champion-odds history snapshots + sparkline.
