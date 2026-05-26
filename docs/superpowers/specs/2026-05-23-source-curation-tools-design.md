# Source Curation Tools — design

**Status:** Design (proposed)
**Author:** Claude (with @GuDenes brainstorming session 2026-05-23)
**Extends:** [2026-05-23-immersive-news-feed-design.md](./2026-05-23-immersive-news-feed-design.md) — the V1 news pipeline this builds on

## 1. Goal

Give operators (and, in Phase 2, end users) the tools to actively grow and maintain the news-source catalog. Today the catalog has 9 hard-coded static sources (8 of which are Google News searches) plus ~120 auto-generated dynamic player/tournament sources. Adding a new direct site requires a SQL `INSERT`; editing requires a SQL `UPDATE`; auto-discovery of new sources doesn't exist; the public submission endpoint has no UI surface.

After this work:

- **Operators** add new sources by pasting a URL — the system auto-detects the type (RSS / WordPress JSON / Google News search), pulls a sample, and operator confirms with one click.
- **Operators** edit existing sources via a drawer — refining Google News queries, disabling dead sources, adjusting weights — without touching SQL.
- **Operators** click "Discover with AI" to surface candidate sources Claude finds via web search. Candidates land in the suggestions queue for review.
- **End users** see a "Suggest a source" affordance in the For You end-of-feed state. Submissions land in the same queue with auto-detection cached for fast operator triage.
- **The system** auto-disables dead/broken/low-yield dynamic sources daily, with a circuit breaker to protect against systemic failures.

## 2. Out of scope (this ship)

- **Source partnership / contract management.** Paid sources, per-source API keys.
- **Per-locale source weight overrides.** Weight is global. A source preferred for ES users vs EN users would need a separate concept.
- **A/B testing source weights** in feed scoring.
- **Cross-source dedup** for the same article published on multiple sites.
- **Operator weekly email digest** summarising changes.
- **Public "recently added sources" page** for transparency.
- **Multi-feed picker** for sites that expose more than one RSS feed (detector picks the first auto-discovered link; operator can manually paste a specific feed URL).
- **Source categorisation taxonomy** beyond the existing `query_kind` enum.

## 3. Approach considered (full ship)

Three approaches were considered during brainstorming:

| Approach | Scope | Time |
|---|---|---|
| **A — Operator-first, minimal** | Add/Edit drawer with paste-and-detect, dead-source cron. Defer AI discovery + public surface to V3. | ~1–2 days |
| **B — Full ship (chosen)** | Everything in A plus AI source discovery via Claude + web search, public "Suggest a source" affordance, source quality scoring, per-source health on the table. | ~4–6 days |
| **C — Minimal API-only** | Just the Add/Edit drawer with manual fields. No detector, no AI, no public surface. | ~half day |

**Chosen: B.** Operator validated they want the public-surface affordance and the AI discovery tool in this ship. Cost cap on AI discovery (3 runs/day, ~$1.50 max) keeps it safe.

## 4. Locked decisions (from clarifying questions)

| # | Question | Decision |
|---|---|---|
| 1 | Primary motivation | Diversify away from Google News — keep it but add specific sites + refine queries |
| 2 | Operator add flow | Paste URL → auto-detect → confirm + save |
| 3 | Operator edit flow | Click row → drawer with all fields editable (Players-page pattern) |
| 4 | Public submission UI | Yes, add a discoverable affordance — end-of-feed sheet |
| 5 | AI discovery output | Lands in the existing Suggestions queue (no separate review surface) |

## 5. Data model

Two additive migrations. No breaking changes.

### 5.1 `news_sources` — add 2 columns

```sql
ALTER TABLE news_sources
  ADD COLUMN extraction_quality_pct REAL,            -- 0..100, NULL if no fetch data yet
  ADD COLUMN auto_disabled_at TIMESTAMPTZ;           -- when dead-source cron disabled (audit trail)
```

`extraction_quality_pct` is denormalized — refreshed daily by the existing `refresh-source-volume` cron from `ops_events`. Used by the Sources table column ("Quality") and the dead-source auto-disable logic.

`auto_disabled_at` lets the UI distinguish "operator-disabled" from "system-disabled" and is the guard that prevents auto-disabling twice (after operator re-enables, the system respects that decision).

### 5.2 `news_source_suggestions` — add 3 columns

```sql
ALTER TABLE news_source_suggestions
  ADD COLUMN submitted_by_kind TEXT NOT NULL DEFAULT 'user'
    CHECK (submitted_by_kind IN ('user', 'ai_discovery')),
  ADD COLUMN detected_type TEXT,                     -- 'rss' | 'wp-api' | 'google-news-search' | 'unknown'
  ADD COLUMN detected_payload JSONB DEFAULT '{}';    -- { name, language, sample_articles[] }
```

Purpose:

- **`submitted_by_kind`** — discriminator. User submissions vs AI-discovered candidates. Same queue, distinct badges in the UI.
- **`detected_type` + `detected_payload`** — cache the detector output so the Suggestions tab renders previews without re-fetching, and the "Approve & Add" button can create the `news_sources` row from cached values.

### 5.3 RLS

| Table | Anonymous | Authenticated | Service role |
|---|---|---|---|
| `news_sources` (new columns) | no access | no access | ALL |
| `news_source_suggestions` (new columns) | INSERT via endpoint only | INSERT via endpoint only | ALL |

No new tables. No RLS changes beyond what already exists.

## 6. Source detector

The core utility. Shared by paste-and-detect (Add drawer), public submissions, and AI discovery candidate verification.

### 6.1 Library: `apps/ops/src/lib/source-detector.ts`

```ts
export type DetectedType = 'rss' | 'wp-api' | 'google-news-search' | 'unknown'

export interface DetectedSource {
  type: DetectedType
  url: string                    // canonical URL (might differ from input — e.g. discovered feed URL from HTML page)
  name?: string                  // from feed metadata or page <title>
  language?: string              // ISO 639-1 — from feed <language>, <html lang>, or TLD heuristic
  sample: Array<{                // 1–3 most recent items so operator can verify
    title: string
    pubDate?: string
    snippet?: string
  }>
  notes?: string                 // operator-visible warnings ("feed is dated, last item 8 months old")
}

export async function detectSource(input: string): Promise<DetectedSource>
```

### 6.2 Detection ladder

Tried in order. First hit wins.

| Step | Action | Network calls |
|---|---|---|
| 1 | **URL pattern match** — `news.google.com/rss/search` → `google-news-search`; `/feed/?` / `.rss` / `/rss/?` / `/atom.xml` → `rss`; `/wp-json/wp/v2/posts` → `wp-api` | 0 |
| 2 | **Content sniff** — GET URL, check `content-type` header + first 256 bytes of body for `<rss`, `<feed`, `<channel>` | 1 |
| 3 | **HTML auto-discovery** (if Step 2 returned HTML) — parse `<link rel="alternate" type="application/rss+xml">`; recurse with discovered URL | 0 (uses Step 2 response) |
| 4 | **Common-path fallback** — try `${base}/feed/`, `${base}/rss/`, `${base}/feed.xml`, `${base}/wp-json/wp/v2/posts?per_page=1` | up to 4 |
| 5 | **Give up gracefully** — return `type: 'unknown'` with `notes` describing what was tried | — |

Total worst-case: 1 + 4 = 5 fetches per detection. Typical: 1–2.

Timeout: 15s total per detection (Vercel function maxDuration default).

### 6.3 Name extraction precedence

1. RSS `<channel><title>`
2. Atom `<feed><title>`
3. WordPress JSON: site title from response metadata
4. HTML `<title>` tag
5. Domain (`sport.es` → `sport.es`)

### 6.4 Language extraction precedence

1. RSS `<language>` element (most reliable)
2. HTML `<html lang>` attribute
3. URL TLD heuristic — `.es` → es, `.fr` → fr, `.it` → it, `.pt` → pt, `.com.br` → pt, `.com` → en (default)

### 6.5 Endpoint

```
POST /api/news-sources/detect           (admin-authed)
Body: { url: string }
Returns: DetectedSource | { error: 'invalid_url' | 'fetch_failed' | 'timeout' }
```

### 6.6 Edge cases accepted in V2

- **Paywalled sites** with no public RSS → `unknown`. Operator skips or contacts site for API access.
- **Sites with multiple feeds** — picks the first `<link rel="alternate">`. Operator can manually paste a category-specific URL.
- **Cloudflare-protected sites** that block our bot → fetch error returned in `notes`. Operator sees the 403.

## 7. Add / Edit drawer (admin UI)

### 7.1 Sources tab — new top-row controls

```
[+ Add Source]  [🔍 Discover with AI]   ⌕ search   filters ▼
─────────────────────────────────────────────────────────────
Key                Name           Type   Lang  Quality  7d
─────────────────────────────────────────────────────────────
▶ google-news-en   Google News    rss    en    ●92%    47
▶ padel-addict     Padel Addict   rss    es    ●88%    23
▶ sport-es-padel   Sport · Padel  rss    es    ●76%    11
▶ news-uk-paywall  PaperWall      rss    en    ●18%    0     ← red, auto-disabled candidate
```

**New filter chips** above the table (each is a button that toggles a server-side filter):

- **Type**: All / RSS / WP-API / Google News (by `source_type`)
- **Language**: All / EN / ES / PT / IT / FR (by `language`)
- **Health**: All / Healthy (quality ≥ 80) / Errors (quality 20–79) / Auto-disabled
- **Source**: All / Static / Dynamic / User-suggested / AI-discovered (by `query_kind`)

### 7.2 Add Source drawer — Stage 1 (paste URL)

```
┌─ Add Source ─────────────────────────────────────  ✕ ┐
│                                                       │
│  Paste a URL — RSS feed, news section, or             │
│  Google News search.                                  │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ https://www.sport.es/.../padel/                  │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│                                  [ Detect → ]         │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Pressing Detect:
- Calls `POST /api/news-sources/detect`
- Loading spinner shown for ~3s typical, ≤15s max
- On `type !== 'unknown'`: transitions in-place to Stage 2
- On `type === 'unknown'`: shows error banner with `notes` from detector + "Use Advanced mode" link that drops to manual-fields form (same drawer)

### 7.3 Add Source drawer — Stage 2 (confirm + tune)

```
┌─ Add Source ─────────────────────────────────────  ✕ ┐
│                                                       │
│  ✓ Detected as RSS feed                               │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Sport · Más Deportes                             │ │   ← Name (editable)
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  URL:    https://www.sport.es/rss/padel.xml          │   ← canonical, editable
│  Type:   RSS                                          │
│  Lang:   ES         [override ▾]                      │
│  Key:    sport-es-padel                              │   ← slug, editable
│                                                       │
│  Sample articles:                                     │
│    • "Galán y Chingotto a la final…"     2h ago      │
│    • "Tapia recibe el premio…"           5h ago      │
│    • "Los nuevos talentos…"             16h ago      │
│                                                       │
│  ▼ Advanced (weight, cadence, lookback, notes)        │
│                                                       │
│                          [ Cancel ]  [ Save Source ]  │
└───────────────────────────────────────────────────────┘
```

**Advanced** (collapsed by default):
- `weight`: number input, default 1.0
- `cadence`: `hourly` / `weekly` dropdown, default `hourly`
- `lookback_days`: default 14
- `query_kind`: `static` / `user-suggested` / `player` / `tournament` / `brand`, default `static` for operator-added
- `notes`: textarea for operator commentary (max 500 chars)

Save → `POST /api/news-sources` with assembled payload → drawer closes → table refreshes → new row highlighted briefly.

### 7.4 Edit drawer (click any row)

Same layout as Stage 2 of Add. Additions:

**Top — health badge row:**
```
●  Quality: 76% over last 30 days   (47 successful / 62 attempts)
   Last fetch: 23 min ago · success · 11 new articles
```

**If `auto_disabled_at` is set:**
```
⚠ Auto-disabled 4 days ago (14d no successful fetches).
[ Re-enable ]   [ Investigate logs → ]
```

**Recent articles preview (below main fields):**
```
─ Last 10 articles from this source ──────────────
  • Galán y Chingotto a la final         2h ago
  • Tapia recibe el premio              5h ago
  • Los nuevos talentos                16h ago
  ... 7 more
```

**Footer buttons:** `[ Delete ]` (left, danger style, requires confirm) · `[ Re-test ]` (re-runs detector) · `[ Cancel ]` · `[ Save ]`

`Delete` is a hard delete via `DELETE /api/news-sources/:id`. Recommended path for cleanup is soft-delete via `enabled = false` to preserve article attribution.

### 7.5 Endpoints summary

| Endpoint | Existing? | Notes |
|---|---|---|
| `POST /api/news-sources/detect` | new | Runs the detector library |
| `POST /api/news-sources` | existing | Add — gains a `from_suggestion_id` optional body field |
| `PATCH /api/news-sources` | existing | Edit |
| `DELETE /api/news-sources/:id` | new | Hard delete (operator confirmation required client-side) |
| `POST /api/news-sources/discover` | new | AI discovery — see §8 |
| `POST /api/news-sources/test-fetch` | existing | Used by Edit drawer's "Re-test" button |

## 8. AI source discovery

### 8.1 Operator flow

```
[Operator clicks "🔍 Discover with AI" in Sources tab]
   ↓
[Modal: pick focus + max candidates]
   ↓
[Claude does web search + verification]   ~$0.50, ~25s total
   ↓
[Candidates land in Suggestions tab tagged ai_discovery]
   ↓
[Operator reviews same as user submissions, one-click Approve & Add]
```

**Critical decision**: AI never directly creates `news_sources` rows. All output lands in `news_source_suggestions` for operator review. Protects against hallucinated URLs and keeps a single review queue.

### 8.2 The modal

```
┌─ Discover Sources with AI ───────────────  ✕ ┐
│                                                 │
│  Find padel news sources you don't already      │
│  ingest. Costs ~$0.50 per run.                  │
│                                                 │
│  Focus:                                         │
│  ( ) Broad — any padel news site                │
│  (●) Specific language:    [ Spanish ▾ ]        │
│  ( ) Brand & equipment news                     │
│  ( ) Official tour press                        │
│  ( ) Custom: ┌──────────────────────────────┐  │
│              │ italian and french sites       │  │
│              └──────────────────────────────┘  │
│                                                 │
│  Max candidates: [ 10 ▾ ]                       │
│                                                 │
│  Last run: 2 days ago · 8 candidates found.     │
│  Daily limit: 1/3 runs used.                    │
│                                                 │
│                   [ Cancel ]  [ Discover → ]    │
└────────────────────────────────────────────────┘
```

### 8.3 Backend implementation

`POST /api/news-sources/discover` (admin-authed). Synchronous, ≤30s.

**Step 1 — Claude call with web_search tool**

```ts
const result = await anthropic.messages.create({
  model: 'claude-sonnet-4-5',
  max_tokens: 2048,
  tools: [{ type: 'web_search_20250305', name: 'web_search' }],
  system: SYSTEM_PROMPT_DISCOVERY,
  messages: [{ role: 'user', content: buildDiscoveryPrompt(focus, maxCandidates) }],
})
```

The `SYSTEM_PROMPT_DISCOVERY` includes:
- List of sources we already ingest (built dynamically from `SELECT key, name, url FROM news_sources WHERE enabled = true`)
- Output schema: JSON array of `{url, name, language, rationale}`
- Quality constraints: "Sites must publish padel content at least weekly. Skip spam, link farms, dead domains. Skip social media (Twitter/Instagram)."

**Step 2 — Filter and verify each candidate**

For each candidate URL Claude returns:

1. **Dedup check**: normalize the URL (lowercase host, strip trailing slash, strip `?utm_*` params) then `SELECT id FROM news_sources WHERE LOWER(url) = $1 OR LOWER(url) = $1 || '/'` — skip if already known. Normalization avoids false-negatives from trivial URL variations (e.g. `https://Sport.es/padel/` vs `https://sport.es/padel`).
2. **Run `detectSource(url)`** from §6 — if `type === 'unknown'`, drop
3. **Recency check**: drop if sample feed items are older than 60 days
4. **Slug check**: `SELECT id FROM news_sources WHERE key LIKE $slug` — skip if a similar key exists

**Step 3 — Persist surviving candidates as suggestions**

```sql
INSERT INTO news_source_suggestions (
  url, note, submitted_by_kind, detected_type, detected_payload, status, created_at
) VALUES (
  $url, $rationale, 'ai_discovery', $detectedType, $detectedPayload, 'pending', now()
)
```

Modal closes with toast: "Found N candidates. [Review in Suggestions tab →]"

### 8.4 Cost guardrails

| Guardrail | Default | Env override |
|---|---|---|
| Max runs/day | 3 | `AI_DISCOVERY_RUNS_PER_DAY` |
| Max candidates per run | 15 | `AI_DISCOVERY_MAX_CANDIDATES` |
| Sonnet `max_tokens` | 2048 | hard-coded |
| Verification timeout per candidate | 10s | hard-coded |

Worst-case cost per day: 3 × $0.50 = $1.50. Below the $50/day overall enrichment-budget alert.

### 8.5 Suggestions tab — unified review

User and AI candidates appear together, distinguished by badge:

```
┌─ Suggestions (8 pending) ────────────────────┐
│                                                │
│  🤖  https://relevo.com/padel                │
│       AI · "Major Spanish sports daily with   │
│             dedicated padel section"          │
│       ✓ Detected as RSS · 3 recent articles   │
│       [ Approve & Add ]   [ Reject ]          │
│                                                │
│  👤  https://padelclub-roma.it                │
│       User · "Italian club blog with news"    │
│       suggested by user@example.com           │
│       ✓ Detected as RSS · 3 recent articles   │
│       [ Approve & Add ]   [ Reject ]          │
│                                                │
└────────────────────────────────────────────────┘
```

**Approve & Add** is one click: creates the `news_sources` row from cached `detected_payload`, marks suggestion `approved` with `approved_source_id = new_source.id`. No re-detection needed.

**Reject** opens optional reason input, marks `rejected`.

## 9. Public "Suggest a source" surface

### 9.1 Placement

For You end-of-feed state — after the user has scrolled past the last article:

```
┌─────────────────────────────────────────┐
│                                          │
│         You're all caught up             │
│                                          │
│      ┌──────────────────────────┐       │
│      │  + Suggest a source       │       │  ← chunky-press button, green
│      └──────────────────────────┘       │
│                                          │
└─────────────────────────────────────────┘
```

Alternatives considered and rejected:
- ❌ FeedTabs row — overcrowds nav
- ❌ Settings menu — doesn't exist as a global affordance
- ❌ AppHeader — removed from immersive mode

### 9.2 The sheet (bottom sheet, mobile-native)

```
┌─────────────────────────────────────────┐
│  ━━━━━                                   │  ← drag handle
│                                          │
│  Suggest a news source                   │
│                                          │
│  Know a padel news site we don't yet     │
│  cover? Paste the URL and we'll add it   │
│  to the For You feed.                    │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ https://...                         │ │  ← URL (required)
│  └────────────────────────────────────┘ │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ Why is this site good? (optional)   │ │  ← note textarea, 500 char max
│  │                                     │ │
│  └────────────────────────────────────┘ │
│                                          │
│  ┌────────────────────────────────────┐ │
│  │ your@email.com (optional)           │ │  ← email
│  └────────────────────────────────────┘ │
│                                          │
│         [ Cancel ]   [ Submit → ]        │
│                                          │
└─────────────────────────────────────────┘
```

### 9.3 Submission flow

1. User types URL, taps Submit
2. Client validates URL pattern (`^https?://`)
3. Sheet shows loading state (~3s — synchronous detector call on server)
4. **POST `/api/feed/suggest-source`** with body `{ url, note?, email? }`
5. Server: rate-limit check (3/day per IP-hash) → 429 if exceeded
6. Server: run `detectSource(url)` synchronously, cache in `detected_type` + `detected_payload`
7. Server: dedup check (same URL normalization as §8.3 — `LOWER(url) match against normalized input` plus a slug-similarity fallback) → if dup, mark suggestion `'duplicate'`
8. Server: INSERT suggestion with `submitted_by_kind = 'user'`, `status = 'pending'` (or `'duplicate'`)
9. Return `{ ok: true, status, detected: { type?, name? } }`

### 9.4 Confirmation states

**Happy path:**
```
✓ Thanks!
We detected this is an RSS feed for "Sport · Más Deportes".
We'll review and add it within a few days.
[ Done ]
```

**Duplicate:**
```
ℹ We already cover this site. Thanks for thinking of us though!
```

**Detection failed:**
```
✓ Got it. We'll take a look. (We weren't able to detect what type of feed this is, so it'll need manual review.)
```

**Rate-limited:**
```
⚠ You've reached today's submission limit (3 per day). Try again tomorrow.
```

### 9.5 i18n keys (5 locales)

Under `foryou.suggest.*`:

| Key | Purpose |
|---|---|
| `button` | "Suggest a source" |
| `title` | "Suggest a news source" |
| `description` | Help text under title |
| `urlLabel` / `urlPlaceholder` | Field labels |
| `noteLabel` | Note field placeholder |
| `emailLabel` | Email field placeholder |
| `submit` / `cancel` | Button labels |
| `successHappy` | ICU template — `"We detected this is {type} for \"{name}\". We'll review and add it within a few days."` The `{type}` placeholder is filled client-side from a small dictionary that translates the detector enum: `rss` → "an RSS feed", `wp-api` → "a WordPress site", `google-news-search` → "a Google News search", `unknown` → "a news source" (also localized per the 5 locales). |
| `successDup` | Duplicate confirmation |
| `successDefault` | Generic acknowledgement when detection failed |
| `errorInvalidUrl` | Client-side validation error |
| `errorRateLimit` | 429 response message |
| `errorGeneric` | Network / 5xx fallback |
| `typeLabel.rss` / `typeLabel.wp-api` / `typeLabel.google-news-search` / `typeLabel.unknown` | Display strings substituted into `{type}` in `successHappy` |

### 9.6 Spam protection

- **Existing**: 3 submissions/day per IP-hash (sha256 of `x-forwarded-for[0]`, first 32 chars)
- **New**: duplicate URL within 30 days from same IP-hash → silently mark `'duplicate'` (don't tip off spammer)
- **Future, out of scope**: Cloudflare Turnstile CAPTCHA if abuse emerges

### 9.7 Feature flag

| Flag | Default in prod | Default in local | Purpose |
|---|---|---|---|
| `suggest_a_source_button` | OFF | ON | Gates the public-facing button. Backend (endpoint, detector, queue) ships independently of UI exposure. |

Lets us flip the button on/off without redeployment.

## 10. Dead-source auto-disable + quality scoring

Extends the **existing** `refresh-source-volume` cron (runs daily 4am UTC). Three steps in one DB pass.

### 10.1 Step 1 — `articles_last_7d` refresh (existing)

Already works. Counts articles per source over last 7 days.

### 10.2 Step 2 — Compute `extraction_quality_pct` (new)

```sql
WITH quality_30d AS (
  SELECT
    source_key,
    100.0 * count(*) FILTER (WHERE last_fetch_status = 'success') / count(*) AS pct,
    count(*) AS attempts
  FROM ops_events
  WHERE kind = 'news_source.fetch.health'
    AND created_at > now() - interval '30 days'
  GROUP BY source_key
)
UPDATE news_sources s
SET extraction_quality_pct = q.pct
FROM quality_30d q
WHERE s.key = q.source_key
  AND q.attempts >= 5;     -- require ≥5 fetches for a stable signal
```

Sources with <5 fetches in 30 days keep their previous value (or NULL if brand-new).

### 10.3 Step 3 — Auto-disable dead sources (new)

```sql
UPDATE news_sources
SET
  enabled = false,
  auto_disabled_at = now(),
  notes = COALESCE(notes || E'\n', '') || 'Auto-disabled: ' || $reason
WHERE enabled = true
  AND query_kind != 'static'        -- never touch operator-curated static
  AND auto_disabled_at IS NULL       -- don't re-disable; operator's re-enable wins
  AND (
       last_fetch_at < now() - interval '14 days'                                      -- "dead": 14d silence
    OR (last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days')     -- "broken": week of errors
    OR (extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days')     -- "low-yield": <20% + week of errors
  )
RETURNING id, key, name, $reason
```

| Trigger | Reason text |
|---|---|
| `last_fetch_at < now() - interval '14 days'` | `'14d no successful fetches'` |
| `last_fetch_status = 'error' AND last_fetch_at < now() - interval '7 days'` | `'7d of consecutive errors'` |
| `extraction_quality_pct < 20 AND last_fetch_at < now() - interval '7 days'` | `'low quality (<20%) + 7d errors'` |

**Hard guards:**

- ❌ Never auto-disable `query_kind = 'static'` — those are operator-curated
- ❌ Never auto-disable twice — if `auto_disabled_at IS NOT NULL`, system has already touched this source; respect operator's subsequent decision

### 10.4 Circuit breaker (protects against systemic failures)

Before the disable step, count candidates. If >30% of currently-enabled sources are candidates, **skip and alert**:

```sql
WITH candidates AS (
  SELECT count(*) AS n FROM news_sources WHERE enabled = true AND <trigger conditions>
), total AS (
  SELECT count(*) AS n FROM news_sources WHERE enabled = true
)
SELECT
  c.n AS candidates, t.n AS total,
  CASE WHEN t.n > 0 AND c.n::float / t.n > 0.3 THEN 'SKIP' ELSE 'OK' END AS status
FROM candidates c, total t
```

On `'SKIP'`: log `ops_events` with `kind = 'news_source.auto_disable.skipped_circuit_breaker'` and bail. Operator sees the alert in the Discovery Health tab.

**Why**: if our extractor breaks (jsdom-style) or there's a Vercel outage, all sources show as errors. Without this guard, the cron auto-disables the entire catalog overnight.

### 10.5 Logging

Per disable run:

| Event | Metadata |
|---|---|
| `news_source.auto_disable.run` | `{ disabled_count, candidate_count, total_enabled }` |
| `news_source.auto_disable.skipped_circuit_breaker` | `{ candidate_count, total_enabled, threshold: 0.3 }` |
| `news_source.auto_disabled` (per source) | `{ source_key, source_name, reason, last_fetch_at, quality_pct }` |

## 11. Observability + alerts

### 11.1 Events to log (`ops_events`)

| Event | Metadata | When |
|---|---|---|
| `news_source.detect.success` | `{ url, type, name, language, sample_count }` | Detector returns real result |
| `news_source.detect.failed` | `{ url, reason }` | Detector returns `unknown` or errors |
| `news_source.added` | `{ source_key, source_name, source_type, added_by_kind: 'operator'\|'suggestion'\|'ai_discovery' }` | New row in `news_sources` |
| `news_source.edited` | `{ source_key, fields_changed[] }` | Operator saves edit drawer |
| `news_source.auto_disabled` | `{ source_key, reason, quality_pct, last_fetch_at }` | Per source in auto-disable run |
| `news_source.auto_disable.skipped_circuit_breaker` | `{ candidate_count, total_enabled, threshold }` | Circuit breaker fired |
| `feed.suggest_source.received` | `{ url, has_email, detected_type, status }` | Public submission landed |
| `news_source.ai_discovery.run` | `{ focus, max, candidates_found, candidates_kept, cost_usd }` | Operator hit Discover with AI |

### 11.2 Alerts

| Condition | Channel | Severity |
|---|---|---|
| `news_source.auto_disable.skipped_circuit_breaker` fires | Sentry → PagerDuty | **High** — systemic failure |
| AI discovery cost > $5 in 24h | Slack only | Medium — budget guardrail |
| >50 public submissions/hr from same /24 IP block | Slack only | Medium — spam attempt |
| Quality dropped >20% in 24h for a source with `articles_last_7d >= 20` | Slack only | Low — operator triage |

### 11.3 Discovery Health tab — new panels

Existing panels: total/enabled/static/dynamic/dead-7d counters + top-20 by volume.

Adding:

1. **Quality distribution chart** — small horizontal bar showing source count by bucket (green ≥80, orange 50–79, red <50, gray=NULL)
2. **Recent auto-disables panel** — last 10 auto-disabled sources with reason + re-enable button + 30d quality
3. **AI discovery history panel** — last 5 runs (date, focus, candidates_found, candidates_approved, cost)
4. **Volume sparkline per top-10 source** — 30-day trend so operator spots drift before it becomes a dead source

## 12. Rollout sequence

| Day | Action | Verification |
|---|---|---|
| **0** | Migrations applied. New endpoints live (`detect`, `discover`, `DELETE :id`). Add Source + Discover with AI buttons live. Public submission backend live. `suggest_a_source_button` OFF in prod. | Operator can add a source via paste-and-detect. Quality column populated within 24h. |
| **0–3** | Operator dogfoods admin tooling. Adds 10–20 new sources manually. Runs AI discovery 2–3 times, approves good candidates. | No false-positive auto-disables. Quality column shows reasonable distribution. |
| **4** | Flip `suggest_a_source_button` ON if dogfood looks good. Public users can submit. | First user submissions land in the queue with detection cached. |
| **7** | Review first week of public submissions. Tune quality thresholds if needed. | Spam rate within acceptable range. False-positive duplicates < 5%. |

### 12.1 Rollback

- Flip `suggest_a_source_button` OFF → public button hidden immediately, no deploy
- Disable the auto-disable cron at the vercel.json level → keep quality scoring, drop auto-disable
- Drop the new columns → revert migration (additive only — safe to drop)

## 13. Cost projection

| Item | Daily |
|---|---|
| AI discovery (up to 3 runs × $0.50) | up to $1.50 |
| Detection (HTTP fetches only) | ~$0 |
| Detection on user submissions (~10/day initial estimate) | ~$0 |
| Existing enrichment (continuous mode) | ~$0.50–1.50 |
| **Total estimated** | **~$2–3/day ($60–90/month)** |

Well within the existing $50/day enrichment alert threshold.

## 14. Files to change

### 14.1 New files

| Path | Purpose |
|---|---|
| `supabase/migrations/20260524_source_curation.sql` | Two ALTERs (§5) |
| `apps/ops/src/lib/source-detector.ts` | Detection library (§6) |
| `apps/ops/src/app/api/news-sources/detect/route.ts` | Detector endpoint (§6.5) |
| `apps/ops/src/app/api/news-sources/[id]/route.ts` | DELETE handler (§7.5) |
| `apps/ops/src/app/api/news-sources/discover/route.ts` | AI discovery endpoint (§8) |
| `apps/ops/src/app/(app)/news-sources/AddSourceDrawer.tsx` | Add drawer UI (§7.2–§7.3) |
| `apps/ops/src/app/(app)/news-sources/EditSourceDrawer.tsx` | Edit drawer UI (§7.4) |
| `apps/ops/src/app/(app)/news-sources/DiscoverWithAIModal.tsx` | AI discovery modal (§8.2) |
| `apps/ops/src/app/(app)/news-sources/SourceFilters.tsx` | Filter chips (§7.1) |
| `src/components/feed/foryou/SuggestSourceSheet.tsx` | Public sheet (§9.2) |
| `apps/ops/src/lib/discovery-prompt.ts` | Claude system prompt + prompt builder for AI discovery (§8.3) |

### 14.2 Modified files

| Path | Change |
|---|---|
| `apps/ops/src/app/(app)/news-sources/SourcesTable.tsx` | Click row → open EditSourceDrawer; render new Quality column; render filter chips |
| `apps/ops/src/app/(app)/news-sources/SuggestionsTable.tsx` | Render `submitted_by_kind` badge; render `detected_payload` preview; wire Approve & Add to use cached detection |
| `apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx` | Add 4 new panels (§11.3) |
| `apps/ops/src/app/api/news-sources/route.ts` | POST: accept `from_suggestion_id` to link new source to suggestion + mark suggestion approved |
| `apps/ops/src/lib/news-sources-queries.ts` | Add `deleteNewsSource`, helpers for detected payload caching |
| `src/app/api/feed/suggest-source/route.ts` | Run `detectSource()` synchronously, cache in `detected_type` + `detected_payload`, return detection result in response |
| `src/app/api/cron/refresh-source-volume/route.ts` | Add Step 2 (quality scoring) and Step 3 (auto-disable with circuit breaker) per §10 |
| `src/lib/feature-flags.ts` | Add `SUGGEST_A_SOURCE_BUTTON` to `FLAG_KEYS` |
| `src/components/feed/foryou/ForYouTab.tsx` | Render "Suggest a source" button in end-of-feed state when flag resolves true |
| `src/messages/{en,es,pt,it,fr}.json` | Add `foryou.suggest.*` keys per §9.5 |

## 15. Testing plan

### 15.1 Unit tests (Vitest, Node env)

- `apps/ops/src/lib/__tests__/source-detector.test.ts` — pure-logic tests with canned fixtures
  - Pattern match (Google News URL → `google-news-search`)
  - HTML auto-discovery (parse `<link rel="alternate">`)
  - Common-path fallback (mock `${base}/feed/` returning RSS)
  - Language extraction precedence
  - `unknown` return on completely opaque URL

### 15.2 Manual smoke tests

- **Add Source happy path**: paste `https://padeladdict.com/feed/` → confirm RSS detected → save → row appears in table
- **Add Source unknown URL**: paste a random homepage with no RSS → see error banner + Advanced mode link
- **Edit Source refine query**: open existing `google-news-en`, modify URL query to be more specific, Re-test, save → next cron picks up new query
- **Edit Source auto-disabled**: find an auto-disabled source, click Re-enable, verify next-day cron does NOT re-disable (audit `auto_disabled_at` is set)
- **AI discovery**: click Discover with AI, pick Spanish focus, max 10 → wait ~25s → verify candidates land in Suggestions with `ai_discovery` badge
- **Approve & Add from suggestion**: click Approve & Add on an AI-discovered candidate → verify source created with detected metadata
- **Public submission**: with flag ON in local, visit `/feed?tab=foryou`, scroll to last article, tap Suggest a source, submit a URL → verify it appears in admin Suggestions tab with auto-detection cached
- **Rate-limit hit**: submit 3 URLs from same IP in 24h, 4th returns 429
- **Circuit breaker**: temporarily break the extractor (e.g. point ANTHROPIC_API_KEY to nothing) so all sources error → run auto-disable cron manually → verify it skips and emits the circuit-breaker event

### 15.3 Cost verification (post-rollout)

48h of dogfood. Pull `news_source.ai_discovery.run` events from `ops_events`, sum `cost_usd`. Verify daily cost is within projection ($1.50 worst case).

## 16. Future work (V3+)

- **Source partnership management** — paid sources with per-source API keys, contract dates, billing reporting
- **Per-locale source weighting** — same source could be weighted differently per user locale
- **A/B testing source weights** — test whether boosting certain sources improves engagement
- **Cross-source dedup** — detect when the same article appears on multiple sites, prefer one canonical
- **Operator weekly email digest** — sources added, auto-disabled, AI discovery results
- **Public "recently added sources" page** — transparency for users + community goodwill
- **Multi-feed picker** — for sites with multiple RSS feeds, operator picks which one(s) to ingest
- **Source quality ML** — predict which sources will yield high-engagement articles based on past performance

## 17. Open questions / risks

| # | Question / risk | Mitigation |
|---|---|---|
| 1 | **AI hallucinated URLs** — Claude returns fake but plausible URLs | All AI output goes through detector verification (§8.3 Step 2). Dead URLs caught at verification, never become suggestions. |
| 2 | **Web search tool availability** in Anthropic SDK at deploy time | Confirm `web_search_20250305` tool is GA before implementation. If still beta, gate behind env flag and fall back to disabling the button. |
| 3 | **Auto-disable false positives** — e.g. site has scheduled maintenance | Circuit breaker (§10.4) protects against systemic. Per-source: operator can re-enable; `auto_disabled_at` guard prevents repeat auto-disable. |
| 4 | **Quality metric noise** — sources with <5 fetches show NULL quality | UI renders NULL as gray dot with hover "Not enough data yet". Threshold (5 fetches) avoids false reds. |
| 5 | **Public submission abuse** — bot floods endpoint despite rate limit | Existing 3/day/IP rate limit + new duplicate-URL silent-drop. If abuse persists, add Turnstile (out of scope for V2). |
| 6 | **Detection cost on user submissions** — synchronous detector adds 3s to API response | Acceptable for V2 (user is OK waiting briefly for "we got it"). If response time becomes an issue, move detection to a background job and respond immediately with "we'll review". |
| 7 | **Detector false-positive** — finds wrong feed via HTML auto-discovery | Sample articles in the operator review preview catch this. Operator sees the feed content before approving. |

## 18. References

- Brainstorming session (this conversation, 2026-05-23)
- Existing spec: [2026-05-23-immersive-news-feed-design.md](./2026-05-23-immersive-news-feed-design.md)
- Existing pipeline: [src/app/api/cron/sync-articles/route.ts](../../../src/app/api/cron/sync-articles/route.ts)
- Existing detector callsite (sync-articles): GoogleNewsDecoder for URL resolution
- Anthropic web_search tool: https://docs.anthropic.com/en/docs/build-with-claude/tool-use/web-search-tool
- Ops UI pattern reference: `apps/ops/src/app/(app)/players/` (drawer pattern source of truth)
