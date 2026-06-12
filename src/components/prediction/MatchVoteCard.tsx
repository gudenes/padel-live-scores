// src/components/prediction/MatchVoteCard.tsx
'use client'
import { useTranslations } from 'next-intl'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

// Team colors mirror the match page's PAIR1_COLOR / PAIR2_COLOR
// (src/app/[locale]/match/[id]/lib/constants.ts) so the vote buttons match the
// momentum chart, stats bars and player cards. Pair 1 = brand orange, pair 2 =
// brand yellow; skirt = a darker shade for the PressButton 3D press effect.
const TEAMS = {
  1: { accent: '#FF6B2B', skirt: '#C2511F', text: '#1A1A1A' },
  2: { accent: '#FFD166', skirt: '#C9A23F', text: '#1A1A1A' },
} as const

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

  // Buttons render in every interactive/revealed state; only a fully-locked
  // match drops interactivity (renders as static chips). Before voting they
  // show just the label; once revealed they also show the community %.
  const interactive = !locked

  return (
    <div style={{ background: '#141414', padding: '14px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{t('whoWillWin')}</div>
      {!revealed && (
        <div style={{ fontSize: 10, color: '#888', marginBottom: 11 }}>{t('castVote')}</div>
      )}

      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', marginTop: revealed ? 10 : 0 }}>
        {([1, 2] as const).map((p) => {
          const team = TEAMS[p]
          const mine = yourPick === p
          const v = revealed ? pct(p === 1 ? aggregate!.pair1 : aggregate!.pair2) : null
          const dim = revealed && yourPick != null && !mine
          return (
            <PressButton
              key={p}
              as={interactive ? 'button' : 'div'}
              accent={team.accent}
              skirt={team.skirt}
              textColor={team.text}
              depth={4}
              clipPath={PRESS_PRESETS.chunkyTilted.clipPath}
              aria-pressed={mine}
              onClick={interactive ? () => onVote(p) : undefined}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '10px 8px',
                fontSize: 12,
                fontWeight: 800,
                lineHeight: 1.2,
                textAlign: 'center',
                opacity: dim ? 0.5 : 1,
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <span>{p === 1 ? pair1Label : pair2Label}</span>
                {v != null && (
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                    <span style={{ fontSize: 16, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{v}%</span>
                    {mine && <span style={{ fontSize: 10, fontWeight: 800 }}>✓ {t('yourPick')}</span>}
                  </span>
                )}
              </span>
            </PressButton>
          )
        })}
      </div>
    </div>
  )
}
