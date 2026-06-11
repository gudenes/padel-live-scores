// src/components/prediction/MatchVoteCard.tsx
'use client'
import { useTranslations } from 'next-intl'

const GREEN = '#7ED321'
const FAN_BLUE = '#3aa0ff'
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
        <div style={{ display: 'flex', gap: 8 }}>
          {([1, 2] as const).map((p) => (
            <button
              key={p}
              type="button"
              disabled={locked}
              aria-pressed={yourPick === p}
              onClick={() => onVote(p)}
              style={{
                flex: 1, border: `1.5px solid ${GREEN}73`, borderRadius: 14, padding: '9px 6px',
                background: yourPick === p ? GREEN : 'rgba(126,211,33,0.04)',
                color: yourPick === p ? '#0a0a0a' : '#fff',
                fontSize: 12, fontWeight: 700, cursor: locked ? 'default' : 'pointer', opacity: locked && yourPick !== p ? 0.5 : 1,
              }}
            >
              {p === 1 ? pair1Label : pair2Label}
            </button>
          ))}
        </div>
      )}

      {revealed && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {([1, 2] as const).map((p) => {
            const count = p === 1 ? aggregate!.pair1 : aggregate!.pair2
            const v = pct(count)
            const mine = yourPick === p
            return (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, height: 22, background: '#23262d', borderRadius: 6, overflow: 'hidden', clipPath: CHUNKY }}>
                  <div style={{ height: '100%', width: `${v}%`, minWidth: v > 0 ? 34 : 0, background: mine ? `linear-gradient(90deg, ${FAN_BLUE}, #1f7fd6)` : '#2b2f37',
                    display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 11, fontWeight: 800, color: mine ? '#fff' : '#9aa' }}>{v}%</div>
                </div>
                <span style={{ width: 88, fontSize: 11, color: mine ? '#fff' : '#9aa', fontWeight: 600 }}>
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
