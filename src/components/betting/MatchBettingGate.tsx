'use client'
// Page-level 18+ gate for the match detail page. Renders a blocking modal over the
// page ONLY when the match is betting-eligible (flag + enabled market + premier tier
// + consent) AND the user hasn't made an age decision yet. Answering it once is
// remembered device-wide (useAgeGate), so it never re-appears.
//
// Decline / under-age → modal closes and the page shows WITHOUT odds (we never
// permanently withhold a score). Eligibility comes from useBettingEligibility, the
// same hook the inline odds widget reads — single source of truth.

import { useTranslations } from 'next-intl'
import { useBettingEligibility } from '@/hooks/useBettingEligibility'
import { AgeGatePrompt } from './AgeGatePrompt'

export function MatchBettingGate({ tournamentLevel }: { tournamentLevel: string | null | undefined }) {
  const t = useTranslations('betting')
  const { market, needsAgeGate, setAgeVerification } = useBettingEligibility(tournamentLevel)

  if (!needsAgeGate || !market) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.78)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div style={{ width: '100%', maxWidth: 420, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <AgeGatePrompt
          minAge={market.minAge}
          onResolve={(r) => setAgeVerification({ ...r, decided_at: new Date().toISOString() })}
        />
        <p style={{ fontSize: 11, color: '#999', textAlign: 'center', margin: 0, lineHeight: 1.4 }}>
          {t(`disclaimers.${market.disclaimerKey}`)}
        </p>
      </div>
    </div>
  )
}
