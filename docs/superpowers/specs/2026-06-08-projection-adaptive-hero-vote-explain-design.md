# Projection — adaptive hero + thumbs vote + explanation sheet

**Date:** 2026-06-08
**Status:** Approved (via mockup iteration at `mockups/projection-prediction/`)
**Scope:** Rework the projection road's hero so the headline metric adapts to the pair, surface the model-agreement vote in that hero (thumbs only, no count), remove the inline timeline prediction card, and add an ⓘ that opens a personalized, AI-framed explanation sheet.

All UI stays behind the existing `projection_enabled` / `projection_vote_enabled` flags.

## 1. Adaptive hero (the "Camino al título" card)

A pair is a **contender** when `championProb >= 0.10` (tunable const `CONTENDER_CHAMPION_PROB`).

**Contender (active + championProb ≥ 10%)** — unchanged hero:
- Green-tinted card, label `roadToTrophy`, "N wins to lift it 🏆", big `{pct}%` + `CHAMPION`, champion-prob bar, sparkline.
- Vote question: `voteWinTitle` ("Will they win the title?").

**Non-contender (active, championProb < 10%)** — prediction-led hero:
- Slate-tinted card (`rgba(154,174,196,.06)` / border `rgba(154,174,196,.2)`), label `ourPrediction` ("Our prediction").
- Bold line `predictionReach` = "Will reach **{round}**" (round accented gold via `t.rich`).
- Subtle slate "depth" bar (no caption) — fills to `projFinishIndex / totalRounds`.
- Vote question: `voteAgree` ("Do you agree?").

Both variants: an ⓘ button top-right opens the explanation sheet. `projFinish = projectedFinishRound(vm.rounds)`.

Done pairs (eliminated/champion) keep the existing **verdict card** — unchanged.

## 2. Thumbs vote (in the hero)

- Small chunky `PressButton` thumbs (👍 / 👎), `clipPath = CHUNK_CARD`, gated by `projection_vote_enabled`.
- **No count, no "% agree" text.** After voting, the chosen thumb stays lit (lime/red); the other dims to 0.4.
- Uses the existing `useProjectionVote` hook + `/api/projection-vote` (vote still recorded globally; just not displayed).

## 3. Remove the inline timeline prediction card

The per-round inline prediction card (added earlier) is removed — the bracket below the hero is just the path. (Already staged in the working tree.)

## 4. Explanation sheet (ⓘ → bottom sheet)

Mirror `AISummaryInfoSheet` structure: fixed scrim (`onClick=close`, z 90), bottom sheet (z 91, `maxHeight:85vh`, `overflowY:auto`), grab handle, `ChunkyPressButton` "Got it" close. Tap-outside + scroll + Got-it all dismiss. Chunky inner elements (number badges, highlight block use `CHUNK_CARD`).

**Content (canonical EN; mirrored to es/pt/it/fr):**
- Title `explainTitle`: "How the prediction works"
- Intro `explainIntro`: "Our AI model plays out the full tournament to estimate how far each pair will go."
- Step 1 `explainStep1`: "Each pair gets a strength rating from their recent results and official ranking."
- Step 2 `explainStep2`: "It simulates the draw multiple times and tracks which round each pair reaches."
- Personalized highlight (uses **this pair's** name + numbers):
  - Contender: `explainHlContender` rich — "**{names}**" + "{champPct} win the title" (`explainWinTitle`) + "{finalPct} reach the final" (`explainReachFinal`) + kicker `explainKickerContender` ("That's why they're our pick to lift the trophy.")
  - Non-contender: `explainHlUnderdog` — "**{names}** reach **{round}** in most simulations, but rarely further." (round accented)
- Close `explainClose`: "Got it"

No simulation count is mentioned. No emojis in sheet copy.

## Files
- `src/lib/projection-view.ts` — `CONTENDER_CHAMPION_PROB`, `isContender(championProb)`.
- `src/components/.../ProjectionExplainSheet.tsx` (new) — the personalized sheet.
- `src/app/[locale]/(app)/tournaments/[id]/ProjectionTab.tsx` — adaptive hero, ⓘ wiring, thumbs, remove inline card.
- `src/messages/{en,es,pt,it,fr}.json` — new `projectionTab` keys.

## Verification
Local dev unusable (external drive I/O); verify on the **Vercel preview** of the PR. tsc + eslint + existing projection unit tests must pass.
