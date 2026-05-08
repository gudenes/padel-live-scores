/**
 * Audit ghost finished matches across the whole DB.
 *
 *   npx tsx scripts/audit-ghost-finished-matches.ts
 *
 * "Ghost" = a match row that survives the public.matches→players join as
 * fully empty:
 *   - status IN ('finished', 'walkover', 'retired')
 *   - all four pair*_player*_id FKs are null
 *   - all four pair*_player*_name columns are null
 *
 * These render as "TBD / TBD vs TBD / TBD" on the tournament page and are
 * the symptom this PR fixes upstream (in match-identifier.insertMatch).
 * The script is informational only — does NOT auto-delete. Use it to
 * decide on a one-off cleanup pass.
 *
 * Output: per-tournament breakdown sorted by ghost count, then a summary
 * grouped by tournament level.
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

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

const FINISHED_STATUSES = ['finished', 'walkover', 'retired']
const PAGE_SIZE = 1000

interface GhostMatch {
  id: string
  tournament_id: string
  status: string
  round: string | null
  category: string | null
  court: string | null
  finished_at: string | null
  last_updated_by: string | null
  widget_id_composite: string | null
}

interface TournamentMeta {
  id: string
  name: string
  level: string | null
  starts_at: string | null
}

async function loadGhosts(): Promise<GhostMatch[]> {
  const out: GhostMatch[] = []
  let from = 0
  for (;;) {
    const { data, error } = await supabase
      .from('matches')
      .select('id, tournament_id, status, round, category, court, finished_at, last_updated_by, widget_id_composite')
      .in('status', FINISHED_STATUSES)
      .is('pair1_player1_id', null)
      .is('pair1_player2_id', null)
      .is('pair2_player1_id', null)
      .is('pair2_player2_id', null)
      .is('pair1_player1_name', null)
      .is('pair1_player2_name', null)
      .is('pair2_player1_name', null)
      .is('pair2_player2_name', null)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`ghost query failed: ${error.message}`)
    if (!data || data.length === 0) break
    out.push(...(data as GhostMatch[]))
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return out
}

async function loadTournamentMeta(ids: string[]): Promise<Map<string, TournamentMeta>> {
  const map = new Map<string, TournamentMeta>()
  if (ids.length === 0) return map
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, level, starts_at')
      .in('id', ids.slice(i, i + 200))
    if (error) throw new Error(`tournaments query failed: ${error.message}`)
    for (const t of (data ?? []) as TournamentMeta[]) map.set(t.id, t)
  }
  return map
}

function formatDate(iso: string | null): string {
  if (!iso) return '          '
  return iso.slice(0, 10)
}

async function main() {
  console.log('Scanning matches for ghost finished rows…')
  const ghosts = await loadGhosts()
  console.log(`Total ghosts: ${ghosts.length}\n`)
  if (ghosts.length === 0) {
    console.log('Nothing to clean up. Producer-side fix should keep it that way.')
    return
  }

  const tournamentIds = Array.from(new Set(ghosts.map((g) => g.tournament_id)))
  const tMeta = await loadTournamentMeta(tournamentIds)

  // Group by tournament
  const byTournament = new Map<string, GhostMatch[]>()
  for (const g of ghosts) {
    const arr = byTournament.get(g.tournament_id) ?? []
    arr.push(g)
    byTournament.set(g.tournament_id, arr)
  }

  // Sort tournaments by ghost count desc, then by starts_at desc
  const sorted = Array.from(byTournament.entries()).sort(([aId, aGhosts], [bId, bGhosts]) => {
    if (bGhosts.length !== aGhosts.length) return bGhosts.length - aGhosts.length
    const aStart = tMeta.get(aId)?.starts_at ?? ''
    const bStart = tMeta.get(bId)?.starts_at ?? ''
    return bStart.localeCompare(aStart)
  })

  console.log('━'.repeat(100))
  console.log('PER-TOURNAMENT BREAKDOWN (most affected first)')
  console.log('━'.repeat(100))
  for (const [tid, gs] of sorted) {
    const t = tMeta.get(tid)
    const name = t?.name ?? '(unknown tournament)'
    const level = t?.level ?? '(no level)'
    const starts = formatDate(t?.starts_at ?? null)
    console.log(`\n[${gs.length}]  ${starts}  ${level.padEnd(15)}  ${name}`)
    console.log(`         tournament_id=${tid}`)
    // Show up to 5 examples
    for (const g of gs.slice(0, 5)) {
      console.log(`         - ${g.id.slice(0, 8)}  ${g.status.padEnd(8)}  ${(g.round ?? '-').padEnd(15)} ${g.category?.padEnd(6) ?? '-'} court=${g.court ?? '-'} finished_at=${g.finished_at ?? '-'}`)
    }
    if (gs.length > 5) console.log(`         … +${gs.length - 5} more`)
  }

  // Group by level summary
  console.log()
  console.log('━'.repeat(100))
  console.log('SUMMARY BY LEVEL')
  console.log('━'.repeat(100))
  const byLevel = new Map<string, number>()
  for (const g of ghosts) {
    const level = tMeta.get(g.tournament_id)?.level ?? '(no level)'
    byLevel.set(level, (byLevel.get(level) ?? 0) + 1)
  }
  const levelSorted = Array.from(byLevel.entries()).sort((a, b) => b[1] - a[1])
  for (const [level, count] of levelSorted) {
    console.log(`  ${level.padEnd(20)} ${count}`)
  }

  // Status breakdown
  console.log()
  console.log('SUMMARY BY STATUS')
  const byStatus = new Map<string, number>()
  for (const g of ghosts) byStatus.set(g.status, (byStatus.get(g.status) ?? 0) + 1)
  for (const [s, c] of byStatus) console.log(`  ${s.padEnd(10)} ${c}`)

  // last_updated_by breakdown — clue to producer
  console.log()
  console.log('SUMMARY BY last_updated_by (producer hint)')
  const byUpdater = new Map<string, number>()
  for (const g of ghosts) byUpdater.set(g.last_updated_by ?? '(null)', (byUpdater.get(g.last_updated_by ?? '(null)') ?? 0) + 1)
  for (const [u, c] of byUpdater) console.log(`  ${u.padEnd(20)} ${c}`)

  console.log()
  console.log('━'.repeat(100))
  console.log(`TOTAL ghost finished matches: ${ghosts.length} across ${tournamentIds.length} tournament(s)`)
  console.log('━'.repeat(100))
  console.log()
  console.log('To clean up a specific tournament, adapt scripts/delete-prishtina-ghost-q1.ts')
  console.log('with that tournament_id + the ghost match UUIDs printed above.')
}

main().catch((e) => { console.error(e); process.exit(1) })
