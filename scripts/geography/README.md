# Player birthplace normalization

Applied to the shared database on 2026-11-19 by
`node scripts/geography/apply-birthplace-normalization.mjs --apply`.
The transaction backfilled 6,632 players: 450 proposed, 648 unresolved,
5,534 missing; 64 proposals map to Catalunya. No records were marked verified.

## Stored datapoint

- `players.birthplace`: unchanged source text.
- `player_birthplaces`: one derived row per player, with raw input, status,
  proposed municipality, all candidate IDs, explanation, normalizer version,
  timestamp and optional verification evidence.
- `birthplace_municipalities`: INE 2026 municipality IDs, names, country,
  province, region and reference source.
- `birthplace_aliases`: exact normalized names, article-order variants,
  bilingual names and explicit reviewed aliases.

Region keys exposed by the scouting API are country + INE region code, e.g.
`ES:09` for Catalunya. They are not ISO subdivision codes. `birth_region`,
`birth_status`, `birth_municipality`, `birth_country` and `birth_reason` are
available in scouting intelligence player records. Country/region values
are proposals unless `birth_status = 'verified'`.

```sql
select p.id, p.name, p.birthplace,
       n.status, m.id as municipality_id, m.name as municipality,
       m.country_code, m.province_code, m.region_code, n.reason
from public.players p
join public.player_birthplaces n on n.player_id = p.id
left join public.birthplace_municipalities m on m.id = n.municipality_id
where m.country_code = 'ES' and m.region_code = '09';
-- Add n.status = 'verified' if evidence-confirmed birthplaces are required.
```

## Automatic maintenance

The `trg_player_birthplace_normalization` trigger runs after player creation
and birthplace updates, including imports and approved admin corrections.
It only writes derived rows. Changes to nationality have no effect.
Unchanged verified values survive reprocessing. A change to the raw birthplace
invalidates prior verification and recomputes the proposal. Player deletion
cascades to the derived row. Catalogue/alias revisions require an explicit
reprocessing pass; they do not silently change verified decisions.

Neither the catalogue nor nationality proves birth country. In particular,
Barcelona and other Spanish names have international namesakes. Automatic
matches are always proposed. Unknown and ambiguous inputs remain unassigned;
foreign locations are not classified as bad data. The UI can filter proposals
or require verified status explicitly. Verification requires source evidence;
this change does not introduce a verification-writing UI.

## Reproduction and validation

`build-birthplace-migration.py` builds the migration from the pinned INE JSON
snapshot (source URL, reference date and SHA256 are retained). The migration
is a one-time operation and is **already applied** to the shared database.
Do not rerun it there. On a fresh database with the players schema:

- `node scripts/geography/apply-birthplace-normalization.mjs` runs the migration,
  compares every player against the reviewed preview, exercises update-trigger
  behavior and verification invalidation, checks access restrictions and
  original player fields/timestamps, then rolls the entire transaction back.
- `--apply` runs those same checks and commits only if they pass. Fixture changes
  are rolled back to a savepoint before commit. Any error rolls everything back.

The database tables use RLS and deny direct anon/authenticated access; admin
server/service-role access is required. The existing public/admin production
applications remain compatible because no existing player columns changed.
The new UI is in this feature branch and must be deployed separately.

The local-only preview remains a read-only comparison against the pinned
catalogue. It does not apply changes. No deployment is performed by these tools.
