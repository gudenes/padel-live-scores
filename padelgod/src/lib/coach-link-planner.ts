// padelgod/src/lib/coach-link-planner.ts
//
// Pure core of the coach-linker worker. Resolution chain per raw string:
//   1. coach_aliases hit (follow merged_into)        → that coach
//   2. a non-merged coach with the same normalized name → that coach + new 'auto' alias
//   3. otherwise                                        → new 'unreviewed' coach + 'auto' alias
// Fuzzy matching is NOT here — it only produces suggestions (coach-suggestions.ts).

import { normalizeCoachName, coachTokens, slugifyCoach, uniqueSlug } from './coach-normalize.js'

export type CoachStatus = 'unreviewed' | 'verified' | 'junk' | 'merged'

export interface PlannerCoach {
  id: string
  normalized_name: string
  display_name: string
  slug: string
  status: CoachStatus
  merged_into: string | null
}

export interface PlayerCoachLink {
  player_id: string
  coach_id: string
  raw_name: string
  position: number
}

export interface PlannerInput {
  /** Every player with a non-empty coaches array, plus every player that currently has links. */
  players: { id: string; coaches: string[] }[]
  coaches: PlannerCoach[]
  aliases: { normalized_alias: string; coach_id: string }[]
  existingLinks: PlayerCoachLink[]
}

export interface NewCoach {
  id: string
  display_name: string
  normalized_name: string
  slug: string
  notes: string | null
}

export interface NewAlias {
  normalized_alias: string
  coach_id: string
  example_raw: string
  source: 'auto'
}

export interface CoachLinkPlan {
  newCoaches: NewCoach[]
  newAliases: NewAlias[]
  linksToUpsert: PlayerCoachLink[]
  linksToDelete: { player_id: string; coach_id: string }[]
  counts: { rawStrings: number; aliasHits: number }
}

export const SINGLE_TOKEN_NOTE = 'single-token name — check if junk'

export function planCoachLinks(input: PlannerInput, newId: () => string): CoachLinkPlan {
  const coachById = new Map(input.coaches.map((c) => [c.id, c]))
  const activeByName = new Map(
    input.coaches.filter((c) => c.status !== 'merged').map((c) => [c.normalized_name, c.id]),
  )
  const aliasMap = new Map(input.aliases.map((a) => [a.normalized_alias, a.coach_id]))
  const takenSlugs = new Set(input.coaches.map((c) => c.slug))

  const newCoaches: NewCoach[] = []
  const newAliases: NewAlias[] = []
  let rawStrings = 0
  let aliasHits = 0

  const follow = (id: string): string => {
    let cur = id
    for (let hops = 0; hops < 10; hops++) {
      const c = coachById.get(cur)
      if (!c || c.status !== 'merged' || !c.merged_into) return cur
      cur = c.merged_into
    }
    return cur
  }

  const resolve = (raw: string): string | null => {
    const norm = normalizeCoachName(raw)
    if (!norm) return null
    rawStrings++
    const aliased = aliasMap.get(norm)
    if (aliased) {
      aliasHits++
      return follow(aliased)
    }
    let coachId = activeByName.get(norm)
    if (!coachId) {
      coachId = newId()
      newCoaches.push({
        id: coachId,
        display_name: raw.trim().replace(/\s+/g, ' '),
        normalized_name: norm,
        slug: uniqueSlug(slugifyCoach(raw), takenSlugs),
        notes: coachTokens(norm).length < 2 ? SINGLE_TOKEN_NOTE : null,
      })
      activeByName.set(norm, coachId)
    }
    aliasMap.set(norm, coachId)
    newAliases.push({ normalized_alias: norm, coach_id: coachId, example_raw: raw.trim(), source: 'auto' })
    return coachId
  }

  const existingByKey = new Map(input.existingLinks.map((l) => [`${l.player_id}|${l.coach_id}`, l]))
  const desiredKeys = new Set<string>()
  const linksToUpsert: PlayerCoachLink[] = []

  for (const p of input.players) {
    const seen = new Set<string>()
    p.coaches.forEach((raw, position) => {
      const coachId = resolve(raw)
      if (!coachId || seen.has(coachId)) return
      seen.add(coachId)
      const key = `${p.id}|${coachId}`
      desiredKeys.add(key)
      const prev = existingByKey.get(key)
      if (!prev || prev.raw_name !== raw || prev.position !== position) {
        linksToUpsert.push({ player_id: p.id, coach_id: coachId, raw_name: raw, position })
      }
    })
  }

  const linksToDelete = input.existingLinks
    .filter((l) => !desiredKeys.has(`${l.player_id}|${l.coach_id}`))
    .map((l) => ({ player_id: l.player_id, coach_id: l.coach_id }))

  return { newCoaches, newAliases, linksToUpsert, linksToDelete, counts: { rawStrings, aliasHits } }
}
