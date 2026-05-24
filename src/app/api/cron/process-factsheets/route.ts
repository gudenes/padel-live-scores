// src/app/api/cron/process-factsheets/route.ts
// Vercel cron — agentically enrich tournament rows from FIP factsheet PDFs.
//
// Two-tier output from Claude:
//   1. `patch` — proposed values for specific columns on the tournaments row
//      that are currently null/empty. Type-validated and source-guarded
//      before write. Only fills gaps — never overwrites a non-null column.
//   2. `meta`  — structured extras that don't fit a single column (prize
//      money breakdown, per-round points, daily schedule with start times,
//      sponsor list, draw-size split DA/Q/WC). Stored verbatim in
//      tournaments.factsheet_data for the UI to render however it wants.
//
// Cost: ~$5/year (~300 FIP tournaments × ~$0.015 each). Runs every 2h,
// batch 5. Operator escape hatch: ?tournament_id=<id> re-extracts on demand.

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

// Columns the agent is allowed to propose values for. Anything outside
// this list gets stripped from `patch` before write. Descriptions are
// sent to Claude so it knows the semantics.
//
// Keep this list curated: each entry is a deliberate decision that we
// trust factsheet-extracted values for. Out-of-scope columns (status,
// fip_id, source, level, IDs, etc.) MUST stay out.
type ColumnSpec = {
  type: 'text' | 'integer' | 'number' | 'object'
  description: string
  /** Optional shape hint for object columns (sent to Claude). */
  shape?: string
  /** Optional validator — returns true if the value is safe to write. */
  validate?: (v: unknown) => boolean
  /**
   * For object columns: if true, merge the proposed value with the existing
   * value (existing keys win on conflict). Lets us fill in missing keys
   * without overwriting partial data that the scraper or operator put there.
   * If false/omitted, the guard treats any non-empty existing value as
   * "already set" and rejects the patch wholesale.
   */
  mergeMissing?: boolean
}

const ROUND_KEYS = ['q1', 'q2', 'q3', 'r128', 'r64', 'r32', 'r16', 'qf', 'sf', 'f'] as const

const ENRICHABLE: Record<string, ColumnSpec> = {
  venue: {
    type: 'text',
    description: 'Venue / arena name. E.g. "Skënderbeg Square", "WiZink Center".',
    validate: v => typeof v === 'string' && v.length > 0 && v.length <= 200,
  },
  venue_address: {
    type: 'text',
    description: 'Full street address of the main-draw venue.',
    validate: v => typeof v === 'string' && v.length > 0 && v.length <= 300,
  },
  venue_type: {
    type: 'text',
    description: 'One of: "indoor" | "outdoor". If the factsheet says nothing definitive, omit.',
    validate: v => v === 'indoor' || v === 'outdoor',
  },
  prize_money_fip: {
    type: 'number',
    description: 'Total prize money pool in EUR (e.g. 150000 for €150,000). Number only — no symbol.',
    validate: v => typeof v === 'number' && v > 0 && v < 10_000_000,
  },
  signup_fee_eur: {
    type: 'number',
    description: 'Per-pair sign-up / entry fee in EUR. Usually 40-200 range.',
    validate: v => typeof v === 'number' && v > 0 && v < 5000,
  },
  draw_size_md: {
    type: 'integer',
    description: 'Total pairs in the main draw (e.g. 28).',
    validate: v => Number.isInteger(v) && (v as number) >= 8 && (v as number) <= 128,
  },
  draw_size_qd: {
    type: 'integer',
    description: 'Total pairs in qualifying (e.g. 32).',
    validate: v => Number.isInteger(v) && (v as number) >= 4 && (v as number) <= 128,
  },
  round_schedule: {
    type: 'object',
    mergeMissing: true,
    description:
      'Map round_key → ISO date "YYYY-MM-DD" of when that round plays. ' +
      `Allowed keys (omit those the factsheet doesn't cover): ${ROUND_KEYS.join(', ')}. ` +
      'For "Main Draw First Round" pick the right key based on draw_size_md: ' +
      '28-32 pairs → "r32", 33-64 → "r64", 65-128 → "r128", 16 → "r16". ' +
      'If two qualifying rounds share a date (e.g. Q2 and Last of Qualy on the same day), set both keys to that date.',
    shape: '{ "q1": "YYYY-MM-DD", "r16": "YYYY-MM-DD", ... }',
    validate: v => {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return false
      const obj = v as Record<string, unknown>
      const keys = Object.keys(obj)
      if (keys.length === 0) return false
      for (const k of keys) {
        if (!ROUND_KEYS.includes(k as typeof ROUND_KEYS[number])) return false
        const dv = obj[k]
        if (typeof dv !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dv)) return false
      }
      return true
    },
  },
  schedule_notes: {
    type: 'text',
    description:
      'One-line human note about the schedule if the factsheet has any irregularity worth surfacing. ' +
      'E.g. "Finals not before 20:30". Keep short. Omit if nothing notable.',
    validate: v => typeof v === 'string' && v.length > 0 && v.length <= 200,
  },
}

const META_SCHEMA = `
  "schedule": [
    { "date": "YYYY-MM-DD", "round_label": string, "start_time": "HH:MM" | null }
  ],
  "prize_money": [
    { "round_label": "winner" | "finalist" | "semifinalist" | "quarterfinalist" | "round_16" | "round_32" | "last_of_qualy" | "qualy_bonus" | string, "total_pair_eur": number | null, "per_player_eur": number | null }
  ],
  "points": [
    { "round_label": "winner" | "finalist" | "semifinalist" | "quarterfinalist" | "round_16" | "round_32" | "qualy_bonus" | "last_of_qualy" | "q2" | "q1" | string, "points": number }
  ],
  "sponsors": [string]`

interface TournamentRow {
  id: string
  name: string | null
  factsheet_url: string
  // Current state of enrichable columns (used to gate writes)
  [key: string]: unknown
}

function buildEnrichablePrompt(currentState: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [col, spec] of Object.entries(ENRICHABLE)) {
    const v = currentState[col]
    const present = v != null && v !== ''
      && !(typeof v === 'object' && Object.keys(v as object).length === 0)
    let tag: string
    if (!present) {
      tag = '[NULL — propose if PDF confidently provides]'
    } else if (spec.mergeMissing && typeof v === 'object' && !Array.isArray(v)) {
      // Tell Claude what's already there so it doesn't redundantly propose
      // those keys, but explicitly invite it to add any missing keys.
      const existingKeys = Object.keys(v as object).join(', ')
      tag = `[PARTIAL — already has keys: {${existingKeys}}. Propose any MISSING keys you can fill from the PDF. Existing keys are kept.]`
    } else {
      tag = '[ALREADY SET — DO NOT PROPOSE]'
    }
    lines.push(`  - ${col} (${spec.type}) ${tag}\n    ${spec.description}`)
  }
  return lines.join('\n')
}

function buildPrompt(row: TournamentRow): string {
  const currentDescribe: Record<string, unknown> = {}
  for (const col of Object.keys(ENRICHABLE)) currentDescribe[col] = row[col] ?? null

  return `You are enriching a padel tournament row in our database from a factsheet PDF. The factsheet was published by the FIP (International Padel Federation) for this tournament: "${row.name ?? '(unnamed)'}".

CURRENT ROW STATE (for the columns you can propose values for):
${JSON.stringify(currentDescribe, null, 2)}

ENRICHABLE COLUMNS:
${buildEnrichablePrompt(currentDescribe)}

Your job: read the PDF and produce a JSON response of this shape:
{
  "patch": {
    "<column_name>": <value matching its declared type>,
    ...
  },
  "meta": {
${META_SCHEMA}
  }
}

PATCH RULES (strict):
- Propose a value when the column is [NULL] or [PARTIAL].
  - [NULL]: propose the full value the PDF supports.
  - [PARTIAL]: propose the full object including the keys we already have AND any missing keys the PDF supports. The pipeline will merge — existing keys win on conflict, so re-including them is safe.
- Skip [ALREADY SET] columns entirely — we never overwrite scalar data through this path.
- Propose a value ONLY when the PDF gives the answer unambiguously. If you're guessing or inferring weakly, omit the column.
- Match the declared type exactly. Numbers must be plain JSON numbers (no strings, no currency symbols, no thousand separators).
- Return an empty {} for patch if nothing can be confidently filled.

META RULES:
- Always include all meta fields the PDF supports (schedule, prize_money, points, sponsors). Omit a meta key only if completely absent from the PDF.
- All EUR amounts as plain numbers.
- Times as "HH:MM" 24h venue-local.
- round_label values are free-form strings — prefer the enum hints above, but the PDF text is fine if it doesn't fit.

Return ONLY the JSON object. No markdown, no commentary.`
}

function applyPatchGuards(patch: Record<string, unknown>, currentState: Record<string, unknown>): {
  accepted: Record<string, unknown>
  rejected: Array<{ column: string; reason: string }>
} {
  const accepted: Record<string, unknown> = {}
  const rejected: Array<{ column: string; reason: string }> = []
  for (const [col, value] of Object.entries(patch)) {
    const spec = ENRICHABLE[col]
    if (!spec) {
      rejected.push({ column: col, reason: 'not-enrichable' })
      continue
    }
    if (spec.validate && !spec.validate(value)) {
      rejected.push({ column: col, reason: 'validation-failed' })
      continue
    }
    const existing = currentState[col]
    const isEmpty = existing == null || existing === '' ||
      (typeof existing === 'object' && existing !== null && Object.keys(existing as object).length === 0)

    if (isEmpty) {
      accepted[col] = value
      continue
    }

    // Non-empty existing value. Two paths:
    if (spec.mergeMissing && typeof value === 'object' && value !== null && !Array.isArray(value)
        && typeof existing === 'object' && !Array.isArray(existing)) {
      // Merge-missing: keep all existing keys, add only the keys the patch
      // proposes that aren't already set. Existing values always win on
      // conflict — operator/scraper data is preserved.
      const merged: Record<string, unknown> = { ...(existing as Record<string, unknown>) }
      let added = 0
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (merged[k] == null) { merged[k] = v; added++ }
      }
      if (added > 0) accepted[col] = merged
      else rejected.push({ column: col, reason: 'merge-no-new-keys' })
    } else {
      rejected.push({ column: col, reason: 'already-set' })
    }
  }
  return { accepted, rejected }
}

async function processOne(row: TournamentRow): Promise<{ ok: boolean; error?: string; accepted?: string[]; rejected?: Array<{ column: string; reason: string }> }> {
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
          { type: 'text', text: buildPrompt(row) },
        ],
      },
    ],
  })

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim()
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

  let parsed: { patch?: Record<string, unknown>; meta?: Record<string, unknown> }
  try {
    parsed = JSON.parse(cleaned) as typeof parsed
  } catch {
    return { ok: false, error: 'invalid JSON from Claude' }
  }

  const currentState: Record<string, unknown> = {}
  for (const col of Object.keys(ENRICHABLE)) currentState[col] = row[col] ?? null

  const { accepted, rejected } = applyPatchGuards(parsed.patch ?? {}, currentState)

  const update: Record<string, unknown> = {
    factsheet_data: parsed.meta ?? null,
    factsheet_processed_at: new Date().toISOString(),
    ...accepted,
  }

  const { error: updErr } = await supabase
    .from('tournaments')
    .update(update)
    .eq('id', row.id)
  if (updErr) return { ok: false, error: `update failed: ${updErr.message}` }

  return { ok: true, accepted: Object.keys(accepted), rejected }
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

  // Pull tournament rows including the current state of every enrichable
  // column so we can gate writes and tell Claude what's already set.
  const selectCols = ['id', 'name', 'factsheet_url', ...Object.keys(ENRICHABLE)].join(', ')

  let query = supabase
    .from('tournaments')
    .select(selectCols)
    .not('factsheet_url', 'is', null)
    .limit(BATCH_LIMIT)

  if (onlyId) {
    query = query.eq('id', onlyId)
  } else {
    query = query.is('factsheet_processed_at', null)
  }

  const { data: rows, error } = await query
  if (error) return Response.json({ error: error.message }, { status: 500 })

  const candidates = (rows ?? []) as unknown as TournamentRow[]
  const results: Array<{
    tournament: string
    ok: boolean
    error?: string
    accepted?: string[]
    rejected?: Array<{ column: string; reason: string }>
  }> = []
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
