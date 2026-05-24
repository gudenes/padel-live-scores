// src/app/api/cron/process-factsheets/route.ts
// Vercel cron — ML-extract structured info from FIP factsheet PDFs.
//
// Upstream: padelgod's `fip-event-page-enricher` worker detects a
// factsheet PDF link on the event page and writes the URL to
// `tournaments.factsheet_url`. This cron picks up rows where
// `factsheet_url IS NOT NULL AND factsheet_processed_at IS NULL` and
// asks Claude to extract a structured representation (prize money
// breakdown, per-round points, daily schedule, venue address, sponsors).
//
// Cost ceiling: ~300 FIP-tier tournaments/year × ~$0.015 per extraction
// ≈ $5/year. Runs hourly but does almost nothing (queue is usually empty).
// Limit per run: 5 PDFs — caps worst-case runtime + cost spikes.
//
// Re-processing: when the enricher detects a new URL (e.g. FACTSHEET-2.pdf
// replaces FACTSHEET-1.pdf), it sets factsheet_processed_at back to NULL
// and we extract again.

import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

export const runtime = 'nodejs'
export const maxDuration = 120

const BATCH_LIMIT = 5
const CLAUDE_MODEL = 'claude-haiku-4-5-20251001'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const EXTRACTION_PROMPT = `Extract structured information from this padel tournament factsheet PDF. Return ONLY valid JSON (no markdown, no commentary). Use null for fields absent from the PDF.

Schema:
{
  "schedule": [
    { "date": "YYYY-MM-DD", "round_label": "First Round Qualy" | "Second Round Qualy" | "Last of Qualy" | "Main Draw: First Round" | "Round of 16" | "Quarterfinals" | "Semifinals" | "Finals" | string, "start_time": "HH:MM" | null }
  ],
  "prize_money": [
    { "round_label": "winner" | "finalist" | "semifinalist" | "quarterfinalist" | "round_16" | "round_32" | "last_of_qualy" | "qualy_bonus" | string, "total_pair_eur": number | null, "per_player_eur": number | null }
  ],
  "points": [
    { "round_label": "winner" | "finalist" | "semifinalist" | "quarterfinalist" | "round_16" | "round_32" | "qualy_bonus" | "last_of_qualy" | "q2" | "q1" | string, "points": number }
  ],
  "venue": { "name": string | null, "address": string | null },
  "draw_size": {
    "main_draw": { "total": number | null, "direct_acceptance": number | null, "qualifying": number | null, "wildcards": number | null } | null,
    "qualifying": { "total": number | null, "direct_acceptance": number | null, "wildcards": number | null } | null
  } | null,
  "sponsors": [string]
}

Rules:
- All monetary amounts in EUR as plain numbers (no currency symbol, no thousand separators).
- Times in 24h "HH:MM" venue-local.
- round_label values are free-form but prefer the enum hints above.
- If a section is absent (e.g. no prize money table), omit that key entirely.
- Sponsor names: just the brand text shown in the sponsor row.
`

interface TournamentRow {
  id: string
  name: string | null
  factsheet_url: string
}

async function processOne(row: TournamentRow): Promise<{ ok: boolean; error?: string }> {
  // Fetch the PDF and base64 it — same pattern as src/lib/pdf-extract-claude.ts.
  // URL-source documents are supported on newer SDK versions but base64 is
  // the conservative path that's already proven in this codebase.
  const resp = await fetch(row.factsheet_url, {
    headers: { 'User-Agent': 'PadelNachos/1.0 (factsheet-processor)' },
  })
  if (!resp.ok) return { ok: false, error: `factsheet fetch ${resp.status}` }
  const bytes = new Uint8Array(await resp.arrayBuffer())
  if (bytes.length === 0) return { ok: false, error: 'empty factsheet' }
  const base64 = Buffer.from(bytes).toString('base64')

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      },
    ],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()

  // Strip code fences if Claude returned `\`\`\`json ... \`\`\`` despite the prompt.
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

  let data: unknown
  try {
    data = JSON.parse(cleaned)
  } catch {
    return { ok: false, error: 'invalid JSON from Claude' }
  }

  const { error: updErr } = await supabase
    .from('tournaments')
    .update({
      factsheet_data: data,
      factsheet_processed_at: new Date().toISOString(),
    })
    .eq('id', row.id)
  if (updErr) return { ok: false, error: `update failed: ${updErr.message}` }

  return { ok: true }
}

export async function GET(request: Request) {
  if (process.env.NODE_ENV === 'production') {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
  }

  const url = new URL(request.url)
  const onlyId = url.searchParams.get('tournament_id')

  let query = supabase
    .from('tournaments')
    .select('id, name, factsheet_url')
    .not('factsheet_url', 'is', null)
    .limit(BATCH_LIMIT)

  // The cron path skips already-processed rows. The one-off path (when
  // an operator passes ?tournament_id=...) re-extracts on demand.
  if (onlyId) {
    query = query.eq('id', onlyId)
  } else {
    query = query.is('factsheet_processed_at', null)
  }

  const { data: rows, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const candidates = (rows ?? []) as TournamentRow[]
  const results: Array<{ tournament: string; ok: boolean; error?: string }> = []
  let ok = 0
  let failed = 0
  for (const row of candidates) {
    try {
      const r = await processOne(row)
      results.push({ tournament: row.name ?? row.id, ...r })
      if (r.ok) ok++; else failed++
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[process-factsheets] ${row.name ?? row.id}:`, msg)
      results.push({ tournament: row.name ?? row.id, ok: false, error: msg })
      failed++
    }
  }

  return Response.json({ scanned: candidates.length, ok, failed, results })
}
