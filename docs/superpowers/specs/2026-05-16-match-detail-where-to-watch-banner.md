# Match-detail Where-to-Watch banner — design spec

## Summary

Add a small standalone banner on the match detail page that opens the same Where-to-Watch popup we shipped on the matches list and tournament pages. The banner sits directly below the hero score area, scoped to the match's tournament circuit, and replaces the existing `MatchStreamCard` (which was feature-flagged off behind `NEXT_PUBLIC_FIP_STREAMS_ENABLED` and only covered FIP-tier matches).

Mockup reference: [`.superpowers/brainstorm/665-1778919031/content/match-detail-positions.html`](../../../.superpowers/brainstorm/665-1778919031/content/match-detail-positions.html) — variant **B · Banner under the hero**.

Built on the shipped foundation in [`docs/superpowers/specs/2026-05-15-where-to-watch-unification-design.md`](2026-05-15-where-to-watch-unification-design.md). Re-uses every popup component and data shape; this spec only describes the new banner trigger and its placement on the match page.

## Problem

The match detail page is the natural surface for "where can I watch this?" — the user is one tap away from committing to a match. Today we have:

- **`MatchStreamCard`** — gated behind `NEXT_PUBLIC_FIP_STREAMS_ENABLED` (currently off in prod). FIP-tier matches only. Renders a rich card with cover art per stream. Premier-tier matches show nothing.
- **No regional broadcaster info** at all on this surface — even for Premier matches in regions where YouTube isn't free (Spain, Italy, etc.).

The unified `WhereToWatchPill` we just shipped solves the regional-broadcasters case for the matches list and tournament pages, but doesn't appear on the per-match surface where intent is highest.

## Approach

Introduce a `<WhereToWatchBanner>` component — a full-width single-row trigger that opens the existing `<WhereToWatchPopup>`. Same self-hide logic as the pill: when `buildGroups()` returns an empty array, the banner renders nothing.

The banner is the **only new component**. Everything inside the popup (groups, channel headers, broadcaster rows, region picker, footer) is unchanged.

## UI design

### Banner layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [▶]   Watch live · 2 options                            VER → │
└─────────────────────────────────────────────────────────────────┘
```

- Single row, ~40px tall. `margin: 0 16px 14px` (matches surrounding card spacing on the page).
- Container: `background: rgba(255,255,255,0.04)`, `border: 1px solid rgba(255,255,255,0.08)`, `clip-path: polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)`. Same chunky language as the existing match-page secondary cards.
- Three children, flex row, gap 10px:
  - **Icon**: same red YT-style play glyph as the pill — `20×14 background:#FF0000 border-radius:2.5` with white triangle SVG inside.
  - **Copy**: 11px, color `#D8D8DD`, line-height 1.35. State-dependent text (see below). Flexes to fill.
  - **CTA**: `VER →` (or localized equivalent), 10px uppercase font-weight 800, orange `#F5A623`, `border: 1px solid rgba(245,166,35,0.4)` with the same chunky clip-path as a pill. Decorative — the whole row is the tap target.
- The button wrapping the whole row gets `cursor: pointer` and `touch-action: manipulation`.

### Copy (5 locales)

Adapts to match state + data availability. Single ICU template with branches:

| State | Condition | Copy (en) |
|---|---|---|
| LIVE w/ YT live | `liveStreamCount > 0` | `Watch live · {count} options` |
| LIVE / SCHED w/o YT, w/ regional | `liveStreamCount === 0 && broadcasterCount > 0` | `Watch in {region}` |
| SCHEDULED (any) | match.status === 'scheduled' | `Where to watch` |
| (Hidden) | `buildGroups()` returns `[]` | — banner not rendered |

Region name uses the same `ISO2_TO_NAME` map (defaults to ISO uppercase if unknown).

### When the banner shows

```
showBanner =
  match.status !== 'finished'   // not done yet
  && match.status !== 'walkover'
  && match.status !== 'retired'
  && groups.length > 0           // pill's self-hide condition
```

`ended` is treated as live (match transitioning to finished — points may still come in).

### When the banner is hidden

- Match status is `finished`, `walkover`, or `retired` — match is done; replay links belong elsewhere (future work).
- `buildGroups({ liveChannels, broadcasters, channelsMeta, todayCircuits, country })` returns empty (no live YT for this channel AND no regional broadcasters apply).

## Component structure

```
src/components/where-to-watch/
  ├── WhereToWatchBanner.tsx     — new: full-width trigger row + popup orchestration
  └── (existing files unchanged)

src/app/[locale]/match/[id]/page.tsx
  — Remove: streamTier state + resolveStreamForMatch effect + <MatchStreamCard>
  — Add: client effect fetching liveChannels/broadcasters/channelsMeta for this match's circuit
  — Add: <WhereToWatchBanner> at the same line where MatchStreamCard sat

src/components/MatchStreamCard.tsx         — deleted
src/lib/fip-stream-resolver.ts             — leave for follow-up cleanup (used only by MatchStreamCard)
```

`WhereToWatchBanner` props:

```ts
interface WhereToWatchBannerProps {
  matchStatus: string                  // drives the hide rule
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  channelsMeta: ChannelMeta[]
  todayCircuits: string[]              // [channelAbbr] for this match's tournament
  geoCountry: string | null
}
```

State: `open` + `preferredCountry` (read once from `localStorage`, written via `onCountryChange` — exact same pattern as `WhereToWatchPill`).

### Data fetching on the match page

Mirrors the pattern already in `tournaments/[id]/page.tsx`'s `V3Overview` sub-component:

```ts
const tournamentChannelAbbr = useMemo(
  () => levelToChannelAbbr(match?.tournament?.level),
  [match?.tournament?.level],
)

const [wtwBroadcasters, setWtwBroadcasters] = useState<BroadcasterRow[]>([])
const [wtwLiveChannels, setWtwLiveChannels] = useState<LiveChannel[]>([])
const [wtwChannelsMeta, setWtwChannelsMeta] = useState<ChannelMeta[]>([])
const [wtwGeoCountry, setWtwGeoCountry] = useState<string | null>(null)

useEffect(() => {
  if (!tournamentChannelAbbr) { /* reset */ return }
  // Read geo-country cookie client-side.
  // Promise.all three Supabase queries scoped to this channel.
  // setState on resolution; cleanup with `cancelled` flag on unmount.
}, [tournamentChannelAbbr])
```

The match page is already a client component (`'use client'`), so this fits naturally. No new server-side wiring.

## i18n

Two new keys (in addition to the `whereToWatch.*` namespace we shipped):

```
whereToWatch.bannerLiveCount    — "Watch live · {count, plural, one {# option} other {# options}}"
whereToWatch.bannerWatchIn      — "Watch in {region}"
whereToWatch.bannerWhere        — "Where to watch"
whereToWatch.bannerCta          — "VER" (es) / "WATCH" (en) / etc. — reuse `watchCta` if it fits, otherwise add `bannerCta`
```

5 locales (en/es/pt/it/fr) as usual.

## Out of scope

- Cross-fading the banner between states as the match goes from scheduled → live → finished. The banner re-renders naturally on prop change; no animation.
- Showing broadcaster details inline in the banner. The banner just opens the popup.
- A future "Replay" affordance for finished matches. Different content (YouTube highlights, channel videos) — not covered here.
- Removing `src/lib/fip-stream-resolver.ts` — handled in a follow-up cleanup commit once MatchStreamCard is gone.

## Verification

1. **Premier live match, Spanish user:** banner shows below hero, "Watch live · 2 options" (Premier YT is live). Tap → popup with PP block (LIVE + streams + Movistar/Red Bull nested).
2. **Premier scheduled match, no current YT:** banner shows, "Where to watch". Popup shows PP block (no LIVE chip, "Watch Premier Padel on:" + broadcasters).
3. **Premier match, user in country with no broadcasters (e.g. US), no YT live:** banner hidden — nothing to surface.
4. **FIP live match, no broadcasters anywhere:** banner shows "Watch live · 1 option" with the FIP YT stream in the popup.
5. **Finished match:** banner hidden.
6. **No tournament level / no circuit:** banner hidden (no `tournamentChannelAbbr`).
7. **Banner replaces MatchStreamCard:** confirm no double-render at the same slot; `NEXT_PUBLIC_FIP_STREAMS_ENABLED` reference removed.
8. **Region picker reachable from this banner's popup:** same picker as the matches-page pill — search, flags, alphabetical.
