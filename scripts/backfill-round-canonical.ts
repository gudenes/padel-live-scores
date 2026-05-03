/**
 * Backfill matches.round_canonical from matches.round using
 * src/lib/round-canonical.ts::roundCanonical().
 *
 * Idempotent: skips matches where round_canonical is already set.
 *
 * Reports unmappable round labels at the end — extend the helper if
 * any of them are real rounds we should support.
 *
 * Usage:
 *   npx tsx scripts/backfill-round-canonical.ts            # dry run
 *   npx tsx scripts/backfill-round-canonical.ts --apply    # write
 */

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { roundCanonical, type RoundCode } from '../src/lib/round-canonical'
import { paginatedSelect } from '../src/lib/db-paginate'

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

const APPLY = process.argv.includes('--apply')

type MatchRow = { id: string; round: string | null }

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`)

  // 1. Load candidates — paginated because matches is the largest table
  const rows = await paginatedSelect<MatchRow>(
    (start, end) =>
      supabase
        .from('matches')
        .select('id, round')
        .not('round', 'is', null)
        .is('round_canonical', null)
        .range(start, end),
    { what: 'matches needing round_canonical', maxRows: 200_000 },
  )
  console.log(`Candidate matches (round NOT NULL, round_canonical IS NULL): ${rows.length}`)

  // 2. Bucket by canonical code + collect unmappable labels
  const planned: { id: string; canonical: RoundCode }[] = []
  const unmappable = new Map<string, number>()

  for (const r of rows) {
    const c = roundCanonical(r.round)
    if (c == null) {
      const k = r.round ?? '(null)'
      unmappable.set(k, (unmappable.get(k) ?? 0) + 1)
    } else {
      planned.push({ id: r.id, canonical: c })
    }
  }

  // 3. Report
  const byCode: Record<string, number> = {}
  for (const p of planned) byCode[p.canonical] = (byCode[p.canonical] ?? 0) + 1
  console.log(`\nPlanned updates: ${planned.length}`)
  console.log(`  by canonical code: ${JSON.stringify(byCode)}`)
  console.log(`Unmappable labels: ${unmappable.size} distinct (${[...unmappable.values()].reduce((a,b)=>a+b, 0)} matches)`)

  if (unmappable.size > 0) {
    console.log('\nUnmappable round labels (extend src/lib/round-canonical.ts if real):')
    const sorted = [...unmappable.entries()].sort((a, b) => b[1] - a[1])
    for (const [label, n] of sorted.slice(0, 30)) {
      console.log(`  ${n.toString().padStart(6)}  "${label}"`)
    }
    if (sorted.length > 30) console.log(`  …and ${sorted.length - 30} more distinct labels`)
  }

  if (!APPLY) {
    console.log('\nDRY RUN. Re-run with --apply to write.')
    return
  }

  // 4. Write — group by canonical code so each batch is one UPDATE ... WHERE id IN (...)
  console.log('')
  let written = 0
  for (const code of Object.keys(byCode) as RoundCode[]) {
    const ids = planned.filter(p => p.canonical === code).map(p => p.id)
    // Chunk IN(...) lists to keep the URL length sane (PostgREST gets cranky past ~2000)
    const CHUNK = 500
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK)
      const { error: uErr } = await supabase
        .from('matches')
        .update({ round_canonical: code })
        .in('id', slice)
      if (uErr) {
        console.error(`  WRITE FAIL ${code} chunk ${i}: ${uErr.message}`)
        continue
      }
      written += slice.length
      console.log(`  ${code}: wrote ${Math.min(i + CHUNK, ids.length)} / ${ids.length}`)
    }
  }
  console.log(`\nWrote ${written} rows.`)
}

main().catch(e => { console.error(e); process.exit(1) })
