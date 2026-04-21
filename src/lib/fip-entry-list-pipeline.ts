// src/lib/fip-entry-list-pipeline.ts
// Orchestration: fetch Ijuí/any-FIP event page → admin-ajax → PDFs → parse →
// resolve each player to a `fip_id` (via local DB first, FIP search fallback)
// → produce rows ready for `padelgod.entry_list_snapshots`.
//
// Transport-injectable: the caller supplies `fetchFn` (for tests & auditing)
// and the resolver/search-client instances.

import type { PlayerResolver } from './player-resolver'
import { normalizeCountry } from './player-resolver'
import { parseEntryListText, type ParsedTeam } from './entry-list-parser'
import { searchFipPlayer, type FipPlayerSearchResult } from './fip-player-search'
import {
  ADMIN_AJAX_URL,
  buildEntryListAjaxBody,
  buildEventPageUrl,
  extractNonceAndPostId,
  extractPdfUrlsFromAjaxResponse,
  type EntryListPdfUrls,
} from './fip-event-page'

export type Category = 'men' | 'women'

export interface PipelineSnapshotRow {
  category: Category
  fip_id: string | null
  name: string
  country: string | null
  seed: number | null
  partner_fip_id: string | null
  partner_name: string | null
}

export interface PipelineUnresolvedEntry {
  category: Category
  name: string
  country: string | null
  ranking: number | null
  reason: 'no_db_match_no_fip_search_result'
}

export interface PipelineStats {
  dbMatches: number
  fipSearchMatches: number
  unresolved: number
  teamsParsed: number
  pdfsDownloaded: number
}

/**
 * A player resolved via the FIP search API because they weren't already in
 * `public.players`. The persistence layer uses these to bootstrap new rows so
 * downstream reconcilers and match pages can link to a real player record.
 */
export interface PipelineNewPlayer {
  fipId: string                 // "fip-P100312" — our canonical convention
  category: Category
  name: string                  // "Cleo Carvalho" (from FIP)
  country: string               // 2-letter ISO ("BR") — normalized from FIP's 3-letter
  rank: number
  points: number
  profileUrl: string            // padelfip.com player profile
}

export interface PipelineResult {
  tournamentId: string
  fipId: string
  pdfUrls: EntryListPdfUrls
  rows: PipelineSnapshotRow[]
  unresolved: PipelineUnresolvedEntry[]
  /**
   * Players that were NOT already in our DB and had to be looked up via the
   * FIP public search API. Deduplicated by fip_id. The persistence layer
   * should UPSERT these into `public.players` before writing the snapshot
   * rows so FK references (implicit) and player-profile pages work.
   */
  newPlayers: PipelineNewPlayer[]
  stats: PipelineStats
}

export interface PipelineDeps {
  /** Service-role supabase client (for PlayerResolver + `public.players` upserts when resolving new players). */
  resolver: PlayerResolver
  /** Injectable fetch; defaults to global fetch. */
  fetchFn?: typeof fetch
  /** Override search client for tests. */
  searchFn?: typeof searchFipPlayer
  /** Logger for info/warn; defaults to console. */
  log?: (msg: string, meta?: Record<string, unknown>) => void
}

export interface PipelineInput {
  tournamentId: string
  fipId: string   // e.g. "fip-bronze-ijui-2026"
  /** Filter: only process this category. Defaults to both. */
  only?: Category
}

/**
 * Full pipeline — used by the API route + manual scripts + live integration tests.
 */
export async function runFipEntryListPipeline(
  input: PipelineInput,
  deps: PipelineDeps
): Promise<PipelineResult> {
  const fetchFn = deps.fetchFn ?? fetch
  const searchFn = deps.searchFn ?? searchFipPlayer
  const log = deps.log ?? ((m, meta) => console.log(`[fip-entry-list] ${m}`, meta ?? {}))

  // Step 1: event page → nonce + post_id
  const pageUrl = buildEventPageUrl(input.fipId)
  const pageRes = await fetchFn(pageUrl)
  if (!pageRes.ok) {
    throw new Error(`event page ${pageUrl} returned HTTP ${pageRes.status}`)
  }
  const html = await pageRes.text()
  const params = extractNonceAndPostId(html)
  if (!params) {
    throw new Error(`could not extract nonce+post_id from ${pageUrl}`)
  }
  log('extracted ajax params', { postId: params.postId })

  // Step 2: admin-ajax → pdfMap
  const ajaxRes = await fetchFn(ADMIN_AJAX_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildEntryListAjaxBody(params),
  })
  if (!ajaxRes.ok) {
    throw new Error(`admin-ajax returned HTTP ${ajaxRes.status}`)
  }
  const ajaxBody = await ajaxRes.text()
  const pdfUrls = extractPdfUrlsFromAjaxResponse(ajaxBody)
  log('pdfUrls', { men: pdfUrls.men, women: pdfUrls.women })

  // Step 3: for each gender that has a PDF, download + parse
  const rows: PipelineSnapshotRow[] = []
  const unresolved: PipelineUnresolvedEntry[] = []
  const newPlayersByFipId = new Map<string, PipelineNewPlayer>()
  const stats: PipelineStats = { dbMatches: 0, fipSearchMatches: 0, unresolved: 0, teamsParsed: 0, pdfsDownloaded: 0 }

  const genders: Array<{ cat: Category; key: 'men' | 'women' }> = [
    { cat: 'men', key: 'men' },
    { cat: 'women', key: 'women' },
  ]

  for (const { cat, key } of genders) {
    if (input.only && input.only !== cat) continue
    const url = pdfUrls[key]
    if (!url) {
      log(`no ${cat} PDF published`, { url: pdfUrls[key] })
      continue
    }

    const pdfRes = await fetchFn(url)
    if (!pdfRes.ok) {
      log(`PDF fetch failed`, { url, status: pdfRes.status })
      continue
    }
    stats.pdfsDownloaded++

    const buf = Buffer.from(await pdfRes.arrayBuffer())
    const text = await extractPdfText(buf)
    const { teams } = parseEntryListText(text)
    stats.teamsParsed += teams.length
    log(`parsed ${teams.length} teams for ${cat}`)

    for (const team of teams) {
      const [r1, r2] = await Promise.all([
        resolvePlayer(deps, team.player1, cat, searchFn),
        resolvePlayer(deps, team.player2, cat, searchFn),
      ])
      recordResolution(r1, rows, unresolved, stats, team, cat, 'player1', r2.fipId, newPlayersByFipId)
      recordResolution(r2, rows, unresolved, stats, team, cat, 'player2', r1.fipId, newPlayersByFipId)
    }
  }

  return {
    tournamentId: input.tournamentId,
    fipId: input.fipId,
    pdfUrls,
    rows,
    unresolved,
    newPlayers: Array.from(newPlayersByFipId.values()),
    stats,
  }
}

// ── Resolution helpers ───────────────────────────────────────────────────

interface ResolvedPlayer {
  fipId: string | null
  name: string
  country: string | null
  source: 'db' | 'fip_search' | 'unresolved'
  /** Present only when `source === 'fip_search'`; raw FIP search payload. */
  fipSearchHit: FipPlayerSearchResult | null
}

async function resolvePlayer(
  deps: PipelineDeps,
  pdfPlayer: { name: string; country: string; ranking: number; points: number },
  category: Category,
  searchFn: typeof searchFipPlayer
): Promise<ResolvedPlayer> {
  // 1. DB lookup with lenient matching
  const dbResult = await deps.resolver.lookup({
    name: pdfPlayer.name,
    country: pdfPlayer.country,
    category,
    ranking: pdfPlayer.ranking || undefined,
    points: pdfPlayer.points || undefined,
  }, { lenient: true })

  if (dbResult.found && dbResult.playerId) {
    // Look up the cached player's fip_id via the public cache shape.
    // The resolver already enriches cache with ranking/points; we need fipId too.
    // Access via a new helper added below.
    const fipId = await deps.resolver.getFipIdForPlayer(dbResult.playerId)
    if (fipId) {
      return { fipId, name: pdfPlayer.name, country: pdfPlayer.country, source: 'db', fipSearchHit: null }
    }
    // DB hit but no fip_id — fall through to FIP search to enrich.
  }

  // 2. FIP search fallback
  const hit = await searchFn({
    name: pdfPlayer.name,
    country: pdfPlayer.country,
    category,
    rankingHint: pdfPlayer.ranking || undefined,
  })
  if (hit) {
    return {
      fipId: `fip-${hit.playerId}`,
      name: hit.fullName,
      country: hit.nationality,
      source: 'fip_search',
      fipSearchHit: hit,
    }
  }

  return { fipId: null, name: pdfPlayer.name, country: pdfPlayer.country, source: 'unresolved', fipSearchHit: null }
}

function recordResolution(
  resolved: ResolvedPlayer,
  rows: PipelineSnapshotRow[],
  unresolved: PipelineUnresolvedEntry[],
  stats: PipelineStats,
  team: ParsedTeam,
  category: Category,
  which: 'player1' | 'player2',
  partnerFipId: string | null,
  newPlayersByFipId: Map<string, PipelineNewPlayer>
): void {
  const player = which === 'player1' ? team.player1 : team.player2
  if (resolved.source === 'db') stats.dbMatches++
  else if (resolved.source === 'fip_search') stats.fipSearchMatches++
  else stats.unresolved++

  // Collect FIP-search-resolved players for later UPSERT into public.players.
  // Dedup by fip_id (same player may appear multiple times across teams).
  if (resolved.source === 'fip_search' && resolved.fipSearchHit && resolved.fipId) {
    if (!newPlayersByFipId.has(resolved.fipId)) {
      const hit = resolved.fipSearchHit
      newPlayersByFipId.set(resolved.fipId, {
        fipId: resolved.fipId,
        category,
        name: hit.fullName,
        country: normalizeCountry(hit.nationality) ?? hit.nationality,
        rank: hit.rank,
        points: hit.points,
        profileUrl: hit.url,
      })
    }
  }

  if (resolved.fipId) {
    rows.push({
      category,
      fip_id: resolved.fipId,
      name: resolved.name,
      country: resolved.country,
      seed: which === 'player1' ? team.position : null, // store team position once (on player1)
      partner_fip_id: partnerFipId,
      partner_name: which === 'player1' ? team.player2.name : team.player1.name,
    })
  } else {
    unresolved.push({
      category,
      name: resolved.name,
      country: resolved.country,
      ranking: player.ranking || null,
      reason: 'no_db_match_no_fip_search_result',
    })
  }
}

// ── PDF text extraction ──────────────────────────────────────────────────
// pdf-parse exports a class in v2; wrap it to match the older callable form.
async function extractPdfText(buf: Buffer): Promise<string> {
  // Lazy import so this module stays usable in test environments that stub
  // `extractPdfText` directly (via vi.mock) without loading pdf-parse.
  const mod: any = await import('pdf-parse')
  const Ctor = mod.PDFParse ?? mod.default?.PDFParse
  if (Ctor) {
    const parser = new Ctor({ data: new Uint8Array(buf) })
    const r = await parser.getText()
    return String(r?.text ?? '')
  }
  // Back-compat for older pdf-parse (v1.x) with a default-function export.
  const fn = mod.default ?? mod
  if (typeof fn === 'function') {
    const r = await fn(buf)
    return String(r?.text ?? '')
  }
  throw new Error('pdf-parse module shape not recognised')
}
