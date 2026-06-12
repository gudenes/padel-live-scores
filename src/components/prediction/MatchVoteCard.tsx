// src/components/prediction/MatchVoteCard.tsx
'use client'
import { useTranslations } from 'next-intl'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

// Two distinct team colors so the pairs read as opposing sides — pair 1
// brand lime, pair 2 blue. Used for both the vote buttons (PressButton
// chunky-tilted) and the revealed community split bars so the colors stay
// consistent across states.
const TEAMS = {
  1: { accent: '#7ED321', skirt: '#558D14', text: '#0a0a0a', fill: 'linear-gradient(90deg, #7ED321, #5fb314)' },
  2: { accent: '#4A9EFF', skirt: '#1A4F8A', text: '#ffffff', fill: 'linear-gradient(90deg, #4A9EFF, #1f7fd6)' },
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
      <div style={{ fontSize: 10, color: '#888', marginBottom: 11 }}>
        {aggregate && aggregate.total > 0 ? t('fansVoted', { count: aggregate.total }) : t('castVote')}
      </div>

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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {([1, 2] as const).map((p) => {
            const count = p === 1 ? aggregate!.pair1 : aggregate!.pair2
            const v = pct(count)
            const mine = yourPick === p
            const team = TEAMS[p]
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 22, background: '#23262d', borderRadius: 6, overflow: 'hidden', clipPath: CHUNKY }}>
                  <div style={{
                    height: '100%', width: `${v}%`, minWidth: v > 0 ? 34 : 0, background: team.fill,
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
