# H2H Row Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ambiguous single-line H2H match rows on the match detail page with two-row scoresheet cards that match the home page's Latest Results pattern, so users can see who won and what the score was for each team at a glance.

**Architecture:** Pure JSX change inside the `H2HTab` function in `src/app/match/[id]/page.tsx`. No new files, no new imports (all helpers and constants already live in this file), no new props, no data layer changes. The sticky summary header and the "Last 5 Matches" bottom section stay exactly as they are today; only the per-match rows (and the now-obsolete column header strip above them) are touched.

**Tech Stack:** React 19, Next.js 16, TypeScript 5, inline styles (matching the rest of the file's existing style system).

**Design spec:** `docs/superpowers/specs/2026-04-08-h2h-row-redesign-design.md`

---

## File Structure

**Files modified:**

- `src/app/match/[id]/page.tsx` — Single file change.
  - Delete the `Column headers` block (lines 1434–1440 today)
  - Replace the `{h2hMatches.map((m, idx) => ...)}` block (lines 1449–1479 today) with a new render that produces two-row scoresheet cards
  - No changes to any other function, the sticky header, the empty state, or the "Last 5 Matches" section

**Files NOT touched:**

- `src/components/FlagImg.tsx` — reusing existing component (defined locally at line 50 of the same page file)
- `src/app/(app)/home/page.tsx` — reference implementation only, not modified
- Any data fetch, hook, or state

---

## Task 1: Remove the obsolete column header strip

**Rationale:** The strip labeled `Tournament·Round | Score | W/L` sits between the sticky summary header and the match list today. The new row design carries its own pills and has no shared columns, so this strip no longer applies. Removing it first keeps the working tree clean before we restructure the rows.

**Files:**
- Modify: `src/app/match/[id]/page.tsx` (inside function `H2HTab`, block starting `{h2hMatches.length > 0 && (` that renders the column headers)

- [ ] **Step 1: Open the file and locate the column header block**

Run: `grep -n "Column headers" src/app/match/[id]/page.tsx`
Expected: one match around line 1433.

- [ ] **Step 2: Delete the column header JSX block**

Remove this exact block:

```tsx
      {/* Column headers */}
      {h2hMatches.length > 0 && (
        <div style={{ display: 'flex', padding: '7px 16px', background: BG_CARD, borderBottom: `0.5px solid ${BORDER}` }}>
          <span style={{ flex: 1, fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Tournament · Round</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 48 }}>Score</span>
          <span style={{ fontSize: 9, fontWeight: 700, color: MUTED, textTransform: 'uppercase', letterSpacing: '0.5px', width: 28, textAlign: 'center' }}>W/L</span>
        </div>
      )}
```

Nothing replaces it — the empty-state block and the match list directly follow the sticky header.

- [ ] **Step 3: Verify the file still compiles**

Run: `npx tsc --noEmit`
Expected: no new errors (pre-existing errors unrelated to this file are fine — only verify no new errors from `src/app/match/[id]/page.tsx`).

- [ ] **Step 4: Commit**

```bash
git add src/app/match/[id]/page.tsx
git commit -m "refactor(match): remove obsolete H2H column header strip

Prep for H2H row redesign — the new row layout no longer shares
columns with a header strip, so the Tournament/Score/W-L labels go
away. No functional change yet."
```

---

## Task 2: Replace the match list rendering with the two-row scoresheet card

**Rationale:** This is the core of the redesign. The new render uses the same team-perspective mapping as today (`ourPairIsMatch1`) to decide orientation, then emits a card with a left accent bar, a pills row, and two team rows (winner bold + W badge, loser dimmed) with each team's own set scores. All helpers and constants already exist in this file.

**Files:**
- Modify: `src/app/match/[id]/page.tsx` (inside function `H2HTab`, block starting `{h2hMatches.map((m, idx) => {`)

- [ ] **Step 1: Locate the current match map block**

Run: `grep -n "h2hMatches.map" src/app/match/[id]/page.tsx`
Expected: match around line 1449 (post Task 1).

- [ ] **Step 2: Replace the entire `.map` block**

Find this block (note: exact line numbers may have shifted after Task 1; use the `h2hMatches.map((m, idx)` marker to locate):

```tsx
      {h2hMatches.map((m, idx) => {
        const mp1p1 = m.pair1_player1?.id ?? null
        const mp1p2 = m.pair1_player2?.id ?? null
        const ourPairIsMatch1 = pairMatchesIds(mp1p1, mp1p2, p1Ids)
        const ourWon = (ourPairIsMatch1 && m.winner_pair === 1) || (!ourPairIsMatch1 && m.winner_pair === 2)

        const scores = formatSetScores(m)
        const date = formatDate(m.finished_at ?? m.started_at)
        const tournamentName = (m.tournament as any)?.name ?? '\u2014'
        const round = m.round ?? ''

        return (
          <Link key={m.id} href={`/match/${m.id}`} style={{ padding: '10px 16px', borderBottom: `0.5px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 8, background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.1)', textDecoration: 'none' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {tournamentName}
              </div>
              <div style={{ fontSize: 10, color: MUTED, marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                <span>{round}</span>
                {date && <><span style={{ width: 2, height: 2, borderRadius: '50%', background: MUTED, display: 'inline-block' }} /><span>{date}</span></>}
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, fontFamily: 'monospace', color: MUTED, flexShrink: 0, textAlign: 'right', marginRight: 12 }}>
              {scores || '\u2014'}
            </div>
            <div style={{ width: 28, height: 28, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: ourWon ? PAIR1_BG : PAIR2_BG, border: `0.5px solid ${ourWon ? PAIR1_BORDER : PAIR2_BORDER}`, clipPath: CHUNKY.badge }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: ourWon ? PAIR1_COLOR : PAIR2_COLOR }}>{ourWon ? 'W' : 'L'}</span>
            </div>
          </Link>
        )
      })}
```

Replace it with:

```tsx
      {h2hMatches.map((m) => {
        // Perspective: figure out whether the historical match's pair1
        // corresponds to CURRENT team 1 (from the match we're viewing).
        // If yes, render historical pair1 on top; otherwise swap so
        // current team 1 is always on top (orange) and current team 2
        // always on the bottom (yellow).
        const mp1p1 = m.pair1_player1?.id ?? null
        const mp1p2 = m.pair1_player2?.id ?? null
        const ourPairIsMatch1 = pairMatchesIds(mp1p1, mp1p2, p1Ids)

        const topP1 = ourPairIsMatch1 ? m.pair1_player1 : m.pair2_player1
        const topP2 = ourPairIsMatch1 ? m.pair1_player2 : m.pair2_player2
        const botP1 = ourPairIsMatch1 ? m.pair2_player1 : m.pair1_player1
        const botP2 = ourPairIsMatch1 ? m.pair2_player2 : m.pair1_player2

        const topName = pairName(topP1, topP2)
        const botName = pairName(botP1, botP2)

        const team1Won = (ourPairIsMatch1 && m.winner_pair === 1) || (!ourPairIsMatch1 && m.winner_pair === 2)
        const team2Won = m.winner_pair != null && !team1Won
        const accentColor = team1Won ? PAIR1_COLOR : team2Won ? PAIR2_COLOR : MUTED

        // Per-set games for each side, in top-row / bottom-row orientation.
        const sortedSets = [...(m.sets ?? [])].sort((a: any, b: any) => a.set_number - b.set_number)
        const setGames: { top: number | string; bot: number | string }[] = sortedSets.map((s: any) => {
          const parsed = parseSetScore(s.set_score)
          const p1g = parsed?.p1 ?? s.pair1_games ?? 0
          const p2g = parsed?.p2 ?? s.pair2_games ?? 0
          return ourPairIsMatch1
            ? { top: p1g, bot: p2g }
            : { top: p2g, bot: p1g }
        })

        const date = formatDate(m.finished_at ?? m.started_at)
        const tournamentName = (m.tournament as any)?.name ?? '\u2014'
        const round = m.round ?? ''

        return (
          <Link
            key={m.id}
            href={`/match/${m.id}`}
            style={{
              display: 'block',
              textDecoration: 'none',
              color: 'inherit',
              margin: '6px 10px',
            }}
          >
            <div style={{
              position: 'relative',
              background: 'rgba(255,255,255,0.03)',
              clipPath: CHUNKY.card,
              padding: '6px 10px 6px 14px',
              overflow: 'hidden',
            }}>
              {/* Left accent bar — winner's team color */}
              <div style={{
                position: 'absolute',
                top: 0, left: 0, bottom: 0,
                width: 3,
                background: accentColor,
              }} />

              {/* Pills row: tournament, round, date */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px',
                  clipPath: CHUNKY.badge, textTransform: 'uppercase',
                  background: 'rgba(255,255,255,0.08)', color: '#fff',
                  letterSpacing: 0.3,
                  maxWidth: 180,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {tournamentName}
                </span>
                {round && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px',
                    clipPath: CHUNKY.badge, textTransform: 'uppercase',
                    background: 'rgba(255,255,255,0.06)', color: MUTED,
                    letterSpacing: 0.3,
                  }}>
                    {round}
                  </span>
                )}
                {date && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px',
                    clipPath: CHUNKY.badge, textTransform: 'uppercase',
                    background: 'rgba(255,255,255,0.06)', color: MUTED,
                    letterSpacing: 0.3,
                  }}>
                    {date}
                  </span>
                )}
              </div>

              {/* Team 1 row (always current team 1 — orange) */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '2px 0',
                opacity: team1Won || m.winner_pair == null ? 1 : 0.42,
              }}>
                {/* Flag stack */}
                <div style={{ position: 'relative', width: 22, height: 16, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImg country={topP1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 1 }}>
                    <FlagImg country={topP2?.country ?? null} size={14} />
                  </div>
                </div>
                <span style={{
                  flex: 1, minWidth: 0,
                  fontSize: 12,
                  fontWeight: team1Won ? 700 : 500,
                  color: team1Won ? '#fff' : MUTED,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {topName}
                </span>
                {team1Won && (
                  <span style={{
                    width: 14, height: 14, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: PAIR1_COLOR, clipPath: CHUNKY.badge,
                    fontSize: 8, fontWeight: 800, color: '#000',
                  }}>
                    W
                  </span>
                )}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {setGames.map((sg, i) => (
                    <span key={i} style={{
                      fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                      color: team1Won ? '#fff' : MUTED,
                      minWidth: 13, textAlign: 'center',
                    }}>
                      {sg.top}
                    </span>
                  ))}
                </div>
              </div>

              {/* Team 2 row (always current team 2 — yellow) */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '2px 0',
                opacity: team2Won || m.winner_pair == null ? 1 : 0.42,
              }}>
                <div style={{ position: 'relative', width: 22, height: 16, flexShrink: 0 }}>
                  <div style={{ position: 'absolute', top: 0, left: 0, zIndex: 2 }}>
                    <FlagImg country={botP1?.country ?? null} size={14} />
                  </div>
                  <div style={{ position: 'absolute', top: 4, left: 6, zIndex: 1 }}>
                    <FlagImg country={botP2?.country ?? null} size={14} />
                  </div>
                </div>
                <span style={{
                  flex: 1, minWidth: 0,
                  fontSize: 12,
                  fontWeight: team2Won ? 700 : 500,
                  color: team2Won ? '#fff' : MUTED,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {botName}
                </span>
                {team2Won && (
                  <span style={{
                    width: 14, height: 14, flexShrink: 0,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    background: PAIR2_COLOR, clipPath: CHUNKY.badge,
                    fontSize: 8, fontWeight: 800, color: '#000',
                  }}>
                    W
                  </span>
                )}
                <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                  {setGames.map((sg, i) => (
                    <span key={i} style={{
                      fontSize: 14, fontWeight: 700, fontFamily: 'monospace',
                      color: team2Won ? '#fff' : MUTED,
                      minWidth: 13, textAlign: 'center',
                    }}>
                      {sg.bot}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </Link>
        )
      })}
```

**Notes while implementing this step:**
- Do NOT touch the `{h2hMatches.length === 0 && !h2hLoading && ...}` empty state block that sits above the `.map`.
- Do NOT touch the `{(pair1Recent.length > 0 || pair2Recent.length > 0) && (...)}` block that sits below the `.map` (the "Last 5 Matches" section).
- Do NOT touch the sticky summary header (`Fixed summary header` block).
- All referenced identifiers (`PAIR1_COLOR`, `PAIR2_COLOR`, `MUTED`, `CHUNKY`, `FlagImg`, `pairMatchesIds`, `pairName`, `parseSetScore`, `formatSetScores`, `formatDate`, `p1Ids`) are already defined earlier in the file or the function — no new imports needed.
- `formatSetScores` is no longer called from the new render (each set is mapped individually), but leave its definition alone — it may still be referenced elsewhere or in future changes, and deleting unrelated helpers is out of scope.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep "src/app/match/\[id\]/page.tsx"`
Expected: no output (no new errors originating from this file).

- [ ] **Step 4: Lint**

Run: `npm run lint -- src/app/match/[id]/page.tsx 2>&1 | tail -20`
Expected: either clean or only pre-existing warnings unrelated to the new render (react-hooks/exhaustive-deps on unrelated hooks, etc.). No new errors.

- [ ] **Step 5: Ensure the dev server is running and reload the H2H tab**

Run (in a Claude Preview check, not Bash):
```
preview_list → confirm the Next.js frontend server is running on port 3000
preview_eval with expression:
  window.location.href = '/match/f12fe4b1-93cf-4dbd-907f-a9414504ccdf'
```

Then:
```
preview_eval:
  (async () => {
    await new Promise(r => setTimeout(r, 800));
    const tabs = [...document.querySelectorAll('button, [role="tab"]')].filter(el => el.textContent?.trim() === 'H2H');
    if (tabs[0]) tabs[0].click();
    await new Promise(r => setTimeout(r, 600));
    document.scrollingElement.scrollTop = 900;
    return 'ready';
  })()
```

- [ ] **Step 6: Screenshot and verify**

Call `preview_screenshot`.

Expected visual:
- The "5 / H2H 8 matches / 3" sticky header is unchanged above the list
- Each past meeting is a self-contained card with a left accent bar (orange if Tapia/Coello won, yellow if Galan/Chingotto won)
- A pills row shows tournament + round + date
- Two team rows stack vertically — Tapia/Coello on top (orange theme), Galan/Chingotto on bottom (yellow theme)
- The winning row is bold white with a small colored "W" badge; the losing row is dimmed to ~42% opacity
- Set scores align column-wise between the two team rows (top row shows that team's games, bottom row shows the other team's games)
- No console errors

- [ ] **Step 7: Verify perspective mapping works across matches**

Look at the screenshot. For any row where Galan/Chingotto won (the yellow team in the current match), verify:
- The yellow accent bar is on the left (not orange)
- The `W` badge appears on the BOTTOM row (Galan/Chingotto's row), not the top
- The bottom row is bright white, the top row is dimmed

This confirms `ourPairIsMatch1` swapping works correctly regardless of how the historical match stored the pairs.

- [ ] **Step 8: Verify the "Last 5 Matches" section still renders unchanged**

Scroll further down in the preview:

```
preview_eval:
  document.scrollingElement.scrollTop = document.scrollingElement.scrollHeight; null
```

Screenshot and verify the two-column "Last 5 Matches" per-pair section is visually identical to before — headers colored per team, W/L badges on each entry. No regression there.

- [ ] **Step 9: Commit**

```bash
git add src/app/match/[id]/page.tsx
git commit -m "feat(match): redesign H2H row as two-row scoresheet

Each past meeting now renders as a card with:
- Left accent bar in the winner's team color (orange or yellow)
- Tournament/round/date pills on top
- Two team rows with flag stack, name, W badge, and own set scores
- Winner bold white, loser dimmed to 42% opacity

Current team 1 is always rendered on top regardless of how the
historical match stored its pair1/pair2, using the existing
pairMatchesIds helper to swap orientation. This eliminates the
score-column ambiguity and the whose-perspective-is-W confusion
that the old single-line layout had.

Spec: docs/superpowers/specs/2026-04-08-h2h-row-redesign-design.md"
```

---

## Task 3: Final verification pass

**Rationale:** A single final sanity check after both tasks are in place, to confirm the full H2H tab flow is correct and nothing else on the page broke.

**Files:** No code changes — verification only.

- [ ] **Step 1: Full page reload and walkthrough**

Run via Claude Preview:
```
preview_eval: window.location.reload()
```

Wait a beat, then:
```
preview_eval: document.scrollingElement.scrollTop = 0; null
```

Screenshot the top of the match detail page. Verify the scoreline, tournament banner, momentum chart, stats tabs, etc. all render normally (no regression from the H2H change touching anything it shouldn't).

- [ ] **Step 2: Walk through all four match page tabs**

For each tab, click it, screenshot, and confirm nothing regressed:

```
preview_eval:
  (async () => {
    const labels = ['Score Recap', 'Live Feed', 'Players', 'H2H'];
    const results = [];
    for (const label of labels) {
      const btn = [...document.querySelectorAll('button, [role="tab"]')].find(el => el.textContent?.trim() === label);
      if (btn) { btn.click(); await new Promise(r => setTimeout(r, 400)); results.push(label + ': clicked'); }
      else results.push(label + ': not found');
    }
    return results;
  })()
```

Final screenshot on the H2H tab. Verify the sticky header, the new scoresheet rows, and the "Last 5 Matches" footer are all rendered correctly together.

- [ ] **Step 3: Check console for errors**

```
preview_console_logs with level: 'error', lines: 20
```

Expected: no new errors originating from the match page (pre-existing warnings about unrelated things are OK).

- [ ] **Step 4: Final build sanity check**

Run: `npx tsc --noEmit 2>&1 | wc -l`
Expected: same number of lines (or fewer) than before the change — no new TypeScript errors introduced.

- [ ] **Step 5: Done**

No commit at this step — verification only. If any issue is found, create a follow-up fix commit rather than amending.

---

## Summary

Two surgical edits to a single file:
1. **Task 1** — delete the obsolete column header strip (small cleanup)
2. **Task 2** — replace the `.map` rendering of H2H rows with the new two-row scoresheet card (the main change)
3. **Task 3** — final verification pass across all four match-page tabs

Total: two commits, one file touched, no new imports, no new components, no tests required (pure JSX rendering over existing data and helpers).
