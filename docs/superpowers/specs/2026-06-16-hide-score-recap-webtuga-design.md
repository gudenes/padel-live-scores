# Hide the Score Recap for webtuga-sourced matches

**Date:** 2026-06-16
**Status:** Design approved — ready for implementation plan
**Branch / worktree:** `feat/webtuga-recap-hide` (`.claude/worktrees/recap-hide`)

## Problem

The `webtuga-live-fetcher` worker (shipped in PR #558) writes live point-by-point
into `sets`/`games`/`match_points` for FIP Platinum **qualifying** matches. Those
matches are classified premier-tier in the UI (`isPremierLevel('fip_platinum') === true`),
so on the match-detail page the **"Score Recap" tab** shows.

The Score Recap renders `MatchStatsView`, which — when there is no Crionet
`match_stats` (always the case for FIP qualifying) — falls back to a **breaks-only
view** built from `match_points`
([`src/components/MatchStatsView.tsx:78`](src/components/MatchStatsView.tsx)). With
webtuga now supplying `match_points`, that fallback produces a "recap" computed
from our **best-effort, gappy** point log (15s polling, tiebreak freeze), not real
Crionet stats. It's misleading, so we want to suppress it for webtuga-sourced
matches.

The Score Recap tab only appears on **finished** matches (the tab list's
`isFinished` branch — [`page.tsx:1183`](src/app/[locale]/match/[id]/page.tsx)), so
this is the finished-match case.

## Goal

On match detail, **hide the Score Recap tab when the match is webtuga-sourced.**
Everything else stays: the live hero score, the **Live Feed** tab (the webtuga
feature itself), the Match Journey momentum chart, Players, and H2H.

## Non-goals

- No change to the momentum chart / Live Feed / hero score — only the Score Recap.
- No change for Premier (genuine Crionet) matches — their recap is unaffected.
- No new RLS surface (see Detection).

## Detection: "score not from Crionet" = webtuga-sourced

A match is webtuga-sourced iff it has an `entity_external_ids` row with
`(entity_type='match', source='webtuga')` — the per-match cache row the worker
writes on resolve. This is precise (never misfires on Premier/Crionet matches) and
distinct from `sets.score_source` (which is `'live'` for both webtuga and Crionet
Premier-live, and flips to `'api'` on the Crionet final).

**Why a server-side signal:** `entity_external_ids` has RLS enabled with **no
policies**, so the browser (anon) client reads zero rows from it (same lockdown as
`player_ranking_snapshots`). The flag must be produced server-side (service role).
We will **not** add an anon RLS policy — consistent with the project's existing
"derive server-side rather than open RLS" pattern.

## Architecture

### 1. Server flag via `GET /api/match-stats`

[`src/app/api/match-stats/route.ts`](src/app/api/match-stats/route.ts) already runs
server-side with the service role and looks up the match. Extend its JSON response
with a `webtugaSourced: boolean` field, computed with one indexed lookup:

```ts
const { data: webtugaRow } = await supabase
  .from('entity_external_ids')
  .select('entity_id')
  .eq('entity_type', 'match')
  .eq('source', 'webtuga')
  .eq('entity_id', matchId)
  .maybeSingle()
const webtugaSourced = !!webtugaRow
```

Return `webtugaSourced` in **all** response branches (`upcoming` / `ok` /
`unavailable`). The current `StatsStatus = 'ok' | 'unavailable' | 'upcoming'` is
unchanged.

### 2. Match page consumes the flag

[`src/app/[locale]/match/[id]/page.tsx`](src/app/[locale]/match/[id]/page.tsx) is a
client component. Add:

- State: `const [matchStats, setMatchStats] = useState<MatchStatsResponse | null>(null)`
  (holds `{ status, stats, webtugaSourced }`).
- An effect keyed on `(id, match?.status)` that, when `match.status === 'finished'`,
  fetches `/api/match-stats?matchId=${id}` once and stores the response. (For
  non-finished matches the Score Recap tab never shows, so no fetch is needed.)
- `const webtugaSourced = matchStats?.webtugaSourced ?? false` (defaults false until
  the fetch resolves, so the tab only *disappears* once we positively know it's
  webtuga — no flicker of a wrongly-shown tab beyond the initial load).

### 3. Tab + default-tab gating

- **Tab list** ([`page.tsx:1172`](src/app/[locale]/match/[id]/page.tsx)):
  `const showRecap = (isPremier || breaks.hasData) && !webtugaSourced`
- **Default landing tab** ([`page.tsx:259`](src/app/[locale]/match/[id]/page.tsx)):
  `if (match?.status === 'finished') setSubTab(isPremier && !webtugaSourced ? 'recap' : 'players')`
  so a finished webtuga match lands on Players (a tab that exists) instead of the
  now-removed recap. (The existing defensive tab-correction effect already moves a
  selection off a tab that isn't in the list, but fixing the initial pick avoids a
  visible jump.)

### 4. Avoid a double fetch

The Score Recap content is rendered by `MatchStatsView`, which today fetches
`/api/match-stats` itself on mount. Since the page now fetches the same endpoint:

- Give `MatchStatsView` an optional `preloaded?: MatchStatsResponse` prop. When
  provided, it renders from the prop and skips its internal fetch; when omitted, it
  behaves exactly as today (back-compat for any other caller).
- The page passes `preloaded={matchStats}` where it renders `<MatchStatsView .../>`.

Result: **one** `/api/match-stats` fetch per finished match view, powering both the
tab decision and the recap content. (For finished Premier matches the recap is the
default tab anyway, so eager-fetching it is effectively what already happens.)

## Files

| File | Change |
|---|---|
| `src/app/api/match-stats/route.ts` | Add `webtugaSourced` to the response (all branches) |
| `src/app/[locale]/match/[id]/page.tsx` | Fetch + store match-stats when finished; `webtugaSourced` gates `showRecap` (1172) + default tab (259); pass `preloaded` to `MatchStatsView` |
| `src/components/MatchStatsView.tsx` | Accept optional `preloaded` prop; skip internal fetch when provided |
| `src/app/api/match-stats/__tests__/…` or existing route test | `webtugaSourced` true/false |
| match-page logic test (if a harness exists) | `showRecap` + default-tab with `webtugaSourced` |

## Testing

- **Server:** `/api/match-stats` returns `webtugaSourced: true` for a match with a
  `source='webtuga'` external-id row, `false` otherwise — both within each status
  branch (`unavailable` for a FIP qualifying match, `ok`/`upcoming` as applicable).
- **Client logic:** `showRecap` is false when `webtugaSourced` is true (even though
  `isPremier` is true); default tab for a finished webtuga match is `players`, not
  `recap`. Premier finished match unchanged (recap shown, default recap).
- **`MatchStatsView`:** renders from `preloaded` without fetching when the prop is
  set; still fetches when it isn't.
- **Manual:** on a finished webtuga Lusitania Q2 match — no Score Recap tab, lands
  on Players, Live Feed + momentum still present. On a finished Premier match —
  recap unchanged.

## Risks

- **Eager fetch on finished matches:** the page now fetches `/api/match-stats` for
  every finished match view (previously lazy, on recap-tab open). It's one bounded,
  indexed query and the recap is the default tab for finished Premier matches
  anyway, so the practical cost is negligible. Accepted.
- **First-paint tab flash:** `webtugaSourced` defaults `false` until the fetch
  resolves, so a webtuga match could show the recap tab for a few hundred ms before
  it's removed. Acceptable; the default-tab pick also corrects once the flag loads.
  (Avoidable later by server-rendering the flag, out of scope.)
