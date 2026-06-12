// src/components/prediction/MatchVoteCard.tsx
'use client'
import { useTranslations } from 'next-intl'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

// Team colors mirror the match page's PAIR1_COLOR / PAIR2_COLOR
// (src/app/[locale]/match/[id]/lib/constants.ts) so the vote buttons + split
// bars match the momentum chart, stats bars and player cards. Pair 1 = brand
// orange, pair 2 = brand yellow; skirt = a darker shade for the PressButton
// 3D press effect.
const TEAMS = {
  1: { accent: '#FF6B2B', skirt: '#C2511F', text: '#1A1A1A' },
  2: { accent: '#FFD166', skirt: '#C9A23F', text: '#1A1A1A' },
} as const

const CHUNKY = 'polygon(1% 5%, 99% 0%, 100% 95%, 0% 100%)'

interface Props {
  pair1Label: string
  pair2Label: string
  yourPick: 1 | 2 | null
  aggregate: { pair1: number; pair2: number; total: number } | null
  locked: boolean
  onVote: (pair: 1 | 2) => void
}

export function MatchVoteCard({ pair1Label, pair2Label, yourPick, aggregate, locked, onVote }: Props) {
  const t = useTranslations('prediction')
  const revealed = (yourPick != null || locked) && aggregate != null
  const pct = (n: number) => (aggregate && aggregate.total > 0 ? Math.round((n / aggregate.total) * 100) : 0)

  // Locked match with no votes → nothing useful to show (model bar still renders above).
  if (locked && (!aggregate || aggregate.total === 0)) return null

  return (
    <div style={{ background: '#141414', padding: '14px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{t('whoWillWin')}</div>
      {/* Pre-vote prompt only — once revealed the % bars speak for themselves
          (we intentionally don't surface a fan count). */}
      {!revealed && (
        <div style={{ fontSize: 10, color: '#888', marginBottom: 11 }}>{t('castVote')}</div>
      )}

      {!revealed && !locked && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'stretch' }}>
          {([1, 2] as const).map((p) => {
            const team = TEAMS[p]
            return (
              <PressButton
                key={p}
                accent={team.accent}
                skirt={team.skirt}
                textColor={team.text}
                depth={4}
                clipPath={PRESS_PRESETS.chunkyTilted.clipPath}
                aria-pressed={yourPick === p}
                onClick={() => onVote(p)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '11px 8px',
                  fontSize: 12,
                  fontWeight: 800,
                  lineHeight: 1.25,
                  textAlign: 'center',
                }}
              >
                {p === 1 ? pair1Label : pair2Label}
              </PressButton>
            )
          })}
        </div>
      )}

      {revealed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {([1, 2] as const).map((p) => {
            const count = p === 1 ? aggregate!.pair1 : aggregate!.pair2
            const v = pct(count)
            const mine = yourPick === p
            const team = TEAMS[p]
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 22, background: '#23262d', borderRadius: 6, overflow: 'hidden', clipPath: CHUNKY }}>
                  <div style={{
                    height: '100%', width: `${v}%`, minWidth: v > 0 ? 34 : 0, background: team.accent,
                    display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11, fontWeight: 800, color: team.text,
                  }}>{v}%</div>
                </div>
                <span style={{ width: 92, fontSize: 11, color: mine ? '#fff' : '#9aa', fontWeight: mine ? 800 : 600 }}>
                  {p === 1 ? pair1Label : pair2Label}{mine ? ` ✓ ${t('yourPick')}` : ''}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
