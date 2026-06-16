# webtuga-live FIP Live Point-by-Point Worker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a padelgod cron worker that ingests genuine live point-by-point from the ad-hoc webtuga tracker for the FIP Platinum Lusitania event and writes it into the canonical `matches`/`sets`/`games`/`match_points` tables.

**Architecture:** A stateless ~15s cron worker discovers webtuga-backed tournaments via an `entity_external_ids` config row, fetches one JSON `results-feed` per tournament (plus per-match detail for live matches), resolves each webtuga match to a pre-existing draw match by surname overlap (cached in `entity_external_ids`), adapts the payload into the existing `LiveMatchState` shape, and reuses the Premier live-poller's `diffLiveState` + `applyDiff` machinery to write sets/games/match_points. Previous-tick state is persisted in the cache row's `metadata` jsonb since the cron has no in-memory state. Writes use `score_source='live'` so Crionet's `fip-results-writer` keeps owning the authoritative final.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), padelgod worker framework (`SchedulerDeps = { supabase, httpClient, logger }`), Supabase JS client, axios, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-webtuga-live-score-worker-design.md`

**Reused modules (do NOT modify):**
- `src/lib/live-state.ts` — `parsePointState(team1Raw, team2Raw, insideTiebreak)`, `diffLiveState(prev, curr, opts)`, types `LiveMatchState`, `LiveSetEntry`, `PointState`.
- `src/lib/point-reconstruction.ts` — `applyDiff(supabase, matchId, prev, curr, diff, resolvedPlayers, opts)`, type `ResolvedPlayers`.

All paths below are relative to the `padelgod/` directory unless noted. Run all commands from `padelgod/`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/webtuga-types.ts` | TypeScript shapes for the webtuga `results-feed` row and `matches/{id}` detail payload. Pure types. |
| `src/lib/webtuga-client.ts` | Thin axios wrappers: `fetchResultsFeed(httpClient, baseUrl)`, `fetchMatchDetail(httpClient, baseUrl, id)`. |
| `src/lib/webtuga-resolve.ts` | Pure resolver: `resolveWebtugaMatch(feedRow, candidateMatches)` → `{ matchId, orientation, resolvedPlayers } | { ambiguous } | null`. |
| `src/lib/webtuga-adapter.ts` | Pure adapter: `webtugaToLiveState(feedRow, matchId, orientation)` → `LiveMatchState`. |
| `src/lib/webtuga-cache.ts` | `entity_external_ids` helpers: `discoverWebtugaTournaments`, `loadMatchCache`, `upsertMatchCache`, `writeLastState`. |
| `src/workers/webtuga-live-fetcher.ts` | Orchestrator worker `runWebtugaLiveFetcher(deps)`. |
| `src/lib/env.ts` | Add `ENABLE_WEBTUGA_LIVE`, `WEBTUGA_LIVE_DRY_RUN`. |
| `src/index.ts` | Map env → `enableWebtugaLive`, `webtugaLiveDryRun`. |
| `src/scheduler.ts` | Register worker (union, `ALL_WORKERS`, `getWorkerRunner`, `SchedulerFlags`, `buildSchedule`). |
| `src/__tests__/scheduler.test.ts` | Add new flag to `ALL_ENABLED`; assert enable/disable. |
| `src/__tests__/lib/webtuga-resolve.test.ts` | Resolver unit tests. |
| `src/__tests__/lib/webtuga-adapter.test.ts` | Adapter unit tests. |
| `src/__tests__/workers/webtuga-live-fetcher.test.ts` | Worker orchestration test. |
| `scripts/onboard-webtuga-tournament.ts` | One-off: insert the `webtuga_live` config row. |

---

## Task 1: webtuga response types + client

**Files:**
- Create: `src/lib/webtuga-types.ts`
- Create: `src/lib/webtuga-client.ts`
- Test: `src/__tests__/lib/webtuga-client.test.ts`

- [ ] **Step 1: Write the types**

Create `src/lib/webtuga-types.ts`:

```typescript
/**
 * Shapes returned by the ad-hoc webtuga tournament tracker
 * (e.g. https://portugalmasterpadel.win.webtuga.net).
 * Captured 2026-06-16 from the FIP Platinum Lusitania event.
 */

/** One row of GET /api/public/results-feed (all matches for the event). */
export interface WebtugaFeedRow {
  id: number;
  court: string;
  time: string;
  round: string;
  category: string; // "Femininos" | "Masculinos"
  status: string; // "Live" | "Scheduled" | "Finished"
  teamA: string; // "A. Garcia / C. Sánchez"
  teamB: string;
  setsA: number;
  setsB: number;
  gamesA: number;
  gamesB: number;
  pointsA: string; // "15" | "40" | "Ad" | "0"
  pointsB: string;
  setsHistoryA: string; // completed-set games, e.g. "6" or "6,4"
  setsHistoryB: string;
  live: boolean;
  finished: boolean;
  updatedAt: string;
}

/** GET /api/public/matches/{id} — richer per-match state. */
export interface WebtugaMatchDetail {
  id: number;
  status: string;
  state: {
    setsA: number;
    setsB: number;
    gamesA: number;
    gamesB: number;
    displayPointsA: string;
    displayPointsB: string;
    isTieBreak: boolean;
    serverTeam: string; // "A" | "B" | ""
    setsHistoryA: string;
    setsHistoryB: string;
  };
}
```

- [ ] **Step 2: Write the failing client test**

Create `src/__tests__/lib/webtuga-client.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fetchResultsFeed, fetchMatchDetail } from '../../lib/webtuga-client.js';

function fakeHttp(routes: Record<string, unknown>) {
  return {
    get: vi.fn(async (url: string) => {
      const key = Object.keys(routes).find((k) => url.endsWith(k));
      if (!key) throw new Error(`no route for ${url}`);
      return { data: routes[key] };
    }),
  } as any;
}

describe('webtuga-client', () => {
  it('fetchResultsFeed returns the parsed array', async () => {
    const http = fakeHttp({
      '/api/public/results-feed': [{ id: 2, teamA: 'A / B', status: 'Live' }],
    });
    const rows = await fetchResultsFeed(http, 'https://x.win.webtuga.net');
    expect(http.get).toHaveBeenCalledWith(
      'https://x.win.webtuga.net/api/public/results-feed',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(2);
  });

  it('fetchMatchDetail hits the id-scoped endpoint', async () => {
    const http = fakeHttp({ '/api/public/matches/5': { id: 5, state: {} } });
    const detail = await fetchMatchDetail(http, 'https://x.win.webtuga.net', 5);
    expect(http.get).toHaveBeenCalledWith(
      'https://x.win.webtuga.net/api/public/matches/5',
    );
    expect(detail.id).toBe(5);
  });

  it('trims a trailing slash on the base URL', async () => {
    const http = fakeHttp({ '/api/public/results-feed': [] });
    await fetchResultsFeed(http, 'https://x.win.webtuga.net/');
    expect(http.get).toHaveBeenCalledWith(
      'https://x.win.webtuga.net/api/public/results-feed',
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/webtuga-client.test.ts`
Expected: FAIL — `Cannot find module '../../lib/webtuga-client.js'`.

- [ ] **Step 4: Write the client**

Create `src/lib/webtuga-client.ts`:

```typescript
import type { AxiosInstance } from 'axios';
import type { WebtugaFeedRow, WebtugaMatchDetail } from './webtuga-types.js';

function base(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

export async function fetchResultsFeed(
  httpClient: AxiosInstance,
  baseUrl: string,
): Promise<WebtugaFeedRow[]> {
  const res = await httpClient.get(`${base(baseUrl)}/api/public/results-feed`);
  return (res.data ?? []) as WebtugaFeedRow[];
}

export async function fetchMatchDetail(
  httpClient: AxiosInstance,
  baseUrl: string,
  id: number,
): Promise<WebtugaMatchDetail> {
  const res = await httpClient.get(`${base(baseUrl)}/api/public/matches/${id}`);
  return res.data as WebtugaMatchDetail;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/webtuga-client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/webtuga-types.ts src/lib/webtuga-client.ts src/__tests__/lib/webtuga-client.test.ts
git commit -m "feat(webtuga): JSON response types + fetch client"
```

---

## Task 2: pure resolver (webtuga match → our match + orientation)

**Files:**
- Create: `src/lib/webtuga-resolve.ts`
- Test: `src/__tests__/lib/webtuga-resolve.test.ts`

Resolver maps a webtuga feed row to one of our pre-existing draw matches using surname-token overlap, scoped to the tournament's matches and the mapped category. It returns the matched match id, the orientation (whether webtuga's team A is our pair1 or pair2), and the four resolved player UUIDs (for `applyDiff`).

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/webtuga-resolve.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { resolveWebtugaMatch, type CandidateMatch } from '../../lib/webtuga-resolve.js';

const garciaMatch: CandidateMatch = {
  id: 'uuid-garcia',
  category: 'women',
  pair1Player1Id: 'p-aitana',
  pair1Player2Id: 'p-cayetana',
  pair2Player1Id: 'p-vega',
  pair2Player2Id: 'p-carla',
  pair1Player1Name: 'Aitana Garcia Roman',
  pair1Player2Name: 'Cayetana Sanchez Vera',
  pair2Player1Name: 'Vega Cano Ortin',
  pair2Player2Name: 'Carla Aguila Tello',
};

const arteagaMatch: CandidateMatch = {
  id: 'uuid-arteaga',
  category: 'women',
  pair1Player1Id: 'p-mariaa',
  pair1Player2Id: 'p-nerea',
  pair2Player1Id: 'p-mgarin',
  pair2Player2Id: 'p-mfernandes',
  pair1Player1Name: 'Maria Arteaga Vilches',
  pair1Player2Name: 'Nerea Gomez Blazquez',
  pair2Player1Name: 'Maria Garin',
  pair2Player2Name: 'Margarida Fernandes',
};

function feed(over: Partial<any> = {}) {
  return {
    id: 2,
    category: 'Femininos',
    teamA: 'A. Garcia / C. Sánchez',
    teamB: 'I. Caño / C. Aguila',
    ...over,
  } as any;
}

describe('resolveWebtugaMatch', () => {
  it('resolves the Garcia match in AB orientation despite first-name drift (Inés vs Vega Caño)', () => {
    const r = resolveWebtugaMatch(feed(), [garciaMatch, arteagaMatch]);
    expect(r && 'matchId' in r ? r.matchId : null).toBe('uuid-garcia');
    expect(r && 'orientation' in r ? r.orientation : null).toBe('AB');
    expect(r && 'resolvedPlayers' in r ? r.resolvedPlayers.pair1Player1Id : null).toBe('p-aitana');
  });

  it('detects BA orientation when webtuga team A maps to our pair2', () => {
    const r = resolveWebtugaMatch(
      feed({ teamA: 'I. Caño / C. Aguila', teamB: 'A. Garcia / C. Sánchez' }),
      [garciaMatch],
    );
    expect(r && 'orientation' in r ? r.orientation : null).toBe('BA');
  });

  it('returns null when no candidate shares enough surnames', () => {
    const r = resolveWebtugaMatch(
      feed({ teamA: 'X. Unknown / Y. Stranger', teamB: 'Z. Nobody / W. Nadie' }),
      [garciaMatch, arteagaMatch],
    );
    expect(r).toBeNull();
  });

  it('only considers matches of the mapped category', () => {
    const menMatch = { ...garciaMatch, id: 'uuid-men', category: 'men' as const };
    const r = resolveWebtugaMatch(feed(), [menMatch]);
    expect(r).toBeNull();
  });

  it('flags ambiguity when two candidates tie on the top score', () => {
    const dup = { ...garciaMatch, id: 'uuid-garcia-2' };
    const r = resolveWebtugaMatch(feed(), [garciaMatch, dup]);
    expect(r && 'ambiguous' in r ? r.ambiguous : false).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/webtuga-resolve.test.ts`
Expected: FAIL — `Cannot find module '../../lib/webtuga-resolve.js'`.

- [ ] **Step 3: Write the resolver**

Create `src/lib/webtuga-resolve.ts`:

```typescript
/**
 * Pure resolver: map a webtuga feed row to one of our pre-existing draw matches
 * by surname-token overlap, scoped to the tournament's matches + mapped category.
 *
 * webtuga's player names are abbreviated ("A. Garcia") and occasionally carry
 * the wrong first name ("Inés Caño" for our "Vega Cano Ortin"), so we match on
 * SURNAME tokens only and rely on pair context (both teams) for confidence.
 * Verified 2026-06-16: 16/16 live+upcoming matches resolved, 0 ambiguous.
 */
import type { ResolvedPlayers } from './point-reconstruction.js';
import type { WebtugaFeedRow } from './webtuga-types.js';

export interface CandidateMatch {
  id: string;
  category: 'men' | 'women';
  pair1Player1Id: string | null;
  pair1Player2Id: string | null;
  pair2Player1Id: string | null;
  pair2Player2Id: string | null;
  pair1Player1Name: string | null;
  pair1Player2Name: string | null;
  pair2Player1Name: string | null;
  pair2Player2Name: string | null;
}

export type ResolveResult =
  | { matchId: string; orientation: 'AB' | 'BA'; resolvedPlayers: ResolvedPlayers }
  | { ambiguous: true }
  | null;

const CATEGORY_MAP: Record<string, 'men' | 'women'> = {
  Femininos: 'women',
  Masculinos: 'men',
};

function strip(s: string | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Surname tokens = tokens of length >= 3 (drops single-letter initials). */
function surnameTokens(full: string | null): Set<string> {
  return new Set(strip(full).split(' ').filter((t) => t.length >= 3));
}

/** Count how many of a webtuga team's surname tokens appear in a DB pair. */
function teamScore(webTeam: string, dbA: string | null, dbB: string | null): number {
  const web = surnameTokens(webTeam.replace('/', ' '));
  const db = new Set([...surnameTokens(dbA), ...surnameTokens(dbB)]);
  let hit = 0;
  for (const t of web) if (db.has(t)) hit++;
  return hit;
}

const MIN_SCORE = 2;

export function resolveWebtugaMatch(
  row: WebtugaFeedRow,
  candidates: CandidateMatch[],
): ResolveResult {
  const cat = CATEGORY_MAP[row.category];

  const scored = candidates
    .filter((m) => !cat || m.category === cat)
    .map((m) => {
      const ab = teamScore(row.teamA, m.pair1Player1Name, m.pair1Player2Name)
        + teamScore(row.teamB, m.pair2Player1Name, m.pair2Player2Name);
      const ba = teamScore(row.teamA, m.pair2Player1Name, m.pair2Player2Name)
        + teamScore(row.teamB, m.pair1Player1Name, m.pair1Player2Name);
      const orientation: 'AB' | 'BA' = ab >= ba ? 'AB' : 'BA';
      return { m, score: Math.max(ab, ba), orientation };
    })
    .filter((x) => x.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top) return null;
  if (scored[1] && scored[1].score === top.score) return { ambiguous: true };

  return {
    matchId: top.m.id,
    orientation: top.orientation,
    resolvedPlayers: {
      pair1Player1Id: top.m.pair1Player1Id,
      pair1Player2Id: top.m.pair1Player2Id,
      pair2Player1Id: top.m.pair2Player1Id,
      pair2Player2Id: top.m.pair2Player2Id,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/webtuga-resolve.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/webtuga-resolve.ts src/__tests__/lib/webtuga-resolve.test.ts
git commit -m "feat(webtuga): pure surname-overlap match resolver"
```

---

## Task 3: pure adapter (webtuga payload → LiveMatchState)

**Files:**
- Create: `src/lib/webtuga-adapter.ts`
- Test: `src/__tests__/lib/webtuga-adapter.test.ts`

The adapter builds a `LiveMatchState` from a webtuga feed row, swapping A/B per the resolved orientation so `team1*` always means our pair1. It reuses `parsePointState` for the current point.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/webtuga-adapter.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { webtugaToLiveState } from '../../lib/webtuga-adapter.js';
import type { WebtugaFeedRow } from '../../lib/webtuga-types.js';

function row(over: Partial<WebtugaFeedRow> = {}): WebtugaFeedRow {
  return {
    id: 2, court: 'Central Court', time: '10:00', round: 'Qualifiers',
    category: 'Femininos', status: 'Live',
    teamA: 'A. Garcia / C. Sánchez', teamB: 'I. Caño / C. Aguila',
    setsA: 1, setsB: 0, gamesA: 0, gamesB: 0,
    pointsA: '15', pointsB: '0', setsHistoryA: '6', setsHistoryB: '2',
    live: true, finished: false, updatedAt: '2026-06-16T09:36:55',
    ...over,
  };
}

describe('webtugaToLiveState', () => {
  it('builds completed + current sets and current point (AB orientation)', () => {
    const s = webtugaToLiveState(row(), 'uuid-2', 'AB');
    expect(s.matchId).toBe('uuid-2');
    expect(s.matchWidgetId).toBe('2');
    expect(s.status).toBe('live');
    // set 1 completed 6-2, set 2 in progress 0-0
    expect(s.team1Sets).toEqual([{ games: 6, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.team2Sets).toEqual([{ games: 2, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.pointState).toEqual({ kind: 'regular', team1: 15, team2: 0 });
    expect(s.servingTeam).toBeNull(); // no serverTeam on the feed row
  });

  it('swaps A/B under BA orientation', () => {
    const s = webtugaToLiveState(row(), 'uuid-2', 'BA');
    // pair1 (team1) now follows webtuga B-side: 2 games completed, point 0
    expect(s.team1Sets).toEqual([{ games: 2, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.team2Sets).toEqual([{ games: 6, tiebreak: null }, { games: 0, tiebreak: null }]);
    expect(s.pointState).toEqual({ kind: 'regular', team1: 0, team2: 15 });
  });

  it('maps multi-set history (comma-separated)', () => {
    const s = webtugaToLiveState(row({ setsHistoryA: '6,4', setsHistoryB: '3,6', gamesA: 2, gamesB: 1 }), 'u', 'AB');
    expect(s.team1Sets.map((x) => x?.games)).toEqual([6, 4, 2]);
    expect(s.team2Sets.map((x) => x?.games)).toEqual([3, 6, 1]);
  });

  it('maps Scheduled status and is tolerant of empty history', () => {
    const s = webtugaToLiveState(row({ status: 'Scheduled', setsHistoryA: '', setsHistoryB: '', gamesA: 0, gamesB: 0, pointsA: '0', pointsB: '0' }), 'u', 'AB');
    expect(s.status).toBe('scheduled');
    expect(s.team1Sets).toEqual([{ games: 0, tiebreak: null }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/webtuga-adapter.test.ts`
Expected: FAIL — `Cannot find module '../../lib/webtuga-adapter.js'`.

- [ ] **Step 3: Write the adapter**

Create `src/lib/webtuga-adapter.ts`:

```typescript
/**
 * Pure adapter: a webtuga feed row → the canonical LiveMatchState consumed by
 * diffLiveState/applyDiff. The `orientation` (from the resolver) decides whether
 * webtuga's team A is our pair1 (AB) or pair2 (BA); we always emit team1* = our
 * pair1.
 */
import {
  parsePointState,
  type LiveMatchState,
  type LiveSetEntry,
} from './live-state.js';
import type { WebtugaFeedRow } from './webtuga-types.js';

function parseHistory(s: string): number[] {
  return (s ?? '')
    .split(/[^0-9]+/)
    .filter((x) => x.length > 0)
    .map((x) => Number(x));
}

/** Build the per-set array: completed sets from history + the current set games. */
function buildSets(history: string, currentGames: number): Array<LiveSetEntry | null> {
  const completed = parseHistory(history).map((g) => ({ games: g, tiebreak: null }));
  return [...completed, { games: currentGames, tiebreak: null }];
}

function mapStatus(raw: string): LiveMatchState['status'] {
  const s = raw.trim().toLowerCase();
  if (s === 'live') return 'live';
  if (s === 'finished') return 'finished';
  return 'scheduled';
}

export function webtugaToLiveState(
  row: WebtugaFeedRow,
  matchId: string,
  orientation: 'AB' | 'BA',
): LiveMatchState {
  // Resolve which webtuga side is our pair1 vs pair2.
  const t1HistoryRaw = orientation === 'AB' ? row.setsHistoryA : row.setsHistoryB;
  const t2HistoryRaw = orientation === 'AB' ? row.setsHistoryB : row.setsHistoryA;
  const t1Games = orientation === 'AB' ? row.gamesA : row.gamesB;
  const t2Games = orientation === 'AB' ? row.gamesB : row.gamesA;
  const t1Points = orientation === 'AB' ? row.pointsA : row.pointsB;
  const t2Points = orientation === 'AB' ? row.pointsB : row.pointsA;

  return {
    matchWidgetId: String(row.id),
    matchId,
    pointState: parsePointState(t1Points || '0', t2Points || '0', false),
    team1Sets: buildSets(t1HistoryRaw, t1Games),
    team2Sets: buildSets(t2HistoryRaw, t2Games),
    servingTeam: null, // feed row carries no server; detail-endpoint enrichment is a later task
    status: mapStatus(row.status),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/webtuga-adapter.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/webtuga-adapter.ts src/__tests__/lib/webtuga-adapter.test.ts
git commit -m "feat(webtuga): pure feed-row -> LiveMatchState adapter"
```

---

## Task 4: entity_external_ids cache helpers

**Files:**
- Create: `src/lib/webtuga-cache.ts`
- Test: `src/__tests__/lib/webtuga-cache.test.ts`

Encapsulates all `entity_external_ids` reads/writes:
- `discoverWebtugaTournaments` — `source='webtuga_live'` rows → `{ tournamentId, baseUrl }[]`.
- `loadMatchCache` — for a tournament, all `source='webtuga'` rows → map of `webtugaId → { matchId, orientation, lastState }`.
- `upsertMatchCache` — insert the per-match mapping on first resolve.
- `writeLastState` — update `metadata.lastState` after a tick.

The per-match `external_id` is `'<tournamentId>:<webtugaId>'`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/lib/webtuga-cache.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import {
  discoverWebtugaTournaments,
  loadMatchCache,
  cacheExternalId,
} from '../../lib/webtuga-cache.js';

function selectChain(rows: any[]) {
  // builds a thenable query chain where every filter returns `this`
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  return chain;
}

describe('webtuga-cache', () => {
  it('cacheExternalId composes tournament + webtuga id', () => {
    expect(cacheExternalId('t-uuid', 2)).toBe('t-uuid:2');
  });

  it('discoverWebtugaTournaments maps base-url rows', async () => {
    const supabase: any = {
      from: vi.fn(() => selectChain([
        { entity_id: 't1', external_id: 'https://a.win.webtuga.net' },
      ])),
    };
    const out = await discoverWebtugaTournaments(supabase);
    expect(out).toEqual([{ tournamentId: 't1', baseUrl: 'https://a.win.webtuga.net' }]);
  });

  it('loadMatchCache keys rows by webtuga id from the composite external_id', async () => {
    const supabase: any = {
      from: vi.fn(() => selectChain([
        { external_id: 't1:2', entity_id: 'm2', metadata: { orientation: 'AB', lastState: { matchId: 'm2' } } },
      ])),
    };
    const map = await loadMatchCache(supabase, 't1');
    expect(map.get(2)?.matchId).toBe('m2');
    expect(map.get(2)?.orientation).toBe('AB');
    expect(map.get(2)?.lastState?.matchId).toBe('m2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/lib/webtuga-cache.test.ts`
Expected: FAIL — `Cannot find module '../../lib/webtuga-cache.js'`.

- [ ] **Step 3: Write the cache helpers**

Create `src/lib/webtuga-cache.ts`:

```typescript
/**
 * entity_external_ids helpers for the webtuga worker.
 *
 *   source='webtuga_live' : one row per tournament, external_id = tracker base URL.
 *   source='webtuga'      : one row per resolved match,
 *                           external_id = '<tournamentId>:<webtugaId>',
 *                           entity_id   = match UUID,
 *                           metadata    = { orientation, lastState }.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LiveMatchState } from './live-state.js';

export interface WebtugaTournament {
  tournamentId: string;
  baseUrl: string;
}

export interface MatchCacheEntry {
  matchId: string;
  orientation: 'AB' | 'BA';
  lastState: LiveMatchState | null;
}

export function cacheExternalId(tournamentId: string, webtugaId: number): string {
  return `${tournamentId}:${webtugaId}`;
}

export async function discoverWebtugaTournaments(
  supabase: SupabaseClient,
): Promise<WebtugaTournament[]> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('entity_id, external_id')
    .eq('entity_type', 'tournament')
    .eq('source', 'webtuga_live');
  if (error) throw new Error(`discoverWebtugaTournaments failed: ${error.message}`);
  return (data ?? []).map((r: any) => ({
    tournamentId: r.entity_id as string,
    baseUrl: r.external_id as string,
  }));
}

export async function loadMatchCache(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<Map<number, MatchCacheEntry>> {
  const { data, error } = await supabase
    .from('entity_external_ids')
    .select('external_id, entity_id, metadata')
    .eq('entity_type', 'match')
    .eq('source', 'webtuga');
  if (error) throw new Error(`loadMatchCache failed: ${error.message}`);

  const map = new Map<number, MatchCacheEntry>();
  for (const r of data ?? []) {
    const ext = String((r as any).external_id);
    const [tid, idPart] = ext.split(':');
    if (tid !== tournamentId) continue;
    const webtugaId = Number(idPart);
    if (!Number.isFinite(webtugaId)) continue;
    const meta = ((r as any).metadata ?? {}) as {
      orientation?: 'AB' | 'BA';
      lastState?: LiveMatchState;
    };
    map.set(webtugaId, {
      matchId: (r as any).entity_id as string,
      orientation: meta.orientation ?? 'AB',
      lastState: meta.lastState ?? null,
    });
  }
  return map;
}

export async function upsertMatchCache(
  supabase: SupabaseClient,
  tournamentId: string,
  webtugaId: number,
  matchId: string,
  orientation: 'AB' | 'BA',
  lastState: LiveMatchState | null,
): Promise<void> {
  const { error } = await supabase.from('entity_external_ids').upsert(
    {
      entity_type: 'match',
      entity_id: matchId,
      source: 'webtuga',
      external_id: cacheExternalId(tournamentId, webtugaId),
      metadata: { orientation, lastState },
    },
    { onConflict: 'entity_type,source,external_id' },
  );
  if (error) throw new Error(`upsertMatchCache failed: ${error.message}`);
}

export async function writeLastState(
  supabase: SupabaseClient,
  tournamentId: string,
  webtugaId: number,
  orientation: 'AB' | 'BA',
  lastState: LiveMatchState,
): Promise<void> {
  const { error } = await supabase
    .from('entity_external_ids')
    .update({ metadata: { orientation, lastState } })
    .eq('entity_type', 'match')
    .eq('source', 'webtuga')
    .eq('external_id', cacheExternalId(tournamentId, webtugaId));
  if (error) throw new Error(`writeLastState failed: ${error.message}`);
}
```

> **Note on `onConflict`:** the `entity_external_ids` unique constraint is on `(entity_type, source, external_id)`. Confirm the constraint name/columns in `supabase/migrations/20260407_entity_external_ids_sidecar.sql` while implementing; adjust the `onConflict` string if the column list differs.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/lib/webtuga-cache.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/webtuga-cache.ts src/__tests__/lib/webtuga-cache.test.ts
git commit -m "feat(webtuga): entity_external_ids cache + config helpers"
```

---

## Task 5: the orchestrator worker

**Files:**
- Create: `src/workers/webtuga-live-fetcher.ts`
- Test: `src/__tests__/workers/webtuga-live-fetcher.test.ts`

`runWebtugaLiveFetcher(deps, opts?)` where `deps: SchedulerDeps` and `opts` carries `dryRun`. Per tick: discover tournaments → fetch feed → for each live row resolve (cache or matcher) → adapt → diff vs `lastState` → `applyDiff` (skipped in dryRun) → flip status `scheduled→live` (skipped in dryRun) → persist `lastState`. Returns a result counter.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/workers/webtuga-live-fetcher.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const applyDiff = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../lib/point-reconstruction.js', async (orig) => ({
  ...(await orig<any>()),
  applyDiff,
}));

import { runWebtugaLiveFetcher } from '../../workers/webtuga-live-fetcher.js';
import * as client from '../../lib/webtuga-client.js';
import * as cache from '../../lib/webtuga-cache.js';

const LIVE_ROW = {
  id: 2, court: 'Central Court', time: '10:00', round: 'Qualifiers',
  category: 'Femininos', status: 'Live',
  teamA: 'A. Garcia / C. Sánchez', teamB: 'I. Caño / C. Aguila',
  setsA: 1, setsB: 0, gamesA: 1, gamesB: 0,
  pointsA: '30', pointsB: '15', setsHistoryA: '6', setsHistoryB: '2',
  live: true, finished: false, updatedAt: '2026-06-16T09:40:00',
};

const CANDIDATE = {
  id: 'uuid-garcia', category: 'women',
  pair1_player1_id: 'p1', pair1_player2_id: 'p2',
  pair2_player1_id: 'p3', pair2_player2_id: 'p4',
  pair1_player1_name: 'Aitana Garcia Roman', pair1_player2_name: 'Cayetana Sanchez Vera',
  pair2_player1_name: 'Vega Cano Ortin', pair2_player2_name: 'Carla Aguila Tello',
  status: 'scheduled',
};

function makeSupabase() {
  // matches SELECT for candidates + status UPDATE capture
  const statusUpdate = vi.fn(() => ({ eq: () => ({ eq: async () => ({ error: null }) }) }));
  const supabase: any = {
    from: vi.fn((table: string) => {
      if (table === 'matches') {
        return {
          select: () => ({ eq: () => ({ then: (r: any) => r({ data: [CANDIDATE], error: null }) }) }),
          update: statusUpdate,
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    _statusUpdate: statusUpdate,
  };
  return supabase;
}

describe('runWebtugaLiveFetcher', () => {
  beforeEach(() => {
    applyDiff.mockClear();
    vi.restoreAllMocks();
  });

  it('first tick: resolves, writes cache, flips status, no points (prev=null)', async () => {
    vi.spyOn(client, 'fetchResultsFeed').mockResolvedValue([LIVE_ROW as any]);
    vi.spyOn(cache, 'discoverWebtugaTournaments').mockResolvedValue([
      { tournamentId: 't1', baseUrl: 'https://x.win.webtuga.net' },
    ]);
    vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(new Map());
    const upsert = vi.spyOn(cache, 'upsertMatchCache').mockResolvedValue();
    const writeLast = vi.spyOn(cache, 'writeLastState').mockResolvedValue();

    const supabase = makeSupabase();
    const res = await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger: { info() {}, warn() {} } as any },
      { dryRun: false },
    );

    expect(res.resolved).toBe(1);
    expect(upsert).toHaveBeenCalled();         // cache row created
    expect(supabase._statusUpdate).toHaveBeenCalled(); // status flip attempted
    // prev was null → applyDiff still called but writes nothing internally; assert it ran
    expect(applyDiff).toHaveBeenCalledTimes(1);
    expect(writeLast).toHaveBeenCalled();      // lastState persisted
  });

  it('dryRun: does not call applyDiff or status update', async () => {
    vi.spyOn(client, 'fetchResultsFeed').mockResolvedValue([LIVE_ROW as any]);
    vi.spyOn(cache, 'discoverWebtugaTournaments').mockResolvedValue([
      { tournamentId: 't1', baseUrl: 'https://x.win.webtuga.net' },
    ]);
    vi.spyOn(cache, 'loadMatchCache').mockResolvedValue(new Map());
    vi.spyOn(cache, 'upsertMatchCache').mockResolvedValue();
    vi.spyOn(cache, 'writeLastState').mockResolvedValue();

    const supabase = makeSupabase();
    const res = await runWebtugaLiveFetcher(
      { supabase, httpClient: {} as any, logger: { info() {}, warn() {} } as any },
      { dryRun: true },
    );

    expect(res.resolved).toBe(1);
    expect(applyDiff).not.toHaveBeenCalled();
    expect(supabase._statusUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/workers/webtuga-live-fetcher.test.ts`
Expected: FAIL — `Cannot find module '../../workers/webtuga-live-fetcher.js'`.

- [ ] **Step 3: Write the worker**

Create `src/workers/webtuga-live-fetcher.ts`:

```typescript
/**
 * webtuga-live-fetcher — stateless cron worker that ingests live point-by-point
 * from the ad-hoc webtuga tracker for FIP-tier events configured via an
 * entity_external_ids `source='webtuga_live'` row.
 *
 * Per tick, per tournament:
 *   1. fetch results-feed
 *   2. for each LIVE row: resolve → our match (cache or surname matcher)
 *   3. adapt → LiveMatchState; diff vs persisted lastState; applyDiff
 *   4. flip matches.status scheduled→live (guarded)
 *   5. persist lastState in the cache row metadata
 *
 * Writes sets/games with score_source='live' (lowest priority) so Crionet's
 * fip-results-writer keeps owning the authoritative final. Never finishes a
 * match. No live-notify in v1 (see design spec).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { SchedulerDeps } from '../scheduler.js';
import { diffLiveState } from '../lib/live-state.js';
import { applyDiff } from '../lib/point-reconstruction.js';
import { fetchResultsFeed } from '../lib/webtuga-client.js';
import { resolveWebtugaMatch, type CandidateMatch } from '../lib/webtuga-resolve.js';
import { webtugaToLiveState } from '../lib/webtuga-adapter.js';
import {
  discoverWebtugaTournaments,
  loadMatchCache,
  upsertMatchCache,
  writeLastState,
  type MatchCacheEntry,
} from '../lib/webtuga-cache.js';

export interface WebtugaLiveOpts {
  dryRun: boolean;
}

export interface WebtugaLiveResult {
  tournaments: number;
  liveSeen: number;
  resolved: number;
  unresolved: number;
  ambiguous: number;
  applied: number;
  dryRun: boolean;
}

/** Load the tournament's matches as resolver candidates (with player names). */
async function loadCandidates(
  supabase: SupabaseClient,
  tournamentId: string,
): Promise<CandidateMatch[]> {
  const { data, error } = await supabase
    .from('matches')
    .select(
      'id, category, pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id, ' +
        'pair1_player1_name, pair1_player2_name, pair2_player1_name, pair2_player2_name',
    )
    .eq('tournament_id', tournamentId);
  if (error) throw new Error(`loadCandidates failed: ${error.message}`);
  return (data ?? []).map((m: any) => ({
    id: m.id,
    category: m.category,
    pair1Player1Id: m.pair1_player1_id,
    pair1Player2Id: m.pair1_player2_id,
    pair2Player1Id: m.pair2_player1_id,
    pair2Player2Id: m.pair2_player2_id,
    pair1Player1Name: m.pair1_player1_name,
    pair1Player2Name: m.pair1_player2_name,
    pair2Player1Name: m.pair2_player1_name,
    pair2Player2Name: m.pair2_player2_name,
  }));
}

export async function runWebtugaLiveFetcher(
  deps: SchedulerDeps,
  opts: WebtugaLiveOpts,
): Promise<WebtugaLiveResult> {
  const { supabase, httpClient, logger } = deps;
  const res: WebtugaLiveResult = {
    tournaments: 0, liveSeen: 0, resolved: 0, unresolved: 0,
    ambiguous: 0, applied: 0, dryRun: opts.dryRun,
  };

  const tournaments = await discoverWebtugaTournaments(supabase);
  res.tournaments = tournaments.length;

  for (const t of tournaments) {
    let feed;
    try {
      feed = await fetchResultsFeed(httpClient, t.baseUrl);
    } catch (err) {
      logger.warn({ err, tournament: t.tournamentId }, 'webtuga feed fetch failed');
      continue;
    }

    const live = feed.filter((r) => String(r.status).toLowerCase() === 'live');
    res.liveSeen += live.length;
    if (live.length === 0) continue;

    const cacheMap = await loadMatchCache(supabase, t.tournamentId);
    let candidates: CandidateMatch[] | null = null; // lazy-load only on cache miss

    for (const rowItem of live) {
      let entry: MatchCacheEntry | undefined = cacheMap.get(rowItem.id);

      if (!entry) {
        if (candidates === null) candidates = await loadCandidates(supabase, t.tournamentId);
        const r = resolveWebtugaMatch(rowItem, candidates);
        if (r === null) { res.unresolved++; logger.warn({ webtugaId: rowItem.id }, 'webtuga match unresolved'); continue; }
        if ('ambiguous' in r) { res.ambiguous++; logger.warn({ webtugaId: rowItem.id }, 'webtuga match ambiguous'); continue; }
        entry = { matchId: r.matchId, orientation: r.orientation, lastState: null };
        if (!opts.dryRun) {
          await upsertMatchCache(supabase, t.tournamentId, rowItem.id, r.matchId, r.orientation, null);
        }
      }
      res.resolved++;

      const curr = webtugaToLiveState(rowItem, entry.matchId, entry.orientation);
      const prev = entry.lastState;
      const diff = diffLiveState(prev, curr);

      if (!opts.dryRun) {
        const resolvedPlayers = {
          pair1Player1Id: null, pair1Player2Id: null,
          pair2Player1Id: null, pair2Player2Id: null,
        };
        // resolvedPlayers come from the cache miss path; on a cache hit we don't
        // have them in-memory, so re-derive cheaply from the match row.
        const rp = await loadResolvedPlayers(supabase, entry.matchId);
        await applyDiff(supabase, entry.matchId, prev, curr, diff, rp ?? resolvedPlayers);
        await flipStatusToLive(supabase, entry.matchId);
        await writeLastState(supabase, t.tournamentId, rowItem.id, entry.orientation, curr);
        res.applied++;
      }
    }
  }

  logger.info({ ...res }, 'webtuga-live-fetcher tick complete');
  return res;
}

async function loadResolvedPlayers(supabase: SupabaseClient, matchId: string) {
  const { data, error } = await supabase
    .from('matches')
    .select('pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id')
    .eq('id', matchId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    pair1Player1Id: (data as any).pair1_player1_id,
    pair1Player2Id: (data as any).pair1_player2_id,
    pair2Player1Id: (data as any).pair2_player1_id,
    pair2Player2Id: (data as any).pair2_player2_id,
  };
}

/** Guarded scheduled→live flip. Never regresses live/finished/retired/walkover. */
async function flipStatusToLive(supabase: SupabaseClient, matchId: string): Promise<void> {
  await supabase
    .from('matches')
    .update({ status: 'live' })
    .eq('id', matchId)
    .eq('status', 'scheduled');
}
```

> **Implementation note:** the test stubs `matches` SELECT as `select().eq().then(...)`. The real Supabase client is thenable on the built query, so `loadCandidates`/`loadResolvedPlayers` `await` the builder directly. Keep the `.select(...).eq(...)` shape so the test's chain matches.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/workers/webtuga-live-fetcher.test.ts`
Expected: PASS (2 tests). If the thenable chain in the test doesn't line up with the real query usage, adjust the test's `makeSupabase` chain (not the worker) until both `matches` SELECTs resolve to `[CANDIDATE]`.

- [ ] **Step 5: Commit**

```bash
git add src/workers/webtuga-live-fetcher.ts src/__tests__/workers/webtuga-live-fetcher.test.ts
git commit -m "feat(webtuga): live-fetcher orchestrator worker"
```

---

## Task 6: scheduler + env wiring

**Files:**
- Modify: `src/lib/env.ts` (add two flags)
- Modify: `src/index.ts` (map env → flags)
- Modify: `src/scheduler.ts` (import, `WorkerName`, `ALL_WORKERS`, `SchedulerFlags`, `getWorkerRunner`, `buildSchedule`)
- Modify: `src/__tests__/scheduler.test.ts` (`ALL_ENABLED` + enable/disable assertions)

- [ ] **Step 1: Add env flags**

In `src/lib/env.ts`, next to `ENABLE_LIVE_ODDS_UPDATER: boolEnv(false),` add:

```typescript
  ENABLE_WEBTUGA_LIVE: boolEnv(false),
  WEBTUGA_LIVE_DRY_RUN: boolEnv(true),
```

- [ ] **Step 2: Map env → flags in `src/index.ts`**

Next to `enableLiveOddsUpdater: env.ENABLE_LIVE_ODDS_UPDATER,` add:

```typescript
      enableWebtugaLive: env.ENABLE_WEBTUGA_LIVE,
      webtugaLiveDryRun: env.WEBTUGA_LIVE_DRY_RUN,
```

- [ ] **Step 3: Wire `src/scheduler.ts`**

3a. Import near the other worker imports (top of file):

```typescript
import { runWebtugaLiveFetcher } from './workers/webtuga-live-fetcher.js';
```

3b. In the `SchedulerFlags` interface, next to `enableLiveOddsUpdater: boolean;`:

```typescript
  /** webtuga-live-fetcher — ~15s FIP live point-by-point from the ad-hoc
   *  webtuga tracker. Off by default; dry-run gated. */
  enableWebtugaLive: boolean;
  webtugaLiveDryRun: boolean;
```

3c. In the `WorkerName` union, add `| 'webtuga-live-fetcher'`.

3d. In `ALL_WORKERS`, add `'webtuga-live-fetcher',`.

3e. In `getWorkerRunner`'s switch, add a case (note: needs the dry-run flag, so it is registered directly in `buildSchedule` — return a thin runner here for admin triggers that defaults to dry-run):

```typescript
    case 'webtuga-live-fetcher':
      return (deps) => runWebtugaLiveFetcher(deps, { dryRun: true });
```

3f. In `buildSchedule`, next to the `enableLiveOddsUpdater` block:

```typescript
  if (flags.enableWebtugaLive) {
    entries.push({
      name: 'webtuga-live-fetcher',
      // Every 15 seconds. node-cron uses 6-field syntax when a seconds field is
      // present; `*/15` fires at 0, 15, 30, 45 s of every minute.
      cron: '*/15 * * * * *',
      run: async (deps) => runWebtugaLiveFetcher(deps, { dryRun: flags.webtugaLiveDryRun }),
    });
  }
```

- [ ] **Step 4: Update `src/__tests__/scheduler.test.ts`**

4a. In the `ALL_ENABLED` object, next to `enableLiveOddsUpdater: true,` add:

```typescript
  enableWebtugaLive: true,
  webtugaLiveDryRun: true,
```

4b. Add assertions near the `live-odds-updater` enable/disable test:

```typescript
  it('includes webtuga-live-fetcher when enabled', () => {
    const sched = buildSchedule(ALL_ENABLED as any);
    expect(sched.map((e) => e.name)).toContain('webtuga-live-fetcher');
  });

  it('excludes webtuga-live-fetcher when disabled', () => {
    const sched = buildSchedule({ ...ALL_ENABLED, enableWebtugaLive: false } as any);
    expect(sched.map((e) => e.name)).not.toContain('webtuga-live-fetcher');
  });
```

- [ ] **Step 5: Run the scheduler + full lib test suite**

Run: `npx vitest run src/__tests__/scheduler.test.ts`
Expected: PASS, including the two new assertions.

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/env.ts src/index.ts src/scheduler.ts src/__tests__/scheduler.test.ts
git commit -m "feat(webtuga): register worker + env flags in scheduler"
```

---

## Task 7: onboarding script + manual verification

**Files:**
- Create: `scripts/onboard-webtuga-tournament.ts`

This inserts the `webtuga_live` config row for Lusitania and documents the manual dry-run + egress checks.

- [ ] **Step 1: Write the onboarding script**

Create `scripts/onboard-webtuga-tournament.ts`:

```typescript
/**
 * One-off: attach a webtuga live tracker base URL to a tournament so the
 * webtuga-live-fetcher worker discovers it. Idempotent (upsert).
 *
 * Usage:
 *   DATABASE_URL=... npx tsx scripts/onboard-webtuga-tournament.ts \
 *     <tournamentId> <baseUrl>
 *
 * Example (FIP Platinum Lusitania 2026):
 *   ... 8d5e9a69-f2d9-473d-bc2e-42334e2e8096 https://portugalmasterpadel.win.webtuga.net
 */
import { createClient } from '@supabase/supabase-js';

const [tournamentId, baseUrl] = process.argv.slice(2);
if (!tournamentId || !baseUrl) {
  console.error('Usage: onboard-webtuga-tournament.ts <tournamentId> <baseUrl>');
  process.exit(1);
}

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
);

const { error } = await supabase.from('entity_external_ids').upsert(
  {
    entity_type: 'tournament',
    entity_id: tournamentId,
    source: 'webtuga_live',
    external_id: baseUrl,
  },
  { onConflict: 'entity_type,source,external_id' },
);

if (error) {
  console.error('upsert failed:', error.message);
  process.exit(1);
}
console.log(`onboarded ${tournamentId} -> ${baseUrl}`);
```

- [ ] **Step 2: Verify the script compiles**

Run: `npx tsc --noEmit`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/onboard-webtuga-tournament.ts
git commit -m "chore(webtuga): tournament onboarding script"
```

- [ ] **Step 4: Manual verification checklist (record results in the PR description)**

1. **Egress check** (run from Railway shell or a Railway one-off, NOT locally):
   `curl -sS https://portugalmasterpadel.win.webtuga.net/api/public/results-feed | head -c 300`
   Expected: JSON array. Confirms webtuga does not block Railway egress.

2. **Onboard Lusitania:**
   `DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/onboard-webtuga-tournament.ts 8d5e9a69-f2d9-473d-bc2e-42334e2e8096 https://portugalmasterpadel.win.webtuga.net`

3. **Dry-run on Railway:** set `ENABLE_WEBTUGA_LIVE=true`, `WEBTUGA_LIVE_DRY_RUN=true`. Watch logs for `webtuga-live-fetcher tick complete` with `resolved > 0`, `unresolved=0`, `ambiguous=0` during live play.

4. **Canary live:** set `WEBTUGA_LIVE_DRY_RUN=false` during a live session. Inspect a resolved match in the DB:
   - `matches.status` flipped to `live`
   - `sets` rows with `score_source='live'`
   - `match_points` rows accumulating across ticks
   - the `entity_external_ids (source='webtuga')` row's `metadata.lastState` advancing
   - confirm a repeat tick with no score change inserts NO new `match_points` (idempotency)

5. **Cooperation check:** when a match finishes, confirm `fip-results-writer` still flips it to `finished` and overwrites the `live` sets with the authoritative final.

---

## Self-Review

**Spec coverage:**
- Worker + ~15s cron + flag/dry-run → Task 5, Task 6. ✔
- DB-config discovery (`source='webtuga_live'`) → Task 4 (`discoverWebtugaTournaments`), Task 7 (onboarding). ✔
- One `results-feed` GET per tournament → Task 1, Task 5. ✔
- Resolution by surname overlap, cached, orientation-aware → Task 2, Task 4, Task 5. ✔
- Adapter → `LiveMatchState`, reuse `diffLiveState`/`applyDiff` → Task 3, Task 5. ✔
- Stateless prev-state via `metadata.lastState` → Task 4, Task 5. ✔
- `score_source='live'` provenance → inherited from `applyDiff` (canonical mode default writes `score_source='live'`); no override needed. ✔
- webtuga never finishes; guarded scheduled→live flip; no notify → Task 5 (`flipStatusToLive`, no `notifyLiveTransition`). ✔
- No migration → Tasks reuse existing tables only. ✔
- Backend-only (no UI) → no UI tasks. ✔
- Testing (adapter/resolver/worker units + manual) → Tasks 2,3,5,7. ✔

**Open items flagged for the implementer (not blockers):**
- Confirm the `entity_external_ids` unique-constraint columns for the `onConflict` strings (Task 4 note).
- The worker test's thenable Supabase chain may need shape tweaks to match the real `.select().eq()` await usage (Task 5 Step 4 note) — adjust the test mock, not the worker.
- `servingTeam` is left `null` in v1 (feed row has no server; the richer `/matches/{id}` endpoint carries `serverTeam`). Enriching from match-detail is a clean follow-up and does not change any table schema.

**Type consistency:** `CandidateMatch`, `ResolveResult`, `MatchCacheEntry`, `WebtugaLiveResult`, `WebtugaFeedRow`, `WebtugaMatchDetail` are defined once and referenced consistently. `ResolvedPlayers` is imported from `point-reconstruction.js` everywhere. Orientation literal `'AB'|'BA'` is consistent across resolver, adapter, and cache.
