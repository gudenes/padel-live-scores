# Pair-aware player resolver for `fip-draw-populator`

**Date:** 2026-05-12
**Status:** Draft — pending user review
**Owner:** padelgod / fip-draw-populator
**Related:** PR [#313](https://github.com/gudenes/padel-live-scores/pull/313) (Pattern 3 short-form, the safe fallback this design replaces as the primary mechanism)

## Problem

`fip-draw-populator` resolves each of a match's four player slots independently against an entry-list `name → fip_id` map plus heuristic short-form patterns. When OOP delivers shorthand like `"J. Ruiz / G. Rubio"` and two players in the entry list share a surname (`Javier Ruiz Gonzalez` and `Jorge Nieto Ruiz`), the resolver picks one by ranking-bias or short-form coincidence — silently — and writes the wrong FK into `public.matches`.

This caused the BA P1 2026-05-12 R64 MD042 bug: world #10 Jorge Nieto Ruiz was paired with Gonzalo Rubio in our DB even though Rubio's entry-list partner is #41 Javier Ruiz Gonzalez. PR #313 added a Spanish paternal-surname short-form (Pattern 3) that turned this specific collision into an ambiguous-→-null fallback. Safer than wrong-linking, but still loses information we already have.

We have two structural signals the resolver ignores:

1. **Entry-list partner pairs.** Every row in `padelgod.entry_list_snapshots` carries `partner_fip_id` and `partner_name`. When one slot of a match resolves unambiguously, the other slot's identity is determined — not guessed — by the entry-list pairing.
2. **Bracket long-form names per `match_widget_id`.** `draw_snapshots` rows tagged `source='fip_event_page'` already carry long-form names like `"Javier Ruiz Gonzalez"` even when the row is bye-skipped from the populator's main loop. The bracket already told us the answer; the resolver never reads it.

This design adds both signals as resolution tiers, with a sanity-check pass that detects mis-pairings and a consistency gate that handles late wildcards safely.

## Decisions (Q&A summary)

| Question | Decision |
|---|---|
| **Scope of fix** | Pair-anchor sweep + bracket long-form overlay (rejected: anchor-only minimal fix; rejected: full constraint-satisfaction rework) |
| **Mis-pair sanity policy** | Unresolve the lower-confidence slot, keep the higher-confidence anchor (rejected: log-only, rejected: unresolve both) |
| **Late wildcard handling** | Consistency-gated partner-anchor + `suspected_late_swap` telemetry when initials match but surname diverges (rejected: silent consistency-gate only, rejected: invalidate entry-list pair on any disagreement) |
| **Bracket overlay scope** | Per-match, slot-level overlay (rejected: per-tournament name-pool augmentation, rejected: both) |

## Components & data flow

Two new pure-function helpers inside `padelgod/src/workers/fip-draw-populator.ts`.

### `buildPairIndex(supabase, tournamentId): Promise<PairIndex>`

Replaces (or wraps) the existing `loadEntryListNameMap`. Reads the latest `entry_list_snapshots` per `(tournament, category)` and returns:

```ts
type PairIndex = {
  // Existing flat map — keeps Pattern 1/2/3 working unchanged.
  nameToFipId: Map<string /* normalized long-form */, string /* fip_id */>;

  // NEW: every player's entry-list partnership.
  fipIdToPartner: Map<string /* fip_id */, {
    partnerFipId: string | null;        // null when entry list has partner_name but not partner_fip_id
    partnerNormName: string;             // normalized long-form of the partner's name
  }>;
};
```

Dedupe rule: latest `captured_at` per `(tournament_id, fip_id, category)`. Falls back to `partner_name` for `partnerNormName` when only the name is populated.

### `buildBracketOverlay(supabase, tournamentId): Promise<BracketOverlay>`

Reads `draw_snapshots` rows where `source='fip_event_page'` (same predicate as `loadLatestFipDrawRows`) but **without** any bye-skip. Walkover rows with one side null still contribute the populated side's long-form names. Returns:

```ts
type BracketOverlay = Map<string /* match_widget_id */, {
  team1_player1_name: string | null;
  team1_player2_name: string | null;
  team2_player1_name: string | null;
  team2_player2_name: string | null;
  team1_fip_id: string | null;
  team2_fip_id: string | null;
}>;
```

Dedupe rule: latest `captured_at` per `(tournament_id, match_widget_id)`.

### Wiring

`runFipDrawPopulator` builds both indexes once per tournament alongside the existing `fipIdToPlayerId` load. The main loop passes `bracketOverlay.get(d.match_widget_id) ?? null` and the full `pairIndex` to `resolveFourPlayers`. Both new parameters are optional — existing tests using the old signature with `nameToFipId` + `shortFormToFipId` continue to compile and pass.

### What this design does NOT change

- The bye-skip in the populator's main loop stays. Walkover bracket rows with one side null still don't insert matches; they only contribute name hints via the overlay.
- The OOP-merge boundary stays — OOP rows still cover rounds the bracket doesn't.
- The UPDATE-vs-INSERT branch stays NULL-only — fixes don't auto-overwrite existing FKs.
- Pattern 1/2/3 from PR #313 stay as the lowest tier of resolution.

## Resolution algorithm

### Confidence tiers (descending priority)

| Tier | Source | Example |
|---|---|---|
| `exact_long` | Exact long-form hit in `pairIndex.nameToFipId` | OOP/bracket sends `"Gonzalo Rubio"` |
| `bracket_overlay` | Exactly one of the 4 bracket long-form names for this `match_widget_id` is consistent with the OOP shorthand (same initial + surname-token overlap), and that bracket name resolves to a known fip_id | OOP `"J. Ruiz"`, bracket pool has `["Gonzalo Rubio", "Javier Ruiz Gonzalez", …]`; only `"Javier Ruiz Gonzalez"` is consistent |
| `short_unique` | Pattern 1/2/3 short-form lookup, no collision | OOP `"J. Nieto"` resolves Jorge cleanly |
| `partner_anchor` | Sibling slot resolved AND that sibling's entry-list partner name is consistent with this slot's OOP shorthand | OOP `"J. Ruiz"`, sibling resolved Rubio, Rubio's partner is `"Javier Ruiz Gonzalez"` |
| `unresolved` | Nothing matched, or short-form collision returned null | The safe fallback (raw name preserved) |

### Pass 1 — per-slot resolution

For each of the four slots, apply in order (first hit wins):

1. **Exact long-form** — `pairIndex.nameToFipId.get(normalized(name))`. Tier = `exact_long`.
2. **Bracket overlay** — collect the up-to-4 bracket long-form names for this `match_widget_id` from `bracketOverlay`. Filter to ones consistent with the OOP shorthand (same first initial AND ≥1 shared surname token between shorthand surname and bracket-name tokens excluding the first-name token). If exactly one bracket name is consistent AND it resolves via `pairIndex.nameToFipId` → substitute. Tier = `bracket_overlay`. If zero or multiple are consistent → fall through. Cross-pair scan deliberate: OOP and bracket may order their two pairs differently (OOP by schedule order, bracket by seed), so slot-index correspondence is unreliable. We do NOT also infer the OOP partner-slot from the bracket match — pass 2 handles that with stronger signals.
3. **Short-form** — existing `shortFormToFipId` lookup with Pattern 1/2/3. Tier = `short_unique` (or `null` on ambiguity).
4. **Middle-strip / prefix** — existing fallback. Tier = `short_unique`.

Result per slot: `{ fipId: string | null; tier: Tier; rawName: string | null }`.

### Pass 2 — pair-anchor sweep

For each of the two pairs `(p1p1, p1p2)` and `(p2p1, p2p2)`:

1. **Both slots resolved.** Check `pairIndex.fipIdToPartner.get(slotA.fipId)?.partnerFipId === slotB.fipId` (symmetric). If yes → no change. If no → **mis-pair detected**: emit `mispair_detected` telemetry, then compare tiers and drop the lower-confidence slot to `unresolved`. If tiers are equal, drop both (genuine ambiguity).
2. **Exactly one slot resolved.** Look up the resolved slot's `partnerFipId` / `partnerNormName` in `pairIndex.fipIdToPartner`.
   - If partner info absent → no anchor, leave the other slot as-is.
   - If the unresolved slot's raw OOP shorthand is consistent with `partnerNormName` (same first initial AND at least one shared surname token between shorthand surname and partner's name tokens excluding the first-name token) → assign `partnerFipId`, tier = `partner_anchor`. Emit `partner_anchor_resolved` telemetry.
   - If initials match but no surname token overlaps with `partnerNormName` → **suspected late swap**. Emit `suspected_late_swap` telemetry, leave the slot unresolved.
3. **Both slots unresolved.** Leave as raw names (current safe fallback).

### Return shape

`ResolvedFour` extends with optional `tier` per slot for telemetry. Existing callers ignoring tier keep working.

```ts
interface ResolvedFour {
  p1p1: string | null;
  p1p2: string | null;
  p2p1: string | null;
  p2p2: string | null;
  // NEW — optional, populated only when caller passes the new params.
  tiers?: { p1p1: Tier; p1p2: Tier; p2p1: Tier; p2p2: Tier };
}
```

### Worked trace — BA MD042

OOP: `"S. Pineda Cabello / D. Garcia Garcia"` vs `"J. Ruiz / G. Rubio"`.
Bracket has long-form `t2 = ["Gonzalo Rubio", "Javier Ruiz Gonzalez"]` (bye-skipped, but harvested by overlay).
Entry list: Rubio's partner is `"Javier Ruiz Gonzalez"`.

Assume entry list has 3-token long-forms `"Santiago Pineda Cabello"` and `"Diego Garcia Garcia"` for the qualifier slots (real production entry list has a 4-token Pineda variant — orthogonal issue, outside this spec).

| Slot | Pass 1 | Pass 2 | Final |
|---|---|---|---|
| `p1p1` `"S. Pineda Cabello"` | scan bracket pool — no consistent name (bracket t1 nulls + t2 = `["Gonzalo Rubio", "Javier Ruiz Gonzalez"]`) → `short_unique` via Pattern 1 → Pineda | — | Pineda |
| `p1p2` `"D. Garcia Garcia"` | scan bracket pool — no consistent name → `short_unique` via Pattern 1 → Garcia | — | Garcia |
| `p2p1` `"J. Ruiz"` | scan bracket pool — exactly one consistent: `"Javier Ruiz Gonzalez"` (initial J, surname ruiz overlaps) → `bracket_overlay` → Javier Ruiz Gonzalez | — | Javier Ruiz Gonzalez |
| `p2p2` `"G. Rubio"` | scan bracket pool — exactly one consistent: `"Gonzalo Rubio"` → `bracket_overlay` → Rubio | — | Rubio |

If the bracket overlay weren't populated (older snapshot, or different code path):

| Slot | Pass 1 | Pass 2 | Final |
|---|---|---|---|
| `p2p1` `"J. Ruiz"` | `null` (Pattern 3 collision from PR #313) | sibling Rubio resolved → Rubio's partner is `"Javier Ruiz Gonzalez"` → `"J. Ruiz"` consistent → `partner_anchor` | Javier Ruiz Gonzalez |

Two independent paths land the correct answer.

## Telemetry

Three new event names emitted via the existing pino logger → Sentry pipeline. Each carries `tournamentId`, `matchWidgetId`, and slot identity.

| Event | When | Severity | Payload |
|---|---|---|---|
| `partner_anchor_resolved` | Pass 2 successfully resolves a slot via partner-anchor | `info` | `{ slot, anchorFipId, anchorTier, partnerFipId, rawShortForm, partnerNormName }` |
| `mispair_detected` | Pass 2 finds both slots resolved but they're not entry-list partners | `warn` | `{ keptSlot, droppedSlot, keptTier, droppedTier, keptFipId, droppedFipId }` |
| `suspected_late_swap` | Pass 2 partner-anchor declines because OOP shorthand surname disagrees with entry-list partner | `warn` | `{ slot, rawShortForm, expectedPartnerNormName, expectedPartnerFipId }` |

No new tables, no schema migration. Ops dashboard surfacing is out of scope (separate follow-up if telemetry volume justifies).

## Testing

Three layers in `padelgod/src/__tests__/workers/fip-draw-populator.test.ts`.

### Layer 1 — pure unit tests for the new helpers

**`buildPairIndex`** — 4 tests:
- Dedupe latest `captured_at` per category
- `partner_fip_id` null vs populated path (falls back to `partner_name` for `partnerNormName`)
- Missing `partner_name` returns no entry for that fip_id
- Mixed-category rows stay isolated (men's partner index doesn't leak into women's)

**`buildBracketOverlay`** — 3 tests:
- Walkover rows with `t1 = [null, null]` still contribute t2 long-form names
- Dedupe by latest `captured_at` per `match_widget_id`
- Empty `draw_snapshots` returns empty map (consumer treats `.get()` as null)

### Layer 2 — table-driven tests for `resolveFourPlayers`

- **BA MD042 via partner-anchor** — short-form input, no bracket overlay, sibling resolves → slot resolves to Javier Ruiz Gonzalez via `partner_anchor` tier
- **BA MD042 via bracket overlay** — same inputs but with bracket overlay carrying long-form names → slot resolves via `bracket_overlay` tier
- **Mis-pair sanity (unequal tiers)** — both slots resolve, not entry-list partners → higher-tier kept, lower-tier dropped to null
- **Mis-pair sanity (equal tiers)** — both slots resolve at the same tier and aren't partners → both dropped to null
- **Suspected late swap** — sibling resolves, OOP shorthand initials match partner but surname disagrees → slot stays null, `suspected_late_swap` event fires
- **Both unresolved + ambiguous** — neither slot resolves Pass 1, no anchor available → both stay null (current safe fallback preserved)
- **Sibling has no entry-list partner info** — sibling resolved but `pairIndex.fipIdToPartner` has nothing → no anchor applied, slot stays null

### Layer 3 — integration test on `runFipDrawPopulator`

Re-uses the existing `fakeSupabase` harness. Two end-to-end tests:
- Entry-list seed with partner pairs + draw_snapshot seed with bye-skipped walkover row carrying long-form names + OOP seed with short-forms → inserted match has correct FKs via bracket-overlay path.
- Same setup but bracket has only t1 names (not t2), and the entry-list partner of an unambiguously-resolved sibling fills the unresolved slot → inserted match has correct FKs via partner-anchor path.

Total: ~10–12 new test cases. All Pattern 1/2/3 tests from PR #313 remain unchanged and green.

### One-shot audit script (not part of the resolver)

`scripts/audit-mispaired-matches.ts` — reads every `public.matches` row with both pair FKs set, cross-references against `entry_list_snapshots.partner_fip_id` per tournament, prints mismatches grouped by tournament. Dry-run by default; `--apply` flag emits and executes UPDATE statements to NULL the lower-confidence slot of each mismatch (operator then re-runs the populator to let the new resolver re-fill them). No schema changes.

## Rollout

Single PR, no feature flag. Sequence:

1. Land the resolver PR.
2. Railway auto-redeploys padelgod.
3. Next hourly `fip-draw-populator` run uses the new resolver. UPDATE stays NULL-only — previously-wrong-linked rows are NOT auto-corrected, but no new wrong-links land.
4. Run `scripts/audit-mispaired-matches.ts` (dry-run) against production, review the list, run `--apply` to NULL the lower-confidence slots.
5. Next populator run re-fills those slots via the new tiered resolver.

## Non-goals

- **No retroactive auto-correction in the populator.** UPDATE stays NULL-only; sweeping fixes belong in the audit script, run deliberately.
- **No new writes outside `public.matches` FKs.** `match_stats`, `tournament_draws`, etc. untouched.
- **No country-as-disambiguator tier.** Entry list has country; could become a follow-up if telemetry shows unresolveds we could've fixed with country.
- **No partner-anchor for tournaments without entry lists** (amateur tiers without entry-list discipline). Pass 2 silently no-ops when `pairIndex.fipIdToPartner` is empty for the tournament.
- **No Ops UI surface for `suspected_late_swap`.** Logs only.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Entry list is stale and a real swap happened — mis-pair sanity could drop a correct resolution | Tier-aware dropping (anchor must be higher tier than the dropped slot). Audit script also surfaces these for operator review. |
| Bracket overlay races a late swap — bracket carries the old long-form, OOP carries the new shorthand | Per-slot consistency check before substituting — if OOP shorthand doesn't agree with bracket long-form (different initial or surname), bracket overlay does NOT fire; OOP wins. |
| `partnerNormName` consistency check has a false-negative on rare diacritic / token-order edge cases | Normalize via existing `normalizeName` (NFKD, strip diacritics, lowercase, collapse whitespace) before comparison. Same normalization used elsewhere in the populator. |

## Future work (out of scope for this spec)

- Country tier as a third disambiguation signal (entry-list `country` + OOP `team*_country` from flag images).
- Constraint-satisfaction over all 4 slots (the rejected Option C from Q1) — only revisit if telemetry shows we routinely have ambiguous-pair situations the two-pass algorithm can't resolve.
- Ops dashboard view for `mispair_detected` and `suspected_late_swap` events.
- Backfill of historical `mispair_detected` rows in matches finished before this PR ships.
