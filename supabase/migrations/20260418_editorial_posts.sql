-- editorial_posts — auto-generated tournament previews and recaps.
-- Generated in English via Claude Opus, translated to ES/PT/IT/FR via Haiku,
-- cached per-locale. Rendered as the Option-A "bold hero" block on tournament
-- detail pages (above the match list) to boost SEO + give users narrative context.
--
-- Wave 2 scope: `preview` (tournament starts ≤ 7 days out) and `recap`
-- (tournament finished). `match_report` and `player_bio` reserved for later waves.

CREATE TABLE IF NOT EXISTS editorial_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('tournament', 'match', 'player')),
  entity_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('preview', 'recap', 'match_report', 'player_bio')),
  locale TEXT NOT NULL CHECK (locale IN ('en', 'es', 'pt', 'it', 'fr')),

  -- Content
  headline TEXT NOT NULL,                 -- H2 of the block, e.g. "Coello & Galán defend title"
  lead TEXT NOT NULL,                     -- First paragraph (SEO-critical, 40–80 words)
  body_md TEXT NOT NULL,                  -- Full body as markdown (3–4 paragraphs including lead)
  callout_key TEXT,                       -- Optional pull-quote label (e.g. "Defending champion")
  callout_value TEXT,                     -- Optional pull-quote value (e.g. "Coello / Galán · Milan P1 2025")
  word_count INT NOT NULL,

  -- Provenance
  source_snapshot JSONB,                  -- Data that fed the post — useful for regeneration decisions
  translated_from UUID REFERENCES editorial_posts(id) ON DELETE CASCADE,  -- NULL for source-of-truth (en) posts
  model TEXT NOT NULL,                    -- Which Claude model produced this copy
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (entity_type, entity_id, kind, locale)
);

-- Hot-path lookup: "Give me the preview for tournament X in locale Y"
CREATE INDEX IF NOT EXISTS idx_editorial_posts_lookup
  ON editorial_posts (entity_type, entity_id, kind, locale);

-- Translation chain — find all translations of a given source post
CREATE INDEX IF NOT EXISTS idx_editorial_posts_translations
  ON editorial_posts (translated_from)
  WHERE translated_from IS NOT NULL;

-- Freshness sweeps — "which posts were generated recently / which are stale"
CREATE INDEX IF NOT EXISTS idx_editorial_posts_generated_at
  ON editorial_posts (generated_at DESC);

COMMENT ON TABLE editorial_posts IS
  'Auto-generated tournament previews/recaps. English version is source-of-truth; other locales are Haiku-translated copies linked via translated_from.';
COMMENT ON COLUMN editorial_posts.translated_from IS
  'NULL for English (source of truth). Non-NULL points at the English post whose translation this is.';
COMMENT ON COLUMN editorial_posts.source_snapshot IS
  'Snapshot of the structured data used to generate the post. Used to detect when regeneration would add value (new seeds, updated draw, etc.)';
