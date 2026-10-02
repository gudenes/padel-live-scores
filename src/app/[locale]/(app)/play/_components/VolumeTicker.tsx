'use client'

import { useEffect, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { formatGuacas } from './shared'
import styles from './VolumeTicker.module.css'

export default function VolumeTicker({ volume, className = '' }: { volume: number; className?: string }) {
  const locale = useLocale()
  const t = useTranslations('play')
  const previous = useRef(volume)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const sequence = useRef(0)
  const [activity, setActivity] = useState<{ amount: number; id: number } | null>(null)

  useEffect(() => {
    const increase = volume - previous.current
    previous.current = volume
    if (increase > 0) {
      clearTimeout(timer.current)
      setActivity({ amount: increase, id: ++sequence.current })
      timer.current = setTimeout(() => setActivity(null), 3200)
    } else if (increase < 0) {
      clearTimeout(timer.current)
      setActivity(null)
    }
  }, [volume])
  useEffect(() => () => clearTimeout(timer.current), [])

  const amount = formatGuacas(volume, locale)
  return <div className={`${styles.ticker} ${className}`} title={t('deck.volumeWithSimulation', { amount })}>
    <span className={styles.dot} aria-hidden="true" />
    <span className={styles.total}>{t('deck.volumeTraded', { amount })}</span>
    <span className={styles.activity} aria-live="polite" aria-atomic="true">
      {activity && <span key={activity.id} className={styles.arrival}>{t('deck.volumeActivity', { amount: formatGuacas(activity.amount, locale) })}</span>}
    </span>
  </div>
}
