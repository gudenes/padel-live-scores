// One-shot: confirm the two survivor tournament rows look healthy
// post-merge (no orphan FK references, gap-fills landed).

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

function loadEnv() {
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
      return
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const survivors = [
  { id: 'e6d2dc78-8cb6-4c39-b2e1-06f4ffab26ae', label: 'FIP SILVER DAMAC DUBAI (FIP-2026-0802)' },
  { id: '6f16c8d9-04b1-425e-937f-e87cb99a8811', label: 'FIP BRONZE ABU DHABI (FIP-2026-1601)' },
]

const FK_TABLES = [
  { table: 'matches', col: 'tournament_id' },
  { table: 'tournament_draws', col: 'tournament_id' },
  { schema: 'padelgod', table: 'scrape_jobs', col: 'tournament_id' },
  { schema: 'padelgod', table: 'unresolved_players', col: 'tournament_id' },
  { schema: 'padelgod', table: 'draw_snapshots', col: 'tournament_id' },
  { schema: 'padelgod', table: 'entry_list_snapshots', col: 'tournament_id' },
  { schema: 'padelgod', table: 'widget_id_cache', col: 'tournament_id' },
]

async function main() {
  for (const s of survivors) {
    console.log(`\n=== ${s.label} ===`)
    const { data: row } = await supabase
      .from('tournaments')
      .select('id, name, slug, padelapi_id, fip_id, matchscorer_url, cover_image_url, level, country, source')
      .eq('id', s.id)
      .maybeSingle()
    if (!row) {
      console.log('  ! survivor row MISSING')
      continue
    }
    console.log(`  name        ${row.name}`)
    console.log(`  slug        ${row.slug}`)
    console.log(`  padelapi_id ${row.padelapi_id}`)
    console.log(`  fip_id      ${row.fip_id}`)
    console.log(`  matchscorer ${row.matchscorer_url}`)
    console.log(`  cover_image ${row.cover_image_url ? 'set' : 'null'}`)
    console.log(`  source/lvl  ${row.source}/${row.level}/${row.country}`)
    for (const t of FK_TABLES) {
      const q = t.schema ? supabase.schema(t.schema).from(t.table) : supabase.from(t.table)
      const { count } = await q.select('*', { count: 'exact', head: true }).eq(t.col, s.id)
      const label = `${t.schema ? t.schema + '.' : ''}${t.table}`
      console.log(`  ${label.padEnd(34)} ${count ?? 0}`)
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
