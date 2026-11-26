import { resolveMatchRoles } from './match-roles'
import type { MatchRowForTitles } from './derive-titles'
import { levelLabel } from './tournament-labels'
import { roundCanonical, type RoundCode } from './round-canonical'

/** Provider values are data, never translation keys. */
export type PlayerRoundCode = RoundCode | 'W' | 'R128'

export function playerRoundCode(value: string | null | undefined): PlayerRoundCode | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ')
  if (normalized === 'w') return 'W'
  if (normalized === 'r128' || normalized === 'round of 128') return 'R128'
  return roundCanonical(normalized.replace(/^(semi|quarter) finals?$/, '$1final'))
}

export function playerRoundLabel(value: string | null | undefined, t: (key: string) => string): string {
  const code = playerRoundCode(value)
  return code ? t(`roundLabel.${code}`) : t('other')
}

export function playerCircuit(level: string | null | undefined): string {
  const value = level?.trim().toLowerCase() ?? ''
  if (['p1', 'p2', 'major', 'finals', 'premier_p1', 'premier_p2', 'premier_major', 'premier_finals', 'premier_mens', 'premier_womens'].includes(value)) return 'Premier Padel'
  if (['wpt_master', 'wpt_1000', 'wpt_500', 'wpt_final'].includes(value)) return 'World Padel Tour'
  if (value.startsWith('fip_')) return 'FIP'
  if (value === 'ppl' || value === 'ppl_ii') return 'PPL'
  return 'Other'
}

const DEPTH = ['Q1', 'Q2', 'Q3', 'R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F', 'W']
export function playerBestRound(matches: { round: string | null }[]): string | null {
  let best: string | null = null
  for (const match of matches) {
    const round = playerRoundCode(match.round)
    if (round && DEPTH.indexOf(round) > DEPTH.indexOf(best ?? '')) best = round
  }
  return best
}

export function playerStatsBreakdown(matches: MatchRowForTitles[], playerId: string, by: 'round' | 'circuit') {
  const groups = new Map<string, { wins: number; losses: number }>()
  for (const match of matches) {
    const roles = resolveMatchRoles(match, playerId)
    if (!roles.won && !roles.lost) continue
    const key = by === 'round' ? playerRoundCode(match.round) ?? 'Other' : playerCircuit(match.tournament?.level)
    const entry = groups.get(key) ?? { wins: 0, losses: 0 }
    if (roles.won) entry.wins++
    if (roles.lost) entry.losses++
    groups.set(key, entry)
  }
  return [...groups.entries()].sort((a, b) => b[1].wins / (b[1].wins + b[1].losses) - a[1].wins / (a[1].wins + a[1].losses))
}

/** Keep unknown provider identifiers out of the tournament subtitle. */
export function playerLevelLabel(value: string | null | undefined, t: (key: string) => string): string {
  if (!value) return ''
  const normalized = value.trim().toLowerCase()
  const label = levelLabel(normalized)
  if (label !== normalized) return label
  const circuit = playerCircuit(normalized)
  return circuit === 'Other' ? t('other') : circuit
}
