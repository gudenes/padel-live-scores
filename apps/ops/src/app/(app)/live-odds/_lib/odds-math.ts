// apps/ops/src/app/(app)/live-odds/_lib/odds-math.ts
import type { Match, Kpis } from './types'

export function fmtOdds(pct: number): string {
  let p = pct
  if (p < 1) p = 1
  if (p > 99) p = 99
  return (100 / p).toFixed(2)
}

export function seedHistory(target: number, rng: () => number = Math.random): number[] {
  const n = 26
  const hist: number[] = []
  let p = Math.min(92, Math.max(8, target - (rng() * 26 + 8)))
  for (let i = 0; i < n; i++) {
    const pull = (target - p) * 0.1
    p += pull + (rng() - 0.5) * 7
    p = Math.min(95, Math.max(5, p))
    hist.push(p)
  }
  hist[hist.length - 1] = target
  return hist
}

export function chartPoints(hist: number[], cw: number, ch: number): Array<[number, number]> {
  const n = hist.length
  return hist.map((v, i) => [ (n === 1 ? 0 : (i / (n - 1)) * cw), ch - (v / 100) * ch ])
}

export function jitterWinProb(prevA: number, rng: () => number = Math.random) {
  let pa = prevA + Math.round((rng() - 0.5) * 9)
  pa = Math.min(96, Math.max(4, pa))
  const pb = 100 - pa
  return { pa, pb, oa: fmtOdds(pa), ob: fmtOdds(pb), delta: pa - prevA }
}

export function computeKpis(matches: Match[]): Kpis {
  const live = matches.filter(m => m.status === 'Live')
  const lowCoverage = live.filter(m => m.confidence === 'low').length
  let biggest = { pct: 0, label: '' }
  for (const m of live) {
    if (Math.abs(m.movement15m) > Math.abs(biggest.pct)) {
      biggest = { pct: m.movement15m, label: `${m.pair1.name.split(' / ')[0]}/${m.pair1.name.split(' / ')[1] ?? ''} vs ${m.pair2.name.split(' / ')[0]}` }
    }
  }
  return {
    liveMatches: live.length,
    preMatchModeled: matches.filter(m => m.status === 'Scheduled').length,
    biggestSwing: biggest,
    lowCoverage,
  }
}
