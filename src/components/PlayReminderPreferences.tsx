'use client'
import { useEffect, useState } from 'react'
import { useLocale } from 'next-intl'
import { IconSlider } from '@/components/IconSlider'
import { reminderCopy, reminderLocale } from '@/lib/play-reminders/copy'
type Prefs = {
  email_enabled: boolean
  push_enabled: boolean
  timezone: string | null
}
export function PlayReminderPreferences({
  pushEnabled,
}: {
  pushEnabled: boolean
}) {
  const c = reminderCopy[reminderLocale(useLocale())],
    [prefs, setPrefs] = useState<Prefs | null>(null),
    [saving, setSaving] = useState(false),
    [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    fetch('/api/play/reminder-prefs', { cache: 'no-store' })
      .then(async (r) => {
        if (r.ok && active) setPrefs(await r.json())
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  async function save(key: 'email_enabled' | 'push_enabled', value: boolean) {
    if (!prefs || saving) return
    const old = prefs,
      next = {
        ...prefs,
        [key]: value,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }
    setPrefs(next)
    setSaving(true)
    setMessage('')
    try {
      const r = await fetch('/api/play/reminder-prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      })
      if (!r.ok) throw Error()
      setMessage(c.saved)
    } catch {
      setPrefs(old)
      setMessage(c.error)
    } finally {
      setSaving(false)
    }
  }
  if (!prefs) return null
  return (
    <section
      style={{
        padding: '18px 14px',
        border: '1px solid rgba(133,220,32,.25)',
        background: 'rgba(133,220,32,.04)',
      }}
    >
      <h2 style={{ fontSize: 14, fontWeight: 800, margin: '0 0 14px' }}>
        {c.settingsTitle}
      </h2>
      {(['email_enabled', 'push_enabled'] as const).map((key) => (
        <div
          key={key}
          style={{
            display: 'flex',
            gap: 14,
            alignItems: 'center',
            padding: '10px 0',
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {key === 'email_enabled' ? c.email : c.push}
            </div>
            <p
              style={{
                fontSize: 12,
                color: '#aebdb3',
                lineHeight: 1.5,
                margin: '4px 0 0',
              }}
            >
              {key === 'email_enabled' ? c.emailSub : c.pushSub}
            </p>
          </div>
          <IconSlider
            checked={prefs[key]}
            disabled={
              saving || (key === 'push_enabled' && !pushEnabled && !prefs[key])
            }
            ariaLabel={key === 'email_enabled' ? c.email : c.push}
            onChange={(value) => save(key, value)}
          />
        </div>
      ))}
      <span role="status" style={{ fontSize: 12, color: '#adc6a4' }}>
        {message}
      </span>
    </section>
  )
}
