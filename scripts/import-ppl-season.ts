// Imports one Pro Padel League season's STATIC layer: franchises, divisions,
// rosters, events, ties and match skeletons. Scores and per-match statistics
// are Phase 2b and are NOT touched here.
//
// Defaults to a DRY RUN. Pass --apply to write.
// Idempotent: re-running with the same inputs updates in place, never
// duplicates. Modelled on scripts/import-amateur-season.ts.
//
// Usage:
//   npx tsx scripts/import-ppl-season.ts                      # dry run, all 2026 events
//   npx tsx scripts/import-ppl-season.ts --map map.json       # dry run with overrides
//   npx tsx scripts/import-ppl-season.ts --apply --map map.json
//
// --map takes a JSON object of { "<ppl-player-slug>": "<players.id uuid>" }
// used to resolve names that match more than one existing player. --apply
// REFUSES to run while any ambiguity is unmapped.

import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { fetchBuildId, fetchTournament, PPL_USER_AGENT, type Fetcher, type PplTournament } from './lib/ppl-source'
import { classifyRoster, type ExistingPlayer } from './lib/ppl-classify'

const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
}

const APPLY = process.argv.includes('--apply')

function argValue(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null
}

const MAP_FILE = argValue('map')

const SEASON_SLUGS = [
  'new-york-2026',
  'new-york-ppl-ii-2026',
  'los-angeles-2026',
  'los-angeles-ppl-ii-2026',
  'playa-del-carmen-2026',
  'playa-del-carmen-ppl-ii-2026',
  'guadalajara-2026',
  'guadalajara-ppl-ii-2026',
  'miami-2026',
  'miami-ppl-ii-2026',
]

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

const nodeFetch: Fetcher = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': PPL_USER_AGENT } })
  return { status: r.status, text: () => r.text() }
}

async function loadExistingPlayers(): Promise<ExistingPlayer[]> {
  const rows: ExistingPlayer[] = []
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('players')
      .select('id,name,normalized_name,category,tier')
      .range(start, start + 999)
    if (error) throw new Error(`players read failed: ${error.message}`)
    rows.push(...(data as ExistingPlayer[]))
    if (data.length < 1000) break
  }
  return rows
}

async function loadRegisteredSlugs(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let start = 0; ; start += 1000) {
    const { data, error } = await supabase
      .from('entity_external_ids')
      .select('entity_id,external_id')
      .eq('entity_type', 'player')
      .eq('source', 'ppl')
      .range(start, start + 999)
    if (error) throw new Error(`entity_external_ids read failed: ${error.message}`)
    for (const r of data as Array<{ entity_id: string; external_id: string }>) {
      out.set(r.external_id, r.entity_id)
    }
    if (data.length < 1000) break
  }
  return out
}

async function main() {
  console.log(APPLY ? '*** APPLY MODE — this will write ***' : '--- DRY RUN (pass --apply to write) ---')

  const buildId = await fetchBuildId(nodeFetch)
  console.log(`buildId: ${buildId}`)

  const tournaments: PplTournament[] = []
  for (const slug of SEASON_SLUGS) {
    const t = await fetchTournament(nodeFetch, buildId, slug)
    if (!t) { console.log(`  ${slug}: not published yet (404)`); continue }
    console.log(`  ${slug}: ${t.matches.length} matches, ${t.teams.length} teams, league=${t.league}`)
    tournaments.push(t)
  }
  if (tournaments.length === 0) throw new Error('no tournaments fetched — aborting')

  // Roster is the union across events; a player can appear in several.
  const roster = new Map<string, (typeof tournaments)[number]['players'][number]>()
  for (const t of tournaments) for (const p of t.players) if (!roster.has(p.slug)) roster.set(p.slug, p)
  console.log(`\nunique players across payloads: ${roster.size}`)

  const overrides = new Map<string, string>()
  if (MAP_FILE) {
    const raw = JSON.parse(fs.readFileSync(MAP_FILE, 'utf8')) as Record<string, string>
    for (const [k, v] of Object.entries(raw)) overrides.set(k, v)
    console.log(`overrides loaded: ${overrides.size} from ${MAP_FILE}`)
  }

  const [existing, registered] = await Promise.all([loadExistingPlayers(), loadRegisteredSlugs()])
  console.log(`our players: ${existing.length} | already registered by ppl slug: ${registered.size}`)

  const c = classifyRoster([...roster.values()], existing, registered, overrides)

  console.log(`\n=== PLAYERS ===`)
  console.log(`  already linked : ${c.linked.length}`)
  console.log(`  to link        : ${c.toLink.length}`)
  console.log(`  to create      : ${c.toCreate.length}`)
  console.log(`  AMBIGUOUS      : ${c.ambiguous.length}`)

  if (c.toCreate.length > 0) {
    console.log(`\n--- would CREATE ---`)
    for (const x of c.toCreate) console.log(`  ${x.player.name}  (${x.category}, ${x.player.league}, slug=${x.player.slug})`)
  }

  if (c.ambiguous.length > 0) {
    console.log(`\n--- AMBIGUOUS — map these before --apply ---`)
    const suggestion: Record<string, string> = {}
    for (const a of c.ambiguous) {
      console.log(`  "${a.player.name}" (slug=${a.player.slug}) matches ${a.candidates.length}:`)
      for (const cand of a.candidates) console.log(`      ${cand.id}  ${cand.name}  [${cand.category}]`)
      suggestion[a.player.slug] = 'PUT-THE-CORRECT-UUID-HERE'
    }
    console.log(`\n  starter map file:\n${JSON.stringify(suggestion, null, 2)}`)
  }

  const ties = tournaments.reduce((n, t) => n + new Set(t.matches.map((m) => `${m.stage}|${m.sessionNumber}`)).size, 0)
  const totalMatches = tournaments.reduce((n, t) => n + t.matches.length, 0)
  console.log(`\n=== EVENTS ===`)
  console.log(`  tournaments : ${tournaments.length}`)
  console.log(`  ties        : ${ties}`)
  console.log(`  matches     : ${totalMatches}`)

  if (!APPLY) { console.log(`\nDry run complete. Nothing written.`); return }

  if (c.ambiguous.length > 0) {
    throw new Error(`refusing to apply: ${c.ambiguous.length} ambiguous player(s) unmapped. Use --map.`)
  }

  throw new Error('--apply is not implemented yet (Task 4)')
}

main().catch((e) => { console.error(e); process.exit(1) })
