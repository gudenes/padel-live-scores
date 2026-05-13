import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

const TIER_W = { p1:1.00, major:0.95, p2:0.85, premier_mens:0.85, premier_womens:0.85, fip_gold:0.75, fip_silver:0.70, fip_bronze:0.65 }
const tierW = (lvl) => TIER_W[(lvl||'').toLowerCase()] ?? 0.7
const ROUND_W = (r) => {
  const s = (r || '').toLowerCase()
  if (s.includes('final') && !s.includes('semi') && !s.includes('quarter')) return 1.15
  if (s.includes('semi') || s === '1/2') return 0.90
  if (s.includes('quarter') || s === '1/4') return 0.80
  if (s.includes('r16') || s === '1/8') return 0.70
  if (s.includes('r32') || s === '1/16') return 0.62
  if (s.includes('r64') || s === '1/32') return 0.55
  if (s.includes('r128')) return 0.48
  if (s.includes('q') || s.includes('quali')) return 0.40
  return 0.55
}
const hasUnranked = (m) =>
  !m.pair1_player1?.ranking || !m.pair1_player2?.ranking ||
  !m.pair2_player1?.ranking || !m.pair2_player2?.ranking
const UNRANKED_PENALTY = 0.15
const clamp01 = (n) => Math.max(0, Math.min(1, n))
const pairEff = (p1,p2) => { const r1=p1?.ranking??1500, r2=p2?.ranking??1500; const b=Math.min(r1,r2), w=Math.max(r1,r2); return b*0.65 + w*0.35 }
const pWin = (a,b) => 1/(1+10**((a-b)/400))
const parity = (p) => 1 - 2*Math.abs(p-0.5)
const starPower = (a) => Math.max(0, Math.min(1, (2000-a)/2000))

const tournamentIds = [
  // P1 R32
  'BUENOS AIRES P1',
  // FIP Bronze that has finals around 2026-05-12
  'FIP BRONZE PRISHTINA',
  'FIP BRONZE SAMUI',
  'FIP BRONZE LONDON',
  'FIP BRONZE MOS MOSH',
]

const sample = []
for (const namePart of tournamentIds) {
  const { data: t } = await supabase
    .from('tournaments')
    .select('id, name, level')
    .ilike('name', `%${namePart}%`)
    .limit(1)
    .maybeSingle()
  if (!t) continue

  const { data: ms } = await supabase
    .from('matches')
    .select(`
      id, round, status, scheduled_at,
      pair1_player1:players!matches_pair1_player1_id_fkey(name, ranking),
      pair1_player2:players!matches_pair1_player2_id_fkey(name, ranking),
      pair2_player1:players!matches_pair2_player1_id_fkey(name, ranking),
      pair2_player2:players!matches_pair2_player2_id_fkey(name, ranking)
    `)
    .eq('tournament_id', t.id)
    .order('scheduled_at', { ascending: true })
    .limit(50)
  // pick highest-round match
  const ordered = (ms || []).filter(m => m.pair1_player1 && m.pair2_player1)
  ordered.sort((a,b) => ROUND_W(b.round) - ROUND_W(a.round))
  if (ordered[0]) sample.push({ tournament: t, match: ordered[0] })
}

const fmt = (n) => (n*100).toFixed(1).padStart(6)
const stars = (n) => Math.max(1, Math.min(5, Math.round(1+4*n)))

console.log('CROSS-TIER COMPARISON — best-round match per tournament\n')
console.log('TIER         TOURNAMENT'.padEnd(45) + 'ROUND'.padEnd(11) + 'MATCH'.padEnd(56) + 'A1'.padStart(7) + 'A2'.padStart(7) + 'A3'.padStart(7) + '   ★1 ★2 ★3')
console.log('─'.repeat(140))

for (const { tournament: t, match: m } of sample) {
  const pA = pairEff(m.pair1_player1, m.pair1_player2)
  const pB = pairEff(m.pair2_player1, m.pair2_player2)
  const par = parity(pWin(pA, pB))
  const star = starPower((pA+pB)/2)
  const damper = 0.5 + 0.5*star
  const tw = tierW(t.level), rw = ROUND_W(m.round)
  const unr = hasUnranked(m) ? UNRANKED_PENALTY : 1
  const a1 = clamp01(par * tw * rw * unr)
  const a2 = clamp01((0.45*star + 0.55*par) * tw * rw * unr)
  const a3 = clamp01(par * damper * tw * rw * unr)
  const last = (p) => p?.name?.split(' ').slice(-1)[0] ?? '?'
  const r = (p) => p?.ranking ?? '—'
  const label = `${last(m.pair1_player1)}(#${r(m.pair1_player1)})/${last(m.pair1_player2)}(#${r(m.pair1_player2)}) vs ${last(m.pair2_player1)}(#${r(m.pair2_player1)})/${last(m.pair2_player2)}(#${r(m.pair2_player2)})`
  console.log(
    `${t.level.padEnd(13)}${t.name.slice(0,30).padEnd(32)}` +
    (m.round||'?').slice(0,10).padEnd(11) +
    label.slice(0,55).padEnd(56) +
    fmt(a1) + fmt(a2) + fmt(a3) +
    `   ${stars(a1)}  ${stars(a2)}  ${stars(a3)}`
  )
}
