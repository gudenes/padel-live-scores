// apps/ops/src/app/(app)/live-odds/_lib/stub-provider.ts
import type { LiveOddsSnapshot, Match } from './types'
import { seedHistory, jitterWinProb, computeKpis } from './odds-math'

const SEED: Match[] = [
  {
    id: 'm1',
    pair1: { name: 'Martínez / Rodríguez', gender: 'men', serving: true },
    pair2: { name: 'Bidahorria / Maldonado', gender: 'men', serving: false },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 3', round: 'QF',
    setScores: [{ a: 6, b: 3, current: false }, { a: 4, b: 2, current: true }],
    gamePoints: { a: '15', b: '30' }, status: 'Live',
    winProbA: 82, fairOddsA: 1.22, fairOddsB: 5.55, movement15m: 6, confidence: 'full', lastUpdatedSeconds: 5,
    winProbHistory: [], drivers: { firstServe: [72, 61], breakPts: ['3/5', '2/4'], totalPts: [58, 47] },
  },
  {
    id: 'm2',
    pair1: { name: 'Orsi / Zielinski', gender: 'men', serving: false },
    pair2: { name: 'Mornia / Salvado', gender: 'men', serving: true },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 1', round: 'QF',
    setScores: [{ a: 2, b: 6, current: false }, { a: 6, b: 5, current: true }],
    gamePoints: { a: '40', b: 'AD' }, status: 'Live',
    winProbA: 46, fairOddsA: 2.17, fairOddsB: 1.85, movement15m: -34, confidence: 'full', lastUpdatedSeconds: 8,
    winProbHistory: [],
  },
  {
    id: 'm3',
    pair1: { name: 'Bengoechea / Villa', gender: 'women', serving: false },
    pair2: { name: 'Goyeneche / Ryzhova', gender: 'women', serving: true },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 2', round: 'QF',
    setScores: [{ a: 4, b: 6, current: false }, { a: 1, b: 2, current: true }],
    gamePoints: null, status: 'Break',
    winProbA: 37, fairOddsA: 2.70, fairOddsB: 1.59, movement15m: -11, confidence: 'full', lastUpdatedSeconds: 6,
    winProbHistory: [],
  },
  {
    id: 'm4',
    pair1: { name: 'Granados / Esbri', gender: 'men', serving: true },
    pair2: { name: 'Sager / Serjani', gender: 'men', serving: false },
    tournament: 'FIP Platinum Sardegna', tournamentShort: 'FIP Sardegna', court: 'Court 1', round: 'R16',
    setScores: [{ a: 7, b: 6, current: false }, { a: 2, b: 1, current: true }],
    gamePoints: { a: '30', b: '15' }, status: 'Live',
    winProbA: 71, fairOddsA: 1.41, fairOddsB: 3.45, movement15m: 4, confidence: 'full', lastUpdatedSeconds: 11,
    winProbHistory: [],
  },
  {
    id: 'm5',
    pair1: { name: 'Herrera / Pons', gender: 'men', serving: false },
    pair2: { name: 'Lacabe / Alonso', gender: 'men', serving: false },
    tournament: 'FIP Platinum Sardegna', tournamentShort: 'FIP Sardegna', court: 'Court 2', round: 'R16',
    setScores: [{ a: 5, b: 3, current: true }],
    gamePoints: { a: '15', b: '15' }, status: 'Live',
    winProbA: 64, fairOddsA: 1.56, fairOddsB: 2.78, movement15m: 0, confidence: 'med', lastUpdatedSeconds: 14,
    winProbHistory: [],
  },
  {
    id: 'm6',
    pair1: { name: 'Gala / Sirvent', gender: 'men', serving: true },
    pair2: { name: 'Ruiz / Sanz', gender: 'men', serving: false },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 4', round: 'QF',
    setScores: [{ a: 6, b: 3, current: false }, { a: 6, b: 4, current: true }],
    gamePoints: { a: '40', b: '30' }, status: 'Live',
    winProbA: 91, fairOddsA: 1.10, fairOddsB: 9.20, movement15m: 12, confidence: 'full', lastUpdatedSeconds: 5,
    winProbHistory: [],
  },
  {
    id: 'm7',
    pair1: { name: 'Nieto / Bautista', gender: 'men', serving: false },
    pair2: { name: 'Martín / Vicente', gender: 'men', serving: false },
    tournament: 'Premier Padel Italy Major', tournamentShort: 'Italy Major', court: 'Court 3', round: 'QF',
    setScores: [], gamePoints: null, status: 'Scheduled', scheduledTime: '11:00',
    winProbA: 58, fairOddsA: 1.72, fairOddsB: 2.38, movement15m: 0, confidence: 'med', lastUpdatedSeconds: 0,
    winProbHistory: [],
  },
  {
    id: 'm8',
    pair1: { name: 'Sánchez / García', gender: 'women', serving: false },
    pair2: { name: 'Diestro / González', gender: 'women', serving: false },
    tournament: 'FIP Platinum Sardegna', tournamentShort: 'FIP Sardegna', court: 'Court 1', round: 'R16',
    setScores: [], gamePoints: null, status: 'Scheduled', scheduledTime: '11:30',
    winProbA: 52, fairOddsA: 1.92, fairOddsB: 2.08, movement15m: 0, confidence: 'low', lastUpdatedSeconds: 0,
    winProbHistory: [],
  },
]

function snapshot(matches: Match[]): LiveOddsSnapshot {
  return { matches, kpis: computeKpis(matches) }
}

export type FeedListener = (s: LiveOddsSnapshot) => void

export function createStubFeed(reduced: boolean) {
  const matches = SEED.map(m => ({ ...m, winProbHistory: seedHistory(m.winProbA) }))
  let listeners: FeedListener[] = []
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false

  const emit = () => listeners.forEach(l => l(snapshot(matches)))

  function pump() {
    const live = matches.filter(m => m.status === 'Live')
    const k = 1 + Math.floor(Math.random() * 2)
    for (let i = 0; i < k; i++) {
      const m = live[Math.floor(Math.random() * live.length)]
      if (!m) continue
      const j = jitterWinProb(m.winProbA)
      m.winProbA = j.pa
      m.fairOddsA = parseFloat(j.oa); m.fairOddsB = parseFloat(j.ob)
      m.movement15m += Math.abs(j.delta) >= 1 ? j.delta : 0
      m.winProbHistory.push(j.pa); if (m.winProbHistory.length > 30) m.winProbHistory.shift()
      m.lastUpdatedSeconds = 3 + Math.floor(Math.random() * 6)
    }
    emit()
    timer = setTimeout(pump, 2200 + Math.random() * 1600)
  }

  return {
    subscribe(fn: FeedListener) { listeners.push(fn); fn(snapshot(matches)); return () => { listeners = listeners.filter(l => l !== fn) } },
    start() { if (running || reduced) return; running = true; timer = setTimeout(pump, 1400) },
    stop() { running = false; if (timer) { clearTimeout(timer); timer = null } },
  }
}
