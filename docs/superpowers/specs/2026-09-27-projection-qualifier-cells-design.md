# Projections: ingest qualifier cells instead of widening the gate

**Date:** 2026-09-27
**Status:** Steps 1 + 2 implemented, not deployed. Step 3 (gate) deliberately untouched.
**Branch:** `feat/projection-qualifier-cells`

> **Implementation note (2026-09-27).** The root cause turned out to be one
> level lower than this spec first assumed. The `(Q)` cells *are* scraped —
> all 16 of Rotterdam's women's R32 cells are in `padelgod.draw_snapshots`.
> FIP renders "pair waiting on a qualifier" with **exactly** the same shape as
> a bye (one side named, other blank, `status='walkover'`), so
> `fip-draw-populator`'s blanket bye-skip discarded both. No new column and no
> migration were needed: the two are separable structurally, because a true
> bye's pair has already advanced into the parent cell and a qualifier slot's
> has not. That discriminator classified all 12 walkover-shaped cells in the
> Rotterdam women's draw correctly, and 376 bye / 12 qualifier across every
> FIP + Premier draw of the last 45 days.

## Problem

Rotterdam P2's main draw landed in `matches` at **11:53:46 UTC** on 2026-09-27. The men's
projection published at **12:35:00 UTC** — a 41m14s lag, which is purely the hourly
`tournament-projection-snapshot` cron (`35 * * * *`) waiting for its next tick.

The women's projection did not publish at all, and will not until the draw changes.

The immediate suspicion was the `≥50% of leaf slots filled` gate in
[`tournament-projection-snapshot.ts:322`](../../../padelgod/src/workers/tournament-projection-snapshot.ts).
Measured against live data with the real `buildFirstRoundLeaves`:

```
men    drawSlots=32  filledEntrants=21  threshold=16  → PASS  (21 projection rows written)
women  drawSlots=32  filledEntrants=13  threshold=16  → FAIL  (short by 3)
```

The gate is where it *stops*. It is not where it *breaks*.

## Root cause

FIP publishes the women's Rotterdam main draw in full. All 16 R32 cells exist
(`https://www.padelfip.com/es/eventos/rotterdam-p2-2026/?tab=Cuadros`, Femenino → Principal):

| Cell shape | Count | Ingested? |
|---|---|---|
| `BYE` (seeds 1–8 carried to R16) | 8 | absent — correct, a bye is not a match |
| pair vs pair | 4 | yes — `WD017`, `WD021`, `WD026`, `WD029` |
| **pair vs `(Q)`** | **4** | **no — `WD018`, `WD022`, `WD025`, `WD030` all absent** |

Plus `WD013` (Claudia Jensen / Claudia Escacena, seed 8, marked `LLi`) is missing from R16.

So FIP gives us **20 known pairs**. We hold 15 rows' worth; the bracket builder places 13.

Every dropped cell contains a **real, known pair** whose only distinguishing feature is that
their opponent is a not-yet-decided qualifier:

- Marta Barrera / Jana Montes
- Sofía Saiz / Lucía Sainz
- Beatriz Caldera / Carmen Goenaga
- Ksenia Sharifova / Alix Collombon
- Claudia Jensen / Claudia Escacena (seed 8)

**We are discarding a known pair because its opponent is unknown.** That is the bug.

## Why widening the gate is the wrong fix

Lowering or removing the threshold makes the women's tab render. It does not make it correct:
the projection would be built from the 13 entrants we happen to hold, and those 5 pairs would
be **absent from the Road to Trophy entirely**. A fan searching for Lucía Sainz or Alix
Collombon finds nothing, on a draw where FIP plainly lists them.

A blank tab is a visible failure. A confidently-rendered projection that silently omits five
contenders is a worse one.

## Scope of the problem

Scan across all Premier + FIP-graded main draws with matches in the last 45 days
(`scripts/scan-projection-dark-cells.mts`, counting first-round cells where *both* slots are empty — i.e. cells we hold
no information about at all):

```
Premier + FIP-graded main draws, last 45 days: 72

Draws with >=1 first-round cell we know NOTHING about: 16 (22%)
  ...currently BLOCKED by the gate:                     4
  ...PUBLISHED anyway, dark cells simulated as byes:   12
```

The blocked case — the one that prompted this — is the *rare* one:

| Draw | cat | filled/need | full/half/dark cells | state |
|---|---|---|---|---|
| MADRID P1 | men | 16/32 | 8 / 0 / 24 | BLOCKED |
| FIP SILVER MC ALLEN TEXAS | women | 0/8 | 0 / 0 / 8 | BLOCKED |
| CUPRA ROTTERDAM P2 | women | 13/16 | 4 / 5 / 7 | BLOCKED |
| FIP BRONZE SHELL CASABLANCA | women | 6/8 | 3 / 0 / 5 | BLOCKED |
| PARIS MAJOR | women | 40/32 | 12 / 16 / 4 | published |
| CUPRA ROTTERDAM P2 | men | 21/16 | 8 / 5 / 3 | published |

The larger population is the 12 draws that **published with dark cells**, including the
Rotterdam men's projection live right now (3 dark cells) and Paris Major women (4).

This matters because `null` in the leaves array means *bye **or** not-yet-known*
([`bracket-projection.ts:29`](../../../padelgod/src/lib/bracket-projection.ts)), and the
simulation advances it for free:

```ts
next.push(a ?? b); // bye (or null vs null)
```

A pair drawn opposite a dark cell is handed a free pass to the next round, inflating its
reach probabilities. This is precisely the distortion the 50% gate exists to prevent
("so a half-published draw doesn't inflate the loaded pairs' odds") — and at 50% it lets
it through anyway.

## Decision

Fix ingest first. Treat the gate as a consequence, not a cause.

### 1. Ingest cells whose opponent is a qualifier placeholder

Write the row with the known pair on one side and `NULL` on the other — the same shape we
already store for partially-known cells. Mark the unknown side as a qualifier slot rather
than leaving it indistinguishable from a bye (proposed: a nullable
`matches.pair2_source` / `pair1_source` enum of `'qualifier' | 'bye' | NULL`, or a
`entity_external_ids`-style marker if we'd rather not touch `matches`).

Effect on Rotterdam women without touching the gate: filled leaves 13 → ~21, threshold 16 →
**passes on its own**, and all 20 known pairs appear.

### 2. Distinguish bye from unknown in the simulation

Once ingest marks the difference:

- **true bye** → advance free (current behaviour, correct)
- **qualifier slot** → simulate as an average-field entrant (e.g. Elo drawn from the
  qualifying field, or the field mean) rather than a free pass
- **still-dark cell** → the honest blocker; this is what a gate should key on

### 3. Revisit the gate last

With (1) and (2) in place the flat `≥50%` proxy is mostly redundant. Replace it with a
condition on genuinely-dark cells rather than a share of filled slots.

## Out of scope, but found on the way

These are separate defects surfaced during the investigation. Not part of this change.

1. **`WD013` absent** — Jensen/Escacena (seed 8) carries an `LLi` marker; likely the
   lucky-loser / withdrawal path rather than the `(Q)` path. Needs its own diagnosis.
   Likely related to the known stale-pair-on-withdrawal defect in `fip-draw-populator`
   (NULL-only update path; Pretoria P1 `MD024`, 2026-07-29).

2. **Live men's projection carries a wrong player.** FIP shows `MD027` as
   **Gonzalo Rubio / Andrés Fernández Lancha**; our DB has **Gonzalo Rubio / Pol Hernández
   Álvarez**, and FIP separately lists Pol Hernández Álvarez in a `(Q)` pair with Manuel
   Castaño. This is the known FIP-feed name-overwrite bug, live in a published projection.

3. **Cron ordering.** `tournament-projection-snapshot` runs at `:35`;
   `fip-draw-populator` — which inserts FIP draw matches — runs at `:47`, twelve minutes
   *after*. A FIP draw populated at `:47` therefore always waits ~48 min for the next
   window. Moving the snapshot to ~`:55` would cut the typical lag to a few minutes.

4. **`projection-ready-notifier` comment is wrong.** Its cron comment
   ([`scheduler.ts:983`](../../../padelgod/src/scheduler.ts)) claims it trails a snapshot
   that "runs at :00"; the snapshot runs at `:35`, so `:20` *precedes* it and the notify
   would lag ~45 min rather than 15. The worker is currently dark
   (`ENABLE_PROJECTION_READY_NOTIFIER` unset; last row 2026-06-15), so this is latent.

## Post-mortem: the first cut would have invented 36 matches

Worth recording, because the unit tests were green and the logic read as
correct. A **production dry-run**, diffed against the unmodified worker, is
what caught it:

```
baseline (no fix):  inserted=0,  skippedBye=55
first cut:          inserted=40, skippedBye=14, qualifierSlots=41   <- 39 false positives
final:              inserted=4,  skippedBye=51, qualifierSlots=4    <- 51+4 = 55 reconciles
```

Two independent causes, both of which invented first-round matches in
tournaments that had none (Lyon, Dubai, Houten, São João):

1. **OOP rows shadowed their bracket twins.** The parent index was built
   last-wins over `latestDraws`, which also carries OOP-merged rows. OOP
   abbreviates first names — `"A. Salazar Bengoechea"` where the bracket says
   `"Alejandra Salazar Bengoechea"` — so the lookup returned an OOP row, the
   name comparison failed, and a real bye was read as a qualifier slot. The
   index is now scoped to `fip_event_page` rows, matching the gate's own
   scope, so both sides of the comparison speak one dialect.
2. **An empty parent cell was treated as "nobody advanced → qualifier".** FIP
   publishes the first round before filling the next one in, so empty means
   *unknowable*, not *qualifier*. It now falls back to bye.

Name comparison is additionally surname-level, so any residual feed-dialect
mismatch fails toward **bye** — the pre-existing behaviour — rather than
conjuring a match.

**The generalisable lesson:** this class of change is not verifiable by unit
test alone. The fixtures encode what I *believed* the feed looked like; only
the real corpus contains the second naming dialect. Any future change to draw
ingest should be dry-run against production and **diffed against the
unmodified worker**, because the absolute counter (`qualifierSlots: 41`) looked
plausible in isolation — it was only obviously wrong next to the baseline's
`skippedBye: 55`.

## Verification

- Rotterdam P2 women projects with all 20 known pairs present, without changing the gate.
- Rotterdam P2 men's reach probabilities shift downward for pairs adjacent to its 3 dark
  cells once qualifier slots stop being free passes.
- Re-run `scripts/scan-projection-dark-cells.mts`: the 12 published-with-dark-cells draws drop toward zero.
