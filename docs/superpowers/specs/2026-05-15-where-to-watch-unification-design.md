# Where-to-Watch unification — design spec

## Summary

Replace the YouTube-only "Live Now" popup on `/matches/[date]` with a unified **Where to Watch** popup that also surfaces country-aware broadcasters (Movistar Plus, Red Bull TV, etc.). The popup groups streams by channel/circuit; each circuit-aware group nests both its YouTube broadcasts AND the regional broadcasters licensed to carry that circuit's content. A footer affordance lets users override the detected region.

The tournament page's existing `WhereToWatch` card is replaced by the same compact popup, opened from a smaller trigger (one row, one tap) — removing the big editorial card that dominates Overview today.

**Direction:** matches-page pill that fires whenever a live YouTube broadcast OR a regional broadcaster applies to today's matches. Single TV icon, single popup, channel-grouped content, regional footer.

Mockup reference: [`.superpowers/brainstorm/81777-1778877706/content/variant-a-nested-v2.html`](../../../.superpowers/brainstorm/81777-1778877706/content/variant-a-nested-v2.html) (will be promoted to `public/mockup-where-to-watch.html` during implementation).

## Problem

Three things are wrong with the current state:

1. The matches-page YT pill is **YouTube-only**. A Spanish user on a day where Premier Padel only streams on Movistar/Red Bull sees nothing — even though both are available to them.
2. The tournament-page `WhereToWatch` card has the regional broadcasters, but it's a **large vertical block** that pushes everything else down the Overview tab.
3. The two surfaces use **different data models and components** (`youtube_channels` for the popup, `broadcast_info` + `broadcasters` for the card). Adding a new broadcaster requires editing two places to be sure both surfaces pick it up.

## Approach

One reusable popup component, two trigger contexts:

- **Matches page** (`/matches/[date]`): replace `YoutubeLiveIndicator` with `WhereToWatchPill` + popup
- **Tournament detail** (`/tournaments/[id]`): replace the inline `WhereToWatch` card with the same pill (or compact trigger row), opening the same popup

The popup renders **channel groups**. Each group is one circuit/broadcaster identity (Premier Padel, FIP Tour, future PadelTV, etc.) and contains:

1. A channel header (avatar, name, optional LIVE chip)
2. Live YouTube sub-rows for that channel (if any)
3. Nested regional broadcaster rows for that channel's content (filtered by user region)

Groups that have nothing to show (no live YT AND no broadcasters AND no scheduled match content) are omitted. The pill itself is hidden when zero groups would render.

## UI design

### Trigger pill

Lives where `YoutubeLiveIndicator` lives today: left of the EN VIVO filter pill in `MatchesFilterBar`.

```
┌───────────┐
│ 📺   2    │   ← TV icon (matches WhereToWatch.tsx eyebrow icon) + count
└───────────┘
```

- Icon: the same outline TV/monitor SVG used in `src/components/WhereToWatch.tsx` (rect + antenna polyline) — neutral, not YouTube-branded.
- Count badge: **only rendered when at least one YouTube stream is live**, and equals the number of live YT streams across all tracked channels. When no YT is live (broadcasters-only state), the badge is omitted — just the TV icon. Keeps "count = something is happening right now" semantics.
- Color: muted dark surface (`rgba(255,255,255,0.06)` bg, `rgba(255,255,255,0.10)` border). No red — we removed YouTube branding because the popup is multi-source.
- Active state when popup is open: slight orange tint on the border (matches the eyebrow color inside).
- Pill is hidden entirely when zero groups would render (no live YT AND no applicable regional broadcasters).

### Popup frame

Same modal shell as today's `YoutubeLiveIndicator`:

- Portal-rendered overlay, centered, ~360–380px wide, max-height 85vh, `clipPath: polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)`
- Backdrop dismiss + Escape close
- Same playful entrance keyframes (`yt-live-pop-in`, etc.) — rename to `wtw-pop-in` etc. and keep the same easing/timing

**Header:**
- Eyebrow row: orange TV icon + "Where to Watch" (12px, weight 800, letter-spacing 1.5px, uppercase)
- Close button (top-right): existing chunky-clipped 32×32 hitbox in a 56×56 tap target

### Channel group

```
┌─[avatar PP]─┬─ PREMIER PADEL  · LIVE ──────────────┐
│             │                                       │
│             │ Buenos Aires P1: Centre Court (ES)  ▶ VER │
│             │ Buenos Aires P1: Centre Court (EN)  ▶ VER │
│             │                                       │
│             │ 🇪🇸 ALSO IN SPAIN                    │
│             │ ┌────────────────────────────────┐   │
│             │ │ [RB] Red Bull TV   FREE       →│   │
│             │ │ [M+] Movistar Plus+           →│   │
│             │ └────────────────────────────────┘   │
└─────────────┴───────────────────────────────────────┘
```

- **Header row:** 30×30 round avatar (channel `colorHex` background, white abbreviation) + channel name (12px/800/uppercase) + optional `LIVE` chip (red, 8px). Group is left-aligned at modal padding; YT sub-rows and regional rows indent `margin-left: 40px` to align with the channel name.
- **YT streams:** existing format — stream title (11px, color `#D8D8DD`, max 2 lines) + red `▶ VER` button. Re-rendered as today.
- **Regional broadcasters:** nested under a small uppercase eyebrow `<flag-icon> ALSO IN <COUNTRY>` (9px, muted). Each row: 28×18px logo + name (11px, weight 600) + optional `FREE` chip + arrow. Sub-card background `#0F0F0F` with `polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)` clip — same as today's broadcasters list.
- **Group divider:** between groups, `padding-top: 14px; margin-top: 14px; border-top: 1px solid rgba(255,255,255,0.06)`.

### "Group with no live YT" state

When today has Premier Padel matches but no Premier YT channel is live, the Premier group still renders — just without the LIVE chip and without YT sub-rows. A muted helper line bridges to the broadcasters:

```
Premier Padel
   No free YouTube broadcast right now. Premier Padel is also on:
   [RB] Red Bull TV   FREE →
   [M+] Movistar Plus+        →
```

This is the Spain-pain case the project exists to fix.

### Region footer

At the bottom of the popup, separated by a top border:

```
📍 Showing broadcasters in Spain.  Not your region?
```

- 10px muted text, location-pin icon
- "Not your region?" is a dashed orange link (`#F5A623`, dashed bottom border, hover → white)
- Clicking opens an inline country picker that replaces the popup body for one screen (back arrow returns to the popup)
- Picker is a vertical list of supported countries (the set in `ISO2_TO_NAME` from `DailyWhereToWatch.tsx` — ~36 entries). Selection writes to `localStorage["preferred-country"]` and re-renders.
- Footer is **hidden** when no region was detected AND no preference is set (we'd be showing "change to what?" with nothing).

## Trigger logic

The pill renders when, for today's matches:

1. At least one tracked YouTube channel has a current live broadcast, **OR**
2. At least one circuit with matches scheduled today has a broadcaster (`channel_id IS NOT NULL`) licensed in the user's effective region (preference > geo cookie)

The **count badge** is rendered only when condition 1 holds, and shows the number of live YT streams. When the pill is shown purely because of condition 2 (broadcasters but no YT live), the icon appears without a count.

A circuit "has matches scheduled today" if any match on the page has `tournament.level` mapped to that circuit. Mapping table:

| Circuit | Tournament levels |
|---|---|
| premier_padel | p1, p2, major, premier_mens, premier_womens |
| fip_tour | bronze, silver, gold, platinum |

(Maps will live in `src/lib/circuit-map.ts`.)

## Data model changes

### `broadcasters` — add `channel_id` (nullable FK)

```sql
ALTER TABLE broadcasters ADD COLUMN channel_id uuid REFERENCES youtube_channels(id);
CREATE INDEX ON broadcasters (channel_id);
```

`channel_id` links a broadcaster row to the YouTube channel (and by extension the circuit) whose content it licenses. Movistar/Red Bull get `channel_id = <premier_padel_youtube_channel_id>`. **Null-channel broadcasters do not render** in the new popup — they're treated as unclassified, and ops needs to set their `channel_id` for them to surface. This is a deliberate constraint: showing a broadcaster without telling the user which content it covers is confusing.

Existing rows backfill: a one-shot script reads each row's `name` + active license metadata and sets `channel_id` for the well-known Premier Padel broadcasters (Movistar, Red Bull, etc.). Anything not matched is logged for ops review.

Trigger logic correspondingly only considers broadcasters with `channel_id IS NOT NULL` when deciding whether to render the pill.

### `youtube_channels` — no schema changes

Already has `abbreviation`, `colorHex`, `displayOrder`. The new popup uses the same columns the existing `YoutubeLiveIndicator` consumes.

### `broadcast_info` — deprecated, not migrated

The "global editorial cards" (e.g., "Free YouTube for early rounds, Red Bull for finals") are eliminated. They were generic information cards, not actionable, and the per-channel grouping with broadcaster rows + free badges expresses the same idea in less space. The `broadcast_info` table stays in place; we just stop reading it from the new component. Cleanup is a follow-up task.

## Component structure

```
src/components/where-to-watch/
  ├── WhereToWatchPill.tsx        — trigger pill (replaces YoutubeLiveIndicator pill bit)
  ├── WhereToWatchPopup.tsx       — modal frame, group orchestration, region footer
  ├── ChannelGroup.tsx            — one channel block (header + YT rows + broadcaster rows)
  ├── BroadcasterRow.tsx          — single regional broadcaster row
  ├── RegionPicker.tsx            — inline country picker (full-popup-body view)
  └── lib/
      ├── circuit-map.ts          — tournament level → circuit lookup
      ├── group-builder.ts        — pure function: (liveYT, broadcasters, todayCircuits, country) → ChannelGroup[]
      └── group-builder.test.ts   — unit tests for the grouping function
```

### `group-builder.ts` shape

```ts
export interface ChannelGroup {
  channelId: string
  channelName: string
  abbreviation: string
  colorHex: string
  displayOrder: number
  hasLive: boolean
  liveStreams: Array<{ videoId: string; title: string }>
  broadcasters: Array<{
    id: string
    name: string
    logoUrl: string | null
    url: string
    isFree: boolean
  }>
}

export function buildGroups(input: {
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  todayCircuits: Set<string>
  country: string | null
}): ChannelGroup[]
```

The function is pure and unit-tested. Sorting: by `displayOrder` ascending. Empty groups (no live + no broadcasters + circuit not in today's set) are filtered out.

## Data flow

```
matches-page server component
  ├── fetchMatchesDay → matches with tournament.level
  ├── resolveLiveYtChannels (existing) → LiveChannel[]
  ├── fetchBroadcasters by country → BroadcasterRow[]
  └── pass {liveChannels, broadcasters, todayCircuits, country} to <WhereToWatchPill>

<WhereToWatchPill> (client)
  ├── reads localStorage.preferred-country, falls back to props.country
  ├── calls buildGroups → ChannelGroup[]
  ├── if groups.length === 0: render nothing
  └── otherwise render pill with count + popup on click

<WhereToWatchPopup>
  ├── renders each ChannelGroup
  └── renders <RegionFooter> if effective country set
```

The matches-page Server Component fetches all three inputs (already does for `liveChannels`). Broadcaster fetch is a new server-side `supabase.from('broadcasters')...eq('country_iso2', country)` query, fast enough to run on every render of an SSR page (small table, indexed by country).

## Trigger pill placement on tournament page

The tournament Overview tab currently embeds `<WhereToWatch />` as a 300+px tall card right under the hero. After this change:

- That card is removed.
- A compact pill sits in the same spot — same component (`WhereToWatchPill`) — with props derived from the tournament's `level` (→ circuit) + the country broadcasters for that circuit. Live YT channels are passed in if the tournament's circuit currently has a live broadcast.
- Tap behaviour identical to matches-page.

This means the tournament Overview reclaims ~280px of vertical space. The pill sits inline with the existing tournament-detail action row (logo / share / follow).

## i18n

New strings (5 locales — en/es/pt/it/fr):

```
whereToWatch.pillLabel       — "Where to Watch" (ARIA)
whereToWatch.eyebrow         — "Where to Watch"
whereToWatch.channelLive     — "LIVE"
whereToWatch.alsoIn          — "Also in {region}"
whereToWatch.noFreeStream    — "No free YouTube broadcast right now. {channel} is also on:"
whereToWatch.freeBadge       — "FREE"
whereToWatch.watchCta        — "VER" (ES) / "WATCH" (EN) / etc.
whereToWatch.openCta         — "ABRIR" (ES) / "OPEN" (EN) / etc.
whereToWatch.regionShowing   — "Showing broadcasters in {region}."
whereToWatch.notYourRegion   — "Not your region?"
whereToWatch.pickRegionTitle — "Choose your region"
whereToWatch.pickRegionBack  — "Back"
```

Existing `daily.youtubeLive.*` keys can be repurposed where the meaning carries over; otherwise add new keys under `whereToWatch.*` and delete `daily.youtubeLive.*` once the old component is removed.

## Out of scope

- Editing broadcaster data from the app (ops dashboard already handles it).
- Per-match stream surfaces — `MatchStreamCard` on match detail stays as-is.
- Push notifications on stream start.
- A subscription paywall view of "what you'd get with Movistar Plus" — just the link out.
- Backfilling `channel_id` for every existing broadcaster row. Backfill only Premier Padel rows; null-channel rows render in a generic fallback group.
- Removing the deprecated `broadcast_info` table — separate cleanup.

## Verification

1. **Unit:** `buildGroups` covers (a) YT-only, (b) YT + broadcasters, (c) broadcasters only, (d) no country, (e) circuit not in today, (f) zero rows → empty array. Test file `group-builder.test.ts`.
2. **Visual (matches page):**
   - Spanish user on a day with PP YT live → popup shows PP group with 2 YT rows + Movistar/Red Bull rows; footer reads "Showing broadcasters in Spain."
   - Spanish user on a day with PP scheduled but no YT live → PP group renders with the helper line + broadcaster rows. Pill is visible.
   - US user (no broadcasters in `broadcasters` for US) on a day with PP YT live → popup shows PP group with YT rows only, no regional section. Footer hidden.
   - No PP, no FIP, nothing live → pill hidden.
3. **Region picker:** click "Not your region?" → list of countries appears in the same modal body, click another country → popup re-renders with new region rows + footer text updated. localStorage `preferred-country` is set.
4. **Tournament page:** Buenos Aires P1 Overview tab no longer has the large card; the pill sits inline with the action row; tap renders the same popup as on matches page.
5. **Accessibility:** pill has `aria-expanded`, popup has `role="dialog"` + `aria-modal`, focus traps inside on open, Escape closes. Reduced-motion gate honored on all keyframes.
