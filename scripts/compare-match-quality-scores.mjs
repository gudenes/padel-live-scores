import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

// Buenos Aires local day 2026-05-12 = UTC 03:00 → next-day 03:00
const startUtc = '2026-05-12T03:00:00.000Z'
const endUtc = '2026-05-13T03:00:00.000Z'

const { data: tournaments } = await supabase
  .from('tournaments')
  .select('id, name, level, country, starts_at, ends_at, status')
  .ilike('name', '%buenos aires%')
  .gte('ends_at', '2026-05-10')
  .order('starts_at', { ascending: false })

if (!tournaments?.length) {
  console.error('No Buenos Aires tournament found')
  process.exit(1)
}
const tournament = tournaments[0]
console.log(`Tournament: ${tournament.name} (${tournament.level}) — ${tournament.starts_at?.slice(0,10)} → ${tournament.ends_at?.slice(0,10)}`)

const { data: matches } = await supabase
  .from('matches')
  .select(`
    id, round, category, status, scheduled_at, court,
    pair1_player1:players!matches_pair1_player1_id_fkey(name, ranking),
    pair1_player2:players!matches_pair1_player2_id_fkey(name, ranking),
    pair2_player1:players!matches_pair2_player1_id_fkey(name, ranking),
    pair2_player2:players!matches_pair2_player2_id_fkey(name, ranking)
  `)
  .eq('tournament_id', tournament.id)
  .in('status', ['scheduled', 'upcoming'])
  .gte('scheduled_at', startUtc)
  .lt('scheduled_at', endUtc)
  .order('scheduled_at', { ascending: true })

if (!matches?.length) {
  console.error('No upcoming matches today in Buenos Aires; widening to next 3 days')
  const wider = await supabase
    .from('matches')
    .select(`
      id, round, category, status, scheduled_at, court,
      pair1_player1:players!matches_pair1_player1_id_fkey(name, ranking),
      pair1_player2:players!matches_pair1_player2_id_fkey(name, ranking),
      pair2_player1:players!matches_pair2_player1_id_fkey(name, ranking),
      pair2_player2:players!matches_pair2_player2_id_fkey(name, ranking)
    `)
    .eq('tournament_id', tournament.id)
    .in('status', ['scheduled', 'upcoming'])
    .gte('scheduled_at', '2026-05-12T00:00:00.000Z')
    .order('scheduled_at', { ascending: true })
    .limit(20)
  if (!wider.data?.length) {
    console.error('Still nothing.')
    process.exit(1)
  }
  matches.push(...wider.data)
}

// ─── Weights (from UTS/Wheelo research) ──────────────────────────────
const TIER_W_RAW = {
  p1: 1.00, major: 0.95, p2: 0.85,
  premier_mens: 0.85, premier_womens: 0.85,
  fip_gold: 0.75, fip_silver: 0.70, fip_bronze: 0.65,
}
const tierW = (level) => TIER_W_RAW[(level || '').toLowerCase()] ?? 0.7
const ROUND_W = (round) => {
  const r = (round || '').toLowerCase()
  if (r.includes('final') && !r.includes('semi') && !r.includes('quarter')) return 1.15
  if (r.includes('semi') || r === '1/2' || r === 'sf') return 0.90
  if (r.includes('quarter') || r === '1/4' || r === 'qf') return 0.80
  if (r.includes('r16') || r === '1/8') return 0.70
  if (r.includes('r32') || r === '1/16') return 0.62
  if (r.includes('r64') || r === '1/32') return 0.55
  if (r.includes('r128')) return 0.48
  if (r.includes('q') || r.includes('quali')) return 0.40
  return 0.55
}
const hasUnranked = (m) =>
  !m.pair1_player1?.ranking || !m.pair1_player2?.ranking ||
  !m.pair2_player1?.ranking || !m.pair2_player2?.ranking
const UNRANKED_PENALTY = 0.15

// Best rank in pair (one star pulls the pair up — anchored by best ranked partner)
const pairBest = (p1, p2) => {
  const r1 = p1?.ranking ?? 1500
  const r2 = p2?.ranking ?? 1500
  return Math.min(r1, r2)
}

// Pair "effective rank" = best · 0.65 + worst · 0.35
const pairEff = (p1, p2) => {
  const r1 = p1?.ranking ?? 1500
  const r2 = p2?.ranking ?? 1500
  const best = Math.min(r1, r2), worst = Math.max(r1, r2)
  return best * 0.65 + worst * 0.35
}

// Elo-style win-prob from rank delta (smoothed). 100-rank gap ≈ ~58/42 split.
const pWin = (rankA, rankB) => 1 / (1 + 10 ** ((rankA - rankB) / 400))

const parity = (pwA) => 1 - 2 * Math.abs(pwA - 0.5)

const starPower = (avgRank) => Math.max(0, Math.min(1, (2000 - avgRank) / 2000))

// ─── Formulas ────────────────────────────────────────────────────────
const clamp01 = (n) => Math.max(0, Math.min(1, n))
function approach1(m) {
  const pA = pairEff(m.pair1_player1, m.pair1_player2)
  const pB = pairEff(m.pair2_player1, m.pair2_player2)
  const par = parity(pWin(pA, pB))
  const q = par * tierW(tournament.level) * ROUND_W(m.round)
  return clamp01(hasUnranked(m) ? q * UNRANKED_PENALTY : q)
}
function approach2(m) {
  const pA = pairEff(m.pair1_player1, m.pair1_player2)
  const pB = pairEff(m.pair2_player1, m.pair2_player2)
  const par = parity(pWin(pA, pB))
  const star = starPower((pA + pB) / 2)
  const q = (0.45 * star + 0.55 * par) * tierW(tournament.level) * ROUND_W(m.round)
  return clamp01(hasUnranked(m) ? q * UNRANKED_PENALTY : q)
}
function approach3(m) {
  const pA = pairEff(m.pair1_player1, m.pair1_player2)
  const pB = pairEff(m.pair2_player1, m.pair2_player2)
  const par = parity(pWin(pA, pB))
  const damper = 0.5 + 0.5 * starPower((pA + pB) / 2)
  const q = par * damper * tierW(tournament.level) * ROUND_W(m.round)
  return clamp01(hasUnranked(m) ? q * UNRANKED_PENALTY : q)
}

const fmt = (n) => (n * 100).toFixed(1).padStart(5)
const stars = (n) => Math.max(1, Math.min(5, Math.round(1 + 4 * n)))

console.log('\n' + 'MATCH'.padEnd(70) + 'ROUND'.padEnd(9) + 'A1'.padStart(7) + 'A2'.padStart(7) + 'A3'.padStart(7) + '   ★1 ★2 ★3')
console.log('─'.repeat(110))

const rows = matches.map((m) => {
  const a1 = approach1(m), a2 = approach2(m), a3 = approach3(m)
  const name = (p) => p?.name?.split(' ').slice(-1)[0] ?? '?'
  const r = (p) => p?.ranking ?? '—'
  const pairStr = (p1, p2) =>
    `${name(p1)}(#${r(p1)})/${name(p2)}(#${r(p2)})`
  const label = `${pairStr(m.pair1_player1, m.pair1_player2)}  vs  ${pairStr(m.pair2_player1, m.pair2_player2)}`
  return { label, round: m.round, a1, a2, a3 }
})

rows.sort((x, y) => y.a3 - x.a3) // sort by approach 3 for stable display

for (const r of rows) {
  console.log(
    r.label.padEnd(70) +
    (r.round || '?').padEnd(9) +
    fmt(r.a1) + fmt(r.a2) + fmt(r.a3) +
    `   ${stars(r.a1)}  ${stars(r.a2)}  ${stars(r.a3)}`
  )
}

console.log('\nAll scores are 0–100 (×100 of raw quality). ★1–5 derived as round(1 + 4·q).')
console.log(`Tier weight applied: ${tournament.level} = ${tierW(tournament.level)}`)
