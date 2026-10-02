# Coach Pages + Coaches Index — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Server-rendered public coach pages (`/coach/[slug]`) and a ranked coaches index (`/coaches`, Overall/Men/Women), linked from the player-profile Coaches card and the Rankings page.

**Architecture:** Two owner-rights public views (`coach_rankings_public`, `coach_slug_redirects`) expose coach ranking data to the anon key. `src/lib/coach-page-data.ts` holds pure shaping functions (unit-tested) plus fetchers that use `createAnonServerClient()`. Pages are server components with `revalidate = 3600`, following `src/app/[locale]/(app)/ppl/team/[slug]/page.tsx`; a tiny client island handles "+N more".

**Tech Stack:** Postgres (Supabase), Next.js 16 App Router (server components), React 19, next-intl, vitest.

**Spec:** `docs/superpowers/specs/2026-10-02-coach-pages-design.md`

**Ground rules**
- Work ONLY in `/Volumes/Crucial/dev/padel-live-scores/.claude/worktrees/coach-pages` (branch `feat/coach-pages`). Never `cd` to the main repo dir. No `git stash`.
- No production writes (migration apply, deploy) without Gustavo's go-ahead — Task 10.
- AGENTS.md: this Next.js has breaking changes — check `node_modules/next/dist/docs/` before using an unfamiliar API (`permanentRedirect`, `generateMetadata`, `searchParams` as a Promise).
- Tests: `npx vitest run <path>` from the worktree root (default env `node`; component tests need `// @vitest-environment jsdom`). Typecheck: `npx tsc --noEmit`.
- If `node_modules` is missing: `npm install` at the worktree root.
- Styling: copy the look of the player profile — constants from `src/components/home/shared` (`BG_BASE`, `BG_CARD`, `ORANGE`, `GREEN`, `MUTED`, `MEN_BLUE`, `WOMEN_PURPLE`, `CHUNKY`), and `Widget` from `src/app/[locale]/player/[id]/Widget.tsx`.

## File map

| File | Responsibility |
|---|---|
| `supabase/migrations/20261002140000_coach_rankings_public.sql` | 2 public views + grants |
| `scripts/verify-coach-rankings-public.ts` | always-rollback check |
| `src/lib/coach-page-data.ts` | types, pure shaping, fetchers |
| `src/lib/__tests__/coach-page-data.test.ts` | shaping tests |
| `src/app/[locale]/(app)/coach/[slug]/page.tsx` | coach page (server) |
| `src/app/[locale]/(app)/coach/[slug]/ExpandableList.tsx` | "+N more" client island |
| `src/app/[locale]/(app)/coaches/page.tsx` | index (server) |
| `src/app/sitemap-coaches.xml/route.ts` + `src/app/sitemap.xml/route.ts` | sitemap |
| `src/messages/{en,es,pt,it,fr}.json` | `coach` namespace |
| `src/app/[locale]/player/[id]/CoachesCard.tsx`, `page.tsx` | names link to coach pages |
| `src/app/[locale]/(app)/rankings/page.tsx` | "Coaches" link |

---

### Task 1: Migration — public views

**Files:** Create `supabase/migrations/20261002140000_coach_rankings_public.sql`, `scripts/verify-coach-rankings-public.ts`

- [ ] **Step 1: Migration**

```sql
-- Public projections for the coach pages (spec 2026-10-02-coach-pages-design.md).
-- Owner-rights views on purpose (no security_invoker): coaches/player_coaches keep
-- RLS with no anon policy and coach_stats is security_invoker, so these views are
-- the only anon path, exposing only the listed columns. Supabase's advisor flags
-- owner-rights views; these are intentional. Writes are explicitly revoked because
-- Supabase's default privileges grant ALL on new public relations to anon.

set local lock_timeout = '5s';

create or replace view public.coach_rankings_public with (security_barrier = true) as
select
  s.coach_id, s.display_name, s.slug,
  s.player_count,
  s.men_points, s.women_points, s.total_points,
  rank() over (order by s.total_points desc) as rank_overall,
  rank() over (order by s.men_points desc)   as rank_men,
  rank() over (order by s.women_points desc) as rank_women
from public.coach_stats s
where s.status in ('unreviewed', 'verified') and s.player_count > 0;

create or replace view public.coach_slug_redirects with (security_barrier = true) as
select m.slug as old_slug, t.slug as new_slug
from public.coaches m
join public.coaches t on t.id = m.merged_into
where m.status = 'merged';

revoke all on public.coach_rankings_public, public.coach_slug_redirects from public, anon, authenticated;
grant select on public.coach_rankings_public, public.coach_slug_redirects to anon, authenticated, service_role;

do $$
begin
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_rankings_public'), 'coach_rankings_public missing';
  assert exists (select 1 from information_schema.views where table_schema='public' and table_name='coach_slug_redirects'), 'coach_slug_redirects missing';
end $$;

notify pgrst, 'reload schema';
```

Note: `coach_slug_redirects` follows one hop; `merge_coaches` flattens chains, so one hop always reaches a live coach.

- [ ] **Step 2: Verify script** (always rolls back; NOT run in this task)

```ts
// Verifies supabase/migrations/20261002140000_coach_rankings_public.sql in a transaction
// that is ALWAYS rolled back. Run from the worktree root:
//   set -a; source .env.local; set +a; NODE_PATH=$PWD/node_modules npx tsx scripts/verify-coach-rankings-public.ts
import { readFileSync } from 'node:fs'
import { Client } from 'pg'

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const c = new Client({ connectionString: process.env.DATABASE_URL })
  await c.connect()
  try {
    await c.query('begin')
    await c.query(readFileSync('supabase/migrations/20261002140000_coach_rankings_public.sql', 'utf8'))

    const player = (await c.query(`select id from players where coalesce(tier,'pro')='pro' and points > 0 limit 1`)).rows[0].id as string
    const mk = async (name: string, status: string) =>
      (await c.query(`insert into coaches (display_name, normalized_name, slug, status) values ($1, $2, $3, $4) returning id`,
        [name, name.toLowerCase(), name.toLowerCase().replace(/\s+/g, '-'), status])).rows[0].id as string
    const junk = await mk('Zz Junk Verify', 'junk')
    const live = await mk('Zz Live Verify', 'unreviewed')
    const empty = await mk('Zz Empty Verify', 'unreviewed')
    const gone = await mk('Zz Gone Verify', 'unreviewed')
    await c.query(`insert into player_coaches (player_id, coach_id, raw_name, position) values ($1, $2, 'x', 7), ($1, $3, 'y', 8)`, [player, junk, live])
    await c.query(`select merge_coaches($1, $2, false)`, [gone, live])

    const priv = (await c.query(`select
      has_table_privilege('anon','public.coach_rankings_public','SELECT') s1,
      has_table_privilege('anon','public.coach_rankings_public','INSERT') i1,
      has_table_privilege('anon','public.coach_slug_redirects','SELECT') s2,
      has_table_privilege('anon','public.coach_slug_redirects','INSERT') i2`)).rows[0]

    await c.query('set local role anon')
    const cols = (await c.query(`select * from coach_rankings_public limit 1`)).fields.map((f) => f.name).sort()
    const ids = (await c.query(`select coach_id from coach_rankings_public`)).rows.map((r) => r.coach_id as string)
    const pratto = (await c.query(`select rank_overall from coach_rankings_public where slug = 'gustavo-pratto'`)).rows[0]
    const redirect = (await c.query(`select new_slug from coach_slug_redirects where old_slug = 'zz-gone-verify'`)).rows[0]

    const checks = {
      columns: JSON.stringify(cols) === JSON.stringify(['coach_id','display_name','men_points','player_count','rank_men','rank_overall','rank_women','slug','total_points','women_points']),
      liveListed: ids.includes(live),
      junkHidden: !ids.includes(junk),
      zeroPlayerHidden: !ids.includes(empty),
      mergedHidden: !ids.includes(gone),
      prattoRanked: Number(pratto?.rank_overall) >= 1,
      redirectWorks: redirect?.new_slug === 'zz-live-verify',
      anonSelect: priv.s1 && priv.s2,
      anonNoInsert: !priv.i1 && !priv.i2,
    }
    console.log({ cols, ...checks })
    if (!Object.values(checks).every(Boolean)) process.exitCode = 1
  } finally {
    await c.query('rollback').catch(() => {})
    await c.end().catch(() => {})
  }
}
main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 3: Typecheck the script**
Run: `npx tsc --noEmit --skipLibCheck --esModuleInterop --module nodenext --moduleResolution nodenext --target es2022 scripts/verify-coach-rankings-public.ts` → no output.

- [ ] **Step 4: Commit** — `git add supabase/migrations/20261002140000_coach_rankings_public.sql scripts/verify-coach-rankings-public.ts && git commit -m "feat(coaches): public coach ranking + slug redirect views"`

---

### Task 2: Pure shaping functions (TDD)

**Files:** Create `src/lib/coach-page-data.ts` (types + pure functions only in this task), test `src/lib/__tests__/coach-page-data.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest'
import {
  initials, shortPlayerName, splitPlayers, shapeTitles, pickNextMatches, isIndexable, topPlayerNames,
  type CoachPlayer, type FinalRow, type UpcomingRow,
} from '../coach-page-data'

const p = (o: Partial<CoachPlayer> & { id: string }): CoachPlayer => ({
  name: o.id, display_name: null, country: null, category: 'men', ranking: null, points: 0, avatar_url: null, ...o,
})

describe('initials / shortPlayerName', () => {
  it('initials from first and last word', () => {
    expect(initials('Gustavo Pratto')).toBe('GP')
    expect(initials('Martín D’antonio')).toBe('MD')
    expect(initials('Juan')).toBe('J')
  })
  it('short name prefers display_name, else surname', () => {
    expect(shortPlayerName(p({ id: '1', name: 'Agustin Tapia' }))).toBe('Tapia')
    expect(shortPlayerName(p({ id: '2', name: 'Beatriz Caldera Sanchez', display_name: 'Bea Caldera' }))).toBe('Bea Caldera')
  })
})

describe('splitPlayers', () => {
  it('splits by category and sorts by ranking, unranked last', () => {
    const r = splitPlayers([
      p({ id: 'w2', category: 'women', ranking: 14 }),
      p({ id: 'm-unr', category: 'men', ranking: null }),
      p({ id: 'm1', category: 'men', ranking: 1 }),
      p({ id: 'w1', category: 'women', ranking: 11 }),
      p({ id: 'm39', category: 'men', ranking: 39 }),
    ])
    expect(r.men.map((x) => x.id)).toEqual(['m1', 'm39', 'm-unr'])
    expect(r.women.map((x) => x.id)).toEqual(['w1', 'w2'])
  })
})

describe('shapeTitles', () => {
  const coached = new Set(['tapia', 'coello', 'caldera'])
  const row = (o: Partial<FinalRow>): FinalRow => ({
    match_id: 'm', category: 'men', winner_pair: 1,
    pair1: [{ id: 'tapia', name: 'Agustin Tapia', display_name: null }, { id: 'coello', name: 'Arturo Coello', display_name: null }],
    pair2: [{ id: 'x', name: 'X Y', display_name: null }, { id: 'z', name: 'Z W', display_name: null }],
    tournament: { id: 't1', name: 'PARIS MAJOR', level: 'major', starts_at: '2026-09-07T00:00:00Z', ends_at: '2026-09-13T00:00:00Z' },
    ...o,
  })
  it('keeps finals won by a coached player, current year, newest first', () => {
    const r = shapeTitles([
      row({ match_id: 'a' }),
      row({ match_id: 'b', tournament: { id: 't2', name: 'LONDON P1', level: 'p1', starts_at: '2026-08-03T00:00:00Z', ends_at: '2026-08-09T00:00:00Z' } }),
      row({ match_id: 'old', tournament: { id: 't3', name: 'OLD', level: 'p1', starts_at: '2025-08-03T00:00:00Z', ends_at: '2025-08-09T00:00:00Z' } }),
      row({ match_id: 'lost', winner_pair: 2 }),
    ], coached, 2026)
    expect(r.map((t) => t.tournamentName)).toEqual(['PARIS MAJOR', 'LONDON P1'])
    expect(r[0].pair).toBe('Tapia / Coello')
  })
  it('dedupes per tournament + category and drops team-league levels', () => {
    const r = shapeTitles([
      row({ match_id: 'a' }), row({ match_id: 'a2' }),
      row({ match_id: 'ppl', tournament: { id: 't9', name: 'PPL', level: 'ppl', starts_at: '2026-05-01T00:00:00Z', ends_at: '2026-05-02T00:00:00Z' } }),
    ], coached, 2026)
    expect(r).toHaveLength(1)
  })
})

describe('pickNextMatches', () => {
  const now = new Date('2026-10-02T12:00:00Z')
  const m = (id: string, status: string, at: string | null): UpcomingRow => ({
    match_id: id, status, scheduled_at: at, round: 'QF', tournament_name: 'T', pair1: 'A / B', pair2: 'C / D',
  })
  it('live first, then soonest scheduled, drops stale scheduled, max 3', () => {
    const r = pickNextMatches([
      m('later', 'scheduled', '2026-10-03T10:00:00Z'),
      m('stale', 'scheduled', '2026-10-02T06:00:00Z'),
      m('live', 'live', '2026-10-02T09:00:00Z'),
      m('soon', 'scheduled', '2026-10-02T13:00:00Z'),
      m('soon2', 'scheduled', '2026-10-02T14:00:00Z'),
    ], now)
    expect(r.map((x) => x.match_id)).toEqual(['live', 'soon', 'soon2'])
  })
})

describe('isIndexable / topPlayerNames', () => {
  it('noindex when total points are 0', () => {
    expect(isIndexable({ total_points: 0 })).toBe(false)
    expect(isIndexable({ total_points: 12 })).toBe(true)
  })
  it('top two by points with remainder count', () => {
    expect(topPlayerNames([
      p({ id: '1', name: 'A One', points: 5 }), p({ id: '2', name: 'B Two', points: 50 }), p({ id: '3', name: 'C Three', points: 20 }),
    ])).toEqual({ names: ['Two', 'Three'], more: 1 })
  })
})
```

- [ ] **Step 2: Run → FAIL** (`npx vitest run src/lib/__tests__/coach-page-data.test.ts`: cannot resolve module).

- [ ] **Step 3: Implement (pure part)**

```ts
// src/lib/coach-page-data.ts
// Data for /coach/[slug] and /coaches (spec 2026-10-02-coach-pages-design.md).
// Pure shaping functions on top; fetchers (anon server client) below.

export type CoachTab = 'overall' | 'men' | 'women'

export interface CoachRankingRow {
  coach_id: string; display_name: string; slug: string; player_count: number
  men_points: number; women_points: number; total_points: number
  rank_overall: number; rank_men: number; rank_women: number
}

export interface CoachPlayer {
  id: string; name: string; display_name: string | null; country: string | null
  category: string | null; ranking: number | null; points: number | null; avatar_url: string | null
}

export interface PairPlayer { id: string; name: string; display_name: string | null }

export interface FinalRow {
  match_id: string; category: string | null; winner_pair: number | null
  pair1: PairPlayer[]; pair2: PairPlayer[]
  tournament: { id: string; name: string; level: string | null; starts_at: string | null; ends_at: string | null }
}

export interface CoachTitle {
  key: string; tournamentId: string; tournamentName: string; level: string | null
  category: string | null; pair: string; date: string | null
}

export interface UpcomingRow {
  match_id: string; status: string; scheduled_at: string | null; round: string | null
  tournament_name: string; pair1: string; pair2: string
}

const TEAM_LEAGUE_LEVELS = new Set(['ppl', 'ppl_ii'])
const STALE_SCHEDULED_MS = 3 * 60 * 60 * 1000
const LIVE_STATUSES = new Set(['live', 'on_court'])

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]![0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]![0] ?? '' : ''
  return (first + last).toUpperCase()
}

export function shortPlayerName(p: { name: string; display_name: string | null }): string {
  const display = p.display_name?.trim()
  if (display) return display
  const parts = p.name.trim().split(/\s+/)
  return parts.length > 1 ? parts[parts.length - 1]! : p.name.trim()
}

const byRanking = (a: CoachPlayer, b: CoachPlayer) =>
  (a.ranking ?? Number.MAX_SAFE_INTEGER) - (b.ranking ?? Number.MAX_SAFE_INTEGER)

export function splitPlayers(players: CoachPlayer[]): { men: CoachPlayer[]; women: CoachPlayer[] } {
  return {
    men: players.filter((p) => p.category !== 'women').sort(byRanking),
    women: players.filter((p) => p.category === 'women').sort(byRanking),
  }
}

export function shapeTitles(rows: FinalRow[], coachedIds: Set<string>, year: number): CoachTitle[] {
  const seen = new Set<string>()
  const out: CoachTitle[] = []
  for (const r of rows) {
    if (r.winner_pair !== 1 && r.winner_pair !== 2) continue
    if (r.tournament.level && TEAM_LEAGUE_LEVELS.has(r.tournament.level)) continue
    const start = r.tournament.starts_at ? new Date(r.tournament.starts_at) : null
    if (!start || start.getUTCFullYear() !== year) continue
    const winners = r.winner_pair === 1 ? r.pair1 : r.pair2
    if (!winners.some((w) => coachedIds.has(w.id))) continue
    const key = `${r.tournament.id}|${r.category ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      key, tournamentId: r.tournament.id, tournamentName: r.tournament.name, level: r.tournament.level,
      category: r.category, pair: winners.map(shortPlayerName).join(' / '),
      date: r.tournament.ends_at ?? r.tournament.starts_at,
    })
  }
  return out.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
}

export function pickNextMatches(rows: UpcomingRow[], now: Date = new Date()): UpcomingRow[] {
  const cutoff = now.getTime() - STALE_SCHEDULED_MS
  const live = rows.filter((r) => LIVE_STATUSES.has(r.status))
  const scheduled = rows
    .filter((r) => r.status === 'scheduled' && r.scheduled_at && new Date(r.scheduled_at).getTime() >= cutoff)
    .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''))
  return [...live, ...scheduled].slice(0, 3)
}

export function isIndexable(row: { total_points: number }): boolean {
  return Number(row.total_points) > 0
}

export function topPlayerNames(players: CoachPlayer[]): { names: string[]; more: number } {
  const sorted = [...players].sort((a, b) => Number(b.points ?? 0) - Number(a.points ?? 0))
  return { names: sorted.slice(0, 2).map(shortPlayerName), more: Math.max(0, sorted.length - 2) }
}
```

- [ ] **Step 4: Run → PASS.**
- [ ] **Step 5: Commit** — `git commit -am`-style: `git add src/lib/coach-page-data.ts src/lib/__tests__/coach-page-data.test.ts && git commit -m "feat(coaches): pure shaping for coach pages"`

---

### Task 3: Fetchers

**Files:** Modify `src/lib/coach-page-data.ts` (append)

- [ ] **Step 1: Append fetchers**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

const PLAYER_COLS = 'id, name, display_name, country, category, ranking, points, avatar_url'
const PAIR_EMBED =
  'pair1_player1:players!matches_pair1_player1_id_fkey(id, name, display_name),' +
  'pair1_player2:players!matches_pair1_player2_id_fkey(id, name, display_name),' +
  'pair2_player1:players!matches_pair2_player1_id_fkey(id, name, display_name),' +
  'pair2_player2:players!matches_pair2_player2_id_fkey(id, name, display_name)'

type MatchWithPairs = {
  id: string; status: string; scheduled_at: string | null; round: string | null; category: string | null; winner_pair: number | null
  tournament: FinalRow['tournament'] | null
  pair1_player1: PairPlayer | null; pair1_player2: PairPlayer | null; pair2_player1: PairPlayer | null; pair2_player2: PairPlayer | null
}

const involving = (ids: string[]) => {
  const list = ids.join(',')
  return `pair1_player1_id.in.(${list}),pair1_player2_id.in.(${list}),pair2_player1_id.in.(${list}),pair2_player2_id.in.(${list})`
}
const pairOf = (a: PairPlayer | null, b: PairPlayer | null) => [a, b].filter((x): x is PairPlayer => !!x)

export type CoachPageResult =
  | { kind: 'ok'; coach: CoachRankingRow; players: CoachPlayer[]; titles: CoachTitle[]; next: UpcomingRow[]; year: number }
  | { kind: 'redirect'; slug: string }
  | { kind: 'not_found' }

export async function fetchCoachPage(sb: SupabaseClient, slug: string, now: Date = new Date()): Promise<CoachPageResult> {
  const { data: coach, error } = await sb.from('coach_rankings_public').select('*').eq('slug', slug).maybeSingle()
  if (error) throw new Error(`coach_rankings_public: ${error.message}`)
  if (!coach) {
    const { data: r } = await sb.from('coach_slug_redirects').select('new_slug').eq('old_slug', slug).maybeSingle()
    return r?.new_slug ? { kind: 'redirect', slug: r.new_slug } : { kind: 'not_found' }
  }

  const { data: links, error: linkErr } = await sb.from('player_coaches_public').select('player_id').eq('coach_id', coach.coach_id)
  if (linkErr) throw new Error(`player_coaches_public: ${linkErr.message}`)
  const ids = (links ?? []).map((l) => l.player_id as string)
  const { data: players, error: pErr } = ids.length
    ? await sb.from('players').select(PLAYER_COLS).in('id', ids)
    : { data: [], error: null }
  if (pErr) throw new Error(`players: ${pErr.message}`)

  const year = now.getUTCFullYear()
  let titles: CoachTitle[] = []
  let next: UpcomingRow[] = []
  if (ids.length) {
    const [finals, upcoming] = await Promise.all([
      sb.from('matches')
        .select(`id, status, scheduled_at, round, category, winner_pair, tournament:tournaments!inner(id, name, level, starts_at, ends_at), ${PAIR_EMBED}`)
        .in('round', ['Final', 'Finals'])
        .eq('status', 'finished')
        .gte('tournament.starts_at', `${year}-01-01`)
        .or(involving(ids))
        .limit(200),
      sb.from('matches')
        .select(`id, status, scheduled_at, round, category, winner_pair, tournament:tournaments(id, name, level, starts_at, ends_at), ${PAIR_EMBED}`)
        .in('status', ['live', 'on_court', 'scheduled'])
        .gte('scheduled_at', new Date(now.getTime() - 3 * 3600_000).toISOString())
        .or(involving(ids))
        .order('scheduled_at')
        .limit(20),
    ])
    if (finals.error) console.warn('[coach] titles query failed', finals.error.message)
    else {
      const rows = (finals.data as unknown as MatchWithPairs[]).filter((m) => m.tournament).map((m): FinalRow => ({
        match_id: m.id, category: m.category, winner_pair: m.winner_pair,
        pair1: pairOf(m.pair1_player1, m.pair1_player2), pair2: pairOf(m.pair2_player1, m.pair2_player2),
        tournament: m.tournament!,
      }))
      titles = shapeTitles(rows, new Set(ids), year)
    }
    if (upcoming.error) console.warn('[coach] next matches query failed', upcoming.error.message)
    else {
      const rows = (upcoming.data as unknown as MatchWithPairs[]).map((m): UpcomingRow => ({
        match_id: m.id, status: m.status, scheduled_at: m.scheduled_at, round: m.round,
        tournament_name: m.tournament?.name ?? '',
        pair1: pairOf(m.pair1_player1, m.pair1_player2).map(shortPlayerName).join(' / '),
        pair2: pairOf(m.pair2_player1, m.pair2_player2).map(shortPlayerName).join(' / '),
      }))
      next = pickNextMatches(rows, now)
    }
  }

  return { kind: 'ok', coach: coach as CoachRankingRow, players: (players ?? []) as CoachPlayer[], titles, next, year }
}

export const INDEX_PAGE_SIZE = 50

export interface CoachIndexRow extends CoachRankingRow { top: { names: string[]; more: number } }

export async function fetchCoachesIndex(
  sb: SupabaseClient, tab: CoachTab, page: number,
): Promise<{ rows: CoachIndexRow[]; hasMore: boolean }> {
  const col = tab === 'men' ? 'men_points' : tab === 'women' ? 'women_points' : 'total_points'
  const from = (page - 1) * INDEX_PAGE_SIZE
  let q = sb.from('coach_rankings_public').select('*')
  if (tab !== 'overall') q = q.gt(col, 0)
  const { data, error } = await q.order(col, { ascending: false }).order('display_name').range(from, from + INDEX_PAGE_SIZE)
  if (error) throw new Error(`coach_rankings_public: ${error.message}`)
  const all = (data ?? []) as CoachRankingRow[]
  const rows = all.slice(0, INDEX_PAGE_SIZE)

  const coachIds = rows.map((r) => r.coach_id)
  const byCoach = new Map<string, CoachPlayer[]>()
  if (coachIds.length) {
    const { data: links } = await sb.from('player_coaches_public').select('coach_id, player_id').in('coach_id', coachIds)
    const playerIds = [...new Set((links ?? []).map((l) => l.player_id as string))]
    const players = new Map<string, CoachPlayer>()
    for (let i = 0; i < playerIds.length; i += 200) {
      const { data: ps } = await sb.from('players').select(PLAYER_COLS).in('id', playerIds.slice(i, i + 200))
      for (const p of (ps ?? []) as CoachPlayer[]) players.set(p.id, p)
    }
    for (const l of links ?? []) {
      const p = players.get(l.player_id as string)
      if (!p) continue
      if (tab === 'men' && p.category === 'women') continue
      if (tab === 'women' && p.category !== 'women') continue
      byCoach.set(l.coach_id as string, [...(byCoach.get(l.coach_id as string) ?? []), p])
    }
  }
  return {
    rows: rows.map((r) => ({ ...r, top: topPlayerNames(byCoach.get(r.coach_id) ?? []) })),
    hasMore: all.length > INDEX_PAGE_SIZE,
  }
}
```

(Move the `import type` to the top of the file.) The `.or()` filter interpolates ids that come from our own DB (uuids), never user input.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` → 0 errors. Unit tests still pass.
- [ ] **Step 3: Commit** — `git commit -m "feat(coaches): coach page + index fetchers"`

---

### Task 4: i18n — `coach` namespace

**Files:** `src/messages/{en,es,pt,it,fr}.json` — add a top-level `"coach": { … }` object (sibling of `"player"`).

- [ ] **Step 1: Add keys** (en shown; translate all five — values below):

| key | en | es | pt | it | fr |
|---|---|---|---|---|---|
| `pageLabel` | Coach | Entrenador | Treinador | Allenatore | Entraîneur |
| `rankChip` | #{rank} coach | #{rank} entrenador | #{rank} treinador | #{rank} allenatore | #{rank} entraîneur |
| `subtitle` | `Coach · {players, plural, one {# player} other {# players}} · {titles, plural, =0 {no titles in {year}} one {# title in {year}} other {# titles in {year}}}` | `Entrenador · {players, plural, one {# jugador} other {# jugadores}} · {titles, plural, =0 {sin títulos en {year}} one {# título en {year}} other {# títulos en {year}}}` | `Treinador · {players, plural, one {# jogador} other {# jogadores}} · {titles, plural, =0 {sem títulos em {year}} one {# título em {year}} other {# títulos em {year}}}` | `Allenatore · {players, plural, one {# giocatore} other {# giocatori}} · {titles, plural, =0 {nessun titolo nel {year}} one {# titolo nel {year}} other {# titoli nel {year}}}` | `Entraîneur · {players, plural, one {# joueur} other {# joueurs}} · {titles, plural, =0 {aucun titre en {year}} one {# titre en {year}} other {# titres en {year}}}` |
| `menPoints` | Men pts | Pts masc. | Pts masc. | Pti maschili | Pts hommes |
| `womenPoints` | Women pts | Pts fem. | Pts fem. | Pti femminili | Pts femmes |
| `playersCount` | `{count, plural, one {# player} other {# players}}` | `{count, plural, one {# jugador} other {# jugadores}}` | `{count, plural, one {# jogador} other {# jogadores}}` | `{count, plural, one {# giocatore} other {# giocatori}}` | `{count, plural, one {# joueur} other {# joueurs}}` |
| `nextMatches` | Next matches | Próximos partidos | Próximos jogos | Prossime partite | Prochains matchs |
| `live` | Live | En directo | Ao vivo | Live | En direct |
| `players` | Players | Jugadores | Jogadores | Giocatori | Joueurs |
| `men` | Men | Masculino | Masculino | Maschile | Hommes |
| `women` | Women | Femenino | Feminino | Femminile | Femmes |
| `titles` | Titles {year} | Títulos {year} | Títulos {year} | Titoli {year} | Titres {year} |
| `titlesFootnote` | Titles won by the players this coach works with today. | Títulos ganados por los jugadores que entrena actualmente. | Títulos conquistados pelos jogadores que treina atualmente. | Titoli vinti dai giocatori che allena attualmente. | Titres remportés par les joueurs qu’il entraîne actuellement. |
| `showMore` | `+{count} more` | `+{count} más` | `+{count} mais` | `+{count} altri` | `+{count} de plus` |
| `indexTitle` | Coaches | Entrenadores | Treinadores | Allenatori | Entraîneurs |
| `indexIntro` | Ranked by their players' FIP points | Ordenados por los puntos FIP de sus jugadores | Ordenados pelos pontos FIP dos seus jogadores | Ordinati per i punti FIP dei loro giocatori | Classés selon les points FIP de leurs joueurs |
| `tabOverall` | Overall | General | Geral | Generale | Général |
| `tabMen` | Men | Masculino | Masculino | Maschile | Hommes |
| `tabWomen` | Women | Femenino | Feminino | Femminile | Femmes |
| `loadMore` | Show more | Ver más | Ver mais | Mostra altri | Voir plus |
| `metaTitle` | `{name} — Padel coach \| Padel Nachos` | `{name} — Entrenador de pádel \| Padel Nachos` | `{name} — Treinador de padel \| Padel Nachos` | `{name} — Allenatore di padel \| Padel Nachos` | `{name} — Entraîneur de padel \| Padel Nachos` |
| `metaDescription` | `{name} coaches {players}. Rankings, titles and next matches of every player.` | `{name} entrena a {players}. Rankings, títulos y próximos partidos de cada jugador.` | `{name} treina {players}. Rankings, títulos e próximos jogos de cada jogador.` | `{name} allena {players}. Ranking, titoli e prossime partite di ogni giocatore.` | `{name} entraîne {players}. Classements, titres et prochains matchs de chaque joueur.` |
| `indexMetaTitle` | `Padel coaches ranking \| Padel Nachos` | `Ranking de entrenadores de pádel \| Padel Nachos` | `Ranking de treinadores de padel \| Padel Nachos` | `Classifica allenatori di padel \| Padel Nachos` | `Classement des entraîneurs de padel \| Padel Nachos` |
| `indexMetaDescription` | `The top padel coaches, ranked by their players' FIP points.` | `Los mejores entrenadores de pádel, ordenados por los puntos FIP de sus jugadores.` | `Os melhores treinadores de padel, ordenados pelos pontos FIP dos seus jogadores.` | `I migliori allenatori di padel, ordinati per i punti FIP dei loro giocatori.` | `Les meilleurs entraîneurs de padel, classés selon les points FIP de leurs joueurs.` |
| `rankingsLink` | Coaches | Entrenadores | Treinadores | Allenatori | Entraîneurs |

(In JSON the `\|` is a plain `|`.)

- [ ] **Step 2: Validate** — add `src/lib/__tests__/coach-i18n.test.ts`: for each locale, `createTranslator({ locale, messages, namespace: 'coach' })` formats every key above (with sample params) without throwing and returns a non-empty string; `subtitle` with `titles: 0` and `titles: 2` differ. Run it.
- [ ] **Step 3: Commit** — `git commit -m "feat(coaches): coach page strings in 5 locales"`

---

### Task 5: Coach page

**Files:** Create `src/app/[locale]/(app)/coach/[slug]/page.tsx`, `src/app/[locale]/(app)/coach/[slug]/ExpandableList.tsx`

- [ ] **Step 1: `ExpandableList.tsx`** (client island for "+N more")

```tsx
'use client'
import { useState, type ReactNode } from 'react'

export function ExpandableList({ items, initial, moreLabel }: { items: ReactNode[]; initial: number; moreLabel: string }) {
  const [open, setOpen] = useState(false)
  const shown = open ? items : items.slice(0, initial)
  return (
    <>
      {shown}
      {!open && items.length > initial && (
        <button type="button" onClick={() => setOpen(true)}
          style={{ display: 'block', width: '100%', marginTop: 4, background: 'none', border: 'none', color: '#6B7280', fontSize: 11, cursor: 'pointer', padding: 6 }}>
          {moreLabel}
        </button>
      )}
    </>
  )
}
```
(`moreLabel` is passed already-translated with the count.)

- [ ] **Step 2: `page.tsx`** — server component. Required behaviour (write it following `ppl/team/[slug]/page.tsx`):
  - `export const revalidate = 3600`; `type Props = { params: Promise<{ locale: string; slug: string }> }`.
  - `const result = await fetchCoachPage(createAnonServerClient(), slug)` (wrap in React `cache()` so `generateMetadata` and the page share one fetch per request).
  - `redirect` → `permanentRedirect(`/${locale === 'en' ? '' : locale + '/'}coach/${result.slug}`)` (check the Next docs for `permanentRedirect` in this version; prefer the locale-aware `redirect` from `@/i18n/navigation` if it supports permanent redirects). `not_found` → `notFound()`.
  - `generateMetadata`: title `t('metaTitle', { name })`; description `t('metaDescription', { name, players: first 3 player short names joined with ", " })`; canonical + `languages` for the 5 locales exactly like the PPL page (`${BASE_URL}/${locale}/coach/${slug}`); `robots: isIndexable(coach) ? undefined : { index: false, follow: true }`.
  - JSON-LD: `{ '@context': 'https://schema.org', '@type': 'Person', name, jobTitle: 'Padel coach', url: canonical }`.
  - Layout (`maxWidth: 500, margin: '0 auto', background: BG_BASE, minHeight: '100vh'`, padding 12, cards via `Widget`):
    1. Header card: initials avatar (58px circle, ORANGE bg, black text), chip `t('rankChip', { rank: coach.rank_overall })` (GREEN bg, chunky clip-path like the player ranking pill), name (19px/800), subtitle `t('subtitle', { players: coach.player_count, titles: titles.length, year })`.
    2. Points tiles (2-column grid): men tile only if `men.length > 0`, women tile only if `women.length > 0`; value = `Math.round(coach.men_points).toLocaleString()` (GREEN) / women (ORANGE); sub-line `t('playersCount', { count })`.
    3. Next matches (`Widget wide label={t('nextMatches')}`) only if `next.length`: each row = chip (`t('live')` red for live/on_court, else formatted `scheduled_at` via next-intl `getFormatter` dateTime `{ weekday: 'short', hour: '2-digit', minute: '2-digit' }`), round, tournament name, `pair1 vs pair2`.
    4. Players (`Widget wide label={t('players')}`): sub-headings `t('men')` / `t('women')` (only non-empty groups); rows are `Link` (from `@/i18n/navigation`) to `/player/${id}` with initials avatar (MEN_BLUE / WOMEN_PURPLE bg), name (`display_name || name`), `FlagImage` (check `src/components/FlagImage.tsx` export/props), ranking `#N` (GREEN) + points (MUTED). Use `ExpandableList` with `initial={6}` over the combined men-then-women row list (headings included as items) and `moreLabel={t('showMore', { count: total - 6 })}`.
    5. Titles (`Widget wide label={t('titles', { year })}`) only if `titles.length`: rows = level chip (uppercase level, ORANGE bg for major/finals, GREEN for p1/p2, WOMEN_PURPLE for fip_*), tournament name (title-cased), pair + formatted date; `ExpandableList initial={4}`; footnote `t('titlesFootnote')` (9px MUTED).
  - Players-query errors throw (Next error boundary); titles/next failures are already swallowed in the fetcher.

- [ ] **Step 3: Typecheck + tests** — `npx tsc --noEmit`, `npx vitest run src/lib`.
- [ ] **Step 4: Commit** — `git commit -m "feat(coaches): /coach/[slug] page"`

---

### Task 6: Coaches index

**Files:** Create `src/app/[locale]/(app)/coaches/page.tsx`

- [ ] **Step 1: Implement** — server component, `revalidate = 3600`, `type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ tab?: string; page?: string }> }`.
  - `tab` ∈ overall|men|women (default overall); `page` = positive int (default 1).
  - `fetchCoachesIndex(createAnonServerClient(), tab, page)`.
  - Header: `<h1>` `t('indexTitle')` styled like the Rankings page title; intro `t('indexIntro')`.
  - Tabs: three `Link`s to `/coaches?tab=…` (active = white + GREEN underline, inactive MUTED), server-rendered.
  - Rows (one `Widget wide` card): position = rank for the tab (`rank_overall` / `rank_men` / `rank_women`; top 3 in ORANGE), initials avatar (ORANGE for top 3, #555 otherwise), name + `top.names.join(', ')` + (`top.more ? ' +' + top.more : ''`) in MUTED, points for the tab (GREEN, rounded, `toLocaleString`), `t('playersCount', { count: player_count })`. Whole row is a `Link` to `/coach/${slug}`.
  - `hasMore` → `Link` to `?tab=${tab}&page=${page + 1}` labelled `t('loadMore')`.
  - `generateMetadata`: `indexMetaTitle` / `indexMetaDescription`, canonical `${BASE_URL}/${locale}/coaches` (tab/page not in canonical), hreflang for 5 locales.
- [ ] **Step 2: Typecheck** — `npx tsc --noEmit`.
- [ ] **Step 3: Commit** — `git commit -m "feat(coaches): /coaches index with overall/men/women tabs"`

---

### Task 7: Sitemap

**Files:** Create `src/app/sitemap-coaches.xml/route.ts`; modify `src/app/sitemap.xml/route.ts`

- [ ] **Step 1: Child sitemap** (mirror `sitemap-players.xml/route.ts`)

```ts
// src/app/sitemap-coaches.xml/route.ts
// Child sitemap — the coaches index + every indexable coach page (players with
// > 0 pro points; zero-point coaches render noindex). 5 locales per URL.
import { createAnonServerClient } from '@/lib/supabase'
import { buildUrlSet, expandPathForLocales, xmlResponse, type SitemapUrl } from '@/lib/sitemap-xml'

const BASE_URL = 'https://padelnachos.com'
export const revalidate = 3600

export async function GET() {
  const { data, error } = await createAnonServerClient()
    .from('coach_rankings_public')
    .select('slug')
    .gt('total_points', 0)
    .order('total_points', { ascending: false })
    .limit(5000)
  if (error) return xmlResponse(buildUrlSet([]), revalidate)
  const urls: SitemapUrl[] = [
    ...expandPathForLocales(BASE_URL, '/coaches', { changefreq: 'weekly', priority: 0.6 }),
    ...(data ?? []).flatMap((c) => expandPathForLocales(BASE_URL, `/coach/${c.slug}`, { changefreq: 'weekly', priority: 0.5 })),
  ]
  return xmlResponse(buildUrlSet(urls), revalidate)
}
```

- [ ] **Step 2:** In `src/app/sitemap.xml/route.ts` add `{ loc: \`${BASE_URL}/sitemap-coaches.xml\`, lastmod: now },` after the players entry.
- [ ] **Step 3:** If `src/proxy.ts` or `public/robots.txt` lists sitemaps or allow-lists paths, add `/coach` and `/coaches` the same way (grep for `sitemap-players` and `/player`).
- [ ] **Step 4: Commit** — `git commit -m "feat(coaches): sitemap-coaches.xml"`

---

### Task 8: Links in

**Prerequisite:** PR #637 (comma-separated Coaches card + Current Partner i18n) must be on this branch. If it's merged to `main`: `git merge origin/main`. If not yet: `git merge origin/fix/player-profile-i18n`. Resolve nothing else.

**Files:** `src/app/[locale]/player/[id]/CoachesCard.tsx`, its test, `src/app/[locale]/player/[id]/page.tsx`, `src/app/[locale]/(app)/rankings/page.tsx`

- [ ] **Step 1:** `ProfileCoach` gets `slug: string`; the profile fetch selects `coach_id, display_name, slug, position` and maps `slug`.
- [ ] **Step 2:** In `CoachesCard`, wrap each name (`<span data-testid="coach-name">`) in `Link` from `@/i18n/navigation` → `/coach/${c.slug}` (inherit color, no underline). Update the test fixtures with `slug` and add an assertion that the first name's closest `a` has `href` ending `/coach/gustavo-pratto` (mock `@/i18n/navigation`'s `Link` as a plain `<a>` with `vi.mock` if it needs routing context).
- [ ] **Step 3:** Rankings page header (next to the search button, `src/app/[locale]/(app)/rankings/page.tsx` ~line 581): a `Link` to `/coaches` labelled `useTranslations('coach')('rankingsLink')`, styled as a small MUTED uppercase text link.
- [ ] **Step 4:** `npx tsc --noEmit`, `npx vitest run "src/app/[locale]/player" src/lib`.
- [ ] **Step 5: Commit** — `git commit -m "feat(coaches): link coach names and rankings to coach pages"`

---

### Task 9: Full check (no prod)

- [ ] `npx tsc --noEmit` → 0 errors; `npx vitest run src/lib "src/app/[locale]/player"` → green; `npx eslint` on all new/changed files → no new errors.
- [ ] `npm run build` must succeed (it validates the new server routes). If it needs env vars, copy `.env.local` from the main checkout first.

---

### Task 10: Verify + rollout (each prod step needs Gustavo's go-ahead)

1. **Ask → run** `scripts/verify-coach-rankings-public.ts` against prod (rolled back). Expect all checks true.
2. **Ask → apply** the migration via pg + `DATABASE_URL`; confirm with the anon key that `coach_rankings_public` returns Pratto rank 1 and `coach_slug_redirects` has rows for today's merges (e.g. `martin-d-antonio`).
3. **Browser** (local dev server from this worktree, port 3023, launch entry added to the main checkout's `.claude/launch.json` and removed afterwards):
   - `/coach/gustavo-pratto`: #1 chip, 9 players, 9 titles, next match if any, "+3 more" expands.
   - `/coach/claudio-gilardoni`: no men tile if he has no men players (else both).
   - a 1-player coach, a 0-point coach (`<meta name="robots" content="noindex…">` present).
   - `/coach/martin-d-antonio` → 308 to `/coach/martin-dantonio`; unknown slug → 404.
   - `/coaches` overall/men/women + "Show more"; `/es/coaches`, `/es/coach/gustavo-pratto` strings.
   - Player profile Coaches card names link to the right coach; Rankings link works; mobile 375px.
4. **Ask → PR → merge → web deploy** with `./scripts/deploy.sh web` from a detached checkout outside `.claude/` (`git worktree add --detach /Volumes/Crucial/dev/padel-deploy-web origin/main`, `railway link --project ec638a56-c42f-4fa6-9216-dcd7668e34b7 --environment production --service padelnachos`); verify `/api/version`, then `curl -s -o /dev/null -w '%{http_code}' https://padelnachos.com/coaches` → 200 and `https://padelnachos.com/sitemap-coaches.xml` lists coach URLs.
5. Gustavo submits `sitemap-coaches.xml` in Search Console.
