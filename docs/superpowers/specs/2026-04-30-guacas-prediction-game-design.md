# Guacas Prediction Game — design

**Date:** 2026-04-30
**Status:** Spec — review pending
**Scope:** Tier 1 (frontend card UX, multiplier economy, post-match feedback) + Tier 2 (server-side predictions, leaderboard, accuracy stats)

## Why now

PadelNachos is at ~120 WAU. The bottleneck is engagement and traction, not monetization. The stated goal for this work is to position the app for fundraising/acquisition by demonstrating that monetization mechanics work — not to maximize revenue today.

A prediction game is the right wedge because:

- It drives the same "obsessive checking" behavior as betting odds with none of the regulatory exposure (Italy AGCOM, Spain DGOJ, France ANJ, Portugal SRIJ all hostile to gambling-affiliate UX).
- It uses infrastructure already shipped (`useMatchPrediction`, `PredictionSection` on the match-detail page, FIP rankings on every player).
- It preserves acquirer optionality. Likely buyers (Playtomic, Premier Padel/QSI, Red Bull, equipment brands) all rule out apps with active betting integrations.
- It creates branded surface area ("Guacas") owned by PadelNachos that can host sponsorship later without changing UX.

Predictions are gamification, not betting. Nothing redeems for cash.

## Existing prior art (kept, not replaced)

- [`src/hooks/useMatchPrediction.ts`](../../../src/hooks/useMatchPrediction.ts) — localStorage prediction store, `{ pair, margin }`. Stays in Phase 1; migrates to Supabase in Phase 2.
- [`src/app/[locale]/match/[id]/PredictionSection.tsx`](../../../src/app/[locale]/match/[id]/PredictionSection.tsx) — full pick-pair → pick-margin → done flow on match detail. Visual language carries over; on cards the same flow runs inline.
- [`src/components/MatchCard.tsx`](../../../src/components/MatchCard.tsx) — primary surface for the game. Today shows only a tiny "PREDICTED" pill; this spec moves the action to the card.
- [`docs/superpowers/specs/2026-04-12-prediction-revamp-design.md`](2026-04-12-prediction-revamp-design.md) — earlier prediction work. This spec extends it; reconcile any drift before implementing.

## Goals & non-goals

**Goals**

- Drive recurring engagement (checking-back behavior, daily activity).
- Create a branded gamification economy ("Guacas") that can host sponsorship.
- Demonstrate working acquisition signals: pick rate, accuracy, streak, retention, community %.
- Move predictions to the server so social and competitive features become possible.

**Non-goals**

- No betting affiliate. No real-money redemption.
- No native app this round.
- No friends / private leagues / direct challenges in v1 — global leaderboard only.
- No push notifications from this spec.

## Frontend — card UX

### Corner CTA

A green chunky polygon button in the top-right corner of every scheduled match card. Replaces the existing tiny "PREDICTED" pill.

| Match status | User predicted? | Corner element |
|---|---|---|
| `scheduled` | no | Green `[brain icon] PICK` button |
| `scheduled` | yes | Muted green pill: `YOUR PICK` / `[pair · margin]` |
| `live` | no | Muted dashed-border `PICKS LOCKED` chip (no expand action — read-only insights only) |
| `live` | yes | Muted green `YOUR PICK` pill (same as scheduled-predicted) |
| `finished` (etc.) | yes | Result badge (see "Finished states") |
| `finished` (etc.) | no | No corner element |

The CTA is **never** annotated with a probability or multiplier. It advertises action only; precision lives inside the panel where it has room to be explained.

### Expand / collapse

Tapping the CTA, the corner pill, or the card body toggles the expanded insights panel. All three are tap targets. Three collapse mechanisms work together:

1. **Auto-collapse 1.4s after locking in margin.** A "Closing in a moment… · *Stay open*" hint appears; "Stay open" cancels the timer.
2. **Manual close handle** — `▴ TAP TO CLOSE ▴` anchored at the bottom of the panel, available at every step.
3. **Toggle via card body or corner pill** — both re-open after collapse.

Mid-flow abandonment (panel closes between pair-pick and margin-pick) discards the half-pick. Only locking in the margin commits a prediction.

### Expanded panel — top-down structure

1. **Prediction zone** (only present pre-pick or in pick flow).
   - **Pair-pick step:** two large pair buttons side by side. Pair 1 has `PAIR1_COLOR` (#FF6B2B) border; Pair 2 has `PAIR2_COLOR` (#FFD166). Each button shows: pair label, stacked names, probability ("68% favored"), multiplier (`1.47×`), reward (`147 G`). Pairs with probability ≤ 35% get a small gradient "UPSET" flag in the corner.
   - **Margin step** (after pair-pick): replaces pair buttons. Shows "You're picking [pair] / [reward]" with a "Change" link, then two big buttons: `2 – 0 / Straight sets / +0.50× bonus` and `2 – 1 / Three sets / +0.50× bonus`.
   - **Confirmed block** (after margin-pick): green check + "Locked in · [pair] · [margin]" + "Change" link.

2. **Probability bar** — horizontal split bar, animates from 0 on expand. Labels: `[pair] · X%` / `Y% · [pair]`.

3. **Stats grid** — three tiles: avg ranking, last 5 (W-L), head-to-head record.

4. **Community pick band** — orange: `Community pick: X% [pair] · N picks`. Only shown when `total_picks ≥ 10` for that match.

5. **Sponsor line** — small footer: `Predictions · presented by [BRAND]`. Slot empty in v1.

### Live match cards

When a match transitions to `live`, predictions lock. The expanded panel for live matches replaces the prediction zone with:

- **"Your pick" block** — green "Locked in · pair · margin" if predicted.
- **Live tracking strip** — pulsing red dot + a one-line read of how the match is going for the user's pick ("Set 2 — your pick is up a break"). Heuristic-based; "feels alive" surface, not a precision tracker.
- **Live-shifting probability bar** — recomputed each time set state changes. Server-side recompute is fine; no Pusher needed for this feature.
- **Live-only stats** — probability delta since match start, break-points won, elapsed time. Tier 2 (server-side recompute).

### Finished match cards

Corner badge depends on the user's result:

| State | Trigger | Badge | Reward |
|---|---|---|---|
| **Heavy upset called** | User picked the eventual winner AND that pair's frozen probability ≤ 0.25 | Gradient orange→yellow `🔥 UPSET / +N G` | base (up to 5.00×) + margin bonus if applicable |
| **Right pair, right margin** | Pair correct + margin correct, probability > 0.25 | Gradient green→yellow `🎯 PERFECT / +N G` | base + 0.50× |
| **Right pair, wrong margin** | Pair correct + margin wrong | Green `✓ RIGHT / +N G` | base only |
| **Wrong pair** | Pair wrong | Red `✗ WRONG / +0` | 0 |
| **No pick** | No prediction made | No badge | — |

The 🔥 UPSET badge is a visual reward for underdog calls — same `+0.50×` margin-bonus math as 🎯 PERFECT, different label/emoji to celebrate the call. UPSET takes precedence over PERFECT when both apply (e.g. underdog called with correct margin renders as 🔥 UPSET, not 🎯 PERFECT).

The expanded panel for finished matches replaces the prediction zone with a result block (icon + verdict line + reward) and a math-row showing `100 G stake × multiplier = N G`. Stats grid stays.

### Component refactor

`MatchCard.tsx` already switches on `match.status`. We add a "predicted" sub-state per status. The expanded insights panel is a new sibling div below the existing `pn-flex` row, CSS-animated open via `max-height` / `opacity` / `margin-top` transitions to mirror the existing chunky language.

A new shared component `<PredictionFlow>` renders the pair-pick → margin-pick → confirmed sequence. Both the inline card panel and the existing `PredictionSection.tsx` on the match detail page consume it, so logic doesn't drift.

## Scoring economy

### The currency

Every authenticated user has a Guacas balance. Unit: `guaca` (singular) / `guacas` (plural). Never translated across locales. Visual: small green circle with white "G" inside, color `#7ED321`.

### Stake & multiplier

Every pick stakes **100 guacas** (fixed; not deducted from balance — predictions don't cost guacas. The stake is just the unit on which the multiplier operates).

Each match has a unique multiplier per pair, computed at pick time:

```
multiplier = clamp(round(1 / probability, 2), 1.00, 5.00)
```

The multiplier is **frozen at the moment the user locks in their pick** — even if model probability shifts later (form changes, partner changes), the user's reward is calculated against the multiplier they saw.

### Margin bonus

If the user also picks the correct margin (2-0 or 2-1), they get **+0.50×** added to the multiplier. Effective cap: **5.50×**.

### Reward formula

```
if pick wins:
  effective_multiplier = base_multiplier + (margin_correct ? 0.50 : 0.00)
  reward = round(100 × effective_multiplier)
else:
  reward = 0
```

### Edge cases

- Both/either players unranked → fallback to **2.00× flat** on both pairs ("toss-up" UI). User can still pick.
- Match cancelled / walkover / retired before locking in → all picks for that match invalidated (no reward, **no streak penalty**, no balance change). Predictions are deleted; the user is notified next time they open `/picks`.
- Probability tied (50/50 within rounding) → both pairs show 2.00×, no UPSET flag.

### Streak

Counts consecutive matches where the user's pair was correct (margin doesn't matter). Wrong pair resets to zero. Tracked per user.

### Future bonus mechanics (not in v1, called out for headroom)

The 100-stake / decimal-multiplier economy leaves room for additive layers later:

- Streak bonus — +50 G each 3-in-a-row, scaling.
- Hot streak — +100 G/pick after 5 correct in a row.
- Tournament sweep — predict every match in a round, win majority → +500 G.
- Daily streak — predict at least once per day for 7 days → +200 G.
- David vs Goliath — call an upset where probability < 25% → +100 G on top of base.
- Early bird — among first 10 to pick a match → +25 G.

Spec records these only because the economy was tuned with their headroom in mind. None ship in v1.

## Probability model

### v1 — ranking-based logistic

For matches where both pairs have FIP rankings (`players.ranking`):

```
strength(pair) = log(1 / avg_ranking)        // lower ranking = stronger
diff = strength(pair1) - strength(pair2)
p_pair1 = sigmoid(diff)
p_pair2 = 1 - p_pair1
p_pair1 = clamp(p_pair1, 0.20, 0.80)         // never claim > 80% confidence
```

The `[0.20, 0.80]` clamp aligns with the multiplier `[1.00, 5.00]` cap: at `p = 0.20` the multiplier hits exactly `5.00`. Tighter clamps (e.g. `[0.30, 0.70]`) would mean v1 never produces multipliers above 3.33× — wasting headroom advertised in the UI. v2/v3 (form, Elo) can produce more extreme probabilities; the clamp keeps v1 honest while leaving the cap as the real ceiling.

Where one or both players are unranked (Q-rounds, wildcards): both pairs get `p = 0.50`, multiplier 2.00× flat. UI shows "Unranked — toss-up".

The model lives in a single function `computeMatchProbability(match): { p1, p2, isFallback }` so v2/v3 can swap in without touching call sites.

### v2 / v3 (later, separate specs)

- v2 — adds last-N match form per pair (5 matches, weighted by recency).
- v3 — Elo or Glicko ratings, updated per finished match. Bootstraps from existing match history.

## "My Picks" page

Lives at `/picks` (locale-prefixed). Linked from the profile page and a small entry-point in the matches header.

**Layout:**

- **Header** — 44px gradient avatar (`#FF6B2B → #FFD166`), display name, "RANK #N · GLOBAL".
- **Stat strip** — four chunky tiles: total guacas / accuracy % / current streak / best streak.
- **Filter chips** — All / Pending / Won / Lost (with counts).
- **Pick rows** (compact list):
  - Result icon (28px circle): 🎯 perfect / ✓ right / ✗ wrong / ⏳ pending.
  - Match context line: `SF · CENTRAL · FIP SILVER LEIRIA` (muted uppercase).
  - Pick detail: `Galán/Chingotto · 2-1 vs Lebrón/Stupaczuk`.
  - Right column: relative time + reward (`+313 G` color-coded).

Tapping a row deep-links to the match detail page.

**Leaderboard:** separate route `/picks/leaderboard`. Top 100 by total guacas, weekly + all-time toggle, optional locale filter. Current user's row pinned at the bottom if outside top 100. Global only in v1 (no friends/private leagues).

## Data model

### `match_predictions` (new)

```sql
CREATE TABLE match_predictions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  match_id      uuid NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  pair          smallint NOT NULL CHECK (pair IN (1, 2)),
  margin        text NOT NULL CHECK (margin IN ('2-0', '2-1')),

  -- Frozen at pick time so reward math is stable
  probability   numeric(4,3) NOT NULL,           -- 0.000 to 1.000
  multiplier    numeric(4,2) NOT NULL,           -- 1.00 to 5.00
  is_fallback   boolean      NOT NULL DEFAULT false,

  -- Computed at finalisation (when match becomes finished)
  resolved      boolean      NOT NULL DEFAULT false,
  result        text         CHECK (result IN ('perfect', 'right', 'wrong', 'invalidated')),
  reward_guacas integer,                          -- null until resolved

  created_at    timestamptz  NOT NULL DEFAULT now(),
  resolved_at   timestamptz,

  UNIQUE (user_id, match_id)
);

CREATE INDEX ON match_predictions (user_id, created_at DESC);
CREATE INDEX ON match_predictions (match_id) WHERE NOT resolved;
```

Predictions are only insertable while `matches.status = 'scheduled'`. Enforced by an RLS policy that joins on `matches.status` plus a CHECK trigger as defense-in-depth.

### `user_prediction_stats` (denormalized; updated on each prediction resolve)

```sql
CREATE TABLE user_prediction_stats (
  user_id        uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  total_guacas   integer NOT NULL DEFAULT 0,
  total_picks    integer NOT NULL DEFAULT 0,
  picks_right    integer NOT NULL DEFAULT 0,    -- pair correct (incl. perfect)
  picks_perfect  integer NOT NULL DEFAULT 0,    -- pair + margin correct
  picks_wrong    integer NOT NULL DEFAULT 0,
  current_streak integer NOT NULL DEFAULT 0,
  best_streak    integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

Computed accuracy = `picks_right / (picks_right + picks_wrong)` — pending picks excluded.

### Match-level community stats (v1 — simple aggregate)

For the "Community pick: X%" surface, a query over `match_predictions`:

```sql
SELECT
  match_id,
  COUNT(*) FILTER (WHERE pair = 1) * 100.0 / COUNT(*) AS pair1_pct,
  COUNT(*) AS total_picks
FROM match_predictions
WHERE match_id = $1
GROUP BY match_id;
```

Cached client-side (60s). Only displayed when `total_picks ≥ 10` to avoid degenerate cases ("3 picks all on one side ≠ 100% community pick"). Threshold drops to 5 once the app crosses ~1k WAU per tournament window.

### Existing tables — unchanged

`matches`, `players`, `tournaments` are read-only here. Probability is computed at pick time from the `players.ranking` columns we already have.

## API surface

All routes live under `/api/predictions/*` and require auth (Auth.js session). Response shapes use existing `Match` types.

| Route | Method | Purpose |
|---|---|---|
| `/api/predictions` | POST | Create or replace a prediction. Body: `{ matchId, pair, margin }`. Server computes the multiplier from current rankings and freezes it on the row. Rejects if `match.status ≠ 'scheduled'`. |
| `/api/predictions` | DELETE | Body: `{ matchId }`. Removes the prediction (only allowed pre-match). |
| `/api/predictions` | GET | List the current user's picks. Query: `?status=pending\|won\|lost\|all`, `?limit=`, `?offset=`. |
| `/api/predictions/leaderboard` | GET | Global leaderboard. Query: `?period=week\|all`, `?locale=`. |
| `/api/match/[id]/predictions` | GET | Returns `{ pair1Pct, pair2Pct, totalPicks }`. Cached 60s. Public. |
| `/api/match/[id]/probability` | GET | Returns `{ p1, p2, multiplier1, multiplier2, isFallback }`. Cached 5min. Public. |

A scheduled job (cron at :05 every hour) **resolves** predictions for newly-finished matches: computes result, writes `reward_guacas`, updates `user_prediction_stats` (streak, totals).

## i18n

All UI strings go through `next-intl`. Locales: en/es/pt/it/fr (existing five). New keys live under `prediction.*`:

- `prediction.cta.pick` → "PICK"
- `prediction.cta.yourPick` → "YOUR PICK"
- `prediction.cta.locked` → "PICKS LOCKED"
- `prediction.makeYourPick` → "Make your pick"
- `prediction.upsetFlag` → "UPSET"
- `prediction.result.perfect` → "Perfect call"
- `prediction.result.right` → "Right · margin off"
- `prediction.result.wrong` → "Wrong"
- `prediction.result.heavyUpset` → "Heavy upset called"
- `prediction.community.pick` → "Community pick"
- `prediction.community.noPicksYet` → "Be the first to pick"
- `prediction.formula.stake` → "stake"
- `prediction.formula.multiplier` → "multiplier"
- `prediction.formula.ifRight` → "if right"
- `prediction.formula.bonus` → "+0.50× bonus if you nail the margin"

The currency name **"guacas"** stays untranslated. The "G" mark is a fixed visual asset.

Multiplier number format is locale-aware (`1.47` in EN; `1,47` in ES/IT/FR/PT) via `Intl.NumberFormat`.

## Phasing

Three deployable phases.

### Phase 1 — frontend card UX, localStorage backend

Goal: ship the new visual design and the multiplier-driven economy without DB changes. Predictions stay in localStorage.

- Update [`MatchCard.tsx`](../../../src/components/MatchCard.tsx) with corner CTA, expandable insights panel, all three card states (scheduled / live / finished).
- Build the `<PredictionFlow>` shared component (pair-pick → margin-pick → confirmed).
- Implement collapse mechanisms (auto + handle + body tap).
- Implement `computeMatchProbability(match)` and the multiplier formula in `src/lib/predictions/probability.ts`.
- Show probability/multiplier/guacas in the panel.
- Show 🎯 / ✓ / ✗ / 🔥 badges on finished cards (computed locally from stored prediction + final result).
- Update [`PredictionSection.tsx`](../../../src/app/[locale]/match/[id]/PredictionSection.tsx) on the match detail page to consume `<PredictionFlow>`.
- Local "My Picks" view at `/picks` reading from localStorage (no server stats yet).

After Phase 1 the prediction game is fully usable; just not socially comparable.

### Phase 2 — server-side predictions, leaderboards, real stats

- `match_predictions` + `user_prediction_stats` migrations.
- API routes (POST/DELETE/GET predictions, leaderboard, community %, probability).
- Migrate existing localStorage picks to server on first user login post-deploy (one-shot import).
- Resolution cron job.
- Real community pick % on cards.
- Leaderboard page at `/picks/leaderboard`.
- Stat strip on `/picks` reads from server.

### Phase 3 — refinements & sponsor slot

- Sponsorship line goes live (configurable per locale via env or admin).
- Live-tracking strip on live matches (Tier 2 features — server-side prob recompute).
- Hooks for future bonus mechanics from the "headroom" list above.

## Risks & open questions

- **Model accuracy.** v1 is intentionally conservative (capped 30-70%). If users game it (always pick favorites of unranked matches at flat 2.00×), we tighten. Mitigation: monitor distribution of multipliers actually claimed.
- **Cold-start community %.** At 120 WAU we'll have 0-3 picks per match for a while. Showing community % only at ≥10 picks avoids confusing edge cases. Threshold can drop later.
- **Sponsorship pacing.** Slot is built but kept empty in v1. Going live with a placeholder cheapens the surface. Wait for a real first deal.
- **Trademark hygiene.** "Guacas" should be cleared in EU trademark databases (classes related to mobile apps and entertainment) before public launch. ~30 min check, not a blocker, but needed.
- **Existing prediction-revamp design.** [`docs/superpowers/specs/2026-04-12-prediction-revamp-design.md`](2026-04-12-prediction-revamp-design.md) may contain decisions this spec contradicts. Reconcile before implementing Phase 1.
- **Locale pluralization.** Spanish "1 guaca / 100 guacas" works; English always uses "guacas". Italian/Portuguese/French follow Spanish pattern. Confirmed safe but worth a translator pass.

## What success looks like

**Six weeks after Phase 1 ships:**

- ≥40% of WAU make at least one prediction per session.
- Median picks/active-user/week ≥ 3.
- Sessions per WAU up ≥ 25% vs the pre-launch baseline.
- D7 retention ≥ 10pp higher on predicting cohort vs non-predicting cohort.

**Six months after Phase 2:**

- Leaderboard has ≥ 500 users with 10+ picks.
- ≥ 1 sponsorship deal closed for the "Predictions presented by" slot.
- Acquisition deck can quote: "X% of WAU predict, Y% accuracy, Z% week-over-week growth in picks/WAU."
