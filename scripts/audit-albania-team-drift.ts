/**
 * Audit: for every Albania widget present in both public.matches and the
 * latest fip_event_page draw_snapshot, flag rows where the team assignment
 * has drifted from the FIP draw. Also flag widgets where one side has been
 * absorbed into a walkover bye but public.matches still has both teams.
 *
 * Read-only.
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
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)
const T = '8a47598a-579b-4503-88c2-135306d274fb'

// Normalise a name for fuzzy compare: lowercase, strip diacritics,
// collapse whitespace.
function norm(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// A "name token" set — set of words. Order-independent.
function tokens(name: string | null | undefined): Set<string> {
  return new Set(norm(name).split(' ').filter(w => w.length >= 2))
}

// Does player A's name (as stored in players.name) plausibly match the
// short variant in the draw snapshot? E.g. players.name="Javier Garrido"
// vs draw "Javier Garrido" → exact. Or "Guillermo Collado Losada" vs
// draw "Guillermo Collado Losada" → exact. Some snapshots may abbreviate;
// we use token-subset.
function namesMatch(a: string | null, b: string | null): boolean {
  const ta = tokens(a)
  const tb = tokens(b)
  if (ta.size === 0 || tb.size === 0) return false
  // every token of the smaller side must appear in the larger side
  const [small, large] = ta.size <= tb.size ? [ta, tb] : [tb, ta]
  for (const t of small) if (!large.has(t)) return false
  return true
}

// Does pair (a1, a2) match pair (b1, b2) in either order?
function pairMatch(a1: string | null, a2: string | null, b1: string | null, b2: string | null): boolean {
  return (namesMatch(a1, b1) && namesMatch(a2, b2)) || (namesMatch(a1, b2) && namesMatch(a2, b1))
}

async function main() {
  // public.matches with player names
  const { data: dbMatches } = await s
    .from('matches')
    .select(`
      id, widget_id_composite, status, round, round_canonical, category, pair1_seed, pair2_seed,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('tournament_id', T)
  const byWidget = new Map<string, any>()
  for (const m of dbMatches ?? []) {
    const wid = (m.widget_id_composite ?? '').split(':')[1]
    if (wid) byWidget.set(wid, m)
  }

  // Latest fip_event_page draw_snapshot per widget
  const { data: snaps } = await s
    .schema('padelgod')
    .from('draw_snapshots')
    .select('match_widget_id, source, round_label, draw_position, status, team1_seed, team2_seed, team1_player1_name, team1_player2_name, team2_player1_name, team2_player2_name, captured_at')
    .eq('tournament_id', T)
    .eq('source', 'fip_event_page')
    .order('captured_at', { ascending: false })
    .limit(5000)
  const latestDraw = new Map<string, any>()
  for (const r of snaps ?? []) {
    if (!r.match_widget_id) continue
    if (!latestDraw.has(r.match_widget_id)) latestDraw.set(r.match_widget_id, r)
  }

  const drift: any[] = []
  const drawByeButDbHasBoth: any[] = []
  const matchedCleanly: string[] = []

  for (const [wid, db] of byWidget) {
    const dr = latestDraw.get(wid)
    if (!dr) continue // no FIP draw row to compare against (OOP-only widget)

    const dbP1 = (db.pair1_player1?.name ?? null) as string | null
    const dbP2 = (db.pair1_player2?.name ?? null) as string | null
    const dbP3 = (db.pair2_player1?.name ?? null) as string | null
    const dbP4 = (db.pair2_player2?.name ?? null) as string | null

    const t1HasNames = !!(dr.team1_player1_name || dr.team1_player2_name)
    const t2HasNames = !!(dr.team2_player1_name || dr.team2_player2_name)
    const drawIsBye = dr.status === 'walkover' && (!t1HasNames || !t2HasNames)

    const dbHasBothTeams = !!(dbP1 || dbP2) && !!(dbP3 || dbP4)

    if (drawIsBye) {
      // Draw says one team is empty (bye-recipient + TBD). DB should EITHER
      // be missing this widget (bye-through skipped) OR have only the
      // bye-recipient team filled.
      const realT = t1HasNames ? { p1: dr.team1_player1_name, p2: dr.team1_player2_name, seed: dr.team1_seed }
                                : { p1: dr.team2_player1_name, p2: dr.team2_player2_name, seed: dr.team2_seed }
      // Does either DB pair match the real team?
      const dbHasRealTeam =
        pairMatch(dbP1, dbP2, realT.p1, realT.p2) ||
        pairMatch(dbP3, dbP4, realT.p1, realT.p2)
      if (!dbHasRealTeam) {
        drift.push({
          wid, kind: 'BYE_WRONG_TEAM',
          db: { round: db.round, status: db.status, p1: dbP1, p2: dbP2, p3: dbP3, p4: dbP4 },
          draw: { round: dr.round_label, status: dr.status, real_team: realT },
        })
      } else if (dbHasBothTeams) {
        drawByeButDbHasBoth.push({
          wid, kind: 'BYE_BUT_DB_HAS_OPPONENT',
          db: { round: db.round, status: db.status, p1: dbP1, p2: dbP2, p3: dbP3, p4: dbP4 },
          draw: { round: dr.round_label, status: dr.status, real_team: realT },
        })
      }
      continue
    }

    // Both teams in the draw — compare DB pair1 to draw T1, DB pair2 to draw T2
    // (allow swap of which is T1 vs T2, since Crionet ordering can flip).
    const sameNoSwap =
      pairMatch(dbP1, dbP2, dr.team1_player1_name, dr.team1_player2_name) &&
      pairMatch(dbP3, dbP4, dr.team2_player1_name, dr.team2_player2_name)
    const sameWithSwap =
      pairMatch(dbP1, dbP2, dr.team2_player1_name, dr.team2_player2_name) &&
      pairMatch(dbP3, dbP4, dr.team1_player1_name, dr.team1_player2_name)
    if (sameNoSwap || sameWithSwap) {
      matchedCleanly.push(wid)
      continue
    }
    // Allow partial: any 1 side OK, the other drifted
    drift.push({
      wid, kind: 'TEAM_DRIFT',
      db: { round: db.round, status: db.status, seed1: db.pair1_seed, seed2: db.pair2_seed,
            pair1: `${dbP1 ?? '-'} / ${dbP2 ?? '-'}`, pair2: `${dbP3 ?? '-'} / ${dbP4 ?? '-'}` },
      draw: { round: dr.round_label, status: dr.status, seed1: dr.team1_seed, seed2: dr.team2_seed,
              T1: `${dr.team1_player1_name ?? '-'} / ${dr.team1_player2_name ?? '-'}`,
              T2: `${dr.team2_player1_name ?? '-'} / ${dr.team2_player2_name ?? '-'}` },
    })
  }

  // Also: widgets that exist in the draw but are MISSING from public.matches
  // (and not bye-through, since those should be skipped)
  const missingFromDb: any[] = []
  for (const [wid, dr] of latestDraw) {
    if (byWidget.has(wid)) continue
    const t1HasNames = !!(dr.team1_player1_name || dr.team1_player2_name)
    const t2HasNames = !!(dr.team2_player1_name || dr.team2_player2_name)
    const drawIsBye = dr.status === 'walkover' && (!t1HasNames || !t2HasNames)
    if (drawIsBye) continue // populator correctly skips first-MD bye-through; the broader bye check is OK
    if (!t1HasNames && !t2HasNames) continue // empty bracket cell
    missingFromDb.push({ wid, draw: { round: dr.round_label, status: dr.status,
      T1: `${dr.team1_player1_name ?? '-'} / ${dr.team1_player2_name ?? '-'}`,
      T2: `${dr.team2_player1_name ?? '-'} / ${dr.team2_player2_name ?? '-'}` } })
  }

  console.log(`== Albania 2026 team-drift audit ==`)
  console.log(`Widgets compared:        ${byWidget.size}`)
  console.log(`Latest fip_event_page snapshots: ${latestDraw.size}`)
  console.log(`Cleanly matched:         ${matchedCleanly.length}`)
  console.log(`TEAM_DRIFT mismatches:   ${drift.filter(d => d.kind === 'TEAM_DRIFT').length}`)
  console.log(`BYE_WRONG_TEAM:          ${drift.filter(d => d.kind === 'BYE_WRONG_TEAM').length}`)
  console.log(`BYE_BUT_DB_HAS_OPPONENT: ${drawByeButDbHasBoth.length}`)
  console.log(`Draw widgets missing from DB (excluding bye-through/empty cells): ${missingFromDb.length}`)

  for (const d of drift) {
    console.log(`\n--- ${d.kind} :: ${d.wid} ---`)
    console.log('  DB  :', JSON.stringify(d.db))
    console.log('  DRAW:', JSON.stringify(d.draw))
  }
  for (const d of drawByeButDbHasBoth) {
    console.log(`\n--- ${d.kind} :: ${d.wid} ---`)
    console.log('  DB  :', JSON.stringify(d.db))
    console.log('  DRAW:', JSON.stringify(d.draw))
  }
  if (missingFromDb.length > 0) {
    console.log('\n--- MISSING FROM public.matches ---')
    for (const m of missingFromDb) console.log(`  ${m.wid}: ${JSON.stringify(m.draw)}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
