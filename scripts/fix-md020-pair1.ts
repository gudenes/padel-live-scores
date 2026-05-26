/**
 * One-shot fix: correct pair1 on Albania MD020 (match 93935b66) — currently
 * holds Garrido/Bergamini (BYE recipients, seed 5) but the actual R32 match
 * per the FIP draw snapshot is Barahona/Alfonso (seed 9) vs Hernandez/Collado.
 *
 *   npx tsx scripts/fix-md020-pair1.ts            # dry-run
 *   npx tsx scripts/fix-md020-pair1.ts --apply    # write
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

const MATCH_ID = '93935b66-119b-45da-b562-8af4bd94dadf'
const APPLY = process.argv.includes('--apply')

async function findPlayer(name: string): Promise<{ id: string; name: string; fip_id: string | null }> {
  // Strict: exact name match first
  const { data: exact } = await supabase
    .from('players')
    .select('id, name, fip_id')
    .eq('name', name)
    .limit(5)
  if (exact && exact.length === 1) return exact[0] as any
  if (exact && exact.length > 1) {
    console.error(`Ambiguous name "${name}" — ${exact.length} matches:`, exact)
    process.exit(2)
  }
  console.error(`No player found for "${name}"`)
  process.exit(3)
}

async function findPlayerByFip(fipId: string, expectedName: string): Promise<{ id: string; name: string; fip_id: string } | null> {
  const { data } = await supabase
    .from('players')
    .select('id, name, fip_id')
    .eq('fip_id', fipId)
    .maybeSingle()
  if (data) return data as any
  console.warn(`No player with fip_id=${fipId} (expected ${expectedName}). Falling back to name lookup.`)
  return null
}

async function main() {
  // Confirm current state
  const { data: before } = await supabase
    .from('matches')
    .select(`
      id, status, scheduled_at, court, round, pair1_seed, pair2_seed, widget_id_composite,
      pair1_player1_id, pair1_player2_id, pair2_player1_id, pair2_player2_id,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('id', MATCH_ID)
    .maybeSingle()
  if (!before) { console.error('Match not found'); process.exit(4) }
  console.log('BEFORE:')
  console.log(`  widget=${before.widget_id_composite} status=${before.status} sched=${before.scheduled_at} court=${before.court} seed1=${before.pair1_seed}`)
  console.log(`  pair1: ${(before as any).pair1_player1?.name} / ${(before as any).pair1_player2?.name}  (ids=${before.pair1_player1_id} / ${before.pair1_player2_id})`)
  console.log(`  pair2: ${(before as any).pair2_player1?.name} / ${(before as any).pair2_player2?.name}  (ids=${before.pair2_player1_id} / ${before.pair2_player2_id})`)

  // Resolve Barahona + Alfonso. Try exact name from draw snapshot first.
  const barahona = await findPlayer('Javier Barahona')
  const alfonso = await findPlayer('Gonzalo Gabriel Alfonso')
  console.log('\nResolved replacement pair1:')
  console.log(`  ${barahona.name} (id=${barahona.id}, fip=${barahona.fip_id})`)
  console.log(`  ${alfonso.name} (id=${alfonso.id}, fip=${alfonso.fip_id})`)

  // Safety: make sure we're not setting pair1 == pair2
  const pair2Ids = new Set([before.pair2_player1_id, before.pair2_player2_id])
  if (pair2Ids.has(barahona.id) || pair2Ids.has(alfonso.id)) {
    console.error('ABORT: replacement player overlaps with current pair2.')
    process.exit(5)
  }

  const patch = {
    pair1_player1_id: barahona.id,
    pair1_player2_id: alfonso.id,
    pair1_seed: 9,
  }
  console.log('\nPATCH:', patch)

  if (!APPLY) {
    console.log('\n[dry-run] re-run with --apply to write.')
    return
  }

  const { error } = await supabase
    .from('matches')
    .update(patch)
    .eq('id', MATCH_ID)
  if (error) { console.error('UPDATE failed:', error.message); process.exit(6) }
  console.log('\nUPDATE applied. Verifying...')

  const { data: after } = await supabase
    .from('matches')
    .select(`
      id, status, scheduled_at, court, round, pair1_seed, pair2_seed,
      pair1_player1:players!matches_pair1_player1_id_fkey(name),
      pair1_player2:players!matches_pair1_player2_id_fkey(name),
      pair2_player1:players!matches_pair2_player1_id_fkey(name),
      pair2_player2:players!matches_pair2_player2_id_fkey(name)
    `)
    .eq('id', MATCH_ID)
    .maybeSingle()
  console.log('AFTER:')
  console.log(`  pair1: ${(after as any).pair1_player1?.name} / ${(after as any).pair1_player2?.name}  (seed ${after?.pair1_seed})`)
  console.log(`  pair2: ${(after as any).pair2_player1?.name} / ${(after as any).pair2_player2?.name}  (seed ${after?.pair2_seed})`)
}
main().catch(e => { console.error(e); process.exit(1) })
