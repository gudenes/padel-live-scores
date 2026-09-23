# Play the Next — prediction market design

**Date:** 2026-09-23
**Status:** Spec — review pending
**Mockups:** [`public/mockup-play-market.html`](../../../public/mockup-play-market.html) (user app) · [`apps/ops/public/mockup-play-admin.html`](../../../apps/ops/public/mockup-play-admin.html) (operator panel)

## Why now

PadelNachos already computes a win probability for every Premier match (`model_predictions`, hourly) and an in-play probability every 20 seconds (`match_live_odds`). Today those numbers are shown and then forgotten. A prediction market turns them into a reason to come back: the crowd trades *against* the model, and the gap between the two lines becomes the content.

This supersedes the shelved Guacas pick game ([2026-04-30](2026-04-30-guacas-prediction-game-design.md)), which is built but not mounted. That design was one-shot picks with a frozen multiplier. This one is a real market: prices move, positions can be sold before resolution, and a long-horizon market stays alive all season.

Nothing converts to money. See "Why guacas stay non-convertible" below — it is a deliberate moat, not a limitation.

## Goals

- A market whose **price moves**, seeded by our own model so it is never a blank 50/50.
- A catalogue that fills the calendar: something resolving today, and something resolving in December.
- An operator surface where markets are **generated, not authored**, and never settle silently.
- A guaca economy that does not inflate into meaninglessness.

## Non-goals (v1)

- **No prizes.** Top-10 season prizes are planned but explicitly out of scope; the season model is built to support them later.
- No real money, no token, no crypto, no convertibility of any kind.
- No user-authored markets. Templates only.
- No user-to-user following (the Activity "Following" filter is deferred with it).
- No in-match / live markets. Pre-match and tournament horizons only.
- No new push notification types.

## Scope — deliberately narrow

**Premier tier only** (`P1`, `P2`, `Major`, `Premier_Mens`, `Premier_Womens`). Point-by-point and `match_stats` only exist at Premier tier anyway; FIP-tier matches flip to `live` with no data behind them.

**Final rounds only.** The round gate is a config value, defaulting to **SF + F**. The arithmetic decides it:

| Round gate | Matches per event (both genders) | Match markets | + outrights | Total open |
|---|---|---|---|---|
| F only | 2 | 4 | 2 | **6** |
| **SF + F** *(default)* | 6 | 12 | 2 | **14** |
| QF + SF + F | 14 | 28 | 2 | 30 — over cap |

The cap exists because **liquidity per market is the binding constraint, not database size**. At ~40 daily actives making ~120 trades, 300 markets yields 0.4 trades each and every price sits frozen at its seed. Fourteen markets yields ~9 trades each and the price actually moves.

Rule of thumb, recorded so it is not re-derived later: `open markets ≈ daily actives ÷ 10`. Raise the gate to QF when the user base — not the match count — justifies it.

## Concepts

| Concept | Definition |
|---|---|
| **Template** | A generator. ~8 rows, authored by an operator, never seen by users. Holds a question pattern with tokens, a trigger, a lock rule, a resolver name, a seed-price source, a subsidy and eligibility gates. |
| **Market** | One instance a template created, bound to a specific match or tournament. This is the only thing users see. |
| **Resolver** | A named, unit-tested function in a code registry that settles a market from our own tables. Operators select one and fill parameters; they never write a query. |
| **Position** | A user's holding of YES or NO shares in one market. Each share pays 1.00 G if it resolves in its favour, 0 otherwise. |
| **Season** | A bounded period. At season end balances reset to baseline and the leaderboard is archived. |

**A market freezes its configuration at creation.** Editing a template never changes markets it already produced — otherwise raising a subsidy or fixing wording would rewrite the terms of a market people already traded in. Same principle as the frozen multiplier in the legacy `predictions` table.

## Templates in v1

Eight templates. Every one resolves from a column we have verified exists.

| Template | Horizon | Resolver | Settles from | Seed price |
|---|---|---|---|---|
| Match winner | pre-match | `match.winner_is_pair` | `matches.winner_pair` | Elo (`model_predictions`) |
| Deciding set | pre-match | `match.goes_to_deciding_set` | `count(sets)` | Elo |
| Total games over/under | pre-match | `match.total_games_over` | `sum(sets.pair1_games + pair2_games)` | Elo |
| Underdog wins a set | pre-match | `match.underdog_wins_a_set` | `sets` + `matches.pred_pair1_prob` | Elo |
| Tournament outright | tournament | `tournament.champion_is_pair` | `matches.winner_pair where round='F'` | Projection |
| Pair reaches final | tournament | `tournament.pair_reaches_round` | `matches.round` progression | Projection |
| Champion drops a set | tournament | `tournament.champion_drops_set` | `sets` across the champion's path | Projection |
| Any seed loses | tournament | `tournament.seed_eliminated_by_round` | `tournament_draws.seed` + results | Projection |

**Explicitly excluded:** any market resolving on winners, unforced errors or smashes. Those columns **do not exist** — `match_stats` is 34 columns of serve, return and points data only. Shot-level data may sit unmodelled inside `match_stats.raw_payload` jsonb; it is not queryable and must not be promised.

### Question text and i18n

Question patterns carry tokens (`{pair1}`, `{pair2}`, `{player}`, `{round}`, `{tournament}`, `{line}`) and must render in all five locales. `market_templates.question_i18n` is a `jsonb` map keyed by locale:

```json
{ "en": "Will {pair1} win this match?", "es": "¿Ganará {pair1} este partido?", … }
```

Tokens are substituted at **render time from the market's bound entities**, not baked into the stored market — so a player rename propagates, and a locale switch re-renders without a migration. `markets` stores the token *values*, not the finished string.

## Data model

### `market_seasons`

```sql
CREATE TABLE market_seasons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text        NOT NULL,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  reset_balance integer     NOT NULL DEFAULT 10000,
  status        text        NOT NULL DEFAULT 'upcoming'
                CHECK (status IN ('upcoming','active','archived')),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON market_seasons (status) WHERE status = 'active';
```

The partial unique index guarantees exactly one active season.

### `market_templates`

```sql
CREATE TABLE market_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text UNIQUE NOT NULL,          -- 'match.winner'
  question_i18n   jsonb       NOT NULL,
  horizon         text        NOT NULL CHECK (horizon IN ('pre-match','tournament','season','roster')),
  trigger         text        NOT NULL,          -- 'match.scheduled' | 'draw.released'
  lock_rule       text        NOT NULL,          -- 'match_start' | 'round_first_ball'
  resolver_key    text        NOT NULL,          -- must exist in the code registry
  seed_source     text        NOT NULL CHECK (seed_source IN ('elo','projection','inplay','fip_rank','fixed')),
  max_loss_guacas integer     NOT NULL DEFAULT 5000,
  params          jsonb       NOT NULL DEFAULT '{}',   -- e.g. {"line": 22.5}
  gates           jsonb       NOT NULL DEFAULT '{}',   -- round/ranking/court/competitiveness/daily cap
  enabled         boolean     NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
```

`gates` shape:

```json
{ "rounds": ["SF","F"], "min_ranking": 50, "competitiveness": [0.35, 0.65], "daily_cap": 6 }
```

### `market_limits` (single row)

Global ceilings, editable from the admin without a deploy.

```sql
CREATE TABLE market_limits (
  id                       boolean PRIMARY KEY DEFAULT true CHECK (id),  -- forces one row
  max_open_markets         integer NOT NULL DEFAULT 15,
  max_new_per_day          integer NOT NULL DEFAULT 20,
  max_per_match            integer NOT NULL DEFAULT 3,
  max_per_tournament_day   integer NOT NULL DEFAULT 8,
  max_subsidy_per_day      integer NOT NULL DEFAULT 250000,
  max_stake_user_market    integer NOT NULL DEFAULT 2000,
  updated_at               timestamptz NOT NULL DEFAULT now(),
  updated_by               text
);
INSERT INTO market_limits DEFAULT VALUES;
```

The `boolean PRIMARY KEY DEFAULT true CHECK (id)` idiom makes a second row impossible at the database level, so no code path can accidentally create competing limit sets.

### `markets`

```sql
CREATE TABLE markets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id      text UNIQUE NOT NULL,
  season_id      uuid NOT NULL REFERENCES market_seasons(id),
  template_id    uuid NOT NULL REFERENCES market_templates(id),

  -- Bound subject. Exactly one of match_id / tournament_id is non-null.
  match_id       uuid REFERENCES matches(id) ON DELETE CASCADE,
  tournament_id  uuid REFERENCES tournaments(id) ON DELETE CASCADE,
  category       text CHECK (category IN ('men','women')),
  tokens         jsonb NOT NULL DEFAULT '{}',   -- resolved token VALUES, not text

  -- Frozen at creation — editing the template must not reach back.
  resolver_key    text    NOT NULL,
  resolver_params jsonb   NOT NULL DEFAULT '{}',
  lmsr_b          numeric(12,4) NOT NULL,       -- derived: max_loss / ln(2)
  seed_prob       numeric(5,4)  NOT NULL,
  seed_source     text    NOT NULL,

  -- Live state
  q_yes          numeric(14,4) NOT NULL DEFAULT 0,  -- LMSR outstanding shares
  q_no           numeric(14,4) NOT NULL DEFAULT 0,
  volume_guacas  bigint  NOT NULL DEFAULT 0,
  position_count integer NOT NULL DEFAULT 0,

  status         text NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open','locked','proposed','settled','void')),
  locks_at       timestamptz NOT NULL,

  -- Resolution
  proposed_outcome  boolean,
  proposed_at       timestamptz,
  proposed_evidence jsonb,
  settles_at        timestamptz,      -- proposed_at + confirmation window
  outcome           boolean,
  settled_at        timestamptz,
  settled_by        text,             -- 'auto' | operator email
  void_reason       text,

  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK ((match_id IS NULL) <> (tournament_id IS NULL))
);

CREATE INDEX ON markets (status, locks_at);
CREATE INDEX ON markets (season_id, status);
CREATE INDEX ON markets (match_id) WHERE match_id IS NOT NULL;
CREATE UNIQUE INDEX ON markets (template_id, match_id, category)
  WHERE match_id IS NOT NULL;   -- one market per template per match
```

The partial unique index is the idempotency guard: the generator can run repeatedly without duplicating markets.

### `market_trades` (append-only)

```sql
CREATE TABLE market_trades (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id    uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  side         text NOT NULL CHECK (side IN ('yes','no')),
  direction    text NOT NULL CHECK (direction IN ('buy','sell')),
  shares       numeric(14,4) NOT NULL CHECK (shares > 0),
  cost_guacas  integer NOT NULL,              -- negative on sell (refund)
  price        numeric(5,4) NOT NULL,         -- effective average price paid
  q_yes_after  numeric(14,4) NOT NULL,
  q_no_after   numeric(14,4) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON market_trades (market_id, created_at DESC);
CREATE INDEX ON market_trades (user_id, created_at DESC);
```

Storing `q_*_after` makes every trade independently auditable — the whole price history can be replayed without re-deriving state.

### `market_positions` (derived, maintained on trade)

```sql
CREATE TABLE market_positions (
  market_id     uuid NOT NULL REFERENCES markets(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  yes_shares    numeric(14,4) NOT NULL DEFAULT 0,
  no_shares     numeric(14,4) NOT NULL DEFAULT 0,
  cost_basis    integer NOT NULL DEFAULT 0,
  realised_pnl  integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (market_id, user_id)
);
CREATE INDEX ON market_positions (user_id) WHERE yes_shares > 0 OR no_shares > 0;
```

### `guaca_ledger` (append-only — the single source of balance truth)

```sql
CREATE TABLE guaca_ledger (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id  uuid NOT NULL REFERENCES market_seasons(id),
  kind       text NOT NULL CHECK (kind IN (
               'signup_grant','daily_stipend','referral','achievement',
               'trade_buy','trade_sell','settlement','refund',
               'cosmetic','market_fee','season_reset')),
  amount     integer NOT NULL,          -- signed
  market_id  uuid REFERENCES markets(id) ON DELETE SET NULL,
  trade_id   bigint REFERENCES market_trades(id) ON DELETE SET NULL,
  memo       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON guaca_ledger (user_id, season_id);
CREATE INDEX ON guaca_ledger (kind, created_at DESC);
```

### `user_guaca_balance` (denormalised cache)

```sql
CREATE TABLE user_guaca_balance (
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  season_id   uuid NOT NULL REFERENCES market_seasons(id),
  balance     integer NOT NULL DEFAULT 0,
  locked      integer NOT NULL DEFAULT 0,   -- cost basis of open positions
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, season_id),
  CHECK (balance >= 0)
);
```

The ledger is authoritative; this table is a cache maintained inside the same transaction. A nightly job re-derives it from the ledger and alerts on drift — with money-like maths, silent divergence is the failure mode that matters.

### `market_audit_log`

```sql
CREATE TABLE market_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  market_id   uuid REFERENCES markets(id) ON DELETE SET NULL,
  template_id uuid REFERENCES market_templates(id) ON DELETE SET NULL,
  actor       text NOT NULL,             -- operator email | 'system'
  action      text NOT NULL,             -- 'settle','void','hold','override','template_edit'
  reason      text NOT NULL,             -- required, never nullable
  before      jsonb,
  after       jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

`reason` is `NOT NULL` by design. An override without a stated reason is the thing we will want six months from now and not have.

### RLS

| Table | anon / authenticated | service role |
|---|---|---|
| `markets` | read (status ≠ draft) | full |
| `market_trades` | read own rows only | full |
| `market_positions` | read own rows only | full |
| `guaca_ledger` | read own rows only | full |
| `user_guaca_balance` | read own row only | full |
| `market_templates`, `market_audit_log` | **no access** | full |

All writes go through service-role API routes. The browser never writes a trade directly.

### Legacy

The existing `predictions` table and `/[locale]/picks` are **left in place and untouched**. They are not mounted in the nav and carry no balance. Opening balances for this system come from a signup grant, **not** from summing historical `predictions.reward` — those were notional, never a balance, and importing them would hand a handful of early users an unassailable lead on day one.

## Pricing — LMSR

A logarithmic market scoring rule, chosen because its **worst-case loss is bounded and knowable before a single trade**, which is what makes the subsidy budget on the Economy page honest.

```
C(q_yes, q_no) = b · ln( exp(q_yes/b) + exp(q_no/b) )
price_yes      = exp(q_yes/b) / ( exp(q_yes/b) + exp(q_no/b) )
cost of trade  = C(q_after) − C(q_before)
max maker loss = b · ln(2)        ≈ 0.6931 · b   (binary)
```

So the operator sets a **max loss per market** and `b` is derived: `b = max_loss / ln(2)`. At 5,000 G → `b = 7,213`.

**Seeding.** A market opens at the model's probability, not at 0.50. Given target `p`, set `q_yes = b · ln(p)`, `q_no = b · ln(1−p)` — which yields `price_yes = p` exactly, with no shares owed to anyone. Seed source per template:

| Source | Reads |
|---|---|
| `elo` | `matches.pred_pair1_prob` (denormalised from `model_predictions`) |
| `projection` | `tournament_projections.champion_prob` / `finalist_prob` |
| `fip_rank` | cold-start Elo from `players.ranking` via `fipPriorElo` |
| `fixed` | 0.5 |

If the seed source returns nothing, the market is **not created**. A market with no anchor is a market with no price.

Implementation note: compute in log-space (`logsumexp`) to avoid overflow — `exp(q/b)` with large `q` overflows float64 well before any realistic volume.

**Numeric discipline.** Shares are `numeric(14,4)`; guacas are integers. Cost is rounded **against the user** (buy rounds up, sell rounds down) so rounding can never mint guacas. Every trade asserts the ledger delta equals the cost.

## Generation worker

New padelgod worker `market-generator`, hourly at `:25`, flag `enableMarketGenerator`.

```
1. Load enabled templates + the active season + global limits.
2. For each template, enumerate candidate subjects from its trigger:
     pre-match   → matches, status='scheduled', Premier tier, round ∈ gates.rounds
     tournament  → tournaments with a released draw, Premier tier
3. Drop candidates failing gates: round · ranking · court · competitiveness.
4. Drop candidates that already have a market (partial unique index).
5. Score survivors — round depth, star power, follower count, model closeness.
6. Take top N under: per-template daily cap → per-match cap → per-tournament/day
   cap → global open cap → daily subsidy budget.
7. Create markets with a frozen config and a seeded price.
8. Log every drop with its reason. Never truncate silently.
```

Global limits live in a single-row `market_limits` table so they are editable from the admin without a deploy.

**Locking.** A second pass moves `open → locked` when `now() >= locks_at`. Lock time is derived per template (`match_start` → `matches.scheduled_at`; `round_first_ball` → earliest `scheduled_at` in that round). If `scheduled_at` is NULL, the market is not created. That column goes missing more often than it should — a tournament in a country absent from `country-timezone.ts` makes `fip-oop-writer` skip every `scheduled_at` for the event.

Lock rules, stated explicitly because "when does a market close" is the question that causes disputes:

| `lock_rule` | Locks at |
|---|---|
| `match_start` | `matches.scheduled_at` of the bound match |
| `round_first_ball` | earliest `scheduled_at` among matches in the bound round |
| `final_start` | `scheduled_at` of the final — used by tournament outrights, which stay tradeable all week |

## Resolution pipeline

Worker `market-resolver`, every 5 minutes.

```
PROPOSE   market is locked, resolver returns a definite outcome
          → status='proposed', record outcome + evidence, settles_at = now + window
CONFIRM   settles_at has passed and nothing invalidated it
          → settle: pay 1.00 G per winning share, write ledger rows
HOLD      resolver returns conflicting or reversed evidence
          → status stays 'proposed', flagged for the operator, no payout
VOID      match walkover / retired / cancelled, or operator decision
          → refund every position at cost basis, ledger kind='refund'
```

**The confirmation window exists because of a real incident.** Crionet has marked a match `finished` roughly twenty minutes early **with the wrong winner**, twice at Paris Major. With instant payout, guacas would move on a phantom result and we would be clawing balances back from users. Default window: **30 minutes**, configurable per horizon (tournament markets can afford longer).

The hold condition is specific: if a resolver's answer **changes** between two runs before `settles_at`, the market is held and never auto-settles. That single rule converts the Crionet bug from an incident into a queued row.

**Resolver contract.** Every resolver is a pure function in a registry:

```ts
type ResolverResult =
  | { state: 'undecided' }
  | { state: 'decided'; outcome: boolean; evidence: Record<string, unknown> }
  | { state: 'void'; reason: string }

type Resolver = (ctx: ResolverContext, params: Json) => Promise<ResolverResult>
```

Registered by key, unit-tested against fixtures, and **versioned** — changing a resolver's semantics requires a new key, because existing markets froze the old one. No operator-authored SQL, ever.

## Economy

### Issuance

| Source | v1 value | Notes |
|---|---|---|
| Signup grant | 10,000 G | one-off, per season |
| Daily stipend | 500 G | **the dangerous dial** — the only source scaling with engagement |
| Referral bonus | 2,000 G | reuses the existing referral flow |
| Achievement rewards | existing tiers | already in `src/lib/gamification.ts` |
| AMM subsidy | ≤ `b·ln(2)` per market | bounded by construction |

### Sinks

| Sink | v1 |
|---|---|
| Cosmetic avatar unlocks | yes — pairs with the generated-avatar system |
| Market creation fee | deferred with user-authored markets |
| Season reset | **the structural fix** |

**Trading is not a source.** Between traders it nets to zero; one side's gain is the other's loss. The only true injection is the subsidy plus the grants above. This is the sentence that keeps the Economy page honest.

### Health metric

`typical stake ÷ median balance`, target **5–10%**. Below that, a stake costs nothing emotionally and no decision in the app matters. This is the number that defines what a guaca is *worth* — not any exchange rate.

### Season

Three months. At rollover: archive the leaderboard, write a `season_reset` ledger row per user, set balances to `reset_balance`, and mark open markets from the prior season for settlement or void. A season stays winnable by someone who joins in month two — which is the retention argument as much as the inflation one.

### Why guacas stay non-convertible

EU and UK regulators apply a substance test: **payment + chance + prize = gambling**, licensed per country. There is no EU equivalent of the US sweepstakes carve-out. We currently fail two of the three legs — guacas cannot be bought, and they buy nothing of value.

Linking guacas to a token or to Bitcoin flips the prize leg and makes PadelNachos a licensed gambling operator in Spain, Italy, France and Portugal — our four largest markets. ADI PredictStreet's real-money product is already geo-blocked in Spain. Separately, issuing a token to the public in the EU triggers MiCA white-paper obligations, and 2026 is the year regulators began treating in-game currency as real money.

It would also break the game: a market priced at 0.38 is meaningless if the unit swings 20% a day, and real value attracts bots that strip the fun from a fan product.

**Non-convertibility is the moat.** It is why we can operate in every padel market on earth while licensed competitors cannot.

### Prizes (designed for, not built)

Top-10 season prizes are planned for a later season. The design supports them already: seasons are bounded and archived, and the leaderboard is a season-scoped query. When prizes arrive they must be **prizes for rank, never redemption at a rate** — you cannot buy a racket for 500,000 G; you finish top-10 and win one. Fixed-rate redemption makes guacas a currency; a free-entry, skill-weighted competition with non-cash prizes is a prize competition under a far lighter regime. Sponsor-funded via the existing `partners` / `padel_rackets` relationships.

## Where the code lives

The pricing function has three consumers — the trade API (`src/`), the generator and resolver workers (`padelgod/`), and the admin (`apps/ops/`, which resolves `@/*` to its **own** `src/`). That is exactly the mirror trap this repo has hit before: some `src/lib` modules are byte-identical copies inside `apps/ops`, and editing only the root copy silently leaves the admin on old behaviour.

**Decision:**

- `padelgod/src/lib/lmsr.ts` and `padelgod/src/lib/market-resolvers/*` are the **single source**.
- The workers own generation and settlement.
- The admin **reads results**; it never recomputes a price.
- The trade API is the one genuine crossing. It gets an explicit mirror at `src/lib/lmsr.ts` guarded by a **checksum test** that fails CI when the two files diverge. A drifted copy means the admin previewing a different price than users are charged.

## API surface

| Route | Method | Purpose |
|---|---|---|
| `/api/play/markets` | GET | Open markets for the deck. Public, cached 30s. |
| `/api/play/markets/[id]` | GET | One market + price history. Public. |
| `/api/play/trade` | POST | `{marketId, side, guacas}` → buy. Service-role, auth required, transactional. |
| `/api/play/trade` | DELETE | `{marketId, shares}` → sell back to the maker. |
| `/api/play/positions` | GET | Current user's positions. |
| `/api/play/activity` | GET | Recent trades across all markets, anonymised to display name. |
| `/api/play/leaderboard` | GET | Season leaderboard by net worth. |
| `/api/ops/play/*` | — | Template CRUD, dry-run, resolution queue, limits, economy. Behind `ops_token`. |

**The trade route is the only place money-like state changes.** It must: verify the market is `open`, verify `locks_at` is in the future, re-read `q_yes`/`q_no` **inside** the transaction with `SELECT … FOR UPDATE`, compute cost, assert the user's balance covers it, write trade + position + ledger + balance atomically, and enforce the per-user-per-market stake cap. Concurrency here is not theoretical — two trades on the same market in the same second must not both price off the same stale `q`.

## User-facing surface

Lives under the **Play** tab, which takes the bottom-nav slot currently held by Following. Sub-nav: `Markets · Activity · Leaders · [balance chip → positions]`.

- **Markets** — a swipe deck, one binary question per card. Swipe right YES, left NO, then choose a stake. Each card shows the crowd price, our model's number, and a 60-minute price sparkline. The gap between the two lines is the product.
- **Activity** — other users' trades, arriving live, with generated avatars and display names. Large stakes flagged.
- **Leaders** — season leaderboard by net worth (balance + live value of open positions), your row pinned.
- **Positions** — open / resolved / history, with live P&L in **G only**. No currency symbols anywhere, ever.

Avatars are **generated characters**, deterministic from the username — no uploads, therefore no storage, no hosting and no moderation queue on a public social surface. The generator must be a **shared module**, not copied into both apps.

**Following needs a new home** when Play takes its slot. Recommendation: move it into the profile menu, which already hosts `/picks`. Decided in the implementation plan, not here.

## Rollout

Flag: DB-backed `feature_flags` row **`play_market_enabled`** with separate Production / Local toggles, matching `match_prediction_enabled`. Off = the Play tab renders as Following, exactly as today.

| Phase | Contents |
|---|---|
| **1 — Engine** | Migrations · LMSR module + tests · resolver registry + fixtures · generator and resolver workers, both flag-off. No UI. Verify by dry-run against a live Premier event. |
| **2 — Operator** | The five admin pages. Operators author templates and watch markets generate for a real tournament with **no users trading**. This is the phase that catches bad resolvers cheaply. |
| **3 — App** | Swipe deck, trade sheet, positions, activity, leaders. Ship dark behind the flag; enable for staff accounts on one tournament. |
| **4 — Open** | Flip the flag. Season 1 begins. Status and cosmetics only, no prizes. |

Phase 2 running for a full tournament before any user can trade is the important one: a wrong resolver discovered with zero positions open costs nothing, and discovered after payout costs trust.

**Each phase gets its own implementation plan.** This spec is too large for a single plan — phase 1 alone is migrations, a pricing module, a resolver registry and two workers. The first plan covers **phase 1 only**; later phases are planned once the engine exists and has been dry-run against a real event.

## Risks

- **Thin markets.** At 40 daily actives even 14 markets is thin. Mitigation: the LMSR subsidy makes a price exist regardless of volume, and the round gate is the dial to tighten if it still feels empty.
- **Balance drift.** The cache diverging from the ledger. Mitigation: nightly re-derivation with an alert; the ledger is authoritative.
- **Upstream data reversal.** Beyond the Crionet case, `fip-results-writer` can revise a score. Mitigation: the hold rule, plus resolvers preferring `matches.winner_pair` over derived score data.
- **Manipulation.** One account moving a thin market; paired accounts farming volume. Mitigation: per-user-per-market stake cap, plus the flags on the Traders page. Play money removes the fraud risk, not the manipulation risk — a leaderboard is still worth cheating for.
- **Inflation.** Covered by the season reset; the stipend is the dial to watch.
- **`scheduled_at` gaps.** A missing timezone silently blanks `scheduled_at` and markets never lock. Mitigation: skip creation when null, and surface the count in the generator's drop log.

## Decided

- **Round gate: SF + F** — confirmed 2026-09-23. ~14 open markets per Premier event, inside the 15 cap. Stored as `gates.rounds = ["SF","F"]` per template, so widening to QF later is a config change, not a migration.

## Open questions

1. **Where Following goes** once Play takes its nav slot.
3. **Confirmation window length** — 30 min proposed; tournament-horizon markets may want longer.
4. Whether a settled market should fire a push. Reuses existing infrastructure, deferred from v1.

## Success criteria

Six weeks after phase 4:

- ≥ 35% of WAU place at least one trade per week.
- Median trades per active trader per week ≥ 5.
- **≥ 60% of open markets see a price move of ≥ 3 points in a week.** The single most important number — a market that never moves is a failed market, regardless of engagement.
- Balance-cache drift: zero unexplained.
- D7 retention ≥ 10pp higher for trading vs non-trading cohorts.
