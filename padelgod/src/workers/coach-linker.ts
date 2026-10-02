// padelgod/src/workers/coach-linker.ts
//
// Maps players.coaches (raw FIP strings) onto canonical coaches.
// Spec: docs/superpowers/specs/2026-10-02-coach-normalization-design.md
//
// Writes: coaches, coach_aliases, player_coaches, coach_merge_suggestions,
// coach_player_link_suggestions. NEVER auto-merges fuzzy matches and NEVER
// sets coaches.player_id — both are operator decisions in the admin.
//
// Each write chunk is isolated: one failing chunk is counted in batchErrors
// and the rest of the run continues (lesson from the fip-draw-populator
// whole-batch abort). A failed chunk is self-healing: the next run re-plans
// from DB state.

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Logger } from 'pino'
import { paginatedSelect } from '../lib/db-paginate.js'
import { normalizeCoachName } from '../lib/coach-normalize.js'
import { planCoachLinks, type PlannerCoach, type PlayerCoachLink } from '../lib/coach-link-planner.js'
import {
  generateMergeSuggestions,
  generatePlayerLinkSuggestions,
  pairKey,
  type SuggestionCoach,
} from '../lib/coach-suggestions.js'

export interface CoachLinkerDeps {
  supabase: SupabaseClient
  logger: Logger
  dryRun: boolean
}

export interface CoachLinkerResult {
  dryRun: boolean
  playersScanned: number
  rawStrings: number
  aliasHits: number
  autoAliases: number
  coachesCreated: number
  playerLinksWritten: number
  playerLinksDeleted: number
  suggestionsCreated: number
  playerLinkSuggestionsCreated: number
  unresolvable: number
  abortedMassDelete: boolean
  batchErrors: number
}

/**
 * Guard against a bad read (e.g. truncated players page) wiping the coach graph.
 * True when the plan would delete more than half of >100 existing links.
 */
export function isMassDelete(deleteCount: number, existingCount: number): boolean {
  return existingCount > 100 && deleteCount > existingCount * 0.5
}

const CHUNK = 200
const PAGE = 1000

function chunks<T>(rows: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

export async function runCoachLinker(deps: CoachLinkerDeps): Promise<CoachLinkerResult> {
  const { supabase, logger, dryRun } = deps
  const log = logger

  const rawPlayers = await paginatedSelect<{ id: string; name: string; coaches: string[] | null }>(
    (s, e) => supabase.from('players').select('id, name, coaches').order('id').range(s, e),
    { what: 'players (coach-linker)', pageSize: PAGE },
  )
  // Offset paging can return a boundary row twice if rows are inserted mid-read;
  // dedupe by id. (A player deleted mid-read just has its links re-added next run.)
  const players = [...new Map(rawPlayers.map((p) => [p.id, p])).values()]
  const coaches = await paginatedSelect<PlannerCoach & { player_id: string | null }>(
    (s, e) => supabase.from('coaches').select('id, normalized_name, display_name, slug, status, merged_into, player_id').order('id').range(s, e),
    { what: 'coaches', pageSize: PAGE },
  )
  const aliases = await paginatedSelect<{ normalized_alias: string; coach_id: string }>(
    (s, e) => supabase.from('coach_aliases').select('normalized_alias, coach_id').order('normalized_alias').range(s, e),
    { what: 'coach_aliases', pageSize: PAGE },
  )
  const existingLinks = await paginatedSelect<PlayerCoachLink>(
    (s, e) => supabase.from('player_coaches').select('player_id, coach_id, raw_name, position').order('player_id').order('coach_id').range(s, e),
    { what: 'player_coaches', pageSize: PAGE },
  )
  const mergeRows = await paginatedSelect<{ coach_a: string; coach_b: string }>(
    (s, e) => supabase.from('coach_merge_suggestions').select('coach_a, coach_b').order('id').range(s, e),
    { what: 'coach_merge_suggestions', pageSize: PAGE },
  )
  const linkRows = await paginatedSelect<{ coach_id: string; player_id: string }>(
    (s, e) => supabase.from('coach_player_link_suggestions').select('coach_id, player_id').order('coach_id').order('player_id').range(s, e),
    { what: 'coach_player_link_suggestions', pageSize: PAGE },
  )

  const playersWithLinks = new Set(existingLinks.map((l) => l.player_id))
  // The planner assumes unique player ids (deduped above).
  const plannerPlayers = players
    .filter((p) => (p.coaches?.length ?? 0) > 0 || playersWithLinks.has(p.id))
    .map((p) => ({ id: p.id, coaches: p.coaches ?? [] }))

  const plan = planCoachLinks({ players: plannerPlayers, coaches, aliases, existingLinks }, randomUUID)

  // Suggestions run over the post-plan coach set.
  const allCoaches: SuggestionCoach[] = [
    ...coaches.map((c) => ({ id: c.id, normalized_name: c.normalized_name, status: c.status, player_id: c.player_id })),
    ...plan.newCoaches.map((c) => ({ id: c.id, normalized_name: c.normalized_name, status: 'unreviewed' as const, player_id: null })),
  ]
  // Full pairwise pass every run (~2.7s for ~860 coaches) so suggestions stay
  // correct after merges / status changes.
  const mergeSuggestions = generateMergeSuggestions(
    allCoaches,
    new Set(mergeRows.map((r) => pairKey(r.coach_a, r.coach_b))),
  )
  const linkSuggestions = generatePlayerLinkSuggestions(
    allCoaches,
    players.map((p) => ({ id: p.id, normalized_name: normalizeCoachName(p.name ?? '') })),
    new Set(linkRows.map((r) => `${r.coach_id}|${r.player_id}`)),
    new Set(coaches.map((c) => c.player_id).filter((x): x is string => !!x)),
  )

  const result: CoachLinkerResult = {
    dryRun,
    playersScanned: plannerPlayers.length,
    rawStrings: plan.counts.rawStrings,
    aliasHits: plan.counts.aliasHits,
    autoAliases: plan.newAliases.length,
    coachesCreated: plan.newCoaches.length,
    playerLinksWritten: plan.linksToUpsert.length,
    playerLinksDeleted: plan.linksToDelete.length,
    suggestionsCreated: mergeSuggestions.length,
    playerLinkSuggestionsCreated: linkSuggestions.length,
    unresolvable: plan.counts.unresolvable,
    abortedMassDelete: false,
    batchErrors: 0,
  }

  if (isMassDelete(plan.linksToDelete.length, existingLinks.length)) {
    result.batchErrors = 1
    result.abortedMassDelete = true
    log.error({ result, existingLinks: existingLinks.length, linksToDelete: plan.linksToDelete.length }, 'coach-linker aborted: plan would delete >50% of existing links (bad players read?)')
    return result
  }

  if (dryRun) {
    log.info({ result, sampleMerges: mergeSuggestions.slice(0, 10), sampleLinks: linkSuggestions.slice(0, 10) }, 'coach-linker dry run')
    return result
  }

  const failedCoachIds = new Set<string>()
  const write = async (what: string, rows: unknown[], op: (chunk: any[]) => PromiseLike<{ error: { message: string } | null }>, onFail?: (chunk: any[]) => void) => {
    for (const chunk of chunks(rows)) {
      const { error } = await op(chunk)
      if (error) {
        result.batchErrors++
        onFail?.(chunk)
        log.warn({ what, size: chunk.length, error: error.message }, 'coach-linker chunk failed')
      }
    }
  }

  // Order matters for FKs: coaches → aliases → links → suggestions.
  await write('coaches', plan.newCoaches, (c) => supabase.from('coaches').insert(c),
    (chunk) => chunk.forEach((c) => failedCoachIds.add(c.id)))
  // Anything referencing a coach whose insert failed would violate the FK; the next run re-plans.
  const aliasRows = plan.newAliases.filter((a) => !failedCoachIds.has(a.coach_id))
  const upsertRows = plan.linksToUpsert.filter((l) => !failedCoachIds.has(l.coach_id))
  await write('coach_aliases', aliasRows, (c) =>
    supabase.from('coach_aliases').upsert(c, { onConflict: 'normalized_alias', ignoreDuplicates: true }))
  await write('player_coaches upsert', upsertRows, (c) =>
    supabase.from('player_coaches').upsert(c, { onConflict: 'player_id,coach_id' }))

  // Deletes grouped per player: one statement per player.
  const deletesByPlayer = new Map<string, string[]>()
  for (const l of plan.linksToDelete) {
    const ids = deletesByPlayer.get(l.player_id)
    if (ids) ids.push(l.coach_id)
    else deletesByPlayer.set(l.player_id, [l.coach_id])
  }
  let deleteFailures = 0
  for (const [playerId, coachIds] of deletesByPlayer) {
    const { error } = await supabase.from('player_coaches').delete().eq('player_id', playerId).in('coach_id', coachIds)
    if (error) {
      result.batchErrors++
      deleteFailures++
      if (deleteFailures <= 5) log.warn({ playerId, coachIds, error: error.message }, 'coach-linker link delete failed')
    }
  }
  if (deleteFailures > 5) log.warn({ deleteFailures }, 'coach-linker link deletes failed (first 5 logged individually)')

  // Drop suggestions touching failed coaches, then re-read status so a merge the
  // operator performed since our read doesn't get a stale suggestion.
  let mergeOut = mergeSuggestions.filter((m) => !failedCoachIds.has(m.coach_a) && !failedCoachIds.has(m.coach_b))
  let linkOut = linkSuggestions.filter((l) => !failedCoachIds.has(l.coach_id))
  const refIds = [...new Set([...mergeOut.flatMap((m) => [m.coach_a, m.coach_b]), ...linkOut.map((l) => l.coach_id)])]
  const mergedNow = new Set<string>()
  let statusReadOk = true
  for (const ids of chunks(refIds)) {
    const { data, error } = await supabase.from('coaches').select('id, status').in('id', ids)
    if (error) {
      statusReadOk = false
      result.batchErrors++
      log.warn({ error: error.message }, 'coach-linker status re-read failed; skipping suggestions this run')
      break
    }
    for (const r of (data ?? []) as { id: string; status: string }[]) if (r.status === 'merged') mergedNow.add(r.id)
  }
  if (!statusReadOk) {
    mergeOut = []
    linkOut = []
  } else {
    mergeOut = mergeOut.filter((m) => !mergedNow.has(m.coach_a) && !mergedNow.has(m.coach_b))
    linkOut = linkOut.filter((l) => !mergedNow.has(l.coach_id))
  }
  await write('coach_merge_suggestions', mergeOut, (c) =>
    supabase.from('coach_merge_suggestions').upsert(c, { onConflict: 'coach_a,coach_b', ignoreDuplicates: true }))
  await write('coach_player_link_suggestions', linkOut, (c) =>
    supabase.from('coach_player_link_suggestions').upsert(c, { onConflict: 'coach_id,player_id', ignoreDuplicates: true }))

  return result
}
