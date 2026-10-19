// Run with node --env-file=.env.local scripts/reconcile-legacy-rankings-20261019.mjs
// Default is a read-only plan. --apply=<saved-plan.json> applies guarded patches.
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const normalize = value => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
const country = code => ({ POR: 'PT', ESP: 'ES', ARG: 'AR', BRA: 'BR', MEX: 'MX', GBR: 'GB' }[code] ?? code)
const apply = process.argv.find(arg => arg.startsWith('--apply='))?.slice(8)
if (apply) {
  const plan = JSON.parse(readFileSync(apply, 'utf8'))
  if (!plan.complete) throw new Error('Refusing incomplete audit plan')
  let updated = 0
  for (const item of plan.items) {
    if (!item.patch) continue
    // Do not overwrite a record that changed since review, or attach an occupied ID.
    if (item.patch.fip_id) {
      const owner = await db.from('players').select('id').eq('fip_id', item.patch.fip_id)
      if (owner.error || owner.data.length) throw new Error(`FIP ID already owned: ${item.before.name}`)
    }
    let query = db.from('players').update(item.patch).eq('id', item.before.id).is('fip_id', null).eq('ranking', item.before.ranking)
    query = item.before.updated_at ? query.eq('updated_at', item.before.updated_at) : query.is('updated_at', null)
    const result = await query.select('id')
    if (result.error || result.data.length !== 1) throw new Error(`Concurrent change or failed update: ${item.before.name}`)
    updated++
  }
  console.log(JSON.stringify({ updated, backup: apply }))
} else {
  const result = await db.from('players').select('*').is('fip_id', null).gt('ranking', 0).lte('ranking', 1000).order('ranking')
  if (result.error) throw result.error
  const items = []
  mkdirSync('tmp/ranking-reconciliation', { recursive: true })
  const path = `tmp/ranking-reconciliation/plan-${Date.now()}.json`
  for (const before of result.data) {
    await new Promise(resolve => setTimeout(resolve, 1100))
    const response = await fetch('https://www.padelfip.com/wp-json/fip/v1/player/search?q=' + encodeURIComponent(before.name))
    const search = response.ok ? await response.json() : { error: 'No result Found' }
    const lookupStatus = response.status
    if (!Array.isArray(search) && search.error !== 'No result Found') throw new Error('Unexpected FIP response')
    const hits = Array.isArray(search) ? search : []
    const exact = hits.filter(hit => normalize(`${hit.name} ${hit.surname}`) === normalize(before.name)
      && country(hit.nationality) === before.country && hit.gender === (before.category === 'men' ? 'male' : 'female')
      && hit.category === 'master')
    const history = await db.from('player_ranking_snapshots').select('id').eq('player_id', before.id).eq('type', 'official').limit(1)
    if (history.error) throw history.error
    let patch = null
    let reason = 'Has verified ranking history; requires separate review'
    if (!history.data.length) {
      // Retain identity and all relationships; withdraw only unsupported official scores.
      patch = { ranking: null, points: null, ranking_move: null, points_move: null }
      reason = 'Withdraw unverified legacy ranking; identity unresolved'
      if (exact.length === 1) {
        const hit = exact[0]
        const owner = await db.from('players').select('id,name').eq('fip_id', hit.player_id)
        if (owner.error) throw owner.error
        if (owner.data.length) reason = `FIP identity already represented by ${owner.data[0].id}; do not merge automatically`
        else if (Number.isInteger(hit.rank) && hit.rank > 0 && Number.isInteger(hit.points) && hit.year === 2026 && hit.week_no === 43) {
          patch = { ...patch, fip_id: hit.player_id, profile_url: hit.url, ranking: hit.rank, points: hit.points, ranking_move: hit.move,
            ranking_date: '2026-10-19T00:00:00Z' }
          reason = 'Exact unique name, country, gender and current FIP week'
        }
      }
      patch.updated_at = new Date().toISOString()
    }
    items.push({ before, candidates: hits, lookupStatus, reason, patch })
    writeFileSync(path, JSON.stringify({ createdAt: new Date().toISOString(), complete: false, items }, null, 2))
    console.log(JSON.stringify({ name: before.name, rank: before.ranking, reason, newRank: patch?.ranking }))
  }
  writeFileSync(path, JSON.stringify({ createdAt: new Date().toISOString(), complete: true, items }, null, 2))
  console.log(`PLAN=${path}`)
}
