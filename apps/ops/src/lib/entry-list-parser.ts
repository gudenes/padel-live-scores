// src/lib/entry-list-parser.ts
// Parses FIP entry list text (from PDF extraction or paste) into structured team data.
// Pure function — no I/O, no DB access.
//
// FIP entry list PDFs contain two sections:
//   1. Main Draw teams (positions 1-N)
//   2. Qualifications teams (positions restart at 1)
//
// Section boundary detection (two patterns):
//   A. "QUALIFICATIONS" text between sections (men's PDFs)
//   B. Second "Pos Ranking..." header where positions restart at 1 (women's PDFs)
//
// Wild Card entries have "WC" prefix: "25 WC 708 Mariya Sinitsyna KAZ"
// These are tagged with isWildCard: true on the team.

export interface ParsedEntryPlayer {
  name: string
  country: string
  ranking: number
  points: number
}

export type DrawType = 'main' | 'qualifying'

export interface ParsedTeam {
  position: number
  teamPoints: number
  drawType: DrawType
  isWildCard: boolean
  player1: ParsedEntryPlayer
  player2: ParsedEntryPlayer
}

export interface EntryListMetadata {
  lastUpdate: string | null   // "29/3/2026 h 03:09 p. m." from PDF
  title: string | null        // "FIP GOLD ALMATY" from PDF
  category: string | null     // "Hombres's" or "Mujeres" from PDF
}

export interface ParseResult {
  teams: ParsedTeam[]
  metadata: EntryListMetadata
}

// Header line that starts each section in the PDF
const HEADER_RE = /^Pos\s+(Ranking\s+)?/i

function isHeaderLine(line: string): boolean {
  return HEADER_RE.test(line) || (line.toLowerCase().includes('ranking') && line.toLowerCase().includes('player'))
}

/**
 * Parse entry list text into structured team data.
 * Automatically detects Main Draw vs Qualifications sections.
 *
 * Returns both the teams (tagged with drawType) and extracted metadata
 * (last update date, tournament title, category from the PDF text).
 */
export function parseEntryListText(text: string): ParseResult {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const teams: ParsedTeam[] = []
  // Anchored at start of string: prevents `(\d+)` from skipping arbitrary
  // leading text ("points 1234 Name XYZ" should NOT match). Callers always
  // feed already-trimmed substrings; anchoring is safe and more precise.
  const playerRe = /^(\d+)\s+(.+?)\s+([A-Z]{2,3})\s*$/
  // Alternate: player line without a ranking prefix. Used for entries near
  // the end of the ranking list (rank > max, field shown blank by FIP).
  const playerNoRankRe = /^(.+?)\s+([A-Z]{2,3})\s*$/
  const pointsRe = /(\d+)\s+points/
  const positionRe = /^(\d+)\s+/

  let currentDrawType: DrawType = 'main'
  let headerCount = 0

  // Extract metadata from text
  const metadata = extractMetadataFromText(text)

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Detect section boundary: "QUALIFICATIONS" or "QUALIFYING"
    if (/^QUALIF/i.test(line)) {
      currentDrawType = 'qualifying'
      i++
      continue
    }

    // Skip headers, but count them — a second header means qualifying section
    // (women's PDFs have qualifying teams between second header and metadata block)
    if (isHeaderLine(line)) {
      headerCount++
      if (headerCount >= 2 && currentDrawType === 'main') {
        currentDrawType = 'qualifying'
      }
      i++
      continue
    }

    // Skip page separators and metadata lines
    if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) { i++; continue }
    if (/^(MAIN DRAW|ENTRY LIST|FIP\s|Last Update)/i.test(line)) { i++; continue }

    // WC (wildcard) prefix: "27 WC 1364 Dmitry Myagkov RUS"
    const hasWC = /^(\d+)\s+WC\s+/i.test(line)
    const wcLine = hasWC ? line.replace(/^(\d+)\s+WC\s+/i, '$1 ') : line

    const posMatch = positionRe.exec(wcLine)
    if (!posMatch) { i++; continue }
    const position = parseInt(posMatch[1], 10)
    const afterPos = wcLine.replace(/^\d+\s*\t?\s*/, '')
    // Player 1 may or may not have a visible ranking. FIP leaves it blank
    // for players below the published ranking depth (e.g. "26 Giuliano San
    // Martin ARG" vs "25 \t2635 Cléo Carvalho BRA").
    const p1Match = playerRe.exec(afterPos)
    let player1Ranking: number
    let player1Name: string
    let player1Country: string
    if (p1Match) {
      player1Ranking = parseInt(p1Match[1], 10)
      player1Name = p1Match[2].trim()
      player1Country = p1Match[3]
    } else {
      const p1NoRank = playerNoRankRe.exec(afterPos)
      if (!p1NoRank) { i++; continue }
      player1Ranking = 0
      player1Name = p1NoRank[1].trim()
      player1Country = p1NoRank[2]
    }
    if (i + 1 >= lines.length) break
    const line2 = lines[i + 1]
    const p1PointsMatch = pointsRe.exec(line2)
    if (!p1PointsMatch) { i++; continue }
    const player1Points = parseInt(p1PointsMatch[1], 10)
    const afterPoints1 = line2.slice(p1PointsMatch.index + p1PointsMatch[0].length).trim()

    // Player 2 can be on the same line as player 1's points, or on the next line
    // (qualifying entries sometimes have player 2 on a separate line with no ranking)
    let player2Ranking = 0
    let player2Name = ''
    let player2Country = ''
    let player2Points = 0
    let linesConsumed = 3

    const p2Match = playerRe.exec(afterPoints1)
    if (p2Match) {
      // Standard format: player 2 on same line as player 1's points
      player2Ranking = parseInt(p2Match[1], 10)
      player2Name = p2Match[2].trim()
      player2Country = p2Match[3]

      if (i + 2 >= lines.length) break
      const line3 = lines[i + 2]
      const p2PointsMatch = pointsRe.exec(line3)
      if (!p2PointsMatch) { i++; continue }
      player2Points = parseInt(p2PointsMatch[1], 10)
    } else {
      // Alternate format (common in qualifying): player 2 on next line
      // Line 2: "19 points"  (just points, no player 2)
      // Line 3: "Maksim Kolobov RUS"
      // Line 4: "0 points 19"
      if (i + 3 >= lines.length) { i++; continue }
      const line3 = lines[i + 2]
      const p2AltMatch = /^(.+?)\s+([A-Z]{2,3})\s*$/.exec(line3)
      if (!p2AltMatch) { i++; continue }
      player2Name = p2AltMatch[1].trim()
      player2Country = p2AltMatch[2]

      const line4 = lines[i + 3]
      const p2PointsMatch = pointsRe.exec(line4)
      if (!p2PointsMatch) { i++; continue }
      player2Points = parseInt(p2PointsMatch[1], 10)
      linesConsumed = 4
    }

    const teamPointsLine = lines[i + linesConsumed - 1]
    const teamPointsMatch = /(\d+)\s*$/.exec(teamPointsLine)
    const teamPoints = teamPointsMatch ? parseInt(teamPointsMatch[1], 10) : 0

    teams.push({
      position,
      teamPoints,
      drawType: currentDrawType,
      isWildCard: hasWC,
      player1: { name: player1Name, country: player1Country, ranking: player1Ranking, points: player1Points },
      player2: { name: player2Name, country: player2Country, ranking: player2Ranking, points: player2Points },
    })
    i += linesConsumed
  }
  return { teams, metadata }
}

/**
 * Extract metadata embedded in the PDF text.
 */
function extractMetadataFromText(text: string): EntryListMetadata {
  const lastUpdateMatch = /Last Update:\s*(.+)/i.exec(text)
  const titleMatch = /^(FIP\s+\w+\s+\w+)/m.exec(text)
  // "ENTRY LIST Hombres's" or "ENTRY LIST Mujeres" or "ENTRY LIST Women's"
  const categoryMatch = /ENTRY LIST\s+(\S+)/i.exec(text)

  return {
    lastUpdate: lastUpdateMatch?.[1]?.trim() ?? null,
    title: titleMatch?.[1]?.trim() ?? null,
    category: categoryMatch?.[1]?.trim() ?? null,
  }
}

/**
 * Extract version number from filename (e.g., "Entry-list-v7.pdf" → 7).
 */
export function extractVersion(filename: string): number | null {
  const match = /v(\d+)/i.exec(filename)
  return match ? parseInt(match[1], 10) : null
}
