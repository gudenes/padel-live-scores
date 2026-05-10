# Bookmark Replaces Picks on MatchCard

**Status:** Design (approved)
**Author:** Claude (with @GuDenes brainstorming session 2026-05-10)
**Mockup:** [`public/mockup-bookmark-vs-picks.html`](../../../public/mockup-bookmark-vs-picks.html) (mode: **Strict · always star**)

## 1. Goal

Simplify the matches-list MatchCard by replacing its corner prediction element (PICK / YOUR PICK / locked / result badge) with a single universal bookmark star. Picks UI lives only on the match detail page after this change. The corner gains one consistent meaning across every match state and tier.

A secondary goal is unloading MatchCard — the prediction state machine, expandable inline panel, and result-badge logic are responsible for ~250 of MatchCard's ~1200 lines today; the bookmark replacement collapses all of that into a 1-line `<FollowButton>` drop-in.

## 2. Scope

### In scope
- Replace `<CornerElement />` rendering on MatchCard with a `<FollowButton variant="star" type="match" />`.
- Remove the inline `PredictionPanel` expansion + all prediction state on MatchCard.
- Remove `CornerElement`, `LockedPill`, prediction state hooks, and the `handleLocked` / `refreshPrediction` machinery from MatchCard.

### Out of scope
- Server-side migration of historical pick data — stays in localStorage / DB as-is.
- Removing `useMatchPrediction` hook or `PredictionPanel` component — still used by the detail page.
- Backend changes to bookmarks — already production via `useFollowing` + anon push.
- Adding `<FollowButton>` to the match detail page header — flagged as a separate small follow-up task.
- Removing the `tournamentLevel` prop from MatchCard — passed by callers; removing it is a separate cleanup once nothing reads it.
- Backend metering / analytics for picks engagement — assume the metric drops, accept it as a known UX trade-off.

## 3. UX

### 3.1 The corner

Top-right of every MatchCard becomes `<FollowButton variant="star" type="match" targetId={match.id} size={20} />`. Two states (driven by `useFollowing`):

- **Not bookmarked** → grey outlined star (#6B7280 stroke, no fill).
- **Bookmarked** → gold filled star (#F5A623 fill + stroke).

Tap toggles. Click event uses `e.preventDefault() + e.stopPropagation()` (already inside `<FollowButton>`) so the wrapping `<Link>` to match detail does not navigate.

Position: same coordinates the current `<CornerElement />` lives at — top-right corner above the meta row, centered vertically with the match round chip. Matches the pattern home `UpcomingMatchCard` already uses.

### 3.2 First-bookmark push flow (iOS-aware, inherited)

When the user toggles the star ON (bookmarked):

1. `useFollowing.toggle('match', id)` mutates the local follow set.
2. `useFollowing` dispatches `BOOKMARK_EVENT`.
3. The mounted `<BookmarkToastProvider>` shows a toast at the bottom of the viewport. On the first bookmark, the toast carries a green "Enable notifications" CTA.
4. Tapping the CTA calls `tryEnablePushOrShowInstallNudge(initialBookmarks, 'bookmark_toast')` which branches:
   - **iOS Safari (regular tab)** → dispatches `PWA_NUDGE_EVENT`. The mounted `<PWAInstallNudge />` modal opens with the animated mini-iPhone demo and localised body copy from `consent.pwaInstall.{title,body}`. Marks `pn_pwa_nudge_shown` in localStorage so it never re-prompts on this device.
   - **iOS Safari, nudge already shown** → silent no-op. User can re-find install instructions in profile (separate UI, already exists).
   - **Everywhere else** → triggers native push permission prompt and registers an anon subscription (`anonPush.ensureSubscription`). Existing bookmarks are sent as the initial subscription set so push works retroactively.

This entire flow is already wired and used by `BookmarkToast.tsx` (line 211–236). The MatchCard star inherits it transparently — no new code for the iOS path.

### 3.3 What goes away from the card

- **Scheduled, no pick** — was green `PICK` CTA → now grey star.
- **Scheduled, picked** — was muted `YOUR PICK` pill → now grey/gold star (pick still exists in localStorage; user can revisit on detail).
- **Live, no pick** — was green `PICK` CTA → now grey star.
- **Live, picked** — was `YOUR PICK` pill → now star.
- **Live, prediction-enabled but locked (Premier-tier mid-match)** — was greyed `LockedPill` → now star.
- **Finished, picked correctly** — was green `CORRECT` result badge → now star (result visible on detail).
- **Finished, picked wrong** — was red `WRONG` result badge → now star.
- **Finished, no pick** — was empty corner → now star (new affordance).

The single change every user sees: **all match cards now have a star in the corner**, replacing whatever was previously there (and adding one where the corner was empty).

## 4. Architecture

### 4.1 MatchCard component changes

Single file: [`src/components/MatchCard.tsx`](../../../src/components/MatchCard.tsx). Net deletion ~250 lines, addition ~10 lines.

**Removed**:
- Import of `Prediction`, `classifyResult` from `@/lib/predictions/*`.
- Import of `PredictionPanel` from `@/components/prediction/PredictionPanel`.
- `isPredictionEnabled` derived value.
- `prediction`, `setPredictionLocal`, `isOpen`, `setIsOpen`, `closeTimer` state hooks.
- `refreshPrediction`, `toggleOpen`, `handleLocked` callbacks.
- The `useEffect` that re-reads localStorage on `isOpen` close.
- The corner JSX block that renders `<CornerElement />` (in both call sites — chip-row and outside-chip-row spots).
- The expandable insights panel block (`isPredictionEnabled && (<div>{isOpen && <PredictionPanel … />}</div>)`).
- `CornerElement` and `LockedPill` function definitions at the bottom of the file. `LockedPill` is only referenced from inside `CornerElement` (verified [line 997](../../../src/components/MatchCard.tsx#L997)) — removing `CornerElement` orphans it, safe to delete together.

**Kept (do NOT remove)**:
- `_matchCardPrev` module-level `Map<string, …>` — powers the live-score flash animation triggered when a pair scores during a live match. Not prediction-related. Verified at the score-flash `useEffect` [line 310–340](../../../src/components/MatchCard.tsx#L310).
- `mc-locked-pop` keyframe — also used by `LateHintPill` ([line 1234](../../../src/components/MatchCard.tsx#L1234)), which is staying.
- `mc-score-sweep` keyframe — used by the live-score flash element ([line 579](../../../src/components/MatchCard.tsx#L579)).
- `fipStreamPulse` keyframe — used by FIP stream button.
- `mc-day-tip-pop` keyframe — used by the day-indicator tooltip.

**Added**:
- Import of `FollowButton` from `@/components/FollowButton`.
- One JSX line in the same physical position the `<CornerElement />` lived: `<FollowButton variant="star" type="match" targetId={match.id} size={20} style={{ position: 'absolute', top: 12, right: 12 }} />`.

**Kept**:
- `tournamentLevel` prop — still passed by `MatchesTournamentGroup`, removing it is a separate cleanup.
- All non-prediction logic (live realtime sub via `useLiveMatch`, score flash, day-indicator chip, late hint, court / round / status chips, FIP stream button, gender accent bar, etc.).

### 4.2 Click semantics

`<FollowButton>` already calls `e.preventDefault()` + `e.stopPropagation()` inside its `handleClick`. The wrapping `<Link>` to match detail will not fire when the star is tapped. Verified by reading `src/components/FollowButton.tsx:78–82`.

### 4.3 Match detail page

No changes. `PredictionSection` and `PredictionResult` continue rendering `<PredictionPanel />` for prediction-enabled (Premier-tier) matches at [`src/app/[locale]/match/[id]/PredictionSection.tsx`](../../../src/app/[locale]/match/[id]/PredictionSection.tsx). Users who want to pick now navigate from the matches list into the detail page, where the panel lives.

### 4.4 Backwards compatibility

- **Existing picks** (saved in `localStorage.pn_match_predictions`) remain readable by the detail page's `useMatchPrediction`. Past picks are not deleted.
- **Existing bookmarks** (in the `useFollowing` set) carry over unchanged. Users with bookmarks will see filled stars on those cards immediately after the deploy.
- **PostHog events** previously fired by `CornerElement` (e.g. prediction CTA taps) stop firing from the matches list. The detail page's panel keeps firing them. Net result: lower top-of-funnel pick-CTA telemetry, same conversion telemetry from the panel itself. Acceptable.

## 5. Edge cases

- **MatchCard reused on tournament-detail / match-detail pages** — both currently pass `tournamentLevel`. Neither passes a `dayBucketIso`, so the day chip is gated off there. The bookmark star will appear on those surfaces too, since the corner is unconditional. This is a behavioural change on those pages: the star wasn't previously rendered. Expected and desirable — universal bookmark surface.
- **Anonymous user, no push subscription, taps star** — useFollowing writes to localStorage, BookmarkToast shows with "Enable notifications" CTA. If they ignore the CTA, bookmark still works locally and surfaces in feed personalization. No regression.
- **Signed-in user with push already enabled, taps star** — same as today's home `UpcomingMatchCard`: bookmark adds to follow set, push subscription updates server-side via `useAnonPush`/`useFollowing`. Toast shows but with no CTA (nothing to enable).
- **Card double-tap (race between Link and star)** — handled. `FollowButton` calls `preventDefault()`+`stopPropagation()` so the Link's onClick never fires.
- **Already-bookmarked tournament gets a new match** — the new card renders with a grey star (the bookmark target is the match, not the tournament). Matching today's home behaviour; tournament-following is a separate feature.

## 6. Testing

- **Visual** — verify star renders top-right of MatchCard in scheduled / live / finished / retired / walkover states. Tap toggles colour + bookmark set.
- **Click isolation** — confirm tapping the star does NOT navigate to match detail. Tapping anywhere else on the card DOES.
- **iOS Safari (regular tab) on first bookmark** — verify `<PWAInstallNudge />` modal opens. Verify second bookmark in same session does NOT re-open the modal (`pn_pwa_nudge_shown` localStorage key set).
- **Already-bookmarked match on initial render** — star renders gold (filled) without flicker.
- **Tournament detail page MatchCard** — star renders, bookmark works. Picks UI does NOT render (gone from card entirely).
- **Match detail page** — `PredictionPanel` still renders for Premier-tier matches; non-Premier matches see no panel. Unchanged.

No new unit tests for MatchCard's render (repo has no RTL setup). Coverage relies on existing `useFollowing` and `pwa-install` tests, plus manual smoke verification against the live data.

## 7. Rollout

Single PR, no flag. Pure additive on the bookmark side (FollowButton already in production), pure deletion on the picks side (panel still reachable on detail). Roll forward only — no migration needed.

## 8. Future

- **Match detail page star** — add `<FollowButton variant="star" />` in the detail page header so users can bookmark / unbookmark from there too. Small cohesion improvement, separate task.
- **`tournamentLevel` prop cleanup** — once nothing on MatchCard reads it, remove from the prop interface and from `MatchesTournamentGroup`'s pass-through. Separate cleanup PR.
- **Picks engagement compensation** — if the picks-funnel drops noticeably after this ships, consider a one-time onboarding tip on first match-detail visit ("Try predicting the score") to recover conversion.
