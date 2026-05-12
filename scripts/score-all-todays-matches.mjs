import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
)

// "Today" in UTC: 2026-05-12 00:00 → 2026-05-13 00:00
const startUtc = '2026-05-12T00:00:00.000Z'
const endUtc = '2026-05-13T00:00:00.000Z'

// ─── Locked formula (Approach 3) ─────────────────────────────────────
const TIER_W = {
  p1: 1.00, major: 0.95, p2: 0.85,
  premier_mens: 0.85, premier_womens: 0.85,
  fip_gold: 0.75, fip_silver: 0.70, fip_bronze: 0.65,
}
const tierW = (lvl) => TIER_W[(lvl || '').toLowerCase()] ?? 0.7

// normalize "Round of 32" → "r32", "1/16" → "r32", etc.
const roundKey = (r) => {
  const s = (r || '').toLowerCase().replace(/\s+/g, '')
  if (s.includes('final') && !s.includes('semi') && !s.includes('quarter')) return 'final'
  if (s.includes('semi') || s === '1/2' || s === 'sf') return 'sf'
  if (s.includes('quarter') || s === '1/4' || s === 'qf') return 'qf'
  if (s.includes('roundof16') || s.includes('r16') || s === '1/8') return 'r16'
  if (s.includes('roundof32') || s.includes('r32') || s === '1/16') return 'r32'
  if (s.includes('roundof64') || s.includes('r64') || s === '1/32') return 'r64'
  if (s.includes('roundof128') || s.includes('r128')) return 'r128'
  if (s.startsWith('q') || s.includes('quali')) return 'q'
  return 'unknown'
}
const ROUND_W_TABLE = { final:1.15, sf:0.90, qf:0.80, r16:0.70, r32:0.62, r64:0.55, r128:0.48, q:0.40, unknown:0.55 }
const ROUND_W = (r) => ROUND_W_TABLE[roundKey(r)]

const pairEff = (p1, p2) => {
  const r1 = p1?.ranking ?? 1500
  const r2 = p2?.ranking ?? 1500
  return Math.min(r1, r2) * 0.65 + Math.max(r1, r2) * 0.35
}
const pWin = (a, b) => 1 / (1 + 10 ** ((a - b) / 400))
const parity = (p) => 1 - 2 * Math.abs(p - 0.5)
const starPower = (a) => Math.max(0, Math.min(1, (2000 - a) / 2000))
const clamp01 = (n) => Math.max(0, Math.min(1, n))
const hasUnranked = (m) =>
  !m.pair1_player1?.ranking || !m.pair1_player2?.ranking ||
  !m.pair2_player1?.ranking || !m.pair2_player2?.ranking
const UNRANKED_PENALTY = 0.15

const ALPHA_TABLE = { final:0.00, sf:0.05, qf:0.10, r16:0.15, r32:0.20, r64:0.25, r128:0.30, q:0.35, unknown:0.20 }
const ALPHA = (r) => ALPHA_TABLE[roundKey(r)]
// star_strength — discrete tiers by ranking
const starStrength = (rank) => {
  if (!rank || rank > 100) return 0
  if (rank <= 5) return 1.00
  if (rank <= 15) return 0.75
  if (rank <= 30) return 0.50
  if (rank <= 60) return 0.25
  return 0.10
}
const bestRankOnCourt = (m) => {
  const ranks = [
    m.pair1_player1?.ranking,
    m.pair1_player2?.ranking,
    m.pair2_player1?.ranking,
    m.pair2_player2?.ranking,
  ].filter((r) => r != null)
  return ranks.length ? Math.min(...ranks) : null
}

function quality(m, tier) {
  const pA = pairEff(m.pair1_player1, m.pair1_player2)
  const pB = pairEff(m.pair2_player1, m.pair2_player2)
  const par = parity(pWin(pA, pB))
  const damper = 0.5 + 0.5 * starPower((pA + pB) / 2)
  const starBonus = ALPHA(m.round) * starStrength(bestRankOnCourt(m))
  const core = par * damper + starBonus
  const unr = hasUnranked(m) ? UNRANKED_PENALTY : 1
  return clamp01(core * tierW(tier) * ROUND_W(m.round) * unr)
}

// ─── Fetch ───────────────────────────────────────────────────────────
const { data: matches, error } = await supabase
  .from('matches')
  .select(`
    id, round, category, status, scheduled_at,
    tournament:tournaments(name, level),
    pair1_player1:players!matches_pair1_player1_id_fkey(name, ranking),
    pair1_player2:players!matches_pair1_player2_id_fkey(name, ranking),
    pair2_player1:players!matches_pair2_player1_id_fkey(name, ranking),
    pair2_player2:players!matches_pair2_player2_id_fkey(name, ranking)
  `)
  .in('status', ['scheduled', 'upcoming', 'live'])
  .gte('scheduled_at', startUtc)
  .lt('scheduled_at', endUtc)
  .order('scheduled_at', { ascending: true })

if (error) { console.error(error); process.exit(1) }

const stars = (n) => Math.max(1, Math.min(5, Math.round(1 + 4 * n)))
// Spanish/Portuguese convention: paternal surname is the SECOND word of the full name,
// not the last. "Alejandra Salazar Bengoechea" → "Salazar".
const last = (p) => {
  const parts = p?.name?.split(/\s+/) ?? []
  if (parts.length >= 2) return parts[1]
  return parts[0] ?? '?'
}
const rk = (p) => p?.ranking ? `#${p.ranking}` : '#—'

const rows = matches.map((m) => ({
  q: quality(m, m.tournament?.level),
  m,
}))
rows.sort((a, b) => b.q - a.q)

console.log(`Scored ${rows.length} matches scheduled 2026-05-12 (UTC)\n`)

console.log(
  'TIER'.padEnd(11) +
  'TOURNAMENT'.padEnd(28) +
  'ROUND'.padEnd(13) +
  'MATCH'.padEnd(56) +
  'SCORE'.padStart(6) + '   ★'
)
console.log('─'.repeat(120))

let starCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
for (const { q, m } of rows) {
  const s = stars(q)
  starCounts[s]++
  const label = `${last(m.pair1_player1)}(${rk(m.pair1_player1)})/${last(m.pair1_player2)}(${rk(m.pair1_player2)}) vs ${last(m.pair2_player1)}(${rk(m.pair2_player1)})/${last(m.pair2_player2)}(${rk(m.pair2_player2)})`
  console.log(
    (m.tournament?.level || '?').slice(0,10).padEnd(11) +
    (m.tournament?.name || '?').slice(0,26).padEnd(28) +
    (m.round || '?').slice(0,11).padEnd(13) +
    label.slice(0,54).padEnd(56) +
    (q * 100).toFixed(1).padStart(6) +
    `   ${s}`
  )
}

console.log('\nDistribution:')
for (const s of [5, 4, 3, 2, 1]) console.log(`  ★${s}: ${starCounts[s]}`)
