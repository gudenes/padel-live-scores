# Where-to-Watch unification implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the matches-page "YouTube live" popup and the tournament-page broadcasters card into one channel-grouped "Where to Watch" popup; nest regional broadcasters under their licensed channel; add a region-override footer.

**Architecture:** One reusable `<WhereToWatchPill>` (button + popup) mounted on both `/matches/[date]` and `/tournaments/[id]`. A pure `buildGroups` function transforms `(liveChannels, broadcasters, todayCircuits, country)` into `ChannelGroup[]` that the popup renders top-down. Broadcasters get a new `channel_id` FK to indicate which YouTube channel's content they license. Spec: [docs/superpowers/specs/2026-05-15-where-to-watch-unification-design.md](../specs/2026-05-15-where-to-watch-unification-design.md).

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Postgres, next-intl (5 locales), Vitest.

---

## File structure

**New files:**

```
src/components/where-to-watch/
  WhereToWatchPill.tsx          — trigger pill (client, opens popup)
  WhereToWatchPopup.tsx         — modal frame + group list + region footer + picker toggle
  ChannelGroup.tsx              — one channel block (header + YT rows + broadcaster rows)
  BroadcasterRow.tsx            — single regional broadcaster row
  RegionPicker.tsx              — inline country list (replaces popup body when active)
  keyframes.ts                  — shared CSS keyframes string

src/lib/where-to-watch/
  circuit-map.ts                — tournament level → channel abbreviation lookup
  group-builder.ts              — pure (inputs) → ChannelGroup[]
  fetch-broadcasters.ts         — server-side query helper

src/lib/__tests__/
  group-builder.test.ts         — unit tests for the pure grouping fn

scripts/
  backfill-broadcasters-channel-id.mjs   — one-shot script

supabase/migrations/
  20260515_broadcasters_channel_id.sql   — add channel_id FK + index
```

**Modified files:**

```
src/components/MatchesFilterBar.tsx                   — swap YoutubeLiveIndicator → WhereToWatchPill
src/components/MatchesDayShell.tsx                    — pass through new props
src/app/[locale]/(app)/matches/[date]/page.tsx        — fetch broadcasters server-side
src/app/[locale]/(app)/tournaments/[id]/page.tsx      — remove <WhereToWatch />, add <WhereToWatchPill />
src/app/api/cron/sync-broadcasters/route.ts           — set channel_id on UPSERT
src/messages/{en,es,pt,it,fr}.json                    — add whereToWatch.* keys
```

**Deleted files (last task):**

```
src/components/YoutubeLiveIndicator.tsx
src/components/WhereToWatch.tsx
src/app/[locale]/(app)/matches/[date]/DailyWhereToWatch.tsx   — never wired anywhere
```

---

## Task 1: Schema migration — add `broadcasters.channel_id`

**Files:**
- Create: `supabase/migrations/20260515_broadcasters_channel_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/20260515_broadcasters_channel_id.sql
-- Add channel_id FK to broadcasters so the new Where-to-Watch popup
-- can nest regional broadcasters under the YouTube channel whose
-- content they license. Premier Padel today; FIP/PadelTV later.
-- Spec: docs/superpowers/specs/2026-05-15-where-to-watch-unification-design.md

ALTER TABLE broadcasters
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES youtube_channels(id);

CREATE INDEX IF NOT EXISTS broadcasters_channel_id_idx
  ON broadcasters (channel_id)
  WHERE channel_id IS NOT NULL;

COMMENT ON COLUMN broadcasters.channel_id IS
  'YouTube channel whose content this broadcaster is licensed to carry. NULL means unclassified — rows with NULL do not render in the new Where-to-Watch popup.';
```

- [ ] **Step 2: Apply locally**

Run: `npx supabase db push --local` (or whatever the project uses — check `package.json` for migration script, e.g. `npm run db:push`)

Expected: migration applies cleanly. Verify with:
```bash
psql $DATABASE_URL -c "\d broadcasters" | grep channel_id
```
Expected: `channel_id | uuid` shows in the column list.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260515_broadcasters_channel_id.sql
git commit -m "feat(broadcasters): add channel_id FK to youtube_channels"
```

---

## Task 2: Backfill existing broadcasters to Premier Padel channel

**Why:** All existing broadcaster rows come from Premier Padel's API (per the `20260407_broadcasters.sql` header comment). They all license Premier Padel content, so every row gets the same channel_id.

**Files:**
- Create: `scripts/backfill-broadcasters-channel-id.mjs`

- [ ] **Step 1: Write the script (dry-run by default)**

```javascript
// scripts/backfill-broadcasters-channel-id.mjs
// One-shot: set channel_id on every existing broadcasters row.
// All existing rows come from Premier Padel's API → all link to the
// Premier Padel youtube_channel (abbreviation='PP').
//
// Defaults to dry-run; pass --apply to mutate.

import { promises as fs } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile('.env.local', 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('='); if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

const apply = process.argv.includes('--apply')

await loadEnv()
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const { data: ppChannel, error: chErr } = await s
  .from('youtube_channels')
  .select('id, name, abbreviation')
  .eq('abbreviation', 'PP')
  .single()
if (chErr || !ppChannel) {
  console.error('Premier Padel channel not found (expected abbreviation=PP):', chErr)
  process.exit(1)
}
console.log(`Premier Padel channel: ${ppChannel.id} (${ppChannel.name})`)

const { count, error: countErr } = await s
  .from('broadcasters')
  .select('*', { count: 'exact', head: true })
  .is('channel_id', null)
if (countErr) { console.error(countErr); process.exit(1) }
console.log(`Broadcasters with NULL channel_id: ${count}`)

if (count === 0) { console.log('Nothing to backfill.'); process.exit(0) }

console.log(`${apply ? '[APPLY]' : '[DRY RUN]'} Would set channel_id = ${ppChannel.id} on ${count} rows.`)

if (!apply) {
  console.log('\n[DRY RUN] No writes. Re-run with --apply.')
  process.exit(0)
}

const { error: upErr } = await s
  .from('broadcasters')
  .update({ channel_id: ppChannel.id })
  .is('channel_id', null)
if (upErr) { console.error(upErr); process.exit(1) }
console.log('OK — backfill complete.')
```

- [ ] **Step 2: Dry-run**

Run: `node scripts/backfill-broadcasters-channel-id.mjs`
Expected: prints PP channel UUID + count of NULL rows + "[DRY RUN] No writes."

- [ ] **Step 3: Apply**

Run: `node scripts/backfill-broadcasters-channel-id.mjs --apply`
Expected: "OK — backfill complete."

Verify:
```bash
psql $DATABASE_URL -c "SELECT count(*) FROM broadcasters WHERE channel_id IS NULL"
```
Expected: `0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/backfill-broadcasters-channel-id.mjs
git commit -m "chore(broadcasters): backfill channel_id for Premier Padel rows"
```

---

## Task 3: Update `sync-broadcasters` cron to set channel_id on UPSERT

**Why:** The weekly sync re-imports broadcaster rows from Premier's API. Without this change, new rows would land with `channel_id = NULL` and silently disappear from the popup.

**Files:**
- Modify: `src/app/api/cron/sync-broadcasters/route.ts`

- [ ] **Step 1: Read the existing route to find the upsert**

Run: `grep -n "broadcasters\|upsert\|insert" src/app/api/cron/sync-broadcasters/route.ts | head -10`

Identify the line where rows are inserted/upserted into `broadcasters`. The function probably builds an array of rows, then calls `supabase.from('broadcasters').upsert(...)`.

- [ ] **Step 2: Fetch the Premier Padel channel id once at the top of the handler**

Add, right after the `createClient` line:

```typescript
const { data: ppChannel } = await supabase
  .from('youtube_channels')
  .select('id')
  .eq('abbreviation', 'PP')
  .maybeSingle()
const premierPadelChannelId = ppChannel?.id ?? null
```

If `premierPadelChannelId` is null (PP channel not seeded), log a warning and proceed — rows will have NULL channel_id and won't render until backfilled.

- [ ] **Step 3: Add channel_id to each row in the upsert payload**

When building the rows array, add `channel_id: premierPadelChannelId` to every row.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/cron/sync-broadcasters/route.ts
git commit -m "feat(sync-broadcasters): set channel_id on upserted rows"
```

---

## Task 4: Add `circuit-map.ts`

**Files:**
- Create: `src/lib/where-to-watch/circuit-map.ts`

- [ ] **Step 1: Write the lookup table**

```typescript
// src/lib/where-to-watch/circuit-map.ts
//
// Map tournament.level → YouTube channel abbreviation. Used by the
// Where-to-Watch popup to decide whether a circuit has matches scheduled
// today (which in turn drives whether to surface its broadcaster rows).
//
// Why abbreviation, not UUID: youtube_channels.abbreviation is unique +
// human-readable, and the channel records already have it ('PP', 'FIP').
// Avoids hardcoding UUIDs that differ per environment.

export const TOURNAMENT_LEVEL_TO_CHANNEL_ABBR: Record<string, string> = {
  // Premier Padel circuit
  p1: 'PP',
  p2: 'PP',
  major: 'PP',
  premier_mens: 'PP',
  premier_womens: 'PP',
  // FIP Tour circuit
  bronze: 'FIP',
  silver: 'FIP',
  gold: 'FIP',
  platinum: 'FIP',
}

export function levelToChannelAbbr(level: string | null | undefined): string | null {
  if (!level) return null
  return TOURNAMENT_LEVEL_TO_CHANNEL_ABBR[level.toLowerCase()] ?? null
}

/**
 * Given an array of today's matches (with tournament.level), return the set
 * of channel abbreviations whose circuit has at least one match today.
 */
export function circuitsForToday(
  matches: Array<{ tournament?: { level?: string | null } | null }>
): Set<string> {
  const result = new Set<string>()
  for (const m of matches) {
    const abbr = levelToChannelAbbr(m.tournament?.level)
    if (abbr) result.add(abbr)
  }
  return result
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/where-to-watch/circuit-map.ts
git commit -m "feat(where-to-watch): add circuit-map lookup for tournament levels"
```

---

## Task 5: Implement `group-builder.ts` (TDD)

**Files:**
- Create: `src/lib/__tests__/group-builder.test.ts`
- Create: `src/lib/where-to-watch/group-builder.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/group-builder.test.ts
import { describe, it, expect } from 'vitest'
import { buildGroups, type LiveChannel, type BroadcasterRow } from '@/lib/where-to-watch/group-builder'

const PP_CHANNEL_ID = '11111111-1111-1111-1111-111111111111'
const FIP_CHANNEL_ID = '22222222-2222-2222-2222-222222222222'

const ppChannelMeta = {
  id: PP_CHANNEL_ID, name: 'Premier Padel', abbreviation: 'PP',
  colorHex: '#FF0000', displayOrder: 10,
}
const fipChannelMeta = {
  id: FIP_CHANNEL_ID, name: 'FIP Tour', abbreviation: 'FIP',
  colorHex: '#1657A0', displayOrder: 20,
}

const movistar: BroadcasterRow = {
  id: 'b1', name: 'Movistar Plus+', url: 'https://movistar.es',
  logo_url: null, is_free: false, display_order: 100,
  country_iso2: 'es', channel_id: PP_CHANNEL_ID,
}
const redBull: BroadcasterRow = {
  id: 'b2', name: 'Red Bull TV', url: 'https://redbull.tv',
  logo_url: null, is_free: true, display_order: 50,
  country_iso2: 'es', channel_id: PP_CHANNEL_ID,
}

const ppLive: LiveChannel = {
  videoId: 'vid1', title: 'BA P1 Centre Court', channel: ppChannelMeta,
}
const fipLive: LiveChannel = {
  videoId: 'vid2', title: 'Cyprus Bronze SF', channel: fipChannelMeta,
}

describe('buildGroups', () => {
  it('returns empty array when there is nothing to show', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [],
      todayCircuits: new Set(),
      country: 'es',
    })
    expect(groups).toEqual([])
  })

  it('renders a YT-only group when no broadcasters available', () => {
    const groups = buildGroups({
      liveChannels: [ppLive],
      broadcasters: [],
      todayCircuits: new Set(['PP']),
      country: null,
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].channelId).toBe(PP_CHANNEL_ID)
    expect(groups[0].hasLive).toBe(true)
    expect(groups[0].liveStreams).toHaveLength(1)
    expect(groups[0].broadcasters).toHaveLength(0)
  })

  it('nests broadcasters under the matching channel', () => {
    const groups = buildGroups({
      liveChannels: [ppLive],
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['PP']),
      country: 'es',
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].liveStreams).toHaveLength(1)
    // Free first, by display_order ascending
    expect(groups[0].broadcasters.map(b => b.id)).toEqual(['b2', 'b1'])
  })

  it('renders a broadcaster-only group when channel has no live but circuit has matches today', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['PP']),
      country: 'es',
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].hasLive).toBe(false)
    expect(groups[0].liveStreams).toHaveLength(0)
    expect(groups[0].broadcasters).toHaveLength(2)
  })

  it('omits a broadcaster-only group when its circuit has no matches today', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['FIP']), // PP not in today
      country: 'es',
    })
    expect(groups).toEqual([])
  })

  it('keeps YT-live groups regardless of todayCircuits', () => {
    // FIP live but no FIP-tier match on the page → still show it
    const groups = buildGroups({
      liveChannels: [fipLive],
      broadcasters: [],
      todayCircuits: new Set(['PP']),
      country: 'es',
    })
    expect(groups).toHaveLength(1)
    expect(groups[0].channelId).toBe(FIP_CHANNEL_ID)
  })

  it('renders multiple groups sorted by displayOrder', () => {
    const groups = buildGroups({
      liveChannels: [fipLive, ppLive], // intentionally out of order
      broadcasters: [movistar, redBull],
      todayCircuits: new Set(['PP', 'FIP']),
      country: 'es',
    })
    expect(groups.map(g => g.abbreviation)).toEqual(['PP', 'FIP']) // PP=10, FIP=20
    expect(groups[0].broadcasters).toHaveLength(2) // PP gets the broadcasters
    expect(groups[1].broadcasters).toHaveLength(0) // FIP has none
  })

  it('skips broadcasters with NULL channel_id', () => {
    const orphan: BroadcasterRow = { ...movistar, id: 'b3', channel_id: null }
    const groups = buildGroups({
      liveChannels: [ppLive],
      broadcasters: [orphan],
      todayCircuits: new Set(['PP']),
      country: 'es',
    })
    expect(groups[0].broadcasters).toHaveLength(0)
  })

  it('returns empty when country is null and no live channels', () => {
    const groups = buildGroups({
      liveChannels: [],
      broadcasters: [movistar],
      todayCircuits: new Set(['PP']),
      country: null,
    })
    // No country → no broadcaster section (the broadcaster row is filtered out by country mismatch upstream too, but defensive)
    expect(groups).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/group-builder.test.ts`
Expected: FAIL with "Cannot find module" or similar (the source file doesn't exist yet).

- [ ] **Step 3: Implement `group-builder.ts`**

```typescript
// src/lib/where-to-watch/group-builder.ts
//
// Pure data shape: given the inputs the Where-to-Watch popup has at hand,
// return the channel groups it should render, in display order. Empty
// groups are filtered out so the caller can render the result blindly.

export interface LiveChannel {
  videoId: string
  title: string
  channel: {
    id: string
    name: string
    abbreviation: string
    colorHex: string
    displayOrder: number
  }
}

export interface BroadcasterRow {
  id: string
  name: string
  url: string
  logo_url: string | null
  is_free: boolean
  display_order: number
  country_iso2: string
  channel_id: string | null
}

export interface ChannelGroup {
  channelId: string
  channelName: string
  abbreviation: string
  colorHex: string
  displayOrder: number
  hasLive: boolean
  liveStreams: Array<{ videoId: string; title: string }>
  broadcasters: Array<{
    id: string
    name: string
    logoUrl: string | null
    url: string
    isFree: boolean
  }>
}

export interface BuildGroupsInput {
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  todayCircuits: Set<string>  // set of channel abbreviations
  country: string | null
}

export function buildGroups(input: BuildGroupsInput): ChannelGroup[] {
  const { liveChannels, broadcasters, todayCircuits, country } = input

  // Index 1: channel metadata, keyed by channel id. Sourced from live
  // channels first (their `channel` payload is the authoritative meta).
  const channelMetaById = new Map<string, ChannelGroup>()
  for (const lc of liveChannels) {
    if (!channelMetaById.has(lc.channel.id)) {
      channelMetaById.set(lc.channel.id, {
        channelId: lc.channel.id,
        channelName: lc.channel.name,
        abbreviation: lc.channel.abbreviation,
        colorHex: lc.channel.colorHex,
        displayOrder: lc.channel.displayOrder,
        hasLive: false,
        liveStreams: [],
        broadcasters: [],
      })
    }
  }

  // Index 2: attach live streams
  for (const lc of liveChannels) {
    const g = channelMetaById.get(lc.channel.id)!
    g.hasLive = true
    g.liveStreams.push({ videoId: lc.videoId, title: lc.title })
  }

  // Index 3: attach broadcasters. Filter rules:
  //   - country must match (caller usually pre-filters, but defensive)
  //   - channel_id must be set (NULL = unclassified, do not render)
  //   - country must be non-null
  if (country) {
    for (const b of broadcasters) {
      if (!b.channel_id) continue
      if (b.country_iso2 !== country) continue
      const g = channelMetaById.get(b.channel_id)
      if (!g) continue  // broadcaster references a channel we don't have metadata for
      g.broadcasters.push({
        id: b.id,
        name: b.name,
        logoUrl: b.logo_url,
        url: b.url,
        isFree: b.is_free,
      })
    }
  }

  // Promote channels that have broadcasters but no metadata yet (no live)
  // ONLY when their circuit has matches today. Use the channel_id from
  // the broadcaster row — but we still need the channel's metadata
  // (name/abbreviation/color/displayOrder). The caller hasn't passed
  // dormant channel rows in, so we can only render groups whose channel
  // meta we have via liveChannels. This is a design constraint: if PP
  // is not currently live, we won't have PP metadata to render a
  // broadcaster-only group.
  //
  // The caller MUST also pass dormant channels via `liveChannels` (as
  // empty entries) when their circuit has matches today and the user has
  // broadcasters. See WhereToWatchPill server-side fetch for this.
  // (This is handled at the call site to avoid a second channels query
  // inside this pure function.)

  // Sort broadcasters within each group: free first, then display_order
  for (const g of channelMetaById.values()) {
    g.broadcasters.sort((a, b) => {
      if (a.isFree !== b.isFree) return a.isFree ? -1 : 1
      return 0  // input is already pre-sorted by display_order
    })
  }

  // Drop empty groups: no live AND no broadcasters AND circuit not in today
  // (we can't render a group with no content)
  const result: ChannelGroup[] = []
  for (const g of channelMetaById.values()) {
    const hasContent = g.hasLive || g.broadcasters.length > 0
    if (!hasContent) continue
    // If a group has ONLY broadcasters (no live), require its circuit
    // to be in today's set — otherwise the user is seeing "watch X on
    // Movistar" with no relevant match.
    if (!g.hasLive && !todayCircuits.has(g.abbreviation)) continue
    result.push(g)
  }

  // Final sort: by displayOrder ascending
  result.sort((a, b) => a.displayOrder - b.displayOrder)
  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/group-builder.test.ts`
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/where-to-watch/group-builder.ts src/lib/__tests__/group-builder.test.ts
git commit -m "feat(where-to-watch): pure buildGroups function with unit tests"
```

---

## Task 6: Add i18n strings (5 locales)

**Files:**
- Modify: `src/messages/en.json`
- Modify: `src/messages/es.json`
- Modify: `src/messages/pt.json`
- Modify: `src/messages/it.json`
- Modify: `src/messages/fr.json`

- [ ] **Step 1: Add the `whereToWatch` namespace to `en.json`**

Locate the top-level object in `src/messages/en.json` and add (alphabetical placement is fine):

```json
"whereToWatch": {
  "pillAriaLabel": "Where to watch — {count, plural, =0 {no streams live} one {# stream live} other {# streams live}}",
  "eyebrow": "Where to Watch",
  "channelLive": "LIVE",
  "alsoIn": "Also in {region}",
  "noFreeStream": "No free YouTube broadcast right now. {channel} is also on:",
  "freeBadge": "FREE",
  "watchCta": "WATCH",
  "openCta": "OPEN",
  "regionShowing": "Showing broadcasters in {region}.",
  "notYourRegion": "Not your region?",
  "pickRegionTitle": "Choose your region",
  "pickRegionBack": "Back",
  "closeAriaLabel": "Close"
}
```

- [ ] **Step 2: Add Spanish translations to `es.json`**

```json
"whereToWatch": {
  "pillAriaLabel": "Dónde verlo — {count, plural, =0 {ningún canal en vivo} one {# canal en vivo} other {# canales en vivo}}",
  "eyebrow": "Dónde ver",
  "channelLive": "EN VIVO",
  "alsoIn": "También en {region}",
  "noFreeStream": "Sin transmisión gratis ahora mismo. {channel} también está en:",
  "freeBadge": "GRATIS",
  "watchCta": "VER",
  "openCta": "ABRIR",
  "regionShowing": "Mostrando opciones en {region}.",
  "notYourRegion": "¿No es tu región?",
  "pickRegionTitle": "Elige tu región",
  "pickRegionBack": "Volver",
  "closeAriaLabel": "Cerrar"
}
```

- [ ] **Step 3: Repeat for `pt.json`, `it.json`, `fr.json`**

```json
// pt.json
"whereToWatch": {
  "pillAriaLabel": "Onde assistir — {count, plural, =0 {nenhum canal ao vivo} one {# canal ao vivo} other {# canais ao vivo}}",
  "eyebrow": "Onde Assistir",
  "channelLive": "AO VIVO",
  "alsoIn": "Também em {region}",
  "noFreeStream": "Sem transmissão gratuita agora. {channel} também está em:",
  "freeBadge": "GRÁTIS",
  "watchCta": "ASSISTIR",
  "openCta": "ABRIR",
  "regionShowing": "Mostrando opções em {region}.",
  "notYourRegion": "Não é sua região?",
  "pickRegionTitle": "Escolha sua região",
  "pickRegionBack": "Voltar",
  "closeAriaLabel": "Fechar"
}
```

```json
// it.json
"whereToWatch": {
  "pillAriaLabel": "Dove guardare — {count, plural, =0 {nessun canale live} one {# canale live} other {# canali live}}",
  "eyebrow": "Dove Guardare",
  "channelLive": "LIVE",
  "alsoIn": "Anche in {region}",
  "noFreeStream": "Nessuna trasmissione gratuita ora. {channel} è anche su:",
  "freeBadge": "GRATIS",
  "watchCta": "GUARDA",
  "openCta": "APRI",
  "regionShowing": "Mostro le opzioni in {region}.",
  "notYourRegion": "Non è la tua regione?",
  "pickRegionTitle": "Scegli la tua regione",
  "pickRegionBack": "Indietro",
  "closeAriaLabel": "Chiudi"
}
```

```json
// fr.json
"whereToWatch": {
  "pillAriaLabel": "Où regarder — {count, plural, =0 {aucune chaîne en direct} one {# chaîne en direct} other {# chaînes en direct}}",
  "eyebrow": "Où Regarder",
  "channelLive": "EN DIRECT",
  "alsoIn": "Aussi en {region}",
  "noFreeStream": "Pas de diffusion gratuite pour l'instant. {channel} est aussi sur :",
  "freeBadge": "GRATUIT",
  "watchCta": "REGARDER",
  "openCta": "OUVRIR",
  "regionShowing": "Diffuseurs en {region}.",
  "notYourRegion": "Pas votre région ?",
  "pickRegionTitle": "Choisir votre région",
  "pickRegionBack": "Retour",
  "closeAriaLabel": "Fermer"
}
```

- [ ] **Step 4: Verify each JSON file still parses**

Run:
```bash
for f in src/messages/{en,es,pt,it,fr}.json; do node -e "require('./$f')" && echo "$f OK"; done
```
Expected: each line ends with "OK".

- [ ] **Step 5: Commit**

```bash
git add src/messages/
git commit -m "i18n(where-to-watch): add whereToWatch namespace in 5 locales"
```

---

## Task 7: Build `BroadcasterRow` + shared keyframes module

**Files:**
- Create: `src/components/where-to-watch/keyframes.ts`
- Create: `src/components/where-to-watch/BroadcasterRow.tsx`

- [ ] **Step 1: Extract animation keyframes into a shared module**

```typescript
// src/components/where-to-watch/keyframes.ts
//
// Shared CSS keyframes for the Where-to-Watch popup. Imported by the
// popup component and rendered once inside <style> on open.
//
// Names prefixed `wtw-` to avoid colliding with any other animations.
// Reduced-motion gate at the bottom disables all animations on a single
// `[data-wtw-anim]` selector.

export const WTW_KEYFRAMES = `
@keyframes wtw-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes wtw-pop-in {
  0%   { opacity: 0; transform: scale(0.7); }
  55%  { opacity: 1; transform: scale(1.05); }
  78%  { transform: scale(0.98); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes wtw-eyebrow-in {
  from { opacity: 0; transform: translateY(-6px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes wtw-row-pop {
  0%   { opacity: 0; transform: translateY(18px) scale(0.94); }
  60%  { opacity: 1; transform: translateY(-2px) scale(1.01); }
  100% { opacity: 1; transform: translateY(0) scale(1); }
}
@keyframes wtw-stream-in {
  from { opacity: 0; transform: translateX(-10px); }
  to   { opacity: 1; transform: translateX(0); }
}
@media (prefers-reduced-motion: reduce) {
  [data-wtw-anim] {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
  }
}
.wtw-close-btn {
  position: absolute;
  top: 0;
  right: 0;
  width: 56px;
  height: 56px;
  background: transparent;
  border: 0;
  cursor: pointer;
  padding: 0;
  color: #fff;
  font-family: inherit;
  font-size: 22px;
  font-weight: 800;
  line-height: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.wtw-close-btn::before {
  content: '';
  position: absolute;
  width: 32px;
  height: 32px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.06);
  clip-path: polygon(1% 4%, 99% 0%, 100% 96%, 0% 100%);
  pointer-events: none;
}
.wtw-close-btn > span {
  position: relative;
  pointer-events: none;
}
`
```

- [ ] **Step 2: Implement `BroadcasterRow`**

```typescript
// src/components/where-to-watch/BroadcasterRow.tsx
'use client'

import { useTranslations } from 'next-intl'

const BG_ROW = '#0F0F0F'
const MUTED = '#6B7280'
const GREEN = '#7ED321'
const CLIP_ROW = 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)'
const CLIP_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export interface BroadcasterRowProps {
  name: string
  logoUrl: string | null
  url: string
  isFree: boolean
  onNavigate?: () => void  // called when user clicks (used to close the popup)
}

export function BroadcasterRow({ name, logoUrl, url, isFree, onNavigate }: BroadcasterRowProps) {
  const t = useTranslations('whereToWatch')
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onNavigate}
      style={{
        display: 'flex', alignItems: 'center', gap: 9,
        padding: '6px 9px',
        background: BG_ROW,
        clipPath: CLIP_ROW,
        textDecoration: 'none', color: 'inherit',
      }}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          style={{ width: 28, height: 18, objectFit: 'contain', flexShrink: 0 }}
        />
      ) : (
        <div style={{ width: 28, height: 18, background: 'rgba(255,255,255,0.04)', flexShrink: 0 }} />
      )}
      <div style={{ flex: 1, fontSize: 11, fontWeight: 600, color: '#fff', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {name}
      </div>
      {isFree && (
        <span style={{
          fontSize: 8, fontWeight: 800, color: GREEN,
          background: 'rgba(126,211,33,0.12)',
          padding: '1px 5px', clipPath: CLIP_BADGE,
          letterSpacing: 0.3,
        }}>
          {t('freeBadge')}
        </span>
      )}
      <span style={{ fontSize: 12, color: MUTED, marginLeft: 2 }}>→</span>
    </a>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/where-to-watch/
git commit -m "feat(where-to-watch): BroadcasterRow + shared keyframes module"
```

---

## Task 8: Build `ChannelGroup`

**Files:**
- Create: `src/components/where-to-watch/ChannelGroup.tsx`

- [ ] **Step 1: Implement the channel group block**

```typescript
// src/components/where-to-watch/ChannelGroup.tsx
'use client'

import { useTranslations } from 'next-intl'
import type { ChannelGroup as ChannelGroupData } from '@/lib/where-to-watch/group-builder'
import { BroadcasterRow } from './BroadcasterRow'

const YT_RED = '#FF0000'
const RED = '#FF4655'
const RED_SOFT = 'rgba(255,70,85,0.16)'
const MUTED = '#9CA3AF'
const CLIP_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

// ISO2 → display name map. Lives here (mirrored from WhereToWatch.tsx)
// because both this file and RegionPicker need it; keeping it inline
// avoids a third file for ~36 entries.
const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`
}

export interface ChannelGroupProps {
  group: ChannelGroupData
  groupIndex: number
  country: string | null
  onCloseRequested?: () => void  // close popup after CTA click
}

export function ChannelGroup({ group, groupIndex, country, onCloseRequested }: ChannelGroupProps) {
  const t = useTranslations('whereToWatch')
  const regionName = country ? (ISO2_TO_NAME[country.toLowerCase()] ?? country.toUpperCase()) : null

  return (
    <div
      data-wtw-anim
      style={{
        paddingTop: groupIndex === 0 ? 0 : 14,
        marginTop: groupIndex === 0 ? 0 : 14,
        borderTop: groupIndex === 0 ? 'none' : `1px solid rgba(255,255,255,0.06)`,
        animation: `wtw-row-pop 420ms cubic-bezier(0.4, 0, 0.2, 1) ${180 + groupIndex * 100}ms both`,
      }}
    >
      {/* Channel header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: group.colorHex,
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0, color: '#fff',
          fontSize: 11, fontWeight: 800, letterSpacing: 0.3,
        }}>
          {group.abbreviation}
        </div>
        <div style={{
          fontSize: 12, fontWeight: 800, letterSpacing: 0.3,
          color: '#fff', lineHeight: 1.2, textTransform: 'uppercase',
          display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0,
        }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {group.channelName}
          </span>
          {group.hasLive && (
            <span style={{
              fontSize: 8, fontWeight: 800, letterSpacing: 0.5,
              color: RED, background: RED_SOFT,
              padding: '1px 5px', clipPath: CLIP_BADGE,
              lineHeight: 1.4, flexShrink: 0,
            }}>
              {t('channelLive')}
            </span>
          )}
        </div>
      </div>

      {/* Live YT streams (when present) */}
      {group.hasLive && (
        <div style={{ marginLeft: 40, display: 'flex', flexDirection: 'column' }}>
          {group.liveStreams.map((stream, si) => (
            <div
              key={stream.videoId}
              data-wtw-anim
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 0',
                animation: `wtw-stream-in 280ms cubic-bezier(0.4, 0, 0.2, 1) ${280 + groupIndex * 100 + si * 50}ms both`,
              }}
            >
              <div style={{
                flex: 1, minWidth: 0,
                fontSize: 11, color: '#D8D8DD', lineHeight: 1.35,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
              }}>{stream.title}</div>
              <a
                href={youtubeWatchUrl(stream.videoId)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onCloseRequested}
                style={{
                  flexShrink: 0,
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
                  textTransform: 'uppercase',
                  color: '#fff', background: YT_RED,
                  padding: '5px 10px',
                  clipPath: CLIP_BADGE,
                  textDecoration: 'none',
                }}
              >
                <svg viewBox="0 0 24 24" width="10" height="10" fill="#fff" aria-hidden="true">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                {t('watchCta')}
              </a>
            </div>
          ))}
        </div>
      )}

      {/* "No free YT, also on:" helper line (only when there are broadcasters AND no live YT) */}
      {!group.hasLive && group.broadcasters.length > 0 && (
        <div style={{
          marginLeft: 40, marginBottom: 8,
          fontSize: 10, color: MUTED, lineHeight: 1.4,
        }}>
          {t('noFreeStream', { channel: group.channelName })}
        </div>
      )}

      {/* Nested regional broadcaster section */}
      {group.broadcasters.length > 0 && (
        <>
          {group.hasLive && regionName && (
            <div style={{
              margin: '8px 0 4px 40px',
              fontSize: 8.5, color: MUTED, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: 0.8,
            }}>
              {t('alsoIn', { region: regionName })}
            </div>
          )}
          <div style={{ marginLeft: 40, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {group.broadcasters.map(b => (
              <BroadcasterRow
                key={b.id}
                name={b.name}
                logoUrl={b.logoUrl}
                url={b.url}
                isFree={b.isFree}
                onNavigate={onCloseRequested}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/where-to-watch/ChannelGroup.tsx
git commit -m "feat(where-to-watch): ChannelGroup component with live + broadcaster states"
```

---

## Task 9: Build `RegionPicker`

**Files:**
- Create: `src/components/where-to-watch/RegionPicker.tsx`

- [ ] **Step 1: Implement the inline picker**

```typescript
// src/components/where-to-watch/RegionPicker.tsx
'use client'

import { useTranslations } from 'next-intl'

// Same map as in ChannelGroup.tsx. The 36-entry list is small enough
// to keep duplicated rather than build a shared module yet; if this
// grows, extract to src/lib/where-to-watch/iso2-names.ts.
const COUNTRIES: Array<{ iso2: string; name: string }> = [
  { iso2: 'es', name: 'Spain' },        { iso2: 'it', name: 'Italy' },
  { iso2: 'fr', name: 'France' },       { iso2: 'de', name: 'Germany' },
  { iso2: 'gb', name: 'United Kingdom' }, { iso2: 'us', name: 'United States' },
  { iso2: 'ar', name: 'Argentina' },    { iso2: 'mx', name: 'Mexico' },
  { iso2: 'br', name: 'Brazil' },       { iso2: 'pt', name: 'Portugal' },
  { iso2: 'nl', name: 'Netherlands' },  { iso2: 'be', name: 'Belgium' },
  { iso2: 'se', name: 'Sweden' },       { iso2: 'no', name: 'Norway' },
  { iso2: 'dk', name: 'Denmark' },      { iso2: 'fi', name: 'Finland' },
  { iso2: 'pl', name: 'Poland' },       { iso2: 'ch', name: 'Switzerland' },
  { iso2: 'at', name: 'Austria' },      { iso2: 'ie', name: 'Ireland' },
  { iso2: 'gr', name: 'Greece' },       { iso2: 'tr', name: 'Turkey' },
  { iso2: 'il', name: 'Israel' },       { iso2: 'sa', name: 'Saudi Arabia' },
  { iso2: 'ae', name: 'UAE' },          { iso2: 'qa', name: 'Qatar' },
  { iso2: 'eg', name: 'Egypt' },        { iso2: 'ma', name: 'Morocco' },
  { iso2: 'za', name: 'South Africa' }, { iso2: 'jp', name: 'Japan' },
  { iso2: 'kr', name: 'South Korea' },  { iso2: 'cn', name: 'China' },
  { iso2: 'in', name: 'India' },        { iso2: 'au', name: 'Australia' },
]

export interface RegionPickerProps {
  currentCountry: string | null
  onPick: (iso2: string) => void
  onBack: () => void
}

export function RegionPicker({ currentCountry, onPick, onBack }: RegionPickerProps) {
  const t = useTranslations('whereToWatch')
  return (
    <div data-wtw-anim style={{ animation: 'wtw-fade-in 220ms ease-out both' }}>
      {/* Header with back arrow */}
      <button
        type="button"
        onClick={onBack}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
          color: '#F5A623', textTransform: 'uppercase',
          background: 'transparent', border: 0, padding: 0, marginBottom: 14,
          cursor: 'pointer',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
        </svg>
        {t('pickRegionBack')}
      </button>

      <div style={{
        fontSize: 13, fontWeight: 800, color: '#fff',
        marginBottom: 12, lineHeight: 1.2,
      }}>
        {t('pickRegionTitle')}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {COUNTRIES.map(c => {
          const selected = currentCountry === c.iso2
          return (
            <button
              key={c.iso2}
              type="button"
              onClick={() => onPick(c.iso2)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 12px',
                background: selected ? 'rgba(245,166,35,0.10)' : '#0F0F0F',
                border: 0, cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: 12, fontWeight: 600,
                color: selected ? '#F5A623' : '#fff',
                clipPath: 'polygon(0% 4%, 99% 0%, 100% 96%, 1% 100%)',
                textAlign: 'left',
              }}
            >
              <span>{c.name}</span>
              {selected && <span style={{ fontSize: 14 }}>✓</span>}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/where-to-watch/RegionPicker.tsx
git commit -m "feat(where-to-watch): RegionPicker inline country list"
```

---

## Task 10: Build `WhereToWatchPopup`

**Files:**
- Create: `src/components/where-to-watch/WhereToWatchPopup.tsx`

- [ ] **Step 1: Implement the modal frame + group orchestration**

```typescript
// src/components/where-to-watch/WhereToWatchPopup.tsx
'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslations } from 'next-intl'
import type { ChannelGroup as ChannelGroupData } from '@/lib/where-to-watch/group-builder'
import { ChannelGroup } from './ChannelGroup'
import { RegionPicker } from './RegionPicker'
import { WTW_KEYFRAMES } from './keyframes'

const ORANGE = '#F5A623'
const MUTED = '#9CA3AF'
const BG_ELEV = '#1e1e1e'
const BORDER = 'rgba(255,255,255,0.06)'
const CLIP_FRAME = 'polygon(0% 1%, 99.5% 0%, 100% 99%, 0.5% 100%)'

// Same iso2 → name map used in ChannelGroup; duplicated here for footer text.
const ISO2_TO_NAME: Record<string, string> = {
  es: 'Spain', it: 'Italy', fr: 'France', de: 'Germany', gb: 'United Kingdom',
  us: 'United States', ar: 'Argentina', mx: 'Mexico', br: 'Brazil',
  pt: 'Portugal', nl: 'Netherlands', be: 'Belgium', se: 'Sweden', no: 'Norway',
  dk: 'Denmark', fi: 'Finland', pl: 'Poland', ch: 'Switzerland', at: 'Austria',
  ie: 'Ireland', gr: 'Greece', tr: 'Turkey', il: 'Israel', sa: 'Saudi Arabia',
  ae: 'UAE', qa: 'Qatar', eg: 'Egypt', ma: 'Morocco', za: 'South Africa',
  jp: 'Japan', kr: 'South Korea', cn: 'China', in: 'India', au: 'Australia',
}

export interface WhereToWatchPopupProps {
  open: boolean
  onClose: () => void
  groups: ChannelGroupData[]
  country: string | null
  onCountryChange: (iso2: string) => void
}

export function WhereToWatchPopup({
  open, onClose, groups, country, onCountryChange,
}: WhereToWatchPopupProps) {
  const t = useTranslations('whereToWatch')
  const [pickerOpen, setPickerOpen] = useState(false)

  // Reset picker state when popup closes
  useEffect(() => {
    if (!open) setPickerOpen(false)
  }, [open])

  // Escape closes the modal (or the picker, if open)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pickerOpen) {
          setPickerOpen(false)
        } else {
          onClose()
        }
        e.stopPropagation()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open, pickerOpen, onClose])

  if (!open || typeof document === 'undefined') return null

  const regionName = country ? (ISO2_TO_NAME[country.toLowerCase()] ?? country.toUpperCase()) : null

  return createPortal(
    <div
      onClick={onClose}
      data-wtw-anim
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center', justifyContent: 'center',
        padding: 16,
        animation: 'wtw-fade-in 180ms ease-out both',
      }}
    >
      <style>{WTW_KEYFRAMES}</style>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('eyebrow')}
        onClick={(e) => e.stopPropagation()}
        data-wtw-anim
        style={{
          position: 'relative',
          width: 'min(380px, 92vw)',
          maxHeight: '85vh',
          overflowY: 'auto',
          background: BG_ELEV,
          padding: '20px 20px 18px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04) inset',
          clipPath: CLIP_FRAME,
          animation: 'wtw-pop-in 380ms cubic-bezier(0.4, 0, 0.2, 1) both',
          transformOrigin: 'center center',
        }}
      >
        <button
          type="button"
          className="wtw-close-btn"
          aria-label={t('closeAriaLabel')}
          onClick={onClose}
        >
          <span aria-hidden="true">×</span>
        </button>

        {pickerOpen ? (
          <RegionPicker
            currentCountry={country}
            onPick={(iso2) => {
              onCountryChange(iso2)
              setPickerOpen(false)
            }}
            onBack={() => setPickerOpen(false)}
          />
        ) : (
          <>
            {/* Eyebrow */}
            <div
              data-wtw-anim
              style={{
                display: 'flex', alignItems: 'center', gap: 7,
                fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
                color: ORANGE, textTransform: 'uppercase',
                marginBottom: 14,
                animation: 'wtw-eyebrow-in 260ms cubic-bezier(0.4, 0, 0.2, 1) 80ms both',
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="7" width="20" height="13" rx="2" ry="2"/>
                <polyline points="17 2 12 7 7 2"/>
              </svg>
              {t('eyebrow')}
            </div>

            {/* Groups */}
            {groups.map((g, gi) => (
              <ChannelGroup
                key={g.channelId}
                group={g}
                groupIndex={gi}
                country={country}
                onCloseRequested={onClose}
              />
            ))}

            {/* Region footer */}
            {regionName && (
              <div
                style={{
                  marginTop: 14, paddingTop: 12,
                  borderTop: `1px solid ${BORDER}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: 6, fontSize: 10, color: MUTED, lineHeight: 1.4,
                  flexWrap: 'wrap',
                }}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.7 }}>
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                </svg>
                <span>{t('regionShowing', { region: regionName })}</span>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  style={{
                    background: 'transparent', border: 0, padding: 0,
                    color: ORANGE, fontWeight: 700, cursor: 'pointer',
                    fontFamily: 'inherit', fontSize: 'inherit',
                    borderBottom: '1px dashed rgba(245,166,35,0.4)',
                  }}
                >
                  {t('notYourRegion')}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/where-to-watch/WhereToWatchPopup.tsx
git commit -m "feat(where-to-watch): WhereToWatchPopup modal + region picker toggle"
```

---

## Task 11: Build `WhereToWatchPill`

**Files:**
- Create: `src/components/where-to-watch/WhereToWatchPill.tsx`

- [ ] **Step 1: Implement the trigger**

```typescript
// src/components/where-to-watch/WhereToWatchPill.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useTranslations } from 'next-intl'
import { buildGroups, type LiveChannel, type BroadcasterRow } from '@/lib/where-to-watch/group-builder'
import { WhereToWatchPopup } from './WhereToWatchPopup'

const CLIP_BADGE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'
const LOCALSTORAGE_KEY = 'preferred-country'

export interface WhereToWatchPillProps {
  liveChannels: LiveChannel[]
  broadcasters: BroadcasterRow[]
  todayCircuits: string[]   // serialized Set — array for SSR-safety
  geoCountry: string | null  // server-detected (cookie)
}

export function WhereToWatchPill({
  liveChannels, broadcasters, todayCircuits, geoCountry,
}: WhereToWatchPillProps) {
  const t = useTranslations('whereToWatch')
  const [open, setOpen] = useState(false)

  // Hydrate region from localStorage preference (overrides geo)
  const [preferredCountry, setPreferredCountry] = useState<string | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(LOCALSTORAGE_KEY)
      if (stored) setPreferredCountry(stored.toLowerCase())
    } catch {
      // localStorage disabled — fall back to geo
    }
  }, [])

  const effectiveCountry = preferredCountry ?? geoCountry

  // Build groups
  const groups = useMemo(
    () => buildGroups({
      liveChannels,
      broadcasters,
      todayCircuits: new Set(todayCircuits),
      country: effectiveCountry,
    }),
    [liveChannels, broadcasters, todayCircuits, effectiveCountry],
  )

  // Hide entirely when nothing to show
  if (groups.length === 0) return null

  const liveStreamCount = groups.reduce((sum, g) => sum + g.liveStreams.length, 0)
  const hasLive = liveStreamCount > 0

  const handleCountryChange = (iso2: string) => {
    setPreferredCountry(iso2.toLowerCase())
    try {
      window.localStorage.setItem(LOCALSTORAGE_KEY, iso2.toLowerCase())
    } catch {
      // ignore
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={t('pillAriaLabel', { count: liveStreamCount })}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
          textTransform: 'uppercase',
          cursor: 'pointer',
          padding: '6px 10px',
          background: open ? 'rgba(245,166,35,0.16)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${open ? 'rgba(245,166,35,0.5)' : 'rgba(255,255,255,0.10)'}`,
          color: '#fff',
          clipPath: CLIP_BADGE,
          fontFamily: 'inherit',
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="2" y="7" width="20" height="13" rx="2" ry="2"/>
          <polyline points="17 2 12 7 7 2"/>
        </svg>
        {hasLive && (
          <span style={{
            color: '#0A0A0A', background: '#fff',
            fontFamily: 'monospace', fontSize: 9, fontWeight: 800,
            padding: '1px 5px', borderRadius: 8, lineHeight: 1.2,
          }}>
            {liveStreamCount}
          </span>
        )}
      </button>

      <WhereToWatchPopup
        open={open}
        onClose={() => setOpen(false)}
        groups={groups}
        country={effectiveCountry}
        onCountryChange={handleCountryChange}
      />
    </>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/where-to-watch/WhereToWatchPill.tsx
git commit -m "feat(where-to-watch): WhereToWatchPill trigger + localStorage preference"
```

---

## Task 12: Add `fetch-broadcasters.ts` server helper

**Files:**
- Create: `src/lib/where-to-watch/fetch-broadcasters.ts`

- [ ] **Step 1: Write the helper**

```typescript
// src/lib/where-to-watch/fetch-broadcasters.ts
//
// Server-side query for broadcasters rows the popup will display.
// Filtered server-side by country to keep the payload tiny.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { BroadcasterRow } from './group-builder'

export async function fetchBroadcastersForCountry(
  supabase: SupabaseClient,
  country: string | null,
): Promise<BroadcasterRow[]> {
  if (!country) return []
  const { data, error } = await supabase
    .from('broadcasters')
    .select('id, name, url, logo_url, is_free, display_order, country_iso2, channel_id')
    .eq('country_iso2', country)
    .eq('active', true)
    .not('channel_id', 'is', null)
    .order('display_order', { ascending: true })
    .order('is_free', { ascending: false })
  if (error) {
    console.error('[fetchBroadcastersForCountry] query failed:', error.message)
    return []
  }
  return (data ?? []) as BroadcasterRow[]
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/where-to-watch/fetch-broadcasters.ts
git commit -m "feat(where-to-watch): server-side broadcaster fetch helper"
```

---

## Task 13: Wire pill into matches page

**Files:**
- Modify: `src/app/[locale]/(app)/matches/[date]/page.tsx`
- Modify: `src/components/MatchesDayShell.tsx`
- Modify: `src/components/MatchesFilterBar.tsx`

- [ ] **Step 1: Fetch broadcasters + compute todayCircuits in the page Server Component**

In `src/app/[locale]/(app)/matches/[date]/page.tsx`, near the existing `liveChannelsRes` fetch (around line 102), add:

```typescript
import { fetchBroadcastersForCountry } from '@/lib/where-to-watch/fetch-broadcasters'
import { circuitsForToday } from '@/lib/where-to-watch/circuit-map'
```

After computing `liveChannels`, also compute:

```typescript
// Broadcasters for the user's geo-detected country (will be overridden
// client-side by localStorage preference if set).
const geoCountry = (cookieStore.get('geo-country')?.value || '').toLowerCase() || null
const broadcasters = await fetchBroadcastersForCountry(supabase, geoCountry)

// Circuits with at least one match on this page today (drives whether
// to surface broadcaster-only groups for circuits not currently live).
const todayCircuits = Array.from(circuitsForToday(dayMatches))
```

Pass to `MatchesDayShell` alongside the existing `liveChannels` prop:

```tsx
<MatchesDayShell
  initialIso={iso}
  initialGroups={groups}
  locale={locale}
  userTz={userTz}
  liveChannels={liveChannels}
  broadcasters={broadcasters}
  todayCircuits={todayCircuits}
  geoCountry={geoCountry}
  emptyStateTitle={tDaily('noMatchesTitle')}
  emptyStateSubtitle={tDaily('noMatchesSub')}
/>
```

- [ ] **Step 2: Thread props through MatchesDayShell → MatchesFilterBar**

In `src/components/MatchesDayShell.tsx`, add to the props type:

```typescript
broadcasters?: BroadcasterRow[]
todayCircuits?: string[]
geoCountry?: string | null
```

Default in the destructure: `broadcasters = [], todayCircuits = [], geoCountry = null`.

Forward to `<MatchesFilterBar>`:

```tsx
<MatchesFilterBar
  // ...existing props
  liveChannels={liveChannels}
  broadcasters={broadcasters}
  todayCircuits={todayCircuits}
  geoCountry={geoCountry}
/>
```

In `src/components/MatchesFilterBar.tsx`:

1. Remove `import YoutubeLiveIndicator, { type LiveChannel } from './YoutubeLiveIndicator'`
2. Add `import { WhereToWatchPill } from './where-to-watch/WhereToWatchPill'`
3. Add `import type { LiveChannel, BroadcasterRow } from '@/lib/where-to-watch/group-builder'`
4. Add `broadcasters: BroadcasterRow[]`, `todayCircuits: string[]`, `geoCountry: string | null` to props
5. Replace the `<YoutubeLiveIndicator liveChannels={liveChannels} />` JSX with:

```tsx
<WhereToWatchPill
  liveChannels={liveChannels}
  broadcasters={broadcasters}
  todayCircuits={todayCircuits}
  geoCountry={geoCountry}
/>
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit 2>&1 | grep -E "matches/\[date\]/page|MatchesDayShell|MatchesFilterBar|WhereToWatch"`
Expected: no errors in these files. (Other unrelated `scripts/*.ts` errors are OK and pre-existing.)

- [ ] **Step 4: Manual smoke test (preview server)**

Start dev server (`preview_start` with "Next.js (frontend)"), navigate to `/matches/today`. Verify:
- Pill shows in filter bar with TV icon
- Click → popup opens with channel groups
- Click "Not your region?" → picker appears
- Pick another country → popup re-renders with new broadcasters
- Reload page → preferred country persists

- [ ] **Step 5: Commit**

```bash
git add src/app/[locale]/\(app\)/matches/[date]/page.tsx \
        src/components/MatchesDayShell.tsx \
        src/components/MatchesFilterBar.tsx
git commit -m "feat(matches): swap YoutubeLiveIndicator for unified WhereToWatchPill"
```

---

## Task 14: Wire pill into tournament Overview tab

**Files:**
- Modify: `src/app/[locale]/(app)/tournaments/[id]/page.tsx`

- [ ] **Step 1: Find the existing `<WhereToWatch />` mount**

Run: `grep -n "WhereToWatch" src/app/\[locale\]/\(app\)/tournaments/\[id\]/page.tsx`
Expected: import on line ~20, JSX usage around line ~1560.

- [ ] **Step 2: Replace with the new pill**

Remove the old import. Add:

```typescript
import { WhereToWatchPill } from '@/components/where-to-watch/WhereToWatchPill'
import { fetchBroadcastersForCountry } from '@/lib/where-to-watch/fetch-broadcasters'
import { levelToChannelAbbr } from '@/lib/where-to-watch/circuit-map'
import type { LiveChannel } from '@/lib/where-to-watch/group-builder'
```

In the page Server Component body, near where `tournament` is loaded, fetch the supporting data:

```typescript
const { cookies } = await import('next/headers')
const cookieStore = await cookies()
const geoCountry = (cookieStore.get('geo-country')?.value || '').toLowerCase() || null

const broadcasters = await fetchBroadcastersForCountry(supabase, geoCountry)

// For the tournament page, "todayCircuits" is just this tournament's circuit
// (we surface its broadcasters even if no live YT). Live channels covering
// this circuit are filtered server-side from the global youtube_channel_live.
const tournamentAbbr = levelToChannelAbbr(tournament?.level)
const todayCircuits = tournamentAbbr ? [tournamentAbbr] : []

// Live channels: only those whose abbreviation matches this tournament's circuit
// (avoids showing FIP live streams on a Premier tournament page, and vice versa).
const STALE_MS = 30 * 60 * 1000
const { data: liveRaw } = tournamentAbbr ? await supabase
  .from('youtube_channel_live')
  .select(`
    video_id, title,
    channel:youtube_channels!inner(id, name, abbreviation, color_hex, display_order)
  `)
  .gt('last_seen_at', new Date(Date.now() - STALE_MS).toISOString())
  .eq('channel.is_active', true)
  .eq('channel.abbreviation', tournamentAbbr)
  : { data: [] }

const liveChannels: LiveChannel[] = (liveRaw ?? []).map((r: any) => {
  const ch = Array.isArray(r.channel) ? r.channel[0] : r.channel
  return ch ? {
    videoId: r.video_id, title: r.title,
    channel: {
      id: ch.id, name: ch.name, abbreviation: ch.abbreviation,
      colorHex: ch.color_hex, displayOrder: ch.display_order,
    },
  } : null
}).filter(Boolean) as LiveChannel[]
```

Replace the `<WhereToWatch />` JSX with:

```tsx
<WhereToWatchPill
  liveChannels={liveChannels}
  broadcasters={broadcasters}
  todayCircuits={todayCircuits}
  geoCountry={geoCountry}
/>
```

- [ ] **Step 3: Verify the layout**

Start dev server, navigate to a Premier tournament detail page (e.g. `/tournaments/buenos-aires-p1-2026`). Verify:
- The large "Where to Watch" card is gone
- A small pill sits in the same spot (or wherever the new placement makes sense — adjust the surrounding container if the old card had its own margin)
- Click → same popup as on matches page, scoped to this circuit

- [ ] **Step 4: Commit**

```bash
git add src/app/\[locale\]/\(app\)/tournaments/\[id\]/page.tsx
git commit -m "feat(tournaments): swap WhereToWatch card for compact WhereToWatchPill"
```

---

## Task 15: Remove dead code

**Files:**
- Delete: `src/components/YoutubeLiveIndicator.tsx`
- Delete: `src/components/WhereToWatch.tsx`
- Delete: `src/app/[locale]/(app)/matches/[date]/DailyWhereToWatch.tsx`
- Modify: `src/messages/{en,es,pt,it,fr}.json` (remove `daily.youtubeLive.*`)

- [ ] **Step 1: Confirm no other consumers**

Run:
```bash
grep -rn "YoutubeLiveIndicator\|DailyWhereToWatch" src/ --include="*.tsx" --include="*.ts"
grep -rn "from '@/components/WhereToWatch'" src/ --include="*.tsx" --include="*.ts"
```
Expected: only the files being deleted reference themselves; no external consumers.

- [ ] **Step 2: Delete the three files**

```bash
git rm src/components/YoutubeLiveIndicator.tsx
git rm src/components/WhereToWatch.tsx
git rm src/app/\[locale\]/\(app\)/matches/\[date\]/DailyWhereToWatch.tsx
```

- [ ] **Step 3: Remove obsolete i18n keys**

In all 5 message files, remove the `daily.youtubeLive` namespace (or whatever sub-keys the old `YoutubeLiveIndicator` used — verify with `grep -n youtubeLive src/messages/*.json`).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit 2>&1 | grep -E "(YoutubeLiveIndicator|WhereToWatch\.tsx|DailyWhereToWatch|youtubeLive)"`
Expected: no errors referencing the deleted files/keys.

- [ ] **Step 5: Commit**

```bash
git add src/messages/
git commit -m "chore(where-to-watch): remove superseded components and i18n keys"
```

---

## Task 16: Manual verification across states

This is a check, not a code task — no commits. Run the dev server and walk through each state to confirm the popup renders correctly.

- [ ] **State 1: Spanish user, Premier YT live**

Set `geo-country=es` cookie (DevTools), navigate to `/matches/today` when a Premier YT broadcast is live. Verify:
- Pill shows TV icon + count badge equal to number of live streams
- Popup: Premier Padel group with LIVE chip, YT streams listed, "Also in Spain" subsection with Movistar + Red Bull rows
- Footer reads "Showing broadcasters in Spain. Not your region?"

- [ ] **State 2: Spanish user, Premier matches today but no YT live**

Same cookie, navigate to a day with Premier matches scheduled but no live broadcast on PP channel. Verify:
- Pill shows TV icon only (no count badge)
- Popup: Premier Padel group with NO LIVE chip, helper line "No free YouTube broadcast right now. Premier Padel is also on:", then Movistar + Red Bull rows

- [ ] **State 3: US user (no broadcasters), Premier YT live**

Set `geo-country=us`. Verify:
- Pill shows with count
- Popup: Premier Padel group with YT streams only (no broadcaster section since US has no rows)
- Footer renders: "Showing broadcasters in United States. Not your region?" — even without rows, the affordance lets a traveler/VPN user switch to their actual region.

- [ ] **State 3b: No detected country (Googlebot / scrubbed IP)**

Delete the `geo-country` cookie, clear localStorage `preferred-country`, navigate. Verify the footer is **hidden** (no region name to display).

- [ ] **State 4: Region picker flow**

In any state, click "Not your region?" → list of countries appears with the current one highlighted. Pick "Italy". Popup re-renders with Italian broadcasters (Sky Sport IT, etc.). Footer text updates. Reload page → preference persists (Italy still selected).

- [ ] **State 5: FIP + Premier both live**

If a FIP Tour channel is also broadcasting, verify two channel groups stack (PP first by displayOrder, FIP below). FIP group has no nested broadcasters (no FIP broadcasters licensed yet).

- [ ] **State 6: Nothing applicable**

Day with no Premier matches AND no YT live → pill is hidden entirely.

- [ ] **State 7: Tournament page**

Navigate to a Premier tournament Overview tab. Verify:
- The big "Where to Watch" card is gone, ~280px reclaimed
- Pill present in roughly the same spot
- Tap → same popup, scoped to that tournament's circuit

- [ ] **State 8: Accessibility**

- Keyboard: Tab to pill, Enter opens popup. Tab cycles inside popup. Escape closes.
- Screen reader: pill announces with `pillAriaLabel`. Popup is `role="dialog" aria-modal="true"`.
- `prefers-reduced-motion: reduce`: confirm animations are disabled (DevTools rendering tab).

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task — schema (T1), backfill (T2-3), components (T7-11), pure data fn (T5), i18n (T6), wire-up (T13-14), cleanup (T15), verification (T16). The "global editorial cards deprecated" section is implicitly satisfied (no task reads `broadcast_info`).
- **Type consistency:** `BroadcasterRow` shape stays consistent from T5 (definition) through T12 (server fetch) and T11 (pill props). `ChannelGroup` from group-builder is consumed by ChannelGroup.tsx unchanged.
- **i18n plurals:** `pillAriaLabel` uses ICU plural with `=0 / one / other` — supported by next-intl ICU mode.
- **Caveats called out in code:** group-builder.ts has a comment block explaining that dormant channels must be passed in via `liveChannels` (currently not done — broadcaster-only groups need their channel metadata from somewhere). This is a known limitation: in v1 we only render broadcaster-only groups when their channel is also being polled (which it is for PP). Adding a separate "dormant channels" query is a follow-up.
