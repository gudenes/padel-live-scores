// src/app/api/ops/widget-lookup-probe/route.ts
//
// Diagnostic endpoint that runs the EXACT same matchscorerlive search
// path the padelgod `widget-code-lookup` worker uses, and returns what
// Crionet actually responds with for a given tournament. Lets operators
// answer "is this tournament really not on Crionet, or is our search
// query stripping too aggressively?" without redeploying or grepping
// scrape_jobs.
//
// Mirrors padelgod/src/workers/widget-code-lookup.ts behaviour:
//   1. simplifyQuery() — strips FIP/level/year tokens
//   2. POST to https://widget.matchscorerlive.com/ft with form-encoded
//      `connector=tol`, `year=<year>`, `query=<simplified>`
//   3. Parse the HTML response for `.card.tournament-card` blocks,
//      pulling `.tournament-name` + `.tournament-code` per card.
//
// We deliberately do NOT call into padelgod source — duplicating the
// ~30 lines of logic here is far cheaper than wiring a cross-package
// import for a one-off diagnostic. If the worker's logic changes,
// update both. The doc-comment links them.
//
// Usage:
//   GET /api/ops/widget-lookup-probe?tournamentId=<uuid>
//   GET /api/ops/widget-lookup-probe?q=asuncion&year=2026
//
// Auth: ops_token cookie via checkOpsAuth (same as other ops endpoints).

import { createClient } from '@supabase/supabase-js'
import { checkOpsAuth } from '@/lib/ops-auth'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const SEARCH_URL = 'https://widget.matchscorerlive.com/ft'

// Mirrors padelgod/src/workers/widget-code-lookup.ts::simplifyQuery
// Strip FIP prefix and tier/year noise; keep distinctive city/event word.
// Example: "FIP Gold Iconico Sevilla 2026" → "iconico sevilla"
function simplifyQuery(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bfip\b/g, '')
    .replace(/\b(gold|silver|bronze|beyond|promises|premier|p1|p2|major|b1|b2|b3)\b/g, '')
    .replace(/\b20\d{2}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Mirrors padelgod/src/parsers/crionet-search.ts::parseCrionetSearchResults
// Inline regex parse — cheerio is not a runtime dep of this app.
// Crionet's response is plain HTML with predictable card markup; the
// regex match against tournament-name + tournament-code spans is enough
// for diagnosis. We take the FIRST tournament-name and tournament-code
// child within each tournament-card block.
function parseCandidates(html: string, year: number): Array<{
  code: string
  name: string
  isLive: boolean
}> {
  const out: Array<{ code: string; name: string; isLive: boolean }> = []
  // Each card spans a chunk of HTML. Use a non-greedy match on the
  // wrapper class `card tournament-card` and bind end-of-card by the
  // next opening of the same class OR end of string.
  const cardRegex = /<div[^>]*class="[^"]*\bcard\b[^"]*\btournament-card\b[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*\bcard\b[^"]*\btournament-card\b|$)/gi
  let m: RegExpExecArray | null
  while ((m = cardRegex.exec(html)) !== null) {
    const block = m[1] ?? ''
    const nameMatch = /class="[^"]*\btournament-name\b[^"]*"[^>]*>([\s\S]*?)<\//i.exec(block)
    const codeMatch = /class="[^"]*\btournament-code\b[^"]*"[^>]*>([\s\S]*?)<\//i.exec(block)
    const isLive = /\btournament-card-header-live\b/i.test(block)
    if (!nameMatch || !codeMatch) continue
    const name = nameMatch[1]!.replace(/<[^>]*>/g, '').trim()
    const codeNum = codeMatch[1]!.replace(/<[^>]*>/g, '').trim()
    if (!name || !codeNum) continue
    out.push({
      code: `FIP-${year}-${codeNum}`,
      name,
      isLive,
    })
  }
  return out
}

interface ProbeResult {
  tournament: {
    id: string
    name: string
    starts_at: string | null
  } | null
  inputs: {
    rawQuery: string
    simplifiedQuery: string
    year: number
    targetUrl: string
  }
  upstream: {
    status: number
    bodyLength: number
    bodySnippet: string
  }
  candidates: Array<{ code: string; name: string; isLive: boolean }>
  resolution: 'unique' | 'ambiguous' | 'empty' | 'http_error'
  diagnostics: {
    /** What widget-code-lookup would do with this result. */
    workerWouldResolve: boolean
    /** Reason the worker would skip — null when it would resolve. */
    workerSkipReason:
      | null
      | 'empty_query'
      | 'no_candidates'
      | 'multiple_candidates'
      | 'http_error'
  }
}

export async function GET(request: Request) {
  const authErr = await checkOpsAuth()
  if (authErr) return authErr

  const url = new URL(request.url)
  const tournamentId = url.searchParams.get('tournamentId')
  let rawQuery = url.searchParams.get('q')
  // Number(null) === 0 (not NaN), so we can't use Number.isFinite as a
  // "year was passed" check — bare-bones null check first.
  const yearParam = url.searchParams.get('year')
  let year: number = yearParam !== null ? Number(yearParam) : NaN

  let tournamentRow: ProbeResult['tournament'] = null

  if (tournamentId) {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, starts_at')
      .eq('id', tournamentId)
      .maybeSingle()
    if (error) {
      return Response.json(
        { error: `tournament read failed: ${error.message}` },
        { status: 500 },
      )
    }
    if (!data) {
      return Response.json(
        { error: 'tournament not found' },
        { status: 404 },
      )
    }
    tournamentRow = {
      id: data.id as string,
      name: data.name as string,
      starts_at: (data.starts_at as string | null) ?? null,
    }
    rawQuery = tournamentRow.name
    if (!Number.isFinite(year)) {
      const startsAt = tournamentRow.starts_at
      year = startsAt ? new Date(startsAt).getUTCFullYear() : new Date().getUTCFullYear()
    }
  }

  if (!rawQuery) {
    return Response.json(
      { error: 'pass either ?tournamentId=<uuid> or ?q=<text>&year=<n>' },
      { status: 400 },
    )
  }
  if (!Number.isFinite(year)) {
    year = new Date().getUTCFullYear()
  }

  const simplified = simplifyQuery(rawQuery)
  const targetUrl = `${SEARCH_URL}?connector=tol&year=${year}&query=${encodeURIComponent(simplified)}`

  // Worker uses POST with form body; mirror that exactly.
  let httpStatus = 0
  let bodyText = ''
  try {
    const resp = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        connector: 'tol',
        year: String(year),
        query: simplified,
      }).toString(),
    })
    httpStatus = resp.status
    bodyText = await resp.text()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return Response.json(
      { error: `upstream fetch failed: ${msg}` },
      { status: 502 },
    )
  }

  const candidates = parseCandidates(bodyText, year)
  const resolution: ProbeResult['resolution'] =
    httpStatus >= 400 ? 'http_error'
    : candidates.length === 1 ? 'unique'
    : candidates.length > 1 ? 'ambiguous'
    : 'empty'

  // What would widget-code-lookup do with this exact result?
  // From widget-code-lookup.ts:88: `if (candidates.length !== 1) skip`.
  // No empty-query guard upstream, but we surface it explicitly because
  // a stripped-to-empty query is the most common silent failure mode.
  const workerSkipReason: ProbeResult['diagnostics']['workerSkipReason'] =
    httpStatus >= 400 ? 'http_error'
    : simplified.length === 0 ? 'empty_query'
    : candidates.length === 0 ? 'no_candidates'
    : candidates.length > 1 ? 'multiple_candidates'
    : null

  const result: ProbeResult = {
    tournament: tournamentRow,
    inputs: {
      rawQuery,
      simplifiedQuery: simplified,
      year,
      targetUrl,
    },
    upstream: {
      status: httpStatus,
      bodyLength: bodyText.length,
      // First 1KB is plenty to eyeball the response shape without
      // returning a multi-MB payload through the probe.
      bodySnippet: bodyText.slice(0, 1024),
    },
    candidates,
    resolution,
    diagnostics: {
      workerWouldResolve: workerSkipReason === null,
      workerSkipReason,
    },
  }

  return Response.json(result)
}
