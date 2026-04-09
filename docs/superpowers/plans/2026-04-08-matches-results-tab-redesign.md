# Matches Results Tab Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refocus the Results tab of `/matches` on actual match results (using the same `V3MatchCard` rendering used inside the tournament detail page), tighten tab landing priority, and replace the "Load previous seasons" pagination with a link to the home Events view (which becomes URL-addressable as `/home?view=tournaments`).

**Architecture:** Three independent tasks executed in order. Task 1 extracts the existing `V3MatchCard` into a shared component (lays the foundation). Task 2 redesigns the matches Results tab using the shared component. Task 3 makes the home Events view URL-addressable so the new Results-tab link actually navigates correctly.

**Tech Stack:** React 19, Next.js 16, TypeScript 5, inline styles. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-04-08-matches-results-tab-redesign-design.md`

---

## File Structure

**New file:**
- `src/components/V3MatchCard.tsx` — extracted shared match card component

**Modified files:**
- `src/app/(app)/tournaments/[id]/page.tsx` — delete inline `V3MatchCard`, import from shared location
- `src/app/(app)/matches/page.tsx` — delete Champions branch + helpers, render `V3MatchCard` in Results, bump cap, fix tab landing, replace load-more with view-link
- `src/app/(app)/home/page.tsx` — add `useSearchParams` reader and `switchView` helper for URL-addressable Events view

---

## Task 1: Extract `V3MatchCard` into a shared component

**Rationale:** Both the tournament detail page and the matches Results tab will need this component. Extracting first means Task 2 has a clean import path, and the tournament detail page should look pixel-identical after the move (low-risk validation).

**Files:**
- Create: `src/components/V3MatchCard.tsx`
- Modify: `src/app/(app)/tournaments/[id]/page.tsx` (delete inline `V3MatchCard`, add import)

- [ ] **Step 1: Create the shared component file**

Write `src/components/V3MatchCard.tsx` with this exact content:

```tsx
'use client'
// src/components/V3MatchCard.tsx
//
// Shared match card used by tournament detail pages and the matches Results tab.
// Renders a finished or live match with a left gender accent bar, a Final/Live/W/O
// status pill, round + court header, and two-row scoresheet with stacked dual flags.
//
// Extracted from src/app/(app)/tournaments/[id]/page.tsx — preserved verbatim
// so existing call sites render identically.

import Link from 'next/link'
import { Match, pairName, parseSetScore } from '@/types/match'

// ── Brand colors ───────────────────────────────────────────────
const GREEN = '#7ED321'
const LIVE_RED = '#FF4655'
const BG_CARD = '#141414'
const MUTED = '#6B7280'
const BORDER = 'rgba(255,255,255,0.06)'

// ── Chunky clip-path presets ───────────────────────────────────
const CHUNKY = {
  badge: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
  card: 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)',
}

// ── FlagImg (local copy — same implementation as the page files) ──
function FlagImg({ country, size = 16 }: { country: string | null; size?: number }) {
  if (!country) return <span style={{ width: size, height: size * 0.75, display: 'inline-block' }} />
  const code = country.toLowerCase()
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={country}
      width={size}
      height={size * 0.75}
      style={{ objectFit: 'cover', display: 'block', flexShrink: 0 }}
    />
  )
}

// ── V3MatchCard ────────────────────────────────────────────────

export function V3MatchCard({ match, genderColor }: { match: Match; genderColor: string }) {
  const sets = (match.sets ?? []).sort((a, b) => a.set_number - b.set_number)
  const currentSet = sets.find(s => s.is_current)
  const currentGame = currentSet?.games?.find(g => g.is_current)
  const gamePoints = currentGame?.game_score ?? ''
  const isLive = match.status === 'live'
  const isFinished = ['finished', 'retired', 'walkover', 'ended'].includes(match.status as string)

  const getWinner = (): 0 | 1 | 2 => {
    if (match.winner_pair === 1) return 1
    if (match.winner_pair === 2) return 2
    let p1Sets = 0, p2Sets = 0
    for (const s of sets) {
      let p1 = s.pair1_games ?? 0
      let p2 = s.pair2_games ?? 0
      if (p1 === 0 && p2 === 0 && s.set_score) {
        const parsed = parseSetScore(s.set_score)
        if (parsed) { p1 = parsed.p1; p2 = parsed.p2 }
      }
      if (p1 > p2) p1Sets++
      else if (p2 > p1) p2Sets++
    }
    if (p1Sets === p2Sets) return 0
    return p1Sets > p2Sets ? 1 : 2
  }
  const winner = isFinished ? getWinner() : 0

  const borderColor = isLive ? 'rgba(255,70,85,0.2)' : BORDER

  return (
    <Link href={`/match/${match.id}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 6 }}>
      <div style={{
        background: BG_CARD,
        border: `1px solid ${borderColor}`,
        clipPath: CHUNKY.card,
        padding: '14px 16px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Left gender accent bar */}
        <div style={{
          position: 'absolute', top: 0, left: 0, bottom: 0,
          width: 3, background: genderColor,
        }} />

        {/* Live glow */}
        {isLive && (
          <div style={{
            position: 'absolute', top: -40, right: -40, width: 120, height: 120,
            background: 'radial-gradient(circle, rgba(255,70,85,0.10) 0%, transparent 70%)',
          }} />
        )}

        {/* Header row: status + round/court */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          {isLive ? (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: LIVE_RED,
              padding: '2px 8px',
              clipPath: CHUNKY.badge,
            }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#fff', animation: 'v3-pulse 2s infinite' }} />
              <span style={{ fontSize: 9, fontWeight: 800, color: '#fff', letterSpacing: 0.5 }}>LIVE</span>
            </div>
          ) : isFinished ? (
            <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, letterSpacing: 0.5, textTransform: 'uppercase' }}>
              {match.status === 'retired' ? 'Retired' : match.status === 'walkover' ? 'W/O' : 'Final'}
            </span>
          ) : null}
          <span style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
            {match.round ?? ''}{match.court ? ` \u00B7 ${match.court}` : ''}
          </span>
        </div>

        {/* Score rows */}
        {[1, 2].map(pairNum => {
          const p1 = pairNum === 1 ? match.pair1_player1 : match.pair2_player1
          const p2 = pairNum === 1 ? match.pair1_player2 : match.pair2_player2
          const pair = pairName(p1, p2)
          const isWinner = winner === pairNum
          const isLoser = winner !== 0 && winner !== pairNum

          return (
            <div key={pairNum} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 0',
              opacity: isLoser ? 0.4 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 }}>
                {/* Stacked overlapping flags — second slightly lower */}
                <div style={{ position: 'relative', width: 26, height: 20, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImg country={p1?.country ?? null} size={16} />
                  </div>
                  <div style={{ position: 'absolute', top: 6, left: 8, zIndex: 1 }}>
                    <FlagImg country={p2?.country ?? null} size={16} />
                  </div>
                </div>
                <span style={{
                  fontSize: 13, fontWeight: isWinner ? 800 : 600, color: '#fff',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {pair}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {sets.map(s => {
                  const parsed = parseSetScore(s.set_score)
                  const games = pairNum === 1 ? (parsed?.p1 ?? s.pair1_games) : (parsed?.p2 ?? s.pair2_games)
                  const isCurrent = s.is_current && isLive
                  return (
                    <span key={s.id} style={{
                      fontSize: 15, fontWeight: 700, fontFamily: 'monospace',
                      color: isCurrent ? GREEN : '#fff',
                      minWidth: 16, textAlign: 'center',
                    }}>
                      {games}
                    </span>
                  )
                })}
                {isLive && gamePoints && (
                  <span style={{
                    fontSize: 17, fontWeight: 800, fontFamily: 'monospace',
                    color: LIVE_RED, minWidth: 20, textAlign: 'center',
                    marginLeft: 4,
                  }}>
                    {gamePoints.split(':')[pairNum === 1 ? 0 : 1] ?? ''}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Delete the inline `V3MatchCard` from `tournaments/[id]/page.tsx`**

Open `src/app/(app)/tournaments/[id]/page.tsx`. Find the comment header `// ── V3 Match Card (live + finished) ─────────────────────────` (around line 861) and delete from there through the closing `}` of the `V3MatchCard` function (around line 1001). Specifically delete the entire block:

```tsx
// ══════════════════════════════════════════════════════════════
// ── V3 Match Card (live + finished) ─────────────────────────
// ══════════════════════════════════════════════════════════════

function V3MatchCard({ match, genderColor }: { match: Match; genderColor: string }) {
  // ... entire function body ...
}
```

If the block is bounded by additional comment dividers (`// ══════════════════════════════════════════════════════════════`), delete those too — the goal is a clean removal that leaves no orphan comment.

- [ ] **Step 3: Add the import to `tournaments/[id]/page.tsx`**

At the top of `src/app/(app)/tournaments/[id]/page.tsx`, in the existing import block (around lines 6-17), add:

```tsx
import { V3MatchCard } from '@/components/V3MatchCard'
```

Place it alphabetically with the other `@/components/*` imports (e.g. after `import BracketView from '@/components/BracketView'`).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -E "(tournaments/\[id\]/page|V3MatchCard)"`

Expected: no NEW errors mentioning either file. Pre-existing errors elsewhere in the project are fine.

- [ ] **Step 5: Lint**

Run: `npm run lint -- src/app/\(app\)/tournaments/\[id\]/page.tsx src/components/V3MatchCard.tsx 2>&1 | tail -20`

Expected: no new errors. Pre-existing warnings about unrelated lines are fine.

- [ ] **Step 6: Visual smoke test of the tournament detail page**

The dev server is running on port 3000 (verify via `mcp__Claude_Preview__preview_list`). Navigate to a tournament detail page that has finished matches:

```
mcp__Claude_Preview__preview_eval:
  expression: window.location.href = '/tournaments/d3d73d56-eea4-4ebb-8715-58fa87751a52'
```

Wait a beat, then `mcp__Claude_Preview__preview_screenshot`. Verify the match cards (live, scheduled, finished) on the tournament page render exactly as they did before — same gender accent bar, same status pill, same scoresheet layout.

If anything looks different, there's a regression in the extraction. Pause and investigate before continuing.

- [ ] **Step 7: Console error check**

```
mcp__Claude_Preview__preview_console_logs:
  level: 'error'
  lines: 20
```

Expected: no new errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/V3MatchCard.tsx src/app/\(app\)/tournaments/\[id\]/page.tsx
git commit -m "$(cat <<'EOF'
refactor(tournaments): extract V3MatchCard into shared component

Lift the V3MatchCard rendering used by the tournament detail page
into src/components/V3MatchCard.tsx so it can be imported by other
surfaces (next: matches Results tab). Also bundles a local FlagImg
copy and the few color/clip-path constants the card needs so the
new file is self-contained.

The tournament detail page now imports the component instead of
defining it inline. Pixel-identical rendering — verified by
manual screenshot comparison on /tournaments/d3d73d56-...

Spec: docs/superpowers/specs/2026-04-08-matches-results-tab-redesign-design.md
EOF
)"
```

---

## Task 2: Redesign the matches Results tab

**Rationale:** With `V3MatchCard` available as a shared component, we can rebuild the Results tab to render real match data instead of Champion-link cards. This task also handles the tab landing priority and the load-more replacement.

**Files:**
- Modify: `src/app/(app)/matches/page.tsx`

### Step 1: Add the import

- [ ] At the top of `src/app/(app)/matches/page.tsx`, add to the imports block (after `import FollowButton from '@/components/FollowButton'` around line 14):

```tsx
import { V3MatchCard } from '@/components/V3MatchCard'
```

### Step 2: Delete the Champions branch in `TournamentGroup`

- [ ] Find the `if (isFinished)` branch inside `TournamentGroup` — it starts around line 481 with `// Finished tournament → compact card linking to tournament page` and includes the entire `return ( <Link href={...recap}>...</Link> )` block down to `)` around line 560. Delete the entire `if (isFinished) { return (...) }` block.

After deletion, line 480 (`if (isFinished) {`) and the matching closing brace are gone, and the next code immediately following is the regular collapsible group rendering (`// Derive the most advanced round`).

### Step 3: Delete unused helpers

- [ ] Find and delete the `getChampions` function (around lines 131-160). It looks like:

```tsx
function getChampions(matches: Match[], category: string): { player1: string | null; player2: string | null; avatar1: string | null; avatar2: string | null } | null {
  // ... function body ...
}
```

- [ ] Find and delete the `ChampionRow` component (around lines 423-453). It looks like:

```tsx
// ── Champion row for finished tournaments ──────────────────────

function ChampionRow({ champions, color }: { champions: { player1: string | null; ... }; color: string }) {
  // ... function body ...
}
```

- [ ] Find and delete the four lines inside `TournamentGroup` that referenced these (now dead variables) — they were just above the `if (isFinished)` branch you already deleted:

```tsx
  const menChampions = isFinished ? getChampions(matches, 'men') : null
  const womenChampions = isFinished ? getChampions(matches, 'women') : null
  const showMen = genderFilter === 'all' || genderFilter === 'men'
  const showWomen = genderFilter === 'all' || genderFilter === 'women'
  const hasChampions = (showMen && menChampions) || (showWomen && womenChampions)
```

After deletion, `TournamentGroup` no longer references `genderFilter` for the Champions logic, but it still might be passed in as a prop. Leave the prop in the signature — it's still used for other rendering conditions if any (verify with grep — if not, also delete the prop as part of this step). Quick grep inside `TournamentGroup` body for `genderFilter` after the deletions: if zero hits, remove the prop from the destructuring AND from the call site at line 1085 today.

### Step 4: Add `tab` prop to `TournamentGroup`

- [ ] Update the `TournamentGroup` function signature. Find:

```tsx
function TournamentGroup({ tournament, matches, defaultOpen, genderFilter }: {
  tournament: any
  matches: Match[]
  defaultOpen: boolean
  genderFilter: string
}) {
```

Replace with:

```tsx
function TournamentGroup({ tournament, matches, defaultOpen, tab }: {
  tournament: any
  matches: Match[]
  defaultOpen: boolean
  tab: 'live' | 'upcoming' | 'results'
}) {
```

(Drop `genderFilter` if Step 3 confirmed it's no longer referenced inside the body. Otherwise keep it.)

### Step 5: Add gender color helper inside `TournamentGroup`

- [ ] Just before the `return (` of `TournamentGroup`, add:

```tsx
  // Resolve a per-match gender accent color for V3MatchCard rendering.
  const genderColorFor = (m: Match): string => {
    const cat = (m as any).category as string | null
    if (cat === 'men') return MEN_BLUE
    if (cat === 'women') return WOMEN_PURPLE
    return MUTED
  }
```

### Step 6: Switch the visible-matches render to branch on `tab`

- [ ] Find the existing render block (around lines 667-673):

```tsx
{visibleMatches.length > 0 && (
  <div style={gated ? { opacity: 0.4, filter: 'grayscale(60%)', pointerEvents: 'none' } : undefined}>
    {visibleMatches.map(m => (
      <V3MatchRow key={m.id} match={m} />
    ))}
  </div>
)}
```

Replace the inner `.map` with a tab-aware branch:

```tsx
{visibleMatches.length > 0 && (
  <div style={gated ? { opacity: 0.4, filter: 'grayscale(60%)', pointerEvents: 'none' } : undefined}>
    {visibleMatches.map(m => (
      tab === 'results'
        ? <V3MatchCard key={m.id} match={m} genderColor={genderColorFor(m)} />
        : <V3MatchRow key={m.id} match={m} />
    ))}
  </div>
)}
```

### Step 7: Bump per-tournament cap from 3 to 10

- [ ] Find line 576 today:

```tsx
  const visibleMatches = viewState === 'collapsed' ? [] : viewState === 'expanded' ? matches : matches.slice(0, 3)
```

Change `slice(0, 3)` to `slice(0, 10)`:

```tsx
  const visibleMatches = viewState === 'collapsed' ? [] : viewState === 'expanded' ? matches : matches.slice(0, 10)
```

- [ ] Find line 674 today:

```tsx
{matchCount > 3 && viewState !== 'collapsed' && (
```

Change to:

```tsx
{matchCount > 10 && viewState !== 'collapsed' && (
```

### Step 8: Update tab landing priority

- [ ] Find lines 810-816 today inside `fetchData`:

```tsx
      // Auto-select tab only on first load: show live only if actual live matches exist
      if (!initialLoadDone.current) {
        const hasLive = liveData.length > 0
        if (hasLive) setTab('live')
        else setTab('upcoming')
        initialLoadDone.current = true
      }
```

Replace with:

```tsx
      // Auto-select tab only on first load: live → upcoming → results
      if (!initialLoadDone.current) {
        const hasLive = liveData.length > 0
        const hasUpcoming = (dataOf(1) as Match[]).length > 0
        if (hasLive) setTab('live')
        else if (hasUpcoming) setTab('upcoming')
        else setTab('results')
        initialLoadDone.current = true
      }
```

### Step 9: Update the call site for `TournamentGroup` and add Results-tab default-open

- [ ] Find lines 1079-1086 today:

```tsx
            {grouped.length > 0 ? grouped.map((group, idx) => (
              <TournamentGroup
                key={group.tournament?.id ?? idx}
                tournament={group.tournament}
                matches={group.matches}
                defaultOpen={tab === 'live'}
                genderFilter={genderFilter}
              />
            )) : (
```

Replace the props block (NOT the surrounding `grouped.length > 0 ? grouped.map((group, idx) => (`) with:

```tsx
            {grouped.length > 0 ? grouped.map((group, idx) => (
              <TournamentGroup
                key={group.tournament?.id ?? idx}
                tournament={group.tournament}
                matches={group.matches}
                defaultOpen={tab === 'live' || (tab === 'results' && idx === 0)}
                tab={tab}
              />
            )) : (
```

(If Step 4 kept `genderFilter` in the prop list, also keep it in the call site — only drop it if `genderFilter` is truly unused inside `TournamentGroup`.)

### Step 10: Replace "Load previous seasons" with "View previous seasons"

- [ ] Find lines 1110-1130 today:

```tsx
          {/* Load more for results */}
          {tab === 'results' && hasMore && (
            <div style={{ padding: '0 16px 32px', textAlign: 'center' }}>
              <button
                onClick={fetchMoreResults}
                disabled={loadingMore}
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.button,
                  padding: '10px 28px',
                  fontSize: 12, fontWeight: 700,
                  color: loadingMore ? MUTED : GREEN,
                  cursor: loadingMore ? 'default' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {loadingMore ? <Spinner size={16} /> : 'Load previous seasons'}
              </button>
            </div>
          )}
```

Replace with:

```tsx
          {/* View previous seasons → home Events view */}
          {tab === 'results' && (
            <div style={{ padding: '0 16px 32px', textAlign: 'center' }}>
              <Link
                href="/home?view=tournaments"
                style={{
                  display: 'inline-block',
                  background: 'rgba(255,255,255,0.04)',
                  border: `1px solid ${BORDER}`,
                  clipPath: CHUNKY.button,
                  padding: '10px 28px',
                  fontSize: 12, fontWeight: 700,
                  color: GREEN,
                  textDecoration: 'none',
                  fontFamily: 'inherit',
                }}
              >
                View previous seasons
              </Link>
            </div>
          )}
```

### Step 11: Delete the dead pagination state and helpers

- [ ] Find and delete:

```tsx
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
```

(around lines 742-743)

- [ ] Find and delete `pageRef`:

```tsx
  const pageRef = useRef(0)
```

(around line 748)

- [ ] Find and delete the two lines inside `fetchData` that touched these:

```tsx
      setHasMore(true)
      pageRef.current = 0
```

(around lines 807-808)

- [ ] Find and delete the entire `fetchMoreResults` callback:

```tsx
  const fetchMoreResults = useCallback(async () => {
    setLoadingMore(true)
    const nextPage = pageRef.current + 1
    const from = nextPage * 50
    const to = from + 49

    const { data } = await supabase.from('matches').select(matchSelect)
      .in('status', ['finished', 'retired', 'walkover'])
      .not('finished_at', 'is', null)
      .lt('finished_at', `${new Date().getFullYear()}-01-01`)
      .order('finished_at', { ascending: false })
      .range(from, to)

    const sorted = sortSets((data as any) ?? [])
    setRecentMatches(prev => [...prev, ...sorted])
    setHasMore(sorted.length >= 50)
    pageRef.current = nextPage
    setLoadingMore(false)
  }, [])
```

(around lines 826-844)

- [ ] If after these deletions the `Spinner` import (`import Spinner from '../../components/Spinner'`) is no longer used anywhere else in the file, delete the import too. Otherwise leave it. Quick grep: `grep -n "Spinner" src/app/\(app\)/matches/page.tsx`. If only the import line remains, remove it.

### Step 12: Typecheck

- [ ] Run: `npx tsc --noEmit 2>&1 | grep "src/app/(app)/matches/page.tsx"`

Expected: no NEW errors. Pre-existing errors are fine.

### Step 13: Lint

- [ ] Run: `npm run lint -- src/app/\(app\)/matches/page.tsx 2>&1 | tail -30`

Expected: no new errors.

### Step 14: Visual verification

- [ ] Use Claude Preview to navigate to `/matches`:

```
mcp__Claude_Preview__preview_eval:
  expression: window.location.href = '/matches'
```

Wait, then check the auto-selected tab (should be Live if any live matches exist, else Upcoming, else Results).

- [ ] Click the Results tab explicitly:

```
mcp__Claude_Preview__preview_eval:
  expression: |
    (async () => {
      await new Promise(r => setTimeout(r, 1500));
      const tabs = [...document.querySelectorAll('button')].filter(el => el.textContent?.trim() === 'Results');
      if (tabs[0]) tabs[0].click();
      await new Promise(r => setTimeout(r, 800));
      return 'ready';
    })()
```

- [ ] Screenshot. Verify:
  - Each tournament group renders with the existing chunky group header (flag, name, round badge, count, chevron)
  - The FIRST group is expanded by default, all others collapsed
  - The expanded group shows match cards rendered as `V3MatchCard` (gender accent bar on the left, "Final" / "Retired" / "W/O" pill on top, round + court header, two-row scoresheet) — NOT the old single-line `V3MatchRow`
  - No Champions widget anywhere
  - At the bottom of the tab, a "View previous seasons" link is visible (not a "Load previous seasons" button)

- [ ] Click a different (collapsed) tournament's chevron to expand it. Screenshot. Verify:
  - The matches inside that group also render as `V3MatchCard`

- [ ] Find a tournament group with more than 10 matches (if any) and verify the "Show all N matches" toggle appears at the bottom of the group. Click it and verify expansion works.

- [ ] Console check: `mcp__Claude_Preview__preview_console_logs` with `level: 'error'`. No new errors.

### Step 15: Verify Live and Upcoming tabs are unchanged

- [ ] Click Live tab:

```
mcp__Claude_Preview__preview_eval:
  expression: |
    (async () => {
      const tabs = [...document.querySelectorAll('button')].filter(el => el.textContent?.trim() === 'Live');
      if (tabs[0]) tabs[0].click();
      await new Promise(r => setTimeout(r, 500));
      return 'ok';
    })()
```

Screenshot and verify the live matches still render with `V3MatchRow` (the existing thin row with court info, animated live updates, etc.). No regression.

- [ ] Click Upcoming tab and verify the same — `V3MatchRow` rendering, not `V3MatchCard`.

### Step 16: Commit

- [ ] Commit:

```bash
git add src/app/\(app\)/matches/page.tsx
git commit -m "$(cat <<'EOF'
feat(matches): redesign Results tab around real match cards

The Results tab previously showed Champion-link cards per finished
tournament — clicking through to see the actual match results was
required. The redesign refocuses the tab on the matches themselves:

- Delete the Champions branch in TournamentGroup along with its
  helpers (getChampions, ChampionRow) — only used by the deleted UI
- Render each match using the shared V3MatchCard (extracted in the
  previous commit) so the Results tab matches what the tournament
  detail page already shows
- Pass tab='results' down to TournamentGroup so it knows which card
  variant to render; Live/Upcoming keep V3MatchRow unchanged
- Bump the per-tournament default cap from 3 to 10 matches
- Default-open only the first (most recent) tournament on Results;
  others stay collapsed
- Tab landing priority is now live → upcoming → results, instead
  of just live → upcoming
- Replace the "Load previous seasons" pagination button with a
  "View previous seasons" link to /home?view=tournaments — the
  home Events view becomes URL-addressable in the next commit
- Drop the now-dead loadingMore/hasMore/pageRef state and the
  fetchMoreResults callback

Spec: docs/superpowers/specs/2026-04-08-matches-results-tab-redesign-design.md
EOF
)"
```

---

## Task 3: Make the home Events view URL-addressable

**Rationale:** The Results tab now links to `/home?view=tournaments`, but the home page currently ignores that query param. This task wires up `useSearchParams` so the URL controls which view is shown, and the existing internal toggle also pushes the URL when changed.

**Files:**
- Modify: `src/app/(app)/home/page.tsx`

### Step 1: Add the search-params reader

- [ ] Open `src/app/(app)/home/page.tsx`. The file already imports React hooks. Find the existing `next/navigation` import line — if present, add `useSearchParams, useRouter` to it. If not present, add a new import line near the top:

```tsx
import { useSearchParams, useRouter } from 'next/navigation'
```

Note: home page is `'use client'` already, so this works.

- [ ] Inside the main page component (where `const [view, setView] = useState<'home' | 'tournaments'>('home')` lives at line 1826), add right above that line:

```tsx
  const searchParams = useSearchParams()
  const router = useRouter()
  const initialView: 'home' | 'tournaments' = searchParams.get('view') === 'tournaments' ? 'tournaments' : 'home'
```

Then change the existing `useState` call from:

```tsx
  const [view, setView] = useState<'home' | 'tournaments'>('home')
```

to:

```tsx
  const [view, setView] = useState<'home' | 'tournaments'>(initialView)
```

### Step 2: Add the `switchView` helper and URL sync effect

- [ ] Just below the `useState` declaration, add:

```tsx
  const switchView = useCallback((next: 'home' | 'tournaments') => {
    setView(next)
    const url = next === 'tournaments' ? '/home?view=tournaments' : '/home'
    router.replace(url, { scroll: false })
  }, [router])

  // Sync state when URL changes (e.g. user navigates from /home to /home?view=tournaments via a link)
  useEffect(() => {
    const next = searchParams.get('view') === 'tournaments' ? 'tournaments' : 'home'
    setView(next)
  }, [searchParams])
```

Verify `useCallback` and `useEffect` are already imported from React (they are — line 6 of the home page imports the hooks).

### Step 3: Replace `setView` call sites with `switchView`

- [ ] Find line 1977 today (the back button inside the tournaments view):

```tsx
        <TournamentsView onBack={() => setView('home')} />
```

Change to:

```tsx
        <TournamentsView onBack={() => switchView('home')} />
```

- [ ] Find line 2107 today (the "Full Events" action):

```tsx
          <SectionTitle action="Full Events" onAction={() => { setView('tournaments'); window.scrollTo(0, 0) }}>Tournament Spotlight</SectionTitle>
```

Change to:

```tsx
          <SectionTitle action="Full Events" onAction={() => { switchView('tournaments'); window.scrollTo(0, 0) }}>Tournament Spotlight</SectionTitle>
```

- [ ] Grep for any other `setView(` call sites in `home/page.tsx`. If any exist, replace them with `switchView(` too. Run: `grep -n "setView(" src/app/\(app\)/home/page.tsx`. The state setter `setView` should still be assignable from the destructured `useState` return value (don't rename it), but no further calls to it should remain — all UI uses `switchView`.

### Step 4: Typecheck

- [ ] Run: `npx tsc --noEmit 2>&1 | grep "src/app/(app)/home/page.tsx"`

Expected: no NEW errors.

### Step 5: Lint

- [ ] Run: `npm run lint -- src/app/\(app\)/home/page.tsx 2>&1 | tail -20`

Expected: no new errors. The new `useEffect` may trigger an `exhaustive-deps` warning if `searchParams` is the only dep — that's fine because `searchParams` IS the only thing the effect reads. If lint complains, add an eslint-disable-next-line for that effect.

### Step 6: Verify the link from Results tab navigates correctly

- [ ] Use Claude Preview. Start on the matches page Results tab:

```
mcp__Claude_Preview__preview_eval:
  expression: window.location.href = '/matches'
```

Wait, click Results tab manually, scroll to the bottom:

```
mcp__Claude_Preview__preview_eval:
  expression: |
    (async () => {
      await new Promise(r => setTimeout(r, 1500));
      const tabs = [...document.querySelectorAll('button')].filter(el => el.textContent?.trim() === 'Results');
      if (tabs[0]) tabs[0].click();
      await new Promise(r => setTimeout(r, 800));
      document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight;
      return 'ready';
    })()
```

Screenshot the bottom of the page. Verify "View previous seasons" link is present.

- [ ] Click the link:

```
mcp__Claude_Preview__preview_eval:
  expression: |
    (async () => {
      const links = [...document.querySelectorAll('a')].filter(el => el.textContent?.trim() === 'View previous seasons');
      if (links[0]) links[0].click();
      await new Promise(r => setTimeout(r, 1200));
      return window.location.pathname + window.location.search;
    })()
```

Expected return value: `/home?view=tournaments`

- [ ] Screenshot. Verify the Events view is shown (the Premier Padel / FIP Tour tabs, Upcoming section, Completed - 2026 section, etc. — the same view that the home page's "Full Events" button shows today).

### Step 7: Verify the home page direct URL works

- [ ] Open `/home?view=tournaments` directly:

```
mcp__Claude_Preview__preview_eval:
  expression: window.location.href = '/home?view=tournaments'
```

Wait and screenshot. Should land directly on the Events view.

### Step 8: Verify back-button behavior

- [ ] From the Events view (still on `/home?view=tournaments`), trigger the in-app back via the `<` button at the top of the events view:

```
mcp__Claude_Preview__preview_eval:
  expression: |
    (async () => {
      const back = document.querySelector('button[aria-label*="back"], button svg polyline[points="15 18 9 12 15 6"]');
      if (back) (back.closest('button') as HTMLButtonElement).click();
      await new Promise(r => setTimeout(r, 800));
      return window.location.pathname + window.location.search;
    })()
```

Expected: `/home` (no query param). The view should switch back to the home feed.

- [ ] Verify the home feed is showing — screenshot.

### Step 9: Verify normal home page URL still works

- [ ] Open `/home` directly:

```
mcp__Claude_Preview__preview_eval:
  expression: window.location.href = '/home'
```

Screenshot. Should land on the home feed (not the Events view).

### Step 10: Console check

```
mcp__Claude_Preview__preview_console_logs:
  level: 'error'
  lines: 20
```

Expected: no new errors.

### Step 11: Commit

```bash
git add src/app/\(app\)/home/page.tsx
git commit -m "$(cat <<'EOF'
feat(home): make Events view URL-addressable via /home?view=tournaments

The home page has long had a 'tournaments' view as local state, but
no URL representation — clicking "Full Events" toggled it in place
without history. Now the view is bound to a search param:

- /home               → home feed (default)
- /home?view=tournaments → Events view (Upcoming, Completed-2026,
                          past seasons, etc.)

A switchView helper wraps setView and pushes the URL via
router.replace, and a useEffect syncs state when the search param
changes (e.g. user navigates from /home → /home?view=tournaments
via a link inside the same page, including the Results tab's new
"View previous seasons" link from the previous commit).

router.replace (not push) keeps internal toggles out of history
so the browser back button returns to whatever was BEFORE /home,
not to a previous view of /home itself.

Spec: docs/superpowers/specs/2026-04-08-matches-results-tab-redesign-design.md
EOF
)"
```

---

## Final Verification

After all three tasks land, do an end-to-end check:

- [ ] **From scratch:**
  - Hard reload the app at `/matches`
  - Confirm the auto-selected tab respects `live → upcoming → results` priority
  - Confirm the Results tab shows the new layout
  - Click "View previous seasons" → lands on `/home?view=tournaments`
  - Confirm the Events view shows
  - Browser back → returns to matches page

- [ ] **Tournament detail page sanity:**
  - Open any `/tournaments/[id]` page
  - Confirm match cards render identically to before (no visual regression from V3MatchCard extraction)

- [ ] **Final typecheck:** `npx tsc --noEmit 2>&1 | wc -l` → same or fewer errors than before this work began

- [ ] **No commit needed** — verification only.

---

## Summary

Three commits, three files modified + one new file:

1. **Task 1 (`refactor`)** — extract `V3MatchCard` into `src/components/V3MatchCard.tsx`, swap inline definition for import in `tournaments/[id]/page.tsx`
2. **Task 2 (`feat`)** — redesign matches Results tab: delete Champions, render `V3MatchCard`, bump cap to 10, fix tab landing priority, replace load-more with view-link
3. **Task 3 (`feat`)** — make home Events view URL-addressable via `/home?view=tournaments`

Each task is independently verifiable and committable. No tests required (pure rendering + routing).
