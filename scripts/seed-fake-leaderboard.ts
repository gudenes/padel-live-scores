#!/usr/bin/env npx tsx
/**
 * Seed fake users + picks so the leaderboard feels alive on day 1.
 *
 * Usage:
 *   npx tsx scripts/seed-fake-leaderboard.ts [--count 100] [--dry-run]
 *
 * Each fake user gets:
 *   - Plausible first+last name from a padel-skewed pool
 *   - DiceBear bottts-neutral avatar (URL keyed on email)
 *   - Identifiable email pattern: seed-<n>-<rand>@padelnachos.fake
 *
 * Each user picks a skewed-distribution number of finished matches
 * from the last 90 days, with realistic pair/margin bias. Picks are
 * resolved inline (result + reward written on insert) so the
 * leaderboard renders without waiting for the cron.
 *
 * Cleanup with: npx tsx scripts/clean-fake-leaderboard.ts
 */
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { computeMatchProbability, computeMultiplier } from '../src/lib/predictions/probability'
import { classifyResult, computeReward } from '../src/lib/predictions/scoring'
import type { Match } from '../src/types/match'
import type { Prediction } from '../src/lib/predictions/types'

// Load .env.local manually (dotenv isn't installed in this project).
// Mirrors the pattern in scripts/seed-player-equipment.ts.
const envPath = resolve(process.cwd(), '.env.local')
try {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/)
    if (m) process.env[m[1].trim()] = m[2].trim()
  }
} catch { /* fallback to existing env */ }

// ──────────────────────────────────────────────────────────────────
// Name pool — mix of Spanish, Portuguese, Italian, French, Argentine
// first names + surnames. Not real people; deliberately not famous
// padel players to avoid confusion.
// ──────────────────────────────────────────────────────────────────

const FIRST_NAMES = [
  // ES / AR
  'Alex', 'Carla', 'Diego', 'Marta', 'Lucas', 'Sofia', 'Pablo', 'Lucia', 'Mateo', 'Valeria',
  'Bruno', 'Camila', 'Leo', 'Julia', 'Tomás', 'Elena', 'Nico', 'Daniela', 'Iván', 'Paula',
  'Sergio', 'Martina', 'Ramón', 'Inés', 'Joaquín', 'Andrea', 'Gabi', 'Rocío', 'Manu', 'Pilar',
  // PT / BR
  'João', 'Beatriz', 'Pedro', 'Mariana', 'Tiago', 'Catarina', 'Rui', 'Ana', 'Miguel', 'Inês',
  'Ricardo', 'Carolina', 'Rafa', 'Helena', 'André', 'Leonor', 'Bruno', 'Margarida',
  // IT
  'Luca', 'Giulia', 'Marco', 'Chiara', 'Matteo', 'Francesca', 'Andrea', 'Alice', 'Giovanni', 'Sara',
  'Davide', 'Elena', 'Stefano', 'Martina', 'Roberto', 'Federica',
  // FR
  'Lucas', 'Léa', 'Hugo', 'Manon', 'Jules', 'Camille', 'Théo', 'Chloé', 'Antoine', 'Jeanne',
  'Maxime', 'Sarah', 'Romain', 'Pauline',
]

const LAST_NAMES = [
  // ES / AR
  'García', 'Martínez', 'Rodríguez', 'López', 'Hernández', 'Pérez', 'Sánchez', 'Ramírez',
  'Torres', 'Flores', 'Romero', 'Vargas', 'Castro', 'Ortiz', 'Núñez', 'Ruiz', 'Iglesias',
  'Domínguez', 'Cabrera', 'Mendoza', 'Vázquez', 'Aguirre', 'Suárez',
  // PT / BR
  'Silva', 'Santos', 'Oliveira', 'Souza', 'Pereira', 'Costa', 'Carvalho', 'Almeida', 'Lima',
  'Gomes', 'Ribeiro', 'Cardoso', 'Martins', 'Rocha',
  // IT
  'Rossi', 'Russo', 'Ferrari', 'Esposito', 'Bianchi', 'Romano', 'Colombo', 'Ricci',
  'Marino', 'Conti', 'Greco', 'Gallo', 'Lombardi', 'Moretti', 'Barbieri',
  // FR
  'Martin', 'Bernard', 'Dubois', 'Thomas', 'Robert', 'Richard', 'Petit', 'Durand',
  'Leroy', 'Moreau', 'Simon', 'Laurent',
]

// ──────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
function randomInt(lo: number, hi: number): number { return Math.floor(Math.random() * (hi - lo + 1)) + lo }
function randomFloat() { return Math.random() }

function generateName(): { first: string; last: string; full: string } {
  const first = pick(FIRST_NAMES)
  const last = pick(LAST_NAMES)
  return { first, last, full: `${first} ${last}` }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * Skewed pick-count distribution. Returns how many picks user index `i`
 * (out of `total`) should make. Power-user / active / casual buckets.
 */
function pickCountFor(i: number, total: number): number {
  const ratio = i / total
  if (ratio < 0.05) return randomInt(50, 80)   // top 5% — heavy users
  if (ratio < 0.20) return randomInt(20, 40)   // next 15% — active
  if (ratio < 0.50) return randomInt(8, 15)    // next 30% — regular
  return randomInt(2, 7)                        // bottom 50% — casual
}

// ──────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const countArg = args.find(a => a.startsWith('--count'))
  const count = countArg ? parseInt(countArg.split(/[ =]/)[1] ?? '100', 10) : 100

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY in env')
    process.exit(1)
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  console.log(`[seed] Fetching finished matches from the last 90 days...`)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  const { data: rawMatches, error: matchErr } = await supabase
    .from('matches')
    .select(`
      id, status, winner_pair, scheduled_at, tournament_id,
      pair1_player1:pair1_player1_id ( id, ranking ),
      pair1_player2:pair1_player2_id ( id, ranking ),
      pair2_player1:pair2_player1_id ( id, ranking ),
      pair2_player2:pair2_player2_id ( id, ranking ),
      sets ( set_number, pair1_games, pair2_games )
    `)
    .in('status', ['finished', 'retired', 'walkover'])
    .gte('scheduled_at', ninetyDaysAgo)
    .not('winner_pair', 'is', null)
    .limit(2000)

  if (matchErr) {
    console.error('[seed] Failed to fetch matches:', matchErr)
    process.exit(1)
  }

  const matches = (rawMatches ?? []) as unknown as Match[]
  console.log(`[seed] Found ${matches.length} eligible finished matches`)
  if (matches.length < 50) {
    console.warn('[seed] Fewer than 50 matches available — leaderboard will be sparse')
  }

  // Generate users
  console.log(`[seed] Generating ${count} fake users...`)
  type FakeUser = { id: string; name: string; email: string; image: string }
  const userRows: Array<Omit<FakeUser, 'id'>> = []
  const usedEmails = new Set<string>()

  for (let i = 0; i < count; i++) {
    const { full } = generateName()
    let email: string
    do {
      const rand = Math.random().toString(36).slice(2, 8)
      email = `seed-${i + 1}-${rand}@padelnachos.fake`
    } while (usedEmails.has(email))
    usedEmails.add(email)

    const image = `https://api.dicebear.com/9.x/bottts-neutral/svg?seed=${encodeURIComponent(email)}`
    userRows.push({ name: full, email, image })
  }

  if (dryRun) {
    console.log('[seed] DRY RUN — first 5 users would be:')
    console.table(userRows.slice(0, 5))
    return
  }

  console.log(`[seed] Inserting ${userRows.length} users into public.users...`)
  const { data: insertedUsers, error: userErr } = await supabase
    .from('users')
    .insert(userRows)
    .select('id, email')

  if (userErr) {
    console.error('[seed] User insert failed:', userErr)
    process.exit(1)
  }

  const users = insertedUsers as Array<{ id: string; email: string }>
  console.log(`[seed] Inserted ${users.length} users`)

  // Generate predictions
  console.log(`[seed] Generating predictions...`)
  const allPredictionRows: Array<{
    user_id: string
    match_id: string
    pair: 1 | 2
    margin: '2-0' | '2-1'
    probability: number
    multiplier: number
    is_fallback: boolean
    result: string | null
    reward: number | null
    resolved_at: string | null
    created_at: string
  }> = []

  let skippedCount = 0
  for (let i = 0; i < users.length; i++) {
    const user = users[i]
    const numPicks = Math.min(pickCountFor(i, users.length), matches.length)
    const userMatches = shuffle(matches).slice(0, numPicks)

    for (const m of userMatches) {
      const prob = computeMatchProbability(m)
      // 65% pick the favorite, 35% pick the underdog. With 50/50 fallbacks just flip a coin.
      const favorPair: 1 | 2 = prob.p1 >= prob.p2 ? 1 : 2
      const dogPair: 1 | 2 = favorPair === 1 ? 2 : 1
      const pair: 1 | 2 = randomFloat() < 0.65 ? favorPair : dogPair
      const userPairProb = pair === 1 ? prob.p1 : prob.p2
      const multiplier = computeMultiplier(userPairProb, false)

      // 70% pick 2-0, 30% pick 2-1
      const margin: '2-0' | '2-1' = randomFloat() < 0.7 ? '2-0' : '2-1'

      // createdAt: random time before scheduled_at, within last 90 days
      const scheduledAt = m.scheduled_at ? new Date(m.scheduled_at) : new Date()
      const earliest = Math.max(
        Date.now() - 90 * 24 * 60 * 60 * 1000,
        scheduledAt.getTime() - 7 * 24 * 60 * 60 * 1000,
      )
      const latest = scheduledAt.getTime() - 60 * 1000  // at least 1 min before start
      const createdAt = new Date(randomInt(earliest, latest)).toISOString()

      // Build a Prediction object for the resolver
      const prediction: Prediction = {
        matchId: m.id,
        pair,
        margin,
        probability: userPairProb,
        multiplier,
        isFallback: prob.isFallback,
        createdAt,
      }

      // Resolve inline so result + reward are stored
      const classified = classifyResult(prediction, m)
      if (!classified) { skippedCount++; continue }
      const reward = computeReward(prediction, classified)

      allPredictionRows.push({
        user_id: user.id,
        match_id: m.id,
        pair,
        margin,
        probability: userPairProb,
        multiplier,
        is_fallback: prob.isFallback,
        result: classified.result,
        reward,
        resolved_at: new Date().toISOString(),
        created_at: createdAt,
      })
    }
  }

  console.log(`[seed] Generated ${allPredictionRows.length} predictions (${skippedCount} skipped — unclassifiable)`)

  // Insert predictions in chunks of 500 to stay under Supabase's payload limit
  const CHUNK = 500
  let inserted = 0
  for (let off = 0; off < allPredictionRows.length; off += CHUNK) {
    const chunk = allPredictionRows.slice(off, off + CHUNK)
    const { error: predErr } = await supabase.from('predictions').insert(chunk)
    if (predErr) {
      console.error(`[seed] Prediction insert failed at offset ${off}:`, predErr)
      process.exit(1)
    }
    inserted += chunk.length
    process.stdout.write(`\r[seed] Inserted ${inserted} / ${allPredictionRows.length}`)
  }
  console.log(`\n[seed] Done. ${users.length} users, ${inserted} predictions written.`)
  console.log(`[seed] Cleanup with: npx tsx scripts/clean-fake-leaderboard.ts`)
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
