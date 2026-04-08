// src/app/api/cron/premier-discovery/route.ts
//
// Links Premier Padel tournaments and matches to our DB via entity_external_ids.
// Day 1: triggered manually via curl. Day 2+: scheduled weekly via Vercel.
//
// Tournament matching: token-subset on name + year from starts_at (via
// src/lib/source-matcher). Unresolved entities are written to
// match_stats_unresolved for manual SQL review.
//
// Match matching: player last-name overlap within linked tournament
// (implemented in Task 14, added to this same file).

import { createClient } from '@supabase/supabase-js'
import {
  fetchPremierTournamentDropdown,
  fetchPremierUpcomingMatches,
  withThrottle,
  type PremierUpcomingMatch,
} from '@/lib/premier-api'
import {
  resolveSingleCandidate,
  yearOf,
  normalizeRound,
  extractCategoryFromPremierRound,
  type CandidateTournament,
} from '@/lib/source-matcher'
import { findEntityBySourceId, registerSourceId } from '@/lib/external-id-registry'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

// Tiers we care about for Premier stats: Premier Tour + FIP Platinum/Gold.
// We deliberately exclude fip_silver/fip_bronze/fip_other because Premier's
// API doesn't cover those events in a useful way.
const IN_SCOPE_LEVELS = ['p1', 'p2', 'major', 'finals', 'fip_platinum', 'fip_gold']

// Only 2026+ tournaments are in scope for the pre-launch backfill.
const MIN_YEAR = 2026

// ── Last-name extraction ─────────────────────────────────────

function lastNameOf(full: string | null | undefined): string {
  if (!full) return ''
  const norm = full.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const parts = norm.trim().split(/\s+/)
  return parts[parts.length - 1] ?? ''
}

// ── Our match row type ───────────────────────────────────────

interface OurMatchRow {
  id: string
  round: string | null
  category: string | null
  pair1_player1: { name: string | null } | null
  pair1_player2: { name: string | null } | null
  pair2_player1: { name: string | null } | null
  pair2_player2: { name: string | null } | null
}

// ── Match-level player-name matcher ──────────────────────────

/**
 * Score a Premier match against a candidate by counting how many of the
 * 4 last names overlap, filtered by matching (category, round) after
 * normalizing both sides through normalizeRound.
 * Returns the best candidate + its score (0-4).
 */
function matchPremierMatchToOurs(
  pm: PremierUpcomingMatch,
  candidates: OurMatchRow[],
): { matched: OurMatchRow | null; score: number } {
  const premierNames = new Set(
    [
      lastNameOf(pm.team1_player_name),
      lastNameOf(pm.team1_partner_name),
      lastNameOf(pm.team2_player_name),
      lastNameOf(pm.team2_partner_player_name),
    ].filter(Boolean),
  )

  if (premierNames.size === 0) return { matched: null, score: 0 }

  // Premier's round_name is like "Men SF"; split into category + canonical round
  const pmCategory = extractCategoryFromPremierRound(pm.round_name)
  const pmCanonicalRound = normalizeRound(pm.round_name)

  let best: OurMatchRow | null = null
  let bestScore = 0

  for (const c of candidates) {
    // Category filter: if both known, they must match
    if (pmCategory && c.category && c.category !== pmCategory) continue

    // Round filter: normalize our DB side to canonical form too
    if (pmCanonicalRound && c.round) {
      const ourCanonicalRound = normalizeRound(c.round)
      if (ourCanonicalRound !== pmCanonicalRound) continue
    }

    const ourNames = new Set(
      [
        lastNameOf(c.pair1_player1?.name),
        lastNameOf(c.pair1_player2?.name),
        lastNameOf(c.pair2_player1?.name),
        lastNameOf(c.pair2_player2?.name),
      ].filter(Boolean),
    )
    const overlap = [...premierNames].filter(n => ourNames.has(n)).length
    if (overlap > bestScore) {
      bestScore = overlap
      best = c
    }
  }

  return { matched: best, score: bestScore }
}

// ── Match linking: iterate over linked tournaments ───────────

async function linkMatchesForLinkedTournaments(
  linkedTournamentIds: Array<{ ourId: string; premierId: number; name: string }>,
  result: {
    matches: { linked: number; already: number; unresolved: number; skipped_byes: number }
    by_reason: { no_candidate: number; multiple_candidates: number; no_player_match: number }
  },
): Promise<void> {
  for (const { ourId, premierId, name } of linkedTournamentIds) {
    // Pull our matches for this tournament with player names joined
    const { data: ourMatches } = await supabase
      .from('matches')
      .select(`
        id, round, category,
        pair1_player1:players!matches_pair1_player1_id_fkey(name),
        pair1_player2:players!matches_pair1_player2_id_fkey(name),
        pair2_player1:players!matches_pair2_player1_id_fkey(name),
        pair2_player2:players!matches_pair2_player2_id_fkey(name)
      `)
      .eq('tournament_id', ourId)

    if (!ourMatches?.length) {
      console.log(`[premier-discovery] no matches in our DB for ${name}`)
      continue
    }

    // Fetch Premier's match list for this tournament (throttled)
    let premierMatches: PremierUpcomingMatch[]
    try {
      premierMatches = await withThrottle(() => fetchPremierUpcomingMatches(premierId))
    } catch (err) {
      console.error(`[premier-discovery] fetchPremierUpcomingMatches(${premierId}) failed:`, err)
      continue
    }

    for (const pm of premierMatches) {
      // Skip byes — no stats to collect
      if (pm.is_bye === 'Yes') {
        result.matches.skipped_byes++
        continue
      }

      // Skip if already linked
      const existing = await findEntityBySourceId(
        supabase,
        'match',
        'premierpadel',
        String(pm.tournaments_match_id),
      )
      if (existing) {
        result.matches.already++
        continue
      }

      const { matched, score } = matchPremierMatchToOurs(
        pm,
        ourMatches as unknown as OurMatchRow[],
      )

      if (matched && score >= 3) {
        await registerSourceId(supabase, {
          entityType: 'match',
          entityId: matched.id,
          source: 'premierpadel',
          externalId: String(pm.tournaments_match_id),
          metadata: {
            draw_type: pm.draw_type,
            round_name: pm.round_name,
            matchId: pm.tournaments_match_id,
          },
        })
        result.matches.linked++
      } else {
        await supabase.from('match_stats_unresolved').upsert({
          source: 'premierpadel',
          source_kind: 'match',
          source_id: String(pm.tournaments_match_id),
          source_payload: pm as unknown as Record<string, unknown>,
          candidate_count: ourMatches.length,
          reason: 'no_player_match',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'source,source_kind,source_id' })
        result.matches.unresolved++
        result.by_reason.no_player_match++
      }
    }
  }
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startedAt = Date.now()
  const result = {
    ok: true,
    tournaments: { linked: 0, already: 0, unresolved: 0 },
    matches: { linked: 0, already: 0, unresolved: 0, skipped_byes: 0 },
    by_reason: { no_candidate: 0, multiple_candidates: 0, no_player_match: 0 },
  }

  // Step 1: Fetch Premier's tournament dropdown (75 entries minus the "All" meta)
  const premiers = await fetchPremierTournamentDropdown('en')
  console.log(`[premier-discovery] fetched ${premiers.length} Premier tournaments`)

  // Step 2: Pre-fetch all our in-scope tournaments
  const { data: ours } = await supabase
    .from('tournaments')
    .select('id, name, level, source, starts_at')
    .in('level', IN_SCOPE_LEVELS)

  const candidates: CandidateTournament[] = (ours ?? []).map(t => ({
    id: t.id as string,
    name: t.name as string,
    starts_at: t.starts_at as string | null,
  }))
  console.log(`[premier-discovery] candidates: ${candidates.length} of our tournaments`)

  // Step 3: Link tournaments (this task's main body)
  const linkedTournamentIds: Array<{ ourId: string; premierId: number; name: string }> = []
  for (const p of premiers) {
    // Only consider tournaments with either no date (fallback to year-less match)
    // OR a start date in MIN_YEAR+
    const premierYear = yearOf(p.accommodation_start_date)
    if (premierYear !== null && premierYear < MIN_YEAR) continue

    // Skip if already linked
    const existing = await findEntityBySourceId(
      supabase,
      'tournament',
      'premierpadel',
      String(p.tournaments_id),
    )
    if (existing) {
      result.tournaments.already++
      linkedTournamentIds.push({ ourId: existing, premierId: p.tournaments_id, name: p.full_name })
      continue
    }

    // Resolve candidate via token-subset match + year filter
    const resolve = resolveSingleCandidate(
      { name: p.full_name, year: premierYear },
      candidates,
    )

    if (resolve.match) {
      await registerSourceId(supabase, {
        entityType: 'tournament',
        entityId: resolve.match.id,
        source: 'premierpadel',
        externalId: String(p.tournaments_id),
        metadata: {
          name: p.full_name,
          accommodation_start_date: p.accommodation_start_date,
          accommodation_end_date: p.accommodation_end_date,
        },
      })
      result.tournaments.linked++
      linkedTournamentIds.push({
        ourId: resolve.match.id,
        premierId: p.tournaments_id,
        name: p.full_name,
      })
    } else {
      await supabase.from('match_stats_unresolved').upsert({
        source: 'premierpadel',
        source_kind: 'tournament',
        source_id: String(p.tournaments_id),
        source_payload: p as unknown as Record<string, unknown>,
        candidate_count: resolve.candidateCount,
        reason: resolve.reason,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'source,source_kind,source_id' })
      result.tournaments.unresolved++
      if (resolve.reason === 'no_candidate') result.by_reason.no_candidate++
      else if (resolve.reason === 'multiple_candidates') result.by_reason.multiple_candidates++
    }
  }

  // Step 4: Match linking for newly-linked (and already-linked) tournaments
  await linkMatchesForLinkedTournaments(linkedTournamentIds, result)

  return Response.json({
    ...result,
    elapsed_ms: Date.now() - startedAt,
  })
}
