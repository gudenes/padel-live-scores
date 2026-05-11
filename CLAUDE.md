@AGENTS.md

# PadelNacho — Padel Live Scores

Mobile-first PWA for real-time padel score tracking, rankings, news, and tournament info. Data sourced from padelapi.org (FIP/Premier Padel) and direct FIP scraping via the padelgod Railway workers.

## Tech Stack

- **Frontend:** Next.js 16.2.0, React 19, Tailwind CSS 4, TypeScript 5
- **Database:** Supabase (PostgreSQL) with Realtime subscriptions
- **Real-time:** Pusher WebSocket (via padelapi.org) → Railway relay → Supabase
- **Deployment:** Vercel (app + cron jobs), Railway (relay service, padelgod workers)
- **External APIs:** padelapi.org, Premier Padel beforeauth API, YouTube Data API, FIP WordPress API, matchscorerlive.com (OOP/draws), Google News RSS, Anthropic Claude API

## Project Structure

```
src/
  app/
    [locale]/(app)/        # User-facing i18n pages (home, matches, ranking, tournaments, feed, player, match)
    api/
      cron/                # Vercel cron jobs (scores, sync, articles, highlights, rankings, premier-*, social-drafts, oop-monitor, fip-streams-discover)
      admin/               # Protected maintenance endpoints
      ops/                 # Ops dashboard APIs
      feed/                # Article click tracking, video reporting
      match-stats/         # GET endpoint for Stats tab
    components/            # Shared (MatchCard, BottomNav, MatchStatsView, …)
  lib/
    supabase.ts            # Client factory
    score-inference.ts     # Final score inference from point data
    player-resolver.ts     # 5-tier player dedup, auto-stores aliases
    external-id-registry.ts  # Unified lookup API for source IDs
    source-priority.ts     # Per-field source-of-truth rules
    feed-scoring.ts        # Feed ranking + personalization
    notification-icon.ts   # Push notification icon resolver
  proxy.ts                 # Next.js 16 proxy (redirects, auth, geo cookies, i18n composition)
relay/                     # Railway Node.js Pusher → Supabase relay
padelgod/                  # Railway workers (see "Padelgod Workers" below) — PRIMARY data integration
apps/labs/                 # Padel Labs (padellabs.tech) — separate Next.js app, shared Supabase
supabase/migrations/       # SQL migrations
```

## Padel Labs (apps/labs/)

Separate B2B SaaS Next.js app at `apps/labs/`, deployed to `padellabs.tech`. Shares the Supabase project — reads from public tables, writes to `labs_*` tables (`labs_subscriptions`, `labs_conversations`, `labs_messages`, `labs_saved_queries`, `labs_usage_events`, `labs_template_runs`). Independent npm package (no workspaces). See [v1 design](docs/superpowers/specs/2026-05-06-padel-labs-v1-design.md).

## Database Tables

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `matches` | Match data | `padelapi_id`, `status`, `coverage`, `winner_pair`, `pusher_channel`, `round`, `court`, `scheduled_at` |
| `sets` | Set scores | `match_id`, `set_number`, `set_score`, `pair1_games`, `pair2_games`, `is_current`, `score_source` |
| `games` | Game-level data | `set_id`, `match_id`, `game_number`, `game_score`, `points[]`, `is_current` |
| `players` | Player profiles | `padelapi_id`, `fip_id`, `name`, `country`, `avatar_url`, `ranking`, `category`, `normalized_name` |
| `tournaments` | Tournament info | `padelapi_id`, `fip_id`, `name`, `level`, `country`, `logo_url`, `starts_at`, `ends_at`, `source`, `status` |
| `seasons` | Season grouping | `external_id`, `name`, `year` |
| `articles` | News feed | `source_url`, `published_at`, `click_count`, `source_weight`, `favicon_url` |
| `highlights` | YouTube videos | `youtube_id`, `channel_name`, `view_count`, `channel_quality_score` |
| `tournament_draws` | Parsed draws | `tournament_id`, `category`, `draw_position`, `seed`, `marker`, `player1/2_name/id` |
| `entity_external_ids` | Sidecar for non-hot source IDs | `entity_type`, `entity_id`, `source`, `external_id`, `metadata` |
| `match_stats` | Per-match + per-set stats (Crionet canonical) | `(match_id, set_number)` PK (`set_number=0` is aggregate), 34 stat columns, `source`, `raw_payload` |
| `match_stats_unresolved` | Queue for unlinkable Premier match stats | `source`, `source_id`, `reason`, `resolved_at` |
| `social_posts` | Auto-generated draft posts | `title`, `caption`, `hashtags`, `platform`, `pillar`, `status` |
| `player_ranking_snapshots` | Append-only FIP ranking history | `(player_id, type, year, week)` unique, `ranking`, `points`, `ranking_move`, `source` |
| `fip_court_streams` / `fip_streams_unresolved` | FIP YouTube stream mapping + ops queue | (see "FIP YouTube streams") |

### Relationships
- `matches` → `tournaments`, `sets` → `matches`, `games` → `sets` + `matches`
- `matches` has 4 player FKs: `pair1_player1_id`, `pair1_player2_id`, `pair2_player1_id`, `pair2_player2_id`

## Data Model: Canonical IDs & Source Identity

Every entity has a `id UUID` primary key — the **canonical PadelNachos ID**. External source IDs are secondary identifiers.

### Hot columns (top 2 sources per entity, indexed unique)

| Table | Column | Source | Format |
|---|---|---|---|
| `players` | `padelapi_id` | padelapi.org | `"432"` |
| `players` | `fip_id` | FIP official | `"P200038"` (raw, no `fip-` prefix) |
| `tournaments` | `padelapi_id` | padelapi.org | `"778"` |
| `tournaments` | `fip_id` | FIP scraper | `"fip-gold-ponta-delgada-2026"` (slug, prefix kept to avoid collisions) |
| `matches` | `padelapi_id` | padelapi.org | numeric |

Legacy columns (`external_id`, `fip_slug`) still exist and are trigger-synced to the new columns. New code writes to the new columns. Player `fip_id` is the **raw** form — normalize legacy `fip-Pxxx` via `.replace(/^fip-/, '')` if you encounter it in old snapshots.

### Sidecar: `entity_external_ids`

For **any source beyond the top 2** (Premier Padel stats, ATP, future feeds), external IDs go in the polymorphic `entity_external_ids` table. Adding a new source = zero schema changes.

### Unified lookup API — `src/lib/external-id-registry.ts`

Hides the hot-column vs sidecar split:

```ts
import { findEntityBySourceId, registerSourceId, listSourceIds } from '@/lib/external-id-registry'

await findEntityBySourceId(supabase, 'player', 'padelapi', '432')      // hot column
await findEntityBySourceId(supabase, 'player', 'atp',      'abc-123')  // sidecar
await registerSourceId(supabase, { entityType: 'tournament', entityId, source: 'whoscored', externalId: 'ws-42' })
```

### Source priority — `src/lib/source-priority.ts`

**FIP is canonical for player identity. Padelapi enriches.** Padelgod (FIP-sourced) defines who a player is — name, country, category, birthdate. Padelapi adds career stats, hosted avatars, win rate.

Per-field priority lists (top wins):

| Field | Primary | Fallbacks |
|---|---|---|
| `player.name` / `country` / `category` | **fip** | padelapi, manual |
| `player.ranking` | fip_official | fip, padelapi |
| `player.avatar_url` | padelapi | fip, manual *(padelapi-hosted on Supabase Storage)* |
| `player.win_rate` / `total_matches` / `titles` | padelapi | *(FIP doesn't compute)* |
| `tournament.name` | padelapi | fip |
| `tournament.logo_url` / `draw_size_md` | fip | padelapi |
| `match.sets` / `status` | padelapi | simulated *(FIP doesn't do live scoring)* |
| `match_stats` | **crionet** (padelgod) | padelapi, premierpadel |

Full list in `src/lib/source-priority.ts`. Use `filterUpdateByPriority(payload, entityType, source)` when updating from a secondary source — it strips fields that source can't own. Wired into padelapi sync routes and padelgod's `fip-event-page-enricher`.

### Tournament entity resolution (cross-source dedup)

Same tournament can exist under multiple sources with different IDs/names. Matching rule:

1. Normalize name: strip diacritics, strip 4-digit years, lowercase, split on non-alphanumerics
2. Filter noise tokens (`premier`, `padel`, `tour`, `open`, `championship`, …)
3. Token subset match — every current token must appear in candidate set
4. Same year (from `starts_at`) + same `level`

Script: `scripts/merge-tournament-duplicates.ts` (supports `--dry-run`, pre-flight FK check). Prevention is built into `padelgod/src/workers/tournament-discovery.ts` — it does a name-token + year lookup against padelapi-only rows before inserting a new FIP row.

## Scheduled Jobs (Vercel — `vercel.json`)

| Route | Schedule | Purpose |
|-------|----------|---------|
| `/api/cron/scores` | Every 2 min | Live match polling, score upsert, finished reconcile, stale detect |
| `/api/cron/sync?scope=matches` | Hourly :00 | Match metadata for active tournaments |
| `/api/cron/sync` | Mon 4am UTC | Full sync: tournaments, players, seasons, FIP logos |
| `/api/cron/sync-fip-rankings` | Daily 7am UTC | FIP official + race rankings (top 1000, both genders) |
| `/api/cron/sync-articles` | Hourly :40 | News from RSS + FIP WP API |
| `/api/cron/sync-highlights` | Hourly :20 | YouTube highlights |
| `/api/cron/fip-streams-discover` | Every 15 min | FIP YouTube livestream discovery |
| `/api/cron/premier-discovery` | Mon 4am UTC | Link Premier tournaments + matches |
| `/api/cron/premier-stats` | Hourly :13 | Per-set stats from Premier API |
| `/api/cron/social-drafts` | Mon 8am UTC | Generate post drafts via Claude API |
| `/api/cron/oop-monitor` | Every 2h :30 | Watch OOP page changes, emit notifications |
| `/api/cron/recompute-earnings` | Mon 6am UTC | Recompute `player_tournament_earnings` for last 30 days (idempotent UPSERT) |

Most padelapi/Premier crons are gated by `PADELAPI_PAUSED` — see "Ops toggles".

## Padelgod Workers (Railway) — PRIMARY data integration

**Padelgod is the primary integration powering padel data on padelnachos.com.** Tournament discovery, draws, entry lists, OOP, live point-by-point, match closing, results, player profiles, rankings, and the web-push notify fan-out all flow through it. The Vercel crons above are secondary feeds, currently paused behind `PADELAPI_PAUSED=true`.

Schedule lives in [`padelgod/src/scheduler.ts`](padelgod/src/scheduler.ts) — that file is canonical when this table goes stale.

| Worker | Schedule | Purpose |
|---|---|---|
| tournament-discovery | hourly :00 | FIP WP API event discovery |
| fip-winner-propagator | hourly :02 | Propagate winners to next-round slots |
| fip-event-page-enricher | hourly :12 | Gap-fill venue / dates / matchscorer code |
| widget-code-lookup | hourly :15 | Resolve Crionet widget IDs |
| draw-fetcher | every 2h :20 | Crionet bracket scrape |
| match-stats-fetcher | :25, :55 | Per-match stats from Crionet (20/batch × 2/hr) |
| player-profile | hourly :30 | Per-player profile refresh |
| static-reconciler | :05, :35 | Consume snapshots → `public.matches` / `sets` |
| fip-draw-fetcher | hourly :35 | FIP event-page bracket scrape |
| shadow-diff-finalizer | :10, :40 | Telemetry: live vs padelapi divergence |
| fip-draw-linker | hourly :42 | Link FIP draws to widget IDs |
| entry-list-fetcher | hourly :45 | Tournament entry-list PDFs/pages |
| fip-entry-list-populator | hourly :46 | Resolve entry-list rows → `players` |
| fip-draw-populator | hourly :47 | INSERT matches from draw + OOP qualifying |
| oop-fetcher | every 15m | Capture OOP snapshots |
| fip-oop-writer | every 15m (offset +2) | UPDATE court/round from OOP snapshots |
| results-fetcher | every 5m | Capture Crionet results snapshots |
| fip-results-writer | every 5m (offset +2) | Write final scores |
| player-rankings | daily 07:00 UTC | FIP rankings sync |
| live-poller-manager | every 1m | Spawn per-match live-poll loops |
| close-stale-live-sweeper | every 5m | Close matches stuck on `live`/`ended` |

### Disambiguating "OOP" — three different things

| Name | Runtime | What it does |
|---|---|---|
| `oop-monitor` (Vercel) | every 2h :30 | Watches OOP for changes, emits notifications |
| `oop-fetcher` (padelgod) | every 15m | Fetches OOP HTML, writes `padelgod.oop_snapshots` |
| `fip-oop-writer` (padelgod) | every 15m (+2 offset) | UPDATEs `public.matches.court`/`round`/`court_order` from snapshots |

The "OOP Schedule Review" ops dashboard tab is a fourth human-in-the-loop piece — parses `scheduled_label` strings into UTC timestamps on `matches.scheduled_at`. Not automated; operator clicks "Apply N Changes" per tournament.

## Live match coverage scope

**Live point-by-point is Premier-tier only** (P1, P2, Major, Premier_Mens/Womens). Crionet exposes per-match score endpoints at Premier tier; padelgod's `live-poller-loop` subscribes there.

FIP-tier (Bronze/Silver/Gold) matches can flip to `status='live'` via OOP/results widgets or padelapi's coarse status feed — **but no point-by-point data lands**. Final scores arrive later via `fip-results-writer`.

UI consequence: a FIP match can render the LIVE pill and a current-set score, but won't update sets in real time and won't power the momentum chart. Web-push live notify still fires (only needs `scheduled → live` edge).

When designing live-only features, **assume Premier as the floor and gracefully degrade for FIP**. Don't surface live affordances on FIP matches.

## Relay Service (`relay/index.js`)

Always-on Node.js/Express service on Railway (port 3001): persistent Pusher WebSocket subscriptions, writes point-by-point to Supabase, infers missing scores + coverage + winner on match finish. Endpoints: `GET /health`, `POST /sync`, `POST /subscribe`.

## Key Patterns

### Score provenance & merge guards
Sets track `score_source`: `'api'` > `'inferred'` > `'live'`. Higher priority overwrites lower. Before writing a points array, check existing DB array length — keep the longer one. Never overwrite with less data.

### Match status lifecycle
`scheduled` → `live` → `ended` (transitional, score may be null) → `finished` (or `retired` / `walkover` — preserved from API, never hardcoded to `'finished'`).

### Coverage computation
Computed from stored data after match finishes: count games with non-empty points vs expected games from set scores → `full` / `partial` / `null`.

### Winner inference (`src/lib/score-inference.ts`)
When API doesn't provide `winner_pair`, infer from completed set scores (best-of-3, first to 2 sets). Handles 1-set retirements and mid-Set-3 retirements. Atomically sets `status: 'finished'` when winner is inferred (unless retired/walkover).

### Stale match detection
Cron transitions matches stuck as `live` >15min and absent from API live feed → finished.

### Feed scoring (`src/lib/feed-scoring.ts`)
- **Base:** `freshness (exp decay 48h) × popularity (log10 clicks) × source_weight`
- **Modifiers:** stale-year penalty (0.3–0.7x), language affinity (≤1.3x, ≥3 clicks), category preference (1.3/0.7x, ≥5 clicks + >65% dominance), channel engagement (1.15–1.3x), bookmark relevance (1.4–1.8x for bookmarked-player content), channel quality (server-computed)
- **Dedup:** title-token overlap >50% → cluster, show best one with "+N similar"
- User prefs in localStorage: `useFeedPreferences`, `useHiddenFeedItems`

### Avatar hosting
Player avatars are rehosted to Supabase Storage (`avatars` bucket) so push largeIcons don't break on upstream hiccups. Best-effort — not every row is on Supabase Storage at any moment.

Shared helper: [`src/lib/avatar-rehost.ts`](src/lib/avatar-rehost.ts) — `rehostAvatarToSupabase(supabase, playerId, sourceUrl)`. Short-circuits when already on Supabase Storage. Safe to call on every sync run.

Backfill: [`/api/admin/migrate-avatars`](src/app/api/admin/migrate-avatars/route.ts) batches rehosts. Supports `?source=googlestorage` (legacy FPT) and `?source=padelfip` (FIP thumbnails). `?limit=N` for testing. Auth: `Bearer $CRON_SECRET`.

Wired into `/api/admin/sync-fip-rankings` — collects `(playerId, thumbnail)` during resolver loop, rehosts in 20-wide parallel batches afterward.

### Player name aliases
`PlayerResolver` resolution chain: fip_id → external_id → normalized name + category (with ranking/points disambiguation) → fuzzy (≥0.7 token similarity). On fuzzy match, the raw name variant is auto-stored in `entity_external_ids` (source=`alias`) for instant future lookups. `players.normalized_name` is indexed and trigger-populated using `unaccent`.

### Historical rankings
`player_ranking_snapshots` is append-only, keyed by `(player_id, type, year, week)`. Both Vercel `sync-fip-rankings` (writes `official` + `race`, captures `ranking_move`) and padelgod `player-rankings` (writes `official` only, no move) UPSERT — last write wins per ISO week.

Forward-capture only currently. Backfill + derived analytics (`player_ranking_stats` with `peak_rank`, `weeks_at_no1`) are planned — see [docs/superpowers/plans/2026-05-10-ranking-history-capture.md](docs/superpowers/plans/2026-05-10-ranking-history-capture.md).

### Scheduled time pipeline
Match `scheduled_at` comes from multiple sources:
1. PadelAPI `played_at` (date-only) + optional `schedule_label`
2. OOP Schedule Review (ops dashboard) — parses matchscorerlive times → UTC timestamps
3. **Sync cron protection:** padelapi date-only values do NOT overwrite an existing real time. Operator-reviewed times survive hourly syncs.
4. "Followed by" estimation: previous match + 90 min
5. Display: approximate times (from "Not before" / "Followed by") show `*` suffix

### FIP draw pipeline
Eliminates TBD names on FIP tournament matches. Pipeline: PDF upload (ops UI) → `pdf-parse` → `src/lib/draw-parser.ts` (pure function, parses bracket + seeds + Q/WC/LL markers) → `tournament_draws` table. `fip-scores` cron loads draws at start, checks them first (token similarity ≥0.7) before PlayerResolver fallback.

Auth: middleware sets httpOnly `ops_token` cookie on `/ops?token=$CRON_SECRET`. All `/api/ops/*` routes read it; 401 responses include `reason: 'server_misconfigured'` | `'token_mismatch'`.

Config: `next.config.ts` needs `serverExternalPackages: ['pdf-parse']` for pdf-parse in API routes.

### Equipment database
Four tables: `padel_brands`, `padel_rackets`, `player_equipment` (history junction), `racket_clicks` (affiliate tracking). APIs at `/api/ops/{brands,rackets,player-equipment}`, `/api/racket-click`. Ops "Brands & Equipment" tab + "Plays with" player widget.

### SEO
- Dynamic sitemap (`src/app/sitemap.ts`) — tournaments, matches (90d), players
- JSON-LD `SportsEvent` on match/tournament, `Person` on player
- `generateMetadata` per page
- Canonical + hreflang for all 5 locales

### Scroll-triggered animations
Stat bars (match stats, player profile, Last 10, Season monthly) use [`useInViewOnce`](src/hooks/useInViewOnce.ts). 700ms ease-out cubic, row stagger `rowIndex * 80ms`, scaleX/Y from origin. Honors `prefers-reduced-motion`. Reuse this pattern — don't introduce a new animation library.

## Tournament-pill / live-state policy

`tournaments.status` from padelapi reports `'live'` for any in-calendar-window event — it's NOT "matches playing right now". Trust hierarchy for the LIVE pill ([MatchesTournamentGroup.tsx:122](src/components/MatchesTournamentGroup.tsx:122)):

1. `matches.status='live'` on today's match → red **LIVE**
2. `tournaments.status` finished/completed → muted **FINAL**
3. Mixed today (finished + upcoming, no live) → orange **ONGOING** *(day's matches prove play happened)*
4. `tournaments.status='live'/'ongoing'` → orange **ONGOING** *(fallback for rest days)*
5. Only upcoming today → green **UPCOMING**
6. Only finished today → muted **FINAL**

Red pill only when an actual match is live. Home page + tournament detail + spotlight hero all follow this.

## PostgREST 10k cap

PostgREST silently caps single-request responses at the project's `db_max_rows`. **Project is set to 10,000 rows** (defense-in-depth).

Policy:
1. Default cap is 10k project-wide
2. **Reads that can plausibly grow past 10k MUST paginate** via [`src/lib/db-paginate.ts`](src/lib/db-paginate.ts) (mirrored to `padelgod/src/lib/db-paginate.ts`). Examples: cross-tournament aggregations, multi-tournament snapshot scans, archive backfills.
3. Per-tournament reads can stay unpaginated (bounded by tournament size)

```ts
import { paginatedSelect } from '@/lib/db-paginate'
const rows = await paginatedSelect<Row>(
  (start, end) => supabase.from('big_table').select('*').range(start, end),
  { what: 'big_table read' },
)
```

Audit script: `scripts/audit-unranged-selects.ts` (heuristic, not a CI gate).

## Ops toggles

### `PADELAPI_PAUSED` — kill-switch for padelapi/Premier crons

Set to `'true'` in Vercel env vars → these routes return `{ paused: true }` and do zero work:
- `/api/cron/scores` (every 2 min)
- `/api/cron/sync` (hourly + weekly)
- `/api/cron/premier-stats` (hourly :13)
- `/api/cron/premier-discovery` (weekly)

Use when padelapi's writes fight padelgod's logic during an incident. Toggle in Vercel env vars (no deploy needed). Not guarded: FIP-sourced crons, articles/highlights, social-drafts, oop-monitor, etc. Padelgod workers are unaffected.

**Currently ON** — padelgod owns all writes.

Implementation: `src/lib/padelapi-pause.ts` exports `padelapiPausedResponse(cronName)`, called after `CRON_SECRET` auth.

## i18n

- **Library:** `next-intl` with App Router
- **Locales:** `en` (default), `es`, `pt`, `it`, `fr`
- **Config:** `src/i18n/routing.ts` (defineRouting), `src/i18n/request.ts` (server messages), `src/i18n/navigation.ts` (locale-aware Link/useRouter/usePathname)
- **Messages:** `src/messages/{en,es,pt,it,fr}.json`
- **Folder:** all user-facing pages under `src/app/[locale]/`. API/ops/auth routes stay outside.
- **Proxy:** `src/proxy.ts` composes next-intl middleware with auth/redirect/cookie logic. `/auth`, `/ops`, `/admin`, `/api` skip i18n.
- **Prefix:** `localePrefix: 'as-needed'` — no prefix for English
- **Switcher:** `src/components/LocaleSwitcher.tsx` — circular flag button + dropdown

**Typing gotcha for email templates:** when importing JSON for `createTranslator`, use `satisfies Record<Locale, unknown>` — NOT `Record<string, Record<string, unknown>>`. The latter collapses next-intl's `NamespaceKeys` inference to `never`.

## Timezone display

All match/tournament times display in the **user's local timezone** (not UTC, not tournament tz). `src/proxy.ts` sets `geo-timezone` cookie from Vercel's `x-vercel-ip-timezone`. `src/i18n/request.ts` reads it and passes `timeZone` to next-intl. `src/lib/format-patterns.ts` has shared format constants.

## Welcome email

Auth signup sends a localized welcome email (5 locales). Capture in `src/auth.ts` `events.createUser` reads `NEXT_LOCALE` cookie, persists to `profiles.locale`. Sender: `src/lib/email/welcome.ts` — fire-and-forget, Resend `idempotencyKey = welcome-<email>-<locale>` guards against retries. Translations in `src/messages/*.json` under `email.welcome.*`. Preview at `GET /api/admin/preview-welcome-email`.

## Push notification icons

Match notifications carry a per-recipient icon URL (Sofascore-style largeIcon). Resolution:
- **Follow** (user follows a player) → that player's `avatar_url`. Falls back to circuit logo if no avatar.
- **Bookmark** (user bookmarked match) → circuit logo by `tournament.level`: Premier-tier → [`public/branding/premier-padel-star.png`](public/branding/premier-padel-star.png), FIP-tier → [`public/branding/fip-tour-icon.png`](public/branding/fip-tour-icon.png).

Resolver: [`src/lib/notification-icon.ts`](src/lib/notification-icon.ts). Wired into `/api/push/notify` per recipient.

**Web Push** picks up `data.icon` in [`public/sw.js`](public/sw.js) → `NotificationOptions.icon`. Legacy fallback `/padelnachos-logo-v2.png`.

**Android FCM** required a custom `FirebaseMessagingService` ([`android/app/src/main/java/com/padelnachos/app/PadelMessagingService.java`](android/app/src/main/java/com/padelnachos/app/PadelMessagingService.java)) — Firebase Admin SDK doesn't expose `largeIcon` as a URL. The service extends Capacitor's plugin MessagingService, downloads the `icon` URL on a background thread, builds `NotificationCompat.setLargeIcon(bitmap)`, posts via `NotificationManager`. AndroidManifest removes the plugin's default service via `tools:node="remove"`. FCM payload is **data-only** (no `notification` block) so FCM doesn't auto-display before our service runs. Trade-off: app builds shipped before this change won't render data-only pushes.

Test loop:
```bash
curl -X POST http://localhost:3002/api/admin/test-push \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"<email>", "scenario":"premier"}'   # premier | fip | avatar
```

## FIP YouTube streams

`fip_court_streams` + `fip_streams_unresolved` power the "Where to watch" affordance on FIP-tier match rows. Discovery cron `/api/cron/fip-streams-discover` runs every 15 min via the FIP channel's `uploads` playlist (~200 quota units/day). Tier fallback: court stream → tournament-scoped channel search → generic FIP channel URL. Feature-flagged behind `NEXT_PUBLIC_FIP_STREAMS_ENABLED`. Premier matches unaffected — they use the existing `WhereToWatch`.

See [docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md](docs/superpowers/specs/2026-04-30-fip-youtube-streams-design.md).

## Supabase soft recovery

When the Supabase auth client gets wedged after tab idle: `supabase-health.ts` tries **soft recovery** before hard reload (restart auth ticker → re-set session from localStorage → re-probe). `useWakeRefresh.ts` calls `startAutoRefresh()` on tab wake. First click after wake runs a quick probe; failure triggers soft recovery immediately.

## Match-identifier pair sanity check

`padelgod/src/lib/match-identifier.ts::findPadelapiTwin` filters court-matched candidates through `pairsMatchUnordered` when the widget input carries all four player UUIDs. Guards against last-minute court swaps where padelapi holds a stale court and the court-only lookup would hijack an unrelated match. Premier live-poller path skips this (no pair UUIDs). Monitoring signal: `"all padelapi twins on this court rejected by pair mismatch — falling through to pair-based lookup (likely court swap)"`.

## Ops dashboard

Tabs: Ongoing Events, Integration Health, Data Quality, Readiness, Entry Lists, Draw Editor, Simulator, Players, Schedule, Brands & Equipment, Architecture.

- **Players:** search + edit + merge + duplicate scan (rules-based + AI via Claude). Decomposed into 5 components under `src/app/ops/players/` (PlayersTable, FilterChips, BulkActionsBar, PlayerDrawer, types).
- **Schedule:** OOP-based review with human-in-the-loop approval
- **Architecture:** live SVG system diagram of all data integrations

## Environment Variables

```
# Public (browser-safe)
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY

# Server-only
SUPABASE_SERVICE_KEY          # Full DB access (bypasses RLS)
PADELAPI_TOKEN                # padelapi.org API key
CRON_SECRET                   # Protects admin/cron + ops cookie
RELAY_SECRET                  # Relay auth
RELAY_URL                     # Railway relay URL
YOUTUBE_API_KEY               # YouTube Data API
PADELAPI_PAUSED               # Kill-switch (see Ops toggles)
```

## Commands

```bash
npm run dev          # Dev server (localhost:3002)
npm run build        # Production build
npm run lint         # ESLint
npx vitest run src/lib/__tests__/score-inference.test.ts  # Unit tests
```

### Admin endpoints

```bash
# Seed a single tournament
curl "http://localhost:3002/api/admin/seed-tournament?tournament=727"

# Resync recent matches
curl "http://localhost:3002/api/admin/resync"

# Historical backfill (2k req/day budget, ~4 days total). Filters: &season=N &tournament=N &skip_pbp=true
curl "http://localhost:3002/api/admin/backfill-matches?run=true"

# Trigger cron manually (prod)
curl -H "Authorization: Bearer $CRON_SECRET" https://padel-nacho.vercel.app/api/cron/scores
```

All admin endpoints require `Authorization: Bearer $CRON_SECRET`.

## Rate Limits

padelapi.org: 10 req/min, 2,000 req/day, 50,000 req/month. Score Agent tracks request count per run (max 60).

## Important Notes

- `tournaments.status` is a coarse calendar-window signal, NOT "matches playing right now" — see "Tournament-pill / live-state policy"
- `category` on matches: `'men'` vs `'women'`
- Proxy injects `geo-country` + `geo-timezone` cookies from Vercel headers
- `next.config.ts` allows remote images from `storage.googleapis.com` and `jwqaesjjoghzobngxejn.supabase.co`
