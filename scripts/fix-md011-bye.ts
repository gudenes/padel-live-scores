/**
 * One-shot fix: Albania MD011 (R16) — DB currently has Leal/Guerrero as
 * pair2 (status=scheduled) but the latest FIP draw says this slot is a
 * BYE walkover for Garrido/Bergamini (seed 5). Replace pair2, flip status
 * to walkover, set winner_pair=2 so they correctly show as advancing to QF.
 *
 *   npx tsx scripts/fix-md011-bye.ts            # dry-run
 *   npx tsx scripts/fix-md011-bye.ts --apply    # write
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

const TOURNAMENT_ID = '8a47598a-579b-4503-88c2-135306d274fb'
const WIDGET = 'FIP-2026-2214:MD011'
const APPLY = process.argv.includes('--apply')

async function findPlayer(name: string) {
  const { data } = await supabase.from('players').select('id, name, fip_id').eq('name', name).limit(5)
  if (!data || data.length === 0) { console.error(`No player "${name}"`); process.exit(2) }
  if (data.length > 1) { console.error(`Ambiguous "${name}":`, data); process.exit(3) }
  return data[0]
}

async function main() {
  const { data: before } = await supabase
    .from('matches')
    .select(`
      id, status, winner_pair, scheduled_at, court, round, pair1_seed, pair2_seed, widget_id_composite,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('tournament_id', TOURNAMENT_ID)
    .eq('widget_id_composite', WIDGET)
    .maybeSingle()
  if (!before) { console.error('No row for', WIDGET); process.exit(4) }

  console.log('BEFORE:')
  console.log(`  match_id=${before.id} status=${before.status} winner=${before.winner_pair} round=${before.round} seed1=${before.pair1_seed} seed2=${before.pair2_seed}`)
  console.log(`  pair1: ${(before as any).pair1_player1?.name ?? '-'} / ${(before as any).pair1_player2?.name ?? '-'}`)
  console.log(`  pair2: ${(before as any).pair2_player1?.name ?? '-'} / ${(before as any).pair2_player2?.name ?? '-'}`)

  if (before.status === 'finished' || before.status === 'retired') {
    console.error(`ABORT: status=${before.status} is terminal; not safe to overwrite`); process.exit(5)
  }

  const garrido = await findPlayer('Javier Garrido')
  const bergamini = await findPlayer('Lucas Bergamini')
  console.log('\nResolved bye-recipients:')
  console.log(`  ${garrido.name} (id=${garrido.id}, fip=${garrido.fip_id})`)
  console.log(`  ${bergamini.name} (id=${bergamini.id}, fip=${bergamini.fip_id})`)

  const patch: Record<string, any> = {
    pair2_player1_id: garrido.id,
    pair2_player2_id: bergamini.id,
    pair2_seed: 5,
    status: 'walkover',
    winner_pair: 2,
  }
  console.log('\nPATCH:', patch)

  if (!APPLY) { console.log('\n[dry-run] re-run with --apply to write.'); return }

  const { error } = await supabase.from('matches').update(patch).eq('id', before.id)
  if (error) { console.error('UPDATE failed:', error.message); process.exit(6) }

  const { data: after } = await supabase
    .from('matches')
    .select(`
      id, status, winner_pair, pair2_seed,
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('id', before.id).maybeSingle()
  console.log('\nAFTER:')
  console.log(`  status=${after?.status} winner=${after?.winner_pair} pair2_seed=${after?.pair2_seed}`)
  console.log(`  pair2: ${(after as any).pair2_player1?.name} / ${(after as any).pair2_player2?.name}`)
}
main().catch(e => { console.error(e); process.exit(1) })
