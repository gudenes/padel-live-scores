# Play the Next — market idea bank

**Living document.** Every entry carries what settles it and what blocks it, so this stays a work queue rather than a wishlist. Anything without a resolution source does not belong here.

Related: [spec](superpowers/specs/2026-09-23-prediction-market-design.md) · [phase-1 plan](superpowers/plans/2026-09-23-play-prediction-market-phase-1.md)

---

## The two structures — pick deliberately

This is the decision that most often gets made by accident.

| | **Binary** (YES/NO) | **Categorical** (N options) |
|---|---|---|
| Use when | **Several answers can be true at once** | **Exactly one answer can be true** |
| Prices | do *not* sum to 100 — and shouldn't | sum to 100 by construction |
| Example | "Will Virseda qualify?" — she and Salazar can both qualify | "Who takes the last Finals spot?" — only one can |
| Engine | **works today** | needs generalising (array `q`, winning-index resolver, `maxLoss = b·ln(N)`) |

A market where several outcomes can be true **cannot** be categorical — prices that sum to 100 would be lying. A market with one winner **should not** be N binaries — you get six candidates each priced at 40%, which reads as broken arithmetic.

Categorical markets want a **Field** bucket (`1 − sum of named`) so a 32-pair draw fits in 4 options and the underdog story has somewhere to live.

---

## Verified data foundations

Measured against production 2026-09-23. These are what make the resolvers possible.

| Source | State | Enables |
|---|---|---|
| `matches.winner_pair` | authoritative, not revisable like scores | match + tournament outcomes |
| `sets.pair1_games/pair2_games` | per-set games | totals, tiebreaks, bagels, deciding sets |
| `games.is_tiebreak` | exists | tiebreak markets |
| `matches.pred_pair1_prob` | 872 matches priced, refreshed hourly | Elo seed for match markets |
| `tournament_projections` | 3,914 rows / 88 events, **sums to 1.0** across the full field (22 pairs at Lyon) | outright seeds, Field bucket |
| `model_tournament_predictions` | Elo, **only 8 of 22 pairs** — partial field | ⚠️ do NOT use for a Field bucket |
| `player_ranking_snapshots` | official + race, both genders, weekly since 2026-05-04 | season rank, race, qualification |
| `player_tournament_earnings` | since 2024, both genders | money list |
| `seasons` | Premier Padel 2026 ends **2026-12-12** | a real season boundary |

**Dead — no data, do not promise:** winners, unforced errors, smashes. `match_stats` is 34 columns of serve/return/points only. Shot-level data may sit unmodelled in `raw_payload` jsonb; it is not queryable.

---

## 1 · Buildable on today's engine

Binary, match- or player-bound, resolvers exist or are small.

| Market | Horizon | Settles from | Status |
|---|---|---|---|
| **Match winner** — "Will {pair} win this match?" | pre-match | `matches.winner_pair` | **LIVE** — 5 markets created 2026-09-23 |
| **Deciding set** — "Will this go to a third set?" | pre-match | `count(sets)` | resolver to write |
| **Total games o/u** — "Over {line} games?" | pre-match | `sum(sets games)` | resolver to write |
| **Underdog wins a set** | pre-match | `sets` + `pred_pair1_prob` | resolver to write |
| **Tiebreak in this match** | pre-match | `games.is_tiebreak` | resolver to write |
| **Bagel** — "Will any set finish 6–0?" | pre-match | `sets` both columns | resolver to write |
| **Finals qualification** — "Will {player} play the Premier Finals?" | **season (11 wks)** | did the player appear at that tournament | resolver to write · **ad-hoc** |

### The Finals qualification market — worked example

Premier Padel Finals, **9–12 December**, 16 players. The bubble as of 2026-09-21:

*Men* — 256 pts across the line: Sanz (15, 2559) · Leal (16, 2418) · **cut** · E. Alonso (17, 2162) · Tello (18, 2122)
*Women* — only 108 pts: Salazar (15, 2624) · Virseda (16, 2265) · **cut** · Osoro (17, 2157) · Dal Pozzo (18, 2134)

Four binary markets per gender. **Binary is correct here, not a compromise** — several of them can qualify simultaneously.

**Resolve on the outcome, not the rule.** Don't model how qualification works: the race ranks individuals, 16 players means 8 pairs, and a player can arrive with a different partner than the one they earned points with. Encoding that rule means defending it in a dispute. Instead ask: *did this player appear at PREMIER PADEL FINALS?* Indifferent to partner changes, reusable every December.

Seed at **0.50** — we have no qualification model, and the price discovery is the content.

---

## 2 · Needs the pair plumbing

All pair-bound, all blocked on the same three pieces: non-match enumeration, **per-market resolver params** (`buildMarketRow` currently copies template-level params, so every market from one template would ask about the same pair), and a lock rule for non-match subjects. Build once, unlock all.

| Market | Horizon | Settles from | Note |
|---|---|---|---|
| **Tournament outright** — "Will {pair} win {tournament}?" | tournament | final's `winner_pair` | **resolver already written and tested** — cheapest first build |
| **Pair reaches the final** | tournament | `matches.round_canonical` progression | |
| **Season titles o/u** — "3+ more titles before 12 Dec?" | season | count finals won in window | state which tiers count, or it's ambiguous |
| **First title together** | swing/season | first final won by that pair | gate to pairs on zero |
| **The rivalry** — "Will {pairA} beat {pairB} next meeting?" | swing | next match containing both | needs a void rule if they never meet |
| **Partnership survival** — "Still together at the last event of 2026?" | roster | both on the same entry list | highest definitional risk — write the rule into the market |

Context for tuning: 2026 Premier-tier titles are a **men's duopoly** — Coello/Tapia 9, Galán/Chingotto 7, of 18 total. The women's side (Josemaría/González 6, Brea/Triay 6, Ustero/Sánchez 3) makes better markets from the same template.

---

## 3 · Needs the categorical engine

Exactly-one-winner markets. Blocked on array-valued `q`, a winning-index resolver, and `maxLoss = b·ln(N)`.

| Market | Horizon | Shape |
|---|---|---|
| **Tournament winner** — 4-option board | tournament | top 3 pairs by `champion_prob` + **Field**. Seeds free from `tournament_projections`, which sums to 1 across the full field |
| **Who takes the last Finals spot?** | season | 4 bubble players + Field |
| **Year-end world No. 1** | season | top 3 + Field, from `player_ranking_snapshots` final week |
| **Money list leader** | season | top 3 + Field, from `player_tournament_earnings` |
| **Champion's country** | tournament | ES / AR / other |

**Generalise before there are real positions.** Today: 5 markets, 0 positions, 0 ledger rows — migration is a delete and regenerate. Once users hold positions, changing the shape of `q` is a migration against their holdings.

---

## 4 · Deliberately parked

| Market | Why |
|---|---|
| In-match (next game, break points, golden point) | Premier-tier only, and `match_points` is sampled — the deciding point is usually missing. `games.winner_pair` is the reliable signal. |
| Shot-count markets (winners, unforced errors, smashes) | **No data. Not in the database at all.** |
| Day markets ("will any seed lose today?") | Needs a day-scoped enumeration path; low value until the calendar is busier |
| "Does the crowd beat the model this week?" | Needs settled markets and trading history first — but it is the most *ours*, so revisit once users exist |

---

## Choosing between template and ad-hoc

| | Template | Ad-hoc |
|---|---|---|
| Recurs | constantly, from the calendar | once, or twice a year |
| Subject chosen by | the generator, mechanically | **you**, editorially |
| Worth it when | hundreds of instances | a handful |

**Both still need a registered resolver.** Ad-hoc means *you pick the subject*, never *you settle it by hand*. A market nobody can settle automatically is a promise to adjudicate months later — which is the operator-judgement problem the resolver registry exists to remove.

Finals qualification is the textbook ad-hoc case: twice a year, editorial choice of candidates, but a resolver reusable every December.
