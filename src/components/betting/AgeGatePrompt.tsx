'use client'
// Two-step 18+ gate UI. Step 1: "Are you 18+?" Yes/No. Step 2 (on Yes): month + year
// of birth (no day — this is an age gate, not KYC; real ID checks happen at the
// bookmaker). Month/Year dropdowns avoid the native date-picker's painful decades-back
// navigation. Eligibility is CONSERVATIVE (admit only if clearly >= minAge).
// Buttons use the shared PressButton primitive so the gate matches the site's
// chunky-CTA design language. Calls onResolve; parent persists via useAgeGate.

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { isOldEnoughByMonthYear } from '@/lib/age-gate'
import PressButton, { PRESS_PRESETS } from '@/components/PressButton'

export interface AgeGatePromptProps {
  minAge: number
  onResolve: (result: { verified: boolean; birthdate: string | null }) => void
}

// Palette aligned with the match detail surface (lib/constants.ts).
const CARD_BG = '#141414'
const CARD_BORDER = 'rgba(255,255,255,0.08)'
const INPUT_BG = '#0e0e0e'
const MUTED = '#6B7280'
const TEXT = '#ECECEC'
const TILT = 'polygon(0% 4%, 100% 0%, 100% 96%, 0% 100%)'

export function AgeGatePrompt({ minAge, onResolve }: AgeGatePromptProps) {
  const t = useTranslations('betting')
  const locale = useLocale()
  const [step, setStep] = useState<'ask' | 'birthdate'>('ask')
  const [month, setMonth] = useState('') // '1'..'12'
  const [year, setYear] = useState('')   // 'YYYY'
  const [error, setError] = useState(false)

  // Localized month names (Jan..Dec) for the dropdown.
  const months = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { month: 'long' })
    return Array.from({ length: 12 }, (_, i) => ({
      value: String(i + 1),
      label: fmt.format(new Date(Date.UTC(2021, i, 1))),
    }))
  }, [locale])

  // Year list: current year down to 100 years back (most recent first).
  const years = useMemo(() => {
    const current = new Date().getFullYear()
    return Array.from({ length: 101 }, (_, i) => String(current - i))
  }, [])

  function submit() {
    if (!month || !year) return
    const ok = isOldEnoughByMonthYear(Number(year), Number(month), minAge, new Date())
    if (!ok) {
      setError(true)
      onResolve({ verified: false, birthdate: null })
      return
    }
    const mm = String(Number(month)).padStart(2, '0')
    onResolve({ verified: true, birthdate: `${year}-${mm}-01` })
  }

  const wrap: React.CSSProperties = {
    background: CARD_BG,
    border: `1px solid ${CARD_BORDER}`,
    borderRadius: 12,
    padding: 18,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  }
  const ctaText: React.CSSProperties = {
    fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.4px',
  }
  const select: React.CSSProperties = {
    flex: 1, padding: '11px', borderRadius: 8, border: `1px solid ${CARD_BORDER}`,
    background: INPUT_BG, color: TEXT, fontSize: 14, appearance: 'none', fontFamily: 'inherit',
  }

  if (error) {
    return <div style={wrap}><p style={{ color: MUTED, fontSize: 13, margin: 0 }}>{t('ageGate.underage')}</p></div>
  }

  if (step === 'birthdate') {
    return (
      <div style={wrap}>
        <label style={{ color: MUTED, fontSize: 13 }}>{t('ageGate.birthdatePrompt')}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <select aria-label={t('ageGate.month')} value={month} onChange={(e) => setMonth(e.target.value)} style={select}>
            <option value="" disabled>{t('ageGate.month')}</option>
            {months.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <select aria-label={t('ageGate.year')} value={year} onChange={(e) => setYear(e.target.value)} style={select}>
            <option value="" disabled>{t('ageGate.year')}</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <PressButton
          {...PRESS_PRESETS.chunkyInline}
          onClick={submit}
          disabled={!month || !year}
          style={{ width: '100%', padding: '11px', opacity: !month || !year ? 0.5 : 1, ...ctaText }}
        >
          {t('ageGate.confirm')}
        </PressButton>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <p style={{ color: MUTED, fontSize: 12.5, margin: 0 }}>{t('ageGate.intro')}</p>
      <p style={{ color: TEXT, fontSize: 15, fontWeight: 800, margin: 0 }}>{t('ageGate.question')}</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <PressButton
          {...PRESS_PRESETS.chunkyInline}
          onClick={() => setStep('birthdate')}
          style={{ flex: 1, padding: '11px', ...ctaText }}
        >
          {t('ageGate.yes')}
        </PressButton>
        <PressButton
          clipPath={TILT}
          accent="#2A2A2A"
          skirt="#191919"
          textColor="#CFCFCF"
          depth={3}
          onClick={() => onResolve({ verified: false, birthdate: null })}
          style={{ flex: 1, padding: '11px', ...ctaText }}
        >
          {t('ageGate.no')}
        </PressButton>
      </div>
    </div>
  )
}
