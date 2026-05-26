// scripts/probe-matchscorer-dupes.ts
//
// One-shot probe: find tournaments that share a matchscorer_url. Prints
// the pair with the FK fan-out so we can decide how to merge them.
//
// Usage:
//   node --experimental-strip-types scripts/probe-matchscorer-dupes.ts                   # all dupes
//   node --experimental-strip-types scripts/probe-matchscorer-dupes.ts FIP-2026-1601    # one code

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
  // Walk up from cwd looking for .env.local — handles worktree runs.
  let dir = process.cwd()
  for (let i = 0; i < 6; i++) {
    const p = path.join(dir, '.env.local')
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8')
      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const eq = trimmed.indexOf('=')
        if (eq === -1) continue
        const key = trimmed.slice(0, eq).trim()
        const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
        if (!process.env[key]) process.env[key] = value
      }
      return p
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}
const envPath = loadEnv()
if (!envPath) {
  console.error('Could not find .env.local in cwd or any parent')
  process.exit(1)
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY)

const FK_TABLES: Array<{ table: string; col: string; schema?: string }> = [
  { table: 'matches', col: 'tournament_id' },
  { table: 'tournament_draws', col: 'tournament_id' },
  { table: 'highlights', col: 'tournament_id' },
  { table: 'scrape_jobs', col: 'tournament_id', schema: 'padelgod' },
  { table: 'draw_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'results_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'oop_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'entry_list_snapshots', col: 'tournament_id', schema: 'padelgod' },
  { table: 'widget_id_cache', col: 'tournament_id', schema: 'padelgod' },
]

async function main() {
  const filterCode = process.argv[2] ?? null

  console.log(`Loaded env from ${envPath}`)
  console.log(`Filter: ${filterCode ?? '(all dupes)'}`)
  console.log()

  let query = supabase
    .from('tournaments')
    .select('id, name, slug, source, fip_id, padelapi_id, matchscorer_url, level, country, starts_at, ends_at, created_at, updated_at, last_updated_by')
    .not('matchscorer_url', 'is', null)
  if (filterCode) {
    query = query.eq('matchscorer_url', filterCode)
  }

  const { data: rows, error } = await query
  if (error) {
    console.error('Failed:', error)
    process.exit(1)
  }

  // Group by matchscorer_url, keep groups with >1 row
  const groups = new Map<string, typeof rows>()
  for (const r of rows ?? []) {
    const k = r.matchscorer_url as string
    if (!groups.has(k)) groups.set(k, [] as any)
    groups.get(k)!.push(r)
  }

  let dupCount = 0
  for (const [code, list] of groups) {
    if (list.length < 2) continue
    dupCount++
    console.log(`\n=== matchscorer_url=${code} — ${list.length} rows ===`)
    for (const t of list) {
      const fk: Record<string, number> = {}
      for (const tbl of FK_TABLES) {
        const q = tbl.schema ? supabase.schema(tbl.schema).from(tbl.table) : supabase.from(tbl.table)
        const { count } = await q.select('*', { count: 'exact', head: true }).eq(tbl.col, t.id as string)
        const label = `${tbl.schema ? tbl.schema + '.' : ''}${tbl.table}`
        if ((count ?? 0) > 0) fk[label] = count!
      }
      console.log(`  id           ${t.id}`)
      console.log(`  name         ${t.name}`)
      console.log(`  slug         ${t.slug}`)
      console.log(`  source       ${t.source}`)
      console.log(`  fip_id       ${t.fip_id}`)
      console.log(`  padelapi_id  ${t.padelapi_id}`)
      console.log(`  level        ${t.level}`)
      console.log(`  country      ${t.country}`)
      console.log(`  starts_at    ${t.starts_at}`)
      console.log(`  ends_at      ${t.ends_at}`)
      console.log(`  created_at   ${t.created_at}`)
      console.log(`  updated_at   ${t.updated_at}`)
      console.log(`  last_updated_by  ${t.last_updated_by}`)
      const fkStr = Object.entries(fk).map(([k, n]) => `${k}=${n}`).join(', ')
      console.log(`  FK fan-out   ${fkStr || '(none)'}`)
      console.log()
    }
  }

  if (filterCode && dupCount === 0) {
    console.log(`No duplicates found for ${filterCode}`)
  } else if (!filterCode) {
    console.log(`\n=== Summary: ${dupCount} matchscorer_url codes with >1 tournament ===`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
