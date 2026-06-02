# Player Current-Tournament Next-Match (Tier-0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a player's pending match in the tournament they're *currently playing* (even when its time isn't set yet) instead of leapfrogging to their next future enrollment.

**Architecture:** Add a pure, highest-priority "Tier-0" selection — a non-finished match (`scheduled`/`live`) in an in-progress tournament — and fold it into the existing `nextScheduled` field on the player page so the existing match-card render and Tier-3 trigger work unchanged. Render gets a "time TBC" label and a graceful opponent fallback. No new DB query, no API/resolver change.

**Tech Stack:** TypeScript, React (Next.js client component), next-intl (5 locales), vitest.

Spec: [docs/superpowers/specs/2026-06-02-player-current-tournament-next-match-design.md](../specs/2026-06-02-player-current-tournament-next-match-design.md)

---

## File Structure

- **Create** `src/lib/current-tournament-match.ts` — pure helper `pickCurrentTournamentMatch`. Generic over a minimal structural shape so it stays decoupled from app types (mirrors the `resolveMatchRoles` pattern in `src/lib/match-roles.ts`).
- **Create** `src/lib/__tests__/current-tournament-match.test.ts` — unit tests for the helper.
- **Modify** `src/app/[locale]/player/[id]/page.tsx` — fold Tier-0 into the `nextScheduled` computation (~lines 529-533); render tweaks for time-TBC + opponent fallback (~lines 798-837).
- **Modify** `src/messages/{en,es,pt,it,fr}.json` — add `player.nextMatchTimeTBC`.

---

## Task 1: Pure helper `pickCurrentTournamentMatch` (TDD)

**Files:**
- Create: `src/lib/current-tournament-match.ts`
- Test: `src/lib/__tests__/current-tournament-match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/current-tournament-match.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pickCurrentTournamentMatch } from '../current-tournament-match'

const NOW = new Date('2026-06-02T13:00:00Z')

// Minimal rows satisfying CurrentMatchCandidate; `id` is carried through so we
// can assert which row was selected.
type Row = {
  id: string
  status: string
  scheduled_at: string | null
  tournament: { starts_at: string | null; ends_at: string | null } | null
}

const inProgressTourn = { starts_at: '2026-05-31T00:00:00Z', ends_at: '2026-06-07T00:00:00Z' }
const futureTourn = { starts_at: '2026-06-08T00:00:00Z', ends_at: '2026-06-14T00:00:00Z' }

describe('pickCurrentTournamentMatch', () => {
  it('selects a scheduled match with null time in an in-progress tournament (Bergamini case)', () => {
    const rows: Row[] = [
      { id: 'r32', status: 'scheduled', scheduled_at: null, tournament: inProgressTourn },
      { id: 'old', status: 'finished', scheduled_at: '2026-05-27T16:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('r32')
  })

  it('returns null when the player only has finished matches in the in-progress tournament (eliminated)', () => {
    const rows: Row[] = [
      { id: 'lost', status: 'finished', scheduled_at: '2026-06-01T16:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)).toBeNull()
  })

  it('does not select a scheduled match in a not-yet-started tournament (left to Tier-1)', () => {
    const rows: Row[] = [
      { id: 'future', status: 'scheduled', scheduled_at: '2026-06-09T16:00:00Z', tournament: futureTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)).toBeNull()
  })

  it('prefers a live match over a scheduled one when both are in progress', () => {
    const rows: Row[] = [
      { id: 'sched', status: 'scheduled', scheduled_at: '2026-06-02T18:00:00Z', tournament: inProgressTourn },
      { id: 'live', status: 'live', scheduled_at: '2026-06-02T12:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('live')
  })

  it('treats a null ends_at as in-progress when started', () => {
    const rows: Row[] = [
      { id: 'noend', status: 'scheduled', scheduled_at: null, tournament: { starts_at: '2026-05-31T00:00:00Z', ends_at: null } },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('noend')
  })

  it('orders scheduled matches by soonest time, null time last', () => {
    const rows: Row[] = [
      { id: 'notime', status: 'scheduled', scheduled_at: null, tournament: inProgressTourn },
      { id: 'soon', status: 'scheduled', scheduled_at: '2026-06-02T15:00:00Z', tournament: inProgressTourn },
      { id: 'later', status: 'scheduled', scheduled_at: '2026-06-02T20:00:00Z', tournament: inProgressTourn },
    ]
    expect(pickCurrentTournamentMatch(rows, NOW)?.id).toBe('soon')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/current-tournament-match.test.ts`
Expected: FAIL — cannot resolve import `'../current-tournament-match'` / `pickCurrentTournamentMatch is not a function`.

- [ ] **Step 3: Write the helper**

Create `src/lib/current-tournament-match.ts`:

```ts
/**
 * pickCurrentTournamentMatch — "Tier-0" selection for the player profile's
 * next-match card. Returns the player's most immediate non-finished match in a
 * tournament that is happening RIGHT NOW (started, not yet ended), even when the
 * match has no scheduled time yet.
 *
 * Rationale: a player still alive in an in-progress event whose next match isn't
 * scheduled would otherwise fall through every tier (Tier-1 needs a future time;
 * Tier-2/3 exclude already-started tournaments) and the card would leapfrog to
 * the player's next FUTURE enrollment. An eliminated player's last match is
 * `finished` (a loss), so this returns null for them and the caller falls
 * through to the future enrollment as before.
 *
 * Pure. Generic over a minimal structural shape so it stays decoupled from the
 * page's MatchRow type (mirrors resolveMatchRoles in match-roles.ts).
 */
export interface CurrentMatchCandidate {
  status: string
  scheduled_at: string | null
  tournament: { starts_at: string | null; ends_at: string | null } | null
}

export function pickCurrentTournamentMatch<M extends CurrentMatchCandidate>(
  matches: M[],
  now: Date,
): M | null {
  const nowMs = now.getTime()

  const inProgress = matches.filter((m) => {
    if (m.status !== 'scheduled' && m.status !== 'live') return false
    const t = m.tournament
    if (!t || !t.starts_at) return false
    if (new Date(t.starts_at).getTime() > nowMs) return false
    if (t.ends_at && new Date(t.ends_at).getTime() <= nowMs) return false
    return true
  })
  if (inProgress.length === 0) return null

  const statusRank = (s: string) => (s === 'live' ? 0 : 1) // live before scheduled
  const timeMs = (s: string | null) => (s ? new Date(s).getTime() : Infinity) // null time last

  return [...inProgress].sort(
    (a, b) =>
      statusRank(a.status) - statusRank(b.status) ||
      timeMs(a.scheduled_at) - timeMs(b.scheduled_at),
  )[0] ?? null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/current-tournament-match.test.ts`
Expected: PASS (6 passing).

- [ ] **Step 5: Commit**

```bash
git add src/lib/current-tournament-match.ts src/lib/__tests__/current-tournament-match.test.ts
git commit -m "feat(player): add pickCurrentTournamentMatch Tier-0 helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Wire Tier-0 into the page's `nextScheduled` computation

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx` (import + ~lines 529-533)

- [ ] **Step 1: Add the import**

Near the other `@/lib` imports (the block around line 18-21 with `resolveMatchRoles`, `levelLabel`, `titleCase`), add:

```ts
import { pickCurrentTournamentMatch } from '@/lib/current-tournament-match'
```

- [ ] **Step 2: Replace the `nextScheduled` computation**

Find (currently ~lines 529-533):

```ts
    // Earliest scheduled match with a known future time
    const now = new Date()
    const nextScheduled = matches
      .filter(m => m.status === 'scheduled' && m.scheduled_at && new Date(m.scheduled_at) > now)
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0] ?? null
```

Replace with:

```ts
    // Tier-0: a pending/live match in the tournament the player is competing in
    // right now (even with no scheduled time yet). Falls back to Tier-1: the
    // earliest future scheduled match with a known time.
    const now = new Date()
    const futureScheduled = matches
      .filter(m => m.status === 'scheduled' && m.scheduled_at && new Date(m.scheduled_at) > now)
      .sort((a, b) => new Date(a.scheduled_at!).getTime() - new Date(b.scheduled_at!).getTime())[0] ?? null
    const nextScheduled = pickCurrentTournamentMatch(matches, now) ?? futureScheduled
```

Note: `nextTournament` (defined just below, gated on `nextScheduled ? null : …`) and the Tier-3 `useEffect` guard (`if (derived.nextScheduled || derived.nextTournament)`) need no change — they already key off `nextScheduled`, which is now populated by Tier-0 when applicable.

- [ ] **Step 3: Verify the build typechecks**

Run: `npm run build`
Expected: build succeeds (no type errors). `pickCurrentTournamentMatch(matches, now)` returns `MatchRow | null`, matching `nextScheduled`'s type.

- [ ] **Step 4: Commit**

```bash
git add "src/app/[locale]/player/[id]/page.tsx"
git commit -m "feat(player): prefer current in-progress tournament match for next-match card

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Render time-TBC label, opponent fallback, and add i18n keys

**Files:**
- Modify: `src/messages/{en,es,pt,it,fr}.json` (add `player.nextMatchTimeTBC`)
- Modify: `src/app/[locale]/player/[id]/page.tsx` (~lines 798-837, the `derived.nextScheduled` render branch)

- [ ] **Step 1: Add the i18n key to all 5 locales**

In each file's `"player"` object, add a `"nextMatchTimeTBC"` key next to `"nextMatch"`:

- `src/messages/en.json`: `"nextMatchTimeTBC": "Time to be confirmed",`
- `src/messages/es.json`: `"nextMatchTimeTBC": "Horario por confirmar",`
- `src/messages/pt.json`: `"nextMatchTimeTBC": "Horário a confirmar",`
- `src/messages/it.json`: `"nextMatchTimeTBC": "Orario da confermare",`
- `src/messages/fr.json`: `"nextMatchTimeTBC": "Horaire à confirmer",`

- [ ] **Step 2: Update the `nextScheduled` render branch**

In `src/app/[locale]/player/[id]/page.tsx`, find the `if (derived.nextScheduled) { … }` block (~lines 798-837). Replace the date/time computation and the two display `<div>`s so that (a) the meta line shows the TBC label when there's no time, and (b) the title falls back gracefully when the opponent is unknown.

Find:

```tsx
              const oppNames = [roles.opp1, roles.opp2]
                .filter(Boolean)
                .map(p => toShortName(p!.display_name?.trim() || p!.name))
                .join(' / ')
              const dateStr = derived.nextScheduled.scheduled_at
                ? format.dateTime(new Date(derived.nextScheduled.scheduled_at), DATE_WITH_WEEKDAY)
                : null
              const timeStr = derived.nextScheduled.scheduled_at
                ? format.dateTime(new Date(derived.nextScheduled.scheduled_at), TIME_24H)
                : null
```

Replace with:

```tsx
              const oppNames = [roles.opp1, roles.opp2]
                .filter(Boolean)
                .map(p => toShortName(p!.display_name?.trim() || p!.name))
                .join(' / ')
              const tournName = derived.nextScheduled.tournament?.name
                ? titleCase(derived.nextScheduled.tournament.name)
                : null
              const roundStr = derived.nextScheduled.round
              // Title: "vs <opponents> · <round>"; when the opponent slot is
              // still TBD, fall back to the round label, then the tournament name.
              const matchTitle = oppNames
                ? `vs ${oppNames}${roundStr ? ` · ${roundStr}` : ''}`
                : (roundStr || tournName || '')
              // When the match has no time yet, show the TBC label instead.
              const whenStr = derived.nextScheduled.scheduled_at
                ? [
                    format.dateTime(new Date(derived.nextScheduled.scheduled_at), DATE_WITH_WEEKDAY),
                    format.dateTime(new Date(derived.nextScheduled.scheduled_at), TIME_24H),
                  ].filter(Boolean).join(' · ')
                : tPlayer('nextMatchTimeTBC')
```

Then find the two inner display `<div>`s:

```tsx
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      vs {oppNames}{derived.nextScheduled.round ? ` · ${derived.nextScheduled.round}` : ''}
                    </div>
                    <div style={{ fontSize: 8, color: MUTED, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[derived.nextScheduled.tournament?.name ? titleCase(derived.nextScheduled.tournament.name) : null, dateStr, timeStr].filter(Boolean).join(' · ')}
                    </div>
```

Replace with:

```tsx
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {matchTitle}
                    </div>
                    <div style={{ fontSize: 8, color: MUTED, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {[tournName, whenStr].filter(Boolean).join(' · ')}
                    </div>
```

Note: `tPlayer` is the player-namespace translator already in scope (used for `tPlayer('nextMatch')` on the adjacent label). Confirm by the existing `{tPlayer('nextMatch')}` usage in the same block — reuse that same `tPlayer`.

- [ ] **Step 3: Verify the build typechecks and messages parse**

Run: `npm run build`
Expected: build succeeds. (A missing/mismatched i18n key would not fail the build, but a JSON syntax error in a messages file would surface during dev/runtime — keep the edits valid JSON.)

- [ ] **Step 4: Verify in the running app**

Per the repo's "test locally" convention, verify the change against a real player who is mid-tournament with an unscheduled next match.

Run the dev server (`npm run dev`, localhost:3002) and load the player whose case motivated this fix:

`http://localhost:3002/es/player/43ac372d-0293-4791-9292-201e985e2ce6`

Expected: the strip now shows the **"PRÓXIMO PARTIDO"** card for **ITALY MAJOR** (R32) with **"Horario por confirmar"** instead of the **"PRÓXIMO TORNEO" Valencia P1** card. Use the preview tools (snapshot/screenshot) to confirm and capture proof.

(Caveat: live data moves — if his R32 has since been scheduled or played, the card will reflect that new reality; the assertion is that an in-progress unscheduled match wins over the future Valencia enrollment.)

- [ ] **Step 5: Commit**

```bash
git add "src/app/[locale]/player/[id]/page.tsx" src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "feat(player): render time-TBC + opponent fallback for current-tournament match

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:**
  - Tier-0 definition (status scheduled/live + in-progress tournament) → Task 1 helper + tests.
  - Ordering (live first, soonest time, null last) → Task 1 Step 3 + ordering tests.
  - Elimination handled implicitly (finished loss ⇒ no candidate) → Task 1 "eliminated" test.
  - Cascade integration via `nextScheduled = currentTournamentMatch ?? futureScheduled` → Task 2.
  - Tier-3 `useEffect` guard / `nextTournament` unchanged → Task 2 Step 2 note.
  - Render: match card + "time TBC" → Task 3 Step 2 (`whenStr`).
  - Opponent fallback → Task 3 Step 2 (`matchTitle`).
  - i18n `player.nextMatchTimeTBC` in 5 locales → Task 3 Step 1.
  - No new DB query / no resolver change → confirmed (only `page.tsx` compute + render touched; `next-enrollment-resolver.ts` untouched).
- **Placeholder scan:** none — every code step shows complete code; no TBD/TODO.
- **Type consistency:** `pickCurrentTournamentMatch` name identical across Task 1/2; `CurrentMatchCandidate` shape (`status`, `scheduled_at`, `tournament.{starts_at,ends_at}`) is satisfied by `MatchRow`; returns `M | null` ⇒ `MatchRow | null` for `nextScheduled`. `tPlayer`, `titleCase`, `format`, `DATE_WITH_WEEKDAY`, `TIME_24H` all already in scope in the render block.
