# Padelgod — API Schema

**Date:** 2026-04-20
**Status:** Design phase
**Companion to:** `2026-04-20-padelgod-design.md`

This document specifies the full HTTP API surface for Padelgod — both the V1 internal admin API and the V1.5+ public API growth path. All shapes are normative; the implementation plan should follow them directly.

---

## 1. Conventions

### 1.1 Base URL
- Production: `https://padelgod.up.railway.app`
- Local dev: `http://localhost:3002`

### 1.2 Authentication

| API surface | Auth method | Header |
|---|---|---|
| Admin (V1) | Static bearer token | `Authorization: Bearer ${PADELGOD_ADMIN_TOKEN}` |
| Public (V1.5+) | Per-key API token | `Authorization: Bearer pk_live_...` or `X-Api-Key: pk_live_...` |
| `/health` | None | (open for liveness checks) |

### 1.3 Response envelope

**Success (2xx):**
```json
{ "data": <resource or array>, "next_cursor": "opaque-string-or-null" }
```

For single-resource endpoints, `data` is the resource object directly. For list endpoints, `data` is an array and `next_cursor` is present (null when no more pages).

**Error (4xx/5xx):**
```json
{
  "error": {
    "code": "WIDGET_ID_NOT_FOUND",
    "message": "No widget ID extracted yet for tournament 7c3a...",
    "details": { "tournament_id": "tour_8Kx3mPq2RvN5" }
  }
}
```

### 1.4 Standard error codes

| HTTP | code | When |
|---|---|---|
| 400 | `INVALID_INPUT` | Malformed body or query |
| 401 | `UNAUTHENTICATED` | Missing/invalid token |
| 403 | `FORBIDDEN` | Token valid but insufficient scope |
| 404 | `NOT_FOUND` | Resource doesn't exist |
| 404 | `WIDGET_ID_NOT_FOUND` | Tournament exists but no widget ID extracted |
| 409 | `CONFLICT` | State conflict (e.g., resolving an already-resolved player) |
| 422 | `UNPROCESSABLE` | Semantic validation failed |
| 429 | `RATE_LIMITED` | Public API quota exceeded |
| 500 | `INTERNAL_ERROR` | Unhandled exception (with request ID) |
| 502 | `UPSTREAM_ERROR` | Widget/FIP source unreachable |
| 503 | `WORKER_BUSY` | Live poller queue full |

### 1.5 Pagination

Cursor-based on all list endpoints:
- `limit` query param (default 50, max 200)
- `cursor` query param (opaque string from previous response)
- Response includes `next_cursor: string | null`

### 1.6 Timestamps

All timestamps are ISO 8601 UTC: `"2026-04-20T14:32:18.123Z"`.

**Every resource includes `created_at` and `updated_at`.** Public API list endpoints support `?updated_after=<iso8601>` for incremental sync — return only resources where `updated_at > updated_after`.

### 1.6.1 Identifiers

Every resource has two stable identifiers:
- **`id`**: prefixed nanoid (e.g., `mat_aB3cD4eF5gH6`) — canonical, immutable, primary handle in clients
- **`slug`** (where applicable): human-readable URL fragment (e.g., `juan-lebron`, `newgiza-p2-2026`) — mutable, for URL paths only, never for long-term storage

Endpoints that take an identifier accept either: `GET /v1/players/plr_jL9bRwQ7m2Ks` and `GET /v1/players/juan-lebron` are equivalent.

**No source-leaking IDs at top level.** Cross-reference IDs from upstream sources live in an optional `sources` object, e.g., `"sources": { "fip": "P200038" }`. Consumers don't need this; integrators who want to cross-reference do.

### 1.7 Source-agnostic taxonomies

Padelgod uses its own values for enums to avoid leaking source vendor names:
- `tournament.level`: `gold`, `silver`, `bronze`, `beyond_b1/b2/b3`, `promises`, `premier_p1/p2/master/finals`, `championships`
- `match.status`: `scheduled`, `live`, `finished`, `retired`, `walkover`, `suspended`, `cancelled`
- `match.coverage`: `full`, `partial`, `tracking`, `none`
- `player.category`: `men`, `women`, `mixed`

### 1.8 Idempotency

All `POST` write endpoints accept optional `Idempotency-Key` header. Repeated requests with the same key within 24h return the original response (no double-execution).

---

## 2. Admin API (V1)

All admin routes are prefixed with `/admin`. Auth: `Authorization: Bearer ${PADELGOD_ADMIN_TOKEN}`.

### 2.1 Health & meta

#### `GET /health`
Liveness check. No auth required.

**Response 200:**
```json
{
  "data": {
    "status": "ok",
    "uptime_seconds": 12345,
    "version": "0.1.0",
    "parser_version": "fip-widget-1.4.0"
  }
}
```

#### `GET /admin/version`
Detailed version info for ops debugging.

**Response 200:**
```json
{
  "data": {
    "padelgod_version": "0.1.0",
    "node_version": "20.11.0",
    "parsers": {
      "fip_widget": "1.4.0",
      "fip_wp": "1.0.2",
      "youtube": "1.0.0",
      "rss": "1.0.0"
    },
    "build_sha": "c7d0217",
    "deployed_at": "2026-04-19T08:00:00Z"
  }
}
```

---

### 2.2 Scrape jobs

#### `GET /admin/jobs`
List recent scrape job records. Defaults to last 24h.

**Query params:**
| param | type | notes |
|---|---|---|
| `type` | string | `discover`, `widget_id`, `draw`, `oop`, `live`, `rankings`, `profile`, `article`, `youtube` |
| `tournament_id` | UUID | filter to one tournament |
| `status` | string | `queued`, `running`, `success`, `failed` |
| `since` | ISO 8601 | only jobs started after this time |
| `limit` | int | default 50, max 200 |
| `cursor` | string | pagination cursor |

**Response 200:**
```json
{
  "data": [
    {
      "id": "job_jbZ4cD5eF6gH7",
      "job_type": "live",
      "tournament_id": "tour_8Kx3mPq2RvN5",
      "target_url": "https://widget.matchscorerlive.com/screen/resultsbyday/FIP-2026-1234",
      "status": "success",
      "started_at": "2026-04-20T14:32:18Z",
      "completed_at": "2026-04-20T14:32:19Z",
      "duration_ms": 847,
      "error_message": null,
      "parser_version": "fip-widget-1.4.0",
      "raw_payload_id": "pay_xY9aB2cD3eF4"
    }
  ],
  "next_cursor": "eyJpZCI6IjlmM2I..."
}
```

#### `GET /admin/jobs/:id`
Single job detail.

**Response 200:** same shape as a list element above, plus a fully-fetchable `raw_payload_id` link.

**Response 404:** `{ "error": { "code": "NOT_FOUND", ... } }`

---

### 2.3 Tournaments

#### `GET /admin/tournaments`
What Padelgod knows about + current polling state.

**Query params:**
| param | type | notes |
|---|---|---|
| `live_source` | string | `padelapi`, `padelgod` (filter) |
| `polling` | bool | only tournaments currently being polled |
| `status` | string | `upcoming`, `live`, `finished` (derived from matches) |
| `limit`, `cursor` | | standard pagination |

**Response 200:**
```json
{
  "data": [
    {
      "tournament_id": "tour_8Kx3mPq2RvN5",
      "name": "NewGiza P2 2026",
      "level": "premier_p2",
      "starts_at": "2026-04-13T08:00:00Z",
      "ends_at": "2026-04-20T22:00:00Z",
      "live_source": "padelapi",
      "widget_id": "FIP-2026-1234",
      "widget_id_extracted_at": "2026-04-12T03:14:00Z",
      "active_polling": true,
      "last_poll_at": "2026-04-20T14:32:19Z",
      "dictionary_size": 64,
      "scrape_stats_24h": {
        "total": 8643,
        "success": 8612,
        "failed": 31,
        "avg_duration_ms": 743
      }
    }
  ],
  "next_cursor": null
}
```

#### `GET /admin/tournaments/:id`
Drill-in detail for one tournament.

**Response 200:** like list element above, plus:
```json
{
  "data": {
    /* all fields above, plus: */
    "recent_jobs": [/* last 20 ScrapeJob records */],
    "unresolved_players_count": 0,
    "draw_categories_synced": ["men", "women"],
    "oop_days_synced": ["2026-04-13", "2026-04-14", "2026-04-15"]
  }
}
```

#### `POST /admin/tournaments/:id/refresh-widget-id`
Manually trigger Playwright re-extraction of the FIP widget ID.

**Body:** none

**Response 200:**
```json
{
  "data": {
    "tournament_id": "tour_8Kx3mPq2RvN5",
    "old_widget_id": "FIP-2026-1234",
    "new_widget_id": "FIP-2026-1234",
    "extraction_method": "iframe",
    "extracted_at": "2026-04-20T14:35:00Z"
  }
}
```

**Response 404:** widget extraction failed (page didn't expose an ID).

#### `POST /admin/tournaments/:id/refresh`
Force re-scrape draws + OOP + entry list right now.

**Body (optional):**
```json
{ "scopes": ["draws", "oop", "entry_list"] }  /* default: all */
```

**Response 202 (accepted):**
```json
{
  "data": {
    "queued_jobs": [
      { "job_id": "...", "job_type": "draw" },
      { "job_id": "...", "job_type": "oop" }
    ]
  }
}
```

#### `POST /admin/tournaments/:id/widget-id`
Manual widget ID override (when Playwright extraction fails or for manual seeding).

**Body:**
```json
{ "widget_id": "FIP-2026-9999" }
```

**Response 200:**
```json
{
  "data": {
    "tournament_id": "tour_8Kx3mPq2RvN5",
    "widget_id": "FIP-2026-9999",
    "extraction_method": "manual",
    "extracted_at": "2026-04-20T14:35:00Z"
  }
}
```

#### `POST /admin/tournaments/:id/start-polling`
Manually start the live poller for a tournament (normally auto-started when tournament moves to `live`).

**Response 200:**
```json
{
  "data": {
    "tournament_id": "tour_8Kx3mPq2RvN5",
    "polling": true,
    "started_at": "2026-04-20T14:35:00Z",
    "poll_interval_ms": 7000
  }
}
```

#### `POST /admin/tournaments/:id/stop-polling`
Manually stop the live poller.

**Response 200:** `{ "data": { "tournament_id": "...", "polling": false } }`

---

### 2.4 Unresolved players (human review queue)

#### `GET /admin/unresolved-players`
List of widget short-names Padelgod could not auto-resolve.

**Query params:**
| param | type | notes |
|---|---|---|
| `status` | string | `pending` (default), `resolved`, `created_new`, `ignored` |
| `tournament_id` | UUID | filter |
| `limit`, `cursor` | | pagination |

**Response 200:**
```json
{
  "data": [
    {
      "id": "unr_q7r8s9t0u1v2",
      "tournament_id": "tour_8Kx3mPq2RvN5",
      "tournament_name": "NewGiza P2 2026",
      "widget_short_name": "J. Lebrón",
      "partner_short_name": "Chingotto",
      "match_id": "mat_aB3cD4eF5gH6",
      "candidate_player_ids": ["plr_jL9bRwQ7m2Ks", "fip-877"],
      "candidates": [
        { "player_id": "...", "name": "Juan Lebrón Perea", "country": "ES", "ranking": 3 },
        { "player_id": "...", "name": "Mario Lebrón",      "country": "ES", "ranking": 412 }
      ],
      "first_seen_at": "2026-04-20T14:00:00Z",
      "status": "pending"
    }
  ],
  "next_cursor": null
}
```

#### `POST /admin/unresolved-players/:id/resolve`
Link the widget short-name to an existing player. Stores the alias in `entity_external_ids` so future scrapes auto-resolve.

**Body:**
```json
{ "player_id": "plr_jL9bRwQ7m2Ks" }
```

**Response 200:**
```json
{
  "data": {
    "id": "unr_q7r8s9t0u1v2",
    "status": "resolved",
    "resolved_player_id": "plr_jL9bRwQ7m2Ks",
    "resolved_at": "2026-04-20T14:36:00Z",
    "resolved_by": "ops@padelnachos.com",
    "alias_stored": true
  }
}
```

**Response 409:** `{ "error": { "code": "CONFLICT", "message": "Already resolved" } }`

#### `POST /admin/unresolved-players/:id/create`
Create a new player record from the widget data + operator input.

**Body:**
```json
{
  "name": "New Player Full Name",
  "country": "BR",
  "fip_id": "fip-P204321",
  "category": "men",
  "ranking": null
}
```

**Response 201:**
```json
{
  "data": {
    "id": "unr_q7r8s9t0u1v2",
    "status": "created_new",
    "created_player_id": "new-uuid...",
    "alias_stored": true
  }
}
```

#### `POST /admin/unresolved-players/:id/ignore`
Mark as a false positive — don't surface again.

**Body (optional):** `{ "reason": "widget typo, transient" }`

**Response 200:** `{ "data": { "id": "...", "status": "ignored" } }`

---

### 2.5 Raw payloads (debugging)

#### `GET /admin/raw-payloads/:id`
Fetch the captured HTML body for replay/debug. 48h retention.

**Response 200:**
```json
{
  "data": {
    "id": "pay_xY9aB2cD3eF4",
    "scrape_job_id": "job_jbZ4cD5eF6gH7",
    "content_hash": "sha256:abc123...",
    "captured_at": "2026-04-20T14:32:19Z",
    "body": "<html>...</html>",
    "byte_size": 47281
  }
}
```

**Response 404:** payload purged (older than 48h) or never captured.

---

### 2.6 Divergence (Phase 1 dashboard backing)

These endpoints exist only during Phase 1 of the migration. Removed in Phase 3.

#### `GET /admin/divergence`
Side-by-side padelapi vs padelgod for currently-live tournaments.

**Query params:**
| param | type | notes |
|---|---|---|
| `tournament_id` | UUID | filter to one tournament |
| `since` | ISO 8601 | only divergence rows after this time |

**Response 200:**
```json
{
  "data": [
    {
      "match_id": "mat_aB3cD4eF5gH6",
      "tournament_id": "tour_8Kx3mPq2RvN5",
      "padelapi": {
        "score": "6-4 3-2",
        "set_score": "3-2",
        "current_server": null,
        "last_updated_at": "2026-04-20T14:32:15Z"
      },
      "padelgod": {
        "score": "6-4 3-2",
        "set_score": "3-2",
        "current_server": "plr_jL9bRwQ7m2Ks",
        "last_updated_at": "2026-04-20T14:32:18Z"
      },
      "lag_ms": 3000,
      "mismatches": ["current_server"]
    }
  ]
}
```

#### `GET /admin/divergence/summary`
Aggregate metrics for the divergence dashboard.

**Query params:** `since` (default 24h ago), `tournament_id` (optional)

**Response 200:**
```json
{
  "data": {
    "window": { "from": "2026-04-19T14:00:00Z", "to": "2026-04-20T14:00:00Z" },
    "tournaments_compared": 3,
    "matches_compared": 47,
    "padelgod_lag_ms_p50": -200,
    "padelgod_lag_ms_p95": -1500,
    "score_match_rate": 1.0,
    "fields_with_divergence": {
      "current_server": "padelapi=null padelgod=populated (47/47)",
      "court": "match (47/47)"
    }
  }
}
```

Negative lag = Padelgod is *faster* than padelapi.

---

## 3. Public API (V1.5+ growth path)

Versioned at `/v1/...`. Designed-in but not built in V1. All routes accept `Authorization: Bearer pk_live_...` or `X-Api-Key: pk_live_...`. Rate-limited per API key (Upstash Redis counters).

### 3.1 Tournaments

#### `GET /v1/tournaments`
**Query params:** `level`, `status`, `country`, `starts_after`, `ends_before`, `limit`, `cursor`

**Response 200:**
```json
{
  "data": [
    {
      "id": "tour_8Kx3mPq2RvN5",
      "name": "NewGiza P2 2026",
      "slug": "newgiza-p2-2026",
      "level": "premier_p2",
      "country": "EG",
      "starts_at": "2026-04-13T08:00:00Z",
      "ends_at": "2026-04-20T22:00:00Z",
      "logo_url": "https://...",
      "status": "live",
      "uses_golden_point": true,
      "sources": { "fip": "newgiza-p2-2026" },
      "created_at": "2026-01-15T09:00:00Z",
      "updated_at": "2026-04-20T07:14:00Z"
    }
  ],
  "next_cursor": null
}
```

**Tournament `level` taxonomy (source-agnostic):** `gold`, `silver`, `bronze`, `beyond_b1`, `beyond_b2`, `beyond_b3`, `promises`, `premier_p1`, `premier_p2`, `premier_master`, `premier_finals`, `championships`. Internal mapping from FIP source labels lives in code, never appears in API responses.

#### `GET /v1/tournaments/:id`
**Response 200:** full tournament resource including draw categories, court list, current standings.

#### `GET /v1/tournaments/:id/draws`
**Query params:** `category` (`men` | `women`)

**Response 200:**
```json
{
  "data": [
    {
      "category": "men",
      "draw_size": 32,
      "positions": [
        {
          "draw_position": 1,
          "seed": 1,
          "marker": null,
          "team": [
            { "player_id": "plr_jL9bRwQ7m2Ks", "name": "Juan Lebrón", "country": "ES", "ranking": 3 },
            { "player_id": "plr_fC4hN6mP9qR2", "name": "Federico Chingotto", "country": "AR", "ranking": 6 }
          ]
        }
      ]
    }
  ]
}
```

#### `GET /v1/tournaments/:id/oop`
**Query params:** `day` (ISO date), `court`

**Response 200:**
```json
{
  "data": {
    "day": "2026-04-15",
    "courts": [
      {
        "court_name": "Centre Court",
        "matches": [
          {
            "match_id": "mat_aB3cD4eF5gH6",
            "scheduled_at": "2026-04-15T11:00:00Z",
            "scheduled_label": "Not before 11:00",
            "round": "QF",
            "category": "men"
          }
        ]
      }
    ]
  }
}
```

#### `GET /v1/tournaments/:id/matches`
**Query params:** `status`, `category`, `round`, `day`, `limit`, `cursor`

**Response 200:** array of match summaries.

---

### 3.2 Matches

#### `GET /v1/matches/:id`
Full match detail including current score state, set summaries, current server, court.

**Response 200:**
```json
{
  "data": {
    "id": "mat_aB3cD4eF5gH6",
    "tournament_id": "tour_8Kx3mPq2RvN5",
    "category": "men",
    "round": "QF",
    "court": "Centre Court",
    "status": "live",
    "scheduled_at": "2026-04-15T11:00:00Z",
    "started_at": "2026-04-15T11:08:00Z",
    "finished_at": null,
    "winner_pair": null,
    "coverage": "full",
    "current_server_player_id": "plr_jL9bRwQ7m2Ks",
    "duration_seconds": 1620,
    "sources": { "fip": "MQ012" },
    "created_at": "2026-04-13T09:00:00Z",
    "updated_at": "2026-04-15T11:35:00Z",
    "pair1": [
      { "player_id": "plr_jL9bRwQ7m2Ks", "name": "Juan Lebrón", "country": "ES" },
      { "player_id": "plr_fC4hN6mP9qR2", "name": "Federico Chingotto", "country": "AR" }
    ],
    "pair2": [
      { "player_id": "plr_aC3hN5pQ7rS9", "name": "Arturo Coello", "country": "ES" },
      { "player_id": "plr_aT8uV1wX3yZ5", "name": "Agustín Tapia", "country": "AR" }
    ],
    "sets": [
      {
        "set_number": 1,
        "set_score": "6-4",
        "pair1_games": 6, "pair2_games": 4,
        "is_current": false
      },
      {
        "set_number": 2,
        "set_score": "3-2",
        "pair1_games": 3, "pair2_games": 2,
        "is_current": true,
        "current_game": {
          "game_number": 6,
          "game_score": "30-15",
          "server_player_id": "plr_jL9bRwQ7m2Ks"
        }
      }
    ]
  }
}
```

#### `GET /v1/matches/:id/points`
Point-by-point timeline.

**Query params:** `set_number`, `game_number`, `since_point_id`

**Response 200:**
```json
{
  "data": [
    {
      "id": "pnt_p1Q2r3S4t5U6",
      "set_number": 1,
      "game_number": 1,
      "point_number": 1,
      "server_player_id": "plr_jL9bRwQ7m2Ks",
      "winner_pair": 1,
      "score_after": "15-0",
      "is_break_point": false,
      "is_set_point": false,
      "is_match_point": false,
      "is_golden_point": false,
      "captured_at": "2026-04-15T11:08:42Z"
    }
  ],
  "next_cursor": null
}
```

#### `GET /v1/matches/:id/stream`
Server-Sent Events stream for live updates. One event per detected change.

**Headers:**
- `Accept: text/event-stream`
- `Last-Event-ID: <event-id>` for resume

**Stream format:**
```
event: point
id: p1q2...
data: {"set_number":2,"game_number":6,"point_number":4,"score_after":"40-15","winner_pair":1,"server_player_id":"plr_jL9bRwQ7m2Ks"}

event: game
id: g3h4...
data: {"set_number":2,"game_number":6,"winner_pair":1,"new_set_score":"4-2"}

event: status
id: s5j6...
data: {"status":"finished","winner_pair":1}
```

WebSocket variant (`/v1/matches/:id/ws`) emits the same payloads as JSON frames.

---

### 3.3 Players

#### `GET /v1/players`
**Query params:** `country`, `category`, `min_ranking`, `max_ranking`, `name_search`, `limit`, `cursor`

**Response 200:** array of player summaries.

#### `GET /v1/players/:id`
**Response 200:**
```json
{
  "data": {
    "id": "plr_jL9bRwQ7m2Ks",
    "slug": "juan-lebron",
    "name": "Juan Lebrón Perea",
    "display_name": "Juan Lebrón",
    "country": "ES",
    "category": "men",
    "birthdate": "1995-04-21",
    "avatar_url": "https://...",
    "ranking": 3,
    "race_ranking": 5,
    "points": 12450,
    "win_rate": 0.78,
    "total_matches": 287,
    "sources": { "fip": "P200038" },
    "created_at": "2024-08-13T12:00:00Z",
    "updated_at": "2026-04-20T07:14:00Z"
  }
}
```

#### `GET /v1/players/:id/matches`
**Query params:** `status`, `tournament_id`, `since`, `until`, `limit`, `cursor`

**Response 200:** array of match summaries this player participated in.

---

### 3.4 Rankings

#### `GET /v1/rankings`
**Query params:** `type` (`fip` | `race`), `category` (`men` | `women`), `country`, `limit`, `cursor`

**Response 200:**
```json
{
  "data": [
    {
      "rank": 1,
      "player_id": "plr_kL2mN4pQ6rS8",
      "name": "Arturo Coello",
      "country": "ES",
      "points": 14820,
      "category": "men",
      "ranking_type": "fip",
      "snapshot_date": "2026-04-20"
    }
  ],
  "next_cursor": null
}
```

---

### 3.5 News & highlights

#### `GET /v1/articles`
**Query params:** `language`, `category`, `since`, `limit`, `cursor`

#### `GET /v1/highlights`
**Query params:** `channel`, `player_id`, `tournament_id`, `since`, `limit`, `cursor`

Both return paginated arrays of articles/highlights — full shape deferred to V1.5 PR (not on the V1 critical path).

---

## 4. Public API operational concerns (V1.5+, designed-in)

### 4.1 Rate limiting

Per-API-key sliding window via Upstash Redis. Default tiers:
- **Free:** 60 req/min, 10k req/day
- **Pro:** 600 req/min, 1M req/day
- **Enterprise:** custom

Headers on every response:
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 47
X-RateLimit-Reset: 1745170800
```

### 4.2 Caching

Read endpoints return `Cache-Control` headers:
- `/v1/tournaments`, `/v1/players`: `public, max-age=300, s-maxage=600`
- `/v1/matches/:id` (live): `public, max-age=5`
- `/v1/matches/:id` (finished): `public, max-age=3600`
- `/v1/rankings`: `public, max-age=3600`

CDN edge cache (Cloudflare or Vercel) sits in front, keyed by full URL + Authorization presence (auth'd vs unauth'd separately).

### 4.3 Webhooks (V2 — out of scope here, noted for completeness)

Customers register webhook URLs to receive push events. Out of scope for V1.5 too.

### 4.4 OpenAPI spec

Hand-maintained `padelgod-openapi.yaml` checked into the repo, served at `GET /openapi.json`. Drives documentation site (Scalar or Mintlify).

---

## 5. Schema evolution policy

**Admin API:** can change without notice. Internal contract.

**Public API (`/v1/...`):** breaking changes require `/v2/...`. Within v1:
- Adding optional fields to responses: allowed, no version bump
- Adding required request params: not allowed
- Removing fields: not allowed
- Changing field types: not allowed
- Adding new endpoints: allowed
- Deprecation: 6-month notice via `Deprecation` and `Sunset` response headers

---

## 6. Summary

The admin API surface is small and operational — designed for the ops dashboard tabs and human intervention during shadow mode and migration. The public API is fully designed but built incrementally after V1 ships. The shape stays consistent across both: same resources, just different auth + rate-limit + cache treatment.
