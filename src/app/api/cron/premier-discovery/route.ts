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
  fetchPremierMatchDetail,
  type PremierMatchDetail,
} from '@/lib/premier-api'
import {
  resolveSingleCandidate,
  yearOf,
  normalizeRound,
  extractCategoryFromPremierRound,
  type CandidateTournament,
} from '@/lib/source-matcher'
import { findEntityBySourceId, registerSourceId } from '@/lib/external-id-registry'
import { padelapiPausedResponse } from '@/lib/padelapi-pause'

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

// Match ID scan range — the ID range scan approach iterates over Premier's
// sequential match IDs, filtering for matches that belong to a linked
// tournament. This is more reliable than fetchPremierUpcomingMatches which
// only returns upcoming matches for future tournaments.
//
// 5700 is roughly where Riyadh P1 2026 (Feb 7) match IDs start.
// MAX rolls forward as the season progresses — overridable via ?max= query
// param so we don't redeploy each time. Brussels P2 (late April) ran around
// ID 8000, so 9000 has a few weeks of headroom.
const DEFAULT_MIN_MATCH_ID = 5700
const DEFAULT_MAX_MATCH_ID = 9000

// Vercel function timeout for this route. The scan is the longest part —
// each fetch is ~150-300ms + network jitter, so a 5-min budget with chunked
// parallelism handles ~3-4k IDs comfortably.
export const maxDuration = 300

// Parallel fetch concurrency. Premier's rate limits aren't documented, but
// 5 concurrent flights with a 150ms gap between chunks has run cleanly
// in practice. Bump cautiously.
const SCAN_CONCURRENCY = 5
const INTER_CHUNK_PAUSE_MS = 150

// Rounds we skip at the source — our DB doesn't store qualification
// matches, so these would always end up as "no_player_match" unresolved
// failures even though they're legitimately out of scope.
const SKIP_ROUND_PATTERN = /\bQ[123]\b/i

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
 * Score a Premier match detail against a list of candidate matches from our
 * DB by counting how many of the 4 last names overlap. Filters by (category,
 * round) normalized via normalizeRound. Returns the best candidate + score.
 */
function matchPremierMatchToOurs(
  detail: PremierMatchDetail,
  candidates: OurMatchRow[],
): { matched: OurMatchRow | null; score: number } {
  const ms = detail.match_score
  const premierNames = new Set(
    [
      lastNameOf(ms.team1_player_name),
      lastNameOf(ms.team1_partner_name),
      lastNameOf(ms.team2_player_name),
      lastNameOf(ms.team2_partner_player_name),
    ].filter(Boolean),
  )

  if (premierNames.size === 0) return { matched: null, score: 0 }

  const pmCategory = extractCategoryFromPremierRound(ms.round_name)
  const pmCanonicalRound = normalizeRound(ms.round_name)

  let best: OurMatchRow | null = null
  let bestScore = 0

  for (const c of candidates) {
    if (pmCategory && c.category && c.category !== pmCategory) continue
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

// ── Match linking: ID-range scan over Premier match IDs ──────
//
// Premier's gettournamnetupcomingmatches endpoint only returns UPCOMING
// matches, so it's useless for finished tournaments. Instead, we scan
// gettournamentsmatchdetail over a known ID range and bucket each match
// by its tournaments_id, filtering down to tournaments we've already linked.

interface ScanDiagnostics {
  scanned: number
  empty: number
  out_of_scope: number
  skipped_quali: number
  tournaments_seen: Record<number, number>  // premier tournaments_id → count
}

async function linkMatchesViaIdScan(
  linkedTournamentIds: Array<{ ourId: string; premierId: number; name: string }>,
  result: {
    matches: { linked: number; already: number; unresolved: number; skipped_byes: number }
    by_reason: { no_candidate: number; multiple_candidates: number; no_player_match: number }
  },
  scanRange: { min: number; max: number },
  diagnostics: ScanDiagnostics,
): Promise<void> {
  // Build lookup: premier tournaments_id → our tournament UUID
  const linkedMap = new Map<number, { ourId: string; name: string }>()
  for (const { premierId, ourId, name } of linkedTournamentIds) {
    linkedMap.set(premierId, { ourId, name })
  }

  // Cache our matches per tournament so we only query once
  const ourMatchesCache = new Map<string, OurMatchRow[]>()

  async function getOurMatches(ourTournamentId: string): Promise<OurMatchRow[]> {
    if (ourMatchesCache.has(ourTournamentId)) return ourMatchesCache.get(ourTournamentId)!
    const { data } = await supabase
      .from('matches')
      .select(`
        id, round, category,
        pair1_player1:players!matches_pair1_player1_id_fkey(name, display_name),
        pair1_player2:players!matches_pair1_player2_id_fkey(name, display_name),
        pair2_player1:players!matches_pair2_player1_id_fkey(name, display_name),
        pair2_player2:players!matches_pair2_player2_id_fkey(name, display_name)
      `)
      .eq('tournament_id', ourTournamentId)
    const rows = (data as unknown as OurMatchRow[] | null) ?? []
    ourMatchesCache.set(ourTournamentId, rows)
    return rows
  }

  // Pre-fetch ALL existing Premier match mappings in one query so the scan
  // loop can do in-memory set membership checks instead of hitting the DB
  // per iteration (was 800 N+1 lookups before this optimization).
  const { data: existingMappings } = await supabase
    .from('entity_external_ids')
    .select('external_id')
    .eq('entity_type', 'match')
    .eq('source', 'premierpadel')
  const alreadyLinkedMatchIds = new Set(
    (existingMappings ?? []).map(r => String(r.external_id)),
  )
  console.log(`[premier-discovery] pre-loaded ${alreadyLinkedMatchIds.size} existing match mappings`)

  console.log(`[premier-discovery] scanning Premier match IDs ${scanRange.min}..${scanRange.max} (concurrency=${SCAN_CONCURRENCY})`)

  // Build the list of IDs we actually need to fetch. Already-linked IDs
  // are skipped at the cost of zero network calls — important because the
  // routine cron will re-scan the full historical range every Monday.
  const idsToFetch: number[] = []
  for (let id = scanRange.min; id <= scanRange.max; id++) {
    if (alreadyLinkedMatchIds.has(String(id))) {
      result.matches.already++
      continue
    }
    idsToFetch.push(id)
  }
  console.log(`[premier-discovery] ${idsToFetch.length} IDs to fetch (${result.matches.already} already-linked skipped)`)

  // Chunked parallel fetch — each chunk waits for all flights to settle,
  // then a small gap before the next chunk so we don't blow up Premier's
  // rate limits. Process results sequentially so DB writes stay ordered.
  for (let chunkStart = 0; chunkStart < idsToFetch.length; chunkStart += SCAN_CONCURRENCY) {
    const chunkIds = idsToFetch.slice(chunkStart, chunkStart + SCAN_CONCURRENCY)
    const details = await Promise.all(chunkIds.map(id => fetchPremierMatchDetail(id)))

    for (let i = 0; i < chunkIds.length; i++) {
      const premierMatchId = chunkIds[i]
      const detail = details[i]
      diagnostics.scanned++

      if (!detail) { diagnostics.empty++; continue }

      // Track every tournament we encounter, even out-of-scope ones — gives
      // us visibility into Premier's ID layout when zero matches link.
      const tournamentsId = detail.match_score.tournaments_id
      diagnostics.tournaments_seen[tournamentsId] = (diagnostics.tournaments_seen[tournamentsId] ?? 0) + 1

      // Is this match's tournament one we've linked?
      const linkedInfo = linkedMap.get(tournamentsId)
      if (!linkedInfo) { diagnostics.out_of_scope++; continue }

      // Skip byes
      if (detail.match_score.is_bye === 'Yes') {
        result.matches.skipped_byes++
        continue
      }

      // Skip qualification rounds (Q1/Q2/Q3) — our DB doesn't track them,
      // so they'd always fail player-matching. Silent skip, no unresolved entry.
      if (SKIP_ROUND_PATTERN.test(detail.match_score.round_name ?? '')) {
        diagnostics.skipped_quali++
        continue
      }

      // Run player-name matcher
      const ourMatches = await getOurMatches(linkedInfo.ourId)
      if (ourMatches.length === 0) {
        // Tournament is linked but our DB has no matches for it yet
        // (future tournament). Queue as unresolved for later.
        await supabase.from('match_stats_unresolved').upsert({
          source: 'premierpadel',
          source_kind: 'match',
          source_id: String(premierMatchId),
          source_payload: detail.match_score as unknown as Record<string, unknown>,
          candidate_count: 0,
          reason: 'no_candidate',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'source,source_kind,source_id' })
        result.matches.unresolved++
        result.by_reason.no_candidate++
        continue
      }

      const { matched, score } = matchPremierMatchToOurs(detail, ourMatches)

      if (matched && score >= 3) {
        await registerSourceId(supabase, {
          entityType: 'match',
          entityId: matched.id,
          source: 'premierpadel',
          externalId: String(premierMatchId),
          metadata: {
            draw_type: detail.match_score.draw_type,
            round_name: detail.match_score.round_name,
            matchId: detail.match_score.matchId,
          },
        })
        result.matches.linked++
      } else {
        await supabase.from('match_stats_unresolved').upsert({
          source: 'premierpadel',
          source_kind: 'match',
          source_id: String(premierMatchId),
          source_payload: detail.match_score as unknown as Record<string, unknown>,
          candidate_count: ourMatches.length,
          reason: 'no_player_match',
          updated_at: new Date().toISOString(),
        }, { onConflict: 'source,source_kind,source_id' })
        result.matches.unresolved++
        result.by_reason.no_player_match++
      }
    }

    // Inter-chunk pause to stay under Premier's (undocumented) rate limit.
    if (chunkStart + SCAN_CONCURRENCY < idsToFetch.length) {
      await new Promise(r => setTimeout(r, INTER_CHUNK_PAUSE_MS))
    }
  }

  console.log(`[premier-discovery] scan complete: ${diagnostics.scanned} fetched, ${diagnostics.empty} empty, ${diagnostics.out_of_scope} out-of-scope, ${diagnostics.skipped_quali} quali-skipped, ${result.matches.linked} linked, ${result.matches.unresolved} unresolved`)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ops kill-switch — shared with padelapi crons (see src/lib/padelapi-pause.ts).
  const paused = padelapiPausedResponse('premier-discovery')
  if (paused) return paused

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
    // Strict 2026-only filter. Historical Premier entries have null or pre-2026
    // dates and would collide with our DB's historical tournaments, causing
    // false multi-candidate matches.
    const premierYear = yearOf(p.accommodation_start_date)
    if (premierYear === null || premierYear < MIN_YEAR) continue

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

  // Step 4: Match linking via ID range scan
  // Range overridable via ?min=&max= for ad-hoc backfill of newer tournaments.
  const url = new URL(request.url)
  const minParam = Number(url.searchParams.get('min'))
  const maxParam = Number(url.searchParams.get('max'))
  const scanRange = {
    min: Number.isFinite(minParam) && minParam > 0 ? minParam : DEFAULT_MIN_MATCH_ID,
    max: Number.isFinite(maxParam) && maxParam > 0 ? maxParam : DEFAULT_MAX_MATCH_ID,
  }
  const diagnostics: ScanDiagnostics = {
    scanned: 0,
    empty: 0,
    out_of_scope: 0,
    skipped_quali: 0,
    tournaments_seen: {},
  }
  await linkMatchesViaIdScan(linkedTournamentIds, result, scanRange, diagnostics)

  // Flatten tournaments_seen so the response is grep-friendly. Trim to
  // top-N to avoid bloating the JSON when the scan crosses many tournaments.
  const topTournaments = Object.entries(diagnostics.tournaments_seen)
    .map(([id, count]) => ({ premier_tournaments_id: Number(id), count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20)

  return Response.json({
    ...result,
    scan_range: scanRange,
    diagnostics: {
      scanned: diagnostics.scanned,
      empty: diagnostics.empty,
      out_of_scope: diagnostics.out_of_scope,
      skipped_quali: diagnostics.skipped_quali,
      top_tournaments_seen: topTournaments,
    },
    elapsed_ms: Date.now() - startedAt,
  })
}
