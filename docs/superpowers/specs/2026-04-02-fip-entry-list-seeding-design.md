# FIP Entry List Seeding Tool — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Location:** Ops Dashboard > Entry Lists tab

## Problem

FIP tournament matches often show players as "TBD" because the FIP scores cron scrapes player names from the matchscorer widget HTML, which uses inconsistent formatting. Entry list PDFs published by FIP before each tournament contain authoritative player data (full names, countries, rankings, points) that can pre-seed the `players` table so the scores cron resolves names correctly on first encounter.

## Solution

A new "Entry Lists" tab in the ops dashboard. Upload a FIP entry list PDF (or paste extracted text), preview parsed players with DB match suggestions, confirm to seed.

## User Flow

1. Open ops dashboard, click "Entry Lists" tab
2. Select a tournament from dropdown (sorted by urgency — nearest first)
3. Select category (men / women)
4. Upload PDF or paste text
5. System parses, shows preview table with DB match status per player
6. Review, fix any mismatches, click "Seed Players"
7. System upserts players, shows summary

## Architecture

### Input Modes

Two input modes, tabbed UI:

1. **PDF Upload** — file sent as `multipart/form-data` to API route, parsed server-side with `pdf-parse` v2, returns structured data
2. **Text Paste** — parsed client-side with same regex, no API call needed for parsing

Both produce identical output: `ParsedTeam[]`.

### Data Types

```typescript
interface ParsedTeam {
  position: number
  teamPoints: number
  player1: ParsedEntryPlayer
  player2: ParsedEntryPlayer
}

interface ParsedEntryPlayer {
  name: string           // "Jeronimo Gonzalez"
  country: string        // "ESP" (3-letter from PDF, converted to ISO2 for DB)
  ranking: number        // FIP ranking position
  points: number         // FIP ranking points
}

interface PDFMetadata {
  filename: string
  version: number | null     // Extracted from filename (e.g., "v7" → 7)
  lastModified: string | null // From PDF info.ModDate
  pageCount: number
  title: string | null       // From PDF info.Title
}

interface PlayerMatchResult {
  parsed: ParsedEntryPlayer
  matchType: 'exact' | 'fuzzy' | 'new'
  dbPlayer: { id: string; name: string; country: string } | null
  similarity: number | null  // For fuzzy matches (0-1)
}
```

### Tournament Selector

Dropdown showing FIP tournaments, grouped and sorted by urgency:

| Group | Criteria | Visual |
|-------|----------|--------|
| Starting soon | starts_at ≤ 3 days from now | Red dot, "starts in X days" |
| This week | starts_at 4–7 days away | Yellow dot |
| Upcoming | starts_at 8–30 days away | Green dot |
| In progress | starts_at ≤ today ≤ ends_at | Gray, "started X days ago" |

Each entry: `{name} · {country_flag} · starts {date} · {urgency label}`

Tournaments with existing seeded entry lists show a checkmark badge.

Source query: `tournaments` table, filtered by `source = 'fip'` and `starts_at` within next 30 days or currently in progress.

### PDF Metadata Extraction

After upload, display an info bar:

> Entry-list-Fip-Gold-Almaty-Men-v7.pdf · Version 7 · Modified: Apr 1, 2026 · 2 pages · 24 teams parsed

Extracted from:
- **Filename** — as-is from upload
- **Version** — regex `/v(\d+)/i` on filename
- **Last modified** — `pdf-parse` document info (`ModDate` or `CreationDate`)
- **Page count** — from `doc.doc.numPages`
- **Title** — from PDF metadata if present

Metadata is stored alongside the seed record for audit trail.

### Parsing Logic

Single shared function, works on plain text (from PDF extraction or paste):

```
Pattern per team (2 lines):
Line 1: {pos}\t{ranking1} {firstName1} {lastName1} {COUNTRY1}\n{points1} points
Line 2: {ranking2} {firstName2} {lastName2} {COUNTRY2}\n{points2} points {teamPoints}
```

Regex approach (validated against real data, 15/15 teams parsed correctly):

```typescript
function parseEntryListText(text: string): ParsedTeam[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const teams: ParsedTeam[] = []
  const playerRe = /(\d+)\s+(.+?)\s+([A-Z]{2,3})\s*$/
  const pointsRe = /(\d+)\s+points/

  // Parse pairs of player lines grouped by position
  // ... (implementation detail)

  return teams
}
```

Country codes: PDF uses 3-letter codes (ESP, ARG, PAR). Convert to ISO2 using the existing `toIso2()` from `fip-scraper.ts`.

### Player Matching

Uses existing `PlayerResolver` for DB lookups. For each parsed player:

1. **Exact match** — normalized name matches existing player in same category → link
2. **Fuzzy match** — token similarity > 0.85 → show suggestion with similarity score, user confirms
3. **No match** — will create new player record

Preview table columns:

| # | Parsed Name | Country | Ranking | Points | DB Match | Status |
|---|-------------|---------|---------|--------|----------|--------|
| 1 | Jeronimo Gonzalez | ESP | 15 | 4350 | Jeronimo Gonzalez (id: abc) | Exact |
| 2 | Martin Di Nenno | ARG | 12 | 5020 | M. Di Nenno (id: def) | Fuzzy 0.91 |
| 3 | Rasul Gojayev | KAZ | 2926 | 5 | — | New |

Fuzzy matches are editable — user can accept suggestion or type a correction.

### Seed Operation

On confirm, for each player:

1. If exact/fuzzy match accepted → update existing player's `country` if missing
2. If new → create player via `PlayerResolver.resolve()` with: `name`, `country` (ISO2), `category`

No ranking/points updates here — that's the rankings cron's job. The seeding tool's purpose is purely to ensure players **exist** in the DB with correct names so the scores cron can resolve them.

### Seed Audit Record

Store each seed operation for tracking:

```typescript
// New table: entry_list_seeds (or just use ops_events)
{
  tournament_id: string
  category: 'men' | 'women'
  source_filename: string | null
  source_version: number | null
  source_modified: string | null
  players_matched: number
  players_created: number
  players_total: number
  seeded_at: string
  seeded_by: 'ops'  // future: user ID
}
```

Use existing `ops_events` table with `source: 'entry-list-seed'` and metadata JSON containing the above fields. No new table needed.

## API Routes

### `POST /api/ops/parse-entry-list`

**Auth:** `Authorization: Bearer {CRON_SECRET}` (same as ops endpoints)

**Input:** `multipart/form-data` with field `file` (PDF) OR `application/json` with `{ text: string }`

**Output:**
```json
{
  "teams": [...ParsedTeam],
  "metadata": { ...PDFMetadata },
  "parseErrors": ["Line 47: could not parse player"]
}
```

**Implementation:**
- If PDF: read buffer, convert to `Uint8Array`, use `pdf-parse` `PDFParse` class: `new PDFParse(uint8) → load() → getText() → result.text`
- Run shared `parseEntryListText()` on extracted text
- Return structured data + any parse warnings

### `POST /api/ops/seed-entry-list`

**Auth:** Same as above

**Input:**
```json
{
  "tournamentId": "uuid",
  "category": "men",
  "players": [
    { "name": "Jeronimo Gonzalez", "country": "ES", "action": "link", "playerId": "abc" },
    { "name": "Rasul Gojayev", "country": "KZ", "action": "create" }
  ],
  "metadata": { "filename": "...", "version": 7, "lastModified": "..." }
}
```

**Output:**
```json
{
  "linked": 28,
  "created": 4,
  "total": 32,
  "errors": []
}
```

**Implementation:**
- For `action: 'link'` — verify player exists (no-op, already matched)
- For `action: 'create'` — call `PlayerResolver.resolve({ name, country, category })`
- Log to `ops_events` with seed metadata

## UI Component

Single file: `src/app/ops/EntryListTab.tsx`

### States

1. **Select** — tournament dropdown + category toggle + input area (upload/paste tabs)
2. **Parsing** — spinner while PDF is uploading/parsing
3. **Preview** — metadata bar + player table + confirm button
4. **Seeding** — progress indicator
5. **Done** — summary with counts (linked/created/total)

### Styling

Inline styles consistent with existing `OpsClient.tsx` patterns (no Tailwind in ops, all inline). Same color palette, card styling, table formatting.

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/app/ops/EntryListTab.tsx` | Create | Tab component with full UI |
| `src/app/ops/OpsClient.tsx` | Modify | Add tab navigation, render EntryListTab |
| `src/app/api/ops/parse-entry-list/route.ts` | Create | PDF parsing API |
| `src/app/api/ops/seed-entry-list/route.ts` | Create | Player seeding API |
| `src/lib/entry-list-parser.ts` | Create | Shared parsing logic (text → ParsedTeam[]) |
| `src/app/ops/api/status/route.ts` | Modify | Include entry list seed history in dashboard data |

## Dependencies

- `pdf-parse` — already installed (v2.4.5), used for server-side PDF text extraction
- `PlayerResolver` — existing, used for DB matching and player creation
- `toIso2()` — existing in `fip-scraper.ts`, 3-letter → 2-letter country conversion

## Edge Cases

- **Duplicate upload** — if same tournament+category already seeded, show warning with previous seed info, allow re-seed (overwrites)
- **Partial parse** — show parse errors inline, allow seeding successfully parsed players
- **Empty PDF** — show "No players found" error with hint to try text paste
- **Wrong category** — user selects "women" but uploads men's list; mismatch between parsed names and DB players will show as mostly "new" — visual signal something is off
- **Wildcard entries** — some entry lists have wildcards or alternates; parse them the same way, they'll just create new player records if not in DB

## Not In Scope

- Automatic PDF fetching from FIP website (future Railway pipeline)
- Ranking/points updates from entry list data (rankings cron handles this)
- Women's entry list format differences (same format, validated)
- Entry list diffing (v6 vs v7 comparison)
