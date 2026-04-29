// Find tournaments where main-draw rounds (R32/R16/R8/QF/SF/F) and
// qualifying rounds (Q1/Q2/Q3) both have matches scheduled on the
// same calendar day. That overlap is the signature of the round-mis-
// classification bug — qualifying never overlaps main draw on a real
// FIP schedule, so a same-day collision means at least one row is
// stamped with the wrong round.
//
// Output is a list of suspect tournaments + the rounds + days at
// fault. Use it as a follow-up audit; doesn't write anything.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

async function loadEnv() {
  const text = await fs.readFile(path.resolve('.env.local'), 'utf8')
  for (const line of text.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (!process.env[k]) process.env[k] = v
  }
}

function normalizeRoundShort(raw) {
  if (!raw) return null
  const cleaned = String(raw).trim().toLowerCase()
  const map = {
    r128: 'R128', 'round of 128': 'R128',
    r64: 'R64', 'round of 64': 'R64',
    r32: 'R32', 'round of 32': 'R32',
    r16: 'R16', 'round of 16': 'R16',
    qf: 'QF', quarter: 'QF', quarters: 'QF', quarterfinals: 'QF', 'quarter-finals': 'QF', 'quarter finals': 'QF',
    sf: 'SF', semifinals: 'SF', 'semi-finals': 'SF', 'semi finals': 'SF',
    f: 'F', final: 'F', finals: 'F',
    q1: 'Q1', q2: 'Q2', q3: 'Q3',
  }
  return map[cleaned] ?? null
}

const MAIN_DRAW = new Set(['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'])
const QUALIFYING = new Set(['Q1', 'Q2', 'Q3'])

async function main() {
  await loadEnv()
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
  )

  // Currently-active tournaments (window ±14d to keep query bounded)
  const cutoff = new Date(Date.now() - 14 * 86400000).toISOString()
  const horizon = new Date(Date.now() + 14 * 86400000).toISOString()
  const { data: tournaments } = await s
    .from('tournaments')
    .select('id, name, level')
    .gte('ends_at', cutoff)
    .lte('starts_at', horizon)
  console.log(`Active tournaments: ${tournaments?.length ?? 0}\n`)

  let suspectCount = 0
  for (const t of tournaments ?? []) {
    const { data: matches } = await s
      .from('matches')
      .select('id, round, scheduled_at, widget_id_composite')
      .eq('tournament_id', t.id)
      .not('scheduled_at', 'is', null)
    if (!matches || matches.length === 0) continue

    // Bucket by (canonical round, day)
    const byDay = new Map() // day → { mainRounds: Map<round, count>, qualRounds: Map<round, count>, mainExamples: [] }
    for (const m of matches) {
      const rn = normalizeRoundShort(m.round)
      if (!rn) continue
      const day = m.scheduled_at.slice(0, 10)
      if (!byDay.has(day)) byDay.set(day, { main: new Map(), qual: new Map(), mainExamples: [] })
      const slot = byDay.get(day)
      if (MAIN_DRAW.has(rn)) {
        slot.main.set(rn, (slot.main.get(rn) ?? 0) + 1)
        if (slot.mainExamples.length < 3) {
          slot.mainExamples.push({ id: m.id.slice(0, 8), round: rn, hasWidget: !!m.widget_id_composite })
        }
      } else if (QUALIFYING.has(rn)) {
        slot.qual.set(rn, (slot.qual.get(rn) ?? 0) + 1)
      }
    }

    // Find days with both
    const conflictDays = []
    for (const [day, slot] of byDay) {
      if (slot.main.size > 0 && slot.qual.size > 0) {
        conflictDays.push({ day, slot })
      }
    }
    if (conflictDays.length === 0) continue

    suspectCount++
    console.log(`⚠ ${t.name} (${t.level})`)
    console.log(`  ${t.id}`)
    for (const { day, slot } of conflictDays) {
      const m = [...slot.main.entries()].map(([r, n]) => `${r}=${n}`).join(', ')
      const q = [...slot.qual.entries()].map(([r, n]) => `${r}=${n}`).join(', ')
      console.log(`  ${day}: MAIN[${m}] + QUAL[${q}]`)
      slot.mainExamples.forEach((ex) => {
        console.log(`    suspect main row: id=${ex.id}.. round=${ex.round} widget=${ex.hasWidget ? 'yes' : 'NO'}`)
      })
    }
    console.log()
  }

  console.log(`\n=== Suspect tournaments: ${suspectCount} ===`)
}

main().catch((e) => { console.error(e); process.exit(1) })
