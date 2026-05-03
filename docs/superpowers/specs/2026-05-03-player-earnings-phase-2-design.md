# Phase 2 — Player tournament earnings

**Date:** 2026-05-03
**Predecessor:** [Phase 1 design](2026-05-03-prize-money-normalization-phase-1-design.md) — schema + helpers shipped (PR 1) and 237 tournaments + 7,522 matches backfilled (PR 2).
**End goal:** for each player, sum what they earned per tournament since 2024-01-01, in EUR.

## North star

```sql
SELECT player_id, SUM(per_player_eur) AS career_eur
FROM player_tournament_earnings
WHERE earned_at >= '2024-01-01'
GROUP BY player_id
ORDER BY career_eur DESC;
```

That query is the entire UI contract — career earnings totals per player, plus drill-downs by season / tier / event.

## Decisions locked in (from brainstorm + research)

1. **Currency:** all amounts stored in EUR (Phase 1 decision, unchanged).
2. **Scope:** matches with `finished_at >= 2024-01-01`. No upcoming, no in-progress.
3. **FIP Beyond + FIP Promises are out of scope** — these tiers don't have published prize money. Earnings table never gets rows for them.
4. **Source authority for per-round amounts:**
   - **Premier (Major / P1 / P2 / Finals):** **official Premier Padel rulebook** ([Men's PDF](https://www.padelfip.com/wp-content/uploads/2025/03/Premier-Padel-Rulebook-Men%C2%B4s_EN.pdf), [Women's PDF](https://www.padelfip.com/wp-content/uploads/2025/03/Premier-Padel-Rulebook-Women%C2%B4s_EN.pdf), §8.2). Absolute €/player per round, hardcoded in TS.
   - **FIP Tour (Bronze / Silver / Gold / Platinum):** scraped `prize_breakdown` first if present; otherwise **Cupra FIP Tour Rulebook** ([PDF](https://www.padelfip.com/wp-content/uploads/2025/03/Cupra-FIP-Tour-Rulebook-11_03_25_EN.pdf), §8.2) percentages × `prize_money_eur`.
5. **Gender split:** Premier P1 and P2 are NOT equal-pay (verified in rulebook). Premier Major IS equal. FIP Tour IS equal. Schema must carry `category` (`men` / `women`) per earnings row regardless.
6. **`tournaments.prize_money_eur` represents combined men+women totals** for Premier events (verified: Brussels P2's €264,534 = €154,534 men's + €110,000 women's per rulebooks).
7. **Walkovers and retirements:** the loser of a walkover/retired match still receives the prize for the round they reached (standard tour rule). Earnings calculated by the round at which a player was eliminated, regardless of how the elimination happened.
8. **Manual override:** the existing `/api/ops/tournament-prize` PATCH endpoint (PR 2) gains a sibling for per-round overrides. Out-of-spec events (`Any tournament whose prize or draw does not fit into one of the breakdowns must contact Premier Padel for an approved breakdown`) get fixed via ops UI.

## What gets built

### Schema

```sql
CREATE TABLE public.player_tournament_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  player_id     UUID NOT NULL REFERENCES public.players(id),
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id),

  category      TEXT NOT NULL CHECK (category IN ('men', 'women')),
  round_eliminated TEXT NOT NULL,  -- canonical: F | SF | QF | R16 | R32 | R64 | Q1 | Q2 | Q3
                                   -- 'F' means won the tournament

  per_player_eur INTEGER NOT NULL CHECK (per_player_eur >= 0),

  -- Provenance
  source TEXT NOT NULL CHECK (source IN (
    'premier_rulebook',     -- Premier table lookup
    'fip_breakdown_scraped', -- public.tournaments.prize_breakdown
    'fip_tour_rulebook_pct',-- Cupra rulebook % × prize_money_eur
    'manual'                -- ops UI override
  )),

  earned_at TIMESTAMPTZ NOT NULL,  -- = matches.finished_at, denormalized for fast time-window queries
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (player_id, tournament_id, category)
);

CREATE INDEX player_tournament_earnings_player_id_idx
  ON public.player_tournament_earnings (player_id);
CREATE INDEX player_tournament_earnings_earned_at_idx
  ON public.player_tournament_earnings (earned_at);
```

One row per `(player, tournament, category)` triple. A player can theoretically have two rows for the same tournament if they played both men's and women's draws (mixed events) — in practice this never happens in our data but the schema doesn't preclude it.

`round_eliminated = 'F'` means the player won. The full `F | SF | QF | R16 | R32 | R64 | Q1 | Q2 | Q3` enum reuses the canonical codes from Phase 1.

### Rulebook tables (code-as-truth)

```
src/lib/earnings/
  premier-prize-table.ts       -- absolute €/player, all tiers + genders
  fip-tour-prize-table.ts      -- % per round, all tiers (gender-agnostic)
  __tests__/
    premier-prize-table.test.ts -- spot-check known events (Brussels P2 reconstruction)
    fip-tour-prize-table.test.ts -- spot-check known events (Mendoza Silver reconstruction)
```

These modules are **the spec implementation**. Pure data + lookup functions. Version-stamped with rulebook publication date (e.g. `RULEBOOK_VERSION = '2026'`). When FIP releases a new rulebook, we add a second version and switch on year.

### Computation engine

```
src/lib/earnings/compute-earnings.ts
  computeEarningForMatch(match, tournament): EarningRow[] | null
```

Pure function. Given a finished match and its tournament:
1. Identify each player's **round of elimination** (loser side) AND the winner's terminal round (which is the match's round_canonical when they won).
2. For each player, look up `per_player_eur` per the source-authority chain:
   - Premier tier → `premier-prize-table` lookup
   - FIP Tour with `prize_breakdown` → use scraped value
   - FIP Tour without breakdown but with `prize_money_eur` → `fip-tour-prize-table` % × total
   - Otherwise → return null (no earnings row computed)
3. Return one earning per player.

A round-by-round walk over a tournament's matches produces all earnings rows. Run idempotent: each `(player, tournament, category)` upserts.

### Backfill + ongoing

- **`scripts/backfill-player-earnings.ts`** — sweeps all finished matches since 2024 once, populates the table. Dry-run by default. Same shape as the Phase 1 backfills.
- **Ongoing maintenance (deferred)** — a sync hook that fires on match-finish. Out of scope for this PR; the backfill is enough to ship the feature, and a manual periodic re-run handles new events.

### Display surfaces (separate small PR)

- Player profile page: `Career earnings: €X` stat tile + a small breakdown by tier and by season.
- Optional: ops dashboard "Top earners" leaderboard.

These are intentionally a follow-up — Phase 2 ships when the table is correct and queryable, even before any UI changes.

## Out of scope

- FIP Beyond and FIP Promises — no earnings rows generated.
- Live updates as matches finish (manual backfill re-run is enough; sync hook is a follow-up).
- Currency conversion (locked in: all EUR, manual conversion handled in Phase 1 for the handful of historical USD events).
- Sponsorship / endorsement earnings — completely separate domain.
- Career-earnings UI (separate small PR after Phase 2 lands).
- "Top earners" leaderboard (same — separate small PR).
- Per-round breakdown visualization on tournament pages (later).

## Edge cases

| Case | Handling |
|---|---|
| Walkover loser | Counts as eliminated AT that round → gets the round's prize. |
| Retired loser | Same — they reached that round, earn the prize. |
| Walkover winner who never played | Counts as advanced PAST that round; their elimination is determined by the next match they actually played (or won the final). |
| Same player in both men's and women's draws | Two earning rows, one per category. Schema-allowed. |
| Match with `round_canonical = NULL` | Skip — no row generated. (Group-stage matches, Phase 1 left these unmapped.) |
| Tournament with neither breakdown nor `prize_money_eur` | Skip the entire tournament. Surface in ops UI with a "missing prize data" badge. |
| Premier event flagged "approved breakdown" (off-spec) | Manual override via ops UI. `source = 'manual'`. |
| Player listed in draw but never played any match (DNS) | No row generated (no match to anchor a round). |

## Verification plan

1. **Unit tests on the rulebook tables** reconstruct known events:
   - Brussels P2 men's pool sum = €154,534 (per rulebook table)
   - FIP Silver Mendoza winner per-player = €1,600 (matches scraped breakdown)
   - These tests pin the rulebook tables as the source of truth.
2. **Backfill dry-run** before --apply:
   - Total earnings sum per tier should be sane (Premier total ≈ count × per-event total, FIP totals proportional).
   - Top earners list passes smell test (Tapia, Coello, Lebrón, Galán among top).
3. **Cross-check vs published end-of-season totals.** When media publishes "X earned €Y on tour in 2024", our number should match within ~5%.
4. **Idempotency:** re-running the backfill produces zero new rows + zero updates.

## Coverage projection

| Tier | Strategy | Expected coverage |
|---|---|---|
| Premier (Major / P1 / P2 / Finals) | Rulebook lookup | **100%** |
| FIP Tour with `prize_breakdown` | Scraped data | 94 events, exact |
| FIP Tour without breakdown but with `prize_money_eur` | Rulebook % × total | ~150 events |
| FIP Tour missing both | Manual override | ~10 events |
| FIP Beyond / Promises | Not applicable | 0 (out of scope) |

End state: roughly **95% of historical earnings since 2024 computed automatically.**

## Risks

- **Rulebook revisions.** FIP publishes annually. The version-stamped table approach handles this — when the 2027 rulebook drops, we add a new file and switch by event year. Detect drift by re-running tests after each rulebook update.
- **The `% per player` ambiguity in the Cupra rulebook footnote.** We confirmed empirically it's actually round-collective allocations (sums to 100%). Test: Mendoza Silver winner = 19.97% × €16,024 / 2 = €1,600 ✓. Embedded as a comment in `fip-tour-prize-table.ts` to prevent re-confusion.
- **Scraped `prize_breakdown` quality.** PR 3 (deferred) will fix the parser misses. Until then, ~149 FIP Tour events fall back to the rulebook % rather than scraped exact values. This may produce earnings off by a few % vs reality. Acceptable for v1; the manual override exists.
- **Duplicate tournament rows in DB.** CLAUDE.md flags Pattern B multi-pipeline duplicates. If both rows have matches and we sum across them, we'd inflate earnings. The earnings backfill must dedupe tournaments by name+year before computing.

## Implementation order

Three small PRs:

1. **PR 2A — Rulebook tables + computation engine + tests.** Pure code, no DB writes. Tests reconstruct known events.
2. **PR 2B — Schema migration + backfill script.** Adds `player_tournament_earnings` table, runs the backfill.
3. **PR 2C — Display surfaces.** Career-earnings tile on player page; later, top-earners leaderboard.

Out of this spec but tracked as follow-ups:
- Wire `roundCanonical()` into match write sites so new matches arrive canonical (small).
- PR 3 of Phase 1 — investigate `prize_breakdown` gaps to lift FIP Tour scraped coverage from 94 to ~210 events, raising earnings precision.
- Live earnings sync hook (replace periodic backfill).
