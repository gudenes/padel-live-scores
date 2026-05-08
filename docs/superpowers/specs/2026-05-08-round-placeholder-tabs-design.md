# Round placeholder tabs on tournament detail

**Status:** Design — pending approval
**Author:** Claude (with Gu)
**Date:** 2026-05-08

## Problem

The tournament detail page's "Partidos" view only shows round tabs for rounds
that have `matches` rows in the DB. When a tournament is mid-draw — e.g.
Asuncion P2 on 2026-05-08 with R32/R16/QF complete or in progress but SF/F
not yet drawn — the SF and F tabs are missing entirely. Users have no
indication that those rounds are coming, when they'll happen, or what the
schedule looks like beyond what they can already see.

The dates exist: the FIP overview scrape captures a `schedule_notes`
free-text field that, on every active FIP-tier and Premier tournament,
specifies which rounds happen on which days. We just don't surface that
information anywhere — the field is stored but never read at render time
because nothing parses it into structured per-round dates.

## Goal

Render placeholder tabs for rounds that:
1. Exist in the tournament's published schedule, AND
2. Are scheduled to happen LATER than the most-advanced round currently
   showing match data.

Each placeholder tab carries the same dated subtitle as a real tab, but its
content area is replaced by a banner explaining that the round hasn't been
drawn yet.

## Non-goals

- **Per-gender placeholder dates.** Qualifying rounds in Premier sometimes
  differ for men vs women (Q1 men: Sun, Q1 women: Mon). For V1 we store a
  single date per round (earliest of the two when they differ) — the round
  tab label just gets "Sun 3 May" rather than "Sun 3/Mon 4 May". The actual
  match cards on the day show real `scheduled_at` values, so the asymmetry
  is invisible inside the tab.
- **Placeholders on other surfaces.** Home page tournament cards, ranking
  calendar, etc. stay unchanged. Only `/tournaments/[id]` Partidos view.
- **Backfilling `scheduled_at` on populator-created matches.** Useful but
  separate scope. The populator continues to leave `scheduled_at` null until
  the OOP writer or padelapi sync fills it in.
- **Auto-detecting cancelled rounds.** If a round was scheduled but the
  tournament ended early (weather, withdrawal cascade), we'll still show the
  placeholder tab. Operators can hide it manually if needed.
- **Placeholders for rounds the bracket never reached.** A 16-draw
  tournament has no R32; we simply don't show R32 because nothing in
  `round_schedule` will set that key.

## Visual design

Same tab shape as existing rounds — round name uppercase + dated subtitle.
No special muting or marker. Placement in the round-tab strip respects the
canonical `ROUND_ORDER` (Q1 first, F last).

When a placeholder tab is selected, the match-card list is replaced by the
existing shared [`<EmptyState>`](src/components/EmptyState.tsx) component
with `title` + `subtitle` from new i18n keys:

```tsx
<EmptyState
  title={t('placeholder.headline')}
  subtitle={t('placeholder.body')}
/>
```

`<EmptyState>` already renders the PadelNachos mascot (sleeping tennis ball
next to a chunky racket, asset `/empty-state-padel.png`) at the right size,
inside the chunky polygon card matching the rest of the brand. Reusing it
keeps the placeholder visually consistent with other empty-state surfaces
(matches list with no fixtures, rankings filter no-results, etc.).

- 5-locale i18n keys under `tournament.placeholder.*`:
  - `tournament.placeholder.headline` → "Schedule pending" / "Programación pendiente" / etc.
  - `tournament.placeholder.body` → "This round will be confirmed once the previous round wraps up." / localized.

## Architecture

```
   ┌─────────────────────────────────────────────────────┐
   │  FIP event page HTML                                │
   │  (overview block: "Play Order", schedule notes)     │
   └────────────────────┬────────────────────────────────┘
                        │ parsed by
                        ▼
   ┌─────────────────────────────────────────────────────┐
   │  parseScheduleNotes()  (NEW pure fn)                │
   │  in padelgod/src/parsers/fip-schedule-notes.ts      │
   │                                                     │
   │  Input:  schedule_notes string + starts_at/ends_at  │
   │  Output: { q1?, q2?, ..., sf?, f? : ISO date }      │
   └────────────────────┬────────────────────────────────┘
                        │ called from
                        ▼
   ┌─────────────────────────────────────────────────────┐
   │  parseOverviewFields()  (extend existing)           │
   │  in padelgod/src/parsers/fip-event-page-detail.ts   │
   └────────────────────┬────────────────────────────────┘
                        │ writes
                        ▼
   ┌─────────────────────────────────────────────────────┐
   │  tournaments.round_schedule JSONB  (NEW column)     │
   └────────────────────┬────────────────────────────────┘
                        │ read at render time by
                        ▼
   ┌─────────────────────────────────────────────────────┐
   │  TournamentDetail page                              │
   │  - extends `availableRounds` with placeholder rounds│
   │  - extends `roundDates` with placeholder dates      │
   │  - swaps match-list for banner when round is        │
   │    placeholder                                      │
   └─────────────────────────────────────────────────────┘
```

## Data layer

### Schema change

```sql
-- supabase/migrations/20260508_tournament_round_schedule.sql
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS round_schedule JSONB;

COMMENT ON COLUMN tournaments.round_schedule IS
  'Per-round schedule scraped from the FIP overview. Single ISO date '
  'per round key. Keys: q1, q2, q3, r64, r32, r16, qf, sf, f. Missing '
  'rounds = absent (NOT zero/empty). Earliest date wins when men/women '
  'differ on qualifying rounds. See parseScheduleNotes for format details.';
```

No index — read pattern is "select round_schedule for one tournament", FK
lookups handle that. No defaults — null means "we haven't parsed it yet".

### `round_schedule` shape

```typescript
type RoundKey = 'q1' | 'q2' | 'q3' | 'r64' | 'r32' | 'r16' | 'qf' | 'sf' | 'f'
type RoundSchedule = Partial<Record<RoundKey, string>>  // ISO YYYY-MM-DD
```

Example (Asuncion P2):
```json
{
  "q1":  "2026-05-03",
  "q2":  "2026-05-04",
  "q3":  "2026-05-05",
  "r32": "2026-05-05",
  "r16": "2026-05-07",
  "qf":  "2026-05-08",
  "sf":  "2026-05-09",
  "f":   "2026-05-10"
}
```

Example (FIP Bronze with day-of-week format only): if the source says
`Sunday – SF and Finals MD` and the tournament runs Wed–Sun, the parser
emits `{ sf: "<that-Sunday>", f: "<that-Sunday>" }`. Combined-round phrases
write the same date to multiple keys.

## Parser

`padelgod/src/parsers/fip-schedule-notes.ts` exports a single pure function:

```typescript
export function parseScheduleNotes(
  notes: string,
  startsAt: string,    // ISO YYYY-MM-DD
  endsAt: string,      // ISO YYYY-MM-DD
): RoundSchedule
```

Pure — no DB, no I/O. Tested in isolation with fixtures from each tier.

### Strategies, in order

The parser tries each strategy and merges results, with later strategies
overriding earlier ones on conflict.

**1. Premier structured format**

Regex over `MAIN DRAW\s*:?\s*(SEMI-FINALS|QUARTER-FINALS|FINAL[S]?|ROUND OF 16|...)\s*\n\s*(\d{1,2})\s+(January|February|...)`. Same regex catches qualifying blocks (`QUALIFYING\nQ1 ... <Day> <Date>`).

Year inference: if month maps to a date inside `[startsAt, endsAt]`, use the year from `startsAt`. If the month would imply a year before `startsAt`, use `startsAt.year + 1` (handles December → January wrap).

**2. Day-of-week resolution**

Phrases like `Sunday – SF and Finals MD`, `Saturday: Quarterfinals`, `Friday — 1st round MD`. Day name maps to the actual date inside `[startsAt, endsAt]` matching that weekday.

Multilingual day names (lowercase keys):
- English: monday, tuesday, ..., sunday
- Spanish: lunes, martes, ..., domingo
- Portuguese: segunda, terça, ..., domingo (also "segunda-feira" forms)
- Italian: lunedì, martedì, ..., domenica
- French: lundi, mardi, ..., dimanche

If the tournament range contains the named weekday more than once (rare —
typically tournaments are 5–7 days), pick the FIRST occurrence. If it
contains the named weekday zero times, skip the line.

Combined-round phrases — emit the same date to all matched keys:
- `SF and Finals` / `Semifinals and Finals` → `sf`, `f`
- `QF and SF` / `Quarterfinals and Semifinals` → `qf`, `sf`
- `2nd round and QF` → mapped to `qf` only in V1 (the "2nd round" half is
  ambiguous on draw size — see "Deliberately not mapped" below)

Round-name aliases (Strategy 2 only — Strategy 1 uses unambiguous full names):
- `Quarterfinal(s)`, `QF`, `Quarter Final(s)`, `1/4 Final` → qf
- `Semifinal(s)`, `SF`, `Semi Final(s)`, `1/2 Final` → sf
- `Final(s)`, `F` → f
- `1st Qualy`, `Q1`, `1st round qualification`, `1st round Q` → q1
- `2nd Qualy`, `Q2`, `2nd round qualification`, `2nd round Q` → q2
- `3rd Qualy`, `Q3`, `3rd round qualification`, `3rd round Q` → q3

**Deliberately not mapped in V1:** plain `1st round MD` / `2nd round MD` /
`Round 1` etc. The label conventionally means R32 in a 32-draw and R16 in
a 16-draw, but the parser is pure and doesn't know `draw_size_md`. Mapping
"1st round MD" to r32 unconditionally would produce wrong placeholders on
16-draw tournaments. The placeholder feature mostly cares about SF/F
(which are unambiguously named in every source we've sampled), so dropping
the "Nth round" mapping costs little. Premier tournaments unaffected —
they use Strategy 1's full-name format ("ROUND OF 16", "ROUND OF 32").

**3. Final-date override**

Explicit `Date Finals:\s*(\d{1,2}/\d{1,2}/\d{4})` line, when present, sets
the `f` key authoritatively (overrides whatever steps 1/2 produced). FIP
tournaments sometimes include this even when the day-of-week notes are
ambiguous.

### Edge cases handled

- HTML entities in source (`&nbsp;`, `&#8211;`) — caller (parseOverviewFields)
  already decodes via `decodeHtmlEntities`. Parser receives clean text.
- Missing `schedule_notes`: `parseScheduleNotes(null, ...)` returns `{}`.
- Tournament range straddling year boundary: not observed in current data;
  if it happens, the year-inference logic from Strategy 1 still works.
- Conflicting strategies (Premier-style block AND day-of-week mention same
  round): later strategy wins. In practice these don't co-occur in real
  data — Premier tournaments use only Strategy 1, FIP tiers use Strategies
  2+3.

### Testing

`padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts` — fixture-based.

Fixtures cover one representative `schedule_notes` value per tier:
- Premier P1 (Buenos Aires)
- Premier P2 (Asuncion)
- FIP Platinum (Lusitania — only `Date Finals` line)
- FIP Gold (Ponta Delgada — full day-of-week breakdown)
- FIP Silver (Mediolanum — colon-separated day-of-week)
- FIP Bronze (Oporto — combined `SF and Finals MD`)
- FIP Bronze edge case (Singapore — only `Date Finals` line)
- Multilingual smoke test (a Spanish/Portuguese-style notes block, hand-constructed)

Each test asserts the exact `RoundSchedule` output. Date-only assertions
(no time component) — keeps fixtures stable across timezone moves.

## Writer integration

`padelgod/src/parsers/fip-event-page-detail.ts::parseOverviewFields` gains a
new return field:

```typescript
export interface OverviewFields {
  // ... existing fields
  scheduleNotes: string | null;
  roundSchedule: RoundSchedule;  // NEW — empty {} when no parse
}
```

`padelgod/src/workers/fip-event-page-enricher.ts`:
- Add `round_schedule` to the matches `select` (read existing value) and
  `update` payload.
- Per the codebase pattern, use `writeFromFip('round_schedule', ...)` so
  `filterUpdateByPriority('tournament', 'fip')` rules apply (FIP is the
  primary owner of this field, padelapi never sets it).
- Empty `{}` from parser → don't write (treat same as null — no signal).

## Backfill

One-shot via the existing `/api/admin/backfill-fip-overview` endpoint —
extend it to also write `round_schedule`. The endpoint already:
- iterates active tournaments,
- re-parses the FIP overview HTML (or pulls from cache),
- runs through `filterUpdateByPriority`,
- writes via service-key Supabase client.

Adding `round_schedule` to its update payload is one line.

After the migration ships and the parser is wired into the enricher, run
the backfill once. Going forward the hourly enricher cron keeps it fresh.

## UI rendering

### Tournament detail page changes

`src/app/[locale]/(app)/tournaments/[id]/page.tsx`:

**Read `round_schedule`.** Already selecting `tournaments` columns at
line 227 — add `round_schedule`.

**Extend `availableRounds`.** The existing memo iterates `allMatches` and
collects distinct rounds. After that:

```typescript
const availableRounds = useMemo(() => {
  // Existing: collect rounds with match data
  const seen = new Set<string>()
  for (const m of allMatches) { /* … */ }
  const real = [...seen]

  // NEW: add placeholder rounds from round_schedule.
  // Per scope decision A — only show placeholders for rounds AFTER the
  // most-advanced real round. If there are no real rounds yet (pre-
  // tournament), we show nothing rather than guessing — keeps current
  // behavior on empty tournaments and avoids the 16-draw "1st round MD"
  // ambiguity (the parser might map it to r32 for a tournament that
  // doesn't have an R32).
  if (real.length === 0) return []

  const sched = (activeTournamentObj?.round_schedule ?? {}) as RoundSchedule
  const realMinOrder = Math.min(...real.map(r => ROUND_ORDER[r] ?? 99))
  const placeholderRounds = Object.keys(sched)
    .map(canonicalLabelFromRoundKey)                       // 'sf' → 'Semifinals'
    .filter(r => (ROUND_ORDER[r] ?? 99) < realMinOrder)

  return [...real, ...placeholderRounds]
    .sort((a, b) => (ROUND_ORDER[b] ?? 0) - (ROUND_ORDER[a] ?? 0))
}, [allMatches, activeTournament, genderFilter, /* round_schedule via tournament */])
```

`canonicalLabelFromRoundKey({ qf: 'Quarterfinals', sf: 'Semifinals', f: 'Finals', ... })` is a small helper; mirror existing `ROUND_ORDER` keys.

**Extend `roundDates`.** Inside the same memo (or a sibling), when a round
has no match data but exists in `sched`, format its date for the tab
subtitle:

```typescript
if (!map[round] && sched[roundKey]) {
  map[round] = format.dateTime(new Date(sched[roundKey]), DATE_SHORT)
}
```

**Detect placeholder state.** A simple boolean per round:

```typescript
const isPlaceholderRound = (round: string) =>
  !filteredByRound.length && !!sched[roundKey(round)]
```

When `isPlaceholderRound(selectedRound)` is true, render the banner
component instead of the match list. The matchcard `<MatchesTournamentGroup>`
section is wrapped in a conditional.

### Banner

No new component — render the existing
[`<EmptyState>`](src/components/EmptyState.tsx) directly inside the round
content area when `isPlaceholderRound(selectedRound)` is true:

```tsx
import EmptyState from '@/components/EmptyState'

// inside the round's content area
{isPlaceholder ? (
  <EmptyState
    title={t('placeholder.headline')}
    subtitle={t('placeholder.body')}
  />
) : (
  <MatchesTournamentGroup ... />
)}
```

The shared component handles the chunky polygon clip-path, mascot image,
typography, and dark-mode styling. We don't need to colocate a new wrapper.

### i18n keys

`src/messages/{en,es,pt,it,fr}.json` — add under `tournament.placeholder`:

| Locale | headline | body |
|---|---|---|
| en | Schedule pending | This round will be confirmed once the previous round wraps up. |
| es | Programación pendiente | Esta ronda se confirmará cuando termine la ronda anterior. |
| pt | Programação pendente | Esta ronda será confirmada assim que a ronda anterior terminar. |
| it | Programmazione in attesa | Questo turno sarà confermato al termine del turno precedente. |
| fr | Programmation à confirmer | Ce tour sera confirmé une fois le tour précédent terminé. |

## Rollout

1. Land migration + parser + enricher + tests in one PR. Parser is pure;
   migration is additive (nullable column, no defaults). No behavior change
   yet.
2. Run backfill via `/api/admin/backfill-fip-overview` after deploy. Verify
   spot-checks across tiers.
3. Land the UI changes in a second PR — they only have effect when
   `round_schedule` is populated, so the staged rollout is safe.
4. Visual smoke-test on Asuncion P2 (and 1 FIP Bronze tournament) before
   announcing.

## Risks

- **Parser drift.** FIP page format changes break the parser silently. The
  enricher should log a warning when `parseScheduleNotes` returns `{}` for
  a non-empty `schedule_notes` input. Operators can investigate via the
  ops dashboard's "Integration Health" tab.
- **Day-of-week ambiguity.** If a tournament unexpectedly spans 14 days,
  "Sunday" matches twice. We pick the first; that's almost always the
  qualifying Sunday. Acceptable for V1; revisit if it bites.
- **"Nth round" phrases not mapped.** V1 deliberately skips `1st round MD`
  / `2nd round MD` because they're ambiguous on draw size. Cost: tournaments
  whose `schedule_notes` only describe early rounds via "Nth round" phrases
  get fewer placeholder tabs. In practice this is fine — the placeholder
  feature's main job is showing SF/F, which are unambiguously named in
  every source we've sampled.

## Files touched

| File | Change |
|---|---|
| `supabase/migrations/20260508_tournament_round_schedule.sql` | NEW — adds `round_schedule` column |
| `padelgod/src/parsers/fip-schedule-notes.ts` | NEW — pure parser |
| `padelgod/src/__tests__/parsers/fip-schedule-notes.test.ts` | NEW — fixture tests |
| `padelgod/src/parsers/fip-event-page-detail.ts` | wire `parseScheduleNotes` into `parseOverviewFields` |
| `padelgod/src/workers/fip-event-page-enricher.ts` | add `round_schedule` to read/update |
| `src/app/api/admin/backfill-fip-overview/route.ts` | include `round_schedule` in backfill |
| `src/app/[locale]/(app)/tournaments/[id]/page.tsx` | extend `availableRounds` + `roundDates` + render `<EmptyState>` when placeholder round selected |
| `src/messages/{en,es,pt,it,fr}.json` | add 5-locale `tournament.placeholder.*` keys |
