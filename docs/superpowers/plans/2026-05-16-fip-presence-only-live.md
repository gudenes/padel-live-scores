# FIP-tier "presence-only" live treatment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render FIP-tier matches that are flagged live (but have no point-by-point coverage) with calm, honest UI: amber **ON COURT** without red-LIVE affordances, plus a tappable explainer popover.

**Architecture:** Pure UI change. New `src/lib/tournament-tier.ts` exposes `isPremierTier` + `isPresenceOnlyLive` helpers. New `<PresenceOnlyHint>` component mirrors the existing `LateHintPill` popover pattern. Five surfaces are updated: MatchCard chip, MatchesTournamentGroup pill, match detail hero, Live Feed tab visibility, LiveMatchCard.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, next-intl (5 locales), Vitest, Tailwind 4. PostHog for telemetry.

**Spec:** [docs/superpowers/specs/2026-05-16-fip-presence-only-live-design.md](docs/superpowers/specs/2026-05-16-fip-presence-only-live-design.md)

**Branch:** `feat/fip-presence-only-live` (already created off `main`; spec committed at 466a7473)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/tournament-tier.ts` | Create | `isPremierTier`, `isLiveStatus`, `isPresenceOnlyLive` |
| `src/lib/__tests__/tournament-tier.test.ts` | Create | Unit tests for the three helpers |
| `src/lib/notification-icon.ts` | Modify (lines 33–45) | Replace inline tier check in `circuitIconUrl` with `isPremierTier` |
| `src/components/PresenceOnlyHint.tsx` | Create | New popover component, mirrors LateHintPill pattern |
| `src/messages/en.json` | Modify | Add `match.presenceOnly.*` keys |
| `src/messages/es.json` | Modify | Spanish translations |
| `src/messages/pt.json` | Modify | Portuguese (Brazil) translations |
| `src/messages/it.json` | Modify | Italian translations |
| `src/messages/fr.json` | Modify | French translations |
| `src/components/MatchCard.tsx` | Modify | `statusChip` returns ON COURT for presence-only; render `<PresenceOnlyHint>` adjacent |
| `src/components/MatchesTournamentGroup.tsx` | Modify (lines 123–169) | Demote tournament pill from LIVE → ONGOING for non-Premier-tier |
| `src/app/[locale]/match/[id]/page.tsx` | Modify (lines ~244, 566–567, Live Feed tab gate) | Drop blink dot + LIVE label for presence-only; hide Live Feed tab |
| `src/components/home/LiveMatchCard.tsx` | Modify | Defensive calm treatment if spotlight match is presence-only |

---

## Task 1: Create `tournament-tier.ts` with `isPremierTier` (TDD)

**Files:**
- Create: `src/lib/tournament-tier.ts`
- Test: `src/lib/__tests__/tournament-tier.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/tournament-tier.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isPremierTier } from '../tournament-tier'

describe('isPremierTier', () => {
  it('returns true for P1/P2/Major/Premier_* levels', () => {
    expect(isPremierTier('P1')).toBe(true)
    expect(isPremierTier('P2')).toBe(true)
    expect(isPremierTier('Major')).toBe(true)
    expect(isPremierTier('Premier_Mens')).toBe(true)
    expect(isPremierTier('Premier_Womens')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isPremierTier('p1')).toBe(true)
    expect(isPremierTier('major')).toBe(true)
    expect(isPremierTier('PREMIER_MENS')).toBe(true)
  })

  it('returns false for FIP-tier levels', () => {
    expect(isPremierTier('fip_bronze')).toBe(false)
    expect(isPremierTier('fip_silver')).toBe(false)
    expect(isPremierTier('fip_gold')).toBe(false)
    expect(isPremierTier('FIP_Bronze')).toBe(false)
  })

  it('returns false for null/undefined/empty', () => {
    expect(isPremierTier(null)).toBe(false)
    expect(isPremierTier(undefined)).toBe(false)
    expect(isPremierTier('')).toBe(false)
  })

  it('returns false for unknown levels', () => {
    expect(isPremierTier('apt')).toBe(false)
    expect(isPremierTier('local_league')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/tournament-tier.test.ts`
Expected: FAIL with "Cannot find module '../tournament-tier'"

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/tournament-tier.ts`:

```ts
// Tournament tier classification — the single source of truth for whether
// a tournament belongs to the Premier circuit (P1/P2/Major/Premier_Mens/
// Premier_Womens, where Crionet exposes live point-by-point) or to the
// FIP circuit (Bronze/Silver/Gold, where it does not).
//
// Used by:
//   - notification-icon.ts (picks Premier vs Cupra FIP icon)
//   - PresenceOnlyHint and the surfaces that render it (MatchCard,
//     MatchesTournamentGroup, match detail hero, LiveMatchCard)
//
// Keep this list in sync if a new Premier-tier label ever ships.

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/tournament-tier.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournament-tier.ts src/lib/__tests__/tournament-tier.test.ts
git commit -m "feat(tier): add isPremierTier helper with tests"
```

---

## Task 2: Add `isLiveStatus` and `isPresenceOnlyLive` to `tournament-tier.ts` (TDD)

**Files:**
- Modify: `src/lib/tournament-tier.ts`
- Test: `src/lib/__tests__/tournament-tier.test.ts`

- [ ] **Step 1: Append failing tests**

Append to `src/lib/__tests__/tournament-tier.test.ts`:

```ts
import { isLiveStatus, isPresenceOnlyLive } from '../tournament-tier'

describe('isLiveStatus', () => {
  it('returns true for live and on_court', () => {
    expect(isLiveStatus('live')).toBe(true)
    expect(isLiveStatus('on_court')).toBe(true)
  })

  it('returns false for other statuses', () => {
    expect(isLiveStatus('scheduled')).toBe(false)
    expect(isLiveStatus('finished')).toBe(false)
    expect(isLiveStatus('ended')).toBe(false)
    expect(isLiveStatus('retired')).toBe(false)
    expect(isLiveStatus('walkover')).toBe(false)
    expect(isLiveStatus('')).toBe(false)
  })
})

describe('isPresenceOnlyLive', () => {
  it('returns true when status is live/on_court AND tournament is non-Premier', () => {
    expect(isPresenceOnlyLive(
      { status: 'live' },
      { level: 'fip_bronze' },
    )).toBe(true)
    expect(isPresenceOnlyLive(
      { status: 'on_court' },
      { level: 'fip_gold' },
    )).toBe(true)
  })

  it('returns false when tournament is Premier-tier (PBP is expected soon)', () => {
    expect(isPresenceOnlyLive(
      { status: 'live' },
      { level: 'P1' },
    )).toBe(false)
    expect(isPresenceOnlyLive(
      { status: 'on_court' },
      { level: 'Premier_Mens' },
    )).toBe(false)
  })

  it('returns false when status is not live/on_court', () => {
    expect(isPresenceOnlyLive(
      { status: 'finished' },
      { level: 'fip_bronze' },
    )).toBe(false)
    expect(isPresenceOnlyLive(
      { status: 'scheduled' },
      { level: 'fip_bronze' },
    )).toBe(false)
  })

  it('treats unknown tier (null level) as non-Premier — calmer default', () => {
    expect(isPresenceOnlyLive(
      { status: 'live' },
      { level: null },
    )).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/lib/__tests__/tournament-tier.test.ts`
Expected: existing 5 PASS; ~9 new tests FAIL with "isLiveStatus is not a function" / "isPresenceOnlyLive is not a function"

- [ ] **Step 3: Append implementation**

Append to `src/lib/tournament-tier.ts`:

```ts
// Statuses that the data layer flags as "currently being played". The UI
// historically renders these with red LIVE pulse + amber ON COURT badge —
// see isPresenceOnlyLive for the FIP-tier carve-out.
export function isLiveStatus(status: string): boolean {
  return status === 'live' || status === 'on_court'
}

// True when the match is flagged live in the DB but the integration will
// never deliver point-by-point data. Crionet only exposes per-match score
// endpoints for Premier-tier — FIP-tier matches (Bronze/Silver/Gold) sit
// at the live status until fip-results-writer posts a final, sometimes
// hours after play ends. Treat unknown tiers (null level) as presence-only
// — the calmer default is correct when we don't know better.
export function isPresenceOnlyLive(
  match: { status: string },
  tournament: { level: string | null },
): boolean {
  if (!isLiveStatus(match.status)) return false
  return !isPremierTier(tournament.level)
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `npx vitest run src/lib/__tests__/tournament-tier.test.ts`
Expected: PASS, all tests

- [ ] **Step 5: Commit**

```bash
git add src/lib/tournament-tier.ts src/lib/__tests__/tournament-tier.test.ts
git commit -m "feat(tier): add isLiveStatus and isPresenceOnlyLive helpers"
```

---

## Task 3: Replace inline tier check in `notification-icon.ts` with `isPremierTier`

**Files:**
- Modify: `src/lib/notification-icon.ts:33-45`

- [ ] **Step 1: Look for existing tests of `circuitIconUrl`**

Run: `grep -rln "circuitIconUrl\|notification-icon" src/lib/__tests__/ src/app/api 2>/dev/null`
If tests exist, run them to capture current behavior: `npx vitest run <path>`
Expected: existing tests PASS.

- [ ] **Step 2: Replace inline check**

In `src/lib/notification-icon.ts`, replace the body of `circuitIconUrl` (lines 33–45):

**Before:**
```ts
export function circuitIconUrl(level: string | null): string {
  if (!level) return FIP_ICON_URL
  const normalized = level.toLowerCase()
  if (
    normalized.startsWith('p1') ||
    normalized.startsWith('p2') ||
    normalized.startsWith('major') ||
    normalized.startsWith('premier')
  ) {
    return PREMIER_ICON_URL
  }
  return FIP_ICON_URL
}
```

**After:**
```ts
export function circuitIconUrl(level: string | null): string {
  return isPremierTier(level) ? PREMIER_ICON_URL : FIP_ICON_URL
}
```

Add import at top of file (after existing imports):
```ts
import { isPremierTier } from './tournament-tier'
```

- [ ] **Step 3: Re-run any existing tests**

Run: `npx vitest run <test paths from Step 1, if any>`
Expected: PASS — behavior is identical.

- [ ] **Step 4: Type-check the project**

Run: `npx tsc --noEmit`
Expected: no errors in `notification-icon.ts` or `tournament-tier.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/notification-icon.ts
git commit -m "refactor(notif): use isPremierTier helper in circuitIconUrl"
```

---

## Task 4: Add `match.presenceOnly.*` i18n keys to all 5 locales

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add EN keys**

Find the `"match": { ... }` object in `src/messages/en.json` and add a new `presenceOnly` block alongside the other `match.*` sub-objects (e.g. next to `match.stageChip` or `match.lateHint`):

```json
"presenceOnly": {
  "label": "no point-by-point",
  "label_context": "Small dotted-underline tap target shown next to the ON COURT badge for FIP-tier matches. Indicates that this tournament does not provide live point-by-point coverage. Translation should be a short noun-ish phrase, not a sentence.",
  "popoverTitle": "NO LIVE POINT-BY-POINT",
  "popoverTitle_context": "Uppercase header inside the explainer popover. Should match the spirit of the trigger label but with stronger emphasis (translations can stay in their natural case if uppercase looks unidiomatic — CSS does not force uppercase).",
  "popoverBody": "This tournament doesn't broadcast point-level data. The final score will appear when reported.",
  "popoverBody_context": "Body of the explainer popover. Tells the user why the score isn't ticking and reassures them the result will arrive. Two short sentences.",
  "ariaLabel": "Why there's no live score updates",
  "ariaLabel_context": "Accessibility label on the tappable trigger button. Read by screen readers."
}
```

- [ ] **Step 2: Add ES keys**

In `src/messages/es.json`, in the same location:

```json
"presenceOnly": {
  "label": "sin punto por punto",
  "popoverTitle": "SIN PUNTO POR PUNTO EN VIVO",
  "popoverBody": "Este torneo no transmite datos punto por punto. El resultado final aparecerá cuando se informe.",
  "ariaLabel": "Por qué no hay actualizaciones del marcador en vivo"
}
```

- [ ] **Step 3: Add PT (Brazil) keys**

In `src/messages/pt.json`:

```json
"presenceOnly": {
  "label": "sem ponto a ponto",
  "popoverTitle": "SEM PONTO A PONTO AO VIVO",
  "popoverBody": "Este torneio não transmite dados ponto a ponto. O placar final aparecerá quando for reportado.",
  "ariaLabel": "Por que não há atualizações ao vivo do placar"
}
```

- [ ] **Step 4: Add IT keys**

In `src/messages/it.json`:

```json
"presenceOnly": {
  "label": "senza punto per punto",
  "popoverTitle": "SENZA PUNTO PER PUNTO IN DIRETTA",
  "popoverBody": "Questo torneo non trasmette dati punto per punto. Il punteggio finale apparirà quando verrà comunicato.",
  "ariaLabel": "Perché non ci sono aggiornamenti in diretta del punteggio"
}
```

- [ ] **Step 5: Add FR keys**

In `src/messages/fr.json`:

```json
"presenceOnly": {
  "label": "sans point par point",
  "popoverTitle": "SANS POINT PAR POINT EN DIRECT",
  "popoverBody": "Ce tournoi ne diffuse pas de données point par point. Le score final apparaîtra une fois communiqué.",
  "ariaLabel": "Pourquoi il n'y a pas de mises à jour en direct du score"
}
```

- [ ] **Step 6: Validate JSON syntax for all five files**

Run: `for f in src/messages/{en,es,pt,it,fr}.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" && echo "$f OK"; done`
Expected: five `OK` lines.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (next-intl may surface missing-key errors if the message types are inferred — if so, the keys should now satisfy them.)

- [ ] **Step 8: Commit**

```bash
git add src/messages/{en,es,pt,it,fr}.json
git commit -m "i18n(match): add presenceOnly.* keys in 5 locales"
```

---

## Task 5: Build `<PresenceOnlyHint>` component (row variant)

**Files:**
- Create: `src/components/PresenceOnlyHint.tsx`

Note: This component is structurally a copy of [LateHintPill at MatchCard.tsx:896](src/components/MatchCard.tsx:896). The spec explicitly chose duplication over premature abstraction. The two will share a future primitive only if a third hint surfaces.

- [ ] **Step 1: Create the file**

Create `src/components/PresenceOnlyHint.tsx` with:

```tsx
// PresenceOnlyHint — small dotted-underline trigger that opens a chunky
// info popover explaining why a FIP-tier match shows ON COURT without
// any live point-by-point data ticking. Mirrors the LateHintPill visual
// pattern (clip-path, gradient, accent-tinted inner shadow, 4.5s
// auto-dismiss, Escape-to-close, posthog shown/tapped events).
//
// Two render variants:
//   - 'row'  → compact, sits next to the ON COURT chip on a MatchCard row
//   - 'hero' → slightly larger label, used on the match-detail hero
//
// The trigger is always orange (matches the ON COURT badge color) so
// the user can map "this hint belongs to that badge" visually.

'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import posthog from 'posthog-js'

const ORANGE = '#F5A623'

// Local copies of the chunky-popover primitives — kept inline because
// only this file and MatchCard's LateHintPill currently use them. If a
// third hint surfaces, extract to a shared <ChunkyHintPopover> primitive.
const CHUNKY_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

const POP_KEYFRAMES = `
@keyframes presence-only-hint-pop {
  0%   { opacity: 0; transform: translateY(-4px) scale(0.95); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
`

export interface PresenceOnlyHintProps {
  matchId: string
  variant?: 'row' | 'hero'
}

export default function PresenceOnlyHint({ matchId, variant = 'row' }: PresenceOnlyHintProps) {
  const t = useTranslations('match.presenceOnly')
  const [open, setOpen] = useState(false)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fire 'shown' once per mount
  useEffect(() => {
    posthog.capture('presence_only_live_shown', { matchId, variant })
  }, [matchId, variant])

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setOpen((prev) => !prev)
    if (!open) {
      posthog.capture('presence_only_live_tapped', { matchId, variant })
    }
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    if (!open) {
      dismissTimerRef.current = setTimeout(() => setOpen(false), 4500)
    }
  }

  useEffect(() => () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current) }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const labelFontSize = variant === 'hero' ? 10 : 9
  const popoverRight = variant === 'hero' ? 0 : 12
  const popoverBottom = variant === 'hero' ? -8 : 6

  return (
    <>
      <style>{POP_KEYFRAMES}</style>
      <button
        type="button"
        onClick={handleClick}
        aria-label={t('ariaLabel')}
        aria-expanded={open}
        style={{
          marginTop: 2,
          padding: '4px 0',
          border: 0,
          background: 'transparent',
          color: ORANGE,
          opacity: 0.85,
          fontSize: labelFontSize,
          fontWeight: 600,
          letterSpacing: 0.2,
          cursor: 'pointer',
          borderBottom: `1px dotted ${ORANGE}66`,
          lineHeight: 1.2,
          alignSelf: variant === 'hero' ? 'center' : 'flex-end',
        }}
      >
        {t('label')}
      </button>
      {open && (
        <div
          role="tooltip"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false) }}
          style={{
            position: 'absolute',
            right: popoverRight,
            bottom: popoverBottom,
            zIndex: 4,
            maxWidth: 260,
            padding: '10px 12px 10px 14px',
            background: 'linear-gradient(135deg, #1A1A1D 0%, #131316 100%)',
            clipPath: CHUNKY_BADGE,
            boxShadow: `0 8px 24px rgba(0,0,0,0.5), 0 0 0 0.5px rgba(255,255,255,0.08), inset 0 0 24px ${ORANGE}10`,
            cursor: 'pointer',
            animation: 'presence-only-hint-pop 220ms cubic-bezier(0.34, 1.56, 0.64, 1) both',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
          }}
        >
          <span style={{ flexShrink: 0, marginTop: 1, display: 'inline-flex' }}>
            {/* Info circle: outline + 'i' glyph, no emoji per project convention */}
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke={ORANGE} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8h.01" />
              <path d="M11 12h1v4h1" />
            </svg>
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: 9,
              fontWeight: 800,
              color: ORANGE,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              marginBottom: 3,
              lineHeight: 1.2,
            }}>
              {t('popoverTitle')}
            </div>
            <div style={{
              color: '#D8D8DD',
              fontSize: 11,
              fontWeight: 500,
              lineHeight: 1.4,
            }}>
              {t('popoverBody')}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PresenceOnlyHint.tsx
git commit -m "feat(matches): add PresenceOnlyHint component (row + hero variants)"
```

---

## Task 6: Wire `<PresenceOnlyHint>` into `MatchCard` and use `isPresenceOnlyLive` in `statusChip`

**Files:**
- Modify: `src/components/MatchCard.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/MatchCard.tsx`, add:

```ts
import { isPresenceOnlyLive } from '@/lib/tournament-tier'
import PresenceOnlyHint from '@/components/PresenceOnlyHint'
```

- [ ] **Step 2: Update `statusChip` to accept tournament context and demote presence-only**

Change the signature and body of `statusChip` (currently around [line 104](src/components/MatchCard.tsx:104)):

**Before:**
```ts
function statusChip(match: Match): { label: string; bg: string; color: string } | null {
  const status = match.status as string
  if (status === 'live') return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
  if (status === 'on_court') return { label: 'ON COURT', bg: 'rgba(245,166,35,0.18)', color: '#F5A623' }
  ...
}
```

**After:**
```ts
function statusChip(
  match: Match,
  tournamentLevel: string | null,
): { label: string; bg: string; color: string } | null {
  const status = match.status as string
  const presenceOnly = isPresenceOnlyLive({ status }, { level: tournamentLevel })
  // Presence-only collapses both 'live' and 'on_court' to the calmer
  // amber ON COURT badge — see spec docs/superpowers/specs/2026-05-16-
  // fip-presence-only-live-design.md.
  if (presenceOnly) {
    return { label: 'ON COURT', bg: 'rgba(245,166,35,0.18)', color: '#F5A623' }
  }
  if (status === 'live') return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
  if (status === 'on_court') return { label: 'ON COURT', bg: 'rgba(245,166,35,0.18)', color: '#F5A623' }
  if (status === 'walkover') return { label: 'W/O', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  if (status === 'retired') return { label: 'RETIRED', bg: 'rgba(255,255,255,0.06)', color: MUTED }
  if (['finished', 'ended'].includes(status)) {
    return { label: 'FINISHED', bg: 'rgba(126,211,33,0.16)', color: GREEN }
  }
  if (status === 'scheduled') return null
  return null
}
```

- [ ] **Step 3: Update every call site of `statusChip` to pass tournament level**

Search the file:

Run: `grep -n "statusChip(" src/components/MatchCard.tsx`

For each call, change `statusChip(match)` → `statusChip(match, match.tournament?.level ?? null)`. The `Match` type already carries `tournament` for the join data — verify by reading the surrounding code; if a call site doesn't have access to `tournament.level` directly, thread it through from the closest component prop.

- [ ] **Step 4: Render the hint adjacent to the chip**

Find the JSX block that renders the status chip (look for the `chip.label` / `chip.bg` usage near line 470–540). After the chip's closing tag, conditionally render:

```tsx
{isPresenceOnlyLive({ status: matchProp.status as string }, { level: matchProp.tournament?.level ?? null }) && (
  <PresenceOnlyHint matchId={matchProp.id} variant="row" />
)}
```

Use the same variable name as the surrounding code uses for the match (`matchProp` or `match` — copy the local). The hint sits in the absolutely-positioned wrapper that the chip lives in, so the popover anchors correctly via `position: absolute`.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. If `statusChip` call sites complain about the new required parameter, fix each one.

- [ ] **Step 6: Visual verification — start dev server**

Run: `npm run dev` (in background) and verify a FIP-tier match (e.g. FIP Bronze Egypt III on `/matches/2026-05-16`):
- The match row that was previously red **LIVE** / amber **ON COURT** should now show only amber **ON COURT**
- A small dotted-underline "no point-by-point" appears next to it
- Tapping it opens the chunky popover with the explainer
- Auto-dismisses after 4.5s; tapping the popover dismisses it; pressing Escape dismisses it

Also verify a **Premier-tier** live match is unchanged (red LIVE pulse intact).

- [ ] **Step 7: Commit**

```bash
git add src/components/MatchCard.tsx
git commit -m "feat(matches): calm ON COURT + hint for FIP-tier in MatchCard"
```

---

## Task 7: Demote tournament header pill from red LIVE → amber ONGOING for non-Premier-tier

**Files:**
- Modify: `src/components/MatchesTournamentGroup.tsx:123-169`

- [ ] **Step 1: Add import**

At the top of `src/components/MatchesTournamentGroup.tsx`:

```ts
import { isPremierTier } from '@/lib/tournament-tier'
```

- [ ] **Step 2: Update `tournamentStatusBadge` signature and step 1 of the trust hierarchy**

Change the function signature and the first `if` in `tournamentStatusBadge` (currently around line 123):

**Before:**
```ts
function tournamentStatusBadge(
  groupBucketCounts: { live: number; upcoming: number; finished: number },
  tournamentStatus: string | null,
): { label: string; bg: string; color: string } | null {
  // ... comments ...
  if (groupBucketCounts.live > 0) {
    return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
  }
  // ...
}
```

**After:**
```ts
function tournamentStatusBadge(
  groupBucketCounts: { live: number; upcoming: number; finished: number },
  tournamentStatus: string | null,
  tournamentLevel: string | null,
): { label: string; bg: string; color: string } | null {
  // ... comments ...
  // Step 1 splits by tier: Premier-tier tournaments with a live match get
  // the red LIVE pulse (point-by-point is flowing). Non-Premier tier
  // ("presence-only") gets the amber ONGOING — we know matches are being
  // played but no PBP data lands. Tournaments are tier-uniform so the
  // tournament-level `level` is sufficient — see spec.
  if (groupBucketCounts.live > 0) {
    if (isPremierTier(tournamentLevel)) {
      return { label: 'LIVE', bg: 'rgba(255,70,85,0.18)', color: LIVE_RED }
    }
    return { label: 'ONGOING', bg: 'rgba(245,166,35,0.15)', color: ONGOING_ORANGE }
  }
  // ... rest unchanged ...
}
```

- [ ] **Step 3: Update the call site to pass the tournament level**

Search the file:

Run: `grep -n "tournamentStatusBadge(" src/components/MatchesTournamentGroup.tsx`

Update each call to also pass `group.tournament.level ?? null` (the group already carries the tournament — verify the exact accessor from the surrounding code).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Visual verification**

Reload `/matches/<today>` in the dev server. For a tournament whose only live-bucketed matches are FIP-tier:
- Tournament header pill should now be amber **ONGOING** (was red **LIVE**)

For a tournament with at least one Premier-tier live match:
- Tournament header pill stays red **LIVE**.

- [ ] **Step 6: Commit**

```bash
git add src/components/MatchesTournamentGroup.tsx
git commit -m "feat(matches): demote tournament pill to ONGOING for non-Premier live"
```

---

## Task 8: Drop blink dot + LIVE label on match-detail hero for presence-only

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/app/[locale]/match/[id]/page.tsx`:

```ts
import { isPresenceOnlyLive } from '@/lib/tournament-tier'
import PresenceOnlyHint from '@/components/PresenceOnlyHint'
```

- [ ] **Step 2: Derive a `presenceOnly` flag near the existing `isLive` computation**

Search the file:

Run: `grep -n "isLive\b\|isPremier" src/app/\[locale\]/match/\[id\]/page.tsx`

Near the existing `isLive` computation (around [line 469](src/app/[locale]/match/[id]/page.tsx:469)), add:

```ts
const presenceOnly = match
  ? isPresenceOnlyLive(
      { status: match.status as string },
      { level: (match as any).tournament?.level ?? null },
    )
  : false
```

Match the access pattern already used by the surrounding code (e.g. if `tournament` is accessed elsewhere via a typed local, reuse that local).

- [ ] **Step 3: Replace the blinking dot + LIVE label with the calm pill + hint when presence-only**

Locate the block at [lines 566–567](src/app/[locale]/match/[id]/page.tsx:566):

```tsx
<span style={{ width: 6, height: 6, borderRadius: '50%', background: LIVE_RED, display: 'inline-block', animation: 'blink 1.2s ease-in-out infinite' }} />
<span style={{ fontSize: 11, fontWeight: 800, color: LIVE_RED, letterSpacing: '0.5px' }}>LIVE</span>
```

Wrap the surrounding container so that:
- When `presenceOnly` is true → render an amber **ON COURT** label + `<PresenceOnlyHint matchId={match.id} variant="hero" />`. Drop the blink dot entirely.
- Otherwise → unchanged.

```tsx
{presenceOnly ? (
  <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
    <span style={{
      fontSize: 11,
      fontWeight: 800,
      color: '#F5A623',
      letterSpacing: '0.5px',
      padding: '2px 8px',
      borderRadius: 4,
      background: 'rgba(245,166,35,0.18)',
    }}>ON COURT</span>
    <PresenceOnlyHint matchId={match.id} variant="hero" />
  </span>
) : (
  <>
    <span style={{ width: 6, height: 6, borderRadius: '50%', background: LIVE_RED, display: 'inline-block', animation: 'blink 1.2s ease-in-out infinite' }} />
    <span style={{ fontSize: 11, fontWeight: 800, color: LIVE_RED, letterSpacing: '0.5px' }}>LIVE</span>
  </>
)}
```

Confirm the parent container has `position: relative` so the popover anchors correctly. If not, add it.

- [ ] **Step 4: Skip the live-points digits for presence-only (defensive)**

Around [line 705](src/app/[locale]/match/[id]/page.tsx:705) (and any analogous `isLive && gamePoints` block in this file or in helpers it renders), gate on `!presenceOnly`:

```tsx
{isLive && !presenceOnly && gamePoints && (
  <span style={{ ... }}>{livePointParts[...]}</span>
)}
```

This is defensive — for FIP-tier matches `gamePoints` is always empty — but it locks the contract.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Visual verification**

Open a FIP-tier match detail page in the dev server (find one from the matches/today page that shows ON COURT). Confirm:
- No blinking red dot in the hero
- Amber **ON COURT** label + "no point-by-point" trigger
- Tap the trigger → popover anchored to the hero metadata row, dismisses correctly

Open a Premier-tier live match detail page. Confirm the blink dot + red **LIVE** label still render.

- [ ] **Step 7: Commit**

```bash
git add src/app/\[locale\]/match/\[id\]/page.tsx
git commit -m "feat(match-detail): calm ON COURT hero for FIP-tier presence-only"
```

---

## Task 9: Hide the Live Feed tab on match-detail for presence-only

**Files:**
- Modify: `src/app/[locale]/match/[id]/page.tsx`

The Live Feed tab is the destination behind sub-tab `'live'`. Already today the default selected sub-tab for non-Premier live is `'players'` (see [page.tsx:244–246](src/app/[locale]/match/[id]/page.tsx:244)), but the tab itself is still rendered and clickable, which leads to an empty/useless view.

- [ ] **Step 1: Find the tab list rendering**

Run: `grep -n "subTab\|SubTab\|tab.*live\|'live'.*tab" src/app/\[locale\]/match/\[id\]/page.tsx | head -20`

Locate the array or JSX block that renders the sub-tab buttons (likely a `tabs` array or inline `.map` over `SubTab` literals).

- [ ] **Step 2: Filter out `'live'` when `presenceOnly` is true**

Apply a filter or conditional render. Example pattern:

```ts
const visibleTabs: SubTab[] = (['recap', 'live', 'players', 'h2h'] as const).filter(
  (t) => !(t === 'live' && presenceOnly),
)
```

If the tab list is JSX rather than a derived array, wrap the `'live'` tab in a `{!presenceOnly && (...)}` guard.

Also defensively guard `subTab === 'live'` rendering: if the user lands with `subTab='live'` (e.g. from a URL query) on a presence-only match, fall back to `'players'`:

```ts
useEffect(() => {
  if (presenceOnly && subTab === 'live') setSubTab('players')
}, [presenceOnly, subTab])
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Visual verification**

On the same FIP-tier match detail page:
- The Live Feed tab is no longer present
- The remaining tabs (Players, H2H, etc.) render normally

On a Premier-tier live match detail page:
- The Live Feed tab is still present and selectable.

- [ ] **Step 5: Commit**

```bash
git add src/app/\[locale\]/match/\[id\]/page.tsx
git commit -m "feat(match-detail): hide Live Feed tab for presence-only matches"
```

---

## Task 10: Defensive calm treatment in `LiveMatchCard` (home spotlight)

**Files:**
- Modify: `src/components/home/LiveMatchCard.tsx`

The home spotlight prefers Premier matches, but defensively handle a FIP-tier spotlight if one ever lands.

- [ ] **Step 1: Read the file and locate the LIVE pulse rendering**

Run: `grep -n "LIVE\|live\|LIVE_RED\|isLive" src/components/home/LiveMatchCard.tsx | head -20`

Identify where the red LIVE chip/dot is rendered.

- [ ] **Step 2: Add imports**

```ts
import { isPresenceOnlyLive } from '@/lib/tournament-tier'
import PresenceOnlyHint from '@/components/PresenceOnlyHint'
```

- [ ] **Step 3: Derive `presenceOnly` from match + tournament level**

Near where the match is destructured or where `status` is used, add:

```ts
const presenceOnly = isPresenceOnlyLive(
  { status: match.status as string },
  { level: match.tournament?.level ?? null },
)
```

Match the data access patterns already used in this component.

- [ ] **Step 4: Render calm treatment when `presenceOnly`**

Wrap the red LIVE chip / blink dot:

```tsx
{presenceOnly ? (
  <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
    <span style={{
      fontSize: 11,
      fontWeight: 800,
      color: '#F5A623',
      letterSpacing: '0.5px',
      padding: '2px 8px',
      borderRadius: 4,
      background: 'rgba(245,166,35,0.18)',
    }}>ON COURT</span>
    <PresenceOnlyHint matchId={match.id} variant="row" />
  </span>
) : (
  /* existing red LIVE chip / blink dot JSX */
)}
```

Verify the parent has `position: relative` for the popover to anchor.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Visual verification**

This case is rare in production (spotlight prefers Premier). To force it, find a FIP-tier live match in the DB and temporarily promote it in the spotlight selection logic — OR confirm via code review that the change is structurally correct and rely on the unit-level `isPresenceOnlyLive` tests.

- [ ] **Step 7: Commit**

```bash
git add src/components/home/LiveMatchCard.tsx
git commit -m "feat(home): defensive calm treatment for FIP-tier in LiveMatchCard"
```

---

## Task 11: End-to-end visual verification

**Files:** none (verification only)

- [ ] **Step 1: Lint & full type-check**

Run: `npm run lint && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run all unit tests touched by this change**

Run: `npx vitest run src/lib/__tests__/tournament-tier.test.ts`
Run: `grep -rln "notification-icon\|circuitIconUrl" src/lib/__tests__/ 2>/dev/null | xargs -r npx vitest run`
Expected: all PASS.

- [ ] **Step 3: Walk the user-facing flows in the dev server**

Open `npm run dev` and verify all five surfaces:

1. `/matches/<today>` — matches day page
   - FIP-tier match row: amber **ON COURT** + "no point-by-point" hint, no red pulse
   - FIP-tier tournament header pill: amber **ONGOING**, no red **LIVE**
   - Premier-tier match row: red **LIVE** intact (unchanged)
   - Premier-tier tournament header pill: red **LIVE** intact

2. Match detail (FIP-tier match) — `/match/<id>`
   - Hero: amber **ON COURT** + hero-variant hint, no blink dot
   - No Live Feed tab
   - Other tabs render normally

3. Match detail (Premier-tier live match)
   - Hero: red blink dot + **LIVE** label intact
   - Live Feed tab present

4. Home `/` — LiveMatchCard
   - If spotlight is Premier (likely): red **LIVE** intact
   - If spotlight is FIP (rare): calm treatment renders

5. Hint behavior
   - Tap → popover opens with chunky clip-path, gradient bg, ORANGE inner shadow
   - Auto-dismisses after ~4.5s
   - Tap popover → dismisses
   - Press Escape → dismisses
   - PostHog events fire (`presence_only_live_shown` on mount, `presence_only_live_tapped` on open)

- [ ] **Step 4: Confirm i18n on at least two locales**

Visit `/es/matches/<today>` and `/pt/matches/<today>`. Confirm the hint trigger and popover render in the target language.

- [ ] **Step 5: Capture a screenshot for the PR description**

Use preview tools to capture before/after-style screenshots of:
- A FIP-tier tournament group on the matches day page
- A FIP-tier match detail hero

- [ ] **Step 6: Push and open the PR**

```bash
git push -u origin feat/fip-presence-only-live
gh pr create --title "FIP-tier presence-only live: calm UI, no fake red LIVE" --body "$(cat <<'EOF'
## Summary
- FIP-tier matches that flip to `live`/`on_court` no longer render the red LIVE pulse — those tournaments don't deliver point-by-point and we shouldn't pretend they do
- New `<PresenceOnlyHint>` popover (mirrors `LateHintPill` pattern) explains the absence of live updates with a tappable info trigger
- Tournament header pill demoted from red LIVE → amber ONGOING when all live matches are non-Premier
- Match detail hero drops blink dot + LIVE label for presence-only; Live Feed tab hidden
- Defensive LiveMatchCard treatment for the rare FIP-tier spotlight

Spec: docs/superpowers/specs/2026-05-16-fip-presence-only-live-design.md
Plan: docs/superpowers/plans/2026-05-16-fip-presence-only-live.md

## Test plan
- [ ] FIP-tier match row on /matches/<today> shows amber ON COURT + hint, no red pulse
- [ ] FIP-tier tournament header pill shows amber ONGOING
- [ ] Premier-tier live match row/header still shows red LIVE
- [ ] FIP-tier match detail hero shows calm pill + hint, no blink dot, no Live Feed tab
- [ ] Premier-tier match detail hero shows blink dot + LIVE intact, Live Feed tab present
- [ ] Hint popover opens/closes via tap, auto-dismiss, Escape
- [ ] /es and /pt locales render translated copy

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

- Every spec section maps to a task: detection helper (Tasks 1–2), notification-icon refactor (Task 3), i18n (Task 4), component (Task 5), MatchCard (Task 6), tournament pill (Task 7), match detail hero (Task 8), Live Feed tab (Task 9), LiveMatchCard (Task 10), verification (Task 11).
- Type signatures are consistent: `isPresenceOnlyLive({ status }, { level })` everywhere.
- No placeholders or "TBD" — every step has code or an exact command.
- The `statusChip` and `tournamentStatusBadge` signature changes intentionally propagate to call sites; Steps 3 in Tasks 6 & 7 require the engineer to grep & update each call. This is explicit, not hand-wavy.
- Five locales translated inline in Task 4 — no follow-up translation drafting needed.
