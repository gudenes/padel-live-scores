# Duplicate match players: October 23, 2026

## Confirmed failure path

The Kuwait Q1 match `e0df96dc-5717-4040-9fda-42d5f54ea100`
(`FIP-2026-4410:MQ029`) stored Miguel Deus in both second-team slots.
The OOP snapshots say `M. Deus / N. Deus`; the entry-list history consistently
identifies Miguel as `P201200` and Nuno as `P201198`, with reciprocal partners.

The reproducible writer is `static-reconciler`:

1. `reconcileOOP` resolves the four snapshot names with `resolveFourNames`.
2. `tournament-dictionary.resolveShortName` previously discarded first names
   and initials when falling back to surnames.
3. Both Deus candidates also have a partner whose surname is Deus. The partner
   loop returned the first candidate for both inputs, rather than requiring a
   unique match. Entry order therefore selected which brother appeared twice.
4. `findOrCreateMatch` inserted those duplicate UUIDs without validation.
5. Later NULL-only fills did not replace the already-populated wrong slot.

An integration test of the actual writer reproduced the Kuwait duplicate before
the fix. Hviid, Niño and Para pairs reproduce the same lookup failure. Database
records alone do not identify the historical writer invocation for every other
affected row.

## Additional reproduced write hazard

`fip-draw-reconciler` previously applied each resolved slot independently while
preserving unresolved slots. If the stored pair was `[B, A]` and the new source
resolved to `[A, unknown]`, the patch produced `[A, A]`. Its bye path had the
same issue. The populator's NULL-only fill could likewise turn `[A, null]` into
`[A, A]` when the source order was `[B, A]`.

Regression cases cover Molina/Villavicencio, Pala/Nyabuto, Juma/Thakker,
Simao/Menezes, Pabbaraju/Sobati, Zabinsky/Duijnhouwer,
Sorensen/Nimji and the two Mario Rodriguez names. These tests establish the
failure mechanism; they do not claim a recovered write history for each match.

## Fix and rollout

- Resolve names using the provided given name or initial and surname tokens.
  Partner hints must uniquely identify a candidate; ambiguous matches stay
  unresolved. Repeated snapshots of one identity are not separate candidates.
- Reject duplicate canonical UUIDs in static reconciliation and match creation.
  In the draw populator, conflicting resolved slots retain source names instead.
- Validate the final merged lineup before a partial draw update is written.
- Apply `20261023100000_matches_distinct_players.sql` and deploy the patched
  padelgod worker. No Next.js deployment is needed for these changes.

The database trigger rejects any new lineup with a repeated non-null player ID,
including a player appearing on both teams. It permits unknown slots, atomic
slot swaps, and repairs. Unchanged historical duplicate lineups can still receive
score/schedule updates; they must be audited separately rather than guessed at
by this migration. A conflicting write fails atomically with SQLSTATE `23514`.

The migration is a deployment artifact, not an automatic production migration.
Do not bundle unrelated working-tree changes into the worker deployment.

## Verification

Run `npm test` and `npm run typecheck` in `padelgod/`.
After applying the migration in a test database, run:

```sh
psql -v ON_ERROR_STOP=1 -f supabase/tests/matches_distinct_players.sql
```

The SQL fixtures use a temporary table and roll back. They cover duplicate
teammates, cross-team duplicates, partial-update collisions, legacy maintenance,
NULL slots, atomic swaps and repairs. The migration and these checks were also
executed in an isolated PostgreSQL runtime (PGlite), including an insert against
the migration's actual `public.matches` trigger.

After deployment, verify the active duplicate count remains zero:

```sql
SELECT id, widget_id_composite
FROM public.matches
WHERE status IN ('scheduled', 'live')
  AND (pair1_player1_id = pair1_player2_id
    OR pair1_player1_id = pair2_player1_id
    OR pair1_player1_id = pair2_player2_id
    OR pair1_player2_id = pair2_player1_id
    OR pair1_player2_id = pair2_player2_id
    OR pair2_player1_id = pair2_player2_id);
```
