# FIP-tier "presence-only" live treatment

**Date:** 2026-05-16
**Author:** brainstormed with Claude (Opus 4.7)
**Status:** spec, awaiting review

## Problem

FIP-tier (Bronze/Silver/Gold) matches flip to `status='live'` or `status='on_court'` via OOP snapshots or padelapi's coarse status feed, but no point-by-point data ever lands — Crionet only exposes per-match score endpoints for Premier-tier, and padelgod's live-poller subscribes there only.

In the current UI this means:
- The match row shows the amber **ON COURT** badge for what can be 2+ hours, with no score progression.
- The tournament header pill fires red **LIVE** (pulsing), implying real-time data is flowing when it isn't.
- The match detail hero shows a blinking red dot + **LIVE** label over a 0–0 board.
- `close-stale-live-sweeper` can't close these (no sets to infer a winner from), so the state persists until `fip-results-writer` finally posts a final — sometimes hours after play ended.

The asks on this surface are misleading: the affordances promise live data the integration can't deliver.

## Decision

Introduce the concept of **"presence-only live"** — a match the data layer knows is currently being played, but for which no live point-by-point will ever arrive. Render it with calm, honest UI: amber **ON COURT** without the red-LIVE family of affordances, plus a tappable explainer popover that tells the user why there's no point data.

Scope is intentionally narrow: this is a UI/labeling change. The data layer is unchanged. No new match statuses, no new DB columns, no padelgod work. The existing `status='live'/'on_court'` semantics are correct — we're just rendering them differently for FIP-tier.

## Detection

A single tiny helper, used everywhere we currently key off live status:

```ts
// src/lib/tournament-tier.ts (new file)

export function isPremierTier(level: string | null | undefined): boolean {
  if (!level) return false
  const n = level.toLowerCase()
  return (
    n.startsWith('p1') ||
    n.startsWith('p2') ||
    n.startsWith('major') ||
    n.startsWith('premier')
  )
}

export function isPresenceOnlyLive(
  match: { status: string },
  tournament: { level: string | null },
): boolean {
  if (!isLiveStatus(match.status)) return false
  return !isPremierTier(tournament.level)
}

function isLiveStatus(s: string): boolean {
  return s === 'live' || s === 'on_court'
}
```

`isPremierTier` is extracted from [src/lib/notification-icon.ts:33](src/lib/notification-icon.ts:33) (`circuitIconUrl`'s level check). After extraction, `circuitIconUrl` calls the new helper to avoid drift between the two definitions.

### Why scope to non-Premier rather than "any FIP" or "any non-PBP"

Premier match rows can briefly sit at `status='on_court'` during warm-up before the live-poller's first tick lands — but PBP arrives within ~1 minute. The pulsing-red **LIVE** treatment is honest there: data is imminent. Only FIP-tier sits hours with no data, so only FIP-tier needs demotion. Future tiers (e.g. APT, hypothetical others) can be added to `isPremierTier`'s allow-list if they ship live PBP, or left out otherwise.

## Surfaces affected

| Surface | File | Current behavior | New behavior |
|---|---|---|---|
| Match row — status chip | [src/components/MatchCard.tsx:104](src/components/MatchCard.tsx:104) (`statusChip`) | `status='live'` → red **LIVE**; `status='on_court'` → amber **ON COURT** | Both → amber **ON COURT** when presence-only; otherwise unchanged |
| Match row — info pill | [src/components/MatchCard.tsx](src/components/MatchCard.tsx) | n/a | New `<PresenceOnlyHint>` rendered next to the status chip, opens explainer popover |
| Tournament header pill | [src/components/MatchesTournamentGroup.tsx:147](src/components/MatchesTournamentGroup.tsx:147) (`tournamentStatusBadge`) | Any live-bucketed match → red **LIVE** | If every live-bucketed match in the group is presence-only → amber **ONGOING**. Mixed (any Premier-tier live) keeps red **LIVE**. |
| Match detail hero — live label | [src/app/[locale]/match/[id]/page.tsx:566](src/app/[locale]/match/[id]/page.tsx:566) | Blinking red dot + **LIVE** label | Amber **ON COURT** label + `<PresenceOnlyHint>`. No blinking dot. |
| Match detail — live point digits | [src/app/[locale]/match/[id]/page.tsx](src/app/[locale]/match/[id]/page.tsx) | `gamePoints` rendered in red when `isLive` | Skip for presence-only (no points exist anyway, but defensive) |
| Match detail — sub-tab default | [src/app/[locale]/match/[id]/page.tsx:244](src/app/[locale]/match/[id]/page.tsx:244) | Already defaults non-Premier live to `'players'` tab | Unchanged — existing `isPremier` check already covers this case |
| Match detail — Live Feed tab | [src/app/[locale]/match/[id]/LiveFeedTab.tsx](src/app/[locale]/match/[id]/LiveFeedTab.tsx) | Renders empty for presence-only | Hide the tab entirely for presence-only (dead destination) |
| Home — LiveMatchCard | [src/components/home/LiveMatchCard.tsx](src/components/home/LiveMatchCard.tsx) | Red **LIVE** pulse | If the spotlight match is presence-only, calm treatment + hint. (Rare, since spotlight prefers Premier — defensive.) |

### Match row score rendering

When status is `live` but presence-only, the per-set score columns are typically all `0–0`. We leave those as-is — showing the structure is fine. The change is purely in the chip + tournament pill.

## The `<PresenceOnlyHint>` component

A new component that wraps the proven [`LateHintPill` pattern at MatchCard.tsx:896](src/components/MatchCard.tsx:896):

- **Trigger:** a small dotted-underline button, 9px uppercase, orange (`ORANGE` / `#F5A623`), set adjacent to the **ON COURT** chip.
  - Label: `tMatch('presenceOnly.label')` → "no point-by-point" (EN), translated 5 locales.
  - On match detail hero, sits in the metadata row next to the **ON COURT** pill at slightly larger sizing (10px label) to match the hero scale.
- **Popover (on tap):** absolutely-positioned, copies `LateHintPill`'s exact visual treatment:
  - Background: `linear-gradient(135deg, #1A1A1D 0%, #131316 100%)`
  - `clipPath: CHUNKY.badge`
  - `boxShadow: 0 8px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 0 24px ${ORANGE}10`
  - Animation: `mc-locked-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1)` (reuse existing keyframe)
  - 9px uppercase orange header + 11px body line
  - Info icon: 13×13 SVG circle-with-i (no emoji, per project convention)
- **Dismissal:** identical to `LateHintPill` — tap-to-toggle, auto-dismiss after 4.5s, `Escape` key, tap-on-popover.
- **Telemetry:** `posthog.capture('presence_only_live_shown', { matchId })` once on mount, `posthog.capture('presence_only_live_tapped', { matchId })` on open.

### Where the component lives

`src/components/PresenceOnlyHint.tsx` — sibling to `MatchCard.tsx`, following the colocation preference. It accepts `{ matchId, variant: 'row' | 'hero' }` so the hero variant can scale the label and adjust the popover anchor (`right`/`bottom` offsets differ on the hero card vs. the match row).

### Why a new component instead of generalizing `LateHintPill`

`LateHintPill` is a closed enum (`'may_be_late' | 'starting_soon'`) tightly coupled to scheduled matches with `match.late_hint`. Mixing presence-only into that enum would add an unrelated concern. Better: extract the shared visual shell into a tiny `<ChunkyHintPopover>` primitive in a follow-up if a third hint surfaces. For two hint variants (one per file), duplicating ~80 lines of styled JSX is cheaper than premature abstraction.

## Tournament header pill demotion

In [`tournamentStatusBadge` at MatchesTournamentGroup.tsx:123](src/components/MatchesTournamentGroup.tsx:123), the rule today is:

```
1. groupBucketCounts.live > 0 → red LIVE
2. tournament.status='finished'/... → FINAL
...
```

New rule:

```
1a. groupBucketCounts.live > 0 AND at least one of those matches is Premier-tier → red LIVE
1b. groupBucketCounts.live > 0 AND all those matches are presence-only → amber ONGOING
2.  tournament.status='finished'/... → FINAL
...
```

This requires the badge function to know which of today's matches are presence-only, not just the bucket counts. Two options:

- **A) Pass `presenceOnlyLiveCount` alongside bucket counts.** Bucket builder already iterates today's matches; add a counter. `groupBucketCounts.live - presenceOnlyLiveCount > 0` ⇒ at least one Premier-tier live.
- **B) Pass the tournament level to the badge function** (already available — the group carries it) and have the badge derive demotion from `groupBucketCounts.live > 0 && !isPremierTier(level)`. This is wrong if a single tournament ever has mixed-tier matches, but tournaments are tier-uniform.

**Chosen: B**, because tournaments are tier-uniform in our schema (a tournament has one `level`). One-line change in the badge function. If that invariant ever breaks, we revisit with A.

## i18n

New translation keys under `match.presenceOnly.*`, shipped to all five locales (EN/ES/PT/IT/FR). Per the translation-context preference, keys carry descriptive paths and `_context` siblings where ambiguous.

```json
"match": {
  "presenceOnly": {
    "label": "no point-by-point",
    "label_context": "Small dotted-underline tap target shown next to the ON COURT badge for FIP-tier matches. Indicates that this tournament does not provide live point-by-point coverage. Translation should be a short noun-ish phrase, not a sentence.",
    "popoverTitle": "NO LIVE POINT-BY-POINT",
    "popoverBody": "This tournament doesn't broadcast point-level data. The final score will appear when reported.",
    "ariaLabel": "Why there's no live score updates"
  }
}
```

Spanish, Portuguese (Brazil), Italian, French translations to be drafted with the same context.

## Edge cases

- **Match flips to Premier-tier classification mid-event.** Not possible in practice — tier is set at tournament creation and not edited. If it did happen, the next render simply switches treatment.
- **Premier-tier match temporarily shows `on_court` during warmup.** Unchanged today's behavior: red **LIVE** chip, no `<PresenceOnlyHint>`. The pulse goes away when PBP starts ticking.
- **Tournament has no `level` set.** `isPremierTier(null) === false` ⇒ treated as presence-only. This is the right default: unknown tier ⇒ assume no live data, calmer UI. (Premier tournaments always have a level set; FIP scraper does too.)
- **A FIP match somehow gets PBP data** (e.g., a future widget integration). Today's UI keys off `status`, not "has points." If we ever land PBP for FIP, the calm treatment is still honest — the points just render in the existing per-set rows. We'd revisit the chip label at that point.

## Non-goals

- **No backend changes.** No new status, no new column, no padelgod worker change, no `close-stale-live-sweeper` adjustment. The data layer is fine; only rendering is wrong.
- **No change to web-push notifications.** "Live started" pushes still fire on `scheduled → live`. The notification copy can be revisited later if needed.
- **No change to the `LateHintPill` component itself.** This spec adds a sibling, not a refactor.
- **No A/B test or feature flag.** This is a pure UI honesty fix; rolling out behind a flag adds complexity without buying anything.

## Implementation order (preview for writing-plans)

1. Extract `isPremierTier` to `src/lib/tournament-tier.ts`; update `circuitIconUrl` to use it.
2. Add `isPresenceOnlyLive` to the same file with unit tests.
3. Add 5 i18n keys under `match.presenceOnly.*`.
4. Build `<PresenceOnlyHint>` component (mirrors `LateHintPill` styling).
5. Wire into `MatchCard` (`statusChip` returns amber **ON COURT** when presence-only; render `<PresenceOnlyHint>` adjacent).
6. Wire into `MatchesTournamentGroup` (`tournamentStatusBadge` demotes to **ONGOING** when tournament is non-Premier-tier and has live-bucketed matches).
7. Wire into match detail hero (drop blink dot + red **LIVE** label for presence-only; render `<PresenceOnlyHint variant="hero">`).
8. Hide Live Feed tab on match detail for presence-only.
9. Wire into `LiveMatchCard` (defensive — spotlight rarely lands on FIP).
10. Visual verification on dev server: today's matches page, a FIP match detail page, the home spotlight (if applicable).

## Telemetry follow-up

After ship, watch `presence_only_live_shown` vs `presence_only_live_tapped` to size the "Why?" curiosity. If tap rate is high (~10%+), consider promoting the explainer from popover to an always-visible micro-line under the chip. If near zero, the silent calm treatment is enough on its own and we could remove the hint affordance entirely.
