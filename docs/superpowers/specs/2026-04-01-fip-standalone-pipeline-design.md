# FIP Gold/Silver/Bronze Standalone Pipeline

## Overview

Standalone data pipeline for FIP Gold, Silver, and Bronze tournament tiers that bypasses padelapi.org entirely. Uses padelfip.com WordPress API for tournament discovery and matchscorerlive.com for draw/match result scraping.

**Goal:** Replace padelapi.org as the data source for Gold/Silver/Bronze tiers, reducing API budget consumption and providing direct access to FIP-published data.

**Approach:** Two new cron jobs + one shared scraper library. Fully separate from existing padelapi sync. Reuses existing DB tables, player-resolver, and ops-logger.

## Data Sources

### padelfip.com WordPress API

Open, no auth, no CAPTCHA. Provides tournament metadata via the `fip_event` custom post type with category-based filtering.

**Endpoints:**

| Category | ID  | Endpoint |
|----------|-----|----------|
| Gold     | 19  | `GET /wp-json/wp/v2/fip_event?fip_event_category=19` |
| Silver   | 496 | `GET /wp-json/wp/v2/fip_event?fip_event_category=496` |
| Bronze   | 497 | `GET /wp-json/wp/v2/fip_event?fip_event_category=497` |

Pagination via `?page=N&per_page=20`. Response includes: title, slug, dates (ACF fields or content), featured image (logo), event page URL.

**Event detail enrichment** from each event page:
- Venue, country, city
- Categories offered (men/women)
- Link to matchscorerlive.com draws

### matchscorerlive.com

Server-rendered HTML (no JS execution needed). Provides draw brackets and match results.

**Data available per match:**
- Player names (first + last)
- Round (R32, R16, QF, SF, F)
- Match status (scheduled or finished)
- Final set scores (e.g. "6-3 7-5")
- Court (if listed)

**Data NOT available:**
- No point-by-point / game-level data
- No live score updates
- No Pusher/WebSocket channels

**matchscorerlive URL discovery:** The URL for each tournament's draws is found from the padelfip.com event page (linked or embedded). Stored on the tournament record for subsequent runs.

## Architecture

```
padelfip.com WP API --> fip-scraper.ts --> tournaments table
                              |                (level: Gold/Silver/Bronze)
                              |
matchscorerlive.com --> fip-scraper.ts --> matches table + sets table
                              |                (no games, no points)
                              |
                        player-resolver.ts --> players table
                              |                (match by name)
                              |
                        ops-logger.ts --> ops_events table
```

### New Files

- `src/lib/fip-scraper.ts` — all padelfip.com + matchscorerlive.com parsing/scraping logic
- `src/app/api/cron/fip-tournaments/route.ts` — tournament discovery cron
- `src/app/api/cron/fip-scores/route.ts` — match result scraping cron

### Modified Files

- `src/app/api/cron/sync/route.ts` — filter to skip Gold/Silver/Bronze from padelapi sync
- `src/app/api/cron/scores/route.ts` — filter to skip Gold/Silver/Bronze from padelapi score polling
- `src/app/ops/api/status/route.ts` — add `cron:fip-tournaments` and `cron:fip-scores` to health sources
- `vercel.json` — add two new cron schedules

## Database Changes

### No new tables. Three new columns on `tournaments`:

```sql
ALTER TABLE tournaments ADD COLUMN source TEXT DEFAULT 'padelapi';
ALTER TABLE tournaments ADD COLUMN fip_slug TEXT;
ALTER TABLE tournaments ADD COLUMN matchscorer_url TEXT;
```

- `source`: `'padelapi'` or `'fip'` — determines which pipeline owns the tournament
- `fip_slug`: padelfip.com event slug for URL construction
- `matchscorer_url`: discovered matchscorerlive.com draw URL

### Existing table usage

**matches:** `coverage` stays `null` (no point-by-point). `pusher_channel` stays `null` (no live relay). No `games` rows created. Status lifecycle: `scheduled` -> `finished` (no `live` state).

**sets:** `score_source` uses new value `'fip'` alongside existing `'api'`, `'inferred'`, `'live'`.

**players:** No changes. Player-resolver matches by name, creates new records if no match found. Country populated from matchscorerlive if available.

## Cron Jobs

### `cron:fip-tournaments` — Every 12 hours

**Route:** `GET /api/cron/fip-tournaments`

1. Query padelfip.com WP API for Gold (19), Silver (496), Bronze (497) categories
2. For each event: extract name, dates, country, slug, logo
3. Upsert into `tournaments` table with `source: 'fip'`
4. For new tournaments: attempt to discover matchscorerlive.com URL from the event page
5. Store `matchscorer_url` on tournament record
6. Log to `ops_events` as `cron:fip-tournaments`

**Expected volume:** ~3-10 HTTP requests per run.

### `cron:fip-scores` — Every 2 hours

**Route:** `GET /api/cron/fip-scores`

1. Query `tournaments` where `source = 'fip'` AND currently active (between `starts_at` and `ends_at + 1 day`)
2. For each active tournament with a `matchscorer_url`:
   - Fetch draw page(s) for each category (men/women)
   - Parse HTML for matches: player names, round, set scores, status
   - Resolve players via `player-resolver.ts` (match by name)
   - Upsert matches: `scheduled` if no scores, `finished` if scores present
   - Upsert sets with `score_source: 'fip'`
3. Skip tournaments without a `matchscorer_url` (log warning)
4. Log to `ops_events` as `cron:fip-scores`

**Expected volume:** ~2-6 HTTP requests per active tournament per run.

### Existing cron filters

Both existing padelapi crons get a filter to exclude Gold/Silver/Bronze:

- `cron:sync` — skip tournaments where `level IN ('Gold', 'Silver', 'Bronze')`
- `cron:scores` — skip matches belonging to Gold/Silver/Bronze tournaments

## Error Handling

**matchscorerlive.com unavailable:** Log warning, skip tournament, retry next run. Leave matches in current state.

**matchscorer_url not found:** Log once, skip. Retry discovery on next `fip-tournaments` run. Draws may not be posted until close to tournament start.

**Player name mismatch:** Player-resolver tries exact match first. No match -> creates new player record. Duplicates merged later via admin tools.

**Partial draw data:** Matches created as `scheduled`, updated to `finished` when scores appear on subsequent runs.

**Rate limiting:** No known limits on padelfip.com or matchscorerlive.com. Add 200ms delay between requests to be polite. Configurable.

## Ops Dashboard Integration

Both cron jobs appear automatically in the ops dashboard via `logOpsEvent`:

- Add `'cron:fip-tournaments'` and `'cron:fip-scores'` to the `sources` array in `fetchHealth()`
- Ongoing events section already works — FIP tournaments with scheduled matches show up naturally

## Transition Plan

**Day 1:** Deploy migration + filter on existing crons (Gold/Silver/Bronze excluded from padelapi). Deploy `fip-tournaments` cron to populate tournament metadata.

**Day 2:** Once tournaments have `matchscorer_url` populated, deploy `fip-scores` cron. Matches start flowing in.

**Rollback:** Remove level filter from padelapi crons, disable FIP crons in vercel.json. Existing padelapi data stays intact.

## Scope Exclusions

- No live score updates for these tiers (no Pusher/relay integration)
- No point-by-point or game-level data
- No coverage computation
- No FIP BEYOND tiers (B1/B2/B3) — can be added later if approach proves successful
- No FIP Platinum tier — remains on padelapi.org
