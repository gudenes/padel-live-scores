// src/lib/fip-stream-title-parser.ts
//
// Pure title parser for FIP YouTube livestream titles.
// Maps a raw video title to (tier, day, court, tournamentTokens) so
// downstream code can match it against an active tournament. Returns
// nullable fields rather than throwing — the cron decides the
// `unresolved` reason based on which fields are null.
//
// Test fixtures live in src/lib/__tests__/fip-stream-title-parser.test.ts

export type FipTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'promises'

export interface ParsedFipTitle {
  tier: FipTier | null
  day: number | null
  court: string | null
  tournamentTokens: string[]
  rawTitle: string
}

const TIER_RE = /\b(bronze|silver|gold|platinum|promises)\b/i
const DAY_RE = /\b(?:DAY|D[ÍI]A|D)[\s_-]*(\d+)\b/i
// Court matcher: anchor on COURT|PISTA|CENTRE|CENTRAL|CENTER, then capture
// up to the next pipe / dash / end-of-string.
const COURT_RE = /\b((?:CENTRE|CENTRAL|CENTER|COURT|PISTA)[\w\s\d]{0,30}?)(?=[|\-–]|$)/i

const NOISE_TOKENS = new Set([
  'fip', 'premier', 'padel', 'tour', 'open', 'cup',
  'live', 'highlights', 'recap', 'stream', 'streaming',
  'official', 'tv', 'youtube',
])

const YEAR_RE = /^\d{4}$/

function stripDiacritics(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function tokenize(s: string): string[] {
  return stripDiacritics(s)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(t => t.length > 0)
    .filter(t => !NOISE_TOKENS.has(t))
    .filter(t => !YEAR_RE.test(t))
}

export function parseFipStreamTitle(title: string): ParsedFipTitle {
  const tierMatch = title.match(TIER_RE)
  const dayMatch = title.match(DAY_RE)
  const courtMatch = title.match(COURT_RE)

  const tier = (tierMatch?.[1]?.toLowerCase() ?? null) as FipTier | null
  const day = dayMatch ? parseInt(dayMatch[1], 10) : null
  const court = courtMatch ? courtMatch[1].trim().toLowerCase() : null

  // Strip the matched segments so they don't pollute tournament tokens.
  let remaining = title
  if (tierMatch) remaining = remaining.replace(tierMatch[0], ' ')
  if (dayMatch) remaining = remaining.replace(dayMatch[0], ' ')
  if (courtMatch) remaining = remaining.replace(courtMatch[0], ' ')

  const tournamentTokens = tokenize(remaining)

  return { tier, day, court, tournamentTokens, rawTitle: title }
}
