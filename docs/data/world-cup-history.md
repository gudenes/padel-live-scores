# Historical national-team World Cups

Admin destination: `/world-cup-history` (operator only), with year/type/category filters, source links, structured record details and JSON download.

The archive is separate from live `matches`, `players`, predictions and public rankings. Ingestion never rewrites those tables. Public/anon roles have no access to the three archive tables. Every record references captured official HTML with URL, fetch time and SHA-256. Podium records are source transcriptions, not an assertion that every historical entry has been independently cross-checked.

Coverage:
- 1992–2024: 17 editions, men's and women's official podiums. Earlier detailed rosters/results remain explicitly unavailable.
- 2024: entry list, groups and their tie summaries, six days of OOP/results, available team-results cards, replays and PDF references. PDFs are references, not transcribed data. Missing results (including unplayed rubbers) stay null. Team-results pages are incomplete; coverage is not claimed as a complete historical match database.
- The archived 2024 widgets omit some women's category headings. The archive-only parser fills missing headings using Crionet LD/MD draw identifiers; it leaves explicit headings untouched and rejects unknown prefixes.
- Roster links require one exact normalized full-name match in the correct category. Match links go through that edition's roster and require an unambiguous initial/surname match. Ambiguous profiles stay unlinked.

Reproduce (root environment supplied externally; never copy secrets into the worktree):

```sh
python3 scripts/fetch-world-cup-history.py --output-dir=/tmp/world-cup-history-source
node --env-file=/path/to/.env.local --import tsx scripts/import-world-cup-history.mts --source-dir=/tmp/world-cup-history-source
```

Review `preview.json` and counts before using `--apply`. Apply migration `20261103180000_world_cup_archive.sql` first. The import runs in one transaction and upserts by edition/type/category/source identity; repeated runs do not duplicate records. Captured sources are immutable by URL/content hash. Changed sources update the record's source reference while retaining older source captures. No scheduled polling is required for these completed editions.
