// src/components/prediction/MatchVoteCard.tsx
'use client'
import { useTranslations } from 'next-intl'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

// Team colors mirror the match page's PAIR1_COLOR / PAIR2_COLOR
// (src/app/[locale]/match/[id]/lib/constants.ts) so the vote buttons + bars
// match the momentum chart, stats bars and player cards. Pair 1 = brand
// orange, pair 2 = brand yellow; skirt = a darker shade for the press effect.
const PAIR1_COLOR = '#FF6B2B'
const PAIR2_COLOR = '#FFD166'
const TEAMS = {
  1: { accent: PAIR1_COLOR, skirt: '#C2511F', text: '#1A1A1A' },
  2: { accent: PAIR2_COLOR, skirt: '#C9A23F', text: '#1A1A1A' },
} as const
const CHUNKY_BAR = 'polygon(2% 10%, 99% 0%, 100% 90%, 1% 100%)'

interface Props {
  pair1Label: string
  pair2Label: string
  yourPick: 1 | 2 | null
  aggregate: { pair1: number; pair2: number; total: number; real?: number } | null
  locked: boolean
  onVote: (pair: 1 | 2) => void
}

export function MatchVoteCard({ pair1Label, pair2Label, yourPick, aggregate, locked, onVote }: Props) {
  const t = useTranslations('prediction')
  const revealed = (yourPick != null || locked) && aggregate != null
  const pct = (n: number) => (aggregate && aggregate.total > 0 ? Math.round((n / aggregate.total) * 100) : 0)

  // Genuine vote count (no model prior). Falls back to total when the API
  // didn't send `real` (e.g. in unit tests passing a literal aggregate).
  const realCount = aggregate ? (aggregate.real ?? aggregate.total) : 0

  // Nothing to show on a started match nobody actually voted on (the model
  // bar still renders above — we don't fake a community split).
  if (locked && realCount === 0) return null

  // ── Locked (match started): read-only community result, presented like the
  // prediction bar above so model vs community read at a glance. ───────────
  if (locked && aggregate) {
    const c1 = pct(aggregate.pair1)
    const c2 = 100 - c1
    return (
      <div style={{ background: '#141414', padding: '12px 16px', borderBottom: '0.5px solid rgba(255,255,255,0.06)' }}>
        <div style={{ fontSize: 9, letterSpacing: 1, textTransform: 'uppercase', fontWeight: 800, color: '#9AAEC4', marginBottom: 8 }}>
          👥 {t('communityHeader')}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#ddd', marginBottom: 5 }}>
          <span>{pair1Label}</span><span>{pair2Label}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 800, fontVariantNumeric: 'tabular-nums', marginBottom: 5 }}>
          <span style={{ color: PAIR1_COLOR }}>{c1}%{yourPick === 1 ? ' ✓' : ''}</span>
          <span style={{ color: PAIR2_COLOR }}>{c2}%{yourPick === 2 ? ' ✓' : ''}</span>
        </div>
        <div style={{ display: 'flex', height: 6, overflow: 'hidden', clipPath: CHUNKY_BAR, background: 'rgba(255,255,255,0.06)' }}>
          <div style={{ width: `${c1}%`, background: PAIR1_COLOR }} />
          <div style={{ width: `${c2}%`, background: PAIR2_COLOR }} />
        </div>
      </div>
    )
  }

  // ── Pre-match: interactive vote buttons. Before voting they show just the
  // label; once voted they also show the community % on the button. ────────
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
              accent={team.accent}
              skirt={team.skirt}
              textColor={team.text}
              depth={3}
              clipPath={PRESS_PRESETS.chunkyTilted.clipPath}
              aria-pressed={mine}
              onClick={() => onVote(p)}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '6px 6px',
                fontSize: 10.5,
                fontWeight: 800,
                lineHeight: 1.15,
                textAlign: 'center',
                opacity: dim ? 0.5 : 1,
              }}
            >
              <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
                <span>{p === 1 ? pair1Label : pair2Label}</span>
                {v != null && (
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
                    <span style={{ fontSize: 13, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>{v}%</span>
                    {mine && <span style={{ fontSize: 8.5, fontWeight: 800 }}>✓ {t('yourPick')}</span>}
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
