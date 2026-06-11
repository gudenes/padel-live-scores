# Match Prediction + Fan Vote — Design Spec

**Date:** 2026-06-11
**Status:** Approved design, pending implementation plan
**Author:** brainstormed with gudenes

## Summary

Bring the admin's calibrated Elo win-probability (`model_predictions`) into the
**user-facing** UI, and replace the existing margin-pick game on the match page
with a lightweight one-tap **"who will win" fan vote** that shows community
sentiment. Two user-facing surfaces:

1. **Match detail page** — a "PadelNacho Prediction" probability bar + a "Who
   will win?" fan vote (Layout A: stacked).
2. **Match list cards** — a quiet inline favorite tag (`🥑 62%`) on the model's
   favored pair, with a tap-to-explain popover.

This is **not** a betting feature. We surface our own model as a *prediction /
win probability*, never as decimal/bookmaker odds.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| **Framing** | Win **probability**, branded "PadelNacho Prediction" / "Our prediction". Never decimal odds. Non-gambling, app-store-safe. |
| **Data source** | Admin Elo `model_predictions.pair1_prob` (calibrated). Replaces the client-side ranking heuristic (`computeMatchProbability`) for *display*. |
| **Match states** | Show pre-match prediction on **scheduled**; **lock** it through live & finished ("were we right?"). Uses `model_predictions` only — NOT live in-play odds (`match_live_odds` worker stays off). |
| **Vote vs picks** | The new one-tap winner vote **replaces** the margin-pick game *in the UI*. |
| **Picks/Guacas code** | **Kept in the repo but hidden.** Guacas no longer shown anywhere. No deletion. |
| **Community aggregate** | **Yes** — after voting, reveal "X% of fans pick <pair>" as a split bar. |
| **Vote identity** | **Anyone** can vote. Guests deduped by a device key; logged-in votes tie to the user. |
| **Vote lifecycle** | Open pre-match; **locks when the match goes live**; then shows the user's pick result (right/wrong) + final community split. |
| **Surfaces** | Match **detail page** (full bar + vote) **and** match **cards** (favorite tag only). |
| **Detail layout** | **Layout A (stacked):** model prediction bar on top, fan-vote card below. Pairs render two players each. |
| **Card hint** | **Inline tag `🥑 62%`** on the favored pair's row (variant G6), tap opens an explanation popover. Renders only when a prediction exists; missing = today's card (no tag, no reserved space). |
| **Popover copy** | Blend: names the favored pair + a "not betting odds" disclaimer + a "How we predict →" link. |

## Architecture

Three concerns, designed as independent units:

### 1. Prediction read-path (server → client)

**Problem:** `model_predictions` has **no RLS** — it's server-only
(service-role). The browser cannot read it with the anon key (unlike
`match_live_odds`, which has an anon read policy).

**Decision — denormalize the latest prediction onto `matches`:**
The padelgod `model-prediction-snapshot` worker already writes a fresh snapshot
per match hourly. Extend it to also UPSERT the *latest* values onto a small set
of columns on the `matches` row:

- `pred_pair1_prob numeric` (0–1, nullable)
- `pred_model_version text` (nullable)
- `pred_computed_at timestamptz` (nullable)

Rationale:
- **Card hint needs batch reads across many matches per page** (home, matches,
  tournament). Denormalized columns ride along with the *existing* match
  fetches — zero extra round-trips, no N+1, works on every list surface for
  free. `matches` is already anon-readable.
- The favored pair and display % derive purely from `pred_pair1_prob`:
  `favored = pred_pair1_prob >= 0.5 ? 1 : 2`,
  `pct = round(max(p, 1−p) × 100)`.
- No new RLS surface, no new public endpoint, no exposure of the append-only
  snapshot history.

The append-only `model_predictions` table is untouched (admin/calibration still
read it). We only add a denormalized "latest" mirror on `matches`.

`pair2_prob` is implied as `1 − pair1_prob` (model is binary), so one column
suffices. (Confirm in the plan whether we want both for clarity.)

### 2. Match-detail prediction + vote widget

Replaces the inner widget of `PredictionSection` / `PredictionPanel` on
`src/app/[locale]/match/[id]/page.tsx`. The Guacas margin-pick flow
(`PredictionFlow`) is **hidden** (feature-flagged off / not rendered), code
retained.

**New component:** `MatchPredictionVote` (working name), with three lifecycle
modes mirroring the existing `deriveMode`:

- **prePick (scheduled):**
  - "PadelNacho Prediction" bar from `matches.pred_pair1_prob` (lime fill,
    pair names + %). Hidden entirely when no prediction exists.
  - "Who will win?" card with two pair buttons (paired avatars + both
    surnames). One tap = vote.
- **live (locked):** vote locked; show the user's locked pick, the frozen model
  bar, and the community split.
- **finished:** show result — user's pick right/wrong + who actually won —
  alongside final community split.

After voting (any state where results are unlocked): reveal community split as
**fan bars (blue) distinct from the model's lime**, with a "✓ you" marker on the
user's pick.

**Fallback:** if `matches.pred_pair1_prob` is null, the model bar is omitted but
the vote still works (vote is independent of the model). We do **not** fall back
to the old ranking heuristic for display.

### 3. Fan vote storage + aggregate

**New table `match_votes`:**

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `match_id` | uuid FK → matches | |
| `pair` | smallint | 1 or 2 (the voted-for pair) |
| `voter_key` | text | device id (guest) or `user:<uuid>` (logged-in) |
| `user_id` | uuid null | set when authenticated |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | vote can be changed before lock |

- **Unique (`match_id`, `voter_key`)** — one vote per voter per match; changing
  the vote UPSERTs.
- **Guest device key:** stable random id in `localStorage` (e.g.
  `pn_voter_key`); sent to the write endpoint. Logged-in users key on
  `user:<uuid>` so the same person isn't double-counted across guest→login.
- **Lock:** writes rejected once `matches.status` ∉ {scheduled} (server-side
  guard).

**Aggregate read:** a server route returns `{ pair1: n, pair2: n, total }` per
match (counts only — never individual votes). Computed via grouped count.
For the card surface we do **not** show counts; only the detail page reveals the
split, so the aggregate endpoint is detail-page-only (no batch needed for
cards).

**RLS:** writes go through a server route (service-role), so the table can stay
locked to anon. The route validates the device key, enforces the
scheduled-only lock, and UPSERTs.

**Endpoints (App Router, outside `[locale]`):**
- `POST /api/match-vote` — `{ matchId, pair, voterKey }` → upserts, returns new
  aggregate. Enforces lock.
- `GET /api/match-vote?matchId=…` — returns `{ aggregate, yourPick? }`
  (yourPick resolved from `voterKey` query / session).

Client hook `useMatchVote(matchId)` mirrors `useMatchPrediction`'s shape:
`{ aggregate, yourPick, vote(pair), loading }`, localStorage device key, optimistic update.

### 4. Card favorite tag + popover

In `src/components/MatchCard.tsx`, on the favored pair's row (after the seed
badge), render an inline tag when `match.pred_pair1_prob != null`:

- Tag: `🥑 {pct}%`, soft lime, chunky clip — matches existing seed/chip styling.
- Tap → toggles a chunky popover (reuse the exact pattern of `LateHintPill` /
  the day-indicator tooltip: `preventDefault` + `stopPropagation` so it doesn't
  navigate the card's `<Link>`; dismiss on outside-tap / Escape / ~4.5s
  auto-dismiss).
- Popover copy (i18n): header "Our prediction", body names the favored pair +
  "{pct}% win chance, from our Elo model. Not betting odds.", plus a
  "How we predict →" link (target: a short methodology blurb or the detail
  page's prediction section — decide in plan).
- Missing prediction → render nothing (no layout shift; mixed lists stay tidy).

## Data flow

```
padelgod model-prediction-snapshot (hourly)
   ├─ append snapshot → model_predictions   (unchanged, admin/calibration)
   └─ UPSERT latest → matches.pred_pair1_prob, pred_model_version, pred_computed_at  (NEW)

Browser (anon):
   match list fetch  → matches.* (incl. pred_*) → MatchCard favorite tag
   match detail page → match.pred_* → MatchPredictionVote model bar
                     → GET /api/match-vote → community split
                     → POST /api/match-vote (scheduled only) → updated split
```

## i18n

New message keys under a `prediction` / `vote` namespace across all 5 locales
(`en, es, pt, it, fr`): bar header ("PadelNacho Prediction" / "Our prediction"),
"Who will win?", vote button a11y labels, "X% of fans", "your pick",
result strings (right/wrong), popover header/body/link, "Not betting odds".

## Error handling & edge cases

- **No prediction** (FIP-tier, unranked, worker hasn't run): model bar + card
  tag both omitted; vote still works.
- **Vote after lock:** server rejects; client shows locked state, not an error.
- **Guest → login:** logged-in key supersedes guest key; we accept possible
  double-count across the transition (documented, low impact). No merge in v1.
- **Aggregate with zero votes:** show "Be the first to vote" empty state.
- **Tie / 50%:** favored pair defaults to pair 1 at exactly 0.5 (rare;
  acceptable). Card tag still shows 50%.
- **Stale denormalized value:** `pred_computed_at` lets us ignore predictions
  older than match start if needed (decide threshold in plan).

## Testing

- **Unit:** favored-pair + pct derivation from `pred_pair1_prob` (incl. <0.5,
  =0.5, null). Vote aggregate math. Lock enforcement (scheduled vs live).
- **Component:** `MatchPredictionVote` renders correct mode per status; reveals
  split after voting; omits model bar when null. `MatchCard` tag presence/absence;
  popover toggle + dismiss; no navigation on tap.
- **Manual (local app):** scheduled match shows bar + vote; vote updates split;
  card tag + popover; a no-prediction match shows neither but still votes.

## Out of scope (v1)

- Live in-play odds that move with the score (`match_live_odds`) — worker stays
  off; we use frozen pre-match only.
- Re-enabling / redesigning the Guacas economy (hidden, not removed).
- Guest→login vote merge/dedup.
- Card-level community vote counts (cards show model favorite only).
- A standalone methodology page (link may point to a blurb/section for now).

## Open questions for the plan

1. Store both `pred_pair1_prob` and `pred_pair2_prob`, or derive pair2 as
   `1 − p`? (Lean: single column.)
2. "How we predict →" link target — short modal blurb vs anchor to detail-page
   prediction vs a docs page.
3. Exact staleness threshold for ignoring an old `pred_computed_at`.
4. Feature-flag the rollout? (env flag mirroring `NEXT_PUBLIC_FIP_STREAMS_ENABLED`
   so we can dark-launch.)
