/**
 * For the 12 OOP-finished but DB-open matches, dump anything in
 * padelgod.results_snapshots so we know whether a real result is available.
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnv() {
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^"(.*)"$/, '$1')
    }
  } catch {}
}
loadEnv()

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

const TOURNAMENT_ID = '8a47598a-579b-4503-88c2-135306d274fb'
const WIDGETS = [
  'MD029','WD028','MD019','MD028','WD029','MD020',
  'WD025','MD022','MD021','WD030','MD017','MD018',
]

async function main() {
  // Show schemas of results tables
  const { data: cols } = await supabase.rpc('exec_sql' as any, { sql: '' }).then(() => ({ data: null })).catch(() => ({ data: null }))

  // Try padelgod.results_snapshots first
  const { data, error } = await supabase
    .schema('padelgod')
    .from('results_snapshots')
    .select('*')
    .eq('tournament_id', TOURNAMENT_ID)
    .order('captured_at', { ascending: false })
    .limit(500)
  if (error) {
    console.error('results_snapshots error:', error.message)
  } else {
    console.log(`results_snapshots rows for tournament: ${data?.length ?? 0}`)
    if (data && data.length > 0) {
      // Inspect first row to see columns
      console.log('columns:', Object.keys(data[0]).join(', '))
      console.log('latest captured_at:', data[0].captured_at)
      // Latest per match_widget_id
      const latest = new Map<string, any>()
      for (const r of data) {
        const wid = r.match_widget_id
        if (!wid) continue
        if (!latest.has(wid)) latest.set(wid, r)
      }
      console.log(`unique widgets with results: ${latest.size}`)
      for (const w of WIDGETS) {
        const r = latest.get(w)
        if (!r) { console.log(`  ${w}: no results_snapshots row`); continue }
        console.log(`  ${w}: status=${r.status} winner_pair=${r.winner_pair ?? r.winner ?? '?'} set_scores=${JSON.stringify(r.set_scores ?? r.sets ?? r.score)}`)
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
