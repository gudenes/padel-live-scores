// apps/ops/src/lib/player-duplicate-rules.ts
// Pure rule-based duplicate detection for players. No Supabase calls — caller
// supplies the full PlayerRow[] from whatever query they ran.
//
// Lifted from /api/internal/duplicate-scan/route.ts so the counts endpoint and
// the scan endpoint share one definition of "duplicate".

export interface PlayerRow {
  id: string
  name: string
  country: string | null
  ranking: number | null
  points: number | null
  category: string | null
  avatar_url: string | null
  fip_id: string | null
  external_id: string | null
}

export interface DuplicateGroup {
  reasons: string[]
  players: PlayerRow[]
  aiVerified?: boolean
  mergeGuidance?: string
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function nameTokens(name: string): { first: string; surname: string } {
  const parts = normalize(name).split(' ').filter(t => t.length > 1)
  if (parts.length === 0) return { first: '', surname: '' }
  if (parts.length === 1) return { first: parts[0], surname: '' }
  return { first: parts[0], surname: parts[parts.length - 1] }
}

/**
 * Rule-based duplicate detection.
 * Looks for clusters via 4 strategies, in this order:
 *   1. Same fip_id (definitive)
 *   2. Same external_id (definitive)
 *   3. Normalized full name + same country
 *   4. First + surname tokens + same country
 *
 * Cluster dedup: a cluster (by sorted member IDs) is only emitted once even
 * if multiple strategies find the same exact members.
 *
 * Subset overlap (v1 behavior): if strategy 1 finds {A,B,C} and strategy 3
 * finds {A,B}, BOTH clusters are emitted. The operator sees two separate
 * suggestions and picks the one that matches their merge intent. Future
 * versions may suppress subsets — pin tests when behavior changes.
 *
 * Strategy order matters only for the `reasons` label — the first strategy
 * to claim a cluster's exact member set wins the reason string.
 */
export function findRuleBasedDuplicates(players: PlayerRow[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = []
  const seen = new Set<string>()

  // 1. Group by fip_id
  const byFipId = new Map<string, PlayerRow[]>()
  for (const p of players) {
    if (!p.fip_id) continue
    const list = byFipId.get(p.fip_id) ?? []
    list.push(p)
    byFipId.set(p.fip_id, list)
  }
  for (const [fipId, list] of byFipId) {
    if (list.length < 2) continue
    const key = list.map(p => p.id).sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({ reasons: [`shared fip_id: ${fipId}`], players: list })
  }

  // 2. Group by external_id
  const byExternalId = new Map<string, PlayerRow[]>()
  for (const p of players) {
    if (!p.external_id) continue
    const list = byExternalId.get(p.external_id) ?? []
    list.push(p)
    byExternalId.set(p.external_id, list)
  }
  for (const [extId, list] of byExternalId) {
    if (list.length < 2) continue
    const key = list.map(p => p.id).sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({ reasons: [`shared external_id: ${extId}`], players: list })
  }

  // 3. Group by normalized name + country
  const byNameCountry = new Map<string, PlayerRow[]>()
  for (const p of players) {
    const norm = normalize(p.name)
    if (!norm) continue
    const key = `${norm}::${p.country ?? '__null__'}`
    const list = byNameCountry.get(key) ?? []
    list.push(p)
    byNameCountry.set(key, list)
  }
  for (const list of byNameCountry.values()) {
    if (list.length < 2) continue
    const key = list.map(p => p.id).sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    groups.push({
      reasons: [`same normalized name + country: "${normalize(list[0].name)}" / ${list[0].country ?? '?'}`],
      players: list,
    })
  }

  // 4. Group by surname + first-token + country (catches diacritic + word-order quirks)
  const byTokenCountry = new Map<string, PlayerRow[]>()
  for (const p of players) {
    const t = nameTokens(p.name)
    if (!t.first || !t.surname) continue
    const key = `${t.first}::${t.surname}::${p.country ?? '__null__'}`
    const list = byTokenCountry.get(key) ?? []
    list.push(p)
    byTokenCountry.set(key, list)
  }
  for (const list of byTokenCountry.values()) {
    if (list.length < 2) continue
    const key = list.map(p => p.id).sort().join('|')
    if (seen.has(key)) continue
    seen.add(key)
    const t = nameTokens(list[0].name)
    groups.push({
      reasons: [`first + surname tokens match: "${t.first}" / "${t.surname}" / ${list[0].country ?? '?'}`],
      players: list,
    })
  }

  return groups
}

/**
 * Count helper used by the sidebar-badge counts endpoint. Cheaper to express
 * intent than `findRuleBasedDuplicates(...).length` and slightly clearer at
 * call sites.
 */
export function countDuplicateGroups(players: PlayerRow[]): number {
  return findRuleBasedDuplicates(players).length
}
