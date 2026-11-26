# Season and match stats rollout

This change is prepared on `codex/player-season-win-rate`; the migrations and deployments must be coordinated. No production data is changed by the tests.

## Data and cost model

- `player_season_stats` stores one row per player and UTC calendar year, keyed by `(player_id, season)`. The Players tab reads at most four rows in one query. It does not download or aggregate match history.
- Private `player_season_contributions` stores each completed match's contributions so result corrections, participant replacements, date changes, cancellations and deletion reverse the previous values. Triggers apply atomic counter deltas to affected player/year rows. Unchanged results and score-only updates do not rewrite totals. Tournament start-date changes only revisit matches using that fallback date.
- Finished matches and retirements with a confirmed winner count; walkovers do not. Season date is scheduled time, then started time, then tournament start, all interpreted in UTC. Display explicitly says recorded results, not complete career coverage.
- `match_stats` already materializes detailed match/set stats. Added break-conversion percentages are backfilled from existing parsed raw payloads when present. Percentages have no fabricated opportunity-count display.
- `claim_match_stats_candidates` joins/filter candidates in the database and returns at most 20 rows. Live matches have priority, then recent completions, then historical catch-up. Final aggregate rows are not fetched again. Claims use row locking and retry delays: 4 minutes live, 15 minutes for recently completed matches, 6 hours for old results. A provider failure does not stop the rest of the batch.
- Candidate SQL uses the mapping lookup keys and the new partial match index. PostgREST's response cap cannot truncate discovery anymore. The worker's follow-up lookups are bounded to the claimed matches/tournaments.
- Browser background tabs do not poll season totals. Detailed stats responses retain existing HTTP caching and select only display/provenance columns, excluding raw payloads at the database query.

## Order of operations

1. Apply `20261126090000_player_season_stats.sql` transactionally. This performs a one-time backfill (production read-only inspection found 19,562 eligible results among 29,633 matches on November 26). The migration installs triggers and backfills in the same transaction, so no concurrent result can fall between them. Allow for the initial write lock during migration; there is no recurring full refresh.
2. Apply `20261126091000_match_stats_fetch_candidates.sql` transactionally. Existing workers remain compatible with the added columns/tables.
3. Merge the reviewed branch to main. Padel God deploys automatically on merge; the new claim function MUST exist before that deployment.
4. Deploy web from clean main with `scripts/deploy.sh web --dry-run`, then the actual web deploy, following AGENTS.md. No admin or cron deploy is required for these changes.
5. Let the bounded worker catch up. The missing Mexico match is `1a353fc8-2456-43bd-82b1-48579ec695e4` / `FIP-2026-4801:MD031`. Verify stored rows for set numbers 0–3 and the public summary. Do not run an unbounded historical provider scrape.

## Verification

- Compare stored season wins/matches with grouped `player_season_contributions` totals. Zero-result rows intentionally remain with matches=0 and win_rate=NULL.
- Verify Gala/Rubini have seasonal rows, both percentages/counts use the same year, and 0% renders as 0%.
- Confirm Mexico's match_stats rows have total-points percentages 47/53 and break conversion 33/30 in the aggregate. Check all set tabs.
- Check worker fetched/skipped counters and logged individual failures. `candidatesSeen` now means the bounded eligible batch rather than all mappings in history.
- Database tests cover initial backfill, corrections, participant/season moves, deletion, retirements/walkovers, fallback date changes, public read-only permissions, >10,000 mappings, bounded claims, final-stat skipping, retries, and legacy break-percentage backfill.

## Rollback

Revert application/worker code first; the added database tables and columns can remain. To disable incremental writes, drop the four `player_season_match_*` / `player_season_tournament_update` triggers only after reverting the Players tab. Do not drop aggregate tables while the new web code reads them. If triggers are disabled, rebuild the ledger and totals before re-enabling seasonal reads.

## Validation result

33 targeted tests pass, including the SQL migrations in PGlite and existing worker regressions. Padel God type-check and targeted application lint pass. The full web type-check remains blocked by unrelated existing errors in Play activity and missing local SQLite/Capacitor type dependencies. No production migrations or deploys have been performed.
