# Merging the Entries and Projection tabs

**Date:** 2026-09-19
**Status:** Approved, not implemented
**Branch:** `feat/entries-projection-merge`

## Problem

A tournament detail page currently carries two adjacent tabs that are the same idea at two moments in time:

- **Entries** (`EntriesTab.tsx` → `EntryList.tsx`) — the field, available as soon as `tournament_entries` is populated. Plain list. No i18n.
- **Projection** (`ProjectionTab.tsx`) — the road to the title, available only once the main draw is ≥50% loaded. Rich: player-photo heroes, champion probabilities, a drillable bracket path, share, vote.

They never usefully coexist. Before the draw, Projection is a locked empty state. After the draw, Entries is a strictly worse view of the same pairs. The user has to know which tab is live at which stage, and the tab strip carries dead weight for the whole tournament.

The Projection tab's visual language is also markedly better than the Entries tab's, and it is currently gated behind the least interesting phase of the event.

## Decision

**One tab, labelled `Entries`, for the whole tournament lifecycle. Projections become content inside it.**

The `projection` tab is removed from the tab strip. `Draw` stays a separate tab, unchanged.

### Why `Entries` and not something new

"Entry list" is the standard term in the sport. It is what the [ATP tour](https://www.atptour.com/en/tournaments) publishes before a tournament, and the pt/es label `Inscritos` is the padel vernacular. Premier Padel itself uses `PLAYER LIST` on its tournament pages (`SCHEDULE · PLAYER LIST · TOURNAMENT INFO · VIDEOS · NEWS`) — so the concept, if not the exact word, is what padel fans expect to find.

Candidate labels considered and rejected:

| Candidate | Rejected because |
|---|---|
| `Contenders` / `Candidatos` | Survives both phases and sells the projections, but invents vocabulary the sport doesn't use. |
| `Entries` → `Projection` phase swap | Mirrors what ATP actually does (the entry list gives way to the draw), but the label moving mid-tournament is a cost with no offsetting user benefit now that `Draw` already exists as its own tab. |
| Keep `Projection` | Meaningless before the draw exists, which is exactly when the tab is most useful as an entry list. |

The accepted cost: post-draw, the tab label advertises the less interesting half of its content. Mitigated by the tab's own subtitle (below), not by the label.

## Phases

The tab is a shell that picks one of two views. Phase is **derived per render, never stored**:

```ts
const phase = rows.length === 0 ? 'field' : 'projected'
```

where `rows` is the `tournament_projections` result from `useProjection`. The UI does not reimplement the ≥50%-of-leaves rule — that gate stays producer-side in `padelgod/src/workers/tournament-projection-snapshot.ts`, and the UI only observes whether it produced rows.

### Phase `field` — no projections yet

Renders the entry list in the projection tab's card styling (`#1A1A1A` surface, chunky clipped polygons, mono numerals, `LIME #7ED321` / `GOLD #F5A623` / `TEXT #EEE4CE`).

- Header: "Who's in the hunt" + subtitle "{n} pairs entered".
- A lime-tinted note setting expectations: odds open when the draw is released.
- `THE FIELD · SEEDED` — seeded pairs, seed number in gold mono, both players' rankings, combined `team_points` right-aligned in mono.
- `UNSEEDED · {n}` — the rest.

Ordering reuses today's `useEntryList` synthesis (seed, then points). Rows are tappable.

### Phase `projected` — draw is loaded

Renders today's `ProjectionPickerList` → road view **unchanged**. Header subtitle becomes "Pick a pair to see their road". Section headings are `TOP CONTENDERS` and `ALL PAIRS · {n}`.

### Pair detail in phase `field`

Tapping a pair pre-draw opens the same hero chrome as the projected road view:

- Back / Share control row.
- Hero banner: full-body player photos (avatar fallback), seed in gold mono, per-player flag + name rows linking to `/player/<id>`.
- Two stat cards: `COMBINED` team points, `BEST RANK`.
- Where the timeline goes: a dashed-border locked card — lock icon, "Path locked", "Opens when the main draw is released."
- Footer: the existing "Model estimate · not a guarantee" line.

No head-to-head or form content in v1. YAGNI — it is a separate data problem and the locked card is honest about why the space is empty.

## Naming convention

| Layer | Value |
|---|---|
| Tab key | `entries` |
| Tab label | en `Entries` · es `Inscritos` · pt `Inscritos` · it `Iscritti` · fr `Inscrits` (existing `tournament.entries` keys, unchanged) |
| In-page URL | `?tab=entries&category=<men\|women>[&pair=<slug>]` |
| Legacy alias | `?tab=projection` resolves to `entries`, the way `recap` → `story` already does |
| Server routes | `/tournaments/[id]/projection` and `/projection/[pair]` — **unchanged** |
| i18n namespace | `projectionTab.*` keeps its name and absorbs the entry-list strings |
| Phase in code | `type ContentPhase = 'field' \| 'projected'` |

### The deliberate label/URL asymmetry

The tab label and the public URL slug disagree, on purpose.

Internally, a user navigates to a tab called **Entries**. Externally, the indexed, shareable, OG-imaged page is `/projection/<pair>` — because the search intent is "will Arroyo win São Paulo", not "who entered São Paulo". Those routes are already in `sitemap-projections.xml` and have `opengraph-image.tsx` from PR #573; renaming them to `/entries` would reset indexing and invalidate shared links for no user benefit.

So: `Entries` is a navigation label. `projection` is a URL noun. They do not need to match, and this document is the record of that being intentional rather than an oversight.

## Tab visibility

Today two independent gates:

```ts
showEntriesTab    = useFeatureFlag('entry_list_enabled') && useHasEntries(tournamentId)
showProjectionTab = useFeatureFlag('projection_enabled') && DRAW_TIERS.has(tournament.level)
```

After the merge, one gate that is the OR of both:

```ts
showEntriesTab =
  (entryListFlag && hasEntries) ||
  (projectionFlag && DRAW_TIERS.has(tournament.level))
```

This preserves every case that shows a tab today. A draw-tier event with neither entries nor projections still shows the tab with the locked empty state, exactly as the Projection tab does now.

The two "New" chip localStorage keys collapse to one. `entry_list_tab_seen` is kept as the surviving key; `projection_tab_seen` is dropped. Users who have seen either tab should not be re-nudged, so treat "either key set" as seen on first read, then write only `entry_list_tab_seen`.

## Work this forces

Two pre-existing gaps that the merge cannot route around.

### 1. `EntriesTab` has no i18n

`EntriesTab.tsx` has two hardcoded English strings:

- `"Couldn't load the entry list. Please try again."`
- `"The entry list for this event is being prepared. Check back soon."`

Both move into `projectionTab.*` and get translated across all five locales, alongside the new phase-`field` copy (header, subtitle, the odds-open note, section headings, the locked-path card).

### 2. Server routes drop seeds

`ProjectionRouteClient` passes `matches={[]}`, so `buildSeedMap` has nothing to work from and `ProjectionPickerList` renders no `#N` chips on `/projection`. The in-page tab is unaffected because it has the match list.

Phase `field` is *entirely* seed-ordered, so on the crawlable pre-draw page this would render a ranked list with no visible ranks. Seeds must be threaded into the server path from `tournament_entries.seed` rather than derived from matches.

## Out of scope

- Head-to-head, recent form, or title counts in the pre-draw pair detail.
- Any change to `tournament-projection-snapshot.ts` or the ≥50% rule.
- Any change to the `Draw` tab.
- Renaming the `/projection` routes or the `projectionTab` i18n namespace.

## Testing

- Unit: phase derivation from `rows.length`, and the seeded/unseeded partition + ordering of the field list.
- Unit: the "either seen key set" → seen collapse.
- Manual, against a live tournament in each state: a pre-draw FIP event (phase `field`), a mid-tournament Premier event (phase `projected`), and a draw-tier event with no entries at all (locked empty state).
- Manual: `?tab=projection` still lands on the merged tab; `/projection/<pair>` still renders and now shows seed chips.
