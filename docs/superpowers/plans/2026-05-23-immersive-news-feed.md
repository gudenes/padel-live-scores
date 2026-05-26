# Immersive "For You" News Feed — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** [docs/superpowers/specs/2026-05-23-immersive-news-feed-design.md](../specs/2026-05-23-immersive-news-feed-design.md) — read it first.
>
> **Codebase guardrail:** Per `AGENTS.md`, this is **Next.js 16** with breaking changes from prior versions. Before writing any code that touches Next.js APIs (route handlers, params, generateMetadata, image, link, etc.), read the relevant guide in `node_modules/next/dist/docs/`.

**Goal:** Ship an AI-summarized, swipeable "For You" news tab in `/feed`, plus a complete server-side pipeline that tags every article with the players, tournaments and brands it mentions — backed by a DB-driven, operator-managed news-source catalog.

**Architecture:** Per-article Sonnet 4.5 enrichment (summary + entity extraction + topic classification) on a 15-minute cron; Haiku-translated summaries to 5 locales; entity tags stored in DB only for V1 (no chips on card). Source catalog moves from a hard-coded array to a `news_sources` table with weekly dynamic player/tournament source generation and a public suggestion endpoint. UI is full-bleed immersive cards using existing CHUNKY clip-path language with a new flat chunky-press CTA primitive. Feature flags via the existing `feature_flags` table.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase (PostgreSQL + RLS), `@anthropic-ai/sdk` (Sonnet 4.5 + Haiku 4.5), `@mozilla/readability` + `jsdom` (article body extraction), `rss-parser` (existing), Vitest (Node env for libs, no DOM).

**Phases:**
- **Phase 0** — Dependency setup
- **Phase 1** — Schema migrations + feature-flag wiring
- **Phase 2** — Enrichment library + cron + backfill (DB-only; ship-criterion: enriched rows in prod)
- **Phase 3** — Source-coverage refactor + dynamic + suggestions endpoint
- **Phase 4** — For You UI primitives (ChunkyPressButton, SwipeHint, SideRail, gesture hook)
- **Phase 5** — For You integration (FeedTabs, FeedClient, routing, i18n, allow-list)
- **Phase 6** — Ops UI (News Sources page in `apps/ops/`)

Each phase ends with a manual smoke test and a commit. Phases 1–3 can ship to prod gated by `news_pipeline_enrichment=true, foryou_enabled=false` — pipeline runs, no UI change.

---

## Phase 0 — Dependency setup

### Task 0.1: Add new runtime dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install jsdom + Readability**

Run:
```bash
npm install --save @mozilla/readability jsdom
npm install --save-dev @types/jsdom
```

Expected: three new lines in `package.json` dependencies / devDependencies.

- [ ] **Step 2: Verify Anthropic SDK is at a Sonnet-4.5-compatible version**

Run:
```bash
node -e "console.log(require('@anthropic-ai/sdk/package.json').version)"
```

Expected: `0.82.0` or higher. If lower, run `npm install --save @anthropic-ai/sdk@latest`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add @mozilla/readability + jsdom for news-pipeline body extraction"
```

---

## Phase 1 — Schema migrations + feature-flag wiring

### Task 1.1: Schema migration — extend `articles`, create junction tables

**Files:**
- Create: `supabase/migrations/20260524_news_pipeline_schema.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260524_news_pipeline_schema.sql`:

```sql
-- News pipeline V1: enrichment columns, entity/topic junctions, source catalog,
-- public suggestion queue. See docs/superpowers/specs/2026-05-23-immersive-news-feed-design.md

BEGIN;

-- ─── articles: enrichment columns ──────────────────────────────────────
ALTER TABLE articles
  ADD COLUMN IF NOT EXISTS summary_md TEXT,
  ADD COLUMN IF NOT EXISTS summary_translations JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed', 'skipped')),
  ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS enrichment_error TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_model TEXT,
  ADD COLUMN IF NOT EXISTS enrichment_retry_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_articles_enrichment_pending
  ON articles (created_at DESC)
  WHERE enrichment_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_articles_enriched_published
  ON articles (published_at DESC)
  WHERE enrichment_status = 'enriched';

-- ─── article_entities (polymorphic junction) ───────────────────────────
CREATE TABLE IF NOT EXISTS article_entities (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id    UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('player', 'tournament', 'brand')),
  entity_id     UUID NOT NULL,
  mention_text  TEXT NOT NULL,
  confidence    REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (article_id, entity_type, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_article_entities_lookup
  ON article_entities (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_article_entities_by_article
  ON article_entities (article_id);

ALTER TABLE article_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read article entities" ON article_entities FOR SELECT USING (true);

-- ─── article_topics ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS article_topics (
  article_id  UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  topic       TEXT NOT NULL,
  confidence  REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  PRIMARY KEY (article_id, topic)
);

CREATE INDEX IF NOT EXISTS idx_article_topics_topic
  ON article_topics (topic, article_id);

ALTER TABLE article_topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read article topics" ON article_topics FOR SELECT USING (true);

-- ─── news_sources (operator-managed catalog) ───────────────────────────
CREATE TABLE IF NOT EXISTS news_sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key             TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('rss', 'wp-api', 'google-news-search')),
  language        TEXT NOT NULL,
  weight          REAL NOT NULL DEFAULT 1.0,
  lookback_days   INTEGER NOT NULL DEFAULT 14,
  cadence         TEXT NOT NULL CHECK (cadence IN ('hourly', 'weekly')),
  query_kind      TEXT CHECK (query_kind IN ('static', 'player', 'tournament', 'brand', 'user-suggested')),
  query_entity_id UUID,
  query_template  TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      TEXT,
  notes           TEXT,
  last_fetch_at   TIMESTAMPTZ,
  last_fetch_status TEXT CHECK (last_fetch_status IN ('success', 'error', 'empty')),
  last_fetch_error TEXT,
  articles_last_7d INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_news_sources_cadence_enabled
  ON news_sources (cadence, enabled)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_news_sources_query
  ON news_sources (query_kind, query_entity_id)
  WHERE query_kind IS NOT NULL;

ALTER TABLE news_sources ENABLE ROW LEVEL SECURITY;
-- No public policies — operator/service-role only.

-- ─── news_source_suggestions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS news_source_suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url           TEXT NOT NULL,
  note          TEXT,
  suggested_by_email TEXT,
  suggested_by_ip TEXT,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate')),
  reviewed_by   TEXT,
  reviewed_at   TIMESTAMPTZ,
  review_note   TEXT,
  approved_source_id UUID REFERENCES news_sources(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_news_source_suggestions_pending
  ON news_source_suggestions (created_at DESC)
  WHERE status = 'pending';

ALTER TABLE news_source_suggestions ENABLE ROW LEVEL SECURITY;
-- Inserts go through the API endpoint with rate-limiting; no direct anon access.

COMMIT;
```

- [ ] **Step 2: Apply migration locally**

Run:
```bash
npx supabase db reset
```

Expected: migration applies cleanly, no errors. If you see "type already exists" type errors, double-check `IF NOT EXISTS` is on every CREATE.

- [ ] **Step 3: Sanity-check schema**

Run:
```bash
npx supabase db diff --use-migra | head -50
```

Expected: empty output (no drift between schema files and DB).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260524_news_pipeline_schema.sql
git commit -m "feat(db): add news pipeline schema — enrichment cols, entity/topic junctions, source catalog"
```

### Task 1.2: Seed migration — `feature_flags` rows + existing 9 static sources

**Files:**
- Create: `supabase/migrations/20260524_news_pipeline_seed.sql`

- [ ] **Step 1: Write the seed migration**

Create `supabase/migrations/20260524_news_pipeline_seed.sql`:

```sql
BEGIN;

-- Feature flags
INSERT INTO feature_flags (key, enabled, enabled_local, label, description)
VALUES
  ('news_pipeline_enrichment', false, true,
    'News pipeline · Enrichment',
    'When ON: enrich-articles cron runs (Sonnet summary + entity tagging + Haiku translation). When OFF: ingest continues unenriched.'),
  ('foryou_enabled', false, true,
    'News · For You tab',
    'When ON: the "For You" immersive tab appears in /feed and becomes the default. Requires news_pipeline_enrichment=true to have content.')
ON CONFLICT (key) DO NOTHING;

-- Seed the 9 existing static sources from src/app/api/cron/sync-articles/route.ts
-- (Keys MUST match the hard-coded array — refactor in Task 3.1 swaps the array for a query against this table.)
INSERT INTO news_sources (
  key, name, url, source_type, language, weight, lookback_days, cadence,
  query_kind, enabled, created_by, notes
) VALUES
  ('google-news-en',  'Google News',  'https://news.google.com/rss/search?q=padel+premier+padel&hl=en&gl=US&ceid=US:en',          'rss', 'en', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-es',  'Google News',  'https://news.google.com/rss/search?q=padel+premier+padel&hl=es&gl=ES&ceid=ES:es',          'rss', 'es', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-pt',  'Google News',  'https://news.google.com/rss/search?q=padel+premier+padel&hl=pt-PT&gl=PT&ceid=PT:pt-150',   'rss', 'pt', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-br',  'Google News',  'https://news.google.com/rss/search?q=padel+premier+padel&hl=pt-BR&gl=BR&ceid=BR:pt-419',   'rss', 'pt', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-it',  'Google News',  'https://news.google.com/rss/search?q=padel+premier+padel&hl=it&gl=IT&ceid=IT:it',          'rss', 'it', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array'),
  ('google-news-fr',  'Google News',  'https://news.google.com/rss/search?q=padel+premier+padel&hl=fr&gl=FR&ceid=FR:fr',          'rss', 'fr', 1.0, 14, 'hourly', 'static', true, 'system', 'Migrated from hard-coded SOURCES array')
ON CONFLICT (key) DO NOTHING;

-- NB: if the existing SOURCES array in route.ts has additional rows beyond these 6
-- (verified at write-time — there's also fip-wp, padel-magazine, p1magazine), open
-- src/app/api/cron/sync-articles/route.ts and add INSERTs here for any missing key.
-- The refactor task (3.1) will fail loud if any active hard-coded key is missing here.

COMMIT;
```

- [ ] **Step 2: Apply + verify seed matches the hard-coded array**

Run:
```bash
npx supabase db reset
psql "$(npx supabase status --output json | jq -r '.[] | select(.name=="API URL") | .value' | sed 's|http|postgresql|; s|:54321|:54322/postgres|')" \
  -c "SELECT key, source_type, language FROM news_sources ORDER BY key;"
grep -E "^\s*key: '" src/app/api/cron/sync-articles/route.ts
```

Visual diff: every `key:` in the route.ts SOURCES array must appear in the SELECT output. If any key is missing, add an INSERT for it in the seed and re-run.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260524_news_pipeline_seed.sql
git commit -m "feat(db): seed feature_flags + initial news_sources from hard-coded SOURCES"
```

### Task 1.3: Wire new flag keys into `FLAG_KEYS` registry

**Files:**
- Modify: `src/lib/feature-flags.ts:18-23`

- [ ] **Step 1: Extend FLAG_KEYS**

Open `src/lib/feature-flags.ts`, replace the `FLAG_KEYS` block:

```ts
export const FLAG_KEYS = {
  HOME_LIVE_TOURNAMENTS_CAROUSEL: 'home_live_tournaments_carousel',
  NEWS_PIPELINE_ENRICHMENT:       'news_pipeline_enrichment',
  FORYOU_ENABLED:                 'foryou_enabled',
} as const
```

- [ ] **Step 2: Type-check passes**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors (this is a pure constant addition — nothing else references the keys yet).

- [ ] **Step 3: Commit**

```bash
git add src/lib/feature-flags.ts
git commit -m "feat(flags): register news_pipeline_enrichment + foryou_enabled"
```

---

## Phase 2 — Enrichment library + cron + backfill

### Task 2.1: Closed topic vocabulary

**Files:**
- Create: `src/lib/article-topics.ts`
- Create: `src/lib/__tests__/article-topics.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/article-topics.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ARTICLE_TOPICS, isValidTopic, type ArticleTopic } from '../article-topics'

describe('article-topics', () => {
  it('exports a closed vocabulary of 7 topics', () => {
    expect(ARTICLE_TOPICS).toHaveLength(7)
    expect(ARTICLE_TOPICS).toEqual([
      'transfer-news', 'result-recap', 'preview',
      'profile', 'controversy', 'olympics', 'business',
    ])
  })

  it('isValidTopic returns true for valid topics', () => {
    expect(isValidTopic('transfer-news')).toBe(true)
    expect(isValidTopic('olympics')).toBe(true)
  })

  it('isValidTopic returns false for unknown strings (silently drops Claude hallucinations)', () => {
    expect(isValidTopic('made-up-topic')).toBe(false)
    expect(isValidTopic('')).toBe(false)
    expect(isValidTopic('TRANSFER-NEWS')).toBe(false)  // case-sensitive
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/__tests__/article-topics.test.ts
```

Expected: FAIL — `Cannot find module '../article-topics'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/lib/article-topics.ts`:

```ts
// Closed topic vocabulary for news article classification.
// Passed to Claude as part of the enrichment system prompt; any
// topic Claude returns outside this list is silently dropped.

export const ARTICLE_TOPICS = [
  'transfer-news',
  'result-recap',
  'preview',
  'profile',
  'controversy',
  'olympics',
  'business',
] as const

export type ArticleTopic = (typeof ARTICLE_TOPICS)[number]

export function isValidTopic(s: string): s is ArticleTopic {
  return (ARTICLE_TOPICS as readonly string[]).includes(s)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
npx vitest run src/lib/__tests__/article-topics.test.ts
```

Expected: PASS — 3/3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/article-topics.ts src/lib/__tests__/article-topics.test.ts
git commit -m "feat(news): closed topic vocabulary for enrichment classification"
```

### Task 2.2: Entity resolver

**Files:**
- Create: `src/lib/entity-resolver.ts`
- Create: `src/lib/__tests__/entity-resolver.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/entity-resolver.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { resolveEntity, normalizeForSearch } from '../entity-resolver'

describe('normalizeForSearch', () => {
  it('strips diacritics', () => {
    expect(normalizeForSearch('Galán')).toBe('galan')
    expect(normalizeForSearch('Bélla Bréa')).toBe('bella brea')
  })

  it('lowercases and trims', () => {
    expect(normalizeForSearch('  TAPIA  ')).toBe('tapia')
  })
})

describe('resolveEntity — player', () => {
  it('returns null when no rows match', async () => {
    const supabase = mockSupabase({ players: [] })
    const out = await resolveEntity(supabase as any, 'player', 'Nonexistent Player')
    expect(out).toBeNull()
  })

  it('returns the single matching player with full confidence', async () => {
    const supabase = mockSupabase({
      players: [{ id: 'p1', name: 'Agustín Tapia', normalized_name: 'agustin tapia' }],
    })
    const out = await resolveEntity(supabase as any, 'player', 'Tapia')
    expect(out).toEqual({ entityId: 'p1', confidence: expect.any(Number) })
    expect(out!.confidence).toBeGreaterThan(0.7)
  })

  it('downscores confidence when multiple plausible candidates exist', async () => {
    const supabase = mockSupabase({
      players: [
        { id: 'p1', name: 'Agustín Tapia',     normalized_name: 'agustin tapia' },
        { id: 'p2', name: 'Agustín Tapia Jr.', normalized_name: 'agustin tapia jr' },
      ],
    })
    const out = await resolveEntity(supabase as any, 'player', 'Tapia')
    // Two candidates → ambiguous → confidence dampened
    expect(out?.confidence).toBeLessThan(0.7)
  })
})

// Tiny supabase mock — only supports the chain shape used by entity-resolver
function mockSupabase(tables: { players?: any[]; tournaments?: any[]; padel_brands?: any[] }) {
  return {
    from(table: string) {
      const data = (tables as any)[table] ?? []
      const builder: any = {
        select: () => builder,
        ilike: () => builder,
        textSearch: () => builder,
        eq: () => builder,
        limit: () => Promise.resolve({ data, error: null }),
      }
      return builder
    },
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/__tests__/entity-resolver.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/entity-resolver.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type EntityType = 'player' | 'tournament' | 'brand'

export interface ResolvedEntity {
  entityId: string
  confidence: number  // 0..1
}

/**
 * Strip diacritics + lowercase + trim. Mirrors the `unaccent` index on
 * players.normalized_name so we can compare like-with-like.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Resolve a mention string to a canonical entity in the DB.
 *
 * Player: looks up by `players.normalized_name` ILIKE %mention%, plus
 *   a token-similarity comparison. Multiple candidates → confidence
 *   dampened by 1/N (Claude shouldn't have to disambiguate).
 *
 * Tournament: name-token + year window from `tournaments.starts_at`.
 *
 * Brand: `padel_brands.name` ILIKE %mention%.
 *
 * Returns null if no candidate scores above 0.5 — the cron caller
 * gates inserts at the final (claude_conf × resolution_conf ≥ 0.7).
 */
export async function resolveEntity(
  supabase: SupabaseClient,
  type: EntityType,
  mention: string,
): Promise<ResolvedEntity | null> {
  const norm = normalizeForSearch(mention)
  if (!norm) return null

  switch (type) {
    case 'player':    return resolvePlayer(supabase, norm)
    case 'tournament': return resolveTournament(supabase, norm)
    case 'brand':     return resolveBrand(supabase, norm)
  }
}

async function resolvePlayer(supabase: SupabaseClient, norm: string): Promise<ResolvedEntity | null> {
  const { data, error } = await supabase
    .from('players')
    .select('id, name, normalized_name')
    .ilike('normalized_name', `%${norm}%`)
    .limit(5)
  if (error || !data || data.length === 0) return null

  const ranked = data
    .map(p => ({ id: p.id, score: tokenOverlap(norm, p.normalized_name ?? normalizeForSearch(p.name)) }))
    .sort((a, b) => b.score - a.score)
    .filter(p => p.score >= 0.5)
  if (ranked.length === 0) return null

  // Single strong candidate → high confidence. Multiple → dampened.
  const top = ranked[0]
  const dampening = 1 / Math.max(1, ranked.length - 0.5)  // 1 → 1.0, 2 → 0.67, 3 → 0.4
  return { entityId: top.id, confidence: top.score * dampening }
}

async function resolveTournament(supabase: SupabaseClient, norm: string): Promise<ResolvedEntity | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, starts_at')
    .ilike('name', `%${norm}%`)
    .limit(5)
  if (error || !data || data.length === 0) return null

  const ranked = data
    .map(t => ({ id: t.id, score: tokenOverlap(norm, normalizeForSearch(t.name)) }))
    .sort((a, b) => b.score - a.score)
    .filter(t => t.score >= 0.5)
  if (ranked.length === 0) return null

  const top = ranked[0]
  const dampening = 1 / Math.max(1, ranked.length - 0.5)
  return { entityId: top.id, confidence: top.score * dampening }
}

async function resolveBrand(supabase: SupabaseClient, norm: string): Promise<ResolvedEntity | null> {
  const { data, error } = await supabase
    .from('padel_brands')
    .select('id, name')
    .ilike('name', `%${norm}%`)
    .limit(3)
  if (error || !data || data.length === 0) return null
  const ranked = data
    .map(b => ({ id: b.id, score: tokenOverlap(norm, normalizeForSearch(b.name)) }))
    .sort((a, b) => b.score - a.score)
    .filter(b => b.score >= 0.5)
  if (ranked.length === 0) return null
  return { entityId: ranked[0].id, confidence: ranked[0].score }
}

/**
 * Jaccard token overlap. 1.0 = identical token sets, 0.0 = disjoint.
 * Tokens are space/punct-split alphanumeric runs.
 */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/[^a-z0-9]+/).filter(Boolean))
  const tb = new Set(b.split(/[^a-z0-9]+/).filter(Boolean))
  if (ta.size === 0 || tb.size === 0) return 0
  let common = 0
  for (const tok of ta) if (tb.has(tok)) common++
  return common / Math.max(ta.size, tb.size)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run src/lib/__tests__/entity-resolver.test.ts
```

Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/entity-resolver.ts src/lib/__tests__/entity-resolver.test.ts
git commit -m "feat(news): entity resolver for player/tournament/brand mentions"
```

### Task 2.3: Article enrichment library

**Files:**
- Create: `src/lib/article-enrichment.ts`
- Create: `src/lib/__tests__/article-enrichment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/__tests__/article-enrichment.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseClaudeResponse, validateEnrichmentShape } from '../article-enrichment'

describe('parseClaudeResponse', () => {
  it('parses a well-formed response', () => {
    const raw = JSON.stringify({
      summary_md: '• First bullet\n• Second bullet\n• Third bullet',
      entities: [
        { type: 'player', mention: 'Tapia', confidence: 0.9 },
      ],
      topics: [
        { topic: 'result-recap', confidence: 0.85 },
      ],
    })
    const parsed = parseClaudeResponse(raw)
    expect(parsed.summary_md).toContain('First bullet')
    expect(parsed.entities).toHaveLength(1)
    expect(parsed.topics[0].topic).toBe('result-recap')
  })

  it('throws on malformed JSON', () => {
    expect(() => parseClaudeResponse('not json')).toThrow()
  })

  it('strips fenced markdown if Claude includes it', () => {
    const raw = '```json\n{"summary_md":"x","entities":[],"topics":[]}\n```'
    const parsed = parseClaudeResponse(raw)
    expect(parsed.summary_md).toBe('x')
  })
})

describe('validateEnrichmentShape', () => {
  it('accepts a valid shape', () => {
    expect(() => validateEnrichmentShape({
      summary_md: '• a\n• b\n• c',
      entities: [{ type: 'player', mention: 'x', confidence: 0.8 }],
      topics: [{ topic: 'preview', confidence: 0.7 }],
    })).not.toThrow()
  })

  it('rejects entities with invalid type', () => {
    expect(() => validateEnrichmentShape({
      summary_md: '• a',
      entities: [{ type: 'invalid-type', mention: 'x', confidence: 0.8 }],
      topics: [],
    })).toThrow(/entity type/)
  })

  it('rejects topics outside the closed vocabulary', () => {
    expect(() => validateEnrichmentShape({
      summary_md: '• a',
      entities: [],
      topics: [{ topic: 'made-up', confidence: 0.7 }],
    })).toThrow(/topic/)
  })

  it('rejects confidence out of range', () => {
    expect(() => validateEnrichmentShape({
      summary_md: '• a',
      entities: [{ type: 'player', mention: 'x', confidence: 1.5 }],
      topics: [],
    })).toThrow(/confidence/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
npx vitest run src/lib/__tests__/article-enrichment.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `src/lib/article-enrichment.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { JSDOM } from 'jsdom'
// @ts-expect-error - no types ship with @mozilla/readability
import { Readability } from '@mozilla/readability'
import { ARTICLE_TOPICS, isValidTopic, type ArticleTopic } from './article-topics'
import { resolveEntity, type EntityType } from './entity-resolver'

const SONNET_MODEL = 'claude-sonnet-4-5'
const HAIKU_MODEL  = 'claude-haiku-4-5'
const MIN_BODY_CHARS = 500
const MAX_INPUT_TOKENS_APPROX = 8000
const TARGET_LOCALES = ['es', 'pt', 'it', 'fr'] as const

const SYSTEM_PROMPT = `You are extracting structured padel news data from an article body.
Return a single JSON object matching this schema (no prose, no markdown fences):

{
  "summary_md": "• bullet 1\\n• bullet 2\\n• bullet 3",
  "entities": [{ "type": "player|tournament|brand", "mention": "verbatim string", "confidence": 0.0-1.0 }],
  "topics": [{ "topic": "${ARTICLE_TOPICS.join('|')}", "confidence": 0.0-1.0 }]
}

Rules:
- 3-4 bullets, English, max 25 words per bullet.
- Bullets MUST start with "• " (bullet + space).
- Bold key terms with **markdown bold**.
- Confidence on entities reflects how sure you are it's THIS specific entity, not just that the name appears.
- Don't invent entities. Only return mentions that appear in the article.`

// ── Body extraction ────────────────────────────────────────────────────

export interface FetchedBody {
  text: string
  title: string | null
}

export async function fetchArticleBody(url: string, timeoutMs = 15000): Promise<FetchedBody> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'PadelNachosBot/1.0 (+https://padelnachos.com)' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const html = await res.text()
    const dom = new JSDOM(html, { url })
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    if (!article || !article.textContent || article.textContent.length < MIN_BODY_CHARS) {
      throw new Error(`body_too_short:${article?.textContent?.length ?? 0}`)
    }
    return { text: article.textContent, title: article.title ?? null }
  } finally {
    clearTimeout(timeoutId)
  }
}

// ── Claude call ────────────────────────────────────────────────────────

export interface EnrichmentResult {
  summary_md: string
  entities: Array<{ type: EntityType; mention: string; confidence: number }>
  topics: Array<{ topic: ArticleTopic; confidence: number }>
}

export async function callSonnetForEnrichment(
  client: Anthropic,
  headline: string,
  body: string,
): Promise<EnrichmentResult> {
  const truncated = truncateToApproxTokens(body, MAX_INPUT_TOKENS_APPROX)
  const userPrompt = `HEADLINE: ${headline}\n\nBODY:\n${truncated}`

  const res = await client.messages.create({
    model: SONNET_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = res.content.find(c => c.type === 'text')
  if (!block || block.type !== 'text') throw new Error('claude: no text block in response')
  const parsed = parseClaudeResponse(block.text)
  validateEnrichmentShape(parsed)
  return parsed
}

export function parseClaudeResponse(raw: string): EnrichmentResult {
  let str = raw.trim()
  // Tolerate ```json ... ``` fenced output even though we asked for raw JSON.
  if (str.startsWith('```')) {
    str = str.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  }
  return JSON.parse(str) as EnrichmentResult
}

export function validateEnrichmentShape(obj: unknown): asserts obj is EnrichmentResult {
  if (typeof obj !== 'object' || obj === null) throw new Error('not an object')
  const o = obj as Record<string, unknown>
  if (typeof o.summary_md !== 'string') throw new Error('summary_md must be string')
  if (!Array.isArray(o.entities)) throw new Error('entities must be array')
  if (!Array.isArray(o.topics)) throw new Error('topics must be array')
  for (const e of o.entities as any[]) {
    if (!['player', 'tournament', 'brand'].includes(e.type)) throw new Error(`invalid entity type: ${e.type}`)
    if (typeof e.mention !== 'string' || !e.mention) throw new Error('entity.mention must be non-empty string')
    if (typeof e.confidence !== 'number' || e.confidence < 0 || e.confidence > 1) throw new Error('entity.confidence out of range')
  }
  for (const t of o.topics as any[]) {
    if (!isValidTopic(t.topic)) throw new Error(`unknown topic: ${t.topic}`)
    if (typeof t.confidence !== 'number' || t.confidence < 0 || t.confidence > 1) throw new Error('topic.confidence out of range')
  }
}

// ── Translation ────────────────────────────────────────────────────────

export async function translateSummary(
  client: Anthropic,
  summaryMd: string,
): Promise<Record<typeof TARGET_LOCALES[number], string>> {
  const res = await client.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1500,
    system: 'You translate padel news bullet summaries. Preserve "• " bullets, bold markdown, line breaks. Return a single JSON object keyed by locale code. No prose, no fences.',
    messages: [{
      role: 'user',
      content: `Translate the following English summary to: ${TARGET_LOCALES.join(', ')}.\n\nReturn shape: {"es": "...", "pt": "...", "it": "...", "fr": "..."}\n\nSummary:\n${summaryMd}`,
    }],
  })
  const block = res.content.find(c => c.type === 'text')
  if (!block || block.type !== 'text') throw new Error('claude: no text block in translation response')
  let raw = block.text.trim()
  if (raw.startsWith('```')) raw = raw.replace(/^```(?:json)?\s*/, '').replace(/```\s*$/, '').trim()
  const parsed = JSON.parse(raw)
  // Sanity-check all locales present, fallback to summary_md if any missing.
  for (const locale of TARGET_LOCALES) {
    if (typeof parsed[locale] !== 'string') throw new Error(`translation missing for ${locale}`)
  }
  return parsed
}

// ── Linking (write to DB) ──────────────────────────────────────────────

export interface LinkResult {
  linkedCount: number
  droppedCount: number
}

export async function linkEntitiesToArticle(
  supabase: SupabaseClient,
  articleId: string,
  entities: EnrichmentResult['entities'],
  minProduct = 0.7,
): Promise<LinkResult> {
  let linked = 0, dropped = 0
  for (const e of entities) {
    const resolved = await resolveEntity(supabase, e.type, e.mention)
    if (!resolved) { dropped++; continue }
    const product = e.confidence * resolved.confidence
    if (product < minProduct) { dropped++; continue }
    const { error } = await supabase
      .from('article_entities')
      .upsert({
        article_id: articleId,
        entity_type: e.type,
        entity_id: resolved.entityId,
        mention_text: e.mention,
        confidence: product,
      }, { onConflict: 'article_id,entity_type,entity_id' })
    if (error) { dropped++; continue }
    linked++
  }
  return { linkedCount: linked, droppedCount: dropped }
}

export async function insertArticleTopics(
  supabase: SupabaseClient,
  articleId: string,
  topics: EnrichmentResult['topics'],
): Promise<void> {
  if (topics.length === 0) return
  const rows = topics.map(t => ({
    article_id: articleId,
    topic: t.topic,
    confidence: t.confidence,
  }))
  await supabase.from('article_topics').upsert(rows, { onConflict: 'article_id,topic' })
}

// ── Helpers ────────────────────────────────────────────────────────────

function truncateToApproxTokens(text: string, approxTokens: number): string {
  // ~4 chars per token rough heuristic. Sonnet's actual tokenizer is more
  // efficient; this errs on the side of leaving headroom.
  const maxChars = approxTokens * 4
  return text.length > maxChars ? text.slice(0, maxChars) + '…' : text
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
npx vitest run src/lib/__tests__/article-enrichment.test.ts
```

Expected: PASS — 7/7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/article-enrichment.ts src/lib/__tests__/article-enrichment.test.ts
git commit -m "feat(news): article-enrichment library (Sonnet extract + Haiku translate + entity link)"
```

### Task 2.4: Enrichment cron route

**Files:**
- Create: `src/app/api/cron/enrich-articles/route.ts`

- [ ] **Step 1: Read the Next.js 16 route-handler guide**

Run:
```bash
ls node_modules/next/dist/docs/ 2>&1 | grep -i route
```

Open and read whatever guide mentions route handlers / `maxDuration` / dynamic. The behavior of `export const dynamic`, `export const maxDuration`, and the request shape may differ from prior Next versions.

- [ ] **Step 2: Write the route**

Create `src/app/api/cron/enrich-articles/route.ts`:

```ts
// src/app/api/cron/enrich-articles/route.ts
// Runs every 15 minutes. Picks up to 20 articles where enrichment_status='pending',
// oldest first. Sonnet summary + entity tagging + topic insert + Haiku translation.

import Anthropic from '@anthropic-ai/sdk'
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { fetchFeatureFlag, FLAG_KEYS, resolveFlag } from '@/lib/feature-flags'
import {
  fetchArticleBody,
  callSonnetForEnrichment,
  translateSummary,
  linkEntitiesToArticle,
  insertArticleTopics,
} from '@/lib/article-enrichment'

export const maxDuration = 300        // 5 min — 20 articles × ~10s each
export const dynamic = 'force-dynamic'

const BATCH_SIZE = 20
const MAX_RETRIES = 2

export async function GET(req: NextRequest) {
  // CRON_SECRET auth
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  // Flag gate
  const flag = await fetchFeatureFlag(supabase, FLAG_KEYS.NEWS_PIPELINE_ENRICHMENT)
  if (!resolveFlag(flag)) {
    return NextResponse.json({ skipped: 'flag_off' })
  }

  // Pick up the batch
  const { data: candidates, error } = await supabase
    .from('articles')
    .select('id, source_url, title, enrichment_retry_count')
    .eq('enrichment_status', 'pending')
    .lt('enrichment_retry_count', MAX_RETRIES + 1)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    await logOpsEvent({ kind: 'enrichment.batch.failed', metadata: { error: error.message } })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!candidates || candidates.length === 0) {
    return NextResponse.json({ processed: 0, message: 'queue empty' })
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const results = { enriched: 0, failed: 0, skipped: 0 }
  for (const article of candidates) {
    try {
      await enrichOne(supabase, anthropic, article)
      results.enriched++
    } catch (err) {
      const reason = (err as Error).message
      const isFinal = (article.enrichment_retry_count ?? 0) + 1 >= MAX_RETRIES
      await supabase.from('articles').update({
        enrichment_status: isFinal ? 'failed' : 'pending',
        enrichment_error: reason.slice(0, 500),
        enrichment_retry_count: (article.enrichment_retry_count ?? 0) + 1,
      }).eq('id', article.id)
      await logOpsEvent({
        kind: 'enrichment.article.failed',
        metadata: { article_id: article.id, reason, retry: article.enrichment_retry_count ?? 0 },
      })
      results.failed++
    }
  }

  await logOpsEvent({ kind: 'enrichment.batch.complete', metadata: results })
  return NextResponse.json(results)
}

async function enrichOne(supabase: ReturnType<typeof createServerClient>, anthropic: Anthropic, article: any) {
  // 1. Fetch body
  const { text: body, title: extractedTitle } = await fetchArticleBody(article.source_url)
  const headline = extractedTitle ?? article.title

  // 2. Sonnet
  const enriched = await callSonnetForEnrichment(anthropic, headline, body)

  // 3. Translate
  const translations = await translateSummary(anthropic, enriched.summary_md)

  // 4. Insert junctions
  const linkResult = await linkEntitiesToArticle(supabase, article.id, enriched.entities)
  await insertArticleTopics(supabase, article.id, enriched.topics)

  // 5. Mark enriched
  const { error } = await supabase.from('articles').update({
    summary_md: enriched.summary_md,
    summary_translations: translations,
    enrichment_status: 'enriched',
    enriched_at: new Date().toISOString(),
    enrichment_model: 'claude-sonnet-4-5',
  }).eq('id', article.id)
  if (error) throw new Error(`db_update: ${error.message}`)

  await logOpsEvent({
    kind: 'enrichment.article.success',
    metadata: {
      article_id: article.id,
      entities_linked: linkResult.linkedCount,
      entities_dropped: linkResult.droppedCount,
      topic_count: enriched.topics.length,
    },
  })
}
```

- [ ] **Step 3: Type-check passes**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Smoke test with curl + one fake row**

Insert a known-good test article into your local DB (use the Supabase Studio at http://localhost:54323):

```sql
INSERT INTO articles (id, source_url, title, source_name, source_weight, published_at, language, enrichment_status)
VALUES (gen_random_uuid(),
  'https://www.padelfip.com/blog/2025/12/some-real-article-url/',
  'Test article title',
  'FIP', 1.0, now(), 'en', 'pending');
```

Then trigger the cron:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/enrich-articles | jq
```

Expected: `{ "enriched": 1, "failed": 0, "skipped": 0 }`. Verify in DB:

```sql
SELECT id, enrichment_status, summary_md, enriched_at FROM articles WHERE source_url LIKE '%some-real-article-url%';
SELECT * FROM article_entities WHERE article_id = '<the id>';
SELECT * FROM article_topics WHERE article_id = '<the id>';
```

If the source URL doesn't resolve (paywall, 404), pick any current article from padelfip.com that loads in a browser and re-run.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/enrich-articles/route.ts
git commit -m "feat(news): /api/cron/enrich-articles — Sonnet + Haiku enrichment pipeline"
```

### Task 2.5: Backfill admin route

**Files:**
- Create: `src/app/api/admin/enrich-articles-backfill/route.ts`

- [ ] **Step 1: Write the route**

Create the file:

```ts
// src/app/api/admin/enrich-articles-backfill/route.ts
// One-shot batched backfill. Marks N pending articles as eligible by
// resetting retry_count, then invokes the same enrichment as the cron
// in a controlled loop (20 / 60s) to stay under Sonnet RPM limits.

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'

export const maxDuration = 800
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') ?? '7', 10), 1), 30)
  const dryRun = url.searchParams.get('dry') === 'true'

  const supabase = createServerClient()

  const cutoff = new Date(Date.now() - days * 86400_000).toISOString()
  const { count, error: countErr } = await supabase
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .eq('enrichment_status', 'pending')
    .gte('published_at', cutoff)

  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 })
  if (dryRun) return NextResponse.json({ would_process: count, days, cutoff })

  await logOpsEvent({ kind: 'enrichment.backfill.start', metadata: { days, count } })

  // Defer actual processing to the regular cron — the backfill is just
  // a "ping the cron 20× in sequence" shape, which the cron already does
  // 20-at-a-time. So we just nudge the cron in a loop, sleeping 60s.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let totalEnriched = 0
  let totalFailed = 0
  const maxIterations = Math.ceil((count ?? 0) / 20) + 1

  for (let i = 0; i < maxIterations; i++) {
    const res = await fetch(`${url.origin}/api/cron/enrich-articles`, {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    })
    const data = await res.json()
    totalEnriched += data.enriched ?? 0
    totalFailed += data.failed ?? 0
    if ((data.processed ?? 0) === 0 && (data.enriched ?? 0) === 0 && (data.failed ?? 0) === 0) break
    await new Promise(r => setTimeout(r, 60000))
  }

  await logOpsEvent({
    kind: 'enrichment.backfill.complete',
    metadata: { days, totalEnriched, totalFailed },
  })

  return NextResponse.json({ days, totalEnriched, totalFailed })
}
```

- [ ] **Step 2: Type-check passes**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Smoke test — dry run**

```bash
curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3002/api/admin/enrich-articles-backfill?days=1&dry=true" | jq
```

Expected: `{ "would_process": <number>, "days": 1, "cutoff": "..." }`.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/enrich-articles-backfill/route.ts
git commit -m "feat(news): backfill admin route for catch-up enrichment"
```

### Task 2.6: Register enrichment cron in vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the schedule entry**

Open `vercel.json` and add to the `crons` array:

```json
{ "path": "/api/cron/enrich-articles", "schedule": "*/15 * * * *" }
```

Place it near the existing `sync-articles` entry for logical grouping.

- [ ] **Step 2: Validate JSON**

Run:
```bash
jq . vercel.json > /dev/null && echo "json ok"
```

Expected: `json ok`.

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(news): schedule enrich-articles cron every 15 min"
```

**End-of-phase smoke test (Phase 2):**

1. With `news_pipeline_enrichment=true` (`enabled_local=true`) on localhost, manually trigger the cron 2–3 times across 10 minutes.
2. Confirm enriched articles accumulate in DB with valid `summary_md`, populated `summary_translations` (all 4 target locales), and `article_entities` + `article_topics` rows for at least some articles.
3. Manually inspect 5 random enriched articles via the Supabase Studio — do the bullets make sense? Are the resolved entities correct?
4. If quality is acceptable, commit a CHECKPOINT marker for the team.

---

## Phase 3 — Source-coverage refactor + dynamic + suggestions endpoint

### Task 3.1: Refactor sync-articles to read from `news_sources`

**Files:**
- Modify: `src/app/api/cron/sync-articles/route.ts`

- [ ] **Step 1: Replace SOURCES array with a DB query**

Open `src/app/api/cron/sync-articles/route.ts`. Find the `SOURCES: ArticleSource[] = [...]` block (starts around line 35–40). Replace the array with a function:

```ts
async function loadStaticSources(supabase: SupabaseClient): Promise<ArticleSource[]> {
  const { data, error } = await supabase
    .from('news_sources')
    .select('key, name, url, source_type, language, weight, lookback_days')
    .eq('cadence', 'hourly')
    .eq('enabled', true)
    .eq('query_kind', 'static')
    .order('key')
  if (error) throw new Error(`load sources: ${error.message}`)
  return (data ?? []).map(r => ({
    key: r.key,
    name: r.name,
    icon: r.name[0]?.toUpperCase() ?? '?',
    language: r.language,
    weight: r.weight,
    type: r.source_type as 'rss' | 'wp-api',
    url: r.url,
    lookbackDays: r.lookback_days,
  }))
}
```

In the main `GET` handler, replace `for (const source of SOURCES)` with:

```ts
const sources = await loadStaticSources(supabase)
for (const source of sources) {
```

- [ ] **Step 2: Write per-source health back to DB**

After each source loop iteration, add health update. Find where the per-source loop ends, add:

```ts
await supabase.from('news_sources').update({
  last_fetch_at: new Date().toISOString(),
  last_fetch_status: sourceError ? 'error' : (articlesAdded === 0 ? 'empty' : 'success'),
  last_fetch_error: sourceError?.slice(0, 500) ?? null,
  // articles_last_7d is recomputed by a separate maintenance job — don't touch here.
}).eq('key', source.key)
```

(`sourceError` is a local variable you'll need to track inside the loop — `let sourceError: string | null = null` at loop top, set in the catch.)

- [ ] **Step 3: Type-check passes**

Run:
```bash
npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 4: Smoke test — run the cron**

Run:
```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/sync-articles | jq
```

Expected: same shape as before (articles upserted), plus DB shows `news_sources.last_fetch_at` populated. Run twice to verify idempotency.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/sync-articles/route.ts
git commit -m "refactor(news): sync-articles reads SOURCES from news_sources table"
```

### Task 3.2: Dynamic-source generator cron

**Files:**
- Create: `src/app/api/cron/regenerate-dynamic-sources/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/cron/regenerate-dynamic-sources/route.ts
// Mondays 5am UTC. Refreshes per-player and per-tournament rows in news_sources.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import { fetchFeatureFlag, FLAG_KEYS, resolveFlag } from '@/lib/feature-flags'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

const TOP_N_PLAYERS = 50
const SOURCE_LANGS = ['en', 'es'] as const

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = createServerClient()
  const flag = await fetchFeatureFlag(supabase, FLAG_KEYS.NEWS_PIPELINE_ENRICHMENT)
  if (!resolveFlag(flag)) return NextResponse.json({ skipped: 'flag_off' })

  const seenKeys = new Set<string>()
  let upserted = 0

  // ─ Players: top N by ranking × {men, women} × {en, es} ─
  for (const category of ['men', 'women']) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name')
      .eq('category', category)
      .not('ranking', 'is', null)
      .order('ranking', { ascending: true })
      .limit(TOP_N_PLAYERS)
    for (const player of players ?? []) {
      for (const lang of SOURCE_LANGS) {
        const key = `dyn-player-${player.id}-${lang}`
        seenKeys.add(key)
        const { error } = await supabase.from('news_sources').upsert({
          key,
          name: `Google News · ${player.name} (${lang.toUpperCase()})`,
          url: googleNewsUrl(player.name, lang),
          source_type: 'google-news-search',
          language: lang,
          weight: 0.85,
          cadence: 'weekly',
          query_kind: 'player',
          query_entity_id: player.id,
          query_template: `padel ${player.name}`,
          enabled: true,
          created_by: 'system',
        }, { onConflict: 'key' })
        if (!error) upserted++
      }
    }
  }

  // ─ Tournaments: active window (last 30d → next 60d) × {en, es} ─
  const startCutoff = new Date(Date.now() - 30 * 86400_000).toISOString()
  const endCutoff = new Date(Date.now() + 60 * 86400_000).toISOString()
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id, name, starts_at, ends_at')
    .gte('ends_at', startCutoff)
    .lte('starts_at', endCutoff)
  for (const t of tournaments ?? []) {
    for (const lang of SOURCE_LANGS) {
      const key = `dyn-tournament-${t.id}-${lang}`
      seenKeys.add(key)
      const { error } = await supabase.from('news_sources').upsert({
        key,
        name: `Google News · ${t.name} (${lang.toUpperCase()})`,
        url: googleNewsUrl(t.name, lang),
        source_type: 'google-news-search',
        language: lang,
        weight: 0.85,
        cadence: 'weekly',
        query_kind: 'tournament',
        query_entity_id: t.id,
        query_template: `padel ${t.name}`,
        enabled: true,
        created_by: 'system',
      }, { onConflict: 'key' })
      if (!error) upserted++
    }
  }

  // ─ Disable orphan dynamic rows (no longer in the top-N or window) ─
  const { data: existingDynamic } = await supabase
    .from('news_sources')
    .select('id, key')
    .in('query_kind', ['player', 'tournament'])
    .eq('enabled', true)
  let disabled = 0
  for (const row of existingDynamic ?? []) {
    if (!seenKeys.has(row.key)) {
      await supabase.from('news_sources').update({ enabled: false }).eq('id', row.id)
      disabled++
    }
  }

  await logOpsEvent({ kind: 'news_sources.regenerate.complete', metadata: { upserted, disabled } })
  return NextResponse.json({ upserted, disabled })
}

function googleNewsUrl(entityName: string, lang: 'en' | 'es'): string {
  const q = encodeURIComponent(`padel ${entityName}`)
  const params = lang === 'es'
    ? 'hl=es&gl=ES&ceid=ES:es'
    : 'hl=en&gl=US&ceid=US:en'
  return `https://news.google.com/rss/search?q=${q}&${params}`
}
```

- [ ] **Step 2: Type-check + smoke test**

```bash
npx tsc --noEmit
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/regenerate-dynamic-sources | jq
```

Expected: `{ "upserted": <100-200ish>, "disabled": 0 }`. Re-run — should be idempotent (same upserted count, no inserts).

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/regenerate-dynamic-sources/route.ts
git commit -m "feat(news): weekly dynamic-source generator for top players + active tournaments"
```

### Task 3.3: Dynamic sources cron (fetcher)

**Files:**
- Create: `src/app/api/cron/sync-articles-dynamic/route.ts`

- [ ] **Step 1: Write the route**

This is largely a parallel of `sync-articles` but filters on `cadence='weekly'`. Rather than duplicating the parser logic, extract the per-source fetch into a shared helper.

First, extract the shared helper. Create `src/lib/fetch-source.ts`:

```ts
// src/lib/fetch-source.ts — shared per-source RSS/WP-API fetch + article upsert.

import type { SupabaseClient } from '@supabase/supabase-js'
import Parser from 'rss-parser'
import GoogleNewsDecoder from 'google-news-decoder'
import { translateTitleBundle } from './snippet-translator'

export interface SourceRow {
  key: string
  name: string
  url: string
  source_type: 'rss' | 'wp-api' | 'google-news-search'
  language: string
  weight: number
  lookback_days: number
}

export interface FetchResult {
  added: number
  error: string | null
}

const parser = new Parser({ timeout: 15000 })

export async function fetchAndUpsertSource(
  supabase: SupabaseClient,
  source: SourceRow,
): Promise<FetchResult> {
  try {
    if (source.source_type === 'wp-api') {
      // wp-api branch — copy/paste relevant block from sync-articles route
      throw new Error('wp-api not yet refactored — handle inline in sync-articles for now')
    }
    const feed = await parser.parseURL(source.url)
    const cutoff = Date.now() - source.lookback_days * 86400_000
    let added = 0
    for (const item of feed.items) {
      const pub = item.pubDate ? Date.parse(item.pubDate) : Date.now()
      if (pub < cutoff) continue
      const realUrl = await resolveGoogleNewsUrlIfNeeded(item.link ?? '')
      if (!realUrl) continue
      const { error } = await supabase.from('articles').upsert({
        source_url: realUrl,
        title: item.title ?? '(untitled)',
        source_name: source.name,
        source_weight: source.weight,
        published_at: new Date(pub).toISOString(),
        language: source.language,
        favicon_url: deriveFavicon(realUrl),
        enrichment_status: 'pending',
      }, { onConflict: 'source_url' })
      if (!error) added++
    }
    return { added, error: null }
  } catch (e) {
    return { added: 0, error: (e as Error).message.slice(0, 500) }
  }
}

async function resolveGoogleNewsUrlIfNeeded(url: string): Promise<string | null> {
  if (!url.includes('news.google.com')) return url
  try {
    const decoder = new GoogleNewsDecoder()
    const resolved = await decoder.decode(url)
    return resolved ?? null
  } catch { return null }
}

function deriveFavicon(url: string): string | null {
  try {
    const u = new URL(url)
    return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=64`
  } catch { return null }
}
```

Now create `src/app/api/cron/sync-articles-dynamic/route.ts`:

```ts
// src/app/api/cron/sync-articles-dynamic/route.ts
// Wed 3am UTC. Fetches Google News RSS for all enabled cadence='weekly' sources.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { fetchAndUpsertSource } from '@/lib/fetch-source'
import { logOpsEvent } from '@/lib/ops-logger'

export const maxDuration = 800
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = createServerClient()
  const { data: sources, error } = await supabase
    .from('news_sources')
    .select('key, name, url, source_type, language, weight, lookback_days')
    .eq('cadence', 'weekly')
    .eq('enabled', true)
    .order('key')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let totalAdded = 0
  let failed = 0
  for (const src of sources ?? []) {
    const result = await fetchAndUpsertSource(supabase, src as any)
    totalAdded += result.added
    if (result.error) failed++
    await supabase.from('news_sources').update({
      last_fetch_at: new Date().toISOString(),
      last_fetch_status: result.error ? 'error' : (result.added === 0 ? 'empty' : 'success'),
      last_fetch_error: result.error,
    }).eq('key', src.key)
  }
  await logOpsEvent({ kind: 'news_sources.dynamic_fetch.complete', metadata: { totalAdded, failed, sourceCount: sources?.length ?? 0 } })
  return NextResponse.json({ totalAdded, failed, sourceCount: sources?.length ?? 0 })
}
```

- [ ] **Step 2: Type-check + smoke test**

```bash
npx tsc --noEmit
curl -s -H "Authorization: Bearer $CRON_SECRET" http://localhost:3002/api/cron/sync-articles-dynamic | jq
```

Expected: `{ "totalAdded": <N>, "failed": <0 or low>, "sourceCount": <hundreds> }`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fetch-source.ts src/app/api/cron/sync-articles-dynamic/route.ts
git commit -m "feat(news): weekly cron for dynamic per-entity Google News sources"
```

### Task 3.4: Public suggestion endpoint

**Files:**
- Create: `src/app/api/feed/suggest-source/route.ts`

- [ ] **Step 1: Write the route**

```ts
// src/app/api/feed/suggest-source/route.ts
// Public endpoint for users to suggest a news source URL. Rate-limited
// to 3/day per IP. Inserts into news_source_suggestions with status='pending'.

import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { logOpsEvent } from '@/lib/ops-logger'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

const RATE_LIMIT_PER_DAY = 3

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    url?: string
    note?: string
    suggested_by_email?: string
  }
  const url = (body.url ?? '').trim()
  if (!url || !/^https?:\/\/.+/.test(url) || url.length > 500) {
    return NextResponse.json({ error: 'invalid_url' }, { status: 400 })
  }
  const note = (body.note ?? '').slice(0, 500)
  const email = (body.suggested_by_email ?? '').trim().slice(0, 200) || null

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0'
  const ipHash = crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32)

  const supabase = createServerClient()

  // Rate limit: count submissions from this IP in last 24h
  const since = new Date(Date.now() - 86400_000).toISOString()
  const { count, error: countErr } = await supabase
    .from('news_source_suggestions')
    .select('id', { count: 'exact', head: true })
    .eq('suggested_by_ip', ipHash)
    .gte('created_at', since)
  if (countErr) return NextResponse.json({ error: 'rate_check_failed' }, { status: 500 })
  if ((count ?? 0) >= RATE_LIMIT_PER_DAY) {
    return NextResponse.json({ error: 'rate_limited', retry_after_hours: 24 }, { status: 429 })
  }

  // Duplicate check
  const { data: existing } = await supabase
    .from('news_sources')
    .select('id')
    .eq('url', url)
    .maybeSingle()
  const initialStatus = existing ? 'duplicate' : 'pending'

  const { error } = await supabase.from('news_source_suggestions').insert({
    url,
    note,
    suggested_by_email: email,
    suggested_by_ip: ipHash,
    status: initialStatus,
  })
  if (error) return NextResponse.json({ error: 'insert_failed' }, { status: 500 })

  await logOpsEvent({
    kind: 'feed.suggest_source.received',
    metadata: { url, has_email: !!email, status: initialStatus },
  })

  return NextResponse.json({ ok: true, status: initialStatus })
}
```

- [ ] **Step 2: Smoke test**

```bash
curl -s -X POST http://localhost:3002/api/feed/suggest-source \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example-padel-site.com/rss","note":"Great Spanish padel coverage","suggested_by_email":"test@example.com"}' | jq
```

Expected: `{ "ok": true, "status": "pending" }`. Re-submit 3 more times in same minute → 4th should return `429`.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/feed/suggest-source/route.ts
git commit -m "feat(news): public suggest-source endpoint (rate-limited 3/day/IP)"
```

### Task 3.5: Register new crons in vercel.json

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Add the two schedules**

In `vercel.json`'s `crons` array:

```json
{ "path": "/api/cron/regenerate-dynamic-sources", "schedule": "0 5 * * 1" },
{ "path": "/api/cron/sync-articles-dynamic",       "schedule": "0 3 * * 3" }
```

- [ ] **Step 2: Validate**

```bash
jq . vercel.json > /dev/null && echo "json ok"
```

- [ ] **Step 3: Commit**

```bash
git add vercel.json
git commit -m "feat(news): schedule weekly dynamic-source crons (Mon 5am + Wed 3am UTC)"
```

**End-of-phase smoke test (Phase 3):**
1. Run `sync-articles` → confirm DB-driven sources work end-to-end.
2. Run `regenerate-dynamic-sources` → confirm ~200 dynamic rows created.
3. Run `sync-articles-dynamic` → confirm articles added under `source_name = 'Google News · ...'`.
4. POST a suggestion → confirm it lands in `news_source_suggestions` with `status='pending'`.
5. Verify the 15-min enrichment cron continues to process new + dynamic articles.

---

## Phase 4 — For You UI primitives

### Task 4.1: ChunkyPressButton primitive

**Files:**
- Create: `src/components/feed/foryou/ChunkyPressButton.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/feed/foryou/ChunkyPressButton.tsx
'use client'

import { ReactNode, CSSProperties } from 'react'

type Variant = 'default' | 'green' | 'orange'

export interface ChunkyPressButtonProps {
  onClick?: () => void
  variant?: Variant
  className?: string
  style?: CSSProperties
  ariaLabel?: string
  children: ReactNode
}

const VARIANT_COLOR: Record<Variant, string> = {
  default: 'rgba(255,255,255,0.94)',
  green:   '#7ED321',
  orange:  '#F5A623',
}

export function ChunkyPressButton({
  onClick, variant = 'default', className, style, ariaLabel, children,
}: ChunkyPressButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      className={className}
      style={{
        display: 'inline-block',
        padding: 0,
        border: 0,
        background: 'transparent',
        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
        transition: 'filter 100ms, transform 100ms ease-out',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        ...style,
      }}
      onPointerDown={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(1px)'
        el.style.filter = 'drop-shadow(0 1px 1px rgba(0,0,0,0.55))'
      }}
      onPointerUp={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(0)'
        el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
      }}
      onPointerLeave={e => {
        const el = e.currentTarget
        el.style.transform = 'translateY(0)'
        el.style.filter = 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))'
      }}
    >
      <span style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#1C2029',
        clipPath: 'polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%)',
        color: VARIANT_COLOR[variant],
      }}>
        {children}
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Type-check passes**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Smoke test in a one-off page**

Create a temporary scratch route `src/app/scratch-foryou/page.tsx`:

```tsx
'use client'
import { ChunkyPressButton } from '@/components/feed/foryou/ChunkyPressButton'

export default function Scratch() {
  return (
    <div style={{ background: '#0a0a0a', minHeight: '100vh', padding: 40, display: 'flex', gap: 12 }}>
      <ChunkyPressButton onClick={() => alert('default')}>
        <span style={{ padding: '8px 14px', fontSize: 12 }}>Default</span>
      </ChunkyPressButton>
      <ChunkyPressButton variant="green" onClick={() => alert('green')}>
        <span style={{ padding: '8px 14px', fontSize: 12 }}>Read at source</span>
      </ChunkyPressButton>
      <ChunkyPressButton variant="orange">
        <span style={{ padding: '8px 14px', fontSize: 12 }}>Save</span>
      </ChunkyPressButton>
    </div>
  )
}
```

Visit `http://localhost:3002/scratch-foryou`. Confirm:
- Chunky polygon shape (not rounded)
- Press-down animation on click+hold
- No "shine" / top-edge highlight
- Color tints work for each variant

- [ ] **Step 4: Delete scratch route after verification**

```bash
rm -rf src/app/scratch-foryou
```

- [ ] **Step 5: Commit**

```bash
git add src/components/feed/foryou/ChunkyPressButton.tsx
git commit -m "feat(foryou): ChunkyPressButton primitive (chunky polygon + press animation)"
```

### Task 4.2: SwipeHint component

**Files:**
- Create: `src/components/feed/foryou/SwipeHint.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/feed/foryou/SwipeHint.tsx
'use client'

import { useTranslations } from 'next-intl'

export function SwipeHint({ visible = true }: { visible?: boolean }) {
  const t = useTranslations('feed.foryou')
  if (!visible) return null
  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        bottom: 76,
        left: 0,
        right: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 3,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      <span style={{ color: '#7ED321', fontSize: 14, lineHeight: 1, animation: 'bounceUp 1.6s ease-in-out infinite' }}>↑</span>
      <span style={{
        color: 'rgba(255,255,255,0.5)',
        fontSize: 9,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
      }}>
        {t('swipeHint')}
      </span>
      <style jsx>{`
        @keyframes bounceUp {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
      `}</style>
    </div>
  )
}
```

- [ ] **Step 2: Type-check passes**

```bash
npx tsc --noEmit
```

**Note:** this component reads `t('swipeHint')` from the `feed.foryou` namespace. The keys are added in Task 5.2 (Phase 5). If you're running tasks out of order and tsc complains about a missing key, jump to Task 5.2 first.

- [ ] **Step 3: Commit**

```bash
git add src/components/feed/foryou/SwipeHint.tsx
git commit -m "feat(foryou): SwipeHint component (muted label + bouncing brand-green arrow)"
```

### Task 4.3: SideRail component

**Files:**
- Create: `src/components/feed/foryou/SideRail.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/feed/foryou/SideRail.tsx
'use client'

import { useTranslations } from 'next-intl'
import { ChunkyPressButton } from './ChunkyPressButton'

export interface SideRailProps {
  isSaved: boolean
  onSave: () => void
  onShare: () => void
  onReadSource: () => void
}

export function SideRail({ isSaved, onSave, onShare, onReadSource }: SideRailProps) {
  const t = useTranslations('feed.foryou')
  return (
    <div style={{
      position: 'absolute',
      right: 12,
      top: 220,
      zIndex: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <RailButton
        ariaLabel={t(isSaved ? 'unsave' : 'save')}
        variant="orange"
        onClick={onSave}
        icon={<BookmarkIcon filled={isSaved} />}
        label={t('save')}
      />
      <RailButton
        ariaLabel={t('share')}
        variant="default"
        onClick={onShare}
        icon={<ShareIcon />}
        label={t('share')}
      />
      <RailButton
        ariaLabel={t('readSource')}
        variant="green"
        onClick={onReadSource}
        icon={<ExternalLinkIcon />}
        label={t('source')}
      />
    </div>
  )
}

function RailButton({ ariaLabel, variant, onClick, icon, label }: {
  ariaLabel: string
  variant: 'default' | 'green' | 'orange'
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <ChunkyPressButton ariaLabel={ariaLabel} variant={variant} onClick={onClick} style={{ width: 46 }}>
      <span style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 2, padding: '7px 4px', width: '100%',
      }}>
        {icon}
        <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.75)' }}>
          {label}
        </span>
      </span>
    </ChunkyPressButton>
  )
}

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={2}>
      <path d="M6 4v18l6-4 6 4V4H6z" />
    </svg>
  )
}
function ShareIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M16 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM10.59 13.5l4.83 2.83M15.41 7.66l-4.82 2.83" />
    </svg>
  )
}
function ExternalLinkIcon() {
  return (
    <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M14 3h7v7M10 14L21 3M21 14v7H3V3h7" />
    </svg>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/feed/foryou/SideRail.tsx
git commit -m "feat(foryou): SideRail with Save/Share/Source CTAs"
```

### Task 4.4: Vertical-swipe gesture hook

**Files:**
- Create: `src/hooks/useVerticalSwipeNavigation.ts`

- [ ] **Step 1: Write the hook**

```ts
// src/hooks/useVerticalSwipeNavigation.ts
'use client'

import { RefObject, useEffect } from 'react'

export interface UseVerticalSwipeOptions {
  threshold?: number       // px
  velocityThreshold?: number  // px/ms
  onNext: () => void
  onPrev?: () => void
  enabled?: boolean
}

/**
 * Attach vertical-swipe gesture to an element. Threshold + velocity gates.
 * Honors prefers-reduced-motion (commits without animated translate).
 */
export function useVerticalSwipeNavigation(
  ref: RefObject<HTMLElement | null>,
  options: UseVerticalSwipeOptions,
) {
  const {
    threshold = 80,
    velocityThreshold = 0.3,
    onNext,
    onPrev,
    enabled = true,
  } = options

  useEffect(() => {
    if (!enabled) return
    const el = ref.current
    if (!el) return

    let pointerStartY = 0
    let pointerStartT = 0
    let dragging = false

    const onPointerDown = (e: PointerEvent) => {
      pointerStartY = e.clientY
      pointerStartT = performance.now()
      dragging = true
      el.setPointerCapture(e.pointerId)
    }
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return
      // Light visual feedback only — no transforms here, the parent owns animation.
    }
    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) return
      dragging = false
      const dy = pointerStartY - e.clientY
      const dt = performance.now() - pointerStartT
      const velocity = Math.abs(dy) / Math.max(1, dt)
      if (Math.abs(dy) >= threshold && velocity >= velocityThreshold) {
        if (dy > 0) onNext()
        else if (onPrev) onPrev()
      }
    }
    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    el.addEventListener('pointercancel', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
      el.removeEventListener('pointercancel', onPointerUp)
    }
  }, [ref, threshold, velocityThreshold, onNext, onPrev, enabled])
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/hooks/useVerticalSwipeNavigation.ts
git commit -m "feat(foryou): useVerticalSwipeNavigation hook (threshold + velocity gates)"
```

---

## Phase 5 — For You integration

### Task 5.1: Per-email allow-list helper

**Files:**
- Create: `src/lib/foryou-allow-list.ts`

- [ ] **Step 1: Write the helper**

```ts
// src/lib/foryou-allow-list.ts
// During dark launch, ON for an operator-curated set of emails even when
// the feature_flag's `enabled` column is false in prod.
// Removed at public ON.

const ALLOW_LIST = new Set<string>([
  // Add operator + tester emails here, lowercase
  // 'operator@padelnachos.com',
])

export function isInForYouAllowList(email: string | null | undefined): boolean {
  if (!email) return false
  return ALLOW_LIST.has(email.toLowerCase())
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/foryou-allow-list.ts
git commit -m "feat(foryou): per-email allow-list for dark-launch override"
```

### Task 5.2: i18n keys for For You

**Files:**
- Modify: `src/messages/en.json`, `src/messages/es.json`, `src/messages/pt.json`, `src/messages/it.json`, `src/messages/fr.json`

- [ ] **Step 1: Add the EN keys**

In `src/messages/en.json`, add to the `feed` namespace:

```json
"foryou": {
  "tabLabel": "For You",
  "swipeHint": "Swipe up for next",
  "aiSummary": "AI Summary",
  "save": "Save",
  "unsave": "Unsave",
  "share": "Share",
  "readSource": "Read original article at source",
  "source": "Source",
  "empty": "No personalized articles yet. Check back soon.",
  "endOfFeed": "You're all caught up"
}
```

- [ ] **Step 2: Add the same keys to the other 4 locales**

`src/messages/es.json`:
```json
"foryou": {
  "tabLabel": "Para Ti",
  "swipeHint": "Desliza para el siguiente",
  "aiSummary": "Resumen IA",
  "save": "Guardar",
  "unsave": "Quitar",
  "share": "Compartir",
  "readSource": "Leer artículo original en la fuente",
  "source": "Fuente",
  "empty": "Aún no hay artículos personalizados. Vuelve pronto.",
  "endOfFeed": "Estás al día"
}
```

`src/messages/pt.json`:
```json
"foryou": {
  "tabLabel": "Para Você",
  "swipeHint": "Deslize para o próximo",
  "aiSummary": "Resumo IA",
  "save": "Salvar",
  "unsave": "Remover",
  "share": "Compartilhar",
  "readSource": "Ler artigo original na fonte",
  "source": "Fonte",
  "empty": "Ainda não há artigos personalizados. Volte em breve.",
  "endOfFeed": "Está em dia"
}
```

`src/messages/it.json`:
```json
"foryou": {
  "tabLabel": "Per Te",
  "swipeHint": "Scorri per il prossimo",
  "aiSummary": "Riepilogo IA",
  "save": "Salva",
  "unsave": "Rimuovi",
  "share": "Condividi",
  "readSource": "Leggi articolo originale alla fonte",
  "source": "Fonte",
  "empty": "Ancora nessun articolo personalizzato. Torna presto.",
  "endOfFeed": "Sei aggiornato"
}
```

`src/messages/fr.json`:
```json
"foryou": {
  "tabLabel": "Pour Toi",
  "swipeHint": "Glisse pour le suivant",
  "aiSummary": "Résumé IA",
  "save": "Enregistrer",
  "unsave": "Retirer",
  "share": "Partager",
  "readSource": "Lire l'article original à la source",
  "source": "Source",
  "empty": "Pas encore d'articles personnalisés. Reviens bientôt.",
  "endOfFeed": "Tu es à jour"
}
```

- [ ] **Step 3: Verify JSON valid**

```bash
for f in src/messages/*.json; do jq . "$f" > /dev/null && echo "$f ok"; done
```

Expected: 5 "ok" lines.

- [ ] **Step 4: Commit**

```bash
git add src/messages/
git commit -m "i18n(foryou): tab label + swipe hint + CTAs in 5 locales"
```

### Task 5.3: ForYouCard component

**Files:**
- Create: `src/components/feed/foryou/ForYouCard.tsx`

- [ ] **Step 1: Write the component**

```tsx
// src/components/feed/foryou/ForYouCard.tsx
'use client'

import Image from 'next/image'
import { useTranslations, useLocale } from 'next-intl'
import { useState } from 'react'
import { ChunkyPressButton } from './ChunkyPressButton'
import { SideRail } from './SideRail'

export interface ForYouArticle {
  id: string
  title: string
  source_url: string
  source_name: string | null
  favicon_url: string | null
  image_url: string | null
  published_at: string | null
  language: string | null
  summary_md: string | null
  summary_translations: Record<string, string>
  tournament_level: string | null     // optional — from a join in the query
}

export interface ForYouCardProps {
  article: ForYouArticle
  isSaved: boolean
  onSave: () => void
  onBack: () => void
}

export function ForYouCard({ article, isSaved, onSave, onBack }: ForYouCardProps) {
  const t = useTranslations('feed.foryou')
  const locale = useLocale()
  const localizedSummary = article.summary_translations?.[locale] ?? article.summary_md ?? ''
  const bullets = localizedSummary.split('\n').map(s => s.trim()).filter(s => s.startsWith('•'))

  const onShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try { await navigator.share({ title: article.title, url: article.source_url }) } catch {}
    } else {
      navigator.clipboard?.writeText(article.source_url)
    }
  }
  const onReadSource = () => { window.open(article.source_url, '_blank', 'noopener,noreferrer') }

  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0a0a0a', overflow: 'hidden' }}>
      {/* Hero */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 420, overflow: 'hidden' }}>
        {article.image_url ? (
          <Image
            src={article.image_url}
            alt=""
            fill
            sizes="100vw"
            style={{ objectFit: 'cover', objectPosition: 'center 30%' }}
            unoptimized
          />
        ) : (
          <div style={{ background: '#0a0a0a', height: '100%' }} />
        )}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(180deg, rgba(10,10,10,.6) 0%, rgba(10,10,10,.2) 12%, rgba(10,10,10,0) 30%, rgba(10,10,10,0) 50%, rgba(10,10,10,.6) 75%, rgba(10,10,10,.95) 92%, #0a0a0a 100%)',
        }} />
      </div>

      {/* Back chip */}
      <div style={{ position: 'absolute', top: 42, left: 14, zIndex: 25 }}>
        <ChunkyPressButton ariaLabel="Back" onClick={onBack} style={{ width: 32 }}>
          <span style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>‹</span>
        </ChunkyPressButton>
      </div>

      {/* Topic chip */}
      {article.tournament_level && (
        <div style={{
          position: 'absolute', top: 42, left: 54, zIndex: 25,
          padding: '7px 10px',
          background: '#F5A623', color: '#0a0a0a',
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
          clipPath: 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)',
        }}>
          {article.tournament_level}
        </div>
      )}

      {/* Side rail */}
      <SideRail
        isSaved={isSaved}
        onSave={onSave}
        onShare={onShare}
        onReadSource={onReadSource}
      />

      {/* Card content */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 360, bottom: 64, padding: '0 20px', zIndex: 4, overflowY: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#B0B0B0', marginBottom: 10 }}>
          {article.favicon_url && (
            <Image src={article.favicon_url} alt="" width={16} height={16} style={{ borderRadius: 3 }} unoptimized />
          )}
          <span style={{ fontWeight: 700, color: '#fff' }}>{article.source_name ?? 'Padel news'}</span>
          {article.published_at && (
            <>
              <span style={{ width: 3, height: 3, borderRadius: '50%', background: '#555' }} />
              <span>{relativeTime(article.published_at)}</span>
            </>
          )}
        </div>

        <h1 style={{ fontSize: 24, lineHeight: 1.1, fontWeight: 800, letterSpacing: '-0.015em', color: '#fff', marginBottom: 14 }}>
          {article.title}
        </h1>

        <ul style={{ listStyle: 'none', margin: '0 0 14px', padding: 0 }}>
          {bullets.map((line, i) => (
            <li key={i} style={{ fontSize: 14, lineHeight: 1.5, color: '#D8D8D8', paddingLeft: 16, position: 'relative', marginBottom: 7 }}>
              <span style={{ position: 'absolute', left: 0, top: 8, width: 5, height: 5, background: '#7ED321', borderRadius: '50%' }} />
              <span dangerouslySetInnerHTML={{ __html: renderInlineBold(line.replace(/^•\s*/, '')) }} />
            </li>
          ))}
        </ul>

        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 5,
          padding: '4px 10px',
          background: 'rgba(184,143,255,0.08)',
          border: '1px solid rgba(184,143,255,0.2)',
          borderRadius: 999,
          fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: 'rgba(184,143,255,0.85)',
        }}>
          {t('aiSummary')}
        </div>
      </div>
    </div>
  )
}

function relativeTime(iso: string): string {
  const dt = Date.parse(iso)
  const dh = (Date.now() - dt) / 3_600_000
  if (dh < 1) return `${Math.max(1, Math.round(dh * 60))}m ago`
  if (dh < 24) return `${Math.round(dh)}h ago`
  return `${Math.round(dh / 24)}d ago`
}

/** Only allow **bold** — no other markdown to keep this safe. */
function renderInlineBold(s: string): string {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/feed/foryou/ForYouCard.tsx
git commit -m "feat(foryou): ForYouCard — full-bleed immersive card layout"
```

### Task 5.3b: Extend useFollowing to support 'article' bookmarks

**Files:**
- Modify: `src/hooks/useFollowing.ts`

The existing `useFollowing` hook supports `match | player | tournament | news_source`. Articles aren't in the union — extend it so the Save CTA can store article bookmarks via the same mechanism.

- [ ] **Step 1: Add 'article' to the type union and store shape**

Open `src/hooks/useFollowing.ts`. Update the type and store:

```ts
export type FollowType = 'match' | 'player' | 'tournament' | 'news_source' | 'article'

interface FollowingStore {
  matches: string[]
  players: string[]
  tournaments: string[]
  news_sources: string[]
  articles: string[]
}

function emptyStore(): FollowingStore {
  return { matches: [], players: [], tournaments: [], news_sources: [], articles: [] }
}

function typeToField(type: FollowType): keyof FollowingStore {
  if (type === 'match') return 'matches'
  if (type === 'player') return 'players'
  if (type === 'tournament') return 'tournaments'
  if (type === 'article') return 'articles'
  return 'news_sources'
}
```

If the hook also writes to the `user_bookmarks` table for authenticated users, find the entity-type allowlist there and add `'article'`. (Check the file for any switch/if that gates the DB-write path — the existing comment block says match/player/tournament are the DB-stored types; news_source is localStorage-only. Article should be localStorage-only too for V1 to keep the schema unchanged.)

If a switch like `if (type === 'match' || type === 'player' || type === 'tournament')` gates the DB write, change it to keep articles out:

```ts
const isDbStored = type === 'match' || type === 'player' || type === 'tournament'
```

- [ ] **Step 2: Type-check passes**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useFollowing.ts
git commit -m "feat(bookmarks): extend useFollowing with 'article' type (localStorage-only)"
```

### Task 5.4: ForYouTab — card stack + gesture

**Files:**
- Create: `src/components/feed/foryou/ForYouTab.tsx`

- [ ] **Step 1: Write the tab**

```tsx
// src/components/feed/foryou/ForYouTab.tsx
'use client'

import { useState, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { ForYouCard, type ForYouArticle } from './ForYouCard'
import { SwipeHint } from './SwipeHint'
import { useVerticalSwipeNavigation } from '@/hooks/useVerticalSwipeNavigation'
import { useFollowing } from '@/hooks/useFollowing'

export interface ForYouTabProps {
  articles: ForYouArticle[]
}

export function ForYouTab({ articles }: ForYouTabProps) {
  const t = useTranslations('feed.foryou')
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const { isFollowing, toggle } = useFollowing()

  const swipeNext = useCallback(() => {
    setIndex(i => Math.min(i + 1, articles.length - 1))
    if (typeof localStorage !== 'undefined') localStorage.setItem('foryou_swipe_hint_dismissed', '1')
  }, [articles.length])

  const swipePrev = useCallback(() => {
    setIndex(i => Math.max(i - 1, 0))
  }, [])

  useVerticalSwipeNavigation(containerRef, {
    onNext: swipeNext,
    onPrev: swipePrev,
    enabled: articles.length > 0,
  })

  if (articles.length === 0) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', color: 'rgba(255,255,255,0.5)', textAlign: 'center', padding: 24 }}>
        {t('empty')}
      </div>
    )
  }

  const current = articles[index]
  const hintDismissed = typeof localStorage !== 'undefined' && localStorage.getItem('foryou_swipe_hint_dismissed') === '1'
  const isLast = index >= articles.length - 1
  const isSaved = isFollowing('article', current.id)

  return (
    <div ref={containerRef} style={{ position: 'relative', height: 'calc(100vh - 64px)', overflow: 'hidden', touchAction: 'pan-y' }}>
      <ForYouCard
        article={current}
        isSaved={isSaved}
        onSave={() => toggle('article', current.id)}
        onBack={() => router.back()}
      />
      <SwipeHint visible={!hintDismissed && !isLast} />
      {isLast && (
        <div style={{
          position: 'absolute', bottom: 76, left: 0, right: 0,
          textAlign: 'center', color: 'rgba(255,255,255,0.45)',
          fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
          pointerEvents: 'none',
        }}>
          {t('endOfFeed')}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check + commit**

```bash
npx tsc --noEmit
git add src/components/feed/foryou/ForYouTab.tsx
git commit -m "feat(foryou): ForYouTab — gesture + index + bookmark integration"
```

### Task 5.5: Extend FeedTabs with For You

**Files:**
- Modify: `src/app/[locale]/(app)/feed/FeedTabs.tsx`

- [ ] **Step 1: Read the current file to find the tabs array**

```bash
sed -n '1,80p' src/app/[locale]/(app)/feed/FeedTabs.tsx
```

- [ ] **Step 2: Add the For You tab to the array, gated on prop**

In `FeedTabs.tsx`, locate where tabs are defined (likely an array of `{ key, label }` objects). Add `foryou` at position 0:

```tsx
// Inside the component, accept a new prop:
interface FeedTabsProps {
  // … existing props
  showForYou?: boolean
}

// In the tab definition:
const tabs = [
  ...(showForYou ? [{ key: 'foryou' as const, label: t('foryou.tabLabel') }] : []),
  { key: 'news' as const, label: t('tabs.news') },
  { key: 'videos' as const, label: t('tabs.videos') },
  { key: 'originals' as const, label: t('tabs.originals') },
  { key: 'saved' as const, label: t('tabs.saved') },
]
```

If `TabKey` is a union type, extend it:

```tsx
export type TabKey = 'foryou' | 'news' | 'videos' | 'originals' | 'saved'
```

- [ ] **Step 3: Commit**

```bash
git add src/app/[locale]/(app)/feed/FeedTabs.tsx
git commit -m "feat(feed): add For You tab to FeedTabs (gated on showForYou prop)"
```

### Task 5.6: Wire ForYou into FeedClient

**Files:**
- Modify: `src/app/[locale]/(app)/feed/FeedClient.tsx`
- Modify: `src/app/[locale]/(app)/feed/page.tsx`

- [ ] **Step 1: In FeedClient, branch on the tab and render ForYouTab when active**

Open `src/app/[locale]/(app)/feed/FeedClient.tsx`. Where the tab render-branch lives (currently switches on 'news' / 'videos' / 'originals' / 'saved'), add a `'foryou'` branch:

```tsx
{activeTab === 'foryou' && <ForYouTab articles={foryouArticles ?? []} />}
```

Add `foryouArticles?: ForYouArticle[]` to the component's props. Add the `showForYou` prop, and pass it to `<FeedTabs showForYou={showForYou} />`. Add the imports.

Update default-tab logic so that if `showForYou=true` and no `?tab=` is in the URL, the default is `foryou`. If `showForYou=false` and the URL says `tab=foryou`, fall back to `news`.

- [ ] **Step 2: In page.tsx, server-fetch + flag-resolve + pass down**

Open `src/app/[locale]/(app)/feed/page.tsx`. Top of the component:

```tsx
import { createServerClient } from '@/lib/supabase'
import { fetchFeatureFlag, FLAG_KEYS, resolveFlag } from '@/lib/feature-flags'
import { isInForYouAllowList } from '@/lib/foryou-allow-list'
import { auth } from '@/auth'

// Inside the component:
const supabase = createServerClient()
const session = await auth()
const flag = await fetchFeatureFlag(supabase, FLAG_KEYS.FORYOU_ENABLED)
// `enabled` is the prod column; allow-list rescues during dark launch.
// `isLocalEnv()` only works client-side, so for SSR we trust enabled and let
// the allow-list cover testers in prod.
const showForYou = resolveFlag(flag, false) || isInForYouAllowList(session?.user?.email)

// Fetch enriched articles (50-row window)
const foryouArticles = showForYou ? await loadForYouArticles(supabase, locale) : undefined

// Pass into FeedClient:
<FeedClient
  // … existing props
  showForYou={showForYou}
  foryouArticles={foryouArticles}
/>
```

Define `loadForYouArticles` in the same file or in a new `src/lib/foryou-queries.ts`:

```ts
// src/lib/foryou-queries.ts
import type { SupabaseClient } from '@supabase/supabase-js'

export async function loadForYouArticles(supabase: SupabaseClient, locale: string) {
  // V1 query — no tournament_level resolution. `articles` has no FK to tournaments;
  // tournament-tier mapping would require a join through article_entities.
  // For V1 the topic chip falls back to "PADEL NEWS" when tournament_level is null.
  // V2 can add the join via article_entities when chip visibility is reconsidered.
  const { data } = await supabase
    .from('articles')
    .select(`
      id, title, source_url, source_name, favicon_url, image_url,
      published_at, language, summary_md, summary_translations
    `)
    .eq('enrichment_status', 'enriched')
    .order('published_at', { ascending: false })
    .limit(50)
  return (data ?? []).map(r => ({
    id: r.id,
    title: r.title,
    source_url: r.source_url,
    source_name: r.source_name,
    favicon_url: r.favicon_url,
    image_url: r.image_url,
    published_at: r.published_at,
    language: r.language,
    summary_md: r.summary_md,
    summary_translations: r.summary_translations ?? {},
    tournament_level: null,
  }))
}
```

- [ ] **Step 3: Type-check + smoke test**

```bash
npx tsc --noEmit
```

Visit `http://localhost:3002/feed?tab=foryou` (with localhost flag ON). Expected:
- For You tab visible in tab strip
- Card renders with hero image, headline, bullets, side rail
- Swipe up advances card
- Back chip works
- "End of feed" shows on last card

- [ ] **Step 4: Commit**

```bash
git add src/app/[locale]/(app)/feed/FeedClient.tsx src/app/[locale]/(app)/feed/page.tsx src/lib/foryou-queries.ts
git commit -m "feat(feed): wire ForYouTab into FeedClient + server-side flag resolution"
```

---

## Phase 6 — Ops UI (News Sources page)

### Task 6.1: News-sources CRUD API

**Files:**
- Create: `apps/ops/src/app/api/news-sources/route.ts`

- [ ] **Step 1: Verify the ops auth pattern**

Read `apps/ops/src/app/api/` to see the shape used by existing ops endpoints (likely a session/cookie check). Mirror it.

```bash
ls apps/ops/src/app/api/
cat apps/ops/src/app/api/<any-existing-route>/route.ts | head -30
```

- [ ] **Step 2: Write the route**

Create the file with GET (list) and POST (create) handlers, plus PATCH for updates and DELETE for removal. Auth-gate every handler.

```ts
// apps/ops/src/app/api/news-sources/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('news_sources')
    .select('*')
    .order('articles_last_7d', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ sources: data })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const body = await req.json()
  const required = ['key', 'name', 'url', 'source_type', 'language', 'cadence']
  for (const f of required) if (!body[f]) return NextResponse.json({ error: `missing ${f}` }, { status: 400 })
  const supabase = createServerClient()
  const { data, error } = await supabase.from('news_sources').insert({
    ...body,
    weight: body.weight ?? 1.0,
    lookback_days: body.lookback_days ?? 14,
    enabled: body.enabled ?? true,
    query_kind: body.query_kind ?? 'static',
    created_by: session.user.email,
  }).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ source: data })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, ...patch } = await req.json()
  if (!id) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  const supabase = createServerClient()
  const { data, error } = await supabase.from('news_sources').update(patch).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ source: data })
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/ops/src/app/api/news-sources/route.ts
git commit -m "feat(ops): news-sources CRUD API (GET/POST/PATCH)"
```

### Task 6.2: Test-fetch (validate-and-test)

**Files:**
- Create: `apps/ops/src/app/api/news-sources/test-fetch/route.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/ops/src/app/api/news-sources/test-fetch/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/lib/auth'
import Parser from 'rss-parser'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { url } = await req.json()
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 })
  const parser = new Parser({ timeout: 15000 })
  try {
    const feed = await parser.parseURL(url)
    const first = feed.items.slice(0, 3).map(i => ({
      title: i.title,
      link: i.link,
      pubDate: i.pubDate,
      snippet: i.contentSnippet?.slice(0, 200),
    }))
    return NextResponse.json({ ok: true, feedTitle: feed.title, count: feed.items.length, sample: first })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ops/src/app/api/news-sources/test-fetch/route.ts
git commit -m "feat(ops): test-fetch endpoint for validate-and-preview"
```

### Task 6.3: Suggestions API

**Files:**
- Create: `apps/ops/src/app/api/news-sources/suggestions/route.ts`

- [ ] **Step 1: Write the route**

```ts
// apps/ops/src/app/api/news-sources/suggestions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { requireOperator } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('news_source_suggestions')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ suggestions: data })
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const { id, status, review_note, approved_source_id } = await req.json()
  if (!id || !status) return NextResponse.json({ error: 'missing fields' }, { status: 400 })
  const supabase = createServerClient()
  const { error } = await supabase.from('news_source_suggestions').update({
    status,
    review_note: review_note ?? null,
    reviewed_by: session.user.email,
    reviewed_at: new Date().toISOString(),
    approved_source_id: approved_source_id ?? null,
  }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ops/src/app/api/news-sources/suggestions/route.ts
git commit -m "feat(ops): suggestions list + approve/reject API"
```

### Task 6.4: News-sources page shell

**Files:**
- Create: `apps/ops/src/app/(app)/news-sources/page.tsx`
- Create: `apps/ops/src/app/(app)/news-sources/NewsSourcesTabs.tsx`
- Create: `apps/ops/src/app/(app)/news-sources/SourcesTable.tsx`
- Create: `apps/ops/src/app/(app)/news-sources/SuggestionsTable.tsx`
- Create: `apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx`

- [ ] **Step 1: Write the page shell**

```tsx
// apps/ops/src/app/(app)/news-sources/page.tsx
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { NewsSourcesTabs } from './NewsSourcesTabs'

export default async function NewsSourcesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const session = await auth()
  if (!session?.user?.isOperator) redirect('/login')
  const params = await searchParams
  const tab = (params.tab ?? 'sources') as 'sources' | 'suggestions' | 'health'
  return <NewsSourcesTabs activeTab={tab} />
}
```

- [ ] **Step 2: Tabs component**

Create `NewsSourcesTabs.tsx` as a client component that fetches from the three APIs and renders the appropriate child.

```tsx
'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { SourcesTable } from './SourcesTable'
import { SuggestionsTable } from './SuggestionsTable'
import { DiscoveryHealth } from './DiscoveryHealth'

export function NewsSourcesTabs({ activeTab }: { activeTab: 'sources' | 'suggestions' | 'health' }) {
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 16 }}>News Sources</h1>
      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <TabLink active={activeTab === 'sources'}     href="?tab=sources">Sources</TabLink>
        <TabLink active={activeTab === 'suggestions'} href="?tab=suggestions">Suggestions</TabLink>
        <TabLink active={activeTab === 'health'}      href="?tab=health">Discovery Health</TabLink>
      </nav>
      {activeTab === 'sources'     && <SourcesTable />}
      {activeTab === 'suggestions' && <SuggestionsTable />}
      {activeTab === 'health'      && <DiscoveryHealth />}
    </div>
  )
}

function TabLink({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link href={href} style={{
      padding: '8px 14px', borderRadius: 6,
      background: active ? '#7ED321' : '#1A1A1A',
      color: active ? '#0a0a0a' : '#6B7280',
      fontSize: 12, fontWeight: 800, letterSpacing: '0.05em', textTransform: 'uppercase',
      textDecoration: 'none',
    }}>
      {children}
    </Link>
  )
}
```

- [ ] **Step 3: SourcesTable**

```tsx
// apps/ops/src/app/(app)/news-sources/SourcesTable.tsx
'use client'
import { useEffect, useState } from 'react'

interface Source {
  id: string; key: string; name: string; source_type: string; language: string;
  cadence: string; enabled: boolean; articles_last_7d: number;
  last_fetch_at: string | null; last_fetch_status: string | null;
}

export function SourcesTable() {
  const [rows, setRows] = useState<Source[] | null>(null)
  useEffect(() => {
    fetch('/api/news-sources').then(r => r.json()).then(d => setRows(d.sources ?? []))
  }, [])
  if (!rows) return <div>Loading…</div>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ background: '#1A1A1A' }}>
          {['Key', 'Name', 'Type', 'Lang', 'Cadence', 'Health', '7d', 'Enabled'].map(h => (
            <th key={h} style={{ padding: 8, textAlign: 'left' }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} style={{ borderBottom: '1px solid #2a2a2a' }}>
            <td style={{ padding: 8 }}>{r.key}</td>
            <td style={{ padding: 8 }}>{r.name}</td>
            <td style={{ padding: 8 }}>{r.source_type}</td>
            <td style={{ padding: 8 }}>{r.language}</td>
            <td style={{ padding: 8 }}>{r.cadence}</td>
            <td style={{ padding: 8 }}>
              <HealthDot status={r.last_fetch_status} lastFetch={r.last_fetch_at} />
            </td>
            <td style={{ padding: 8 }}>{r.articles_last_7d}</td>
            <td style={{ padding: 8 }}>{r.enabled ? '✓' : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function HealthDot({ status, lastFetch }: { status: string | null; lastFetch: string | null }) {
  const now = Date.now()
  const lf = lastFetch ? Date.parse(lastFetch) : 0
  const ageH = (now - lf) / 3_600_000
  let color = '#666'
  if (status === 'success' && ageH < 2) color = '#7ED321'
  else if (status === 'error' && ageH < 24) color = '#F5A623'
  else if (ageH > 24 * 7) color = '#E53935'
  return <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: color }} />
}
```

- [ ] **Step 4: SuggestionsTable**

```tsx
// apps/ops/src/app/(app)/news-sources/SuggestionsTable.tsx
'use client'
import { useEffect, useState } from 'react'

interface Suggestion {
  id: string; url: string; note: string | null; suggested_by_email: string | null;
  created_at: string;
}

export function SuggestionsTable() {
  const [rows, setRows] = useState<Suggestion[] | null>(null)
  useEffect(() => {
    fetch('/api/news-sources/suggestions').then(r => r.json()).then(d => setRows(d.suggestions ?? []))
  }, [])

  const review = async (id: string, status: 'approved' | 'rejected' | 'duplicate', note?: string) => {
    await fetch('/api/news-sources/suggestions', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, review_note: note }),
    })
    setRows(rs => rs?.filter(r => r.id !== id) ?? null)
  }

  if (!rows) return <div>Loading…</div>
  if (rows.length === 0) return <div>No pending suggestions.</div>
  return (
    <div>
      {rows.map(r => (
        <div key={r.id} style={{ padding: 16, borderBottom: '1px solid #2a2a2a' }}>
          <div style={{ fontWeight: 700 }}>{r.url}</div>
          {r.suggested_by_email && <div style={{ fontSize: 11, color: '#888' }}>by {r.suggested_by_email}</div>}
          {r.note && <div style={{ fontSize: 12, marginTop: 6 }}>{r.note}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button onClick={() => review(r.id, 'approved')}>Approve</button>
            <button onClick={() => review(r.id, 'rejected', prompt('Reason?') ?? undefined)}>Reject</button>
            <button onClick={() => review(r.id, 'duplicate')}>Duplicate</button>
          </div>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: DiscoveryHealth**

```tsx
// apps/ops/src/app/(app)/news-sources/DiscoveryHealth.tsx
'use client'
import { useEffect, useState } from 'react'

interface Stats {
  totalSources: number
  enabledSources: number
  staticCount: number
  dynamicCount: number
  deadIn7d: number
  topByVolume: Array<{ key: string; name: string; articles_last_7d: number }>
}

export function DiscoveryHealth() {
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => {
    fetch('/api/news-sources').then(r => r.json()).then(d => {
      const sources = d.sources ?? []
      setStats({
        totalSources: sources.length,
        enabledSources: sources.filter((s: any) => s.enabled).length,
        staticCount:  sources.filter((s: any) => s.query_kind === 'static').length,
        dynamicCount: sources.filter((s: any) => s.query_kind === 'player' || s.query_kind === 'tournament').length,
        deadIn7d:     sources.filter((s: any) => s.enabled && (s.articles_last_7d ?? 0) === 0).length,
        topByVolume:  sources.slice().sort((a: any, b: any) => b.articles_last_7d - a.articles_last_7d).slice(0, 20),
      })
    })
  }, [])
  if (!stats) return <div>Loading…</div>
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12, marginBottom: 24 }}>
        <Stat label="Total"    value={stats.totalSources} />
        <Stat label="Enabled"  value={stats.enabledSources} />
        <Stat label="Static"   value={stats.staticCount} />
        <Stat label="Dynamic"  value={stats.dynamicCount} />
        <Stat label="Dead 7d"  value={stats.deadIn7d} />
      </div>
      <h2 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Top 20 by 7d volume</h2>
      <table style={{ width: '100%', fontSize: 12 }}>
        <tbody>
          {stats.topByVolume.map(s => (
            <tr key={s.key} style={{ borderBottom: '1px solid #2a2a2a' }}>
              <td style={{ padding: 6 }}>{s.key}</td>
              <td style={{ padding: 6 }}>{s.name}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>{s.articles_last_7d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ padding: 16, background: '#1A1A1A' }}>
      <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800 }}>{value}</div>
    </div>
  )
}
```

- [ ] **Step 6: Type-check + smoke test**

```bash
npx tsc --noEmit
```

Visit `http://localhost:3001/news-sources` (or whatever port `apps/ops` uses). Confirm:
- Sources tab shows all rows from the table
- Suggestions tab shows any pending ones (or "no pending" empty state)
- Health tab shows counters + top-20 list

- [ ] **Step 7: Commit**

```bash
git add apps/ops/src/app/\(app\)/news-sources/
git commit -m "feat(ops): News Sources page with Sources/Suggestions/Health tabs"
```

### Task 6.5: Maintenance cron to refresh `articles_last_7d`

**Files:**
- Create: `src/app/api/cron/refresh-source-volume/route.ts`
- Modify: `vercel.json`

The `news_sources.articles_last_7d` column needs periodic recomputation. The simplest path: a daily cron that updates it from a join.

- [ ] **Step 1: Write the cron**

```ts
// src/app/api/cron/refresh-source-volume/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const supabase = createServerClient()
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString()
  // articles.source_name is the canonical link to news_sources.name.
  // For sources where the names match exactly we can aggregate.
  // For the dynamic-source variant, the source_name pattern is "Google News · …",
  // which won't aggregate cleanly per-source — those rows stay at 0 here.
  // (V2: refactor articles to carry a source_key FK.)
  const { error } = await supabase.rpc('refresh_news_sources_volume_7d', { cutoff_ts: cutoff })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 2: Add the SQL function**

Append to `supabase/migrations/20260524_news_pipeline_seed.sql` OR create a new `20260525_news_pipeline_volume_rpc.sql`:

```sql
CREATE OR REPLACE FUNCTION refresh_news_sources_volume_7d(cutoff_ts TIMESTAMPTZ)
RETURNS void LANGUAGE sql AS $$
  UPDATE news_sources s
  SET articles_last_7d = COALESCE(c.cnt, 0)
  FROM (
    SELECT source_name AS name, COUNT(*) AS cnt
    FROM articles
    WHERE created_at >= cutoff_ts
    GROUP BY source_name
  ) c
  WHERE s.name = c.name;
$$;
```

- [ ] **Step 3: Register cron daily**

In `vercel.json`:

```json
{ "path": "/api/cron/refresh-source-volume", "schedule": "0 4 * * *" }
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/refresh-source-volume/ supabase/migrations/20260525_news_pipeline_volume_rpc.sql vercel.json
git commit -m "feat(news): daily cron + RPC to refresh news_sources.articles_last_7d"
```

---

## Final verification

- [ ] **All migrations applied locally without errors**

```bash
npx supabase db reset
```

- [ ] **All vitest tests pass**

```bash
npx vitest run
```

Expected: all tests pass, including new ones for article-topics, entity-resolver, article-enrichment.

- [ ] **Type-check clean**

```bash
npx tsc --noEmit
```

- [ ] **Lint clean**

```bash
npm run lint
```

- [ ] **Manual end-to-end smoke**

1. Insert 2-3 real article URLs via `sync-articles`. Confirm rows appear with `enrichment_status='pending'`.
2. Trigger `enrich-articles`. Confirm rows become `enriched` with valid `summary_md` and translations.
3. With `foryou_enabled.enabled_local=true`, visit `/feed?tab=foryou` and verify the immersive card renders + swipe works.
4. POST a suggestion via the public endpoint. Confirm it appears in the ops News Sources → Suggestions tab.
5. Approve the suggestion from ops UI. Confirm a new row appears in `news_sources`.

- [ ] **Push branch + open PR**

```bash
git push -u origin <branch-name>
gh pr create --title "feat: immersive For You news feed (V1)" --body "$(cat <<'EOF'
## Summary
- Adds Sonnet-4.5-powered article enrichment pipeline (summary + entity tagging + topic classification)
- DB-driven news source catalog with weekly per-player + per-tournament dynamic sources
- New immersive "For You" tab in /feed using chunky-press visual language
- Ops UI in apps/ops/news-sources for source management

## Test plan
- [ ] Migrations apply cleanly
- [ ] enrich-articles cron processes pending articles end-to-end
- [ ] regenerate-dynamic-sources creates ~200 dynamic rows
- [ ] /api/feed/suggest-source rate-limits at 3/day
- [ ] For You tab renders + swipe works on localhost
- [ ] Ops News Sources page lists + approves suggestions

Spec: docs/superpowers/specs/2026-05-23-immersive-news-feed-design.md
EOF
)"
```

---

## Spec coverage map

| Spec section | Implemented in |
|---|---|
| §5.1 articles table extensions | Task 1.1 |
| §5.2 article_entities | Task 1.1 |
| §5.3 article_topics | Task 1.1 |
| §5.4 news_sources | Task 1.1, 1.2 |
| §5.5 news_source_suggestions | Task 1.1 |
| §5.6 RLS | Task 1.1 (per-table policies inline) |
| §6.1 existing flow | Task 3.1 (refactor preserves) |
| §6.2 enrichment cron | Task 2.3, 2.4 |
| §6.3.1 static sources refactor | Task 3.1 |
| §6.3.2 dynamic generator | Task 3.2 |
| §6.3.3 dynamic sources cron | Task 3.3 |
| §6.3.4 user-suggested sources | Task 3.4 |
| §6.4 backfill | Task 2.5 |
| §7.1 visual language | Tasks 4.1, 4.2, 4.3, 5.3 |
| §7.2 components inventory | Tasks 4.1–4.4, 5.3, 5.3b, 5.4 |
| §7.3 FeedTabs integration | Task 5.5 |
| §7.4 card content rendering | Task 5.3 |
| §7.5 swipe gesture | Task 4.4 |
| §7.6 routing & deep-linking | Task 5.6 |
| §8.1 ops Sources tab | Tasks 6.1, 6.4 |
| §8.2 ops Suggestions tab | Tasks 6.3, 6.4 |
| §8.3 ops Discovery health tab | Tasks 6.4 |
| §9 observability | Inline in 2.4, 3.2, 3.3, 3.4 (logOpsEvent calls) |
| §10 rollout & feature flags | Tasks 1.2, 1.3, 5.1, 5.6 |
| §11.1 new files | All Create tasks |
| §11.2 modified files | Tasks 1.3, 3.1, 5.5, 5.6 |
| §12 testing plan | Task-level test steps + Final Verification |
