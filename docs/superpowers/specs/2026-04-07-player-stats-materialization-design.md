# Player Stats Materialization — Design

**Status:** Backlog (not urgent — revisit post-launch)
**Date:** 2026-04-07
**Related:** Phase 1-5 data-model cleanup (commits 18df7e7 → 754ddf7)

## Problem

The player profile page (`src/app/player/[id]/page.tsx`) currently fetches up to 1000 career matches in a single query and computes every stat client-side via `useMemo`. This works today (Tapia: 371 matches, ~500KB payload, ~1-2s load) but has ceiling issues:

1. **Doesn't scale to veteran players** — a hypothetical player with 2000+ matches would hit Supabase's default 1000-row range cap and silently show partial data.
2. **No reuse across features** — every time we want leaderboards, player comparisons, or week-over-week trend charts, we'd have to re-query and re-compute the same aggregates.
3. **Wasted computation** — career totals (wins, titles, by-partner breakdowns) change slowly but are recomputed on every profile visit.
4. **Large payload** — the profile pulls ~550KB on first paint when it really only needs ~5KB of career stats + ~30KB of recent activity.

## Goal

Pre-compute slow-moving aggregates on a weekly cron and store them on a sidecar table. Profile page reads the snapshot for stats tabs and loads only the most recent 20 matches live, with "load more" pagination for deeper browsing.

## Non-goals

- **Real-time freshness.** Weekly is fine for career stats. A `computed_at` timestamp on the snapshot tells users when it was last updated.
- **Historical snapshots** (week-over-week tracking). Could be added later by replacing UPSERT with INSERT, but not in v1.
- **Live stats during tournaments.** If a player has finished 3 matches this weekend and snapshot ran Sunday night, the by-year counts will lag until next Sunday. Current-year stats can optionally be computed live from the top-20 fetch.

## Data categorization

| Data | Strategy | Rationale |
|---|---|---|
| `total_matches`, `wins`, `losses`, `win_rate` | **Snapshot** | Slow-moving, expensive to compute |
| Career `titles`, `finals` | **Snapshot** | Rarely change |
| Stats by partner (all-time) | **Snapshot** | Grouping over career = expensive, perfect for pre-compute |
| Stats by round (R32/R16/QF/SF/F) | **Snapshot** | Same |
| Stats by tournament level (p1/p2/fip_gold/etc.) | **Snapshot** | Same |
| Season summaries (past years) | **Snapshot** | Immutable once year ends |
| Current year in progress | **Hybrid** (snapshot + live delta from top 20) | Accepts up to 6-day lag |
| **Recent matches (top 20)** | **Live + paginated** | Users expect freshness |
| **Current partner** | **Derived from top 20** | Always "most recent partner" |
| **Last 10 form sparkline** | **Derived from top 20** | Same |

## Schema

New sidecar table, not new columns on `players`:

```sql
CREATE TABLE player_stats_snapshot (
  player_id      UUID PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,

  -- Flat totals for the hero stat chips
  total_matches  INT NOT NULL DEFAULT 0,
  wins           INT NOT NULL DEFAULT 0,
  losses         INT NOT NULL DEFAULT 0,
  win_rate       NUMERIC(5,2),
  titles         INT NOT NULL DEFAULT 0,
  finals         INT NOT NULL DEFAULT 0,

  -- Rich breakdowns as JSONB so we can iterate without migrations
  by_year        JSONB,  -- { "2026": { wins, losses, matches, titles }, "2025": {...} }
  by_partner     JSONB,  -- [{ partner_id, name, country, avatar_url, matches, wins, losses, last_played_at, win_rate }, ...]
  by_round       JSONB,  -- { "Finals": { wins, losses }, "Semifinals": { wins, losses }, ... }
  by_level       JSONB,  -- { "p1": { wins, losses }, "fip_gold": { wins, losses }, ... }

  computed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX player_stats_snapshot_computed_at_idx
  ON player_stats_snapshot (computed_at);
```

**Why a separate table:**
- Keeps the `players` table lean (already 29 columns)
- Can be dropped + recomputed without touching core data
- Enables swapping in a materialized view later if needed
- Clean FK with `ON DELETE CASCADE` — no orphan risk

**Why JSONB for breakdowns instead of more tables:**
- Shapes will evolve as we learn what's useful
- Partial updates are simple (`jsonb_set`)
- No join overhead on read — the page already wants everything at once
- The downside (no per-key indexing) is moot because we always fetch by `player_id`

## Cron

```
POST /api/cron/compute-player-stats
Schedule: 0 3 * * 0  (Sunday 03:00 UTC)
Timeout:  900 seconds (15 min hard ceiling)
```

Pseudocode:

```ts
const BATCH_SIZE = 50
const MIN_MATCHES = 5  // skip players with too little data

async function run() {
  // Players with at least MIN_MATCHES finished matches
  const { data: players } = await supabase
    .from('players')
    .select('id, category')
    .not('padelapi_id', 'is', null)
    .order('ranking', { ascending: true, nullsFirst: false })

  let processed = 0
  for (const batch of chunked(players, BATCH_SIZE)) {
    await Promise.all(batch.map(p => computeAndStore(p.id)))
    processed += batch.length
    console.log(`[compute-player-stats] ${processed}/${players.length}`)
  }
}

async function computeAndStore(playerId: string) {
  // Fetch ALL finished matches for this player
  const { data: matches } = await supabase
    .from('matches')
    .select(`
      id, status, round, winner_pair, finished_at, started_at,
      tournament:tournaments(name, level),
      pair1_player1:players!matches_pair1_player1_id_fkey(id, name, country, avatar_url),
      pair1_player2:players!matches_pair1_player2_id_fkey(id, name, country, avatar_url),
      pair2_player1:players!matches_pair2_player1_id_fkey(id, name, country, avatar_url),
      pair2_player2:players!matches_pair2_player2_id_fkey(id, name, country, avatar_url)
    `)
    .or(`pair1_player1_id.eq.${playerId},pair1_player2_id.eq.${playerId},pair2_player1_id.eq.${playerId},pair2_player2_id.eq.${playerId}`)
    .in('status', ['finished', 'retired', 'walkover'])
    .not('winner_pair', 'is', null)
    .limit(5000)

  if (!matches || matches.length < MIN_MATCHES) return

  // Compute totals, by_year, by_partner, by_round, by_level
  const snapshot = computeSnapshot(playerId, matches)

  await supabase
    .from('player_stats_snapshot')
    .upsert({ ...snapshot, computed_at: new Date().toISOString() }, { onConflict: 'player_id' })
}
```

**Expected runtime:** ~3150 players × 2 queries each × ~200ms average = ~20 min on current DB. If that's too long we can:
- Run in parallel batches of 50 (already planned)
- Skip players whose `updated_at` hasn't changed since last snapshot
- Split into daily batches (men on weekdays, women on weekends, etc.)

**Computing the snapshot** (`computeSnapshot` helper in `src/lib/player-stats.ts`):

```ts
export function computeSnapshot(playerId: string, matches: MatchRow[]): SnapshotRow {
  // Reuses the same resolveMatchRoles logic the player profile uses today
  // so we don't drift between profile display and snapshot computation

  const totals = { matches: 0, wins: 0, losses: 0 }
  const byYear = new Map<string, YearStats>()
  const byPartner = new Map<string, PartnerStats>()
  const byRound = new Map<string, RoundStats>()
  const byLevel = new Map<string, LevelStats>()

  for (const m of matches) {
    const roles = resolveMatchRoles(m, playerId)
    if (!roles.won && !roles.lost) continue

    totals.matches++
    if (roles.won) totals.wins++
    else totals.losses++

    const year = (m.finished_at ?? m.started_at)?.slice(0, 4) ?? 'unknown'
    // ... accumulate into byYear, byPartner, byRound, byLevel
  }

  return {
    player_id: playerId,
    total_matches: totals.matches,
    wins: totals.wins,
    losses: totals.losses,
    win_rate: totals.matches > 0 ? (totals.wins / totals.matches) * 100 : null,
    by_year: Object.fromEntries(byYear),
    by_partner: [...byPartner.values()].sort((a, b) => b.matches - a.matches),
    by_round: Object.fromEntries(byRound),
    by_level: Object.fromEntries(byLevel),
  }
}
```

Pure function, unit-testable, shared between the cron and any future tools.

## Profile page refactor

Parallel fetch on mount:

```ts
const [playerRes, snapshotRes, recentRes] = await Promise.all([
  supabase.from('players').select('*').eq('id', id).single(),
  supabase.from('player_stats_snapshot').select('*').eq('player_id', id).maybeSingle(),
  supabase.from('matches').select(MATCHES_SELECT).or(...).limit(20),
])
```

Tab responsibilities change:

| Tab | Data source |
|---|---|
| **Hero stat chips** | Snapshot (total, win_rate, titles) + DB `players.ranking` |
| **Overview — Current Partner** | Derived from `recentRes[0..20]` |
| **Overview — Last 10 sparkline** | Derived from `recentRes[0..20]` |
| **Overview — Recent Matches** | First 3 of `recentRes` |
| **Season tab — year chips** | `snapshot.by_year` keys |
| **Season tab — current year chart** | Derived from `recentRes` (filtered to current year) |
| **Season tab — past year chart** | TODO: either store `by_year_monthly` in snapshot, or a second query on tab click |
| **Partners tab** | `snapshot.by_partner` (no grouping loop) |
| **Stats tab** | `snapshot.by_round`, `snapshot.by_level` + `players.{titles, finals}` |
| **Matches tab** | `recentRes` initially, "Load more" paginates in batches of 20 using `finished_at` cursor |

New UI element: a small "Stats updated: 3 days ago" label near the Partners/Season/Stats tab headers so users see when they're looking at snapshot data.

```tsx
{snapshot && (
  <div style={{ fontSize: 10, color: MUTED, textAlign: 'right', padding: '4px 8px' }}>
    Stats updated {timeAgo(snapshot.computed_at)}
  </div>
)}
```

## Pagination pattern

"Load more" on Matches tab — cursor-based, not offset:

```ts
const [matches, setMatches] = useState<MatchRow[]>([])
const [hasMore, setHasMore] = useState(true)

async function loadMore() {
  const cursor = matches.length > 0 ? matches[matches.length - 1].finished_at : null
  const q = supabase.from('matches').select(MATCHES_SELECT).or(...).order('finished_at', { ascending: false, nullsFirst: false }).limit(20)
  if (cursor) q.lt('finished_at', cursor)
  const { data } = await q
  setMatches(prev => [...prev, ...(data ?? [])])
  if (!data || data.length < 20) setHasMore(false)
}
```

Cursor beats `.range(offset, offset+19)` for deep scrolls because offset pagination re-scans everything before the offset each time, while cursor uses the index.

## Expected impact

| Metric | Before | After |
|---|---|---|
| Initial payload | ~550 KB (1000 matches) | ~40 KB (snapshot + 20 matches) |
| Time to first paint | 1-2 s | <300 ms |
| Partner grouping cost | O(n) per render in useMemo | 0 (pre-computed) |
| Stats freshness | Instant (up to 1000 matches) | Weekly (snapshot) + live (recent 20) |
| Scales to | ~1000 matches per player | Unlimited |
| Enables leaderboards | No | Yes — snapshot table is exactly the right shape |
| Enables week-over-week trends | No | With minor change (INSERT instead of UPSERT + history table) |

## Phased rollout

**Phase A — Schema + cron (day 1)**
- Migration adding `player_stats_snapshot` table
- `src/lib/player-stats.ts` with `computeSnapshot()` helper (pure, unit-tested)
- `src/app/api/cron/compute-player-stats/route.ts` batch runner
- Manual trigger endpoint for initial backfill
- Run cron once to populate

**Phase B — Profile page refactor (day 1-2)**
- Fetch snapshot alongside player row
- Feature-flag new path: `?v=snapshot` URL param switches between live-fetch and snapshot path for side-by-side comparison
- Verify numbers match for a handful of players
- Remove flag, kill old path

**Phase C — Pagination + timestamp label (day 2)**
- Add cursor-based "Load more" on Matches tab
- Add "Stats updated X ago" label
- Update `vercel.json` to schedule the weekly cron

**Total effort:** 2-3 engineering days.

## Open questions for later

1. **Monthly breakdown for past years.** Do we store `by_year_monthly` in the snapshot (~4KB per player extra) or fetch on demand when user taps a year chip?
2. **Recomputation triggers.** Weekly is fine by default, but should a match finish during a tournament also trigger a targeted recompute for just the players involved? (Pros: always fresh for active players. Cons: extra load during tournament weekends.)
3. **Player stats sidebar on tournament pages?** Once we have snapshots, the tournament detail page could pre-load stats for the top seeds without additional queries — easy win.
4. **Partner compatibility scores** (advanced feature). With `by_partner` stats available server-side, we can compute "best partner" / "worst partner" / "most consistent partner" widgets. Unlocks the "compare players" feature.
5. **RLS policies.** If we ever let users publish profiles, the `player_stats_snapshot` table needs read-only RLS for anonymous users (simple — all players are public data).

## When to build

**Not now.** Trigger conditions to build this:

- [ ] After launch: measure p50/p95 profile load time with real users
- [ ] If any profile load exceeds 3s on mobile 3G
- [ ] When building leaderboards / compare-players features
- [ ] When we hit our first player with >1000 matches (won't be for a while)
- [ ] When week-over-week stat tracking becomes a product requirement

Current approach (fetch 1000, compute client-side) is fine until at least one of those hits.
