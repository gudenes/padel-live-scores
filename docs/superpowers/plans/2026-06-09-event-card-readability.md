# Event Card Readability & Full-Height Layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the events-list `BigTournamentCard` text legible over cover images and fill the full card height by switching to a bottom-anchored content stack on a vertical scrim.

**Architecture:** Pure presentation change to a single component (`BigTournamentCard` in `src/components/home/TournamentsView.tsx`). The card becomes a flex column; the cover image (when present) keeps the top, the textual content is pinned to the bottom via `margin-top:auto`, sitting on a bottom-up gradient scrim. No data, API, or schema changes. The same structure serves both cover and no-cover (FIP) variants for visual consistency.

**Tech Stack:** Next.js 16 / React 19, inline-style components, `next-intl` (`useFormatter`, `useTranslations`), existing helpers from `src/components/home/shared.tsx` (`CHUNKY`, `BG_CARD`, `GREEN`, `GREEN_DIM`, `ORANGE`, `LIVE_RED`, `MUTED`, `FlagImg`, `titleCase`, `daysUntil`, `formatDateRange`, `levelLabel`) and `TournamentCoverImage`.

**Note on testing:** This is a pure styling/JSX change with no extractable logic, so there is no meaningful unit test to write — TDD does not apply here. Verification is a typecheck/lint gate plus visual confirmation in the running app across all three states and both cover variants (Task 3). Do not invent snapshot tests for inline-style markup; they would be brittle and low-value.

---

### Task 1: Rewrite `BigTournamentCard` with bottom-anchored layout + vertical scrim

**Files:**
- Modify: `src/components/home/TournamentsView.tsx` — replace the entire `BigTournamentCard` function (currently lines ~1126–1270, the block starting `function BigTournamentCard({` through its closing `}` before the `// ── Ongoing carousel` comment).

**Context — what changes vs. the current implementation:**
- Card container gains `display:flex; flexDirection:column` (keeps `aspectRatio:'360 / 260'`).
- The cover overlay's **horizontal** gradient is replaced by a **top band** + a **bottom-up scrim**.
- The status pill and the upcoming countdown badge become **absolutely positioned** (top-left / top-right) for **both** variants. The old inline monospace countdown (no-cover upcoming) is removed.
- Title/meta/level/CTA move into a single **bottom-anchored stack** (`marginTop:'auto'`).
- Text treatment branches on `hasCover`: solid pill, bolder shadowed title, frosted level chip over images; existing muted styling when no cover.

- [ ] **Step 1: Replace the function**

Replace the whole `BigTournamentCard` function with exactly this:

```tsx
function BigTournamentCard({
  tournament,
  state,
}: {
  tournament: TournamentWithWinners
  state: 'live' | 'ongoing' | 'upcoming'
}) {
  const format = useFormatter()
  const tHome = useTranslations('home')
  const tList = useTranslations('home.tournamentList')
  const isLive = state === 'live'
  const isOngoing = state === 'ongoing'
  const isUpcoming = !isLive && !isOngoing
  const hasCover = Boolean(tournament.cover_image_url)
  const stateColor = isLive ? LIVE_RED : isOngoing ? ORANGE : GREEN
  const stateTint = isLive ? 'rgba(255,70,85,0.15)' : isOngoing ? 'rgba(245,166,35,0.15)' : GREEN_DIM
  const stateGlow = isLive ? 'rgba(255,70,85,0.4)' : isOngoing ? 'rgba(245,166,35,0.4)' : 'rgba(126,211,33,0.4)'

  return (
    <Link href={`/tournaments/${tournament.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div style={{
        margin: '0 16px 12px', padding: 18, position: 'relative', overflow: 'hidden',
        aspectRatio: '360 / 260', display: 'flex', flexDirection: 'column',
        clipPath: CHUNKY.card,
        background: `linear-gradient(135deg, ${isLive ? 'rgba(255,70,85,0.10)' : isOngoing ? 'rgba(245,166,35,0.08)' : 'rgba(126,211,33,0.06)'} 0%, ${BG_CARD} 60%)`,
        border: `1.5px solid ${isLive ? 'rgba(255,70,85,0.25)' : isOngoing ? 'rgba(245,166,35,0.2)' : 'rgba(126,211,33,0.2)'}`,
      }}>
        {/* Cover image + legibility scrims */}
        {tournament.cover_image_url && (
          <>
            <TournamentCoverImage
              src={tournament.cover_image_url}
              alt={tournament.name}
              variant="hero"
              sizes="(max-width: 480px) 100vw, 480px"
            />
            {/* top band keeps the status pill / countdown legible */}
            <div aria-hidden style={{
              position: 'absolute', top: 0, left: 0, right: 0, height: 64, zIndex: 1,
              background: 'linear-gradient(180deg, rgba(8,9,6,0.55) 0%, rgba(8,9,6,0) 100%)',
            }} />
            {/* bottom-up scrim keeps the content block legible */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0, zIndex: 1,
              background: 'linear-gradient(0deg, rgba(8,9,6,0.94) 0%, rgba(8,9,6,0.82) 16%, rgba(8,9,6,0.45) 38%, rgba(8,9,6,0.08) 60%, rgba(8,9,6,0) 78%)',
            }} />
          </>
        )}

        {/* Decorative corner glow */}
        <div aria-hidden style={{
          position: 'absolute', top: -30, right: -30, width: 100, height: 100, zIndex: 2, pointerEvents: 'none',
          background: isLive
            ? 'radial-gradient(circle, rgba(255,70,85,0.08) 0%, transparent 70%)'
            : isOngoing
              ? 'radial-gradient(circle, rgba(245,166,35,0.06) 0%, transparent 70%)'
              : 'radial-gradient(circle, rgba(126,211,33,0.06) 0%, transparent 70%)',
        }} />

        {/* Status pill — top-left */}
        <div style={{
          position: 'absolute', top: 14, left: 14, zIndex: 2,
          display: 'inline-flex', alignItems: 'center', gap: 5,
          clipPath: CHUNKY.badge, padding: '5px 10px', fontSize: 9, fontWeight: 800,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          background: hasCover ? stateColor : stateTint,
          color: hasCover ? '#fff' : stateColor,
          boxShadow: hasCover ? `0 2px 8px ${stateGlow}` : 'none',
        }}>
          {isLive && (
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: hasCover ? '#fff' : LIVE_RED, animation: 'v3-pulse 2s infinite',
            }} />
          )}
          {isLive ? tHome('liveNow') : isOngoing ? tHome('ongoing') : tHome('comingUp')}
        </div>

        {/* Countdown badge — top-right, upcoming only (both variants) */}
        {isUpcoming && (
          <div style={{
            position: 'absolute', top: 12, right: 12, zIndex: 3,
            background: '#BCE83B', color: '#0a0a0a', padding: '5px 10px',
            borderRadius: 8, textAlign: 'center', fontWeight: 800,
          }}>
            <div style={{ fontSize: 18, lineHeight: 1 }}>{daysUntil(tournament.starts_at)}</div>
            <div style={{ fontSize: 8, letterSpacing: '0.08em' }}>{tList('daysLabel')}</div>
          </div>
        )}

        {/* Bottom-anchored content stack */}
        <div style={{ position: 'relative', zIndex: 2, marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <FlagImg country={tournament.country} size={22} />
            <span style={{
              fontSize: 22, fontWeight: 900, color: '#fff', lineHeight: 1.05, letterSpacing: '-0.01em',
              textShadow: hasCover ? '0 2px 12px rgba(0,0,0,0.7)' : 'none',
            }}>
              {titleCase(tournament.name)}
            </span>
          </div>
          <div style={{
            fontSize: 12, fontWeight: 600,
            color: hasCover ? '#e6e8ea' : MUTED,
            textShadow: hasCover ? '0 1px 6px rgba(0,0,0,0.8)' : 'none',
          }}>
            {formatDateRange(format, tournament.starts_at, tournament.ends_at)}
            {tournament.location ? ` · ${tournament.location}` : ''}
          </div>

          {/* Level pill + view CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 13 }}>
            <span style={{
              ...pillStyle,
              background: hasCover ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)',
              color: hasCover ? '#fff' : MUTED,
              backdropFilter: hasCover ? 'blur(4px)' : undefined,
            }}>
              {levelLabel(tournament.level)}
            </span>
            <div style={{ flex: 1 }} />
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '7px 15px', clipPath: CHUNKY.badge,
              background: isLive
                ? (hasCover ? LIVE_RED : 'rgba(255,70,85,0.12)')
                : (hasCover ? '#BCE83B' : GREEN_DIM),
              fontSize: 11, fontWeight: 800,
              color: isLive ? (hasCover ? '#fff' : LIVE_RED) : (hasCover ? '#0a0a0a' : GREEN),
            }}>
              {isLive ? tList('viewMatches') : tList('viewEvent')}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}
```

- [ ] **Step 2: Verify the old inline countdown and standalone top-right countdown blocks are gone**

After the edit, the function must contain exactly **one** countdown block (the `isUpcoming` absolute badge). Run:

```bash
grep -c "daysUntil(tournament.starts_at)" src/components/home/TournamentsView.tsx
```
Expected: `1` (the single consolidated badge inside `BigTournamentCard`). If it returns `2`, an old countdown block was left behind — remove it.

- [ ] **Step 3: Commit**

```bash
git add src/components/home/TournamentsView.tsx
git commit -m "feat(tournaments): bottom-anchored event card for legibility + full height"
```

---

### Task 2: Typecheck and lint gate

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the changed file via the build's TS config**

Run:
```bash
npx tsc --noEmit -p tsconfig.json
```
Expected: no errors referencing `TournamentsView.tsx`. (Pre-existing errors elsewhere, if any, are out of scope — confirm none are in the edited function.)

- [ ] **Step 2: Lint**

Run:
```bash
npm run lint
```
Expected: no new errors/warnings in `src/components/home/TournamentsView.tsx`.

- [ ] **Step 3: If either gate fails, fix inline and amend**

```bash
git add -A && git commit --amend --no-edit
```

---

### Task 3: Visual verification in the running app

**Files:** none (manual verification — this is the real test for a styling change)

- [ ] **Step 1: Start the dev server**

Run (from the worktree root):
```bash
npm run dev
```
Expected: server on `http://localhost:3002`.

- [ ] **Step 2: Open the events list and verify each case**

Navigate to the tournaments/events view (the home/events screen showing "AO VIVO AGORA" / "EM ANDAMENTO" sections). Confirm all of the following:

- [ ] **Cover + live** (e.g. Valencia P1): title is crisp and readable over the photo; the bottom-up scrim makes the bottom band near-solid; the photo is still visible up top; red "Ao Vivo Agora" pill is solid with the pulsing dot; "Ver jogos ›" CTA is solid red with dark/white text per spec.
- [ ] **No cover + ongoing** (e.g. FIP Bronze Lanzarote): no empty bottom half — pill sits top-left, content sits bottom, the card reads as intentionally framed; level chip is the dim variant; CTA is the green-dim variant.
- [ ] **Upcoming** (both a cover and a no-cover upcoming tournament if available): the green countdown badge appears **top-right** in both; no leftover inline monospace countdown.
- [ ] Title + dates + location render on the expected lines (`date · location`), nothing clipped by the card's `overflow:hidden` or `CHUNKY.card` clip-path.

- [ ] **Step 3: Confirm reduced-motion + no regression**

- [ ] The live pulsing dot still animates (it reuses the existing `v3-pulse` keyframe).
- [ ] No console errors in the browser devtools related to the card.

- [ ] **Step 4: Capture a screenshot for the PR (optional but recommended)**

Take a screenshot of a cover card and a no-cover FIP card to attach when finishing the branch.

---

## Self-Review

- **Spec coverage:**
  - Bottom-up scrim replacing horizontal gradient → Task 1, cover block. ✓
  - Top band for pill legibility → Task 1, cover block. ✓
  - Bottom-anchored flex-column content stack (full height) → Task 1, container `display:flex` + stack `marginTop:'auto'`. ✓
  - Solid pill / bolder shadowed title / frosted level chip over images; degrade for no-cover → Task 1, `hasCover` branches. ✓
  - Countdown badge top-right unified across states → Task 1, `isUpcoming` block; old inline countdown removed, verified in Task 1 Step 2. ✓
  - Out-of-scope items (carousel tile, FIP cover sourcing, stats/seeds fills) → untouched. ✓
  - Verification across 3 states × 2 variants → Task 3. ✓
- **Placeholder scan:** none — full component code provided; no TODO/TBD. ✓
- **Type/name consistency:** `hasCover`, `isUpcoming`, `stateColor`, `stateTint`, `stateGlow` defined once and used consistently; `tournament.cover_image_url` narrowed by the JSX `&&` guard before passing to `TournamentCoverImage` (no non-null assertion needed); all imported helpers verified present in the worktree. ✓
```
