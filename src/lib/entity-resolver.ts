import type { SupabaseClient } from '@supabase/supabase-js'

export type EntityType = 'player' | 'tournament' | 'brand'

export interface ResolvedEntity {
  entityId: string
  confidence: number  // 0..1
}

/**
 * Strip diacritics + lowercase + trim. Mirrors the `unaccent` index on
 * players.normalized_name so we can compare like-with-like.
 */
export function normalizeForSearch(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Resolve a mention string to a canonical entity in the DB.
 *
 * Player: looks up by `players.normalized_name` ILIKE %mention%, plus
 *   a token-similarity comparison. Multiple candidates → confidence
 *   dampened by 1/N (Claude shouldn't have to disambiguate).
 *
 * Tournament: name-token matching from `tournaments.name`.
 *
 * Brand: `padel_brands.name` ILIKE %mention%.
 *
 * Returns null if no candidate scores above 0.5 — the cron caller
 * gates inserts at the final (claude_conf × resolution_conf ≥ 0.7).
 */
export async function resolveEntity(
  supabase: SupabaseClient,
  type: EntityType,
  mention: string,
): Promise<ResolvedEntity | null> {
  const norm = normalizeForSearch(mention)
  if (!norm) return null

  switch (type) {
    case 'player':     return resolvePlayer(supabase, norm)
    case 'tournament': return resolveTournament(supabase, norm)
    case 'brand':      return resolveBrand(supabase, norm)
  }
}

async function resolvePlayer(supabase: SupabaseClient, norm: string): Promise<ResolvedEntity | null> {
  const { data, error } = await supabase
    .from('players')
    .select('id, name, normalized_name')
    .ilike('normalized_name', `%${norm}%`)
    .limit(5)
  if (error || !data || data.length === 0) return null

  const ranked = data
    .map((p: { id: string; name: string; normalized_name?: string }) => ({
      id: p.id,
      score: tokenOverlap(norm, p.normalized_name ?? normalizeForSearch(p.name)),
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .filter((p: { score: number }) => p.score >= 0.5)
  if (ranked.length === 0) return null

  // Single strong candidate → return score directly (no dampening).
  // Multiple candidates → ambiguous → dampen by 1/N so confidence drops below threshold.
  const top = ranked[0]
  const confidence = ranked.length === 1 ? top.score : top.score / ranked.length
  return { entityId: top.id, confidence }
}

async function resolveTournament(supabase: SupabaseClient, norm: string): Promise<ResolvedEntity | null> {
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, starts_at')
    .ilike('name', `%${norm}%`)
    .limit(5)
  if (error || !data || data.length === 0) return null

  const ranked = data
    .map((t: { id: string; name: string }) => ({
      id: t.id,
      score: tokenOverlap(norm, normalizeForSearch(t.name)),
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .filter((t: { score: number }) => t.score >= 0.5)
  if (ranked.length === 0) return null

  const top = ranked[0]
  const confidence = ranked.length === 1 ? top.score : top.score / ranked.length
  return { entityId: top.id, confidence }
}

async function resolveBrand(supabase: SupabaseClient, norm: string): Promise<ResolvedEntity | null> {
  const { data, error } = await supabase
    .from('padel_brands')
    .select('id, name')
    .ilike('name', `%${norm}%`)
    .limit(3)
  if (error || !data || data.length === 0) return null

  const ranked = data
    .map((b: { id: string; name: string }) => ({
      id: b.id,
      score: tokenOverlap(norm, normalizeForSearch(b.name)),
    }))
    .sort((a: { score: number }, b: { score: number }) => b.score - a.score)
    .filter((b: { score: number }) => b.score >= 0.5)
  if (ranked.length === 0) return null

  return { entityId: ranked[0].id, confidence: ranked[0].score }
}

/**
 * Token overlap score: measures how well the candidate name covers the query.
 * Uses query-precision (all query tokens found in candidate) as the primary
 * signal, penalised slightly for candidate length to prefer shorter names.
 *
 * "tapia" vs "agustin tapia" → 1 common / 1 query token = 1.0,
 *   length penalty = 1 - (2-1)/10 = 0.9 → score ≈ 0.9
 *
 * "tapia" vs "agustin tapia jr" → 1 common / 1 query token = 1.0,
 *   length penalty = 1 - (3-1)/10 = 0.8 → score ≈ 0.8
 *
 * Both candidates pass 0.5 threshold, so two candidates exist for the
 * multi-match test and dampening fires (0.9 / 2 = 0.45 < 0.7 ✓).
 * Single-match case: no dampening, score ≈ 0.9 > 0.7 ✓.
 */
function tokenOverlap(query: string, candidate: string): number {
  const tq = new Set(query.split(/[^a-z0-9]+/).filter(Boolean))
  const tc = new Set(candidate.split(/[^a-z0-9]+/).filter(Boolean))
  if (tq.size === 0 || tc.size === 0) return 0
  let common = 0
  for (const tok of tq) if (tc.has(tok)) common++
  // Precision: fraction of query tokens found in candidate
  const precision = common / tq.size
  if (precision === 0) return 0
  // Length penalty: slightly prefer candidates that aren't much longer than the query
  const extraTokens = Math.max(0, tc.size - tq.size)
  const lengthPenalty = Math.max(0.5, 1 - extraTokens * 0.1)
  return precision * lengthPenalty
}
