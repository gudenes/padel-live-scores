'use client'
// Two-step 18+ gate UI rendered in place of the odds unit until resolved.
// Step 1: "Are you 18+?" Yes/No. Step 2 (on Yes): date-of-birth input.
// Calls onResolve with the outcome; the parent persists it via useAgeGate.

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { isOldEnough } from '@/lib/age-gate'

export interface AgeGatePromptProps {
  minAge: number
  onResolve: (result: { verified: boolean; birthdate: string | null }) => void
}

export function AgeGatePrompt({ minAge, onResolve }: AgeGatePromptProps) {
  const t = useTranslations('betting')
  const [step, setStep] = useState<'ask' | 'birthdate'>('ask')
  const [birthdate, setBirthdate] = useState('')
  const [error, setError] = useState(false)

  function submitBirthdate() {
    if (!birthdate) return
    const ok = isOldEnough(birthdate, minAge, new Date())
    if (!ok) {
      setError(true)
      onResolve({ verified: false, birthdate: null })
      return
    }
    onResolve({ verified: true, birthdate })
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

  if (error) {
    return <div style={wrap}><p style={{ color: '#bbb', fontSize: 13, margin: 0 }}>{t('ageGate.underage')}</p></div>
  }

  if (step === 'birthdate') {
    return (
      <div style={wrap}>
        <label style={{ color: '#bbb', fontSize: 13 }}>{t('ageGate.birthdatePrompt')}</label>
        <input
          type="date"
          value={birthdate}
          max={new Date().toISOString().slice(0, 10)}
          onChange={(e) => setBirthdate(e.target.value)}
          style={{ padding: '10px', borderRadius: 6, border: '0.5px solid #333', background: '#0e0e0e', color: '#eee', fontSize: 14 }}
        />
        <button style={{ ...btn, background: '#6abf3a', color: '#0a0a0a' }} onClick={submitBirthdate} disabled={!birthdate}>
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
