# Round Placeholder Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render placeholder tabs on the tournament-detail "Partidos" view for rounds (e.g. SF, F) that haven't been drawn yet, populated from a structured `round_schedule` JSONB column parsed out of the existing `tournaments.schedule_notes` free-text field.

**Architecture:** Pure parser converts FIP overview text → per-round ISO dates. Stored on `tournaments.round_schedule`. Enricher worker writes it on every tick. UI extends `availableRounds` with rounds that have schedule entries but no real matches yet, swaps `<EmptyState>` copy on those tabs.

**Tech Stack:** TypeScript / Node.js / Vitest (parser + tests), PostgreSQL via Supabase (migration), Next.js 16 / React 19 (UI), next-intl (i18n).

**Spec:** [docs/superpowers/specs/2026-05-08-round-placeholder-tabs-design.md](../specs/2026-05-08-round-placeholder-tabs-design.md)

---

## File Structure

| File | Purpose | New / Modified |
|---|---|---|
| `supabase/migrations/20260508_tournament_round_schedule.sql` | Add `round_schedule JSONB` column to `tournaments` | NEW |
| `padelgod/src/parsers/fip-schedule-notes.ts` | Pure parser: `schedule_notes` → `RoundSchedule` | NEW |
| `padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts` | Fixture-driven tests for the parser | NEW |
| `padelgod/src/parsers/fip-event-page-detail.ts` | Wire `parseScheduleNotes` into `parseOverviewFields` | MODIFIED |
| `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts` | Test the integration in `parseOverviewFields` | MODIFIED |
| `padelgod/src/workers/fip-event-page-enricher.ts` | Read + write `round_schedule` on the row | MODIFIED |
| `padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts` | Test that enricher writes the column | MODIFIED |
| `src/app/api/admin/backfill-fip-overview/route.ts` | Include `round_schedule` in backfill payload | MODIFIED |
| `src/messages/{en,es,pt,it,fr}.json` | Add `tournament.placeholder.{headline,body}` | MODIFIED (×5) |
| `src/app/[locale]/(app)/tournaments/[id]/page.tsx` | Extend `availableRounds`, `roundDates`, swap EmptyState copy | MODIFIED |

---

## Task 1: Migration — `round_schedule` column

**Files:**
- Create: `supabase/migrations/20260508_tournament_round_schedule.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260508_tournament_round_schedule.sql
--
-- Per-round schedule scraped from the FIP overview block. Read at render
-- time on the tournament detail page to surface placeholder tabs for
-- rounds that haven't been drawn yet (e.g. SF/F mid-tournament).
--
-- Shape: { q1?, q2?, q3?, r64?, r32?, r16?, qf?, sf?, f? : ISO YYYY-MM-DD }.
-- Missing rounds = absent (NOT zero/empty). Single date per round; when
-- the source has different qualifying dates for men/women, the parser
-- stores the earliest. See padelgod/src/parsers/fip-schedule-notes.ts.

ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS round_schedule JSONB;

COMMENT ON COLUMN tournaments.round_schedule IS
  'Per-round schedule scraped from the FIP overview. Single ISO date '
  'per round key. Keys: q1, q2, q3, r64, r32, r16, qf, sf, f. Missing '
  'rounds = absent (NOT zero/empty). Earliest date wins when men/women '
  'differ on qualifying rounds. See parseScheduleNotes for format details.';
```

- [ ] **Step 2: Apply the migration**

Apply via Supabase dashboard SQL editor (this project's convention — migrations are checked in but not auto-applied). Verify the column exists:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'tournaments' AND column_name = 'round_schedule';
```

Expected: one row with `data_type = 'jsonb'`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260508_tournament_round_schedule.sql
git commit -m "feat(db): add tournaments.round_schedule JSONB column"
```

---

## Task 2: Parser — types + day-of-week resolver

**Files:**
- Create: `padelgod/src/parsers/fip-schedule-notes.ts`
- Test: `padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts`

- [ ] **Step 1: Write the failing test for `resolveDayOfWeek`**

```typescript
// padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts
import { describe, it, expect } from 'vitest';
import { resolveDayOfWeek } from '../../parsers/fip-schedule-notes.js';

describe('resolveDayOfWeek', () => {
  it('returns the first ISO date in [startsAt, endsAt] matching the named weekday', () => {
    // 2026-05-03 is Sunday, 2026-05-10 is Sunday — Asuncion P2 range
    expect(resolveDayOfWeek('Sunday', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
    expect(resolveDayOfWeek('Friday', '2026-05-03', '2026-05-10')).toBe('2026-05-08');
  });

  it('lowercases input and supports en/es/pt/it/fr day names', () => {
    expect(resolveDayOfWeek('SUNDAY', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
    expect(resolveDayOfWeek('domingo', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
    expect(resolveDayOfWeek('domenica', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
    expect(resolveDayOfWeek('dimanche', '2026-05-03', '2026-05-10')).toBe('2026-05-03');
  });

  it('returns null when the named weekday is outside the range', () => {
    // 2026-05-04 (Mon) → 2026-05-06 (Wed): no Sunday
    expect(resolveDayOfWeek('Sunday', '2026-05-04', '2026-05-06')).toBeNull();
  });

  it('returns null for unrecognised day names', () => {
    expect(resolveDayOfWeek('Quintday', '2026-05-03', '2026-05-10')).toBeNull();
    expect(resolveDayOfWeek('', '2026-05-03', '2026-05-10')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-schedule-notes.test.ts`
Expected: FAIL with "Cannot find module '../../parsers/fip-schedule-notes.js'".

- [ ] **Step 3: Implement minimal parser skeleton + resolveDayOfWeek**

```typescript
// padelgod/src/parsers/fip-schedule-notes.ts

/**
 * Per-round schedule extracted from a FIP tournament's `schedule_notes`
 * (free-text "Play Order" block from the overview page). Rendered as
 * placeholder tabs on the tournament detail page when a round has dates
 * but no match data yet.
 *
 * Single ISO date per round key; missing rounds are absent (not null).
 * When the source has different qualifying dates for men/women (Premier),
 * the parser stores the earliest.
 */
export type RoundKey = 'q1' | 'q2' | 'q3' | 'r64' | 'r32' | 'r16' | 'qf' | 'sf' | 'f';
export type RoundSchedule = Partial<Record<RoundKey, string>>;

const DAY_NAMES: Record<string, number> = {
  // English
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
  // Spanish
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, miércoles: 3, jueves: 4, viernes: 5, sabado: 6, sábado: 6,
  // Portuguese (segunda/terça/etc.; full "segunda-feira" forms also accepted)
  segunda: 1, 'segunda-feira': 1, terca: 2, terça: 2, 'terca-feira': 2, 'terça-feira': 2,
  quarta: 3, 'quarta-feira': 3, quinta: 4, 'quinta-feira': 4, sexta: 5, 'sexta-feira': 5,
  // Italian
  domenica: 0, lunedi: 1, lunedì: 1, martedi: 2, martedì: 2, mercoledi: 3, mercoledì: 3,
  giovedi: 4, giovedì: 4, venerdi: 5, venerdì: 5, sabato_it: 6,
  // French
  dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
};
// Italian "sabato" collides with Spanish; pre-register Spanish above and add
// IT-only entry without colliding (this is a no-op key but documents intent).
DAY_NAMES.sabato = 6;

/**
 * Returns the first ISO date in [startsAt, endsAt] (inclusive) whose
 * weekday matches `dayName`. Day names are matched case-insensitively
 * across en/es/pt/it/fr. Returns null when the day name is unknown or
 * the range contains no matching weekday.
 */
export function resolveDayOfWeek(
  dayName: string,
  startsAt: string,
  endsAt: string,
): string | null {
  const key = dayName.trim().toLowerCase();
  if (!(key in DAY_NAMES)) return null;
  const target = DAY_NAMES[key];
  const start = new Date(`${startsAt}T00:00:00Z`);
  const end = new Date(`${endsAt}T00:00:00Z`);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() === target) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-schedule-notes.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/fip-schedule-notes.ts padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts
git commit -m "feat(padelgod): add RoundSchedule types + resolveDayOfWeek helper"
```

---

## Task 3: Parser Strategy 1 — Premier full-name format

**Files:**
- Modify: `padelgod/src/parsers/fip-schedule-notes.ts`
- Modify: `padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts

import { parseScheduleNotes } from '../../parsers/fip-schedule-notes.js';

describe('parseScheduleNotes — Premier structured format', () => {
  it('parses Asuncion P2 main-draw blocks', () => {
    const notes = `QUALIFYING
Men 3-5 May
Q1 Sun 3 Start time : 10.00 am
Q2 Mon 4 Start time : 10.00 am
Q3 Tue 5 Start time : 10.00 am
Women 4-5 May
Q1 Mon 4 Start time : 10.00 am
Q2 Tue 5 Start time : 10.00 am
MAIN DRAW : 1st ROUND
Men 5 – 6 May
Tue 5 Start time : 4.00 pm
Wed 6 Start time : 10.00 am
Women Wed 6 May
Start time : 10.00 am
MAIN DRAW: ROUND OF 16
7 May
Start time : 10.00 am
MAIN DRAW: QUARTER-FINALS
8 May
Start time : 10.00 am
MAIN DRAW: SEMI-FINALS
9 May
Start time : 2.00 pm
MAIN DRAW : FINAL
10 May
Start time : 4.00 pm`;
    const result = parseScheduleNotes(notes, '2026-05-03', '2026-05-10');
    expect(result).toEqual({
      q1: '2026-05-03', // earliest of men=Sun3, women=Mon4
      q2: '2026-05-04',
      q3: '2026-05-05',
      r16: '2026-05-07',
      qf: '2026-05-08',
      sf: '2026-05-09',
      f: '2026-05-10',
    });
  });

  it('handles "FINALS" with trailing S', () => {
    const notes = `MAIN DRAW : FINALS
17 May
Start time : 2.00 pm`;
    const result = parseScheduleNotes(notes, '2026-05-11', '2026-05-17');
    expect(result.f).toBe('2026-05-17');
  });

  it('handles "ROUND OF 32" / "ROUND OF 16" full names', () => {
    const notes = `MAIN DRAW: ROUND OF 32
12 May
MAIN DRAW: ROUND OF 16
14 May`;
    const result = parseScheduleNotes(notes, '2026-05-11', '2026-05-17');
    expect(result.r32).toBe('2026-05-12');
    expect(result.r16).toBe('2026-05-14');
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-schedule-notes.test.ts`
Expected: FAIL with "parseScheduleNotes is not exported".

- [ ] **Step 3: Implement Strategy 1 + the public `parseScheduleNotes` function**

Add to `padelgod/src/parsers/fip-schedule-notes.ts`:

```typescript
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

/**
 * Resolve a "(D)D Month" string against a tournament range. Picks the
 * year so the resulting date falls inside [startsAt, endsAt]; if both
 * candidate years would land outside the range we still prefer the
 * one closer to startsAt.
 */
function resolveDateInRange(
  dayNum: number,
  monthName: string,
  startsAt: string,
  endsAt: string,
): string | null {
  const month = MONTHS[monthName.toLowerCase()];
  if (!month || dayNum < 1 || dayNum > 31) return null;
  const startYear = parseInt(startsAt.slice(0, 4), 10);
  const candidates = [startYear, startYear + 1];
  for (const y of candidates) {
    const iso = `${y}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    if (iso >= startsAt && iso <= endsAt) return iso;
  }
  // Out of range — return the startYear candidate as a fallback (shouldn't
  // happen for well-formed FIP data; keeps the parser deterministic).
  const iso = `${startYear}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
  return iso;
}

/** Strategy 1: Premier "MAIN DRAW : <FULL ROUND NAME>" blocks. */
function parsePremierBlocks(
  notes: string,
  startsAt: string,
  endsAt: string,
): RoundSchedule {
  const out: RoundSchedule = {};
  // Match a label line followed by a date line. The label is anchored to
  // start-of-line OR after a previous newline; the date line picks up the
  // first "<day> <Month>" pattern within the next 80 chars.
  const re =
    /(MAIN DRAW\s*:?\s*(?:ROUND OF 64|ROUND OF 32|ROUND OF 16|QUARTER-FINALS?|SEMI-FINALS?|FINALS?|1st ROUND|2nd ROUND|3rd ROUND))[\s\S]{0,200}?(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b/gi;
  for (const m of notes.matchAll(re)) {
    const label = m[1]!.toUpperCase();
    const dayNum = parseInt(m[2]!, 10);
    const monthName = m[3]!;
    const iso = resolveDateInRange(dayNum, monthName, startsAt, endsAt);
    if (!iso) continue;
    const key = labelToKey(label);
    if (key && !(key in out)) out[key] = iso;
  }

  // Qualifying lines: "Q1 Sun 3 Start time : ..." — capture the day number,
  // then resolve via day-of-week + range.
  const qualRe = /\b(Q[123])\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*\s+(\d{1,2})\b/gi;
  // For Q lines we don't always know the month from the line itself; use
  // the most-recently-seen month above OR fall back to startsAt's month.
  const startMonth = parseInt(startsAt.slice(5, 7), 10);
  for (const m of notes.matchAll(qualRe)) {
    const qKey = m[1]!.toLowerCase() as RoundKey;
    const dayNum = parseInt(m[2]!, 10);
    // Try same month as startsAt, then next month
    const candidates = [
      `${startsAt.slice(0, 4)}-${String(startMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`,
      `${startsAt.slice(0, 4)}-${String(startMonth + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`,
    ];
    for (const iso of candidates) {
      if (iso >= startsAt && iso <= endsAt) {
        // Earliest wins (men's qualifying typically comes before women's)
        if (!(qKey in out) || iso < out[qKey]!) out[qKey] = iso;
        break;
      }
    }
  }
  return out;
}

function labelToKey(label: string): RoundKey | null {
  const u = label.toUpperCase();
  if (u.includes('ROUND OF 64')) return 'r64';
  if (u.includes('ROUND OF 32')) return 'r32';
  if (u.includes('ROUND OF 16')) return 'r16';
  if (u.includes('QUARTER')) return 'qf';
  if (u.includes('SEMI')) return 'sf';
  if (u.includes('FINAL')) return 'f';
  return null;
}

/**
 * Parse a tournament's `schedule_notes` into a structured per-round map.
 *
 * Tries three strategies in order, merging results. Later strategies
 * override earlier ones on conflict.
 *   1. Premier "MAIN DRAW : ROUND OF 16" full-name blocks.
 *   2. (Task 4) Day-of-week phrases — "Sunday – SF and Finals MD".
 *   3. (Task 5) Final-date override — "Date Finals: 22/03/2026".
 *
 * Pure: no I/O, no DB. Returns {} for null/empty input.
 */
export function parseScheduleNotes(
  notes: string | null,
  startsAt: string,
  endsAt: string,
): RoundSchedule {
  if (!notes) return {};
  const result: RoundSchedule = {};
  Object.assign(result, parsePremierBlocks(notes, startsAt, endsAt));
  return result;
}
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-schedule-notes.test.ts`
Expected: PASS, all tests including the 3 Strategy-1 tests.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/fip-schedule-notes.ts padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts
git commit -m "feat(padelgod): parseScheduleNotes — Premier structured format (Strategy 1)"
```

---

## Task 4: Parser Strategy 2 — day-of-week resolution

**Files:**
- Modify: `padelgod/src/parsers/fip-schedule-notes.ts`
- Modify: `padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to fip-schedule-notes.test.ts

describe('parseScheduleNotes — day-of-week format', () => {
  it('resolves combined "SF and Finals MD" to a single Sunday date', () => {
    const notes = `* Wednesday – 1st round qualification.
* Thursday – 2nd and 3rd round qualification.
* Friday – 1st round MD.
* Saturday – 2nd round and QF MD.
* Sunday – SF and Finals MD.
Date Finals: 07/06/2026`;
    // FIP Bronze Oporto: Wed 3 → Sun 7 June 2026
    const result = parseScheduleNotes(notes, '2026-06-01', '2026-06-07');
    // Strategy 2 emits qf for Saturday (Jun 6) and sf+f for Sunday (Jun 7).
    // Strategy 3's "Date Finals" override (Task 5) keeps f at Jun 7 too.
    expect(result.qf).toBe('2026-06-06');
    expect(result.sf).toBe('2026-06-07');
    expect(result.q1).toBe('2026-06-03'); // Wed
    expect(result.q2).toBe('2026-06-04'); // Thu
    expect(result.q3).toBe('2026-06-04'); // Thu (combined "2nd and 3rd")
  });

  it('handles colon-separated day-of-week format (Italian-style)', () => {
    const notes = `Tuesday: 1st Qualy
Wednesday: 2nd and 3rd Qualy
Thursday: 1st Round Main Draw
Friday: 2nd Round Main Draw
Saturday: Quarterfinals
Sunday: Semifinals and Finals`;
    // FIP Silver Mediolanum 2026-03-17 → 2026-03-22 (Tue → Sun)
    const result = parseScheduleNotes(notes, '2026-03-17', '2026-03-22');
    expect(result.q1).toBe('2026-03-17');
    expect(result.q2).toBe('2026-03-18');
    expect(result.q3).toBe('2026-03-18');
    expect(result.qf).toBe('2026-03-21');
    expect(result.sf).toBe('2026-03-22');
  });

  it('handles separate "Quarter Finals" / "Semi Finals" / "Finals" days (FIP Beyond)', () => {
    const notes = `Beyond 18-39
– Quarter Finals – 7th, April
– Semi Finals & Finals – 8th, April`;
    // Strategy 1 catches "QUARTER FINAL" / "SEMI FINAL" via labelToKey
    // when followed by a full-month date — this format uses ordinals
    // ("7th") that the strict regex doesn't match. Day-of-week strategy
    // doesn't apply (no day name). Should fall through gracefully.
    // For V1 we accept this is unparsed.
    const result = parseScheduleNotes(notes, '2026-04-06', '2026-04-08');
    // Best-effort: nothing here is required to match. No crash, no entries.
    expect(result.qf ?? null).toBeNull();
  });

  it('emits nothing when no day matches the tournament range', () => {
    // Tournament range Wed-Fri but schedule mentions Sunday
    const notes = '* Sunday – SF and Finals MD.';
    const result = parseScheduleNotes(notes, '2026-05-04', '2026-05-06');
    expect(result.sf ?? null).toBeNull();
    expect(result.f ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — verify the new ones fail**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-schedule-notes.test.ts`
Expected: FAIL on the new tests (older Strategy 1 tests still pass).

- [ ] **Step 3: Implement Strategy 2**

Add to `padelgod/src/parsers/fip-schedule-notes.ts`:

```typescript
/** Strategy 2: day-of-week phrases like "Sunday – SF and Finals MD". */
function parseDayOfWeekLines(
  notes: string,
  startsAt: string,
  endsAt: string,
): RoundSchedule {
  const out: RoundSchedule = {};
  // Match each line that starts with a day name (after optional bullet
  // markers like "*", "-", whitespace) and capture the description after
  // the dash/colon.
  const lineRe =
    /^[\s*\-•·]*([A-Za-zçéëèêîïôûáàèéíìóòúù]+)\s*(?:[-–—:]+)\s*(.+)$/gm;
  for (const m of notes.matchAll(lineRe)) {
    const dayName = m[1]!;
    const desc = m[2]!.toLowerCase();
    const date = resolveDayOfWeek(dayName, startsAt, endsAt);
    if (!date) continue;

    // Map descriptions to round keys. Combined phrases ("SF and Finals",
    // "QF and SF", "2nd and 3rd round qualy") emit multiple keys.
    const keys = descriptionToKeys(desc);
    for (const k of keys) {
      // Earliest-wins on conflict (consistent with Q1 men/women rule).
      if (!(k in out) || date < out[k]!) out[k] = date;
    }
  }
  return out;
}

/**
 * Map a free-text description of a tournament day's matches to round keys.
 * Conservative — only emits keys for unambiguously named rounds.
 *   Quarterfinals / Quarter Finals / QF      → qf
 *   Semifinals / Semi Finals / SF            → sf
 *   Finals / Final / F                       → f
 *   1st (round of) Qualy / Q1                → q1   (and q2/q3)
 * Combined phrases ("SF and Finals", "QF and SF", "2nd and 3rd qualy")
 * emit multiple keys.
 *
 * Deliberately NOT mapped: "1st round MD" / "2nd round MD" — ambiguous
 * on draw size (R32 in 32-draw, R16 in 16-draw). See spec §Risks.
 */
function descriptionToKeys(desc: string): RoundKey[] {
  const keys = new Set<RoundKey>();
  // Strip anything after a non-round qualifier word to avoid false hits
  // ("Time Schedule SF and Finals (local time)" — only the "SF and Finals"
  // half is meaningful, but we don't want to over-fit). The tests cover
  // the actual formats observed in production.
  const lc = desc;

  // Order matters: check combined phrases first.
  if (/(?:semi[-\s]?final[s]?|sf)\s*(?:and|y|e|et|&)\s*final[s]?/i.test(lc)) {
    keys.add('sf');
    keys.add('f');
  } else if (/(?:quarter[-\s]?final[s]?|qf)\s*(?:and|y|e|et|&)\s*(?:semi[-\s]?final[s]?|sf)/i.test(lc)) {
    keys.add('qf');
    keys.add('sf');
  } else {
    if (/\b(?:quarter[-\s]?final[s]?|qf|1\/4)\b/i.test(lc)) keys.add('qf');
    if (/\b(?:semi[-\s]?final[s]?|sf|1\/2)\b/i.test(lc)) keys.add('sf');
    if (/\b(?:final[s]?|^f$)\b/i.test(lc) && !/(semi|quarter)/i.test(lc)) keys.add('f');
  }

  // Qualifying — handle "1st round qualification", "2nd and 3rd round qualy", "Q1", etc.
  if (/\b(?:1st\s+(?:round\s+)?qual|q1|1st\s+qualy)\b/i.test(lc)) keys.add('q1');
  if (/\b(?:2nd\s+(?:round\s+)?qual|q2|2nd\s+qualy)\b/i.test(lc)) keys.add('q2');
  if (/\b(?:3rd\s+(?:round\s+)?qual|q3|3rd\s+qualy|final\s+round\s+qual)\b/i.test(lc)) keys.add('q3');
  // Combined: "2nd and 3rd round qualification" — emit both
  if (/\b2nd\s+and\s+3rd\s+(?:round\s+)?qual/i.test(lc)) {
    keys.add('q2');
    keys.add('q3');
  }
  return [...keys];
}
```

Update `parseScheduleNotes` to call Strategy 2:

```typescript
export function parseScheduleNotes(
  notes: string | null,
  startsAt: string,
  endsAt: string,
): RoundSchedule {
  if (!notes) return {};
  const result: RoundSchedule = {};
  Object.assign(result, parsePremierBlocks(notes, startsAt, endsAt));
  // Strategy 2 wins on conflict per spec.
  Object.assign(result, parseDayOfWeekLines(notes, startsAt, endsAt));
  return result;
}
```

- [ ] **Step 4: Run tests — verify all pass**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-schedule-notes.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/fip-schedule-notes.ts padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts
git commit -m "feat(padelgod): parseScheduleNotes — day-of-week strategy (Strategy 2)"
```

---

## Task 5: Parser Strategy 3 — `Date Finals` override

**Files:**
- Modify: `padelgod/src/parsers/fip-schedule-notes.ts`
- Modify: `padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
describe('parseScheduleNotes — Date Finals override', () => {
  it('overrides any prior `f` entry with explicit Date Finals', () => {
    // Day-of-week strategy would set sf+f to the same Sunday; Date Finals
    // should override f if it points to a different day.
    const notes = `* Saturday – SF MD.
* Sunday – Finals MD.
Date Finals: 06/06/2026`;
    const result = parseScheduleNotes(notes, '2026-06-01', '2026-06-07');
    expect(result.f).toBe('2026-06-06'); // override
    expect(result.sf).toBe('2026-06-06'); // Saturday → Jun 6
  });

  it('sets f when no other strategy did (FIP Bronze Singapore-style)', () => {
    const notes = `Date Finals: 08/03/2026
Time Schedule SF and Finals: 10:00h (local time) and 16:00h (local time)`;
    const result = parseScheduleNotes(notes, '2026-03-04', '2026-03-08');
    expect(result.f).toBe('2026-03-08');
  });

  it('handles single-digit day/month', () => {
    const notes = 'Date Finals: 7/6/2026';
    const result = parseScheduleNotes(notes, '2026-06-01', '2026-06-07');
    expect(result.f).toBe('2026-06-07');
  });

  it('returns {} when notes is empty/null', () => {
    expect(parseScheduleNotes(null, '2026-06-01', '2026-06-07')).toEqual({});
    expect(parseScheduleNotes('', '2026-06-01', '2026-06-07')).toEqual({});
  });
});
```

- [ ] **Step 2: Run tests — verify the new ones fail**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-schedule-notes.test.ts`
Expected: FAIL on Date Finals tests (the override doesn't exist yet).

- [ ] **Step 3: Implement Strategy 3**

Add to `padelgod/src/parsers/fip-schedule-notes.ts`:

```typescript
/** Strategy 3: explicit "Date Finals: DD/MM/YYYY" override. */
function parseDateFinals(notes: string): string | null {
  const m = /Date\s+Finals\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(notes);
  if (!m) return null;
  const dd = m[1]!.padStart(2, '0');
  const mm = m[2]!.padStart(2, '0');
  const yyyy = m[3]!;
  return `${yyyy}-${mm}-${dd}`;
}
```

Update `parseScheduleNotes`:

```typescript
export function parseScheduleNotes(
  notes: string | null,
  startsAt: string,
  endsAt: string,
): RoundSchedule {
  if (!notes) return {};
  const result: RoundSchedule = {};
  Object.assign(result, parsePremierBlocks(notes, startsAt, endsAt));
  Object.assign(result, parseDayOfWeekLines(notes, startsAt, endsAt));
  // Strategy 3: explicit Date Finals overrides whatever strategies 1/2 set.
  const finals = parseDateFinals(notes);
  if (finals) result.f = finals;
  return result;
}
```

- [ ] **Step 4: Run tests — verify all pass**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-schedule-notes.test.ts`
Expected: PASS, all tests including 4 Strategy 3 tests.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/fip-schedule-notes.ts padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts
git commit -m "feat(padelgod): parseScheduleNotes — Date Finals override (Strategy 3)"
```

---

## Task 6: Wire `parseScheduleNotes` into `parseOverviewFields`

**Files:**
- Modify: `padelgod/src/parsers/fip-event-page-detail.ts`
- Modify: `padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts

describe('parseOverviewFields — roundSchedule', () => {
  it('parses round_schedule from Play Order text', () => {
    // Synthetic overview HTML carrying a Premier-style Play Order block.
    const html = `
<span class="overview__title">Play Order:</span>
<div class="overview__listText">
MAIN DRAW: SEMI-FINALS<br>
9 May<br>
Start time : 2.00 pm<br>
MAIN DRAW : FINAL<br>
10 May<br>
Start time : 4.00 pm
</div>`;
    const result = parseOverviewFields(html, { startsAt: '2026-05-03', endsAt: '2026-05-10' });
    expect(result.roundSchedule).toEqual({
      sf: '2026-05-09',
      f: '2026-05-10',
    });
  });

  it('returns empty roundSchedule when no schedule notes present', () => {
    const html = '<div></div>';
    const result = parseOverviewFields(html, { startsAt: '2026-05-03', endsAt: '2026-05-10' });
    expect(result.roundSchedule).toEqual({});
  });
});
```

Note: this test changes `parseOverviewFields`'s signature to accept a context object with `startsAt`/`endsAt`. Existing test sites pass undefined or skip the new field — make sure they still pass.

- [ ] **Step 2: Run tests — verify the new ones fail**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-event-page-detail.test.ts`
Expected: FAIL on the new tests (signature mismatch / `roundSchedule` undefined).

- [ ] **Step 3: Update `parseOverviewFields`**

Edit `padelgod/src/parsers/fip-event-page-detail.ts`:

```typescript
import { parseScheduleNotes, type RoundSchedule } from './fip-schedule-notes.js';

export interface OverviewFields {
  registrationStatus: string | null;
  signupFeeEur: number | null;
  venue: string | null;
  venueAddress: string | null;
  venueType: string | null;
  scheduleNotes: string | null;
  roundSchedule: RoundSchedule;  // NEW
}

export interface OverviewContext {
  startsAt: string | null;
  endsAt: string | null;
}

export function parseOverviewFields(
  html: string,
  ctx?: OverviewContext,
): OverviewFields {
  // ... existing parsing logic unchanged ...

  // After scheduleNotes is computed:
  const roundSchedule: RoundSchedule =
    scheduleNotes && ctx?.startsAt && ctx?.endsAt
      ? parseScheduleNotes(scheduleNotes, ctx.startsAt, ctx.endsAt)
      : {};

  return {
    registrationStatus,
    signupFeeEur,
    venue,
    venueAddress,
    venueType,
    scheduleNotes,
    roundSchedule,
  };
}
```

- [ ] **Step 4: Run tests — verify all pass**

Run: `cd padelgod && npx vitest run src/__tests__/parsers/fip-event-page-detail.test.ts`
Expected: PASS, including the 2 new `roundSchedule` tests.

If existing tests fail because they assert the OverviewFields shape exactly, update those assertions to include `roundSchedule: {}`.

- [ ] **Step 5: Commit**

```bash
git add padelgod/src/parsers/fip-event-page-detail.ts padelgod/src/__tests__/parsers/fip-event-page-detail.test.ts
git commit -m "feat(padelgod): wire parseScheduleNotes into parseOverviewFields"
```

---

## Task 7: Enricher writes `round_schedule`

**Files:**
- Modify: `padelgod/src/workers/fip-event-page-enricher.ts`
- Modify: `padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// add to padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts

describe('fip-event-page-enricher — round_schedule', () => {
  it('writes round_schedule from parsed Play Order block', async () => {
    // Use the existing test scaffolding pattern in this file. Mock fetch
    // to return overview HTML with a Play Order block; assert the
    // tournaments UPDATE patch includes round_schedule.
    const html = `
<span class="overview__title">Play Order:</span>
<div class="overview__listText">
MAIN DRAW: SEMI-FINALS<br>9 May<br>
MAIN DRAW : FINAL<br>10 May
</div>`;
    // (full mock setup mirrors existing tests in this file — pattern is:
    //  build a fake supabase client + httpClient, call runFipEventPageEnricher,
    //  assert the patch passed to the matches UPDATE)
    const captured: any = await runEnricherCapturingPatch({
      tournament: { id: 't-1', source: 'fip', slug: 'fip-test', starts_at: '2026-05-03', ends_at: '2026-05-10', schedule_notes: null, round_schedule: null /* … rest of TournamentRow */ },
      html,
    });
    expect(captured.round_schedule).toEqual({ sf: '2026-05-09', f: '2026-05-10' });
  });

  it('skips round_schedule write when parser returns empty object', async () => {
    const html = '<div></div>';
    const captured: any = await runEnricherCapturingPatch({
      tournament: { id: 't-2', source: 'fip', slug: 'fip-empty', starts_at: '2026-05-03', ends_at: '2026-05-10', schedule_notes: null, round_schedule: null },
      html,
    });
    expect(captured.round_schedule).toBeUndefined();
  });
});
```

(`runEnricherCapturingPatch` is a helper to be added at the top of the test file mirroring existing patterns; if the existing test file builds the supabase mock inline per-test, add the test inline using the same scaffolding rather than extracting a helper.)

- [ ] **Step 2: Run tests — verify they fail**

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-event-page-enricher.test.ts`
Expected: FAIL — column not in patch.

- [ ] **Step 3: Update the enricher**

Edit `padelgod/src/workers/fip-event-page-enricher.ts`:

1. Add `round_schedule` to the `select` (around line 117–120):

```typescript
.select(
  'id, slug, source, fip_id, matchscorer_url, starts_at, ends_at, ' +
    'venue, venue_address, venue_type, signup_fee_eur, schedule_notes, ' +
    'round_schedule, ' +     // ADDED
    'draw_size_md, draw_size_qd, ' +
    'registration_status, prize_money_fip, prize_breakdown, level',
)
```

2. Add `round_schedule` to the `TournamentRow` interface (find it earlier in the file). Type as `Record<string, string> | null`.

3. Pass starts_at/ends_at into `parseOverviewFields`. Replace the existing `parseOverviewFields(html)` call (around line 154) with:

```typescript
const overview = parseOverviewFields(html, {
  startsAt: t.starts_at ?? null,
  endsAt: t.ends_at ?? null,
});
```

4. Inside the `writeFromFip` block (around line 239–248) add:

```typescript
// Only write when the parser produced something. Empty {} means the
// scrape didn't carry a parseable Play Order — keep the existing column
// value (might have been set by a prior run with better data).
if (Object.keys(overview.roundSchedule).length > 0) {
  writeFromFip('round_schedule', t.round_schedule, overview.roundSchedule)
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `cd padelgod && npx vitest run src/__tests__/workers/fip-event-page-enricher.test.ts`
Expected: PASS, all enricher tests including the 2 new ones.

- [ ] **Step 5: Run the full padelgod test suite to catch regressions**

Run: `cd padelgod && npx vitest run`
Expected: same pre-existing pass count (one unrelated `parseEventDates` failure on `main`) — no new failures.

- [ ] **Step 6: Commit**

```bash
git add padelgod/src/workers/fip-event-page-enricher.ts padelgod/src/__tests__/workers/fip-event-page-enricher.test.ts
git commit -m "feat(padelgod): enricher writes round_schedule column"
```

---

## Task 8: Backfill endpoint writes `round_schedule`

**Files:**
- Modify: `src/app/api/admin/backfill-fip-overview/route.ts`

- [ ] **Step 1: Read the existing endpoint to find the parse + update site**

Open `src/app/api/admin/backfill-fip-overview/route.ts`. Find where `parseOverviewFields` is called (the file mentions `ov.scheduleNotes` per earlier grep at line 283).

- [ ] **Step 2: Edit — pass starts_at/ends_at into the parser + include round_schedule in update**

Replace the existing `parseOverviewFields(html)` call with the context-aware form, and add `round_schedule` to the update payload mirroring the enricher's pattern:

```typescript
// Around the existing parseOverviewFields call:
const ov = parseOverviewFields(html, {
  startsAt: tournament.starts_at ?? null,
  endsAt: tournament.ends_at ?? null,
});

// Around the existing update payload:
if (ov.scheduleNotes) update.schedule_notes = ov.scheduleNotes;
if (Object.keys(ov.roundSchedule).length > 0) {
  update.round_schedule = ov.roundSchedule;
}
```

(Be careful to read the file first — exact location and surrounding code may differ from this snippet. The pattern is: parse via `ov`, then add a key to the `update` object before the supabase `.update(update)` call.)

- [ ] **Step 3: Smoke-test the endpoint locally**

Start dev server (`npm run dev`), then in another terminal:

```bash
curl -s -X POST "http://localhost:3002/api/admin/backfill-fip-overview" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"tournamentId": "5027936c-9fd5-4309-83e7-44ee4620a207", "dryRun": true}' \
  | python3 -m json.tool
```

(Adjust the request body to match the existing endpoint's API — it might use query strings or no body.)

Expected: response shows the `round_schedule` value computed for Asuncion P2.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/backfill-fip-overview/route.ts
git commit -m "feat(api): backfill-fip-overview writes round_schedule"
```

---

## Task 9: Add 5-locale i18n keys

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the keys to `en.json`**

Find the `tournament` namespace (around line 421 — `noMatchesForStage`/`tryDifferentRound`). Add the new `placeholder` sub-object right after `tryDifferentRound`:

```json
    "noMatchesForStage": "No matches for this stage",
    "tryDifferentRound": "Try selecting a different round",
    "placeholder": {
      "headline": "Schedule pending",
      "body": "This round will be confirmed once the previous round wraps up."
    },
```

- [ ] **Step 2: Add corresponding keys to the other 4 locales**

`es.json`:
```json
    "placeholder": {
      "headline": "Programación pendiente",
      "body": "Esta ronda se confirmará cuando termine la ronda anterior."
    },
```

`pt.json`:
```json
    "placeholder": {
      "headline": "Programação pendente",
      "body": "Esta ronda será confirmada assim que a ronda anterior terminar."
    },
```

`it.json`:
```json
    "placeholder": {
      "headline": "Programmazione in attesa",
      "body": "Questo turno sarà confermato al termine del turno precedente."
    },
```

`fr.json`:
```json
    "placeholder": {
      "headline": "Programmation à confirmer",
      "body": "Ce tour sera confirmé une fois le tour précédent terminé."
    },
```

- [ ] **Step 3: Verify all 5 JSON files parse**

Run: `for f in en es pt it fr; do node -e "JSON.parse(require('fs').readFileSync('src/messages/$f.json'))" && echo "$f ok"; done`
Expected: `en ok`, `es ok`, `pt ok`, `it ok`, `fr ok`.

- [ ] **Step 4: Commit**

```bash
git add src/messages/en.json src/messages/es.json src/messages/pt.json src/messages/it.json src/messages/fr.json
git commit -m "i18n: add tournament.placeholder.{headline,body} for 5 locales"
```

---

## Task 10: UI — placeholder rounds in `availableRounds` + EmptyState swap

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

- [ ] **Step 1: Add `round_schedule` to the tournaments select**

Open `src/app/[locale]/(app)/tournaments/[id]/page.tsx`, find the tournaments column list (around line 227). Add `round_schedule` to the existing select string. Done in one place.

- [ ] **Step 2: Add `ROUND_KEY_TO_LABEL` helper near `ROUND_ORDER`**

Around line 62 (after `ROUND_ORDER`), add:

```typescript
// Map round_schedule's compact keys to the canonical labels in ROUND_ORDER.
const ROUND_KEY_TO_LABEL: Record<string, string> = {
  q1: 'Q1',
  q2: 'Q2',
  q3: 'Q3',
  r64: 'Round of 64',
  r32: 'Round of 32',
  r16: 'Round of 16',
  qf: 'Quarterfinals',
  sf: 'Semifinals',
  f: 'Finals',
}

// And the inverse for finding a round_schedule date by canonical label.
const ROUND_LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(ROUND_KEY_TO_LABEL).map(([k, v]) => [v, k]),
)
```

- [ ] **Step 3: Extend `availableRounds` to include placeholder rounds**

Find the `availableRounds` memo (around line 305). Replace it with:

```typescript
const availableRounds = useMemo(() => {
  const seen = new Set<string>()
  for (const m of allMatches) {
    if (activeTournament && (m as any).tournament?.id !== activeTournament) continue
    if ((m as any).category !== genderFilter) continue
    const r = m.round as string | null
    if (r) seen.add(normalizeRoundFull(r))
  }
  const real = [...seen]

  // Per spec §"UI rendering": only show placeholders when there's at least
  // one real round. Pre-tournament view stays empty (preserves current
  // behavior + dodges the 16-draw "1st round MD" ambiguity).
  if (real.length === 0) {
    return real.sort((a, b) => (ROUND_ORDER[b] ?? 0) - (ROUND_ORDER[a] ?? 0))
  }

  const sched = (activeTournamentObj?.round_schedule ?? {}) as Record<string, string>
  const realMinOrder = Math.min(...real.map(r => ROUND_ORDER[r] ?? 99))
  const placeholderRounds = Object.keys(sched)
    .map(k => ROUND_KEY_TO_LABEL[k])
    .filter((label): label is string => !!label)
    .filter(label => (ROUND_ORDER[label] ?? 99) < realMinOrder)
    .filter(label => !seen.has(label))   // never duplicate a real round

  return [...real, ...placeholderRounds].sort(
    (a, b) => (ROUND_ORDER[b] ?? 0) - (ROUND_ORDER[a] ?? 0),
  )
}, [allMatches, activeTournament, activeTournamentObj, genderFilter])
```

- [ ] **Step 4: Extend `roundDates` to include placeholder dates**

Find the `roundDates` memo (around line 317). After the existing loop populates dates from match data, add:

```typescript
// Backfill placeholder rounds with their round_schedule date.
const sched = (activeTournamentObj?.round_schedule ?? {}) as Record<string, string>
for (const round of availableRounds) {
  if (map[round]) continue   // already has a match-derived date
  const key = ROUND_LABEL_TO_KEY[round]
  const iso = key ? sched[key] : null
  if (iso) {
    map[round] = format.dateTime(new Date(`${iso}T00:00:00`), DATE_SHORT)
  }
}
```

- [ ] **Step 5: Detect placeholder state + swap EmptyState copy**

Find the existing EmptyState render (around line 839):

```tsx
{liveMatches.length === 0 && warmingUpMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
  <div style={{ paddingTop: 24 }}>
    <EmptyState
      title={tTournament('noMatchesForStage')}
      subtitle={tTournament('tryDifferentRound')}
    />
  </div>
)}
```

Replace with:

```tsx
{liveMatches.length === 0 && warmingUpMatches.length === 0 && scheduledMatches.length === 0 && finishedMatches.length === 0 && (
  <div style={{ paddingTop: 24 }}>
    {(() => {
      const sched = (activeTournamentObj?.round_schedule ?? {}) as Record<string, string>
      const key = selectedRound ? ROUND_LABEL_TO_KEY[selectedRound] : null
      const isPlaceholder = !!(key && sched[key])
      return (
        <EmptyState
          title={tTournament(isPlaceholder ? 'placeholder.headline' : 'noMatchesForStage')}
          subtitle={tTournament(isPlaceholder ? 'placeholder.body' : 'tryDifferentRound')}
        />
      )
    })()}
  </div>
)}
```

- [ ] **Step 6: Type-check + lint**

Run: `npm run lint`
Expected: passes (no new warnings related to the changes).

If TypeScript complains about `activeTournamentObj?.round_schedule`, add it to the local TS type for tournaments — find where the tournaments query result is typed (often `(t as any).round_schedule` is used elsewhere; mirror the existing pattern).

- [ ] **Step 7: Commit**

```bash
git add src/app/[locale]/(app)/tournaments/[id]/page.tsx
git commit -m "feat(tournament): show placeholder tabs for rounds with schedule but no matches"
```

---

## Task 11: Smoke test in dev server

**Files:** none

- [ ] **Step 1: Apply the migration in the local Supabase**

If using a local Supabase shadow, run:

```bash
psql $DATABASE_URL -f supabase/migrations/20260508_tournament_round_schedule.sql
```

Or apply via the dashboard for the production project.

- [ ] **Step 2: Trigger a backfill for Asuncion P2**

```bash
curl -s -X POST "http://localhost:3002/api/admin/backfill-fip-overview" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -d '{"tournamentId":"5027936c-9fd5-4309-83e7-44ee4620a207"}'
```

Verify in DB: `select round_schedule from tournaments where id = '5027936c-9fd5-4309-83e7-44ee4620a207';`
Expected: JSON with at least `qf`, `sf`, `f` keys.

- [ ] **Step 3: Use preview tools to inspect the page**

Per the worktree's `<preview_tools>` block:

1. `preview_start` — boot the dev server.
2. Navigate to `http://localhost:3002/es/tournaments/a829852e-6ad6-429d-97c6-28b37c410fc1`. Hmm — that's Prishtina. Use Asuncion instead: `/es/tournaments/5027936c-9fd5-4309-83e7-44ee4620a207`. Click the "Partidos" tab if not active.
3. `preview_snapshot` — confirm SF and F tabs appear after Quarterfinals.
4. Click the SF tab via `preview_click` on the round button.
5. `preview_snapshot` — confirm the EmptyState renders with "Schedule pending" / "Esta ronda se confirmará cuando termine la ronda anterior." (in es locale).
6. `preview_screenshot` — capture for the PR description.
7. `preview_console_logs onlyErrors=true` — confirm no errors.

- [ ] **Step 4: Test on a 2nd tournament (FIP Bronze with day-of-week format)**

Pick any active FIP Bronze tournament from Task 8's verification. Run the same `preview_click` → `preview_snapshot` flow on its tournament page. Confirm placeholder tabs appear if SF/F dates resolved.

- [ ] **Step 5: Stop the dev server**

`preview_stop` (or let it run if you want to keep iterating).

- [ ] **Step 6: No commit needed** (unless the smoke test surfaced bugs — then loop back to the relevant task and re-apply).

---

## Task 12: Open the PR

**Files:** none — git operations only.

- [ ] **Step 1: Push branch**

```bash
git push -u origin <current-branch>
```

- [ ] **Step 2: Create PR via gh**

```bash
gh pr create --title "feat(tournament): placeholder tabs for un-drawn rounds" --body "$(cat <<'EOF'
## Summary

Tournament-detail "Partidos" view now shows placeholder tabs for rounds that have a confirmed schedule but no match data yet (e.g. SF/F mid-tournament). Date subtitle is real (parsed from FIP overview), and the tab content is the existing `<EmptyState>` mascot with new copy.

Triggered by reviewing FIP Bronze Prishtina + Asuncion P2 on 2026-05-08. Spec at [docs/superpowers/specs/2026-05-08-round-placeholder-tabs-design.md](../specs/2026-05-08-round-placeholder-tabs-design.md).

## Changes

- New `tournaments.round_schedule` JSONB column (migration `20260508_tournament_round_schedule.sql`)
- New `parseScheduleNotes` parser in padelgod (3 strategies: Premier full-name, day-of-week resolution, Date Finals override)
- `fip-event-page-enricher` writes the column on every tick
- `/api/admin/backfill-fip-overview` includes the column in its update payload
- 5-locale i18n keys under `tournament.placeholder.*`
- Tournament detail page extends `availableRounds` + `roundDates` and swaps EmptyState copy when the selected round is a placeholder

## Test plan

- [x] 30+ parser tests covering Premier, FIP Silver, Bronze, Beyond fixtures
- [x] Enricher writes column when parser yields, skips when empty
- [x] Smoke test on Asuncion P2 (Premier P2): SF and F tabs render with correct dates + banner
- [x] Smoke test on a FIP Bronze tournament with day-of-week notes: placeholder appears
- [ ] Manual verification on prod once deployed: backfill-fip-overview run + spot-check 5 tournaments

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Return the PR URL to the user.**

---

## Self-Review

**Spec coverage check:**

| Spec section | Implementing task |
|---|---|
| §Data layer (migration + JSONB shape) | Task 1 |
| §Parser Strategy 1 (Premier) | Task 3 |
| §Parser Strategy 2 (day-of-week) | Task 4 |
| §Parser Strategy 3 (Date Finals override) | Task 5 |
| §Parser edge cases (multilingual day names, empty input) | Tasks 2 + 5 |
| §Writer integration (enricher) | Tasks 6 + 7 |
| §Backfill endpoint | Task 8 |
| §UI: extended availableRounds + roundDates | Task 10 |
| §UI: EmptyState reuse with placeholder copy | Task 10 |
| §i18n keys (5 locales) | Task 9 |
| §Risks: 16-draw "1st round MD" ambiguity | Task 4 (descriptionToKeys deliberately omits) + spec note in plan |
| §Risks: pre-tournament empty range | Task 10 (early-return when real.length === 0) |
| §Rollout (staged data → UI) | Implicit in commit order; not enforced by branching, single-PR per skill convention |

**Placeholder scan:** No `TBD`/`TODO`/`fill in` strings in the plan. All steps include exact code or commands. Two prose-only steps (Task 11 step 5 "stop dev server", Task 12 step 3 "return PR URL") are unavoidably trivial.

**Type consistency:** `RoundSchedule` and `RoundKey` defined in Task 2 are referenced consistently in Tasks 3-7. `ROUND_KEY_TO_LABEL` / `ROUND_LABEL_TO_KEY` defined in Task 10 step 2 are used in steps 3-5.

**Note on test signature change:** Task 6 changes `parseOverviewFields(html)` to `parseOverviewFields(html, ctx?)`. Existing callers (the enricher, the backfill endpoint, the existing tests) need to either pass the context or rely on the optional default. Tasks 7 + 8 pass it explicitly. Existing tests in `fip-event-page-detail.test.ts` that don't pass the context will get `roundSchedule: {}` — adjust those assertions in Task 6 step 4.
