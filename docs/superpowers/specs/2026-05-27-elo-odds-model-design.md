# Elo + Odds Model — Design Spec

**Date:** 2026-05-27
**Status:** v0 proof-of-concept (single-tournament backtest passes; multi-tournament Brier/log-loss validation pending)
**Reference implementation:** [`scripts/simulate-elo-tournaments.ts`](../../../scripts/simulate-elo-tournaments.ts)

## Overview

A probabilistic forecasting model for padel tournaments. Produces:

1. **Per-match win probabilities** — pair1 vs pair2 for any specific match
2. **Per-tournament finish probabilities** — championship %, finalist %, semifinalist % per pair
3. **Betting-market odds** in three formats (decimal, fractional, American) from the same fair probability

Designed for two use cases:

- **Phase 1 — Editorial/social:** "Our model gives Coello/Tapia a 54% chance to win Buenos Aires" — narrative-friendly probabilities and form callouts.
- **Phase 2 — Betting partnership:** compare partner sportsbook prices to our fair probability to detect "value picks", or price markets for the partner directly.

## Why Elo

- **Math is tiny** (~30 lines), no library dependency
- **Well-established for tennis** — Jeff Sackmann's tennis Elo, FiveThirtyEight's tennis Elo, ATP/WTA published methodologies all follow this pattern
- **Per-player rating naturally handles padel doubles** — each match updates all four players, partnerships don't get locked in
- **Outputs are explainable** ("Stupa moved from 2080 to 2110") — fits the social-content goal
- **Cold-start from FIP ranking** means useful predictions even for FIP-tier events with sparse history

## Pipeline

```
FIP rank ──► cold-start Elo prior (per player)
                    │
                    ▼
All finished matches before tournament start
   (K_tier × 0.5^(age_days / halflife))
                    │
                    ▼
Per-player Elo at tournament start ◄── snapshot at (start - 30d) ──► Form column
                    │
                    ▼
Pair Elo = arithmetic mean of two players' Elos
                    │
                    ▼
PER-MATCH:                              PER-TOURNAMENT:
expected_win = 1/(1+10^((opp-me)/400))   20k random-bracket Monte Carlo
                    │                              │
                    ▼                              ▼
fair probability (sums to 100%)         champ% / finalist% / semi%
                    │                              │
                    ▼                              ▼
decimal / fractional / American odds (no vig)
                    │
                    ▼
Optional: apply margin → bookmaker price
Optional: compare against partner book → value detection
```

## 1. Cold-start prior — what we assume before any match data

Every player starts with an Elo derived from their FIP ranking:

```
prior_elo = max(1100, 2200 - 250 × log10(rank))
```

| FIP rank | Starting Elo |
|---|---|
| 1 | 2200 |
| 10 | 1950 |
| 50 | 1775 |
| 100 | 1700 |
| 200 | 1625 |
| 1000 | 1450 |
| Unranked | 1300 (flat default) |

This means the model gives reasonable predictions even for tournaments where we have little or no match history for some entrants.

## 2. Per-match Elo update — long-term skill

Pair Elo = arithmetic mean of the two individual Elos. After each match:

```
expected_win_pair1 = 1 / (1 + 10^((pair2_elo - pair1_elo) / 400))
delta = K × (actual - expected)             # actual = 1 if won, 0 if lost
# Both players on the winning pair gain delta.
# Both players on the losing pair lose delta.
```

**K-factor varies by tournament tier** — higher-stakes events move ratings more:

| Tier | K |
|---|---|
| Premier Major, Premier P1 | 36 |
| Premier P2, FIP Platinum | 30 |
| FIP Gold | 24 |
| FIP Silver | 20 |
| FIP Bronze / Beyond / Promises | 14 |
| Default | 18 |

## 3. Time decay — recency matters

Every match's effective K is weighted by how old the match is, anchored to the tournament's start date (so backtests don't peek at the future):

```
K_effective = K_tier × 0.5 ^ (days_since_match / halflife_days)
```

| Match age | Weight |
|---|---|
| 0 days | 1.00 |
| 90 days | 0.71 |
| 180 days | 0.50 |
| 365 days | 0.25 |
| 540 days | 0.13 |

Default halflife = 180 days (in the same range Sackmann/FiveThirtyEight use). Configurable via `--halflife=N` on the script.

Rationale: padel partnerships rotate often. A Stupa win from 2024 (when he was with a different partner) is less informative about today's Stupa-Yanguas pair than a recent win.

## 4. Form metric — "trending up/down" signal

We snapshot every player's Elo at (tournament_start − 30 days). Pair form = today's pair Elo minus 30-day-ago pair Elo.

```
form = team_elo_now - team_elo_30d_ago
```

| Value | Meaning |
|---|---|
| +50 or more | strong hot streak |
| +20 to +50 | trending up |
| -20 to +20 | stable |
| -20 to -50 | cooling off |
| -50 or worse | slump |

**Currently display-only** — does NOT feed into probability. It's the narrative number ("Josemaría/González are +54 going into Buenos Aires"). A future enhancement is to also add a small fraction of form to effective Elo at evaluation time; we want a multi-tournament backtest first to know if it improves calibration.

## 5. Per-match win probability (the simple case)

For any specific match (scheduled or hypothetical):

```
pair1_elo = (player_a_elo + player_b_elo) / 2
pair2_elo = (player_c_elo + player_d_elo) / 2

p_pair1_wins = 1 / (1 + 10^((pair2_elo - pair1_elo) / 400))
p_pair2_wins = 1 - p_pair1_wins
```

These sum to exactly 1 — padel has no draws.

### Worked example

Albania R16 — Stupaczuk/Yanguas (pair Elo 2060) vs Diestro/Piotto (pair Elo 1797).

```
elo_diff = 1797 - 2060 = -263
p_stupa = 1 / (1 + 10^(-263/400)) = 1 / (1 + 0.220) = 0.819 → 81.9%
p_diestro = 1 - 0.819 = 0.181 → 18.1%
```

Stupa/Yanguas have an 81.9% chance to win that match per the model.

## 6. Per-tournament finish probability (Monte Carlo)

For an entire tournament's championship odds:

1. Pull every pair alive in the bracket at the chosen entry round (default: latest assigned round; for backtests use `--from=R32`)
2. For Premier draws where top seeds bye to R16, collect from R32 *plus* all later rounds so bye-receivers aren't missed (de-dup by sorted player IDs)
3. Run **20,000 random-bracket simulations**. Each simulation:
   - Shuffle the alive pairs into a knockout bracket
   - Play it out using the per-match formula above
   - Track who reached SF / F / Champion
4. Output: per-pair `champ%`, `finalist%`, `semi%`

Random bracket averages over draw-luck. We don't have reliable bracket-slot linkage between rounds in our matches table today — when we do, we can replace random with the actual draw structure and get pair-specific "easier half / harder half" stories.

## 7. From probability to betting odds

Our probability number is **fair (no-vig)**: it represents the model's true belief, with no bookmaker margin baked in. Three standard odds formats convert from it directly.

### Decimal odds (Europe / Asia / global default)

```
decimal = 1 / p
```

Read as: bet $1, get back `decimal` dollars if right (your $1 stake + (decimal-1) profit).

| Probability | Decimal |
|---|---|
| 90% | 1.11 |
| 75% | 1.33 |
| 60% | 1.67 |
| 50% | 2.00 |
| 40% | 2.50 |
| 25% | 4.00 |
| 10% | 10.00 |
| 5% | 20.00 |
| 1% | 100.00 |

### Fractional odds (UK, horse racing tradition)

```
fractional_decimal = (1 - p) / p
# then rounded to a recognizable ratio (1/2, 5/6, 2/1, 5/2, 10/1, ...)
```

Reads as "X to Y" — bet Y, win X profit (plus your Y back). 5/2 means risk 2 to win 5.

| Probability | Fractional (rounded) |
|---|---|
| 80% | 1/4 |
| 67% | 1/2 |
| 50% | 1/1 (evens) |
| 33% | 2/1 |
| 25% | 3/1 |
| 10% | 9/1 |
| 5% | 19/1 |

### American odds / Moneyline (US sportsbooks)

```
if p >= 0.5:
    american = -100 × p / (1 - p)     # favorite → negative
else:
    american = +100 × (1 - p) / p     # underdog → positive
```

Reads as:
- **Negative** (favorite): bet `|american|` to win $100 profit. `-150` means risk $150 to win $100.
- **Positive** (underdog): bet $100 to win `american` profit. `+250` means risk $100 to win $250.

| Probability | American |
|---|---|
| 80% | -400 |
| 67% | -200 |
| 55% | -122 |
| 50% | +100 (or -100 — both are even) |
| 45% | +122 |
| 33% | +200 |
| 25% | +300 |
| 10% | +900 |

### Worked example — full odds table

For Stupa vs Diestro (81.9% / 18.1%):

| Side | Probability | Decimal | Fractional | American |
|---|---|---|---|---|
| Stupa / Yanguas | 81.9% | 1.22 | 1/4 | -452 |
| Diestro / Piotto | 18.1% | 5.52 | 9/2 | +452 |

## 8. The vig / overround — why bookmaker prices ≠ our prices

When a real sportsbook publishes odds, they bake in a margin. The sum of implied probabilities across all outcomes exceeds 100%. Example for a 5-pair outright market:

| Pair | Fair % (model) | Book quote (decimal) | Book implied % |
|---|---|---|---|
| A | 50.0% | 1.85 | 54.0% |
| B | 25.0% | 3.50 | 28.6% |
| C | 15.0% | 5.50 | 18.2% |
| D | 7.0% | 11.00 | 9.1% |
| E | 3.0% | 25.00 | 4.0% |
| **Sum** | **100%** | — | **113.9%** |

That extra **13.9%** is the bookmaker's edge (overround). Padel markets, being niche, typically run 110–120% overround on outrights — much fatter than ATP tennis at ~105%.

### Implied probability from a quoted odds

```
implied_from_decimal     = 1 / decimal
implied_from_american    = 100 / (american + 100)        if american > 0
                         = |american| / (|american| + 100) if american < 0
implied_from_fractional  = denominator / (numerator + denominator)
```

### Value detection (Phase 2 — betting partnership)

For each market the partner offers:

1. Take the partner's price for pair X (e.g. 1.95 decimal)
2. Convert to implied probability: `1 / 1.95 = 51.3%`
3. Compare to our fair probability (e.g. 54.3%)
4. If our probability > implied → there is **positive expected value** (the book is underestimating)
5. If our probability < implied → the book is overestimating (we'd "fade" or skip)

Expected value of a $1 bet at the book's price, given our probability:

```
EV = (decimal - 1) × p - (1 - p) × 1
   = decimal × p - 1
```

For the example above: `1.95 × 0.543 - 1 = +0.059` → 5.9% positive EV per $1 staked. That's a value pick we'd surface to users.

### Pricing a market (also Phase 2 — if a partner wants us to quote)

Apply a target margin (say 8%) by inflating each fair probability:

```
quoted_decimal = 1 / (p × (1 + margin))
```

The fair probabilities normalized over a market sum to 1; multiplying each by `1 + margin` gives a market that sums to `1 + margin` — that's the overround we'd take.

## 9. Configurable knobs

```bash
npx tsx scripts/simulate-elo-tournaments.ts <tournament_uuid> [options]

  --mode=tournament|matches   # default: tournament (championship MC)
                              # matches: per-match win probabilities + odds
  --from=R32                  # bracket entry round (default: auto-detect latest)
  --halflife=180              # time-decay halflife in days (default: 180)
  --date=YYYY-MM-DD           # filter matches mode to a specific day (default: today)
```

Constants in code (would expose as flags if useful):

- `MC_RUNS = 20_000` — Monte Carlo iterations
- `FORM_WINDOW_DAYS = 30` — form snapshot window
- K-factor table by tier (see §2)

## 10. Validation status

| Test | Status | Result |
|---|---|---|
| Buenos Aires P1 men's (R32 entry, no-decay) | done | Champion = our #2 (Chingotto/Galán at 32.6%); all 4 SFs in top 4 |
| Buenos Aires P1 women's (R32 entry, no-decay) | done | Champion = our #2 (Josemaría/González at 32.5%); all 4 SFs in top 4 |
| Buenos Aires P1 (with 180d time decay) | done | Same ordering; field tighter; form column lights up the actual champion (+54 form) |
| **Multi-tournament Brier / log-loss** | **not done** | Need this before publishing probabilities publicly |
| Comparison vs FIP-seeding baseline | not done | Need this to claim model beats raw seeding |

Single-tournament results can be luck. The headline numbers are encouraging but require multi-tournament backtest to be trustworthy.

## 11. Known limitations / not yet addressed

| Gap | Why it matters | Effort to add |
|---|---|---|
| Multi-tournament backtest with log-loss/Brier | Only way to *prove* the model works | ~1 hour |
| Form bonus feeding into probability | Right now form is just narrative | ~30 min |
| Synergy term for partnerships | New pairs may be under/over-rated; padel partnerships rotate | ~2 hours |
| Real bracket slot linkage | Random bracket smooths draw luck; real draw lets us say "Stupa's half is harder" | ~2-4 hours (matches table doesn't carry slot info today) |
| Score-margin signal | 6-0 6-0 and 7-6 7-6 are equal to the model | medium |
| Live in-tournament Elo updates | Day-to-day forecast shifts during play = huge content unlock | ~1 hour |
| Layoff / injury regression-to-mean | A player back from 6-month absence is treated as their pre-injury self | low (heuristic) |
| Main-draw vs qualifying-draw seed disambiguation | `matches.pair*_seed` mixes both; bit us once already | small ingestion fix in padelgod |
| Surface / format adjustment | Not relevant for padel — single surface, single format | n/a |

## 12. Productionization path

Out of scope for the v0 spec but the natural follow-ups:

1. **`/api/tournament-odds/[id]`** — cache 1h, returns the championship Monte Carlo result. Consumed by social-drafts cron + future UI widget.
2. **`/api/match-odds/[match_id]`** — returns per-match win probability + odds. Consumed by the match-detail page.
3. **Daily cron** that recomputes Elo from the latest finished matches, persists to `player_elo_snapshots` table. Saves Monte-Carlo cost on every API hit.
4. **UI surfaces:**
   - Match-detail page: model probability + odds, optionally diffed against bookmaker prices
   - Tournament page: top-4-seed forecast widget
   - Feed / social: auto-generated "biggest movers" / "trending up" posts (already wired into `social-drafts` cron)
5. **Betting partnership integration** — partner's API hits `/api/value-picks` which intersects our model with their odds to highlight value bets.

## 13. Glossary

| Term | Meaning |
|---|---|
| **Elo** | A numeric skill rating; higher = stronger. Standard mathematical chess/tennis rating system. |
| **Pair Elo** | Arithmetic mean of the two players' Elos. |
| **K-factor** | How much a single match moves a player's rating. Bigger K = more responsive, more variance. |
| **Time decay** | Older matches contribute less to current rating. We use a 180-day halflife. |
| **Form** | A pair's Elo change over the last 30 days. Display-only currently. |
| **Fair probability** | Model's true-belief probability, with no bookmaker margin. Sums to 100% across a market. |
| **Implied probability** | The probability backed out of a quoted odds (e.g. `1/decimal`). Includes the bookmaker's margin. |
| **Vig / overround / juice** | Bookmaker's margin. The amount by which the sum of implied probabilities exceeds 100%. |
| **Value pick** | A bet where our fair probability > the book's implied probability — positive expected value. |
| **Decimal odds** | European format. `1 / probability`. Payout per $1 wagered (including stake). |
| **Fractional odds** | UK format. `(1-p)/p` rounded to a ratio. Reads as "X to Y". |
| **American odds / Moneyline** | US format. Negative for favorites, positive for underdogs. |
