// apps/ops/src/app/api/news-sources/discover/route.ts
import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { auth } from '@/lib/auth'
import { pgPool } from '@/lib/db'
import { detectSource } from '@/lib/source-detector'
import { buildDiscoveryPrompt, SYSTEM_PROMPT_DISCOVERY, type DiscoveryFocus } from '@/lib/discovery-prompt'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const RUNS_PER_DAY = parseInt(process.env.AI_DISCOVERY_RUNS_PER_DAY ?? '3', 10)
const MAX_CANDIDATES = parseInt(process.env.AI_DISCOVERY_MAX_CANDIDATES ?? '15', 10)

interface Body {
  focus: DiscoveryFocus
  customQuery?: string
  maxCandidates?: number
}

interface Candidate { url: string; name: string; language: string; rationale: string }

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.isOperator) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as Body
  const max = Math.min(body.maxCandidates ?? 10, MAX_CANDIDATES)

  // Rate-limit (per-day across all operators — telemetry, not per-user)
  const { rows: limitRows } = await pgPool().query<{ runs: number }>(
    `SELECT count(*)::int AS runs FROM ops_events
       WHERE kind = 'news_source.ai_discovery.run'
         AND created_at > now() - interval '24 hours'`,
  )
  if ((limitRows[0]?.runs ?? 0) >= RUNS_PER_DAY) {
    return NextResponse.json({ error: 'daily_limit_reached', limit: RUNS_PER_DAY }, { status: 429 })
  }

  // Existing sources for the prompt
  const { rows: existing } = await pgPool().query<{ key: string; name: string; url: string }>(
    `SELECT key, name, url FROM news_sources WHERE enabled = true ORDER BY articles_last_7d DESC LIMIT 50`,
  )

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  let resp: Awaited<ReturnType<typeof client.messages.create>>
  try {
    resp = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      // The web_search tool type isn't fully reflected in the SDK's typed tools union at every release —
      // cast to `never` so we don't fight TypeScript on a runtime-provided tool. Beta name may change.
      tools: [{ type: 'web_search_20250305' as 'web_search_20250305', name: 'web_search' } as never],
      system: SYSTEM_PROMPT_DISCOVERY,
      messages: [{ role: 'user', content: buildDiscoveryPrompt({ focus: body.focus, customQuery: body.customQuery, maxCandidates: max, existing }) }],
    })
  } catch (e) {
    return NextResponse.json({ error: 'claude_failed', message: (e as Error).message }, { status: 502 })
  }

  // Extract text content
  const text = resp.content.filter(c => c.type === 'text').map(c => (c as { type: 'text'; text: string }).text).join('\n')
  let candidates: Candidate[] = []
  const jsonMatch = text.match(/\[\s*\{[\s\S]+?\}\s*\]/)
  if (jsonMatch) {
    try { candidates = JSON.parse(jsonMatch[0]) } catch {}
  }

  // Verify each candidate
  const kept: Array<Candidate & { detected_type: string; detected_payload: object }> = []
  for (const c of candidates.slice(0, max)) {
    if (!c.url || !/^https?:\/\//.test(c.url)) continue

    // Dedup against existing sources
    const { rows: dup } = await pgPool().query(
      `SELECT id FROM news_sources WHERE LOWER(url) = LOWER($1) LIMIT 1`,
      [c.url],
    )
    if (dup.length > 0) continue

    const detected = await detectSource(c.url).catch(() => null)
    if (!detected || detected.type === 'unknown') continue
    if (detected.sample.length === 0) continue
    // Recency: drop if first sample item is older than 60 days
    const firstDate = detected.sample[0]?.pubDate
    if (firstDate && Date.now() - Date.parse(firstDate) > 60 * 86400_000) continue

    kept.push({
      ...c,
      detected_type: detected.type,
      detected_payload: { name: detected.name, language: detected.language, sample: detected.sample, notes: detected.notes },
    })
  }

  // Persist as suggestions
  for (const k of kept) {
    await pgPool().query(
      `INSERT INTO news_source_suggestions (url, note, submitted_by_kind, detected_type, detected_payload, status)
       VALUES ($1, $2, 'ai_discovery', $3, $4, 'pending')
       ON CONFLICT DO NOTHING`,
      [k.url, k.rationale, k.detected_type, k.detected_payload],
    )
  }

  // Log run
  const usage = resp.usage ?? { input_tokens: 0, output_tokens: 0 }
  const costUsd = (usage.input_tokens / 1_000_000) * 3 + (usage.output_tokens / 1_000_000) * 15  // Sonnet 4.5 rough
  await pgPool().query(
    `INSERT INTO ops_events (kind, metadata) VALUES ('news_source.ai_discovery.run', $1)`,
    [JSON.stringify({ focus: body.focus, max, candidates_found: candidates.length, candidates_kept: kept.length, cost_usd: costUsd })],
  )

  return NextResponse.json({ ok: true, candidates_found: candidates.length, candidates_kept: kept.length })
}
