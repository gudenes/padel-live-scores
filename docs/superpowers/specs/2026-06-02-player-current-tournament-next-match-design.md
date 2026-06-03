# Player profile: surface the current-tournament match ("Tier-0")

**Date:** 2026-06-02
**Status:** Approved design — ready for implementation plan
**Area:** `src/app/[locale]/player/[id]/page.tsx` ("Próximo partido / torneo" card)

## Problem

The player profile shows a "next match / next tournament" card. When a player is
**still competing in an in-progress tournament** but their next match has **no
`scheduled_at` yet**, the card leapfrogs ahead to the player's next *future*
enrollment — making it look like they are done with the current event.

### Confirmed case (Lucas Bergamini, observed 2026-06-02)

- **ITALY MAJOR** — in progress (31 May → 7 Jun). He is in the main draw and has
  a match row: `round='R32', status='scheduled', scheduled_at=NULL` (his next
  match, time not yet set).
- **VALENCIA P1** — future (starts 8 Jun), seed 8, partner Javier Garrido.

The card displayed **Valencia P1** as "Próximo torneo" while he was still in the
Major.

### Why every tier drops the Major

The card is computed as a 3-tier cascade in `page.tsx` (~lines 529-577, rendered
~796-905):

| Tier | Source | Filter | Why it misses the Major |
|------|--------|--------|--------------------------|
| 1 — `nextScheduled` | `matches` | `status='scheduled'` **AND `scheduled_at > now`** | R32 has `scheduled_at = NULL` → dropped |
| 2 — `nextTournament` | `matches.tournament` | `status='scheduled'` **AND `tournament.starts_at > now`** | Major already started (`starts_at <= now`) → dropped |
| 3 — `enrollment` | `padelgod.entry_list_snapshots` via `resolveNextEnrollment` | candidate kept if `ends_at > now`, but **"prefer future"** filter discards in-progress events | Major is in-progress; Valencia (future) wins |

The Tier-3 resolver explicitly assumes an in-progress entry-list hit means the
player is "already eliminated there but still listed"
(`src/lib/next-enrollment-resolver.ts:112-118`). That assumption is inverted here:
he is still alive in the Major, just unscheduled.

**Root gap:** the feature only models "next *future* appointment." It has no
concept of "you have a pending match in the tournament happening right now." A
`scheduled` match in an already-started tournament with a null time falls through
every filter.

## Goal

When the player has a non-finished match in a tournament that is currently in
progress, show **that** match as the card — even if its time isn't set yet —
instead of leapfrogging to a future enrollment.

## Approach — Tier-0 match detection (chosen scope)

Add a highest-priority selection ahead of the existing cascade, using data the
page **already fetches** (the career-matches query at `page.tsx:395-420` already
returns `status` and `tournament.starts_at/ends_at`). **No new DB query, no API
route change, no resolver change.**

### Tier-0 definition

From the player's `matches` array, select a match where:

- `status ∈ {'scheduled', 'live'}` — the non-finished statuses the page already
  fetches (the fetch's `.in('status', [...])` includes `'live'` and
  `'scheduled'`; no fetch change needed), **and**
- its tournament is **in progress**:
  `tournament.starts_at != null && tournament.starts_at <= now && (tournament.ends_at == null || tournament.ends_at > now)`.

**Ordering** (most immediate first):
1. `live` matches before `scheduled`.
2. Among `scheduled`: soonest `scheduled_at` first; **null `scheduled_at` last but
   still eligible** (so a pending-time match is selected when there's no
   timed one).

### Why this is correct for elimination

An eliminated player's last match in the tournament is `finished` (a loss), not
`scheduled`/`live`. So Tier-0 finds nothing for them, and the cascade falls
through to their future enrollment exactly as today. This replaces the resolver's
brittle "in-progress ⇒ eliminated" guess with a real signal (presence of a
non-finished match), without touching the resolver.

### Cascade after the change

`Tier-0 (current-tournament match)` → `Tier-1 (future scheduled match)` →
`Tier-2 (tournament from matches)` → `Tier-3 (entry-list enrollment)`.

**Integration:** fold Tier-0 into the existing `nextScheduled` selection:

```
nextScheduled = currentTournamentMatch ?? futureScheduledMatch
```

This keeps the existing match-card render path and the Tier-3 `useEffect` guard
(`if (derived.nextScheduled || derived.nextTournament) { … }`) working unchanged —
when Tier-0 selects a match, `nextScheduled` is populated and Tier-3 does not fire.

### Pure helper + tests

Extract the Tier-0 selection into a small **pure** helper so it is unit-testable
in isolation, e.g.:

```ts
pickCurrentTournamentMatch(matches: MatchRow[], now: Date): MatchRow | null
```

Unit tests (vitest, alongside existing `src/lib/__tests__`):

1. **Bergamini case** — in-progress tournament, `scheduled` match with
   `scheduled_at = null` → selected.
2. **Eliminated player** — only `finished` matches (losses) in the in-progress
   tournament → returns `null`.
3. **Future tournament** — a `scheduled` match in a not-yet-started tournament
   (`starts_at > now`) → **not** selected by Tier-0 (left to Tier-1).
4. **Ordering** — a `live` match and a `scheduled` match both in-progress → the
   `live` one is selected.
5. **Null `ends_at`** — `starts_at <= now`, `ends_at = null` → treated as
   in-progress.

## Render — match card + "time TBC" (chosen display)

Reuse the existing "Próximo partido" match card (`page.tsx:798-837`). Two small
adjustments:

1. **Time-TBC label.** When the selected match has no `scheduled_at`, the meta
   line shows a new i18n string in place of the date·time:
   - Key: `player.nextMatchTimeTBC`
   - Copy: ES "Horario por confirmar", EN "Time to be confirmed" (provide all 5
     locales: en, es, pt, it, fr).
   - Meta line becomes roughly:
     `[titleCase(tournament.name), scheduled_at ? `${dateStr} · ${timeStr}` : tNextMatchTimeTBC].filter(Boolean).join(' · ')`
2. **Graceful opponent fallback.** If the opponent slot is still TBD (no resolved
   opponent names), the title falls back to the round label (or the tournament
   name) instead of rendering a bare `vs `. Keep the current
   `vs {oppNames} · {round}` when opponents are known.

No change to the card's container styling, click target (`/match/{id}`), or level
badge.

## Out of scope

- **Tier-3 resolver "prefer-future" rule** is left unchanged. The rarer
  winner-propagation-lag gap (player won a round but the next-round match row
  isn't populated yet, so no `scheduled` match exists) is not addressed here;
  Tier-0 relies on the next match row existing, which it does in the observed
  case and generally once the bracket/`fip-winner-propagator` has run.
- No new DB query or data fetch.
- No relabeling/special live-match treatment beyond reusing the existing card
  (a `live` match still renders under the "Próximo partido" label).

## Files touched

- `src/app/[locale]/player/[id]/page.tsx` — Tier-0 selection folded into
  `nextScheduled`; render tweaks (TBC label + opponent fallback).
- New pure helper (location TBD in plan, e.g. `src/lib/…` or a local module) +
  `src/lib/__tests__/…test.ts`.
- `src/messages/{en,es,pt,it,fr}.json` — add `player.nextMatchTimeTBC`.
