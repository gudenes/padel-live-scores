# Reviewed Premier tournament duplicates

Read-only database audit: 2026-11-09. These are presentation preferences, not
permission to delete records or an automatic database merge plan. PadelAPI has
been decommissioned; its historical IDs and results still carry useful data.

| Event | Preferred UUID | Duplicate UUID |
| --- | --- | --- |
| Madrid 2026 | `8083ac24-da11-4a8f-84c5-708c21307e9f` | `3f3ac22c-20a0-4999-aaf2-d6451cefa65c` |
| Mexico Major 2025 | `c3fc9afd-adff-49ba-88bc-abaabc098732` | `92b0a5cb-99a7-43f5-a24e-8d453a2759d6` |
| Barcelona Finals 2025 | `29fbd066-1879-4f15-b9b6-8f9535a6b647` | `b62cb0c0-f777-405c-ad57-1490bf31755c` |

## Application behavior

`src/lib/premier-editions.ts` owns the reviewed preferences. Previous-edition
links use them. Tournament lists remove an alias only if its preferred record
is also in the fetched results; a partial query must not silently lose an event.
The request proxy temporarily redirects the three duplicate UUID URLs to their
preferred records, preserving locale, query parameters and trailing slashes.
Unknown IDs, other events and API routes are unaffected.

This does not merge match feeds, player histories, earnings, bookmarks or source
identities. In particular, the preferred Mexico page still lacks any useful
legacy-only result until reconciliation. The catalog is explicit: new Premier
UUIDs need review, and an unlisted Premier record has no previous-edition link.
Acapulco P1 and Mexico/Acapulco Major are separate series.

## Data that must be reconciled before deletion

- **Madrid:** preferred record has 110 completed matches with scores and stats.
  All 13 legacy scheduled lineups appear in the completed results. All 141
  legacy entries match; 10 of 60 legacy draw rows did not match directly by
  category, round and pair. Preserve useful location/timezone metadata and
  the `premierpadel` external ID on the legacy row. Both records have sizeable
  worker snapshot histories; do not let a cascade silently delete these.
- **Mexico:** preferred record has 114 matches and statistics for 106. Legacy
  has 122 rows, including 36 byes, plus 177 earnings records. The 78 exact
  player-lineup matches agree on winners and set scores. Eight other non-bye
  legacy records need reconciliation: two missing FIP player IDs, three
  Javier Garcia/Garcia Caro ID differences, two Collado partner disagreements
  (Pol Hernandez vs Andres Fernandez Lancha), and a legacy-only Tapia/Coello
  walkover. A matching score does not resolve a conflicting player identity.
- **Finals:** Barcelona has all 14 completed matches, 32 sets and 32 earnings
  records. The FIP twin has no matches but supplies venue, poster, official
  source identity and widget mapping. Transfer those onto Barcelona. Its
  December 11 start agrees with the earliest stored match, unlike the legacy
  December 8 date. Both rows still carry `live_source='padelapi'`; retaining
  the Barcelona UUID does not mean retaining that ingestion configuration.

## Follow-up database procedure

1. Re-audit current rows and discover every referencing foreign key from the
   live schema, plus polymorphic source mappings and stored public links.
2. Back up affected rows and prepare explicit tournament and match ID maps.
   Resolve disputed players and draw rows before approving deletions.
3. Preserve dependent records and deduplicate overlapping matches/entries/draws
   using their identities, not just tournament names or raw row counts.
4. Apply each approved merge atomically, accounting for unique source IDs and
   concurrent ingestion. Preserve aliases for old public URLs and configure
   discovery so another FIP slug cannot recreate the duplicate.
5. Verify scores, winners, statistics, earnings, references and subsequent
   ingestion. Update this catalog if the approved survivor changes.

Do not use `scripts/merge-tournament-duplicates.ts --apply` unchanged for these
pairs: its PadelAPI survivor assumption, incomplete reference list and separate
HTTP writes do not provide the required reconciliation or transaction safety.
