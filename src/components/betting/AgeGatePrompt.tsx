'use client'
// Two-step 18+ gate UI. Step 1: "Are you 18+?" Yes/No. Step 2 (on Yes): month + year
// of birth (no day — this is an age gate, not KYC; real ID checks happen at the
// bookmaker). Month/Year dropdowns avoid the native date-picker's painful decades-back
// navigation. Eligibility is CONSERVATIVE (admit only if clearly >= minAge).
// Calls onResolve with the outcome; the parent persists it via useAgeGate.

import { useMemo, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { isOldEnoughByMonthYear } from '@/lib/age-gate'

export interface AgeGatePromptProps {
  minAge: number
  onResolve: (result: { verified: boolean; birthdate: string | null }) => void
}

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
    background: '#161616',
    border: '0.5px solid #2a2a2a',
    borderRadius: 8,
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  }
  const btn: React.CSSProperties = {
    padding: '10px 14px', borderRadius: 6, fontWeight: 700, fontSize: 14,
    cursor: 'pointer', border: 'none',
  }
  const select: React.CSSProperties = {
    flex: 1, padding: '10px', borderRadius: 6, border: '0.5px solid #333',
    background: '#0e0e0e', color: '#eee', fontSize: 14, appearance: 'none',
  }

  if (error) {
    return <div style={wrap}><p style={{ color: '#bbb', fontSize: 13, margin: 0 }}>{t('ageGate.underage')}</p></div>
  }

  if (step === 'birthdate') {
    return (
      <div style={wrap}>
        <label style={{ color: '#bbb', fontSize: 13 }}>{t('ageGate.birthdatePrompt')}</label>
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
        <button style={{ ...btn, background: '#6abf3a', color: '#0a0a0a' }} onClick={submit} disabled={!month || !year}>
          {t('ageGate.confirm')}
        </button>
      </div>
    )
  }

  return (
    <div style={wrap}>
      <p style={{ color: '#bbb', fontSize: 13, margin: 0 }}>{t('ageGate.intro')}</p>
      <p style={{ color: '#eee', fontSize: 15, fontWeight: 700, margin: 0 }}>{t('ageGate.question')}</p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button style={{ ...btn, background: '#6abf3a', color: '#0a0a0a', flex: 1 }} onClick={() => setStep('birthdate')}>
          {t('ageGate.yes')}
        </button>
        <button style={{ ...btn, background: '#262626', color: '#ccc', flex: 1 }} onClick={() => onResolve({ verified: false, birthdate: null })}>
          {t('ageGate.no')}
        </button>
      </div>
    </div>
  )
}
