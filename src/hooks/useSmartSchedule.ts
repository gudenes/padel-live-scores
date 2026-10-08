'use client'
import { useEffect, useState } from 'react'
import { useFeatureFlag } from './useFeatureFlag'
import { FLAG_KEYS } from '@/lib/feature-flags'
import { visibleForecast, type SmartScheduleForecast } from '@/lib/smart-schedule'

export function useSmartSchedule(match: { status: string; smart_schedule?: SmartScheduleForecast | null } | null) {
  const enabled = useFeatureFlag(FLAG_KEYS.SMART_SCHEDULE_ENABLED)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled || !match?.smart_schedule) return
    const update = () => setNow(Date.now())
    update()
    const timer = setInterval(update, 30_000)
    return () => clearInterval(timer)
  }, [enabled, match?.smart_schedule])
  return { enabled, now, forecast: enabled && match ? visibleForecast(match.smart_schedule, match.status, now) : null }
}
