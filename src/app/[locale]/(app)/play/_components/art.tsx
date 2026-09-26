// src/app/[locale]/(app)/play/_components/art.tsx
//
// Procedural SVG art for the Play screens — a perspective court under a
// spotlight, tinted per market horizon. Stands in for the player photography
// we do not have rights to. Ported verbatim from the mockup's heroSVG().
//
// The sparkline is the one place the port deviates, and deliberately:
// the mockup fabricated a 26-point random walk per card. That is invented
// market data, and production has no trades to draw. The real component
// plots the crowd price series when the API supplies one and a flat line at
// the single real price when it does not — with the model's dashed line
// always drawn, because the gap between the two is the entire product.

import type { MarketHorizon } from './types'

// ── Palette per horizon ──────────────────────────────────────────
// live/match → lime · tourn → women pink · season → accent blue.
function toneColors(tone: MarketHorizon): { c: string; bg: string } {
  if (tone === 'tourn') return { c: '#F472B6', bg: '#140d12' }
  if (tone === 'season') return { c: '#38C8FF', bg: '#0b1016' }
  return { c: '#7ED321', bg: '#0d1410' }
}

export function HeroArt({ tone, idSeed }: { tone: MarketHorizon; idSeed: string }) {
  const { c, bg } = toneColors(tone)
  const sp = `pl-sp-${idSeed}`
  const fl = `pl-fl-${idSeed}`
  return (
    <svg viewBox="0 0 345 190" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id={sp} cx="50%" cy="26%" r="72%">
          <stop offset="0%" stopColor={c} stopOpacity=".34" />
          <stop offset="60%" stopColor={c} stopOpacity=".07" />
          <stop offset="100%" stopColor={bg} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={fl} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={c} stopOpacity=".13" />
          <stop offset="100%" stopColor={c} stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="345" height="190" fill={bg} />
      <rect width="345" height="190" fill={`url(#${sp})`} />
      <path d="M78 190 L142 40 L203 40 L267 190 Z" fill={`url(#${fl})`} />
      <g stroke={c} strokeOpacity=".22" fill="none" strokeWidth="1.1">
        <path d="M78 190 L142 40 L203 40 L267 190" />
        <path d="M40 190 L120 18 L225 18 L305 190" />
        <path d="M96 148 L249 148" />
        <path d="M110 104 L235 104" />
        <path d="M120 72 L225 72" />
        <path d="M172.5 148 L172.5 40" />
      </g>
      <g stroke={c} strokeOpacity=".5" fill="none" strokeWidth="1.6" strokeDasharray="3 5">
        <path d="M88 168 L257 168" />
      </g>
    </svg>
  )
}

/** The wide court behind the confirmation tick. */
export function ConfirmArt() {
  return (
    <svg viewBox="0 0 375 172" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="pl-cspot" cx="50%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#7ED321" stopOpacity=".30" />
          <stop offset="100%" stopColor="#0d1410" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="375" height="172" fill="#0d1410" />
      <rect width="375" height="172" fill="url(#pl-cspot)" />
      <g stroke="#7ED321" strokeOpacity=".17" fill="none" strokeWidth="1.1">
        <path d="M92 172 L150 42 L225 42 L283 172" />
        <path d="M60 172 L128 22 L247 22 L315 172" />
        <path d="M104 128 L271 128" />
        <path d="M118 88 L257 88" />
        <path d="M187.5 128 L187.5 42" />
      </g>
    </svg>
  )
}

/** 46px court thumbnail for the "Up next" card. */
export function ThumbArt({ tone }: { tone: MarketHorizon }) {
  const { c, bg } = toneColors(tone)
  return (
    <svg viewBox="0 0 46 46" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="46" height="46" fill={bg} />
      <g stroke={c} strokeOpacity=".4" fill="none" strokeWidth=".9">
        <path d="M10 46 L18 12 L28 12 L36 46" />
        <path d="M13 32 L33 32" />
        <path d="M23 32 L23 12" />
      </g>
    </svg>
  )
}

// ── Sparkline ────────────────────────────────────────────────────

export interface SparklineProps {
  /** Current crowd price, 0..1. */
  crowd: number
  /** Our model's probability, 0..1. */
  model: number
  /** Crowd price series oldest → newest, 0..1. Optional. */
  history?: number[]
  /** Unique suffix for the gradient id. */
  idSeed: string
}

export function Sparkline({ crowd, model, history, idSeed }: SparklineProps) {
  // With fewer than two real points there is nothing to draw a line
  // between, so the "series" is the current price held flat. That is the
  // honest picture of a market with no trades: the price has not moved.
  const vals = history && history.length > 1 ? history : [crowd, crowd]
  const n = vals.length
  const last = vals[n - 1] ?? crowd
  const first = vals[0] ?? crowd

  // Pad the domain by 5 percentage points either side, as the mockup does,
  // so a flat line sits mid-box instead of hugging an edge.
  const lo = Math.min(...vals, model) - 0.05
  const hi = Math.max(...vals, model) + 0.05
  const span = hi - lo || 1

  const X = (k: number) => (n === 1 ? 300 : (k / (n - 1)) * 300)
  const Y = (v: number) => 50 - ((v - lo) / span) * 44

  const pts = vals.map((v, k) => `${X(k).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')
  const area = `0,54 ${pts} 300,54`
  const up = last >= first
  const col = up ? '#7ED321' : '#FF4655'
  const my = Y(model).toFixed(1)
  const gid = `pl-sg-${idSeed}`

  return (
    <svg viewBox="0 0 300 54" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity=".26" />
          <stop offset="100%" stopColor={col} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} />
      <line
        x1="0" y1={my} x2="300" y2={my}
        stroke="#38C8FF" strokeOpacity=".75" strokeWidth="1.4"
        strokeDasharray="4 4" vectorEffect="non-scaling-stroke"
      />
      <polyline
        points={pts} fill="none" stroke={col} strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"
      />
      <circle cx="300" cy={Y(last).toFixed(1)} r="3" fill={col} />
    </svg>
  )
}
