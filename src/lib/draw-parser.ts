// src/lib/draw-parser.ts
// Parses FIP draw PDF text into structured bracket data.
// Pure function — no I/O, no DB access.
//
// Draw PDFs list teams in bracket order (pairs of lines per slot),
// with optional prefixes: seed number (1-8), Q (qualifier), WC (wild card), LL (lucky loser).
// After bracket entries: round prizes, seeded teams summary, withdrawals, metadata.

export interface ParsedDrawEntry {
  drawPosition: number
  player1Name: string
  player1Country: string | null
  player2Name: string
  player2Country: string | null
  seed: number | null
  marker: 'Q' | 'WC' | 'LL' | null
}

export interface ParsedSeededTeam {
  seed: number
  player1: string
  player2: string
  points: number
}

export interface DrawMetadata {
  category: 'men' | 'women'
  releaseDate: string | null
  drawSize: number
}

export interface DrawParseResult {
  entries: ParsedDrawEntry[]
  seededTeams: ParsedSeededTeam[]
  metadata: DrawMetadata
  warnings: string[]
}

// ── Name helpers ────────────────────────────────────────────────

/** Convert "LASTNAME, Firstname" → "Firstname Lastname" */
function flipName(raw: string): string {
  const commaIdx = raw.indexOf(',')
  if (commaIdx === -1) {
    // No comma — title-case the whole thing
    return titleCase(raw.trim())
  }
  const last = raw.slice(0, commaIdx).trim()
  const first = raw.slice(commaIdx + 1).trim()
  return `${titleCase(first)} ${titleCase(last)}`
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/(?:^|\s|-|')(\S)/g, (_, c) => _.slice(0, -1) + c.toUpperCase())
}

// ── Parsing ─────────────────────────────────────────────────────

// Matches: optional prefix (seed number, Q, WC, LL) + player name + optional country
const PLAYER_LINE_RE = /^(?:(\d+|Q|WC|LL)\s+)?(.+?)(?:\s+([A-Z]{2,3}))?\s*$/

// Seeded teams line: "1. OSORO ULRICH, Aranzazu / IGLESIAS SEGADOR, Victoria \t7110"
const SEEDED_TEAM_RE = /^(\d+)\.\s*(.+?)\s*\/\s*(.+?)\s+(\d+)\s*$/

// Lines that signal the end of bracket entries
const BRACKET_END_RE = /^(Round of|Quarterfinal|Semifinal|Final|Winner|\u20AC|\d+\s*$|Seeded teams|TEAM\s+POINTS|Withdrawal|Lucky|Retire|RELEASED|Tournament|Main Referee|Qualifying|Bye|WALKOVER)/i

// Date line: "30 Mar 2026"
const DATE_RE = /^\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4}$/

export function parseDrawText(text: string): DrawParseResult {
  if (!text.trim()) {
    return {
      entries: [],
      seededTeams: [],
      metadata: { category: 'women', releaseDate: null, drawSize: 0 },
      warnings: [],
    }
  }

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const entries: ParsedDrawEntry[] = []
  const seededTeams: ParsedSeededTeam[] = []
  const warnings: string[] = []
  let category: 'men' | 'women' = 'women'
  let releaseDate: string | null = null

  // Detect category from first line
  const firstLine = lines[0]?.toUpperCase() ?? ''
  if (firstLine.includes('MEN') && !firstLine.includes('WOMEN')) {
    category = 'men'
  }

  // Phase 1: Parse bracket entries (pairs of player lines)
  let i = firstLine.includes('MEN') || firstLine.includes('WOMEN') ? 1 : 0
  let drawPosition = 1
  let pendingPlayer1: {
    name: string
    country: string | null
    seed: number | null
    marker: 'Q' | 'WC' | 'LL' | null
  } | null = null

  while (i < lines.length) {
    const line = lines[i]

    // Stop parsing bracket when we hit round/prize/metadata lines
    if (BRACKET_END_RE.test(line)) break

    const match = PLAYER_LINE_RE.exec(line)
    if (!match) { i++; continue }

    const prefix = match[1] ?? null
    const rawName = match[2].trim()
    const country = match[3] ?? null

    // Skip empty names
    if (!rawName || rawName === '-') { i++; continue }

    // Determine seed/marker from prefix
    let seed: number | null = null
    let marker: 'Q' | 'WC' | 'LL' | null = null
    if (prefix) {
      const num = parseInt(prefix, 10)
      if (!isNaN(num)) {
        seed = num
      } else {
        marker = prefix as 'Q' | 'WC' | 'LL'
      }
    }

    const playerName = flipName(rawName)

    if (!pendingPlayer1) {
      // This is player 1 of a team
      pendingPlayer1 = { name: playerName, country, seed, marker }
    } else {
      // This is player 2 — complete the entry
      entries.push({
        drawPosition,
        player1Name: pendingPlayer1.name,
        player1Country: pendingPlayer1.country,
        player2Name: playerName,
        player2Country: country,
        seed: pendingPlayer1.seed,
        marker: pendingPlayer1.marker,
      })
      drawPosition++
      pendingPlayer1 = null
    }

    i++
  }

  // Warn if there's an unpaired player 1 (odd number of player lines)
  if (pendingPlayer1) {
    warnings.push(`Unpaired player at draw position ${drawPosition}: ${pendingPlayer1.name}`)
  }

  // Phase 2: Parse seeded teams and metadata from remaining lines
  for (; i < lines.length; i++) {
    const line = lines[i]

    // Seeded team line
    const seededMatch = SEEDED_TEAM_RE.exec(line)
    if (seededMatch) {
      seededTeams.push({
        seed: parseInt(seededMatch[1], 10),
        player1: flipName(seededMatch[2]),
        player2: flipName(seededMatch[3]),
        points: parseInt(seededMatch[4], 10),
      })
      continue
    }

    // Release date
    if (DATE_RE.test(line)) {
      releaseDate = line
      continue
    }
  }

  return {
    entries,
    seededTeams,
    metadata: {
      category,
      releaseDate,
      drawSize: entries.length,
    },
    warnings,
  }
}
