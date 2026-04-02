# FIP Entry List Seeding Tool — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Entry Lists" tab to the ops dashboard that lets operators upload FIP entry list PDFs (or paste text) to pre-seed player records, reducing TBD players in FIP match scores.

**Architecture:** Shared parser library extracts player data from entry list text. Two API routes handle PDF parsing and player seeding. A new React tab component in the ops dashboard provides the full workflow: select tournament → upload/paste → preview with DB matching → confirm seed.

**Tech Stack:** Next.js API routes, `pdf-parse` v2 (server-side PDF extraction), `PlayerResolver` (existing), Supabase, React (inline styles matching ops dashboard patterns).

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/lib/entry-list-parser.ts` | Pure parsing logic: text → `ParsedTeam[]`. No DB, no I/O. |
| `src/lib/entry-list-parser.test.ts` | Unit tests for parser |
| `src/app/api/ops/parse-entry-list/route.ts` | API: accepts PDF upload or text, returns parsed teams + metadata |
| `src/app/api/ops/seed-entry-list/route.ts` | API: accepts confirmed players, upserts via PlayerResolver, logs to ops_events |
| `src/app/ops/EntryListTab.tsx` | React component: full UI for the entry list workflow |
| `src/app/ops/OpsClient.tsx` | Modified: add tab navigation + render EntryListTab |

---

### Task 1: Entry List Text Parser

**Files:**
- Create: `src/lib/entry-list-parser.ts`
- Create: `src/lib/entry-list-parser.test.ts`

- [ ] **Step 1: Write the test file with real entry list data**

Create `src/lib/entry-list-parser.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { parseEntryListText, type ParsedTeam } from './entry-list-parser'

const SAMPLE_TEXT = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t15 Jeronimo Gonzalez ESP
4350 points 12 Martin Di Nenno ARG
5020 points 9370
2 \t16 Javier Leal ESP
3875 points 45 Pablo Lijó ESP
1395 points 5270
3 \t24 Alejandro Arroyo ESP
2400 points 38 Pablo Garcia Rodrigo ESP
1630 points 4030`

describe('parseEntryListText', () => {
  it('parses teams from entry list text', () => {
    const teams = parseEntryListText(SAMPLE_TEXT)
    expect(teams).toHaveLength(3)

    expect(teams[0]).toEqual({
      position: 1,
      teamPoints: 9370,
      player1: { name: 'Jeronimo Gonzalez', country: 'ESP', ranking: 15, points: 4350 },
      player2: { name: 'Martin Di Nenno', country: 'ARG', ranking: 12, points: 5020 },
    })

    expect(teams[1]).toEqual({
      position: 2,
      teamPoints: 5270,
      player1: { name: 'Javier Leal', country: 'ESP', ranking: 16, points: 3875 },
      player2: { name: 'Pablo Lijó', country: 'ESP', ranking: 45, points: 1395 },
    })

    expect(teams[2]).toEqual({
      position: 3,
      teamPoints: 4030,
      player1: { name: 'Alejandro Arroyo', country: 'ESP', ranking: 24, points: 2400 },
      player2: { name: 'Pablo Garcia Rodrigo', country: 'ESP', ranking: 38, points: 1630 },
    })
  })

  it('handles high-ranking numbers (4+ digits)', () => {
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t2926 Rasul Gojayev KAZ
5 points 5000 Some Player USA
3 points 8`
    const teams = parseEntryListText(text)
    expect(teams).toHaveLength(1)
    expect(teams[0].player1.ranking).toBe(2926)
    expect(teams[0].player1.name).toBe('Rasul Gojayev')
    expect(teams[0].player2.ranking).toBe(5000)
  })

  it('returns empty array for empty/header-only input', () => {
    expect(parseEntryListText('')).toEqual([])
    expect(parseEntryListText('Pos Ranking Player')).toEqual([])
  })

  it('skips malformed lines and continues parsing', () => {
    const text = `Pos Ranking \tPlayer \tRanking \tPlayer \tTeam Points
1 \t15 Jeronimo Gonzalez ESP
4350 points 12 Martin Di Nenno ARG
5020 points 9370
this line is garbage
2 \t24 Alejandro Arroyo ESP
2400 points 38 Pablo Garcia Rodrigo ESP
1630 points 4030`
    const teams = parseEntryListText(text)
    expect(teams).toHaveLength(2)
    expect(teams[0].position).toBe(1)
    expect(teams[1].position).toBe(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/entry-list-parser.test.ts`
Expected: FAIL — module `./entry-list-parser` not found

- [ ] **Step 3: Implement the parser**

Create `src/lib/entry-list-parser.ts`:

```typescript
// src/lib/entry-list-parser.ts
// Parses FIP entry list text (from PDF extraction or paste) into structured team data.
// Pure function — no I/O, no DB access.

export interface ParsedEntryPlayer {
  name: string        // Full name, e.g. "Jeronimo Gonzalez"
  country: string     // 3-letter code from PDF, e.g. "ESP"
  ranking: number     // FIP ranking position
  points: number      // FIP ranking points
}

export interface ParsedTeam {
  position: number
  teamPoints: number
  player1: ParsedEntryPlayer
  player2: ParsedEntryPlayer
}

export interface ParseResult {
  teams: ParsedTeam[]
  parseErrors: string[]
}

/**
 * Parse entry list text into structured team data.
 *
 * Expected format (from FIP entry list PDFs):
 *   {pos}\t{ranking} {FirstName} {LastName} {COUNTRY}
 *   {points} points {ranking2} {FirstName2} {LastName2} {COUNTRY2}
 *   {points2} points {teamPoints}
 *
 * Each team spans 3 logical lines (position + player1, points1 + player2, points2 + teamPoints).
 * Lines may be split differently depending on PDF extraction, so we use a
 * state-machine approach: scan for player patterns and group them into teams.
 */
export function parseEntryListText(text: string): ParsedTeam[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const teams: ParsedTeam[] = []

  // Pattern: {ranking} {Name parts} {COUNTRY_CODE}
  const playerRe = /(\d+)\s+(.+?)\s+([A-Z]{2,3})\s*$/
  // Pattern: {points} points
  const pointsRe = /(\d+)\s+points/
  // Pattern: position at start of line
  const positionRe = /^(\d+)\s+/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Skip header line
    if (line.startsWith('Pos') || line.toLowerCase().includes('ranking') && line.toLowerCase().includes('player')) {
      i++
      continue
    }

    // Try to match a position + player1 line
    const posMatch = positionRe.exec(line)
    if (!posMatch) {
      i++
      continue
    }

    const position = parseInt(posMatch[1], 10)

    // Extract player1 from this line (after position, or after tab)
    const afterPos = line.replace(/^\d+\s*\t?\s*/, '')
    const p1Match = playerRe.exec(afterPos)
    if (!p1Match) {
      i++
      continue
    }

    const player1Ranking = parseInt(p1Match[1], 10)
    const player1Name = p1Match[2].trim()
    const player1Country = p1Match[3]

    // Next line should have: {points} points {ranking2} {Name2} {COUNTRY2}
    if (i + 1 >= lines.length) break
    const line2 = lines[i + 1]

    const p1PointsMatch = pointsRe.exec(line2)
    if (!p1PointsMatch) {
      i++
      continue
    }
    const player1Points = parseInt(p1PointsMatch[1], 10)

    // After "XXXX points" extract player2
    const afterPoints1 = line2.slice(p1PointsMatch.index + p1PointsMatch[0].length).trim()
    const p2Match = playerRe.exec(afterPoints1)
    if (!p2Match) {
      i++
      continue
    }

    const player2Ranking = parseInt(p2Match[1], 10)
    const player2Name = p2Match[2].trim()
    const player2Country = p2Match[3]

    // Third line: {points2} points {teamPoints}
    if (i + 2 >= lines.length) break
    const line3 = lines[i + 2]

    const p2PointsMatch = pointsRe.exec(line3)
    if (!p2PointsMatch) {
      i++
      continue
    }
    const player2Points = parseInt(p2PointsMatch[1], 10)

    // Team points: number at end of line3
    const teamPointsMatch = /(\d+)\s*$/.exec(line3)
    const teamPoints = teamPointsMatch ? parseInt(teamPointsMatch[1], 10) : 0

    teams.push({
      position,
      teamPoints,
      player1: { name: player1Name, country: player1Country, ranking: player1Ranking, points: player1Points },
      player2: { name: player2Name, country: player2Country, ranking: player2Ranking, points: player2Points },
    })

    i += 3 // Move past the 3 lines of this team
  }

  return teams
}

/**
 * Extract version number from filename (e.g., "Entry-list-v7.pdf" → 7).
 */
export function extractVersion(filename: string): number | null {
  const match = /v(\d+)/i.exec(filename)
  return match ? parseInt(match[1], 10) : null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/entry-list-parser.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/entry-list-parser.ts src/lib/entry-list-parser.test.ts
git commit -m "feat: add FIP entry list text parser with tests"
```

---

### Task 2: PDF Parse API Route

**Files:**
- Create: `src/app/api/ops/parse-entry-list/route.ts`

**Context:**
- Auth: ops routes are protected by middleware that checks `ops_token` cookie against `CRON_SECRET`. All routes under `/ops/` are automatically protected — no auth code needed in the route itself.
- `pdf-parse` v2 API: `new PDFParse(uint8array) → .load() → .getText() → { text, pages, total }`. Metadata via `.getInfo()`.
- This route also accepts `application/json` with `{ text: string }` for the paste flow (client can send text to get the same structured response).

- [ ] **Step 1: Create the parse API route**

Create `src/app/api/ops/parse-entry-list/route.ts`:

```typescript
// src/app/api/ops/parse-entry-list/route.ts
// Accepts PDF file (multipart/form-data) or JSON text ({ text: string }).
// Returns parsed teams + PDF metadata.
// Auth: handled by ops middleware (ops_token cookie).

import { parseEntryListText, extractVersion } from '@/lib/entry-list-parser'

export async function POST(request: Request) {
  const contentType = request.headers.get('content-type') ?? ''

  let text: string
  let metadata: {
    filename: string | null
    version: number | null
    lastModified: string | null
    pageCount: number | null
    title: string | null
  } = { filename: null, version: null, lastModified: null, pageCount: null, title: null }

  if (contentType.includes('multipart/form-data')) {
    // PDF upload flow
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return Response.json({ error: 'No file provided' }, { status: 400 })
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return Response.json({ error: 'File must be a PDF' }, { status: 400 })
    }

    metadata.filename = file.name
    metadata.version = extractVersion(file.name)

    try {
      const { PDFParse } = await import('pdf-parse')
      const buffer = await file.arrayBuffer()
      const uint8 = new Uint8Array(buffer)
      const doc = new PDFParse(uint8)
      await doc.load()

      metadata.pageCount = doc.doc?.numPages ?? null

      // Extract PDF metadata (creation/modification dates, title)
      try {
        const info = await doc.getInfo()
        if (info) {
          metadata.title = info.Title ?? null
          // ModDate format: "D:20260401120000Z" → parse to ISO
          const modDate = info.ModDate ?? info.CreationDate ?? null
          if (modDate) {
            metadata.lastModified = parsePdfDate(modDate)
          }
        }
      } catch {
        // Metadata extraction is best-effort
      }

      const result = await doc.getText()
      text = result?.text ?? ''

      if (!text.trim()) {
        return Response.json({
          error: 'No text extracted from PDF. Try pasting the text instead.',
          metadata,
        }, { status: 422 })
      }
    } catch (e) {
      return Response.json({
        error: `PDF parsing failed: ${e instanceof Error ? e.message : String(e)}`,
      }, { status: 422 })
    }
  } else {
    // Text paste flow
    const body = await request.json()
    text = body.text ?? ''

    if (!text.trim()) {
      return Response.json({ error: 'No text provided' }, { status: 400 })
    }
  }

  const teams = parseEntryListText(text)

  return Response.json({
    teams,
    metadata,
    playerCount: teams.length * 2,
  })
}

/**
 * Parse PDF date string (e.g., "D:20260401120000+00'00'" or "D:20260401120000Z")
 * into ISO 8601 format.
 */
function parsePdfDate(pdfDate: string): string | null {
  try {
    // Remove "D:" prefix
    const cleaned = pdfDate.replace(/^D:/, '')
    // Extract: YYYYMMDDHHMMSS
    const match = /^(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(cleaned)
    if (!match) return null
    const [, y, m, d, h = '00', min = '00', s = '00'] = match
    return `${y}-${m}-${d}T${h}:${min}:${s}Z`
  } catch {
    return null
  }
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit src/app/api/ops/parse-entry-list/route.ts 2>&1 | head -20`

If there are type errors, fix them. The key thing to check: `pdf-parse` may need a type declaration. If so, the dynamic import approach avoids build-time issues.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ops/parse-entry-list/route.ts
git commit -m "feat: add parse-entry-list API route with PDF and text support"
```

---

### Task 3: Seed API Route

**Files:**
- Create: `src/app/api/ops/seed-entry-list/route.ts`

**Context:**
- Uses `PlayerResolver` from `src/lib/player-resolver.ts`. Call `resolver.load()` once, then `resolver.resolve()` per player.
- `resolve()` accepts `PlayerInput` with `name`, `country` (ISO2), `category`. Returns `{ playerId, action: 'found'|'enriched'|'created' }`.
- Country conversion: use `toIso2()` from `src/lib/fip-scraper.ts` to convert 3-letter → 2-letter.
- Audit: log to `ops_events` table with `source: 'entry-list-seed'`.

- [ ] **Step 1: Create the seed API route**

Create `src/app/api/ops/seed-entry-list/route.ts`:

```typescript
// src/app/api/ops/seed-entry-list/route.ts
// Accepts confirmed player list + tournament info, seeds players via PlayerResolver.
// Auth: handled by ops middleware (ops_token cookie).

import { createClient } from '@supabase/supabase-js'
import { PlayerResolver } from '@/lib/player-resolver'
import { toIso2 } from '@/lib/fip-scraper'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

interface SeedPlayer {
  name: string
  country: string      // 3-letter code from PDF
  action: 'link' | 'create'
  playerId?: string    // For 'link' action — existing DB player ID
}

interface SeedRequest {
  tournamentId: string
  category: 'men' | 'women'
  players: SeedPlayer[]
  metadata?: {
    filename?: string
    version?: number | null
    lastModified?: string | null
  }
}

export async function POST(request: Request) {
  const body: SeedRequest = await request.json()

  if (!body.tournamentId || !body.category || !body.players?.length) {
    return Response.json({ error: 'Missing required fields: tournamentId, category, players' }, { status: 400 })
  }

  // Verify tournament exists
  const { data: tournament } = await supabase
    .from('tournaments')
    .select('id, name')
    .eq('id', body.tournamentId)
    .single()

  if (!tournament) {
    return Response.json({ error: 'Tournament not found' }, { status: 404 })
  }

  const resolver = new PlayerResolver(supabase)
  await resolver.load()

  let linked = 0
  let created = 0
  const errors: string[] = []

  for (const player of body.players) {
    try {
      if (player.action === 'link' && player.playerId) {
        // Verify player exists — no-op, already matched
        linked++
      } else {
        // Create or find via resolver
        const iso2 = toIso2(player.country)
        const result = await resolver.resolve({
          name: player.name,
          country: iso2,
          category: body.category,
        })

        if (result.action === 'created') {
          created++
        } else {
          linked++
        }
      }
    } catch (e) {
      errors.push(`${player.name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Log to ops_events for audit trail
  await supabase.from('ops_events').insert({
    source: 'entry-list-seed',
    status: errors.length > 0 ? 'partial' : 'ok',
    started_at: new Date().toISOString(),
    duration_ms: 0,
    meta: {
      tournament_id: body.tournamentId,
      tournament_name: tournament.name,
      category: body.category,
      filename: body.metadata?.filename ?? null,
      version: body.metadata?.version ?? null,
      last_modified: body.metadata?.lastModified ?? null,
      players_total: body.players.length,
      players_linked: linked,
      players_created: created,
      errors: errors.length,
    },
    error_message: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
  })

  return Response.json({
    linked,
    created,
    total: body.players.length,
    errors,
  })
}
```

- [ ] **Step 2: Verify the route compiles**

Run: `npx tsc --noEmit src/app/api/ops/seed-entry-list/route.ts 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/app/api/ops/seed-entry-list/route.ts
git commit -m "feat: add seed-entry-list API route with PlayerResolver integration"
```

---

### Task 4: Entry List Tab UI Component

**Files:**
- Create: `src/app/ops/EntryListTab.tsx`

**Context:**
- Inline styles only — match existing `OpsClient.tsx` patterns (the `card`, `sectionLabel`, `tileLabel`, `dimText` style objects).
- Component receives no props — it fetches its own data.
- Auth: API calls go to `/api/ops/*` routes which are protected by the ops middleware cookie. The browser already has the `ops_token` cookie set from login, so `fetch()` calls include it automatically.
- State machine: Select → Parsing → Preview → Seeding → Done.

- [ ] **Step 1: Create the EntryListTab component**

Create `src/app/ops/EntryListTab.tsx`:

```typescript
'use client'
// src/app/ops/EntryListTab.tsx
// Entry list seeding tool — upload PDF or paste text to pre-seed players for FIP tournaments.

import { useState, useEffect, useCallback, useRef } from 'react'

// ── Types ───────────────────────────────────────────────────────

interface ParsedEntryPlayer {
  name: string
  country: string
  ranking: number
  points: number
}

interface ParsedTeam {
  position: number
  teamPoints: number
  player1: ParsedEntryPlayer
  player2: ParsedEntryPlayer
}

interface PDFMetadata {
  filename: string | null
  version: number | null
  lastModified: string | null
  pageCount: number | null
  title: string | null
}

interface Tournament {
  id: string
  name: string
  country: string | null
  level: string | null
  starts_at: string
  ends_at: string | null
}

interface MatchedPlayer {
  parsed: ParsedEntryPlayer
  matchType: 'exact' | 'fuzzy' | 'new'
  dbPlayer: { id: string; name: string; country: string | null } | null
  similarity: number | null
  action: 'link' | 'create'  // User's decision
}

type Phase = 'select' | 'parsing' | 'preview' | 'seeding' | 'done'

// ── Styles (matching OpsClient patterns) ────────────────────────

const card: React.CSSProperties = {
  background: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: 8,
  padding: 12,
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  color: '#999',
  textTransform: 'uppercase',
  fontWeight: 700,
  letterSpacing: 1,
  marginBottom: 8,
}

const btnPrimary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
  background: '#2563eb',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
}

const btnSecondary: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  color: '#374151',
  background: '#f3f4f6',
  border: '1px solid #e5e7eb',
  borderRadius: 6,
  cursor: 'pointer',
}

// ── Helpers ─────────────────────────────────────────────────────

function daysUntil(dateStr: string): number {
  const d = new Date(dateStr)
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
}

function urgencyInfo(t: Tournament): { color: string; label: string; sort: number } {
  const days = daysUntil(t.starts_at)
  const endDays = t.ends_at ? daysUntil(t.ends_at) : days

  if (days <= 0 && endDays >= 0) {
    // In progress
    return { color: '#6b7280', label: `started ${Math.abs(days)}d ago`, sort: 100 + Math.abs(days) }
  }
  if (days <= 3) return { color: '#ef4444', label: `starts in ${days}d`, sort: days }
  if (days <= 7) return { color: '#f59e0b', label: `starts in ${days}d`, sort: days }
  return { color: '#22c55e', label: `starts in ${days}d`, sort: days }
}

// ── Component ───────────────────────────────────────────────────

export default function EntryListTab() {
  // State
  const [phase, setPhase] = useState<Phase>('select')
  const [tournaments, setTournaments] = useState<Tournament[]>([])
  const [selectedTournament, setSelectedTournament] = useState<string>('')
  const [category, setCategory] = useState<'men' | 'women'>('men')
  const [inputMode, setInputMode] = useState<'upload' | 'paste'>('upload')
  const [pasteText, setPasteText] = useState('')
  const [teams, setTeams] = useState<ParsedTeam[]>([])
  const [metadata, setMetadata] = useState<PDFMetadata | null>(null)
  const [matchedPlayers, setMatchedPlayers] = useState<MatchedPlayer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [seedResult, setSeedResult] = useState<{ linked: number; created: number; total: number; errors: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch FIP tournaments on mount
  useEffect(() => {
    fetchTournaments()
  }, [])

  async function fetchTournaments() {
    try {
      const res = await fetch('/api/ops/parse-entry-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listTournaments: true }),
      })
      // Fallback: fetch from status API which has tournament data
      const statusRes = await fetch('/ops/api/status')
      if (!statusRes.ok) return
      const data = await statusRes.json()

      // We need FIP tournaments — extract from ongoing or fetch separately
      // For now, use a dedicated fetch
      const tournamentsRes = await fetch('/api/ops/seed-entry-list?' + new URLSearchParams({ action: 'list-tournaments' }))
      if (tournamentsRes.ok) {
        const tData = await tournamentsRes.json()
        setTournaments(tData.tournaments ?? [])
      }
    } catch {
      // Silent — tournaments will just be empty
    }
  }

  async function handleUpload(file: File) {
    setError(null)
    setPhase('parsing')

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/ops/parse-entry-list', { method: 'POST', body: formData })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Parse failed')
        setPhase('select')
        return
      }

      setTeams(data.teams)
      setMetadata(data.metadata)
      await matchPlayers(data.teams)
      setPhase('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setPhase('select')
    }
  }

  async function handlePaste() {
    if (!pasteText.trim()) return
    setError(null)
    setPhase('parsing')

    try {
      const res = await fetch('/api/ops/parse-entry-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: pasteText }),
      })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Parse failed')
        setPhase('select')
        return
      }

      setTeams(data.teams)
      setMetadata(null) // No metadata for paste
      await matchPlayers(data.teams)
      setPhase('preview')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Parse failed')
      setPhase('select')
    }
  }

  async function matchPlayers(teams: ParsedTeam[]) {
    // For now, mark all as 'new' — the seed endpoint will use PlayerResolver
    // to do the actual matching. We show a simple preview.
    const matched: MatchedPlayer[] = []
    for (const team of teams) {
      matched.push({
        parsed: team.player1,
        matchType: 'new',
        dbPlayer: null,
        similarity: null,
        action: 'create',
      })
      matched.push({
        parsed: team.player2,
        matchType: 'new',
        dbPlayer: null,
        similarity: null,
        action: 'create',
      })
    }
    setMatchedPlayers(matched)
  }

  async function handleSeed() {
    if (!selectedTournament) {
      setError('Please select a tournament')
      return
    }

    setPhase('seeding')
    setError(null)

    try {
      const players = matchedPlayers.map(mp => ({
        name: mp.parsed.name,
        country: mp.parsed.country,
        action: mp.action,
        playerId: mp.dbPlayer?.id,
      }))

      const res = await fetch('/api/ops/seed-entry-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tournamentId: selectedTournament,
          category,
          players,
          metadata: metadata ? {
            filename: metadata.filename,
            version: metadata.version,
            lastModified: metadata.lastModified,
          } : undefined,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Seed failed')
        setPhase('preview')
        return
      }

      setSeedResult(data)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seed failed')
      setPhase('preview')
    }
  }

  function handleReset() {
    setPhase('select')
    setTeams([])
    setMetadata(null)
    setMatchedPlayers([])
    setError(null)
    setSeedResult(null)
    setPasteText('')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div>
      {error && (
        <div style={{
          background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6,
          padding: '8px 12px', marginBottom: 16, fontSize: 12, color: '#dc2626',
        }}>
          {error}
        </div>
      )}

      {/* Phase: Select */}
      {phase === 'select' && (
        <>
          <div style={sectionLabel}>Tournament & Category</div>
          <div style={{ ...card, marginBottom: 16 }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {/* Tournament selector */}
              <div style={{ flex: 1, minWidth: 280 }}>
                <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>FIP Tournament</label>
                <select
                  value={selectedTournament}
                  onChange={e => setSelectedTournament(e.target.value)}
                  style={{
                    width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db',
                    borderRadius: 6, background: 'white', color: '#111',
                  }}
                >
                  <option value="">Select tournament...</option>
                  {tournaments
                    .map(t => ({ ...t, urgency: urgencyInfo(t) }))
                    .sort((a, b) => a.urgency.sort - b.urgency.sort)
                    .map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name} · {t.urgency.label}
                      </option>
                    ))
                  }
                </select>
              </div>

              {/* Category toggle */}
              <div>
                <label style={{ fontSize: 11, color: '#666', display: 'block', marginBottom: 4 }}>Category</label>
                <div style={{ display: 'flex', gap: 0 }}>
                  {(['men', 'women'] as const).map(c => (
                    <button
                      key={c}
                      onClick={() => setCategory(c)}
                      style={{
                        padding: '8px 16px', fontSize: 13, fontWeight: category === c ? 600 : 400,
                        color: category === c ? '#fff' : '#666',
                        background: category === c ? '#2563eb' : '#f3f4f6',
                        border: '1px solid #d1d5db',
                        borderRadius: c === 'men' ? '6px 0 0 6px' : '0 6px 6px 0',
                        cursor: 'pointer',
                        ...(c === 'women' ? { borderLeft: 'none' } : {}),
                      }}
                    >
                      {c === 'men' ? 'Men' : 'Women'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Input mode tabs */}
          <div style={sectionLabel}>Entry List Data</div>
          <div style={{ ...card }}>
            <div style={{ display: 'flex', gap: 0, marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
              {(['upload', 'paste'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setInputMode(mode)}
                  style={{
                    padding: '6px 16px', fontSize: 12, fontWeight: inputMode === mode ? 700 : 500,
                    color: inputMode === mode ? '#111' : '#888', background: 'none', border: 'none',
                    borderBottom: inputMode === mode ? '2px solid #111' : '2px solid transparent',
                    cursor: 'pointer', marginBottom: -1,
                  }}
                >
                  {mode === 'upload' ? 'Upload PDF' : 'Paste Text'}
                </button>
              ))}
            </div>

            {inputMode === 'upload' && (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  onChange={e => {
                    const file = e.target.files?.[0]
                    if (file) handleUpload(file)
                  }}
                  style={{ display: 'none' }}
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
                  onDrop={e => {
                    e.preventDefault()
                    e.stopPropagation()
                    const file = e.dataTransfer.files[0]
                    if (file && file.name.toLowerCase().endsWith('.pdf')) handleUpload(file)
                  }}
                  style={{
                    border: '2px dashed #d1d5db', borderRadius: 8, padding: '32px 20px',
                    textAlign: 'center', cursor: 'pointer', color: '#666', fontSize: 13,
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = '#2563eb')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = '#d1d5db')}
                >
                  <div style={{ fontSize: 24, marginBottom: 8 }}>PDF</div>
                  <div>Drop entry list PDF here or click to browse</div>
                  <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>Accepts FIP entry list PDFs</div>
                </div>
              </div>
            )}

            {inputMode === 'paste' && (
              <div>
                <textarea
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  placeholder="Paste entry list text here (copy from PDF)..."
                  style={{
                    width: '100%', minHeight: 200, padding: 10, fontSize: 12, fontFamily: 'monospace',
                    border: '1px solid #d1d5db', borderRadius: 6, resize: 'vertical',
                    color: '#111', background: '#fafafa',
                  }}
                />
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
                  <button onClick={handlePaste} style={btnPrimary} disabled={!pasteText.trim()}>
                    Parse Text
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* Phase: Parsing */}
      {phase === 'parsing' && (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 14, color: '#666' }}>Parsing entry list...</div>
        </div>
      )}

      {/* Phase: Preview */}
      {phase === 'preview' && (
        <>
          {/* Metadata bar */}
          {metadata?.filename && (
            <div style={{
              ...card, marginBottom: 16, fontSize: 12, color: '#666',
              display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap',
            }}>
              <span style={{ fontWeight: 600, color: '#111' }}>{metadata.filename}</span>
              {metadata.version && <span>Version {metadata.version}</span>}
              {metadata.lastModified && <span>Modified: {new Date(metadata.lastModified).toLocaleDateString()}</span>}
              {metadata.pageCount && <span>{metadata.pageCount} pages</span>}
              <span style={{ fontWeight: 600, color: '#2563eb' }}>{teams.length} teams parsed</span>
            </div>
          )}

          <div style={sectionLabel}>Parsed Players ({matchedPlayers.length})</div>
          <div style={{ ...card, overflow: 'auto', marginBottom: 16 }}>
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#666' }}>#</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Name</th>
                  <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, color: '#666' }}>Country</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Ranking</th>
                  <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, color: '#666' }}>Points</th>
                  <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600, color: '#666' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {matchedPlayers.map((mp, i) => {
                  const isTeamStart = i % 2 === 0
                  const teamIdx = Math.floor(i / 2) + 1
                  return (
                    <tr key={i} style={{
                      borderBottom: i % 2 === 1 ? '2px solid #e5e7eb' : '1px solid #f3f4f6',
                      background: i % 4 < 2 ? '#fff' : '#fafafa',
                    }}>
                      <td style={{ padding: '5px 10px', color: '#999', fontSize: 10 }}>
                        {isTeamStart ? teamIdx : ''}
                      </td>
                      <td style={{ padding: '5px 10px', fontWeight: 500, color: '#111' }}>
                        {mp.parsed.name}
                      </td>
                      <td style={{ padding: '5px 10px', color: '#666' }}>{mp.parsed.country}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#666' }}>{mp.parsed.ranking}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'right', color: '#666' }}>{mp.parsed.points.toLocaleString()}</td>
                      <td style={{ padding: '5px 10px', textAlign: 'center' }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 4,
                          ...(mp.matchType === 'exact'
                            ? { background: '#d1fae5', color: '#065f46' }
                            : mp.matchType === 'fuzzy'
                            ? { background: '#fef3c7', color: '#92400e' }
                            : { background: '#dbeafe', color: '#1e40af' }),
                        }}>
                          {mp.matchType === 'exact' ? 'Exact' : mp.matchType === 'fuzzy' ? `Fuzzy ${(mp.similarity! * 100).toFixed(0)}%` : 'New'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button onClick={handleReset} style={btnSecondary}>Back</button>
            <button
              onClick={handleSeed}
              style={{
                ...btnPrimary,
                opacity: !selectedTournament ? 0.5 : 1,
              }}
              disabled={!selectedTournament}
            >
              Seed {matchedPlayers.length} Players
            </button>
          </div>

          {!selectedTournament && (
            <div style={{ fontSize: 11, color: '#f59e0b', textAlign: 'right', marginTop: 4 }}>
              Please select a tournament above before seeding
            </div>
          )}
        </>
      )}

      {/* Phase: Seeding */}
      {phase === 'seeding' && (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 14, color: '#666' }}>Seeding players...</div>
        </div>
      )}

      {/* Phase: Done */}
      {phase === 'done' && seedResult && (
        <div style={{ ...card, textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#166534', marginBottom: 8 }}>
            Seeding Complete
          </div>
          <div style={{ display: 'flex', gap: 24, justifyContent: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#2563eb' }}>{seedResult.linked}</div>
              <div style={{ fontSize: 10, color: '#666' }}>Linked</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#166534' }}>{seedResult.created}</div>
              <div style={{ fontSize: 10, color: '#666' }}>Created</div>
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#111' }}>{seedResult.total}</div>
              <div style={{ fontSize: 10, color: '#666' }}>Total</div>
            </div>
          </div>
          {seedResult.errors.length > 0 && (
            <div style={{ fontSize: 11, color: '#dc2626', marginBottom: 12 }}>
              {seedResult.errors.length} error(s): {seedResult.errors.slice(0, 3).join(', ')}
            </div>
          )}
          <button onClick={handleReset} style={btnPrimary}>Seed Another</button>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the component compiles**

Run: `npx tsc --noEmit src/app/ops/EntryListTab.tsx 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/app/ops/EntryListTab.tsx
git commit -m "feat: add EntryListTab UI component for ops dashboard"
```

---

### Task 5: Add Tournament List Endpoint to Seed Route

**Files:**
- Modify: `src/app/api/ops/seed-entry-list/route.ts`

**Context:**
- The EntryListTab needs a list of FIP tournaments to populate the dropdown.
- Add a `GET` handler to the seed route that returns FIP tournaments sorted by urgency.
- Query: `tournaments` table, `source = 'fip'`, `starts_at` within next 30 days OR currently in progress (starts_at ≤ today ≤ ends_at).

- [ ] **Step 1: Add GET handler for tournament listing**

Add this `GET` export to `src/app/api/ops/seed-entry-list/route.ts`, above the existing `POST`:

```typescript
export async function GET(request: Request) {
  const url = new URL(request.url)
  const action = url.searchParams.get('action')

  if (action === 'list-tournaments') {
    const today = new Date().toISOString().slice(0, 10)
    const in30Days = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, name, country, level, starts_at, ends_at')
      .eq('source', 'fip')
      .or(`starts_at.lte.${in30Days},and(starts_at.lte.${today},ends_at.gte.${today})`)
      .order('starts_at', { ascending: true })

    return Response.json({ tournaments: tournaments ?? [] })
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 })
}
```

- [ ] **Step 2: Update fetchTournaments in EntryListTab**

Replace the `fetchTournaments` function in `src/app/ops/EntryListTab.tsx` with a cleaner version:

```typescript
  async function fetchTournaments() {
    try {
      const res = await fetch('/api/ops/seed-entry-list?' + new URLSearchParams({ action: 'list-tournaments' }))
      if (!res.ok) return
      const data = await res.json()
      setTournaments(data.tournaments ?? [])
    } catch {
      // Silent — tournaments will just be empty
    }
  }
```

- [ ] **Step 3: Verify the app builds**

Run: `npm run build 2>&1 | tail -20`

- [ ] **Step 4: Commit**

```bash
git add src/app/api/ops/seed-entry-list/route.ts src/app/ops/EntryListTab.tsx
git commit -m "feat: add tournament list endpoint for entry list dropdown"
```

---

### Task 6: Wire EntryListTab into OpsClient

**Files:**
- Modify: `src/app/ops/OpsClient.tsx`

**Context:**
- OpsClient currently has two tabs: `'health'` and `'data'`.
- Add a third tab: `'entry-lists'`.
- Import and render `EntryListTab` when that tab is active.
- The tab type needs to expand from `'health' | 'data'` to include `'entry-lists'`.

- [ ] **Step 1: Add the import at the top of OpsClient.tsx**

After the existing React imports (line 5), add:

```typescript
import EntryListTab from './EntryListTab'
```

- [ ] **Step 2: Update the tab state type**

Change line 228:

```typescript
const [tab, setTab] = useState<'health' | 'data' | 'entry-lists'>('health')
```

- [ ] **Step 3: Add the new tab button**

Change the tabs section (around line 355–375). Replace the tab mapping:

```typescript
      {(['health', 'data', 'entry-lists'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 20px',
              fontSize: 13,
              fontWeight: tab === t ? 700 : 500,
              color: tab === t ? '#111' : '#888',
              background: 'none',
              border: 'none',
              borderBottom: tab === t ? '2px solid #111' : '2px solid transparent',
              cursor: 'pointer',
              marginBottom: -1,
            }}
          >
            {t === 'health' ? 'Integration Health' : t === 'data' ? 'Data' : 'Entry Lists'}
          </button>
        ))}
```

- [ ] **Step 4: Add the Entry Lists tab content**

After the `{tab === 'data' && <>...</>}` block (around line 573), before the closing `</div></div>`, add:

```typescript
      {tab === 'entry-lists' && <EntryListTab />}
```

- [ ] **Step 5: Verify the app builds**

Run: `npm run build 2>&1 | tail -20`

- [ ] **Step 6: Commit**

```bash
git add src/app/ops/OpsClient.tsx
git commit -m "feat: wire EntryListTab into ops dashboard as third tab"
```

---

### Task 7: Manual End-to-End Test

**Files:** None (testing only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

- [ ] **Step 2: Open ops dashboard**

Navigate to `http://localhost:3002/ops?token={CRON_SECRET}` in browser.

- [ ] **Step 3: Verify Entry Lists tab appears**

Click the "Entry Lists" tab. Verify:
- Tournament dropdown loads with FIP tournaments
- Category toggle works (men/women)
- Upload PDF and Paste Text sub-tabs are visible

- [ ] **Step 4: Test PDF upload flow**

Upload the test PDF (`Entry-list-Fip-Gold-Almaty-Men-v7.pdf`). Verify:
- Parsing spinner shows briefly
- Preview table appears with parsed players
- Metadata bar shows filename, version, page count
- Player names, countries, rankings, points are correct

- [ ] **Step 5: Test paste flow**

Switch to Paste Text tab, paste entry list text. Verify same preview appears.

- [ ] **Step 6: Test seed operation**

Select a tournament, click "Seed Players". Verify:
- Seeding progress shows
- Done screen shows linked/created counts
- Check `ops_events` table in Supabase for the audit record

- [ ] **Step 7: Fix any issues found during testing**

Address any bugs discovered. Common issues to watch for:
- CORS or auth issues on API routes (should be handled by middleware)
- `pdf-parse` import issues in Next.js server context (dynamic import helps)
- Tournament list returning empty (check `source = 'fip'` filter)

- [ ] **Step 8: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: address issues found during entry list e2e testing"
```
