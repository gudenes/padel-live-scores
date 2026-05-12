# Upcoming Match Quality Score — Design

**Date:** 2026-05-12
**Status:** Approved for implementation planning
**Author:** brainstorm session

## Goal

Compute a `0–100` integer **quality score** for every upcoming padel match, used to surface the matches worth watching and worth promoting on socials. Internal-only — no end-user-facing stars or labels in v1.

## Non-goals

- Live-match excitement scoring (different problem; covered by point-by-point momentum)
- Finished-match retrospective quality (different problem; uses actual scoreline)
- End-user-facing stars/labels in feed cards (deferred — no UI surface in v1)
- Personalized scoring (no per-user weighting)

## Consumers

| Consumer | v1? | Notes |
|---|---|---|
| **Ops highlight picker** (`/ops/highlight-picker`) | ✅ | Social/content team scans upcoming matches by quality to pick what to post |
| **Feed ranking** (`feed-scoring.ts` multiplier) | ❌ deferred | Wire after the team validates the score for a week against their intuition |
| Push notification gating | ❌ future | "Only ping for matches scoring ≥ X" |

Decoupling feed-ranking from v1 isolates risk — we calibrate against real picks before letting the score touch user-visible ordering.

## Design philosophy

A great match for the feed/socials has **two ingredients**:

1. **Competitiveness** — close ranks make for tight matches, the primary signal
2. **Star draw** — a top-ranked player on court is interesting even in a blowout, especially in early rounds where there's no marquee parity story yet

The formula encodes both, with the **balance shifting by round**: star bonus dominates in qualifiers (no parity story), parity dominates in finals (everyone left is a star).

Tournament tier and round are multiplicative dampers — a balanced FIP Bronze Final can still beat a P1 R128 mismatch, which is the right answer under a competitiveness lens.

## Formula

```
quality = clamp01(
  (parity × star_damper + star_bonus)
  × tier_w
  × round_w
  × unranked_penalty
)
score   = Math.round(quality × 100)              // 0–100 integer
```

### Components

```
pair_eff_rank(p1, p2) = 0.65·min(rankP1, rankP2) + 0.35·max(rankP1, rankP2)
pWin(pA, pB)          = 1 / (1 + 10^((pA − pB) / 400))            // Elo-style
parity                = 1 − 2·|pWin − 0.5|                         // 1 = even, 0 = blowout
star_damper           = 0.5 + 0.5·clamp01((2000 − avg_rank) / 2000)  // 0.5 – 1.0
star_bonus            = α(round) · star_strength(best_rank_on_court) // 0 – 0.35
```

### Round multipliers

| Round | `round_w` | `α` (star-bonus weight) |
|---|---|---|
| Final | **1.15** | 0.00 |
| Semifinal | 0.90 | 0.05 |
| Quarterfinal | 0.80 | 0.10 |
| Round of 16 | 0.70 | 0.15 |
| Round of 32 | 0.62 | 0.20 |
| Round of 64 | 0.55 | 0.25 |
| Round of 128 | 0.48 | 0.30 |
| Qualifying (Q1/Q2/Q3) | 0.40 | 0.35 |
| Unknown / fallback | 0.55 | 0.20 |

Final round goes **above 1.0** so a Final cannot be tied by any earlier round at the same parity — gives Finals a clear lift.

### Tier multipliers

| `tournaments.level` (DB value, lowercased) | `tier_w` |
|---|---|
| `p1` | 1.00 |
| `major` | 0.95 |
| `p2` | 0.85 |
| `premier_mens`, `premier_womens` | 0.85 |
| `fip_gold` | 0.75 |
| `fip_silver` | 0.70 |
| `fip_bronze` | 0.65 |
| unknown / null | 0.70 |

### Star strength (by best rank on court)

| Best ranking on court | `star_strength` |
|---|---|
| 1–5 | 1.00 |
| 6–15 | 0.75 |
| 16–30 | 0.50 |
| 31–60 | 0.25 |
| 61–100 | 0.10 |
| > 100 or null | 0.00 |

### Unranked penalty

If **any** of the 4 players has `ranking IS NULL`:

```
unranked_penalty = 0.15
```

Drops the score by ~85% so unranked-player matches sink to the bottom of the picker, but stay orderable amongst themselves (rather than collapsing to identical zero).

### Round-string normalization

The `matches.round` column carries inconsistent formats from upstream sources: `"Round of 32"`, `"R32"`, `"1/16"`, `"Final"`, `"Q2"`, etc. The implementation normalizes case-insensitively, stripping whitespace:

```
"round of 32" / "r32" / "1/16"   → r32
"round of 16" / "r16" / "1/8"    → r16
"q1" / "q2" / "qualifying"       → q
"final"                          → final
"semifinal" / "1/2" / "sf"       → sf
...
```

## Module API

**Single pure function** in `src/lib/match-quality.ts`:

```ts
export interface MatchQualityInput {
  pair1Rankings: [number | null, number | null]
  pair2Rankings: [number | null, number | null]
  tournamentLevel: string | null   // e.g. "p1", "fip_bronze"
  round: string | null              // e.g. "Round of 32", "Q2", "Final"
}

export function matchQualityScore(input: MatchQualityInput): number
// returns integer in [0, 100]

// Optional debug variant exposes the intermediate components for the ops table tooltip
export function matchQualityBreakdown(input: MatchQualityInput): {
  score: number
  parity: number
  starDamper: number
  starBonus: number
  tierW: number
  roundW: number
  unrankedPenalty: number
}
```

Pure, no DB, no async, no dependencies beyond a small constants module. Caller is responsible for supplying the rankings.

## Ops highlight picker — UI

**Route:** `/ops/highlight-picker` (new tab in the existing ops dashboard nav)

**Auth:** Reuses the existing `ops_token` cookie set by `/ops?token=$CRON_SECRET`. No new auth needed.

**Data source:**

```sql
select m.id, m.round, m.category, m.scheduled_at, m.court, m.status,
       t.name as tournament_name, t.level, t.country,
       p11.name, p11.ranking, p12.name, p12.ranking,
       p21.name, p21.ranking, p22.name, p22.ranking
from matches m
join tournaments t on t.id = m.tournament_id
left join players p11 on p11.id = m.pair1_player1_id
left join players p12 on p12.id = m.pair1_player2_id
left join players p21 on p21.id = m.pair2_player1_id
left join players p22 on p22.id = m.pair2_player2_id
where m.status in ('scheduled', 'upcoming')
  and m.scheduled_at >= now()
  and m.scheduled_at <  now() + interval '72 hours'
order by m.scheduled_at asc
```

Score is computed in JS via `matchQualityScore` per row, then the page sorts by score desc by default.

**Columns:**

| Col | Notes |
|---|---|
| Score | 0–100, with optional tooltip showing breakdown (parity / star_damper / star_bonus / tier_w / round_w / unranked_penalty) |
| Match | "Salazar (#13) / Alonso (#14)  vs  Luján (#50) / Nogueira (#44)" |
| Round | "Round of 32" / "Final" / "Q2" |
| Tournament | Tournament name + tier badge |
| Category | M / W |
| Scheduled | Local time + relative ("in 4h") |
| Court | If present |
| Actions | Link to match page; "Generate draft" stub (out of scope for v1, wire later) |

**Filters / controls:**

- Time window: 24h / 48h / 72h (default 24h)
- Tier multi-select: P1, Major, P2, FIP Gold, FIP Silver, FIP Bronze
- Category: All / Men / Women
- Min-score slider: 0–100, default 0

**Sort:** Score desc by default. Click-to-sort on Score, Scheduled, Tier.

**Display name helper:** The picker MUST render player names using a shared player display-name utility (paternal-surname convention for Spanish names, single surname otherwise). A grep should turn up an existing helper — if not, add one. Without it, "Salazar Bengoechea" displays as "Bengoechea" and the team cannot recognize known players.

## Compute model

**On-read** for v1.

- Feed query for the ops table fetches all 4 rankings + tournament info anyway
- Pure function cost is negligible (a few arithmetic ops per row, ~24 rows in a 24h window)
- Rankings update daily via the FIP rankings cron → score reflects updates next render automatically
- No migration, no invalidation, no stale-data risk

Switch to a stored `matches.quality_score` column **only if** profiling shows the ops table or future feed integration is hot enough to need it.

## Edge cases

| Case | Behavior |
|---|---|
| All 4 players unranked | `unranked_penalty = 0.15` applies; score will be very low (0–5 range). Drops to bottom. |
| 1+ player unranked | Same penalty. Score sinks. |
| Round string unrecognized | `round_w = 0.55`, `α = 0.20` (treats as R64-ish). Logged to console once per unique unknown value. |
| Tournament level null / unknown | `tier_w = 0.70` (between Silver and Gold). Logged once. |
| Same pair vs itself / duplicate IDs | Not handled — caller's responsibility to validate inputs. |
| Walkover / retired upcoming | Should not appear in picker; only `status in ('scheduled', 'upcoming')` queried. Defensive: matches in `walkover` / `retired` status are filtered out at query time, not by formula. |
| Doubles category (men/women) | Formula is category-agnostic. Score uses whatever `ranking` is on the player row (FIP-canonical per source-priority). |

## Test matrix

Unit tests in `src/lib/__tests__/match-quality.test.ts` covering:

### Component tests
- `pair_eff_rank` weighting: best=10, worst=100 → 41.5
- `pWin`: equal effective ranks → 0.5
- `parity`: equal → 1.0; 200 rank gap → ≈0.6
- `star_damper`: avg rank 0 → 1.0; avg 2000 → 0.5; avg 1000 → 0.75
- `star_strength`: 1 → 1.00; 15 → 0.75; 16 → 0.50; 100 → 0.10; 101 → 0
- Round normalization: each input form ("Round of 32", "R32", "1/16") maps to same key

### Integration tests (full formula)
- **Balanced top-10 Final** (p1, all #5-#10) → ≥ 90
- **Balanced Bronze Final** (all rank ~120) → 65–75
- **Top-15 vs mid-50 R32** (p1) → 60–70 (the Salazar/Alonso scenario)
- **Close-ranked mid-pack R64** (p1, all #40-#80) → 50–60
- **Big-name mismatch** (#33 vs #240 at R32) → 25–35 (stays well below balanced same-round)
- **Any unranked player** → < 5
- **Unknown round string** → mid-range, doesn't throw

### Calibration snapshot test
Lock the BA P1 2026-05-12 ranking — the test fixture preserves today's rankings and asserts:
- Salazar/Alonso R32 scores 60–70
- Banchero (#240) vs Borrero (#33) R32 scores 25–35
- Camacho (unranked)/Pozzo Q2 scores < 5

Prevents accidental formula regressions.

## Implementation outline (for the plan)

1. Add `src/lib/match-quality.ts` with `matchQualityScore` + `matchQualityBreakdown` (pure)
2. Add `src/lib/__tests__/match-quality.test.ts` with the matrix above
3. Add `src/app/api/ops/highlight-picker/route.ts` — GET endpoint returning scored upcoming matches (auth via `ops_token`)
4. Add `/ops/highlight-picker` page + table component, link from ops nav
5. Verify a shared player display-name helper exists; if not, add one and use it in the picker
6. Calibrate against 5 days of real upcoming matches; tune star_strength / α weights only if the team flags clear mistakes

No database migration. No padelgod changes. No `feed-scoring.ts` changes (deferred).

## Open questions / future work

- **Feed integration:** after 1–2 weeks of social-team use, wire as multiplier in `feed-scoring.ts` upcoming-match scoring
- **Live-match score:** different formula (point-by-point momentum); separate spec
- **Recent form:** could add a small bonus for players on a win streak; out of scope v1
- **Head-to-head:** historic rivalries (e.g. Galán/Lebrón vs Tapia/Coello) could add a bonus; needs H2H aggregation table; out of scope v1
- **Calibration:** if profiling shows the picker is slow at scale, materialize `matches.quality_score` with invalidation on `players.ranking` updates and player FK changes

## References

- Canonical analogue: [Wheelo Ratings methodology](https://www.wheeloratings.com/tennis_methodology.html) — tennis Elo tier × round multipliers adapted to padel tiers
- Background reading (from the brainstorm research pass):
  - [An Introduction to Tennis Elo — Tennis Abstract](https://www.tennisabstract.com/blog/2019/12/03/an-introduction-to-tennis-elo/)
  - [Weighted Elo rating for tennis match predictions (Kovalchik & Reid, 2021)](https://www.sciencedirect.com/science/article/abs/pii/S0377221721003234)
  - [The NBA Excitement Index — FiveThirtyEight](https://fivethirtyeight.com/features/the-nba-excitement-index/) (post-hoc analogue)
  - [HLTV Rating 2.0](https://www.hltv.org/news/20695/introducing-rating-20) (event-tier × stage weighting)
- Comparison scripts (kept in repo for calibration audits):
  - [scripts/compare-match-quality-scores.mjs](../../../scripts/compare-match-quality-scores.mjs)
  - [scripts/compare-cross-tier-quality.mjs](../../../scripts/compare-cross-tier-quality.mjs)
  - [scripts/score-all-todays-matches.mjs](../../../scripts/score-all-todays-matches.mjs)
