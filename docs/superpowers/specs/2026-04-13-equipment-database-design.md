# Padel Equipment Database — Design Spec

**Date:** 2026-04-13
**Status:** Approved for implementation

## Overview

Build a structured padel equipment database with brands, rackets, and player equipment history. Replaces the free-text `equipment` JSONB on players with proper relational tables. Enables racket database pages, brand pages, affiliate click tracking, and historical equipment timelines.

**Core goal:** Maintain equipment data once per brand/racket and reuse across all players — no duplicate image URLs or brand names per player.

## Data Model

### `padel_brands` — Brand entity

```sql
CREATE TABLE padel_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  logo_url TEXT,                    -- Brand logo image URL
  website_url TEXT,                 -- Brand website
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

~10-15 brands: HEAD, Bullpadel, Nox, Babolat, Adidas, Siux, Wilson, StarVie, Lok, Varlion, Dunlop.

### `padel_rackets` — Racket entity (central)

```sql
CREATE TABLE padel_rackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES padel_brands(id),
  model TEXT NOT NULL,              -- "Coello Pro"
  year INTEGER,                     -- 2025
  -- Specs
  shape TEXT,                       -- 'diamond' | 'round' | 'teardrop' | 'hybrid'
  weight_grams INTEGER,             -- e.g. 365
  balance TEXT,                     -- 'low' | 'medium' | 'high'
  surface_material TEXT,            -- e.g. "Carbon fibre", "Fiberglass"
  -- Images & links
  image_url TEXT,                   -- Product image URL
  product_url TEXT,                 -- Affiliate link to buy
  -- Tracking
  click_count INTEGER DEFAULT 0,    -- Denormalized for quick display
  -- Meta
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (brand_id, model, year)
);
```

### `player_equipment` — Player × Racket junction (with history)

```sql
CREATE TABLE player_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  racket_id UUID NOT NULL REFERENCES padel_rackets(id) ON DELETE CASCADE,
  started_at DATE,                  -- When player started using this racket
  ended_at DATE,                    -- NULL = current racket
  notes TEXT,                       -- Optional: "Signature model", "Tournament-only"
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (player_id, racket_id, started_at)
);

-- Index for "current racket" query
CREATE INDEX idx_player_equipment_current
  ON player_equipment (player_id)
  WHERE ended_at IS NULL;
```

Current racket query: `WHERE player_id = $1 AND ended_at IS NULL`

### `racket_clicks` — Affiliate click tracking

```sql
CREATE TABLE racket_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  racket_id UUID NOT NULL REFERENCES padel_rackets(id),
  player_id UUID REFERENCES players(id),  -- Which player profile was clicked from
  user_id UUID,                           -- Logged-in user (nullable)
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_racket_clicks_racket ON racket_clicks (racket_id);
CREATE INDEX idx_racket_clicks_player ON racket_clicks (player_id);
```

Fire-and-forget insert on "Learn more" click. Periodically update `padel_rackets.click_count` from this table.

## Ops Dashboard

### New "Brands & Equipment" tab

Two sections in a single tab:

**Brands section (top):**
- Table listing all brands: name, logo preview, website, racket count
- Add Brand button → inline form: name, logo URL, website URL
- Edit brand → same inline form
- Logo preview shows the actual image (white-filtered on dark background, same as player profile)

**Rackets section (bottom):**
- Table listing rackets: brand (from dropdown), model, year, shape, weight, image preview, click count
- Filter by brand dropdown
- Add Racket button → form: brand (dropdown), model, year, shape (dropdown: diamond/round/teardrop/hybrid), weight, balance (dropdown: low/medium/high), surface material, image URL, product URL (affiliate)
- Edit racket → same form
- Image preview shows the racket image if URL provided

### Players tab changes

Replace the current free-text equipment inputs with:

1. **Brand dropdown** — populated from `padel_brands` table. Shows brand name + small logo.
2. **Racket dropdown** — filtered by selected brand, populated from `padel_rackets`. Shows model + year.
3. **"Assign" button** — creates a `player_equipment` row with `ended_at = NULL`.
4. **Current equipment display** — shows the assigned racket with brand logo + racket image (from the racket table, not per-player).
5. **Equipment history** — small list below showing past rackets with date ranges.

The preview card stays but now reads from the selected racket's data (brand logo from `padel_brands.logo_url`, racket image from `padel_rackets.image_url`).

## Player Profile (Public)

### Query

```sql
SELECT
  pe.started_at,
  r.model, r.year, r.image_url, r.product_url, r.shape, r.weight_grams,
  b.name AS brand_name, b.logo_url AS brand_logo
FROM player_equipment pe
JOIN padel_rackets r ON r.id = pe.racket_id
JOIN padel_brands b ON b.id = r.brand_id
WHERE pe.player_id = $1
  AND pe.ended_at IS NULL
LIMIT 1
```

### Widget card

Same "Plays with" widget design but data comes from the joined query:
- Brand logo from `padel_brands.logo_url`
- Racket image from `padel_rackets.image_url`
- Model name from `padel_rackets.model` + `year`
- "Learn more" link from `padel_rackets.product_url`

### Click tracking

When user taps "Learn more":
1. Fire-and-forget insert into `racket_clicks` (racket_id, player_id, user_id)
2. Navigate to `product_url` in new tab

## Affiliate Click API

New endpoint: `POST /api/racket-click`

```typescript
// Request: { racket_id: string, player_id?: string }
// Response: { url: string } (the product URL to redirect to)
//
// Side effect: inserts into racket_clicks, increments padel_rackets.click_count
```

The "Learn more" link calls this API instead of linking directly. This ensures every click is tracked before redirect.

## Migration from JSONB

One-time migration script:
1. Read all players with `equipment` JSONB
2. For each unique `racket_brand`, create or find a `padel_brands` row
3. For each unique `racket_brand + racket_model`, create or find a `padel_rackets` row (copy `racket_image`, `racket_url` from JSONB)
4. Create `player_equipment` row linking player → racket (current, `ended_at = NULL`)
5. Keep `equipment` JSONB column for backward compat (read from new tables, don't write to JSONB)

## Scope

### In scope
- 4 new database tables (brands, rackets, player_equipment, racket_clicks)
- Ops "Brands & Equipment" tab (brand + racket CRUD)
- Ops Players tab: brand/racket dropdowns replacing free-text inputs
- Player profile reads from new tables
- Racket click tracking API
- JSONB migration script

### Out of scope (future)
- Public racket database pages (`/racket/[id]`)
- Public brand pages (`/brand/[id]`)
- Racket comparison tool
- Historical timeline UI on player profile
- Racket specs on player profile widget (just brand + model for now)
- i18n for racket specs (shape names, etc.)
- Image upload to Supabase Storage (URLs only for now)

## File Structure

```
supabase/migrations/20260413_equipment_database.sql   -- 4 new tables
src/app/api/ops/brands/route.ts                       -- Brand CRUD API
src/app/api/ops/rackets/route.ts                      -- Racket CRUD API
src/app/api/racket-click/route.ts                     -- Click tracking API
src/app/ops/BrandsTab.tsx                              -- New ops tab
src/app/ops/PlayersTab.tsx                             -- Update equipment section
src/app/ops/OpsClient.tsx                              -- Add Brands & Equipment tab
src/app/[locale]/player/[id]/page.tsx                  -- Read from new tables
scripts/migrate-equipment-to-tables.ts                 -- One-time JSONB migration
```
