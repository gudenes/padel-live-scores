// scripts/audit-unranged-selects.ts
//
// Advisory linter. Scans the codebase for `.from('TABLE').select(...)`
// chains against tables that can plausibly exceed PostgREST's
// `db_max_rows` cap (currently 10,000 on this project). Flags files
// that don't use `.limit(...)` / `.range(...)` / `paginatedSelect()`
// inside the same call so a reviewer can decide whether the read is
// safe (single-row, small per-tournament slice) or genuinely unbounded
// (cross-tournament aggregation).
//
// This is NOT a hard CI gate — too many false positives (e.g. queries
// keyed by `id=eq.X` are obviously bounded). It's a triage tool. Run
// after touching any file that reads from one of the watched tables:
//
//   npx tsx scripts/audit-unranged-selects.ts
//
// Or pin to a specific table:
//
//   npx tsx scripts/audit-unranged-selects.ts entry_list_snapshots
//
// Output is grouped by table → file → line for easy scanning.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

// Tables that can grow past the 10k cap in production. Pulled from
// the audit done 2026-04-29 (CLAUDE.md → "PostgREST 1k cap"). Add
// new tables here as their row counts cross the threshold.
const WATCHED_TABLES = [
  // padelgod staging tables — all accumulate over time per tournament
  'entry_list_snapshots',
  'draw_snapshots',
  'oop_snapshots',
  'results_snapshots',
  'scrape_jobs',
  // public tables — large global scans are the risk; per-id reads fine
  'matches',
  'players',
  'tournaments',
  'entity_external_ids',
  'articles',
]

// Source roots scanned. Skip generated + dependency dirs.
const ROOTS = ['src', 'padelgod/src']
const SKIP_PATH_FRAGMENTS = ['node_modules', 'dist', '.next', '__tests__']

// Patterns that mean "this read is bounded" — if any appear in the
// surrounding ~6 lines after a `.from(table)` we treat the call site
// as OK and don't flag it.
const BOUND_HINTS = [
  /\.limit\(/,
  /\.range\(/,
  /paginatedSelect\b/,
  /\.maybeSingle\(/,
  /\.single\(/,
  // Equality on a unique identifier — almost always returns ≤1 row.
  /\.eq\(['"`]id['"`]/,
  /\.eq\(['"`].*_id['"`]/,
]

interface Hit {
  table: string
  file: string
  line: number
  snippet: string
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (SKIP_PATH_FRAGMENTS.some((s) => entry.includes(s))) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) {
      out.push(...listFiles(full))
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

function scan(filter?: string): Hit[] {
  const tables = filter ? [filter] : WATCHED_TABLES
  const hits: Hit[] = []

  for (const root of ROOTS) {
    let files: string[]
    try {
      files = listFiles(root)
    } catch {
      continue // root doesn't exist (e.g. running outside repo root)
    }

    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      const lines = text.split('\n')

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!
        for (const table of tables) {
          // Match either single or double quotes; support .from() and
          // .schema('padelgod').from() patterns.
          const re = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)`)
          if (!re.test(line)) continue

          // Look at this line + next 8 for any "bounded" signal.
          const window = lines.slice(i, i + 9).join('\n')
          if (BOUND_HINTS.some((h) => h.test(window))) continue

          hits.push({
            table,
            file,
            line: i + 1,
            snippet: line.trim(),
          })
        }
      }
    }
  }
  return hits
}

function report(hits: Hit[]): void {
  if (hits.length === 0) {
    console.log('✓ No unranged selects detected against watched tables.')
    return
  }

  // Group by table → file
  const byTable = new Map<string, Hit[]>()
  for (const h of hits) {
    const arr = byTable.get(h.table) ?? []
    arr.push(h)
    byTable.set(h.table, arr)
  }

  console.log(`\nFound ${hits.length} potentially-unranged select(s):\n`)
  for (const [table, tHits] of [...byTable.entries()].sort()) {
    console.log(`── ${table} (${tHits.length}) ──`)
    for (const h of tHits) {
      const rel = relative(process.cwd(), h.file)
      console.log(`  ${rel}:${h.line}`)
      console.log(`    ${h.snippet}`)
    }
    console.log()
  }
  console.log(
    'Heuristic only — equality on `id`, `*_id`, `.single()`, `.maybeSingle()`, ' +
      '`.limit()`, `.range()`, and `paginatedSelect()` are treated as bounded. ' +
      'Other patterns (e.g. `.eq(\'category\', x)`) may still be safe in context. ' +
      'Use this as a triage tool, not a CI gate.',
  )
}

const filter = process.argv[2]
report(scan(filter))
