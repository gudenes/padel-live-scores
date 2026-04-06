// src/lib/pdf-parse-sonnet.ts
// Parse FIP tournament PDFs using Claude Sonnet for structured extraction.
// Sends the PDF directly to Sonnet and gets back structured JSON — no text
// extraction step needed. Handles draw PDFs and entry list PDFs.

import Anthropic from '@anthropic-ai/sdk'

// ── Draw PDF types ──────────────────────────────────────────────

export interface SonnetDrawEntry {
  drawPosition: number
  round: string                // 'R128' | 'R64' | 'R32' | 'R16' | 'QF' | 'SF' | 'F'
  seed: number | null
  marker: 'Q' | 'WC' | 'LL' | null
  player1Name: string          // "Firstname Lastname" format
  player1Country: string | null // 2-3 letter ISO code
  player2Name: string
  player2Country: string | null
  teamPoints: number | null
}

export interface SonnetSeededTeam {
  seed: number
  player1: string
  player2: string
  points: number
}

export interface SonnetDrawResult {
  entries: SonnetDrawEntry[]
  seededTeams: SonnetSeededTeam[]
  metadata: {
    category: 'men' | 'women'
    drawSize: number           // Total entries (e.g., 32)
    tournamentName: string | null
    releaseDate: string | null
    startingRound: string      // e.g., 'R32' for 32-draw
  }
  warnings: string[]
}

// ── Entry List PDF types ────────────────────────────────────────

export interface SonnetEntryPlayer {
  name: string                 // "Firstname Lastname" format
  country: string              // 2-3 letter ISO code
  ranking: number | null       // null if unranked
  points: number | null        // null if no points
}

export interface SonnetEntryTeam {
  position: number
  drawType: 'main' | 'qualifying'
  isWildCard: boolean
  teamPoints: number | null
  player1: SonnetEntryPlayer
  player2: SonnetEntryPlayer
}

export interface SonnetEntryListResult {
  teams: SonnetEntryTeam[]
  metadata: {
    category: 'men' | 'women' | null
    tournamentName: string | null
    lastUpdate: string | null
    totalTeams: number
    mainDrawTeams: number
    qualifyingTeams: number
  }
}

// ── Parse functions ─────────────────────────────────────────────

function createClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function pdfDocument(base64: string): Anthropic.DocumentBlockParam {
  return {
    type: 'document',
    source: {
      type: 'base64',
      media_type: 'application/pdf',
      data: base64,
    },
  }
}

// ── Constant prompts (cached via prompt caching) ────────────────
// These long instruction blocks are constant across every call,
// so we mark them with cache_control to get 90% cost reduction
// on repeated reads ($3/M → $0.30/M after first call within 5 min TTL).

const DRAW_SYSTEM_PROMPT = `You are a parser for FIP padel tournament draw PDFs. Convert the PDF into structured JSON.

RULES:
1. Each draw position has a PAIR of two players (team). Extract both player names.
2. Player names must be in "Firstname Lastname" format (convert from "LASTNAME, Firstname" in the PDF).
3. Country codes are the 2-3 letter codes (ARG, MEX, USA, etc.).
4. Seeds are numbers 1-8 (or more) shown before certain team entries.
5. Markers: Q = Qualifier (placeholder, no real players yet), WC = Wild Card, LL = Lucky Loser.
6. For "Q Qualifier" entries (no player names), use player1Name: "Qualifier", player2Name: "Qualifier".
7. Determine the round for each position based on draw size:
   - 32-draw: positions 1-32 are R32
   - 16-draw: positions 1-16 are R16
   - 8-draw: positions 1-8 are QF
8. Extract seeded teams summary (usually at bottom of PDF with seed number, names, and points).
9. Detect category: "MEN"/"HOMBRES" = men, "WOMEN"/"MUJERES" = women.
10. The drawSize = total number of bracket positions (teams).
11. startingRound = the first round based on drawSize (32 → "R32", 16 → "R16", etc.).

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "entries": [
    {
      "drawPosition": 1,
      "round": "R32",
      "seed": 1,
      "marker": null,
      "player1Name": "Firstname Lastname",
      "player1Country": "ARG",
      "player2Name": "Firstname Lastname",
      "player2Country": "ARG",
      "teamPoints": null
    }
  ],
  "seededTeams": [
    { "seed": 1, "player1": "Firstname Lastname", "player2": "Firstname Lastname", "points": 3617 }
  ],
  "metadata": {
    "category": "men",
    "drawSize": 32,
    "tournamentName": "FIP SILVER AGUASCALIENTES",
    "releaseDate": "6 Apr 2026",
    "startingRound": "R32"
  },
  "warnings": []
}`

const ENTRY_LIST_SYSTEM_PROMPT = `You are a parser for FIP padel tournament entry list PDFs. Convert the PDF into structured JSON.

RULES:
1. Each entry is a TEAM of two players with a position number.
2. Player names must be in "Firstname Lastname" format (convert from "LASTNAME, Firstname" in the PDF).
3. Country codes are the 2-3 letter codes shown next to each player.
4. Rankings and points are numbers shown for each player (ranking is their FIP ranking position, points is their FIP points total).
5. If a player has no ranking or 0 ranking, set ranking to null.
6. If a player has no points or 0 points, set points to null.
7. Teams marked with "WC" are wild cards (isWildCard: true).
8. Detect sections: "Main Draw" or top section = drawType "main", "QUALIFICATIONS"/"QUALIFYING" section = drawType "qualifying".
9. teamPoints is the combined team points (usually the last number on the team line).
10. Detect category: "HOMBRES"/"MEN" = men, "MUJERES"/"WOMEN" = women.
11. Count totals: mainDrawTeams + qualifyingTeams = totalTeams.

Return ONLY valid JSON matching this exact schema (no markdown, no explanation):
{
  "teams": [
    {
      "position": 1,
      "drawType": "main",
      "isWildCard": false,
      "teamPoints": 3617,
      "player1": { "name": "Firstname Lastname", "country": "ARG", "ranking": 45, "points": 1800 },
      "player2": { "name": "Firstname Lastname", "country": "ARG", "ranking": 52, "points": 1817 }
    }
  ],
  "metadata": {
    "category": "men",
    "tournamentName": "FIP SILVER AGUASCALIENTES",
    "lastUpdate": "6 Apr 2026",
    "totalTeams": 32,
    "mainDrawTeams": 24,
    "qualifyingTeams": 8
  }
}`

/**
 * Parse a FIP tournament draw PDF using Claude Sonnet.
 * Returns structured bracket data with round assignments.
 */
export async function parseDrawPdfWithSonnet(data: Uint8Array): Promise<SonnetDrawResult> {
  const client = createClient()
  const base64 = Buffer.from(data).toString('base64')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: [
      {
        type: 'text',
        text: DRAW_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          pdfDocument(base64),
          { type: 'text', text: 'Parse this draw PDF.' },
        ],
      },
    ],
  })

  // Log cache usage for cost monitoring
  const usage = response.usage as any
  if (usage?.cache_creation_input_tokens || usage?.cache_read_input_tokens) {
    console.log(`[parseDrawPdfWithSonnet] cache: created=${usage.cache_creation_input_tokens ?? 0}, read=${usage.cache_read_input_tokens ?? 0}, input=${usage.input_tokens}, output=${usage.output_tokens}`)
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  // Extract JSON from response (might be wrapped in ```json ... ```)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Sonnet did not return valid JSON for draw parsing')
  }

  const parsed = JSON.parse(jsonMatch[0]) as SonnetDrawResult
  return parsed
}

/**
 * Parse a FIP tournament entry list PDF using Claude Sonnet.
 * Returns structured team/player data with rankings.
 */
export async function parseEntryListPdfWithSonnet(data: Uint8Array): Promise<SonnetEntryListResult> {
  const client = createClient()
  const base64 = Buffer.from(data).toString('base64')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    system: [
      {
        type: 'text',
        text: ENTRY_LIST_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          pdfDocument(base64),
          { type: 'text', text: 'Parse this entry list PDF.' },
        ],
      },
    ],
  })

  // Log cache usage for cost monitoring
  const usage = response.usage as any
  if (usage?.cache_creation_input_tokens || usage?.cache_read_input_tokens) {
    console.log(`[parseEntryListPdfWithSonnet] cache: created=${usage.cache_creation_input_tokens ?? 0}, read=${usage.cache_read_input_tokens ?? 0}, input=${usage.input_tokens}, output=${usage.output_tokens}`)
  }

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('Sonnet did not return valid JSON for entry list parsing')
  }

  const parsed = JSON.parse(jsonMatch[0]) as SonnetEntryListResult
  return parsed
}
