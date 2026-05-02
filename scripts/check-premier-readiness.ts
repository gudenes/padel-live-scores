/**
 * Read-only Premier readiness audit for tournaments starting in a 3-day window.
 * Does NOT mutate state. Run before flipping live_source.
 *
 * Usage:
 *   npx tsx scripts/check-premier-readiness.ts
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}
const supa = createClient(url, key, { auth: { persistSession: false } })

const PREMIER_LEVELS = ['p1', 'p2', 'major', 'finals']

async function main() {
  // Q1 — tomorrow's Premier event(s) (window: yesterday → +2d)
  const today = new Date()
  const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString()
  const to = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3).toISOString()

  const { data: tournaments, error: e1 } = await supa
    .from('tournaments')
    .select('id, name, level, live_source, starts_at, ends_at, padelapi_id')
    .in('level', PREMIER_LEVELS)
    .gte('starts_at', from)
    .lte('starts_at', to)
    .order('starts_at', { ascending: true })

  if (e1) {
    console.error('Q1 failed:', e1)
    process.exit(1)
  }

  console.log('\n=== Q1: Premier events starting in window ===')
  console.log(`Window: ${from.slice(0, 10)} → ${to.slice(0, 10)}`)
  if (!tournaments || tournaments.length === 0) {
    console.log('(none)')
    return
  }
  console.table(tournaments)

  // Q2 — readiness gates per tournament
  console.log('\n=== Q2: Readiness gates ===')
  const ids = tournaments.map((t) => t.id)
  const { data: cacheRows, error: e2 } = await supa
    .schema('padelgod' as never)
    .from('widget_id_cache')
    .select('tournament_id, widget_id, is_active')
    .in('tournament_id', ids)

  if (e2) {
    console.error('Q2 widget_id_cache fetch failed:', e2)
  }

  const cacheByTid = new Map<string, { widget_id: string; is_active: boolean }>()
  for (const row of cacheRows ?? []) cacheByTid.set(row.tournament_id, row as never)

  const gateRows = tournaments.map((t) => {
    const c = cacheByTid.get(t.id)
    const widgetActive = !!c?.is_active
    const liveSrc = t.live_source
    let status = '🔴 NOT READY'
    if (liveSrc === 'padelgod' && widgetActive) status = '✅ READY (canonical)'
    else if (liveSrc !== 'padelgod' && widgetActive) status = '⚠️  shadow only — flip live_source=padelgod'
    else if (liveSrc === 'padelgod' && !widgetActive) status = '⚠️  flag set, no widget_id_cache row'
    return {
      tournament: t.name,
      live_source: liveSrc,
      widget_id: c?.widget_id ?? '(none)',
      widget_active: widgetActive,
      status,
    }
  })
  console.table(gateRows)

  // Q3 — what live-poller-manager will pick up
  console.log('\n=== Q3: padelgod_tournaments_for_live_polling() ===')
  const { data: pollerRows, error: e3 } = await supa.rpc('padelgod_tournaments_for_live_polling')
  if (e3) {
    console.error('Q3 RPC failed:', e3)
  } else {
    const matching = (pollerRows ?? []).filter((r: { tournament_id: string }) =>
      ids.includes(r.tournament_id),
    )
    if (matching.length === 0) {
      console.log('(none of our Premier candidates are in the live-polling list)')
    } else {
      console.table(matching)
    }
  }

  // Q7 — premierpadel link presence on existing matches
  console.log('\n=== Q7: Premier match-stats linkage (entity_external_ids[premierpadel]) ===')
  for (const t of tournaments) {
    const { data: matches, error: em } = await supa
      .from('matches')
      .select('id, status, scheduled_at, court, padelapi_id')
      .eq('tournament_id', t.id)
      .order('scheduled_at', { ascending: true, nullsFirst: false })
    if (em) {
      console.error(`  match fetch failed for ${t.name}:`, em.message)
      continue
    }
    const matchIds = (matches ?? []).map((m) => m.id)
    const { data: links, error: el } = await supa
      .from('entity_external_ids')
      .select('entity_id')
      .eq('entity_type', 'match')
      .eq('source', 'premierpadel')
      .in('entity_id', matchIds.length ? matchIds : ['00000000-0000-0000-0000-000000000000'])
    if (el) {
      console.error(`  link fetch failed for ${t.name}:`, el.message)
      continue
    }
    const linked = new Set((links ?? []).map((l) => l.entity_id))
    const total = matches?.length ?? 0
    const linkedCount = matchIds.filter((id) => linked.has(id)).length
    console.log(
      `  ${t.name}: ${total} matches, ${linkedCount} with premierpadel link${
        total > 0 && linkedCount === 0 ? '  ← discovery has not run yet' : ''
      }`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
