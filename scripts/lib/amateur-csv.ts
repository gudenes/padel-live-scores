// Parsing for the amateur season import. Pure — no filesystem, no database.
//
// The operator hands over an Excel workbook; it's converted to three CSVs by
// hand before running the import. Deliberately a plain split parser: the
// source has no quoted fields or embedded commas, and adding a CSV dependency
// for a hand-run import isn't worth it.

export function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0)
  if (lines.length === 0) return []
  const header = lines[0].split(',').map(h => h.trim())
  return lines.slice(1).map(line => {
    const cells = line.split(',')
    const row: Record<string, string> = {}
    header.forEach((h, i) => { row[h] = (cells[i] ?? '').trim() })
    return row
  })
}

function num(value: string): number | null {
  if (value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function bool(value: string): boolean {
  return value.toLowerCase() === 'true'
}

export interface AmateurPlayerRow {
  name: string
  side: string | null
  homeClub: string | null
  competitionPoints: number | null
  competitionRank: number | null
  rosterRank: number | null
  gamesPlayed: number | null
  wins: number | null
  losses: number | null
}

export function parsePlayersCsv(text: string): AmateurPlayerRow[] {
  return parseCsv(text).map(r => ({
    name: r.name,
    side: r.side || null,
    homeClub: r.home_club || null,
    competitionPoints: num(r.competition_points),
    competitionRank: num(r.competition_rank),
    rosterRank: num(r.roster_rank),
    gamesPlayed: num(r.games_played),
    wins: num(r.wins),
    losses: num(r.losses),
  }))
}

export interface AmateurFixtureRow {
  code: string
  label: string
  sortOrder: number
  complete: boolean
  result: string | null
  pointsFor: number | null
  pointsAgainst: number | null
  courtsWon: number | null
  courtsLost: number | null
  opponentName: string | null
}

export function parseFixturesCsv(text: string): AmateurFixtureRow[] {
  return parseCsv(text).map(r => ({
    code: r.code,
    label: r.label,
    sortOrder: num(r.sort_order) ?? 0,
    complete: bool(r.complete),
    result: r.result || null,
    pointsFor: num(r.points_for),
    pointsAgainst: num(r.points_against),
    courtsWon: num(r.courts_won),
    courtsLost: num(r.courts_lost),
    opponentName: r.opponent_name || null,
  }))
}

export interface AmateurSlotRow {
  fixtureCode: string
  sortOrder: number
  label: string
  worth: number
  slotGroup: number
  result: string | null
  sets: number | null
  courtCount: number
  exact: boolean
  partial: boolean
  playerNames: string[]
}

export function parseSlotsCsv(text: string): AmateurSlotRow[] {
  return parseCsv(text).map(r => {
    const sortOrder = num(r.sort_order) ?? 0
    const playerNames = r.players.split('|').map(n => n.trim()).filter(Boolean)
    if (playerNames.length === 0) {
      throw new Error(`Slot ${r.fixture_code} sort_order ${sortOrder} has no players`)
    }
    const courtCount = num(r.court_count) ?? 1
    return {
      fixtureCode: r.fixture_code,
      sortOrder,
      label: r.label,
      worth: num(r.worth) ?? 0,
      slotGroup: num(r.slot_group) ?? 0,
      result: r.result || null,
      sets: num(r.sets),
      courtCount,
      // A slot spanning several courts can never pin the pairing down,
      // whatever the spreadsheet says.
      exact: bool(r.exact) && courtCount === 1,
      partial: bool(r.partial),
      playerNames,
    }
  })
}
