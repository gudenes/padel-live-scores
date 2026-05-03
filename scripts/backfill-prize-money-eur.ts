/**
 * Backfill tournaments.prize_money_eur + prize_money_eur_source from
 * existing prize_money (text) and prize_money_fip (int) columns.
 *
 * Scope: tournaments with ends_at >= 2024-01-01.
 *
 * Priority:
 *   1. prize_money_fip > 100  → use it.                source = 'fip_int'
 *   2. parsePrizeMoneyText(prize_money) → if not null   source = 'parsed_text'
 *      - EUR amount stored directly
 *      - USD amount converted at FIXED_USD_EUR rate (historical mid-rate)
 *      - OTHER currency → skipped (logged as suspicious)
 *   3. else → leave NULL.
 *
 * Idempotent: skips rows where prize_money_eur is already set.
 *
 * Usage:
 *   npx tsx scripts/backfill-prize-money-eur.ts            # dry run (default)
 *   npx tsx scripts/backfill-prize-money-eur.ts --apply    # write
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parsePrizeMoneyText } from '../src/lib/prize-money-parser'

// Lightweight .env.local loader — same shape as scripts/audit-thin-matches.ts
function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch { /* fine */ }
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
  { auth: { persistSession: false } },
)

// One-time historical conversion rate for the handful of legacy USD events.
// Not a runtime FX system — we store EUR end-state. Spec decision: "store
// in EUR, manually convert if needed." 1 USD ≈ 0.92 EUR (2024-2026 average).
const FIXED_USD_EUR = 0.92

// >100 floor on prize_money_fip — observed pollution: many rows have
// €40 (looks like the FIP scraper picked up entry fees). Anything ≤ 100 is
// almost certainly not a real prize pool.
const FIP_INT_MIN = 100

const APPLY = process.argv.includes('--apply')

type TournamentRow = {
  id: string
  name: string
  level: string | null
  ends_at: string | null
  prize_money: string | null
  prize_money_fip: number | null
  prize_money_eur: number | null
}

type PlannedUpdate = {
  id: string
  name: string
  level: string | null
  amount_eur: number
  source: 'fip_int' | 'parsed_text'
  // diagnostic context, not written
  raw_text: string | null
  raw_fip_int: number | null
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  // 1. Load candidate rows
  const { data, error } = await supabase
    .from('tournaments')
    .select('id, name, level, ends_at, prize_money, prize_money_fip, prize_money_eur')
    .gte('ends_at', '2024-01-01')
    .lt('ends_at', new Date().toISOString())
    .is('prize_money_eur', null)
    .order('ends_at', { ascending: false })
    .limit(5000)
    .returns<TournamentRow[]>()

  if (error) throw new Error(`tournaments read: ${error.message}`)
  const rows = data ?? []
  console.log(`Candidate tournaments (ends_at in [2024-01-01, today), prize_money_eur IS NULL): ${rows.length}`)

  // 2. Compute planned updates
  const planned: PlannedUpdate[] = []
  const skipped: { id: string; name: string; reason: string }[] = []
  const suspicious: { id: string; name: string; reason: string }[] = []

  for (const r of rows) {
    // Priority 1: prize_money_fip if above the entry-fee floor
    if (r.prize_money_fip != null && r.prize_money_fip > FIP_INT_MIN) {
      planned.push({
        id: r.id, name: r.name, level: r.level,
        amount_eur: r.prize_money_fip, source: 'fip_int',
        raw_text: r.prize_money, raw_fip_int: r.prize_money_fip,
      })
      continue
    }

    // Priority 2: parse the text column
    if (r.prize_money) {
      const parsed = parsePrizeMoneyText(r.prize_money)
      if (parsed == null) {
        skipped.push({ id: r.id, name: r.name, reason: `unparseable: "${r.prize_money}"` })
        continue
      }
      let eur: number
      if (parsed.currency === 'EUR') {
        eur = parsed.amount
      } else if (parsed.currency === 'USD') {
        eur = Math.round(parsed.amount * FIXED_USD_EUR)
      } else {
        skipped.push({ id: r.id, name: r.name, reason: `unknown currency: "${r.prize_money}"` })
        continue
      }
      // Upstream pollution: many tournaments carry "EUR 0" / "USD 0" as a
      // placeholder before real prize data is published. Don't write 0 to
      // the column — that would lock in a false "amateur event" signal.
      // Leave NULL so the row stays a candidate for the next backfill run
      // (or a manual override via the ops UI).
      if (eur === 0) {
        skipped.push({ id: r.id, name: r.name, reason: `zero value (likely placeholder): "${r.prize_money}"` })
        continue
      }
      // Sanity-check obviously wrong values
      if (eur > 5_000_000) {
        suspicious.push({ id: r.id, name: r.name, reason: `>€5M: ${eur} from "${r.prize_money}"` })
      }
      if (eur < 500 && r.level && !['fip_bronze', 'fip_promises', 'fip_other'].includes(r.level)) {
        suspicious.push({ id: r.id, name: r.name, reason: `<€500 on ${r.level}: ${eur} from "${r.prize_money}"` })
      }
      planned.push({
        id: r.id, name: r.name, level: r.level,
        amount_eur: eur, source: 'parsed_text',
        raw_text: r.prize_money, raw_fip_int: r.prize_money_fip,
      })
      continue
    }

    // Priority 3: nothing usable
    skipped.push({ id: r.id, name: r.name, reason: 'no prize_money or prize_money_fip' })
  }

  // 3. Report
  const bySource: Record<string, number> = {}
  for (const p of planned) bySource[p.source] = (bySource[p.source] ?? 0) + 1

  console.log(`\nPlanned updates: ${planned.length}`)
  console.log(`  by source: ${JSON.stringify(bySource)}`)
  console.log(`Skipped: ${skipped.length}`)
  console.log(`Suspicious values flagged for review: ${suspicious.length}`)

  if (suspicious.length > 0) {
    console.log('\nSuspicious values (review before --apply):')
    for (const s of suspicious.slice(0, 30)) {
      console.log(`  [${s.id.slice(0, 8)}] ${s.name} — ${s.reason}`)
    }
    if (suspicious.length > 30) console.log(`  …and ${suspicious.length - 30} more`)
  }

  if (skipped.length > 0 && skipped.length <= 30) {
    console.log('\nSkipped reasons:')
    for (const s of skipped) console.log(`  [${s.id.slice(0, 8)}] ${s.name} — ${s.reason}`)
  } else if (skipped.length > 0) {
    console.log(`\n(${skipped.length} skipped rows — too many to print; first 10):`)
    for (const s of skipped.slice(0, 10)) console.log(`  [${s.id.slice(0, 8)}] ${s.name} — ${s.reason}`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply to write.')
    return
  }

  // 4. Write in chunks of 500 (Supabase row-size friendly)
  const CHUNK = 500
  let written = 0
  for (let i = 0; i < planned.length; i += CHUNK) {
    const chunk = planned.slice(i, i + CHUNK)
    // upsert one-by-one inside a Promise.all is fine for ~hundreds of rows;
    // we don't need a single bulk update because each row needs distinct
    // values. Sequential .update() calls keep error reporting clean.
    for (const p of chunk) {
      const { error: uErr } = await supabase
        .from('tournaments')
        .update({ prize_money_eur: p.amount_eur, prize_money_eur_source: p.source })
        .eq('id', p.id)
      if (uErr) {
        console.error(`  WRITE FAIL [${p.id.slice(0, 8)}] ${p.name}: ${uErr.message}`)
        continue
      }
      written++
    }
    console.log(`  wrote ${Math.min(i + CHUNK, planned.length)} / ${planned.length}`)
  }
  console.log(`\nWrote ${written} rows.`)
}

main().catch(e => { console.error(e); process.exit(1) })
