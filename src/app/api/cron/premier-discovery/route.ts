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
  type PremierTournamentSummary,
} from '@/lib/premier-api'
import {
  resolveSingleCandidate,
  yearOf,
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

  // Step 4: Match linking — implemented in Task 14, placeholder for now
  // (will add a `linkMatchesForLinkedTournaments(linkedTournamentIds)` call here)

  return Response.json({
    ...result,
    elapsed_ms: Date.now() - startedAt,
  })
}
