// Pure interpretation of a scraped PPL match page.
//
// Takes the raw strings ppl-match-dom.ts lifted out of the DOM and turns them
// into a typed result. No browser, no network, no database — so every way
// this page can be misread is testable against a captured fixture.
//
// It THROWS rather than guessing. A half-parsed match that silently writes
// the wrong lineup is the worst outcome available here: it attaches a
// league match to someone else's career history, which is invisible and
// permanent. A thrown error costs one skipped match and a log line.

import type { RawMatchDom, RawPlayerCard } from './ppl-match-dom'

export interface ParsedPlayer {
  slug: string
  name: string | null
  firstServeInPct: number | null
  aces: number | null
  doubleFaults: number | null
  winners: {
    smash: number | null
    bandeja: number | null
    volley: number | null
    vibora: number | null
    ground: number | null
    lob: number | null
    other: number | null
  }
}

export interface ParsedPair {
  /**
   * Which scoreboard row this pair is, 0 or 1. `ParsedSet.row0`/`row1` are
   * indexed the same way, so the caller can orient scores to pairs without
   * assuming an order.
   */
  rowIndex: 0 | 1
  /** Upstream franchise name, verbatim. The caller maps it onto a team_season. */
  team: string | null
  won: boolean
  players: ParsedPlayer[]
}

export interface ParsedSet {
  setNumber: number
  /**
   * Games for the FIRST scoreboard row and the SECOND, in page order.
   *
   * Deliberately NOT called home/away. The first version used those names,
   * and the caller reasonably read "home" as the tie's home franchise while
   * this file meant "the top row of the scoreboard". Those two disagree on
   * most matches, which silently reversed every set score written on
   * 2026-09-23. The names now say only what they are; orienting them to a
   * pair is the caller's job, via ParsedPair.rowIndex.
   */
  row0: number
  row1: number
}

export interface PctPair {
  /** Same row ordering as ParsedSet — first scoreboard row, then second. */
  row0: number | null
  row1: number | null
}

export interface ParsedMatchStats {
  pointsWonPct: PctPair
  servesWonPct: PctPair
  breakPointsConvertedPct: PctPair
  goldenPointsWonPct: PctPair
  longRalliesWonPct: PctPair
}

export interface PplMatchResult {
  url: string
  isFinal: boolean
  durationSeconds: number | null
  /** In scoreboard row order; each carries its own `rowIndex`. */
  pairs: ParsedPair[]
  sets: ParsedSet[]
  stats: ParsedMatchStats
}

function fail(raw: RawMatchDom, why: string): never {
  throw new Error(`parseMatchDom(${raw.url}): ${why}`)
}

/** Case, accent and punctuation insensitive, for comparing franchise names. */
function normTeam(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Reads the value that follows a label in the card's pipe-joined text:
 *   ...|SERVE|1ST IN|97%|ACES|0|DF|0|POINTS|SMASH|11|...
 * Percentages lose the `%`. Returns null when the label is absent, which is
 * normal — a card can omit a shot type.
 */
function valueAfter(parts: string[], label: string): number | null {
  const want = label.toUpperCase()
  for (let i = 0; i < parts.length - 1; i++) {
    if (parts[i].trim().toUpperCase() !== want) continue
    const raw = parts[i + 1].trim().replace('%', '')
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function parsePlayerCard(raw: RawMatchDom, card: RawPlayerCard): ParsedPlayer & { team: string } {
  // The slug is the whole point of this card — it is what lets a player
  // resolve by id instead of by name. Refuse to continue without one.
  if (!card.slug) fail(raw, `player card has no slug (text: ${String(card.text).slice(0, 80)})`)

  const parts = (card.text ?? '').split('|')
  // `team` / `name` come from dedicated elements when present; the pipe-split
  // text is the fallback, because those two sub-selectors are the least
  // certain part of the extraction.
  const team = card.team ?? parts[0] ?? ''
  if (!normTeam(team)) fail(raw, `player card ${card.slug} has no team`)

  return {
    team,
    slug: card.slug,
    name: card.name ?? parts[1] ?? null,
    firstServeInPct: valueAfter(parts, '1ST IN'),
    aces: valueAfter(parts, 'ACES'),
    doubleFaults: valueAfter(parts, 'DF'),
    winners: {
      smash: valueAfter(parts, 'SMASH'),
      bandeja: valueAfter(parts, 'BANDEJA'),
      volley: valueAfter(parts, 'VOLLEY'),
      vibora: valueAfter(parts, 'VIBORA'),
      ground: valueAfter(parts, 'GROUND'),
      lob: valueAfter(parts, 'LOB'),
      other: valueAfter(parts, 'OTHER'),
    },
  }
}

/** `HH:MM:SS` -> seconds. Null when absent or malformed. */
function parseDuration(v: string | null): number | null {
  if (!v) return null
  const m = v.trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

const STAT_LABELS: Array<[keyof ParsedMatchStats, string]> = [
  ['pointsWonPct', 'POINTS WON'],
  ['servesWonPct', 'SERVES WON'],
  ['breakPointsConvertedPct', 'BREAK PTS CONVERTED'],
  ['goldenPointsWonPct', 'GOLDEN POINTS WON'],
  ['longRalliesWonPct', 'LONG RALLIES WON'],
]

/** Each stat row is `43%|POINTS WON|57%`. */
function parseStats(rows: string[]): ParsedMatchStats {
  const out = {} as ParsedMatchStats
  for (const [key, label] of STAT_LABELS) out[key] = { row0: null, row1: null }
  for (const row of rows) {
    const parts = row.split('|').map((x) => x.trim())
    if (parts.length < 3) continue
    const label = parts[1].toUpperCase()
    const hit = STAT_LABELS.find(([, l]) => l === label)
    if (!hit) continue
    const num = (v: string) => {
      const n = Number(v.replace('%', ''))
      return Number.isFinite(n) ? n : null
    }
    out[hit[0]] = { row0: num(parts[0]), row1: num(parts[2]) }
  }
  return out
}

export function parseMatchDom(raw: RawMatchDom): PplMatchResult {
  if (raw.scoreRows.length !== 2) {
    fail(raw, `expected exactly 2 score rows, got ${raw.scoreRows.length}`)
  }
  if (raw.scoreRows.filter((r) => r.winner).length !== 1) {
    fail(raw, 'expected exactly one winning score row')
  }

  const cards = raw.playerCards.map((c) => parsePlayerCard(raw, c))

  const pairs: ParsedPair[] = raw.scoreRows.map((row, rowIndex) => {
    const key = normTeam(row.team)
    if (!key) fail(raw, 'score row has no team name')
    return {
      rowIndex: rowIndex as 0 | 1,
      team: row.team,
      won: row.winner,
      players: cards.filter((c) => normTeam(c.team) === key).map(({ team: _t, ...p }) => p),
    }
  })

  // A card whose team matches neither score row would silently vanish above.
  for (const c of cards) {
    if (!pairs.some((p) => normTeam(p.team) === normTeam(c.team))) {
      fail(raw, `player ${c.slug} belongs to "${c.team}", which is neither pair`)
    }
  }

  // The last cell is the W/L marker, not a set. Trusting cell COUNT instead of
  // the `game` flag would read "W" as a set score.
  //
  // A two-set match still renders a third column, filled with an em dash
  // placeholder on BOTH rows so the table keeps its shape. Those are dropped
  // by position, not by value, and only when both rows agree the column is
  // empty — a dash on one side and a number on the other is a real anomaly
  // and must still fail loudly.
  const rawSetCells = raw.scoreRows.map((r) => r.cells.filter((c) => !c.game))
  const isBlank = (v: string) => v === '' || /^[-\u2012-\u2015\u2212]+$/.test(v.trim())
  const columns = Math.min(rawSetCells[0].length, rawSetCells[1].length)
  const keep: number[] = []
  for (let i = 0; i < columns; i++) {
    const a = rawSetCells[0][i].v
    const b = rawSetCells[1][i].v
    if (isBlank(a) && isBlank(b)) continue
    keep.push(i)
  }
  const setCells = rawSetCells.map((cells) => keep.map((i) => cells[i]))
  if (setCells[0].length === 0) fail(raw, 'no played sets on the scoreboard')
  if (setCells[0].length !== setCells[1].length) {
    fail(raw, `score rows disagree on set count: ${setCells[0].length} vs ${setCells[1].length}`)
  }

  const sets: ParsedSet[] = setCells[0].map((cell, i) => {
    const row0 = Number(cell.v)
    const row1 = Number(setCells[1][i].v)
    if (!Number.isFinite(row0) || !Number.isFinite(row1)) {
      fail(raw, `set ${i + 1} has a non-numeric score: "${cell.v}" / "${setCells[1][i].v}"`)
    }
    return { setNumber: i + 1, row0, row1 }
  })

  return {
    url: raw.url,
    isFinal: /final/i.test(raw.finalLabel ?? ''),
    durationSeconds: parseDuration(raw.duration),
    pairs,
    sets,
    stats: parseStats(raw.statRows),
  }
}
