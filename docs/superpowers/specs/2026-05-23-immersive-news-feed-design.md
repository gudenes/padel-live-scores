# Immersive "For You" News Feed — design

**Status:** Design (proposed)
**Author:** Claude (with @GuDenes brainstorming session 2026-05-23)
**Related:** [2026-05-17-feed-tabs-design.md](./2026-05-17-feed-tabs-design.md) (extends), [2026-05-08-first-party-news-section-design.md](./2026-05-08-first-party-news-section-design.md) (sibling)

## 1. Goal

Add a swipeable, full-screen, AI-summarized "For You" tab to `/feed` that turns the existing third-party `articles` corpus into an immersive padel-first news experience — competitive with LiveScore/Sofascore on UX, distinct from them on padel-native depth.

Two outcomes:

1. **User-facing**: a single-article-per-screen feed. Hero image, 3–4 AI-generated bullet points, big "Read original" CTA. Vertical swipe = next article. Calm visual language using the established `CHUNKY` clip-paths.
2. **Backend** (the larger long-term value): every ingested article is tagged with the players, tournaments, and brands it mentions, then summarized into Markdown bullets and translated to 5 locales. The entity tags power "Latest news mentioning X" widgets on player/tournament/brand pages, sharpen feed-scoring personalization, and feed push triggers.

V1 ships entity tags **in the database only** — no chips on the card. V2 reconsiders chip visibility once we have production-quality data to audit.

## 2. Out of scope (V1)

- **Entity chips on the card.** Tags live in DB only. Revisit V2.
- **Bottom-nav promotion of For You.** V1 lives as a tab inside `/feed` (added to [`FeedTabs`](../../../src/components/feed/FeedTabs.tsx)). Promotion to its own bottom-nav slot is a separate decision post-launch.
- **Editorial / human review** of summaries or translations. Fully automated via Claude API.
- **User-customizable feed preferences** specific to For You (player follows, tournament follows). Reuses existing [`useFeedPreferences`](../../../src/hooks/useFeedPreferences.ts) localStorage state.
- **Per-article comments or reactions** beyond the existing bookmark/share.
- **Cross-locale UX experiments.** All locales get the same UI and the same enrichment pipeline.
- **Real-time/breaking-news push** triggered by entity tagging. Push triggers from entity data are a separate work item.
- **Audio / TTS summaries.**
- **Video cards in the immersive view.** YouTube highlights stay on the existing `Videos` tab. For You is articles-only.

## 3. Approaches considered

| Approach | Card layout | What it asks of the user | Why we picked / rejected |
|---|---|---|---|
| **A — LiveScore-faithful** | Full-bleed photo card, minimal chrome, 1 headline + 2-line summary, swipe up | Just swipe. Read or move on. | Rejected as base — sets a low ceiling. We have data they don't. |
| **B — Padel-native immersive** ✓ | Full-bleed hero, 3-4 AI bullets, AI summary tag, big "Read original" CTA | Swipe up = next, tap "Read original" = source | **Picked.** Same immersive promise, more substance. Pulls our padel-native data into the surface. |
| **C — Hybrid (rejected variant)** | Photo + summary + chips on card | More tappable, more info dense | Rejected — chips on card carry a false-positive risk early on (10-15% mismatch at 0.85 confidence threshold), visual budget tax, and users already have search/follow as paths to player pages. Tag data lives in DB and powers other surfaces instead. |

The trade-off conversation is captured in [content/hifi-mockup-v8.html](../../../.superpowers/brainstorm/33284-1779514619/content/hifi-mockup-v8.html) — side-by-side phones, with-chips vs no-chips.

## 4. Locked decisions

The 9 clarifying questions answered during brainstorming:

| # | Question | Decision |
|---|---|---|
| 1 | Card layout direction | Variant B (padel-native immersive) |
| 2 | Global AppHeader in immersive mode | Hidden — back-chip top-left, topic chip next to it |
| 3 | Article source attribution | Source name + favicon in meta row above headline |
| 4 | "Read original" CTA placement | Side rail (right edge, vertical stack with Save / Share / Source) |
| 5 | CTA visual style | Chunky-press — clip-path + drop-shadow + press animation, **no shine** |
| 6 | CTA size | 46×44 (icon 15px + label 8px) |
| 7 | Entity chips on card | None in V1 — reconsider V2 |
| 8 | Swipe hint color/position | Muted-white label (`rgba(255,255,255,0.5)`) + brand-green up-arrow above; `bottom: 76px`; `pointer-events: none` |
| 9 | For You routing in V1 | Tab inside `/feed`, NOT a bottom-nav slot |

## 5. Data model

### 5.1 `articles` table — extend

Three new columns on the existing `articles` table:

```sql
ALTER TABLE articles
  ADD COLUMN summary_md TEXT,
  ADD COLUMN summary_translations JSONB DEFAULT '{}'::jsonb,
  ADD COLUMN enrichment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed', 'skipped')),
  ADD COLUMN enriched_at TIMESTAMPTZ,
  ADD COLUMN enrichment_error TEXT,
  ADD COLUMN enrichment_model TEXT;        -- e.g. 'claude-sonnet-4-5'

-- Index for the enrichment cron's "what's pending" query
CREATE INDEX idx_articles_enrichment_pending
  ON articles (created_at DESC)
  WHERE enrichment_status = 'pending';

-- Index for the For You tab's "show only enriched" query
CREATE INDEX idx_articles_enriched_published
  ON articles (published_at DESC)
  WHERE enrichment_status = 'enriched';
```

`summary_md` holds the canonical English-extracted summary as Markdown with 3–4 `•`-prefixed bullets. `summary_translations` is a JSONB map `{ "es": "...", "pt": "...", "it": "...", "fr": "..." }` produced by Haiku.

### 5.2 `article_entities` — junction table (new)

Records every player/tournament/brand mentioned in an article. Polymorphic, mirrors the `entity_external_ids` pattern.

```sql
CREATE TABLE article_entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id    UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('player', 'tournament', 'brand')),
  entity_id     UUID NOT NULL,                   -- references players.id / tournaments.id / padel_brands.id
  mention_text  TEXT NOT NULL,                   -- the verbatim string that resolved here, e.g. "Tapia"
  confidence    REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, entity_type, entity_id)
);

-- Lookup: "all articles mentioning Tapia"
CREATE INDEX idx_article_entities_lookup
  ON article_entities (entity_type, entity_id, created_at DESC);

-- Reverse lookup: "all entities for this article"
CREATE INDEX idx_article_entities_by_article
  ON article_entities (article_id);
```

No foreign key on `entity_id` because the target table varies. Soft integrity — if a player gets merged/deleted, the resolver re-runs catch the drift. Audit script `scripts/audit-article-entities-orphans.ts` runs weekly.

### 5.3 `article_topics` — junction table (new)

Coarse categorical tags (`'transfer-news'`, `'result-recap'`, `'preview'`, `'profile'`, `'controversy'`, `'olympics'`, `'business'`). One article can have multiple topics.

```sql
CREATE TABLE article_topics (
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  confidence  REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (article_id, topic)
);

CREATE INDEX idx_article_topics_topic
  ON article_topics (topic, article_id);
```

The topic vocabulary is closed — defined as a TS const in `src/lib/article-topics.ts` and passed to Claude as part of the system prompt. Closed vocabulary keeps the analytics tractable.

### 5.4 `news_sources` — operator-managed source catalog (new)

Replaces the hard-coded `SOURCES` array in [`sync-articles/route.ts`](../../../src/app/api/cron/sync-articles/route.ts).

```sql
CREATE TABLE news_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,           -- e.g. 'google-news-en', 'dyn-player-{uuid}-en'
  name            TEXT NOT NULL,                   -- display name in ops UI
  url             TEXT NOT NULL,                   -- RSS or WP-API endpoint
  source_type     TEXT NOT NULL CHECK (source_type IN ('rss', 'wp-api', 'google-news-search')),
  language        TEXT NOT NULL,                   -- 'en', 'es', 'pt', 'it', 'fr'
  weight          REAL NOT NULL DEFAULT 1.0,       -- feed-scoring multiplier
  lookback_days   INTEGER NOT NULL DEFAULT 14,
  cadence         TEXT NOT NULL CHECK (cadence IN ('hourly', 'weekly')),

  -- Dynamic-source provenance (null for static sources)
  query_kind      TEXT CHECK (query_kind IN ('static', 'player', 'tournament', 'brand', 'user-suggested')),
  query_entity_id UUID,                            -- player/tournament/brand id; null for static + user-suggested
  query_template  TEXT,                            -- 'padel ${player_name}' etc.

  -- Lifecycle
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT,                            -- operator email or 'system' for dynamic
  notes           TEXT,                            -- operator notes

  -- Health (updated by crons)
  last_fetch_at   TIMESTAMPTZ,
  last_fetch_status TEXT CHECK (last_fetch_status IN ('success', 'error', 'empty')),
  last_fetch_error TEXT,
  articles_last_7d INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_news_sources_cadence_enabled
  ON news_sources (cadence, enabled)
  WHERE enabled = true;

CREATE INDEX idx_news_sources_query
  ON news_sources (query_kind, query_entity_id)
  WHERE query_kind IS NOT NULL;
```

### 5.5 `news_source_suggestions` — public submission queue (new)

```sql
CREATE TABLE news_source_suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url           TEXT NOT NULL,
  note          TEXT,
  suggested_by_email TEXT,
  suggested_by_ip TEXT,                            -- for rate-limiting
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate')),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  approved_source_id UUID REFERENCES news_sources(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_news_source_suggestions_pending
  ON news_source_suggestions (created_at DESC)
  WHERE status = 'pending';
```

### 5.6 RLS

| Table | Anonymous role | Authenticated | Service role |
|---|---|---|---|
| `articles` (existing cols) | SELECT (current behavior preserved) | SELECT | ALL |
| `articles` (new cols) | SELECT | SELECT | ALL |
| `article_entities` | SELECT | SELECT | ALL |
| `article_topics` | SELECT | SELECT | ALL |
| `news_sources` | **no access** | **no access** | ALL |
| `news_source_suggestions` | INSERT only (via dedicated endpoint, not direct) | INSERT only | ALL |

`news_sources` is operator-only. Suggestions are insert-only for end users.

## 6. Ingestion pipeline

### 6.1 Existing flow (today, status quo)

[`/api/cron/sync-articles`](../../../src/app/api/cron/sync-articles/route.ts) runs hourly :40. Loops a hard-coded `SOURCES` array, parses RSS/WP-API, upserts into `articles`. Each new row gets a title-translation Haiku call before save. The `enrichment_status` column (new) defaults to `'pending'`.

### 6.2 Enrichment cron (NEW) — `/api/cron/enrich-articles`

Runs every 15 minutes. Picks up to 20 articles where `enrichment_status='pending'`, oldest first. For each:

**Step 1 — Fetch full body.** HTTP GET the `source_url`. Apply [Mozilla Readability](https://github.com/mozilla/readability) via JSDOM to extract clean article body. If body < 500 chars or fetch fails (4xx / 5xx / timeout) → set `enrichment_status='failed'`, log reason in `enrichment_error`, move on.

**Step 2 — Claude Sonnet call.** Single structured tool-use call. System prompt:

```
You are extracting structured padel news data from an article body.
Return a single JSON object matching this schema (no prose):

{
  "summary_md": "• bullet 1\n• bullet 2\n• bullet 3",     // 3-4 bullets, English, max 25 words/bullet
  "entities": [
    { "type": "player|tournament|brand", "mention": "verbatim string from article", "confidence": 0.0-1.0 }
  ],
  "topics": [
    { "topic": "one of: transfer-news|result-recap|preview|profile|controversy|olympics|business",
      "confidence": 0.0-1.0 }
  ]
}

Rules:
- Bullets MUST start with • and a space.
- Bold key terms with **markdown bold**.
- Confidence on entities reflects how sure you are it's THIS specific person/event,
  not just that the name appears. "García" alone in a tournament context with no
  first name → 0.6. "Federico Chingotto" → 0.95.
- Don't invent entities. Only return mentions that appear in the article.
```

Input: article body (truncated to 8000 tokens if longer) + headline.

Sonnet selected over Haiku because entity-resolution accuracy is the long-term value driver — getting Tapia vs Tapia Jr right is worth the per-article cost premium.

**Cost math (Sonnet 4.5 at $3/MTok input, $15/MTok output):**
- Average article: ~3500 input tokens (after Readability + 8k truncation), ~450 output tokens
- Per-call cost: `(3500 × 3 + 450 × 15) / 1M = $0.017`
- Plus Haiku translation: ~$0.001/article
- **Per article total: ~$0.018**

| Throughput | Daily | Monthly |
|---|---|---|
| Steady-state (~25/hr) | $11 | $325 |
| Tournament-week spike (~50/hr) | $22 | n/a (transient) |
| Worst-case (cron at max 80/hr × 24) | $35 | n/a (capped by 20-per-run batch) |

Alert at $50/day catches anything outside this envelope.

**Step 3 — Resolve entities.** For each `{ type, mention, confidence }`, call:

```ts
const resolved = await resolveEntity(supabase, type, mention)
// Player: PlayerResolver chain (fip_id → external_id → normalized name + category → fuzzy ≥0.7)
// Tournament: name-token + year matching (per the tournament-dedup logic in CLAUDE.md)
// Brand: padel_brands.name fuzzy match
```

If resolved and `confidence × resolution_confidence ≥ 0.7`, INSERT into `article_entities`. Otherwise drop and log to ops with the mention text for future debugging.

**Step 4 — Insert topics.** Straightforward upsert into `article_topics` (closed vocabulary, no resolution needed). Anything outside the vocabulary is silently dropped — Sonnet is instructed not to, but defensive.

**Step 5 — Translate summary.** Single Haiku call. Input: `summary_md`. Output: `{ es, pt, it, fr }` map. Save to `articles.summary_translations`. Mirrors the existing [`translateTitleBundle`](../../../src/lib/snippet-translator.ts) pattern.

**Step 6 — Mark enriched.** `UPDATE articles SET enrichment_status='enriched', enriched_at=now(), enrichment_model='claude-sonnet-4-5'`.

The full step set is wrapped in try/catch — any unhandled error sets `enrichment_status='failed'` with the error in `enrichment_error`. Failed articles are retried at most twice (tracked via a `retry_count` we add inline if needed); after that they stay `failed` until manual operator intervention.

**Gating.** Cron exits early if `NEWS_PIPELINE_ENRICHMENT_ENABLED` feature flag is off. This is the dark-launch toggle.

### 6.3 Source-coverage pipeline

#### 6.3.1 Static sources cron — `/api/cron/sync-articles` (refactor)

Existing endpoint. Replace the hard-coded `SOURCES` array with `SELECT * FROM news_sources WHERE query_kind='static' AND enabled=true AND cadence='hourly'`. Behavior preserved. Updates `last_fetch_at` / `last_fetch_status` / `articles_last_7d` per source.

#### 6.3.2 Dynamic-source generator — `/api/cron/regenerate-dynamic-sources` (NEW)

Runs Mondays at 5am UTC. Refreshes per-player and per-tournament rows in `news_sources`.

```ts
// Top 50 players by FIP ranking × {men, women} × {en, es}  → ~200 rows
const playersByGender = await Promise.all([
  supabase.from('players').select('id, name').eq('category', 'men')
    .not('ranking', 'is', null).order('ranking').limit(50),
  supabase.from('players').select('id, name').eq('category', 'women')
    .not('ranking', 'is', null).order('ranking').limit(50),
])

for (const player of playersByGender.flat()) {
  for (const lang of ['en', 'es']) {
    await upsertNewsSource({
      key: `dyn-player-${player.id}-${lang}`,
      name: `Google News · ${player.name} (${lang.toUpperCase()})`,
      url: googleNewsSearchUrl(player.name, lang),
      source_type: 'google-news-search',
      language: lang,
      weight: 0.85,                  // slightly under default to balance against curated sources
      cadence: 'weekly',
      query_kind: 'player',
      query_entity_id: player.id,
      query_template: `padel ${player.name}`,
    })
  }
}

// Tournaments in the active window (last 30d + next 60d) × {en, es}
const activeTournaments = await supabase
  .from('tournaments').select('id, name')
  .gte('ends_at', daysAgo(30)).lte('starts_at', daysAhead(60))
```

Soft-deletes rows that no longer match the criteria (sets `enabled=false`, keeps row for FK integrity on past `articles` lookups — articles don't directly FK to sources, but health stats reference source ids in ops events).

#### 6.3.3 Dynamic sources cron — `/api/cron/sync-articles-dynamic` (NEW)

Runs Wednesdays at 3am UTC. `SELECT * FROM news_sources WHERE cadence='weekly' AND enabled=true`. For each, fetches Google News RSS, upserts into `articles`, same pipeline as static sources (deduplication by `source_url`).

Volume estimate: 160 weekly sources × ~3 net-new articles each ≈ 500/week. Within rate budgets.

#### 6.3.4 User-suggested sources

Public endpoint `POST /api/feed/suggest-source`:

```ts
// Body: { url: string, note?: string, suggested_by_email?: string }
// Validates URL is well-formed and not already a source.
// Rate-limits to 3/day per IP.
// Inserts into news_source_suggestions with status='pending'.
```

Operator approval happens in the Ops UI (§7.2). On approval, creates a `news_sources` row with `query_kind='user-suggested'`, sets `cadence='hourly'`, default `weight=0.7` (lower until trust is established), links back to suggestion via `approved_source_id`.

### 6.4 Backfill plan

Admin one-shot endpoint `POST /api/admin/enrich-articles-backfill` accepts `?days=7` and enqueues all `articles` with `published_at` newer than the cutoff and `enrichment_status='pending'`. Processes in batches of 20 every 60 seconds to stay under Sonnet rate limits (~50 RPM tier-2).

Verify actual article volume via the existing `ops_events` log before kickoff (look for `articles.upserted` events). Backfill duration is roughly `articles_in_window × 3 seconds`. Run during dark-launch phase before flipping the user-facing flag. Backfill cost lands in the same $0.018/article envelope — a 7-day backfill of ~3,500 articles ≈ $63 one-shot.

## 7. UI design

### 7.1 Visual language (locked from brainstorm)

| Token | Value | Used in |
|---|---|---|
| **Chunky-press wrapper** | `display: inline-block`, `filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5))`, `transition: filter 100ms, transform 100ms ease-out` | Every CTA (back-chip, side rail, future entry points) |
| **Chunky-press face** | `background: #1C2029`, `clip-path: polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)`, `color: rgba(255,255,255,0.94)` | Inner div of chunky-press |
| **Chunky-press active** | Wrapper: `transform: translateY(1px)`, lighter filter. Face: `background: #14171F`. | All CTAs |
| **Topic chip (flat, decorative)** | `background: #F5A623` (orange / Premier) or `#7ED321` (green / Olympic-track), `clip-path: polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)`, `color: #0a0a0a` | Top-left next to back-chip; level-specific color from `tournament.level` |
| **Swipe hint label** | `color: rgba(255,255,255,0.5)`, `font-size: 9px`, `font-weight: 600`, `letter-spacing: 0.1em`, uppercase | Below the up-arrow |
| **Swipe hint arrow** | `color: #7ED321`, `font-size: 14px`, `animation: bounce 1.6s ease-in-out infinite` | Above the label |
| **AI Summary badge** | `background: rgba(184,143,255,0.08)`, `border: 1px solid rgba(184,143,255,0.2)`, `color: rgba(184,143,255,0.85)`, `border-radius: 999px` (rounded — not chunky, it's a meta-label) | Between bullets and (in V2) chips |

These are the **only** new visual tokens. Everything else reuses existing shared-constants (`GREEN`, `MUTED`, `BORDER`, `CHUNKY.button`, `CHUNKY.badge` from [`shared-constants.ts`](../../../src/components/home/shared-constants.ts)).

### 7.2 Components inventory

New under `src/components/feed/foryou/`:

| Component | Purpose | Key props |
|---|---|---|
| `ForYouTab.tsx` | The tab itself. Manages article list, current index, prefetch logic. | `articles: EnrichedArticle[]` |
| `ForYouCard.tsx` | A single immersive card. | `article: EnrichedArticle, isActive: boolean` |
| `ChunkyPressButton.tsx` | The shared chunky-press button primitive (wrapper + face pattern). | `children, onClick, variant?: 'green'|'orange'|'default'` |
| `SwipeHint.tsx` | The muted-white + green-arrow hint. Hides after first swipe (localStorage `foryou_swipe_hint_dismissed`). | `visible: boolean` |
| `SideRail.tsx` | Right-edge vertical stack of Save / Share / Source. | `article, onSave, onShare` |

### 7.3 FeedTabs integration

Extend [`FeedTabs`](../../../src/app/[locale]/(app)/feed/FeedTabs.tsx) (the chunky-tabs row from the 2026-05-17 spec) to include a new "For You" tab at position 0:

`For You · News · Videos · Originals · Saved`

- Becomes the **default tab** when the `foryou_enabled` flag resolves true. Otherwise hidden, News stays default.
- URL state: `/feed?tab=foryou`
- When inactive (any other tab is selected), nothing renders / fetches. No background work.
- When active, `<ForYouTab>` mounts and queries enriched articles only.

### 7.4 Card content rendering

Top to bottom inside a single full-bleed card:

1. **Status bar** (Capacitor PWA — already handled globally).
2. **Hero image** — `article.image_url` (`object-fit: cover`, `object-position: center 30%`), 420px on a 380×800 phone, gradient overlay top + bottom for legibility.
3. **Back-chip** (top-left, chunky-press, 32×32) — `‹` glyph, navigates back via `useRouter().back()`.
4. **Topic chip** (next to back-chip) — `tournament.level` if the article's primary `article_entities` row resolves to a tournament; otherwise "PADEL NEWS" fallback in muted gray.
5. **Side rail** (right edge, 46×44 each, gap 8px) — Save (orange), Share (white), Source (green). Anchored at `top: 220px` so it doesn't collide with the topic chip.
6. **Card content** (scrollable below hero, padding 20px):
   - **Meta row** — `<source favicon> <source name> · <category> · <relative time>`
   - **Headline** — `article.title_localized` (existing translation) at 22px / 24px on no-chips (V1) layout, font-weight 800, letter-spacing -0.015em
   - **Bullets** — `article.summary_translations[locale] ?? article.summary_md`, split on `•`, rendered as `<ul>` with green-dot prefix
   - **AI Summary badge** — rounded pill, purple-tinted, indicates the bullets are AI-generated
7. **Swipe hint** — `bottom: 76px`, `pointer-events: none`, arrow + muted label
8. **BottomNav** (existing) — Feed tab active

### 7.5 Swipe gesture mechanics

Reuse [`<SwipeTabView>`](../../../src/components/SwipeTabView.tsx) is **not** the right primitive — that's for horizontal tab swiping. Vertical swiping needs a different gesture handler.

New hook `useVerticalSwipeNavigation(items, currentIndex, onChange)`:

- Uses `pointerdown` / `pointermove` / `pointerup` events on the card container.
- Tracks vertical delta. If `Δy > 80px` AND velocity > 0.3 px/ms → advance.
- During drag, applies `transform: translateY(${delta}px)` to current card and `transform: translateY(calc(100% + ${delta}px))` to next card (peek effect).
- On release: snap forward or snap back, 250ms ease-out spring.
- Honors `prefers-reduced-motion` — disables drag transform, just commits on threshold-crossed without animation.

Prefetch: when on card N, mount card N+1 invisible behind (so its image is already loaded). Unmount card N-2 to keep memory bounded.

### 7.6 Routing & deep-linking

- `/feed?tab=foryou` → For You tab, latest enriched article at top.
- `/feed?tab=foryou&article=<uuid>` → For You tab, jumped to a specific article (used by Share). Falls back to "latest" if the UUID isn't in the current 50-article window.
- `?tab=foryou` is silently coerced to `?tab=news` when the `foryou_enabled` flag resolves false.

## 8. Ops UI

New page at `apps/ops/src/app/(app)/news-sources/`. Per the [admin-ops-app](./2026-05-20-admin-ops-app-design.md) auth model.

### 8.1 Sources tab (default)

Table of all `news_sources` rows. Columns:

| `key` | `name` | `type` | `lang` | `cadence` | health | `articles_7d` | `enabled` | actions |

- Health badge: green if `last_fetch_at < 2h ago` AND `last_fetch_status='success'`; orange if last fetch errored but was within 24h; red if no successful fetch in 7 days.
- Filter chips at top: by `source_type`, by `language`, by `query_kind`, by health.
- Default sort: `articles_7d DESC` (find high-value + dead sources fast).
- Row click → opens drawer with full row data + recent-articles preview (last 10 articles where `articles.source_key = sources.key`).
- **Add Source button** opens drawer with form: `key`, `name`, `url`, `type`, `language`, `weight`, `cadence`. **Validate-and-test** button fetches the URL once server-side and renders the first parsed article as a preview pane. On save, INSERT into `news_sources`.

### 8.2 Suggestions tab

Inbox of `news_source_suggestions` where `status='pending'`. Each row:

```
[URL] [suggested by email] [note] [submitted X ago]
[server-fetched preview: page title + favicon]
[Approve] [Reject] [Duplicate]
```

- **Approve** opens the Add Source drawer pre-filled from the suggestion, on save also UPDATEs the suggestion → `status='approved'`, `approved_source_id=<new>`.
- **Reject** opens optional reason input, UPDATE `status='rejected'`, `review_note=<reason>`.
- **Duplicate** UPDATE `status='duplicate'` (use when the URL matches an existing source).

### 8.3 Discovery health tab

Read-only operator dashboard:

- **Source-level counters** — total enabled sources, total disabled, breakdown by `source_type` and `query_kind`.
- **Dead sources widget** — list of sources with zero articles in 7 days (candidates to disable).
- **Top sources widget** — top 20 by `articles_7d` (candidates to weight up).
- **Volume chart** — 30-day line chart of articles ingested per day, stacked by source. SVG, no chart library.
- **Suggestions counters** — pending, approved last 30d, rejected last 30d.

## 9. Observability

### 9.1 Events to log

| Event | Channel | Tags | Trigger |
|---|---|---|---|
| `enrichment.fetch.success` | ops_events | `source_key`, `body_length` | Readability extract OK |
| `enrichment.fetch.failed` | ops_events + Sentry | `source_key`, `reason` (`paywall`/`4xx`/`5xx`/`body_too_short`/`timeout`) | After retries |
| `enrichment.claude.success` | ops_events | `input_tokens`, `output_tokens`, `latency_ms`, `entity_count`, `topic_count` | Sonnet call OK |
| `enrichment.claude.failed` | Sentry | `error`, `retry_count` | After retries |
| `enrichment.resolver.linked` | ops_events | `entity_type`, `entity_id`, `confidence` | Per linked entity |
| `enrichment.resolver.dropped_low_confidence` | ops_events | `entity_type`, `mention_text`, `confidence` | Per dropped mention (debug surface) |
| `news_source.fetch.health` | ops_events | `source_key`, `articles_added`, `error?` | Every cron run, per source |
| `feed.suggest_source.received` | ops_events | `url`, `has_email`, `client_ip_hash` | POST endpoint hit |
| `foryou.swipe` | ops_events (sampled 10%) | `article_id`, `direction`, `dwell_ms` | Card transition |
| `foryou.cta_click` | ops_events | `article_id`, `cta` (`save`/`share`/`source`) | Side-rail CTA tap |

### 9.2 Ops dashboard surfaces

- **Padelgod Health** page gains a new "News pipeline" subsection with: enrichment success rate (24h), avg latency, Claude cost (24h, calculated from `input_tokens` × pricing), articles pending > 1h (red threshold), articles failed in last cron run.
- **News Sources page** (§8) is the day-to-day surface for source-level health.

### 9.3 Alerts

| Condition | Channel | Severity |
|---|---|---|
| `enrichment.fetch.failed` rate > 30% over 1h | Sentry → PagerDuty (operator phone) | High |
| Zero articles ingested in 4h | Sentry → PagerDuty | High |
| Claude cost in last 24h > $50 | Slack only | Medium (budget guardrail; expected $11–22/day at V1 volume per §6.2 cost math) |
| Any source goes 7 days with no successful fetch | Slack only | Low (handled in News Sources health badges) |

## 10. Rollout & feature flags

Two flags managed via the existing [`feature_flags` table](../../../supabase/migrations/20260520_feature_flags.sql) + [`FLAG_KEYS` registry](../../../src/lib/feature-flags.ts). Each row has independent `enabled` (production) and `enabled_local` (localhost dev) columns, so we can dogfood on local without affecting prod.

| Flag key | Surface | Default at deploy |
|---|---|---|
| `news_pipeline_enrichment` | Server. Gates the enrichment cron + dynamic-source crons. When OFF, article ingest continues unchanged. | `enabled=true`, `enabled_local=true` — pipeline starts populating immediately |
| `foryou_enabled` | Client. Shows/hides the For You tab in FeedTabs. | `enabled=false`, `enabled_local=true` — hidden in prod, visible on localhost |

Both keys get added to [`FLAG_KEYS`](../../../src/lib/feature-flags.ts) and seeded via the same migration as the schema changes. Operators flip them via the existing Feature Flags ops tab — **no deploy needed**.

For dark-launch to a specific user without flipping the global flag, we use the existing per-email allow-list pattern (check the user's email against a hard-coded operator list before honoring the off-state). The list lives in `src/lib/foryou-allow-list.ts` and is removed when public ON.

### 10.1 Dark-launch sequence

| Day | Action |
|---|---|
| 0 | Migrations applied. Cron registered. `news_pipeline_enrichment` flipped ON in prod. `foryou_enabled` stays OFF in prod, ON for localhost. |
| 0–1 | Backfill admin endpoint catches up last 7 days of articles. Operators audit ~20 random enriched articles for summary quality + entity correctness. |
| 2–6 | Operators tune confidence threshold via the News Sources dashboard. Watch for false-positive entity resolution. |
| 7 | Spot-check the Sources tab + Suggestions endpoint with a public test submission. |
| 7–13 | Internal users get For You via the `foryou_enabled` allow-list (≤5 emails hard-coded in `src/lib/foryou-allow-list.ts`). Dogfood swipe UX on real data. |
| 14 | Allow-list removed. `foryou_enabled.enabled` flipped to `true` in prod. For You tab visible to all users. Monitor swipe/save/share/source-click rates. |

### 10.2 Rollback

Flip `foryou_enabled` off → tab disappears immediately (no deploy). Schema stays. Pipeline can stay running because the data is useful for player News widgets and push triggers even when For You is off.

If pipeline itself misbehaves (cost overrun, mass-fail), flip `news_pipeline_enrichment` off. Articles continue ingesting unenriched; For You tab gracefully renders only the articles that ARE enriched (empty state if none).

## 11. Files to change

### 11.1 New files

| Path | Purpose |
|---|---|
| `supabase/migrations/20260524_news_pipeline.sql` | All schema changes from §5 |
| `src/app/api/cron/enrich-articles/route.ts` | Enrichment cron (§6.2) |
| `src/app/api/cron/regenerate-dynamic-sources/route.ts` | Weekly source generator (§6.3.2) |
| `src/app/api/cron/sync-articles-dynamic/route.ts` | Weekly dynamic source fetcher (§6.3.3) |
| `src/app/api/admin/enrich-articles-backfill/route.ts` | One-shot backfill (§6.4) |
| `src/app/api/feed/suggest-source/route.ts` | Public submission endpoint (§6.3.4) |
| `src/lib/article-enrichment.ts` | Core enrichment logic (Sonnet call, entity resolution, topic insert, translation) |
| `src/lib/article-topics.ts` | Closed topic vocabulary const + types |
| `src/lib/entity-resolver.ts` | Shared resolveEntity(supabase, type, mention) for the enrichment pipeline |
| `src/components/feed/foryou/ForYouTab.tsx` | The tab |
| `src/components/feed/foryou/ForYouCard.tsx` | A single card |
| `src/components/feed/foryou/ChunkyPressButton.tsx` | Primitive |
| `src/components/feed/foryou/SwipeHint.tsx` | Hint |
| `src/components/feed/foryou/SideRail.tsx` | Right-edge action stack |
| `src/hooks/useVerticalSwipeNavigation.ts` | Vertical swipe gesture handler |
| `apps/ops/src/app/(app)/news-sources/page.tsx` | Ops Sources page (server component) |
| `apps/ops/src/app/(app)/news-sources/SourcesTable.tsx` | Sources tab |
| `apps/ops/src/app/(app)/news-sources/SuggestionsTable.tsx` | Suggestions tab |
| `apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx` | Health tab |
| `apps/ops/src/app/api/news-sources/route.ts` | CRUD for sources (ops-token authed) |
| `apps/ops/src/app/api/news-sources/suggestions/route.ts` | List/approve/reject |
| `apps/ops/src/app/api/news-sources/test-fetch/route.ts` | Validate-and-test the URL |

### 11.2 Modified files

| Path | Change |
|---|---|
| `src/app/api/cron/sync-articles/route.ts` | Replace hard-coded `SOURCES` with `news_sources` query (§6.3.1) |
| `src/app/[locale]/(app)/feed/FeedTabs.tsx` | Add `For You` tab (conditionally rendered on `foryou_enabled` flag) |
| `src/app/[locale]/(app)/feed/FeedClient.tsx` | Mount `<ForYouTab>` when `tab=foryou` |
| `src/lib/feature-flags.ts` | Add `FORYOU_ENABLED` and `NEWS_PIPELINE_ENRICHMENT` to `FLAG_KEYS` |
| `src/lib/feed-scoring.ts` | (later, V2) add entity-aware scoring multiplier |
| `vercel.json` | Register new cron schedules |
| `src/messages/{en,es,pt,it,fr}.json` | `feed.tabs.foryou`, `feed.foryou.swipeHint`, `feed.foryou.aiSummary`, `feed.foryou.readOriginal`, `feed.foryou.empty` keys |
| `src/lib/source-priority.ts` | Add `claude-enrichment` as a source for `article.summary_md` (it's the only writer) |

## 12. Testing plan

### 12.1 Unit / integration tests

- `src/lib/__tests__/article-enrichment.test.ts` — given a fixed body, mocked Sonnet call returns expected schema; resolver linking works for happy paths; low-confidence drops; failed-fetch path.
- `src/lib/__tests__/entity-resolver.test.ts` — covers player-name disambiguation (Tapia vs Tapia Jr), tournament name-token matching, brand fuzzy.
- `src/components/feed/foryou/__tests__/useVerticalSwipeNavigation.test.tsx` — simulated pointer events, threshold and velocity gates, reduced-motion path.

### 12.2 Manual smoke

- Cold visit to `/feed?tab=foryou` with `NEXT_PUBLIC_FORYOU_ENABLED=true` lands on For You.
- Swipe up advances card. Swipe up on last card shows "End of feed" state, not a stuck swipe.
- Save button toggles bookmark state (reuses existing bookmark store).
- Share button opens native share sheet with localized title + URL.
- "Read original" (Source) opens the article in a new tab (PWA), or in-app browser (Capacitor).
- All 5 locales render the localized summary_translations. Falls back to English if a locale is missing.
- Card with no `image_url` renders a neutral dark hero — doesn't break layout.
- Card with no enriched bullets (race condition) doesn't appear in the For You feed at all (query filters).
- News Sources Ops page: add a source, verify it picks up in the next hourly cron run.
- Suggestions: submit via `/api/feed/suggest-source`, see it appear in the Suggestions tab, approve it, verify new `news_sources` row.
- Flip `NEXT_PUBLIC_FORYOU_ENABLED=false` — For You tab disappears, `/feed?tab=foryou` redirects to `?tab=news`.

### 12.3 Cost & rate-limit verification

Before going to public flag ON: 48h of pipeline running with real volume. Pull `enrichment.claude.success` events, sum input + output tokens, multiply by pricing, confirm daily cost matches the ~$5.80 projection within ±50%.

## 13. Future work (V2+)

- **Entity chips on the card.** Reconsider once 4–6 weeks of production entity-resolution audit data is available. If high-confidence (≥0.92) is reliably high, ship the chip design from [hifi-mockup-v7](../../../.superpowers/brainstorm/33284-1779514619/content/hifi-mockup-v7.html).
- **Player News widget.** On `/player/[slug]`, show "Latest news mentioning <player>" backed by `article_entities`. Pure additive — no feed change.
- **Tournament Coverage tab.** On `/tournament/[slug]`, add a "Coverage" tab with the same query. Same low-risk addition.
- **Brand Press section.** Same pattern on `/brands/[slug]`.
- **Entity-aware feed scoring multiplier.** In [`feed-scoring.ts`](../../../src/lib/feed-scoring.ts), bump articles mentioning followed/bookmarked players by 1.2–1.5×. Sharpens the existing bookmark-relevance modifier from category-level to player-level granularity.
- **Push triggers from entity tags.** "Coello trending — 3 new articles today" using `article_entities` aggregation.
- **Swipe-between-tabs in immersive view.** Horizontal swipe to jump between For You / News / Videos within the immersive layout.
- **TTS / audio summaries.** Spoken summary_md, useful for driving / hands-busy moments.
- **Editorial overrides.** Operator can force-pin or hide a specific article from For You via a flag on the article row.

## 14. Open questions / risks

| # | Question / risk | Mitigation |
|---|---|---|
| 1 | **Sonnet cost overrun if article volume spikes** (e.g. major tournament week pushes ingest to 100+/hr) | Budget alert at $50/day. Hard cap of 20 articles per 15-min cron run = max 80/hr ≈ $35/day worst case (well under $50 alert) |
| 2 | **Readability fails on JS-heavy news sites** (some sources hide body behind hydration) | Failed-fetch path is clean — article stays in pool unenriched, no degradation. Operator surfaces "consistently failing source" as a `news_sources` health signal |
| 3 | **Entity false positives** (Tapia → wrong Tapia) at 0.7 threshold | Logged to ops_events. V1 doesn't show chips so user trust isn't at risk. Operator can adjust threshold in code based on observed FP rate before V2 chip ship |
| 4 | **News Sources access via `apps/ops`** | Follows the admin-ops-app auth model; no new surface area |
| 5 | **Per-IP rate limit on suggestion endpoint isn't enough** if a determined spammer rotates IPs | If abuse emerges, add CAPTCHA (Turnstile). Out of scope for V1 |
| 6 | **`foryou_enabled` flag is global** — single switch for everyone | Per-user dark-launch uses a hard-coded operator allow-list in `src/lib/foryou-allow-list.ts` evaluated server-side alongside the flag. List is deleted at public ON |
| 7 | **Image hotlinking from arbitrary source domains** — performance + privacy | Use `<Image>` with allow-listed remote domains in `next.config.ts`; if a source domain isn't allow-listed, the card renders the neutral dark hero |
| 8 | **Translation drift** — Haiku translation of summary_md may not match the existing title-translation tone | Reuse the same system prompt skeleton from `snippet-translator.ts` for tonal consistency |

## 15. References

- Brainstorming session content: `.superpowers/brainstorm/33284-1779514619/content/`
- Locked visual language: [hifi-mockup-v8.html](../../../.superpowers/brainstorm/33284-1779514619/content/hifi-mockup-v8.html)
- Extends: [2026-05-17-feed-tabs-design.md](./2026-05-17-feed-tabs-design.md)
- Sibling pattern: [2026-05-08-first-party-news-section-design.md](./2026-05-08-first-party-news-section-design.md)
- Ops infra: [2026-05-20-admin-ops-app-design.md](./2026-05-20-admin-ops-app-design.md)
- Source-priority registry: [`src/lib/source-priority.ts`](../../../src/lib/source-priority.ts)
- Feed scoring: [`src/lib/feed-scoring.ts`](../../../src/lib/feed-scoring.ts)
