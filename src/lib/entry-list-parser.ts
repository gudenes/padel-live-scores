// src/lib/entry-list-parser.ts
// Parses FIP entry list text (from PDF extraction or paste) into structured team data.
// Pure function — no I/O, no DB access.

export interface ParsedEntryPlayer {
  name: string
  country: string
  ranking: number
  points: number
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

export function parseEntryListText(text: string): ParsedTeam[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const teams: ParsedTeam[] = []
  const playerRe = /(\d+)\s+(.+?)\s+([A-Z]{2,3})\s*$/
  const pointsRe = /(\d+)\s+points/
  const positionRe = /^(\d+)\s+/

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.startsWith('Pos') || (line.toLowerCase().includes('ranking') && line.toLowerCase().includes('player'))) {
      i++
      continue
    }
    const posMatch = positionRe.exec(line)
    if (!posMatch) { i++; continue }
    const position = parseInt(posMatch[1], 10)
    const afterPos = line.replace(/^\d+\s*\t?\s*/, '')
    const p1Match = playerRe.exec(afterPos)
    if (!p1Match) { i++; continue }
    const player1Ranking = parseInt(p1Match[1], 10)
    const player1Name = p1Match[2].trim()
    const player1Country = p1Match[3]
    if (i + 1 >= lines.length) break
    const line2 = lines[i + 1]
    const p1PointsMatch = pointsRe.exec(line2)
    if (!p1PointsMatch) { i++; continue }
    const player1Points = parseInt(p1PointsMatch[1], 10)
    const afterPoints1 = line2.slice(p1PointsMatch.index + p1PointsMatch[0].length).trim()
    const p2Match = playerRe.exec(afterPoints1)
    if (!p2Match) { i++; continue }
    const player2Ranking = parseInt(p2Match[1], 10)
    const player2Name = p2Match[2].trim()
    const player2Country = p2Match[3]
    if (i + 2 >= lines.length) break
    const line3 = lines[i + 2]
    const p2PointsMatch = pointsRe.exec(line3)
    if (!p2PointsMatch) { i++; continue }
    const player2Points = parseInt(p2PointsMatch[1], 10)
    const teamPointsMatch = /(\d+)\s*$/.exec(line3)
    const teamPoints = teamPointsMatch ? parseInt(teamPointsMatch[1], 10) : 0

    teams.push({
      position,
      teamPoints,
      player1: { name: player1Name, country: player1Country, ranking: player1Ranking, points: player1Points },
      player2: { name: player2Name, country: player2Country, ranking: player2Ranking, points: player2Points },
    })
    i += 3
  }
  return teams
}

export function extractVersion(filename: string): number | null {
  const match = /v(\d+)/i.exec(filename)
  return match ? parseInt(match[1], 10) : null
}
