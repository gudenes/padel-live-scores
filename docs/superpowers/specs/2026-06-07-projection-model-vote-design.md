# Projection — model prediction + agreement vote (experiment)

**Date:** 2026-06-07
**Status:** Design — pending implementation plan
**Surface:** padelnachos.com Projection tab (road view), per pair.
**Extends:** the Road to Trophy / Projection feature.

## Summary

On a pair's road, surface a plain-language **prediction** ("Projected to reach the Quarterfinals") and a lightweight **gamified vote** — fans tap 👍/👎 on the prediction in front of them, and after voting we reveal a **global "agreement with our model" signal** ("78% of fans agree with our model · 12.4k votes"). The per-pair champion % stays in the hero; the prediction reads better than "1% champion" for the field. Votes are stored with pair context but the displayed/headline metric is **model-wide**, which is the meaningful experiment signal. The whole vote layer is an **experiment behind its own feature flag**.

## Goals

- A meaningful, human-readable projection for every pair (not just the high-% favourites).
- A low-friction fan-engagement loop (one tap) that yields a meaningful aggregate: do fans trust our model?
- Ship as a toggleable experiment, independent of the projection feature flag.

## Non-goals (YAGNI)

- No per-pair result display (only the global model-agreement metric is shown).
- No leaderboards, streaks, or auth gating.
- No per-vote versioning of the predicted round (a vote is sentiment on the model's call at tap time).
- No new projection data/worker changes — the prediction is derived from existing `tournament_projections.rounds`.

## UX

### 1. The prediction (derived, client-side)
For the tracked pair, compute the **projected finish** = the deepest round whose `reach_prob ≥ 0.5` (e.g. reach R16 .86, QF .55, SF .30 → **Quarterfinals**; a title favourite with reach F ≥ .5 → **Final**). Pure function over the road VM's rounds. Eliminated/champion pairs: show their factual result instead (e.g. "Won the title" / "Reached the SF") — reuse the existing `vm.status`/`eliminatedRound`; the vote card is hidden for finished pairs (nothing to predict).

### 2. The "Our prediction" card
Placement: a distinct card **under the road-to-trophy hero, above "Projected path"**. Shown on every active pair's road; updates when you drill into another pair.

States:
- **Collapsed (not voted):**
  - Eyebrow: *Our prediction*
  - Headline: "Projected to reach the **Quarterfinals**."
  - Prompt: *Do you agree with our call?* → **👍 Agree** / **👎 Disagree** (one tap).
- **Voted (reveal global signal):**
  - Headline stays.
  - A community bar: "**78% of fans agree with our model**" + "· 12,418 votes", your choice highlighted.
  - Tappable to change your vote (bar updates).
- The global number is identical across pairs (it's model-wide); once the user has voted anywhere, the bar is shown on every card (they can still cast a per-pair vote).

The vote UI only renders when the `projection_vote_enabled` flag is on; the **prediction headline shows regardless** (it's free, derived data).

## Data

### Table — `projection_votes`
```sql
create table public.projection_votes (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  category text not null check (category in ('men','women')),
  pair_key text not null,
  voter_id text not null,                 -- device UUID (pn_device_id), or user id when logged in
  vote text not null check (vote in ('agree','disagree')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tournament_id, category, pair_key, voter_id)
);
create index projection_votes_vote_idx on public.projection_votes (vote);
```
- RLS: no anon access (writes go through the server route with the service key). Mirrors how `match_rating` is handled.
- Pair context (`tournament_id, category, pair_key`) is retained for later analysis even though only the global tally is surfaced.

### Global tally
Two head-count queries (no row fetch, respects the 10k cap):
`select count(*) head where vote='agree'` and `…='disagree'` over the whole table → `{ agree, disagree }`. (Volume is experiment-scale; revisit with a cached counter row if it grows.)

### Device id
Reuse `getOrCreateDeviceId()` from `src/lib/anon-push.ts` (localStorage `pn_device_id`, `crypto.randomUUID`). When the user is logged in, prefer the account id as `voter_id` (so a logged-in user is one voter across devices); else the device id.

## API — `/api/projection-vote` (mirrors `/api/match-rating`)
- **POST** `{ tournamentId, category, pairKey, voterId, vote }` → upsert on the unique key (update `vote`+`updated_at` on conflict). Returns `{ yourVote, global: { agree, disagree } }`.
- **GET** `?tournamentId=&category=&pairKey=&voterId=` → `{ yourVote, hasVotedEver, global: { agree, disagree } | null }`. The global tally is returned only when `hasVotedEver` is true (reveal-after-vote, enforced server-side). `yourVote` is this pair's vote (or null).
- Validation: `vote ∈ {agree,disagree}`, `category ∈ {men,women}`, non-empty ids. Service-key client.

## Client — `useProjectionVote(tournamentId, category, pairKey)` (mirrors `useMatchRating`)
Returns `{ yourVote, global, hasVotedEver, loading, vote(choice) }`. On mount, GET the state for the pair; `vote()` POSTs and updates local state from the response. Caches the per-pair `yourVote` in localStorage for instant paint (like `useMatchRating`'s ratings cache), reconciled by the GET.

## Prediction helper — `src/lib/projection-view.ts`
Add `projectedFinishRound(rounds: RoadRoundVM[]): ProjRound | null` = the deepest round with `reachProb ≥ 0.5` (null if none/empty). Unit-tested. `ProjectionTab` maps it through `ROUND_LABEL_KEY` for display.

## Feature flag
Add `projection_vote_enabled` to `FLAG_KEYS` (`src/lib/feature-flags.ts`) and seed it via a migration (mirroring `20260606150000_projection_feature_flag.sql`): production OFF, local ON. `ProjectionTab` reads it via `useFeatureFlag(FLAG_KEYS.PROJECTION_VOTE_ENABLED)` and renders the vote UI only when on.

## i18n (projectionTab namespace, 5 locales)
`ourPrediction` ("Our prediction"), `projectedToReach` ("Projected to reach the {round}"), `agreeWithCall` ("Do you agree with our call?"), `agree` ("Agree"), `disagree` ("Disagree"), `fansAgree` ("{pct}% of fans agree with our model"), `voteCount` ("{count} votes"), `changeVote` ("Tap to change").

## Architecture / files

**Create:**
- `supabase/migrations/2026….._projection_votes.sql` — table + index.
- `supabase/migrations/2026….._projection_vote_flag.sql` — seed `projection_vote_enabled`.
- `src/app/api/projection-vote/route.ts` — GET/POST.
- `src/hooks/useProjectionVote.ts` — client hook.
- `src/lib/__tests__/projection-finish.test.ts` — `projectedFinishRound` tests.

**Modify:**
- `src/lib/projection-view.ts` — add `projectedFinishRound`.
- `src/lib/feature-flags.ts` — add `PROJECTION_VOTE_ENABLED`.
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` — render the prediction headline + (flagged) vote card via `useProjectionVote`.
- `src/messages/{en,es,pt,it,fr}.json` — i18n keys.

## Edge cases
- Pair whose deepest ≥50% round is its entry round (no wins favoured) → still "Projected to reach the {entry round}" (reads as an early exit). Acceptable for v1.
- Finished pairs (champion/eliminated) → show factual result; hide the vote card.
- Offline / API error on vote → keep the optimistic local vote, retry on next mount; never block the road.
- Flag off → no vote UI, prediction headline still shows.

## Testing
- **Unit:** `projectedFinishRound` (≥50% threshold; entry-round; champion→F; empty→null).
- **API:** POST upsert idempotency (same voter+pair updates, doesn't duplicate); GET gates global tally on `hasVotedEver`.
- **Local:** on a Premier draw, prediction shows per pair; vote → global bar reveals; re-vote flips; flag off hides the vote.

## Rollout
Experiment: `projection_vote_enabled` production OFF at ship. New table + flag migrations applied via the pg driver (per repo convention), idempotent. No worker changes. Ships on `feat/projection-picker` (continued polish branch).
