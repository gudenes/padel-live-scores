# Prize money normalization — Phase 1: foundation

**Date:** 2026-05-03
**Pillar:** part of "compute per-player career earnings" roadmap
**Phase:** 1 of 3 (Foundation → Computation → Display)

## North star

Compute per-player tournament earnings in EUR for matches since 2024-01-01.
Phase 1 makes the inputs trustworthy. Phases 2 and 3 ride on top.

## Decisions locked in (from brainstorm)

- **Backfill scope:** tournaments with `ends_at >= 2024-01-01`
- **Currency:** store all amounts in EUR, no FX history table. Non-EUR values converted manually at backfill time (handful of WPT USD events).
- **Source priority** (already in `src/lib/source-priority.ts:169`): FIP > manual for `prize_breakdown`. Same for the new prize_money_eur column.

## Today's mess (concrete)

- `tournaments.prize_money` is TEXT with **at least 8 different format conventions** even within EUR: `EUR 25.000`, `25,000€`, `€ 479,068.00`, `EUR 18000`, `9000€`, `€264.534`, `30,000€`, `EUR 0`. European-decimal vs US-decimal is genuinely ambiguous in some.
- `tournaments.prize_money_fip` is INT — supposedly clean EUR, but contaminated: Bronze + Platinum events both show `€40` (entry fee, not prize).
- `prize_breakdown` JSONB exists, well-shaped, but only **148 of 352** completed tournaments have it (42%).
- `matches.round` has **3-4 spellings per round** (`Round of 32` / `R32`, `Quarter` / `Quarterfinals` / `QF`, `Finals` / `Final` / `F`).

Without normalization, computing player earnings requires per-row string parsing in the SQL — fragile and slow.

## Phase 1 deliverables

### 1. Schema additions

```sql
ALTER TABLE tournaments
  ADD COLUMN prize_money_eur INTEGER,
  ADD COLUMN prize_money_eur_source TEXT;
  -- prize_money_eur: total prize pool in EUR (integer cents NOT used — euros only, fractional events truncated)
  -- prize_money_eur_source: 'fip_int' | 'parsed_text' | 'manual' — for transparency

ALTER TABLE matches
  ADD COLUMN round_canonical TEXT;
  -- one of: 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'Q1' | 'Q2' | 'Q3'
  -- nullable: keeps null for rounds we can't classify (e.g. RR group stage, exhibitions)

CREATE INDEX matches_round_canonical_idx ON matches (round_canonical) WHERE round_canonical IS NOT NULL;
```

No constraint on `prize_money_eur >= 0` — explicit `0` is meaningful (tournament had no prize / amateur). NULL = unknown.

### 2. New helpers

**`src/lib/prize-money-parser.ts`** — pure function, fully unit-tested:

```ts
type ParsedPrize = { amount: number; currency: 'EUR' | 'USD' | 'OTHER' } | null

export function parsePrizeMoneyText(input: string | null | undefined): ParsedPrize
```

Handles:
- Currency detection: `EUR`, `USD`, `€`, `$`, prefix or suffix
- European decimal: `25.000` → 25,000 (when no other separators present, and ≤ 6 digits)
- US decimal: `25,000.00` → 25,000
- US thousands: `30,000` → 30,000
- No separator: `9000` → 9000
- `EUR 0` / `0€` → `{ amount: 0, currency: 'EUR' }`
- Whitespace, mixed case, leading/trailing junk

Heuristic for `25.000` ambiguity: if total digits ≤ 6 and no comma anywhere in string AND the trailing `.000` exactly suggests "thousands separator" (vs `.5` decimal), interpret as European thousands. Document the ambiguity explicitly with examples in unit tests.

**`src/lib/round-canonical.ts`** — pure function, fully unit-tested:

```ts
export type RoundCode = 'F' | 'SF' | 'QF' | 'R16' | 'R32' | 'R64' | 'Q1' | 'Q2' | 'Q3'

export function roundCanonical(input: string | null | undefined): RoundCode | null
```

Mapping table (case-insensitive, whitespace-trimmed):
- `Final`, `Finals`, `F` → `F`
- `Semifinal`, `Semifinals`, `SemiFinals`, `SF` → `SF`
- `Quarter`, `Quarterfinals`, `QF` → `QF`
- `Round of 16`, `R16` → `R16`
- `Round of 32`, `R32` → `R32`
- `Round of 64`, `R64` → `R64`
- `Q1`, `Q2`, `Q3` (qualifier rounds) → as-is
- Anything else → null (don't guess)

### 3. Backfill scripts

**`scripts/backfill-prize-money-eur.ts`**

For tournaments with `ends_at >= 2024-01-01`:
1. If `prize_money_fip IS NOT NULL` AND > 100 (filter out the entry-fee `€40` poisoning) → use it. `source = 'fip_int'`.
2. Else if `prize_money` text → parse with `parsePrizeMoneyText`. EUR → store directly. USD → convert at fixed historical rate (will compute with a one-time exchange table embedded in the script, not a runtime FX system). `source = 'parsed_text'`.
3. Else → leave NULL.

Dry-run flag default true. Reports summary: how many filled per source, how many still NULL, list of suspicious values (>500k or <500 outside Bronze).

**`scripts/backfill-round-canonical.ts`**

For all matches: `round_canonical = roundCanonical(round)`. Idempotent. Reports unmapped round labels.

**Maintenance:** add `roundCanonical()` call at all WRITE sites for `matches.round` (sync cron, padelgod workers, draw populator). One small change per writer.

### 4. Expand `prize_breakdown` coverage

Investigate the 204 missing tournaments to bucket them:

- **Bucket A — pre-scraper era** (before fip-event-page-enricher started writing): one-time backfill via the existing `/api/admin/backfill-fip-overview` route, scoped to 2024-2025.
- **Bucket B — no FIP event page** (Premier-only events, exhibitions): document the gap, mark in tournament row (`prize_breakdown = { source: 'unavailable' }`), fall back to using just the total `prize_money_eur` for any winner-take-all calculation in Phase 2.
- **Bucket C — scraper miss** (FIP page exists but enricher couldn't parse it): add diagnostic logging to the enricher, fix the parser, re-run.

Action: small audit script `scripts/audit-prize-breakdown-gaps.ts` that classifies each missing tournament into A/B/C. Then targeted fixes per bucket.

### 5. Ops UI affordance (small)

In existing `src/app/ops/TournamentExplorerTab.tsx`:
- Show `prize_money_eur` alongside the existing prize fields
- Add a "manually set prize" inline editor for tournaments where automated sources failed
- Filter: "Prize money missing" toggle

No new tab. Existing ops dashboard pattern.

## Out of scope (deferred to Phase 2 / 3)

- `player_tournament_earnings` table or any earnings computation
- Player profile UI changes
- Tournament page UI changes (will fold into Phase 3)
- "Top earners" leaderboard
- Walkover / retire prize allocation rules
- Premier matches with R64 (breakdown only goes to R32) — Phase 2 design problem
- Live currency conversion / FX rate table

## Verification plan

- Unit tests for both helpers — at least 25 cases each, including the 8 known text formats and all round-label spellings observed in production
- Backfill scripts run with `--dry-run` first; output reviewed before committing
- After backfill: SQL spot-check 20 random tournaments — does `prize_money_eur` match the actual prize on the FIP / Premier event page?
- After round backfill: SQL `SELECT round, round_canonical, COUNT(*) FROM matches GROUP BY round, round_canonical` — verify all common variants mapped, unmapped count is small and explicable

## Risks

- **The European-decimal ambiguity has no perfect parser.** Some text values genuinely cannot be disambiguated automatically (`EUR 1.500` could be €1,500 or €1.50). Strategy: parser returns null in genuinely-ambiguous cases, backfill script logs them for manual review.
- **`prize_money_fip` poisoning.** The `€40` rows look systematic — likely the FIP scraper picked up entry fees. Filter `> 100` is a quick guard but the right fix is in the scraper itself, deferred to Bucket C investigation in deliverable 4.
- **Scope creep into Phase 2.** Tempting to also build the earnings table now. Resist. Phase 1 lands without it; the contract for Phase 2 is "consume `prize_money_eur` + `prize_breakdown` + `round_canonical` and produce earnings rows."

## Implementation order

1. Schema migration + helpers (PR 1)
2. Backfill scripts + ops UI tweak (PR 2)
3. Bucket A/B/C investigation + targeted fills (PR 3)

Three small PRs, ship in order, each independently mergeable.
