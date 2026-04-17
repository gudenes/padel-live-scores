# Player Match History Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the player profile Matches tab with stacked-pairs rows, winner-bold styling, tournament grouping, and load-more pagination — fixing the current bug where set scores render from pair1's perspective regardless of which pair the viewed player was on.

**Architecture:** All new components live inline in `src/app/[locale]/player/[id]/page.tsx` alongside the existing `MatchesTab` (no new component files). One shared-util module is introduced at `src/lib/tournament-labels.ts` to house `levelLabel`, `ROUND_ORDER`, `ROUND_LABELS`, and a new `mostAdvancedRound` helper — extracted from `/matches` page so both callers share it. No data-layer changes; the orientation fix is purely visual (render the viewed player's pair first and let bold-winner styling disambiguate).

**Tech Stack:** Next.js 16 App Router · React 19 · TypeScript · Tailwind CSS 4 (inline styles used in this file) · next-intl · Supabase client · Vitest (unit tests)

---

## File Structure

### Created
- `src/lib/tournament-labels.ts` — pure TS module: `levelLabel`, `ROUND_ORDER`, `ROUND_LABELS`, `mostAdvancedRound`
- `src/lib/__tests__/tournament-labels.test.ts` — unit tests for the new module

### Modified
- `src/app/[locale]/player/[id]/page.tsx` — add `TournamentHeader`, `TournamentGroup`, `MatchRow`, `TeamRow`, `FlagPair` components; rewrite `MatchesTab` to use them; delete old `MatchListItem`; keep `scoreString` only if still used elsewhere (we'll verify and delete if not)
- `src/app/[locale]/(app)/matches/page.tsx` — replace the three inline definitions (`levelLabel`, `ROUND_ORDER`, `ROUND_LABELS`) and the `stageLabel` derivation with imports + calls into `tournament-labels.ts`

### Unchanged
- `src/types/match.ts` — we reuse `parseSetScore`, `toShortName`, `MatchStatus` as-is
- The Supabase query in `player/[id]/page.tsx` at line 487-506 — all data we need is already fetched

---

## Task 1: Extract `tournament-labels` module with tests

**Files:**
- Create: `src/lib/tournament-labels.ts`
- Create: `src/lib/__tests__/tournament-labels.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/tournament-labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { levelLabel, mostAdvancedRound, ROUND_ORDER, ROUND_LABELS } from '@/lib/tournament-labels'

describe('levelLabel', () => {
  it('maps known levels to display labels', () => {
    expect(levelLabel('p1')).toBe('P1')
    expect(levelLabel('p2')).toBe('P2')
    expect(levelLabel('major')).toBe('Major')
    expect(levelLabel('finals')).toBe('Finals')
    expect(levelLabel('fip_platinum')).toBe('FIP Platinum')
    expect(levelLabel('fip_gold')).toBe('FIP Gold')
    expect(levelLabel('fip_other')).toBe('FIP Tour')
  })

  it('returns the raw string for unknown levels', () => {
    expect(levelLabel('unknown_thing')).toBe('unknown_thing')
  })

  it('returns empty string for null', () => {
    expect(levelLabel(null)).toBe('')
  })
})

describe('ROUND_ORDER and ROUND_LABELS', () => {
  it('contains the expected round codes in order', () => {
    expect(ROUND_ORDER[0]).toBe('F')
    expect(ROUND_ORDER).toContain('SF')
    expect(ROUND_ORDER).toContain('QF')
    expect(ROUND_ORDER).toContain('R16')
  })

  it('every ROUND_ORDER entry has a ROUND_LABELS mapping', () => {
    for (const code of ROUND_ORDER) {
      expect(ROUND_LABELS[code]).toBeTruthy()
    }
  })
})

describe('mostAdvancedRound', () => {
  it('picks Final when the player reached the final', () => {
    const matches = [
      { round: 'R16' }, { round: 'QF' }, { round: 'SF' }, { round: 'Final' },
    ]
    expect(mostAdvancedRound(matches)).toBe('Final')
  })

  it('picks Semis when the player lost in the semis', () => {
    const matches = [{ round: 'R32' }, { round: 'R16' }, { round: 'QF' }, { round: 'SF' }]
    expect(mostAdvancedRound(matches)).toBe('Semis')
  })

  it('matches prefix-insensitively (Quarter-final vs QF)', () => {
    expect(mostAdvancedRound([{ round: 'Quarter-final' }])).toBe('Quarters')
    expect(mostAdvancedRound([{ round: 'Semi-final' }])).toBe('Semis')
  })

  it('handles case-insensitive matching', () => {
    expect(mostAdvancedRound([{ round: 'sf' }])).toBe('Semis')
  })

  it('returns null for unrecognized rounds', () => {
    expect(mostAdvancedRound([{ round: 'Group stage' }])).toBeNull()
    expect(mostAdvancedRound([{ round: null }])).toBeNull()
  })

  it('returns null for empty list', () => {
    expect(mostAdvancedRound([])).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx vitest run src/lib/__tests__/tournament-labels.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Create the module**

Create `src/lib/tournament-labels.ts`:

```ts
// Shared tournament display helpers. Extracted from matches/page.tsx so
// multiple pages (player profile Matches tab, /matches page) render
// level + round labels consistently.

export function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals',
    major: 'Major',
    p1: 'P1',
    p2: 'P2',
    fip_platinum: 'FIP Platinum',
    fip_gold: 'FIP Gold',
    fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}

// Listed most-advanced → least-advanced. Used to find the highest round
// the player reached in a given tournament.
export const ROUND_ORDER = [
  'F', 'Final',
  'SF', 'Semi-final',
  'QF', 'Quarter-final',
  'R16', 'R32', 'R64', 'R128',
]

export const ROUND_LABELS: Record<string, string> = {
  F: 'Final',
  Final: 'Final',
  SF: 'Semis',
  'Semi-final': 'Semis',
  QF: 'Quarters',
  'Quarter-final': 'Quarters',
  R16: 'R16',
  R32: 'R32',
  R64: 'R64',
  R128: 'R128',
}

/**
 * Given a list of matches from the same tournament, returns the stage-badge
 * label for the most-advanced round reached. Matches the prefix-insensitive
 * logic used at matches/page.tsx:474-480.
 * Returns null if no recognized round is present.
 */
export function mostAdvancedRound(
  matches: { round: string | null }[],
): string | null {
  let bestIdx = ROUND_ORDER.length
  for (const m of matches) {
    const r = m.round ?? ''
    const idx = ROUND_ORDER.findIndex(
      x => r.toLowerCase().startsWith(x.toLowerCase()),
    )
    if (idx >= 0 && idx < bestIdx) bestIdx = idx
  }
  if (bestIdx >= ROUND_ORDER.length) return null
  const code = ROUND_ORDER[bestIdx]
  return ROUND_LABELS[code] ?? code
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx vitest run src/lib/__tests__/tournament-labels.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournament-labels.ts src/lib/__tests__/tournament-labels.test.ts
git commit -m "refactor: extract tournament-labels util with tests"
```

---

## Task 2: Wire `matches/page.tsx` to the new module

**Files:**
- Modify: `src/app/[locale]/(app)/matches/page.tsx:50-56` (delete inline `levelLabel`)
- Modify: `src/app/[locale]/(app)/matches/page.tsx:471-480` (delete inline `ROUND_ORDER`/`ROUND_LABELS`/`bestRoundIdx` loop; replace with `mostAdvancedRound` call)

- [ ] **Step 1: Add the import**

At the top of `src/app/[locale]/(app)/matches/page.tsx`, alongside the other `@/lib` imports, add:

```ts
import { levelLabel, mostAdvancedRound } from '@/lib/tournament-labels'
```

- [ ] **Step 2: Delete the inline `levelLabel` function**

Delete lines 50-56 of `src/app/[locale]/(app)/matches/page.tsx`:

```ts
function levelLabel(level: string | null): string {
  const map: Record<string, string> = {
    finals: 'Finals', major: 'Major', p1: 'P1', p2: 'P2',
    fip_platinum: 'FIP Platinum', fip_gold: 'FIP Gold', fip_other: 'FIP Tour',
  }
  return level ? (map[level] ?? level) : ''
}
```

- [ ] **Step 3: Replace the inline stage derivation**

Find the block at lines 471-480 (inside `TournamentGroup`):

```ts
  // Derive the most advanced round
  const ROUND_ORDER = ['F', 'Final', 'SF', 'Semi-final', 'QF', 'Quarter-final', 'R16', 'R32', 'R64', 'R128']
  const ROUND_LABELS: Record<string, string> = { 'F': 'Final', 'Final': 'Final', 'SF': 'Semis', 'Semi-final': 'Semis', 'QF': 'Quarters', 'Quarter-final': 'Quarters', 'R16': 'R16', 'R32': 'R32', 'R64': 'R64', 'R128': 'R128' }
  let bestRoundIdx = 999
  for (const m of matches) {
    const r = m.round ?? ''
    const idx = ROUND_ORDER.findIndex(x => r.toLowerCase().startsWith(x.toLowerCase()))
    if (idx >= 0 && idx < bestRoundIdx) bestRoundIdx = idx
  }
  const stageLabel = bestRoundIdx < 999 ? (ROUND_LABELS[ROUND_ORDER[bestRoundIdx]] ?? ROUND_ORDER[bestRoundIdx]) : null
```

Replace with a single call:

```ts
  const stageLabel = mostAdvancedRound(matches)
```

- [ ] **Step 4: Verify the /matches page still renders correctly**

Start the dev server (if not already):

```bash
# Claude Code preview_start: "Next.js (frontend)" (port 3002)
```

Navigate to `http://localhost:3002/matches`. Verify:
- Tournament headers still show the correct stage badge (e.g. "SEMIS", "QUARTERS", "FINAL")
- Level subtitle ("P1", "P2", "FIP GOLD", etc.) still renders

Also run lint to catch missing imports or unused symbols:

```bash
npm run lint -- src/app/\[locale\]/\(app\)/matches/page.tsx
```

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/\(app\)/matches/page.tsx
git commit -m "refactor: /matches page uses shared tournament-labels helpers"
```

---

## Task 3: Add `FlagPair` component to player page

Self-contained inline component that renders the staggered two-flag stack. Lives right above the `MatchesTab` function in `src/app/[locale]/player/[id]/page.tsx`.

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` (add `FlagPair` above line 1475)

- [ ] **Step 1: Add the FlagPair component**

Insert immediately above the `MatchesTab` function declaration (currently at line 1475):

```tsx
// Renders two overlapping country flags — first player top-left, second
// offset down-and-right by 6px. Used in match-history team rows.
function FlagPair({
  p1,
  p2,
  dimmed = false,
  serving = false,
}: {
  p1: PartnerInfo | null
  p2: PartnerInfo | null
  dimmed?: boolean
  serving?: boolean
}) {
  return (
    <div style={{
      flexShrink: 0, width: 22, height: 18, position: 'relative',
    }}>
      {serving && (
        <span style={{
          position: 'absolute', top: -2, left: -2, width: 5, height: 5,
          borderRadius: '50%', background: ORANGE, zIndex: 3,
          boxShadow: `0 0 0 1px ${BG_CARD}`,
        }} />
      )}
      {/* Flag 1 — top-left, on top */}
      <div style={{
        position: 'absolute', top: 0, left: 0, zIndex: 2,
        boxShadow: `0 0 0 1px ${BG_CARD}`,
        opacity: dimmed ? 0.45 : 1,
        filter: dimmed ? 'saturate(0.6)' : 'none',
      }}>
        <FlagImg country={p1?.country ?? null} size={14} />
      </div>
      {/* Flag 2 — offset down-and-right, behind */}
      <div style={{
        position: 'absolute', top: 6, left: 6, zIndex: 1,
        boxShadow: `0 0 0 1px ${BG_CARD}`,
        opacity: dimmed ? 0.45 : 1,
        filter: dimmed ? 'saturate(0.6)' : 'none',
      }}>
        <FlagImg country={p2?.country ?? null} size={14} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Sanity check — type check + lint**

```bash
npm run lint -- src/app/\[locale\]/player/\[id\]/page.tsx
```

Expected: no errors. (The component is unused at this step, but TypeScript should not flag that — it's a function declaration.)

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): add FlagPair component for staggered flag pair"
```

---

## Task 4: Add `TeamRow` component to player page

Renders one pair's flag+names+cells line. Uses `FlagPair` from Task 3 and `parseSetScore` from `src/types/match.ts`.

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` (add `TeamRow` right after `FlagPair`; import `parseSetScore`)

- [ ] **Step 1: Extend the existing match.ts import**

At line 9 of `src/app/[locale]/player/[id]/page.tsx`, replace:

```ts
import { toShortName } from '@/types/match'
```

with:

```ts
import { parseSetScore, toShortName } from '@/types/match'
```

- [ ] **Step 2: Add the TeamRow component**

Insert immediately after the `FlagPair` declaration added in Task 3:

```tsx
// One team (pair) row inside a match card — flag pair + names + set cells.
// Per-set winner coloring is computed from the parsed set score; names
// coloring comes from the match-level `isWinner` flag.
function TeamRow({
  p1, p2,
  sets,
  isP1Side,
  isWinner,
  status,
}: {
  p1: PartnerInfo | null
  p2: PartnerInfo | null
  sets: Array<{ set_score: string | null; set_number: number }>
  isP1Side: boolean                // is this team pair 1 (true) or pair 2 (false)?
  isWinner: boolean                // did this pair win the match?
  status: string                   // 'live' | 'scheduled' | 'finished' | 'retired' | 'walkover' | ...
}) {
  const isScheduled = status === 'scheduled'
  const nameColor = isScheduled ? '#fff' : (isWinner ? '#fff' : MUTED)
  const nameWeight: React.CSSProperties['fontWeight'] = isScheduled ? 600 : (isWinner ? 700 : 400)

  // Parse each set in order
  const ordered = [...sets].sort((a, b) => a.set_number - b.set_number)
  // The "current set" (highest set_number) gets the red-pill treatment when the
  // match is live.
  const currentSetNumber = status === 'live' && ordered.length > 0
    ? ordered[ordered.length - 1].set_number
    : null

  const firstName = p1 ? toShortName(p1.display_name?.trim() || p1.name) : ''
  const secondName = p2 ? toShortName(p2.display_name?.trim() || p2.name) : ''
  const displayNames = [firstName, secondName].filter(Boolean).join(' / ') || '—'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '3px 0', minHeight: 22,
    }}>
      <FlagPair p1={p1} p2={p2} dimmed={!isScheduled && !isWinner} />
      <div style={{
        flex: 1, minWidth: 0,
        fontSize: 11.5, fontWeight: nameWeight, color: nameColor,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {displayNames}
      </div>
      {!isScheduled && ordered.length > 0 && (
        <div style={{
          display: 'flex', gap: 8,
          fontVariantNumeric: 'tabular-nums',
        }}>
          {ordered.map(set => {
            const parsed = parseSetScore(set.set_score)
            if (!parsed) return null
            const mine = isP1Side ? parsed.p1 : parsed.p2
            const theirs = isP1Side ? parsed.p2 : parsed.p1
            const setWinner = mine > theirs
            const isCurrent = currentSetNumber === set.set_number

            return (
              <span key={set.set_number} style={{
                minWidth: 14, textAlign: 'center',
                fontWeight: 700, fontSize: 12,
                color: setWinner ? '#fff' : MUTED,
                // Live current-set gets a red-pill treatment; overrides color + adds bg
                ...(isCurrent && status === 'live' ? {
                  background: 'rgba(255,70,85,0.08)',
                  color: LIVE_RED,
                  padding: '1px 6px',
                  borderRadius: 3,
                  fontWeight: 800,
                } : {}),
              }}>
                {mine}
                {/* Tie-break superscript — shown on the set winner's cell,
                    displaying the loser's tie-break points count (tennis convention) */}
                {setWinner && parsed.tb != null && (
                  <span style={{
                    fontSize: 8, verticalAlign: 'super',
                    color: MUTED, marginLeft: 1,
                  }}>
                    {parsed.tb}
                  </span>
                )}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Sanity check — type check + lint**

```bash
npm run lint -- src/app/\[locale\]/player/\[id\]/page.tsx
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): add TeamRow component with per-set score coloring"
```

---

## Task 5: Add `MatchRow` component (meta strip + two team rows)

Replaces `MatchListItem`. Renders the chunky card with meta strip + two stacked `TeamRow`s. Clickable whole-card navigation preserved.

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` (add `MatchRow` after `TeamRow`)

> **Note on live state:** live-point plumbing is out of scope — the player profile's Supabase query at [player/[id]/page.tsx:487-506](src/app/%5Blocale%5D/player/%5Bid%5D/page.tsx:487) doesn't fetch the `games` tree. When the match is `live`, the red-pill styling still fires on the highest set_number cell (handled in `TeamRow` via `isCurrent && status === 'live'`), but the number shown is the running set game count, not live points. A player has at most one live match at a time, so this is acceptable. Adding live-point text can be a follow-up if needed.

- [ ] **Step 1: Add the MatchRow component**

Insert right after `TeamRow`:

```tsx
// One match card inside a TournamentGroup. Meta strip + two stacked TeamRows.
function MatchRow({
  match,
  playerId,
  onClick,
  format,
}: {
  match: MatchRow
  playerId: string
  onClick: () => void
  format: ReturnType<typeof useFormatter>
}) {
  const roles = resolveMatchRoles(match, playerId)
  const playerWon = roles.won
  const playerLost = roles.lost
  const isLive = match.status === 'live'
  const isScheduled = match.status === 'scheduled'
  const isRetired = match.status === 'retired'
  const isWalkover = match.status === 'walkover'

  // Meta strip leading letter/chip
  let leadNode: React.ReactNode
  if (isLive) {
    leadNode = (
      <span style={{
        color: LIVE_RED, fontWeight: 800, letterSpacing: 0.3,
      }}>● LIVE</span>
    )
  } else if (isScheduled) {
    leadNode = (
      <span style={{ color: '#9ca3af', fontWeight: 800 }}>VS</span>
    )
  } else if (playerWon) {
    leadNode = <span style={{ color: GREEN, fontWeight: 800 }}>W</span>
  } else if (playerLost) {
    leadNode = <span style={{ color: LIVE_RED, fontWeight: 800 }}>L</span>
  } else {
    leadNode = <span style={{ color: MUTED, fontWeight: 800 }}>—</span>
  }

  const dateString = isScheduled
    ? formatDateTime(match.scheduled_at, format)
    : formatDate(matchDate(match), format)

  // Retired / walkover trailing tag
  const retTag = isRetired ? 'RET' : isWalkover ? 'W/O' : null

  // Player's pair rendered first (top row), opponent pair below
  const playerIsP1 = roles.isP1
  const topPair = playerIsP1
    ? { p1: match.pair1_player1, p2: match.pair1_player2, isP1Side: true }
    : { p1: match.pair2_player1, p2: match.pair2_player2, isP1Side: false }
  const bottomPair = playerIsP1
    ? { p1: match.pair2_player1, p2: match.pair2_player2, isP1Side: false }
    : { p1: match.pair1_player1, p2: match.pair1_player2, isP1Side: true }

  // Per-pair win flags — only valid for finished-ish matches
  const topWon = playerWon
  const bottomWon = playerLost && !playerWon

  return (
    <div
      onClick={onClick}
      style={{
        background: BG_CARD,
        clipPath: CHUNKY.card,
        padding: '8px 12px 10px',
        margin: '6px 8px 0',
        cursor: 'pointer',
        display: 'flex', flexDirection: 'column',
      }}
    >
      {/* Meta strip */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        color: MUTED, fontSize: 10, padding: '2px 0 6px',
      }}>
        {leadNode}
        {match.round && <>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
          <span>{match.round}</span>
        </>}
        {dateString && <>
          <span style={{ color: 'rgba(255,255,255,0.2)' }}>·</span>
          <span>{dateString}</span>
        </>}
        {retTag && (
          <span style={{
            marginLeft: 'auto',
            color: ORANGE, background: 'rgba(245,166,35,0.12)',
            padding: '2px 6px', borderRadius: 3,
            fontSize: 9, fontWeight: 800, letterSpacing: 0.4,
            textTransform: 'uppercase',
          }}>{retTag}</span>
        )}
      </div>

      {/* Team rows — player's pair first */}
      <TeamRow
        p1={topPair.p1} p2={topPair.p2}
        sets={match.sets}
        isP1Side={topPair.isP1Side}
        isWinner={topWon}
        status={match.status}
      />
      <TeamRow
        p1={bottomPair.p1} p2={bottomPair.p2}
        sets={match.sets}
        isP1Side={bottomPair.isP1Side}
        isWinner={bottomWon}
        status={match.status}
      />
    </div>
  )
}

// Like formatDate but appends time-of-day for scheduled matches.
function formatDateTime(
  iso: string | null,
  format: ReturnType<typeof useFormatter>,
): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const datePart = format.dateTime(d, DATE_WITH_YEAR)
    const timePart = format.dateTime(d, { hour: '2-digit', minute: '2-digit' })
    return `${datePart} · ${timePart}`
  } catch {
    return ''
  }
}
```

- [ ] **Step 2: Sanity check — type check + lint**

```bash
npm run lint -- src/app/\[locale\]/player/\[id\]/page.tsx
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): add MatchRow component with stacked team layout"
```

---

## Task 6: Add `TournamentHeader` + `TournamentGroup` components

Renders the grey bar with flag + name + stage badge + level/date subtitle, followed by all the match rows for that tournament.

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` (add `TournamentHeader` + `TournamentGroup` right after `MatchRow`; add imports for `DATE_SHORT`, `titleCase`, `mostAdvancedRound`, `levelLabel`, `Link`)

- [ ] **Step 1: Extend imports**

Update imports at the top of `src/app/[locale]/player/[id]/page.tsx`:

Replace:
```ts
import { DATE_WITH_YEAR } from '@/lib/format-patterns'
```
with:
```ts
import { DATE_SHORT, DATE_WITH_YEAR } from '@/lib/format-patterns'
import { levelLabel, mostAdvancedRound } from '@/lib/tournament-labels'
import { Link } from '@/i18n/navigation'
```

If `Link` is already imported via `@/i18n/navigation` (search first), don't add it twice. Run:

```bash
grep "from '@/i18n/navigation'" src/app/\[locale\]/player/\[id\]/page.tsx
```

Then merge imports accordingly.

- [ ] **Step 2: Add a local `titleCase` (player page doesn't have one yet)**

Check:
```bash
grep "^function titleCase\|const titleCase" src/app/\[locale\]/player/\[id\]/page.tsx
```

If no result, add near the other string helpers (before the component block, e.g. right before `formatDate` at line 387):

```ts
function titleCase(input: string): string {
  return input.split(' ').map(word => {
    if (word.length === 0) return word
    if (word.length <= 1) return word.toUpperCase()
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  }).join(' ')
}
```

- [ ] **Step 3: Add TournamentHeader component**

Insert right after `MatchRow` + `formatDateTime`:

```tsx
// Grey bar with country flag, titlecased tournament name, stage badge,
// and level/date-range subline. Mirrors TournamentGroup header on /matches.
function TournamentHeader({
  tournament,
  matches,
  format,
}: {
  tournament: NonNullable<MatchRow['tournament']> & { id?: string; starts_at?: string | null; ends_at?: string | null }
  matches: MatchRow[]
  format: ReturnType<typeof useFormatter>
}) {
  const hasLive = matches.some(m => m.status === 'live')
  const accent = hasLive ? LIVE_RED : GREEN
  const stage = mostAdvancedRound(matches)
  const level = tournament.level ? levelLabel(tournament.level) : ''

  const dateRange = tournament.starts_at
    ? format.dateTime(new Date(tournament.starts_at), DATE_SHORT)
      + (tournament.ends_at ? ` \u2013 ${format.dateTime(new Date(tournament.ends_at), DATE_SHORT)}` : '')
    : ''

  const nameStr = tournament.name ? titleCase(tournament.name) : ''

  const body = (
    <>
      {tournament.country && <FlagImg country={tournament.country} size={20} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, color: '#fff',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>{nameStr}</span>
          {stage && (
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: 0.5,
              padding: '2px 6px', clipPath: CHUNKY.badge,
              color: accent,
              background: hasLive ? 'rgba(255,70,85,0.12)' : 'rgba(126,211,33,0.12)',
              flexShrink: 0, lineHeight: '12px', textTransform: 'uppercase',
            }}>{stage}</span>
          )}
        </div>
        {(level || dateRange) && (
          <div style={{
            fontSize: 9, fontWeight: 700, color: MUTED,
            letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 2,
          }}>
            {level}{level && dateRange ? ' \u00B7 ' : ''}{dateRange}
          </div>
        )}
      </div>
    </>
  )

  const containerStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 14px',
    background: '#1e1e1e',
    position: 'relative',
    textDecoration: 'none', color: 'inherit',
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Top accent bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: accent, zIndex: 1,
      }} />
      {tournament.id ? (
        <Link href={`/tournaments/${tournament.id}`} style={containerStyle}>
          {body}
        </Link>
      ) : (
        <div style={containerStyle}>{body}</div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Add TournamentGroup component**

Insert right after `TournamentHeader`:

```tsx
// Tournament header + its match rows, sorted reverse-chronologically.
function TournamentGroup({
  tournament,
  matches,
  playerId,
  onMatchClick,
  format,
}: {
  tournament: NonNullable<MatchRow['tournament']> & { id?: string; starts_at?: string | null; ends_at?: string | null }
  matches: MatchRow[]
  playerId: string
  onMatchClick: (matchId: string) => void
  format: ReturnType<typeof useFormatter>
}) {
  // Matches already sorted newest-first by the parent; we just render.
  return (
    <div style={{ marginBottom: 14 }}>
      <TournamentHeader tournament={tournament} matches={matches} format={format} />
      <div style={{ background: '#0b0b0b', padding: '2px 0 10px' }}>
        {matches.map(m => (
          <MatchRow
            key={m.id}
            match={m}
            playerId={playerId}
            onClick={() => onMatchClick(m.id)}
            format={format}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Sanity check — lint**

```bash
npm run lint -- src/app/\[locale\]/player/\[id\]/page.tsx
```

Expected: no errors. The two new components are unused — tolerate until Task 7.

- [ ] **Step 6: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): add TournamentHeader + TournamentGroup components"
```

---

## Task 7: Rewrite `MatchesTab` with grouping + pagination, delete `MatchListItem`

The payoff task: wire everything together, sort/group the matches, render groups with load-more, and remove the old list item.

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx:1475-1504` (rewrite `MatchesTab`)
- Modify: `src/app/[locale]/player/[id]/page.tsx:1416-1473` (delete `MatchListItem`)
- Modify: `src/app/[locale]/player/[id]/page.tsx:406-412` (delete `scoreString` — unused after this)

- [ ] **Step 1: Rewrite MatchesTab**

Replace the entire existing `MatchesTab` function (currently lines 1475-1504):

```tsx
function MatchesTab({
  matches, playerId, router, format,
}: {
  matches: MatchRow[]
  playerId: string
  router: ReturnType<typeof useRouter>
  format: ReturnType<typeof useFormatter>
}) {
  const [visibleTournaments, setVisibleTournaments] = useState(5)

  if (matches.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: MUTED, fontSize: 12 }}>
        No matches found.
      </div>
    )
  }

  // Group by tournament.id (matches with missing tournament get grouped under
  // a synthetic key so we don't crash)
  type Group = {
    key: string
    tournament: NonNullable<MatchRow['tournament']> & { id?: string; starts_at?: string | null; ends_at?: string | null }
    matches: MatchRow[]
  }
  const groups: Group[] = []
  const seen = new Map<string, Group>()
  for (const m of matches) {
    const t = m.tournament as Group['tournament'] | null
    // Keying by the tournament name when id is missing keeps orphan matches
    // merged by name rather than scattering into per-row groups.
    const key = (t as any)?.id ?? t?.name ?? '__orphan__'
    let g = seen.get(key)
    if (!g) {
      g = { key, tournament: t ?? ({} as Group['tournament']), matches: [] }
      seen.set(key, g)
      groups.push(g)
    }
    g.matches.push(m)
  }

  // Sort tournaments: live-first, then newest starts_at first
  groups.sort((a, b) => {
    const aLive = a.matches.some(m => m.status === 'live')
    const bLive = b.matches.some(m => m.status === 'live')
    if (aLive !== bLive) return aLive ? -1 : 1
    const aDate = (a.tournament as any)?.starts_at ?? ''
    const bDate = (b.tournament as any)?.starts_at ?? ''
    return bDate.localeCompare(aDate)
  })

  // Within each tournament: newest match first (final before QF before R16)
  for (const g of groups) {
    g.matches.sort((a, b) => matchTime(b) - matchTime(a))
  }

  const visible = groups.slice(0, visibleTournaments)
  const hiddenCount = groups.length - visible.length

  return (
    <div style={{ paddingBottom: 16 }}>
      {visible.map(g => (
        <TournamentGroup
          key={g.key}
          tournament={g.tournament}
          matches={g.matches}
          playerId={playerId}
          onMatchClick={(mid) => router.push(`/match/${mid}`)}
          format={format}
        />
      ))}
      {hiddenCount > 0 && (
        <div style={{ padding: '0 12px' }}>
          <button
            onClick={() => setVisibleTournaments(n => n + 5)}
            style={{
              width: '100%', padding: 12,
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 6,
              color: '#9ca3af',
              fontSize: 11, fontWeight: 700,
              letterSpacing: 0.5, textTransform: 'uppercase',
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            Load more tournaments
          </button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Delete `MatchListItem`**

Find and delete the entire function at lines 1416-1473 (the whole old `MatchListItem` block, including the closing `}`).

- [ ] **Step 3: Check if `scoreString` is still referenced**

```bash
grep -n "scoreString" src/app/\[locale\]/player/\[id\]/page.tsx
```

- If every hit is inside the `scoreString` function itself (definition at line 406-412), delete that function too.
- If any other callsite exists, leave `scoreString` alone.

- [ ] **Step 4: Verify the imports are clean**

```bash
npm run lint -- src/app/\[locale\]/player/\[id\]/page.tsx
```

Expected: no errors, no unused-symbol warnings on the imports we added in Tasks 4 + 6.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/player/\[id\]/page.tsx
git commit -m "feat(player): new stacked match history with tournament grouping + load-more"
```

---

## Task 8: Manual QA in preview

**Files:**
- No source changes unless bugs surface.

- [ ] **Step 1: Start the preview server**

Use the Claude Code preview tool to start the `Next.js (frontend)` server (port 3002). Wait for it to be ready.

- [ ] **Step 2: Test a player with many tournaments**

Open `http://localhost:3002/ranking`, click any top-10 men's or women's player (Tapia, Galan, Bea Gonzalez, Triay all have hundreds of matches). Click the **Matches** tab. Verify:
- Matches are grouped under tournament mini-headers
- Each header shows country flag, titlecased name, stage badge, level + date
- Five tournament groups render; a "Load more tournaments" button appears below
- Clicking the button reveals five more groups

- [ ] **Step 3: Verify win/loss orientation**

Find a match the player lost decisively (e.g. the original bug case: Bea vs Goenaga/Caldera). Verify:
- Player's pair is listed on the TOP row
- Player's pair row is muted (grey, regular weight)
- Opponent row is bold white
- Set cells on the player's row show the player's games (`0`, `1`), not the opponent's (`6`, `6`)
- Meta strip shows a red `L`

Then find a match the player won. Verify:
- Player's pair on TOP, bold white
- Opponent muted
- Meta strip shows green `W`

- [ ] **Step 4: Verify tie-break superscript**

Find any match with a 7-6 or 6-7 set. Verify:
- Set-winner's cell has a small superscript digit (the loser's tiebreak points)

- [ ] **Step 5: Verify retired / walkover tag**

Find a retired match. Use the Supabase MCP or the psql connection to locate one:

```sql
-- Locate a player id with a retired match for quick testing
select p.id, p.name, count(*)
from matches m
join players p on p.id in (m.pair1_player1_id, m.pair1_player2_id, m.pair2_player1_id, m.pair2_player2_id)
where m.status in ('retired', 'walkover')
group by p.id, p.name
order by count(*) desc
limit 10;
```

Navigate to that player and open the Matches tab. Verify:
- Small orange `RET` (or `W/O`) tag appears pushed to the right of the meta strip
- Rendered score cells reflect whatever sets completed (may be zero cells for a walkover)

- [ ] **Step 6: Verify live state**

If there's no live match on the tested player, skip. Otherwise verify:
- `● LIVE` in red in meta strip
- Current set cells render (even if just as static game counts, not live points)

- [ ] **Step 7: Verify scheduled state**

Find a scheduled match (player with upcoming draw). Verify:
- `VS` leading the meta strip
- Both team rows render with flags + names
- No set cells
- Date + time appears in the meta strip

- [ ] **Step 8: Verify mobile layout**

Use the preview's resize tool to set viewport to 390×844 (iPhone 14 Pro). Verify:
- No horizontal scroll
- Long pair names ellipsis-truncate
- Tournament header doesn't overflow
- Load-more button spans full width

- [ ] **Step 9: Take a proof screenshot**

Capture a screenshot of the new Matches tab on the tested player (using `preview_screenshot`). Attach it to the PR description.

- [ ] **Step 10: Fix any regressions found**

If any step above fails, create a targeted commit fixing it. Keep commits small and focused (one bug per commit). Loop back to Step 2 after each fix until the whole matrix passes.

- [ ] **Step 11: Final commit pass**

Ensure no uncommitted changes:

```bash
git status --short
```

Expected: empty (or only unrelated pre-existing untracked files — the tournament-page changes from the earlier session).

---

## Self-Review Checklist (run before handing off)

After writing the code but before declaring done, verify:

1. **Spec coverage** — for each section §1-§9 of the spec, a task implements it:
   - §1 Component structure → Tasks 3, 4, 5, 6, 7
   - §2 Tournament header → Task 6
   - §3a Meta strip → Task 5
   - §3b Team row + flag pair + names + set cells → Tasks 3, 4
   - §4 Grouping + ordering → Task 7
   - §5 Pagination → Task 7
   - §6 Refactor tournament-labels → Tasks 1, 2
   - §7 Data orientation (bug fix) → Task 5 (via `roles.isP1` + player's pair as topPair)
   - §8 Accessibility → preserved by whole-row click + colorblind-safe bold treatment
   - §9 Empty/edge states → Task 7 ("No matches found"), Task 5 (RET/WO tag)

2. **Placeholder scan** — no "TBD", "TODO", unimplemented stubs. ✓ (`liveCurrentDisplay` stub was dropped in Task 5 Step 3.)

3. **Type consistency** — `TeamRow` prop names (`p1, p2, sets, isP1Side, isWinner, status, currentSetDisplay, serving`) match their usage in `MatchRow`. `TournamentGroup` prop names (`tournament, matches, playerId, onMatchClick, format`) match usage in `MatchesTab`. ✓

4. **No orphaned code** — `MatchListItem` and `scoreString` deleted in Task 7 steps 2-3. ✓
