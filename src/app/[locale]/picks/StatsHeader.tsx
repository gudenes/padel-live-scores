'use client'

import { useTranslations } from 'next-intl'

const GREEN = '#7ED321'
const GOLD = '#FFD166'
const MUTED = '#6B7280'

const CHUNKY_TILE = 'polygon(3% 5%, 97% 0%, 100% 95%, 0% 100%)'

export interface StatsHeaderProps {
  displayName: string
  rank: number | null
  totalGuacas: number
  accuracyPct: number
  currentStreak: number
  bestStreak: number
}

export function StatsHeader({ displayName, rank, totalGuacas, accuracyPct, currentStreak, bestStreak }: StatsHeaderProps) {
  const t = useTranslations('prediction.myPicks')

  // Guard against email-shaped display_names (Apple private-relay
  // accounts) and other non-alpha first chars — show "?" instead of a
  // digit or "@" which looks like a glitch.
  const initial = /^[a-zA-Z]/.test(displayName) ? displayName.charAt(0).toUpperCase() : '?'

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%',
          background: 'linear-gradient(135deg, #FF6B2B, #FFD166)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 800, color: '#0a0a0a', flexShrink: 0,
        }}>{initial}</div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#fff' }}>{displayName}</div>
          {rank != null && (
            <div style={{ fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 700 }}>
              {t('rank', { rank })}
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 14 }}>
        <Tile value={totalGuacas.toLocaleString()} label={t('totalGuacas')} valueColor="#fff" />
        <Tile value={`${accuracyPct}%`} label={t('accuracy')} valueColor={GREEN} />
        <Tile value={String(currentStreak)} label={t('currentStreak')} valueColor={GOLD} />
        <Tile value={String(bestStreak)} label={t('bestStreak')} valueColor="#fff" />
      </div>
    </>
  )
}

function Tile({ value, label, valueColor }: { value: string; label: string; valueColor: string }) {
  return (
    <div style={{ background: '#141414', border: '0.5px solid rgba(255,255,255,0.06)', padding: '10px 8px', textAlign: 'center', clipPath: CHUNKY_TILE }}>
      <div style={{ fontSize: 18, fontWeight: 800, color: valueColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontSize: 8, textTransform: 'uppercase', letterSpacing: 0.5, color: MUTED, marginTop: 5, fontWeight: 700 }}>{label}</div>
    </div>
  )
}
