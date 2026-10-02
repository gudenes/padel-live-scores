// padelgod/src/lib/coach-link-planner.ts
//
// Pure core of the coach-linker worker. Resolution chain per raw string:
//   1. coach_aliases hit (follow merged_into)        → that coach
//   2. a non-merged coach with the same normalized name → that coach + new 'auto' alias
//      (or a MERGED coach with that name → follow merged_into to the live coach + new 'auto' alias)
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
  counts: { rawStrings: number; aliasHits: number; unresolvable: number }
}

export const SINGLE_TOKEN_NOTE = 'single-token name — check if junk'

export function planCoachLinks(input: PlannerInput, newId: () => string): CoachLinkPlan {
  const coachById = new Map(input.coaches.map((c) => [c.id, c]))
  const activeByName = new Map(
    input.coaches.filter((c) => c.status !== 'merged').map((c) => [c.normalized_name, c.id]),
  )
  const aliasMap = new Map(input.aliases.map((a) => [a.normalized_alias, a.coach_id]))
  // Alias keys that came from the DB; used so aliasHits ignores aliases created in this run.
  const dbAliasKeys = new Set(aliasMap.keys())
  const mergedByName = new Map(
    input.coaches.filter((c) => c.status === 'merged').map((c) => [c.normalized_name, c.id]),
  )
  const takenSlugs = new Set(input.coaches.map((c) => c.slug))

  const newCoaches: NewCoach[] = []
  const newAliases: NewAlias[] = []
  const createdIds = new Set<string>() // coaches created in this run (live by definition)
  let rawStrings = 0
  let aliasHits = 0
  let unresolvable = 0

  /** Follows merged_into to a live coach; null on cycle, >10 hops, or a missing/merged end. */
  const follow = (id: string): string | null => {
    let cur = id
    for (let hops = 0; hops < 10; hops++) {
      if (createdIds.has(cur)) return cur
      const c = coachById.get(cur)
      if (!c) return null
      if (c.status !== 'merged') return cur
      if (!c.merged_into) return null
      cur = c.merged_into
    }
    return null
  }

  const addAlias = (norm: string, coachId: string, raw: string) => {
    aliasMap.set(norm, coachId)
    newAliases.push({
      normalized_alias: norm,
      coach_id: coachId,
      example_raw: raw.trim().replace(/\s+/g, ' '),
      source: 'auto',
    })
  }

  const resolve = (raw: string): string | null => {
    const norm = normalizeCoachName(raw)
    if (!norm) return null
    rawStrings++
    const aliased = aliasMap.get(norm)
    if (aliased) {
      if (dbAliasKeys.has(norm)) aliasHits++
      const target = follow(aliased)
      if (!target) unresolvable++
      return target
    }
    let coachId = activeByName.get(norm)
    if (!coachId) {
      const mergedId = mergedByName.get(norm)
      if (mergedId) {
        const target = follow(mergedId)
        if (!target) {
          unresolvable++
          return null
        }
        addAlias(norm, target, raw)
        return target
      }
      coachId = newId()
      newCoaches.push({
        id: coachId,
        display_name: raw.trim().replace(/\s+/g, ' '),
        normalized_name: norm,
        slug: uniqueSlug(slugifyCoach(raw), takenSlugs),
        notes: coachTokens(norm).length < 2 ? SINGLE_TOKEN_NOTE : null,
      })
      activeByName.set(norm, coachId)
      createdIds.add(coachId)
    }
    addAlias(norm, coachId, raw)
    return coachId
  }

  const existingByKey = new Map(input.existingLinks.map((l) => [`${l.player_id}|${l.coach_id}`, l]))
  const desiredKeys = new Set<string>()
  const linksToUpsert: PlayerCoachLink[] = []

  for (const p of input.players) {
    const seen = new Set<string>()
    // `position` is the index in the FIP list, so gaps occur when entries are skipped
    // (empty/unresolvable/duplicate); it preserves FIP ordering, not a dense rank.
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

  return { newCoaches, newAliases, linksToUpsert, linksToDelete, counts: { rawStrings, aliasHits, unresolvable } }
}
