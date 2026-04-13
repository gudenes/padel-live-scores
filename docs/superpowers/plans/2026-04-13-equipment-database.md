# Padel Equipment Database Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a structured padel equipment database with brands, rackets, player equipment history, and affiliate click tracking — replacing the free-text equipment JSONB on players.

**Architecture:** Four new Supabase tables (`padel_brands`, `padel_rackets`, `player_equipment`, `racket_clicks`) with ops dashboard CRUD for brands and rackets, dropdown-based player equipment assignment, a click tracking API, and player profile reading from the joined tables.

**Tech Stack:** Next.js 16, Supabase (PostgreSQL), TypeScript, React 19.

**Spec:** `docs/superpowers/specs/2026-04-13-equipment-database-design.md`

---

## File Structure

```
supabase/migrations/20260413_equipment_database.sql    # 4 new tables + indexes
src/app/api/ops/brands/route.ts                        # Brand CRUD (GET list, POST create, PATCH update)
src/app/api/ops/rackets/route.ts                       # Racket CRUD (GET list, POST create, PATCH update)
src/app/api/ops/player-equipment/route.ts              # Player equipment (GET history, POST assign, PATCH end)
src/app/api/racket-click/route.ts                      # Affiliate click tracking
src/app/ops/BrandsTab.tsx                               # New ops tab: brands + rackets management
src/app/ops/OpsClient.tsx                               # Add "Brands & Equipment" tab
src/app/ops/PlayersTab.tsx                              # Update equipment section with dropdowns
src/app/[locale]/player/[id]/page.tsx                   # Read equipment from new tables
scripts/migrate-equipment-to-tables.ts                  # One-time JSONB migration
```

---

### Task 1: Database Migration — Create 4 Tables

**Files:**
- Create: `supabase/migrations/20260413_equipment_database.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260413_equipment_database.sql` with the complete SQL from the spec:

```sql
-- Padel Equipment Database
-- 4 tables: padel_brands, padel_rackets, player_equipment, racket_clicks

-- Brands
CREATE TABLE IF NOT EXISTS padel_brands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  website_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Rackets
CREATE TABLE IF NOT EXISTS padel_rackets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id UUID NOT NULL REFERENCES padel_brands(id),
  model TEXT NOT NULL,
  year INTEGER,
  shape TEXT,
  weight_grams INTEGER,
  balance TEXT,
  surface_material TEXT,
  image_url TEXT,
  product_url TEXT,
  click_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (brand_id, model, year)
);

-- Player equipment history
CREATE TABLE IF NOT EXISTS player_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  racket_id UUID NOT NULL REFERENCES padel_rackets(id) ON DELETE CASCADE,
  started_at DATE,
  ended_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (player_id, racket_id, started_at)
);

CREATE INDEX IF NOT EXISTS idx_player_equipment_current
  ON player_equipment (player_id) WHERE ended_at IS NULL;

-- Affiliate click tracking
CREATE TABLE IF NOT EXISTS racket_clicks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  racket_id UUID NOT NULL REFERENCES padel_rackets(id),
  player_id UUID REFERENCES players(id),
  user_id UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_racket_clicks_racket ON racket_clicks (racket_id);
CREATE INDEX IF NOT EXISTS idx_racket_clicks_player ON racket_clicks (player_id);

-- Enable RLS
ALTER TABLE padel_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE padel_rackets ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE racket_clicks ENABLE ROW LEVEL SECURITY;

-- Public read for all equipment tables
CREATE POLICY "Public read brands" ON padel_brands FOR SELECT USING (true);
CREATE POLICY "Public read rackets" ON padel_rackets FOR SELECT USING (true);
CREATE POLICY "Public read player_equipment" ON player_equipment FOR SELECT USING (true);

-- Authenticated users can insert clicks
CREATE POLICY "Insert clicks" ON racket_clicks FOR INSERT WITH CHECK (true);
CREATE POLICY "Public read clicks" ON racket_clicks FOR SELECT USING (true);
```

- [ ] **Step 2: Apply migration via Supabase dashboard**

Copy the SQL and run it in the Supabase SQL Editor.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260413_equipment_database.sql
git commit -m "feat(equipment): create brands, rackets, player_equipment, racket_clicks tables"
```

---

### Task 2: Brand & Racket CRUD APIs

**Files:**
- Create: `src/app/api/ops/brands/route.ts`
- Create: `src/app/api/ops/rackets/route.ts`

The implementing agent should:

- [ ] **Step 1: Read existing ops API patterns**

Read `src/app/api/ops/players/route.ts` to understand the auth pattern (ops_token cookie check) and response format. All ops APIs:
1. Check `cookies().get('ops_token')?.value` against `process.env.CRON_SECRET`
2. Return 401 if unauthorized
3. Use the service-key Supabase client (not the anon client)

- [ ] **Step 2: Create brands API**

Create `src/app/api/ops/brands/route.ts` with:

**GET** — List all brands (ordered by name):
```typescript
const { data } = await supabase
  .from('padel_brands')
  .select('*, racket_count:padel_rackets(count)')
  .order('name')
```
Return: `{ brands: [...] }`

**POST** — Create brand:
Request: `{ name: string, logo_url?: string, website_url?: string }`
Insert into `padel_brands`. Return: `{ brand: {...} }`

**PATCH** — Update brand:
Request: `{ id: string, updates: Record<string, unknown> }`
Update `padel_brands` by id. Return: `{ brand: {...} }`

- [ ] **Step 3: Create rackets API**

Create `src/app/api/ops/rackets/route.ts` with:

**GET** — List rackets (optionally filtered by brand_id):
```typescript
let query = supabase
  .from('padel_rackets')
  .select('*, brand:padel_brands(id, name, logo_url)')
  .order('year', { ascending: false })
  .order('model')
const brandId = url.searchParams.get('brand_id')
if (brandId) query = query.eq('brand_id', brandId)
```
Return: `{ rackets: [...] }`

**POST** — Create racket:
Request: `{ brand_id, model, year, shape?, weight_grams?, balance?, surface_material?, image_url?, product_url? }`
Insert into `padel_rackets`. Return: `{ racket: {...} }`

**PATCH** — Update racket:
Request: `{ id: string, updates: Record<string, unknown> }`
Update `padel_rackets` by id. Return: `{ racket: {...} }`

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
git add src/app/api/ops/brands/ src/app/api/ops/rackets/
git commit -m "feat(equipment): add brand and racket CRUD APIs for ops dashboard"
```

---

### Task 3: Player Equipment API

**Files:**
- Create: `src/app/api/ops/player-equipment/route.ts`

- [ ] **Step 1: Create player equipment API**

**GET** — Get equipment history for a player:
Query param: `player_id`
```typescript
const { data } = await supabase
  .from('player_equipment')
  .select('*, racket:padel_rackets(*, brand:padel_brands(id, name, logo_url))')
  .eq('player_id', playerId)
  .order('ended_at', { ascending: true, nullsFirst: false })
  .order('started_at', { ascending: false })
```
Return: `{ equipment: [...] }` — current racket is the one with `ended_at = null`

**POST** — Assign racket to player:
Request: `{ player_id, racket_id, started_at? }`
1. First, set `ended_at = today` on any existing row where `ended_at IS NULL` for this player
2. Then insert new row with `ended_at = NULL`
Return: `{ assignment: {...} }`

**PATCH** — End an equipment assignment:
Request: `{ id, ended_at }`
Update the `player_equipment` row. Return: `{ assignment: {...} }`

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -5
git add src/app/api/ops/player-equipment/
git commit -m "feat(equipment): add player equipment assignment API"
```

---

### Task 4: Racket Click Tracking API

**Files:**
- Create: `src/app/api/racket-click/route.ts`

- [ ] **Step 1: Create click tracking endpoint**

This is a public API (no ops auth needed — called from the player profile).

**POST** — Track a racket click:
Request: `{ racket_id: string, player_id?: string }`
1. Look up the racket's `product_url`
2. Insert into `racket_clicks` (racket_id, player_id, user_id from auth session)
3. Increment `padel_rackets.click_count` via `supabase.rpc` or direct update
4. Return: `{ url: string }` — the product URL for the client to redirect to

```typescript
// Get product URL
const { data: racket } = await supabase
  .from('padel_rackets')
  .select('product_url')
  .eq('id', racketId)
  .single()

if (!racket?.product_url) return Response.json({ error: 'No product URL' }, { status: 404 })

// Track click (fire-and-forget)
void supabase.from('racket_clicks').insert({
  racket_id: racketId,
  player_id: playerId ?? null,
  user_id: session?.user?.id ?? null,
})

// Increment click count
void supabase.rpc('increment_click_count', { rid: racketId })
// OR: void supabase.from('padel_rackets').update({ click_count: racket.click_count + 1 }).eq('id', racketId)

return Response.json({ url: racket.product_url })
```

Note: Add a simple Postgres function for atomic increment if using rpc, or just use a direct update.

- [ ] **Step 2: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -5
git add src/app/api/racket-click/
git commit -m "feat(equipment): add racket click tracking API for affiliate links"
```

---

### Task 5: Ops Dashboard — Brands & Equipment Tab

**Files:**
- Create: `src/app/ops/BrandsTab.tsx`
- Modify: `src/app/ops/OpsClient.tsx`

- [ ] **Step 1: Read existing ops tab patterns**

Read `src/app/ops/PlayersTab.tsx` for UI patterns: card styles, table styles, form inputs, save handlers. Read `src/app/ops/OpsClient.tsx` to understand how tabs are registered and rendered.

- [ ] **Step 2: Create BrandsTab component**

Create `src/app/ops/BrandsTab.tsx` — a `'use client'` component with two sections:

**Brands section:**
- Fetch brands on mount via `GET /api/ops/brands`
- Table: name, logo (small img preview), website, racket count, Edit button
- "Add Brand" button opens an inline form above the table
- Form fields: Name (text), Logo URL (text + img preview), Website URL (text)
- Save calls `POST /api/ops/brands` or `PATCH /api/ops/brands`
- Style matches existing ops dashboard (white background, light borders, 11px fonts)

**Rackets section:**
- Fetch rackets via `GET /api/ops/rackets` (optionally filtered by brand)
- Brand filter dropdown at top
- Table: brand name, model, year, shape, weight, image (small preview), clicks, Edit button
- "Add Racket" button opens inline form
- Form: Brand (dropdown from brands list), Model (text), Year (number), Shape (dropdown: diamond/round/teardrop/hybrid), Weight (number), Balance (dropdown: low/medium/high), Surface Material (text), Image URL (text + preview), Product URL (text)
- Save calls `POST /api/ops/rackets` or `PATCH /api/ops/rackets`

- [ ] **Step 3: Register tab in OpsClient**

In `src/app/ops/OpsClient.tsx`:
1. Import `BrandsTab` (lazy or direct)
2. Add `'brands'` to the tab type
3. Add tab button in the sidebar under "Data Management"
4. Render `<BrandsTab />` when `tab === 'brands'`

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
git add src/app/ops/BrandsTab.tsx src/app/ops/OpsClient.tsx
git commit -m "feat(equipment): add Brands & Equipment ops dashboard tab"
```

---

### Task 6: Update Players Tab — Equipment Dropdowns

**Files:**
- Modify: `src/app/ops/PlayersTab.tsx`

- [ ] **Step 1: Read the current equipment section**

Read the equipment editing section in PlayersTab.tsx (the section with `equipmentFields` state and the 5 text inputs for brand, model, etc.).

- [ ] **Step 2: Replace free-text inputs with dropdowns**

Replace the current equipment section with:

1. **Fetch brands and rackets** on mount (or when player selected):
```typescript
const [brands, setBrands] = useState<Array<{ id: string; name: string; logo_url: string | null }>>([])
const [rackets, setRackets] = useState<Array<{ id: string; model: string; year: number | null; brand_id: string; image_url: string | null }>>([])
const [selectedBrandId, setSelectedBrandId] = useState<string>('')
const [selectedRacketId, setSelectedRacketId] = useState<string>('')
const [playerEquipment, setPlayerEquipment] = useState<Array<any>>([])
```

2. **Brand dropdown** — `<select>` populated from `brands`. On change, filter rackets by `brand_id`.
3. **Racket dropdown** — `<select>` populated from `rackets` filtered by selected brand. Shows model + year.
4. **"Assign Racket" button** — calls `POST /api/ops/player-equipment` with `{ player_id, racket_id }`.
5. **Current equipment display** — shows the current racket (from `playerEquipment` where `ended_at === null`) with brand logo + racket image from the joined data.
6. **Equipment history list** — shows past rackets with date ranges and "End" buttons.
7. **Preview card** — same dark preview card but reads brand logo from `brands` array and racket image from `rackets` array based on selections.

Remove the old `equipmentFields` state and the 5 text inputs. Remove equipment from `handleSavePlayer`.

- [ ] **Step 3: Fetch player equipment on player select**

In the `selectPlayer` callback, after fetching player detail, also fetch:
```typescript
const eqRes = await fetch(`/api/ops/player-equipment?player_id=${id}`)
const eqData = await eqRes.json()
setPlayerEquipment(eqData.equipment ?? [])
```

- [ ] **Step 4: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
git add src/app/ops/PlayersTab.tsx
git commit -m "feat(equipment): replace free-text inputs with brand/racket dropdowns in Players tab"
```

---

### Task 7: Update Player Profile to Read from New Tables

**Files:**
- Modify: `src/app/[locale]/player/[id]/page.tsx`

- [ ] **Step 1: Read the current equipment widget**

Find the "Plays with" Widget in the Overview tab (around line 945-970). Currently reads from `player.equipment` JSONB.

- [ ] **Step 2: Add equipment query**

After the main player fetch, add a separate query for current equipment:

```typescript
const { data: equipmentData } = await supabase
  .from('player_equipment')
  .select('racket:padel_rackets(id, model, year, image_url, product_url, brand:padel_brands(name, logo_url))')
  .eq('player_id', id)
  .is('ended_at', null)
  .limit(1)
  .single()
```

Note: This must be done in a `useEffect` or alongside the existing player fetch. The player profile page is a client component — add the fetch in the existing data loading flow.

- [ ] **Step 3: Update the Widget card**

Replace the equipment Widget to read from `equipmentData` instead of `player.equipment`:
- Brand logo: `equipmentData.racket.brand.logo_url`
- Brand name: `equipmentData.racket.brand.name`
- Model: `equipmentData.racket.model`
- Year: `equipmentData.racket.year`
- Image: `equipmentData.racket.image_url`
- Product URL: `equipmentData.racket.product_url`

- [ ] **Step 4: Update "Learn more" click to use tracking API**

Replace the direct `<a href={product_url}>` with:
```typescript
const handleRacketClick = async (racketId: string, playerId: string) => {
  const res = await fetch('/api/racket-click', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ racket_id: racketId, player_id: playerId }),
  })
  if (res.ok) {
    const { url } = await res.json()
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}
```

- [ ] **Step 5: Verify and commit**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
git add src/app/[locale]/player/[id]/page.tsx
git commit -m "feat(equipment): read player equipment from new tables + track affiliate clicks"
```

---

### Task 8: Migrate Existing JSONB Data to New Tables

**Files:**
- Create: `scripts/migrate-equipment-to-tables.ts`

- [ ] **Step 1: Create the migration script**

The script should:
1. Fetch all players with non-null `equipment` JSONB
2. For each unique `racket_brand` value, upsert into `padel_brands`
3. For each unique brand+model combination, upsert into `padel_rackets` (carry over `racket_image` and `racket_url` from JSONB if present)
4. For each player, create a `player_equipment` row (current, `ended_at = NULL`)
5. Print a summary of what was migrated

Use the same env loading pattern as `scripts/seed-player-equipment.ts` (read `.env.local` manually).

- [ ] **Step 2: Run the migration**

```bash
npx tsx scripts/migrate-equipment-to-tables.ts
```

- [ ] **Step 3: Verify data**

Check in Supabase dashboard:
- `padel_brands` has the expected brands
- `padel_rackets` has the expected rackets linked to brands
- `player_equipment` has rows linking players to rackets

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate-equipment-to-tables.ts
git commit -m "feat(equipment): add JSONB to tables migration script"
```

---

### Task 9: Smoke Test + Polish

- [ ] **Step 1: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "error TS" | head -10
```

- [ ] **Step 2: Test ops Brands & Equipment tab**

1. Navigate to `/ops` → Brands & Equipment tab
2. Add a brand (e.g. "HEAD" with logo URL)
3. Verify brand appears in table with logo preview
4. Add a racket (select HEAD, model "Coello Pro", year 2025, diamond shape)
5. Verify racket appears in table

- [ ] **Step 3: Test player equipment assignment**

1. Go to ops Players tab → search for "Arturo Coello"
2. In equipment section, select brand "HEAD" from dropdown
3. Select racket "Coello Pro 2025" from filtered dropdown
4. Click "Assign Racket"
5. Verify current equipment shows with preview card

- [ ] **Step 4: Test player profile (public)**

1. Navigate to Arturo Coello's player profile
2. Verify "Plays with" widget shows HEAD brand + Coello Pro model
3. Click "Learn more" → verify new tab opens to product URL
4. Check `racket_clicks` table in Supabase → verify click was logged

- [ ] **Step 5: Fix any issues**

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(equipment): smoke test polish"
```
