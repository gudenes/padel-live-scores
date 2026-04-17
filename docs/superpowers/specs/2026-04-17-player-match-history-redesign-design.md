# Player Match History Redesign — Design Spec

**Date:** 2026-04-17
**Status:** Approved
**Scope:** Player profile page, Matches tab only

## Problem

Users report that the Matches tab on a player profile is hard to read — it's unclear who won and at what score.

Root cause: the current single-line row renders the raw `sets.set_score` string, which is stored in `pair1_games-pair2_games` order regardless of which pair the viewed player was on. So when Bea Gonzalez (on pair 2) wins 6-0, 6-1, the row displays a green "W" badge next to the score "0-6 1-6", producing a visual contradiction. Secondary friction: dense single-line format crams partner/opponents into one truncated string, making scanning a list of matches hard.

See [src/app/[locale]/player/[id]/page.tsx:1416-1473](src/app/%5Blocale%5D/player/%5Bid%5D/page.tsx:1416) for the current `MatchListItem`.

## Goals

- At-a-glance readability: who won is obvious without reading the W/L badge
- Per-set scores map unambiguously to each pair
- Consistent with existing tournament-group header pattern on [matches/page.tsx:456](src/app/%5Blocale%5D/%28app%29/matches/page.tsx:456)
- Handles all match states (live, scheduled, finished, retired, walkover)
- Remains compact on mobile (the primary form factor)
- No backend changes — reuses data already fetched

Non-goals:
- Redesigning home/tournament/feed match cards (separate effort)
- Server-side pagination (data is already fetched client-side)
- Changing score storage or inference logic

## Design

### 1. Component structure

```
MatchesTab (existing, rewritten)
├── TournamentGroup (new)                  — one per distinct tournament
│   ├── TournamentHeader                    — grey #1e1e1e bar with flag + name + stage badge
│   └── MatchRow (new)                      — replaces MatchListItem
│       ├── MetaStrip                        — W/L letter · round · date · optional RET/WO tag
│       ├── TeamRow (player's pair)         — flags + names + set cells
│       └── TeamRow (opponent pair)         — flags + names + set cells
└── LoadMoreButton (new, conditional)      — appears if hidden tournament groups exist
```

All new components live inline in `src/app/[locale]/player/[id]/page.tsx` alongside the existing `MatchesTab`. No separate files. The old `MatchListItem` function is removed.

### 2. Tournament header — mirrors the /matches page

Visual is copied from [matches/page.tsx:492-545](src/app/%5Blocale%5D/%28app%29/matches/page.tsx:492):

- Container: `background: #1e1e1e`, `padding: 10px 14px`, with 2px top accent bar (green `#7ED321` for finished tournaments, red `#FF4655` if tournament has any live match)
- Country flag: `<FlagImg country={tournament.country} size={20} />` on the left
- Name: `titleCase(tournament.name)`, font-size 12, weight 700, `#fff`, ellipsis on overflow
- Stage badge: most-advanced round in this tournament the player reached, rendered as a small green chip (`clip-path: CHUNKY.badge`, color `#7ED321`, bg `rgba(126,211,33,0.12)`, 8px letter-spacing 0.5, 2px 6px padding, uppercase). Red if any match is live.
  - Determined using the same `ROUND_ORDER` + `ROUND_LABELS` maps defined at [matches/page.tsx:472-473](src/app/%5Blocale%5D/%28app%29/matches/page.tsx:472): the round with the lowest index across the player's matches in this tournament wins. Extract both maps alongside `levelLabel` into `src/lib/tournament-labels.ts` (see §6).
- Subline: `"{levelLabel(level)} · {DATE_SHORT starts_at} – {DATE_SHORT ends_at}"` · font-size 9, weight 700, color `#6B7280`, uppercase, letter-spacing 0.5
- Whole header is a `<Link>` to `/tournaments/{id}` (not collapsible, unlike /matches page — the player profile doesn't need collapse state)

Helpers already exist in `player/[id]/page.tsx`: `titleCase`, `DATE_SHORT` via `format-patterns`. The `levelLabel` helper must be duplicated from [matches/page.tsx:50-56](src/app/%5Blocale%5D/%28app%29/matches/page.tsx:50) or extracted to a shared util (see §6 Refactor).

### 3. Match row

Chunky card (`background: #141414`, `clipPath: CHUNKY.card`), `padding: 8px 12px 10px`, `margin: 6px 8px 0`, stacked flex column:

#### 3a. Meta strip (first row inside card)

- Player-perspective W/L letter, bold, colored (green `#7ED321` for W, red `#FF4655` for L, grey for live/scheduled)
  - Live: `● LIVE` text instead of W/L letter
  - Scheduled: `VS` text in grey
- `·` separator dot
- Round name (e.g. "Quarterfinals"). Use `match.round` raw; if null, omit this segment and the preceding dot.
- `·` separator dot
- Date: `formatDate(matchDate(match), format)` using existing helper. For scheduled, append time if available (e.g. "Apr 20 · 15:30")
- For live matches only: a `· Court {court}` segment appended
- Optional `RET` / `W/O` tag pushed right with `margin-left:auto`, small orange pill (`color: #F5A623`, bg `rgba(245,166,35,0.12)`, 2px 6px padding, font-size 9, weight 800, uppercase, letter-spacing 0.4)

Font size 10, color `#6B7280`, gap 8px between segments.

#### 3b. Team row — two per match

Layout: `display: flex; align-items: center; gap: 10px; min-height: 22px; padding: 3px 0;`

**Order:** the viewed player's pair is always the first team row; opponent pair is second. (Use `resolveMatchRoles(match, playerId).isP1` to determine which pair is the player's — existing helper at [player/[id]/page.tsx:374](src/app/%5Blocale%5D/player/%5Bid%5D/page.tsx:374).)

**Flag pair** (22×18 container, relative-positioned):
- Two 14×10 `<FlagImg>` instances, absolutely positioned:
  - Flag 1 (first player of the pair): `top: 0; left: 0; z-index: 2`
  - Flag 2 (second player of the pair): `top: 6px; left: 6px; z-index: 1`
- Each flag has `box-shadow: 0 0 0 1px #141414` to create a visible seam where they overlap
- For the **losing team row**, add `opacity: 0.45; filter: saturate(0.6)` to fade the flags
- If a player is missing a country, render the placeholder span from existing FlagImg logic (width 14, height 10 empty)
- For live matches, the **serving pair** gets a small orange dot at the flag pair's top-left (5×5 `#F5A623` circle with `#141414` ring, `z-index: 3`). Derive serving pair from the current game's point data if available; if not derivable, omit the dot.

**Names:**
- Single line: `${toShortName(player1)} / ${toShortName(player2)}` using existing `toShortName` helper
- Font size 11.5, weight 700 for winner pair / 400 for loser pair — this coloring is **per-match**: the pair that won the match is bold white, the pair that lost is muted
- Color `#fff` for winner, `#6B7280` for loser
- For scheduled matches: both teams get `color: #fff`, weight 600 (no winner distinction yet)
- Ellipsis-truncate on overflow; `flex: 1, min-width: 0`

**Set cells:**
- `display: flex; gap: 8px; font-variant-numeric: tabular-nums;`
- One cell per played set, rendered as a span, `min-width: 14px; text-align: center; font-weight: 700; font-size: 12px`
- Each cell shows `pair1_games` for the player's row if the player is on pair 1, or `pair2_games` if on pair 2 (mirror for the opponent row)
- Color: `#fff` bold for the set winner, `#6B7280` regular for the set loser (coloring is **per-set**, not per-match — independent from the names coloring above. This is why in a 3-setter like 6-4 4-6 7-5, the match-winner row's cells render as `6` (bold) `4` (muted) `7` (bold), since they lost the middle set)
- Tiebreak: if `set_score` contains a tiebreak detail (e.g., the set ended 7-6 and we have `pair1_score`/`pair2_score` tiebreak values), render the loser's tiebreak count as a superscript `<span>` (font-size 8, color `#6B7280`, vertical-align super) on the *set-winning* cell. Reuses the existing tiebreak parsing logic already applied in match detail (see `parseSetScore` in `src/types/match.ts`).
- Live-match current set: cell renders as a pill (`background: rgba(255,70,85,0.08); color: #FF4655; padding: 1px 6px; border-radius: 3px; font-weight: 800`) with the current game's points (e.g. `40`, `AD`, or `0`). Pull from the latest game's `points[]` array if available, otherwise just render the set's current game count.
- Scheduled matches: no set cells rendered at all (team rows are just flag + name)
- Retired / walkover: cells render up to the point the match was stopped. The score array truncates naturally because unfinished sets aren't stored.

### 4. Grouping + ordering logic

```ts
// Group all matches by tournament.id
const byTournament = groupByTournament(matches)  // helper — copy pattern from matches/page.tsx:84

// Sort tournaments: tournaments containing live matches first, then by starts_at desc
byTournament.sort((a, b) => {
  const aLive = a.matches.some(m => m.status === 'live')
  const bLive = b.matches.some(m => m.status === 'live')
  if (aLive !== bLive) return aLive ? -1 : 1
  return (b.tournament?.starts_at ?? '').localeCompare(a.tournament?.starts_at ?? '')
})

// Within each tournament: reverse chronological (newest first — final > SF > QF > ...)
for (const g of byTournament) g.matches.sort((a, b) => matchTime(b) - matchTime(a))
```

`matchTime` already exists at [player/[id]/page.tsx:360](src/app/%5Blocale%5D/player/%5Bid%5D/page.tsx:360).

### 5. Pagination

- New state: `const [visibleTournaments, setVisibleTournaments] = useState(5)`
- Render only `byTournament.slice(0, visibleTournaments)`
- Below the last rendered group: `<button>` styled as ghost pill (`background: transparent; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 12px; width: 100%; color: #9ca3af; font-size: 11; font-weight: 700; letter-spacing: 0.5; text-transform: uppercase`)
- Label: `Load more tournaments`
- On click: `setVisibleTournaments(n => n + 5)`
- Button hidden when `visibleTournaments >= byTournament.length`
- No scroll-restore or pagination memory (resetting to 5 on tab switch is fine — the tab itself isn't persisted)

### 6. Refactor: extract `levelLabel` and round helpers

`levelLabel` is defined inline at [matches/page.tsx:50-56](src/app/%5Blocale%5D/%28app%29/matches/page.tsx:50). `ROUND_ORDER` + `ROUND_LABELS` are at [matches/page.tsx:472-473](src/app/%5Blocale%5D/%28app%29/matches/page.tsx:472). The player profile now needs all three.

Extract to `src/lib/tournament-labels.ts`:

```ts
export function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

export const ROUND_ORDER = ['F', 'Final', 'SF', 'Semi-final', 'QF', 'Quarter-final', 'R16', 'R32', 'R64', 'R128']
export const ROUND_LABELS: Record<string, string> = {
  F: 'Final', Final: 'Final',
  SF: 'Semis', 'Semi-final': 'Semis',
  QF: 'Quarters', 'Quarter-final': 'Quarters',
  R16: 'R16', R32: 'R32', R64: 'R64', R128: 'R128',
}

// Given a list of matches from the same tournament, returns the stage-badge label
// for the most-advanced round reached, or null if no recognized round is present.
export function mostAdvancedRound(matches: { round: string | null }[]): string | null {
  let bestIdx = ROUND_ORDER.length
  for (const m of matches) {
    const r = m.round ?? ''
    const idx = ROUND_ORDER.findIndex(x => r.toLowerCase().startsWith(x.toLowerCase()))
    if (idx >= 0 && idx < bestIdx) bestIdx = idx
  }
  return bestIdx < ROUND_ORDER.length ? (ROUND_LABELS[ROUND_ORDER[bestIdx]] ?? ROUND_ORDER[bestIdx]) : null
}
```

Update `matches/page.tsx` to import from the new module and delete the inline copies.

### 7. Data orientation — the bug fix

The orientation fix is purely visual: we do NOT swap or mutate `pair1_games`/`pair2_games`. Instead, the render knows which pair the viewed player is on (via `resolveMatchRoles`) and:

- Renders the player's pair as the first team row
- Pulls `pair1_games` for that row if the player is on pair 1, else `pair2_games`
- The winner-bold/loser-muted styling flows from `match.winner_pair` comparing to the rendered pair's index

So for Bea's match where pair1 = Goenaga/Caldera won 6-0 6-1:
- Row 1 (player's pair, pair2): flags ES+ES, "B. Gonzalez / P. Josemaria", cells `0` `1`, muted (loser)
- Row 2 (opponent pair, pair1): flags ES+ES, "C. Goenaga / B. Caldera", cells `6` `6`, bold white (winner)
- Meta strip: red `L` · Quarterfinals · Apr 16

No ambiguity.

### 8. Accessibility

- Whole match row remains clickable → `router.push('/match/{id}')` (same as today)
- Tournament header is a `<Link>` → `/tournaments/{id}`, stopPropagation not needed since header and match are not nested
- W/L colors (green/red) are redundant with the bold/muted treatment — a user with red-green colorblindness can still read winners by weight/color contrast
- All text uses existing color tokens from the file

### 9. Empty / edge states

- No matches at all: existing "No matches found." message preserved
- Only live / scheduled matches (new player, no finished history): tournament groups render normally, just without W/L letters in meta strips
- Player only has walkover wins: RET/WO tag shown on each, no score cells if the walkover had zero games played

## Testing

Manual QA matrix on localhost:3002 using the preview server:
1. Player with many tournaments (e.g. Bea Gonzalez, Tapia) — verify grouping + load-more
2. Player with a live match in progress — verify live pill + serving dot
3. Player with a recent retired win — verify RET tag + partial scores
4. Player with only scheduled matches — verify VS state + no cells
5. A tiebreak match — verify superscript rendering
6. Mobile width 390px — verify no overflow, ellipsis works
7. Dark mode only — no light mode toggle affects this page

No unit tests required — all changes are presentational and the underlying data pipeline is unchanged. The `resolveMatchRoles` and `matchTime` helpers already have coverage indirectly through existing derived-data tests.

## Rollout

Ship as a single PR on `claude/badge-system` branch. No feature flag — the change is self-contained and reversible via git revert if issues emerge.

## Open questions

None.
