// scripts/import-amateur-season.ts
//
// Imports one amateur team season from three CSVs into the team model.
//
//   npx tsx scripts/import-amateur-season.ts --dir ./import/blue-padel-25-26 \
//     --team-slug blue-padel-mataro --team-name "Blue Padel Mataró" \
//     --season 25/26 --source snp --external-id blue-padel-mataro-2526
//
// Defaults to a dry run. Pass --apply to write.
// Idempotent: re-running with the same inputs updates in place, never
// duplicates. Conflict keys match the unique constraints in the migration.

import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { parsePlayersCsv, parseFixturesCsv, parseSlotsCsv } from './lib/amateur-csv'

const envText = fs.readFileSync('.env.local', 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/i)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  if (fallback !== undefined) return fallback
  throw new Error(`Missing required --${name}`)
}

const APPLY = process.argv.includes('--apply')
const DIR = arg('dir')
const TEAM_SLUG = arg('team-slug')
const TEAM_NAME = arg('team-name')
const SEASON_LABEL = arg('season')
const SOURCE = arg('source', 'manual')
const EXTERNAL_ID = arg('external-id', TEAM_SLUG)
const COMPETITION = arg('competition', '')
const CATEGORY = arg('category', 'men')
const NOTES = arg('notes', '')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!,
)

/** Same normalisation the players table uses for normalized_name. */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

async function main() {
  const players = parsePlayersCsv(fs.readFileSync(path.join(DIR, 'players.csv'), 'utf8'))
  const fixtures = parseFixturesCsv(fs.readFileSync(path.join(DIR, 'fixtures.csv'), 'utf8'))
  const slots = parseSlotsCsv(fs.readFileSync(path.join(DIR, 'slots.csv'), 'utf8'))

  // Every name referenced anywhere must exist in players.csv, or the roster
  // and the line-ups would disagree.
  const known = new Set(players.map(p => normalize(p.name)))
  const orphans = [...new Set(slots.flatMap(s => s.playerNames))].filter(n => !known.has(normalize(n)))
  if (orphans.length > 0) {
    throw new Error(`Names in slots.csv missing from players.csv: ${orphans.join(', ')}`)
  }
  const fixtureCodes = new Set(fixtures.map(f => f.code))
  const badSlots = slots.filter(s => !fixtureCodes.has(s.fixtureCode))
  if (badSlots.length > 0) {
    throw new Error(`Slots reference unknown fixtures: ${[...new Set(badSlots.map(s => s.fixtureCode))].join(', ')}`)
  }

  // Match existing players by normalized name; the rest get created as amateurs.
  const { data: existing } = await supabase
    .from('players')
    .select('id, name, normalized_name, tier')
    .in('normalized_name', players.map(p => normalize(p.name)))

  const idByNormalized = new Map<string, string>()
  for (const row of existing ?? []) {
    if (row.normalized_name) idByNormalized.set(row.normalized_name, row.id)
  }
  const toCreate = players.filter(p => !idByNormalized.has(normalize(p.name)))

  console.log(`Team:      ${TEAM_NAME} (${TEAM_SLUG})`)
  console.log(`Season:    ${SEASON_LABEL}`)
  console.log(`Players:   ${players.length} — ${players.length - toCreate.length} matched, ${toCreate.length} to create`)
  console.log(`Fixtures:  ${fixtures.length}`)
  console.log(`Slots:     ${slots.length}`)
  if (toCreate.length > 0) console.log(`Creating:  ${toCreate.map(p => p.name).join(', ')}`)
  const matched = players.filter(p => idByNormalized.has(normalize(p.name)))
  if (matched.length > 0) {
    console.log(`Matched:   ${matched.map(p => {
      const row = (existing ?? []).find(r => r.normalized_name === normalize(p.name))
      return `${p.name} (existing id=${row?.id}, tier=${row?.tier})`
    }).join(', ')}`)
  }

  if (!APPLY) {
    console.log('\nDry run — nothing written. Re-run with --apply to commit.')
    return
  }

  for (const p of toCreate) {
    const { data, error } = await supabase
      .from('players')
      .insert({ name: p.name, tier: 'amateur', side: p.side, home_club: p.homeClub, category: CATEGORY })
      .select('id')
      .single()
    if (error || !data) throw new Error(`Failed to create ${p.name}: ${error?.message}`)
    idByNormalized.set(normalize(p.name), data.id)
  }

  const { data: team, error: teamErr } = await supabase
    .from('teams')
    .upsert(
      { slug: TEAM_SLUG, name: TEAM_NAME, competition: COMPETITION || null, category: CATEGORY, source: SOURCE, external_id: EXTERNAL_ID },
      { onConflict: 'source,external_id' },
    )
    .select('id')
    .single()
  if (teamErr || !team) throw new Error(`Failed to upsert team: ${teamErr?.message}`)

  const complete = fixtures.filter(f => f.complete)
  const { data: season, error: seasonErr } = await supabase
    .from('team_seasons')
    .upsert(
      {
        team_id: team.id,
        label: SEASON_LABEL,
        notes: NOTES || null,
        ties_played: complete.length,
        ties_won: complete.filter(f => f.result === 'W').length,
        points_for: complete.reduce((a, f) => a + (f.pointsFor ?? 0), 0),
        points_against: complete.reduce((a, f) => a + (f.pointsAgainst ?? 0), 0),
        courts_won: complete.reduce((a, f) => a + (f.courtsWon ?? 0), 0),
        courts_lost: complete.reduce((a, f) => a + (f.courtsLost ?? 0), 0),
      },
      { onConflict: 'team_id,label' },
    )
    .select('id')
    .single()
  if (seasonErr || !season) throw new Error(`Failed to upsert season: ${seasonErr?.message}`)

  for (const p of players) {
    const playerId = idByNormalized.get(normalize(p.name))!
    const { error } = await supabase.from('team_memberships').upsert(
      {
        team_season_id: season.id, player_id: playerId,
        competition_points: p.competitionPoints, competition_rank: p.competitionRank,
        roster_rank: p.rosterRank, games_played: p.gamesPlayed, wins: p.wins, losses: p.losses,
      },
      { onConflict: 'team_season_id,player_id' },
    )
    if (error) throw new Error(`Failed to upsert membership for ${p.name}: ${error.message}`)
  }

  const fixtureIdByCode = new Map<string, string>()
  for (const f of fixtures) {
    const { data, error } = await supabase.from('team_fixtures').upsert(
      {
        team_season_id: season.id, code: f.code, label: f.label, sort_order: f.sortOrder,
        complete: f.complete, result: f.result, points_for: f.pointsFor,
        points_against: f.pointsAgainst, courts_won: f.courtsWon, courts_lost: f.courtsLost,
        opponent_name: f.opponentName,
      },
      { onConflict: 'team_season_id,code' },
    ).select('id').single()
    if (error || !data) throw new Error(`Failed to upsert fixture ${f.code}: ${error?.message}`)
    fixtureIdByCode.set(f.code, data.id)
  }

  for (const s of slots) {
    const fixtureId = fixtureIdByCode.get(s.fixtureCode)!
    const { data, error } = await supabase.from('team_fixture_slots').upsert(
      {
        fixture_id: fixtureId, label: s.label, worth: s.worth, slot_group: s.slotGroup,
        result: s.result, sets: s.sets, court_count: s.courtCount,
        exact: s.exact, partial: s.partial, sort_order: s.sortOrder,
      },
      { onConflict: 'fixture_id,sort_order' },
    ).select('id').single()
    if (error || !data) throw new Error(`Failed to upsert slot ${s.fixtureCode}/${s.sortOrder}: ${error?.message}`)

    // Replace the line-up wholesale so a corrected re-import drops stale names.
    await supabase.from('team_fixture_slot_players').delete().eq('slot_id', data.id)
    const rows = s.playerNames.map(n => ({ slot_id: data.id, player_id: idByNormalized.get(normalize(n))! }))
    const { error: linkErr } = await supabase.from('team_fixture_slot_players').insert(rows)
    if (linkErr) throw new Error(`Failed to link players on ${s.fixtureCode}/${s.sortOrder}: ${linkErr.message}`)
  }

  console.log('\nDone.')
}

main().catch(err => { console.error(err.message); process.exit(1) })
