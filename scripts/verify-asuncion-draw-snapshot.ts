// scripts/verify-asuncion-draw-snapshot.ts
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
const TID = '5027936c-9fd5-4309-83e7-44ee4620a207'
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false } })

async function main() {
  const { count, error } = await s
    .schema('padelgod' as never)
    .from('draw_snapshots')
    .select('*', { count: 'exact', head: true })
    .eq('tournament_id', TID)
  if (error) throw error
  console.log(`draw_snapshots for Asuncion: ${count} rows`)

  const { data: latest } = await s
    .schema('padelgod' as never)
    .from('draw_snapshots')
    .select('captured_at, category, draw_type, round, position')
    .eq('tournament_id', TID)
    .order('captured_at', { ascending: false })
    .limit(5)
  console.table(latest)

  if ((count ?? 0) === 0) {
    console.error('GATE FAIL: no draw snapshots for Asuncion. Wait for next :20 draw-fetcher run, then retry.')
    process.exit(1)
  }
  console.log('GATE PASS')
}
main().catch((e) => { console.error(e); process.exit(1) })
